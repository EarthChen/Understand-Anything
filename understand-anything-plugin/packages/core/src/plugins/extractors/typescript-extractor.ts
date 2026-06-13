import type { StructuralAnalysis, CallGraphEntry, AnnotationInfo, PropertyInfo } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { getStringValue, findChild, findChildren } from "./base-extractor.js";

/**
 * Extract parameter names from a formal_parameters node.
 */
function extractParams(paramsNode: TreeSitterNode | null): string[] {
  if (!paramsNode) return [];
  const params: string[] = [];
  for (let i = 0; i < paramsNode.childCount; i++) {
    const child = paramsNode.child(i);
    if (!child) continue;
    if (
      child.type === "required_parameter" ||
      child.type === "optional_parameter"
    ) {
      const ident =
        child.childForFieldName("pattern") ??
        child.childForFieldName("name");
      if (ident) {
        params.push(ident.text);
      } else {
        // Fallback: first identifier child
        for (let j = 0; j < child.childCount; j++) {
          const c = child.child(j);
          if (c && c.type === "identifier") {
            params.push(c.text);
            break;
          }
        }
      }
    } else if (child.type === "identifier") {
      // JavaScript parameters (no type annotation)
      params.push(child.text);
    } else if (
      child.type === "rest_pattern" ||
      child.type === "rest_element"
    ) {
      const ident = child.children.find(
        (c) => c.type === "identifier",
      );
      if (ident) params.push("..." + ident.text);
    }
  }
  return params;
}

/**
 * Extract return type annotation from a function-like node.
 */
function extractReturnType(
  node: TreeSitterNode,
): string | undefined {
  const typeAnnotation = node.childForFieldName("return_type");
  if (typeAnnotation && typeAnnotation.type === "type_annotation") {
    const text = typeAnnotation.text;
    return text.startsWith(":") ? text.slice(1).trim() : text;
  }
  return undefined;
}

/**
 * Extract import specifiers from an import_clause node.
 */
function extractImportSpecifiers(
  importClause: TreeSitterNode,
): string[] {
  const specifiers: string[] = [];

  for (let i = 0; i < importClause.childCount; i++) {
    const child = importClause.child(i);
    if (!child) continue;

    if (child.type === "named_imports") {
      for (let j = 0; j < child.childCount; j++) {
        const spec = child.child(j);
        if (spec && spec.type === "import_specifier") {
          const alias = spec.childForFieldName("alias");
          const name = spec.childForFieldName("name");
          specifiers.push(
            alias ? alias.text : name ? name.text : spec.text,
          );
        }
      }
    } else if (child.type === "namespace_import") {
      const ident = child.children.find(
        (c) => c.type === "identifier",
      );
      if (ident) specifiers.push("* as " + ident.text);
    } else if (child.type === "identifier") {
      // default import: import foo from '...'
      specifiers.push(child.text);
    }
  }

  return specifiers;
}

/**
 * Extract decorators from a node's children.
 *
 * TypeScript decorators appear as `decorator` child nodes before
 * class/method/property declarations. Each decorator may be a simple
 * identifier (`@Injectable`) or a call expression with arguments
 * (`@Component({ selector: 'app' })`).
 */
function extractDecorators(node: TreeSitterNode): AnnotationInfo[] {
  const annotations: AnnotationInfo[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child || child.type !== "decorator") continue;

    // Find the name: could be identifier, member_expression, or inside call_expression
    let name: string | undefined;
    let argsNode: TreeSitterNode | null = null;

    const callExpr = findChild(child, "call_expression");
    if (callExpr) {
      // @Decorator(args) form
      const funcNode = callExpr.childForFieldName("function");
      if (funcNode) {
        name = funcNode.text;
      }
      argsNode = callExpr.childForFieldName("arguments");
    } else {
      // @Decorator form (no args)
      const ident =
        findChild(child, "identifier") ??
        findChild(child, "member_expression");
      if (ident) {
        name = ident.text;
      }
    }

    if (!name) continue;

    const info: AnnotationInfo = { name };

    if (argsNode) {
      const args: Record<string, string> = {};
      for (let j = 0; j < argsNode.childCount; j++) {
        const arg = argsNode.child(j);
        if (!arg) continue;
        if (arg.type === "pair") {
          // { key: value } pairs directly in arguments
          const key = arg.childForFieldName("key");
          const value = arg.childForFieldName("value");
          if (key && value) {
            args[key.text] = value.text.replace(/^["']|["']$/g, "");
          }
        } else if (arg.type === "object") {
          // Object literal: iterate children for pair nodes
          for (let k = 0; k < arg.childCount; k++) {
            const pair = arg.child(k);
            if (pair && pair.type === "pair") {
              const key = pair.childForFieldName("key");
              const value = pair.childForFieldName("value");
              if (key && value) {
                args[key.text] = value.text.replace(/^["']|["']$/g, "");
              }
            }
          }
        } else if (arg.type !== "(" && arg.type !== ")" && arg.type !== ",") {
          // Single positional argument
          args["value"] = arg.text.replace(/^["']|["']$/g, "");
        }
      }
      if (Object.keys(args).length > 0) {
        info.arguments = args;
      }
    }

    annotations.push(info);
  }
  return annotations;
}

/**
 * TypeScript/JavaScript extractor.
 *
 * Handles structural analysis and call-graph extraction for
 * TypeScript and JavaScript ASTs produced by tree-sitter.
 */
export class TypeScriptExtractor implements LanguageExtractor {
  readonly languageIds = ["typescript", "javascript"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];
    const exportedNames = new Set<string>();

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;
      this.processTopLevelNode(
        node,
        functions,
        classes,
        imports,
        exports,
        exportedNames,
      );
    }

    return { functions, classes, imports, exports };
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];
    const functionStack: string[] = [];

    const walkForCalls = (node: TreeSitterNode) => {
      const isFunctionLike =
        node.type === "function_declaration" ||
        node.type === "method_definition" ||
        node.type === "arrow_function" ||
        node.type === "function_expression";

      let pushedName = false;
      if (isFunctionLike) {
        let name: string | undefined;
        if (node.type === "function_declaration") {
          name = (
            node.childForFieldName("name") ??
            node.children.find((c) => c.type === "identifier")
          )?.text;
        } else if (node.type === "method_definition") {
          name = node.children.find(
            (c) => c.type === "property_identifier",
          )?.text;
        } else if (
          node.type === "arrow_function" ||
          node.type === "function_expression"
        ) {
          const parent = node.parent;
          if (parent && parent.type === "variable_declarator") {
            name = parent.childForFieldName("name")?.text;
          }
        }
        if (name) {
          functionStack.push(name);
          pushedName = true;
        }
      }

      if (node.type === "call_expression") {
        const callee = node.childForFieldName("function");
        if (callee && functionStack.length > 0) {
          entries.push({
            caller: functionStack[functionStack.length - 1],
            callee: callee.text,
            lineNumber: node.startPosition.row + 1,
          });
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) walkForCalls(child);
      }

      if (pushedName) {
        functionStack.pop();
      }
    };

    walkForCalls(rootNode);

    return entries;
  }

  // ---- Private extraction helpers ----

  private processTopLevelNode(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    imports: StructuralAnalysis["imports"],
    exports: StructuralAnalysis["exports"],
    exportedNames: Set<string>,
  ): void {
    switch (node.type) {
      case "function_declaration":
        this.extractFunction(node, functions);
        break;

      case "class_declaration":
        this.extractClass(node, classes);
        break;

      case "lexical_declaration":
      case "variable_declaration":
        this.extractVariableDeclarations(node, functions);
        break;

      case "import_statement":
        this.extractImport(node, imports);
        break;

      case "interface_declaration":
        this.extractInterface(node, classes);
        break;

      case "enum_declaration":
        this.extractEnum(node, classes);
        break;

      case "type_alias_declaration":
        this.extractTypeAlias(node, classes);
        break;

      case "export_statement":
        this.processExportStatement(
          node,
          functions,
          classes,
          imports,
          exports,
          exportedNames,
        );
        break;
    }
  }

  private extractFunction(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
  ): void {
    const nameNode =
      node.childForFieldName("name") ??
      node.children.find((c) => c.type === "identifier");
    if (!nameNode) return;

    const params = extractParams(
      node.childForFieldName("parameters") ??
        node.children.find(
          (c) => c.type === "formal_parameters",
        ) ??
        null,
    );
    const returnType = extractReturnType(node);

    functions.push({
      name: nameNode.text,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      params,
      returnType,
    });
  }

  private extractClass(
    node: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
  ): void {
    const nameNode = node.children.find(
      (c) =>
        c.type === "type_identifier" || c.type === "identifier",
    );
    if (!nameNode) return;

    const methods: string[] = [];
    const properties: string[] = [];
    const typedProperties: PropertyInfo[] = [];

    const classBody = node.children.find(
      (c) => c.type === "class_body",
    );
    if (classBody) {
      for (let j = 0; j < classBody.childCount; j++) {
        const member = classBody.child(j);
        if (!member) continue;

        if (member.type === "method_definition") {
          const methodName = member.children.find(
            (c) => c.type === "property_identifier",
          );
          if (methodName) methods.push(methodName.text);
        } else if (
          member.type === "public_field_definition" ||
          member.type === "property_definition"
        ) {
          const propName = member.children.find(
            (c) => c.type === "property_identifier",
          );
          if (propName) {
            properties.push(propName.text);
            // Extract type annotation for typed properties
            const typeAnnotation = member.children.find(
              (c) => c.type === "type_annotation",
            );
            if (typeAnnotation) {
              const typeText = typeAnnotation.text;
              const typeName = typeText.startsWith(":")
                ? typeText.slice(1).trim()
                : typeText;
              typedProperties.push({
                name: propName.text,
                type: typeName,
              });
            }
          }
        }
      }
    }

    // Extract decorators
    const annotations = extractDecorators(node);

    // Extract heritage (extends / implements)
    let superclass: string | undefined;
    let interfaces: string[] | undefined;

    const classHeritage = node.children.find(
      (c) => c.type === "class_heritage",
    );
    if (classHeritage) {
      for (let i = 0; i < classHeritage.childCount; i++) {
        const child = classHeritage.child(i);
        if (!child) continue;
        if (child.type === "extends_clause") {
          const typeNode =
            findChild(child, "type_identifier") ??
            findChild(child, "identifier") ??
            findChild(child, "generic_type");
          if (typeNode) superclass = typeNode.text;
        } else if (child.type === "implements_clause") {
          const ifaces: string[] = [];
          for (let j = 0; j < child.childCount; j++) {
            const typeChild = child.child(j);
            if (
              typeChild &&
              (typeChild.type === "type_identifier" ||
                typeChild.type === "generic_type")
            ) {
              ifaces.push(typeChild.text);
            }
          }
          if (ifaces.length > 0) interfaces = ifaces;
        }
      }
    }

    const classEntry: StructuralAnalysis["classes"][0] = {
      name: nameNode.text,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      methods,
      properties,
      kind: "class",
    };
    if (annotations.length > 0) classEntry.annotations = annotations;
    if (superclass) classEntry.superclass = superclass;
    if (interfaces) classEntry.interfaces = interfaces;
    if (typedProperties.length > 0) classEntry.typedProperties = typedProperties;
    classes.push(classEntry);
  }

  private extractVariableDeclarations(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
  ): void {
    for (let j = 0; j < node.childCount; j++) {
      const child = node.child(j);
      if (!child || child.type !== "variable_declarator") continue;

      const nameNode = child.childForFieldName("name");
      const valueNode = child.childForFieldName("value");

      if (
        nameNode &&
        valueNode &&
        (valueNode.type === "arrow_function" ||
          valueNode.type === "function_expression" ||
          valueNode.type === "function")
      ) {
        const params = extractParams(
          valueNode.childForFieldName("parameters") ??
            valueNode.children.find(
              (c) => c.type === "formal_parameters",
            ) ??
            null,
        );
        const returnType = extractReturnType(valueNode);

        functions.push({
          name: nameNode.text,
          lineRange: [
            node.startPosition.row + 1,
            node.endPosition.row + 1,
          ],
          params,
          returnType,
        });
      }
    }
  }

  private extractImport(
    node: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    const sourceNode = node.children.find(
      (c) => c.type === "string",
    );
    if (!sourceNode) return;

    const source = getStringValue(sourceNode);
    const specifiers: string[] = [];

    const importClause = node.children.find(
      (c) => c.type === "import_clause",
    );
    if (importClause) {
      specifiers.push(...extractImportSpecifiers(importClause));
    }

    imports.push({
      source,
      specifiers,
      lineNumber: node.startPosition.row + 1,
    });
  }

  private processExportStatement(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    _imports: StructuralAnalysis["imports"],
    exports: StructuralAnalysis["exports"],
    exportedNames: Set<string>,
  ): void {
    for (let j = 0; j < node.childCount; j++) {
      const child = node.child(j);
      if (!child) continue;

      switch (child.type) {
        case "function_declaration": {
          this.extractFunction(child, functions);
          const nameNode =
            child.childForFieldName("name") ??
            child.children.find((c) => c.type === "identifier");
          const isDefault = node.children.some((c) => c.type === "default");
          if (nameNode && !exportedNames.has(nameNode.text)) {
            exports.push({
              name: nameNode.text,
              lineNumber: node.startPosition.row + 1,
              isDefault,
            });
            exportedNames.add(nameNode.text);
          } else if (!nameNode && isDefault && !exportedNames.has("default")) {
            // `export default function () {}` — anonymous default export
            exports.push({
              name: "default",
              lineNumber: node.startPosition.row + 1,
              isDefault: true,
            });
            exportedNames.add("default");
          }
          break;
        }

        case "class_declaration": {
          this.extractClass(child, classes);
          const nameNode = child.children.find(
            (c) =>
              c.type === "type_identifier" ||
              c.type === "identifier",
          );
          const isDefault = node.children.some(
            (c) => c.type === "default",
          );
          if (nameNode && !exportedNames.has(nameNode.text)) {
            const exportName = isDefault
              ? "default"
              : nameNode.text;
            exports.push({
              name: exportName,
              lineNumber: node.startPosition.row + 1,
              isDefault,
            });
            exportedNames.add(exportName);
          }
          break;
        }

        case "lexical_declaration":
        case "variable_declaration": {
          this.extractVariableDeclarations(child, functions);
          for (let k = 0; k < child.childCount; k++) {
            const declarator = child.child(k);
            if (
              declarator &&
              declarator.type === "variable_declarator"
            ) {
              const nameNode =
                declarator.childForFieldName("name");
              if (
                nameNode &&
                !exportedNames.has(nameNode.text)
              ) {
                exports.push({
                  name: nameNode.text,
                  lineNumber: node.startPosition.row + 1,
                });
                exportedNames.add(nameNode.text);
              }
            }
          }
          break;
        }

        case "interface_declaration": {
          this.extractInterface(child, classes);
          const nameNode = child.children.find(
            (c) => c.type === "type_identifier",
          );
          const isDefault = node.children.some(
            (c) => c.type === "default",
          );
          if (nameNode && !exportedNames.has(nameNode.text)) {
            const exportName = isDefault
              ? "default"
              : nameNode.text;
            exports.push({
              name: exportName,
              lineNumber: node.startPosition.row + 1,
              isDefault,
            });
            exportedNames.add(exportName);
          }
          break;
        }

        case "enum_declaration": {
          this.extractEnum(child, classes);
          const nameNode =
            findChild(child, "identifier") ??
            findChild(child, "type_identifier");
          if (nameNode && !exportedNames.has(nameNode.text)) {
            exports.push({
              name: nameNode.text,
              lineNumber: node.startPosition.row + 1,
            });
            exportedNames.add(nameNode.text);
          }
          break;
        }

        case "type_alias_declaration": {
          this.extractTypeAlias(child, classes);
          const nameNode = findChild(child, "type_identifier");
          if (nameNode && !exportedNames.has(nameNode.text)) {
            exports.push({
              name: nameNode.text,
              lineNumber: node.startPosition.row + 1,
            });
            exportedNames.add(nameNode.text);
          }
          break;
        }

        case "export_clause": {
          for (let k = 0; k < child.childCount; k++) {
            const spec = child.child(k);
            if (spec && spec.type === "export_specifier") {
              const alias = spec.childForFieldName("alias");
              const name = spec.childForFieldName("name");
              const exportName = alias
                ? alias.text
                : name
                  ? name.text
                  : spec.text;
              if (!exportedNames.has(exportName)) {
                exports.push({
                  name: exportName,
                  lineNumber: node.startPosition.row + 1,
                });
                exportedNames.add(exportName);
              }
            }
          }
          break;
        }
      }
    }
  }

  private extractInterface(
    node: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
  ): void {
    const nameNode = findChild(node, "type_identifier");
    if (!nameNode) return;

    const methods: string[] = [];
    const properties: string[] = [];

    const body = findChild(node, "interface_body");
    if (body) {
      for (const methodSig of findChildren(body, "method_signature")) {
        const methName = findChild(methodSig, "property_identifier");
        if (methName) methods.push(methName.text);
      }
      for (const propSig of findChildren(body, "property_signature")) {
        const propName = findChild(propSig, "property_identifier");
        if (propName) properties.push(propName.text);
      }
    }

    const interfaces: string[] = [];
    const extendsClause = findChild(node, "extends_type_clause");
    if (extendsClause) {
      for (const typeNode of findChildren(extendsClause, "type_identifier")) {
        interfaces.push(typeNode.text);
      }
    }

    const entry: StructuralAnalysis["classes"][0] = {
      name: nameNode.text,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      methods,
      properties,
      kind: "interface",
    };
    if (interfaces.length > 0) entry.interfaces = interfaces;
    classes.push(entry);
  }

  private extractEnum(
    node: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
  ): void {
    const nameNode =
      findChild(node, "identifier") ??
      findChild(node, "type_identifier");
    if (!nameNode) return;

    const properties: string[] = [];
    const body = findChild(node, "enum_body");
    if (body) {
      for (const member of findChildren(body, "property_identifier")) {
        properties.push(member.text);
      }
    }

    classes.push({
      name: nameNode.text,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      methods: [],
      properties,
      kind: "enum",
    });
  }

  private extractTypeAlias(
    node: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
  ): void {
    const nameNode = findChild(node, "type_identifier");
    if (!nameNode) return;

    classes.push({
      name: nameNode.text,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      methods: [],
      properties: [],
      kind: "type",
    });
  }
}

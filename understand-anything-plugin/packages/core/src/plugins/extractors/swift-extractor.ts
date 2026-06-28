import type { StructuralAnalysis, CallGraphEntry, PropertyInfo } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { findChild, findChildren } from "./base-extractor.js";

function extractFunctionParams(node: TreeSitterNode): string[] {
  const params: string[] = [];
  for (const param of findChildren(node, "parameter")) {
    const nameNode = findChild(param, "simple_identifier");
    if (nameNode) params.push(nameNode.text);
  }
  return params;
}

function extractReturnType(node: TreeSitterNode): string | undefined {
  let pastParams = false;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === ")") {
      pastParams = true;
      continue;
    }
    if (pastParams && child.type === "user_type") {
      return child.text;
    }
    if (pastParams && child.type === "array_type") {
      return child.text;
    }
    if (pastParams && child.type === "optional_type") {
      return child.text;
    }
    if (pastParams && child.type === "tuple_type") {
      return child.text;
    }
    if (pastParams && child.type === "function_body") break;
  }
  return undefined;
}

function extractProtocolReturnType(node: TreeSitterNode): string | undefined {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === "user_type" || child.type === "array_type" || child.type === "optional_type" || child.type === "tuple_type") {
      return child.text;
    }
  }
  return undefined;
}

function extractModifiers(node: TreeSitterNode): { isPublic: boolean; isPrivate: boolean } {
  const modifiers = findChild(node, "modifiers");
  if (!modifiers) return { isPublic: false, isPrivate: false };

  for (let i = 0; i < modifiers.childCount; i++) {
    const child = modifiers.child(i);
    if (!child || child.type !== "visibility_modifier") continue;
    const visibility = child.child(0)?.text;
    if (visibility === "private" || visibility === "fileprivate") return { isPublic: false, isPrivate: true };
    if (visibility === "public" || visibility === "open") return { isPublic: true, isPrivate: false };
  }
  return { isPublic: false, isPrivate: false };
}

function extractPropertyName(node: TreeSitterNode): string | null {
  const pattern = findChild(node, "pattern");
  if (!pattern) return null;
  const nameNode = findChild(pattern, "simple_identifier");
  return nameNode?.text ?? null;
}

function extractPropertyType(node: TreeSitterNode): string | undefined {
  const typeAnnotation = findChild(node, "type_annotation");
  if (!typeAnnotation) return undefined;
  const userType = findChild(typeAnnotation, "user_type");
  return userType?.text;
}

function extractInheritanceSpecifiers(node: TreeSitterNode): {
  superclass?: string;
  interfaces: string[];
} {
  const specifiers = findChildren(node, "inheritance_specifier");
  if (specifiers.length === 0) return { interfaces: [] };

  let superclass: string | undefined;
  const interfaces: string[] = [];

  for (let idx = 0; idx < specifiers.length; idx++) {
    const spec = specifiers[idx];
    const userType = findChild(spec, "user_type");
    const typeId = userType ? findChild(userType, "type_identifier") : null;
    const name = typeId?.text;
    if (!name) continue;

    if (idx === 0) {
      superclass = name;
    } else {
      interfaces.push(name);
    }
  }

  return { superclass, interfaces };
}

export class SwiftExtractor implements LanguageExtractor {
  readonly languageIds = ["swift"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;

      switch (node.type) {
        case "import_declaration":
          this.extractImport(node, imports);
          break;
        case "class_declaration":
          this.extractClassDeclaration(node, functions, classes, exports);
          break;
        case "protocol_declaration":
          this.extractProtocolDeclaration(node, functions, classes, exports);
          break;
        case "function_declaration":
          this.extractTopLevelFunction(node, functions, exports);
          break;
      }
    }

    return { functions, classes, imports, exports };
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];
    const functionStack: string[] = [];
    const ownerStack: string[] = [];

    const walkForCalls = (node: TreeSitterNode) => {
      let pushedName = false;
      let pushedOwner = false;
      const savedFunctionStack = functionStack.slice();
      const isolatesFunctionScope = this.isOwnerDeclaration(node);

      if (isolatesFunctionScope) {
        functionStack.length = 0;
      }

      if (this.isOwnerDeclaration(node)) {
        const ownerName = this.extractDeclarationName(node);
        if (ownerName) {
          ownerStack.push(ownerName);
          pushedOwner = true;
        }
      }

      if (node.type === "function_declaration") {
        const nameNode = node.childForFieldName("name") ?? findChild(node, "simple_identifier");
        if (nameNode) {
          functionStack.push(nameNode.text);
          pushedName = true;
        }
      }

      if (node.type === "call_expression" && functionStack.length > 0) {
        const callee = this.extractCallExpressionName(node);
        if (callee) {
          const caller = functionStack[functionStack.length - 1];
          const callerOwner = ownerStack[ownerStack.length - 1];
          const receiver = this.extractReceiver(callee);
          const methodName = this.extractMethodName(callee);
          entries.push({
            caller,
            callee,
            lineNumber: node.startPosition.row + 1,
            columnNumber: node.startPosition.column + 1,
            ...(receiver ? { receiver } : {}),
            methodName,
            argumentCount: this.extractArgumentCount(node),
            callText: node.text,
            ...(callerOwner ? { callerOwner } : {}),
            ...(callerOwner ? { callerQualifiedName: `${callerOwner}#${caller}` } : {}),
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
      if (pushedOwner) {
        ownerStack.pop();
      }
      if (isolatesFunctionScope) {
        functionStack.length = 0;
        functionStack.push(...savedFunctionStack);
      }
    };

    walkForCalls(rootNode);
    return entries;
  }

  private extractCallExpressionName(node: TreeSitterNode): string | null {
    const navigation = findChild(node, "navigation_expression");
    if (navigation) {
      const target = navigation.childForFieldName("target");
      const suffix = findChild(navigation, "navigation_suffix");
      if (target && suffix) {
        const suffixId = findChild(suffix, "simple_identifier");
        if (suffixId) return `${target.text}.${suffixId.text}`;
      }
      return navigation.text;
    }

    const identifier = findChild(node, "simple_identifier");
    if (identifier) return identifier.text;

    return null;
  }

  private isOwnerDeclaration(node: TreeSitterNode): boolean {
    return (
      node.type === "class_declaration" ||
      node.type === "protocol_declaration" ||
      node.type === "extension_declaration" ||
      node.type === "actor_declaration"
    );
  }

  private extractDeclarationName(node: TreeSitterNode): string | null {
    return (
      node.childForFieldName("name") ??
      node.childForFieldName("extended_type") ??
      findChild(node, "type_identifier") ??
      findChild(node, "user_type")
    )?.text ?? null;
  }

  private extractReceiver(callee: string): string | undefined {
    const dotIndex = callee.lastIndexOf(".");
    return dotIndex === -1 ? undefined : callee.slice(0, dotIndex);
  }

  private extractMethodName(callee: string): string {
    const dotIndex = callee.lastIndexOf(".");
    return dotIndex === -1 ? callee : callee.slice(dotIndex + 1);
  }

  private extractArgumentCount(node: TreeSitterNode): number {
    const suffix = findChild(node, "call_suffix");
    const argsNode = suffix ? findChild(suffix, "value_arguments") : null;
    const valueArgumentCount = argsNode
      ? findChildren(argsNode, "value_argument").length
      : 0;
    const trailingClosureCount = suffix
      ? findChildren(suffix, "lambda_literal").length
      : 0;

    return valueArgumentCount + trailingClosureCount;
  }

  private extractImport(
    node: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    const identifier = findChild(node, "identifier");
    if (!identifier) return;

    const simpleId = findChild(identifier, "simple_identifier");
    const source = simpleId?.text ?? identifier.text;

    imports.push({
      source,
      specifiers: [source],
      lineNumber: node.startPosition.row + 1,
    });
  }

  private extractClassDeclaration(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = node.childForFieldName("name") ?? findChild(node, "type_identifier");
    if (!nameNode) return;

    const methods: string[] = [];
    const properties: string[] = [];
    const typedProperties: PropertyInfo[] = [];

    const body = node.childForFieldName("body") ?? findChild(node, "class_body") ?? findChild(node, "enum_class_body");
    if (body) {
      this.extractBodyMembers(body, methods, properties, functions, exports, typedProperties);
    }

    const { superclass, interfaces } = extractInheritanceSpecifiers(node);

    const kindNode = node.childForFieldName("declaration_kind");
    const kind = kindNode?.text ?? "class";

    const classEntry: StructuralAnalysis["classes"][0] = {
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      methods,
      properties,
      kind,
    };
    if (superclass) classEntry.superclass = superclass;
    if (interfaces.length > 0) classEntry.interfaces = interfaces;
    if (typedProperties.length > 0) classEntry.typedProperties = typedProperties;
    classes.push(classEntry);

    const { isPrivate } = extractModifiers(node);
    if (!isPrivate) {
      exports.push({
        name: nameNode.text,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractProtocolDeclaration(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = node.childForFieldName("name") ?? findChild(node, "type_identifier");
    if (!nameNode) return;

    const methods: string[] = [];
    const body = node.childForFieldName("body") ?? findChild(node, "protocol_body");
    if (body) {
      for (const funcDecl of findChildren(body, "protocol_function_declaration")) {
        const funcName = funcDecl.childForFieldName("name") ?? findChild(funcDecl, "simple_identifier");
        if (!funcName) continue;
        methods.push(funcName.text);

        const params = extractFunctionParams(funcDecl);
        const returnType = extractProtocolReturnType(funcDecl);
        const fnEntry: StructuralAnalysis["functions"][0] = {
          name: funcName.text,
          lineRange: [funcDecl.startPosition.row + 1, funcDecl.endPosition.row + 1],
          params,
          ...(returnType ? { returnType } : {}),
        };
        functions.push(fnEntry);
      }
    }

    classes.push({
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      methods,
      properties: [],
      kind: "protocol",
    });

    exports.push({
      name: nameNode.text,
      lineNumber: node.startPosition.row + 1,
    });
  }

  private extractBodyMembers(
    body: TreeSitterNode,
    methods: string[],
    properties: string[],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
    typedProperties: PropertyInfo[],
  ): void {
    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);
      if (!child) continue;

      switch (child.type) {
        case "function_declaration":
          this.extractFunction(child, methods, functions, exports);
          break;
        case "property_declaration":
          this.extractProperty(child, properties, exports, typedProperties);
          break;
      }
    }
  }

  private extractFunction(
    node: TreeSitterNode,
    methods: string[],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = node.childForFieldName("name") ?? findChild(node, "simple_identifier");
    if (!nameNode) return;

    const params = extractFunctionParams(node);
    const returnType = extractReturnType(node);

    methods.push(nameNode.text);

    const fnEntry: StructuralAnalysis["functions"][0] = {
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      params,
      ...(returnType ? { returnType } : {}),
    };
    functions.push(fnEntry);

    const { isPrivate } = extractModifiers(node);
    if (!isPrivate) {
      exports.push({
        name: nameNode.text,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractTopLevelFunction(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    this.extractFunction(node, [], functions, exports);
  }

  private extractProperty(
    node: TreeSitterNode,
    properties: string[],
    exports: StructuralAnalysis["exports"],
    typedProperties: PropertyInfo[],
  ): void {
    const name = extractPropertyName(node);
    if (!name) return;

    properties.push(name);

    const prop: PropertyInfo = { name };
    const type = extractPropertyType(node);
    if (type) prop.type = type;
    typedProperties.push(prop);

    const { isPrivate } = extractModifiers(node);
    if (!isPrivate) {
      exports.push({
        name,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }
}

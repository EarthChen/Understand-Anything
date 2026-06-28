import type { StructuralAnalysis, CallGraphEntry, AnnotationInfo, PropertyInfo, EndpointInfo } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import type { TypeBinding } from "./callgraph-resolution.js";
import { findChild, findChildren } from "./base-extractor.js";
import {
  buildQualifiedMethodName,
  qualifyTypeName,
  simpleTypeName,
  TypeScopeStack,
} from "./callgraph-resolution.js";

const HTTP_METHOD_ANNOTATIONS: Record<string, string> = {
  GET: "GET",
  POST: "POST",
  PUT: "PUT",
  DELETE: "DELETE",
  PATCH: "PATCH",
  HEAD: "HEAD",
  OPTIONS: "OPTIONS",
  GetMapping: "GET",
  PostMapping: "POST",
  PutMapping: "PUT",
  DeleteMapping: "DELETE",
  PatchMapping: "PATCH",
  RequestMapping: "REQUEST",
};

/**
 * Extract parameter names and types from a Java `formal_parameters` node.
 *
 * Each `formal_parameter` child has a `name` field (identifier) and a `type` field.
 */
function extractParams(
  paramsNode: TreeSitterNode | null,
): Array<{ name: string; type: string }> {
  if (!paramsNode) return [];
  const params: Array<{ name: string; type: string }> = [];

  const declarations = findChildren(paramsNode, "formal_parameter");
  for (const decl of declarations) {
    const nameNode = decl.childForFieldName("name");
    const typeNode = decl.childForFieldName("type");
    if (nameNode) {
      params.push({
        name: nameNode.text,
        type: typeNode?.text ?? "unknown",
      });
    }
  }

  // Also handle spread_parameter (varargs): e.g. `String... args`
  const spreadParams = findChildren(paramsNode, "spread_parameter");
  for (const spread of spreadParams) {
    const nameNode = spread.childForFieldName("name");
    const typeNode = spread.childForFieldName("type");
    if (nameNode) {
      params.push({
        name: nameNode.text,
        type: typeNode?.text ?? "unknown",
      });
    }
  }

  return params;
}

/**
 * Extract the return type text from a method_declaration node.
 *
 * In tree-sitter-java, the return type is the `type` named field on method_declaration.
 * It can be a type_identifier, generic_type, void_type, integral_type, etc.
 */
function extractReturnType(node: TreeSitterNode): string | undefined {
  const typeNode = node.childForFieldName("type");
  if (!typeNode) return undefined;
  return typeNode.text;
}

/**
 * Check if a node has a `modifiers` child containing a specific modifier keyword.
 */
function hasModifier(node: TreeSitterNode, modifier: string): boolean {
  const modifiers = findChild(node, "modifiers");
  if (!modifiers) return false;
  for (let i = 0; i < modifiers.childCount; i++) {
    const child = modifiers.child(i);
    if (child && child.text === modifier) return true;
  }
  return false;
}

/**
 * Extract annotations from a `modifiers` node.
 *
 * In tree-sitter-java, modifiers can contain `marker_annotation` (no args)
 * and `annotation` (with args). Both have a `name` field.
 */
function extractAnnotations(node: TreeSitterNode): AnnotationInfo[] {
  const modifiers = findChild(node, "modifiers");
  if (!modifiers) return [];
  const annotations: AnnotationInfo[] = [];
  for (let i = 0; i < modifiers.childCount; i++) {
    const child = modifiers.child(i);
    if (!child) continue;
    if (child.type === "marker_annotation") {
      const nameNode = child.childForFieldName("name");
      if (nameNode) annotations.push({ name: nameNode.text });
    } else if (child.type === "annotation") {
      const nameNode = child.childForFieldName("name");
      if (!nameNode) continue;
      const info: AnnotationInfo = { name: nameNode.text };
      const argsNode = child.childForFieldName("arguments");
      if (argsNode) {
        const args: Record<string, string> = {};
        for (let j = 0; j < argsNode.childCount; j++) {
          const arg = argsNode.child(j);
          if (!arg) continue;
          if (arg.type === "element_value_pair") {
            const key = arg.childForFieldName("key");
            const value = arg.childForFieldName("value");
            if (key && value) {
              args[key.text] = value.text.replace(/^"|"$/g, "");
            }
          } else if (arg.type !== "(" && arg.type !== ")" && arg.type !== ",") {
            args["value"] = arg.text.replace(/^"|"$/g, "");
          }
        }
        if (Object.keys(args).length > 0) info.arguments = args;
      }
      annotations.push(info);
    }
  }
  return annotations;
}

/**
 * Extract the superclass name from a class_declaration's `superclass` field.
 */
function extractSuperclass(node: TreeSitterNode): string | undefined {
  const superNode = node.childForFieldName("superclass");
  if (!superNode) return undefined;
  const typeNode = findChild(superNode, "type_identifier") ?? findChild(superNode, "generic_type");
  return typeNode?.text;
}

/**
 * Extract implemented interface names from a class_declaration's `interfaces` field
 * (which maps to a `super_interfaces` node), or extended interfaces from an
 * interface_declaration's `extends_interfaces` child node.
 *
 * In tree-sitter-java:
 * - class: `childForFieldName("interfaces")` → `super_interfaces` node
 * - interface: `extends_interfaces` is a child node type, not a named field
 * Both contain a `type_list` with `type_identifier` children.
 */
function extractInterfaces(node: TreeSitterNode): string[] {
  const interfacesNode =
    node.childForFieldName("interfaces") ??
    findChild(node, "extends_interfaces");
  if (!interfacesNode) return [];
  const result: string[] = [];
  for (let i = 0; i < interfacesNode.childCount; i++) {
    const child = interfacesNode.child(i);
    if (!child) continue;
    if (child.type === "type_identifier" || child.type === "generic_type") {
      result.push(child.text);
    } else if (child.type === "type_list") {
      for (let j = 0; j < child.childCount; j++) {
        const typeChild = child.child(j);
        if (typeChild && (typeChild.type === "type_identifier" || typeChild.type === "generic_type")) {
          result.push(typeChild.text);
        }
      }
    }
  }
  return result;
}

/**
 * Extract the full dotted path from a scoped_identifier node.
 *
 * Java's scoped_identifier nests recursively:
 * `java.util.List` is scoped_identifier(scope: scoped_identifier(scope: identifier "java",
 * name: identifier "util"), name: identifier "List")
 *
 * This returns the full path as a dotted string.
 */
function extractScopedIdentifierPath(node: TreeSitterNode): string {
  return node.text;
}

/**
 * Get the last component of a dotted import path.
 * e.g. "java.util.List" -> "List"
 */
function lastComponent(path: string): string {
  const parts = path.split(".");
  return parts[parts.length - 1];
}

/**
 * Extract the base path from class-level annotations like @RequestMapping("/api")
 * or Retrofit-style base URL annotations.
 */
function extractHttpBasePath(annotations: AnnotationInfo[]): string | undefined {
  for (const ann of annotations) {
    if (ann.name === "RequestMapping" || ann.name === "Path") {
      const path = ann.arguments?.value ?? ann.arguments?.path;
      if (path) return path.replace(/^["']|["']$/g, "");
    }
  }
  return undefined;
}

/**
 * Extract HTTP endpoint info from method-level annotations.
 * Supports JAX-RS (@GET, @POST, etc.), Retrofit (@GET, @POST, etc.),
 * and Spring (@GetMapping, @PostMapping, @RequestMapping, etc.).
 */
function extractEndpointFromMethod(
  methodNode: TreeSitterNode,
  endpoints: EndpointInfo[],
  basePath?: string,
): void {
  const annotations = extractAnnotations(methodNode);
  for (const ann of annotations) {
    const httpMethod = HTTP_METHOD_ANNOTATIONS[ann.name];
    if (!httpMethod) continue;

    let methodPath = ann.arguments?.value ?? ann.arguments?.path ?? "";
    methodPath = methodPath.replace(/^["']|["']$/g, "");

    if (ann.name === "RequestMapping" && ann.arguments?.method) {
      const resolvedMethod = ann.arguments.method
        .replace(/RequestMethod\./g, "")
        .replace(/[{}]/g, "")
        .trim();
      const fullPath = joinPaths(basePath, methodPath);
      endpoints.push({
        method: resolvedMethod || "REQUEST",
        path: fullPath || "/",
        lineRange: [methodNode.startPosition.row + 1, methodNode.endPosition.row + 1],
      });
      return;
    }

    const fullPath = joinPaths(basePath, methodPath);
    endpoints.push({
      method: httpMethod,
      path: fullPath || "/",
      lineRange: [methodNode.startPosition.row + 1, methodNode.endPosition.row + 1],
    });
    return;
  }
}

function joinPaths(base: string | undefined, path: string): string {
  if (!base) return path;
  if (!path) return base;
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return normalizedBase + normalizedPath;
}

/**
 * Java extractor for tree-sitter structural analysis and call graph extraction.
 *
 * Handles classes, interfaces, methods, constructors, fields, imports,
 * visibility-based exports, and call graphs for Java source code.
 *
 * Java-specific mapping decisions:
 * - Classes and interfaces are mapped to the `classes` array.
 * - Constructors are mapped to the `functions` array (named after the class).
 * - Methods (including interface method signatures) are listed in the
 *   containing class/interface's `methods` array and also in the `functions` array.
 * - Exports are determined by the `public` modifier on classes, methods,
 *   constructors, and fields.
 * - Fields are extracted as `properties` from `field_declaration` nodes.
 */
export class JavaExtractor implements LanguageExtractor {
  readonly languageIds = ["java"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];
    const endpoints: EndpointInfo[] = [];

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;

      switch (node.type) {
        case "import_declaration":
          this.extractImport(node, imports);
          break;

        case "class_declaration":
          this.extractClass(node, functions, classes, exports, endpoints);
          break;

        case "interface_declaration":
          this.extractInterface(node, functions, classes, exports, endpoints);
          break;
        case "enum_declaration":
          this.extractEnum(node, classes, exports);
          break;
        case "record_declaration":
          this.extractRecord(node, functions, classes, exports);
          break;
        case "annotation_type_declaration":
          this.extractAnnotationType(node, functions, classes, exports);
          break;
      }
    }

    const result: StructuralAnalysis = { functions, classes, imports, exports };
    if (endpoints.length > 0) result.endpoints = endpoints;
    return result;
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];
    const functionStack: string[] = [];
    const ownerStack: string[] = [];
    const packageName = this.extractPackageName(rootNode);
    const imports = this.extractImports(rootNode);
    const knownTypes = this.extractKnownTypes(rootNode, packageName, imports);
    const typeContext = { packageName, imports, knownTypes };
    const typeScopes = new TypeScopeStack();
    const fieldScopes: Array<Map<string, TypeBinding>> = [];

    const walkForCalls = (node: TreeSitterNode) => {
      let pushedName = false;
      let pushedOwner = false;
      let pushedFieldScope = false;
      let pushedTypeScope = false;
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
        typeScopes.pushScope();
        pushedTypeScope = true;
        fieldScopes.push(this.bindClassFields(node, typeScopes, typeContext));
        pushedFieldScope = true;
      }

      // Track entering method/constructor declarations
      if (
        node.type === "method_declaration" ||
        node.type === "constructor_declaration"
      ) {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          functionStack.push(nameNode.text);
          pushedName = true;
        }
        typeScopes.pushScope();
        pushedTypeScope = true;
        this.bindParameters(node, typeScopes, typeContext);
      }

      if (node.type === "block") {
        typeScopes.pushScope();
        pushedTypeScope = true;
      }

      if (
        node.type === "for_statement" ||
        node.type === "enhanced_for_statement" ||
        node.type === "catch_clause"
      ) {
        typeScopes.pushScope();
        pushedTypeScope = true;
      }

      if (node.type === "local_variable_declaration") {
        this.bindLocalVariables(node, typeScopes, typeContext);
      }

      if (node.type === "enhanced_for_statement") {
        this.bindEnhancedForVariable(node, typeScopes, typeContext);
      }

      if (node.type === "catch_clause") {
        this.bindCatchParameter(node, typeScopes, typeContext);
      }

      // Extract method invocations: e.g. fetchFromDb(limit), System.out.println(msg)
      if (node.type === "method_invocation") {
        if (functionStack.length > 0) {
          const callee = this.extractMethodInvocationName(node);
          const nameNode = node.childForFieldName("name");
          if (callee) {
            const caller = functionStack[functionStack.length - 1];
            const callerOwner = ownerStack[ownerStack.length - 1];
            const objectNode = node.childForFieldName("object");
            const resolution = objectNode
              ? this.resolveReceiver(
                objectNode.text,
                nameNode?.text,
                objectNode,
                typeScopes,
                fieldScopes,
                typeContext,
              )
              : {};
            entries.push({
              caller,
              callee,
              lineNumber: node.startPosition.row + 1,
              columnNumber: node.startPosition.column + 1,
              ...(objectNode ? { receiver: objectNode.text } : {}),
              ...(nameNode ? { methodName: nameNode.text } : {}),
              argumentCount: this.extractArgumentCount(node),
              callText: node.text,
              ...(callerOwner ? { callerOwner } : {}),
              ...(callerOwner
                ? { callerQualifiedName: `${callerOwner}#${caller}` }
                : {}),
              ...resolution,
            });
          }
        }
      }

      // Extract object creation: e.g. new Foo()
      if (node.type === "object_creation_expression") {
        if (functionStack.length > 0) {
          const typeNode = node.childForFieldName("type");
          if (typeNode) {
            const caller = functionStack[functionStack.length - 1];
            const callerOwner = ownerStack[ownerStack.length - 1];
            entries.push({
              caller,
              callee: `new ${typeNode.text}`,
              lineNumber: node.startPosition.row + 1,
              columnNumber: node.startPosition.column + 1,
              methodName: typeNode.text,
              argumentCount: this.extractArgumentCount(node),
              callText: node.text,
              ...(callerOwner ? { callerOwner } : {}),
              ...(callerOwner
                ? { callerQualifiedName: `${callerOwner}#${caller}` }
                : {}),
            });
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;

        if (this.isAnonymousClassBody(node, child)) {
          const savedAnonymousFunctionStack = functionStack.slice();
          const savedAnonymousOwnerStack = ownerStack.slice();
          const savedAnonymousFieldScopes = fieldScopes.slice();
          functionStack.length = 0;
          ownerStack.length = 0;
          fieldScopes.length = 0;
          typeScopes.pushScope();
          fieldScopes.push(this.bindClassBodyFields(child, typeScopes, typeContext));
          walkForCalls(child);
          fieldScopes.pop();
          typeScopes.popScope();
          functionStack.length = 0;
          functionStack.push(...savedAnonymousFunctionStack);
          ownerStack.length = 0;
          ownerStack.push(...savedAnonymousOwnerStack);
          fieldScopes.length = 0;
          fieldScopes.push(...savedAnonymousFieldScopes);
          continue;
        }

        walkForCalls(child);
      }

      if (pushedName) {
        functionStack.pop();
      }
      if (pushedOwner) {
        ownerStack.pop();
      }
      if (pushedFieldScope) {
        fieldScopes.pop();
      }
      if (pushedTypeScope) {
        typeScopes.popScope();
      }
      if (isolatesFunctionScope) {
        functionStack.length = 0;
        functionStack.push(...savedFunctionStack);
      }
    };

    walkForCalls(rootNode);

    return entries;
  }

  // ---- Private helpers ----

  /**
   * Extract the callee name from a method_invocation node.
   *
   * Handles:
   * - Plain method call: `fetchFromDb(limit)` -> "fetchFromDb"
   * - Qualified call: `System.out.println(msg)` -> "System.out.println"
   */
  private extractMethodInvocationName(node: TreeSitterNode): string | null {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return null;

    const objectNode = node.childForFieldName("object");
    if (objectNode) {
      return `${objectNode.text}.${nameNode.text}`;
    }

    return nameNode.text;
  }

  private isOwnerDeclaration(node: TreeSitterNode): boolean {
    return (
      node.type === "class_declaration" ||
      node.type === "interface_declaration" ||
      node.type === "record_declaration" ||
      node.type === "enum_declaration" ||
      node.type === "annotation_type_declaration"
    );
  }

  private isAnonymousClassBody(
    parent: TreeSitterNode,
    child: TreeSitterNode,
  ): boolean {
    return (
      parent.type === "object_creation_expression" &&
      child.type === "class_body"
    );
  }

  private extractDeclarationName(node: TreeSitterNode): string | null {
    return (
      node.childForFieldName("name") ??
      findChild(node, "identifier") ??
      findChild(node, "type_identifier")
    )?.text ?? null;
  }

  private extractArgumentCount(node: TreeSitterNode): number {
    const argsNode =
      node.childForFieldName("arguments") ?? findChild(node, "argument_list");
    if (!argsNode) return 0;

    let count = 0;
    for (let i = 0; i < argsNode.childCount; i++) {
      if (argsNode.child(i)?.isNamed) count++;
    }
    return count;
  }

  private extractPackageName(rootNode: TreeSitterNode): string | undefined {
    for (let i = 0; i < rootNode.childCount; i++) {
      const child = rootNode.child(i);
      if (child?.type !== "package_declaration") continue;
      return child.text
        .replace(/^package\s+/, "")
        .replace(/;$/, "")
        .trim();
    }

    return undefined;
  }

  private extractImports(rootNode: TreeSitterNode): Map<string, string> {
    const imports = new Map<string, string>();
    for (let i = 0; i < rootNode.childCount; i++) {
      const child = rootNode.child(i);
      if (child?.type !== "import_declaration") continue;

      const importPath = child.text
        .replace(/^import\s+/, "")
        .replace(/^static\s+/, "")
        .replace(/;$/, "")
        .trim();
      if (!importPath || importPath.endsWith(".*")) continue;

      imports.set(lastComponent(importPath), importPath);
    }

    return imports;
  }

  private extractKnownTypes(
    rootNode: TreeSitterNode,
    packageName: string | undefined,
    imports: Map<string, string>,
  ): Map<string, string> {
    const knownTypes = new Map<string, string>(imports);

    for (let i = 0; i < rootNode.childCount; i++) {
      const child = rootNode.child(i);
      if (!child || !this.isOwnerDeclaration(child)) continue;

      const name = this.extractDeclarationName(child);
      if (name) {
        knownTypes.set(name, packageName ? `${packageName}.${name}` : name);
      }
    }

    return knownTypes;
  }

  private bindClassFields(
    ownerNode: TreeSitterNode,
    typeScopes: TypeScopeStack,
    typeContext: {
      packageName?: string;
      imports: Map<string, string>;
      knownTypes: Map<string, string>;
    },
  ): Map<string, TypeBinding> {
    const body = ownerNode.childForFieldName("body");
    if (!body) return new Map();

    return this.bindClassBodyFields(body, typeScopes, typeContext);
  }

  private bindClassBodyFields(
    body: TreeSitterNode,
    typeScopes: TypeScopeStack,
    typeContext: {
      packageName?: string;
      imports: Map<string, string>;
      knownTypes: Map<string, string>;
    },
  ): Map<string, TypeBinding> {
    const fields = new Map<string, TypeBinding>();
    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);
      if (child?.type !== "field_declaration") continue;
      this.bindTypedDeclarators(child, "field", typeScopes, typeContext, fields);
    }

    return fields;
  }

  private bindParameters(
    callableNode: TreeSitterNode,
    typeScopes: TypeScopeStack,
    typeContext: {
      packageName?: string;
      imports: Map<string, string>;
      knownTypes: Map<string, string>;
    },
  ): void {
    const paramsNode = callableNode.childForFieldName("parameters");
    for (const param of extractParams(paramsNode ?? null)) {
      typeScopes.set(param.name, {
        type: simpleTypeName(param.type),
        qualifiedType: qualifyTypeName(param.type, typeContext),
        kind: "parameter",
      });
    }
  }

  private bindLocalVariables(
    node: TreeSitterNode,
    typeScopes: TypeScopeStack,
    typeContext: {
      packageName?: string;
      imports: Map<string, string>;
      knownTypes: Map<string, string>;
    },
  ): void {
    this.bindTypedDeclarators(node, "local", typeScopes, typeContext);
  }

  private bindEnhancedForVariable(
    node: TreeSitterNode,
    typeScopes: TypeScopeStack,
    typeContext: {
      packageName?: string;
      imports: Map<string, string>;
      knownTypes: Map<string, string>;
    },
  ): void {
    const typeNode = node.childForFieldName("type");
    const nameNode = node.childForFieldName("name");
    if (!typeNode || !nameNode) return;

    this.bindNamedType(nameNode.text, typeNode.text, "local", typeScopes, typeContext);
  }

  private bindCatchParameter(
    node: TreeSitterNode,
    typeScopes: TypeScopeStack,
    typeContext: {
      packageName?: string;
      imports: Map<string, string>;
      knownTypes: Map<string, string>;
    },
  ): void {
    const parameter = findChild(node, "catch_formal_parameter");
    const typeNode =
      parameter?.childForFieldName("type") ??
      (parameter ? findChild(parameter, "catch_type") : null);
    const nameNode = parameter?.childForFieldName("name");
    if (!typeNode || !nameNode) return;

    this.bindNamedType(nameNode.text, typeNode.text, "local", typeScopes, typeContext);
  }

  private bindTypedDeclarators(
    node: TreeSitterNode,
    kind: "field" | "local",
    typeScopes: TypeScopeStack,
    typeContext: {
      packageName?: string;
      imports: Map<string, string>;
      knownTypes: Map<string, string>;
    },
    bindings?: Map<string, TypeBinding>,
  ): void {
    const typeNode = node.childForFieldName("type");
    if (!typeNode) return;

    for (const declarator of findChildren(node, "variable_declarator")) {
      const nameNode = declarator.childForFieldName("name");
      if (!nameNode) continue;

      const binding = this.bindNamedType(nameNode.text, typeNode.text, kind, typeScopes, typeContext);
      bindings?.set(nameNode.text, binding);
    }
  }

  private bindNamedType(
    name: string,
    type: string,
    kind: "field" | "local",
    typeScopes: TypeScopeStack,
    typeContext: {
      packageName?: string;
      imports: Map<string, string>;
      knownTypes: Map<string, string>;
    },
  ): TypeBinding {
    const binding: TypeBinding = {
      type: simpleTypeName(type),
      qualifiedType: qualifyTypeName(type, typeContext),
      kind,
    };
    typeScopes.set(name, binding);
    return binding;
  }

  private resolveReceiver(
    receiver: string,
    methodName: string | undefined,
    receiverNode: TreeSitterNode,
    typeScopes: TypeScopeStack,
    fieldScopes: Array<Map<string, TypeBinding>>,
    typeContext: {
      packageName?: string;
      imports: Map<string, string>;
      knownTypes: Map<string, string>;
    },
  ): Partial<CallGraphEntry> {
    if (receiver.startsWith("this.")) {
      const fieldName = receiver.slice("this.".length);
      const binding = fieldScopes[fieldScopes.length - 1]?.get(fieldName);
      if (binding) {
        return this.buildResolvedReceiver(binding, methodName);
      }

      return { resolutionKind: "unresolved" };
    }

    const binding = typeScopes.resolve(receiver);
    if (binding) {
      return this.buildResolvedReceiver(binding, methodName);
    }

    if (receiverNode.type === "identifier" && /^[A-Z]/.test(receiver)) {
      const qualifiedType = qualifyTypeName(receiver, typeContext);
      const receiverType = simpleTypeName(receiver);
      return {
        receiverType,
        ...(qualifiedType ? { receiverQualifiedType: qualifiedType } : {}),
        calleeOwner: receiverType,
        ...(qualifiedType
          ? { calleeQualifiedName: buildQualifiedMethodName(qualifiedType, methodName) }
          : {}),
        resolutionKind: "static",
      };
    }

    return { resolutionKind: "unresolved" };
  }

  private buildResolvedReceiver(
    binding: TypeBinding,
    methodName: string | undefined,
  ): Partial<CallGraphEntry> {
    return {
      receiverType: binding.type,
      ...(binding.qualifiedType ? { receiverQualifiedType: binding.qualifiedType } : {}),
      calleeOwner: binding.type,
      ...(binding.qualifiedType
        ? { calleeQualifiedName: buildQualifiedMethodName(binding.qualifiedType, methodName) }
        : {}),
      resolutionKind: binding.kind,
    };
  }

  private extractImport(
    node: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    // Check for asterisk (wildcard) import: `import java.util.*;`
    const hasAsterisk = findChild(node, "asterisk") !== null;

    const scopedId = findChild(node, "scoped_identifier");
    if (!scopedId) return;

    const fullPath = extractScopedIdentifierPath(scopedId);

    if (hasAsterisk) {
      // Wildcard import: source is the full scope, specifier is "*"
      imports.push({
        source: fullPath,
        specifiers: ["*"],
        lineNumber: node.startPosition.row + 1,
      });
    } else {
      // Regular import: source is the full path, specifier is the last component
      imports.push({
        source: fullPath,
        specifiers: [lastComponent(fullPath)],
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractClass(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
    endpoints: EndpointInfo[],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    const methods: string[] = [];
    const properties: string[] = [];
    const typedProperties: PropertyInfo[] = [];

    const annotations = extractAnnotations(node);
    const basePath = extractHttpBasePath(annotations);

    const body = node.childForFieldName("body");
    if (body) {
      this.extractClassBodyMembers(
        body,
        methods,
        properties,
        functions,
        exports,
        typedProperties,
        endpoints,
        basePath,
      );
    }

    const superclass = extractSuperclass(node);
    const interfaces = extractInterfaces(node);

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
    if (interfaces.length > 0) classEntry.interfaces = interfaces;
    if (typedProperties.length > 0) classEntry.typedProperties = typedProperties;
    classes.push(classEntry);

    if (hasModifier(node, "public")) {
      exports.push({
        name: nameNode.text,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractInterface(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
    endpoints: EndpointInfo[],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    const methods: string[] = [];
    const properties: string[] = [];

    const annotations = extractAnnotations(node);
    const basePath = extractHttpBasePath(annotations);

    const body = node.childForFieldName("body");
    if (body) {
      const methodNodes = findChildren(body, "method_declaration");
      for (const methodNode of methodNodes) {
        const methNameNode = methodNode.childForFieldName("name");
        if (methNameNode) {
          methods.push(methNameNode.text);
        }
        extractEndpointFromMethod(methodNode, endpoints, basePath);
      }

      const fields = findChildren(body, "constant_declaration");
      for (const field of fields) {
        const declarators = findChildren(field, "variable_declarator");
        for (const decl of declarators) {
          const declName = decl.childForFieldName("name");
          if (declName) {
            properties.push(declName.text);
          }
        }
      }
    }

    const interfaces = extractInterfaces(node);

    const classEntry: StructuralAnalysis["classes"][0] = {
      name: nameNode.text,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      methods,
      kind: "interface",
      properties,
    };
    if (annotations.length > 0) classEntry.annotations = annotations;
    if (interfaces.length > 0) classEntry.interfaces = interfaces;
    classes.push(classEntry);

    if (hasModifier(node, "public")) {
      exports.push({
        name: nameNode.text,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractClassBodyMembers(
    body: TreeSitterNode,
    methods: string[],
    properties: string[],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
    typedProperties?: PropertyInfo[],
    endpoints?: EndpointInfo[],
    basePath?: string,
  ): void {
    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);
      if (!child) continue;

      switch (child.type) {
        case "method_declaration":
          this.extractMethod(child, methods, functions, exports);
          if (endpoints) {
            extractEndpointFromMethod(child, endpoints, basePath);
          }
          break;

        case "constructor_declaration":
          this.extractConstructor(child, methods, functions, exports);
          break;

        case "field_declaration":
          this.extractField(child, properties, exports, typedProperties);
          break;
      }
    }
  }

  private extractMethod(
    node: TreeSitterNode,
    methods: string[],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    const paramsNode = node.childForFieldName("parameters");
    const params = extractParams(paramsNode ?? null);
    const returnType = extractReturnType(node);
    const annotations = extractAnnotations(node);

    methods.push(nameNode.text);

    const fnEntry: StructuralAnalysis["functions"][0] = {
      name: nameNode.text,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      params,
      returnType,
    };
    if (annotations.length > 0) fnEntry.annotations = annotations;
    functions.push(fnEntry);

    if (hasModifier(node, "public")) {
      exports.push({
        name: nameNode.text,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractConstructor(
    node: TreeSitterNode,
    methods: string[],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    const paramsNode = node.childForFieldName("parameters");
    const params = extractParams(paramsNode ?? null);

    methods.push(nameNode.text);

    functions.push({
      name: nameNode.text,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      params,
      // Constructors have no return type
    });

    if (hasModifier(node, "public")) {
      exports.push({
        name: nameNode.text,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractField(
    node: TreeSitterNode,
    properties: string[],
    exports: StructuralAnalysis["exports"],
    typedProperties?: PropertyInfo[],
  ): void {
    const typeNode = node.childForFieldName("type");
    const fieldType = typeNode?.text;
    const fieldAnnotations = extractAnnotations(node);

    const declarators = findChildren(node, "variable_declarator");
    for (const decl of declarators) {
      const nameNode = decl.childForFieldName("name");
      if (nameNode) {
        properties.push(nameNode.text);

        if (typedProperties) {
          const prop: PropertyInfo = { name: nameNode.text };
          if (fieldType) prop.type = fieldType;
          if (fieldAnnotations.length > 0) prop.annotations = fieldAnnotations;
          typedProperties.push(prop);
        }

        if (hasModifier(node, "public")) {
          exports.push({
            name: nameNode.text,
            lineNumber: node.startPosition.row + 1,
          });
        }
      }
    }
  }

  private extractEnum(
    node: TreeSitterNode,
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = node.childForFieldName("name") ?? findChild(node, "identifier");
    if (!nameNode) return;

    const body = findChild(node, "enum_body");
    const properties: string[] = [];
    if (body) {
      for (const enumConst of findChildren(body, "enum_constant")) {
        const constName = findChild(enumConst, "identifier");
        if (constName) properties.push(constName.text);
      }
    }

    classes.push({
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      methods: [],
      properties,
      kind: "enum",
    });
    exports.push({ name: nameNode.text, lineNumber: node.startPosition.row + 1 });
  }

  private extractRecord(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = node.childForFieldName("name") ?? findChild(node, "identifier");
    if (!nameNode) return;

    const methods: string[] = [];
    const properties: string[] = [];
    const body = findChild(node, "class_body");
    if (body) {
      this.extractClassBodyMembers(body, methods, properties, functions, exports);
    }

    classes.push({
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      methods,
      properties,
      kind: "record",
    });
    exports.push({ name: nameNode.text, lineNumber: node.startPosition.row + 1 });
  }


  private extractAnnotationType(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = node.childForFieldName("name") ?? findChild(node, "identifier");
    if (!nameNode) return;

    const methods: string[] = [];
    const body = findChild(node, "class_body");
    if (body) {
      for (const method of findChildren(body, "method_declaration")) {
        const methodName = method.childForFieldName("name") ?? findChild(method, "identifier");
        if (methodName) methods.push(methodName.text);
      }
    }

    classes.push({
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      methods,
      properties: [],
      kind: "annotation",
    });
    exports.push({ name: nameNode.text, lineNumber: node.startPosition.row + 1 });
  }

}

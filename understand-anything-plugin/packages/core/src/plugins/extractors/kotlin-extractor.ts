import type { StructuralAnalysis, CallGraphEntry, AnnotationInfo, PropertyInfo, EndpointInfo } from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { findChild, findChildren } from "./base-extractor.js";

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

function extractParams(paramsNode: TreeSitterNode | null): string[] {
  if (!paramsNode) return [];
  const params: string[] = [];
  for (const param of findChildren(paramsNode, "parameter")) {
    const nameNode = findChild(param, "identifier");
    if (nameNode) params.push(nameNode.text);
  }
  return params;
}

function extractReturnType(node: TreeSitterNode): string | undefined {
  let pastParams = false;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === "function_value_parameters") {
      pastParams = true;
      continue;
    }
    if (pastParams && child.type === "user_type") {
      return child.text;
    }
  }
  return undefined;
}

function extractTypeText(node: TreeSitterNode | null): string | undefined {
  if (!node) return undefined;
  const userType = node.type === "user_type" ? node : findChild(node, "user_type");
  return userType?.text;
}

function isExported(node: TreeSitterNode): boolean {
  const modifiers = findChild(node, "modifiers");
  if (!modifiers) return true;

  for (let i = 0; i < modifiers.childCount; i++) {
    const child = modifiers.child(i);
    if (!child || child.type !== "visibility_modifier") continue;
    const visibility = child.child(0)?.text;
    if (visibility === "private" || visibility === "protected") return false;
    if (visibility === "internal" || visibility === "public") return true;
  }

  return true;
}

function extractAnnotationName(annotationNode: TreeSitterNode): string | null {
  const markerType = findChild(annotationNode, "user_type");
  if (markerType) {
    const nameNode = findChild(markerType, "identifier");
    if (nameNode) return nameNode.text;
  }

  const ctorInvocation = findChild(annotationNode, "constructor_invocation");
  if (ctorInvocation) {
    const userType = findChild(ctorInvocation, "user_type");
    const nameNode = userType ? findChild(userType, "identifier") : null;
    if (nameNode) return nameNode.text;
  }

  return null;
}

function extractAnnotationArguments(
  annotationNode: TreeSitterNode,
): Record<string, string> | undefined {
  const ctorInvocation = findChild(annotationNode, "constructor_invocation");
  if (!ctorInvocation) return undefined;

  const valueArgs = findChild(ctorInvocation, "value_arguments");
  if (!valueArgs) return undefined;

  const args: Record<string, string> = {};
  for (const arg of findChildren(valueArgs, "value_argument")) {
    const hasEquals = (() => {
      for (let i = 0; i < arg.childCount; i++) {
        if (arg.child(i)?.type === "=") return true;
      }
      return false;
    })();

    if (hasEquals) {
      const keyNode = findChild(arg, "identifier");
      if (!keyNode) continue;
      let valueText = "";
      let afterEquals = false;
      for (let i = 0; i < arg.childCount; i++) {
        const child = arg.child(i);
        if (!child) continue;
        if (child.type === "=") {
          afterEquals = true;
          continue;
        }
        if (afterEquals) {
          valueText += child.text;
        }
      }
      args[keyNode.text] = valueText.replace(/^"|"$/g, "");
    } else {
      // Positional argument (no key=value syntax) — store as "value"
      let valueText = "";
      for (let i = 0; i < arg.childCount; i++) {
        const child = arg.child(i);
        if (child) valueText += child.text;
      }
      if (valueText) {
        args["value"] = valueText.replace(/^"|"$/g, "");
      }
    }
  }

  return Object.keys(args).length > 0 ? args : undefined;
}

function extractAnnotations(node: TreeSitterNode): AnnotationInfo[] {
  const modifiers = findChild(node, "modifiers");
  if (!modifiers) return [];

  const annotations: AnnotationInfo[] = [];
  for (let i = 0; i < modifiers.childCount; i++) {
    const child = modifiers.child(i);
    if (!child || child.type !== "annotation") continue;

    const name = extractAnnotationName(child);
    if (!name) continue;

    const info: AnnotationInfo = { name };
    const args = extractAnnotationArguments(child);
    if (args) info.arguments = args;
    annotations.push(info);
  }

  return annotations;
}

function extractDelegationSpecifiers(node: TreeSitterNode): {
  superclass?: string;
  interfaces: string[];
} {
  const specifiersNode = findChild(node, "delegation_specifiers");
  if (!specifiersNode) return { interfaces: [] };

  let superclass: string | undefined;
  const interfaces: string[] = [];

  for (const specifier of findChildren(specifiersNode, "delegation_specifier")) {
    const ctorInvocation = findChild(specifier, "constructor_invocation");
    if (ctorInvocation) {
      const userType = findChild(ctorInvocation, "user_type");
      const nameNode = userType ? findChild(userType, "identifier") : null;
      if (nameNode) superclass = nameNode.text;
      continue;
    }

    const userType = findChild(specifier, "user_type");
    const nameNode = userType ? findChild(userType, "identifier") : null;
    if (nameNode) interfaces.push(nameNode.text);
  }

  return { superclass, interfaces };
}

function lastComponent(path: string): string {
  const parts = path.split(".");
  return parts[parts.length - 1];
}

function extractClassParameter(
  paramNode: TreeSitterNode,
  properties: string[],
  typedProperties: PropertyInfo[],
): void {
  const hasValOrVar =
    findChild(paramNode, "val") !== null || findChild(paramNode, "var") !== null;
  if (!hasValOrVar) return;

  const nameNode = findChild(paramNode, "identifier");
  if (!nameNode) return;

  properties.push(nameNode.text);

  const prop: PropertyInfo = { name: nameNode.text };
  const typeText = extractTypeText(paramNode);
  if (typeText) prop.type = typeText;
  const annotations = extractAnnotations(paramNode);
  if (annotations.length > 0) prop.annotations = annotations;
  typedProperties.push(prop);
}

function extractPropertyDeclaration(
  node: TreeSitterNode,
  properties: string[],
  exports: StructuralAnalysis["exports"],
  typedProperties: PropertyInfo[],
): void {
  const varDecl = findChild(node, "variable_declaration");
  if (!varDecl) return;

  const nameNode = findChild(varDecl, "identifier");
  if (!nameNode) return;

  properties.push(nameNode.text);

  const prop: PropertyInfo = { name: nameNode.text };
  const typeText = extractTypeText(varDecl);
  if (typeText) prop.type = typeText;
  const annotations = extractAnnotations(node);
  if (annotations.length > 0) prop.annotations = annotations;
  typedProperties.push(prop);

  if (isExported(node)) {
    exports.push({
      name: nameNode.text,
      lineNumber: node.startPosition.row + 1,
    });
  }
}

function extractHttpBasePath(annotations: AnnotationInfo[]): string | undefined {
  for (const ann of annotations) {
    if (ann.name === "RequestMapping" || ann.name === "Path") {
      const path = ann.arguments?.value ?? ann.arguments?.path;
      if (path) return path.replace(/^["']|["']$/g, "");
    }
  }
  return undefined;
}

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

export class KotlinExtractor implements LanguageExtractor {
  readonly languageIds = ["kotlin"];

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
        case "import":
          this.extractImport(node, imports);
          break;
        case "class_declaration":
          this.extractClassDeclaration(node, functions, classes, exports, endpoints);
          break;
        case "object_declaration":
          this.extractObjectDeclaration(node, functions, classes, exports, endpoints);
          break;
        case "function_declaration":
          this.extractTopLevelFunction(node, functions, exports);
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

    const walkForCalls = (node: TreeSitterNode) => {
      let pushedName = false;

      if (node.type === "function_declaration") {
        const nameNode = node.childForFieldName("name") ?? findChild(node, "identifier");
        if (nameNode) {
          functionStack.push(nameNode.text);
          pushedName = true;
        }
      }

      if (node.type === "call_expression" && functionStack.length > 0) {
        const callee = this.extractCallExpressionName(node);
        if (callee) {
          entries.push({
            caller: functionStack[functionStack.length - 1],
            callee,
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

  private extractCallExpressionName(node: TreeSitterNode): string | null {
    const navigation = findChild(node, "navigation_expression");
    if (navigation) return navigation.text;

    const identifier = findChild(node, "identifier");
    if (identifier) return identifier.text;

    return null;
  }

  private extractImport(
    node: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    const qualifiedId = findChild(node, "qualified_identifier");
    if (!qualifiedId) return;

    const hasWildcard = findChild(node, "*") !== null;
    const fullPath = qualifiedId.text;

    if (hasWildcard) {
      imports.push({
        source: fullPath,
        specifiers: ["*"],
        lineNumber: node.startPosition.row + 1,
      });
    } else {
      imports.push({
        source: fullPath,
        specifiers: [lastComponent(fullPath)],
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractClassDeclaration(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
    endpoints: EndpointInfo[],
  ): void {
    const nameNode = node.childForFieldName("name") ?? findChild(node, "identifier");
    if (!nameNode) return;

    const methods: string[] = [];
    const properties: string[] = [];
    const typedProperties: PropertyInfo[] = [];

    const annotations = extractAnnotations(node);
    const basePath = extractHttpBasePath(annotations);

    const primaryConstructor = findChild(node, "primary_constructor");
    if (primaryConstructor) {
      const classParameters = findChild(primaryConstructor, "class_parameters");
      if (classParameters) {
        for (const param of findChildren(classParameters, "class_parameter")) {
          extractClassParameter(param, properties, typedProperties);
        }
      }
    }

    const body = findChild(node, "class_body");
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

    const { superclass, interfaces } = extractDelegationSpecifiers(node);

    const classEntry: StructuralAnalysis["classes"][0] = {
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      methods,
      properties,
    };
    if (annotations.length > 0) classEntry.annotations = annotations;
    if (superclass) classEntry.superclass = superclass;
    if (interfaces.length > 0) classEntry.interfaces = interfaces;
    if (typedProperties.length > 0) classEntry.typedProperties = typedProperties;
    classes.push(classEntry);

    if (isExported(node)) {
      exports.push({
        name: nameNode.text,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractObjectDeclaration(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
    endpoints: EndpointInfo[],
  ): void {
    const nameNode = node.childForFieldName("name") ?? findChild(node, "identifier");
    if (!nameNode) return;

    const methods: string[] = [];
    const properties: string[] = [];
    const typedProperties: PropertyInfo[] = [];

    const annotations = extractAnnotations(node);
    const basePath = extractHttpBasePath(annotations);

    const body = findChild(node, "class_body");
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

    const classEntry: StructuralAnalysis["classes"][0] = {
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      methods,
      properties,
    };
    if (annotations.length > 0) classEntry.annotations = annotations;
    if (typedProperties.length > 0) classEntry.typedProperties = typedProperties;
    classes.push(classEntry);

    if (isExported(node)) {
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
    typedProperties: PropertyInfo[],
    endpoints?: EndpointInfo[],
    basePath?: string,
  ): void {
    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);
      if (!child) continue;

      switch (child.type) {
        case "function_declaration":
          this.extractFunction(child, methods, functions, exports);
          if (endpoints) {
            extractEndpointFromMethod(child, endpoints, basePath);
          }
          break;
        case "property_declaration":
          extractPropertyDeclaration(child, properties, exports, typedProperties);
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
    const nameNode = node.childForFieldName("name") ?? findChild(node, "identifier");
    if (!nameNode) return;

    const paramsNode = findChild(node, "function_value_parameters");
    const params = extractParams(paramsNode ?? null);
    const returnType = extractReturnType(node);
    const annotations = extractAnnotations(node);

    methods.push(nameNode.text);

    const fnEntry: StructuralAnalysis["functions"][0] = {
      name: nameNode.text,
      lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
      params,
      returnType,
    };
    if (annotations.length > 0) fnEntry.annotations = annotations;
    functions.push(fnEntry);

    if (isExported(node)) {
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
}

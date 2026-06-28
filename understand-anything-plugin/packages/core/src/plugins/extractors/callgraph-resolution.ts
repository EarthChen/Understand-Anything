export type CallResolutionKind =
  | "field"
  | "parameter"
  | "local"
  | "static"
  | "implicit-owner"
  | "heuristic"
  | "unresolved";

export interface TypeBinding {
  type: string;
  qualifiedType?: string;
  kind: Exclude<CallResolutionKind, "static" | "implicit-owner" | "heuristic" | "unresolved">;
}

export interface QualificationContext {
  packageName?: string;
  imports: Map<string, string>;
  knownTypes: Map<string, string>;
}

export class TypeScopeStack {
  private readonly scopes: Array<Map<string, TypeBinding>> = [new Map()];

  pushScope(): void {
    this.scopes.push(new Map());
  }

  popScope(): void {
    if (this.scopes.length > 1) {
      this.scopes.pop();
    }
  }

  set(name: string, binding: TypeBinding): void {
    this.scopes[this.scopes.length - 1].set(name, binding);
  }

  resolve(name: string): TypeBinding | undefined {
    for (let index = this.scopes.length - 1; index >= 0; index--) {
      const binding = this.scopes[index].get(name);
      if (binding) {
        return binding;
      }
    }

    return undefined;
  }
}

export function stripTypeSyntax(typeText: string): string {
  return typeText
    .trim()
    .replace(/[?!]+$/g, "")
    .replace(/\s*[*&]+$/g, "")
    .replace(/<.*>$/g, "")
    .replace(/(?:\[\])+$/g, "")
    .trim();
}

export function simpleTypeName(typeText: string): string {
  const stripped = stripTypeSyntax(typeText);
  return stripped.split(".").pop() ?? stripped;
}

export function qualifyTypeName(typeText: string, context: QualificationContext): string | undefined {
  const stripped = stripTypeSyntax(typeText);
  if (!stripped) {
    return undefined;
  }

  if (stripped.includes(".")) {
    return stripped;
  }

  const simple = simpleTypeName(stripped);
  return context.knownTypes.get(simple)
    ?? context.imports.get(simple)
    ?? (context.packageName ? `${context.packageName}.${simple}` : simple);
}

export function buildQualifiedMethodName(
  owner: string | undefined,
  methodName: string | undefined,
): string | undefined {
  if (!owner || !methodName) {
    return undefined;
  }

  return `${owner}#${methodName}`;
}

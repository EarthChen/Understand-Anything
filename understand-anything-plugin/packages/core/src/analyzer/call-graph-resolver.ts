export interface FileExtraction {
  path: string;
  functions: Array<{ name: string; lineRange: [number, number] }>;
  callGraph: Array<{ caller: string; callee: string; lineNumber: number }>;
  imports: Array<{ source: string; specifiers: string[] }>;
  classes: Array<{
    name: string;
    lineRange: [number, number];
    methods: string[];
    properties: string[];
    typedProperties?: Array<{ name: string; type?: string }>;
  }>;
}

export interface ResolvedCallEdge {
  callerFile: string;
  callerFunc: string;
  calleeFile: string;
  calleeFunc: string;
  lineNumber: number;
}

export interface UnresolvedCall {
  file: string;
  caller: string;
  callee: string;
  lineNumber: number;
}

export function resolveCallGraph(files: FileExtraction[]): {
  edges: ResolvedCallEdge[];
  unresolved: UnresolvedCall[];
} {
  // 1. Build global symbol index: functionName -> filePath[]
  const symbolIndex = new Map<string, string[]>();
  for (const file of files) {
    for (const fn of file.functions) {
      const existing = symbolIndex.get(fn.name) ?? [];
      if (!existing.includes(file.path)) existing.push(file.path);
      symbolIndex.set(fn.name, existing);
    }
    for (const cls of file.classes) {
      for (const method of cls.methods) {
        const existing = symbolIndex.get(method) ?? [];
        if (!existing.includes(file.path)) existing.push(file.path);
        symbolIndex.set(method, existing);
      }
    }
  }

  // 2. Build per-file import maps: localName -> sourceFilePath
  const importMaps = new Map<string, Map<string, string>>();
  for (const file of files) {
    const imap = new Map<string, string>();
    for (const imp of file.imports) {
      const resolvedPath = resolveImportPath(file.path, imp.source, files);
      if (resolvedPath) {
        for (const spec of imp.specifiers) {
          imap.set(spec, resolvedPath);
        }
      }
    }
    importMaps.set(file.path, imap);
  }

  // 3. Resolve each call graph entry
  const edges: ResolvedCallEdge[] = [];
  const unresolved: UnresolvedCall[] = [];

  for (const file of files) {
    const imap = importMaps.get(file.path)!;

    for (const entry of file.callGraph) {
      let calleeName = entry.callee;
      let resolvedFile: string | null = null;

      // Parse callee: "obj.method" -> try type lookup
      if (calleeName.includes(".")) {
        const parts = calleeName.split(".");
        const objName = parts[0];
        const methodName = parts[parts.length - 1];

        // Try to find obj's type from class typedProperties
        for (const cls of file.classes) {
          const prop = cls.typedProperties?.find((p) => p.name === objName);
          if (prop?.type) {
            const typeFile = findFileContainingClass(files, prop.type);
            if (typeFile) {
              resolvedFile = typeFile;
              calleeName = methodName;
              break;
            }
          }
        }

        // Fallback: try methodName directly
        if (!resolvedFile) {
          resolvedFile = imap.get(methodName) ?? null;
          if (!resolvedFile) {
            const candidates = symbolIndex.get(methodName);
            if (candidates?.length === 1) resolvedFile = candidates[0];
          }
          calleeName = methodName;
        }
      } else {
        // Simple name: check import map first
        resolvedFile = imap.get(calleeName) ?? null;
        if (!resolvedFile) {
          const candidates = symbolIndex.get(calleeName);
          if (candidates?.length === 1) resolvedFile = candidates[0];
        }
      }

      if (resolvedFile) {
        edges.push({
          callerFile: file.path,
          callerFunc: entry.caller,
          calleeFile: resolvedFile,
          calleeFunc: calleeName,
          lineNumber: entry.lineNumber,
        });
      } else {
        unresolved.push({
          file: file.path,
          caller: entry.caller,
          callee: entry.callee,
          lineNumber: entry.lineNumber,
        });
      }
    }
  }

  return { edges, unresolved };
}

function resolveImportPath(fromFile: string, importSource: string, files: FileExtraction[]): string | null {
  if (importSource.startsWith(".")) {
    const dir = fromFile.split("/").slice(0, -1).join("/");
    const resolved = normalizePath(dir + "/" + importSource);
    for (const f of files) {
      if (
        f.path === resolved ||
        f.path === resolved + ".ts" ||
        f.path === resolved + ".js" ||
        f.path === resolved + "/index.ts" ||
        f.path === resolved + "/index.js"
      ) {
        return f.path;
      }
    }
  }
  return null;
}

function normalizePath(p: string): string {
  const parts: string[] = [];
  for (const part of p.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== ".") parts.push(part);
  }
  return parts.join("/");
}

function findFileContainingClass(files: FileExtraction[], className: string): string | null {
  for (const file of files) {
    if (file.classes.some((c) => c.name === className)) return file.path;
  }
  return null;
}

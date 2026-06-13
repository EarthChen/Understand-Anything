export interface FQNInput {
  language: string;
  filePath: string;
  packageName?: string;
  className: string;
}

export function buildFQN(input: FQNInput): string {
  const { language, filePath, packageName, className } = input;

  // Java/Kotlin: package declaration is authoritative
  if (packageName && (language === "java" || language === "kotlin")) {
    return `${packageName}.${className}`;
  }

  // Java/Kotlin fallback: derive from file path
  if (language === "java" || language === "kotlin") {
    const match = filePath.match(
      /(?:src\/(?:(?:main|test)\/)?(?:(?:java|kotlin)\/)?)(.+)\//
    );
    if (match) {
      return `${match[1].replace(/\//g, ".")}.${className}`;
    }
  }

  // TypeScript/JavaScript: use file path
  if (language === "typescript" || language === "javascript") {
    const normalized = filePath
      .replace(/\.(ts|tsx|js|jsx)$/, "")
      .replace(/\/index$/, "");
    if (normalized.includes("/")) {
      return `${normalized}.${className}`;
    }
  }

  // Dart
  if (language === "dart" && packageName) {
    return `${packageName}.${className}`;
  }

  // Swift: module.type
  if (language === "swift") {
    const module = filePath.split("/")[0] || "main";
    return `${module}.${className}`;
  }

  // Fallback: short name
  return className;
}

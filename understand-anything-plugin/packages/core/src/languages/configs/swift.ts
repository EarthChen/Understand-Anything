import type { LanguageConfig } from "../types.js";

export const swiftConfig = {
  id: "swift",
  displayName: "Swift",
  extensions: [".swift"],
  treeSitter: {
    wasmPackage: "tree-sitter-swift",
    wasmFile: "tree-sitter-swift.wasm",
    localWasm: "grammars/tree-sitter-swift.wasm",
  },
  concepts: [
    "optionals",
    "protocols",
    "extensions",
    "generics",
    "closures",
    "property wrappers",
    "result builders",
    "actors",
    "structured concurrency",
    "value types vs reference types",
  ],
  filePatterns: {
    entryPoints: ["Sources/*/main.swift", "App.swift", "AppDelegate.swift"],
    barrels: [],
    tests: ["*Tests.swift", "Tests/**/*.swift"],
    config: ["Package.swift"],
  },
} satisfies LanguageConfig;

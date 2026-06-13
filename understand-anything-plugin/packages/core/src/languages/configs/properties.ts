import type { LanguageConfig } from "../types.js";

export const propertiesConfig = {
  id: "properties",
  displayName: "Properties",
  extensions: [".properties"],
  concepts: ["key-value", "configuration", "spring-boot"],
  filePatterns: {
    entryPoints: [],
    barrels: [],
    tests: [],
    config: ["*.properties", "application*.properties", "bootstrap*.properties"],
  },
} satisfies LanguageConfig;

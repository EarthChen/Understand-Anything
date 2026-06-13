import { describe, it, expect } from "vitest";
import { buildFQN } from "./fqn-builder.js";

describe("buildFQN", () => {
  it("builds FQN from Java package declaration", () => {
    const result = buildFQN({
      language: "java",
      filePath: "src/main/java/com/example/service/UserService.java",
      packageName: "com.example.service",
      className: "UserServiceImpl",
    });
    expect(result).toBe("com.example.service.UserServiceImpl");
  });

  it("builds FQN from file path when no package declaration", () => {
    const result = buildFQN({
      language: "java",
      filePath: "src/com/example/service/UserService.java",
      className: "UserService",
    });
    expect(result).toBe("com.example.service.UserService");
  });

  it("builds FQN for TypeScript from file path", () => {
    const result = buildFQN({
      language: "typescript",
      filePath: "src/services/user-service.ts",
      className: "UserService",
    });
    expect(result).toBe("src/services/user-service.UserService");
  });

  it("returns short name when no path info available", () => {
    const result = buildFQN({
      language: "typescript",
      filePath: "unknown.ts",
      className: "MyClass",
    });
    expect(result).toBe("MyClass");
  });
});

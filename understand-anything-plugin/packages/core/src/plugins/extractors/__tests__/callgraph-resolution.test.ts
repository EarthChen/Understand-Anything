import { describe, expect, it } from "vitest";
import {
  TypeScopeStack,
  buildQualifiedMethodName,
  qualifyTypeName,
  stripTypeSyntax,
} from "../callgraph-resolution.js";

describe("callgraph resolution helpers", () => {
  it("uses local bindings before parameters and fields", () => {
    const scopes = new TypeScopeStack();
    scopes.set("service", { type: "FieldService", qualifiedType: "com.example.FieldService", kind: "field" });
    scopes.pushScope();
    scopes.set("service", { type: "ParamService", qualifiedType: "com.example.ParamService", kind: "parameter" });
    scopes.pushScope();
    scopes.set("service", { type: "LocalService", qualifiedType: "com.example.LocalService", kind: "local" });

    expect(scopes.resolve("service")).toEqual({
      type: "LocalService",
      qualifiedType: "com.example.LocalService",
      kind: "local",
    });
  });

  it("falls back to package qualification for simple class names", () => {
    expect(qualifyTypeName("UserService", {
      packageName: "com.example",
      imports: new Map(),
      knownTypes: new Map(),
    })).toBe("com.example.UserService");
  });

  it("prefers explicit imports over package qualification", () => {
    expect(qualifyTypeName("UserService", {
      packageName: "com.local",
      imports: new Map([["UserService", "com.remote.UserService"]]),
      knownTypes: new Map(),
    })).toBe("com.remote.UserService");
  });

  it("strips syntax noise from receiver types", () => {
    expect(stripTypeSyntax("List<UserProfileMoaWrapperService>?")).toBe("List");
    expect(stripTypeSyntax("UserProfileMoaWrapperService *")).toBe("UserProfileMoaWrapperService");
  });

  it("builds qualified method names from owner and method", () => {
    expect(buildQualifiedMethodName("com.example.UserService", "queryUserExtend"))
      .toBe("com.example.UserService#queryUserExtend");
  });
});

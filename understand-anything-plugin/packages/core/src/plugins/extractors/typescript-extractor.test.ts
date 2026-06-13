import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { TypeScriptExtractor } from "./typescript-extractor.js";

const require = createRequire(import.meta.url);

let Parser: any;
let Language: any;
let tsLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  const wasmPath = require.resolve(
    "tree-sitter-typescript/tree-sitter-typescript.wasm",
  );
  tsLang = await Language.load(wasmPath);
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(tsLang);
  const tree = parser.parse(code);
  return tree.rootNode;
}

const extractor = new TypeScriptExtractor();

describe("TypeScriptExtractor interface extraction", () => {
  it("extracts interface with methods and properties", () => {
    const code = `
interface UserService {
  getUser(id: string): User;
  name: string;
  age: number;
}`;
    const root = parse(code);
    const result = extractor.extractStructure(root);
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].name).toBe("UserService");
    expect(result.classes[0].kind).toBe("interface");
    expect(result.classes[0].methods).toContain("getUser");
    expect(result.classes[0].properties).toEqual(expect.arrayContaining(["name", "age"]));
  });

  it("extracts interface with extends", () => {
    const code = `
interface AdminService extends UserService {
  grantPermission(perm: string): void;
}`;
    const root = parse(code);
    const result = extractor.extractStructure(root);
    expect(result.classes[0].kind).toBe("interface");
    expect(result.classes[0].interfaces).toContain("UserService");
  });

  it("extracts exported interface", () => {
    const code = `export interface PublicAPI { query(): void; }`;
    const root = parse(code);
    const result = extractor.extractStructure(root);
    expect(result.classes).toHaveLength(1);
    expect(result.exports.some((e) => e.name === "PublicAPI")).toBe(true);
  });
});

describe("TypeScriptExtractor enum extraction", () => {
  it("extracts enum with members", () => {
    const code = `
enum Status {
  Active,
  Inactive,
  Pending,
}`;
    const root = parse(code);
    const result = extractor.extractStructure(root);
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].name).toBe("Status");
    expect(result.classes[0].kind).toBe("enum");
    expect(result.classes[0].properties).toEqual(expect.arrayContaining(["Active", "Inactive", "Pending"]));
  });

  it("extracts exported enum", () => {
    const code = `export enum Color { Red, Green, Blue }`;
    const root = parse(code);
    const result = extractor.extractStructure(root);
    expect(result.classes[0].kind).toBe("enum");
    expect(result.exports.some((e) => e.name === "Color")).toBe(true);
  });
});

describe("TypeScriptExtractor type alias extraction", () => {
  it("extracts type alias", () => {
    const code = `type UserID = string | number;`;
    const root = parse(code);
    const result = extractor.extractStructure(root);
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].name).toBe("UserID");
    expect(result.classes[0].kind).toBe("type");
  });

  it("extracts exported type alias", () => {
    const code = `export type Callback = (err: Error | null) => void;`;
    const root = parse(code);
    const result = extractor.extractStructure(root);
    expect(result.classes[0].kind).toBe("type");
    expect(result.exports.some((e) => e.name === "Callback")).toBe(true);
  });
});

describe("TypeScriptExtractor decorator extraction", () => {
  it("extracts class decorators", () => {
    const code = `
@Component({ selector: 'app-root' })
class App {}
`;
    const root = parse(code);
    const result = extractor.extractStructure(root);
    expect(result.classes[0].annotations).toBeDefined();
    expect(result.classes[0].annotations![0].name).toBe("Component");
    expect(result.classes[0].annotations![0].arguments).toEqual({ selector: "app-root" });
  });

  it("extracts method decorators", () => {
    const code = `
class Controller {
  @Get('/api')
  handle() {}
}`;
    const root = parse(code);
    const result = extractor.extractStructure(root);
    expect(result.classes[0].methods).toContain("handle");
  });
});

describe("TypeScriptExtractor heritage extraction", () => {
  it("extracts extends", () => {
    const code = `class AdminService extends BaseService { }`;
    const root = parse(code);
    const result = extractor.extractStructure(root);
    expect(result.classes[0].superclass).toBe("BaseService");
  });

  it("extracts implements", () => {
    const code = `class MyService implements Service, Serializable { }`;
    const root = parse(code);
    const result = extractor.extractStructure(root);
    expect(result.classes[0].interfaces).toEqual(expect.arrayContaining(["Service", "Serializable"]));
  });
});

describe("TypeScriptExtractor CommonJS support", () => {
  it("detects require() as import", () => {
    const code = `const fs = require('fs');`;
    const root = parse(code);
    const result = extractor.extractStructure(root);
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].source).toBe("fs");
  });

  it("detects require() with destructuring", () => {
    const code = `const { readFile, writeFile } = require('fs');`;
    const root = parse(code);
    const result = extractor.extractStructure(root);
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].source).toBe("fs");
  });

  it("detects module.exports as export", () => {
    const code = `module.exports = { foo: 1 };`;
    const root = parse(code);
    const result = extractor.extractStructure(root);
    expect(result.exports.length).toBeGreaterThan(0);
    expect(result.exports.some((e) => e.name === "module.exports")).toBe(true);
  });

  it("detects exports.foo as export", () => {
    const code = `exports.bar = function() {};`;
    const root = parse(code);
    const result = extractor.extractStructure(root);
    expect(result.exports.length).toBeGreaterThan(0);
    expect(result.exports.some((e) => e.name === "bar")).toBe(true);
  });

  it("detects multiple exports.foo assignments", () => {
    const code = `exports.a = 1;\nexports.b = 2;`;
    const root = parse(code);
    const result = extractor.extractStructure(root);
    expect(result.exports.length).toBe(2);
    expect(result.exports.map((e) => e.name)).toEqual(expect.arrayContaining(["a", "b"]));
  });
});

describe("TypeScriptExtractor typed properties", () => {
  it("extracts typed class fields", () => {
    const code = `
class User {
  name: string;
  age: number;
}`;
    const root = parse(code);
    const result = extractor.extractStructure(root);
    expect(result.classes[0].typedProperties).toBeDefined();
    expect(result.classes[0].typedProperties!.map((p) => p.name)).toEqual(expect.arrayContaining(["name", "age"]));
  });
});

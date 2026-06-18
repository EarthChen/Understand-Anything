import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "node:path";
import { SwiftExtractor } from "../swift-extractor.js";

let Parser: any;
let Language: any;
let swiftLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  const wasmPath = resolve(__dirname, "../../../../grammars/tree-sitter-swift.wasm");
  swiftLang = await Language.load(wasmPath);
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(swiftLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  return { tree, parser, root };
}

describe("SwiftExtractor", () => {
  const extractor = new SwiftExtractor();

  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["swift"]);
  });

  describe("extractStructure - functions", () => {
    it("extracts functions with params and return types", () => {
      const { tree, parser, root } = parse(`class Foo {
    func getName(id: Int) -> String {
        return ""
    }
    func process(data: String, count: Int) {
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(2);
      expect(result.functions[0].name).toBe("getName");
      expect(result.functions[0].params).toEqual(["id"]);
      expect(result.functions[0].returnType).toBe("String");
      expect(result.functions[1].name).toBe("process");
      expect(result.functions[1].params).toEqual(["data", "count"]);
      expect(result.functions[1].returnType).toBeUndefined();

      tree.delete();
      parser.delete();
    });

    it("extracts top-level functions", () => {
      const { tree, parser, root } = parse(`func greet(name: String) -> String {
    return name
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("greet");
      expect(result.functions[0].params).toEqual(["name"]);
      expect(result.functions[0].returnType).toBe("String");

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - classes and structs", () => {
    it("extracts class with methods and properties", () => {
      const { tree, parser, root } = parse(`class Server {
    var host: String = ""
    var port: Int = 0
    func start() {}
    func stop() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Server");
      expect(result.classes[0].kind).toBe("class");
      expect(result.classes[0].properties).toEqual(["host", "port"]);
      expect(result.classes[0].methods).toEqual(["start", "stop"]);

      tree.delete();
      parser.delete();
    });

    it("extracts struct declarations as classes", () => {
      const { tree, parser, root } = parse(`struct User {
    let name: String
    let age: Int
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("User");
      expect(result.classes[0].kind).toBe("struct");
      expect(result.classes[0].properties).toEqual(["name", "age"]);

      tree.delete();
      parser.delete();
    });

    it("extracts protocol declarations as classes", () => {
      const { tree, parser, root } = parse(`protocol Repository {
    func findAll() -> [User]
    func findById(id: Int) -> User
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Repository");
      expect(result.classes[0].kind).toBe("protocol");
      expect(result.classes[0].methods).toEqual(["findAll", "findById"]);

      tree.delete();
      parser.delete();
    });

    it("extracts enum declarations as classes", () => {
      const { tree, parser, root } = parse(`enum Direction {
    case north
    case south
    case east
    case west
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Direction");
      expect(result.classes[0].kind).toBe("enum");

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - imports", () => {
    it("extracts regular imports", () => {
      const { tree, parser, root } = parse(`import Foundation
import UIKit
class Foo {}
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("Foundation");
      expect(result.imports[0].specifiers).toEqual(["Foundation"]);
      expect(result.imports[0].lineNumber).toBe(1);
      expect(result.imports[1].source).toBe("UIKit");

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - exports", () => {
    it("exports public declarations by default", () => {
      const { tree, parser, root } = parse(`public class UserService {
    public func start() {}
    private func helper() {}
}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("UserService");
      expect(exportNames).toContain("start");
      expect(exportNames).not.toContain("helper");

      tree.delete();
      parser.delete();
    });

    it("does not export private classes", () => {
      const { tree, parser, root } = parse(`private class Internal {
    private func helper() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.exports).toHaveLength(0);

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - inheritance", () => {
    it("extracts superclass and protocol conformance", () => {
      const { tree, parser, root } = parse(`class OrderController: BaseController, OrderServiceProtocol {
    func list() -> [Order] { return [] }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].superclass).toBe("BaseController");
      expect(result.classes[0].interfaces).toEqual(["OrderServiceProtocol"]);

      tree.delete();
      parser.delete();
    });

    it("omits superclass/interfaces when absent", () => {
      const { tree, parser, root } = parse(`class Simple {
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].superclass).toBeUndefined();
      expect(result.classes[0].interfaces).toBeUndefined();

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - typedProperties", () => {
    it("extracts property types", () => {
      const { tree, parser, root } = parse(`class Svc {
    var client: PaymentClient
    let name: String
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].typedProperties).toHaveLength(2);

      const client = result.classes[0].typedProperties!.find(
        (p) => p.name === "client",
      );
      expect(client).toBeDefined();
      expect(client!.type).toBe("PaymentClient");

      const name = result.classes[0].typedProperties!.find(
        (p) => p.name === "name",
      );
      expect(name).toBeDefined();
      expect(name!.type).toBe("String");

      tree.delete();
      parser.delete();
    });
  });

  describe("extractCallGraph", () => {
    it("extracts simple and qualified method calls", () => {
      const { tree, parser, root } = parse(`class Svc {
    func process() {
        validate()
        repo.save()
    }
    func validate() {}
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(2);
      expect(result[0].caller).toBe("process");
      expect(result[0].callee).toBe("validate");
      expect(result[1].caller).toBe("process");
      expect(result[1].callee).toBe("repo.save");

      tree.delete();
      parser.delete();
    });

    it("reports correct line numbers for calls", () => {
      const { tree, parser, root } = parse(`class Foo {
    func run() {
        foo()
        bar()
    }
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(2);
      expect(result[0].lineNumber).toBe(3);
      expect(result[1].lineNumber).toBe(4);

      tree.delete();
      parser.delete();
    });
  });
});

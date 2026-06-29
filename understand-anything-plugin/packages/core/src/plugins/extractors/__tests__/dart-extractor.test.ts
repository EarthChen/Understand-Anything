import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DartExtractor } from "../dart-extractor.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

let Parser: any;
let Language: any;
let dartLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  const wasmPath = resolve(__dirname, "../../../../grammars/tree-sitter-dart.wasm");
  dartLang = await Language.load(wasmPath);
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(dartLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  return { tree, parser, root };
}

describe("DartExtractor", () => {
  const extractor = new DartExtractor();

  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["dart"]);
  });

  describe("extractStructure - functions", () => {
    it("extracts methods with params and return types", () => {
      const { tree, parser, root } = parse(`class Foo {
  String getName(int id) {
    return "";
  }
  void process(String data, int count) {
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
      expect(result.functions[1].returnType).toBe("void");

      tree.delete();
      parser.delete();
    });

    it("extracts top-level functions", () => {
      const { tree, parser, root } = parse(`String greet(String name) {
  return "Hello";
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

    it("extracts getters and setters", () => {
      const { tree, parser, root } = parse(`class Foo {
  String get name => "";
  set name(String v) {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(2);
      expect(result.functions[0].name).toBe("name");
      expect(result.functions[0].returnType).toBe("String");
      expect(result.functions[1].name).toBe("name");
      expect(result.functions[1].params).toEqual(["v"]);

      tree.delete();
      parser.delete();
    });

    it("extracts named and factory constructors as functions", () => {
      const { tree, parser, root } = parse(`class Foo {
  factory Foo.named() => Foo();
  Foo.bar(this.x);
}
`);
      const result = extractor.extractStructure(root);

      const names = result.functions.map((f) => f.name);
      expect(names).toContain("Foo.named");
      expect(names).toContain("Foo.bar");

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - classes", () => {
    it("extracts class with methods and properties", () => {
      const { tree, parser, root } = parse(`class Server {
  final String host = "";
  int port = 0;
  void start() {}
  void stop() {}
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

    it("extracts mixin declarations as classes", () => {
      const { tree, parser, root } = parse(`mixin LoggerMixin {
  void log(String msg) {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("LoggerMixin");
      expect(result.classes[0].methods).toEqual(["log"]);

      tree.delete();
      parser.delete();
    });

    it("extracts extension declarations as classes", () => {
      const { tree, parser, root } = parse(`extension StringExt on String {
  bool get isBlank => trim().isEmpty;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("StringExt");
      expect(result.classes[0].methods).toEqual(["isBlank"]);

      tree.delete();
      parser.delete();
    });

    it("extracts enum declarations as classes", () => {
      const { tree, parser, root } = parse(`enum Status { active, inactive }
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Status");
      expect(result.classes[0].properties).toEqual(["active", "inactive"]);

      tree.delete();
      parser.delete();
    });

    it("extracts abstract method signatures in abstract classes", () => {
      const { tree, parser, root } = parse(`abstract class Base {
  void run();
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Base");
      expect(result.classes[0].methods).toEqual(["run"]);

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - imports", () => {
    it("extracts regular imports", () => {
      const { tree, parser, root } = parse(`import 'package:flutter/material.dart';
import 'dart:async';
class Foo {}
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("package:flutter/material.dart");
      expect(result.imports[0].specifiers).toEqual(["*"]);
      expect(result.imports[0].lineNumber).toBe(1);
      expect(result.imports[1].source).toBe("dart:async");
      expect(result.imports[1].specifiers).toEqual(["*"]);

      tree.delete();
      parser.delete();
    });

    it("extracts show imports", () => {
      const { tree, parser, root } = parse(`import 'src/models.dart' show User, Order;
class Foo {}
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("src/models.dart");
      expect(result.imports[0].specifiers).toEqual(["User", "Order"]);

      tree.delete();
      parser.delete();
    });

    it("extracts hide imports", () => {
      const { tree, parser, root } = parse(`import 'dart:math' hide Random;
class Foo {}
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("dart:math");
      expect(result.imports[0].specifiers).toEqual(["Random"]);

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - exports", () => {
    it("exports public classes and members", () => {
      const { tree, parser, root } = parse(`class UserService {
  void start() {}
  void _helper() {}
  String _secret = "";
  void public() {}
}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("UserService");
      expect(exportNames).toContain("start");
      expect(exportNames).toContain("public");
      expect(exportNames).not.toContain("_helper");
      expect(exportNames).not.toContain("_secret");

      tree.delete();
      parser.delete();
    });

    it("exports top-level public declarations", () => {
      const { tree, parser, root } = parse(`final String appName = "test";
void run() {}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("appName");
      expect(exportNames).toContain("run");

      tree.delete();
      parser.delete();
    });

    it("handles export directives with show", () => {
      const { tree, parser, root } = parse(`export 'src/models.dart' show User;
class Foo {}
`);
      const result = extractor.extractStructure(root);

      const userExport = result.exports.find((e) => e.name === "User");
      expect(userExport).toBeDefined();
      expect(userExport!.lineNumber).toBe(1);

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - annotations", () => {
    it("extracts marker annotations on classes", () => {
      const { tree, parser, root } = parse(`@immutable
class MyWidget extends StatelessWidget {
  void build() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].annotations).toEqual([{ name: "immutable" }]);

      tree.delete();
      parser.delete();
    });

    it("extracts annotations with arguments on classes", () => {
      const { tree, parser, root } = parse(`@JsonSerializable(fieldRename: FieldRename.snake)
class User {}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].annotations).toHaveLength(1);
      expect(result.classes[0].annotations![0].name).toBe("JsonSerializable");
      expect(result.classes[0].annotations![0].arguments?.fieldRename).toBe(
        "FieldRename.snake",
      );

      tree.delete();
      parser.delete();
    });

    it("extracts annotations on methods", () => {
      const { tree, parser, root } = parse(`class Svc {
  @override
  void run() {}
}
`);
      const result = extractor.extractStructure(root);

      const fn = result.functions.find((f) => f.name === "run");
      expect(fn).toBeDefined();
      expect(fn!.annotations).toEqual([{ name: "override" }]);

      tree.delete();
      parser.delete();
    });

    it("omits annotations field when class has none", () => {
      const { tree, parser, root } = parse(`class Plain {
  void run() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].annotations).toBeUndefined();

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - inheritance", () => {
    it("extracts superclass and interfaces", () => {
      const { tree, parser, root } = parse(`class Dog extends Animal implements Runnable, Serializable {
  void bark() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].superclass).toBe("Animal");
      expect(result.classes[0].interfaces).toEqual(["Runnable", "Serializable"]);

      tree.delete();
      parser.delete();
    });

    it("extracts mixins in interfaces alongside implements", () => {
      const { tree, parser, root } = parse(`class MyWidget extends StatelessWidget with TickerMixin {
  void build() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].superclass).toBe("StatelessWidget");
      expect(result.classes[0].interfaces).toEqual(["TickerMixin"]);

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
      const { tree, parser, root } = parse(`class Config {
  final String apiUrl;
  int retryCount = 3;
  List<String>? tags;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].typedProperties).toHaveLength(3);

      const apiUrl = result.classes[0].typedProperties!.find((p) => p.name === "apiUrl");
      expect(apiUrl).toBeDefined();
      expect(apiUrl!.type).toBe("String");

      const retryCount = result.classes[0].typedProperties!.find(
        (p) => p.name === "retryCount",
      );
      expect(retryCount).toBeDefined();
      expect(retryCount!.type).toBe("int");

      const tags = result.classes[0].typedProperties!.find((p) => p.name === "tags");
      expect(tags).toBeDefined();
      expect(tags!.type).toBe("List<String>?");

      tree.delete();
      parser.delete();
    });
  });

  describe("extractCallGraph", () => {
    it("extracts simple and qualified method calls", () => {
      const { tree, parser, root } = parse(`class Svc {
  void process() {
    validate();
    repo.save();
  }
  void validate() {}
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

    it("extracts this and super calls", () => {
      const { tree, parser, root } = parse(`class Foo {
  void run() {
    this.validate();
    super.run();
  }
}
`);
      const result = extractor.extractCallGraph(root);

      const callees = result.map((e) => e.callee);
      expect(callees).toContain("this.validate");
      expect(callees).toContain("super.run");

      tree.delete();
      parser.delete();
    });

    it("reports correct line numbers for calls", () => {
      const { tree, parser, root } = parse(`class Foo {
  void run() {
    foo();
    bar();
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

    it("tracks top-level function callers", () => {
      const { tree, parser, root } = parse(`void main() {
  greet("hi");
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(1);
      expect(result[0].caller).toBe("main");
      expect(result[0].callee).toBe("greet");

      tree.delete();
      parser.delete();
    });

    it("resolves Dart field, this.field, parameter, local, static, and implicit owner calls", () => {
      const { tree, parser, root } = parse(`class UserApi {
  Future<String> fetch(String id) async => id;
  static void warmup() {}
}

class UserRepo {
  void save() {}
}

class UserController {
  final UserApi api;
  UserController(this.api);

  void load(UserRepo repo) {
    final UserApi localApi = UserApi();
    api.fetch("field");
    this.api.fetch("this-field");
    repo.save();
    localApi.fetch("local");
    UserApi.warmup();
    notify();
  }

  void notify() {}
}
`);
      const result = extractor.extractCallGraph(root);

      const fieldCall = result.find((entry) => entry.callee === "api.fetch");
      expect(fieldCall).toEqual(
        expect.objectContaining({
          caller: "load",
          callee: "api.fetch",
          lineNumber: 16,
          columnNumber: 5,
          receiver: "api",
          methodName: "fetch",
          argumentCount: 1,
          callText: 'api.fetch("field")',
          callerOwner: "UserController",
          callerQualifiedName: "UserController#load",
          receiverType: "UserApi",
          receiverQualifiedType: "UserApi",
          calleeOwner: "UserApi",
          calleeQualifiedName: "UserApi#fetch",
          resolutionKind: "field",
        }),
      );

      const thisFieldCall = result.find((entry) => entry.callee === "this.api.fetch");
      expect(thisFieldCall).toEqual(
        expect.objectContaining({
          receiver: "this.api",
          methodName: "fetch",
          receiverType: "UserApi",
          receiverQualifiedType: "UserApi",
          calleeOwner: "UserApi",
          calleeQualifiedName: "UserApi#fetch",
          resolutionKind: "field",
        }),
      );

      const parameterCall = result.find((entry) => entry.callee === "repo.save");
      expect(parameterCall).toEqual(
        expect.objectContaining({
          receiver: "repo",
          methodName: "save",
          receiverType: "UserRepo",
          receiverQualifiedType: "UserRepo",
          calleeOwner: "UserRepo",
          calleeQualifiedName: "UserRepo#save",
          resolutionKind: "parameter",
        }),
      );

      const localCall = result.find((entry) => entry.callee === "localApi.fetch");
      expect(localCall).toEqual(
        expect.objectContaining({
          receiver: "localApi",
          methodName: "fetch",
          receiverType: "UserApi",
          receiverQualifiedType: "UserApi",
          calleeOwner: "UserApi",
          calleeQualifiedName: "UserApi#fetch",
          resolutionKind: "local",
        }),
      );

      const staticCall = result.find((entry) => entry.callee === "UserApi.warmup");
      expect(staticCall).toEqual(
        expect.objectContaining({
          receiver: "UserApi",
          methodName: "warmup",
          receiverType: "UserApi",
          receiverQualifiedType: "UserApi",
          calleeOwner: "UserApi",
          calleeQualifiedName: "UserApi#warmup",
          resolutionKind: "static",
        }),
      );

      const implicitOwnerCall = result.find((entry) => entry.callee === "notify");
      expect(implicitOwnerCall).toEqual(
        expect.objectContaining({
          callerOwner: "UserController",
          callerQualifiedName: "UserController#load",
          methodName: "notify",
          calleeOwner: "UserController",
          calleeQualifiedName: "UserController#notify",
          resolutionKind: "implicit-owner",
        }),
      );

      tree.delete();
      parser.delete();
    });

    it("records constructor-like Dart calls with argument counts", () => {
      const { tree, parser, root } = parse(`class User {}

class UserFactory {
  void create() {
    User();
  }
}
`);
      const result = extractor.extractCallGraph(root);

      const constructorCall = result.find((entry) => entry.callText === "User()");
      expect(constructorCall).toEqual(
        expect.objectContaining({
          caller: "create",
          callee: "new User",
          lineNumber: 5,
          columnNumber: 5,
          methodName: "User",
          argumentCount: 0,
          callText: "User()",
          callerOwner: "UserFactory",
          callerQualifiedName: "UserFactory#create",
          receiverType: "User",
          receiverQualifiedType: "User",
          calleeOwner: "User",
          calleeQualifiedName: "User#User",
          resolutionKind: "static",
        }),
      );

      tree.delete();
      parser.delete();
    });

    it("records calls from constructor bodies with class ownership", () => {
      const { tree, parser, root } = parse(`class C {
  C() {
    init();
  }

  void init() {}
}
`);
      const result = extractor.extractCallGraph(root);

      const initCall = result.find((entry) => entry.callText === "init()");
      expect(initCall).toEqual(
        expect.objectContaining({
          caller: "C",
          callee: "init",
          callerOwner: "C",
          callerQualifiedName: "C#C",
          methodName: "init",
          calleeOwner: "C",
          calleeQualifiedName: "C#init",
          resolutionKind: "implicit-owner",
        }),
      );

      tree.delete();
      parser.delete();
    });

    it("does not classify uppercase top-level function calls as constructors", () => {
      const { tree, parser, root } = parse(`void DoWork() {}

void main() {
  DoWork();
}
`);
      const result = extractor.extractCallGraph(root);

      const call = result.find((entry) => entry.callText === "DoWork()");
      expect(call).toEqual(
        expect.objectContaining({
          caller: "main",
          callee: "DoWork",
          methodName: "DoWork",
          callText: "DoWork()",
        }),
      );
      expect(call).not.toEqual(expect.objectContaining({ callee: "new DoWork" }));
      expect(call).not.toEqual(expect.objectContaining({ resolutionKind: "static" }));
      expect(call).not.toEqual(
        expect.objectContaining({ calleeQualifiedName: "DoWork#DoWork" }),
      );

      tree.delete();
      parser.delete();
    });

    it("resolves multi-level this field receivers from the root field", () => {
      const { tree, parser, root } = parse(`class Api {
  void fetch() {}
}

class Controller {
  final Api api;
  Controller(this.api);

  void load() {
    this.api.client.fetch();
  }
}
`);
      const result = extractor.extractCallGraph(root);

      const call = result.find((entry) => entry.callee === "this.api.client.fetch");
      expect(call).toEqual(
        expect.objectContaining({
          receiver: "this.api.client",
          methodName: "fetch",
          receiverType: "Api",
          receiverQualifiedType: "Api",
          calleeOwner: "Api",
          calleeQualifiedName: "Api#fetch",
          resolutionKind: "field",
        }),
      );

      tree.delete();
      parser.delete();
    });

    it("does not leak local bindings outside nested blocks", () => {
      const { tree, parser, root } = parse(`class Api {
  void fetch() {}
}

void load(bool enabled) {
  if (enabled) {
    final Api api = Api();
    api.fetch();
  }
  api.fetch();
}
`);
      const result = extractor.extractCallGraph(root);
      const apiCalls = result.filter((entry) => entry.callee === "api.fetch");

      expect(apiCalls).toHaveLength(2);
      expect(apiCalls[0]).toEqual(
        expect.objectContaining({
          lineNumber: 8,
          resolutionKind: "local",
          receiverType: "Api",
          receiverQualifiedType: "Api",
        }),
      );
      expect(apiCalls[1]).toEqual(
        expect.objectContaining({
          lineNumber: 10,
          resolutionKind: "unresolved",
        }),
      );
      expect(apiCalls[1]).not.toEqual(expect.objectContaining({ resolutionKind: "local" }));

      tree.delete();
      parser.delete();
    });

    it("does not leak for initializer local bindings after the loop", () => {
      const { tree, parser, root } = parse(`class Api {
  void fetch() {}
}

void load(bool enabled) {
  for (final Api api = Api(); enabled; ) {
    api.fetch();
    break;
  }
  api.fetch();
}
`);
      const result = extractor.extractCallGraph(root);
      const apiCalls = result.filter((entry) => entry.callee === "api.fetch");

      expect(apiCalls).toHaveLength(2);
      expect(apiCalls[0]).toEqual(
        expect.objectContaining({
          lineNumber: 7,
          resolutionKind: "local",
          receiverType: "Api",
          receiverQualifiedType: "Api",
        }),
      );
      expect(apiCalls[1]).toEqual(
        expect.objectContaining({
          lineNumber: 10,
          resolutionKind: "unresolved",
        }),
      );
      expect(apiCalls[1]).not.toEqual(expect.objectContaining({ resolutionKind: "local" }));

      tree.delete();
      parser.delete();
    });

    it("does not treat hide import specifiers as constructor types", () => {
      const { tree, parser, root } = parse(`import "models.dart" hide User;

void main() {
  User();
}
`);
      const result = extractor.extractCallGraph(root);

      const call = result.find((entry) => entry.callText === "User()");
      expect(call).toEqual(
        expect.objectContaining({
          caller: "main",
          callee: "User",
          methodName: "User",
          callText: "User()",
        }),
      );
      expect(call).not.toEqual(expect.objectContaining({ callee: "new User" }));
      expect(call).not.toEqual(expect.objectContaining({ resolutionKind: "static" }));
      expect(call).not.toEqual(
        expect.objectContaining({ calleeQualifiedName: "User#User" }),
      );

      tree.delete();
      parser.delete();
    });

    it("resolves constructor parameter receivers", () => {
      const { tree, parser, root } = parse(`class UserRepo {
  void save() {}
}

class C {
  C(UserRepo repo) {
    repo.save();
  }
}
`);
      const result = extractor.extractCallGraph(root);

      const call = result.find((entry) => entry.callee === "repo.save");
      expect(call).toEqual(
        expect.objectContaining({
          caller: "C",
          callee: "repo.save",
          callerOwner: "C",
          callerQualifiedName: "C#C",
          receiver: "repo",
          methodName: "save",
          receiverType: "UserRepo",
          receiverQualifiedType: "UserRepo",
          calleeOwner: "UserRepo",
          calleeQualifiedName: "UserRepo#save",
          resolutionKind: "parameter",
        }),
      );

      tree.delete();
      parser.delete();
    });

    it("records named constructor calls as constructor-like entries", () => {
      const { tree, parser, root } = parse(`class User {
  User.named();
}

void main() {
  User.named();
}
`);
      const result = extractor.extractCallGraph(root);

      const call = result.find((entry) => entry.callText === "User.named()");
      expect(call).toEqual(
        expect.objectContaining({
          caller: "main",
          callee: "new User.named",
          methodName: "User.named",
          receiverType: "User",
          receiverQualifiedType: "User",
          calleeOwner: "User",
          calleeQualifiedName: "User#User.named",
          resolutionKind: "static",
        }),
      );
      expect(call).not.toEqual(
        expect.objectContaining({ calleeQualifiedName: "User#named" }),
      );

      tree.delete();
      parser.delete();
    });
  });
});

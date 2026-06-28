import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { KotlinExtractor } from "../kotlin-extractor.js";

const require = createRequire(import.meta.url);

let Parser: any;
let Language: any;
let kotlinLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  kotlinLang = await Language.load(
    require.resolve(
      "@tree-sitter-grammars/tree-sitter-kotlin/tree-sitter-kotlin.wasm",
    ),
  );
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(kotlinLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  return { tree, parser, root };
}

describe("KotlinExtractor", () => {
  const extractor = new KotlinExtractor();

  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["kotlin"]);
  });

  describe("extractStructure - functions", () => {
    it("extracts methods with params and return types", () => {
      const { tree, parser, root } = parse(`class Foo {
    fun getName(id: Int): String {
        return ""
    }
    private fun process(data: String, count: Int) {
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
      const { tree, parser, root } = parse(`fun greet(name: String): String = name
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

  describe("extractStructure - classes", () => {
    it("extracts class with methods and properties", () => {
      const { tree, parser, root } = parse(`class Server {
    val host: String = ""
    var port: Int = 0
    fun start() {}
    fun stop() {}
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

    it("extracts data class primary constructor properties", () => {
      const { tree, parser, root } = parse(
        `data class User(val name: String, val age: Int)`,
      );
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("User");
      expect(result.classes[0].properties).toEqual(["name", "age"]);
      expect(result.classes[0].typedProperties).toEqual([
        { name: "name", type: "String" },
        { name: "age", type: "Int" },
      ]);

      tree.delete();
      parser.delete();
    });

    it("extracts object declarations as classes", () => {
      const { tree, parser, root } = parse(`object Singleton {
    fun get(): Singleton = this
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Singleton");
      expect(result.classes[0].methods).toEqual(["get"]);

      tree.delete();
      parser.delete();
    });

    it("extracts interface method signatures", () => {
      const { tree, parser, root } = parse(`interface Repo {
    fun findAll(): List<User>
    fun findById(id: Int): User
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Repo");
      expect(result.classes[0].methods).toEqual(["findAll", "findById"]);

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - imports", () => {
    it("extracts regular imports", () => {
      const { tree, parser, root } = parse(`import com.example.OrderService
import com.example.util.Helper
class Foo {}
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("com.example.OrderService");
      expect(result.imports[0].specifiers).toEqual(["OrderService"]);
      expect(result.imports[0].lineNumber).toBe(1);
      expect(result.imports[1].source).toBe("com.example.util.Helper");
      expect(result.imports[1].specifiers).toEqual(["Helper"]);

      tree.delete();
      parser.delete();
    });

    it("extracts wildcard imports", () => {
      const { tree, parser, root } = parse(`import com.example.util.*
class Foo {}
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("com.example.util");
      expect(result.imports[0].specifiers).toEqual(["*"]);

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - exports", () => {
    it("exports public-by-default and internal declarations", () => {
      const { tree, parser, root } = parse(`class UserService {
    fun start() {}
    private fun helper() {}
}
internal class InternalSvc {
    internal fun run() {}
}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("UserService");
      expect(exportNames).toContain("start");
      expect(exportNames).toContain("InternalSvc");
      expect(exportNames).toContain("run");
      expect(exportNames).not.toContain("helper");

      tree.delete();
      parser.delete();
    });

    it("does not export private classes or members", () => {
      const { tree, parser, root } = parse(`private class Internal {
    private fun helper() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.exports).toHaveLength(0);

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - annotations", () => {
    it("extracts marker annotations on classes", () => {
      const { tree, parser, root } = parse(`@RestController
class OrderController {
    fun list() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].annotations).toEqual([{ name: "RestController" }]);

      tree.delete();
      parser.delete();
    });

    it("extracts annotations with arguments on methods", () => {
      const { tree, parser, root } = parse(`class Consumer {
    @KafkaListener(topics = "order-events")
    fun onMessage(msg: String) {}
}
`);
      const result = extractor.extractStructure(root);

      const fn = result.functions.find((f) => f.name === "onMessage");
      expect(fn).toBeDefined();
      expect(fn!.annotations).toHaveLength(1);
      expect(fn!.annotations![0].name).toBe("KafkaListener");
      expect(fn!.annotations![0].arguments?.topics).toBe("order-events");

      tree.delete();
      parser.delete();
    });

    it("omits annotations field when class has none", () => {
      const { tree, parser, root } = parse(`class Plain {
    fun run() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].annotations).toBeUndefined();

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - inheritance", () => {
    it("extracts superclass and interfaces from delegation specifiers", () => {
      const { tree, parser, root } = parse(`@RestController
class OrderController : BaseController(), OrderService {
    fun list(): List<Order> = emptyList()
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].superclass).toBe("BaseController");
      expect(result.classes[0].interfaces).toEqual(["OrderService"]);

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
    it("extracts property types and annotations", () => {
      const { tree, parser, root } = parse(`class Svc {
    @Autowired
    lateinit var client: PaymentClient
    val name: String = ""
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].typedProperties).toHaveLength(2);

      const client = result.classes[0].typedProperties!.find(
        (p) => p.name === "client",
      );
      expect(client).toBeDefined();
      expect(client!.type).toBe("PaymentClient");
      expect(client!.annotations).toEqual([{ name: "Autowired" }]);

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
    fun process() {
        validate()
        repo.save()
    }
    fun validate() {}
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
    fun run() {
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

    it("records structured metadata so overloads can be distinguished inside an owner", () => {
      const { tree, parser, root } = parse(`class UserController {
    fun load(id: String) {
        refresh()
        repo.queryUser(id)
        repo.queryUser(id, false)
    }
}
`);
      const result = extractor.extractCallGraph(root);
      const queryCalls = result.filter(
        (entry) => entry.callee === "repo.queryUser",
      );

      expect(result[0]).toMatchObject({
        caller: "load",
        callee: "refresh",
        lineNumber: 3,
        columnNumber: 9,
        methodName: "refresh",
        argumentCount: 0,
        callText: "refresh()",
        callerOwner: "UserController",
        callerQualifiedName: "UserController#load",
      });
      expect(result[0].receiver).toBeUndefined();
      expect(queryCalls).toHaveLength(2);
      expect(queryCalls.map((entry) => entry.argumentCount)).toEqual([1, 2]);
      expect(queryCalls.every((entry) => entry.receiver === "repo")).toBe(true);
      expect(queryCalls.every((entry) => entry.methodName === "queryUser")).toBe(
        true,
      );
      expect(
        queryCalls.every(
          (entry) => entry.callerQualifiedName === "UserController#load",
        ),
      ).toBe(true);
      expect(queryCalls[1]).toMatchObject({
        callText: "repo.queryUser(id, false)",
        columnNumber: 9,
      });

      tree.delete();
      parser.delete();
    });

    it("counts trailing lambda as an argument and keeps it in call text", () => {
      const { tree, parser, root } = parse(`class Svc {
    fun process() {
        repo.save(1) { done() }
    }
}
`);
      const result = extractor.extractCallGraph(root);
      const saveCall = result.find((entry) => entry.methodName === "save");

      expect(saveCall).toMatchObject({
        caller: "process",
        callee: "repo.save",
        receiver: "repo",
        methodName: "save",
        argumentCount: 2,
        callText: "repo.save(1) { done() }",
      });

      tree.delete();
      parser.delete();
    });

    it("cleans structured receiver for null-safe and non-null Kotlin calls", () => {
      const { tree, parser, root } = parse(`class Svc {
    fun process() {
        repo?.query(1)
        repo!!.query(2)
    }
}
`);
      const result = extractor.extractCallGraph(root);
      const queryCalls = result.filter((entry) => entry.methodName === "query");

      expect(queryCalls).toHaveLength(2);
      expect(queryCalls.map((entry) => entry.callee)).toEqual([
        "repo?.query",
        "repo!!.query",
      ]);
      expect(queryCalls.every((entry) => entry.receiver === "repo")).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("keeps local object calls under their own owner and leaves top-level callers unowned", () => {
      const { tree, parser, root } = parse(`fun topLevel() {
    work()
}

class Outer {
    fun outer() {
        object Local {
            fun inner() {
                nested()
            }
        }
        after()
    }
}
`);
      const result = extractor.extractCallGraph(root);
      const workCall = result.find((entry) => entry.callee === "work");

      expect(workCall).toMatchObject({
        caller: "topLevel",
        callee: "work",
        argumentCount: 0,
        callText: "work()",
      });
      expect(workCall?.callerOwner).toBeUndefined();
      expect(workCall?.callerQualifiedName).toBeUndefined();
      expect(
        result.some(
          (entry) => entry.callerQualifiedName === "Local#outer",
        ),
      ).toBe(false);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            caller: "inner",
            callee: "nested",
            callerOwner: "Local",
            callerQualifiedName: "Local#inner",
          }),
          expect.objectContaining({
            caller: "outer",
            callee: "after",
            callerOwner: "Outer",
            callerQualifiedName: "Outer#outer",
          }),
        ]),
      );

      tree.delete();
      parser.delete();
    });

    it("resolves Kotlin receiver types for fields, parameters, locals, and static-looking calls", () => {
      const { tree, parser, root } = parse(`package com.example

import com.remote.UserProfileMoaWrapperService

class QuickMessageService(
    private val constructorService: UserProfileMoaWrapperService
) {
    private val fieldService: UserProfileMoaWrapperService? = null

    fun getQuickMessage(parameterService: UserProfileMoaWrapperService) {
        fieldService?.queryUserExtend(1)
        constructorService.queryUserExtend(1, 2)
        parameterService.queryUserExtend()
        val fieldService: OtherService = OtherService()
        fieldService.queryUserExtend()
        UnknownService.queryUserExtend()
    }
}
`);
      const result = extractor.extractCallGraph(root).filter((entry) => entry.methodName === "queryUserExtend");

      expect(result).toEqual(expect.arrayContaining([
        expect.objectContaining({
          receiver: "fieldService",
          receiverType: "UserProfileMoaWrapperService",
          receiverQualifiedType: "com.remote.UserProfileMoaWrapperService",
          calleeOwner: "UserProfileMoaWrapperService",
          calleeQualifiedName: "com.remote.UserProfileMoaWrapperService#queryUserExtend",
          resolutionKind: "field",
        }),
        expect.objectContaining({
          receiver: "constructorService",
          argumentCount: 2,
          receiverType: "UserProfileMoaWrapperService",
          receiverQualifiedType: "com.remote.UserProfileMoaWrapperService",
          resolutionKind: "field",
        }),
        expect.objectContaining({
          receiver: "parameterService",
          receiverType: "UserProfileMoaWrapperService",
          receiverQualifiedType: "com.remote.UserProfileMoaWrapperService",
          resolutionKind: "parameter",
        }),
        expect.objectContaining({
          receiver: "fieldService",
          receiverType: "OtherService",
          receiverQualifiedType: "com.example.OtherService",
          calleeQualifiedName: "com.example.OtherService#queryUserExtend",
          resolutionKind: "local",
        }),
        expect.objectContaining({
          receiver: "UnknownService",
          receiverQualifiedType: "com.example.UnknownService",
          calleeQualifiedName: "com.example.UnknownService#queryUserExtend",
          resolutionKind: "static",
        }),
      ]));

      tree.delete();
      parser.delete();
    });

    it("does not resolve chained receiver expressions as static calls", () => {
      const { tree, parser, root } = parse(`package com.example

class Svc {
    fun process() {
        Factory.create().queryUserExtend()
        pkg.Factory.queryUserExtend()
    }
}
`);
      const result = extractor.extractCallGraph(root).filter((entry) => entry.methodName === "queryUserExtend");

      expect(result).toEqual(expect.arrayContaining([
        expect.objectContaining({
          receiver: "Factory.create()",
          resolutionKind: "unresolved",
        }),
        expect.objectContaining({
          receiver: "pkg.Factory",
          resolutionKind: "unresolved",
        }),
      ]));
      expect(result).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ resolutionKind: "static" }),
      ]));

      tree.delete();
      parser.delete();
    });

    it("keeps block-local receiver bindings from leaking after the block", () => {
      const { tree, parser, root } = parse(`package com.example

class ScopeService {
    private val dep: FieldDep = FieldDep()

    fun run(flag: Boolean) {
        if (flag) {
            val dep: LocalDep = LocalDep()
            dep.call()
        }
        dep.call()
    }
}
`);
      const calls = extractor.extractCallGraph(root).filter((entry) => entry.methodName === "call");

      expect(calls).toHaveLength(2);
      expect(calls[0]).toMatchObject({
        receiver: "dep",
        receiverType: "LocalDep",
        receiverQualifiedType: "com.example.LocalDep",
        calleeQualifiedName: "com.example.LocalDep#call",
        resolutionKind: "local",
      });
      expect(calls[1]).toMatchObject({
        receiver: "dep",
        receiverType: "FieldDep",
        receiverQualifiedType: "com.example.FieldDep",
        calleeQualifiedName: "com.example.FieldDep#call",
        resolutionKind: "field",
      });

      tree.delete();
      parser.delete();
    });

    it("resolves initializer receiver before binding the new local property", () => {
      const { tree, parser, root } = parse(`package com.example

class InitService {
    private val dep: FieldDep = FieldDep()

    fun run() {
        val dep: LocalDep = dep.wrap()
        dep.call()
    }
}
`);
      const result = extractor.extractCallGraph(root);
      const wrapCall = result.find((entry) => entry.methodName === "wrap");
      const call = result.find((entry) => entry.methodName === "call");

      expect(wrapCall).toMatchObject({
        receiver: "dep",
        receiverType: "FieldDep",
        receiverQualifiedType: "com.example.FieldDep",
        calleeQualifiedName: "com.example.FieldDep#wrap",
        resolutionKind: "field",
      });
      expect(call).toMatchObject({
        receiver: "dep",
        receiverType: "LocalDep",
        receiverQualifiedType: "com.example.LocalDep",
        calleeQualifiedName: "com.example.LocalDep#call",
        resolutionKind: "local",
      });

      tree.delete();
      parser.delete();
    });

    it("keeps lambda-local receiver bindings from leaking after a trailing lambda", () => {
      const { tree, parser, root } = parse(`package com.example

class LambdaService {
    private val dep: FieldDep = FieldDep()

    fun run() {
        withBlock {
            val dep: LocalDep = LocalDep()
            dep.call()
        }
        dep.call()
    }
}
`);
      const result = extractor.extractCallGraph(root);
      const withBlockCall = result.find((entry) => entry.methodName === "withBlock");
      const calls = result.filter((entry) => entry.methodName === "call");

      expect(withBlockCall).toMatchObject({
        callee: "withBlock",
        argumentCount: 1,
        callText: expect.stringContaining("withBlock"),
      });
      expect(calls).toHaveLength(2);
      expect(calls[0]).toMatchObject({
        receiver: "dep",
        receiverType: "LocalDep",
        receiverQualifiedType: "com.example.LocalDep",
        calleeQualifiedName: "com.example.LocalDep#call",
        resolutionKind: "local",
      });
      expect(calls[1]).toMatchObject({
        receiver: "dep",
        receiverType: "FieldDep",
        receiverQualifiedType: "com.example.FieldDep",
        calleeQualifiedName: "com.example.FieldDep#call",
        resolutionKind: "field",
      });

      tree.delete();
      parser.delete();
    });
  });

  // ---- HTTP Endpoint Extraction ----

  describe("extractStructure - HTTP endpoint annotations", () => {
    it("extracts Retrofit-style @GET and @POST from interface", () => {
      const { tree, parser, root } = parse(`
interface UserApiService {
    @GET("/api/users")
    suspend fun getUsers(): List<User>

    @POST("/api/users")
    suspend fun createUser(@Body request: UserRequest): User

    @DELETE("/api/users/{id}")
    suspend fun deleteUser(@Path("id") id: String)
}
`);
      const result = extractor.extractStructure(root);

      expect(result.endpoints).toBeDefined();
      expect(result.endpoints).toHaveLength(3);
      expect(result.endpoints![0]).toMatchObject({ method: "GET", path: "/api/users" });
      expect(result.endpoints![1]).toMatchObject({ method: "POST", path: "/api/users" });
      expect(result.endpoints![2]).toMatchObject({ method: "DELETE", path: "/api/users/{id}" });

      tree.delete();
      parser.delete();
    });

    it("extracts Spring @GetMapping/@PostMapping with base path", () => {
      const { tree, parser, root } = parse(`
@RestController
@RequestMapping("/api/orders")
class OrderController {
    @GetMapping("/list")
    fun listOrders(): List<Order> = emptyList()

    @PostMapping("/create")
    fun createOrder(@RequestBody dto: OrderDTO): Order = Order()
}
`);
      const result = extractor.extractStructure(root);

      expect(result.endpoints).toBeDefined();
      expect(result.endpoints).toHaveLength(2);
      expect(result.endpoints![0]).toMatchObject({ method: "GET", path: "/api/orders/list" });
      expect(result.endpoints![1]).toMatchObject({ method: "POST", path: "/api/orders/create" });

      tree.delete();
      parser.delete();
    });

    it("returns no endpoints when no HTTP annotations present", () => {
      const { tree, parser, root } = parse(`
class PlainService {
    fun doSomething() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.endpoints).toBeUndefined();

      tree.delete();
      parser.delete();
    });
  });
});

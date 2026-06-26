import { describe, expect, it } from "vitest"
import {
  getCallgraphMatchMode,
  matchesCallgraphEntry,
  parseCallQuery,
  projectCallgraphResult,
} from "../structure-callgraph"

describe("callgraph query parsing", () => {
  it("parses method, receiver.method, Class#method, and FQN#method", () => {
    expect(parseCallQuery("queryUserExtend")).toEqual({ kind: "method", methodName: "queryUserExtend" })
    expect(parseCallQuery("wrapper.queryUserExtend")).toEqual({
      kind: "receiverMethod",
      receiver: "wrapper",
      methodName: "queryUserExtend",
    })
    expect(parseCallQuery("UserProfileMoaWrapperService#queryUserExtend")).toEqual({
      kind: "ownerMethod",
      ownerClass: "UserProfileMoaWrapperService",
      methodName: "queryUserExtend",
    })
    expect(parseCallQuery("com.example.UserProfileMoaWrapperService#queryUserExtend")).toEqual({
      kind: "ownerMethod",
      ownerClass: "UserProfileMoaWrapperService",
      methodName: "queryUserExtend",
    })
  })
})

describe("callgraph exact matching", () => {
  it("matches a plain method name exactly against receiver.method fallback", () => {
    expect(matchesCallgraphEntry(
      { caller: "getQuickMessage", callee: "userProfileMoaWrapperService.queryUserExtend", lineNumber: 318 },
      { callee: "queryUserExtend", exact: true },
    )).toBe(true)
  })

  it("does not match longer method names in exact mode", () => {
    expect(matchesCallgraphEntry(
      { caller: "getQuickMessage", callee: "userProfileMoaWrapperService.queryUserExtendList", lineNumber: 318 },
      { callee: "queryUserExtend", exact: true },
    )).toBe(false)
  })

  it("uses the rightmost separator when extracting fallback method names", () => {
    expect(matchesCallgraphEntry(
      { caller: "getQuickMessage", callee: "UserProfileMoaWrapperService#service.queryUserExtend", lineNumber: 318 },
      { callee: "queryUserExtend", exact: true },
    )).toBe(true)
  })

  it("matches receiver.method exactly", () => {
    expect(matchesCallgraphEntry(
      { caller: "getQuickMessage", callee: "userProfileMoaWrapperService.queryUserExtend", lineNumber: 318 },
      { callee: "userProfileMoaWrapperService.queryUserExtend", exact: true },
    )).toBe(true)
  })

  it("matches arrow receiver calls by method name and receiver.method exactly", () => {
    expect(matchesCallgraphEntry(
      { caller: "getQuickMessage", callee: "service->queryUserExtend", lineNumber: 318 },
      { callee: "queryUserExtend", exact: true },
    )).toBe(true)
    expect(matchesCallgraphEntry(
      { caller: "getQuickMessage", callee: "service->queryUserExtend", lineNumber: 318 },
      { callee: "service->queryUserExtend", exact: true },
    )).toBe(true)
  })

  it("matches double-colon receiver calls by method name and receiver.method exactly", () => {
    expect(matchesCallgraphEntry(
      { caller: "getQuickMessage", callee: "Service::queryUserExtend", lineNumber: 318 },
      { callee: "queryUserExtend", exact: true },
    )).toBe(true)
    expect(matchesCallgraphEntry(
      { caller: "getQuickMessage", callee: "Service::queryUserExtend", lineNumber: 318 },
      { callee: "Service::queryUserExtend", exact: true },
    )).toBe(true)
  })

  it("matches Class#method through lower-camel receiver heuristic", () => {
    expect(matchesCallgraphEntry(
      { caller: "getQuickMessage", callee: "userProfileMoaWrapperService.queryUserExtend", lineNumber: 318 },
      { callee: "com.example.UserProfileMoaWrapperService#queryUserExtend", exact: true },
    )).toBe(true)
  })

  it("rejects malformed owner-method callee queries", () => {
    const entry = { caller: "x", callee: "example.queryUserExtend", lineNumber: 1 }

    expect(matchesCallgraphEntry(entry, { callee: "#queryUserExtend", exact: true })).toBe(false)
    expect(matchesCallgraphEntry(entry, { callee: "UserProfileMoaWrapperService#", exact: true })).toBe(false)
    expect(matchesCallgraphEntry(entry, { callee: "com.example.#queryUserExtend", exact: true })).toBe(false)
    expect(matchesCallgraphEntry(entry, { callee: "Foo#bar#baz", exact: true })).toBe(false)
  })

  it("matches caller owner only when structured callerQualifiedName exists", () => {
    expect(matchesCallgraphEntry(
      {
        caller: "process",
        callerOwner: "OrderService",
        callerQualifiedName: "OrderService#process",
        callee: "repo.save",
        lineNumber: 42,
      },
      { caller: "OrderService#process", exact: true },
    )).toBe(true)
    expect(matchesCallgraphEntry(
      { caller: "process", callee: "repo.save", lineNumber: 42 },
      { caller: "OrderService#process", exact: true },
    )).toBe(false)
  })

  it("filters by argument count only when structured count exists", () => {
    expect(matchesCallgraphEntry(
      { caller: "process", callee: "repo.save", methodName: "save", argumentCount: 1, lineNumber: 42 },
      { callee: "save", exact: true, argc: 1 },
    )).toBe(true)
    expect(matchesCallgraphEntry(
      { caller: "process", callee: "repo.save", methodName: "save", lineNumber: 42 },
      { callee: "save", exact: true, argc: 1 },
    )).toBe(false)
  })

  it("keeps substring behavior when exact is false", () => {
    expect(matchesCallgraphEntry(
      { caller: "processOrder", callee: "repo.queryUserExtendList", lineNumber: 42 },
      { callee: "queryUserExtend", exact: false },
    )).toBe(true)
  })
})

describe("callgraph result projection", () => {
  it("preserves structured optional fields", () => {
    expect(projectCallgraphResult("src/OrderService.java", {
      caller: "process",
      callerOwner: "OrderService",
      callerQualifiedName: "OrderService#process",
      callee: "repo.save",
      receiver: "repo",
      methodName: "save",
      argumentCount: 1,
      callText: "repo.save(order)",
      lineNumber: 42,
      columnNumber: 12,
    })).toEqual({
      filePath: "src/OrderService.java",
      caller: "process",
      callerOwner: "OrderService",
      callerQualifiedName: "OrderService#process",
      callee: "repo.save",
      receiver: "repo",
      methodName: "save",
      argumentCount: 1,
      callText: "repo.save(order)",
      lineNumber: 42,
      columnNumber: 12,
    })
  })

  it("omits optional keys when structured optional fields are absent", () => {
    expect(projectCallgraphResult("src/OrderService.java", {
      caller: "process",
      callee: "repo.save",
      lineNumber: 42,
    })).toEqual({
      filePath: "src/OrderService.java",
      caller: "process",
      callee: "repo.save",
      lineNumber: 42,
    })
  })
})

describe("callgraph match mode", () => {
  it("reports match mode for caller and callee query forms", () => {
    expect(getCallgraphMatchMode({ callee: "queryUserExtend", exact: true })).toBe("exact-method")
    expect(getCallgraphMatchMode({ callee: "wrapper.queryUserExtend", exact: true })).toBe("exact-receiver")
    expect(getCallgraphMatchMode({ callee: "UserProfileMoaWrapperService#queryUserExtend", exact: true })).toBe("exact-owner-heuristic")
    expect(getCallgraphMatchMode({ caller: "OrderService#process", exact: true })).toBe("exact-caller-owner")
    expect(getCallgraphMatchMode({ caller: "process", exact: true })).toBe("exact-caller")
    expect(getCallgraphMatchMode({ callee: "query", exact: false })).toBe("substring")
  })
})

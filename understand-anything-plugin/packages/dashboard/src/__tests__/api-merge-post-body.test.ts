import { describe, it, expect } from "vitest"
import { mergePostBody } from "../api/utils"

describe("mergePostBody", () => {
  it("merges body keys into searchParams as strings", () => {
    const sp = new URLSearchParams()
    mergePostBody(sp, { file: "A.java", start: 10 })
    expect(sp.get("file")).toBe("A.java")
    expect(sp.get("start")).toBe("10")
  })
  it("body overrides existing query keys", () => {
    const sp = new URLSearchParams("q=old")
    mergePostBody(sp, { q: "new" })
    expect(sp.get("q")).toBe("new")
  })
  it("skips null/undefined and ignores non-object body", () => {
    const sp = new URLSearchParams("q=keep")
    mergePostBody(sp, { a: null, b: undefined })
    mergePostBody(sp, "not-an-object")
    expect(sp.get("a")).toBeNull()
    expect(sp.get("q")).toBe("keep")
  })
  it("array body is a no-op — searchParams unchanged", () => {
    const sp = new URLSearchParams("q=keep")
    mergePostBody(sp, ["foo", "bar"])
    expect(sp.get("q")).toBe("keep")
    expect(sp.get("0")).toBeNull()
  })
})

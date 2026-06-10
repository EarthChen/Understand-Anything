import { describe, it, expect } from "vitest"
import { validateServiceName, validateServiceNameRequired } from "../api/service-resolver"

describe("service-resolver", () => {
  it("validates service name rejects traversal", () => {
    expect(validateServiceName("../etc")).not.toBeNull()
    expect(validateServiceName("foo\\bar")).not.toBeNull()
  })
  it("validates service name allows valid names", () => {
    expect(validateServiceName("order-service")).toBeNull()
    expect(validateServiceName(null)).toBeNull()
  })
  it("required version rejects null", () => {
    expect(validateServiceNameRequired(null)).not.toBeNull()
  })
})

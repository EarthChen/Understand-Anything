import { describe, it, expect, vi } from "vitest"
import request from "supertest"

vi.mock("../api/index", () => ({
  createApiRouter: () => ({
    handle: async () => {
      throw new Error("Simulated handler crash")
    },
  }),
}))

import { createApp } from "../../server"

describe("Express middleware error handling", () => {
  it("returns 500 JSON when router.handle throws", async () => {
    const app = createApp({ projectRoot: "/tmp" })
    const res = await request(app).get("/api/wiki")
    expect(res.status).toBe(500)
    expect(res.headers["content-type"]).toMatch(/application\/json/)
    expect(res.body).toEqual({ error: "Internal server error" })
  })
})

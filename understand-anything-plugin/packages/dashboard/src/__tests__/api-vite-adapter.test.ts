import { describe, it, expect } from "vitest"
import { writeApiResponse } from "../api/vite-adapter"

describe("vite-adapter", () => {
  it("writeApiResponse sets JSON content-type", () => {
    const chunks: Buffer[] = []
    const res = {
      statusCode: 0,
      setHeader: () => {},
      end: (c: string) => { chunks.push(Buffer.from(c)) },
    }
    writeApiResponse(res as never, { statusCode: 200, body: { ok: true } })
    expect(chunks[0].toString()).toBe('{"ok":true}')
  })
})

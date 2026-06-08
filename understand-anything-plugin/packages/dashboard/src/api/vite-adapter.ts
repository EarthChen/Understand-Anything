import type { ServerResponse } from "http"
import type { ApiResponse } from "./types"

export function writeApiResponse(res: ServerResponse, apiRes: ApiResponse): void {
  res.statusCode = apiRes.statusCode
  if (apiRes.headers) {
    for (const [k, v] of Object.entries(apiRes.headers)) res.setHeader(k, v)
  }
  res.setHeader("Content-Type", "application/json")
  res.end(JSON.stringify(apiRes.body))
}

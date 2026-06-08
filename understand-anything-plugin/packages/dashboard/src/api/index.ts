import type { ApiRequest, ApiContext, ApiResponse, ApiRouter } from "./types"
import { isProtectedPath, validateToken } from "./handlers/auth"
import { handleGraphRequest } from "./handlers/graph"
import { handleWikiRequest } from "./handlers/wiki"
import { handleSourceRequest } from "./handlers/source"
import { handleBusinessRequest } from "./handlers/business"

const HANDLERS = [
  handleBusinessRequest,
  handleWikiRequest,
  handleSourceRequest,
  handleGraphRequest,
]

export function createApiRouter(): ApiRouter {
  return {
    async handle(req: ApiRequest, ctx: ApiContext): Promise<ApiResponse | null> {
      if (isProtectedPath(req.pathname)) {
        const authError = validateToken(req.searchParams, ctx.accessToken)
        if (authError) return authError
      }
      for (const handler of HANDLERS) {
        const res = await handler(req, ctx)
        if (res !== null) return res
      }
      return null
    },
  }
}

export { isProtectedPath, validateToken } from "./handlers/auth"
export type { ApiRequest, ApiResponse, ApiContext } from "./types"

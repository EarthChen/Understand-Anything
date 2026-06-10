import type { WikiDataService } from "../../wiki-api"

export interface ApiRequest {
  pathname: string
  searchParams: URLSearchParams
}

export interface ApiResponse {
  statusCode: number
  body: unknown
  headers?: Record<string, string>
}

export interface ApiContext {
  getWikiService: () => WikiDataService
}

export type ApiHandler = (
  req: ApiRequest,
  ctx: ApiContext,
) => Promise<ApiResponse> | ApiResponse

export interface ApiRouter {
  handle(req: ApiRequest, ctx: ApiContext): Promise<ApiResponse | null>
}

export interface ApiErrorBody {
  error: string
  code?: string
  suggestions?: Array<{ id: string; name: string; type: string }>
}

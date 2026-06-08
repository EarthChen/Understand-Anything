import type { ApiResponse } from "../types"

const PROTECTED_PREFIXES = ["/wiki/", "/api/wiki"]
const PROTECTED_EXACT = new Set([
  "/knowledge-graph.json",
  "/domain-graph.json",
  "/system-graph.json",
  "/diff-overlay.json",
  "/meta.json",
  "/config.json",
  "/api/source",
  "/api/graph",
  "/api/business/domains",
  "/api/business/cross-facet-links",
  "/api/business/overview",
  "/api/business/search",
])

export function isProtectedPath(pathname: string): boolean {
  if (PROTECTED_EXACT.has(pathname)) return true
  if (PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) return true
  if (pathname.startsWith("/api/business/domains/")) return true
  return false
}

export function validateToken(
  searchParams: URLSearchParams,
  accessToken: string,
): ApiResponse | null {
  if (searchParams.get("token") !== accessToken) {
    return { statusCode: 403, body: { error: "Forbidden: missing or invalid token" } }
  }
  return null
}

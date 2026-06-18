import { describe, it, expect } from "vitest"
import type { EdgeType } from "@understand-anything/core/types"
import { locales, type LocaleKey } from "../locales"

// Exhaustive list of every EdgeType member. The `Record<EdgeType, true>` below is
// a compile-time exhaustiveness guard: if a new EdgeType is added to core, this
// object will fail to typecheck until the new member is listed here, keeping the
// test honest about what "all edge types" means.
const EDGE_TYPE_PRESENCE = {
  imports: true, exports: true, contains: true, inherits: true, implements: true,
  calls: true, subscribes: true, publishes: true, middleware: true,
  provides_rpc: true, consumes_rpc: true,
  provides_route: true, consumes_route: true,
  provides_api: true, consumes_api: true,
  injects: true, navigates_to: true,
  reads_from: true, writes_to: true, transforms: true, validates: true,
  depends_on: true, tested_by: true, configures: true,
  related: true, similar_to: true,
  deploys: true, serves: true, provisions: true, triggers: true,
  migrates: true, documents: true, routes: true, defines_schema: true,
  contains_flow: true, flow_step: true, cross_domain: true,
  cites: true, contradicts: true, builds_on: true, exemplifies: true,
  categorized_under: true, authored_by: true,
} satisfies Record<EdgeType, true>

const ALL_EDGE_TYPES = Object.keys(EDGE_TYPE_PRESENCE) as EdgeType[]
const LOCALE_KEYS = Object.keys(locales) as LocaleKey[]

describe("locale edgeLabels coverage", () => {
  // NodeInfo's getDirectionalLabel does `t.edgeLabels[edgeType]`. A missing key
  // means an edge of that type renders with a generic fallback label instead of
  // the proper localized text — a silent runtime bug.
  for (const key of LOCALE_KEYS) {
    it(`"${key}" defines a forward/backward label for every EdgeType`, () => {
      const labels = locales[key].edgeLabels as Record<string, { forward: string; backward: string }>
      const missing = ALL_EDGE_TYPES.filter((edgeType) => labels[edgeType] === undefined)
      expect(missing).toEqual([])
      for (const edgeType of ALL_EDGE_TYPES) {
        expect(typeof labels[edgeType].forward).toBe("string")
        expect(typeof labels[edgeType].backward).toBe("string")
      }
    })
  }
})

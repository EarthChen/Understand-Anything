import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import BusinessGraphView from "../components/BusinessGraphView"
import { useBusinessStore } from "../stores/businessStore"

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ children, nodes }: any) => (
    <div data-testid="react-flow">
      {nodes?.map((n: any) => (
        <div key={n.id} data-testid={`node-${n.id}`}>
          {n.data.label}
        </div>
      ))}
      {children}
    </div>
  ),
  ReactFlowProvider: ({ children }: any) => <>{children}</>,
  Background: () => null,
  Controls: () => null,
  BaseEdge: () => null,
  EdgeLabelRenderer: ({ children }: any) => <>{children}</>,
  getBezierPath: () => ["", 0, 0],
}))

const mockDomain = {
  id: "domain:order",
  name: "Order Management",
  slug: "order",
  summary: "Orders",
  facets: { server: { services: ["order-service"] }, client: {} },
  interactions: [],
  businessRules: [],
}

describe("BusinessGraphView", () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ links: [] }),
    }))
    useBusinessStore.setState({
      available: true,
      domains: [mockDomain],
      crossFacetLinks: [],
      selectedDomainId: null,
      domainDetail: {},
      isLoading: false,
      error: null,
      facetFilter: null,
      searchQuery: "",
    } as any)
    vi.restoreAllMocks()
  })

  it("renders domain nodes", () => {
    render(<BusinessGraphView />)
    expect(screen.getByText("Order Management")).toBeInTheDocument()
  })

  it("shows facet filter buttons", () => {
    render(<BusinessGraphView />)
    expect(screen.getByText("server")).toBeInTheDocument()
    expect(screen.getByText("client")).toBeInTheDocument()
  })

  it("renders business-graph-view testid", () => {
    render(<BusinessGraphView />)
    expect(screen.getByTestId("business-graph-view")).toBeInTheDocument()
  })
})

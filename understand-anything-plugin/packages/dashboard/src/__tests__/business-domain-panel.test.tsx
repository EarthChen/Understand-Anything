import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import BusinessDomainPanel from "../components/BusinessDomainPanel"
import { useBusinessStore } from "../stores/businessStore"

const detail = {
  id: "domain:order",
  name: "Order Management",
  summary: "Orders",
  interactions: [{
    id: "flow:create",
    name: "Create Order",
    steps: [
      { id: "s1", facet: "server", description: "Validate cart", terminal: false },
      { id: "s2", facet: "client", description: "Show confirmation", terminal: true },
    ],
  }],
  businessRules: [{ id: "r1", rule: "Cart must not be empty", enforcedBy: ["s1"] }],
  facets: { server: { services: ["order-service"] }, client: { features: ["checkout"] } },
}

describe("BusinessDomainPanel", () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    useBusinessStore.setState({
      domainDetail: { "domain:order": detail },
      selectedDomainId: "domain:order",
    } as any)
  })

  it("renders interactions and rules", () => {
    render(<BusinessDomainPanel domainId="domain:order" />)
    expect(screen.getByText("Create Order")).toBeInTheDocument()
    expect(screen.getByText(/Cart must not be empty/)).toBeInTheDocument()
  })

  it("shows interaction steps", () => {
    render(<BusinessDomainPanel domainId="domain:order" />)
    expect(screen.getByText("Validate cart")).toBeInTheDocument()
    expect(screen.getByText("Show confirmation")).toBeInTheDocument()
  })

  it("shows cross-mode navigation buttons", () => {
    render(<BusinessDomainPanel domainId="domain:order" />)
    expect(screen.getByTestId("nav-system-order-service")).toBeInTheDocument()
  })

  it("returns null when detail is missing", () => {
    useBusinessStore.setState({ domainDetail: {} } as any)
    const { container } = render(<BusinessDomainPanel domainId="domain:missing" />)
    expect(container.innerHTML).toBe("")
  })
})

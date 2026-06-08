import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useBusinessStore } from "../stores/businessStore";

const mockLocation = {
  origin: "http://localhost:5173",
  search: "?token=test-token",
};

const mockDomainIndex = {
  domains: [
    {
      id: "domain:order",
      name: "Order Management",
      summary: "下单流程",
      facets: ["server", "client"],
      detailRef: "business-landscape/domains/order.json",
    },
  ],
  stats: { totalDomains: 1, mappedDomains: 1, unmappedDomains: 0, coverageRate: 1 },
};

const mockDomainDetail = {
  id: "domain:order",
  name: "Order Management",
  summary: "下单流程",
  interactions: [{ id: "flow:create", name: "Create Order", steps: [] }],
  businessRules: [{ id: "r1", rule: "must have items", enforcedBy: ["s1"] }],
  facets: { server: { services: ["order-service"] } },
};

function resetStore() {
  useBusinessStore.setState({
    viewMode: "knowledge",
    available: false,
    domains: [],
    selectedDomainSlug: null,
    selectedDomain: null,
    selectedDomainId: null,
    domainDetail: {},
    crossFacetLinks: [],
    overview: null,
    searchQuery: "",
    searchResults: [],
    isLoading: false,
    error: null,
    facetFilter: null,
  });
}

describe("useBusinessStore", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { location: { ...mockLocation } });
    resetStore();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has correct initial state", () => {
    const state = useBusinessStore.getState();
    expect(state.viewMode).toBe("knowledge");
    expect(state.available).toBe(false);
    expect(state.domains).toEqual([]);
    expect(state.selectedDomainSlug).toBeNull();
    expect(state.selectedDomain).toBeNull();
    expect(state.selectedDomainId).toBeNull();
    expect(state.crossFacetLinks).toEqual([]);
    expect(state.overview).toBeNull();
    expect(state.searchQuery).toBe("");
    expect(state.searchResults).toEqual([]);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.facetFilter).toBeNull();
  });

  it("setViewMode updates viewMode", () => {
    useBusinessStore.getState().setViewMode("business");
    expect(useBusinessStore.getState().viewMode).toBe("business");
    useBusinessStore.getState().setViewMode("knowledge");
    expect(useBusinessStore.getState().viewMode).toBe("knowledge");
  });

  it("fetchDomains loads domains from API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockDomainIndex,
    });
    vi.stubGlobal("fetch", fetchMock);

    await useBusinessStore.getState().fetchDomains();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5173/api/business/domains?token=test-token",
    );
    const state = useBusinessStore.getState();
    expect(state.domains).toHaveLength(1);
    expect(state.domains[0].id).toBe("domain:order");
    expect(state.domains[0].slug).toBe("order");
    expect(state.available).toBe(true);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("selectDomain fetches detail and updates selection", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockDomainDetail,
    });
    vi.stubGlobal("fetch", fetchMock);

    await useBusinessStore.getState().selectDomain("order");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5173/api/business/domains/order?token=test-token",
    );
    const state = useBusinessStore.getState();
    expect(state.selectedDomainSlug).toBe("order");
    expect(state.selectedDomain?.id).toBe("domain:order");
    expect(state.selectedDomain?.interactions).toHaveLength(1);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("sets error when fetch fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "server error" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await useBusinessStore.getState().fetchDomains();

    const state = useBusinessStore.getState();
    expect(state.error).toBeTruthy();
    expect(state.isLoading).toBe(false);
    expect(state.domains).toEqual([]);
  });

  it("search updates searchQuery and searchResults", async () => {
    const searchResults = [{ id: "domain:order", name: "Order Management", match: "下单流程" }];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: searchResults }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await useBusinessStore.getState().search("下单");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5173/api/business/search?token=test-token&q=%E4%B8%8B%E5%8D%95",
    );
    const state = useBusinessStore.getState();
    expect(state.searchQuery).toBe("下单");
    expect(state.searchResults).toEqual(searchResults);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });
});

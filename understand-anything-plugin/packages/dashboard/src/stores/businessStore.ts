import { create } from "zustand";

export type ViewMode = "knowledge" | "business";

export interface BusinessDomain {
  id: string;
  name: string;
  slug: string;
  summary: string;
  facets: Record<string, unknown>;
  interactions: unknown[];
  businessRules: unknown[];
}

export interface CrossFacetLink {
  source: string;
  target: string;
  label: string;
  facet: string;
}

export interface BusinessOverview {
  totalDomains: number;
  totalInteractions: number;
  totalRules: number;
  facetDistribution: Record<string, number>;
}

export interface BusinessDomainDetail {
  id: string;
  name: string;
  summary: string;
  interactions: Array<{
    id: string;
    name: string;
    steps: Array<{
      id: string;
      facet: string;
      description: string;
      terminal?: boolean;
      branches?: unknown[];
      parallel?: unknown[];
    }>;
  }>;
  businessRules: Array<{ id: string; rule: string; enforcedBy: string[] }>;
  facets: Record<string, unknown>;
}

interface BusinessState {
  viewMode: ViewMode;
  available: boolean;
  domains: BusinessDomain[];
  selectedDomainSlug: string | null;
  selectedDomain: BusinessDomain | null;
  selectedDomainId: string | null;
  domainDetail: Record<string, BusinessDomainDetail>;
  crossFacetLinks: CrossFacetLink[];
  overview: BusinessOverview | null;
  searchQuery: string;
  searchResults: unknown[];
  isLoading: boolean;
  error: string | null;
  facetFilter: string | null;

  setViewMode: (mode: ViewMode) => void;
  fetchDomains: () => Promise<void>;
  selectDomain: (slug: string) => Promise<void>;
  clearSelection: () => void;
  fetchDomainDetail: (slug: string) => Promise<void>;
  fetchCrossFacetLinks: () => Promise<void>;
  fetchOverview: () => Promise<void>;
  search: (query: string) => Promise<void>;
  setFacetFilter: (facet: string | null) => void;
  setSearchQuery: (q: string) => void;
}

function slugFromDetailRef(detailRef: unknown): string | null {
  if (typeof detailRef !== "string") return null;
  const match = detailRef.match(/\/([^/]+)\.json$/);
  return match ? match[1] : null;
}

function slugFromId(id: string): string {
  const colon = id.lastIndexOf(":");
  return colon >= 0 ? id.slice(colon + 1) : id;
}

function toBusinessDomain(raw: Record<string, unknown>, slugOverride?: string): BusinessDomain {
  const id = String(raw.id ?? "");
  const slug =
    slugOverride ??
    (typeof raw.slug === "string" ? raw.slug : null) ??
    slugFromDetailRef(raw.detailRef) ??
    slugFromId(id);

  const facets =
    raw.facets != null &&
    typeof raw.facets === "object" &&
    !Array.isArray(raw.facets)
      ? (raw.facets as Record<string, unknown>)
      : {};

  return {
    id,
    name: String(raw.name ?? ""),
    slug,
    summary: String(raw.summary ?? ""),
    facets,
    interactions: Array.isArray(raw.interactions) ? raw.interactions : [],
    businessRules: Array.isArray(raw.businessRules) ? raw.businessRules : [],
  };
}

function toCrossFacetLinks(raw: unknown): CrossFacetLink[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => item != null && typeof item === "object")
    .map((item) => ({
      source: String(item.source ?? item.domain ?? ""),
      target: String(item.target ?? ""),
      label: String(item.label ?? ""),
      facet: String(item.facet ?? ""),
    }));
}

function toOverview(data: Record<string, unknown>): BusinessOverview {
  const stats =
    data.stats != null && typeof data.stats === "object"
      ? (data.stats as Record<string, number>)
      : {};

  const facetDistribution: Record<string, number> = {};
  if (Array.isArray(data.facets)) {
    for (const facet of data.facets) {
      const key = String(facet);
      facetDistribution[key] = (facetDistribution[key] ?? 0) + 1;
    }
  }

  return {
    totalDomains: Number(data.domainCount ?? stats.totalDomains ?? 0),
    totalInteractions: Number(stats.totalInteractions ?? 0),
    totalRules: Number(stats.totalRules ?? 0),
    facetDistribution,
  };
}

function businessApiUrl(pathname: string, extraParams?: Record<string, string>): string {
  const url = new URL(pathname, window.location.origin);
  const token = new URLSearchParams(window.location.search).get("token");
  if (token) {
    url.searchParams.set("token", token);
  }
  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export const useBusinessStore = create<BusinessState>()((set) => ({
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

  setViewMode: (mode) => set({ viewMode: mode }),

  fetchDomains: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(businessApiUrl("/api/business/domains"));
      if (!res.ok) {
        throw new Error(`Failed to fetch domains: ${res.status}`);
      }
      const data = (await res.json()) as { domains?: Record<string, unknown>[] };
      const domains = (data.domains ?? []).map((item) => toBusinessDomain(item));
      set({ domains, available: domains.length > 0, isLoading: false });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : String(e),
        isLoading: false,
        available: false,
      });
    }
  },

  selectDomain: async (slug) => {
    const domainId = `domain:${slug}`;
    set({ isLoading: true, error: null, selectedDomainSlug: slug, selectedDomainId: domainId });
    try {
      const res = await fetch(
        businessApiUrl(`/api/business/domains/${encodeURIComponent(slug)}`),
      );
      if (!res.ok) {
        throw new Error(`Failed to fetch domain: ${res.status}`);
      }
      const data = (await res.json()) as Record<string, unknown>;
      const domain = toBusinessDomain(data, slug);
      const detail: BusinessDomainDetail = {
        id: domain.id,
        name: domain.name,
        summary: domain.summary,
        interactions: Array.isArray(data.interactions)
          ? (data.interactions as BusinessDomainDetail["interactions"])
          : [],
        businessRules: Array.isArray(data.businessRules)
          ? (data.businessRules as BusinessDomainDetail["businessRules"])
          : [],
        facets: domain.facets,
      };
      set((s) => ({
        selectedDomain: domain,
        domainDetail: { ...s.domainDetail, [domain.id]: detail },
        isLoading: false,
      }));
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : String(e),
        isLoading: false,
        selectedDomain: null,
      });
    }
  },

  clearSelection: () => set({ selectedDomainSlug: null, selectedDomain: null, selectedDomainId: null }),

  fetchDomainDetail: async (slug) => {
    try {
      const res = await fetch(
        businessApiUrl(`/api/business/domains/${encodeURIComponent(slug)}`),
      );
      if (!res.ok) return;
      const data = (await res.json()) as Record<string, unknown>;
      const domain = toBusinessDomain(data, slug);
      const detail: BusinessDomainDetail = {
        id: domain.id,
        name: domain.name,
        summary: domain.summary,
        interactions: Array.isArray(data.interactions)
          ? (data.interactions as BusinessDomainDetail["interactions"])
          : [],
        businessRules: Array.isArray(data.businessRules)
          ? (data.businessRules as BusinessDomainDetail["businessRules"])
          : [],
        facets: domain.facets,
      };
      set((s) => ({ domainDetail: { ...s.domainDetail, [domain.id]: detail } }));
    } catch {
      // silently degrade
    }
  },

  fetchCrossFacetLinks: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(businessApiUrl("/api/business/cross-facet-links"));
      if (!res.ok) {
        throw new Error(`Failed to fetch cross-facet links: ${res.status}`);
      }
      const data = (await res.json()) as { links?: unknown };
      set({ crossFacetLinks: toCrossFacetLinks(data.links), isLoading: false });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : String(e),
        isLoading: false,
      });
    }
  },

  fetchOverview: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(businessApiUrl("/api/business/overview"));
      if (!res.ok) {
        throw new Error(`Failed to fetch overview: ${res.status}`);
      }
      const data = (await res.json()) as Record<string, unknown>;
      set({ overview: toOverview(data), isLoading: false });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : String(e),
        isLoading: false,
      });
    }
  },

  search: async (query) => {
    set({ isLoading: true, error: null, searchQuery: query });
    try {
      const res = await fetch(businessApiUrl("/api/business/search", { q: query }));
      if (!res.ok) {
        throw new Error(`Failed to search: ${res.status}`);
      }
      const data = (await res.json()) as { results?: unknown[] };
      set({ searchResults: data.results ?? [], isLoading: false });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : String(e),
        isLoading: false,
        searchResults: [],
      });
    }
  },

  setFacetFilter: (facet) => set({ facetFilter: facet }),

  setSearchQuery: (q) => set({ searchQuery: q }),
}));

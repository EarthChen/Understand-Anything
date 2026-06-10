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
  domain: string;
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

  let facets: Record<string, unknown> = {};
  if (raw.facets != null) {
    if (Array.isArray(raw.facets)) {
      for (const f of raw.facets) {
        if (typeof f === "string") facets[f] = true;
      }
    } else if (typeof raw.facets === "object") {
      facets = raw.facets as Record<string, unknown>;
    }
  }

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
  const links: CrossFacetLink[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (rec.domain && (Array.isArray(rec.serverEndpoints) || Array.isArray(rec.clientApiCalls))) {
      const domain = String(rec.domain);
      const serverEps = Array.isArray(rec.serverEndpoints) ? rec.serverEndpoints : [];
      const clientCalls = Array.isArray(rec.clientApiCalls) ? rec.clientApiCalls : [];
      for (const ep of serverEps) {
        const epName =
          typeof ep === "object" && ep !== null
            ? String((ep as Record<string, unknown>).path ?? (ep as Record<string, unknown>).name ?? ep)
            : String(ep);
        for (const call of clientCalls) {
          const callName =
            typeof call === "object" && call !== null
              ? String((call as Record<string, unknown>).path ?? (call as Record<string, unknown>).name ?? call)
              : String(call);
          links.push({
            source: `server:${epName}`,
            target: `client:${callName}`,
            label: `${epName} ↔ ${callName}`,
            domain,
          });
        }
      }
      if (serverEps.length === 0 && clientCalls.length === 0) {
        links.push({ source: domain, target: domain, label: domain, domain });
      }
    } else {
      links.push({
        source: String(rec.source ?? rec.domain ?? ""),
        target: String(rec.target ?? ""),
        label: String(rec.label ?? ""),
        domain: String(rec.domain ?? rec.facet ?? ""),
      });
    }
  }
  return links;
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
      const data = (await res.json()) as { domains?: Record<string, unknown>[]; unmapped?: unknown[]; stats?: Record<string, number> };
      const domains = (data.domains ?? []).map((item) => toBusinessDomain(item));
      const hasContent = domains.length > 0 || (Array.isArray(data.unmapped) && data.unmapped.length > 0) || (data.stats?.totalDomains ?? 0) > 0;
      set({ domains, available: hasContent, isLoading: false });
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
    // Find basic info from already-loaded domains list
    const currentDomains = useBusinessStore.getState().domains;
    const basicDomain = currentDomains.find(d => d.slug === slug || d.id === domainId);
    set({ isLoading: true, error: null, selectedDomainSlug: slug, selectedDomainId: domainId, selectedDomain: basicDomain ?? null });
    try {
      const res = await fetch(
        businessApiUrl(`/api/business/domains/${encodeURIComponent(slug)}`),
      );
      if (!res.ok) {
        // Detail file not generated yet — keep basic domain info visible
        set({ isLoading: false, error: null });
        return;
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
        selectedDomainId: domain.id,
        domainDetail: { ...s.domainDetail, [domain.id]: detail },
        isLoading: false,
      }));
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : String(e),
        isLoading: false,
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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { detectBusinessAvailability } from "../utils/businessMode";

describe("business mode detection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("detectBusinessAvailability returns true when domains endpoint succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ domains: [{ id: "domain:x", name: "X", summary: "", facets: [], matchType: "manual", matchConfidence: 1, detailRef: "" }] }),
    }));
    const ok = await detectBusinessAvailability();
    expect(ok).toBe(true);
  });

  it("calls fetch without token parameter", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ domains: [{ id: "domain:x", name: "X" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await detectBusinessAvailability();
    expect(fetchMock).toHaveBeenCalledWith("/api/business/domains");
  });

  it("returns false on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await detectBusinessAvailability()).toBe(false);
  });

  it("returns false on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    expect(await detectBusinessAvailability()).toBe(false);
  });

  it("returns false when domains is empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ domains: [] }),
    }));
    expect(await detectBusinessAvailability()).toBe(false);
  });
});

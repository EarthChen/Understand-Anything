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
    const ok = await detectBusinessAvailability("tok");
    expect(ok).toBe(true);
  });

  it("returns false on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await detectBusinessAvailability("tok")).toBe(false);
  });

  it("returns false on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    expect(await detectBusinessAvailability("tok")).toBe(false);
  });

  it("returns false when domains is empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ domains: [] }),
    }));
    expect(await detectBusinessAvailability("tok")).toBe(false);
  });
});

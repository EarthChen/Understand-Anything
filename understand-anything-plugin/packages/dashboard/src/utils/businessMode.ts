export async function detectBusinessAvailability(): Promise<boolean> {
  try {
    const res = await fetch("/api/business/domains");
    if (!res.ok) return false;
    const data = await res.json() as { domains?: unknown[]; unmapped?: unknown[]; stats?: Record<string, number> };
    const hasDomains = Array.isArray(data.domains) && data.domains.length > 0;
    const hasUnmapped = Array.isArray(data.unmapped) && data.unmapped.length > 0;
    const hasTotalDomains = (data.stats?.totalDomains ?? 0) > 0;
    return hasDomains || hasUnmapped || hasTotalDomains;
  } catch {
    return false;
  }
}

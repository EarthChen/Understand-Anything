export async function detectBusinessAvailability(): Promise<boolean> {
  try {
    const res = await fetch("/api/business/domains");
    if (!res.ok) return false;
    const data = await res.json() as { domains?: unknown[] };
    return Array.isArray(data.domains) && data.domains.length > 0;
  } catch {
    return false;
  }
}

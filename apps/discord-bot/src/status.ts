// État du service lu sur les adresses PUBLIQUES d'AETHRYON (aucune API privée, aucun jeton) :
// la configuration du site (/api/config : plateformes, quotas, message de maintenance), la santé du service
// de conversion et les pauses de plateforme (/api/status : YouTube qui bloque le serveur, avec l'heure de fin).
// Résultat mis en cache 30 s pour ne pas solliciter le service à chaque commande.
export interface ServiceStatus {
  site: "ok" | "down";
  conversion: "ok" | "down";
  maintenance: string | null;
  platforms: { youtube: boolean | null; tiktok: boolean | null; x: boolean | null };
  quotas: { daily: number; maxActive: number } | null;
  /** Plateformes en pause (ytapi ne les contacte plus jusqu'à `until`, ms) : cause constatée. */
  pauses?: { platform: "youtube" | "tiktok" | "x"; reason: "bot_check" | "upstream_rate_limited"; until: number }[];
  checkedAt: number;
}

type Fetch = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

async function getJson(fetchFn: Fetch, url: string, timeoutMs: number): Promise<unknown | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchFn(url, { signal: ctrl.signal, headers: { accept: "application/json", "user-agent": "AETHRYON-Discord" } });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const PAUSE_PLATFORM: Record<string, "youtube" | "tiktok" | "x"> = { youtube: "youtube", tiktok: "tiktok", twitter: "x" };
/** Pauses d'account (/api/status), validées : plateforme connue, cause connue, fin dans le futur (≤ 24 h). */
export function parsePauses(raw: unknown, nowMs: number): NonNullable<ServiceStatus["pauses"]> {
  if (!Array.isArray(raw)) return [];
  const out: NonNullable<ServiceStatus["pauses"]> = [];
  for (const p of raw.slice(0, 3)) {
    const x = p as { platform?: unknown; reason?: unknown; until?: unknown } | null;
    const platform = typeof x?.platform === "string" ? PAUSE_PLATFORM[x.platform] : undefined;
    const until = typeof x?.until === "string" ? Date.parse(x.until) : Number.NaN;
    if (!platform || Number.isNaN(until) || until <= nowMs || until > nowMs + 86_400_000) continue;
    out.push({ platform, reason: x!.reason === "bot_check" ? "bot_check" : "upstream_rate_limited", until });
  }
  return out;
}

export function createStatusReader(siteUrl: string, apiHealthUrl: string, fetchFn: Fetch = fetch as unknown as Fetch, ttlMs = 30_000, now = () => Date.now()) {
  let cache: ServiceStatus | null = null;
  return async function read(): Promise<ServiceStatus> {
    if (cache && now() - cache.checkedAt < ttlMs) return cache;
    const [cfg, health, st] = await Promise.all([getJson(fetchFn, `${siteUrl}/api/config`, 4000), getJson(fetchFn, apiHealthUrl, 4000),
      getJson(fetchFn, `${siteUrl}/api/status`, 4000)]);
    const c = (cfg ?? {}) as { maintenanceMessage?: unknown; platforms?: Record<string, unknown>; quotas?: { daily?: unknown; maxActive?: unknown } };
    const p = c.platforms ?? {};
    const flag = (v: unknown) => (typeof v === "boolean" ? v : null);
    const q = c.quotas;
    cache = {
      site: cfg ? "ok" : "down",
      conversion: (health as { status?: unknown } | null)?.status === "ok" ? "ok" : "down",
      maintenance: typeof c.maintenanceMessage === "string" && c.maintenanceMessage.trim() ? c.maintenanceMessage.trim().slice(0, 300) : null,
      platforms: { youtube: flag(p.youtube), tiktok: flag(p.tiktok), x: flag(p.twitter) },
      quotas: q && typeof q.daily === "number" && typeof q.maxActive === "number" ? { daily: q.daily, maxActive: q.maxActive } : null,
      pauses: parsePauses((st as { pauses?: unknown } | null)?.pauses, now()),
      checkedAt: now(),
    };
    return cache;
  };
}

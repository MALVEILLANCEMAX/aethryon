// Client de l'API interne de ytapi (docs/ADMIN.md §5) : état, jobs actifs, annulation.
// En-tête X-Internal-Token = jeton interne partagé ; délai de 3 s ; latence mesurée. Le jeton n'est
// envoyé qu'à une adresse http:// (réseau Docker interne) : jamais à une URL publique https:// qui
// passerait par Traefik (ytapi refuse de toute façon l'API interne derrière un proxy).
import type { Config } from "./config.ts";

export type YtapiResult<T> =
  | { ok: true; status: number; body: T; latencyMs: number }
  | { ok: false; error: string; status?: number; latencyMs: number | null; unconfigured?: true };

export interface YtapiJob {
  jobId: string | null; usageId: string | null; userId: string | null; platform: string | null; fmt: string | null;
  stage: string | null; progress: number | null; createdAt: string | null; startedAt: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Liste de jobs de ytapi (tableau, ou objet { jobs | items }) → forme stable, sans URL. */
export function parseJobs(body: unknown): YtapiJob[] {
  const list = Array.isArray(body) ? body
    : body && typeof body === "object" ? ((body as { jobs?: unknown }).jobs ?? (body as { items?: unknown }).items) : null;
  if (!Array.isArray(list)) return [];
  return list.filter((j) => j && typeof j === "object").map((j: Record<string, unknown>) => ({
    jobId: str(j.job_id) ?? str(j.id),
    usageId: str(j.usage_id),
    userId: str(j.user_id),
    platform: str(j.platform),
    fmt: str(j.fmt) ?? str(j.format),
    stage: str(j.stage) ?? str(j.status),
    progress: num(j.progress),
    createdAt: str(j.created_at),
    startedAt: str(j.started_at),
  }));
}

export class YtapiClient {
  private cfg: Config;
  private fetchImpl: typeof fetch;
  private cache: { at: number; value: YtapiResult<Record<string, unknown>> } | null = null;
  constructor(cfg: Config, fetchImpl: typeof fetch = fetch) { this.cfg = cfg; this.fetchImpl = fetchImpl; }

  private async call<T>(method: "GET" | "POST", path: string): Promise<YtapiResult<T>> {
    const base = this.cfg.ytapiInternalUrl;
    if (!base) return { ok: false, error: "YTAPI_INTERNAL_URL non configurée", latencyMs: null, unconfigured: true };
    if (!base.startsWith("http://")) {
      return { ok: false, error: "YTAPI_INTERNAL_URL n'est pas une adresse interne (http://)\u00a0: API interne non appelée", latencyMs: null, unconfigured: true };
    }
    const t0 = performance.now();
    try {
      const res = await this.fetchImpl(`${base}${path}`, {
        method,
        headers: { "x-internal-token": this.cfg.internalToken, accept: "application/json", ...(method === "POST" ? { "content-type": "application/json" } : {}) },
        ...(method === "POST" ? { body: "{}" } : {}),
        signal: AbortSignal.timeout(3000),
      });
      const latencyMs = Math.round(performance.now() - t0);
      const text = await res.text();
      let body: unknown = null;
      if (text) { try { body = JSON.parse(text); } catch { body = null; } }
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, status: res.status, latencyMs };
      return { ok: true, status: res.status, body: body as T, latencyMs };
    } catch (e) {
      const latencyMs = Math.round(performance.now() - t0);
      const name = (e as { name?: string } | null)?.name;
      return { ok: false, error: name === "TimeoutError" || name === "AbortError" ? "délai dépassé (3 s)" : "connexion impossible", latencyMs };
    }
  }

  /** État de ytapi ; `maxAgeMs` > 0 réutilise une réponse récente (vue d'ensemble interrogée en boucle). */
  async status(maxAgeMs = 0): Promise<YtapiResult<Record<string, unknown>>> {
    if (maxAgeMs > 0 && this.cache && Date.now() - this.cache.at < maxAgeMs) return this.cache.value;
    const r = await this.call<Record<string, unknown>>("GET", "/internal/v1/status");
    const value: YtapiResult<Record<string, unknown>> = r.ok && (!r.body || typeof r.body !== "object")
      ? { ok: false, error: "réponse illisible", status: r.status, latencyMs: r.latencyMs }
      : r;
    this.cache = { at: Date.now(), value };
    return value;
  }

  invalidate(): void { this.cache = null; }

  async jobs(): Promise<YtapiResult<YtapiJob[]>> {
    const r = await this.call<unknown>("GET", "/internal/v1/jobs");
    return r.ok ? { ...r, body: parseJobs(r.body) } : r;
  }

  async cancel(jobId: string): Promise<YtapiResult<unknown>> {
    return this.call<unknown>("POST", `/internal/v1/jobs/${encodeURIComponent(jobId)}/cancel`);
  }
}

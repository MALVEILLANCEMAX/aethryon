// État du service, calculé à partir de sources réelles : /health de ytapi, réglage « pause »,
// et part d'échecs côté service de la dernière heure. Mis en cache 15 s pour ne pas solliciter ytapi.
// `pauses` : plateformes que ytapi ne contacte plus pour un moment (YouTube qui bloque le serveur :
// disjoncteur, docs/ERREURS.md), lues sur l'API interne de ytapi ; n'agit pas sur `state` (le service
// et les autres plateformes fonctionnent), affiché par le bot Discord (/status).
import type { Config } from "./config.ts";
import type { DB } from "./db.ts";
import { getSettings } from "./settings.ts";
import type { UsageService } from "./usage.ts";
import type { YtapiClient } from "./ytapi.ts";

export type ServiceState = "ok" | "degraded" | "down" | "paused";
export interface PlatformPause { platform: "youtube" | "tiktok" | "twitter"; reason: "bot_check" | "upstream_rate_limited"; until: string }
export interface ServiceStatus { state: ServiceState; message: string; checkedAt: string; pauses: PlatformPause[] }

/**
 * Codes d'erreur liés au contenu demandé ou à l'utilisateur (vidéo supprimée, privée, trop longue,
 * lien non pris en charge, annulation…), cf. docs/ERREURS.md. Ils ne disent rien de la santé du
 * service : exclus du calcul « certaines conversions échouent » (numérateur et dénominateur).
 */
export const CONTENT_ERROR_CODES: readonly string[] = [
  "not_found", "no_video", "media_index_not_found",
  "private", "age_restricted", "members_only", "login_required",
  "unsupported_url", "unsupported_content", "playlist_not_supported", "youtube_music_not_accepted", "live_not_supported", "short_link_unresolved", "no_audio",
  "too_long", "too_large", "transcode_too_long", "gif_too_long",
  "cancelled",
];

const MESSAGES: Record<ServiceState, string> = {
  ok: "Le service de conversion fonctionne normalement.",
  degraded: "Le service fonctionne, mais certaines conversions échouent en ce moment.",
  down: "Le service de conversion ne répond pas. Réessaie un peu plus tard.",
  paused: "Les conversions sont temporairement suspendues.",
};

export class StatusService {
  private cache: { value: ServiceStatus; at: number } | null = null;

  private cfg: Config;
  private db: DB;
  private usage: UsageService;
  private fetchImpl: typeof fetch;
  private ytapi: YtapiClient | null;
  constructor(cfg: Config, db: DB, usage: UsageService, fetchImpl: typeof fetch = fetch, ytapi: YtapiClient | null = null) {
    this.cfg = cfg; this.db = db; this.usage = usage; this.fetchImpl = fetchImpl; this.ytapi = ytapi;
  }

  /** Pauses en cours (fin dans le futur) d'après l'API interne de ytapi ; [] si elle est injoignable. */
  private async pauses(): Promise<PlatformPause[]> {
    if (!this.ytapi) return [];
    const r = await this.ytapi.status(15_000);
    if (!r.ok) return [];
    const platforms = (r.body as { platforms?: unknown }).platforms;
    if (!platforms || typeof platforms !== "object") return [];
    const out: PlatformPause[] = [];
    for (const name of ["youtube", "tiktok", "twitter"] as const) {
      const p = (platforms as Record<string, unknown>)[name] as { state?: unknown; cooldown_until?: unknown } | undefined;
      const until = typeof p?.cooldown_until === "string" ? Date.parse(p.cooldown_until) : Number.NaN;
      if (!p || Number.isNaN(until) || until <= Date.now()) continue;
      out.push({ platform: name, reason: p.state === "bot_check" ? "bot_check" : "upstream_rate_limited", until: new Date(until).toISOString() });
    }
    return out;
  }

  private async apiHealthy(): Promise<boolean> {
    if (!this.cfg.ytapiInternalUrl) return false;
    try {
      const res = await this.fetchImpl(`${this.cfg.ytapiInternalUrl}/health`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return false;
      const body = (await res.json()) as { status?: string };
      return body.status === "ok";
    } catch {
      return false;
    }
  }

  async get(): Promise<ServiceStatus> {
    if (this.cache && Date.now() - this.cache.at < 15_000) return this.cache.value;
    let state: ServiceState;
    if (getSettings(this.db).conversionsPaused) state = "paused";
    else if (!(await this.apiHealthy())) state = "down";
    else {
      const ratio = this.usage.errorRatioLastHour(CONTENT_ERROR_CODES);
      state = ratio !== null && ratio > 0.5 ? "degraded" : "ok";
    }
    const value = { state, message: MESSAGES[state], checkedAt: new Date().toISOString(), pauses: await this.pauses() };
    this.cache = { value, at: Date.now() };
    return value;
  }

  invalidate(): void { this.cache = null; }
}

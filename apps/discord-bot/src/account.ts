// Client typé de l'API interne d'account réservée au bot (docs/DISCORD-BOT.md §17) : secret partagé dans
// l'en-tête X-Bot-Token, réseau Docker interne seulement (http), délai court (3 s, 5 s pour une clé), aucune
// redirection suivie. Erreurs ramenées à des codes stables, dont les textes sont dans errors.ts.
// Jamais journalisé ici : identifiant Discord, clé, lien de téléchargement.

/** Quota du jour, même format que /api/me du site (account, usage.ts). */
export interface Today { used: number; limit: number | null; remaining: number | null; unlimited?: boolean; bonus?: number; resetAt: string }

export type Resolved =
  | { linked: false }
  | { linked: true; status: "suspended" }
  | { linked: true; status: "active"; user: { name: string; email: string }; discord: { name: string; linkedAt: string; lastUsedAt: string | null }; today: Today; maxActive: number };

export interface SessionKey { key: string; keyId: string; expiresAt: string | null }
export interface DownloadLink { url: string; expiresAt: string }

export interface HistoryItem { id: string; createdAt: string; finishedAt: string | null; fmt: string; platform: string | null; state: string; errorCode: string | null; errorMessage: string | null }
export interface History { items: HistoryItem[]; today: Today }
export interface Prefs { fmt: "mp4" | "mp3"; quality: "auto" | "720" | "1080"; visibility: "private" | "share"; locale: "auto" | "fr" | "en" }
export interface SavedItem { id: string; platform: "youtube" | "tiktok" | "x"; url: string; mediaType: "video" | "audio"; title: string | null; creator: string | null; durationS: number | null; origin: string; savedAt: string }
export interface SavedPage { items: SavedItem[]; total: number; max: number }
export interface GuildSettings {
  autoEmbeds: boolean; platforms: ("youtube" | "tiktok" | "x")[]; channels: string[]; buttons: boolean; share: boolean;
  quality: "auto" | "720" | "1080"; perHour: number; original: "keep" | "suppress"; mode: "card" | "react";
}

/** Nom de fichier lu dans Content-Disposition (filename*=UTF-8'' ou filename=), nettoyé ; « fichier » sinon. */
export function fileName(cd: string): string {
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(cd)?.[1];
  let name = "";
  if (star) { try { name = decodeURIComponent(star.trim()); } catch { name = ""; } }
  if (!name) name = /filename\s*=\s*"?([^";]+)"?/i.exec(cd)?.[1] ?? "";
  name = name.replace(/[\u0000-\u001f\u007f\/\\:*?"<>|]/g, "").trim().slice(0, 120);
  return name || "fichier";
}

/** Codes d'échec : ceux d'account (not_linked, account_suspended, service_paused, too_many_sessions,
 *  too_many_downloads, rate_limited…) ou « link_unavailable » (account injoignable, délai, réponse illisible,
 *  secret refusé : l'utilisateur n'y peut rien). */
export class AccountError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message = code) { super(message); this.code = code; this.status = status; }
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal; redirect: "manual" }) =>
  Promise<{ status: number; text(): Promise<string>; arrayBuffer?(): Promise<ArrayBuffer>; headers?: { get(name: string): string | null } }>;

const SNOWFLAKE = /^\d{17,20}$/;

export class AccountClient {
  private base: string;
  private token: string;
  private fetchFn: Fetch;
  constructor(base: string, token: string, fetchFn: Fetch = fetch as unknown as Fetch) { this.base = base; this.token = token; this.fetchFn = fetchFn; }

  private async call<T>(path: string, body: Record<string, unknown>, timeoutMs = 3000): Promise<{ status: number; body: T | null }> {
    if (!SNOWFLAKE.test(String(body.discord_user_id ?? body.guild_id ?? ""))) throw new AccountError("bad_request", 400);
    let res: Awaited<ReturnType<Fetch>>;
    try {
      res = await this.fetchFn(`${this.base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "x-bot-token": this.token },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "manual",
      });
    } catch {
      throw new AccountError("link_unavailable", 0);
    }
    const text = await res.text().catch(() => "");
    let parsed: unknown = null;
    if (text) { try { parsed = JSON.parse(text); } catch { parsed = null; } }
    if (res.status === 401 || (res.status === 403 && (parsed as { error?: string } | null)?.error === "forbidden")) {
      // Secret ou réseau refusés : erreur de configuration du bot, jamais la faute de l'utilisateur.
      throw new AccountError("link_unavailable", res.status, "configuration");
    }
    if (res.status >= 500 && (parsed as { error?: string } | null)?.error !== "service_paused") throw new AccountError("link_unavailable", res.status);
    return { status: res.status, body: parsed as T | null };
  }

  private refuse(status: number, body: unknown): never {
    const code = (body as { error?: unknown } | null)?.error;
    throw new AccountError(typeof code === "string" && /^[a-z_]{2,40}$/.test(code) ? code : "link_unavailable", status);
  }

  /** Qui est ce compte Discord ? */
  /** `profile` : nom d'utilisateur, nom affiché et empreinte de l'image vus dans l'interaction (account tient le profil
   *  du compte lié à jour ; jamais de jeton). */
  async resolve(discordUserId: string, profile?: { name: string; display: string | null; avatar: string | null } | null): Promise<Resolved> {
    const r = await this.call<Resolved>("/internal/v1/discord/resolve", { discord_user_id: discordUserId, ...(profile ? { profile } : {}) });
    const b = r.body as Resolved | null;
    if (r.status !== 200 || !b || typeof b.linked !== "boolean") this.refuse(r.status, r.body);
    if (b.linked && b.status === "active" && (!b.today || typeof b.today.used !== "number")) throw new AccountError("link_unavailable", r.status);
    return b;
  }

  /** Clé ytc_ « discord » de 15 min pour UNE conversion (quota du compte). */
  async session(discordUserId: string): Promise<SessionKey> {
    const r = await this.call<SessionKey>("/internal/v1/discord/session", { discord_user_id: discordUserId }, 5000);
    const b = r.body;
    if (r.status !== 201 || !b || typeof b.key !== "string" || !b.key.startsWith("ytc_") || typeof b.keyId !== "string") this.refuse(r.status, r.body);
    return b;
  }

  /** Rend la clé en fin de conversion (révocation). Ne lève jamais : la clé expire de toute façon en 15 min. */
  async release(discordUserId: string, keyId: string): Promise<boolean> {
    try {
      const r = await this.call<null>("/internal/v1/discord/release", { discord_user_id: discordUserId, key_id: keyId });
      return r.status === 204;
    } catch {
      return false;
    }
  }

  /** Déliaison demandée depuis Discord (après confirmation). */
  async unlink(discordUserId: string): Promise<boolean> {
    const r = await this.call<{ unlinked: boolean }>("/internal/v1/discord/unlink", { discord_user_id: discordUserId });
    if (r.status !== 200 || typeof r.body?.unlinked !== "boolean") this.refuse(r.status, r.body);
    return r.body.unlinked;
  }

  /** Historique récent (date, format, plateforme, état ; jamais de lien ni de titre) et quota du jour. */
  async history(discordUserId: string, limit = 10): Promise<History> {
    const r = await this.call<History>("/internal/v1/discord/history", { discord_user_id: discordUserId, limit });
    if (r.status !== 200 || !Array.isArray(r.body?.items)) this.refuse(r.status, r.body);
    return r.body;
  }

  async prefs(discordUserId: string): Promise<Prefs> {
    const r = await this.call<Prefs>("/internal/v1/discord/prefs", { discord_user_id: discordUserId });
    if (r.status !== 200 || !r.body?.fmt) this.refuse(r.status, r.body);
    return r.body;
  }

  async setPrefs(discordUserId: string, patch: Partial<Prefs>): Promise<Prefs> {
    const r = await this.call<Prefs>("/internal/v1/discord/prefs/set", { discord_user_id: discordUserId, ...patch });
    if (r.status !== 200 || !r.body?.fmt) this.refuse(r.status, r.body);
    return r.body;
  }

  async savedList(discordUserId: string, f: { q?: string | null; platform?: string | null; type?: string | null; offset?: number } = {}): Promise<SavedPage> {
    const body: Record<string, unknown> = { discord_user_id: discordUserId };
    if (f.q) body.q = f.q.slice(0, 60);
    if (f.platform) body.platform = f.platform;
    if (f.type) body.type = f.type;
    if (f.offset) body.offset = f.offset;
    const r = await this.call<SavedPage>("/internal/v1/discord/saved/list", body);
    if (r.status !== 200 || !Array.isArray(r.body?.items)) this.refuse(r.status, r.body);
    return r.body;
  }

  async savedGet(discordUserId: string, id: string): Promise<SavedItem | null> {
    const r = await this.call<SavedItem>("/internal/v1/discord/saved/get", { discord_user_id: discordUserId, id });
    if (r.status === 404) return null;
    if (r.status !== 200 || !r.body?.id) this.refuse(r.status, r.body);
    return r.body;
  }

  /** Enregistre une référence (le lien est validé et rendu canonique par account ; la plateforme en est déduite). */
  async savedAdd(discordUserId: string, item: { url: string; mediaType?: "video" | "audio"; title?: string | null; creator?: string | null; durationS?: number | null }): Promise<{ item: SavedItem; created: boolean }> {
    const body: Record<string, unknown> = { discord_user_id: discordUserId, url: item.url };
    if (item.mediaType) body.media_type = item.mediaType;
    if (item.title) body.title = item.title.slice(0, 400);
    if (item.creator) body.creator = item.creator.slice(0, 200);
    if (typeof item.durationS === "number" && Number.isInteger(item.durationS) && item.durationS >= 0 && item.durationS <= 86400) body.duration_s = item.durationS;
    const r = await this.call<{ item: SavedItem; created: boolean }>("/internal/v1/discord/saved/add", body);
    if ((r.status !== 201 && r.status !== 200) || !r.body?.item) this.refuse(r.status, r.body);
    return r.body;
  }

  async savedRemove(discordUserId: string, id: string): Promise<boolean> {
    const r = await this.call<{ removed: boolean }>("/internal/v1/discord/saved/remove", { discord_user_id: discordUserId, id });
    if (r.status !== 200) this.refuse(r.status, r.body);
    return !!r.body?.removed;
  }

  /** Efface toute la bibliothèque du compte lié (après confirmation dans Discord) ; renvoie le nombre retiré. */
  async savedClear(discordUserId: string): Promise<number> {
    const r = await this.call<{ removed: number }>("/internal/v1/discord/saved/clear", { discord_user_id: discordUserId });
    if (r.status !== 200) this.refuse(r.status, r.body);
    return Number(r.body?.removed ?? 0);
  }

  async guild(guildId: string): Promise<{ settings: GuildSettings; stored: boolean }> {
    const r = await this.call<{ settings: GuildSettings; stored: boolean }>("/internal/v1/discord/guild", { guild_id: guildId });
    if (r.status !== 200 || !r.body?.settings) this.refuse(r.status, r.body);
    return r.body;
  }

  async setGuild(guildId: string, settings: Partial<GuildSettings>): Promise<GuildSettings> {
    const r = await this.call<{ settings: GuildSettings }>("/internal/v1/discord/guild/set", { guild_id: guildId, settings });
    if (r.status !== 200 || !r.body?.settings) this.refuse(r.status, r.body);
    return r.body.settings;
  }

  async forgetGuild(guildId: string): Promise<void> {
    try { await this.call("/internal/v1/discord/guild/forget", { guild_id: guildId }); } catch { /* sans conséquence : purge à 400 jours */ }
  }

  /** Fichier d'un job pour une pièce jointe : octets si ≤ maxBytes, sinon « trop gros » (avec la taille si connue). */
  async file(discordUserId: string, jobId: string, maxBytes: number): Promise<{ ok: true; bytes: Buffer; name: string; type: string } | { ok: false; error: string; size?: number }> {
    if (!SNOWFLAKE.test(discordUserId)) throw new AccountError("bad_request", 400);
    let res: Awaited<ReturnType<Fetch>>;
    try {
      res = await this.fetchFn(`${this.base}/internal/v1/discord/file`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "*/*", "x-bot-token": this.token },
        body: JSON.stringify({ discord_user_id: discordUserId, job_id: jobId, max_bytes: Math.floor(maxBytes) }),
        signal: AbortSignal.timeout(120_000),
        redirect: "manual",
      });
    } catch {
      return { ok: false, error: "download_unavailable" };
    }
    if (res.status === 200 && res.arrayBuffer) {
      const len = Number(res.headers?.get("content-length"));
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > maxBytes || (Number.isFinite(len) && len !== bytes.length)) return { ok: false, error: "download_unavailable" };
      const cd = res.headers?.get("content-disposition") ?? "";
      return { ok: true, bytes, name: fileName(cd), type: res.headers?.get("content-type") ?? "application/octet-stream" };
    }
    const text = await res.text().catch(() => "");
    let b: { error?: unknown; size?: unknown } | null = null;
    try { b = text ? JSON.parse(text) : null; } catch { b = null; }
    const code = typeof b?.error === "string" && /^[a-z_]{2,40}$/.test(b.error) ? b.error : "download_unavailable";
    return { ok: false, error: code, ...(typeof b?.size === "number" ? { size: b.size } : {}) };
  }

  /** Lien « Ouvrir dans AETHRYON Tools » (55 min) pour un job terminé du compte lié : valable seulement pour ce compte,
   *  une fois connecté au site (le jeton est après le « # », il n'apparaît dans aucun journal). */
  async toolsLink(discordUserId: string, jobId: string): Promise<DownloadLink> {
    const r = await this.call<DownloadLink>("/internal/v1/discord/outils", { discord_user_id: discordUserId, job_id: jobId });
    const b = r.body;
    if (r.status !== 201 || !b || typeof b.url !== "string" || !/^https?:\/\/[^#]+\/outils\/studio#ref=[A-Za-z0-9_-]{43}$/.test(b.url)) this.refuse(r.status, r.body);
    return b;
  }

  /** Lien de téléchargement à usage unique (10 min) pour un job terminé du compte lié. */
  async download(discordUserId: string, jobId: string): Promise<DownloadLink> {
    const r = await this.call<DownloadLink>("/internal/v1/discord/download", { discord_user_id: discordUserId, job_id: jobId });
    const b = r.body;
    if (r.status !== 201 || !b || typeof b.url !== "string" || !/^https?:\/\//.test(b.url)) this.refuse(r.status, r.body);
    return b;
  }
}

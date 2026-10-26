// AETHRYON Tools (docs/OUTILS.md) : relais authentifié entre l'éditeur du site et ytapi.
// Le navigateur ne parle qu'au site (cookie de session, même origine, CSP inchangée) ; account relaie chaque demande à
// ytapi avec une clé « outils » de 15 min gardée EN MÉMOIRE (jamais remise au navigateur, jamais journalisée). ytapi
// applique ses règles habituelles : propriétaire seul (404 sinon), quota (une unité par lien ouvert ou fichier importé),
// une conversion à la fois, limites de durée et de taille. Les adresses internes de ytapi ne sortent jamais : chaque vue
// de job est réécrite vers /api/outils/…
// Liens « Ouvrir dans AETHRYON Tools » (bot Discord) : jeton de 32 octets dont seule l'empreinte est gardée, valable
// 55 min et SEULEMENT pour le compte connecté qui le possède (un lien vu par un autre ne lui donne rien).
import type { Antibot } from "./antibot.ts";
import { createHash, randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import type { Config } from "./config.ts";
import { writeTx, type DB } from "./db.ts";
import { err, HttpError, Limiter, type Vars } from "./http.ts";
import type { KeyService } from "./keys.ts";
import { exportMinutes, exportWeight } from "./plans.ts";
import type { UsageService } from "./usage.ts";
import { log } from "./log.ts";
import { isYouTubeMusicUrl, YOUTUBE_MUSIC_CODE, YOUTUBE_MUSIC_TEXT } from "./youtube-music.ts";

const NB = " ";
const JOB_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const THUMB_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const REF_RE = /^[A-Za-z0-9_-]{43}$/;
const HEADERS_TIMEOUT_MS = 30_000;
/** Durée de vie d'un lien « Ouvrir dans AETHRYON Tools » : moins que celle d'un fichier de ytapi (60 min). */
export const TOOLS_REF_TTL_MS = 55 * 60_000;
/** Corps d'un morceau d'import : UPLOAD_CHUNK_MB de ytapi (5 Mio) ; le contrôle exact est fait par ytapi. */
export const TOOLS_CHUNK_MAX_BYTES = 8 * 1024 * 1024;
export const TOOLS_CHUNK_PATH = /^\/api\/outils\/imports\/[A-Za-z0-9_-]{1,40}\/morceaux\/\d{1,6}$/;
const QUALITIES = new Set(["best", "2160", "1440", "1080", "720", "480", "360"]);

export const TEXT = {
  unauthorized: `Connecte-toi pour utiliser AETHRYON Tools.`,
  unavailable: `AETHRYON Tools est momentanément indisponible${NB}: réessaie dans un instant.`,
  invalidId: "Média introuvable.",
  refGone: `Ce lien a expiré ou il est destiné à un autre compte${NB}: ouvre le média depuis ton propre compte.`,
  tooMany: `Trop de demandes en peu de temps${NB}: réessaie dans quelques minutes.`,
  invalidBody: "Requête invalide.",
} as const;

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const token32 = () => randomBytes(32).toString("base64url");

export interface ToolsDeps { cfg: Config; db: DB; keys: KeyService; fetch?: typeof fetch }

export class ToolsService {
  readonly cfg: Config;
  private db: DB;
  private keys: KeyService;
  private fetchImpl: () => typeof fetch;
  /** Clé « outils » par compte (secret en mémoire seulement), réutilisée jusqu'à 2 min de son expiration. */
  private cache = new Map<string, { secret: string; expiresAt: number }>();

  constructor(d: ToolsDeps) {
    this.cfg = d.cfg; this.db = d.db; this.keys = d.keys;
    this.fetchImpl = () => d.fetch ?? globalThis.fetch;
  }

  get enabled(): boolean { return this.cfg.toolsEnabled && Boolean(this.cfg.ytapiInternalUrl?.startsWith("http://")); }

  private async keyFor(userId: string, fresh = false): Promise<string> {
    const hit = this.cache.get(userId);
    if (!fresh && hit && hit.expiresAt - Date.now() > 120_000) return hit.secret;
    const { key, secret } = await this.keys.createToolsKey(userId);
    const expiresAt = key.expiresAt ? Date.parse(key.expiresAt) : Date.now() + 14 * 60_000;
    this.cache.set(userId, { secret, expiresAt });
    if (this.cache.size > 5000) for (const [k, v] of this.cache) if (v.expiresAt < Date.now()) this.cache.delete(k);
    return secret;
  }

  forget(userId: string): void { this.cache.delete(userId); }

  /**
   * Requête à ytapi pour ce compte. Délai sur l'arrivée des EN-TÊTES seulement (le corps d'un flux vidéo peut durer) ;
   * une clé refusée (révoquée, expirée) est remplacée une fois. Jamais de redirection suivie.
   */
  async call(userId: string, method: string, path: string,
             init: { json?: unknown; body?: Uint8Array; headers?: Record<string, string> } = {},
             /** Relais AETHRYON Music (music.ts) : ouvert par MUSIC_RELAY, pas par TOOLS_ENABLED. */
             feature: "tools" | "music" = "tools"): Promise<Response> {
    const base = this.cfg.ytapiInternalUrl;
    const open = feature === "music" ? this.cfg.musicEnabled && Boolean(base?.startsWith("http://")) : this.enabled;
    if (!open || !base) throw new HttpError(503, "tools_unavailable", TEXT.unavailable);
    for (let attempt = 0; attempt < 2; attempt++) {
      const secret = await this.keyFor(userId, attempt > 0);
      const headers: Record<string, string> = { authorization: `Bearer ${secret}`, accept: "*/*", ...init.headers };
      let body: string | Uint8Array | undefined;
      if (init.json !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(init.json); }
      else if (init.body !== undefined) { headers["content-type"] = "application/octet-stream"; body = init.body; }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), HEADERS_TIMEOUT_MS);
      let res: Response;
      try {
        res = await this.fetchImpl()(`${base}${path}`, { method, headers, body: body as never, redirect: "manual", signal: ctrl.signal });
      } catch {
        throw new HttpError(503, "tools_unavailable", TEXT.unavailable);
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 401 && attempt === 0) {
        await res.body?.cancel().catch(() => undefined);
        this.forget(userId);
        continue;
      }
      return res;
    }
    throw new HttpError(503, "tools_unavailable", TEXT.unavailable);
  }

  // ---- liens « Ouvrir dans AETHRYON Tools » -----------------------------------------------------------------------

  async createRef(userId: string, jobId: string, origin: "discord" | "extension"): Promise<{ token: string; expiresAt: string }> {
    if (!JOB_ID_RE.test(jobId)) throw new HttpError(400, "invalid_job", TEXT.invalidId);
    const token = token32();
    const now = Date.now();
    const expiresAt = new Date(now + TOOLS_REF_TTL_MS).toISOString();
    await writeTx(this.db, () => {
      this.db.prepare("INSERT INTO ytc_outils_ref (token_hash, user_id, job_id, origin, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(sha(token), userId, jobId, origin, new Date(now).toISOString(), expiresAt);
    });
    log("info", "tools link issued", { user: userId, job: jobId, origin });
    return { token, expiresAt };
  }

  /** Job du lien, s'il n'a pas expiré ET s'il appartient à ce compte ; null sinon (même réponse dans les deux cas). */
  async redeemRef(userId: string, token: string): Promise<string | null> {
    if (!REF_RE.test(token)) return null;
    const now = new Date().toISOString();
    const row = this.db.prepare("SELECT user_id, job_id FROM ytc_outils_ref WHERE token_hash = ? AND expires_at > ?")
      .get(sha(token), now) as { user_id: string; job_id: string } | undefined;
    if (!row || row.user_id !== userId) return null;
    await writeTx(this.db, () => {
      this.db.prepare("UPDATE ytc_outils_ref SET uses = uses + 1 WHERE token_hash = ?").run(sha(token));
    });
    return row.job_id;
  }
}

// ---- forme des réponses ---------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;
const str = (v: unknown, max = 300): string | null => (typeof v === "string" && v ? v.slice(0, max) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Vue d'un job pour le navigateur : liste blanche de champs, adresses réécrites vers /api/outils. */
export function shapeJob(raw: unknown): Json {
  const j = (raw && typeof raw === "object" ? raw : {}) as Json;
  const id = str(j.job_id, 40) ?? "";
  const done = j.status === "done";
  const out: Json = {
    id,
    kind: str(j.kind, 20) ?? "download",
    status: str(j.status, 20),
    stage: str(j.stage, 40),
    progress: num(j.progress),
    platform: str(j.platform, 20),
    params: j.params && typeof j.params === "object" ? j.params : null,
    createdAt: str(j.created_at, 40),
    updatedAt: str(j.updated_at, 40),
    expiresAt: str(j.expires_at, 40),
    title: str(j.title),
    filename: str(j.filename),
    sizeBytes: num(j.size_bytes),
    mediaType: str(j.media_type, 80),
    notes: Array.isArray(j.notes) ? j.notes.filter((n) => typeof n === "string").slice(0, 5) : [],
    media: j.media && typeof j.media === "object" ? j.media : null,
    upload: j.upload && typeof j.upload === "object" ? j.upload : null,
    statusUrl: `/api/outils/medias/${id}`,
    streamUrl: done ? `/api/outils/medias/${id}/flux` : null,
    fileUrl: done ? `/api/outils/medias/${id}/fichier` : null,
  };
  if (j.derive && typeof j.derive === "object") {
    const d = j.derive as Json;
    out.derive = { ...d, sourceId: str(d.source_job_id, 40) };
    delete (out.derive as Json).source_job_id;
  }
  if (j.error) {
    out.error = str(j.error, 60);
    out.message = str(j.detail, 500);
    out.retryAfterS = num(j.retry_after_s);
  }
  return out;
}

export function shapePreview(raw: unknown): Json {
  const p = (raw && typeof raw === "object" ? raw : {}) as Json;
  const item = (e: Json): Json => ({
    title: str(e.title), uploader: str(e.uploader, 100), duration: num(e.duration),
    thumbnail: typeof e.thumbnail_id === "string" && THUMB_ID_RE.test(e.thumbnail_id) ? `/api/outils/vignettes/${e.thumbnail_id}` : null,
    isGif: Boolean(e.is_gif), live: Boolean(e.live), audio: str(e.audio, 10), bestH264: num(e.best_h264_quality),
    qualities: Array.isArray(e.qualities) ? e.qualities.slice(0, 8) : [],
    sizes: e.est_size_bytes && typeof e.est_size_bytes === "object" ? e.est_size_bytes : {},
    limits: e.limits && typeof e.limits === "object" ? e.limits : {},
  });
  const out: Json = { platform: str(p.platform, 20), mediaCount: num(p.media_count) ?? 1, ...item(p) };
  if (Array.isArray(p.entries)) {
    out.entries = p.entries.filter((e) => e && typeof e === "object").slice(0, 10)
      .map((e) => ({ index: num((e as Json).index), ...item(e as Json) }));
  }
  return out;
}

// ---- routes ---------------------------------------------------------------------------------------------------------

/** Secondes d'un champ de temps de la demande (nombre, ou « m:ss » / « h:mm:ss » comme ytapi les accepte). */
export function seconds(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== "string" || v.length > 16 || !/^\d+(?::\d{1,2}){0,2}(?:[.,]\d+)?$/.test(v.trim())) return null;
  const parts = v.trim().replace(",", ".").split(":").map(Number);
  return parts.reduce((t, x) => t * 60 + x, 0);
}

/** Minutes d'export d'une demande (plans.ts) : durée produite (passage ÷ vitesse) et côté court de l'image produite,
 *  tirés de la demande et de la sonde du média. Borne haute : un recadrage, qui réduit l'image, n'est pas déduit. */
export function exportCost(body: Record<string, unknown>, media: { duration: number; width?: number | null; height?: number | null }): number {
  const op = String(body.op ?? "");
  if (!exportWeight(op, null)) return 0;
  const start = Math.min(seconds(body.start_s) ?? 0, media.duration);
  const asked = seconds(body.duration_s);
  const span = Math.max(0, Math.min(asked ?? Infinity, media.duration - start));
  const speed = typeof body.speed === "number" && body.speed >= 0.25 && body.speed <= 4 ? body.speed : 1;
  const w = media.width ?? null, h = media.height ?? null;
  const ratio = w && h ? w / h : 16 / 9;
  const outH = typeof body.height === "number" && body.height > 0 ? body.height : h;
  const short = outH ? Math.min(outH, outH * ratio) : null;
  return exportMinutes(op, span / speed, short);
}

export function mountOutils(app: Hono<{ Variables: Vars }>, s: { cfg: Config; tools: ToolsService; usage: UsageService; antibot: Antibot }): void {
  const { tools } = s;
  const heavy = new Limiter(120, 3_600_000);   // aperçus, ouvertures, imports, exports : 120 par heure et par compte
  const refLimiter = new Limiter(30, 600_000);  // liens à ouvrir : 30 par 10 min et par compte

  const user = (c: Context<{ Variables: Vars }>) => {
    const u = c.get("user");
    if (!u) throw new HttpError(401, "unauthorized", TEXT.unauthorized);
    if (!tools.enabled) throw new HttpError(404, "not_found", "Route inconnue.");
    return u;
  };
  const jobId = (c: Context) => {
    const id = c.req.param("id") ?? "";
    if (!JOB_ID_RE.test(id)) throw new HttpError(404, "job_not_found", TEXT.invalidId);
    return encodeURIComponent(id);
  };
  const take = (limiter: Limiter, key: string) => {
    if (!limiter.take(key)) throw new HttpError(429, "rate_limited", TEXT.tooMany);
  };

  /** Réponse JSON de ytapi → même statut, corps réécrit ; une erreur garde son code et son texte. */
  const relayJson = async (c: Context, res: Response, shape: (b: unknown) => unknown = (b) => b) => {
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    const retry = res.headers.get("retry-after");
    if (retry && /^\d{1,6}$/.test(retry)) c.header("Retry-After", retry);
    if (res.status >= 400) {
      const b = (body ?? {}) as Json;
      if (res.status === 404 && !b.error) return err(c, 404, "not_found", "Route inconnue.");
      return c.json({ error: str(b.error, 60) ?? "tools_error", message: str(b.detail, 500) ?? TEXT.unavailable,
                      ...(b.job_id ? shapeJob(b) : {}) }, res.status as 400);
    }
    return c.json(shape(body) as Json, res.status as 200);
  };

  /** Flux binaire de ytapi (fichier, planche, vignette) : en-têtes utiles seulement, plages d'octets transmises. */
  const relayStream = (res: Response, disposition: "inline" | "attachment" | null, cache: string) => {
    const headers = new Headers({ "cache-control": cache, "x-content-type-options": "nosniff" });
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const v = res.headers.get(name);
      if (v) headers.set(name, v);
    }
    if (disposition === "attachment") {
      const d = res.headers.get("content-disposition");
      if (d) headers.set("content-disposition", d);
    } else if (disposition === "inline") {
      headers.set("content-disposition", "inline");
    }
    return new Response(res.body, { status: res.status, headers });
  };

  const rangeOf = (c: Context): Record<string, string> => {
    const out: Record<string, string> = {};
    const range = c.req.header("range");
    if (range && /^bytes=\d*-\d*(,\s*\d*-\d*)?$/.test(range)) out.range = range;
    const ifRange = c.req.header("if-range");
    if (ifRange && ifRange.length < 200) out["if-range"] = ifRange;
    return out;
  };

  // Liste (fichiers encore sur le serveur) et limites du service.
  app.get("/api/outils/medias", async (c) => {
    const u = user(c);
    const res = await tools.call(u.id, "GET", "/jobs");
    return relayJson(c, res, (b) => {
      const body = (b ?? {}) as Json;
      return {
        items: Array.isArray(body.jobs) ? body.jobs.map(shapeJob) : [],
        limits: {
          ttlMin: num(body.ttl_min), keepMin: num(body.keep_min), keepMaxMin: num(body.keep_max_min),
          maxUploadMb: num(body.max_upload_mb), chunkMb: num(body.chunk_mb), maxDurationS: num(body.max_duration_s),
          videoMaxS: num(body.video_max_s), gifMaxS: num(body.gif_max_s),
          // Minutes d'export du jour (offre du compte) : affichées avant l'export, jamais devinées par le navigateur.
          exportMinutes: { used: s.usage.exportUsed(u.id), limit: s.usage.exportLimit(u.id) },
        },
      };
    });
  });

  // Ce que contient un lien (titre, durée, qualités, vignette) : aucune unité de quota.
  app.post("/api/outils/apercu", async (c) => {
    const u = user(c);
    take(heavy, u.id);
    { const g = await s.antibot.guard(c, "travaux"); if (g.deny) return g.deny; }  // anti-bot : travaux du site
    const body = (await c.req.json().catch(() => null)) as { url?: unknown } | null;
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    if (!url || url.length > 2048) throw new HttpError(400, "invalid_url", "Colle le lien d'une vidéo YouTube, TikTok ou X.");
    // YouTube Music est fermé (2026-10-23) : refus ici, avant tout relais (ytapi le refuserait de la même façon).
    if (isYouTubeMusicUrl(url)) throw new HttpError(400, YOUTUBE_MUSIC_CODE, YOUTUBE_MUSIC_TEXT);
    return relayJson(c, await tools.call(u.id, "POST", "/preview", { json: { url } }), shapePreview);
  });

  app.get("/api/outils/vignettes/:tid", async (c) => {
    const u = user(c);
    const tid = c.req.param("tid") ?? "";
    if (!THUMB_ID_RE.test(tid)) return c.body(null, 404);
    const res = await tools.call(u.id, "GET", `/preview/thumbnail/${tid}`);
    if (res.status !== 200) { await res.body?.cancel().catch(() => undefined); return c.body(null, 404); }
    return relayStream(res, null, "private, max-age=600");
  });

  // Ouvrir un lien dans l'éditeur : une conversion MP4 (une unité du quota du jour), lue ensuite par l'éditeur.
  app.post("/api/outils/sources", async (c) => {
    const u = user(c);
    take(heavy, u.id);
    { const g = await s.antibot.guard(c, "travaux"); if (g.deny) return g.deny; }  // anti-bot : travaux du site
    const b = (await c.req.json().catch(() => null)) as Json | null;
    const url = typeof b?.url === "string" ? b.url.trim() : "";
    if (!url || url.length > 2048) throw new HttpError(400, "invalid_url", "Colle le lien d'une vidéo YouTube, TikTok ou X.");
    if (isYouTubeMusicUrl(url)) throw new HttpError(400, YOUTUBE_MUSIC_CODE, YOUTUBE_MUSIC_TEXT);  // fermé le 2026-10-23
    const job: Json = { url, fmt: "mp4" };
    if (typeof b?.quality === "string" && QUALITIES.has(b.quality)) job.quality = b.quality;
    if (b?.transcode === true) job.transcode = true;
    if (typeof b?.index === "number" && Number.isInteger(b.index) && b.index >= 1 && b.index <= 50) job.index = b.index;
    const res = await tools.call(u.id, "POST", "/jobs", { json: job });
    log("info", "tools source requested", { user: u.id, status: res.status });
    return relayJson(c, res, shapeJob);
  });

  // Import d'un fichier : annonce, morceaux (5 Mio), fin.
  app.post("/api/outils/imports", async (c) => {
    const u = user(c);
    take(heavy, u.id);
    { const g = await s.antibot.guard(c, "travaux"); if (g.deny) return g.deny; }  // anti-bot : travaux du site
    const b = (await c.req.json().catch(() => null)) as Json | null;
    const size = b?.size;
    if (typeof size !== "number" || !Number.isInteger(size) || size < 1) throw new HttpError(400, "invalid_size", TEXT.invalidBody);
    const name = typeof b?.name === "string" ? b.name.slice(0, 255) : "";
    const type = typeof b?.type === "string" ? b.type.slice(0, 100) : "";
    return relayJson(c, await tools.call(u.id, "POST", "/uploads", { json: { name, size, type } }), shapeJob);
  });

  app.put("/api/outils/imports/:id/morceaux/:n", async (c) => {
    const u = user(c);
    const id = jobId(c);
    const n = c.req.param("n") ?? "";
    if (!/^\d{1,6}$/.test(n)) throw new HttpError(404, "not_found", "Route inconnue.");
    const declared = Number(c.req.header("content-length") ?? "-1");
    if (!Number.isInteger(declared) || declared < 1 || declared > TOOLS_CHUNK_MAX_BYTES) {
      throw new HttpError(400, "invalid_chunk", "Morceau de fichier invalide.");
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength !== declared) throw new HttpError(400, "invalid_chunk", "Morceau de fichier incomplet.");
    const res = await tools.call(u.id, "PUT", `/uploads/${id}/chunks/${n}`, { body: bytes });
    return relayJson(c, res);
  });

  app.post("/api/outils/imports/:id/terminer", async (c) => {
    const u = user(c);
    return relayJson(c, await tools.call(u.id, "POST", `/uploads/${jobId(c)}/complete?wait=15`), shapeJob);
  });

  app.get("/api/outils/medias/:id", async (c) => {
    const u = user(c);
    // ?attendre=N : réponse à la fin du travail ou au bout de N s ; &suivi=1 : aussi dès que la progression bouge
    // (toutes les 2 s au plus), pour une barre qui suit le vrai travail.
    const wait = Math.min(Math.max(Number(c.req.query("attendre") ?? "0") || 0, 0), 20);
    const follow = wait && c.req.query("suivi") === "1" ? "&change=true" : "";
    return relayJson(c, await tools.call(u.id, "GET", `/jobs/${jobId(c)}${wait ? `?wait=${Math.floor(wait)}${follow}` : ""}`), shapeJob);
  });

  app.get("/api/outils/medias/:id/infos", async (c) => {
    const u = user(c);
    return relayJson(c, await tools.call(u.id, "GET", `/jobs/${jobId(c)}/media`));
  });

  // Lecture dans l'éditeur (plages d'octets) et téléchargement : le même fichier, même propriétaire.
  app.get("/api/outils/medias/:id/flux", async (c) => {
    const u = user(c);
    const res = await tools.call(u.id, "GET", `/jobs/${jobId(c)}/file`, { headers: rangeOf(c) });
    if (res.status !== 200 && res.status !== 206) return relayJson(c, res);
    return relayStream(res, "inline", "private, no-cache");
  });

  app.get("/api/outils/medias/:id/fichier", async (c) => {
    const u = user(c);
    const res = await tools.call(u.id, "GET", `/jobs/${jobId(c)}/file`, { headers: rangeOf(c) });
    if (res.status !== 200 && res.status !== 206) return relayJson(c, res);
    log("info", "tools file downloaded", { user: u.id, job: c.req.param("id") });
    return relayStream(res, "attachment", "private, no-store");
  });

  app.get("/api/outils/medias/:id/planche", async (c) => {
    const u = user(c);
    const id = jobId(c);
    return relayJson(c, await tools.call(u.id, "GET", `/jobs/${id}/storyboard`), (b) => {
      const body = { ...((b ?? {}) as Json) };
      delete body.image_url;
      return { ...body, image: num(body.count) ? `/api/outils/medias/${id}/planche.jpg` : null };
    });
  });

  app.get("/api/outils/medias/:id/planche.jpg", async (c) => {
    const u = user(c);
    const res = await tools.call(u.id, "GET", `/jobs/${jobId(c)}/storyboard.jpg`);
    if (res.status !== 200) return relayJson(c, res);
    return relayStream(res, null, "private, max-age=3600");
  });

  app.get("/api/outils/medias/:id/onde", async (c) => {
    const u = user(c);
    return relayJson(c, await tools.call(u.id, "GET", `/jobs/${jobId(c)}/waveform`));
  });

  // Export (retouche) : un à la fois ; ytapi valide chaque champ (et refuse tout champ inconnu). Quota d'export du jour
  // (minutes pondérées, plans.ts) réservé AVANT ytapi, d'après la demande et la sonde du média ; rendu si ytapi refuse
  // ou rejoint un export identique déjà fait (aucun travail nouveau). Le même décompte vaut pour tous les accès.
  app.post("/api/outils/medias/:id/exports", async (c) => {
    const u = user(c);
    take(heavy, u.id);
    { const g = await s.antibot.guard(c, "travaux"); if (g.deny) return g.deny; }  // anti-bot : travaux du site
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "invalid_body", TEXT.invalidBody);
    const id = jobId(c);
    const op = String((body as Json).op ?? "").slice(0, 20);
    let minutes = 0;
    if (exportWeight(op, null) > 0) {
      const probe = await tools.call(u.id, "GET", `/jobs/${id}/media`);
      if (probe.status !== 200) return relayJson(c, probe);
      const m = (await probe.json().catch(() => null)) as Json | null;
      const duration = num(m?.duration);
      if (duration === null) throw new HttpError(502, "upstream_error", "Le média n'a pas pu être mesuré : réessaie dans un instant.");
      minutes = exportCost(body as Json, { duration, width: num(m?.width), height: num(m?.height) });
    }
    // Empreinte de la demande : source + réglages en ordre stable (la même demande → la même empreinte).
    const canon = (v: unknown): unknown => (v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v as Json).sort().map((k) => [k, canon((v as Json)[k])])) : v);
    const key = createHash("sha256").update(`${id}|${JSON.stringify(canon(body))}`).digest("hex");
    const r = await s.usage.reserveExport(u.id, ["video", "compress", "gif", "audio", "apercu", "echantillon"].includes(op) ? op : "video", minutes, key);
    if (!r.ok) {
      const f = (x: number) => String(Math.round(x * 10) / 10).replace(".", ",");
      c.header("Retry-After", String(r.retryAfterS));
      return err(c, 429, "export_quota", `Limite d'export du jour : ${f(r.used)} min utilisées sur ${r.limit}, cet export en compte ${f(r.minutes)}. ` +
        "Elle revient à minuit. Un passage plus court ou une qualité plus légère compte moins ; le son ne compte pas.");
    }
    let res: Response;
    try { res = await tools.call(u.id, "POST", `/jobs/${id}/derive`, { json: body }); } catch (e) { await s.usage.settleExport(r.id, "rendu"); throw e; }
    const out = (await res.clone().json().catch(() => null)) as Json | null;
    const jid = typeof out?.job_id === "string" ? out.job_id.slice(0, 64) : null;
    const counted = !(res.status >= 400 || out?.merged === true || !jid);
    // Demande identique que ytapi a vraiment refaite (fichier expiré) : comptée après coup.
    await s.usage.settleExport(r.id, counted ? "compte" : "rendu", jid, counted && r.identical ? r.minutes : null);
    log("info", "tools export requested", { user: u.id, op, status: res.status, minutes });
    return relayJson(c, res, shapeJob);
  });

  app.post("/api/outils/medias/:id/garder", async (c) => {
    const u = user(c);
    return relayJson(c, await tools.call(u.id, "POST", `/jobs/${jobId(c)}/keep`), (b) => ({ expiresAt: str((b as Json | null)?.expires_at, 40) }));
  });

  app.delete("/api/outils/medias/:id", async (c) => {
    const u = user(c);
    // Le média ET ce qui en a été fait : un fichier supprimé ne laisse aucun export derrière lui.
    return relayJson(c, await tools.call(u.id, "DELETE", `/jobs/${jobId(c)}?with_exports=true`), () => ({ deleted: true }));
  });

  // Lien « Ouvrir dans AETHRYON Tools » (bot Discord) : le compte connecté doit être celui du lien.
  app.post("/api/outils/references", async (c) => {
    const u = user(c);
    take(refLimiter, u.id);
    const b = (await c.req.json().catch(() => null)) as { ref?: unknown } | null;
    const id = typeof b?.ref === "string" ? await tools.redeemRef(u.id, b.ref) : null;
    if (!id) return err(c, 404, "ref_gone", TEXT.refGone);
    return c.json({ id });
  });
}

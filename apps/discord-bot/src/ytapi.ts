// Client de l'API publique de conversion (ytapi), comme le raccourci et l'extension : la clé ytc_ « discord »
// de 15 min voyage UNIQUEMENT dans l'en-tête Authorization (jamais dans une URL ni un journal). ytapi est
// inchangé : il valide la clé auprès d'account et réserve l'unité de quota du compte à la création du job.
// Lus : état, étape, progression, plateforme, code d'erreur et, une fois terminé, le titre, le nom, la taille et le
// type du fichier (version 2 : affichés dans la carte privée du résultat, JAMAIS journalisés ni conservés).

export type JobStatus = "queued" | "running" | "done" | "error";

export interface Job {
  id: string;
  status: JobStatus;
  stage: string | null;
  /** Progression réelle de ytapi (0–100), jamais simulée. */
  progress: number | null;
  platform: string | null;
  /** Code stable de ytapi en cas d'échec (docs/ERREURS.md). */
  error: string | null;
  /** Terminé : titre de la vidéo, nom du fichier, taille exacte (octets) et type (null si absents). */
  title?: string | null;
  filename?: string | null;
  sizeBytes?: number | null;
  mediaType?: string | null;
  /** Remarques de ytapi sur le fichier livré (ex. « Image réduite à 540p… ») : affichées telles quelles, jamais journalisées. */
  notes?: string[];
  /** Échec dû à une pause de la plateforme (YouTube qui bloque le serveur) : secondes avant qu'un nouvel essai soit accepté. */
  retryAfterS?: number | null;
}

/** Paramètres d'une conversion (sous-ensemble de ytapi/app/params.py ouvert au bot). `start`/`end` : extrait, en
 *  secondes (MEDIA_TOOLS_ENABLED côté ytapi ; 180 s au plus en MP4, 600 s en MP3). */
export interface JobParams { fmt: "mp3" | "mp4"; quality?: "1080" | "720" | null; bitrate?: 128 | 192 | 320 | null; start?: number | null; end?: number | null }

/** Fichier dérivé d'une conversion MP4 terminée (POST /jobs/{id}/derive) : sans nouveau téléchargement ni unité de quota. */
export type DeriveParams =
  | { op: "compress"; maxBytes: number }
  | { op: "gif"; start: number; duration: number; maxBytes?: number | null; width?: number; fps?: number };

/** Aperçu (POST /preview) : seulement les champs de ytapi (preview_view), jamais d'URL de flux ni d'identifiant. */
export interface PreviewQuality { quality: number | null; estSizeBytes: number | null; h264: boolean }
export interface PreviewItem {
  title: string | null; uploader: string | null; durationS: number | null; thumbnail: string | null; isGif: boolean; live: boolean;
  /** Piste son : true (annoncée), false (GIF X, toujours muet), null (la plateforme ne le dit pas : jamais « pas de son »). */
  bestH264: number | null; audioAvailable: boolean | null; qualities: PreviewQuality[]; mp3Bytes: { 128?: number; 192?: number; 320?: number };
  limits: { tooLong: boolean; gifAllowed: boolean; transcodeAllowed: boolean };
}
export interface Preview extends PreviewItem { platform: string | null; mediaCount: number; entries: (PreviewItem & { index: number })[] }

/** Refus de ytapi : code stable (`error`), statut HTTP, attente conseillée (Retry-After). */
export class YtapiError extends Error {
  code: string;
  status: number;
  retryAfterS: number | null;
  constructor(code: string, status: number, retryAfterS: number | null = null) { super(code); this.code = code; this.status = status; this.retryAfterS = retryAfterS; }
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal; redirect: "manual" }) =>
  Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

const JOB_ID = /^[A-Za-z0-9_-]{1,40}$/;
const STATUSES: ReadonlySet<string> = new Set(["queued", "running", "done", "error"]);

function parseJob(body: unknown): Job | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.job_id !== "string" || !JOB_ID.test(b.job_id) || typeof b.status !== "string" || !STATUSES.has(b.status)) return null;
  const progress = typeof b.progress === "number" && Number.isFinite(b.progress) ? Math.max(0, Math.min(100, b.progress)) : null;
  return {
    id: b.job_id,
    status: b.status as JobStatus,
    stage: typeof b.stage === "string" ? b.stage.slice(0, 32) : null,
    progress,
    platform: typeof b.platform === "string" ? b.platform.slice(0, 32) : null,
    error: typeof b.error === "string" && /^[a-z_]{2,40}$/.test(b.error) ? b.error : null,
    title: typeof b.title === "string" ? b.title.slice(0, 300) : null,
    filename: typeof b.filename === "string" ? b.filename.slice(0, 300) : null,
    sizeBytes: typeof b.size_bytes === "number" && Number.isFinite(b.size_bytes) && b.size_bytes >= 0 ? b.size_bytes : null,
    mediaType: typeof b.media_type === "string" ? b.media_type.slice(0, 80) : null,
    notes: Array.isArray(b.notes) ? b.notes.filter((n): n is string => typeof n === "string").slice(0, 3).map((n) => n.slice(0, 200)) : [],
    retryAfterS: typeof b.retry_after_s === "number" && Number.isInteger(b.retry_after_s) && b.retry_after_s > 0 ? Math.min(b.retry_after_s, 86_400) : null,
  };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

function parseItem(v: unknown): PreviewItem {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const sizes = (o.est_size_bytes && typeof o.est_size_bytes === "object" ? o.est_size_bytes : {}) as Record<string, unknown>;
  const limits = (o.limits && typeof o.limits === "object" ? o.limits : {}) as Record<string, unknown>;
  const thumb = str(o.thumbnail, 2048);
  const mp3: PreviewItem["mp3Bytes"] = {};
  for (const br of [128, 192, 320] as const) { const n = num(sizes[`mp3_${br}`]); if (n !== null) mp3[br] = n; }
  return {
    title: str(o.title, 300), uploader: str(o.uploader, 100), durationS: num(o.duration),
    thumbnail: thumb && thumb.startsWith("https://") ? thumb : null,
    isGif: o.is_gif === true, live: o.live === true, bestH264: num(o.best_h264_quality),
    audioAvailable: o.audio === "yes" ? true : o.audio === "no" ? false : null,
    qualities: (Array.isArray(o.qualities) ? o.qualities : []).slice(0, 8).map((q) => {
      const x = (q && typeof q === "object" ? q : {}) as Record<string, unknown>;
      return { quality: num(x.quality), estSizeBytes: num(x.est_size_bytes), h264: x.h264 === true };
    }),
    mp3Bytes: mp3,
    limits: { tooLong: limits.too_long === true, gifAllowed: limits.gif_allowed !== false, transcodeAllowed: limits.transcode_allowed !== false },
  };
}

export function parsePreview(body: unknown): Preview | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.platform !== "string") return null;
  const entries = Array.isArray(b.entries) ? b.entries.slice(0, 10).map((e, i) => ({ ...parseItem(e), index: num((e as Record<string, unknown>)?.index) ?? i + 1 })) : [];
  const first = entries[0];
  const main = parseItem(b);
  return {
    ...(first ? { ...first, title: main.title ?? first.title, uploader: main.uploader ?? first.uploader } : main),
    platform: b.platform.slice(0, 32), mediaCount: num(b.media_count) ?? (entries.length || 1), entries,
  };
}

/** Refus de ytapi → code stable. Route absente (outils non ouverts côté ytapi : MEDIA_TOOLS_ENABLED) : son 404
 *  « not_found / Route inconnue. » n'est PAS une vidéo introuvable → « tools_unavailable ». */
function refusal(res: { status: number; headers: { get(name: string): string | null } }, parsed: unknown): YtapiError {
  const retry = Number(res.headers.get("retry-after"));
  const b = (parsed ?? {}) as { error?: unknown; detail?: unknown };
  const code = res.status === 404 && b.error === "not_found" && b.detail === "Route inconnue." ? "tools_unavailable"
    : typeof b.error === "string" && /^[a-z_]{2,40}$/.test(b.error) ? b.error : res.status >= 500 ? "api_unreachable" : "upstream_error";
  return new YtapiError(code, res.status, Number.isFinite(retry) && retry > 0 ? retry : null);
}

export class YtapiClient {
  private base: string;
  private fetchFn: Fetch;
  constructor(base: string, fetchFn: Fetch = fetch as unknown as Fetch) { this.base = base; this.fetchFn = fetchFn; }

  private async call(key: string, method: "GET" | "POST", path: string, body: unknown, timeoutMs: number): Promise<Job> {
    let res: Awaited<ReturnType<Fetch>>;
    try {
      res = await this.fetchFn(`${this.base}${path}`, {
        method,
        headers: { authorization: `Bearer ${key}`, accept: "application/json", "user-agent": "AETHRYON-Discord", ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "manual",
      });
    } catch (e) {
      throw new YtapiError((e as { name?: string })?.name === "TimeoutError" ? "upstream_timeout_api" : "api_unreachable", 0);
    }
    const text = await res.text().catch(() => "");
    let parsed: unknown = null;
    if (text) { try { parsed = JSON.parse(text); } catch { parsed = null; } }
    const job = parseJob(parsed);
    // Job lisible (202 en cours, 200 terminé, ou 4xx/5xx d'un job en échec : le code est dans le job).
    if (job) return job;
    throw refusal(res, parsed);
  }

  /** Crée (ou rejoint) un job ; le quota est réservé par ytapi via account. `p` : format, ou paramètres complets. */
  createJob(key: string, url: string, p: "mp3" | "mp4" | JobParams): Promise<Job> {
    const params: JobParams = typeof p === "string" ? { fmt: p } : p;
    const body: Record<string, unknown> = { url, fmt: params.fmt };
    if (params.fmt === "mp4" && params.quality) body.quality = params.quality;
    if (params.fmt === "mp3" && params.bitrate) body.bitrate = params.bitrate;
    if (typeof params.start === "number" && typeof params.end === "number") { body.start_s = params.start; body.end_s = params.end; }
    return this.call(key, "POST", "/jobs", body, 30_000);
  }

  /** Compression ou GIF à partir d'une conversion MP4 terminée du même compte (aucune unité de quota en plus). */
  derive(key: string, jobId: string, p: DeriveParams): Promise<Job> {
    if (!JOB_ID.test(jobId)) return Promise.reject(new YtapiError("bad_job", 0));
    const body: Record<string, unknown> = p.op === "compress"
      ? { op: "compress", max_bytes: Math.floor(p.maxBytes) }
      : { op: "gif", start_s: p.start, duration_s: p.duration, ...(p.maxBytes ? { max_bytes: Math.floor(p.maxBytes) } : {}), ...(p.width ? { gif_width: p.width } : {}), ...(p.fps ? { gif_fps: p.fps } : {}) };
    return this.call(key, "POST", `/jobs/${encodeURIComponent(jobId)}/derive`, body, 30_000);
  }

  /** Aperçu d'un lien (une lecture sur la plateforme, aucun téléchargement, aucune unité de quota). */
  async preview(key: string, url: string): Promise<Preview> {
    let res: Awaited<ReturnType<Fetch>>;
    try {
      res = await this.fetchFn(`${this.base}/preview`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, accept: "application/json", "user-agent": "AETHRYON-Discord", "content-type": "application/json" },
        body: JSON.stringify({ url }), signal: AbortSignal.timeout(60_000), redirect: "manual",
      });
    } catch (e) {
      throw new YtapiError((e as { name?: string })?.name === "TimeoutError" ? "upstream_timeout_api" : "api_unreachable", 0);
    }
    const text = await res.text().catch(() => "");
    let parsed: unknown = null;
    if (text) { try { parsed = JSON.parse(text); } catch { parsed = null; } }
    const preview = res.status === 200 ? parsePreview(parsed) : null;
    if (preview) return preview;
    throw refusal(res, parsed);
  }

  /** État du job ; `waitS` (≤ 25) : réponse retenue jusqu'à la fin du job (long polling de ytapi). */
  job(key: string, jobId: string, waitS: number): Promise<Job> {
    if (!JOB_ID.test(jobId)) return Promise.reject(new YtapiError("bad_job", 0));
    const w = Math.max(0, Math.min(25, Math.floor(waitS)));
    return this.call(key, "GET", `/jobs/${encodeURIComponent(jobId)}${w ? `?wait=${w}` : ""}`, null, (w + 10) * 1000);
  }
}

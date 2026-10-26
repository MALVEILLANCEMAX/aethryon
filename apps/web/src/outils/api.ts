// AETHRYON Tools : accès à /api/outils (account relaie à ytapi). Aucune clé dans le navigateur : la session suffit.
// Import d'un fichier par morceaux de 5 Mio (chaque requête reste courte, reprise possible morceau par morceau) ;
// lecture du fichier lu localement (blob:) pendant l'envoi, sans jamais le charger entier en mémoire (File.slice).
import { api as baseApi, ApiError } from "../lib/api.ts";
// Travaux du site (aperçu, ouverture, import, export) : vérification de sécurité si le serveur l'exige (anti-bot).
import { verified } from "../lib/verification.ts";

/**
 * Appel de /api/outils : quand l'atelier est fermé côté serveur (account sans TOOLS_ENABLED : route inconnue), une
 * phrase claire plutôt que « Route inconnue. » ; un média absent garde sa propre réponse (job_not_found).
 */
const CLOSED = "AETHRYON Tools n'est pas disponible pour le moment. Réessaie plus tard.";
async function api<T>(path: string, init?: Parameters<typeof baseApi>[1]): Promise<T> {
  try {
    return await baseApi<T>(path, init);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404 && e.code === "not_found") throw new ApiError(503, "tools_unavailable", CLOSED);
    throw e;
  }
}

export type JobStatus = "queued" | "running" | "done" | "error";

export interface MediaInfo {
  duration: number;
  size_bytes: number;
  bit_rate: number | null;
  has_video: boolean;
  has_audio: boolean;
  container: string;
  width?: number;
  height?: number;
  fps?: number | null;
  video_codec?: string;
  rotation?: number;
  audio_codec?: string;
  sample_rate?: number | null;
  channels?: number | null;
  audio_bit_rate?: number | null;
  playable: boolean;
}

export interface ToolsJob {
  id: string;
  kind: "download" | "upload" | "derive";
  status: JobStatus | null;
  stage: string | null;
  progress: number | null;
  platform: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  expiresAt: string | null;
  title: string | null;
  filename: string | null;
  sizeBytes: number | null;
  mediaType: string | null;
  notes: string[];
  media: MediaInfo | null;
  upload: { size_bytes: number; chunk_bytes: number; chunks: number; received: number[]; name?: string | null } | null;
  derive?: Record<string, unknown> & { op: string; sourceId: string | null };
  statusUrl: string;
  streamUrl: string | null;
  fileUrl: string | null;
  error?: string | null;
  message?: string | null;
  retryAfterS?: number | null;
}

export interface ToolsLimits {
  ttlMin: number | null;
  keepMin: number | null;
  keepMaxMin: number | null;
  maxUploadMb: number | null;
  chunkMb: number | null;
  maxDurationS: number | null;
  videoMaxS: number | null;
  gifMaxS: number | null;
}

export interface Preview {
  platform: string | null;
  mediaCount: number;
  title: string | null;
  uploader: string | null;
  duration: number | null;
  thumbnail: string | null;
  isGif: boolean;
  live: boolean;
  audio: string | null;
  bestH264: number | null;
  qualities: { quality: number | null; est_size_bytes: number | null; h264: boolean }[];
  sizes: Record<string, number>;
  limits: Record<string, boolean>;
  entries?: (Omit<Preview, "entries" | "mediaCount" | "platform"> & { index: number | null })[];
}

export const listMedia = () => api<{ items: ToolsJob[]; limits: ToolsLimits }>("/api/outils/medias");
export const getJob = (id: string, waitS = 0, signal?: AbortSignal, follow = false) =>
  api<ToolsJob>(`/api/outils/medias/${encodeURIComponent(id)}${waitS ? `?attendre=${waitS}${follow ? "&suivi=1" : ""}` : ""}`, { signal });
export const getInfo = (id: string) => api<MediaInfo>(`/api/outils/medias/${encodeURIComponent(id)}/infos`);
export const preview = (url: string) => verified((v) => api<Preview>("/api/outils/apercu", { method: "POST", body: { url }, ...v }));
export const openSource = (body: { url: string; quality?: string; transcode?: boolean; index?: number }) =>
  verified((v) => api<ToolsJob>("/api/outils/sources", { method: "POST", body, ...v }));
export const deriveJob = (id: string, body: Record<string, unknown>) =>
  verified((v) => api<ToolsJob>(`/api/outils/medias/${encodeURIComponent(id)}/exports`, { method: "POST", body, ...v }));
export const keepJob = (id: string) => api<{ expiresAt: string | null }>(`/api/outils/medias/${encodeURIComponent(id)}/garder`, { method: "POST" });
export const deleteJob = (id: string) => api<{ deleted: boolean }>(`/api/outils/medias/${encodeURIComponent(id)}`, { method: "DELETE" });
export const redeemRef = (ref: string) => api<{ id: string }>("/api/outils/references", { method: "POST", body: { ref } });

export interface Storyboard { count: number; cols?: number; rows?: number; tile_w?: number; tile_h?: number; interval_s?: number; duration?: number; image?: string | null }
export interface Waveform { count: number; duration?: number; peaks?: number[] }
export const getStoryboard = (id: string) => api<Storyboard>(`/api/outils/medias/${encodeURIComponent(id)}/planche`);
export const getWaveform = (id: string) => api<Waveform>(`/api/outils/medias/${encodeURIComponent(id)}/onde`);

/** Attend la fin d'un job (attente longue côté serveur, 15 s par requête) ; `onUpdate` à chaque état reçu. */
/** Attente interrompue par l'annulation, ou écourtée par le retour du réseau. */
function nap(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => { window.clearTimeout(t); window.removeEventListener("online", done); signal.removeEventListener("abort", stop); resolve(); };
    const stop = () => { done(); reject(new DOMException("annulé", "AbortError")); };
    const t = window.setTimeout(done, ms);
    window.addEventListener("online", done);
    signal.addEventListener("abort", stop);
  });
}

/**
 * Suit un travail jusqu'à sa fin. Réseau coupé : le travail continue sur le serveur, on attend donc le retour de la
 * connexion sans abandonner (`onTrouble(true)` le signale, `onTrouble(false)` à la reprise). Serveur en erreur : six
 * essais espacés, puis échec.
 */
export async function waitJob(id: string, onUpdate: (j: ToolsJob) => void, signal: AbortSignal, onTrouble?: (lost: boolean) => void): Promise<ToolsJob> {
  let failures = 0;
  let offline = 0;
  for (;;) {
    if (signal.aborted) throw new DOMException("annulé", "AbortError");
    try {
      const j = await getJob(id, 15, signal, true); // réponse dès que la progression bouge (2 s au plus souvent)
      if (offline) onTrouble?.(false);
      failures = 0; offline = 0;
      onUpdate(j);
      if (j.status === "done" || j.status === "error") return j;
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      if (e instanceof ApiError && !e.isServer) throw e;
      if (e instanceof ApiError && e.isNetwork) {
        if (!offline) onTrouble?.(true);
        offline += 1;
        await nap(Math.min(8000, 1000 * offline), signal);
        continue;
      }
      failures += 1;
      if (failures > 6) throw e;
      await nap(Math.min(8000, 1000 * failures), signal);
    }
  }
}

// ---- import par morceaux ----------------------------------------------------------------------------------------

/** `waiting` : fichier entièrement envoyé, sa vérification attend la fin d'un autre traitement du compte. */
export interface UploadProgress { sent: number; total: number; chunk: number; chunks: number; speedBps: number | null; waiting?: boolean }

function putChunk(url: string, body: Blob, onProgress: (loaded: number) => void, signal: AbortSignal): Promise<void> {
  // XMLHttpRequest : seul moyen d'avoir la progression d'un envoi (fetch ne la donne pas).
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.withCredentials = true;
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { resolve(); return; }
      let data: { error?: string; message?: string } = {};
      try { data = JSON.parse(xhr.responseText); } catch { data = {}; }
      const retryAfterS = Number(xhr.getResponseHeader("retry-after")) || null;
      reject(new ApiError(xhr.status, data.error ?? "upload_error", data.message ?? "Envoi interrompu.", { retryAfterS }));
    };
    xhr.onerror = () => reject(new ApiError(0, "network", "Connexion perdue pendant l'envoi."));
    xhr.onabort = () => reject(new DOMException("annulé", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

/** Attente interrompue par l'abandon de l'envoi. */
const pause = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(new DOMException("annulé", "AbortError")); return; }
  const t = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, ms);
  const stop = () => { clearTimeout(t); reject(new DOMException("annulé", "AbortError")); };
  signal.addEventListener("abort", stop, { once: true });
});

/** Attentes de débit permises pendant un envoi (une connexion très rapide atteint la limite par minute du serveur). */
const MAX_RATE_WAITS = 40;

/**
 * Envoie `file` dans l'import `job` (créé par startUpload ou repris) : seuls les morceaux absents partent ; chaque
 * morceau est réessayé (3 fois, avec attente) avant d'abandonner. Une limite de débit (429) n'est pas un échec : on
 * attend le délai dit par le serveur (Retry-After) et on reprend. Termine par la vérification du fichier sur le
 * serveur ; renvoie le job tel qu'il est alors (souvent encore « checking »).
 */
export async function sendFile(job: ToolsJob, file: File, onProgress: (p: UploadProgress) => void, signal: AbortSignal): Promise<ToolsJob> {
  const up = job.upload;
  if (!up) throw new ApiError(409, "upload_closed", "Cet import n'attend plus de fichier.");
  const done = new Set(up.received);
  const started = performance.now();
  let base = [...done].reduce((s, i) => s + Math.min(up.chunk_bytes, file.size - i * up.chunk_bytes), 0);
  const firstBase = base;
  let rateWaits = 0;
  for (let i = 0; i < up.chunks; i++) {
    if (done.has(i)) continue;
    const start = i * up.chunk_bytes;
    const blob = file.slice(start, Math.min(file.size, start + up.chunk_bytes));
    for (let attempt = 1; ; attempt++) {
      try {
        await putChunk(`/api/outils/imports/${encodeURIComponent(job.id)}/morceaux/${i}`, blob, (loaded) => {
          const sent = base + loaded;
          const s = (performance.now() - started) / 1000;
          onProgress({ sent, total: file.size, chunk: i, chunks: up.chunks, speedBps: s > 1 ? (sent - firstBase) / s : null });
        }, signal);
        break;
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        if (e instanceof ApiError && e.status === 429 && rateWaits < MAX_RATE_WAITS) {
          rateWaits += 1;
          attempt -= 1; // pas un échec : le serveur dit quand reprendre
          await pause(Math.min(60, Math.max(1, Number(e.data?.retryAfterS) || 5)) * 1000, signal);
          continue;
        }
        if (attempt >= 3 || (e instanceof ApiError && e.status >= 400 && e.status < 500)) throw e;
        await pause(1500 * attempt, signal);
      }
    }
    base += blob.size;
  }
  onProgress({ sent: file.size, total: file.size, chunk: up.chunks, chunks: up.chunks, speedBps: null });
  // La vérification compte comme un traitement du compte : quand un autre tourne déjà (export, conversion), le serveur
  // la refuse pour l'instant (429 active_job_limit) ; le fichier est là, on attend donc qu'il se libère.
  for (let waits = 0; ; waits++) {
    try {
      return await api<ToolsJob>(`/api/outils/imports/${encodeURIComponent(job.id)}/terminer`, { method: "POST", signal });
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 429 && e.code === "active_job_limit") || waits >= MAX_RATE_WAITS) throw e;
      onProgress({ sent: file.size, total: file.size, chunk: up.chunks, chunks: up.chunks, speedBps: null, waiting: true });
      await pause(Math.min(60, Math.max(1, Number(e.data?.retryAfterS) || 15)) * 1000, signal);
    }
  }
}

export const startUpload = (file: File) =>
  verified((v) => api<ToolsJob>("/api/outils/imports", { method: "POST", body: { name: file.name.slice(0, 255), size: file.size, type: file.type.slice(0, 100) }, ...v }));

// ---- fichiers locaux en cours d'envoi : gardés le temps de la page (aperçu immédiat, reprise) -------------------

const localFiles = new Map<string, File>();
export const rememberFile = (id: string, f: File) => localFiles.set(id, f);
export const localFile = (id: string) => localFiles.get(id) ?? null;
export const forgetFile = (id: string) => localFiles.delete(id);

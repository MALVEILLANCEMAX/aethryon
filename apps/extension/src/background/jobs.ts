// Jobs de téléchargement (docs/EXTENSION.md §4) :
// queued → converting (ytapi) → downloading (le NAVIGATEUR écrit le fichier, chrome.downloads) → done,
// ou error / cancelled. « done » seulement quand Chrome dit que le fichier est complet. Chaque transition
// est écrite dans storage.session et envoyée à l'onglet d'origine et aux pages de l'extension.
// 3.8.1 : « Envoyer vers › Premiere Pro » (vidéo ou audio) n'appelle plus ytapi et ne télécharge plus rien par Chrome :
// le travail est relayé à AETHRYON Desktop (relais.ts), qui convertit avec SA clé et importe dans Premiere Pro ;
// queued (« Envoyé à AETHRYON Desktop ») → converting → downloading (le Desktop reçoit le fichier, puis l'import)
// → done (« Importé dans Premiere Pro »), ou error avec le motif réel.
import { API_BASE } from "../shared/config.ts";
import { consentOutdated } from "../shared/consent.ts";
import { etapeOf, laterEtape, progressionOf, type Etape } from "../shared/etapes.ts";
import { toMs } from "../shared/extrait.ts";
import { cleanText, type StartJob, type TabMessage } from "../shared/messages.ts";
import { premiereQuality } from "../shared/premiere.ts";
import { getAuth, getSettings, getStoredAuth } from "../shared/storage.ts";
import type { Clip, JobError, JobState, JobView } from "../shared/types.ts";
import { parseMediaUrl, safeThumbnail, type Platform } from "../shared/urls.ts";
import {
  apiError, BgError, classifyInterrupt, consentRequired, isObj, jobError, MSG, networkError, unexpectedError,
} from "./errors.ts";
import { http, type FetchFn, type HttpResult } from "./http.ts";
import { frameFileName, thumbFileName } from "./filenames.ts";
import { notifyJob } from "./notify.ts";
import { DESKTOP_HOST, tracksDesktop, type NativePort } from "./desktop.ts";
import { createPremiereRelay, relayRequest, type RelayStatus } from "./relais.ts";
import { createPremiereRouter, type FilenameEvent } from "./premiere.ts";
import { createJobStore, isActive, toView, type StoredJob } from "./store.ts";
import { sleep, type Timing } from "./timing.ts";

export const ALARM = "aethryon-jobs";
const KEY_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const JOB_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const STAGE_RE = /^[a-z_]{1,32}$/;

export function newKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => KEY_ALPHABET[b % KEY_ALPHABET.length]).join("");
}

/** Fichier d'un job : même origine que l'API et chemin de CE job uniquement (le jeton n'ira pas ailleurs). */
export function safeFileUrl(raw: unknown, jobId: string, apiBase = API_BASE): string | null {
  if (typeof raw !== "string" || raw.length > 4096 || !JOB_ID_RE.test(jobId)) return null;
  let u: URL;
  let api: URL;
  try {
    u = new URL(raw);
    api = new URL(apiBase);
  } catch {
    return null;
  }
  if (u.origin !== api.origin || u.username || u.password || u.search || u.hash) return null;
  if (!raw.startsWith(`${api.origin}/`)) return null;
  const prefix = `${api.pathname.replace(/\/+$/, "")}/jobs/${jobId}/file`;
  return u.pathname === prefix || u.pathname.startsWith(`${prefix}/`) ? u.href : null;
}

interface ServerStatus {
  jobId: string;
  status: "queued" | "running" | "done" | "error";
  stage?: string;
  progress?: number;
  /** 3.6.0 (extraits) : étape du contrat (ou ancienne étape traduite) et progression MESURABLE seulement (0–100). */
  etape?: Etape;
  progression?: number;
  /** Format du fichier produit (« gif » quand le serveur a fabriqué le GIF lui-même). */
  producedGif?: boolean;
  fileUrl?: unknown;
  title?: string;
  error?: string;
  detail?: string;
  retryAfterS?: number;
}

/** Corps de job ytapi (POST /jobs, GET /jobs/<id>) vérifié champ par champ. */
export function parseStatus(body: unknown): ServerStatus | null {
  if (!isObj(body) || typeof body.job_id !== "string" || !JOB_ID_RE.test(body.job_id)) return null;
  const status = body.status;
  if (status !== "queued" && status !== "running" && status !== "done" && status !== "error") return null;
  const out: ServerStatus = { jobId: body.job_id, status };
  if (typeof body.stage === "string" && STAGE_RE.test(body.stage)) out.stage = body.stage;
  if (typeof body.progress === "number" && Number.isFinite(body.progress)) out.progress = Math.max(0, Math.min(100, Math.round(body.progress)));
  const etape = etapeOf(body);
  if (etape) out.etape = etape;
  const measured = progressionOf(body);
  if (measured !== null) out.progression = measured;
  const params = isObj(body.params) ? body.params : null;
  if (params?.fmt === "gif" || body.fmt === "gif" || (typeof body.media_type === "string" && body.media_type.startsWith("image/gif"))) out.producedGif = true;
  if (body.file_url !== undefined && body.file_url !== null) out.fileUrl = body.file_url;
  if (typeof body.title === "string" && body.title.trim()) out.title = cleanText(body.title, 200);
  if (typeof body.error === "string") out.error = body.error;
  if (typeof body.detail === "string") out.detail = body.detail;
  if (typeof body.retry_after_s === "number" && Number.isFinite(body.retry_after_s)) out.retryAfterS = body.retry_after_s;
  return out;
}

/**
 * Vidéo entière vers Premiere Pro (3.5.1) : MP4 H.264 + AAC garanti par ytapi (transcode=true : pistes copiées si
 * elles le sont déjà, réencodées sinon, tout autre résultat refusé par le serveur). Un extrait est toujours réencodé
 * en H.264 + AAC par le serveur : rien à demander de plus (transcode changerait seulement la source choisie).
 */
export function premiereVideo(job: Pick<StoredJob, "dest" | "fmt" | "clip" | "kind">): boolean {
  return job.dest === "premiere" && job.fmt === "mp4" && !job.clip && job.kind === undefined;
}

export function requestBody(job: StoredJob): Record<string, unknown> {
  // 3.6.0 : un GIF est demandé directement au serveur (format « gif » du contrat des extraits) ; un serveur qui ne sait
  // pas encore faire un GIF d'un passage (400) reçoit l'ancienne demande : extrait MP4, puis GIF tiré de l'extrait.
  const gif = job.kind === "gif" && !!job.clip && !job.gifLegacy;
  const body: Record<string, unknown> = { url: job.url, fmt: gif ? "gif" : job.fmt };
  const premiere = premiereVideo(job);
  if (job.fmt === "mp4" && job.quality && !gif) body.quality = premiere ? premiereQuality(job.quality) : job.quality;
  if (job.fmt === "mp3" && job.bitrate) body.bitrate = job.bitrate;
  if (job.index) body.index = job.index;
  // Extrait : le serveur ne récupère et n'encode que ce passage (une conversion du quota, comme une vidéo entière).
  // 3.6.0 : millisecondes entières (startMs / endMs, contrat des extraits) ; le serveur valide tout lui-même.
  if (job.clip && job.clipSeconds) {
    // Serveur d'avant le contrat des extraits : secondes, à la milliseconde (comme la 3.5.2).
    body.start_s = job.clip.start;
    body.end_s = job.clip.end;
  } else if (job.clip) {
    const r = toMs(job.clip);
    body.startMs = r.startMs;
    body.endMs = r.endMs;
  }
  if (premiere) body.transcode = true;
  return body;
}

/**
 * GIF tiré d'un extrait MP4 (V3) : 480 px de large, 12 images par seconde, toute la durée de l'extrait, sous 8 Mio
 * (le serveur réduit la taille puis la cadence jusqu'à tenir : un GIF de 10 s en 480 px dépasse sinon 13 Mo).
 */
export const GIF_MAX_BYTES = 8 * 1024 * 1024;
export function gifBody(clip: Clip): Record<string, unknown> {
  return { op: "gif", start_s: 0, duration_s: Math.round((clip.end - clip.start) * 1000) / 1000, gif_width: 480, gif_fps: 12, max_bytes: GIF_MAX_BYTES };
}

const sameClip = (a?: Clip, b?: Clip): boolean => (!a && !b) || (!!a && !!b && a.start === b.start && a.end === b.end);
const sameRequest = (a: StoredJob, b: StoredJob): boolean =>
  a.url === b.url && a.fmt === b.fmt && a.quality === b.quality && a.bitrate === b.bitrate && a.index === b.index &&
  a.kind === b.kind && a.dest === b.dest && sameClip(a.clip, b.clip);

/**
 * Premiere Pro : la vidéo n'existe pas en H.264 à cette qualité et elle est trop longue pour que le serveur la
 * réencode ; on dit quoi faire (le texte du serveur parle de son paramètre « transcode »).
 */
export function forDestination(job: Pick<StoredJob, "dest">, error: JobError): JobError {
  if (job.dest === "premiere" && error.code === "transcode_too_long") return jobError(error.code, MSG.premiereTooLong, false);
  return error;
}

/** 3.8.1 : état final d'un envoi relayé à AETHRYON Desktop (autre que « importe ») → erreur montrée telle quelle. */
export function relayError(s: Pick<RelayStatus, "etat" | "message">): JobError {
  // 3.9.0 : Desktop trop ancien (son hôte ne connaît pas `envoyer-premiere`) : code à part, le popup propose « Mettre à
  // jour AETHRYON Desktop » (lien vers la page d'installation du site).
  if (s.message === MSG.desktopOutdated) return jobError("desktop_outdated", MSG.desktopOutdated, false);
  switch (s.etat) {
    case "premiere-absent":
      return jobError("premiere_absent", s.message ?? MSG.premiereClosed, false);
    case "sans-projet":
      return jobError("premiere_no_project", s.message ?? MSG.premiereNoProject, false);
    case "non-relie":
      return jobError("desktop_not_linked", s.message ?? MSG.desktopNotLinked, true);
    case "desktop-absent":
      return jobError("desktop_absent", s.message ?? MSG.desktopAbsent, true);
    default:
      return jobError("premiere_failed", s.message ?? MSG.premiereFailed, true);
  }
}

/** Miniature à enregistrer : YouTube en grand (1280 px) avec repli sur la taille toujours présente (480 px). */
export function thumbSources(url: string): { primary: string; fallback?: string } | null {
  const safe = safeThumbnail(url);
  if (!safe) return null;
  const m = /^https:\/\/i\.ytimg\.com\/vi(?:_webp)?\/([A-Za-z0-9_-]{11})\//.exec(safe);
  if (m) return { primary: `https://i.ytimg.com/vi/${m[1]}/maxresdefault.jpg`, fallback: `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` };
  return { primary: safe };
}

function basename(path: string): string {
  return cleanText(path.split(/[\\/]/).pop() ?? "", 255);
}

/** Retire les champs mis à undefined (une erreur effacée disparaît vraiment du stockage). */
function compact(job: StoredJob): StoredJob {
  for (const k of Object.keys(job) as (keyof StoredJob)[]) if (job[k] === undefined) delete job[k];
  return job;
}

function quiet(fn: () => unknown): void {
  try {
    const p = fn();
    if (p && typeof (p as Promise<unknown>).catch === "function") (p as Promise<unknown>).catch(() => undefined);
  } catch { /* aucun destinataire */ }
}

type Probe = HttpResult | "network";

export interface JobDeps {
  fetch: FetchFn;
  timing: Timing;
  alive: () => boolean;
  /** Un 401 a été reçu avec ce jeton : liaison effacée (si c'est toujours la même) ; renvoie l'erreur à montrer (motif). */
  onUnauthorized: (token: string) => Promise<JobError>;
  /** Aucune liaison utilisable : erreur à montrer (motif connu, sinon « connecte-toi »). */
  authLost: () => Promise<JobError>;
  /** Notice sur les données acceptée ? Sinon, aucune conversion (src/shared/consent.ts). */
  consented: () => Promise<boolean>;
}

export interface StartOptions {
  /** Onglet d'origine (progression envoyée à son content script). */
  tabId?: number;
  /** Demande d'un content script : la vidéo doit être de la plateforme de sa page. */
  platform?: Platform;
}

export type JobManager = ReturnType<typeof createJobManager>;

export function createJobManager(deps: JobDeps) {
  const T = deps.timing;
  const store = createJobStore(deps.alive);
  const controllers = new Map<string, AbortController>(); // attente et suivi d'un job
  const polling = new Set<string>();
  const submitting = new Set<string>();
  const cancelRequested = new Set<string>();
  const tracked = new Map<number, string>(); // downloadId → key
  // Destination « Premiere Pro » : nom « AETHRYON/<nom du serveur> » proposé à Chrome pour NOS fichiers seulement.
  const premiere = createPremiereRouter({
    extensionId: () => chrome.runtime.id,
    event: () => chrome.downloads?.onDeterminingFilename as unknown as FilenameEvent | undefined,
  });
  // 3.8.1 : « Envoyer vers › Premiere Pro » relayé à AETHRYON Desktop (Native Messaging, permission facultative ;
  // sans elle, chrome.runtime.connectNative n'existe pas et l'envoi est refusé avec une explication).
  const nativeConnect = (): NativePort | null => {
    const rt = chrome.runtime as typeof chrome.runtime | undefined;
    return typeof rt?.connectNative === "function" ? (rt.connectNative(DESKTOP_HOST) as unknown as NativePort) : null;
  };
  const relay = createPremiereRelay({
    connect: nativeConnect,
    lastError: () => chrome.runtime?.lastError?.message,
    onStatus: (key, s) => { if (deps.alive()) void onRelay(key, s); },
    permissionText: MSG.desktopPermission,
    pollMs: T.desktopProgressMs, idleMs: T.desktopIdleMs,
  });
  // onChanged arrivé avant que l'identifiant du téléchargement soit enregistré (petit fichier) : rejoué.
  const early = new Map<number, { state: "complete" | "interrupted"; error?: string; at: number }>();
  let progressTimer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;

  const signalFor = (key: string): AbortSignal => {
    let c = controllers.get(key);
    if (!c || c.signal.aborted) {
      c = new AbortController();
      controllers.set(key, c);
    }
    return c.signal;
  };
  const abortWork = (key: string): void => {
    controllers.get(key)?.abort();
    controllers.delete(key);
  };

  // ---- écriture + diffusion ----------------------------------------------------------------------
  function broadcast(job: StoredJob): void {
    if (!deps.alive()) return;
    const msg: TabMessage = { type: "job.update", job: toView(job) };
    quiet(() => chrome.runtime.sendMessage(msg));
    if (typeof job.tabId === "number" && job.tabId >= 0) {
      const tabId = job.tabId;
      quiet(() => chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }));
    }
  }

  async function commit(key: string, fn: (j: StoredJob) => StoredJob | null): Promise<StoredJob | null> {
    const r = await store.update(key, fn);
    if (!r) return null;
    broadcast(r.after);
    if (r.after.state === "done" || r.after.state === "error" || r.after.state === "cancelled") abortWork(key);
    if (r.before.state !== r.after.state) {
      if (isActive(r.before) !== isActive(r.after)) void syncAlarm();
      if (r.after.state === "done" || r.after.state === "error") void notifyJob(r.after);
      // Fichier que le navigateur finissait d'écrire au moment d'une déconnexion (signOut) : son état final
      // vient d'être annoncé à son onglet ; il ne reste pas dans la liste.
      // (Seulement un fichier du serveur : une image ou une miniature enregistrée sans compte reste dans la liste.)
      if (r.before.state === "downloading" && !isActive(r.after) && r.after.jobId !== undefined && !(await getStoredAuth())) await store.remove(key);
    }
    return r.after;
  }

  /** Transition gardée : seulement depuis les états `from` (et si `guard` l'accepte). */
  function transition(
    key: string, from: readonly JobState[], patch: (j: StoredJob) => Partial<StoredJob> | null, guard?: (j: StoredJob) => boolean,
  ): Promise<StoredJob | null> {
    return commit(key, (j) => {
      if (!from.includes(j.state) || (guard && !guard(j))) return null;
      const p = patch(j);
      return p ? compact({ ...j, ...p, updatedAt: Date.now() }) : null;
    });
  }

  const ACTIVE: readonly JobState[] = ["queued", "converting", "downloading"];
  const fail = (key: string, error: JobError, guard?: (j: StoredJob) => boolean) =>
    transition(key, ACTIVE, (j) => ({ state: "error", error: forDestination(j, error), stage: undefined }), guard);
  const markCancelled = (key: string, guard?: (j: StoredJob) => boolean) =>
    transition(key, ACTIVE, () => ({ state: "cancelled", stage: undefined, error: undefined }), guard);

  async function syncAlarm(): Promise<void> {
    if (!deps.alive()) return;
    try {
      const active = (await store.all()).some(isActive);
      const existing = await chrome.alarms.get(ALARM);
      if (active && !existing) await chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
      else if (!active && existing) await chrome.alarms.clear(ALARM);
    } catch { /* alarmes indisponibles : le suivi continue tant que le worker vit */ }
  }

  async function getScoped(key: string, contentTab?: number): Promise<StoredJob> {
    const job = await store.get(key);
    if (!job || (contentTab !== undefined && job.tabId !== contentTab)) throw new BgError(jobError("not_found", MSG.notFound, false));
    return job;
  }

  // ---- création --------------------------------------------------------------------------------
  async function start(req: StartJob, opts: StartOptions = {}): Promise<JobView> {
    const ref = parseMediaUrl(req.url);
    if (!ref) throw new BgError(jobError("unsupported_url", MSG.unsupportedUrl, false));
    if (opts.platform && ref.platform !== opts.platform) throw new BgError(jobError("unsupported_url", MSG.wrongPage, false));
    if (!(await deps.consented())) throw new BgError(consentRequired(await consentOutdated()));
    if (!(await getAuth())) throw new BgError(await deps.authLost());
    const settings = await getSettings();
    const index = ref.platform === "twitter" ? (req.index ?? ref.index) : undefined;
    const now = Date.now();
    const gif = req.gif === true && !!req.clip;
    // Premiere Pro : vidéo ou audio (un GIF reste dans Téléchargements). Absent : Téléchargements, comme avant.
    const dest = req.dest === "premiere" && !gif ? "premiere" as const : undefined;
    // 3.8.1 : relayé à AETHRYON Desktop ; sans la permission « nativeMessaging », rien ne peut partir.
    if (dest && typeof (chrome.runtime as typeof chrome.runtime | undefined)?.connectNative !== "function") {
      throw new BgError(jobError("desktop_permission", MSG.desktopPermission, false));
    }
    const job: StoredJob = compact({
      key: newKey(), url: ref.url, platform: ref.platform, fmt: req.fmt,
      // GIF : l'extrait MP4 en 720p suffit pour une image de 480 px (moins à récupérer et à encoder).
      quality: req.fmt === "mp4" ? (gif ? "720" : (req.quality ?? settings.quality)) : undefined,
      bitrate: req.fmt === "mp3" ? (req.bitrate ?? settings.bitrate) : undefined,
      index, title: req.title || undefined, clip: req.clip, kind: gif ? "gif" : undefined, dest,
      // Extrait (3.6.0) : étapes réelles, et aucune progression tant qu'elle n'est pas mesurée.
      state: "queued", stage: "queued", progress: req.clip ? undefined : 0,
      createdAt: now, updatedAt: now, tabId: opts.tabId,
    });
    // Double clic, ou même vidéo depuis le popup et depuis la page : un seul job.
    const r = await store.insertUnlessActive(job, (j) => sameRequest(j, job));
    if (!r.created) return toView(r.job);
    broadcast(job);
    void syncAlarm();
    void submit(job.key);
    return toView(job);
  }

  async function submit(key: string): Promise<void> {
    if (submitting.has(key) || !deps.alive()) return;
    submitting.add(key);
    try {
      for (;;) {
        const job = await store.get(key);
        if (!job || job.state !== "queued" || job.jobId) return;
        if (cancelRequested.has(key)) {
          await markCancelled(key);
          return;
        }
        // 3.8.1 : Premiere Pro → AETHRYON Desktop (aucune requête à ytapi d'ici, aucun téléchargement par Chrome).
        if (tracksDesktop(job)) {
          const req = relayRequest(job);
          if (req) relay.send(key, req);
          else await fail(key, unexpectedError());
          return;
        }
        const auth = await getAuth();
        if (!auth) {
          await fail(key, await deps.authLost());
          return;
        }
        let res: HttpResult;
        try {
          // Pas d'interruption sur annulation : si le serveur a créé le job, sa réponse donne l'identifiant
          // à supprimer (DELETE) ; sinon le job continuerait sans personne pour le suivre.
          res = await http(deps.fetch, `${API_BASE}/jobs?wait=0`, {
            method: "POST", token: auth.token, json: requestBody(job), timeoutMs: T.requestTimeoutMs,
          });
        } catch {
          if (!deps.alive()) return;
          if (cancelRequested.has(key)) await markCancelled(key);
          else await fail(key, networkError());
          return;
        }
        if (!deps.alive()) return;
        if (cancelRequested.has(key)) {
          // Annulé pendant la création : supprimer le job s'il a été créé, sans attendre ni suivre.
          const created = parseStatus(res.body);
          if (created) await serverCancel(created.jobId, auth.token);
          await markCancelled(key);
          return;
        }
        // Le compte a déjà une conversion en cours (autre onglet, iPhone…) : on attend son tour, sans
        // consommer de quota (le serveur ne décompte qu'à la création réelle).
        const code = isObj(res.body) ? res.body.error : undefined;
        if (res.status === 429 && (code === "active_job_limit" || code === "rate_limited") && Date.now() - job.createdAt < T.accountBusyMaxWaitMs) {
          await transition(key, ["queued"], (j) => (j.stage === "waiting" ? null : { stage: "waiting" }));
          const waited = await sleep(retryDelay(res.retryAfterS), signalFor(key));
          if (!waited) {
            if (cancelRequested.has(key)) await markCancelled(key);
            return;
          }
          continue;
        }
        // Serveur d'avant le contrat des extraits (400 invalid_parameter) : une seule nouvelle demande par repli —
        // GIF d'un passage → extrait MP4 puis GIF tiré ; startMs/endMs inconnus → start_s/end_s (secondes).
        if (res.status === 400 && code === "invalid_parameter" && job.clip && (!job.clipSeconds || (job.kind === "gif" && !job.gifLegacy))) {
          const patch: Partial<StoredJob> = job.kind === "gif" && !job.gifLegacy ? { gifLegacy: true } : { clipSeconds: true };
          const j = await transition(key, ["queued"], () => patch);
          if (j) continue;
        }
        await handleJobResponse(key, res, auth.token);
        return;
      }
    } finally {
      submitting.delete(key);
    }
  }

  async function handleJobResponse(key: string, res: HttpResult, token: string): Promise<void> {
    if (res.status === 401) {
      await fail(key, await deps.onUnauthorized(token));
      return;
    }
    const st = parseStatus(res.body);
    if (res.status === 200 || res.status === 202) {
      if (!st) await fail(key, unexpectedError());
      else await applyStatus(key, st);
      return;
    }
    const code = isObj(res.body) ? res.body.error : undefined;
    if (res.status === 499 || code === "cancelled") await markCancelled(key);
    else await fail(key, apiError(res.status, res.body, res.retryAfterS));
  }

  async function applyStatus(key: string, st: ServerStatus): Promise<void> {
    const common = (j: StoredJob): Partial<StoredJob> => ({
      jobId: st.jobId, stage: st.stage ?? j.stage, ...(st.title ? { title: st.title } : {}),
    });
    switch (st.status) {
      case "queued":
      case "running": {
        const state: JobState = st.status === "queued" ? "queued" : "converting";
        const j = await transition(key, ["queued", "converting"], (x) => x.clip
          // Extrait : l'étape ne recule jamais ; un pourcentage seulement s'il est mesuré par le serveur.
          ? { ...common(x), state, etape: laterEtape(x.etape, st.etape ?? null), progress: st.progression }
          : { ...common(x), state, progress: st.progress ?? x.progress ?? 0 });
        if (j) ensurePolling(key);
        return;
      }
      case "done": {
        const current = await store.get(key);
        // GIF demandé au serveur (3.6.0) ; un serveur qui aurait rendu l'extrait MP4 à la place : GIF tiré ensuite.
        if (current?.kind === "gif" && !current.sourceJobId && !st.producedGif) {
          await startGif(key, st.jobId);
          return;
        }
        const fileUrl = safeFileUrl(st.fileUrl, st.jobId);
        if (!fileUrl) {
          await fail(key, jobError("server_error", MSG.badFileUrl, false));
          return;
        }
        // Conversion terminée ≠ fichier téléchargé : on reste « converting » à 100 % jusqu'au lancement. Extrait :
        // étape « finalisation » (le navigateur enregistre le fichier), sans pourcentage inventé.
        const j = await transition(key, ["queued", "converting"], (x) => ({
          ...common(x), state: "converting", stage: "done", fileUrl,
          ...(x.clip ? { etape: "finalisation" as const, progress: undefined } : { progress: 100 }),
        }));
        if (j) await startDownload(key);
        return;
      }
      case "error": {
        if (st.error === "cancelled") {
          await markCancelled(key);
          return;
        }
        const error = apiError(502, { error: st.error, detail: st.detail }, st.retryAfterS ?? null);
        await transition(key, ACTIVE, (j) => ({ state: "error", error: forDestination(j, error), stage: undefined, jobId: st.jobId }));
        return;
      }
    }
  }

  /** 3.8.1 : état RÉEL d'un envoi relayé à AETHRYON Desktop → transitions du travail (jamais en arrière). */
  async function onRelay(key: string, s: RelayStatus): Promise<void> {
    const progress = s.progression === undefined ? undefined : Math.round(s.progression * 100);
    const to = (state: JobState, stage: string, from: readonly JobState[]) =>
      transition(key, from, (j) => (j.state === state && j.stage === stage && j.progress === progress ? null : { state, stage, progress }));
    switch (s.etat) {
      case "envoye":
        await to("queued", "desktop", ["queued"]);
        return;
      case "conversion":
        await to("converting", "desktop", ["queued", "converting"]);
        return;
      case "telechargement":
        await to("downloading", "desktop", ["queued", "converting", "downloading"]);
        return;
      case "import":
        await to("downloading", "import", ACTIVE);
        return;
      case "importe":
        await transition(key, ACTIVE, () => ({ state: "done", stage: "done", progress: 100, error: undefined }));
        return;
      default:
        await fail(key, relayError(s));
    }
  }

  /**
   * GIF (V3) : l'extrait MP4 est prêt sur le serveur ; le GIF en est tiré (POST /jobs/<extrait>/derive, aucune
   * conversion de plus au quota, aucune nouvelle requête à la plateforme). Le suivi continue sur le job du GIF.
   */
  async function startGif(key: string, sourceId: string): Promise<void> {
    const job = await store.get(key);
    if (!job || !job.clip || (job.state !== "queued" && job.state !== "converting")) return;
    const auth = await getAuth();
    if (!auth) {
      await fail(key, await deps.authLost());
      return;
    }
    let res: HttpResult;
    try {
      res = await http(deps.fetch, `${API_BASE}/jobs/${encodeURIComponent(sourceId)}/derive?wait=0`, {
        method: "POST", token: auth.token, json: gifBody(job.clip), timeoutMs: T.requestTimeoutMs,
      });
    } catch {
      if (deps.alive()) await fail(key, networkError());
      return;
    }
    if (!deps.alive()) return;
    if (res.status === 401) {
      await fail(key, await deps.onUnauthorized(auth.token));
      return;
    }
    const st = parseStatus(res.body);
    if ((res.status !== 200 && res.status !== 202) || !st) {
      await fail(key, res.status === 200 || res.status === 202 ? jobError("gif_failed", MSG.gifFailed, true) : apiError(res.status, res.body, res.retryAfterS));
      return;
    }
    const j = await transition(key, ["queued", "converting"], () => ({
      sourceJobId: sourceId, jobId: st.jobId, state: "converting", stage: "gif", progress: 0, fileUrl: undefined,
    }));
    if (!j) return;
    if (cancelRequested.has(key)) {
      await serverCancel(st.jobId, auth.token);
      await markCancelled(key);
      return;
    }
    await applyStatus(key, st);
  }

  // ---- suivi de la conversion (GET /jobs/<id>?wait=20) -------------------------------------------
  function ensurePolling(key: string): void {
    if (polling.has(key) || !deps.alive()) return;
    polling.add(key);
    void pollLoop(key, signalFor(key)).finally(() => polling.delete(key));
  }

  const backoff = (n: number): number => T.backoffMs[Math.min(n, T.backoffMs.length) - 1] ?? 5_000;
  const retryDelay = (s: number | null): number =>
    Math.min(Math.max((s ?? 0) * 1000, T.retryAfterMinMs), T.retryAfterMaxMs);

  async function pollLoop(key: string, signal: AbortSignal): Promise<void> {
    let failures = 0;
    while (deps.alive() && !signal.aborted) {
      const job = await store.get(key);
      if (!job || !job.jobId || (job.state !== "queued" && job.state !== "converting")) return;
      const auth = await getAuth();
      if (!auth) {
        await fail(key, await deps.authLost());
        return;
      }
      let res: HttpResult;
      const started = Date.now();
      try {
        // Extrait (3.6.0) : &change=true, le serveur répond dès qu'une étape ou la progression change (une réponse
        // toutes les 2 s au plus) — les étapes réelles s'affichent en direct. Vidéo entière : inchangé.
        const change = job.clip ? "&change=true" : "";
        res = await http(deps.fetch, `${API_BASE}/jobs/${encodeURIComponent(job.jobId)}?wait=${T.pollWaitS}${change}`, {
          token: auth.token, timeoutMs: T.pollTimeoutMs, signal,
        });
      } catch {
        if (signal.aborted || !deps.alive()) return;
        failures++;
        if (failures >= T.maxPollFailures) {
          await fail(key, networkError());
          return;
        }
        if (!(await sleep(backoff(failures), signal))) return;
        continue;
      }
      if (!deps.alive() || signal.aborted) return;
      if (res.status === 200) {
        const st = parseStatus(res.body);
        if (st && st.jobId === job.jobId) {
          failures = 0;
          await applyStatus(key, st);
          const early = T.minPollIntervalMs - (Date.now() - started);
          if (st.status !== "done" && st.status !== "error" && early > 0 && !(await sleep(early, signal))) return;
          continue;
        }
        res = { ...res, status: 502 }; // corps illisible : traité comme une erreur passagère
      }
      if (res.status === 401) {
        await fail(key, await deps.onUnauthorized(auth.token));
        return;
      }
      if (res.status === 404) {
        await fail(key, jobError("job_not_found", MSG.jobExpired, true));
        return;
      }
      if (res.status === 429 || res.status >= 500 || res.status === 0) {
        failures++;
        if (failures >= T.maxPollFailures) {
          await fail(key, apiError(res.status, res.body, res.retryAfterS));
          return;
        }
        const wait = res.retryAfterS !== null ? retryDelay(res.retryAfterS) : backoff(failures);
        if (!(await sleep(wait, signal))) return;
        continue;
      }
      await fail(key, apiError(res.status, res.body, res.retryAfterS));
      return;
    }
  }

  async function serverCancel(jobId: string, token: string, { report401 = true } = {}): Promise<void> {
    try {
      const r = await http(deps.fetch, `${API_BASE}/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE", token, timeoutMs: T.requestTimeoutMs });
      if (r.status === 401 && report401) await deps.onUnauthorized(token);
    } catch { /* hors ligne : le job expirera seul sur le serveur */ }
  }

  // ---- téléchargement par le navigateur ----------------------------------------------------------
  async function searchDownload(id: number): Promise<chrome.downloads.DownloadItem | undefined> {
    try {
      return (await chrome.downloads.search({ id }))[0];
    } catch {
      return undefined;
    }
  }

  async function startDownload(key: string): Promise<void> {
    const job = await store.get(key);
    if (!job || !job.fileUrl || !job.jobId || job.state !== "converting") return;
    const fileUrl = safeFileUrl(job.fileUrl, job.jobId);
    if (!fileUrl) {
      await fail(key, jobError("server_error", MSG.badFileUrl, false));
      return;
    }
    const auth = await getAuth();
    if (!auth) {
      await fail(key, await deps.authLost());
      return;
    }
    let id: number;
    try {
      // Le navigateur écrit le fichier sur le disque (aucune copie en mémoire ici) ; jeton en en-tête.
      const launch = () => chrome.downloads.download({
        url: fileUrl, headers: [{ name: "Authorization", value: `Bearer ${auth.token}` }], conflictAction: "uniquify", saveAs: false,
      });
      // Premiere Pro : même téléchargement, rangé dans Téléchargements/AETHRYON (nom proposé à Chrome, voir premiere.ts).
      id = job.dest === "premiere" ? await premiere.launch(launch) : await launch();
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      if (/^[A-Z][A-Z_]{3,40}$/.test(reason)) await interrupted(key, undefined, reason);
      else await fail(key, jobError("download_refused", MSG.downloadRefused, true));
      return;
    }
    if (typeof id !== "number") {
      await fail(key, jobError("download_refused", MSG.downloadRefused, true));
      return;
    }
    const j = await transition(key, ["converting"], (x) => ({
      state: "downloading", stage: "download", downloadId: id, error: undefined, fileName: undefined, savedAs: undefined, bytes: undefined,
      // Extrait : le pourcentage viendra des octets reçus par le navigateur (mesurés), pas avant.
      ...(x.clip ? { progress: undefined, etape: "finalisation" as const } : { progress: 0 }),
    }));
    if (!j) {
      // Annulé ou retiré pendant le lancement.
      premiere.forget(id);
      quiet(() => chrome.downloads.cancel(id));
      return;
    }
    track(id, key);
    const ev = early.get(id);
    early.delete(id);
    if (ev?.state === "complete") return complete(key, id);
    if (ev?.state === "interrupted") return interrupted(key, id, ev.error);
    // Une réponse d'erreur peut créer un téléchargement déjà interrompu.
    const item = await searchDownload(id);
    if (item?.state === "interrupted") await interrupted(key, id, item.error);
  }

  function track(id: number, key: string): void {
    tracked.set(id, key);
    if (!progressTimer && deps.alive()) progressTimer = setInterval(() => void tick(), T.progressIntervalMs);
  }

  function untrack(id: number): void {
    tracked.delete(id);
    premiere.forget(id);
    if (!tracked.size && progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
  }

  /** Progression (octets reçus / total) tant que le worker vit ; chaque lecture est un vrai travail. */
  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      for (const [id, key] of [...tracked]) {
        if (!deps.alive()) return;
        const item = await searchDownload(id);
        const mine = (j: StoredJob) => j.downloadId === id;
        if (!item) {
          untrack(id);
          await fail(key, jobError("download_missing", MSG.downloadMissing, true), mine);
        } else if (item.state === "in_progress") {
          const p = item.totalBytes > 0 ? Math.min(99, Math.floor((item.bytesReceived / item.totalBytes) * 100)) : null;
          // Premiere : nom définitif connu dès que Chrome l'a déterminé (après « uniquify ») ; annoncé au Desktop.
          const saved = item.filename ? item.filename.split(/[\\/]/).pop() || undefined : undefined;
          await transition(key, ["downloading"], (j) => {
            const patch: Partial<StoredJob> = {};
            if (p !== null && j.progress !== p) patch.progress = p;
            if (saved && j.dest === "premiere" && j.savedAs !== saved) {
              patch.savedAs = saved;
              patch.fileName = basename(saved) || undefined;
            }
            return Object.keys(patch).length ? patch : null;
          }, mine);
        } else if (item.state === "interrupted") {
          await interrupted(key, id, item.error);
        }
        // « complete » : seul downloads.onChanged conclut (voir onDownloadChanged).
      }
    } finally {
      ticking = false;
    }
  }

  async function complete(key: string, id: number): Promise<void> {
    untrack(id);
    const item = await searchDownload(id);
    const bytes = item ? (item.fileSize > 0 ? item.fileSize : item.bytesReceived) : undefined;
    await transition(key, ["downloading"], (j) => ({
      state: "done", stage: "done", progress: 100, error: undefined, ...(j.clip ? { etape: "termine" as const } : {}),
      fileName: item?.filename ? basename(item.filename) || undefined : undefined,
      savedAs: j.dest === "premiere" && item?.filename ? item.filename.split(/[\\/]/).pop() || undefined : undefined,
      bytes: typeof bytes === "number" && bytes >= 0 ? bytes : undefined,
    }), (j) => j.downloadId === id);
  }

  async function probe(fileUrl: string, token: string): Promise<Probe> {
    try {
      // Un octet suffit pour savoir si le fichier existe encore (et le corps n'est pas lu).
      return await http(deps.fetch, fileUrl, { token, headers: { range: "bytes=0-0" }, timeoutMs: T.requestTimeoutMs });
    } catch {
      return "network";
    }
  }

  /** Après une interruption : le fichier est-il encore sur le serveur ? (message juste, relance possible) */
  async function diagnose(key: string, reason: string): Promise<JobError> {
    const job = await store.get(key);
    const auth = await getAuth();
    if (!auth) return deps.authLost();
    const network = reason.startsWith("NETWORK_") || reason === "SERVER_CONTENT_LENGTH_MISMATCH" || reason === "SERVER_UNREACHABLE";
    const transient = network
      ? jobError("download_interrupted", MSG.downloadNetwork, true)
      : jobError("download_server", MSG.downloadServer, true);
    if (!job?.fileUrl) return transient;
    const p = await probe(job.fileUrl, auth.token);
    if (p === "network") return jobError("download_interrupted", MSG.downloadNetwork, true);
    if (p.status === 200 || p.status === 206) return transient;
    if (p.status === 401) return deps.onUnauthorized(auth.token);
    if (p.status === 404 || p.status === 410) return jobError("file_expired", MSG.fileExpired, true);
    if (p.status === 403) {
      const e = apiError(403, p.body, null);
      return isObj(p.body) && typeof p.body.detail === "string" ? e : jobError(e.code, MSG.downloadForbidden, false);
    }
    if (p.status >= 400 && p.status < 500 && p.status !== 429) return apiError(p.status, p.body, p.retryAfterS);
    return transient;
  }

  async function interrupted(key: string, id: number | undefined, reason = "NETWORK_FAILED"): Promise<void> {
    if (id !== undefined) untrack(id);
    const mine = (j: StoredJob) => id === undefined || j.downloadId === id;
    const c = classifyInterrupt(reason);
    if (c.kind === "cancelled") {
      await markCancelled(key, mine);
      return;
    }
    // Miniature en grand absente (vidéo ancienne, YouTube) : la taille toujours présente, une fois.
    const job = await store.get(key);
    if (job?.kind === "thumb" && job.thumbFallback && mine(job)) {
      const next = job.thumbFallback;
      const j = await transition(key, ["downloading"], () => ({ localUrl: next, thumbFallback: undefined, downloadId: undefined }), mine);
      if (j) await launchLocal(key);
      return;
    }
    if (job?.kind === "frame" || job?.kind === "thumb") {
      await fail(key, job.kind === "frame" ? jobError("download_interrupted", MSG.frameRetry, false) : jobError("download_interrupted", MSG.downloadNetwork, true), mine);
      return;
    }
    const error = c.error ?? (await diagnose(key, reason));
    await fail(key, error, mine);
  }

  async function onDownloadChanged(delta: chrome.downloads.DownloadDelta): Promise<void> {
    const state = delta.state?.current;
    if (state !== "complete" && state !== "interrupted") return;
    if (!deps.alive()) return;
    const job = (await store.all()).find((j) => j.downloadId === delta.id && j.state === "downloading");
    if (!job) {
      const now = Date.now();
      for (const [k, v] of early) if (now - v.at > 120_000) early.delete(k);
      if (early.size < 100) early.set(delta.id, { state, error: delta.error?.current, at: now });
      return;
    }
    if (state === "complete") await complete(job.key, delta.id);
    else await interrupted(job.key, delta.id, delta.error?.current ?? (await searchDownload(delta.id))?.error);
  }

  // ---- actions demandées par les pages -----------------------------------------------------------
  async function cancel(key: string, contentTab?: number): Promise<JobView> {
    const job = await getScoped(key, contentTab);
    if (!isActive(job)) return toView(job);
    cancelRequested.add(key);
    abortWork(key);
    // 3.8.1 : envoi relayé au Desktop : seul le suivi s'arrête ici (aucun message d'annulation vers le Desktop).
    if (tracksDesktop(job)) relay.forget(key);
    if (job.state === "downloading" && job.downloadId !== undefined) {
      untrack(job.downloadId);
      try { await chrome.downloads.cancel(job.downloadId); } catch { /* déjà terminé */ }
    } else if (job.jobId) {
      const auth = await getAuth();
      if (auth) await serverCancel(job.jobId, auth.token);
    }
    // Sans jobId, la création est en cours : submit() supprimera le job créé dès sa réponse.
    return toView((await markCancelled(key)) ?? (await store.get(key)) ?? job);
  }

  async function retry(key: string, contentTab?: number): Promise<JobView> {
    const job = await getScoped(key, contentTab);
    if (job.state !== "error" && job.state !== "cancelled") return toView(job);
    if (!(await deps.consented())) throw new BgError(consentRequired(await consentOutdated()));
    const auth = await getAuth();
    if (!auth) throw new BgError(await deps.authLost());
    if (job.kind === "frame") throw new BgError(jobError("frame_retry", MSG.frameRetry, false));
    cancelRequested.delete(key);
    abortWork(key);
    const reset = { error: undefined, downloadId: undefined, fileName: undefined, bytes: undefined } as const;
    if (job.kind === "thumb") {
      const j = await transition(key, ["error", "cancelled"], () => ({ ...reset, state: "downloading", stage: "download", progress: 0 }));
      if (j) await launchLocal(key);
      return toView((await store.get(key)) ?? job);
    }
    // Conversion déjà faite et fichier encore là : on relance seulement le téléchargement.
    if (job.fileUrl && job.jobId) {
      const p = await probe(job.fileUrl, auth.token);
      if (p !== "network" && (p.status === 200 || p.status === 206)) {
        if (job.downloadId !== undefined) {
          const old = job.downloadId;
          quiet(() => chrome.downloads.cancel(old)); // fichier partiel abandonné par Chrome
        }
        const j = await transition(key, ["error", "cancelled"], (x) => ({
          ...reset, state: "converting", stage: "done", ...(x.clip ? { progress: undefined, etape: "finalisation" as const } : { progress: 100 }),
        }));
        if (j) {
          void syncAlarm();
          await startDownload(key);
        }
        return toView((await store.get(key)) ?? job);
      }
      if (p !== "network" && p.status === 401) throw new BgError(await deps.onUnauthorized(auth.token));
    }
    // Sinon : nouvelle conversion avec les mêmes paramètres (même entrée dans la liste).
    const j = await transition(key, ["error", "cancelled"], (x) => ({
      ...reset, state: "queued", stage: "queued", progress: x.clip ? undefined : 0, etape: undefined,
      jobId: undefined, fileUrl: undefined, sourceJobId: undefined, createdAt: Date.now(),
    }));
    if (!j) return toView((await store.get(key)) ?? job);
    void syncAlarm();
    void submit(key);
    return toView(j);
  }

  async function dismiss(key: string): Promise<{ key: string }> {
    const job = await getScoped(key);
    if (isActive(job)) await cancel(key);
    await store.remove(key);
    void syncAlarm();
    return { key };
  }

  // ---- enregistrements par le navigateur seul (V3 : image de la vidéo, miniature) ----------------
  /**
   * Image de la vidéo (PNG déjà vérifié, en data:) ou miniature de la plateforme : le NAVIGATEUR l'écrit dans le dossier
   * de téléchargement (aucun serveur AETHRYON) ; l'élément suit le même cycle que les autres (« done » seulement quand
   * Chrome dit le fichier complet). L'image n'est pas gardée ensuite : une capture se refait depuis la vidéo.
   */
  async function saveLocal(kind: "frame" | "thumb", src: { url: string; fallback?: string }, media: { url: string; platform: Platform; title?: string; at?: number },
    opts: { tabId?: number } = {}): Promise<JobView> {
    if (!(await deps.consented())) throw new BgError(consentRequired(await consentOutdated()));
    const now = Date.now();
    const job: StoredJob = compact({
      key: newKey(), url: media.url, platform: media.platform, fmt: "mp4", kind, title: media.title || undefined,
      state: "downloading", stage: "download", progress: 0, createdAt: now, updatedAt: now, tabId: opts.tabId,
      fileName: kind === "frame" ? frameFileName(media.title, media.at) : thumbFileName(media.title, src.url),
      localUrl: kind === "thumb" ? src.url : undefined, thumbFallback: kind === "thumb" ? src.fallback : undefined,
    });
    await store.insertUnlessActive(job, () => false);
    broadcast(job);
    await launchLocal(job.key, kind === "frame" ? src.url : undefined);
    return toView((await store.get(job.key)) ?? job);
  }

  /** Lance (ou relance) l'écriture d'un enregistrement local ; `dataUrl` : l'image, jamais stockée. */
  async function launchLocal(key: string, dataUrl?: string): Promise<void> {
    const job = await store.get(key);
    if (!job || job.state !== "downloading") return;
    const url = job.kind === "frame" ? dataUrl : job.localUrl;
    if (!url) {
      await fail(key, jobError("frame_retry", MSG.frameRetry, false));
      return;
    }
    let id: number;
    try {
      // Nom choisi ici : redonné à Chrome si un envoi vers Premiere a posé son écouteur à ce moment-là (premiere.ts).
      id = await premiere.withName(() => chrome.downloads.download({ url, filename: job.fileName, conflictAction: "uniquify", saveAs: false }), job.fileName);
    } catch {
      await fail(key, jobError("download_refused", MSG.downloadRefused, job.kind === "thumb"));
      return;
    }
    if (typeof id !== "number") {
      await fail(key, jobError("download_refused", MSG.downloadRefused, job.kind === "thumb"));
      return;
    }
    const j = await transition(key, ["downloading"], () => ({ downloadId: id, progress: 0, error: undefined }));
    if (!j) {
      quiet(() => chrome.downloads.cancel(id));
      return;
    }
    track(id, key);
    const ev = early.get(id);
    early.delete(id);
    if (ev?.state === "complete") return complete(key, id);
    if (ev?.state === "interrupted") return interrupted(key, id, ev.error);
    const item = await searchDownload(id);
    if (item?.state === "complete") await complete(key, id);
    else if (item?.state === "interrupted") await interrupted(key, id, item.error);
  }

  /** « Afficher dans le dossier » : le fichier d'un élément terminé, dans le gestionnaire de fichiers du système. */
  async function show(key: string, contentTab?: number): Promise<{ shown: boolean }> {
    const job = await getScoped(key, contentTab);
    if (job.state !== "done" || job.downloadId === undefined) throw new BgError(jobError("not_found", MSG.showFailed, false));
    const item = await searchDownload(job.downloadId);
    if (!item || item.state !== "complete" || item.exists === false) throw new BgError(jobError("not_found", MSG.showFailed, false));
    chrome.downloads.show(job.downloadId);
    return { shown: true };
  }

  /** Job ytapi d'un élément (pour AETHRYON Tools) : l'extrait d'un GIF, sinon le fichier converti. */
  async function serverJobOf(key: string, contentTab?: number): Promise<string | null> {
    const job = await getScoped(key, contentTab);
    if (job.kind === "frame" || job.kind === "thumb") return null;
    return job.sourceJobId ?? job.jobId ?? null;
  }

  async function list(contentTab?: number): Promise<JobView[]> {
    return (await store.all())
      .filter((j) => contentTab === undefined || j.tabId === contentTab)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(toView);
  }

  /** Démarrage du worker, alarme, onStartup : reprendre ce qui était en cours (idempotent). */
  async function resume(): Promise<void> {
    if (!deps.alive()) return;
    for (const j of await store.all()) {
      // 3.8.1 : envoi déjà accepté par AETHRYON Desktop → seulement le suivi (jamais une seconde conversion).
      const relayed = tracksDesktop(j) && isActive(j) ? relayRequest(j) : null;
      if (relayed && (j.state !== "queued" || j.stage === "desktop")) relay.follow(j.key, relayed);
      else if (j.state === "queued" && !j.jobId) void submit(j.key);
      else if ((j.state === "queued" || j.state === "converting") && j.jobId) ensurePolling(j.key);
      else if (j.state === "downloading" && j.downloadId !== undefined && !tracked.has(j.downloadId)) {
        const id = j.downloadId;
        const item = await searchDownload(id);
        if (!item) await fail(j.key, jobError("download_missing", MSG.downloadMissing, true), (x) => x.downloadId === id);
        else if (item.state === "in_progress") track(id, j.key);
        // Le téléchargement s'est terminé pendant que le worker était arrêté : Chrome le confirme.
        else if (item.state === "complete") await complete(j.key, id);
        else await interrupted(j.key, id, item.error);
      }
    }
    await syncAlarm();
  }

  /**
   * Déconnexion (voulue, ou clé refusée par le serveur) : la liste des téléchargements ne lui survit pas.
   * - conversions en file ou en cours : arrêtées (DELETE sur ytapi avec `cancelWith`, la clé encore valable
   *   d'une déconnexion voulue) et annoncées à leur onglet : « Annulé », ou l'erreur `error` (le motif du
   *   refus : révoquée, expirée…) ;
   * - fichier que le navigateur est en train d'écrire : laissé au navigateur (déjà converti), retiré de la
   *   liste dès qu'il se termine (commit) ;
   * - tout le reste (terminés, en échec, annulés) est effacé de storage.session.
   */
  async function signOut(opts: { cancelWith?: string; error?: JobError } = {}): Promise<void> {
    for (const j of await store.all()) {
      if (j.state !== "queued" && j.state !== "converting") continue;
      cancelRequested.add(j.key);
      abortWork(j.key);
      if (tracksDesktop(j)) relay.forget(j.key);
      if (opts.cancelWith && j.jobId) await serverCancel(j.jobId, opts.cancelWith, { report401: false });
      if (opts.error) await fail(j.key, opts.error);
      else await markCancelled(j.key);
    }
    await store.removeWhere((j) => j.state !== "downloading");
    await syncAlarm();
  }

  function stop(): void {
    for (const c of controllers.values()) c.abort();
    controllers.clear();
    premiere.stop();
    relay.stop();
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = null;
    tracked.clear();
  }

  return { start, cancel, retry, dismiss, list, resume, onDownloadChanged, signOut, stop, syncAlarm, saveLocal, show, serverJobOf };
}

// Dialogue avec le service worker (seul interlocuteur du popup, des réglages et de la page d'accueil) :
// requêtes BgRequest, réponses BgResponse<T> vérifiées avant usage (une réponse inattendue devient une erreur
// lisible, jamais une exception), annonces poussées (job.update, auth.changed, update.changed). Le jeton
// d'extension n'arrive jamais ici : le service worker le garde pour lui.
import { SITE_BASE } from "../shared/config.ts";
import { isEtape } from "../shared/etapes.ts";
import { CONSENT_VERSION } from "../shared/consent.ts";
import type { AuthChanged, BgRequest, BgResponse, PopupInit } from "../shared/messages.ts";
import { mergeSettings } from "../shared/storage.ts";
import {
  AUTH_LOST_REASONS, BITRATES, DEGRADED_REASONS, QUALITIES, type AccountView, type AuthChangeReason, type AuthNotice, type ConsentView,
  type DetectedMedia, type JobError, type JobState, type JobView, type Settings, type UpdateNotice, type UpdateProgress, type LoadHint, type DesktopUpdateResult,
} from "../shared/types.ts";
import { PLATFORM_LABEL } from "../shared/urls.ts";

const UNREACHABLE: JobError = { code: "unreachable", message: "Le service de l'extension ne répond pas. Réessaie dans un instant.", retryable: true };
const UNEXPECTED: JobError = { code: "bad_response", message: "Réponse inattendue du service de l'extension.", retryable: true };
const TIMEOUT: JobError = { code: "timeout", message: "Le service de l'extension met trop de temps à répondre.", retryable: true };

const STATES: readonly JobState[] = ["queued", "converting", "downloading", "done", "error", "cancelled"];
const KINDS: readonly string[] = ["video", "short", "post", "shortlink"];

export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
const optStr = (v: unknown) => v === undefined || typeof v === "string";
const optNum = (v: unknown) => v === undefined || (typeof v === "number" && Number.isFinite(v));
const isPlatform = (v: unknown) => typeof v === "string" && Object.hasOwn(PLATFORM_LABEL, v);

export function isJobError(v: unknown): v is JobError {
  return isObj(v) && typeof v.code === "string" && typeof v.message === "string" && typeof v.retryable === "boolean";
}

export function isJobView(v: unknown): v is JobView {
  if (!isObj(v)) return false;
  return typeof v.key === "string" && v.key.length > 0 && v.key.length <= 64
    && typeof v.url === "string"
    && isPlatform(v.platform)
    && (v.fmt === "mp4" || v.fmt === "mp3")
    && typeof v.state === "string" && (STATES as readonly string[]).includes(v.state)
    && (v.quality === undefined || (QUALITIES as readonly unknown[]).includes(v.quality))
    && (v.bitrate === undefined || (BITRATES as readonly unknown[]).includes(v.bitrate))
    && optNum(v.index) && optStr(v.title) && optNum(v.progress) && optStr(v.stage)
    && (v.error === undefined || isJobError(v.error))
    && typeof v.createdAt === "number" && typeof v.updatedAt === "number"
    && optNum(v.downloadId) && optStr(v.fileName) && optNum(v.bytes)
    // V3 : nature (GIF, image, miniature) et extrait.
    && (v.kind === undefined || v.kind === "gif" || v.kind === "frame" || v.kind === "thumb")
    && (v.dest === undefined || v.dest === "premiere")
    && (v.desktop === undefined || v.desktop === "suivi" || v.desktop === "absent")
    // 3.6.0 : étape réelle d'un extrait.
    && (v.etape === undefined || isEtape(v.etape))
    && (v.clip === undefined || (isObj(v.clip) && typeof v.clip.start === "number" && typeof v.clip.end === "number"
      && Number.isFinite(v.clip.start) && Number.isFinite(v.clip.end) && v.clip.end > v.clip.start));
}

export function isAccountView(v: unknown): v is AccountView {
  if (!isObj(v) || typeof v.connected !== "boolean") return false;
  if (!optStr(v.email) || !optStr(v.name) || !optNum(v.activeJobs) || !optStr(v.expiresAt)) return false;
  if (v.stale !== undefined && typeof v.stale !== "boolean") return false;
  if (v.suspended !== undefined && typeof v.suspended !== "boolean") return false;
  if (v.tools !== undefined && typeof v.tools !== "boolean") return false;
  if (v.degraded !== undefined) {
    const d = v.degraded;
    if (!isObj(d) || !(DEGRADED_REASONS as readonly unknown[]).includes(d.reason) || !optNum(d.status)) return false;
  }
  if (v.notice !== undefined && !isNotice(v.notice)) return false;
  if (v.today !== undefined) {
    const t = v.today;
    if (!isObj(t) || typeof t.used !== "number") return false;
    if (t.limit !== null && typeof t.limit !== "number") return false;
    if (t.remaining !== null && typeof t.remaining !== "number") return false;
    if (!optStr(t.resetAt)) return false;
  }
  if (v.recent !== undefined && !Array.isArray(v.recent)) return false;
  return true;
}

function isNotice(v: unknown): v is AuthNotice {
  return isObj(v) && typeof v.reason === "string" && (AUTH_LOST_REASONS as readonly string[]).includes(v.reason)
    && typeof v.message === "string" && v.message.length > 0 && v.message.length <= 300 && typeof v.at === "number";
}

/** Historique du compte : on garde les entrées bien formées (affichées par textContent). */
function cleanRecent(list: unknown): AccountView["recent"] {
  if (!Array.isArray(list)) return undefined;
  return list.filter((r): r is NonNullable<AccountView["recent"]>[number] =>
    isObj(r) && typeof r.createdAt === "string" && (r.platform === null || typeof r.platform === "string")
    && typeof r.fmt === "string" && typeof r.state === "string" && (r.errorMessage === null || typeof r.errorMessage === "string"));
}

export function cleanAccount(v: AccountView): AccountView {
  return { ...v, recent: cleanRecent(v.recent) };
}

function isDetected(v: unknown): v is DetectedMedia {
  return isObj(v) && isPlatform(v.platform) && typeof v.kind === "string" && KINDS.includes(v.kind)
    && typeof v.url === "string" && v.url.length <= 2048 && typeof v.id === "string"
    && optStr(v.title) && optStr(v.thumbnail) && optNum(v.duration) && optNum(v.currentTime)
    && (v.videoCount === undefined || (typeof v.videoCount === "number" && Number.isInteger(v.videoCount) && v.videoCount >= 0 && v.videoCount <= 50));
}

/** Accord à la notice : absent ou mal formé → NON accepté (l'interface reste fermée, jamais l'inverse). */
export function parseConsent(v: unknown): ConsentView {
  if (!isObj(v) || v.accepted !== true || v.version !== CONSENT_VERSION) {
    return isObj(v) && v.outdated === true ? { accepted: false, version: CONSENT_VERSION, outdated: true } : { accepted: false, version: CONSENT_VERSION };
  }
  return { accepted: true, version: CONSENT_VERSION, ...(typeof v.at === "string" ? { at: v.at.slice(0, 40) } : {}) };
}

/** Avis de nouvelle version : textes bornés (affichés par textContent), URL du site seulement. */
export function parseUpdate(v: unknown, siteBase: string = SITE_BASE): UpdateNotice | null {
  if (!isObj(v) || typeof v.version !== "string" || !/^\d{1,5}(\.\d{1,5}){0,3}$/.test(v.version)) return null;
  if (typeof v.url !== "string" || !v.url.startsWith(`${siteBase}/`) || !Array.isArray(v.notes)) return null;
  const out: UpdateNotice = { version: v.version, url: v.url, notes: v.notes.filter((n): n is string => typeof n === "string").map((n) => n.slice(0, 240)).slice(0, 8) };
  if (typeof v.released === "string") out.released = v.released.slice(0, 10);
  if (typeof v.needsChrome === "number" && Number.isInteger(v.needsChrome)) out.needsChrome = v.needsChrome;
  return out;
}

const STEPS = ["telechargement", "verification", "installation", "redemarrage"] as const;

/** Étape de mise à jour annoncée par le service worker (nombres bornés), ou null. */
export function parseProgress(v: unknown): UpdateProgress | null {
  if (!isObj(v) || typeof v.version !== "string" || !/^\d{1,5}(\.\d{1,5}){0,3}$/.test(v.version)) return null;
  const step = STEPS.find((s) => s === v.step);
  if (!step) return null;
  const out: UpdateProgress = { version: v.version, step };
  const n = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x < 1e12;
  if (n(v.done)) out.done = v.done as number;
  if (n(v.total)) out.total = v.total as number;
  return out;
}

/** Explication du chargement unique (chemin affiché par textContent, jamais ouvert). */
export function parseLoadHint(v: unknown): LoadHint | null {
  if (!isObj(v) || typeof v.version !== "string" || typeof v.loaded !== "string" || typeof v.folder !== "string") return null;
  const re = /^\d{1,5}(\.\d{1,5}){0,3}$/;
  // eslint-disable-next-line no-control-regex
  if (!re.test(v.version) || !re.test(v.loaded) || v.folder.length < 3 || v.folder.length > 500 || /[\u0000-\u001f\u007f]/.test(v.folder)) return null;
  return { version: v.version, folder: v.folder, loaded: v.loaded };
}

/** Résultat de update.install (desktop-update.ts) → forme sûre. */
export function parseInstallResult(v: unknown): DesktopUpdateResult | null {
  const r = isObj(v) && isObj(v.result) ? v.result : null;
  if (!r) return null;
  if (r.ok === true && typeof r.version === "string" && typeof r.folder === "string") return { ok: true, version: r.version.slice(0, 32), folder: r.folder.slice(0, 500), already: r.already === true };
  const reasons = ["permission", "absent", "ancien", "refus", "delai"] as const;
  const reason = reasons.find((x) => x === r.reason);
  if (r.ok === false && reason && typeof r.message === "string") {
    const step = STEPS.find((s) => s === r.step);
    return { ok: false, reason, message: r.message.slice(0, 400), ...(step && step !== "redemarrage" ? { step } : {}) };
  }
  return null;
}

/** Réponse de popup.init → données sûres, ou null si la forme est inattendue. */
export function parseInit(v: unknown, siteBase: string = SITE_BASE): PopupInit | null {
  if (!isObj(v) || !isAccountView(v.account)) return null;
  const settings: Settings = mergeSettings(isObj(v.settings) ? (v.settings as Partial<Settings>) : undefined);
  return {
    account: cleanAccount(v.account),
    detected: isDetected(v.detected) ? v.detected : null,
    pageHint: typeof v.pageHint === "string" && v.pageHint.trim() ? v.pageHint.trim().slice(0, 300) : null,
    jobs: Array.isArray(v.jobs) ? v.jobs.filter(isJobView) : [],
    settings,
    version: typeof v.version === "string" ? v.version.slice(0, 32) : "",
    consent: parseConsent(v.consent),
    update: parseUpdate(v.update, siteBase),
    loadHint: parseLoadHint(v.loadHint),
  };
}

/**
 * Envoie une requête au service worker. Jamais d'exception : service worker absent, réponse mal formée
 * ou délai dépassé deviennent { ok: false, error } avec une phrase en français.
 */
export async function send<T>(req: BgRequest, timeoutMs = 0): Promise<BgResponse<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const call = Promise.resolve(chrome.runtime.sendMessage(req) as Promise<unknown>);
    const res = timeoutMs > 0
      ? await Promise.race([call, new Promise<typeof TIMEOUT>((resolve) => { timer = setTimeout(() => resolve(TIMEOUT), timeoutMs); })])
      : await call;
    if (res === TIMEOUT) return { ok: false, error: TIMEOUT };
    if (isObj(res) && res.ok === true && "data" in res) return { ok: true, data: res.data as T };
    if (isObj(res) && res.ok === false && isJobError(res.error)) return { ok: false, error: res.error };
    return { ok: false, error: UNEXPECTED };
  } catch {
    return { ok: false, error: UNREACHABLE };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const CHANGE_REASONS: readonly AuthChangeReason[] = [...AUTH_LOST_REASONS, "signed_out", "linked", "withdrawn"];

export interface PageEvents {
  job?: (job: JobView) => void;
  /** Liaison changée ailleurs (clé refusée, déconnexion, connexion, accord retiré). */
  auth?: (e: Pick<AuthChanged, "connected" | "reason" | "message">) => void;
  /** Avis de nouvelle version (null : plus rien à montrer). */
  update?: (u: UpdateNotice | null) => void;
  /** Mise à jour en un clic : étape réelle en cours (null : terminée ou abandonnée). */
  progress?: (p: UpdateProgress | null) => void;
  /** Explication du chargement unique (null : réglé ou masqué). */
  hint?: (h: LoadHint | null) => void;
}

/**
 * Annonces poussées par le service worker — et seulement par lui : pas un onglet (content script), pas une
 * autre extension. Tout message mal formé est ignoré.
 */
export function onPageEvents(cbs: PageEvents, siteBase: string = SITE_BASE): () => void {
  const listener = (msg: unknown, sender: chrome.runtime.MessageSender): undefined => {
    if (sender.id !== chrome.runtime.id || sender.tab || !isObj(msg)) return undefined;
    if (msg.type === "job.update" && isJobView(msg.job)) cbs.job?.(msg.job);
    else if (msg.type === "auth.changed" && typeof msg.connected === "boolean" && (CHANGE_REASONS as readonly unknown[]).includes(msg.reason)) {
      cbs.auth?.({ connected: msg.connected, reason: msg.reason as AuthChangeReason, ...(typeof msg.message === "string" ? { message: msg.message.slice(0, 300) } : {}) });
    } else if (msg.type === "update.changed") {
      cbs.update?.(msg.update === null ? null : parseUpdate(msg.update, siteBase));
    } else if (msg.type === "update.progress") {
      cbs.progress?.(msg.progress === null ? null : parseProgress(msg.progress));
    } else if (msg.type === "update.hint") {
      cbs.hint?.(msg.hint === null ? null : parseLoadHint(msg.hint));
    }
    return undefined;
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

/** Compatibilité : seulement les job.update. */
export function onJobUpdate(cb: (job: JobView) => void): () => void {
  return onPageEvents({ job: cb });
}

// Côté content script du protocole de messages (src/shared/messages.ts) : validation de ce que reçoit
// l'onglet (job.update, detect.request) et interprétation des réponses du service worker.
// Un content script n'écoute QUE l'extension elle-même (jamais window.postMessage, jamais la page).
// Testé par tests/unit/content-protocol.test.ts.
import { isEtape } from "../../shared/etapes.ts";
import { cleanText, parsePlayerOp, type PlayerOp } from "../../shared/messages.ts";
import type { JobState } from "../../shared/types.ts";
import { parseMediaUrl } from "../../shared/urls.ts";
import type { SafeError, SafeJob } from "./job.ts";
import { T } from "./strings.ts";

const JOB_STATES: readonly JobState[] = ["queued", "converting", "downloading", "done", "error", "cancelled"];
const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isJobKey(v: unknown): v is string {
  return typeof v === "string" && KEY_RE.test(v);
}

export function parseError(v: unknown): SafeError | null {
  if (!isObj(v) || typeof v.message !== "string") return null;
  const message = cleanText(v.message, 300);
  if (!message) return null;
  const code = typeof v.code === "string" ? cleanText(v.code, 64) : "";
  return { code: code || "unknown", message, retryable: v.retryable === true };
}

/** JobView (types.ts) → vue réduite et validée ; null si incohérente. */
export function parseJob(v: unknown): SafeJob | null {
  if (!isObj(v)) return null;
  if (!isJobKey(v.key)) return null;
  if (typeof v.url !== "string" || !parseMediaUrl(v.url)) return null;
  if (typeof v.state !== "string" || !(JOB_STATES as readonly string[]).includes(v.state)) return null;
  const job: SafeJob = {
    key: v.key,
    url: v.url,
    state: v.state as JobState,
    updatedAt: typeof v.updatedAt === "number" && Number.isFinite(v.updatedAt) ? v.updatedAt : 0,
  };
  if (typeof v.progress === "number" && Number.isFinite(v.progress)) job.progress = Math.min(100, Math.max(0, v.progress));
  if (v.fmt === "mp4" || v.fmt === "mp3") job.fmt = v.fmt;
  if (typeof v.index === "number" && Number.isInteger(v.index) && v.index >= 1 && v.index <= 50) job.index = v.index;
  if (v.desktop === "absent") job.desktop = "absent";
  if (v.dest === "premiere") job.premiere = true;
  if (v.stage === "desktop" || v.stage === "import") job.stage = v.stage;
  // 3.6.0 : extrait (étapes réelles, pourcentage seulement s'il est mesuré) et GIF.
  if (isObj(v.clip)) job.clip = true;
  if (isEtape(v.etape)) job.etape = v.etape;
  if (v.kind === "gif") job.gif = true;
  if (v.error !== undefined && v.error !== null) {
    const e = parseError(v.error);
    if (e) job.error = e;
  }
  return job;
}

export type TabIncoming = { type: "detect.request" } | { type: "frame.grab" } | { type: "job.update"; job: SafeJob } | ({ type: "player.cmd" } & PlayerOp);

/** Message reçu par l'onglet → message typé, ou null (rejet silencieux). */
export function parseTabMessage(msg: unknown): TabIncoming | null {
  if (!isObj(msg) || typeof msg.type !== "string") return null;
  if (msg.type === "detect.request") return Object.keys(msg).length === 1 ? { type: "detect.request" } : null;
  if (msg.type === "frame.grab") return Object.keys(msg).length === 1 ? { type: "frame.grab" } : null;
  // 3.6.0 : lecteur piloté depuis le popup (relayé par le service worker), champs et instants vérifiés.
  if (msg.type === "player.cmd") return parsePlayerOp(msg, "player.cmd") as ({ type: "player.cmd" } & PlayerOp) | null;
  if (msg.type === "job.update") {
    if (Object.keys(msg).length !== 2) return null;
    const job = parseJob(msg.job);
    return job ? { type: "job.update", job } : null;
  }
  return null;
}

/** Expéditeur accepté : notre extension (service worker, popup), jamais un onglet ni une autre extension. */
export function isTrustedSender(sender: { id?: string; tab?: unknown } | null | undefined, extensionId: string | undefined): boolean {
  return !!extensionId && !!sender && sender.id === extensionId && !sender.tab;
}

export const NO_ANSWER: SafeError = { code: "no_answer", message: T.errNoAnswer, retryable: true };
export const INVALID_LINK: SafeError = { code: "invalid_url", message: T.errInvalidLink, retryable: false };
const GENERIC: SafeError = { code: "unknown", message: T.errGeneric, retryable: true };

export type StartResult = { ok: true; job: SafeJob | null } | { ok: false; error: SafeError };

/** Réponse BgResponse<JobView> du service worker (ou rien) → résultat exploitable. */
export function interpretStartResponse(res: unknown): StartResult {
  if (!isObj(res)) return { ok: false, error: NO_ANSWER };
  if (res.ok === true) return { ok: true, job: parseJob(res.data) };
  if (res.ok === false) return { ok: false, error: parseError(res.error) ?? GENERIC };
  return { ok: false, error: NO_ANSWER };
}

export type LoginResult = { ok: true } | { ok: false; error: SafeError };

/** Réponse à « auth.login » (réduite à { connected } pour une page) → connecté, ou la cause d'un échec. */
export function interpretLoginResponse(res: unknown): LoginResult {
  if (!isObj(res)) return { ok: false, error: NO_ANSWER };
  if (res.ok === true) return isObj(res.data) && res.data.connected === true ? { ok: true } : { ok: false, error: GENERIC };
  if (res.ok === false) return { ok: false, error: parseError(res.error) ?? GENERIC };
  return { ok: false, error: NO_ANSWER };
}

export type SendFailure = { invalidated: true } | { invalidated: false; error: SafeError };

/** Exception de chrome.runtime.sendMessage → contexte perdu (démontage) ou « l'extension ne répond pas ». */
export function interpretSendFailure(err: unknown): SendFailure {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/context invalidated/i.test(msg)) return { invalidated: true };
  return { invalidated: false, error: NO_ANSWER };
}

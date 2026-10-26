// Logique pure de la commande : choix proposés (format, qualité, débit, vidéo), construction de la
// requête « job.start » envoyée au service worker et traduction de l'état d'un job en libellés.
// Testé par tests/unit/content-job.test.ts.
import { cleanText, parseBgRequest, type StartJob } from "../../shared/messages.ts";
import { BITRATES, QUALITIES, type Bitrate, type Destination, type DetectedMedia, type Fmt, type JobState, type Quality, type Settings } from "../../shared/types.ts";
import { parseMediaUrl } from "../../shared/urls.ts";
import { ETAPE_SHORT, type Etape } from "../../shared/etapes.ts";
import { etapeTitle } from "../../extrait/texts.ts";
import { T, percent, withPercent } from "./strings.ts";

// ---- choix proposés --------------------------------------------------------------------------
/** MP4 : Auto / 1080p / 720p / 480p (+ la qualité réglée dans les options si elle est différente). */
export const BASE_QUALITIES: readonly Quality[] = ["best", "1080", "720", "480"];
export const MP3_BITRATES: readonly Bitrate[] = BITRATES;

export function qualityChoices(preferred: Quality): Quality[] {
  const set = new Set<Quality>(BASE_QUALITIES);
  if (QUALITIES.includes(preferred)) set.add(preferred);
  return QUALITIES.filter((q) => set.has(q));
}

export function qualityLabel(q: Quality): string {
  return q === "best" ? "Auto" : `${q}p`;
}

export interface Choice {
  fmt: Fmt;
  quality: Quality;
  bitrate: Bitrate;
  /** Rang de la vidéo dans la publication (X), à partir de 1 ; ignoré s'il n'y a qu'une vidéo. */
  index: number;
}

export function initialChoice(s: Pick<Settings, "defaultFmt" | "quality" | "bitrate">): Choice {
  return {
    fmt: s.defaultFmt === "mp3" ? "mp3" : "mp4",
    quality: QUALITIES.includes(s.quality) ? s.quality : "best",
    bitrate: BITRATES.includes(s.bitrate) ? s.bitrate : 192,
    index: 1,
  };
}

// ---- requête job.start -----------------------------------------------------------------------
export type MediaForJob = Pick<DetectedMedia, "platform" | "id" | "url" | "title" | "videoCount">;

/**
 * Requête « job.start » prête à envoyer, ou null si le média ou le choix est invalide.
 * L'URL est re-validée par parseMediaUrl (URL canonique, aucune URL arbitraire), puis le message entier
 * passe par le validateur du service worker (parseBgRequest) : ce qui sort d'ici sera accepté tel quel.
 * `dest` (3.5.1) : « premiere » ajoute dest: "premiere" ; Téléchargements laisse la requête telle qu'avant.
 */
export function buildStartJob(media: MediaForJob, choice: Choice, dest: Destination = "downloads"): StartJob | null {
  const ref = parseMediaUrl(media.url);
  if (!ref || ref.kind === "shortlink" || ref.platform !== media.platform || ref.id !== media.id) return null;
  const raw: Record<string, unknown> = { type: "job.start", url: ref.url, fmt: choice.fmt };
  if (dest === "premiere") raw.dest = "premiere";
  if (choice.fmt === "mp4") raw.quality = choice.quality;
  else raw.bitrate = choice.bitrate;
  const count = typeof media.videoCount === "number" && Number.isInteger(media.videoCount) ? media.videoCount : 1;
  if (ref.platform === "twitter" && count > 1) {
    if (!Number.isInteger(choice.index) || choice.index < 1 || choice.index > count) return null;
    raw.index = choice.index;
  }
  const title = typeof media.title === "string" ? cleanText(media.title, 200) : "";
  if (title) raw.title = title;
  const parsed = parseBgRequest(raw);
  return parsed && parsed.type === "job.start" ? parsed : null;
}

// ---- état d'un job → affichage ----------------------------------------------------------------
export interface SafeError {
  code: string;
  message: string;
  retryable: boolean;
}

/** Vue d'un job reçue du service worker, validée (voir protocol.ts). */
export interface SafeJob {
  key: string;
  url: string;
  state: JobState;
  progress?: number;
  error?: SafeError;
  index?: number;
  fmt?: Fmt;
  updatedAt: number;
  /** 3.5.2 : AETHRYON Desktop n’a pas reçu cet envoi vers Premiere (ligne calme sous l’état). */
  desktop?: "absent";
  /** 3.8.1 : envoi vers Premiere Pro relayé à AETHRYON Desktop, et son étape (« desktop », « import »). */
  premiere?: true;
  stage?: "desktop" | "import";
  /** 3.6.0 : extrait (passage d'une vidéo), son étape réelle, et GIF. */
  clip?: true;
  etape?: Etape;
  gif?: true;
}

/** « auth » : connexion nécessaire (ou notice à accepter) ; « signing » : fenêtre de connexion ouverte ;
 *  « linked » : connexion réussie depuis la page, prêt à télécharger. */
export type Phase = "idle" | "sending" | "auth" | "signing" | "linked" | JobState;

/** Action proposée dans le popover à la place de « Réessayer ». */
export type PopAction = "login" | "consent" | "keys";

export interface JobDisplay {
  phase: Phase;
  /** Ligne d'état dans le popover : « Conversion… 42 % ». */
  label: string;
  /** Texte court sur le bouton : « 42 % », « En file », « Enregistré ». */
  short: string;
  progress: number | null;
  /** Message d'erreur (phrase du serveur, en français). */
  message: string | null;
  retryable: boolean;
  /** Job en cours : formulaire désactivé. */
  busy: boolean;
  /** Bouton d'action (se connecter, lire la notice, ouvrir « Mes jetons »), à la place de « Réessayer ». */
  action?: PopAction;
  /** 3.5.2 : ligne calme sous l'état (« Installe AETHRYON Desktop pour suivre l'envoi »), jamais une erreur. */
  note?: string;
  /** 3.6.0 : code de l'erreur (ex. extrait_partiel_impossible), pour l'avancement de l'extrait. */
  code?: string;
}

export function normProgress(p: unknown): number | null {
  return typeof p === "number" && Number.isFinite(p) ? Math.round(Math.min(100, Math.max(0, p))) : null;
}

export const IDLE: JobDisplay = { phase: "idle", label: "", short: T.trigger, progress: null, message: null, retryable: false, busy: false };

export function describeSending(): JobDisplay {
  return { phase: "sending", label: T.sending, short: T.sending, progress: null, message: null, retryable: false, busy: true };
}

export function describeFailure(err: SafeError): JobDisplay {
  // Rien n'a échoué : il faut d'abord se connecter, ou accepter la notice sur les données.
  if (err.code === "auth_required") return { phase: "auth", label: T.authNeeded, short: T.trigger, progress: null, message: err.message || null, retryable: false, busy: false, action: "login" };
  if (err.code === "consent_required") return { phase: "auth", label: T.consentNeeded, short: T.trigger, progress: null, message: err.message || null, retryable: false, busy: false, action: "consent" };
  return { phase: "error", label: T.failedShort, short: T.failedShort, progress: null, message: err.message || T.errGeneric, retryable: err.retryable, busy: false, code: err.code };
}

/** Fenêtre de connexion ouverte depuis la page (bouton « Se connecter à AETHRYON »). */
export function describeSigningIn(): JobDisplay {
  return { phase: "signing", label: T.signingIn, short: T.signingIn, progress: null, message: T.signingInHint, retryable: false, busy: true };
}

/** Connexion réussie depuis la page : le formulaire est de nouveau utilisable. */
export function describeSignedIn(): JobDisplay {
  return { phase: "linked", label: T.signedIn, short: T.trigger, progress: null, message: T.signedInHint, retryable: false, busy: false };
}

/** Échec de la connexion : la cause dite par le service worker, et le moyen de recommencer. */
export function describeSignInFailure(err: SafeError): JobDisplay {
  if (err.code === "consent_required") return describeFailure(err);
  const action: PopAction = err.code === "too_many_extensions" ? "keys" : "login";
  return { phase: "auth", label: T.signInFailed, short: T.trigger, progress: null, message: err.message || T.errGeneric, retryable: false, busy: false, action };
}

/** La notice vient d'être ouverte dans un onglet. */
export function describeNoticeOpened(): JobDisplay {
  return { phase: "auth", label: T.consentNeeded, short: T.trigger, progress: null, message: T.noticeOpened, retryable: false, busy: false, action: "consent" };
}

export function describeJob(job: Pick<SafeJob, "state" | "progress" | "error" | "desktop" | "clip" | "etape" | "premiere" | "stage">): JobDisplay {
  const d = job.clip && job.etape ? describeClipState(job as Pick<SafeJob, "state" | "progress" | "error"> & { etape: Etape }) : describeJobState(job);
  // 3.8.1 : Premiere Pro par AETHRYON Desktop : « Envoyé à AETHRYON Desktop », « Import dans Premiere… », « Importé ».
  if (job.premiere) {
    if (d.phase === "queued" && job.stage === "desktop") d.label = d.short = T.premiereSent;
    else if (d.phase === "downloading" && job.stage === "import") d.label = d.short = T.premiereImporting;
    else if (d.phase === "done") d.label = d.short = T.premiereDone;
  }
  // Envoi vers Premiere non suivi par le Desktop : le fichier arrive quand même dans Téléchargements › AETHRYON.
  if (job.desktop === "absent" && d.phase !== "error" && d.phase !== "cancelled" && d.phase !== "auth") d.note = T.desktopMissing;
  return d;
}

/**
 * Extrait (3.6.0) : l'étape réelle du serveur (« Récupération de l’extrait »), avec un pourcentage seulement s'il est
 * mesuré ; sans mesure, la barre est indéterminée (progress null). « Enregistré » reste réservé au fichier écrit.
 */
function describeClipState(job: Pick<SafeJob, "state" | "progress" | "error"> & { etape: Etape }): JobDisplay {
  const p = normProgress(job.progress);
  if (job.state === "queued" || job.state === "converting" || job.state === "downloading") {
    const e: Etape = job.state === "downloading" && job.etape === "termine" ? "finalisation" : job.etape;
    return { phase: job.state, label: etapeTitle(e, p), short: p === null ? ETAPE_SHORT[e] : percent(p), progress: p, message: null, retryable: false, busy: true };
  }
  return describeJobState(job);
}

function describeJobState(job: Pick<SafeJob, "state" | "progress" | "error">): JobDisplay {
  const p = normProgress(job.progress);
  switch (job.state) {
    case "queued":
      return { phase: "queued", label: T.queued, short: T.queued, progress: null, message: null, retryable: false, busy: true };
    case "converting":
      return { phase: "converting", label: withPercent(T.converting, p), short: p === null ? T.converting : percent(p), progress: p, message: null, retryable: false, busy: true };
    case "downloading":
      return { phase: "downloading", label: withPercent(T.downloading, p), short: p === null ? T.downloading : percent(p), progress: p, message: null, retryable: false, busy: true };
    case "done":
      // « Enregistré » UNIQUEMENT ici : le service worker n'envoie « done » qu'une fois le fichier écrit sur le disque.
      return { phase: "done", label: T.done, short: T.done, progress: 100, message: null, retryable: false, busy: false };
    case "cancelled":
      return { phase: "cancelled", label: T.cancelled, short: T.cancelled, progress: null, message: null, retryable: true, busy: false };
    case "error":
    default:
      return describeFailure(job.error ?? { code: "unknown", message: T.errGeneric, retryable: true });
  }
}

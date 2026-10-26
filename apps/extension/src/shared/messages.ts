// Protocole des messages internes, validé à la réception (le service worker ne fait confiance à aucun
// contenu venant d'une page, même par l'intermédiaire de notre content script).
import { parseClip } from "./clip.ts";
import { BITRATES, DESTINATIONS, QUALITIES, type AccountView, type Clip, type AuthChangeReason, type Bitrate, type ConsentView, type Destination, type DetectedMedia, type Fmt, type JobError, type JobView, type Quality, type Settings, type UpdateNotice, type LoadHint, type UpdateProgress } from "./types.ts";

// ---- requêtes vers le service worker -----------------------------------------------------------
export interface StartJob {
  type: "job.start";
  url: string;
  fmt: Fmt;
  quality?: Quality;
  bitrate?: Bitrate;
  index?: number;
  title?: string;
  /**
   * V3 : extrait [start, end] (secondes, à la milliseconde) ; avec gif, le serveur en fait un GIF. 3.6.0 : envoyé au
   * serveur en startMs / endMs ; aucune durée maximale vérifiée ici (celle du serveur, revérifiée par lui).
   */
  clip?: Clip;
  gif?: true;
  /**
   * 3.5.1 : « premiere » = fichier enregistré dans Téléchargements/AETHRYON (panneau AETHRYON de Premiere Pro) ;
   * absent ou « downloads » = Téléchargements, exactement comme avant. Sans effet sur un GIF.
   */
  dest?: Destination;
}
export type JobAction = { type: "job.retry" | "job.cancel" | "job.dismiss" | "download.show"; key: string };
/** Image de la vidéo `url` envoyée par le content script (PNG en data:, vérifié par le service worker). */
export interface FrameSave { type: "frame.save"; url: string; dataUrl: string; at?: number; title?: string }
/** Miniature de la vidéo `url` à enregistrer (adresse revalidée : serveurs d'images des plateformes seulement). */
export interface ThumbSave { type: "thumb.save"; url: string; thumbnail: string; title?: string }
/**
 * « Ouvrir dans AETHRYON Tools » : un élément du centre de téléchargements (key) ou un lien de vidéo (url), avec en
 * V3.5 le passage réglé dans la vue « Extrait » (Tools le présélectionne).
 */
export type ToolsOpen = { type: "tools.open"; key: string } | { type: "tools.open"; url: string; clip?: Clip };
/** Section de la page d'accueil à afficher (ancre). */
export type WelcomeSection = "donnees" | "connexion";
/**
 * 3.6.0 : le popup règle un extrait sur la vidéo de l'onglet actif (son lecteur sert de mini-lecteur) : instant de
 * lecture et durée, aller à un instant, lire le passage, arrêter. Relayé par le service worker au content script de
 * l'onglet actif (le popup ne parle qu'au service worker) ; jamais accepté d'un content script.
 */
export type PlayerOp =
  | { op: "times" }
  | { op: "seek"; t: number }
  | { op: "preview"; start: number; end: number }
  | { op: "stop" };
export type PlayerRequest = { type: "player" } & PlayerOp;
/** Réponse du content script (revalidée) : instants en secondes, à la milliseconde. */
export interface PlayerState { currentTime?: number; duration?: number; paused?: boolean; previewing?: boolean }
export type BgRequest =
  | StartJob
  | JobAction
  | FrameSave
  | ThumbSave
  | ToolsOpen
  | { type: "frame.capture" }
  | { type: "caps.get" }
  | { type: "limits.get" }
  | PlayerRequest
  | { type: "jobs.list" }
  | { type: "popup.init" }
  | { type: "account.refresh" }
  | { type: "auth.login" }
  | { type: "auth.logout" }
  | { type: "consent.accept"; version: number }
  | { type: "consent.withdraw" }
  | { type: "welcome.open"; section?: WelcomeSection }
  | { type: "update.dismiss"; version: string }
  /** Mise à jour en un clic : seulement la version vue annoncée (jamais d'adresse ni de chemin). Pages seulement. */
  | { type: "update.install"; version: string }
  | { type: "update.hint.dismiss" };

export type BgResponse<T> = { ok: true; data: T } | { ok: false; error: JobError };

export interface PopupInit {
  account: AccountView;
  detected: DetectedMedia | null;
  /** Page prise en charge mais sans vidéo identifiable (ex. fil X : utiliser le bouton sous la publication). */
  pageHint: string | null;
  jobs: JobView[];
  settings: Settings;
  version: string;
  /** Notice sur les données acceptée ? Sinon : ni connexion, ni téléchargement, ni requête vers un serveur. */
  consent: ConsentView;
  /** Nouvelle version annoncée (et pas masquée par l'utilisateur), sinon null. */
  update: UpdateNotice | null;
  /** Mise à jour installée par AETHRYON Desktop mais pas chargée : chargement unique à expliquer, sinon null. */
  loadHint: LoadHint | null;
}

// ---- messages du service worker vers un onglet ------------------------------------------------
export type TabMessage = { type: "job.update"; job: JobView } | { type: "detect.request" } | { type: "frame.grab" } | ({ type: "player.cmd" } & PlayerOp);
export type DetectResponse = { media: DetectedMedia | null; hint: string | null };

/**
 * Réponse du content script à « frame.grab » : l'image courante de la vidéo principale (PNG en data:), ou pourquoi
 * elle n'a pas pu être lue sur la page — pas de vidéo, pas encore d'image, vidéo d'une autre origine sans
 * autorisation (canvas « contaminé ») — avec alors la place de la vidéo dans l'onglet (pixels CSS) pour une capture
 * de l'onglet par le service worker.
 */
export type FrameGrab =
  | { ok: true; dataUrl: string; width: number; height: number; at: number }
  | { ok: false; reason: "no_video" | "not_ready" | "tainted" | "drm"; rect?: { x: number; y: number; width: number; height: number }; viewport?: { width: number; height: number }; at?: number };

// ---- annonces du service worker aux pages de l'extension (popup, réglages, accueil) ---------------
/** Liaison changée : clé refusée (motif), déconnexion, nouvelle connexion, accord retiré. */
export interface AuthChanged { type: "auth.changed"; connected: boolean; reason: AuthChangeReason; message?: string }
/** Avis de nouvelle version (null : plus rien à montrer). */
export interface UpdateChanged { type: "update.changed"; update: UpdateNotice | null }
/** Mise à jour en un clic : étape réelle en cours (null : terminée ou abandonnée). */
export interface UpdateProgressEvent { type: "update.progress"; progress: UpdateProgress | null }
export interface UpdateHintEvent { type: "update.hint"; hint: LoadHint | null }
export type PageEvent = { type: "job.update"; job: JobView } | AuthChanged | UpdateChanged | UpdateProgressEvent | UpdateHintEvent;

// ---- validation --------------------------------------------------------------------------------
const FMTS: readonly string[] = ["mp4", "mp3"];
const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
/** Image PNG en data: (base64) : 24 Mo d'image au plus (une image 4K en PNG pèse 5 à 15 Mo). */
export const FRAME_DATA_MAX = 32_000_000;
const FRAME_PREFIX = "data:image/png;base64,";

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Message reçu → requête typée, ou null (rejet silencieux de tout ce qui est inattendu). */
export function parseBgRequest(msg: unknown): BgRequest | null {
  if (!isObj(msg) || typeof msg.type !== "string") return null;
  switch (msg.type) {
    case "frame.capture":
      return Object.keys(msg).length === 1 ? { type: "frame.capture" } : null;
    case "frame.save": {
      if (Object.keys(msg).some((k) => !["type", "url", "dataUrl", "at", "title"].includes(k))) return null;
      if (typeof msg.url !== "string" || msg.url.length > 2048) return null;
      if (typeof msg.dataUrl !== "string" || msg.dataUrl.length > FRAME_DATA_MAX || !msg.dataUrl.startsWith(FRAME_PREFIX)) return null;
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(msg.dataUrl.slice(FRAME_PREFIX.length))) return null;
      const out: FrameSave = { type: "frame.save", url: msg.url, dataUrl: msg.dataUrl };
      if (msg.at !== undefined) {
        if (typeof msg.at !== "number" || !Number.isFinite(msg.at) || msg.at < 0 || msg.at > 86_400) return null;
        out.at = msg.at;
      }
      if (msg.title !== undefined) {
        if (typeof msg.title !== "string") return null;
        out.title = cleanText(msg.title, 200);
      }
      return out;
    }
    case "thumb.save": {
      if (Object.keys(msg).some((k) => !["type", "url", "thumbnail", "title"].includes(k))) return null;
      if (typeof msg.url !== "string" || msg.url.length > 2048 || typeof msg.thumbnail !== "string" || msg.thumbnail.length > 2048) return null;
      const out: ThumbSave = { type: "thumb.save", url: msg.url, thumbnail: msg.thumbnail };
      if (msg.title !== undefined) {
        if (typeof msg.title !== "string") return null;
        out.title = cleanText(msg.title, 200);
      }
      return out;
    }
    case "tools.open": {
      const keys = Object.keys(msg);
      if (typeof msg.key === "string") return keys.length === 2 && KEY_RE.test(msg.key) ? { type: "tools.open", key: msg.key } : null;
      if (typeof msg.url === "string" && msg.url.length <= 2048) {
        if (msg.clip === undefined) return keys.length === 2 ? { type: "tools.open", url: msg.url } : null;
        const clip = parseClip(msg.clip); // Tools règle ensuite le passage
        return clip && keys.length === 3 ? { type: "tools.open", url: msg.url, clip } : null;
      }
      return null;
    }
    case "player":
      return parsePlayerOp(msg, "player") as PlayerRequest | null;
    case "caps.get":
    case "limits.get":
    case "jobs.list":
    case "popup.init":
    case "account.refresh":
    case "auth.login":
    case "auth.logout":
    case "consent.withdraw":
      return Object.keys(msg).length === 1 ? ({ type: msg.type } as BgRequest) : null;
    case "consent.accept":
      return Object.keys(msg).length === 2 && typeof msg.version === "number" && Number.isInteger(msg.version) && msg.version > 0 && msg.version < 1000
        ? { type: "consent.accept", version: msg.version }
        : null;
    case "welcome.open": {
      const keys = Object.keys(msg);
      if (keys.some((k) => k !== "type" && k !== "section")) return null;
      if (msg.section === undefined) return { type: "welcome.open" };
      return msg.section === "donnees" || msg.section === "connexion" ? { type: "welcome.open", section: msg.section } : null;
    }
    case "update.dismiss":
    case "update.install":
      return Object.keys(msg).length === 2 && typeof msg.version === "string" && /^\d{1,5}(\.\d{1,5}){0,3}$/.test(msg.version)
        ? { type: msg.type, version: msg.version }
        : null;
    case "update.hint.dismiss":
      return Object.keys(msg).length === 1 ? { type: "update.hint.dismiss" } : null;
    case "job.retry":
    case "job.cancel":
    case "job.dismiss":
    case "download.show":
      return typeof msg.key === "string" && KEY_RE.test(msg.key) && Object.keys(msg).length === 2
        ? { type: msg.type, key: msg.key }
        : null;
    case "job.start": {
      const allowed = new Set(["type", "url", "fmt", "quality", "bitrate", "index", "title", "clip", "gif", "dest"]);
      if (Object.keys(msg).some((k) => !allowed.has(k))) return null;
      if (typeof msg.url !== "string" || msg.url.length > 2048) return null;
      if (typeof msg.fmt !== "string" || !FMTS.includes(msg.fmt)) return null;
      const out: StartJob = { type: "job.start", url: msg.url, fmt: msg.fmt as Fmt };
      if (msg.quality !== undefined) {
        if (typeof msg.quality !== "string" || !(QUALITIES as readonly string[]).includes(msg.quality)) return null;
        out.quality = msg.quality as Quality;
      }
      if (msg.bitrate !== undefined) {
        if (typeof msg.bitrate !== "number" || !(BITRATES as readonly number[]).includes(msg.bitrate)) return null;
        out.bitrate = msg.bitrate as Bitrate;
      }
      if (msg.index !== undefined) {
        if (typeof msg.index !== "number" || !Number.isInteger(msg.index) || msg.index < 1 || msg.index > 50) return null;
        out.index = msg.index;
      }
      if (msg.title !== undefined) {
        if (typeof msg.title !== "string") return null;
        out.title = cleanText(msg.title, 200);
      }
      if (msg.dest !== undefined) {
        if (typeof msg.dest !== "string" || !(DESTINATIONS as readonly string[]).includes(msg.dest)) return null;
        out.dest = msg.dest as Destination;
      }
      // GIF : seulement à partir d'un extrait (fmt « mp4 ») ; la durée maximale est celle du serveur (3.6.0).
      if (msg.gif !== undefined && (msg.gif !== true || out.fmt !== "mp4" || msg.clip === undefined)) return null;
      if (msg.clip !== undefined) {
        const clip = parseClip(msg.clip);
        if (!clip) return null;
        out.clip = clip;
        if (msg.gif === true) out.gif = true;
      }
      return out;
    }
    default:
      return null;
  }
}

const instant = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 86_400;

/**
 * Commande du lecteur (3.6.0) : « player » (popup → service worker) ou « player.cmd » (service worker → onglet),
 * champs exacts, instants de 0 à 24 h. null si quoi que ce soit dépasse.
 */
export function parsePlayerOp(msg: Record<string, unknown>, type: "player" | "player.cmd"): ({ type: typeof type } & PlayerOp) | null {
  const keys = Object.keys(msg).sort().join(",");
  switch (msg.op) {
    case "times":
    case "stop":
      return keys === "op,type" ? { type, op: msg.op } : null;
    case "seek":
      return keys === "op,t,type" && instant(msg.t) ? { type, op: "seek", t: Math.round(msg.t * 1000) / 1000 } : null;
    case "preview":
      return keys === "end,op,start,type" && instant(msg.start) && instant(msg.end) && msg.end > msg.start
        ? { type, op: "preview", start: Math.round(msg.start * 1000) / 1000, end: Math.round(msg.end * 1000) / 1000 }
        : null;
    default:
      return null;
  }
}

/** Réponse (non fiable) d'un content script à « player.cmd » → état revalidé (instants arrondis à la ms). */
export function parsePlayerState(raw: unknown): PlayerState | null {
  if (!isObj(raw)) return null;
  const out: PlayerState = {};
  if (instant(raw.currentTime)) out.currentTime = Math.round(raw.currentTime * 1000) / 1000;
  if (instant(raw.duration) && raw.duration > 0) out.duration = Math.round(raw.duration * 1000) / 1000;
  if (typeof raw.paused === "boolean") out.paused = raw.paused;
  if (typeof raw.previewing === "boolean") out.previewing = raw.previewing;
  return out;
}

/** Texte venant d'une page : sans caractères de contrôle, borné ; affiché ensuite par textContent. */
export function cleanText(s: string, max: number): string {
  // Espaces réduites, sauf l'espace insécable (typographie française des messages : « réessaie : … »).
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, " ").replace(/[^\S\u00a0]+/g, " ").replace(/ ?\u00a0 ?/g, "\u00a0").trim().slice(0, max);
}

/**
 * L'expéditeur est-il une page de notre propre extension (popup, réglages ouverts dans un onglet) ?
 * Le critère est l'origine chrome-extension://<notre id>/ : un content script a l'URL de la page web
 * (https://…) et n'est donc jamais accepté ici, même s'il appartient à notre extension.
 */
export function isExtensionPage(sender: chrome.runtime.MessageSender, extensionId: string): boolean {
  return sender.id === extensionId && typeof sender.url === "string" && sender.url.startsWith(`chrome-extension://${extensionId}/`);
}

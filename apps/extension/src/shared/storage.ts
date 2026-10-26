// Accès typé au stockage de l'extension.
// - storage.sync    : réglages (aucune donnée sensible) ;
// - storage.local   : session d'extension (jeton ytc_ de type « extension », date d'expiration, profil) ;
//                     lu UNIQUEMENT par le service worker (les content scripts n'y touchent jamais) ;
// - storage.session : jobs en cours (mémoire du navigateur, effacée à sa fermeture), pour survivre aux
//                     redémarrages du service worker.
import { AUTH_LOST_REASONS, DEFAULT_SETTINGS, type AuthNotice, type JobView, type Settings } from "./types.ts";

const SETTINGS_KEY = "settings";
const AUTH_KEY = "auth";
const NOTICE_KEY = "authNotice";
const JOBS_KEY = "jobs";

export interface AuthState {
  token: string;
  expiresAt: string | null;
  email: string;
  name: string;
  linkedAt: string;
}

export async function getSettings(): Promise<Settings> {
  const raw = (await chrome.storage.sync.get(SETTINGS_KEY))[SETTINGS_KEY] as Partial<Settings> | undefined;
  return mergeSettings(raw);
}

export function mergeSettings(raw: Partial<Settings> | undefined): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS, platforms: { ...DEFAULT_SETTINGS.platforms } };
  if (!raw || typeof raw !== "object") return s;
  if (typeof raw.inlineButtons === "boolean") s.inlineButtons = raw.inlineButtons;
  if (raw.platforms && typeof raw.platforms === "object") {
    for (const p of ["youtube", "tiktok", "twitter"] as const) {
      if (typeof raw.platforms[p] === "boolean") s.platforms[p] = raw.platforms[p];
    }
  }
  if (raw.defaultFmt === "mp4" || raw.defaultFmt === "mp3") s.defaultFmt = raw.defaultFmt;
  if (typeof raw.quality === "string" && ["best", "2160", "1440", "1080", "720", "480", "360"].includes(raw.quality)) s.quality = raw.quality;
  if (raw.bitrate === 128 || raw.bitrate === 192 || raw.bitrate === 320) s.bitrate = raw.bitrate;
  if (typeof raw.floatingPanel === "boolean") s.floatingPanel = raw.floatingPanel;
  if (raw.panelPosition && typeof raw.panelPosition === "object" && Number.isFinite(raw.panelPosition.x) && Number.isFinite(raw.panelPosition.y)) {
    s.panelPosition = { x: Math.round(raw.panelPosition.x), y: Math.round(raw.panelPosition.y) };
  }
  if (typeof raw.notifications === "boolean") s.notifications = raw.notifications;
  if (raw.clipLength === 10 || raw.clipLength === 15 || raw.clipLength === 30 || raw.clipLength === 60) s.clipLength = raw.clipLength;
  if (raw.clipAnchor === "before" || raw.clipAnchor === "around" || raw.clipAnchor === "after") s.clipAnchor = raw.clipAnchor;
  if (typeof raw.pageTools === "boolean") s.pageTools = raw.pageTools;
  if (raw.ytToolbar === "open" || raw.ytToolbar === "collapsed") s.ytToolbar = raw.ytToolbar;
  if (raw.destination === "downloads" || raw.destination === "premiere") s.destination = raw.destination;
  if (typeof raw.premiereHintSeen === "boolean") s.premiereHintSeen = raw.premiereHintSeen;
  return s;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = mergeSettings({ ...(await getSettings()), ...patch });
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}

/** Écoute des réglages : storage.SYNC uniquement (jamais chrome.storage.onChanged, qui transmettrait aussi
 *  les changements de storage.local — la session et son jeton — à tout contexte qui écoute). */
export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
    if (changes[SETTINGS_KEY]) cb(mergeSettings(changes[SETTINGS_KEY].newValue as Partial<Settings>));
  };
  chrome.storage.sync.onChanged.addListener(listener);
  return () => chrome.storage.sync.onChanged.removeListener(listener);
}

// ---- session d'extension (service worker uniquement) ------------------------------------------
/** Liaison enregistrée, même expirée (pour dire pourquoi elle ne vaut plus rien). */
export async function getStoredAuth(): Promise<AuthState | null> {
  const a = (await chrome.storage.local.get(AUTH_KEY))[AUTH_KEY] as AuthState | undefined;
  if (!a || typeof a.token !== "string" || !a.token.startsWith("ytc_")) return null;
  return a;
}
export const isExpired = (a: Pick<AuthState, "expiresAt">, now = Date.now()): boolean =>
  !!a.expiresAt && Date.parse(a.expiresAt) <= now;
/** Liaison utilisable (présente et non expirée). */
export async function getAuth(): Promise<AuthState | null> {
  const a = await getStoredAuth();
  return a && !isExpired(a) ? a : null;
}
export async function setAuth(a: AuthState): Promise<void> { await chrome.storage.local.set({ [AUTH_KEY]: a }); }
export async function clearAuth(): Promise<void> { await chrome.storage.local.remove(AUTH_KEY); }

// ---- motif de la dernière déconnexion imposée par le serveur (service worker) ----------------------
export async function getNotice(): Promise<AuthNotice | null> {
  const n = (await chrome.storage.local.get(NOTICE_KEY))[NOTICE_KEY] as AuthNotice | undefined;
  return n && AUTH_LOST_REASONS.includes(n.reason) && typeof n.message === "string" && typeof n.at === "number" ? n : null;
}
export async function setNotice(n: AuthNotice): Promise<void> { await chrome.storage.local.set({ [NOTICE_KEY]: n }); }
export async function clearNotice(): Promise<void> { await chrome.storage.local.remove(NOTICE_KEY); }

// ---- jobs (service worker) ---------------------------------------------------------------------
export async function getJobs(): Promise<JobView[]> {
  const j = (await chrome.storage.session.get(JOBS_KEY))[JOBS_KEY] as JobView[] | undefined;
  return Array.isArray(j) ? j : [];
}
export async function setJobs(jobs: JobView[]): Promise<void> {
  // On garde les 30 plus récents : l'historique complet est sur le site.
  const kept = [...jobs].sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
  await chrome.storage.session.set({ [JOBS_KEY]: kept });
}

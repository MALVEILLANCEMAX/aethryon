// Liaison navigateur → AETHRYON Desktop (3.5.2, étape D ; contrat d'échange §6 et §8 ; docs/EXTENSION.md §12).
// Pendant un « Envoyer vers Premiere Pro », le service worker annonce l'envoi à l'hôte Native Messaging
// `fr.aethryon.desktop` (aethryon-desktop.exe, lancé par Chrome), qui écrit SEULEMENT `transferts\<id>.json` :
// le Desktop et le panneau AETHRYON de Premiere montrent l'envoi en cours, puis le Desktop le relie au fichier arrivé.
// Règles :
// - permission « nativeMessaging » FACULTATIVE, demandée par le popup ou les réglages au moment où l'utilisateur
//   choisit « Premiere Pro » (src/shared/desktop.ts) ; sans elle, chrome.runtime.connectNative n'existe pas et rien
//   n'est envoyé ;
// - liste fermée de champs (contrat §6) : type, id, titre, plateforme, format, etat, progression, fichierAttendu.
//   Le message est CONSTRUIT champ par champ : ni jeton, ni adresse (de la vidéo, du fichier signé, de l'API), ni
//   cookie, ni donnée de compte, ni identifiant du serveur. Le titre est nettoyé de toute adresse ;
// - « pret » n'est JAMAIS envoyé : il appartient au Desktop, qui relie le transfert au média arrivé (contrat §6) ;
//   un fichier écrit est annoncé « telechargement » à 1 avec son nom définitif ;
// - fichierAttendu : seulement le nom DÉFINITIF donné par Chrome (après « uniquify »), jamais un nom provisoire (le
//   Desktop relierait l'envoi à un ancien fichier du même nom), et seulement s'il passe la validation du Desktop ;
// - progression limitée : un changement d'état part tout de suite, la progression au plus toutes les PROGRESS_MS ;
// - UN seul port partagé, ouvert au premier envoi, fermé IDLE_MS après le dernier envoi terminé : un seul processus
//   hôte à la fois, quel que soit le nombre d'envois, et aucun processus qui reste après ;
// - hôte absent (Desktop non installé) ou en erreur : le fichier va quand même dans Téléchargements › AETHRYON ;
//   l'envoi est marqué « absent » (ligne calme « Installe AETHRYON Desktop pour suivre l'envoi »), sans fenêtre
//   d'erreur, et aucune nouvelle tentative avant RETRY_MS.
import { cleanText } from "../shared/messages.ts";
import type { DesktopLink, JobState, JobView } from "../shared/types.ts";

export { DESKTOP_HOST } from "../shared/desktop.ts";

export type TransferEtat = "attente" | "telechargement" | "conversion" | "pret" | "erreur";
/** Champs admis par l'hôte (desktop/noyau/src/nm.rs, CHAMPS_TRANSFERT) : tout autre champ fait refuser le message. */
export const TRANSFER_FIELDS = ["type", "id", "titre", "plateforme", "format", "etat", "progression", "fichierAttendu"] as const;

export interface TransferMessage {
  type: "transfert";
  id: string;
  titre?: string;
  plateforme?: "youtube" | "tiktok" | "x";
  format?: "mp4" | "mp3";
  etat: TransferEtat;
  progression?: number;
  fichierAttendu?: string;
}

/** Délais par défaut (src/background/timing.ts, desktop*) : le Desktop et le panneau relisent toutes les 2 s. */
export const PROGRESS_MS = 2_000;
export const IDLE_MS = 3_000;
export const RETRY_MS = 30_000;

/** Envois suivis : vidéo ou audio entiers (ou extrait MP4/MP3) vers Premiere ; jamais un GIF, une image, une miniature. */
export function tracksDesktop(job: Pick<JobView, "dest" | "kind" | "fmt">): boolean {
  return job.dest === "premiere" && job.kind === undefined && (job.fmt === "mp4" || job.fmt === "mp3");
}

/**
 * États de l'extension → états du contrat : queued → attente ; converting → conversion ; downloading → telechargement ;
 * done → telechargement (fichier écrit : progression 1, nom définitif ; « pret » est posé par le Desktop quand il le
 * voit arriver) ; error et cancelled → erreur.
 */
export function transferEtat(state: JobState): TransferEtat {
  switch (state) {
    case "queued":
      return "attente";
    case "converting":
      return "conversion";
    case "downloading":
    case "done":
      return "telechargement";
    default:
      return "erreur";
  }
}

const isFinal = (s: JobState): boolean => s === "done" || s === "error" || s === "cancelled";

/** Identifiant du transfert : la clé locale du travail (aléatoire, jamais l'identifiant du serveur). */
export function transferId(key: unknown): string | null {
  return typeof key === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(key) ? key : null;
}

// Adresses retirées du titre (un titre de page peut en contenir) : schéma://…, www.…, data:, blob:, javascript:…
const URLISH = /\b(?:[a-z][a-z0-9+.-]{0,30}:\/\/|www\.)\S*|\b(?:data|blob|javascript|file|mailto|chrome-extension):\S*/gi;

/** Titre montré par le Desktop et le panneau : texte seul, sans adresse ni caractère de contrôle, 300 caractères. */
export function transferTitle(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = cleanText(raw.normalize("NFC").replace(URLISH, " "), 300);
  return t || undefined;
}

const RESERVED = new Set(["CON", "PRN", "AUX", "NUL", ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => [`COM${n}`, `LPT${n}`])]);
const NAME_MAX = 120; // desktop/noyau/src/noms.rs, NOM_MAX
const utf8Len = (s: string): number => new TextEncoder().encode(s).length;

/**
 * Nom définitif du fichier (le nom seul), s'il est « propre » pour le Desktop (desktop/noyau/src/noms.rs,
 * est_nom_propre : NFC, aucun de <>:"/\|?* ni caractère de contrôle, espaces simples, rien avant ni après, pas
 * d'espace avant l'extension, pas de nom réservé de Windows, 120 caractères au plus). Sinon : absent (l'hôte
 * refuserait tout le message).
 */
export function expectedFile(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const name = raw.split(/[\\/]/).pop() ?? "";
  if (!name || name === "." || name === ".." || name.normalize("NFC") !== name) return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[<>:"/\\|?*\u0000-\u001f\u007f]/.test(name)) return undefined;
  // Espaces : un seul espace ordinaire à la fois, ni au début ni à la fin (le Desktop replie les autres).
  if (/[\s\u0085]/.test(name.replace(/ /g, "")) || / {2}/.test(name) || /^\s/.test(name) || /[. ]$/.test(name)) return undefined;
  const dot = name.lastIndexOf(".");
  if (dot > 0 && utf8Len(name.slice(dot)) <= 8 && /[ .]$/.test(name.slice(0, dot))) return undefined;
  if (RESERVED.has((name.split(".")[0] ?? "").trim().toUpperCase())) return undefined;
  if ([...name].length > NAME_MAX) return undefined;
  if (/:\/\//.test(name)) return undefined;
  return name;
}

const PLATFORM: Record<string, TransferMessage["plateforme"]> = { youtube: "youtube", tiktok: "tiktok", twitter: "x" };

const ratio = (p: unknown): number | undefined =>
  typeof p === "number" && Number.isFinite(p) ? Math.round(Math.min(100, Math.max(0, p))) / 100 : undefined;

/**
 * Message de transfert pour ce travail, construit champ par champ depuis la liste fermée (rien d'autre n'est lu :
 * ni url, ni fileUrl, ni jobId, ni jeton). null si le travail n'est pas un envoi vers Premiere.
 */
export type TransferSource = Pick<JobView, "key" | "dest" | "kind" | "fmt" | "state" | "progress" | "title" | "platform" | "fileName"> & {
  /** Nom écrit par Chrome, sans nettoyage (StoredJob.savedAs) ; à défaut fileName. */
  savedAs?: string;
};

export function transferMessage(job: TransferSource): TransferMessage | null {
  if (!tracksDesktop(job)) return null;
  const id = transferId(job.key);
  if (!id) return null;
  const etat = transferEtat(job.state);
  const msg: TransferMessage = { type: "transfert", id, etat };
  const titre = transferTitle(job.title);
  if (titre) msg.titre = titre;
  const plateforme = PLATFORM[job.platform as string];
  if (plateforme) msg.plateforme = plateforme;
  msg.format = job.fmt;
  if (etat !== "erreur") msg.progression = job.state === "done" ? 1 : job.state === "queued" ? 0 : (ratio(job.progress) ?? 0);
  if (job.state === "downloading" || job.state === "done") {
    const f = expectedFile(job.savedAs ?? job.fileName);
    if (f) msg.fichierAttendu = f;
  }
  return msg;
}

// ---- port partagé ------------------------------------------------------------------------------------------------
export interface NativePort {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(fn: (message: unknown) => void): void };
  onDisconnect: { addListener(fn: () => void): void };
}

export interface DesktopLinkOptions {
  /** chrome.runtime.connectNative(DESKTOP_HOST), ou null quand la permission n'est pas accordée (API absente). */
  connect: () => NativePort | null;
  /** chrome.runtime.lastError?.message, lu dans onDisconnect (jamais montré ni journalisé). */
  lastError?: () => string | undefined;
  /** L'hôte a accepté (« suivi ») ou est absent ou en erreur (« absent ») pour ce travail. */
  onLink: (key: string, link: DesktopLink) => void;
  progressMs?: number;
  idleMs?: number;
  retryMs?: number;
  now?: () => number;
}

interface Entry {
  key: string;
  /** Dernier message posté (et pas perdu). */
  last?: TransferMessage;
  sentAt: number;
  /** Message retenu (progression trop rapprochée, ou hôte indisponible) : le plus récent. */
  pending?: TransferMessage;
  final: boolean;
  link?: DesktopLink;
  /** Messages postés sans réponse encore. */
  inflight: number;
}

const same = (a: TransferMessage | undefined, b: TransferMessage): boolean =>
  !!a && a.etat === b.etat && a.progression === b.progression && a.fichierAttendu === b.fichierAttendu && a.titre === b.titre
  && a.format === b.format && a.plateforme === b.plateforme;

export type DesktopLinkManager = ReturnType<typeof createDesktopLink>;

export function createDesktopLink(opts: DesktopLinkOptions) {
  const progressMs = opts.progressMs ?? PROGRESS_MS;
  const idleMs = opts.idleMs ?? IDLE_MS;
  const retryMs = opts.retryMs ?? RETRY_MS;
  const now = opts.now ?? Date.now;
  const entries = new Map<string, Entry>();
  /** Identifiants des messages postés, dans l'ordre : l'hôte répond à chacun, dans le même ordre. */
  let inflight: string[] = [];
  let port: NativePort | null = null;
  let downUntil = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let connects = 0;
  let stopped = false;

  const setLink = (e: Entry, link: DesktopLink): void => {
    if (e.link === link) return;
    e.link = link;
    try {
      opts.onLink(e.key, link);
    } catch { /* travail retiré entre-temps */ }
  };

  function closePort(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    const p = port;
    port = null;
    inflight = [];
    for (const e of entries.values()) e.inflight = 0;
    if (p) {
      try {
        p.disconnect(); // l'hôte lit la fin de son entrée et s'arrête
      } catch { /* déjà fermé */ }
    }
  }

  /** Retire les envois terminés dont l'hôte a répondu ; plus rien en cours : port fermé après idleMs. */
  function settle(): void {
    for (const [id, e] of entries) if (e.final && !e.pending && e.inflight === 0) entries.delete(id);
    const busy = [...entries.values()].some((e) => !e.final || e.pending || e.inflight > 0);
    if (busy || !port) {
      if (idleTimer && busy) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      return;
    }
    if (!idleTimer) idleTimer = setTimeout(() => { idleTimer = null; if (![...entries.values()].some((e) => !e.final || e.pending)) closePort(); }, idleMs);
  }

  function onReply(reply: unknown): void {
    const id = inflight.shift();
    const e = id === undefined ? undefined : entries.get(id);
    if (!e) return;
    e.inflight = Math.max(0, e.inflight - 1);
    const ok = typeof reply === "object" && reply !== null && (reply as { ok?: unknown }).ok === true;
    if (ok) setLink(e, "suivi");
    else if (e.link !== "suivi") setLink(e, "absent"); // message refusé par l'hôte : pas suivi
    settle();
  }

  /** L'hôte s'est arrêté de lui-même (absent, refusé, planté) : messages en vol perdus, rien avant retryMs. */
  function onDown(p: NativePort): void {
    if (p !== port) return; // ancien port, fermé par nous
    try {
      void opts.lastError?.(); // lu pour que Chrome ne le signale pas comme non vérifié ; jamais affiché
    } catch { /* rien */ }
    port = null;
    inflight = [];
    downUntil = now() + retryMs;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    for (const [id, e] of entries) {
      if (e.inflight > 0 && e.last) e.pending = e.pending ?? e.last; // perdu : à renvoyer plus tard
      e.inflight = 0;
      // Jamais accepté : Desktop absent (ou hôte qui refuse). Déjà suivi : l'hôte reviendra au prochain envoi.
      if (e.link !== "suivi") setLink(e, "absent");
      if (e.final) entries.delete(id); // envoi terminé : pas de nouvelle tentative
    }
  }

  function ensurePort(): NativePort | null {
    if (port) return port;
    let p: NativePort | null = null;
    try {
      p = opts.connect();
    } catch {
      p = null;
    }
    if (!p) return null;
    connects++;
    port = p;
    const mine = p;
    p.onMessage.addListener((m) => { if (mine === port) onReply(m); });
    p.onDisconnect.addListener(() => onDown(mine));
    return p;
  }

  function post(e: Entry, msg: TransferMessage): void {
    if (now() < downUntil) {
      // Hôte indisponible depuis peu : le plus récent est retenu pour le prochain essai ; un envoi terminé est abandonné.
      if (e.final) entries.delete(msg.id);
      else e.pending = msg;
      return;
    }
    const p = ensurePort();
    if (!p) {
      // Permission non accordée (ou API absente) : rien n'est suivi, rien n'est retenu.
      entries.delete(msg.id);
      return;
    }
    try {
      p.postMessage(msg);
    } catch {
      e.pending = msg;
      onDown(p);
      return;
    }
    e.last = msg;
    e.sentAt = now();
    e.pending = undefined;
    e.inflight++;
    inflight.push(msg.id);
    settle();
  }

  function scheduleFlush(): void {
    if (flushTimer || stopped) return;
    let wait = progressMs;
    for (const e of entries.values()) if (e.pending) wait = Math.min(wait, Math.max(0, e.sentAt + progressMs - now()));
    flushTimer = setTimeout(flush, Math.max(wait, 50));
  }

  function flush(): void {
    flushTimer = null;
    if (stopped) return;
    let again = false;
    for (const e of entries.values()) {
      if (!e.pending) continue;
      if (now() < downUntil) continue; // renvoyé au prochain changement du travail
      if (now() - e.sentAt >= progressMs || e.final) post(e, e.pending);
      else again = true;
    }
    if (again) scheduleFlush();
  }

  return {
    /** Changement d'un travail (appelé à chaque écriture) : message envoyé, retenu ou ignoré. */
    update(job: TransferSource & Pick<JobView, "desktop">): void {
      if (stopped) return;
      const msg = transferMessage(job);
      if (!msg) return;
      let e = entries.get(msg.id);
      const final = isFinal(job.state);
      if (!e) {
        if (final && !job.desktop) return; // jamais annoncé (ex. permission accordée après coup) : rien à terminer
        e = { key: job.key, sentAt: 0, final, inflight: 0, link: job.desktop };
        entries.set(msg.id, e);
      }
      if (same(e.pending ?? e.last, msg)) return;
      const ref = e.pending ?? e.last;
      e.final = final;
      const important = !ref || ref.etat !== msg.etat || ref.fichierAttendu !== msg.fichierAttendu || ref.titre !== msg.titre || final;
      if (important || now() - e.sentAt >= progressMs) post(e, msg);
      else {
        e.pending = msg;
        scheduleFlush();
      }
    },
    /** Arrêt du worker : port fermé (l'hôte s'arrête), minuteries coupées. */
    stop(): void {
      stopped = true;
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      closePort();
      entries.clear();
    },
    /** Tests : état courant. */
    get open(): boolean { return port !== null; },
    get connects(): number { return connects; },
    get tracked(): number { return entries.size; },
  };
}

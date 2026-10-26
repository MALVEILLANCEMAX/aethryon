// 3.8.1 : « Envoyer vers › Premiere Pro » relayé à AETHRYON Desktop (contrat d'échange §12, proposé).
// Plus AUCUN téléchargement par Chrome pour cette destination : le service worker envoie à l'hôte Native Messaging
// `fr.aethryon.desktop` (desktop/noyau/src/nm.rs) un message en liste fermée — `envoyer-premiere` : id (clé locale du
// travail), url de la PAGE de la vidéo, format, extrait éventuel (début/fin en secondes), titre ; jamais de jeton,
// jamais d'adresse de fichier signée, jamais d'identifiant du serveur — puis demande l'état RÉEL (`etat-envoi`) toutes
// les POLL_MS sur le même port. Le Desktop convertit avec SA clé, enregistre le fichier dans son dossier des médias et
// l'importe dans Premiere Pro (commande `importer` au panneau, chutier par défaut « AETHRYON »).
// - un seul port tant qu'un envoi est suivi, fermé IDLE_MS après le dernier (l'hôte, processus court, s'arrête) ;
// - hôte absent (Desktop non installé) ou qui s'arrête avant d'accepter : « desktop-absent », sans nouvel essai ;
// - Annuler dans l'extension arrête seulement le suivi (aucun message d'annulation dans la liste fermée).
import { toMs } from "../shared/extrait.ts";
import { cleanText } from "../shared/messages.ts";
import type { Clip, Fmt } from "../shared/types.ts";
import { parseMediaUrl } from "../shared/urls.ts";
import { transferId, transferTitle, type NativePort } from "./desktop.ts";
import { MSG } from "./errors.ts";

/** Champs admis par l'hôte (nm.rs, CHAMPS_ENVOI) : tout autre champ fait refuser le message. */
export const RELAY_FIELDS = ["type", "id", "url", "format", "debut", "fin", "titre"] as const;

export type RelayEtat =
  | "envoye" | "conversion" | "telechargement" | "import"
  | "importe" | "premiere-absent" | "sans-projet" | "non-relie" | "desktop-absent" | "echec";
const ETATS: readonly string[] = ["envoye", "conversion", "telechargement", "import", "importe", "premiere-absent", "sans-projet", "non-relie", "desktop-absent", "echec"];
export const FINAL_ETATS: ReadonlySet<RelayEtat> = new Set(["importe", "premiere-absent", "sans-projet", "non-relie", "desktop-absent", "echec"]);

export interface RelayStatus {
  etat: RelayEtat;
  /** 0 à 1, seulement quand le Desktop la mesure (conversion du serveur, octets reçus). */
  progression?: number;
  /** Phrase claire du Desktop (en français), pour un état final autre que « importe ». */
  message?: string;
}

export interface RelayRequest {
  type: "envoyer-premiere";
  id: string;
  url: string;
  format: Fmt;
  debut?: number;
  fin?: number;
  titre?: string;
}

/** Délais par défaut (timing.ts, desktop*) : le Desktop met le transfert à jour au plus deux fois par seconde. */
export const POLL_MS = 2_000;
export const IDLE_MS = 3_000;
/** Pertes successives du port pendant le suivi avant d'abandonner (« desktop-absent »). */
export const MAX_MISSES = 3;

/**
 * Message `envoyer-premiere` construit champ par champ (rien d'autre n'est lu : ni fileUrl, ni jobId, ni jeton) ;
 * l'adresse est celle de la PAGE, revalidée (parseMediaUrl). null si le travail ne peut pas être relayé.
 */
export function relayRequest(job: { key: string; url: string; fmt: Fmt; clip?: Clip; title?: string }): RelayRequest | null {
  const id = transferId(job.key);
  const ref = parseMediaUrl(job.url);
  if (!id || !ref || ref.kind === "shortlink") return null;
  const msg: RelayRequest = { type: "envoyer-premiere", id, url: ref.url, format: job.fmt === "mp3" ? "mp3" : "mp4" };
  if (job.clip) {
    const r = toMs(job.clip);
    msg.debut = r.startMs / 1000;
    msg.fin = r.endMs / 1000;
  }
  const titre = transferTitle(job.title);
  if (titre) msg.titre = titre;
  return msg;
}

/** Réponse à `etat-envoi` validée champ par champ ; null si elle n'est pas un état connu. */
export function parseRelayStatus(v: unknown): RelayStatus | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.ok !== true || typeof o.etat !== "string" || !ETATS.includes(o.etat)) return null;
  const s: RelayStatus = { etat: o.etat as RelayEtat };
  if (typeof o.progression === "number" && Number.isFinite(o.progression)) s.progression = Math.min(1, Math.max(0, o.progression));
  if (typeof o.message === "string") {
    const m = cleanText(o.message, 400);
    if (m) s.message = m;
  }
  return s;
}

/** Réponse de l'hôte d'un AETHRYON Desktop d'avant la 1.1.0-beta.3 (nm.rs) : il ne connaît pas `envoyer-premiere`. */
export const UNKNOWN_TYPE = "Type de message inconnu.";

/** Refus de l'hôte ; « Type de message inconnu. » (Desktop trop ancien) n'est jamais montré tel quel. */
const refusal = (v: unknown): string | undefined => {
  const e = typeof v === "object" && v !== null ? (v as { erreur?: unknown }).erreur : undefined;
  if (typeof e === "string" && e.trim() === UNKNOWN_TYPE) return MSG.desktopOutdated;
  return typeof e === "string" ? cleanText(e, 300) || undefined : undefined;
};

export interface RelayOptions {
  /** chrome.runtime.connectNative(DESKTOP_HOST), ou null quand la permission n'est pas accordée (API absente). */
  connect: () => NativePort | null;
  /** chrome.runtime.lastError?.message, lu dans onDisconnect (jamais montré ni journalisé). */
  lastError?: () => string | undefined;
  /** État réel d'un envoi (les états finaux terminent son suivi). */
  onStatus: (key: string, status: RelayStatus) => void;
  /** Texte montré quand la permission « nativeMessaging » a disparu en cours de route. */
  permissionText: string;
  pollMs?: number;
  idleMs?: number;
}

interface Entry {
  key: string;
  req: RelayRequest;
  /** L'hôte a accepté `envoyer-premiere` (commande déposée pour le Desktop). */
  accepted: boolean;
  /** Une question attend sa réponse. */
  busy: boolean;
  misses: number;
}

export type PremiereRelay = ReturnType<typeof createPremiereRelay>;

export function createPremiereRelay(opts: RelayOptions) {
  const pollMs = opts.pollMs ?? POLL_MS;
  const idleMs = opts.idleMs ?? IDLE_MS;
  const entries = new Map<string, Entry>();
  /** Questions posées, dans l'ordre : l'hôte répond à chacune, dans le même ordre. */
  let queue: { key: string; kind: "envoi" | "etat" }[] = [];
  let port: NativePort | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let connects = 0;

  function emit(e: Entry, s: RelayStatus): void {
    if (FINAL_ETATS.has(s.etat) && entries.get(e.key) === e) entries.delete(e.key);
    try {
      opts.onStatus(e.key, s);
    } catch { /* travail retiré entre-temps */ }
  }

  function close(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    const p = port;
    port = null;
    queue = [];
    for (const e of entries.values()) e.busy = false;
    if (p) {
      try {
        p.disconnect(); // l'hôte lit la fin de son entrée et s'arrête
      } catch { /* déjà fermé */ }
    }
  }

  /** Plus rien à suivre : port fermé après idleMs ; sinon prochaine question dans pollMs. */
  function settle(): void {
    if (stopped) return;
    if (entries.size === 0) {
      if (timer) clearTimeout(timer);
      timer = null;
      if (port && !idleTimer) idleTimer = setTimeout(() => { idleTimer = null; if (entries.size === 0) close(); }, idleMs);
      return;
    }
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    if (!timer) timer = setTimeout(tick, pollMs);
  }

  function onReply(m: unknown): void {
    const q = queue.shift();
    const e = q && entries.get(q.key);
    if (!q || !e) return settle();
    e.busy = false;
    if (q.kind === "envoi") {
      if (typeof m === "object" && m !== null && (m as { ok?: unknown }).ok === true) {
        e.accepted = true;
        e.misses = 0;
        emit(e, { etat: "envoye" });
      } else {
        emit(e, { etat: "echec", message: refusal(m) ?? "AETHRYON Desktop a refusé l'envoi : relance-le." });
      }
      return settle();
    }
    const s = parseRelayStatus(m);
    if (s) e.misses = 0;
    emit(e, s ?? { etat: "echec", message: refusal(m) ?? "AETHRYON Desktop ne connaît plus cet envoi : relance-le." });
    settle();
  }

  /** L'hôte s'est arrêté (absent, planté, Chrome l'a coupé) : questions en vol perdues. */
  function onDown(p: NativePort): void {
    if (p !== port) return; // ancien port, fermé par nous
    try {
      void opts.lastError?.(); // lu pour que Chrome ne le signale pas comme non vérifié ; jamais affiché
    } catch { /* rien */ }
    port = null;
    const lost = queue;
    queue = [];
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    for (const q of lost) {
      const e = entries.get(q.key);
      if (!e) continue;
      e.busy = false;
      // Jamais accepté : hôte absent (Desktop non installé ou non déclaré à Chrome). Déjà accepté : nouvel essai au
      // prochain tour (un nouveau processus hôte), puis abandon après MAX_MISSES pertes de suite.
      if (q.kind === "envoi" || ++e.misses >= MAX_MISSES) emit(e, { etat: "desktop-absent" });
    }
    settle();
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

  function ask(e: Entry, kind: "envoi" | "etat"): void {
    const p = ensurePort();
    if (!p) {
      // Permission retirée (ou API absente) : rien ne peut partir.
      emit(e, { etat: "desktop-absent", message: opts.permissionText });
      return;
    }
    queue.push({ key: e.key, kind });
    e.busy = true;
    try {
      p.postMessage(kind === "envoi" ? e.req : { type: "etat-envoi", id: e.req.id });
    } catch {
      onDown(p);
    }
  }

  function tick(): void {
    timer = null;
    if (stopped) return;
    for (const e of [...entries.values()]) if (!e.busy && e.accepted) ask(e, "etat");
    settle();
  }

  return {
    /** Nouvel envoi (ou relance du même travail) : `envoyer-premiere`, puis suivi. */
    send(key: string, req: RelayRequest): void {
      if (stopped) return;
      const e: Entry = { key, req, accepted: false, busy: false, misses: 0 };
      entries.set(key, e);
      ask(e, "envoi");
      settle();
    },
    /** Envoi déjà accepté (service worker relancé) : seulement le suivi. */
    follow(key: string, req: RelayRequest): void {
      if (stopped || entries.has(key)) return;
      entries.set(key, { key, req, accepted: true, busy: false, misses: 0 });
      settle();
    },
    /** Plus de suivi pour ce travail (annulé, retiré). */
    forget(key: string): void {
      entries.delete(key);
      settle();
    },
    stop(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      close();
      entries.clear();
    },
    /** Tests : état courant. */
    get open(): boolean { return port !== null; },
    get connects(): number { return connects; },
    get tracked(): number { return entries.size; },
  };
}

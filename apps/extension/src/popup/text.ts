// Textes et formats français de l'interface (popup et réglages).
// Typographie : espace insécable U+00A0 avant « ? ! : ; % » et à l'intérieur des guillemets « » (écrite
//   pour rester visible dans le code). Les DONNÉES (titres, liens, messages du serveur) ne passent
// jamais par ces fonctions : elles sont affichées telles quelles, par textContent.
import { clipLabel, clipLength } from "../shared/clip.ts";
import type { AccountView, Bitrate, Degraded, Fmt, JobView, Quality } from "../shared/types.ts";
import { PLATFORM_LABEL, type MediaKind, type Platform } from "../shared/urls.ts";

export const NB = " ";

/** Libellés des qualités MP4 (valeurs acceptées par ytapi). */
export const QUALITY_LABEL: Record<Quality, string> = {
  best: "Auto",
  "2160": "2160p",
  "1440": "1440p",
  "1080": "1080p",
  "720": "720p",
  "480": "480p",
  "360": "360p",
};

export const bitrateLabel = (b: Bitrate): string => `${b}${NB}kbit/s`;

export const KIND_LABEL: Record<MediaKind, string> = { video: "Vidéo", short: "Short", post: "Publication", shortlink: "Lien court" };

export function platformLabel(p: string | null | undefined): string {
  if (p === "x") return "X";
  return p && p in PLATFORM_LABEL ? PLATFORM_LABEL[p as Platform] : "Plateforme inconnue";
}

/** Plateforme d'une conversion du compte (le serveur peut écrire « x » pour X) → pictogramme, sinon null. */
export function knownPlatform(p: string | null | undefined): Platform | null {
  if (p === "x") return "twitter";
  return p && p in PLATFORM_LABEL ? (p as Platform) : null;
}

/** Accord en français : 0 et 1 au singulier. */
export const plural = (n: number, one: string, many: string): string => (Math.abs(n) >= 2 ? many : one);

/** « MP4 · 1080p », « MP4 · Auto », « MP3 · 192 kbit/s ». */
export function formatLabel(fmt: Fmt, quality?: Quality, bitrate?: Bitrate): string {
  if (fmt === "mp3") return bitrate ? `MP3 · ${bitrateLabel(bitrate)}` : "MP3";
  return `MP4 · ${QUALITY_LABEL[quality ?? "best"]}`;
}

/**
 * Ce qu'est un élément du centre de téléchargements (V3) : « Extrait 1:23 → 1:53 · MP4 · 1080p », « GIF · 10 s »,
 * « Image de la vidéo », « Miniature », sinon le format comme avant.
 */
export function itemLabel(job: JobView): string {
  if (job.kind === "frame") return "Image de la vidéo";
  if (job.kind === "thumb") return "Miniature";
  if (job.kind === "gif") return job.clip ? `GIF · ${clipLength(job.clip)} · ${clipLabel(job.clip)}` : "GIF";
  const fmt = formatLabel(job.fmt, job.quality, job.bitrate);
  return job.clip ? `Extrait ${clipLabel(job.clip)} · ${fmt}` : fmt;
}

/** Pourcentage affichable (entier 0–100) ou null si inconnu. */
export function percent(p: unknown): number | null {
  if (typeof p !== "number" || !Number.isFinite(p)) return null;
  return Math.min(100, Math.max(0, Math.round(p)));
}

/**
 * État d'un téléchargement, formulé honnêtement : « Enregistré » UNIQUEMENT pour done (fichier écrit
 * sur le disque, downloads.onChanged « complete »). Conversion terminée = début du téléchargement.
 */
export function jobStatusText(job: JobView): string {
  const p = percent(job.progress);
  // 3.8.1 : « Envoyer vers › Premiere Pro » relayé à AETHRYON Desktop (états réels du Desktop).
  if (job.dest === "premiere" && job.kind === undefined) {
    if (job.state === "queued") return job.stage === "desktop" ? "Envoyé à AETHRYON Desktop" : "Envoi à AETHRYON Desktop…";
    if (job.state === "converting") return p === null ? "Conversion par AETHRYON Desktop…" : `Conversion par AETHRYON Desktop…${NB}${p}${NB}%`;
    if (job.state === "downloading" && job.stage === "import") return "Import dans Premiere Pro…";
    if (job.state === "downloading") return p === null ? "AETHRYON Desktop reçoit le fichier…" : `AETHRYON Desktop reçoit le fichier…${NB}${p}${NB}%`;
    if (job.state === "done") return "Importé dans Premiere Pro";
  }
  switch (job.state) {
    case "queued":
      return "En file d'attente";
    case "converting":
      if (job.kind === "gif" && job.stage !== "queued" && job.jobId && job.stage === "gif") return "Fabrication du GIF…";
      return p === null ? "Conversion sur le serveur…" : `Conversion sur le serveur…${NB}${p}${NB}%`;
    case "downloading":
      return p === null ? "Téléchargement…" : `Téléchargement…${NB}${p}${NB}%`;
    case "done":
      return job.kind === "frame" || job.kind === "thumb" ? "Enregistrée dans Téléchargements" : "Enregistré dans Téléchargements";
    case "error":
      return job.error?.message?.trim() || "Le téléchargement a échoué.";
    case "cancelled":
      return "Annulé";
    default:
      return "État inconnu";
  }
}

/** Phrase courte annoncée (aria-live) quand l'état du dernier téléchargement CHANGE. */
export function companionLine(job: JobView | null): string {
  if (!job) return "Aucun téléchargement pour l'instant.";
  if (job.dest === "premiere" && job.kind === undefined && job.state !== "error" && job.state !== "cancelled") {
    return job.state === "done" ? "Importé dans Premiere Pro par AETHRYON Desktop." : "AETHRYON Desktop s'occupe de l'envoi vers Premiere Pro…";
  }
  switch (job.state) {
    case "queued":
      return "En file d'attente sur le serveur.";
    case "converting":
      return "Conversion en cours sur le serveur…";
    case "downloading":
      return "Le navigateur reçoit le fichier…";
    case "done":
      return job.kind === "frame" ? "Image enregistrée dans Téléchargements." : job.kind === "thumb" ? "Miniature enregistrée dans Téléchargements."
        : "Fichier enregistré dans Téléchargements.";
    case "error":
      return "Le dernier téléchargement a échoué.";
    case "cancelled":
      return "Dernier téléchargement annulé.";
    default:
      return "État inconnu.";
  }
}

/** Quota du jour : « 3 conversions restantes sur 10 », « Illimité ». */
export function quotaText(today: AccountView["today"]): string {
  if (!today) return "Quota indisponible";
  if (today.limit === null) return "Illimité";
  const remaining = today.remaining ?? Math.max(0, today.limit - today.used);
  return `${remaining} ${plural(remaining, "conversion restante", "conversions restantes")} sur ${today.limit}`;
}

/** Quota du jour en deux parties (chiffre mis en avant, puis la phrase) ; « tone » : épuisé ou non. */
export function quotaParts(today: NonNullable<AccountView["today"]>): { num: string; rest: string; exhausted: boolean; unlimited: boolean } {
  if (today.limit === null) return { num: "Illimité", rest: "aucune limite quotidienne", exhausted: false, unlimited: true };
  const remaining = today.remaining ?? Math.max(0, today.limit - today.used);
  return { num: String(remaining), rest: `${plural(remaining, "conversion restante", "conversions restantes")} sur ${today.limit}`, exhausted: remaining <= 0, unlimited: false };
}

/** « Remise à zéro à 00:00 » (heure locale), sinon minuit, heure de Paris (règle du serveur). */
export function resetText(today: AccountView["today"]): string {
  const at = clockTime(today?.resetAt);
  return at ? `Remise à zéro à ${at}` : "Remise à zéro à minuit (heure de Paris)";
}

/** Compte lié mais service injoignable ou en erreur : libellé court (en-tête), titre et phrase. */
export function degradedText(d: Degraded): { pill: string; title: string; text: string } {
  switch (d.reason) {
    case "network":
      return { pill: "Hors ligne", title: "AETHRYON injoignable", text: `Impossible de joindre le serveur AETHRYON${NB}: vérifie ta connexion à Internet, puis réessaie.` };
    case "missing":
      return { pill: "Service indisponible", title: "Service pas encore disponible", text: "Le service de l'extension n'est pas encore disponible sur le serveur AETHRYON. Réessaie plus tard." };
    case "unavailable":
      return { pill: "Service indisponible", title: "Service momentanément indisponible", text: `Le serveur AETHRYON répond en erreur${d.status ? ` (${d.status})` : ""}. Réessaie dans quelques minutes.` };
    default:
      return { pill: "Service indisponible", title: "Réponse inattendue du serveur", text: "Le serveur AETHRYON a répondu de façon inattendue. Réessaie dans un instant." };
  }
}

/** Déconnexion faite ailleurs (autre page de l'extension) : ce qui s'est passé, dit une fois. */
export const SIGNED_OUT_TEXT = `Déconnecté de ce navigateur${NB}: l'accès de l'extension à ton compte a été révoqué.`;
export const WITHDRAWN_TEXT = `Accord retiré${NB}: l'extension est déconnectée et n'envoie plus rien.`;

/** Part utilisée du quota (0–1), ou null si illimité ou inconnu. */
export function quotaRatio(today: AccountView["today"]): number | null {
  if (!today || today.limit === null || today.limit <= 0) return null;
  return Math.min(1, Math.max(0, today.used / today.limit));
}

const timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

/** « à l'instant », « il y a 5 min », « il y a 2 h », puis la date. */
export function relativeTime(at: string | number | undefined): string {
  const t = typeof at === "number" ? at : at ? Date.parse(at) : NaN;
  if (!Number.isFinite(t)) return "";
  const min = Math.round((Date.now() - t) / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min}${NB}min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h}${NB}h`;
  return dateFmt.format(new Date(t));
}

export function clockTime(at: string | undefined): string | null {
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? timeFmt.format(new Date(t)) : null;
}

/** Lien lisible : « youtube.com/watch?v=… » (hôte sans www, chemin, paramètres). */
export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`;
  } catch {
    return url;
  }
}

/** États de l'historique du compte (mêmes libellés que la page Activité du site). */
export const RECENT_STATE: Record<string, { tone: "ok" | "bad" | "gold" | "neutral"; label: string }> = {
  reserved: { tone: "gold", label: "Demandée" },
  running: { tone: "gold", label: "En cours" },
  done: { tone: "ok", label: "Terminée" },
  error: { tone: "bad", label: "Échec" },
  cancelled: { tone: "neutral", label: "Annulée" },
  refunded: { tone: "neutral", label: "Non démarrée" },
};

// ---- 3.5.1 : destination Premiere Pro (popup et réglages) ; 3.5.2 : « Envoyer vers », lien avec AETHRYON Desktop ----
/** Titre du choix (« Envoyer vers » › « Premiere Pro » : les mots du brief, en deux parties pour rester compact). */
export const DEST_TITLE = "Envoyer vers";
export const DEST_LABEL = { downloads: "Téléchargements", premiere: "Premiere Pro" } as const;
/** Explication montrée tant qu'aucun fichier n'est encore parti vers Premiere (3.8.1 : relayé à AETHRYON Desktop). */
export const PREMIERE_HINT = "AETHRYON Desktop convertit la vidéo, l'enregistre dans sa bibliothèque et l'importe dans Premiere Pro.";
/** Envoi vers Premiere que l'hôte du Desktop n'a pas reçu (non installé ou en erreur) : une ligne calme, sans lien. */
export const DESKTOP_MISSING = "Installe AETHRYON Desktop pour suivre l'envoi";
/** Lien local pas encore autorisé (permission facultative « nativeMessaging »). */
export const DESKTOP_ASK = `Pour envoyer vers Premiere Pro, autorise le lien local avec AETHRYON Desktop${NB}: c'est lui qui convertit et importe.`;
export const DESKTOP_ALLOWED = `Autorisé${NB}: chaque envoi part à AETHRYON Desktop par un lien local, sans jeton ni adresse de fichier.`;
/** Au-delà de 1080p, YouTube n'a que du VP9 ou de l'AV1 : le serveur réencode en H.264. */
export const PREMIERE_REENCODE = `Au-delà de 1080p, le serveur réencode la vidéo en H.264 pour Premiere${NB}: c'est plus long.`;

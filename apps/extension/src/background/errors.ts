// Erreurs montrées à l'utilisateur (français, typographie soignée : espace insécable U+00A0 avant
// « : ; ! ? » et à l'intérieur des guillemets). Les textes de ytapi (champ `detail`, déjà rédigés pour
// les jetons ytc_) sont repris tels quels, seulement nettoyés et remis à la même typographie.
import { cleanText } from "../shared/messages.ts";
import { PLATFORMS_OR } from "../shared/platforms.ts";
import type { AuthLostReason, JobError } from "../shared/types.ts";

const NBSP = " ";

/** Espace insécable avant : ; ! ? » et après « (les espaces ordinaires ou fines sont remplacées). */
export function typo(s: string): string {
  return s.replace(/[  ]+([:;!?»])/g, `${NBSP}$1`).replace(/«[  ]+/g, `«${NBSP}`);
}

export function jobError(code: string, message: string, retryable: boolean): JobError {
  return { code, message: typo(message), retryable };
}

/** Erreur portée par une promesse rejetée jusqu'au routeur ({ok:false, error}). */
export class BgError extends Error {
  readonly error: JobError;
  constructor(error: JobError) {
    super(error.code);
    this.name = "BgError";
    this.error = error;
  }
}

export const MSG = {
  authRequired: "Connecte l'extension à ton compte AETHRYON pour télécharger.",
  unsupportedUrl: `Ce lien n'est pas pris en charge : ouvre une vidéo ${PLATFORMS_OR}.`,
  wrongPage: "Ce lien ne correspond pas à la page ouverte : relance le téléchargement depuis la vidéo.",
  network: "Impossible de joindre le serveur AETHRYON : vérifie ta connexion puis réessaie.",
  unexpected: "Réponse inattendue du serveur AETHRYON : réessaie dans un instant.",
  badFileUrl: "Réponse inattendue du serveur : l'adresse du fichier a été refusée par sécurité.",
  premiereTooLong: "Premiere Pro : cette vidéo n'existe pas en H.264 à cette qualité et elle est trop longue pour être réencodée par le serveur. Choisis une qualité plus basse, ou la destination Téléchargements.",
  // 3.8.1 : « Envoyer vers › Premiere Pro » relayé à AETHRYON Desktop (relais.ts) ; le Desktop donne d'habitude sa phrase.
  desktopPermission: "Pour envoyer vers Premiere Pro, autorise le lien avec AETHRYON Desktop : popup AETHRYON › Envoyer vers › Premiere Pro › Autoriser.",
  desktopAbsent: "AETHRYON Desktop est introuvable ou ne répond pas : installe-le ou ouvre-le, puis relance l'envoi.",
  desktopNotLinked: "AETHRYON Desktop n'est pas relié à ton compte : ouvre AETHRYON Desktop › Paramètres › Compte, puis relance l'envoi.",
  premiereClosed: "Fichier enregistré dans AETHRYON Desktop, mais Premiere Pro n'est pas ouvert (ou le panneau AETHRYON est fermé) : ouvre Premiere Pro, puis importe-le depuis le panneau AETHRYON.",
  premiereNoProject: "Fichier enregistré dans AETHRYON Desktop, mais aucun projet n'est ouvert dans Premiere Pro : ouvre un projet, puis importe-le depuis le panneau AETHRYON.",
  premiereFailed: "L'envoi vers Premiere Pro a échoué : relance-le.",
  // AETHRYON Desktop d'avant la 1.1.0-beta.3 : son hôte répond « Type de message inconnu. » à `envoyer-premiere`.
  desktopOutdated: "Mets à jour AETHRYON Desktop pour importer dans Premiere Pro.",
  jobExpired: "La conversion a expiré : relance-la.",
  fileExpired: "Le fichier a expiré sur le serveur : relance la conversion.",
  requestLost: "La demande a été interrompue avant d'aboutir : relance-la.",
  notFound: "Ce téléchargement n'existe plus.",
  downloadRefused: "Le navigateur a refusé de lancer le téléchargement.",
  downloadMissing: "Le téléchargement n'apparaît plus dans le navigateur : relance-le.",
  downloadNetwork: "Téléchargement interrompu : la connexion au serveur a été perdue. Relance-le.",
  downloadServer: "Le serveur n'a pas pu envoyer le fichier : relance le téléchargement.",
  downloadForbidden: "Le serveur a refusé l'accès au fichier.",
  downloadShutdown: "Téléchargement interrompu par la fermeture du navigateur : relance-le.",
  diskFull: "Espace disque insuffisant : libère de la place puis relance le téléchargement.",
  diskDenied: "Le navigateur ne peut pas écrire dans le dossier de téléchargement (accès refusé).",
  nameTooLong: "Le nom du fichier est trop long pour ton système.",
  fileTooLarge: "Le fichier est trop volumineux pour ton système de fichiers.",
  blocked: "Le navigateur a bloqué ce fichier (contrôle de sécurité).",
  fileWrite: "Le navigateur n'a pas pu enregistrer le fichier : relance le téléchargement.",
  certificate: "Connexion sécurisée au serveur impossible (certificat refusé).",
  redirect: "Réponse inattendue du serveur : redirection refusée.",
  // Connexion (docs/EXTENSION.md §3) : chaque cause a sa phrase, jamais « vérifie ta connexion » à tort.
  loginCancelled: "Connexion annulée.",
  loginDenied: "Autorisation refusée : l'extension n'est pas connectée à ton compte.",
  loginState: "La réponse de connexion n'a pas pu être vérifiée : recommence.",
  loginFailed: "La connexion au compte AETHRYON a échoué : réessaie.",
  loginNetwork: "Impossible de joindre AETHRYON : vérifie ta connexion à Internet, puis réessaie.",
  loginMissing: "La connexion de l'extension n'est pas encore disponible sur le site AETHRYON. Réessaie plus tard.",
  loginPage: "La page de connexion AETHRYON n'a pas pu s'ouvrir. Réessaie dans un instant.",
  loginSuspended: "Ton compte AETHRYON est suspendu : l'extension ne peut pas s'y connecter.",
  loginTooMany: "Limite atteinte : 3 extensions au plus peuvent être connectées à un même compte. Révoque un appareil dans « Mes jetons », puis reconnecte-toi.",
  loginCode: "Le code de connexion a expiré ou a déjà servi : recommence la connexion.",
  consentRequired: "Avant la première connexion, lis la notice sur les données et accepte-la.",
  consentChanged: "La notice sur les données a changé avec la mise à jour : relis-la et accepte-la pour continuer.",
  internal: "Erreur interne de l'extension : réessaie.",
  // Déconnexion imposée par le serveur (docs/EXTENSION.md §7) : pourquoi, et quoi faire.
  lostRevokedUser: "Cette extension a été déconnectée de ton compte depuis « Mes jetons ». Reconnecte-la pour continuer.",
  lostRevokedAdmin: "Un administrateur AETHRYON a révoqué l'accès de cette extension. Reconnecte-la pour continuer.",
  lostRevokedReplay: "Accès révoqué par sécurité : un code de connexion a été réutilisé. Reconnecte l'extension pour continuer.",
  lostRevoked: "L'accès de cette extension à ton compte a été révoqué. Reconnecte-la pour continuer.",
  lostExpired: "Connexion expirée (30 jours) : reconnecte-toi.",
  lostInvalid: "La connexion de l'extension n'est plus valide. Reconnecte-la pour continuer.",
  suspended: "Ton compte AETHRYON est suspendu : les conversions sont refusées.",
  tokenRefused: "Le service de conversion a refusé la connexion : réessaie dans un instant.",
  // V3 : extrait, GIF, image de la vidéo, miniature, AETHRYON Tools.
  gifFailed: "Le GIF n'a pas pu être fabriqué à partir de l'extrait : réessaie.",
  frameNoVideo: "Aucune vidéo lisible sur cet onglet : lance la lecture, puis réessaie.",
  frameNotReady: "La vidéo n'a pas encore d'image à capturer : lance la lecture, puis réessaie.",
  frameTainted: "Ce site ne laisse pas lire l'image depuis la page : utilise le bouton AETHRYON de la barre d'outils du navigateur.",
  frameBlack: "Image noire : cette vidéo est protégée (DRM), sa capture n'est pas possible.",
  frameFailed: "La capture de l'image a échoué : réessaie.",
  frameRetry: "Une image capturée n'est pas gardée : capture-la à nouveau depuis la vidéo.",
  thumbMissing: "Aucune miniature connue pour cette vidéo.",
  toolsClosed: "AETHRYON Tools n'est pas encore ouvert : réessaie plus tard.",
  toolsNoMedia: "Ce téléchargement n'a plus de média sur le serveur : ouvre plutôt le lien dans Tools.",
  toolsFailed: "AETHRYON Tools n'a pas pu s'ouvrir : réessaie.",
  showFailed: "Le fichier n'est plus dans le dossier de téléchargement.",
  // 3.6.0 : extraits (contrat startMs / endMs).
  partialImpossible: "Cette vidéo ne permet pas de récupérer seulement le passage choisi, et la récupérer en entier dépasserait la limite du serveur. Rien n'a été téléchargé : choisis une autre source, ou télécharge la vidéo entière si elle est courte.",
  clipInvalid: "Le serveur a refusé ce passage : vérifie le début et la fin, puis réessaie.",
  noPlayer: "La vidéo de l'onglet ne répond pas : recharge la page, puis rouvre AETHRYON.",
} as const;

export const authRequired = (): JobError => jobError("auth_required", MSG.authRequired, false);
/** Notice sur les données pas encore acceptée (ou acceptée dans une version plus ancienne : `changed`) : ni connexion, ni téléchargement. */
export const consentRequired = (changed = false): JobError => jobError("consent_required", changed ? MSG.consentChanged : MSG.consentRequired, false);

/** Site ou service momentanément indisponible (5xx, 429) : la phrase dit le code reçu. */
export const loginUnavailable = (status: number): JobError =>
  jobError("service_unavailable", `Le site AETHRYON est momentanément indisponible (erreur ${status}). Réessaie dans quelques minutes.`, true);

/**
 * La page de connexion n'a pas pu se charger (launchWebAuthFlow : « Authorization page could not be
 * loaded. », même message pour un réseau coupé et pour une page en erreur HTTP). `probe` : ce qu'a répondu
 * une requête simple vers cette page (statut HTTP, ou "network" si rien n'a répondu).
 */
export function loginPageError(probe: number | "network"): JobError {
  if (probe === "network") return jobError("network", MSG.loginNetwork, true);
  if (probe === 404) return jobError("service_missing", MSG.loginMissing, true);
  if (probe === 429 || probe >= 500) return loginUnavailable(probe);
  return jobError("auth_page", MSG.loginPage, true);
}

/** Échange du code refusé (POST /api/extension/token) → cause précise ; texte du serveur pour le reste. */
export function tokenExchangeError(status: number, body: unknown): JobError {
  const b = isObj(body) ? body : {};
  const said = typeof b.message === "string" ? cleanText(b.message, 300) : "";
  if (status === 404) return jobError("service_missing", MSG.loginMissing, true);
  if (status === 429 && b.error !== "rate_limited") return loginUnavailable(status);
  if (status >= 500) return loginUnavailable(status);
  if (status === 403 && b.error === "account_suspended") return jobError("account_suspended", MSG.loginSuspended, false);
  if (status === 409 && b.error === "too_many_extensions") return jobError("too_many_extensions", MSG.loginTooMany, false);
  if (status === 400 && b.error === "invalid_grant") return jobError("auth_code", said || MSG.loginCode, true);
  if (status === 429) return jobError("rate_limited", said || "Trop de tentatives de connexion : réessaie dans une minute.", true);
  return jobError("auth_failed", said || MSG.loginFailed, true);
}

const LOST_TEXT: Record<AuthLostReason, string> = {
  revoked_user: MSG.lostRevokedUser,
  revoked_admin: MSG.lostRevokedAdmin,
  revoked_replay: MSG.lostRevokedReplay,
  revoked: MSG.lostRevoked,
  expired: MSG.lostExpired,
  invalid: MSG.lostInvalid,
};

/** Phrase (typographie française) qui dit pourquoi l'extension a été déconnectée. */
export const lostMessage = (reason: AuthLostReason): string => typo(LOST_TEXT[reason]);

/** Refus de /api/extension/me (401) → motif ; null si la réponse ne dit rien d'exploitable. */
export function lostReason(body: unknown): AuthLostReason | null {
  if (!isObj(body)) return null;
  if (body.error === "token_expired") return "expired";
  if (body.error === "token_revoked") {
    return body.revokedBy === "user" ? "revoked_user" : body.revokedBy === "admin" ? "revoked_admin" : body.revokedBy === "replay" ? "revoked_replay" : "revoked";
  }
  if (body.error === "invalid_token") return "invalid";
  return null;
}
export const networkError = (): JobError => jobError("network", MSG.network, true);
export const unexpectedError = (): JobError => jobError("server_error", MSG.unexpected, true);

/** « 15 s », « 3 min », « 5 h 07 » (espaces insécables). */
export function formatDelay(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 60) return `${s}${NBSP}s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m}${NBSP}min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}${NBSP}h${NBSP}${String(r).padStart(2, "0")}` : `${h}${NBSP}h`;
}

/** Retry-After : secondes entières ou date HTTP ; borné à 48 h ; null si absent ou illisible. */
export function parseRetryAfter(raw: string | null, now = Date.now()): number | null {
  if (!raw) return null;
  const v = raw.trim();
  let s: number;
  if (/^\d{1,9}$/.test(v)) s = Number(v);
  else {
    const t = Date.parse(v);
    if (!Number.isFinite(t)) return null;
    s = Math.ceil((t - now) / 1000);
  }
  return Math.min(Math.max(s, 0), 172_800);
}

const FALLBACK: Record<number, string> = {
  400: "Requête refusée par le serveur.",
  403: "Accès refusé par le serveur.",
  404: "Vidéo introuvable.",
  409: "Le serveur n'a pas pu fournir le fichier.",
  410: MSG.fileExpired,
  413: "Vidéo trop longue ou fichier trop volumineux pour le service.",
  422: "Aucun format compatible n'est proposé pour cette vidéo.",
  429: "Trop de demandes : réessaie dans un instant.",
};

// Codes de docs/ERREURS.md : relancer le même lien ne peut pas aboutir (contenu, lien, limite du
// service) ou peut aboutir plus tard (plateforme, serveur, réseau). Un échec lu sur GET /jobs/<id>
// n'a pas de statut HTTP propre : ces listes décident alors seules.
const PERMANENT_CODES = new Set([
  "not_found", "unavailable", "no_video", "media_index_not_found", "private", "age_restricted", "members_only",
  "geo_restricted", "login_required", "unsupported_url", "invalid_url", "unsupported_content", "playlist_not_supported", "youtube_music_not_accepted",
  "live_not_supported", "short_link_unresolved", "no_audio", "too_long", "too_large", "transcode_too_long",
  "gif_too_long", "format_unavailable", "invalid_parameter", "account_suspended", "forbidden_for_user_keys",
  "quota_exceeded", "job_failed",
  // 3.6.0 : extraits — la source n'autorise pas la récupération partielle ; passage refusé par la validation du serveur.
  "extrait_partiel_impossible", "extrait_trop_long", "extrait_invalide", "extrait_hors_source", "extrait_trop_lourd", "clip_out_of_range",
]);
const TEMPORARY_CODES = new Set([
  "bot_check", "upstream_rate_limited", "upstream_unavailable", "upstream_timeout", "extractor_broken",
  "upstream_forbidden", "download_failed", "upstream_error", "conversion_failed", "timeout", "insufficient_storage",
  "server_busy", "internal_error", "worker_crashed", "cookies_invalid", "proxy_unreachable", "proxy_bypass",
  "rate_limited", "active_job_limit", "service_paused", "auth_unavailable",
]);

export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Réponse d'erreur de ytapi ({error, detail} ou corps de job en échec) → JobError. Le texte du serveur
 * est montré (ytapi rédige déjà des phrases françaises pour les jetons ytc_) ; Retry-After complète le
 * message quand le serveur ne donne pas lui-même le délai.
 */
export function apiError(status: number, body: unknown, retryAfterS: number | null): JobError {
  const b = isObj(body) ? body : {};
  const code = typeof b.error === "string" && /^[a-z0-9_]{1,64}$/.test(b.error) ? b.error : status >= 500 ? "server_error" : `http_${status}`;
  if (status === 401 || code === "unauthorized") return authRequired();
  const detail = typeof b.detail === "string" ? cleanText(b.detail, 400) : "";
  let message = detail || (status === 422 && /^(extrait|clip)_/.test(code) ? MSG.clipInvalid : "") || FALLBACK[status] || (status >= 500 ? "Le serveur AETHRYON rencontre un problème : réessaie dans un instant." : MSG.unexpected);
  let retryable: boolean;
  if (code === "job_not_found") {
    message = MSG.jobExpired;
    retryable = true;
  } else if (code === "extrait_partiel_impossible") {
    // Message dédié, toujours le même (aucun téléchargement intégral silencieux) ; il tient dans la carte d'état.
    message = MSG.partialImpossible;
    retryable = false;
  } else if (code === "file_gone" || status === 410) {
    message = MSG.fileExpired;
    retryable = true;
  } else if (PERMANENT_CODES.has(code)) retryable = false;
  else if (TEMPORARY_CODES.has(code)) retryable = true;
  else retryable = status === 429 || status >= 500 || status === 0;
  const retry = retryAfterS ?? (typeof b.retry_after_s === "number" && Number.isFinite(b.retry_after_s) ? b.retry_after_s : null);
  if (retry && retry > 0 && code !== "quota_exceeded" && !/essa(ie|yez)/i.test(message)) {
    message = `${message.replace(/[.\s]*$/, ".")} Réessaie dans ${formatDelay(retry)}.`;
  }
  return jobError(code, message, retryable);
}

/** Raisons d'interruption de chrome.downloads (DownloadInterruptReason) → erreur affichable. */
export type InterruptClass = "cancelled" | "auth" | "forbidden" | "expired" | "probe" | "final";

export function classifyInterrupt(reason: string): { kind: InterruptClass; error?: JobError } {
  switch (reason) {
    case "USER_CANCELED":
      return { kind: "cancelled" };
    case "SERVER_UNAUTHORIZED":
      return { kind: "auth" };
    case "SERVER_FORBIDDEN":
      return { kind: "forbidden" };
    case "SERVER_BAD_CONTENT": // HTTP 404 : job inconnu ou expiré
      return { kind: "expired", error: jobError("file_expired", MSG.fileExpired, true) };
    // Le serveur répondait ou la connexion a lâché : on vérifie l'état du fichier pour dire pourquoi.
    case "SERVER_FAILED":
    case "SERVER_NO_RANGE":
    case "SERVER_CONTENT_LENGTH_MISMATCH":
    case "SERVER_UNREACHABLE":
    case "NETWORK_FAILED":
    case "NETWORK_TIMEOUT":
    case "NETWORK_DISCONNECTED":
    case "NETWORK_SERVER_DOWN":
    case "NETWORK_INVALID_REQUEST":
      return { kind: "probe" };
    case "USER_SHUTDOWN":
    case "CRASH":
      return { kind: "final", error: jobError("download_interrupted", MSG.downloadShutdown, true) };
    case "FILE_NO_SPACE":
      return { kind: "final", error: jobError("disk_full", MSG.diskFull, true) };
    case "FILE_ACCESS_DENIED":
      return { kind: "final", error: jobError("disk_denied", MSG.diskDenied, true) };
    case "FILE_NAME_TOO_LONG":
      return { kind: "final", error: jobError("file_name_too_long", MSG.nameTooLong, false) };
    case "FILE_TOO_LARGE":
      return { kind: "final", error: jobError("file_too_large", MSG.fileTooLarge, false) };
    case "FILE_VIRUS_INFECTED":
    case "FILE_BLOCKED":
    case "FILE_SECURITY_CHECK_FAILED":
      return { kind: "final", error: jobError("download_blocked", MSG.blocked, false) };
    case "FILE_FAILED":
    case "FILE_TRANSIENT_ERROR":
    case "FILE_TOO_SHORT":
    case "FILE_HASH_MISMATCH":
    case "FILE_SAME_AS_SOURCE":
      return { kind: "final", error: jobError("file_write_failed", MSG.fileWrite, true) };
    case "SERVER_CERT_PROBLEM":
      return { kind: "final", error: jobError("download_certificate", MSG.certificate, false) };
    case "SERVER_CROSS_ORIGIN_REDIRECT":
      return { kind: "final", error: jobError("download_redirect", MSG.redirect, false) };
    default:
      return { kind: "probe" };
  }
}

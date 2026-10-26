// Types partagés entre service worker, content scripts, popup et réglages.
import type { Etape } from "./etapes.ts";
import type { MediaKind, Platform } from "./urls.ts";

export type Fmt = "mp4" | "mp3";
/** Qualités acceptées par ytapi (app/params.py). */
export type Quality = "best" | "2160" | "1440" | "1080" | "720" | "480" | "360";
export const QUALITIES: readonly Quality[] = ["best", "2160", "1440", "1080", "720", "480", "360"];
export type Bitrate = 128 | 192 | 320;
export const BITRATES: readonly Bitrate[] = [128, 192, 320];
/**
 * 3.5.1 : où va le fichier d'une vidéo ou d'un audio. « downloads » : le dossier de téléchargement du navigateur,
 * comme avant ; « premiere » (« Envoyer vers » › « Premiere Pro ») : son sous-dossier AETHRYON, que surveille
 * AETHRYON Desktop, dont le panneau AETHRYON de Premiere Pro montre la bibliothèque (src/shared/premiere.ts,
 * docs/EXTENSION.md §11 et §12).
 */
export type Destination = "downloads" | "premiere";
export const DESTINATIONS: readonly Destination[] = ["downloads", "premiere"];

/**
 * Extrait d'une vidéo, en secondes depuis le début (V3), à la milliseconde près : [start, end]. Envoyé au serveur en
 * millisecondes entières (startMs, endMs : 3.6.0) ; la durée maximale est celle du serveur (GET /limites), jamais une
 * constante de l'extension.
 */
export interface Clip { start: number; end: number }
/** Durées proposées pour un extrait instantané, et où il se place par rapport à l'instant de lecture. */
export const CLIP_LENGTHS = [10, 15, 30, 60] as const;
export type ClipLength = (typeof CLIP_LENGTHS)[number];
export type ClipAnchor = "before" | "around" | "after";
export const CLIP_ANCHORS: readonly ClipAnchor[] = ["before", "around", "after"];

/**
 * Nature d'un élément du centre de téléchargements : absent = fichier converti (fmt dit MP4 ou MP3) ;
 * gif = GIF fabriqué par le serveur à partir d'un extrait ; frame = image de la vidéo enregistrée sur
 * l'appareil (aucun serveur) ; thumb = miniature de la plateforme (téléchargée par le navigateur).
 */
export type JobKind = "gif" | "frame" | "thumb";

/** Vidéo détectée par un content script (jamais de cookie, jamais de donnée de compte). */
export interface DetectedMedia {
  platform: Platform;
  kind: MediaKind;
  url: string;
  id: string;
  title?: string;
  thumbnail?: string;
  /** X : nombre de vidéos dans la publication (choix « Vidéo 1, 2… » si > 1). */
  videoCount?: number;
  /** Durée et instant de lecture lus sur l'élément <video> de la page (secondes), quand ils sont connus. */
  duration?: number;
  currentTime?: number;
}

/**
 * Étapes d'un téléchargement, du point de vue de l'utilisateur :
 * queued (en file sur le serveur) → converting (conversion) → downloading (le navigateur reçoit le
 * fichier) → done (fichier ÉCRIT sur le disque : downloads.onChanged « complete ») ; ou error / cancelled.
 * « Conversion terminée » n'est PAS « done » : c'est le début de « downloading ».
 */
export type JobState = "queued" | "converting" | "downloading" | "done" | "error" | "cancelled";

/** 3.5.2 : suivi d'un envoi vers Premiere par AETHRYON Desktop (voir JobView.desktop). */
export type DesktopLink = "suivi" | "absent";

export interface JobError {
  /** Code stable (ytapi : docs/ERREURS.md ; extension : auth_required, network, download_interrupted…). */
  code: string;
  /** Phrase en français, montrée telle quelle. */
  message: string;
  /** Le même lien peut être relancé (réseau, fichier expiré, limite momentanée). */
  retryable: boolean;
}

export interface JobView {
  key: string;            // identifiant local (aléatoire), stable pendant la vie du job
  jobId?: string;         // identifiant ytapi
  url: string;
  platform: Platform;
  fmt: Fmt;
  quality?: Quality;
  bitrate?: Bitrate;
  index?: number;
  title?: string;
  /** Extrait demandé (V3) ; absent = la vidéo entière. */
  clip?: Clip;
  /** Absent : fichier converti ; gif, frame (image), thumb (miniature) : voir JobKind. */
  kind?: JobKind;
  /** « premiere » : 3.8.1, relayé à AETHRYON Desktop (conversion, bibliothèque, import dans Premiere Pro) ; absent = Téléchargements. */
  dest?: "premiere";
  /**
   * 3.5.2 : lien local avec AETHRYON Desktop pour cet envoi vers Premiere (src/background/desktop.ts) : « suivi »
   * (l'hôte a accepté l'envoi), « absent » (Desktop non installé ou en erreur : le fichier arrive quand même dans
   * Téléchargements › AETHRYON). Absent : permission non accordée, ou pas encore de réponse.
   */
  desktop?: DesktopLink;
  state: JobState;
  /**
   * 0–100 pendant la conversion (ytapi) puis pendant le téléchargement (octets reçus / total). Extrait (3.6.0) :
   * présent SEULEMENT quand la progression est mesurable (`progression` du serveur, octets reçus par le navigateur).
   */
  progress?: number;
  stage?: string;
  /** 3.6.0 : étape réelle d'un extrait (analyse, récupération, conversion, finalisation, terminé). */
  etape?: Etape;
  error?: JobError;
  createdAt: number;
  updatedAt: number;
  downloadId?: number;
  fileName?: string;
  bytes?: number;
  /** Onglet d'où vient la demande (pour lui envoyer la progression), jamais transmis à l'API. */
  tabId?: number;
}

/**
 * Pourquoi l'extension n'est plus connectée (refus du serveur, docs/EXTENSION.md §7) : clé révoquée
 * depuis « Mes jetons » (user), par un administrateur (admin), par sécurité après un code rejoué (replay)
 * ou sans motif connu ; clé expirée (30 jours) ; clé inconnue du serveur (invalid).
 */
export type AuthLostReason = "revoked_user" | "revoked_admin" | "revoked_replay" | "revoked" | "expired" | "invalid";
export const AUTH_LOST_REASONS: readonly AuthLostReason[] = ["revoked_user", "revoked_admin", "revoked_replay", "revoked", "expired", "invalid"];

/** Motif montré tant que l'utilisateur ne s'est pas reconnecté (ni déconnecté lui-même). */
export interface AuthNotice { reason: AuthLostReason; message: string; at: number }

/**
 * Compte lié, mais son service ne répond pas comme prévu (GET /api/extension/me) : réseau coupé, service de
 * l'extension absent du serveur (404 : pas encore déployé), serveur en erreur (5xx, 429) ou réponse
 * illisible. Jamais présenté comme « Connecté » : la liaison est gardée, les infos ne sont pas à jour.
 */
export type DegradedReason = "network" | "missing" | "unavailable" | "unexpected";
export const DEGRADED_REASONS: readonly DegradedReason[] = ["network", "missing", "unavailable", "unexpected"];
export interface Degraded { reason: DegradedReason; status?: number }

/** Changement de liaison annoncé en direct aux pages ouvertes (popup, réglages, accueil). */
export type AuthChangeReason = AuthLostReason | "signed_out" | "linked" | "withdrawn";

/** Accord donné à la notice sur les données (src/shared/consent.ts). */
/** `outdated` : accord donné à une version plus ancienne de la notice (mise à jour de l'extension), à relire. */
export interface ConsentView { accepted: boolean; version: number; at?: string; outdated?: true }

/** Nouvelle version annoncée par latest.json, à montrer (jamais téléchargée ni installée par l'extension). */
/** Étapes réelles d'une mise à jour en un clic (AETHRYON Desktop), puis le rechargement de l'extension. */
export type UpdateStep = "telechargement" | "verification" | "installation" | "redemarrage";
export interface UpdateProgress {
  version: string;
  step: UpdateStep;
  done?: number;
  total?: number;
}
/**
 * Après « Mettre à jour », la version chargée n'a pas changé : ce navigateur charge l'extension depuis un AUTRE
 * dossier que le dossier géré par AETHRYON Desktop. Explication montrée jusqu'à ce que ce soit réglé (ou masquée).
 */
export interface LoadHint {
  /** Version installée par AETHRYON Desktop dans le dossier géré. */
  version: string;
  /** Chemin exact du dossier géré, tel que Desktop l'a donné. */
  folder: string;
  /** Version toujours chargée par le navigateur. */
  loaded: string;
}
/** Résultat de la demande à AETHRYON Desktop (src/background/desktop-update.ts). */
export type DesktopUpdateResult =
  | { ok: true; version: string; folder: string; already: boolean }
  | { ok: false; reason: "permission" | "absent" | "ancien" | "refus" | "delai"; message: string; step?: UpdateStep };

export interface UpdateNotice {
  version: string;
  notes: string[];
  released?: string;
  /** Page de téléchargement du site, ouverte dans un onglet. */
  url: string;
  /** Version minimale de Chrome demandée par la nouvelle version, quand le navigateur est plus ancien. */
  needsChrome?: number;
}

export interface AccountView {
  connected: boolean;
  /** Non connecté après un refus du serveur : pourquoi (absent après une déconnexion volontaire). */
  notice?: AuthNotice;
  /** Connecté, mais le compte est suspendu par un administrateur : conversions refusées (liaison gardée). */
  suspended?: boolean;
  email?: string;
  name?: string;
  /** Quota du jour : null = illimité (administrateur, compte sans limite). */
  today?: { used: number; limit: number | null; remaining: number | null; resetAt?: string };
  activeJobs?: number;
  expiresAt?: string;
  recent?: { createdAt: string; platform: string | null; fmt: string; state: string; errorMessage: string | null }[];
  /** Infos affichées = dernier état connu (pas de réponse à jour du compte). */
  stale?: boolean;
  /** Liaison présente mais service du compte injoignable ou en erreur : pourquoi (voir Degraded). */
  degraded?: Degraded;
  /** AETHRYON Tools ouvert sur ce serveur (features.tools de /api/extension/me) : « Ouvrir dans Tools » montré. */
  tools?: boolean;
}

export type PanelPosition = { x: number; y: number } | null;

export interface Settings {
  inlineButtons: boolean;
  platforms: Record<Platform, boolean>;
  defaultFmt: Fmt;
  quality: Quality;
  bitrate: Bitrate;
  floatingPanel: boolean;
  panelPosition: PanelPosition;
  notifications: boolean;
  /** V3 : durée et placement par défaut d'un extrait instantané ; outils rapides dans la commande de la page. */
  clipLength: ClipLength;
  clipAnchor: ClipAnchor;
  pageTools: boolean;
  /** V3.5 : barre AETHRYON sous le lecteur YouTube, ouverte ou repliée (mémorisé au clic). */
  ytToolbar: "open" | "collapsed";
  /** 3.5.1 : destination des vidéos et de l'audio (menu de la page, popup, réglages). */
  destination: Destination;
  /** 3.5.1 : explication de la destination Premiere Pro déjà vue (montrée jusqu'au premier envoi vers Premiere). */
  premiereHintSeen: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  inlineButtons: true,
  platforms: { youtube: true, tiktok: true, twitter: true },
  defaultFmt: "mp4",
  quality: "best",
  bitrate: 192,
  floatingPanel: false,
  panelPosition: null,
  notifications: false,
  clipLength: 30,
  clipAnchor: "after",
  pageTools: true,
  ytToolbar: "open",
  destination: "downloads",
  premiereHintSeen: false,
};

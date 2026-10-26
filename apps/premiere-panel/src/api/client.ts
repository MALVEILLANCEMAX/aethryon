// Client de l'API AETHRYON (serveur ytapi pour les conversions, service « account » pour la connexion du panneau).
// Il ne fait AUCUN appel réseau lui-même : tout passe par hote.http / hote.telecharger (Node dans CEP, donc ni CORS ni
// cookie). La clé personnelle part seulement vers les deux origines configurées ici, jamais vers une adresse reçue
// du serveur (on reconstruit l'adresse du fichier au lieu de suivre file_url).
//
// Connexion par page d'accord (V2-CONNEXION.md, inspirée du RFC 8628), routes du VRAI serveur account (feat/v2-compte,
// note d'API à la fin de V2-CONNEXION.md) :
//   POST /api/premiere/appairage {hote?, versionPremiere?, versionExtension?} (corps STRICT, 60/32/32 caractères)
//     → 200 code utilisateur + adresse de vérification · 404 premiere_closed (connexion pas encore ouverte) · 429 ;
//   POST /api/premiere/jeton {codeAppareil} (toutes les « intervalle » s) → 428 en attente · 200 clé (une seule fois)
//     · 403 refusé ou compte suspendu · 409 too_many_premiere (3 ordinateurs) · 410 expiré ou déjà utilisé (rejeu :
//     la clé est révoquée) · 400 invalid_grant (code inconnu) · 429 trop rapide (Retry-After) · 404 premiere_closed ;
//   GET /api/premiere/moi (Bearer) → compte, quota, conversions en cours, 5 dernières conversions, expiration de la clé ;
//   POST /api/premiere/deconnexion (Bearer, corps vide) → 204, idempotent.
// Aucun CORS côté serveur : ces appels passent par Node (hote.http), sans en-tête Origin ni cookie.

import type { Hote, ReponseHttp, SuiviOctets } from "../hote/types";
import { NB, typo } from "../lib/format";

export interface ConfigServeur {
  /** Site et service de compte (page d'accord, clés). */
  compte: string;
  /** Serveur de conversion ytapi. */
  api: string;
}

export const PRODUCTION: ConfigServeur = { compte: "https://raccourci.malvu.fr", api: "https://api.malvu.fr/media" };

export const ROUTES = {
  appairage: "/api/premiere/appairage",
  jeton: "/api/premiere/jeton",
  moi: "/api/premiere/moi",
  deconnexion: "/api/premiere/deconnexion",
  pageAccord: "/premiere/connecter",
  /** « Mes jetons » de l'espace : la clé y apparaît sous « Premiere Pro · <ordinateur> ». */
  jetons: "/dashboard/cles",
};

/** Longueurs maximales acceptées par /api/premiere/appairage (au-delà, le serveur tronque ; on tronque avant). */
export const LIMITES_APPAREIL = { hote: 60, versionPremiere: 32, versionExtension: 32 } as const;

export type Format = "mp4" | "mp3";
export type Qualite = "best" | "2160" | "1440" | "1080" | "720" | "480" | "360";

export class ErreurApi extends Error {
  constructor(public statut: number, public code: string, message: string, public reessayerDans: number | null = null) {
    super(message);
    this.name = "ErreurApi";
  }
}

// ---- Réponses -------------------------------------------------------------------------------------------------------------
export interface QualitePreview {
  quality: number | null;
  est_size_bytes: number | null;
  h264: boolean;
}

export interface Apercu {
  platform: string;
  title: string | null;
  uploader: string | null;
  duration: number | null;
  thumbnail: string | null;
  thumbnail_id?: string | null;
  live?: boolean;
  audio?: "yes" | "no" | "unknown";
  qualities: QualitePreview[];
  est_size_bytes?: Record<string, number>;
  limits?: { too_long?: boolean; transcode_allowed?: boolean };
  media_count: number;
  entries?: Apercu[];
}

export type EtatJob = "queued" | "running" | "done" | "error";

export interface Job {
  job_id: string;
  status: EtatJob;
  stage: string;
  progress: number;
  platform?: string;
  title?: string | null;
  filename?: string | null;
  size_bytes?: number | null;
  media_type?: string | null;
  error?: string;
  detail?: string;
  retry_after_s?: number;
  created_at?: string;
  expires_at?: string | null;
}

export interface Appairage {
  codeAppareil: string;
  codeUtilisateur: string;
  urlVerification: string;
  expireDans: number;
  intervalle: number;
}

/** Fins de la connexion autres que l'accord : le panneau arrête d'interroger et affiche `message`. */
export type FinConnexion = "refuse" | "suspendu" | "trop-d-ordinateurs" | "expire" | "deja-utilise" | "invalide" | "indisponible";

export type ReponseJeton =
  | { etat: "en-attente" }
  | { etat: "lent"; intervalle: number }
  | { etat: "accorde"; cle: string; expireLe: string | null; compte: { email: string; nom: string } }
  | { etat: FinConnexion; message: string };

/** Quota du jour (GET /api/premiere/moi, champ `quota`). */
export interface Quota {
  utilise: number;
  limite: number | null;
  restant: number | null;
  illimite: boolean;
  reinitialiseLe: string | null;
}

/** Une des 5 dernières conversions (champ `recentes`). */
export interface ConversionRecente {
  creeLe: string;
  plateforme: string | null;
  format: string;
  etat: string;
  erreur: string | null;
}

/** Réponse de GET /api/premiere/moi (forme exacte du serveur account). */
export interface Moi {
  compte: { email: string; nom: string | null };
  quota: Quota;
  conversionsEnCours: number;
  recentes: ConversionRecente[];
  cle: { expireLe: string | null };
}

export interface DemandeConversion {
  url: string;
  fmt: Format;
  quality?: Qualite;
  bitrate?: 128 | 192 | 320;
  start_s?: number;
  end_s?: number;
  index?: number;
}

/** Durée maximale d'un extrait (ytapi params.py, CLIP_MAX_S). */
export const EXTRAIT_MAX_S: Record<Format, number> = { mp4: 180, mp3: 600 };

// ---- Messages ---------------------------------------------------------------------------------------------------------------
function messageDe(r: ReponseHttp, repli: string): string {
  const j = r.json as Record<string, unknown> | null;
  const m = j && (typeof j.detail === "string" ? j.detail : typeof j.message === "string" ? j.message : null);
  return typo(m || repli);
}

function codeDe(r: ReponseHttp): string {
  const j = r.json as Record<string, unknown> | null;
  return j && typeof j.error === "string" ? j.error : j && typeof j.etat === "string" ? j.etat : "http_" + r.statut;
}

/** Texte d'un 401 de /moi : révoquée (par toi, par l'administrateur, par sécurité), expirée (30 jours) ou invalide. */
function texteCleRefusee(r: ReponseHttp): string {
  const j = r.json as { error?: unknown; revokedBy?: unknown } | null;
  if (j?.error === "token_expired") return "La connexion de Premiere Pro a expiré (30" + NB + "jours)" + NB + ": reconnecte le panneau.";
  if (j?.error === "token_revoked") {
    if (j.revokedBy === "replay") return "Par sécurité, l’accès du panneau a été révoqué (code de connexion réutilisé)" + NB + ": reconnecte le panneau.";
    if (j.revokedBy === "admin") return "L’accès du panneau a été révoqué par AETHRYON" + NB + ": reconnecte le panneau ou contacte le support.";
    return "L’accès du panneau a été révoqué depuis ton espace" + NB + ": reconnecte le panneau.";
  }
  return "Clé du panneau invalide ou révoquée" + NB + ": reconnecte le panneau.";
}

/** Chaîne nettoyée et tronquée à `max` caractères (points de code), ou null si vide. */
function borner(v: string | null | undefined, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = Array.from(v.replace(/[\u0000-\u001f\u007f]/g, " ").trim()).slice(0, max).join("").trim();
  return t || null;
}

function reessayer(r: ReponseHttp): number | null {
  const v = Number(r.entetes["retry-after"]);
  return isFinite(v) && v > 0 ? v : null;
}

/** Messages du panneau pour les fins de connexion (le serveur envoie aussi un `message` ; le nôtre dit quoi faire). */
export const TEXTES_CONNEXION: Record<FinConnexion, string> = {
  refuse: "Connexion refusée sur le site AETHRYON : rien n’a été autorisé. Relance la connexion si c’était une erreur.",
  suspendu: "Ce compte AETHRYON est suspendu : la connexion de Premiere Pro est impossible.",
  "trop-d-ordinateurs": "Trois ordinateurs sont déjà connectés à ton compte. Révoque-en un dans « Mes jetons » (ton espace AETHRYON), puis relance la connexion.",
  expire: "Le code a expiré (10 minutes) : relance la connexion.",
  "deja-utilise": "Ce code avait déjà servi : par sécurité, l’accès qu’il avait ouvert est révoqué. Relance la connexion.",
  invalide: "Code de connexion inconnu du serveur : relance la connexion.",
  indisponible: "Connexion pas encore disponible : la connexion de Premiere Pro à ton compte n’est pas encore ouverte sur le serveur AETHRYON.",
};

const TEXTES_STATUT: Record<number, string> = {
  401: "Ta connexion à AETHRYON a expiré ou a été révoquée : reconnecte le panneau.",
  403: "Accès refusé par le serveur AETHRYON.",
  404: "Service introuvable sur le serveur AETHRYON.",
  429: "Trop de demandes : réessaie dans un instant.",
  503: "Service AETHRYON momentanément indisponible.",
};

function erreur(r: ReponseHttp, repli?: string): ErreurApi {
  return new ErreurApi(r.statut, codeDe(r), messageDe(r, repli || TEXTES_STATUT[r.statut] || `Le serveur a répondu ${r.statut}.`), reessayer(r));
}

/** Libellé humain de l'étape serveur (stage de ytapi). */
export function libelleEtape(job: Pick<Job, "status" | "stage">): string {
  if (job.status === "queued") return "En file d’attente sur le serveur";
  const s = job.stage || "";
  if (/download/.test(s)) return "Récupération de la vidéo";
  if (/(transcod|convert|encod|ffmpeg|remux|merg|postprocess|clip|cut)/.test(s)) return "Conversion en MP4 compatible";
  if (/(check|probe|verif)/.test(s)) return "Vérification du fichier";
  if (s === "done") return "Conversion terminée";
  return "Conversion sur le serveur";
}

// ---- Client -------------------------------------------------------------------------------------------------------------------
export function creerClient(hote_: Hote, config: ConfigServeur, lireCle: () => string | null) {
  const compte = config.compte.replace(/\/+$/, "");
  const api = config.api.replace(/\/+$/, "");

  function auth(): Record<string, string> {
    const cle = lireCle();
    if (!cle) throw new ErreurApi(401, "non_connecte", "Connecte ton compte AETHRYON pour convertir et importer.");
    return { authorization: `Bearer ${cle}` };
  }

  return {
    config: { compte, api },

    // -- Connexion par page d'accord -------------------------------------------------------------------------------------------
    async appairer(hote: string, versionPremiere: string | null, versionExtension: string): Promise<Appairage> {
      // Corps STRICT du serveur : seulement ces trois champs, des chaînes, absents plutôt que vides ou null.
      const corps: Record<string, string> = {};
      const champs: [keyof typeof LIMITES_APPAREIL, string | null][] = [["hote", hote], ["versionPremiere", versionPremiere], ["versionExtension", versionExtension]];
      for (const [nom, valeur] of champs) {
        const v = borner(valeur, LIMITES_APPAREIL[nom]);
        if (v) corps[nom] = v;
      }
      const r = await hote_.http({ methode: "POST", url: compte + ROUTES.appairage, json: corps });
      if (r.statut === 404) throw new ErreurApi(404, "indisponible", TEXTES_CONNEXION.indisponible);
      if (r.statut !== 200 && r.statut !== 201) throw erreur(r);
      const j = r.json as Partial<Appairage> | null;
      if (!j || typeof j.codeAppareil !== "string" || typeof j.codeUtilisateur !== "string" || typeof j.urlVerification !== "string") {
        throw new ErreurApi(r.statut, "reponse", "Réponse du serveur illisible.");
      }
      // La page d'accord doit être sur le site AETHRYON configuré : on n'ouvre jamais une autre adresse.
      const verif = new URL(j.urlVerification);
      if (verif.origin !== new URL(compte).origin) throw new ErreurApi(0, "origine", "Adresse de connexion inattendue" + NB + ": connexion annulée.");
      return {
        codeAppareil: j.codeAppareil, codeUtilisateur: j.codeUtilisateur, urlVerification: verif.toString(),
        expireDans: Math.min(Math.max(Number(j.expireDans) || 600, 30), 1800), intervalle: Math.min(Math.max(Number(j.intervalle) || 3, 1), 30),
      };
    },

    async jeton(codeAppareil: string): Promise<ReponseJeton> {
      const r = await hote_.http({ methode: "POST", url: compte + ROUTES.jeton, json: { codeAppareil } });
      const j = (r.json && typeof r.json === "object" ? r.json : {}) as { etat?: unknown; error?: unknown; intervalle?: unknown };
      const fin = (etat: FinConnexion): ReponseJeton => ({ etat, message: TEXTES_CONNEXION[etat] });
      if (r.statut === 428) return { etat: "en-attente" };
      if (r.statut === 429) {
        // « trop-rapide » : attendre Retry-After (3 s si l'intervalle n'a pas été respecté, 60 s si l'IP interroge trop).
        const intervalle = reessayer(r) ?? (Number(j.intervalle) > 0 ? Number(j.intervalle) : 5);
        return { etat: "lent", intervalle };
      }
      if (r.statut === 403) return fin(j.error === "account_suspended" ? "suspendu" : "refuse");
      if (r.statut === 409 && j.error === "too_many_premiere") return fin("trop-d-ordinateurs");
      if (r.statut === 410) return fin(j.etat === "deja-utilise" ? "deja-utilise" : "expire");
      if (r.statut === 400 && (j.error === "invalid_grant" || j.etat === "invalide")) return fin("invalide");
      if (r.statut === 404) return fin("indisponible");
      if (r.statut === 200) {
        const k = r.json as { cle?: unknown; expireLe?: unknown; compte?: { email?: unknown; nom?: unknown } } | null;
        if (!k || typeof k.cle !== "string" || k.cle.length < 10) throw new ErreurApi(200, "reponse", "Réponse du serveur illisible.");
        return {
          etat: "accorde", cle: k.cle, expireLe: typeof k.expireLe === "string" ? k.expireLe : null,
          compte: { email: typeof k.compte?.email === "string" ? k.compte.email : "", nom: typeof k.compte?.nom === "string" ? k.compte.nom : "" },
        };
      }
      throw erreur(r);
    },

    urlPageAccord(a: Appairage): string {
      const u = new URL(a.urlVerification);
      u.searchParams.set("code", a.codeUtilisateur);
      return u.toString();
    },

    async moi(): Promise<Moi> {
      const r = await hote_.http({ methode: "GET", url: compte + ROUTES.moi, entetes: auth() });
      if (r.statut === 404) throw new ErreurApi(404, "indisponible", "Le quota et l’historique du panneau ne sont pas encore servis par le serveur AETHRYON.");
      if (r.statut === 401) throw new ErreurApi(401, codeDe(r), texteCleRefusee(r));
      if (r.statut === 403) throw new ErreurApi(403, codeDe(r), "Ce compte AETHRYON est suspendu" + NB + ": les conversions sont bloquées. La liaison est gardée.");
      if (r.statut !== 200) throw erreur(r);
      const j = r.json as Partial<Moi> | null;
      const q = j?.quota;
      if (!j || !j.compte || typeof j.compte.email !== "string" || !q || typeof q.utilise !== "number") throw new ErreurApi(200, "reponse", "Réponse du serveur illisible.");
      const recentes = Array.isArray(j.recentes) ? j.recentes.slice(0, 5) : [];
      return {
        compte: { email: j.compte.email, nom: typeof j.compte.nom === "string" ? j.compte.nom : null },
        quota: { utilise: q.utilise, limite: q.limite ?? null, restant: q.restant ?? null, illimite: !!q.illimite, reinitialiseLe: q.reinitialiseLe ?? null },
        conversionsEnCours: Number(j.conversionsEnCours) || 0,
        recentes: recentes.map((x) => ({ creeLe: String(x.creeLe), plateforme: x.plateforme ?? null, format: String(x.format || ""), etat: String(x.etat || ""), erreur: x.erreur ?? null })),
        cle: { expireLe: j.cle && typeof j.cle.expireLe === "string" ? j.cle.expireLe : null },
      };
    },

    /** Révoque la clé côté serveur (204, idempotent ; 401 : clé déjà inconnue ou révoquée, rien à faire). Corps vide. */
    async deconnecter(): Promise<boolean> {
      const r = await hote_.http({ methode: "POST", url: compte + ROUTES.deconnexion, entetes: auth() });
      return r.statut === 204 || r.statut === 200 || r.statut === 401;
    },

    // -- Conversion ---------------------------------------------------------------------------------------------------------------
    async apercu(url: string): Promise<Apercu> {
      const r = await hote_.http({ methode: "POST", url: api + "/preview", entetes: auth(), json: { url }, delaiMs: 45000 });
      if (r.statut !== 200) throw erreur(r);
      const j = r.json as Apercu | null;
      if (!j || typeof j !== "object") throw new ErreurApi(200, "reponse", "Réponse du serveur illisible.");
      return { ...j, qualities: Array.isArray(j.qualities) ? j.qualities : [], media_count: j.media_count || 1 };
    },

    /** Miniature servie par le serveur (identifiant opaque, 10 min) : data: URL, sans requête vers la plateforme. */
    async miniature(tid: string): Promise<string | null> {
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(tid)) return null;
      const r = await hote_.http({ methode: "GET", url: `${api}/preview/thumbnail/${tid}`, entetes: auth(), reponse: "binaire" });
      if (r.statut !== 200 || !r.base64) return null;
      const type = /^image\/(jpeg|png|webp)/.exec(r.typeContenu || "")?.[0] || "image/jpeg";
      return `data:${type};base64,${r.base64}`;
    },

    async creerJob(d: DemandeConversion): Promise<Job> {
      const corps: Record<string, unknown> = { url: d.url, fmt: d.fmt };
      if (d.fmt === "mp4") {
        corps.quality = d.quality || "1080";
        corps.transcode = true; // MP4 H.264 + AAC : prêt pour Premiere, jamais de VP9/AV1/Opus
      } else {
        corps.bitrate = d.bitrate || 192;
      }
      if (d.start_s != null && d.end_s != null) {
        corps.start_s = Math.round(d.start_s * 1000) / 1000;
        corps.end_s = Math.round(d.end_s * 1000) / 1000;
      }
      if (d.index) corps.index = d.index;
      const r = await hote_.http({ methode: "POST", url: api + "/jobs", entetes: auth(), json: corps, delaiMs: 40000 });
      if (r.statut !== 200 && r.statut !== 202) throw erreur(r);
      return verifierJob(r);
    },

    /** Attente longue côté serveur (?wait=25&change=true) : aucune interrogation rapide. */
    async suivreJob(id: string): Promise<Job> {
      if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) throw new ErreurApi(0, "job", "Identifiant de conversion invalide.");
      const r = await hote_.http({ methode: "GET", url: `${api}/jobs/${id}?wait=25&change=true`, entetes: auth(), delaiMs: 40000 });
      if (r.statut !== 200) throw erreur(r);
      return verifierJob(r);
    },

    /** Annulation : le panneau quitte la conversion (le serveur l'arrête s'il était seul à l'attendre). */
    async quitterJob(id: string): Promise<void> {
      if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return;
      try {
        await hote_.http({ methode: "DELETE", url: `${api}/jobs/${id}`, entetes: auth(), delaiMs: 10000 });
      } catch {
        /* au mieux : le serveur expire le job de lui-même */
      }
    },

    /** Télécharge le fichier converti dans le dossier des médias (flux, .part puis renommage). */
    async telechargerFichier(job: Job, dossier: string, suivi: SuiviOctets, signal?: AbortSignal) {
      if (!/^[A-Za-z0-9_-]{6,64}$/.test(job.job_id)) throw new ErreurApi(0, "job", "Identifiant de conversion invalide.");
      return hote_.telecharger(
        { url: `${api}/jobs/${job.job_id}/file`, entetes: auth(), dossier, nomSouhaite: job.filename || `AETHRYON ${job.job_id}.mp4`, tailleAttendue: job.size_bytes ?? null },
        suivi, signal,
      );
    },

    async sante(): Promise<{ ok: boolean; ms: number; detail: string }> {
      const t0 = Date.now();
      try {
        const r = await hote_.http({ methode: "GET", url: api + "/health", delaiMs: 10000 });
        const ms = Date.now() - t0;
        return { ok: r.statut === 200, ms, detail: r.statut === 200 ? "Serveur de conversion joignable" : `Réponse ${r.statut}` };
      } catch (e) {
        return { ok: false, ms: Date.now() - t0, detail: e instanceof Error ? e.message : "Erreur réseau" };
      }
    },
  };
}

function verifierJob(r: ReponseHttp): Job {
  const j = r.json as Job | null;
  if (!j || typeof j.job_id !== "string" || typeof j.status !== "string") throw new ErreurApi(r.statut, "reponse", "Réponse du serveur illisible.");
  if (j.status === "error") {
    throw new ErreurApi(r.statut, j.error || "job_failed", typo(j.detail || "La conversion a échoué sur le serveur."), j.retry_after_s ?? null);
  }
  return j;
}

export type ClientApi = ReturnType<typeof creerClient>;

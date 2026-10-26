// AETHRYON Cloud V1 : logique métier (ARCHITECTURE.md du dossier cloud-music). Réservé à l'administrateur en V1.
// - Quota : RÉSERVATION atomique (transaction d'écriture exclusive) avant toute URL d'envoi ; quota par compte et plafond
//   global du seau, auquel s'ajoute l'écart mesuré par la réconciliation (octets présents dans le seau, inconnus de la base).
// - « Sauvegardé » seulement après un HEAD du fournisseur : taille exacte, empreinte SHA-256 (métadonnée signée) et, quand
//   l'ETag est un MD5, MD5 identique (le fournisseur a déjà vérifié Content-MD5 à la réception).
// - Expiration : envoye_le + rétention ; la tâche périodique révoque l'accès (statut), supprime CHAQUE version et chaque
//   marqueur, relit le seau pour vérifier, puis met à jour statut et quota ; un échec est journalisé et repris plus tard.
// - Jamais de suppression d'un fichier non expiré pour faire de la place : un quota atteint est un refus clair.
// - Noms d'objets générés ici (aucun nom fourni par un client n'entre dans une clé) ; aucune URL signée journalisée.
import { createHash } from "node:crypto";
import type { CloudConfig } from "../config.ts";
import { newId, writeTx, type DB } from "../db.ts";
import { HttpError } from "../http.ts";
import { log } from "../log.ts";
import { cleValide, pieceJointe } from "../stockage/stockage.ts";
import { StockageErreur, type CloudStore, type EnvoiSigne, type Version } from "./stockage.ts";

export type Statut = "en_attente" | "envoi_en_cours" | "sauvegarde" | "echec" | "suppression_en_attente" | "expire" | "supprime";
export type Origine = "ytapi" | "desktop" | "extension" | "site";
type Motif = "expiration" | "manuelle" | "invalide" | "abandon";

/** Statuts qui occupent (ou réservent) de la place dans le seau : comptés dans le quota. */
export const OCCUPANTS: readonly Statut[] = ["en_attente", "envoi_en_cours", "sauvegarde", "suppression_en_attente"];
const OCC_SQL = OCCUPANTS.map((s) => `'${s}'`).join(", ");
const FINAUX: ReadonlySet<Statut> = new Set(["echec", "expire", "supprime"]);

/** Libellés affichés par les interfaces (« Téléchargé » est l'état du téléchargement lui-même, hors de cette table). */
export const LIBELLES: Record<Statut, string> = {
  en_attente: "En attente de sauvegarde cloud", envoi_en_cours: "Upload cloud en cours", sauvegarde: "Sauvegardé",
  echec: "Échec de sauvegarde", suppression_en_attente: "Suppression en cours", expire: "Expiré", supprime: "Supprimé",
};

/** Types acceptés (extension du nom → type MIME exact). Tout autre fichier est refusé. */
export const TYPES: Readonly<Record<string, string>> = {
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska",
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", opus: "audio/ogg", wav: "audio/wav", flac: "audio/flac",
  gif: "image/gif",
};
/** Types lus dans le navigateur (aperçu « inline », servi depuis le domaine du fournisseur, jamais celui du site). */
export const APERCU: ReadonlySet<string> = new Set(["video/mp4", "video/webm", "audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/wav", "audio/flac", "image/gif"]);

const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const MD5_RE = /^[A-Za-z0-9+/]{22}==$/;
const JOB_RE = /^[A-Za-z0-9_-]{1,40}$/;
const NOM_MAX = 200;
const MARGE_RESERVATION_MS = 15 * 60_000;
const ANCIENNE_VERSION_MS = 10 * 60_000;
const JOURNAL_JOURS = 90;

interface Row {
  id: string; owner_id: string; cle: string; nom_original: string; type_mime: string; taille: number; sha256: string | null; md5: string | null;
  origine: Origine; source_job: string | null; plateforme: string | null; statut: Statut; motif_suppression: Motif | null;
  derniere_erreur: string | null; tentatives: number; prochaine_tentative: string | null; cree_le: string; reserve_jusqu_a: string | null;
  envoye_le: string | null; expire_le: string | null; supprime_le: string | null; version_id: string | null; meta: string | null;
}

export interface Vue {
  id: string; nom: string; type: string; taille: number; statut: Statut; libelle: string; origine: Origine; plateforme: string | null;
  creeLe: string; envoyeLe: string | null; expireLe: string | null; expireDansJours: number | null; sha256: string | null;
  erreur: string | null; apercu: boolean;
  /** AETHRYON Music : fiche du morceau, gardée à part de l'audio (elle reste quand l'audio expire). */
  musique: Musique | null; audioDisponible: boolean;
  reimport: { possible: true; url: string; connecteur: string; attestationRequise: boolean } | null;
}

/** Fiche musicale envoyée par ytapi avec un import autorisé (app/music) ; validée champ par champ. */
export interface Musique {
  connecteur: string; titre: string; artistes: string[]; album: string | null; date: string | null; isrc: string | null;
  licence: { code: string; nom: string; url: string | null }; attribution: string | null; sourceUrl: string;
  pochetteUrl: string | null; attestation: boolean;
  audio: { dureeS: number | null; codec: string | null; debitKbps: number | null; frequenceHz: number | null; canaux: number | null; sansPerte: boolean } | null;
}

/** Connecteurs d'AETHRYON Music qui produisent un fichier (sources qui autorisent le téléchargement). */
const MUSIQUE_SOURCES = new Set(["archive", "commons", "podcast", "fichier"]);
const LICENCES = new Set(["cc0", "pdm", "pd", "cc-by", "cc-by-sa", "editeur", "declaree"]);
const META_MAX = 4000;

const txt = (v: unknown, n: number): string | null => {
  if (typeof v !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ").trim().slice(0, n);
  return t || null;
};
const https = (v: unknown, n = 1000): string | null => (typeof v === "string" && v.length <= n && /^https:\/\/[^\s]+$/.test(v) ? v : null);
const entier = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e9 ? Math.round(v) : null);

/** Fiche musicale propre, ou null (champ absent, source qui ne produit pas de fichier, titre ou lien manquant). */
export function normaliserMusique(raw: unknown): Musique | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const connecteur = typeof m.connecteur === "string" && MUSIQUE_SOURCES.has(m.connecteur) ? m.connecteur : null;
  const titre = txt(m.titre, 300), sourceUrl = https(m.sourceUrl);
  const l = (m.licence && typeof m.licence === "object" ? m.licence : {}) as Record<string, unknown>;
  const code = typeof l.code === "string" && LICENCES.has(l.code) ? l.code : null;
  if (!connecteur || !titre || !sourceUrl || !code) return null;
  const a = (m.audio && typeof m.audio === "object" ? m.audio : null) as Record<string, unknown> | null;
  const duree = a && typeof a.dureeS === "number" && Number.isFinite(a.dureeS) && a.dureeS > 0 && a.dureeS < 1e6 ? Math.round(a.dureeS * 100) / 100 : null;
  const isrc = typeof m.isrc === "string" && /^[A-Z0-9]{12}$/.test(m.isrc) ? m.isrc : null;
  return {
    connecteur, titre, artistes: Array.isArray(m.artistes) ? m.artistes.map((x) => txt(x, 200)).filter((x): x is string => !!x).slice(0, 10) : [],
    album: txt(m.album, 300), date: txt(m.date, 40), isrc,
    licence: { code, nom: txt(l.nom, 200) ?? code, url: https(l.url, 300) }, attribution: txt(m.attribution, 600), sourceUrl,
    pochetteUrl: https(m.pochetteUrl), attestation: m.attestation === true,
    audio: a ? { dureeS: duree, codec: txt(a.codec, 20), debitKbps: entier(a.debitKbps), frequenceHz: entier(a.frequenceHz), canaux: entier(a.canaux), sansPerte: a.sansPerte === true } : null,
  };
}

/** Métadonnées d'un objet en JSON : jamais tronquées (un JSON coupé serait illisible) ; trop grandes → absentes. */
const metaJson = (meta: Record<string, unknown> | undefined): string | null => {
  if (!meta) return null;
  const j = JSON.stringify(meta);
  return j.length <= META_MAX ? j : null;
};

export interface Quota { max: number; utilise: number; reserve: number; sauvegarde: number; disponible: number; global: { max: number; utilise: number; ecart: number } }

export interface Entree { nom: unknown; type: unknown; taille: unknown; sha256: unknown; md5: unknown }

const msg = {
  invalide: (quoi: string) => new HttpError(400, "invalid_request", `Requête invalide : ${quoi}.`),
  introuvable: () => new HttpError(404, "not_found", "Fichier introuvable dans ton cloud."),
};

/** Nom affichable : NFC, sans caractère de contrôle ni séparateur de chemin, 200 caractères au plus, extension gardée. */
export function nettoyerNom(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.slice(0, 1000).normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, "")
    .replace(/[\\/]/g, "_").replace(/\s+/g, " ").trim();
  if (s === "" || s === "." || s === "..") return null;
  const chars = Array.from(s);
  if (chars.length > NOM_MAX) {
    const dot = s.lastIndexOf(".");
    const ext = dot > 0 && s.length - dot <= 6 ? s.slice(dot) : "";
    s = Array.from(s.slice(0, s.length - ext.length)).slice(0, NOM_MAX - ext.length).join("").trimEnd() + ext;
  }
  return s;
}

export function extensionDe(nom: string): string | null {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(nom);
  return m ? m[1]!.toLowerCase() : null;
}

/** Délai avant une nouvelle tentative : 1, 5, 15, 60 min puis 6 h. */
export function delaiReprise(tentatives: number): number {
  return [60_000, 5 * 60_000, 15 * 60_000, 3_600_000][tentatives - 1] ?? 6 * 3_600_000;
}

const hexDe = (b64: string) => Buffer.from(b64, "base64").toString("hex");

export class CloudService {
  readonly cfg: CloudConfig;
  private readonly db: DB;
  private readonly store: CloudStore;
  private readonly now: () => number;
  private enCours = false;
  constructor(db: DB, cfg: CloudConfig, store: CloudStore, now: () => number = Date.now) {
    this.db = db; this.cfg = cfg; this.store = store; this.now = now;
  }

  private iso(ms = this.now()): string { return new Date(ms).toISOString(); }

  cleDe(ownerId: string, id: string): string {
    const h = createHash("sha256").update(ownerId, "utf8").digest("hex").slice(0, 16);
    const cle = `${this.cfg.prefix}v1/${h}/${id}`;
    if (!cleValide(cle)) throw new Error("clé d'objet invalide");
    return cle;
  }

  private row(id: string): Row | undefined {
    return this.db.prepare("SELECT * FROM ytc_cloud_objet WHERE id = ?").get(id) as Row | undefined;
  }

  /** Objet de ce propriétaire, sinon 404 (même réponse qu'un identifiant inconnu : pas d'énumération). */
  objetDe(ownerId: string, id: string): Row {
    if (typeof id !== "string" || !ID_RE.test(id)) throw msg.introuvable();
    const r = this.row(id);
    if (!r || r.owner_id !== ownerId || r.statut === "supprime") throw msg.introuvable();
    return r;
  }

  private journal(objetId: string | null, action: string, ok: boolean, detail: Record<string, unknown> | null = null): void {
    try {
      this.db.prepare("INSERT INTO ytc_cloud_journal (objet_id, action, resultat, detail, cree_le) VALUES (?, ?, ?, ?, ?)")
        .run(objetId, action, ok ? "ok" : "echec", detail ? JSON.stringify(detail).slice(0, 500) : null, this.iso());
    } catch (e) { log("warn", "cloud journal not written", { err: String(e).slice(0, 120) }); }
  }

  // ---- réglages et quota ------------------------------------------------------------------------------------

  reglages(userId: string): { sauvegardeAuto: boolean; quota: number; retentionJours: number } {
    const r = this.db.prepare("SELECT sauvegarde_auto, quota_octets, retention_jours FROM ytc_cloud_compte WHERE user_id = ?").get(userId) as
      { sauvegarde_auto: number; quota_octets: number | null; retention_jours: number | null } | undefined;
    return {
      sauvegardeAuto: r ? r.sauvegarde_auto === 1 : true,
      quota: r?.quota_octets ?? this.cfg.quotaBytes,
      retentionJours: r?.retention_jours ?? this.cfg.retentionDays,
    };
  }

  async changerReglages(userId: string, sauvegardeAuto: boolean): Promise<void> {
    await writeTx(this.db, () => {
      this.db.prepare("INSERT INTO ytc_cloud_compte (user_id, sauvegarde_auto, maj_le) VALUES (?, ?, ?) " +
        "ON CONFLICT(user_id) DO UPDATE SET sauvegarde_auto = excluded.sauvegarde_auto, maj_le = excluded.maj_le").run(userId, sauvegardeAuto ? 1 : 0, this.iso());
    });
  }

  /** Quota calculé dans la transaction de l'appelant (ou seul) : octets réservés et gardés, compte et seau entier. */
  quota(userId: string): Quota {
    const one = (sql: string, ...p: (string | number)[]) => Number((this.db.prepare(sql).get(...p) as { n: number | null } | undefined)?.n ?? 0);
    const max = this.reglages(userId).quota;
    const utilise = one(`SELECT sum(taille) AS n FROM ytc_cloud_objet WHERE owner_id = ? AND statut IN (${OCC_SQL})`, userId);
    const reserve = one("SELECT sum(taille) AS n FROM ytc_cloud_objet WHERE owner_id = ? AND statut IN ('en_attente', 'envoi_en_cours')", userId);
    const sauvegarde = one("SELECT sum(taille) AS n FROM ytc_cloud_objet WHERE owner_id = ? AND statut = 'sauvegarde'", userId);
    const gUtilise = one(`SELECT sum(taille) AS n FROM ytc_cloud_objet WHERE statut IN (${OCC_SQL})`);
    const ecart = Math.max(0, one("SELECT ecart AS n FROM ytc_cloud_mesure WHERE id = 1"));
    const disponible = Math.max(0, Math.min(max - utilise, this.cfg.globalQuotaBytes - gUtilise - ecart));
    return { max, utilise, reserve, sauvegarde, disponible, global: { max: this.cfg.globalQuotaBytes, utilise: gUtilise, ecart } };
  }

  // ---- réservation et envoi ---------------------------------------------------------------------------------

  /** Valide un fichier annoncé (nom, type, taille, empreintes). */
  private valider(e: Entree): { nom: string; type: string; taille: number; sha256: string; md5: string } {
    const nom = nettoyerNom(e.nom);
    if (!nom) throw msg.invalide("nom de fichier");
    const ext = extensionDe(nom);
    const attendu = ext ? TYPES[ext] : undefined;
    if (!attendu) throw new HttpError(415, "type_refuse", "Type de fichier refusé : seuls les fichiers vidéo et audio (MP4, WebM, MOV, MKV, MP3, M4A, AAC, OGG, Opus, WAV, FLAC) et les GIF sont acceptés.");
    if (e.type !== attendu) throw new HttpError(415, "type_refuse", `Type de fichier incohérent : ${attendu} attendu pour un fichier .${ext}.`);
    if (typeof e.taille !== "number" || !Number.isSafeInteger(e.taille) || e.taille < 1) throw msg.invalide("taille");
    if (e.taille > this.cfg.maxFileBytes) {
      throw new HttpError(413, "fichier_trop_volumineux", `Fichier trop volumineux pour le cloud : ${(this.cfg.maxFileBytes / 1e9).toFixed(1).replace(".", ",")} Go au plus par fichier.`);
    }
    if (typeof e.sha256 !== "string" || !SHA256_RE.test(e.sha256)) throw msg.invalide("empreinte SHA-256 (64 caractères hexadécimaux)");
    if (typeof e.md5 !== "string" || !MD5_RE.test(e.md5)) throw msg.invalide("empreinte MD5 (base64, 24 caractères)");
    return { nom, type: attendu, taille: e.taille, sha256: e.sha256, md5: e.md5 };
  }

  /**
   * Réserve la place (atomique) puis signe l'URL d'envoi. Refus clairs : 413 (fichier), 409 quota_atteint ou
   * quota_global_atteint (aucun fichier n'est jamais supprimé pour faire de la place), 429 trop d'envois simultanés.
   */
  async reserver(ownerId: string, e: Entree, o: { origine: Origine; sourceJob?: string | null; plateforme?: string | null; meta?: Record<string, unknown> }): Promise<{ objet: Vue; envoi: EnvoiSigne }> {
    const f = this.valider(e);
    const id = newId(16);
    const cle = this.cleDe(ownerId, id);
    const now = this.now();
    await writeTx(this.db, () => {
      // Même fichier (mêmes octets) déjà sauvegardé par ce compte : refus clair au lieu d'une seconde copie qui
      // consommerait le quota (le Desktop, l'extension et le site ; ytapi garde sa règle par job).
      if (o.origine !== "ytapi") {
        const dup = this.db.prepare("SELECT expire_le FROM ytc_cloud_objet WHERE owner_id = ? AND sha256 = ? AND statut = 'sauvegarde' LIMIT 1").get(ownerId, f.sha256) as { expire_le: string | null } | undefined;
        if (dup) throw new HttpError(409, "deja_dans_le_cloud", "Ce fichier est déjà sauvegardé dans ton cloud : aucune seconde copie n'est envoyée.");
      }
      const pending = Number((this.db.prepare("SELECT count(*) AS n FROM ytc_cloud_objet WHERE owner_id = ? AND statut IN ('en_attente', 'envoi_en_cours')").get(ownerId) as { n: number }).n);
      if (pending >= this.cfg.maxPending) throw new HttpError(429, "trop_d_envois", "Trop d'envois vers le cloud en même temps : attends la fin de ceux en cours.");
      const q = this.quota(ownerId);
      if (q.utilise + f.taille > q.max) {
        throw new HttpError(409, "quota_atteint", `Espace cloud insuffisant : ${fmtGo(q.max - q.utilise)} libres sur ${fmtGo(q.max)}, il en faut ${fmtGo(f.taille)}. Supprime des fichiers du cloud pour faire de la place ; rien n'est supprimé automatiquement avant son expiration.`);
      }
      if (q.global.utilise + q.global.ecart + f.taille > q.global.max) {
        throw new HttpError(409, "quota_global_atteint", "Le stockage cloud du serveur est plein : supprime des fichiers du cloud pour faire de la place.");
      }
      this.db.prepare(`INSERT INTO ytc_cloud_objet (id, owner_id, cle, nom_original, type_mime, taille, sha256, md5, origine, source_job, plateforme, statut, cree_le, reserve_jusqu_a, meta)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'envoi_en_cours', ?, ?, ?)`).run(
        id, ownerId, cle, f.nom, f.type, f.taille, f.sha256, f.md5, o.origine, o.sourceJob ?? null, o.plateforme ?? null,
        this.iso(now), this.iso(now + this.cfg.putTtlS * 1000 + MARGE_RESERVATION_MS), metaJson(o.meta));
    });
    let envoi: EnvoiSigne;
    try {
      envoi = await this.signerEnvoi(this.row(id)!);
    } catch (err) {
      await this.marquerEchec(id, "signature_impossible");
      log("error", "cloud presign failed", { objet: id, err: String((err as Error)?.name ?? err).slice(0, 80) });
      throw new HttpError(503, "cloud_indisponible", "Le cloud est momentanément indisponible. Réessaie dans quelques minutes.");
    }
    log("info", "cloud reserved", { objet: id, user: ownerId, origine: o.origine, taille: f.taille });
    return { objet: this.vue(this.row(id)!), envoi };
  }

  private signerEnvoi(r: Row): Promise<EnvoiSigne> {
    return this.store.signerEnvoi(r.cle, { taille: r.taille, type: r.type_mime, md5: r.md5!, sha256: r.sha256!, disposition: pieceJointe(r.nom_original), expireDansS: this.cfg.putTtlS });
  }

  /** Nouvelle URL d'envoi (reprise après une coupure) : seulement tant que l'envoi n'est ni vérifié ni abandonné. */
  async nouvelleUrl(ownerId: string, id: string): Promise<{ objet: Vue; envoi: EnvoiSigne }> {
    const r = this.objetDe(ownerId, id);
    if (r.statut !== "envoi_en_cours" && r.statut !== "en_attente") throw new HttpError(409, "envoi_termine", "Cet envoi est terminé : il ne peut plus être repris.");
    const now = this.now();
    await writeTx(this.db, () => {
      this.db.prepare("UPDATE ytc_cloud_objet SET statut = 'envoi_en_cours', reserve_jusqu_a = ? WHERE id = ? AND statut IN ('envoi_en_cours', 'en_attente')")
        .run(this.iso(now + this.cfg.putTtlS * 1000 + MARGE_RESERVATION_MS), id);
    });
    const envoi = await this.signerEnvoi(r);
    return { objet: this.vue(this.row(id)!), envoi };
  }

  /**
   * Vérifie l'objet chez le fournisseur (HEAD) et fixe le statut : sauvegarde (taille et empreintes exactes), echec
   * (absent ; ou invalide, alors supprimé), ou en_attente (fournisseur indisponible : nouvelle vérification plus tard).
   */
  async verifier(id: string, contexte: "confirmation" | "reprise" | "abandon"): Promise<Statut> {
    const r = this.row(id);
    if (!r) throw msg.introuvable();
    if (r.statut === "sauvegarde") return "sauvegarde";
    if (r.statut !== "envoi_en_cours" && r.statut !== "en_attente") return r.statut;
    let t;
    try {
      t = await this.store.tete(r.cle);
    } catch (e) {
      if (e instanceof StockageErreur && e.nature === "indisponible") return this.reporter(r, "fournisseur_indisponible", "verification");
      return this.reporter(r, e instanceof StockageErreur ? `refus_${e.code}`.slice(0, 60) : "erreur_verification", "verification");
    }
    if (!t) {
      // Rien chez le fournisseur. Juste après une confirmation (ou une reprise), l'envoi n'a pas abouti ; à l'échéance de
      // la réservation, l'envoi est abandonné. Dans les deux cas la place réservée est rendue.
      await this.marquerEchec(id, contexte === "abandon" ? "envoi_abandonne" : "objet_absent");
      return "echec";
    }
    const etagMd5 = t.etag && /^[0-9a-f]{32}$/i.test(t.etag) ? t.etag.toLowerCase() : null;
    const valide = t.taille === r.taille && t.sha256 === r.sha256 && (etagMd5 === null || r.md5 === null || etagMd5 === hexDe(r.md5));
    if (!valide) {
      log("warn", "cloud object invalid", { objet: id, taille_ok: t.taille === r.taille, sha_ok: t.sha256 === r.sha256 });
      await this.demanderSuppression(id, "invalide", "objet_invalide");
      await this.purger(id);
      return this.row(id)!.statut;
    }
    const now = this.now();
    const jours = this.reglages(r.owner_id).retentionJours;
    const changed = await writeTx(this.db, () => this.db.prepare(
      "UPDATE ytc_cloud_objet SET statut = 'sauvegarde', envoye_le = ?, expire_le = ?, version_id = ?, reserve_jusqu_a = NULL, " +
      "derniere_erreur = NULL, tentatives = 0, prochaine_tentative = NULL WHERE id = ? AND statut IN ('envoi_en_cours', 'en_attente')",
    ).run(this.iso(now), this.iso(now + jours * 86_400_000), t.versionId, id).changes);
    if (changed) {
      this.journal(id, "verification", true, { contexte });
      log("info", "cloud saved", { objet: id, user: r.owner_id, taille: r.taille });
    }
    return this.row(id)!.statut;
  }

  /** Vérification impossible pour l'instant : en_attente, nouvelle tentative programmée (la réservation est gardée). */
  private async reporter(r: Row, code: string, action: string): Promise<Statut> {
    const tentatives = r.tentatives + 1;
    await writeTx(this.db, () => this.db.prepare(
      "UPDATE ytc_cloud_objet SET statut = 'en_attente', tentatives = ?, derniere_erreur = ?, prochaine_tentative = ? WHERE id = ? AND statut IN ('envoi_en_cours', 'en_attente')",
    ).run(tentatives, code, this.iso(this.now() + delaiReprise(tentatives)), r.id));
    this.journal(r.id, action, false, { code, tentatives });
    log("warn", "cloud verification postponed", { objet: r.id, code, tentatives });
    return "en_attente";
  }

  /** Envoi raté sans rien laisser chez le fournisseur : echec, place rendue. */
  private async marquerEchec(id: string, code: string): Promise<void> {
    await writeTx(this.db, () => this.db.prepare(
      "UPDATE ytc_cloud_objet SET statut = 'echec', derniere_erreur = ?, reserve_jusqu_a = NULL, prochaine_tentative = NULL WHERE id = ? AND statut IN ('envoi_en_cours', 'en_attente')",
    ).run(code, id));
    this.journal(id, "envoi", false, { code });
    log("warn", "cloud upload failed", { objet: id, code });
  }

  /** L'envoyeur renonce (échec définitif de son côté, ou annulation) : toute version éventuelle est supprimée. */
  async abandonner(id: string, code: string): Promise<Statut> {
    const r = this.row(id);
    if (!r) throw msg.introuvable();
    if (r.statut !== "envoi_en_cours" && r.statut !== "en_attente") return r.statut;
    await this.demanderSuppression(id, "abandon", code);
    await this.purger(id);
    return this.row(id)!.statut;
  }

  // ---- lecture ----------------------------------------------------------------------------------------------

  vue(r: Row): Vue {
    const exp = r.expire_le ? Date.parse(r.expire_le) : null;
    return {
      id: r.id, nom: r.nom_original, type: r.type_mime, taille: r.taille, statut: r.statut, libelle: LIBELLES[r.statut], origine: r.origine,
      plateforme: r.plateforme, creeLe: r.cree_le, envoyeLe: r.envoye_le, expireLe: r.expire_le,
      expireDansJours: exp !== null && r.statut === "sauvegarde" ? Math.max(0, Math.ceil((exp - this.now()) / 86_400_000)) : null,
      sha256: r.sha256, erreur: r.derniere_erreur, apercu: APERCU.has(r.type_mime), ...this.musiqueDe(r),
    };
  }

  /** Fiche musicale séparée de l'audio : à l'expiration, la fiche reste et l'audio est marqué indisponible. */
  private musiqueDe(r: Row): Pick<Vue, "musique" | "audioDisponible" | "reimport"> {
    let musique: Musique | null = null;
    if (r.meta) {
      try { musique = normaliserMusique((JSON.parse(r.meta) as { musique?: unknown }).musique); } catch { musique = null; }
    }
    const audioDisponible = r.statut === "sauvegarde";
    const reimport = musique && (r.statut === "expire" || r.statut === "echec")
      ? { possible: true as const, url: musique.sourceUrl, connecteur: musique.connecteur, attestationRequise: musique.connecteur === "fichier" }
      : null;
    return { musique, audioDisponible, reimport };
  }

  lister(ownerId: string, f: { q?: string; statut?: string; type?: string; tri?: string; page?: number; taillePage?: number; musique?: string }): { items: Vue[]; total: number; page: number; taillePage: number } {
    const where = ["owner_id = ?"];
    const p: (string | number)[] = [ownerId];
    const statuts = ["en_attente", "envoi_en_cours", "sauvegarde", "echec", "suppression_en_attente", "expire"];
    const musique = f.musique === "1";
    if (f.musique !== undefined && f.musique !== "" && !musique) throw msg.invalide("musique (1 attendu)");
    if (musique) where.push("meta LIKE '{\"musique\":%'");
    // Bibliothèque musicale : les fiches expirées restent visibles (audio indisponible, réimport possible).
    if (musique && (f.statut === undefined || f.statut === "")) where.push("statut != 'supprime'");
    else if (f.statut === undefined || f.statut === "" || f.statut === "actifs") where.push("statut NOT IN ('expire', 'supprime')");
    else if (f.statut === "envois") where.push("statut IN ('en_attente', 'envoi_en_cours', 'echec')");
    else if (statuts.includes(f.statut)) { where.push("statut = ?"); p.push(f.statut); }
    else throw msg.invalide("statut");
    if (f.type !== undefined && f.type !== "") {
      if (!["video", "audio", "image"].includes(f.type)) throw msg.invalide("type");
      where.push("type_mime LIKE ?"); p.push(`${f.type}/%`);
    }
    if (f.q !== undefined && f.q !== "") {
      if (f.q.length > 100) throw msg.invalide("recherche trop longue");
      const motif = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push("(nom_original LIKE ? ESCAPE '\\' OR (meta IS NOT NULL AND meta LIKE ? ESCAPE '\\'))"); p.push(motif, motif);
    }
    const tris: Record<string, string> = { recent: "cree_le DESC", expiration: "expire_le IS NULL, expire_le ASC", taille: "taille DESC", nom: "nom_original COLLATE NOCASE ASC" };
    const tri = tris[f.tri || "recent"];
    if (!tri) throw msg.invalide("tri");
    const page = f.page ?? 1, taillePage = f.taillePage ?? 50;
    if (!Number.isInteger(page) || page < 1 || page > 100_000 || !Number.isInteger(taillePage) || taillePage < 1 || taillePage > 100) throw msg.invalide("pagination");
    const w = where.join(" AND ");
    const total = Number((this.db.prepare(`SELECT count(*) AS n FROM ytc_cloud_objet WHERE ${w}`).get(...p) as { n: number }).n);
    const rows = this.db.prepare(`SELECT * FROM ytc_cloud_objet WHERE ${w} ORDER BY ${tri}, id LIMIT ? OFFSET ?`).all(...p, taillePage, (page - 1) * taillePage) as unknown as Row[];
    return { items: rows.map((r) => this.vue(r)), total, page, taillePage };
  }

  /** Lien temporaire signé (téléchargement en pièce jointe, ou aperçu « inline » des types lisibles). */
  async lien(ownerId: string, id: string, usage: "telecharger" | "apercu"): Promise<{ url: string; expireLe: string; usage: string }> {
    const r = this.objetDe(ownerId, id);
    if (r.statut !== "sauvegarde") {
      if (r.statut === "expire") throw new HttpError(410, "expire", "Ce fichier a expiré : il a été supprimé du cloud.");
      throw new HttpError(409, "pas_disponible", `Ce fichier n'est pas disponible (${LIBELLES[r.statut].toLowerCase()}).`);
    }
    if (!r.expire_le || Date.parse(r.expire_le) <= this.now()) throw new HttpError(410, "expire", "Ce fichier a expiré : il va être supprimé du cloud.");
    if (usage === "apercu" && !APERCU.has(r.type_mime)) throw new HttpError(415, "apercu_impossible", "Aperçu impossible pour ce type de fichier : télécharge-le.");
    const disposition = usage === "apercu" ? pieceJointe(r.nom_original).replace(/^attachment/, "inline") : pieceJointe(r.nom_original);
    // Lien jamais plus long que la vie restante du fichier.
    const restantS = Math.floor((Date.parse(r.expire_le) - this.now()) / 1000);
    const s = await this.store.signerLecture(r.cle, { disposition, type: r.type_mime, expireDansS: Math.max(1, Math.min(this.cfg.getTtlS, restantS)) });
    log("info", "cloud link", { objet: id, user: ownerId, usage });
    return { url: s.url, expireLe: s.expireLe, usage };
  }

  // ---- suppression ------------------------------------------------------------------------------------------

  /** Révoque l'accès (plus aucun lien) et programme la suppression de toutes les versions. */
  private async demanderSuppression(id: string, motif: Motif, code: string | null = null): Promise<void> {
    await writeTx(this.db, () => this.db.prepare(
      "UPDATE ytc_cloud_objet SET statut = 'suppression_en_attente', motif_suppression = ?, derniere_erreur = COALESCE(?, derniere_erreur), " +
      "prochaine_tentative = NULL, tentatives = 0 WHERE id = ? AND statut IN ('sauvegarde', 'envoi_en_cours', 'en_attente')",
    ).run(motif, code, id));
  }

  /** Suppression manuelle par le propriétaire. */
  async supprimer(ownerId: string, id: string): Promise<Vue> {
    const r = this.objetDe(ownerId, id);
    if (r.statut === "echec" || r.statut === "expire") {
      // Rien n'est gardé chez le fournisseur : la ligne disparaît seulement de la bibliothèque.
      await writeTx(this.db, () => this.db.prepare("UPDATE ytc_cloud_objet SET statut = 'supprime', supprime_le = ? WHERE id = ? AND statut IN ('echec', 'expire')").run(this.iso(), id));
    } else if (r.statut !== "suppression_en_attente") {
      await this.demanderSuppression(id, r.statut === "sauvegarde" ? "manuelle" : "abandon");
    }
    if (this.row(id)!.statut === "suppression_en_attente") await this.purger(id);
    log("info", "cloud delete", { objet: id, user: ownerId, statut: this.row(id)!.statut });
    return this.vue(this.row(id)!);
  }

  /** Supprime chaque version et chaque marqueur, relit le seau, puis fixe le statut final ; reprise programmée sinon. */
  async purger(id: string): Promise<boolean> {
    const r = this.row(id);
    if (!r || r.statut !== "suppression_en_attente") return false;
    let res;
    try {
      res = await this.store.supprimerToutesVersions(r.cle);
    } catch (e) {
      await this.echecPurge(r, e instanceof StockageErreur ? (e.nature === "indisponible" ? "fournisseur_indisponible" : `refus_${e.code}`.slice(0, 60)) : "erreur_suppression");
      return false;
    }
    if (res.restantes > 0) { await this.echecPurge(r, "versions_restantes"); return false; }
    const final: Statut = r.motif_suppression === "expiration" ? "expire" : r.motif_suppression === "manuelle" ? "supprime" : "echec";
    await writeTx(this.db, () => this.db.prepare(
      "UPDATE ytc_cloud_objet SET statut = ?, supprime_le = ?, reserve_jusqu_a = NULL, prochaine_tentative = NULL, tentatives = 0 WHERE id = ? AND statut = 'suppression_en_attente'",
    ).run(final, this.iso(), id));
    this.journal(id, r.motif_suppression === "expiration" ? "expiration" : "suppression", true, { versions: res.supprimees, octets: res.octets });
    log("info", "cloud purged", { objet: id, motif: r.motif_suppression, versions: res.supprimees });
    return true;
  }

  private async echecPurge(r: Row, code: string): Promise<void> {
    const tentatives = r.tentatives + 1;
    await writeTx(this.db, () => this.db.prepare(
      "UPDATE ytc_cloud_objet SET tentatives = ?, derniere_erreur = ?, prochaine_tentative = ? WHERE id = ? AND statut = 'suppression_en_attente'",
    ).run(tentatives, code, this.iso(this.now() + delaiReprise(tentatives)), r.id));
    this.journal(r.id, r.motif_suppression === "expiration" ? "expiration" : "suppression", false, { code, tentatives });
    log("warn", "cloud purge failed", { objet: r.id, code, tentatives });
  }

  // ---- tâches périodiques -----------------------------------------------------------------------------------

  /**
   * Expiration (accès révoqué puis toutes versions supprimées et vérifiées), reprises des suppressions et des
   * vérifications en attente, envois abandonnés (réservation échue : vérifiés, puis gardés s'ils sont complets).
   */
  async tache(): Promise<{ expires: number; purges: number; verifies: number; abandons: number }> {
    if (this.enCours) return { expires: 0, purges: 0, verifies: 0, abandons: 0 };
    this.enCours = true;
    try {
      const now = this.iso();
      const expires = await writeTx(this.db, () => this.db.prepare(
        "UPDATE ytc_cloud_objet SET statut = 'suppression_en_attente', motif_suppression = 'expiration', prochaine_tentative = NULL, tentatives = 0 " +
        "WHERE statut = 'sauvegarde' AND expire_le <= ?",
      ).run(now).changes);
      let purges = 0, verifies = 0, abandons = 0;
      const dus = (this.db.prepare("SELECT id FROM ytc_cloud_objet WHERE statut = 'suppression_en_attente' AND (prochaine_tentative IS NULL OR prochaine_tentative <= ?) ORDER BY cree_le LIMIT 200").all(now) as { id: string }[]);
      for (const { id } of dus) if (await this.purger(id)) purges++;
      const attente = (this.db.prepare("SELECT id FROM ytc_cloud_objet WHERE statut = 'en_attente' AND (prochaine_tentative IS NULL OR prochaine_tentative <= ?) LIMIT 200").all(now) as { id: string }[]);
      for (const { id } of attente) { await this.verifier(id, "reprise"); verifies++; }
      const echus = (this.db.prepare("SELECT id FROM ytc_cloud_objet WHERE statut = 'envoi_en_cours' AND reserve_jusqu_a <= ? LIMIT 200").all(now) as { id: string }[]);
      for (const { id } of echus) { await this.verifier(id, "abandon"); abandons++; }
      if (expires || purges || verifies || abandons) log("info", "cloud task", { expires, purges, verifies, abandons });
      return { expires: Number(expires), purges, verifies, abandons };
    } finally { this.enCours = false; }
  }

  /**
   * Réconciliation base ⇄ seau (toutes versions et marqueurs) : objets inconnus de la base ou d'une ligne terminée
   * (orphelins, envois abandonnés) supprimés après CLOUD_ORPHAN_GRACE_S ; anciennes versions d'un objet gardé supprimées ;
   * objet gardé introuvable → echec « objet_absent » ; envois multiparties oubliés annulés ; écart mesuré enregistré.
   */
  async reconcilier(): Promise<{ octetsReels: number; octetsBase: number; ecart: number; versions: number; orphelins: number; anciennes: number; absents: number; multiparties: number }> {
    const now = this.now();
    const parCle = new Map<string, Version[]>();
    for await (const v of this.store.toutesVersions(this.cfg.prefix)) {
      const l = parCle.get(v.cle);
      if (l) l.push(v); else parCle.set(v.cle, [v]);
    }
    const rows = new Map<string, Row>();
    for (const r of this.db.prepare("SELECT * FROM ytc_cloud_objet WHERE statut <> 'supprime' OR supprime_le > ?").all(this.iso(now - 30 * 86_400_000)) as unknown as Row[]) rows.set(r.cle, r);
    let reels = 0, versions = 0, orphelins = 0, anciennes = 0, absents = 0, liberes = 0;
    for (const [cle, vs] of parCle) {
      const octets = vs.reduce((a, v) => a + v.taille, 0);
      reels += octets; versions += vs.length;
      const r = rows.get(cle) ?? (this.db.prepare("SELECT * FROM ytc_cloud_objet WHERE cle = ?").get(cle) as Row | undefined);
      const plusRecent = Math.max(...vs.map((v) => v.modifieLe?.getTime() ?? now));
      if (!r || FINAUX.has(r.statut)) {
        if (now - plusRecent < this.cfg.orphanGraceS * 1000) continue;
        try { await this.store.supprimerVersions(vs); orphelins++; liberes += octets; this.journal(r?.id ?? null, "orphelin", true, { versions: vs.length, octets }); }
        catch (e) { this.journal(r?.id ?? null, "orphelin", false, { code: (e as StockageErreur).code ?? "erreur" }); }
      } else if (r.statut === "sauvegarde") {
        const donnees = vs.filter((v) => !v.marqueur && v.taille === r.taille);
        const garder = donnees.find((v) => r.version_id && v.versionId === r.version_id) ?? donnees.sort((a, b) => (b.modifieLe?.getTime() ?? 0) - (a.modifieLe?.getTime() ?? 0))[0];
        const extra = vs.filter((v) => v !== garder && now - (v.modifieLe?.getTime() ?? now) >= ANCIENNE_VERSION_MS);
        if (extra.length && garder) {
          try { await this.store.supprimerVersions(extra); anciennes += extra.length; liberes += extra.reduce((a, v) => a + v.taille, 0); this.journal(r.id, "anciennes_versions", true, { versions: extra.length }); }
          catch (e) { this.journal(r.id, "anciennes_versions", false, { code: (e as StockageErreur).code ?? "erreur" }); }
        }
      }
    }
    // Objets gardés qui n'existent plus chez le fournisseur (liste complète lue sans erreur) : la base dit la vérité.
    for (const r of rows.values()) {
      if (r.statut !== "sauvegarde" || parCle.get(r.cle)?.some((v) => !v.marqueur)) continue;
      await writeTx(this.db, () => this.db.prepare("UPDATE ytc_cloud_objet SET statut = 'echec', derniere_erreur = 'objet_absent' WHERE id = ? AND statut = 'sauvegarde'").run(r.id));
      this.journal(r.id, "reconciliation", false, { code: "objet_absent" });
      log("warn", "cloud object missing at provider", { objet: r.id });
      absents++;
    }
    let multiparties = 0;
    try { multiparties = await this.store.annulerMultipartiesAnciennes(this.cfg.prefix, new Date(now - this.cfg.orphanGraceS * 1000)); }
    catch { /* reprise à la prochaine réconciliation */ }
    const base = Number((this.db.prepare(`SELECT sum(taille) AS n FROM ytc_cloud_objet WHERE statut IN (${OCC_SQL})`).get() as { n: number | null }).n ?? 0);
    const reelsApres = reels - liberes;
    const ecart = Math.max(0, reelsApres - base);
    await writeTx(this.db, () => this.db.prepare(
      "INSERT INTO ytc_cloud_mesure (id, mesure_le, octets_reels, octets_base, ecart, versions, orphelins, detail) VALUES (1, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET mesure_le = excluded.mesure_le, octets_reels = excluded.octets_reels, octets_base = excluded.octets_base, " +
      "ecart = excluded.ecart, versions = excluded.versions, orphelins = excluded.orphelins, detail = excluded.detail",
    ).run(this.iso(now), reelsApres, base, ecart, versions, orphelins, JSON.stringify({ anciennes, absents, multiparties, liberes })));
    this.journal(null, "reconciliation", true, { reels: reelsApres, base, ecart, orphelins, anciennes, absents });
    log("info", "cloud reconcile", { reels: reelsApres, base, ecart, versions, orphelins, anciennes, absents, multiparties });
    return { octetsReels: reelsApres, octetsBase: base, ecart, versions, orphelins, anciennes, absents, multiparties };
  }

  /** Purge quotidienne : journal du cloud au-delà de 90 jours. */
  async purgerJournal(): Promise<number> {
    return Number(await writeTx(this.db, () => this.db.prepare("DELETE FROM ytc_cloud_journal WHERE cree_le < ?").run(this.iso(this.now() - JOURNAL_JOURS * 86_400_000)).changes));
  }

  mesure(): Record<string, unknown> | null {
    return (this.db.prepare("SELECT mesure_le, octets_reels, octets_base, ecart, versions, orphelins FROM ytc_cloud_mesure WHERE id = 1").get() as Record<string, unknown> | undefined) ?? null;
  }

  // ---- ytapi (API interne) ----------------------------------------------------------------------------------

  /**
   * Un téléchargement d'ytapi vient d'aboutir : faut-il le sauvegarder ? Oui seulement pour un ADMINISTRATEUR, cloud
   * actif, sauvegarde automatique activée et quota disponible. Un quota atteint laisse une ligne « Échec de sauvegarde »
   * (erreur claire dans la bibliothèque) ; le téléchargement lui-même reste réussi.
   */
  async offre(b: Record<string, unknown>): Promise<{ sauvegarder: false; raison: string } | { sauvegarder: true; objet: Vue; envoi: EnvoiSigne }> {
    const userId = typeof b.user_id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(b.user_id) ? b.user_id : null;
    const jobId = typeof b.job_id === "string" && JOB_RE.test(b.job_id) ? b.job_id : null;
    if (!userId || !jobId) throw msg.invalide("user_id et job_id");
    const u = this.db.prepare('SELECT role, status FROM "user" WHERE id = ?').get(userId) as { role: string | null; status: string | null } | undefined;
    if (!u || u.status === "suspended") return { sauvegarder: false, raison: "compte_inconnu" };
    if (u.role !== "admin") return { sauvegarder: false, raison: "non_admin" };
    if (!this.reglages(userId).sauvegardeAuto) return { sauvegarder: false, raison: "sauvegarde_auto_coupee" };
    if (typeof b.usage_id === "string") {
      const us = this.db.prepare("SELECT user_id FROM ytc_usage WHERE id = ?").get(b.usage_id) as { user_id: string } | undefined;
      if (!us || us.user_id !== userId) return { sauvegarder: false, raison: "usage_inconnu" };
    }
    const dup = this.db.prepare(`SELECT id FROM ytc_cloud_objet WHERE owner_id = ? AND origine = 'ytapi' AND source_job = ? AND statut IN (${OCC_SQL})`).get(userId, jobId);
    if (dup) return { sauvegarder: false, raison: "deja_envoye" };
    const plateforme = typeof b.plateforme === "string" ? b.plateforme.slice(0, 32) : null;
    // AETHRYON Music : fiche du morceau (validée ; une fiche invalide est ignorée, la sauvegarde continue).
    const fiche = b.meta && typeof b.meta === "object" ? normaliserMusique((b.meta as Record<string, unknown>).musique) : null;
    const meta = fiche ? { musique: fiche } : undefined;
    try {
      const out = await this.reserver(userId, { nom: b.nom, type: b.type, taille: b.taille, sha256: b.sha256, md5: b.md5 }, { origine: "ytapi", sourceJob: jobId, plateforme, meta });
      return { sauvegarder: true, ...out };
    } catch (e) {
      if (e instanceof HttpError && (e.code === "quota_atteint" || e.code === "quota_global_atteint" || e.code === "fichier_trop_volumineux" || e.code === "trop_d_envois")) {
        await this.noterRefus(userId, b, jobId, plateforme, e.code, meta);
        return { sauvegarder: false, raison: e.code };
      }
      if (e instanceof HttpError && (e.status === 400 || e.status === 415)) return { sauvegarder: false, raison: e.code };
      throw e;
    }
  }

  /** Ligne « Échec de sauvegarde » visible dans la bibliothèque (aucune place réservée, rien chez le fournisseur). */
  private async noterRefus(userId: string, b: Record<string, unknown>, jobId: string, plateforme: string | null, code: string, meta?: Record<string, unknown>): Promise<void> {
    const nom = nettoyerNom(b.nom) ?? "fichier";
    const ext = extensionDe(nom);
    const type = (ext && TYPES[ext]) || "application/octet-stream";
    const taille = typeof b.taille === "number" && Number.isSafeInteger(b.taille) && b.taille > 0 ? b.taille : 1;
    const id = newId(16);
    await writeTx(this.db, () => this.db.prepare(`INSERT INTO ytc_cloud_objet (id, owner_id, cle, nom_original, type_mime, taille, origine, source_job, plateforme, statut, derniere_erreur, cree_le, meta)
      VALUES (?, ?, ?, ?, ?, ?, 'ytapi', ?, ?, 'echec', ?, ?, ?)`).run(id, userId, this.cleDe(userId, id), nom, type, taille, jobId, plateforme, code, this.iso(), metaJson(meta)));
    log("info", "cloud offer refused", { objet: id, user: userId, code });
  }

  /** Objet envoyé par ytapi pour ce compte (contrôle du propriétaire et de l'origine). */
  objetYtapi(userId: unknown, id: string): Row {
    if (typeof userId !== "string") throw msg.introuvable();
    const r = this.objetDe(userId, id);
    if (r.origine !== "ytapi") throw msg.introuvable();
    return r;
  }
}

const fmtGo = (n: number) => `${(Math.max(0, n) / 1e9).toFixed(2).replace(".", ",")} Go`;

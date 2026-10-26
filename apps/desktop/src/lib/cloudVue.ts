// Section CLOUD du Desktop : règles PURES (cloudVue.test.ts). Libellés des statuts du brief (Téléchargé, En attente de
// sauvegarde, Envoi en cours, Sauvegardé, Échec de sauvegarde, Expiré), « Expire dans X jours » et date, jauge réelle
// du quota (unités décimales, comme le quota du serveur : 9 Go = 9 000 000 000 octets), textes des transferts (aucun
// pourcentage inventé : seulement fait / total quand le cœur les donne), erreurs de synchronisation lisibles.
import { NBSP } from "./format";
import type { EtatCompte, ObjetCloud, QuotaCloud, StatutCloud, TransfertCloud } from "./types";

export { envoiPossible, typeCloud } from "./compte";

/** Octets → « 845 Ko », « 14,2 Mo », « 2,4 Go » (décimal, comme le quota du serveur). */
export function octetsCloud(o: number): string {
  if (!Number.isFinite(o) || o < 0) return "—";
  // Go : deux décimales sous 10 Go (près du quota de 9 Go, « 8,96 Go » et non « 9 Go ») ; zéros finaux retirés.
  const v = (x: number, d = 1) => (x >= 100 ? String(Math.round(x)) : x.toFixed(x >= 10 ? 1 : d).replace(".", ",").replace(/,?0+$/, (z) => (z.startsWith(",") ? "" : z.replace(/0+$/, ""))));
  if (o === 0) return `0${NBSP}Go`;
  if (o < 1000) return `${o}${NBSP}octets`;
  if (o < 1e6) return `${v(o / 1e3)}${NBSP}Ko`;
  if (o < 1e9) return `${v(o / 1e6)}${NBSP}Mo`;
  return `${v(o / 1e9, 2)}${NBSP}Go`;
}

export type Ton = "ok" | "attente" | "cours" | "erreur" | "eteint";

/** Libellé et ton d'un statut du serveur. */
export function statutObjet(s: StatutCloud): { libelle: string; ton: Ton } {
  switch (s) {
    case "sauvegarde": return { libelle: "Sauvegardé", ton: "ok" };
    case "en_attente": return { libelle: "En attente de sauvegarde", ton: "attente" };
    case "envoi_en_cours": return { libelle: "Envoi en cours", ton: "cours" };
    case "echec": return { libelle: "Échec de sauvegarde", ton: "erreur" };
    case "suppression_en_attente": return { libelle: "Suppression en cours", ton: "eteint" };
    case "expire": return { libelle: "Expiré", ton: "eteint" };
    default: return { libelle: "Supprimé", ton: "eteint" };
  }
}

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** « 22 novembre 2026 » */
export function dateJour(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${d.getDate()}${NBSP}${MOIS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Échéance d'un objet sauvegardé : « Expire dans 12 jours », « Expire demain », « Expire aujourd'hui » + date. */
export function expiration(o: Pick<ObjetCloud, "statut" | "expireLe">, maintenant = Date.now()): { court: string; date: string; proche: boolean } | null {
  if (o.statut !== "sauvegarde" || !o.expireLe) return null;
  const fin = Date.parse(o.expireLe);
  if (Number.isNaN(fin)) return null;
  // Jours de calendrier (heure locale) : « aujourd'hui », « demain », puis « dans N jours ».
  const minuit = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const jours = Math.max(0, Math.round((minuit(fin) - minuit(maintenant)) / 86_400_000));
  const court = fin <= maintenant || jours === 0 ? "Expire aujourd'hui" : jours === 1 ? "Expire demain" : `Expire dans ${jours}${NBSP}jours`;
  return { court, date: `le ${dateJour(o.expireLe)}`, proche: jours <= 3 };
}

/** Jauge du quota : fractions RÉELLES (sauvegardé, réservé par les envois en cours), textes. */
export function jauge(q: QuotaCloud): { sauve: number; reserve: number; niveau: "normal" | "haut" | "plein"; utilise: string; disponible: string; max: string; aria: string } {
  const max = Math.max(1, q.max);
  const borne = (x: number) => Math.max(0, Math.min(1, x));
  const sauve = borne(q.sauvegarde / max);
  const reserve = borne((q.utilise - q.sauvegarde) / max);
  const total = borne(q.utilise / max);
  const niveau = q.disponible <= 0 || total >= 0.98 ? "plein" : total >= 0.85 ? "haut" : "normal";
  const utilise = octetsCloud(q.utilise), disponible = octetsCloud(Math.max(0, q.disponible)), m = octetsCloud(q.max);
  return { sauve, reserve, niveau, utilise, disponible, max: m, aria: `${utilise} utilisés sur ${m}, ${disponible} disponibles` };
}

/** Pourcentage RÉEL d'un transfert (null si le total est inconnu : l'interface dit « en cours » sans chiffre). */
export function fraction(t: Pick<TransfertCloud, "fait" | "total">): number | null {
  return t.total > 0 ? Math.max(0, Math.min(1, t.fait / t.total)) : null;
}

const pct = (f: number) => `${Math.floor(f * 100)}${NBSP}%`;

/** Texte d'un transfert local (file d'envoi, téléchargement). */
export function libelleTransfert(t: TransfertCloud): { libelle: string; ton: Ton; actif: boolean } {
  const f = fraction(t);
  const envoi = t.sens === "envoi";
  switch (t.etape) {
    case "attente": return { libelle: envoi ? "En attente de sauvegarde" : "En attente", ton: "attente", actif: true };
    case "verification": return { libelle: f == null ? "Préparation de l'envoi" : `Préparation de l'envoi · ${pct(f)}`, ton: "cours", actif: true };
    case "envoi": return { libelle: f == null ? "Envoi en cours" : `Envoi en cours · ${pct(f)}`, ton: "cours", actif: true };
    case "confirmation": return { libelle: "Vérification par le serveur…", ton: "cours", actif: true };
    case "telechargement": return { libelle: f == null ? "Téléchargement" : `Téléchargement · ${pct(f)}`, ton: "cours", actif: true };
    case "termine":
      if (!envoi) return { libelle: "Téléchargé", ton: "ok", actif: false };
      return t.statut === "en_attente" ? { libelle: "En attente de sauvegarde", ton: "attente", actif: false } : { libelle: "Sauvegardé", ton: "ok", actif: false };
    case "annule": return { libelle: "Annulé", ton: "eteint", actif: false };
    default: return { libelle: envoi ? "Échec de sauvegarde" : "Échec du téléchargement", ton: "erreur", actif: false };
  }
}

/** Erreurs de synchronisation : code machine → phrase (vouvoiement du Desktop) ; repli sur le message du cœur. */
const ERREURS: Record<string, string> = {
  quota_atteint: "Espace Cloud insuffisant : supprimez des fichiers du Cloud pour faire de la place. Rien n'est supprimé avant son expiration.",
  quota_global_atteint: "Le stockage du serveur est plein : supprimez des fichiers du Cloud pour faire de la place.",
  fichier_trop_volumineux: "Fichier trop volumineux pour le Cloud.",
  type_refuse: "Type non accepté par le Cloud : vidéo, audio ou GIF seulement.",
  deja_dans_le_cloud: "Ce fichier est déjà sauvegardé dans le Cloud : aucune seconde copie n'est envoyée.",
  trop_d_envois: "Trop d'envois en même temps : attendez la fin de ceux en cours.",
  envoi_interrompu: "Envoi interrompu (connexion coupée) : la place réservée a été libérée. Réessayez.",
  envoi_refuse: "Le stockage a refusé l'envoi (lien d'envoi expiré) : réessayez.",
  objet_invalide: "Le fichier reçu ne correspond pas à l'original : rien n'a été gardé. Réessayez.",
  envoi_abandonne: "Envoi abandonné : le fichier n'est jamais arrivé dans le Cloud.",
  annule: "Envoi annulé avant la fin : rien n'a été gardé dans le Cloud.",
  objet_absent: "Fichier absent du stockage : supprimez cette ligne.",
  fichier_modifie: "Le fichier a changé pendant l'envoi : réessayez quand il sera terminé.",
  lien_refuse: "Lien temporaire expiré : relancez le téléchargement.",
  telechargement_interrompu: "Téléchargement interrompu (connexion coupée) : rien n'a été gardé. Réessayez.",
  empreinte: "Le fichier reçu ne correspond pas à celui du Cloud : rien n'a été gardé.",
  cloud_indisponible: "Le Cloud est momentanément indisponible : réessayez dans quelques minutes.",
  non_relie: "AETHRYON Desktop n'est pas relié à votre compte (Paramètres › Compte).",
  forbidden: "AETHRYON Cloud est réservé à l'administrateur.",
  cloud_closed: "AETHRYON Cloud n'est pas activé sur le serveur.",
  token_revoked: "La liaison a été révoquée sur le site : reliez de nouveau ce Desktop (Paramètres › Compte).",
  token_expired: "La liaison a expiré (30 jours) : reliez de nouveau ce Desktop (Paramètres › Compte).",
  expire: "Ce fichier a expiré : il a été supprimé du Cloud.",
  pas_disponible: "Ce fichier n'est pas disponible pour l'instant.",
  reseau: "Site AETHRYON injoignable : vérifiez la connexion à Internet.",
};

export function erreurLisible(code: string | null | undefined, message?: string | null): string {
  if (code && ERREURS[code]) return ERREURS[code];
  if (code && /^http_5\d\d$/.test(code)) return "Stockage Cloud momentanément indisponible : réessayez.";
  return message || "Opération impossible.";
}

/** Lien temporaire : « valable 5 min, jusqu'à 14:32 ». */
export function dureeLien(expireLe: string, maintenant = Date.now()): string {
  const fin = Date.parse(expireLe);
  if (Number.isNaN(fin)) return "valable quelques minutes";
  const min = Math.max(1, Math.round((fin - maintenant) / 60_000));
  const d = new Date(fin);
  const h = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `valable ${min}${NBSP}min, jusqu'à ${h}`;
}

/** Explication sobre dans Paramètres quand la section CLOUD n'existe pas pour ce compte. */
export function raisonSansCloud(e: EtatCompte | null): string | null {
  if (!e?.relie) return null;
  if (e.cloud?.raison === "non_admin" || e.administrateur === false) return "AETHRYON Cloud est réservé à l'administrateur : il n'apparaît pas pour ce compte.";
  if (e.cloud?.raison === "ferme") return "AETHRYON Cloud n'est pas activé sur le serveur pour le moment.";
  return null;
}

export const FILTRES_TYPES = [{ id: "", libelle: "Tous" }, { id: "video", libelle: "Vidéo" }, { id: "audio", libelle: "Audio" }] as const;
export const FILTRES_STATUTS = [
  { id: "", libelle: "Tous les fichiers" }, { id: "sauvegarde", libelle: "Sauvegardés" }, { id: "envois", libelle: "Envois en cours ou en échec" },
  { id: "echec", libelle: "Échecs de sauvegarde" }, { id: "expire", libelle: "Expirés" },
] as const;
export const TRIS = [{ id: "recent", libelle: "Plus récents" }, { id: "expiration", libelle: "Expiration proche" }, { id: "taille", libelle: "Plus gros" }, { id: "nom", libelle: "Nom" }] as const;

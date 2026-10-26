// AETHRYON Cloud dans l'espace (app/Cloud.tsx) : formes de l'API d'account (/api/cloud/*) et règles d'affichage PURES
// (tests/cloud.test.ts), alignées sur la section Cloud du Desktop (desktop/src/lib/cloudVue.ts) : unités décimales du
// quota (9 Go = 9 000 000 000 octets), « Expire dans X jours » en jours de calendrier, statuts du brief.
const NB = " ";

export type StatutCloud = "en_attente" | "envoi_en_cours" | "sauvegarde" | "echec" | "suppression_en_attente" | "expire" | "supprime";
export interface QuotaCloud { max: number; utilise: number; reserve: number; sauvegarde: number; disponible: number }
export interface EtatCloud { actif: boolean; quota: QuotaCloud; retentionJours: number; tailleMaxFichier: number; sauvegardeAuto: boolean }
export interface ObjetCloud {
  id: string; nom: string; type: string; taille: number; statut: StatutCloud; libelle: string; origine: string; plateforme: string | null;
  creeLe: string; envoyeLe: string | null; expireLe: string | null; expireDansJours: number | null; sha256: string | null; erreur: string | null; apercu: boolean;
}
export interface ListeCloud { items: ObjetCloud[]; total: number; page: number; taillePage: number; quota: QuotaCloud | null }

export const STATUTS: Record<StatutCloud, { label: string; tone: "ok" | "warn" | "bad" | "gold" | "neutral" }> = {
  sauvegarde: { label: "Sauvegardé", tone: "ok" },
  en_attente: { label: "En attente de sauvegarde", tone: "warn" },
  envoi_en_cours: { label: "Envoi en cours", tone: "gold" },
  echec: { label: "Échec de sauvegarde", tone: "bad" },
  suppression_en_attente: { label: "Suppression en cours", tone: "neutral" },
  expire: { label: "Expiré", tone: "neutral" },
  supprime: { label: "Supprimé", tone: "neutral" },
};

/** Octets → « 846 Ko », « 14,2 Mo », « 8,96 Go » (décimal ; deux décimales sous 10 Go, zéros finaux retirés). */
export function octets(o: number): string {
  if (!Number.isFinite(o) || o < 0) return "—";
  const v = (x: number, d = 1) => (x >= 100 ? String(Math.round(x)) : x.toFixed(x >= 10 ? 1 : d).replace(".", ",").replace(/,?0+$/, (z) => (z.startsWith(",") ? "" : z.replace(/0+$/, ""))));
  if (o === 0) return `0${NB}Go`;
  if (o < 1000) return `${o}${NB}octets`;
  if (o < 1e6) return `${v(o / 1e3)}${NB}Ko`;
  if (o < 1e9) return `${v(o / 1e6)}${NB}Mo`;
  return `${v(o / 1e9, 2)}${NB}Go`;
}

export function jaugeCloud(q: QuotaCloud) {
  const max = Math.max(1, q.max);
  const borne = (x: number) => Math.max(0, Math.min(1, x));
  const sauve = borne(q.sauvegarde / max);
  const reserve = borne((q.utilise - q.sauvegarde) / max);
  const total = borne(q.utilise / max);
  const niveau: "normal" | "haut" | "plein" = q.disponible <= 0 || total >= 0.98 ? "plein" : total >= 0.85 ? "haut" : "normal";
  const utilise = octets(q.utilise), disponible = octets(Math.max(0, q.disponible)), m = octets(q.max);
  return { sauve, reserve, niveau, utilise, disponible, max: m, aria: `${utilise} utilisés sur ${m}, ${disponible} disponibles` };
}

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const dateJour = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "—" : `${d.getDate()}${NB}${MOIS[d.getMonth()]} ${d.getFullYear()}`; };

/** « Expire dans 12 jours » / « Expire demain » / « Expire aujourd'hui » (jours de calendrier) + « le 4 novembre 2026 ». */
export function expiration(o: Pick<ObjetCloud, "statut" | "expireLe">, maintenant = Date.now()): { court: string; date: string; proche: boolean } | null {
  if (o.statut !== "sauvegarde" || !o.expireLe) return null;
  const fin = Date.parse(o.expireLe);
  if (Number.isNaN(fin)) return null;
  const minuit = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const jours = Math.max(0, Math.round((minuit(fin) - minuit(maintenant)) / 86_400_000));
  const court = fin <= maintenant || jours === 0 ? "Expire aujourd'hui" : jours === 1 ? "Expire demain" : `Expire dans ${jours}${NB}jours`;
  return { court, date: `le ${dateJour(o.expireLe)}`, proche: jours <= 3 };
}

/** « 5 min, jusqu'à 14:32 » */
export function dureeLien(expireLe: string, maintenant = Date.now()): string {
  const fin = Date.parse(expireLe);
  if (Number.isNaN(fin)) return "quelques minutes";
  const min = Math.max(1, Math.round((fin - maintenant) / 60_000));
  const d = new Date(fin);
  return `${min}${NB}min, jusqu'à ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const ERREURS: Record<string, string> = {
  envoi_abandonne: "Envoi abandonné : le fichier n'est jamais arrivé dans le Cloud.",
  annule: "Envoi annulé avant la fin : rien n'a été gardé dans le Cloud.",
  objet_absent: "Fichier absent du stockage : supprime cette ligne.",
  objet_invalide: "Le fichier reçu ne correspondait pas à l'original : rien n'a été gardé.",
  quota_atteint: "Espace Cloud insuffisant : supprime des fichiers pour faire de la place.",
  expire: "Ce fichier a expiré : il a été supprimé du Cloud.",
  pas_disponible: "Ce fichier n'est pas disponible pour l'instant.",
  forbidden: "AETHRYON Cloud est réservé à l'administrateur.",
  cloud_closed: "AETHRYON Cloud n'est pas activé sur ce serveur.",
  rate_limited: "Trop de demandes vers le Cloud : réessaie dans quelques minutes.",
};

export function erreurCloud(code: string | null | undefined, message?: string | null): string {
  if (code && ERREURS[code]) return ERREURS[code].replace(/ :/g, `${NB}:`);
  if (code && /^http_5\d\d$/.test(code)) return `Stockage momentanément indisponible${NB}: il sera vérifié de nouveau.`;
  return message || "Opération impossible.";
}

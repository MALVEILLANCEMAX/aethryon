// Offres AETHRYON, modèle V2 décidé par le propriétaire : SOURCE UNIQUE de leur affichage (accueil › Tarifs, espace ›
// Abonnement). Aucun prix n'est écrit ailleurs dans le site.
//
// - Gratuit 0 € : l'offre RÉELLE d'aujourd'hui. Quota et simultanéité lus dans /api/config quand la page les a.
// - « Premium » 5 € par an (identifiant interne : annuel ; renouvelé automatiquement, résiliable en ligne) et « Premium à
//   vie » 20 € (identifiant : vie ; payé une fois, sans renouvellement, option secondaire, VITE_OFFRE_VIE) : MÊMES
//   limites, seule la façon de payer change. Prix TTC fixés par le propriétaire ; quand la vente
//   est ouverte, le prix affiché est celui que Stripe facturera (lu par le serveur). Limites : celles d'account
//   (account/src/plans.ts, mêmes valeurs, vérifié par un essai).
// - Aucun crédit, aucune offre mensuelle, rien d'« illimité ». « À vie » = pour la durée de vie du service, aux limites
//   affichées : ni stockage, ni trafic, ni calcul illimités, ni fonctions futures promises.
//
// Visibilité (VITE_OFFRES, argument OFFRES de web/Dockerfile, réglage de deploy-web.sh) :
//   « reelles » (défaut) : seulement l'offre réelle ;
//   « apercu » : les trois offres, payantes marquées « Bientôt », « Me prévenir » ;
//   « vente » : les trois offres À VENDRE ; « S'abonner » / « Acheter » mènent au récapitulatif légal. Jamais en production sans la
//   décision du propriétaire (juriste, prestataire, informations légales : docs/FACTURATION.md).

import { LEGAL } from "./legal.tsx";

export type PlanId = "free" | "annuel" | "vie";
export type PaidPlanId = Exclude<PlanId, "free">;

const MODE = import.meta.env.VITE_OFFRES as string | undefined;
export const OFFRES_MODE: "reelles" | "apercu" | "vente" = MODE === "apercu" ? "apercu" : MODE === "vente" ? "vente" : "reelles";
/** Libellé du lien de navigation : une offre (« Tarif ») ou trois (« Tarifs »). */
export const TARIFS_LABEL = OFFRES_MODE === "reelles" ? "Tarif" : "Tarifs";
/** « Premium à vie » proposée (option secondaire) : VITE_OFFRE_VIE, argument OFFRE_VIE de web/Dockerfile ; « 0 » la
 *  masque (sa vente se ferme côté serveur par BILLING_OFFRE_VIE=0). Un compte qui l'a déjà la voit toujours. */
export const LIFETIME_OFFERED = (import.meta.env.VITE_OFFRE_VIE as string | undefined) !== "0";
/** Page publique /premium : seulement quand les offres payantes sont montrées (aperçu ou vente). */
export const PREMIUM_PAGE = OFFRES_MODE !== "reelles";

export interface PlanLimits {
  daily: number;
  /** Plafond sur 30 jours glissants ; null : aucun en plus du quota quotidien. */
  monthly: number | null;
  maxActive: number;
  /** Tools : minutes d'export vidéo par jour (pondérées par le coût : 4K ×3,5, 720p ×0,65, GIF ×0,55 ; son : 0). */
  exportMinutes: number;
  savedMax: number;
  /** Historique gardé (jours). */
  historyDays: number;
}

export interface OfferPlan {
  id: PlanId;
  name: string;
  /** Prix TTC (€) fixé par le propriétaire ; remplacé par le prix réel lu chez Stripe quand la vente est ouverte. */
  price: number;
  /** none : gratuit ; year : par an, renouvelé ; once : une seule fois. */
  billing: "none" | "year" | "once";
  limits: PlanLimits;
}

// Bibliothèque : elle n'existe que dans le bot Discord, où les limites de Gratuit s'appliquent à toutes les offres ; le
// même plafond pour tous, donc aucune ligne « Bibliothèque » dans les offres (account/src/plans.ts, mêmes valeurs).
const PAID: PlanLimits = { daily: 40, monthly: 600, maxActive: 2, exportMinutes: 120, savedMax: 200, historyDays: 365 };

export const PLANS: readonly OfferPlan[] = [
  { id: "free", name: "Gratuit", price: 0, billing: "none", limits: { daily: 10, monthly: null, maxActive: 1, exportMinutes: 30, savedMax: 200, historyDays: 90 } },
  { id: "annuel", name: "Premium", price: 5, billing: "year", limits: PAID },
  { id: "vie", name: "Premium à vie", price: 20, billing: "once", limits: PAID },
];

export const planById = (id: PlanId) => PLANS.find((p) => p.id === id) ?? PLANS[0]!;
/** Offres PROPOSÉES (cartes, comparatif) : Premium à vie seulement si LIFETIME_OFFERED. */
export const OFFERED_PLANS: readonly OfferPlan[] = PLANS.filter((p) => p.id !== "vie" || LIFETIME_OFFERED);
/** Titre de l'offre annuelle et de sa page (/premium). */
export const PREMIUM_TITLE = "AETHRYON Premium";
/** La phrase sous « Passer à Premium » : renouvellement, résiliation, accès gardé. */
export const PREMIUM_RENEW_LINE = "Renouvellement automatique chaque année, à la même date. Résiliable à tout moment depuis ton espace : ton accès reste ouvert jusqu'à la fin de l'année payée.";

/** La limite d'export de Tools s'applique-t-elle aujourd'hui ? Seulement si le serveur l'annonce (/api/config,
 *  quotas.exportMinutes) : tant qu'elle est coupée, aucune ligne « export » n'est montrée, ni pour Gratuit (ce serait
 *  une limite qui n'existe pas) ni pour les offres payantes (ce serait un avantage qui n'en est pas un). */
// Avant la réponse du serveur (HTML pré-rendu, premier rendu) : la valeur attendue dans ce mode — la vente ouverte
// applique les offres (PLANS_ACTIVE=1, deploy-vente.sh), donc la limite ; sinon, non. Aucune ligne n'apparaît ni ne
// disparaît à l'arrivée de /api/config (CLS nul) quand le serveur est réglé comme prévu.
export const exportLimitApplies = (q: { exportMinutes?: number | null } | undefined) => (q ? typeof q.exportMinutes === "number" : OFFRES_MODE === "vente");

/** Lignes visibles des offres, d'après ce que le serveur applique (voir exportLimitApplies). */
export const visibleRows = (q: { exportMinutes?: number | null } | undefined) =>
  FEATURE_ROWS.filter((r) => r.id !== "export" || exportLimitApplies(q));

/** « 5 € », « 20 € », « 4,99 € ». */
export const formatEuros = (v: number) => `${v.toFixed(2).replace(".", ",").replace(/,00$/, "")} €`;
const fmtInt = (n: number) => n.toLocaleString("fr-FR").replace(/ | /g, " ");

/** Période sous le prix, et la phrase qui dit comment on paie (jamais cachée). */
export const PERIOD: Record<OfferPlan["billing"], string> = { none: "pour toujours", year: "par an", once: "une seule fois" };
export const HOW: Record<OfferPlan["billing"], string> = {
  none: "Sans carte bancaire.",
  year: "Renouvelé automatiquement chaque année. Résiliable en ligne à tout moment.",
  once: "Un seul paiement. Aucun abonnement, aucun renouvellement.",
};

/** Lignes des offres (billets : les trois premières lignes « card » visibles ; comparatif replié : toutes les visibles). */
export interface FeatureRow { id: string; label: string; value: (p: OfferPlan) => string; card?: true }
export const FEATURE_ROWS: readonly FeatureRow[] = [
  { id: "conversions", label: "Conversions", value: (p) => `${fmtInt(p.limits.daily)} par jour`, card: true },
  { id: "export", label: "Export vidéo dans Tools", value: (p) => `${fmtInt(p.limits.exportMinutes)} min par jour`, card: true },
  { id: "parallel", label: "En même temps", value: (p) => `${p.limits.maxActive} à la fois`, card: true },
  { id: "month", label: "Sur 30 jours", value: (p) => (p.limits.monthly ? `jusqu'à ${fmtInt(p.limits.monthly)} conversions` : "le quota du jour, chaque jour") },
  { id: "history", label: "Historique", value: (p) => (p.limits.historyDays === 365 ? "1 an" : `${p.limits.historyDays} jours`), card: true },
  { id: "tools", label: "Outils et qualité", value: () => "tous, en qualité maximale disponible" },
  { id: "files", label: "Fichiers sur le serveur", value: () => "effacés 1 à 6 h après, jamais stockés" },
];

/** Ce que veut dire « à vie », dit avant tout achat. */
export const LIFETIME_LINE = "« Premium à vie » : ces limites pour la durée de vie du service, liées à ton compte. Ni stockage, ni trafic, ni calcul illimités ; les fonctions futures ne sont pas promises.";
/** Règle de Discord (Developer Policy, parité Premium Apps) : aucun avantage payant dans le bot. */
export const DISCORD_LINE = "Dans le bot Discord, les limites de Gratuit s'appliquent à toutes les offres.";
/** Le même compte partout : les droits sont décidés par le serveur, pas par l'appareil. */
export const EVERYWHERE_LINE = "Une offre par compte, la même sur le web, Tools, l'extension et l'iPhone.";

/** Mention de TVA à côté des prix (lib/legal.tsx, champ « tva », confirmé par le propriétaire : en franchise,
 *  « TVA non applicable, article 293 B du code général des impôts ») ; « Prix TTC » tant qu'elle n'est pas fournie. */
export const VAT_NOTE = LEGAL.tva.value ?? "Prix TTC";
/** Avant le paiement (L221-14) : moyens de paiement et restriction de livraison, dits dès le début de la commande. */
export const PAY_LINE = "Paiement par carte bancaire, sur une page sécurisée de Stripe. Offres réservées aux résidents de France métropolitaine.";

/** Mentions vraies quand la vente est ouverte (mode « vente »). */
export const REASSURANCES_VENTE: readonly { icon: "card" | "repeat" | "trash" | "lock"; title: string; text: string }[] = [
  { icon: "lock", title: "Paiement par Stripe", text: "Ta carte n'est jamais vue par AETHRYON." },
  { icon: "repeat", title: "Premium résiliable en ligne", text: "À tout moment, actif jusqu'à la fin de l'année payée." },
  ...(LIFETIME_OFFERED ? [{ icon: "card" as const, title: "Premium à vie : un seul paiement", text: "Jamais d'autre prélèvement." }] : []),
  { icon: "trash", title: "Rétractation 14 jours", text: "Remboursement intégral, depuis ton espace." },
];

/** Mentions vraies aujourd'hui (aucune ne parle de paiement : il n'y en a pas). */
export const REASSURANCES: readonly { icon: "card" | "repeat" | "trash" | "lock"; title: string; text: string }[] = [
  { icon: "card", title: "Aucune carte bancaire", text: "Rien n'est demandé ni enregistré." },
  { icon: "repeat", title: "Aucun abonnement en cours", text: "Rien à résilier." },
  { icon: "trash", title: "Compte supprimable", text: "Depuis ton espace, quand tu veux." },
  { icon: "lock", title: "Connexion simple", text: "Google en un clic, ou ton adresse e-mail." },
];

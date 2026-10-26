// Offres AETHRYON, modèle V2 décidé par le propriétaire (2026-10-15, docs/FACTURATION.md) : Gratuit 0 €, Annuel 5 € par
// an (renouvelé automatiquement, résiliable en ligne), À vie 20 € payés une fois (aucun renouvellement). Prix TTC, fixés
// par le propriétaire : ce module ne les change pas, il ne fait que les nommer. Ni crédits, ni offre mensuelle, ni prix
// à la conversion.
//
// Limites : calculées dans docs/COUTS.md à partir des mesures de production (temps processeur par opération, mémoire,
// capacité de ytapi) ; elles protègent la CAPACITÉ et l'équité, le coût en argent d'un abonné au plafond restant faible
// devant ce qu'il paie (COUTS.md §10). Rien d'illimité. Gratuit = l'offre réelle d'aujourd'hui (rien ne lui est retiré)
// plus une limite d'export de Tools, nouvelle, qui ferme le risque mesuré (COUTS.md §5). Annuel et À vie donnent les
// MÊMES limites : seule la façon de payer change. À vie ne promet ni stockage, ni trafic, ni calcul illimités, ni les
// fonctions futures, ni des services tiers pour toujours : ce sont les limites ci-dessous, pour la durée de vie du
// service (CGV). Affichage : web/src/lib/offres.ts (mêmes valeurs, vérifiées par un essai).
//
// Budget YouTube (Go par mois) : appliqué SEULEMENT si des proxys payants deviennent nécessaires (youtubeBudgetActive).

export type PlanId = "free" | "annuel" | "vie";
export type PaidPlanId = Exclude<PlanId, "free">;

export interface PlanLimits {
  /** Conversions par jour (remise à zéro à minuit, heure de Paris) et plafond sur 30 jours glissants (null : aucun). */
  daily: number;
  monthly: number | null;
  /** Conversions et exports simultanés. */
  maxActive: number;
  /** Tools : minutes d'export vidéo par jour, pondérées par le coût mesuré (exportWeight) ; le son ne compte pas. */
  exportMinutesDaily: number;
  /** Plus grande qualité vidéo servie (côté court de l'image), quand la plateforme la propose. */
  maxQuality: 1080 | 1440 | 2160;
  /** Débit MP3 le plus élevé (kbit/s). */
  maxBitrate: 192 | 320;
  /** Taille maximale d'un fichier livré ou importé (Mo) ; au-delà : refus clair, jamais de fichier tronqué. */
  maxFileMb: number;
  /** Durée max d'un extrait (s), d'un GIF (s), d'un export vidéo de Tools (s). */
  clipMaxS: number;
  gifMaxS: number;
  exportMaxS: number;
  /** Bibliothèque et historique. */
  savedMax: number;
  historyDays: number;
  /** Budget YouTube (Go par mois), appliqué seulement si des proxys payants deviennent nécessaires. */
  youtubeGbMonthly: number;
}

export interface Plan {
  id: PlanId;
  name: string;
  /** Prix TTC fixé par le propriétaire (€) ; jamais facturé tant que BILLING=off. Le prix FACTURÉ est celui lu chez Stripe. */
  priceEur: number;
  /** none : gratuit ; year : abonnement annuel renouvelé automatiquement ; once : paiement unique, sans renouvellement. */
  billing: "none" | "year" | "once";
  limits: PlanLimits;
}

const PAID_LIMITS: PlanLimits = {
  daily: 40, monthly: 600, maxActive: 2, exportMinutesDaily: 120, maxQuality: 2160, maxBitrate: 320, maxFileMb: 1500,
  // Budget YouTube : 0,15 Go par mois (≈ 5 MP4 YouTube moyens). Avec des proxys à 3 $/Go, il coûterait ≈ 0,41 € par mois,
  // déjà la totalité du net d'Annuel (4,64 € par an) : il n'existe que pour borner le pire, jamais pour être atteint.
  // Bibliothèque : elle n'existe que dans le bot Discord, où les limites de Gratuit s'appliquent à toutes les offres
  // (règle de Discord sur les avantages payants) : même plafond pour tous (discord-library.ts, MAX_SAVED).
  clipMaxS: 180, gifMaxS: 30, exportMaxS: 900, savedMax: 200, historyDays: 365, youtubeGbMonthly: 0.15,
};

export const PLANS: Readonly<Record<PlanId, Plan>> = {
  free: { id: "free", name: "Gratuit", priceEur: 0, billing: "none", limits: {
    daily: 10, monthly: null, maxActive: 1, exportMinutesDaily: 30, maxQuality: 2160, maxBitrate: 320, maxFileMb: 1500,
    clipMaxS: 180, gifMaxS: 30, exportMaxS: 900, savedMax: 200, historyDays: 90, youtubeGbMonthly: 0.05 } },
  // Noms montrés (2026-10-21) : « Premium » (5 € par an) et « Premium à vie » (20 € une fois) ; identifiants internes
  // inchangés (annuel, vie : base, Stripe, URL), aucune migration.
  annuel: { id: "annuel", name: "Premium", priceEur: 5, billing: "year", limits: PAID_LIMITS },
  vie: { id: "vie", name: "Premium à vie", priceEur: 20, billing: "once", limits: PAID_LIMITS },
};

export const PAID_PLANS: readonly PaidPlanId[] = ["annuel", "vie"];
export const isPaidPlan = (v: unknown): v is PaidPlanId => v === "annuel" || v === "vie";

/** D'où vient un droit : paiement web (Stripe), abonnement Discord (Premium Apps, non branché), ou attribution manuelle
 *  par un administrateur (tests, partenaires ; journalisée). Un seul compte AETHRYON : web, Tools, extension, Discord et
 *  raccourci iPhone partagent les mêmes droits, décidés par ce serveur. */
export type EntitlementSource = "discord" | "web" | "manual";

export interface Entitlement {
  plan: PaidPlanId;
  source: EntitlementSource;
  /** Début et fin (ISO) ; fin null = sans fin (À vie, ou abonnement jusqu'à résiliation). */
  startsAt: string;
  endsAt: string | null;
  /** Remboursé, litige perdu ou suspendu par un litige en cours : aucun droit, même avant endsAt. */
  revoked?: boolean;
}

// À vie passe devant Annuel (même limites, mais droit permanent : c'est lui que l'on affiche).
const RANK: Record<PlanId, number> = { free: 0, annuel: 1, vie: 2 };

/** Offre effective d'un compte : la plus haute parmi ses droits ACTIFS à l'instant `now`, sinon Gratuit. */
export function effectivePlan(entitlements: readonly Entitlement[], now = new Date()): Plan {
  let best: PlanId = "free";
  for (const e of entitlements) {
    if (e.revoked) continue;
    if (Date.parse(e.startsAt) > now.getTime()) continue;
    if (e.endsAt !== null && Date.parse(e.endsAt) <= now.getTime()) continue;
    if (RANK[e.plan] > RANK[best]) best = e.plan;
  }
  return PLANS[best];
}

/** Correspondance SKU Discord → offre (Premium Apps ; non branché, docs/ABONNEMENTS.md §4). */
export function planForSku(skuId: string, skus: { annuel?: string | null; vie?: string | null }): PaidPlanId | null {
  if (skus.vie && skuId === skus.vie) return "vie";
  if (skus.annuel && skuId === skus.annuel) return "annuel";
  return null;
}

/** Droit tiré d'un entitlement Discord (événements ENTITLEMENT_CREATE / UPDATE / DELETE, ou interaction.entitlements). */
export function fromDiscordEntitlement(e: { sku_id: string; starts_at?: string | null; ends_at?: string | null; deleted?: boolean },
  skus: { annuel?: string | null; vie?: string | null }): Entitlement | null {
  const plan = planForSku(e.sku_id, skus);
  if (!plan) return null;
  return { plan, source: "discord", startsAt: e.starts_at ?? new Date(0).toISOString(), endsAt: e.ends_at ?? null, revoked: !!e.deleted };
}

/** Budget YouTube : n'agit que si des proxys payants sont nécessaires (réglage du Control Center, faux aujourd'hui). */
export function youtubeAllowed(plan: Plan, usedGbThisMonth: number, nextFileGb: number, youtubeBudgetActive: boolean): boolean {
  return !youtubeBudgetActive || usedGbThisMonth + nextFileGb <= plan.limits.youtubeGbMonthly;
}

/**
 * Poids d'une minute d'export de Tools, relatif à une minute de vidéo 1080p « Standard » (≈ 0,52 CPU/s mesurés,
 * COUTS.md §2) : 720p et moins ×0,65, 4K ×3,5, GIF ×0,55 ; son, aperçu et échantillon de 2 s : 0 (≈ 0,01 CPU/s).
 * La compression suit la hauteur de la source (borne haute : elle réduit souvent l'image).
 */
export function exportWeight(op: string, outHeight: number | null): number {
  if (op === "audio" || op === "apercu" || op === "echantillon") return 0;
  if (op === "gif") return 0.55;
  const h = outHeight ?? 1080;
  return h >= 1800 ? 3.5 : h <= 720 ? 0.65 : 1;
}

/** Minutes d'export décomptées : durée produite (passage ÷ vitesse) × poids ; arrondi au dixième supérieur. */
export function exportMinutes(op: string, outSeconds: number, outHeight: number | null): number {
  const w = exportWeight(op, outHeight);
  if (!w || !(outSeconds > 0)) return 0;
  return Math.ceil((outSeconds / 60) * w * 10) / 10;
}

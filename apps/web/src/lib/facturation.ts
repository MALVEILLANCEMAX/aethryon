// Facturation V2 (account/src/facturation.ts, docs/FACTURATION.md) : état des contrats (Premium « annuel », Premium à
// vie « vie ») et actions.
// Aucune donnée de carte ne passe par le site : le paiement, le moyen de paiement et les factures sont des pages
// hébergées par Stripe. L'adresse de retour du paiement n'est jamais une preuve : le site demande au serveur de relire
// la session chez Stripe.
import { api } from "./api.ts";
import type { PaidPlanId, PlanId } from "./offres.ts";
import { invalidate } from "./store.ts";

export type PaidPlan = PaidPlanId;
export interface BillingPrice { montant: number; devise: string; type: "annuel" | "unique" }
export interface BillingState {
  /** Paiement ouvert sur ce serveur (BILLING=test ou live). */
  disponible: boolean;
  /** Nouveaux achats possibles (absent : ancien serveur, comme disponible). */
  vente?: boolean;
  mode: "test" | "live" | null;
  /** Codes promo acceptés sur la page de paiement (BILLING_PROMO_CODES ; absent : ancien serveur). */
  codesPromo?: boolean;
  offre: { id: PlanId; nom: string };
  /** Prix RÉELS lus chez Stripe (centimes TTC) ; null : vente de l'offre fermée. */
  prix: Record<PaidPlan, BillingPrice | null>;
  abonnement: null | {
    /** Référence du contrat (identifiant de l'abonnement), pour la résiliation en ligne. */
    reference: string;
    statut: string;
    etat: "actif" | "resilie" | "impaye" | "en_attente" | "termine";
    renouvellement: string | null;
    fin: string | null;
    /** Renouvellement arrêté parce que le compte a acheté Premium à vie. */
    arretParVie: boolean;
  };
  vie: null | { reference: string; achete: string; montant: number; devise: string; etat: "actif" | "suspendu" | "rembourse" | "retire" };
  suspendu: "litige" | "remboursement" | null;
  /** Rétractation possible : contrat et date limite (14 jours), sinon null. */
  retractation: null | { contrat: PaidPlan; jusqua: string };
}
export interface Facture { id: string; numero: string | null; date: string | null; montant: number; devise: string; statut: string | null; lien: string | null; pdf: string | null; objet: string }

export const BILLING_URL = "/api/facturation";

const refresh = () => invalidate(BILLING_URL, "/api/me", "/api/abonnement", "/api/facturation/factures", "/api/outils/medias");

/** Montant en centimes → « 5,00 € ». */
export const money = (cents: number, devise = "eur") => new Intl.NumberFormat("fr-FR", { style: "currency", currency: devise.toUpperCase() }).format(cents / 100);
/** Date ISO → « 15 novembre 2026 ». */
export const dayLong = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "Europe/Paris" }).format(new Date(iso)) : "—");

/** Page de paiement Stripe : demande expresse de démarrage immédiat et version des CGV acceptées (null : non cochée). */
export async function startCheckout(offre: PaidPlan, executionImmediate: boolean, cgv: string | null): Promise<string> {
  const r = await api<{ url: string }>("/api/facturation/paiement", { method: "POST", body: { offre, executionImmediate, ...(cgv ? { cgv } : {}) } });
  return r.url;
}
export async function confirmReturn(session: string): Promise<BillingState> {
  const r = await api<BillingState>("/api/facturation/retour", { method: "POST", body: { session } });
  refresh();
  return r;
}
/** Portail client de Stripe : « accueil » (Gérer mon abonnement) ou un lien direct. */
export async function openPortal(action: "accueil" | "paiement" | "factures" | "resilier"): Promise<string> {
  return (await api<{ url: string }>("/api/facturation/portail", { method: "POST", body: { action } })).url;
}
export async function resume(): Promise<BillingState> {
  const r = await api<BillingState>("/api/facturation/reprendre", { method: "POST" });
  refresh();
  return r;
}
export async function terminate(): Promise<BillingState> {
  const r = await api<BillingState>("/api/facturation/resilier", { method: "POST", body: { confirme: true } });
  refresh();
  return r;
}
export async function withdraw(contrat: PaidPlan): Promise<BillingState> {
  const r = await api<BillingState>("/api/facturation/retracter", { method: "POST", body: { confirme: true, contrat } });
  refresh();
  return r;
}

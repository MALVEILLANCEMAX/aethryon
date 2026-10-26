// Facturation sur le site, modèle V2 (docs/FACTURATION.md) : Annuel 5 € par an (abonnement Stripe Billing, renouvelé
// automatiquement, résiliable en ligne) et À vie 20 € (paiement unique Stripe Checkout, sans renouvellement). Prix fixés
// par le propriétaire ; le montant FACTURÉ est celui du prix Stripe, relu et vérifié (type et intervalle) avant la vente.
// Règles tenues ici :
// - aucune donnée de carte ne passe par AETHRYON ; la clé secrète ne quitte jamais le serveur ;
// - aucun droit payant sans preuve de paiement valide relue chez Stripe (abonnement actif, ou page de paiement
//   « complete » ET « paid », ou « complete » à 0 € par une remise réellement appliquée : code promo de 100 %) ;
//   l'adresse de retour n'est JAMAIS une preuve, le contenu d'un événement non plus ;
// - codes promo (BILLING_PROMO_CODES) : le montant PAYÉ, remise comprise, est celui des e-mails, de l'historique et de
//   tout remboursement ; le renouvellement est annoncé au prix du catalogue (coupons « once ») ;
// - chaque événement s'applique une fois (ytc_billing_event) et dans n'importe quel ordre : tout est relu chez Stripe
//   (syncCustomer) et les droits recalculés depuis l'état réel ; un rapprochement périodique rattrape un webhook manqué ;
// - un seul abonnement en cours ; un seul achat À vie : un second paiement est refusé (base ET Stripe), un doublon né
//   d'une course (deux onglets) est remboursé ; À vie arrête le renouvellement de l'annuel, jamais l'inverse : un droit
//   permanent n'est jamais dégradé automatiquement ;
// - À vie n'est retiré que par un remboursement TOTAL (rétractation, geste) ou un litige PERDU ; un litige en cours le
//   suspend, un litige gagné le rend ;
// - fermé par défaut (BILLING=off) ; mode réel impossible sans la confirmation du propriétaire (config.ts).
//   GET  /api/facturation                 → état (offre, abonnement, achat À vie, prix réels lus chez Stripe)
//   POST /api/facturation/paiement        {offre, executionImmediate, cgv} → {url} page de paiement Stripe
//   POST /api/facturation/retour          {session} → état, après relecture serveur de la session
//   POST /api/facturation/portail         {action: accueil|paiement|factures|resilier} → {url} portail Stripe
//   POST /api/facturation/reprendre       → annule une résiliation demandée (avant l'échéance)
//   POST /api/facturation/resilier        {confirme} → résiliation en ligne de l'annuel (L215-1-1) : fin à l'échéance
//   POST /api/facturation/retracter       {confirme, contrat?} → rétractation sous 14 jours (L221-18, D221-5)
//   GET  /api/facturation/factures        → factures et reçus (liens hébergés par Stripe)
//   POST /api/facturation/stripe          → webhook signé (aucune session, aucun cookie)
import type { Context, Hono } from "hono";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { checkoutSessionParams } from "./checkout-params.ts";
import type { BillingConfig, Config } from "./config.ts";
import { newId, writeTx, type DB } from "./db.ts";
import { err, Limiter, type Vars } from "./http.ts";
import { log } from "./log.ts";
import { effectivePlan, isPaidPlan, PLANS, type PaidPlanId, type PlanId } from "./plans.ts";
import type { AccountMails } from "./mails.ts";
import type { Attachment } from "./mailer.ts";
import { nowIso } from "./time.ts";
import type { UsageService } from "./usage.ts";

export type PaidPlan = PaidPlanId;
export const WEBHOOK_PATH = "/api/facturation/stripe";
export const WEBHOOK_MAX_BYTES = 512 * 1024;

/** Statuts d'un abonnement encore « en cours » : ils bloquent un second paiement. */
const OPEN = new Set(["active", "trialing", "past_due", "unpaid", "paused", "incomplete"]);
/** Statuts qui donnent accès à l'offre (past_due : seulement pendant le délai de grâce). */
const PAYING = new Set(["active", "trialing"]);
/** Litiges en cours (le droit est suspendu) ; « lost » le retire, « won » et « warning_closed » le rendent. */
const DISPUTE_OPEN = new Set(["warning_needs_response", "warning_under_review", "needs_response", "under_review"]);
/** Le renouvellement est confirmé quelques minutes à quelques heures après l'échéance : marge avant de couper. */
const RENEW_MARGIN_MS = 2 * 86_400_000;
/** Délai de rétractation d'un service (Code de la consommation L221-18). */
export const WITHDRAWAL_MS = 14 * 86_400_000;
/** Rappel de reconduction (L215-1) : au plus tôt 3 mois, au plus tard 1 mois avant le terme de la période autorisant le
 *  refus, c'est-à-dire la VEILLE de l'échéance (date limite annoncée : Stripe renouvelle à l'heure anniversaire). Envoyé
 *  entre 60 et 33 jours avant l'échéance, avec une marge si le serveur était arrêté le jour prévu. */
export const NOTICE_MAX_MS = 60 * 86_400_000;
export const NOTICE_MIN_MS = 33 * 86_400_000;
/** Texte de la demande expresse de démarrage immédiat (version enregistrée avec l'accord). v3 (2026-10-16) : la même
 *  case pour les deux offres, avec la reconnaissance qu'exige L221-25 (perte du droit une fois le contrat entièrement
 *  exécuté). */
export const CONSENT_TEXT_VERSION = "v3-2026-10-16";
/** Version des CGV acceptées (case du récapitulatif), la même que web/src/lib/legal.tsx (CGV_VERSION, vérifié par un
 *  essai) ; enregistrée avec la demande expresse. */
export const CGV_VERSION = "1.1";
/** Rétractation : remboursement INTÉGRAL pour les deux offres (décision du 2026-10-16, CGV 8.4) ; AETHRYON renonce à
 *  la part du service déjà fourni que L221-25 lui permettrait de garder pour Annuel. */
export const WITHDRAWAL_FULL_REFUND = true;
/** Offres réservées aux résidents de France métropolitaine (CGV 1.2) : pays de l'adresse de facturation exigée par la
 *  page de paiement, contrôlé ici avant d'ouvrir le droit ; sinon, commande annulée et remboursée. */
export const SALES_COUNTRY = "FR";
/** Une page de paiement vit 30 min (minimum de Stripe) : un lien oublié ne reste pas payable une journée. */
const SESSION_TTL_S = 30 * 60;
/** Fin d'un achat Premium à vie SANS paiement (remise de 100 %) : aucune charge chez Stripe à rembourser ; la fin est un
 *  marqueur local, gardé dans la colonne dispute_status (migration 011, déjà en production, inchangée) : rétractation,
 *  doublon (deux onglets), adresse de facturation hors de France. */
const FREE_END = new Set(["retractation", "doublon", "hors_france"]);

/** Preuve d'un achat Premium à vie dans une session RELUE chez Stripe (calcul pur, testé) : page terminée ET payée ;
 *  ou, sans paiement (no_payment_required), seulement un total de 0 dû à une remise RÉELLEMENT appliquée (code promo de
 *  100 %). Un 0 € sans remise n'ouvre aucun droit. */
export function sessionGrantsLifetime(cs: Pick<Stripe.Checkout.Session, "mode" | "status" | "payment_status" | "amount_total"> & { total_details?: { amount_discount?: number | null } | null }): boolean {
  if (cs.mode !== "payment" || cs.status !== "complete") return false;
  if (cs.payment_status === "paid") return true;
  return cs.payment_status === "no_payment_required" && cs.amount_total === 0 && (cs.total_details?.amount_discount ?? 0) > 0;
}

const dayFr = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "Europe/Paris" });
const momentFr = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Paris" });
export const money = (cents: number, currency: string) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);

/** Part à rembourser après une rétractation : avec demande expresse de démarrage, le temps déjà fourni reste dû
 *  (L221-25, au prorata de la durée du contrat) ; sans elle, tout est remboursé. Calcul pur, testé. */
export function withdrawalRefund(paidCents: number, periodStart: number, periodEnd: number, nowS: number, expressConsent: boolean): number {
  if (!expressConsent) return paidCents;
  const span = Math.max(1, periodEnd - periodStart);
  const used = Math.min(1, Math.max(0, (nowS - periodStart) / span));
  return Math.max(0, Math.round(paidCents * (1 - used)));
}

/** Date limite pour refuser la reconduction (encadré du rappel, L215-1) : la VEILLE du jour de l'échéance, heure de
 *  Paris. Stripe prélève à l'heure anniversaire ; une résiliation faite le jour même, après cette heure, arriverait
 *  trop tard. Calcul pur, testé. */
export function renewalDeadline(periodEndIso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(periodEndIso));
  const [y, m, d] = parts.split("-").map(Number) as [number, number, number];
  // Midi UTC du jour précédent : toujours ce jour-là à Paris, quel que soit le changement d'heure.
  return dayFr.format(new Date(Date.UTC(y, m - 1, d - 1, 12)));
}

export interface SubRow {
  stripe_subscription_id: string; user_id: string; stripe_customer_id: string; plan: "annuel" | null; status: string;
  cancel_at_period_end: number; current_period_start: string | null; current_period_end: string | null; canceled_at: string | null;
  renewal_notice_for: string | null; renewal_notice_at: string | null; confirmed_at: string | null;
  livemode: number; created_at: string; synced_at: string;
}

export interface PurchaseRow {
  stripe_session_id: string; user_id: string; stripe_customer_id: string; payment_intent_id: string | null; plan: "vie" | null;
  amount: number; currency: string; refunded_amount: number; dispute_status: string | null; paid_at: string;
  confirmed_at: string | null; livemode: number; synced_at: string;
}

export class BillingError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

/** Clé d'idempotence d'une MODIFICATION : unique par appel (le SDK la réutilise pour ses propres nouvelles tentatives
 *  réseau). Une clé fixe ferait « rejouer » sans effet une action légitimement répétée (résilier, reprendre,
 *  résilier). Les clés fixes sont réservées à ce qui ne doit JAMAIS se faire deux fois (client, remboursements). */
const once = (op: string) => `${op}-${randomUUID()}`;

/** Droit tiré d'un abonnement annuel (calcul pur, testé) : fin d'accès et révocation, selon le statut RÉEL. */
export function entitlementFor(sub: Pick<SubRow, "status" | "plan" | "current_period_end" | "cancel_at_period_end"> & { current_period_start?: string | null },
  hold: string | null, graceDays: number, now = new Date()): { endsAt: string | null; revoked: boolean } {
  if (hold || !sub.plan || !sub.current_period_end) return { endsAt: null, revoked: true };
  const end = Date.parse(sub.current_period_end);
  if (PAYING.has(sub.status)) {
    // Résilié à l'échéance : accès jusqu'à la fin de la période payée, sans marge ; sinon marge de renouvellement.
    return { endsAt: new Date(sub.cancel_at_period_end ? end : end + RENEW_MARGIN_MS).toISOString(), revoked: false };
  }
  if (sub.status === "past_due") {
    // Paiement de renouvellement refusé : Stripe relance ; l'accès dure jusqu'à la fin du délai de grâce, compté depuis
    // le renouvellement manqué (début de la période impayée).
    const from = sub.current_period_start ? Date.parse(sub.current_period_start) : end;
    const deadline = from + graceDays * 86_400_000;
    return { endsAt: new Date(deadline).toISOString(), revoked: now.getTime() >= deadline };
  }
  // canceled, unpaid, incomplete, incomplete_expired, paused : aucun accès.
  return { endsAt: null, revoked: true };
}

/** Droit tiré d'un achat À vie (calcul pur, testé) : permanent, sauf remboursement total, litige perdu (retiré) ou en
 *  cours (suspendu, rendu s'il est gagné). */
export function purchaseRight(p: Pick<PurchaseRow, "plan" | "amount" | "refunded_amount" | "dispute_status">):
  { revoked: boolean; etat: "actif" | "suspendu" | "rembourse" | "retire" } {
  if (!p.plan) return { revoked: true, etat: "retire" };
  if (p.dispute_status && FREE_END.has(p.dispute_status)) return { revoked: true, etat: "retire" };
  if (p.amount > 0 && p.refunded_amount >= p.amount) return { revoked: true, etat: "rembourse" };
  if (p.dispute_status === "lost") return { revoked: true, etat: "retire" };
  if (p.dispute_status && DISPUTE_OPEN.has(p.dispute_status)) return { revoked: true, etat: "suspendu" };
  return { revoked: false, etat: "actif" };
}

const iso = (s: number | null | undefined) => (s ? new Date(s * 1000).toISOString() : null);
const idOf = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : x?.id ?? null);

export interface PriceView { montant: number; devise: string; type: "annuel" | "unique" }

export interface BillingState {
  disponible: boolean;
  /** Nouveaux achats possibles (facturation ouverte ET ventes ouvertes, BILLING_SALES). */
  vente: boolean;
  mode: "test" | "live" | null;
  /** Codes promo acceptés sur la page de paiement (BILLING_PROMO_CODES). */
  codesPromo: boolean;
  offre: { id: PlanId; nom: string };
  /** Prix RÉELS lus chez Stripe ; null quand la vente de l'offre est fermée (prix absent ou de mauvais type). */
  prix: Record<PaidPlan, PriceView | null>;
  abonnement: null | {
    /** Référence du contrat (identifiant de l'abonnement chez Stripe), demandée par la résiliation en ligne (D215-2). */
    reference: string;
    statut: string;
    etat: "actif" | "resilie" | "impaye" | "en_attente" | "termine";
    renouvellement: string | null;
    fin: string | null;
    /** Renouvellement arrêté parce que le compte a acheté À vie. */
    arretParVie: boolean;
  };
  vie: null | { reference: string; achete: string; montant: number; devise: string; etat: "actif" | "suspendu" | "rembourse" | "retire" };
  suspendu: "litige" | "remboursement" | null;
  /** Rétractation possible (14 jours après la souscription ou l'achat) : contrat concerné et date limite, sinon null. */
  retractation: null | { contrat: PaidPlan; jusqua: string };
}

export class BillingService {
  readonly db: DB;
  readonly cfg: Config;
  readonly b: BillingConfig | null;
  readonly stripe: Stripe | null;
  private usage: UsageService;
  private mails: AccountMails | null;
  private prices = new Map<PaidPlan, { value: PriceView | null; at: number }>();

  constructor(db: DB, cfg: Config, usage: UsageService, stripe: Stripe | null, mails: AccountMails | null = null) {
    this.db = db; this.cfg = cfg; this.b = cfg.billing; this.usage = usage; this.mails = mails;
    this.stripe = cfg.billing ? stripe : null;
  }

  get enabled(): boolean { return !!(this.b && this.stripe); }

  private sdk(): Stripe {
    if (!this.stripe || !this.b) throw new BillingError(404, "billing_closed", "Les offres payantes ne sont pas ouvertes.");
    return this.stripe;
  }

  planOfPrice(id: string | null | undefined): PaidPlan | null {
    if (!this.b || !id) return null;
    return id === this.b.prices.annuel ? "annuel" : id === this.b.prices.vie ? "vie" : null;
  }

  customerOf(userId: string): { stripe_customer_id: string; hold: "litige" | "remboursement" | null } | null {
    return (this.db.prepare("SELECT stripe_customer_id, hold FROM ytc_billing_customer WHERE user_id = ?").get(userId) as
      { stripe_customer_id: string; hold: "litige" | "remboursement" | null } | undefined) ?? null;
  }

  private userOfCustomer(customerId: string): string | null {
    return (this.db.prepare("SELECT user_id FROM ytc_billing_customer WHERE stripe_customer_id = ?").get(customerId) as { user_id: string } | undefined)?.user_id ?? null;
  }

  subscriptions(userId: string): SubRow[] {
    return this.db.prepare("SELECT * FROM ytc_billing_subscription WHERE user_id = ? ORDER BY created_at").all(userId) as unknown as SubRow[];
  }

  purchases(userId: string): PurchaseRow[] {
    return this.db.prepare("SELECT * FROM ytc_billing_purchase WHERE user_id = ? ORDER BY paid_at").all(userId) as unknown as PurchaseRow[];
  }

  /** L'achat À vie qui compte : le plus ancien encore valable, sinon le plus récent. */
  private lifetime(userId: string): PurchaseRow | null {
    const all = this.purchases(userId).filter((p) => p.plan === "vie");
    return all.find((p) => !purchaseRight(p).revoked) ?? all.at(-1) ?? null;
  }

  /** Vrai si le compte a un droit À vie ACTIF, quelle qu'en soit la source (web, manuel, Discord). */
  hasLifetime(userId: string): boolean {
    return this.usage.entitlements(userId).some((e) => e.plan === "vie" && !e.revoked && (e.endsAt === null || Date.parse(e.endsAt) > Date.now()));
  }

  /** L'abonnement qui compte pour l'affichage : le plus récent encore en cours, sinon le plus récent. */
  private current(userId: string): SubRow | null {
    const subs = this.subscriptions(userId);
    return [...subs].reverse().find((s) => OPEN.has(s.status)) ?? subs.at(-1) ?? null;
  }

  // ---- client Stripe ↔ compte ---------------------------------------------------------------------------------------

  async ensureCustomer(user: { id: string; email: string }): Promise<string> {
    const known = this.customerOf(user.id);
    if (known) return known.stripe_customer_id;
    // Créé côté serveur, une fois (clé d'idempotence) ; seule l'adresse e-mail part chez Stripe (reçus, factures).
    const c = await this.sdk().customers.create({ email: user.email, metadata: { aethryon_user: user.id } }, { idempotencyKey: `client-${user.id}` });
    const now = nowIso();
    await writeTx(this.db, () => {
      this.db.prepare("INSERT INTO ytc_billing_customer (user_id, stripe_customer_id, livemode, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO NOTHING")
        .run(user.id, c.id, c.livemode ? 1 : 0, now, now);
    });
    return this.customerOf(user.id)!.stripe_customer_id;
  }

  // ---- paiement ------------------------------------------------------------------------------------------------------

  async checkout(user: { id: string; email: string }, plan: PaidPlan, executionImmediate: boolean, cgv: unknown = null): Promise<{ url: string }> {
    const stripe = this.sdk();
    // Démarrage immédiat : demande EXPRESSE, cochée sur la page récapitulative (L221-25) ; CGV acceptées (case du même
    // récapitulatif, version affichée) ; les deux enregistrées avant le paiement.
    // Ventes fermées (BILLING_SALES=fermees) : aucun nouvel achat ; les contrats en cours ne sont pas touchés.
    if (!this.b!.salesOpen) throw new BillingError(403, "sales_closed", "Les ventes sont fermées pour le moment : ton offre actuelle n'est pas touchée.");
    if (executionImmediate !== true) {
      throw new BillingError(400, "consent_required", "Coche la demande de démarrage immédiat pour continuer.");
    }
    if (typeof cgv !== "string" || !/^\d{1,3}(\.\d{1,3}){0,2}$/.test(cgv)) {
      throw new BillingError(400, "terms_required", "Coche l'acceptation des conditions générales de vente pour continuer.");
    }
    // Les conditions acceptées doivent être celles en vigueur (texte publié par le site, sinon la version du serveur).
    const published = (await this.termsAttachment())?.version ?? CGV_VERSION;
    if (cgv !== published) throw new BillingError(409, "terms_changed", "Les conditions générales de vente viennent de changer : recharge la page pour lire la nouvelle version.");
    // Premium à vie peut être fermé à la vente (BILLING_OFFRE_VIE=0) sans toucher aux achats déjà faits.
    if (plan === "vie" && !this.b!.lifetimeOpen) throw new BillingError(503, "offer_unavailable", "Cette offre n'est pas disponible pour le moment.");
    // Le prix vendu doit être celui de l'offre : récurrent annuel pour Annuel, unique pour À vie ; sinon, vente fermée.
    const price = await this.price(plan, { fresh: true });
    if (!price) throw new BillingError(503, "offer_unavailable", "Cette offre n'est pas disponible pour le moment.");
    if (this.hasLifetime(user.id)) throw new BillingError(409, "already_lifetime", "Ton compte a déjà l'offre Premium à vie : rien à payer de plus.");
    if (plan === "annuel" && this.subscriptions(user.id).some((s) => OPEN.has(s.status))) {
      throw new BillingError(409, "already_subscribed", "Un abonnement Premium est déjà en cours sur ce compte.");
    }
    const customer = await this.ensureCustomer(user);
    // Vérification chez Stripe aussi : un webhook manqué ou une autre fenêtre ne doit pas ouvrir un second contrat.
    await this.syncCustomer(customer, { userHint: user.id });
    if (this.hasLifetime(user.id)) throw new BillingError(409, "already_lifetime", "Ton compte a déjà l'offre Premium à vie : rien à payer de plus.");
    if (plan === "annuel" && this.subscriptions(user.id).some((s) => OPEN.has(s.status))) {
      throw new BillingError(409, "already_subscribed", "Un abonnement Premium est déjà en cours sur ce compte.");
    }
    await writeTx(this.db, () => {
      this.db.prepare("INSERT INTO ytc_billing_consent (id, user_id, kind, text_version, plan, created_at) VALUES (?, ?, 'execution_immediate', ?, ?, ?)")
        .run(newId(), user.id, `${CONSENT_TEXT_VERSION}+cgv-${cgv}`, plan, nowIso());
    });
    const annualOpen = this.subscriptions(user.id).some((s) => PAYING.has(s.status) && !s.cancel_at_period_end);
    // Paramètres EXACTS de la page (checkout-params.ts, partagés avec le banc du mode test réel de Stripe).
    const params = checkoutSessionParams({
      plan, priceId: this.b!.prices[plan], customer, userId: user.id,
      metadata: { aethryon_user: user.id, aethryon_plan: plan, execution_immediate: CONSENT_TEXT_VERSION, cgv },
      publicUrl: this.cfg.publicUrl, expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_S, amountText: money(price.montant, price.devise),
      promoCodes: this.b!.promoCodes, automaticTax: this.b!.automaticTax, requireTerms: this.b!.requireTerms, invoiceOnce: this.b!.invoiceOnce,
      annualOpen,
    });
    const session = await stripe.checkout.sessions.create(params, { idempotencyKey: `paiement-${user.id}-${plan}-${Math.floor(Date.now() / 600_000)}` });
    if (!session.url) throw new BillingError(502, "provider_error", "Le service de paiement n'a pas fourni de page de paiement.");
    log("info", "billing checkout", { user: user.id, plan, mode: this.b!.mode });
    return { url: session.url };
  }

  /** Retour de la page de paiement : la session est RELUE chez Stripe ; elle doit appartenir à ce compte. */
  async confirmReturn(userId: string, sessionId: string): Promise<void> {
    if (!/^cs_(test|live)_[A-Za-z0-9]{8,200}$/.test(sessionId)) throw new BillingError(400, "invalid_request", "Session de paiement invalide.");
    const s = await this.sdk().checkout.sessions.retrieve(sessionId);
    if (s.client_reference_id !== userId) throw new BillingError(404, "not_found", "Session de paiement introuvable.");
    const customer = idOf(s.customer);
    if (customer) await this.syncCustomer(customer, { userHint: userId });
  }

  // ---- état relu chez Stripe -----------------------------------------------------------------------------------------

  /** Relit TOUS les contrats d'un client chez Stripe (abonnements, achats uniques), traite les doublons, arrête le
   *  renouvellement de l'annuel d'un compte À vie, et recalcule les droits du compte. Idempotent : l'appeler deux fois,
   *  ou dans le désordre des événements, donne le même résultat. */
  async syncCustomer(customerId: string, opts: { userHint?: string } = {}): Promise<string | null> {
    const stripe = this.sdk();
    let subs = (await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 })).data;
    let sessions = (await stripe.checkout.sessions.list({ customer: customerId, limit: 100, expand: ["data.payment_intent.latest_charge"] })).data;
    let userId = this.userOfCustomer(customerId);
    if (!userId) {
      // Client inconnu localement : rattaché seulement par la métadonnée posée par CE serveur, à un compte sans client.
      const meta = opts.userHint ?? [...subs.map((s) => s.metadata?.aethryon_user), ...sessions.map((s) => s.metadata?.aethryon_user)].find((x): x is string => !!x) ?? null;
      const exists = meta && this.db.prepare('SELECT 1 FROM "user" WHERE id = ?').get(meta);
      if (!meta || !exists || this.customerOf(meta)) { log("warn", "billing unknown customer", { customer: customerId }); return null; }
      const now = nowIso();
      await writeTx(this.db, () => {
        this.db.prepare("INSERT INTO ytc_billing_customer (user_id, stripe_customer_id, livemode, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
          .run(meta, customerId, this.b!.mode === "live" ? 1 : 0, now, now);
      });
      userId = this.userOfCustomer(customerId);
      if (!userId) return null;
    }
    const uid = userId;

    // Commandes hors de France métropolitaine : annulées et remboursées AVANT tout calcul de droit.
    if (await this.refuseForeign(uid, sessions, subs)) {
      subs = (await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 })).data;
      sessions = (await stripe.checkout.sessions.list({ customer: customerId, limit: 100, expand: ["data.payment_intent.latest_charge"] })).data;
    }

    // Achats À vie PROUVÉS (session relue ici : payée, ou 0 € par une remise réelle, sessionGrantsLifetime) et leur état
    // (remboursement, litige, fin d'un achat sans paiement).
    const mine = (cs: Stripe.Checkout.Session) => !cs.metadata?.aethryon_user || cs.metadata.aethryon_user === uid;
    const paid: PurchaseRow[] = [];
    for (const cs of sessions) if (sessionGrantsLifetime(cs) && mine(cs)) paid.push(await this.purchaseOf(cs));
    // Doublons (deux onglets payés) : le plus ancien achat valable reste, les autres sont remboursés tout de suite ; un
    // doublon sans paiement (remise de 100 %) n'a rien à rembourser : il est seulement clos (marqueur « doublon »).
    const valid = paid.filter((p) => p.plan === "vie" && !purchaseRight(p).revoked).sort((a, b) => a.paid_at.localeCompare(b.paid_at) || a.stripe_session_id.localeCompare(b.stripe_session_id));
    if (valid.length > 1) {
      const closed = new Set<string>();
      let refunded = false;
      for (const extra of valid.slice(1)) {
        if (!extra.payment_intent_id && extra.amount === 0) { closed.add(extra.stripe_session_id); continue; }
        await this.refundPurchase(extra, "duplicate", `remb-doublon-${extra.payment_intent_id ?? extra.stripe_session_id}`);
        refunded = true;
      }
      if (refunded) {
        sessions = (await stripe.checkout.sessions.list({ customer: customerId, limit: 100, expand: ["data.payment_intent.latest_charge"] })).data;
        paid.length = 0;
        for (const cs of sessions) if (sessionGrantsLifetime(cs) && mine(cs)) paid.push(await this.purchaseOf(cs));
      }
      for (const p of paid) if (closed.has(p.stripe_session_id)) p.dispute_status = "doublon";
    }
    const lifetime = paid.find((p) => p.plan === "vie" && !purchaseRight(p).revoked) ?? null;

    // Abonnements : doublons résiliés et remboursés ; un annuel souscrit APRÈS l'achat À vie est un doublon (remboursé) ;
    // un annuel antérieur garde sa période payée mais ne se renouvelle plus.
    let changed = false;
    const paying = subs.filter((s) => s.status === "active" || s.status === "trialing" || s.status === "past_due").sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
    for (const [i, s] of paying.entries()) {
      if (lifetime && s.created * 1000 > Date.parse(lifetime.paid_at)) { await this.cancelDuplicate(s); changed = true; continue; }
      if (i > 0) { await this.cancelDuplicate(s); changed = true; continue; }
      if (lifetime && !s.cancel_at_period_end && !s.cancel_at) {
        await stripe.subscriptions.update(s.id, { cancel_at_period_end: true, metadata: { ...s.metadata, aethryon_arret: "vie" } }, { idempotencyKey: `vie-arret-renouvellement-${s.id}` });
        changed = true;
        log("info", "billing annual renewal stopped by lifetime", { user: uid, subscription: s.id });
      }
    }
    if (changed) subs = (await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 })).data;

    // Résiliations programmées découvertes par CETTE relecture (espace, portail Stripe…) : un accusé chacune (L215-1-1),
    // décidé dans la transaction (une seule relecture voit le passage de « non » à « oui »). Pas pour l'arrêt automatique
    // du renouvellement après un achat À vie (aucune notification du client).
    const terminated: Stripe.Subscription[] = [];
    await writeTx(this.db, () => {
      for (const s of subs) if (this.upsertSubSync(uid, customerId, s) && PAYING.has(s.status) && s.metadata?.aethryon_arret !== "vie") terminated.push(s);
      for (const p of paid) this.upsertPurchaseSync(uid, customerId, p);
      this.recomputeSync(uid);
    });
    await this.confirmNew(uid);
    this.acknowledgeTerminations(uid, terminated);
    return uid;
  }

  /** Accusé de résiliation (L215-1-1, D215-3) : date de fin et effets, sur support durable. */
  private acknowledgeTerminations(userId: string, subs: Stripe.Subscription[]): void {
    if (!this.mails || !subs.length) return;
    const user = this.db.prepare('SELECT email FROM "user" WHERE id = ?').get(userId) as { email: string } | undefined;
    if (!user) return;
    for (const s of subs) {
      const row = this.subscriptions(userId).find((x) => x.stripe_subscription_id === s.id);
      const fin = row?.current_period_end ?? null;
      this.mails.billingTermination(user.email, { plan: PLANS.annuel.name, endsAt: fin ? dayFr.format(new Date(fin)) : "la fin de la période payée", at: momentFr.format(new Date()), reference: s.id });
      log("info", "billing termination", { user: userId, subscription: s.id });
    }
  }

  /** Achat tiré d'une session payée : prix vérifié (lignes de la session), montant, remboursements, litige. */
  private async purchaseOf(cs: Stripe.Checkout.Session): Promise<PurchaseRow> {
    const stripe = this.sdk();
    const known = this.db.prepare("SELECT plan, dispute_status FROM ytc_billing_purchase WHERE stripe_session_id = ?").get(cs.id) as { plan: "vie" | null; dispute_status: string | null } | undefined;
    let plan: "vie" | null = known ? known.plan : null;
    if (!known) {
      const items = await stripe.checkout.sessions.listLineItems(cs.id, { limit: 5 });
      plan = items.data.length === 1 && this.planOfPrice(items.data[0]?.price?.id) === "vie" ? "vie" : null;
    }
    const pi = (typeof cs.payment_intent === "object" ? cs.payment_intent : null) as Stripe.PaymentIntent | null;
    const piId = idOf(cs.payment_intent as string | { id: string } | null);
    const charge = (pi && typeof pi.latest_charge === "object" ? pi.latest_charge : null) as Stripe.Charge | null;
    let dispute: string | null = null;
    if (charge?.disputed) {
      const d = await stripe.disputes.list({ charge: charge.id, limit: 1 });
      dispute = d.data[0]?.status ?? "needs_response";
    }
    // Achat sans paiement (remise de 100 %) : aucune charge chez Stripe. Sa fin éventuelle est un marqueur local, gardé ;
    // une adresse de facturation hors de France le clôt d'emblée (aucun droit, même un instant).
    if (!charge && !piId && (cs.amount_total ?? 0) === 0) {
      const country = cs.customer_details?.address?.country ?? null;
      dispute = known?.dispute_status && FREE_END.has(known.dispute_status) ? known.dispute_status
        : country && country !== SALES_COUNTRY ? "hors_france" : null;
    }
    return {
      stripe_session_id: cs.id, user_id: "", stripe_customer_id: idOf(cs.customer as string | { id: string } | null) ?? "", payment_intent_id: piId,
      plan, amount: cs.amount_total ?? charge?.amount ?? 0, currency: cs.currency ?? charge?.currency ?? "eur",
      refunded_amount: charge?.amount_refunded ?? 0, dispute_status: dispute,
      paid_at: iso(charge?.created ?? cs.created) ?? nowIso(), confirmed_at: null, livemode: cs.livemode ? 1 : 0, synced_at: nowIso(),
    };
  }

  private async refundPurchase(p: PurchaseRow, reason: "duplicate" | "requested_by_customer", key: string, motif?: string): Promise<number> {
    if (!p.payment_intent_id) return 0;
    const left = p.amount - p.refunded_amount;
    if (left <= 0) return 0;
    await this.sdk().refunds.create({ payment_intent: p.payment_intent_id, reason, ...(motif ? { metadata: { aethryon_motif: motif } } : {}) }, { idempotencyKey: key });
    log("warn", "billing purchase refunded", { session: p.stripe_session_id, reason });
    return left;
  }

  /** Abonnement résilié tout de suite et payé remboursé en totalité : doublon, ou commande hors de France (motif). */
  private async cancelDuplicate(sub: Stripe.Subscription, motif: "doublon" | "hors-france" = "doublon"): Promise<number> {
    const stripe = this.sdk();
    await stripe.subscriptions.cancel(sub.id, { prorate: false, invoice_now: false }, { idempotencyKey: `${motif}-${sub.id}` });
    const invoices = await stripe.invoices.list({ subscription: sub.id, status: "paid", limit: 5 });
    let refunded = 0;
    for (const inv of invoices.data) {
      if (!inv.id) continue;
      const payments = await stripe.invoicePayments.list({ invoice: inv.id, limit: 5 });
      for (const p of payments.data) {
        const pi = idOf(p.payment?.payment_intent as string | { id: string } | undefined);
        const charge = idOf(p.payment?.charge as string | { id: string } | undefined);
        if (!pi && !charge) continue;
        const why = motif === "doublon" ? { reason: "duplicate" as const } : { metadata: { aethryon_motif: "hors_france" } };
        await stripe.refunds.create(pi ? { payment_intent: pi, ...why } : { charge: charge!, ...why }, { idempotencyKey: `remb-${motif}-${p.id}` });
        refunded += inv.amount_paid;
      }
    }
    log("warn", motif === "doublon" ? "billing duplicate subscription cancelled and refunded" : "billing subscription refused: billing country", { subscription: sub.id });
    return refunded;
  }

  /** Offres réservées à la France métropolitaine (CGV 1.2 et 4.2) : une commande payée avec une adresse de facturation
   *  d'un autre pays (page de paiement terminée) est annulée et remboursée en totalité, sans aucun droit ouvert, et le
   *  client en est averti une fois. Idempotent : remboursements et résiliation à clés fixes ; une commande déjà
   *  remboursée ou résiliée n'est plus touchée. Pays absent (jamais avec une adresse exigée) : journalisé, pas refusé. */
  private async refuseForeign(uid: string, sessions: Stripe.Checkout.Session[], subs: Stripe.Subscription[]): Promise<boolean> {
    const stripe = this.sdk();
    let changed = false;
    for (const cs of sessions) {
      if (cs.status !== "complete") continue;
      if (cs.metadata?.aethryon_user && cs.metadata.aethryon_user !== uid) continue;
      const country = cs.customer_details?.address?.country ?? null;
      if (!country) { log("warn", "billing session without billing country", { session: cs.id }); continue; }
      if (country === SALES_COUNTRY) continue;
      const user = this.db.prepare('SELECT email FROM "user" WHERE id = ?').get(uid) as { email: string } | undefined;
      let amount = 0;
      if (cs.mode === "payment" && cs.payment_status === "no_payment_required") {
        // Remise de 100 % : rien à rembourser ; aucun droit (purchaseOf la clôt « hors_france ») ; l'e-mail part à la
        // première relecture seulement (achat encore inconnu ici).
        if (!sessionGrantsLifetime(cs) || this.db.prepare("SELECT 1 FROM ytc_billing_purchase WHERE stripe_session_id = ?").get(cs.id)) continue;
        if (user) this.mails?.billingForeignRefund(user.email, { plan: PLANS.vie.name, amount: money(0, cs.currency ?? "eur"), at: momentFr.format(new Date(cs.created * 1000)), reference: cs.id, free: true });
        log("warn", "billing purchase refused: billing country", { session: cs.id, free: true });
        continue;
      }
      if (cs.mode === "payment") {
        const piId = idOf(cs.payment_intent as string | { id: string } | null);
        const pi = (typeof cs.payment_intent === "object" ? cs.payment_intent : null) as Stripe.PaymentIntent | null;
        const charge = (pi && typeof pi.latest_charge === "object" ? pi.latest_charge : null) as Stripe.Charge | null;
        amount = (cs.amount_total ?? 0) - (charge?.amount_refunded ?? 0);
        if (cs.payment_status !== "paid" || !piId || amount <= 0) continue;
        await stripe.refunds.create({ payment_intent: piId, metadata: { aethryon_motif: "hors_france" } }, { idempotencyKey: `hors-france-${piId}` });
        log("warn", "billing purchase refused: billing country", { session: cs.id });
      } else if (cs.mode === "subscription") {
        const subId = idOf(cs.subscription as string | { id: string } | null);
        const sub = subs.find((x) => x.id === subId);
        if (!sub || !OPEN.has(sub.status)) continue;
        amount = await this.cancelDuplicate(sub, "hors-france");
      } else continue;
      changed = true;
      const plan = cs.mode === "payment" ? PLANS.vie.name : PLANS.annuel.name;
      if (user) this.mails?.billingForeignRefund(user.email, { plan, amount: money(amount, cs.currency ?? "eur"), at: momentFr.format(new Date(cs.created * 1000)), reference: cs.id });
    }
    return changed;
  }

  /** Enregistre l'état relu d'un abonnement ; vrai si une résiliation programmée vient d'apparaître (dans la transaction). */
  private upsertSubSync(userId: string, customerId: string, s: Stripe.Subscription): boolean {
    const item = s.items?.data?.[0];
    const plan = this.planOfPrice(item?.price?.id) === "annuel" ? "annuel" : null;
    const periodEnd = iso(item?.current_period_end);
    const periodStart = iso(item?.current_period_start);
    // Résiliation programmée : à l'échéance (cancel_at_period_end) ou à une date (cancel_at, mode de facturation
    // « flexible » par défaut depuis l'API 2025).
    const scheduledCancel = s.cancel_at_period_end || !!s.cancel_at;
    const end = s.cancel_at ? iso(s.cancel_at) : periodEnd;
    const now = nowIso();
    const prev = this.db.prepare("SELECT cancel_at_period_end AS c FROM ytc_billing_subscription WHERE stripe_subscription_id = ?").get(s.id) as { c: number } | undefined;
    this.db.prepare(
      "INSERT INTO ytc_billing_subscription (stripe_subscription_id, user_id, stripe_customer_id, plan, status, cancel_at_period_end, current_period_start, " +
      "current_period_end, canceled_at, livemode, created_at, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(stripe_subscription_id) DO UPDATE SET user_id = excluded.user_id, plan = excluded.plan, status = excluded.status, " +
      "cancel_at_period_end = excluded.cancel_at_period_end, current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end, " +
      "canceled_at = excluded.canceled_at, synced_at = excluded.synced_at",
    ).run(s.id, userId, customerId, plan, s.status, scheduledCancel ? 1 : 0, periodStart, end, iso(s.canceled_at), s.livemode ? 1 : 0, iso(s.created) ?? now, now);
    return plan !== null && scheduledCancel && prev?.c === 0;
  }

  private upsertPurchaseSync(userId: string, customerId: string, p: PurchaseRow): void {
    this.db.prepare(
      "INSERT INTO ytc_billing_purchase (stripe_session_id, user_id, stripe_customer_id, payment_intent_id, plan, amount, currency, refunded_amount, dispute_status, " +
      "paid_at, livemode, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(stripe_session_id) DO UPDATE SET user_id = excluded.user_id, " +
      "payment_intent_id = excluded.payment_intent_id, refunded_amount = excluded.refunded_amount, dispute_status = excluded.dispute_status, synced_at = excluded.synced_at",
    ).run(p.stripe_session_id, userId, customerId, p.payment_intent_id, p.plan, p.amount, p.currency.slice(0, 3), p.refunded_amount, p.dispute_status, p.paid_at, p.livemode, p.synced_at);
  }

  /** Recalcule les droits « web » du compte depuis ses abonnements et ses achats (dans une transaction). */
  recomputeSync(userId: string, now = new Date()): void {
    const hold = this.customerOf(userId)?.hold ?? null;
    const ts = nowIso();
    const upsert = (externalId: string, plan: PaidPlan | null, startsAt: string, endsAt: string | null, revoked: boolean) => {
      const existing = this.db.prepare("SELECT id, revoked_at FROM ytc_entitlement WHERE source = 'web' AND external_id = ?").get(externalId) as
        { id: string; revoked_at: string | null } | undefined;
      if (!plan) {
        if (existing && !existing.revoked_at) this.db.prepare("UPDATE ytc_entitlement SET revoked_at = ?, updated_at = ? WHERE id = ?").run(ts, ts, existing.id);
        return;
      }
      if (!existing) {
        if (revoked) return; // jamais payé, ou retiré avant d'avoir été accordé : aucune ligne
        // Début : la date de Stripe, jamais après maintenant (léger décalage d'horloge entre Stripe et le serveur).
        this.db.prepare("INSERT INTO ytc_entitlement (id, user_id, plan, source, external_id, starts_at, ends_at, revoked_at, created_at, updated_at) VALUES (?, ?, ?, 'web', ?, ?, ?, NULL, ?, ?)")
          .run(newId(), userId, plan, externalId, startsAt < ts ? startsAt : ts, endsAt, ts, ts);
      } else {
        this.db.prepare("UPDATE ytc_entitlement SET user_id = ?, plan = ?, ends_at = ?, revoked_at = ?, updated_at = ? WHERE id = ?")
          .run(userId, plan, endsAt, revoked ? existing.revoked_at ?? ts : null, ts, existing.id);
      }
    };
    for (const s of this.subscriptions(userId)) {
      const e = entitlementFor(s, hold, this.b?.graceDays ?? 7, now);
      upsert(s.stripe_subscription_id, s.plan, s.created_at, e.endsAt, e.revoked);
    }
    for (const p of this.purchases(userId)) upsert(p.stripe_session_id, p.plan, p.paid_at, null, purchaseRight(p).revoked);
  }

  /** CGV publiées par le site, en texte (dist/legal/cgv.txt, scripts/prerender.mjs), jointes à la confirmation du
   *  contrat : relues au plus toutes les 10 minutes ; la dernière copie valable sert si le site ne répond pas. */
  private termsCache: { at: number; value: { version: string; attachment: Attachment } } | null = null;
  async termsAttachment(): Promise<{ version: string; attachment: Attachment } | null> {
    if (this.termsCache && Date.now() - this.termsCache.at < 10 * 60_000) return this.termsCache.value;
    const url = this.b?.termsUrl ?? `${this.cfg.publicUrl}/legal/cgv.txt`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5_000), redirect: "error" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      const m = /Version (\d{1,3}(?:\.\d{1,3}){0,2})\b/.exec(text.slice(0, 1_000));
      // Texte complet seulement : jamais une page d'attente ni un texte « À compléter ».
      if (!text.startsWith("CONDITIONS GÉNÉRALES DE VENTE") || !m || text.length > 500_000 || /À compléter/i.test(text)) throw new Error("texte inattendu");
      const value = { version: m[1]!, attachment: { filename: `CGV-AETHRYON-v${m[1]}.txt`, contentType: "text/plain; charset=utf-8" as const, content: Buffer.from(text, "utf8") } };
      this.termsCache = { at: Date.now(), value };
      return value;
    } catch (e) {
      log("error", "billing terms unavailable", { err: e instanceof Error ? e.message : "?" });
      return this.termsCache?.value ?? null;
    }
  }

  /** Confirmation du contrat sur support durable (L221-13), une fois par contrat, après la preuve de paiement. */
  private async confirmNew(userId: string): Promise<void> {
    if (!this.mails) return;
    const user = this.db.prepare('SELECT email FROM "user" WHERE id = ?').get(userId) as { email: string } | undefined;
    if (!user) return;
    const ts = nowIso();
    const seller = this.b?.seller ?? null;
    const vat = this.b?.vatMention ?? "TVA non applicable, art. 293 B du CGI";
    // Lu AVANT les réservations : une confirmation réservée part toujours, avec les CGV si le site les a publiées.
    const pending = this.subscriptions(userId).some((s) => !s.confirmed_at && s.plan && PAYING.has(s.status)) ||
      this.purchases(userId).some((p) => !p.confirmed_at && !purchaseRight(p).revoked);
    const terms = pending ? await this.termsAttachment() : null;
    // Réservation atomique (UPDATE … WHERE confirmed_at IS NULL) AVANT l'envoi : deux relectures simultanées (webhook
    // et retour de paiement) n'envoient jamais deux confirmations.
    const claim = (sql: string, id: string) => Number((this.db.prepare(sql).run(ts, id) as { changes: number | bigint }).changes) === 1;
    for (const s of this.subscriptions(userId)) {
      if (s.confirmed_at || !s.plan || !PAYING.has(s.status)) continue;
      if (!claim("UPDATE ytc_billing_subscription SET confirmed_at = ? WHERE stripe_subscription_id = ? AND confirmed_at IS NULL", s.stripe_subscription_id)) continue;
      // Montant PAYÉ (première facture, remise comprise) et prix de renouvellement (catalogue, relu chez Stripe).
      const price = await this.price("annuel");
      const first = await this.firstPayment(s.stripe_subscription_id);
      const catalog = price ? money(price.montant, price.devise) : null;
      this.mails.billingConfirmation(user.email, {
        plan: PLANS.annuel.name, contract: "annuel", amount: first ? money(first.amount, first.currency) : catalog ?? "le prix affiché",
        renewalAmount: catalog, reference: s.stripe_subscription_id,
        at: momentFr.format(new Date(s.created_at)), renewal: s.current_period_end ? dayFr.format(new Date(s.current_period_end)) : null,
        withdrawalUntil: dayFr.format(new Date(Date.parse(s.created_at) + WITHDRAWAL_MS)), seller, vat, terms,
      });
    }
    for (const p of this.purchases(userId)) {
      if (p.confirmed_at || purchaseRight(p).revoked) continue;
      if (!claim("UPDATE ytc_billing_purchase SET confirmed_at = ? WHERE stripe_session_id = ? AND confirmed_at IS NULL", p.stripe_session_id)) continue;
      const list = await this.price("vie");
      this.mails.billingConfirmation(user.email, {
        plan: PLANS.vie.name, contract: "vie", amount: money(p.amount, p.currency), reference: p.stripe_session_id,
        listAmount: list && list.montant > p.amount ? money(list.montant, list.devise) : null,
        at: momentFr.format(new Date(p.paid_at)), renewal: null, withdrawalUntil: dayFr.format(new Date(Date.parse(p.paid_at) + WITHDRAWAL_MS)), seller, vat, terms,
      });
    }
  }

  /** Premier paiement d'un abonnement (montant PAYÉ, remise comprise) : la plus ancienne facture payée. Null si Stripe ne
   *  répond pas (la confirmation part alors avec le prix du catalogue). */
  private async firstPayment(subscriptionId: string): Promise<{ amount: number; currency: string } | null> {
    try {
      const inv = (await this.sdk().invoices.list({ subscription: subscriptionId, status: "paid", limit: 10 })).data.at(-1);
      return inv ? { amount: inv.amount_paid, currency: inv.currency } : null;
    } catch (e) {
      log("warn", "billing first payment unavailable", stripeErr(e));
      return null;
    }
  }

  // ---- résiliation, reprise, rétractation, portail -------------------------------------------------------------------

  /** Reprend un abonnement annuel résilié à l'échéance (avant la fin de la période) ; sans objet avec À vie. */
  async resume(userId: string): Promise<void> {
    if (this.hasLifetime(userId)) throw new BillingError(409, "already_lifetime", "Ton compte a l'offre Premium à vie : l'abonnement annuel n'a plus à se renouveler.");
    const row = this.subscriptions(userId).reverse().find((s) => PAYING.has(s.status) && s.cancel_at_period_end === 1);
    if (!row) throw new BillingError(409, "nothing_to_resume", "Aucune résiliation à annuler.");
    await this.sdk().subscriptions.update(row.stripe_subscription_id, { cancel_at_period_end: false }, { idempotencyKey: once("reprendre") });
    await this.syncCustomer(row.stripe_customer_id);
  }

  /** Résiliation en ligne de l'annuel (L215-1-1, D215-1 à D215-3) : notifiée ici, effet à la fin de la période payée,
   *  accusé de réception par e-mail avec la date de fin — envoyé par la relecture qui constate la résiliation (la même
   *  pour le portail de Stripe), une seule fois. Une nouvelle notification d'un contrat déjà résilié reçoit son accusé. */
  async terminate(user: { id: string; email: string }): Promise<{ fin: string | null }> {
    const row = this.subscriptions(user.id).reverse().find((s) => PAYING.has(s.status) || s.status === "past_due");
    if (!row) throw new BillingError(409, "no_subscription", "Aucun abonnement en cours à résilier.");
    if (!row.cancel_at_period_end) {
      await this.sdk().subscriptions.update(row.stripe_subscription_id, { cancel_at_period_end: true }, { idempotencyKey: once("resilier") });
      await this.syncCustomer(row.stripe_customer_id);
    } else {
      this.mails?.billingTermination(user.email, { plan: PLANS.annuel.name, endsAt: row.current_period_end ? dayFr.format(new Date(row.current_period_end)) : "la fin de la période payée", at: momentFr.format(new Date()), reference: row.stripe_subscription_id });
      log("info", "billing termination", { user: user.id, again: true });
    }
    const fresh = this.subscriptions(user.id).find((s) => s.stripe_subscription_id === row.stripe_subscription_id) ?? row;
    return { fin: fresh.current_period_end };
  }

  /** Contrat qui peut encore être rétracté : souscrit ou acheté il y a moins de 14 jours, le plus récent d'abord. */
  private withdrawable(userId: string, now = Date.now()): { contrat: PaidPlan; at: string } | null {
    const sub = [...this.subscriptions(userId)].reverse().find((s) => OPEN.has(s.status) && now - Date.parse(s.created_at) <= WITHDRAWAL_MS);
    const buy = [...this.purchases(userId)].reverse().find((p) => !purchaseRight(p).revoked && now - Date.parse(p.paid_at) <= WITHDRAWAL_MS);
    const c: { contrat: PaidPlan; at: string }[] = [];
    if (sub) c.push({ contrat: "annuel", at: sub.created_at });
    if (buy) c.push({ contrat: "vie", at: buy.paid_at });
    return c.sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
  }

  /** Rétractation sous 14 jours (L221-18, L221-21, D221-5), sans motif :
   *  - Annuel : abonnement arrêté tout de suite, remboursement de la part non fournie au prorata de l'année (ou de
   *    tout, sans demande expresse de démarrage) ;
   *  - À vie : remboursement INTÉGRAL (aucune règle établie pour un prorata d'une durée indéfinie : choix prudent,
   *    docs/FACTURATION.md §7), droit retiré.
   *  Accusé de réception daté par e-mail. */
  async withdraw(user: { id: string; email: string }, contrat: PaidPlan | null = null): Promise<{ rembourse: number; devise: string }> {
    const stripe = this.sdk();
    const target = this.withdrawable(user.id);
    if (!target || (contrat && contrat !== target.contrat && !this.withdrawableKind(user.id, contrat))) {
      throw new BillingError(409, "withdrawal_expired", "Le délai de rétractation de 14 jours est passé (ou rien n'a été souscrit) : un abonnement annuel reste résiliable, il s'arrêtera à la fin de la période payée.");
    }
    const kind = contrat ?? target.contrat;
    let refunded = 0;
    let currency = "eur";
    let reference = "";
    let concluded = "";
    if (kind === "vie") {
      const p = [...this.purchases(user.id)].reverse().find((x) => !purchaseRight(x).revoked && Date.now() - Date.parse(x.paid_at) <= WITHDRAWAL_MS)!;
      currency = p.currency;
      reference = p.stripe_session_id;
      concluded = momentFr.format(new Date(p.paid_at));
      refunded = await this.refundPurchase(p, "requested_by_customer", `retractation-${p.payment_intent_id ?? p.stripe_session_id}`, "retractation");
      // Achat sans paiement (remise de 100 %) : rien à rembourser, le contrat est clos ici (marqueur local, FREE_END).
      if (!p.payment_intent_id && p.amount === 0) {
        await writeTx(this.db, () => { this.db.prepare("UPDATE ytc_billing_purchase SET dispute_status = 'retractation', synced_at = ? WHERE stripe_session_id = ?").run(nowIso(), p.stripe_session_id); });
      }
      await this.syncCustomer(p.stripe_customer_id);
    } else {
      const row = [...this.subscriptions(user.id)].reverse().find((s) => OPEN.has(s.status) && Date.now() - Date.parse(s.created_at) <= WITHDRAWAL_MS)!;
      reference = row.stripe_subscription_id;
      concluded = momentFr.format(new Date(row.created_at));
      // Demande expresse donnée AVANT la souscription (marge d'une heure : horloges de Stripe et du serveur).
      const before = new Date(Date.parse(row.created_at) + 3_600_000).toISOString();
      const consent = !!this.db.prepare("SELECT 1 FROM ytc_billing_consent WHERE user_id = ? AND kind = 'execution_immediate' AND plan = 'annuel' AND created_at <= ?").get(user.id, before);
      const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
      const item = sub.items.data[0];
      const nowS = Math.floor(Date.now() / 1000);
      const invoices = await stripe.invoices.list({ subscription: sub.id, status: "paid", limit: 10 });
      for (const inv of invoices.data) {
        if (!inv.id || !inv.amount_paid) continue;
        currency = inv.currency;
        const start = inv.period_start ?? item?.current_period_start ?? sub.created;
        const end = item?.current_period_end ?? start + 365 * 86_400;
        const amount = withdrawalRefund(inv.amount_paid, start, end, nowS, consent && !WITHDRAWAL_FULL_REFUND);
        if (amount <= 0) continue;
        const payments = await stripe.invoicePayments.list({ invoice: inv.id, limit: 5 });
        const p = payments.data.find((x) => idOf(x.payment?.payment_intent as string | { id: string } | undefined) || idOf(x.payment?.charge as string | { id: string } | undefined));
        if (!p) continue;
        const pi = idOf(p.payment?.payment_intent as string | { id: string } | undefined);
        const charge = idOf(p.payment?.charge as string | { id: string } | undefined);
        await stripe.refunds.create({ ...(pi ? { payment_intent: pi } : { charge: charge! }), amount, reason: "requested_by_customer", metadata: { aethryon_motif: "retractation" } },
          { idempotencyKey: `retractation-${inv.id}` });
        refunded += amount;
      }
      await stripe.subscriptions.cancel(sub.id, { prorate: false, invoice_now: false }, { idempotencyKey: `retractation-${sub.id}` });
      await this.syncCustomer(row.stripe_customer_id);
    }
    const named = this.db.prepare('SELECT name FROM "user" WHERE id = ?').get(user.id) as { name: string | null } | undefined;
    this.mails?.billingWithdrawal(user.email, {
      plan: PLANS[kind].name, at: momentFr.format(new Date()), refund: money(refunded, currency),
      name: named?.name?.trim() || "Titulaire du compte", reference, concluded,
    });
    log("info", "billing withdrawal", { user: user.id, contrat: kind, refunded });
    return { rembourse: refunded, devise: currency };
  }

  private withdrawableKind(userId: string, kind: PaidPlan): boolean {
    const now = Date.now();
    return kind === "vie"
      ? this.purchases(userId).some((p) => !purchaseRight(p).revoked && now - Date.parse(p.paid_at) <= WITHDRAWAL_MS)
      : this.subscriptions(userId).some((s) => OPEN.has(s.status) && now - Date.parse(s.created_at) <= WITHDRAWAL_MS);
  }

  /** Portail client Stripe : accueil (« Gérer mon abonnement ») ou lien direct vers le moyen de paiement, les factures,
   *  la résiliation. */
  async portal(userId: string, action: "accueil" | "paiement" | "factures" | "resilier"): Promise<{ url: string }> {
    const customer = this.customerOf(userId);
    if (!customer) throw new BillingError(404, "no_customer", "Aucun paiement n'a encore été fait avec ce compte.");
    const back = `${this.cfg.publicUrl}/dashboard/abonnement`;
    let flow: Stripe.BillingPortal.SessionCreateParams.FlowData | undefined;
    if (action === "paiement") flow = { type: "payment_method_update" };
    if (action === "resilier") {
      const row = this.subscriptions(userId).reverse().find((s) => PAYING.has(s.status) || s.status === "past_due");
      if (!row) throw new BillingError(409, "no_subscription", "Aucun abonnement actif à résilier.");
      flow = { type: "subscription_cancel", subscription_cancel: { subscription: row.stripe_subscription_id }, after_completion: { type: "redirect", redirect: { return_url: `${back}?resiliation=faite` } } };
    }
    const s = await this.sdk().billingPortal.sessions.create({
      customer: customer.stripe_customer_id, return_url: back, locale: "fr",
      ...(this.b!.portalConfiguration ? { configuration: this.b!.portalConfiguration } : {}),
      ...(flow ? { flow_data: flow } : {}),
    });
    return { url: s.url };
  }

  /** Historique : factures Stripe (annuel, et À vie si invoice_creation) et reçus des paiements uniques. */
  async invoices(userId: string): Promise<{ id: string; numero: string | null; date: string | null; montant: number; devise: string; statut: string | null; lien: string | null; pdf: string | null; objet: string }[]> {
    const customer = this.customerOf(userId);
    if (!customer || !this.enabled) return [];
    const stripe = this.sdk();
    const list = await stripe.invoices.list({ customer: customer.stripe_customer_id, limit: 24 });
    // Montant PAYÉ (remise comprise) pour une facture payée ; sinon le total dû.
    const out = list.data.filter((i) => i.status !== "draft").map((i) => ({
      id: i.id ?? "", numero: i.number ?? null, date: iso(i.created), montant: i.status === "paid" ? i.amount_paid : i.total, devise: i.currency,
      statut: i.status ?? null, lien: i.hosted_invoice_url ?? null, pdf: i.invoice_pdf ?? null,
      objet: i.parent?.type === "subscription_details" ? PLANS.annuel.name : PLANS.vie.name,
    }));
    // Achats À vie sans facture Stripe : le reçu de Stripe (lien hébergé), relu ici.
    for (const p of this.purchases(userId)) {
      if (!p.payment_intent_id) {
        // Premium à vie sans paiement (remise de 100 %) : aucun reçu chez Stripe ; la ligne dit 0 €.
        if (p.plan === "vie" && p.amount === 0) {
          out.push({ id: p.stripe_session_id, numero: null, date: p.paid_at, montant: 0, devise: p.currency, statut: purchaseRight(p).revoked ? "void" : "paid", lien: null, pdf: null, objet: PLANS.vie.name });
        }
        continue;
      }
      const pi = await stripe.paymentIntents.retrieve(p.payment_intent_id, { expand: ["latest_charge"] });
      const ch = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
      out.push({ id: p.stripe_session_id, numero: null, date: p.paid_at, montant: p.amount, devise: p.currency,
        statut: purchaseRight(p).etat === "rembourse" ? "rembourse" : "paid", lien: ch?.receipt_url ?? null, pdf: null, objet: PLANS.vie.name });
    }
    return out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  }

  /** Prix RÉELS lus chez Stripe (affichés tels qu'ils seront facturés), gardés 10 min. Un prix dont le type ne
   *  correspond pas à l'offre (annuel récurrent d'un an ; À vie unique) ferme la vente de l'offre. */
  async price(plan: PaidPlan, opts: { fresh?: boolean } = {}): Promise<PriceView | null> {
    if (!this.enabled) return null;
    const hit = this.prices.get(plan);
    if (hit && !opts.fresh && Date.now() - hit.at < 600_000) return hit.value;
    try {
      const p = await this.sdk().prices.retrieve(this.b!.prices[plan]);
      const yearly = p.type === "recurring" && p.recurring?.interval === "year" && (p.recurring.interval_count ?? 1) === 1;
      const oneTime = p.type === "one_time" && !p.recurring;
      const ok = p.active !== false && p.unit_amount !== null && p.unit_amount > 0 && (plan === "annuel" ? yearly : oneTime);
      if (!ok) log("error", "billing price does not match its offer", { plan });
      const value: PriceView | null = ok ? { montant: p.unit_amount!, devise: p.currency, type: plan === "annuel" ? "annuel" : "unique" } : null;
      this.prices.set(plan, { value, at: Date.now() });
      return value;
    } catch (e) {
      log("warn", "billing price unavailable", { plan, err: stripeErr(e) });
      return hit?.value ?? null;
    }
  }

  async state(userId: string): Promise<BillingState> {
    const plan = effectivePlan(this.usage.entitlements(userId));
    const sub = this.current(userId);
    const customer = this.customerOf(userId);
    let abonnement: BillingState["abonnement"] = null;
    if (sub) {
      const e = entitlementFor(sub, customer?.hold ?? null, this.b?.graceDays ?? 7);
      const etat: NonNullable<BillingState["abonnement"]>["etat"] =
        sub.status === "incomplete" ? "en_attente"
        : sub.status === "past_due" || sub.status === "unpaid" ? "impaye"
        : PAYING.has(sub.status) ? (sub.cancel_at_period_end ? "resilie" : "actif")
        : "termine";
      abonnement = {
        reference: sub.stripe_subscription_id, statut: sub.status, etat,
        renouvellement: etat === "actif" ? sub.current_period_end : null,
        fin: etat === "resilie" ? sub.current_period_end : etat === "impaye" ? e.endsAt : null,
        arretParVie: etat === "resilie" && this.hasLifetime(userId),
      };
    }
    const life = this.lifetime(userId);
    const w = this.withdrawable(userId);
    return {
      disponible: this.enabled,
      vente: this.enabled && this.b!.salesOpen,
      mode: this.b?.mode ?? null,
      codesPromo: !!this.b?.promoCodes,
      offre: { id: plan.id, nom: plan.name },
      prix: { annuel: await this.price("annuel"), vie: this.b?.lifetimeOpen === false ? null : await this.price("vie") },
      abonnement,
      vie: life ? { reference: life.stripe_session_id, achete: life.paid_at, montant: life.amount, devise: life.currency, etat: purchaseRight(life).etat } : null,
      suspendu: customer?.hold ?? null,
      retractation: w ? { contrat: w.contrat, jusqua: new Date(Date.parse(w.at) + WITHDRAWAL_MS).toISOString() } : null,
    };
  }

  // ---- rappel de reconduction (L215-1) -------------------------------------------------------------------------------

  /** Annuels actifs dont l'échéance tombe dans 31 à 60 jours et sans rappel pour cette échéance : e-mail dédié avec la
   *  date limite pour refuser la reconduction dans un encadré apparent. Une fois par échéance. */
  async renewalNotices(now = Date.now()): Promise<number> {
    if (!this.enabled || !this.mails) return 0;
    const rows = this.db.prepare(
      "SELECT s.*, u.email FROM ytc_billing_subscription s JOIN \"user\" u ON u.id = s.user_id WHERE s.plan = 'annuel' AND s.status IN ('active', 'trialing') " +
      "AND s.cancel_at_period_end = 0 AND s.current_period_end IS NOT NULL AND (s.renewal_notice_for IS NULL OR s.renewal_notice_for <> s.current_period_end)",
    ).all() as unknown as (SubRow & { email: string })[];
    const price = await this.price("annuel");
    let sent = 0;
    for (const r of rows) {
      const left = Date.parse(r.current_period_end!) - now;
      if (left > NOTICE_MAX_MS || left < NOTICE_MIN_MS) continue;
      // Réservé atomiquement avant l'envoi : un rappel par échéance, même si deux rapprochements se croisent.
      const claimed = await writeTx(this.db, () => Number((this.db.prepare(
        "UPDATE ytc_billing_subscription SET renewal_notice_for = ?, renewal_notice_at = ? WHERE stripe_subscription_id = ? AND (renewal_notice_for IS NULL OR renewal_notice_for <> ?)",
      ).run(r.current_period_end, nowIso(), r.stripe_subscription_id, r.current_period_end) as { changes: number | bigint }).changes));
      if (claimed !== 1) continue;
      const date = dayFr.format(new Date(r.current_period_end!));
      this.mails.billingRenewalNotice(r.email, {
        renewal: date, deadline: renewalDeadline(r.current_period_end!), amount: price ? money(price.montant, price.devise) : "le prix de l'offre",
        reference: r.stripe_subscription_id, vat: this.b?.vatMention ?? "TVA non applicable, art. 293 B du CGI",
      });
      sent++;
    }
    if (sent) log("info", "billing renewal notices sent", { count: sent });
    return sent;
  }

  // ---- événements Stripe (webhook, rapprochement) --------------------------------------------------------------------

  verify(raw: Buffer, signature: string): Stripe.Event {
    // Corps BRUT et en-tête Stripe-Signature ; horodatage à 5 min au plus (rejeu).
    return this.sdk().webhooks.constructEvent(raw, signature, this.b!.webhookSecret, 300);
  }

  private seen(eventId: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM ytc_billing_event WHERE source = 'stripe' AND event_id = ?").get(eventId);
  }

  private async record(event: Stripe.Event, outcome: string): Promise<void> {
    await writeTx(this.db, () => {
      this.db.prepare("INSERT INTO ytc_billing_event (source, event_id, type, received_at, outcome) VALUES ('stripe', ?, ?, ?, ?) ON CONFLICT DO NOTHING")
        .run(event.id, event.type.slice(0, 80), nowIso(), outcome.slice(0, 40));
    });
  }

  /** Achat À vie payé par ce paiement (payment_intent), s'il en est un. */
  private purchaseByIntent(pi: string | null): PurchaseRow | null {
    if (!pi) return null;
    return (this.db.prepare("SELECT * FROM ytc_billing_purchase WHERE payment_intent_id = ?").get(pi) as PurchaseRow | undefined) ?? null;
  }

  /** Applique un événement Stripe une seule fois. Le contenu de l'événement ne sert qu'à savoir QUEL client relire :
   *  l'état vient toujours d'une relecture chez Stripe (ordre d'arrivée indifférent). */
  async handleEvent(event: Stripe.Event): Promise<string> {
    if (this.seen(event.id)) return "deja";
    if (event.livemode !== (this.b?.mode === "live")) { await this.record(event, "mode_different"); return "mode_different"; }
    const obj = event.data.object as unknown as Record<string, unknown>;
    let customer = idOf(obj.customer as string | { id: string } | null | undefined);
    let outcome = "ignore";
    const sync = async () => (customer && (await this.syncCustomer(customer, { userHint: (obj.client_reference_id as string | undefined) ?? undefined })) ? "synchronise" : "client_inconnu");
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
      case "checkout.session.async_payment_failed":
      case "checkout.session.expired":
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed":
      case "invoice.paid":
      case "invoice.payment_failed":
      case "invoice.payment_action_required":
      case "payment_intent.succeeded":
      case "payment_intent.payment_failed":
        outcome = await sync();
        break;
      case "charge.refunded": {
        const pi = idOf(obj.payment_intent as string | { id: string } | null | undefined);
        // Relu d'abord : un achat À vie encore inconnu localement (événements dans le désordre) est ainsi reconnu, et
        // son remboursement ne touche jamais un abonnement annuel.
        if (customer) await this.syncCustomer(customer);
        if (this.purchaseByIntent(pi)) { outcome = "achat_relu"; break; }
        // Annuel : remboursement TOTAL → abonnement résilié tout de suite (geste commercial) ; partiel : rien.
        const fully = Number(obj.amount_refunded) >= Number(obj.amount) && Number(obj.amount) > 0;
        if (fully && customer) {
          const uid = this.userOfCustomer(customer);
          if (uid) {
            for (const s of this.subscriptions(uid).filter((x) => OPEN.has(x.status))) {
              await this.sdk().subscriptions.cancel(s.stripe_subscription_id, { prorate: false, invoice_now: false }, { idempotencyKey: `rembourse-${s.stripe_subscription_id}` });
            }
            await this.syncCustomer(customer);
            outcome = "resilie_rembourse";
          }
        } else outcome = "remboursement_partiel";
        break;
      }
      case "charge.dispute.created":
      case "charge.dispute.updated":
      case "charge.dispute.closed": {
        const chargeId = idOf(obj.charge as string | { id: string } | undefined);
        let pi = idOf(obj.payment_intent as string | { id: string } | null | undefined);
        if ((!customer || !pi) && chargeId) {
          const ch = await this.sdk().charges.retrieve(chargeId);
          customer = customer ?? idOf(ch.customer as string | { id: string } | null);
          pi = pi ?? idOf(ch.payment_intent as string | { id: string } | null);
        }
        const uid = customer ? this.userOfCustomer(customer) : null;
        if (!uid || !customer) { outcome = "client_inconnu"; break; }
        if (!this.purchaseByIntent(pi)) await this.syncCustomer(customer);
        const status = String(obj.status ?? "");
        // Achat À vie : son litige se relit avec lui (suspendu pendant, retiré s'il est perdu, rendu s'il est gagné) ;
        // aucun autre droit n'est touché (un droit permanent n'est pas dégradé par un litige sur autre chose).
        if (this.purchaseByIntent(pi)) {
          await this.syncCustomer(customer);
          outcome = status === "lost" ? "litige_perdu" : status === "won" || status === "warning_closed" ? "litige_leve" : "litige_ouvert";
          log("warn", "billing dispute (lifetime)", { user: uid, outcome });
          break;
        }
        // Annuel : droit suspendu dès l'ouverture ; levé si le litige est gagné, abonnement résilié s'il est perdu.
        if (event.type !== "charge.dispute.closed" || (status !== "won" && status !== "warning_closed")) {
          await writeTx(this.db, () => { this.db.prepare("UPDATE ytc_billing_customer SET hold = 'litige', hold_at = ?, updated_at = ? WHERE user_id = ?").run(nowIso(), nowIso(), uid); });
          if (status === "lost") {
            for (const s of this.subscriptions(uid).filter((x) => OPEN.has(x.status))) {
              await this.sdk().subscriptions.cancel(s.stripe_subscription_id, { prorate: false, invoice_now: false }, { idempotencyKey: `litige-${s.stripe_subscription_id}` });
            }
          }
          outcome = status === "lost" ? "litige_perdu" : "litige_ouvert";
        } else {
          await writeTx(this.db, () => { this.db.prepare("UPDATE ytc_billing_customer SET hold = NULL, hold_at = NULL, updated_at = ? WHERE user_id = ?").run(nowIso(), uid); });
          outcome = "litige_leve";
        }
        await this.syncCustomer(customer);
        log("warn", "billing dispute", { user: uid, outcome });
        break;
      }
      default:
        outcome = "ignore";
    }
    await this.record(event, outcome);
    return outcome;
  }

  /** Rapprochement : relit tous les clients connus, traite les événements des 3 derniers jours jamais reçus (webhook
   *  manqué), puis envoie les rappels de reconduction dus. Lancé toutes les 6 h et par l'outil `facturation`. */
  async reconcile(): Promise<{ clients: number; evenements: number; rappels: number }> {
    const stripe = this.sdk();
    const customers = this.db.prepare("SELECT stripe_customer_id FROM ytc_billing_customer").all() as { stripe_customer_id: string }[];
    for (const c of customers) await this.syncCustomer(c.stripe_customer_id);
    let events = 0;
    const since = Math.floor(Date.now() / 1000) - 3 * 86_400;
    for await (const ev of stripe.events.list({ created: { gte: since }, limit: 100 })) {
      if (this.seen(ev.id)) continue;
      await this.handleEvent(ev);
      events++;
    }
    const rappels = await this.renewalNotices();
    log("info", "billing reconcile", { customers: customers.length, events, notices: rappels });
    return { clients: customers.length, evenements: events, rappels };
  }

  /** Suppression d'un compte : son abonnement annuel est résilié chez Stripe AVANT (aucun prélèvement après la
   *  suppression). Un achat À vie n'a rien à arrêter (aucun prélèvement futur) ; les factures restent chez Stripe
   *  (obligation comptable). Sans Stripe joignable, la suppression est refusée s'il reste un abonnement en cours. */
  async beforeAccountDeletion(userId: string): Promise<void> {
    const open = this.subscriptions(userId).filter((s) => OPEN.has(s.status));
    if (!open.length) return;
    if (!this.enabled) throw new BillingError(409, "subscription_open", "Un abonnement est encore en cours : résilie-le avant de supprimer ton compte.");
    for (const s of open) {
      await this.sdk().subscriptions.cancel(s.stripe_subscription_id, { prorate: false, invoice_now: false }, { idempotencyKey: `suppression-${s.stripe_subscription_id}` });
    }
    log("info", "billing subscriptions cancelled before account deletion", { user: userId, count: open.length });
  }
}

/** Erreur Stripe lisible dans le journal, sans rien de secret (type, code, statut, identifiant de requête). */
export function stripeErr(e: unknown): Record<string, unknown> {
  const x = e as { type?: string; code?: string; param?: string; statusCode?: number; requestId?: string; message?: string };
  // param : nom du paramètre refusé par l'API (jamais une valeur) ; utile à l'ouverture, faite sans essai en mode test.
  return { type: x?.type ?? null, code: x?.code ?? null, param: x?.param ?? null, status: x?.statusCode ?? null, request: x?.requestId ?? null };
}

export function mountFacturation(app: Hono<{ Variables: Vars }>, s: { billing: BillingService; db: DB }): void {
  const { billing } = s;
  const limiter = new Limiter(30, 3_600_000); // actions de facturation : 30 par heure et par compte

  const fail = (c: Context, e: unknown) => {
    if (e instanceof BillingError) return err(c, e.status, e.code, e.message);
    log("error", "billing provider error", stripeErr(e));
    return err(c, 502, "provider_error", "Le service de paiement ne répond pas : réessaie dans un instant. Ton offre actuelle n'a pas changé.");
  };
  const body = async (c: Context): Promise<Record<string, unknown>> => {
    try { const b = await c.req.json(); return b && typeof b === "object" && !Array.isArray(b) ? b as Record<string, unknown> : {}; } catch { return {}; }
  };
  const user = (c: Context<{ Variables: Vars }>) => c.get("user");

  app.get("/api/facturation", async (c) => {
    const u = user(c);
    if (!u) return err(c, 401, "unauthorized", "Connecte-toi pour continuer.");
    try { return c.json(await billing.state(u.id)); } catch (e) { return fail(c, e); }
  });

  app.get("/api/facturation/factures", async (c) => {
    const u = user(c);
    if (!u) return err(c, 401, "unauthorized", "Connecte-toi pour continuer.");
    try { return c.json({ factures: await billing.invoices(u.id) }); } catch (e) { return fail(c, e); }
  });

  const action = (path: string, run: (u: NonNullable<Vars["user"]>, b: Record<string, unknown>) => Promise<unknown>) =>
    app.post(path, async (c) => {
      const u = user(c);
      if (!u) return err(c, 401, "unauthorized", "Connecte-toi pour continuer.");
      if (!billing.enabled) return err(c, 404, "billing_closed", "Les offres payantes ne sont pas ouvertes.");
      if (!limiter.take(u.id)) return err(c, 429, "rate_limited", "Trop de demandes : réessaie dans un moment.");
      try { return c.json((await run(u, await body(c))) ?? (await billing.state(u.id))); } catch (e) { return fail(c, e); }
    });
  const planOf = (v: unknown): PaidPlan => {
    if (!isPaidPlan(v)) throw new BillingError(400, "invalid_request", "Offre inconnue.");
    return v;
  };

  action("/api/facturation/paiement", (u, b) => billing.checkout(u, planOf(b.offre), b.executionImmediate === true, b.cgv ?? null));
  const confirmed = (b: Record<string, unknown>) => {
    if (b.confirme !== true) throw new BillingError(400, "confirmation_required", "Confirme d'abord ta demande.");
  };
  action("/api/facturation/resilier", async (u, b) => { confirmed(b); await billing.terminate(u); return null; });
  action("/api/facturation/retracter", async (u, b) => { confirmed(b); await billing.withdraw(u, b.contrat === undefined ? null : planOf(b.contrat)); return null; });
  action("/api/facturation/retour", async (u, b) => { await billing.confirmReturn(u.id, String(b.session ?? "")); return null; });
  action("/api/facturation/reprendre", async (u) => { await billing.resume(u.id); return null; });
  action("/api/facturation/portail", (u, b) => {
    const a = b.action;
    if (a !== "accueil" && a !== "paiement" && a !== "factures" && a !== "resilier") throw new BillingError(400, "invalid_request", "Action inconnue.");
    return billing.portal(u.id, a);
  });

  // Webhook : ni session ni origine (app.ts l'exempte), corps BRUT vérifié par la signature Stripe.
  app.post(WEBHOOK_PATH, async (c) => {
    if (!billing.enabled) return err(c, 404, "billing_closed", "Facturation fermée.");
    const sig = c.req.header("stripe-signature");
    if (!sig) return err(c, 400, "bad_signature", "Signature absente.");
    const raw = Buffer.from(await c.req.arrayBuffer());
    let event: Stripe.Event;
    try { event = billing.verify(raw, sig); } catch {
      log("warn", "billing webhook signature refused", {});
      return err(c, 400, "bad_signature", "Signature invalide.");
    }
    try {
      return c.json({ received: true, outcome: await billing.handleEvent(event) });
    } catch (e) {
      // Non enregistré : Stripe renverra l'événement (nouvel essai), le traitement est idempotent.
      log("error", "billing webhook processing failed", { type: event.type, ...stripeErr(e) });
      return err(c, 500, "processing_failed", "Événement non traité.");
    }
  });
}

// Paramètres de la page de paiement hébergée Stripe Checkout : SOURCE UNIQUE, utilisée par la facturation
// (facturation.ts) ET par le banc du mode test réel de Stripe (<notes internes non publiées>),
// pour qu'un essai chez Stripe porte EXACTEMENT les paramètres de production. Fonction pure : aucun appel réseau.
//
// Réglages « Checkout Studio » demandés par le propriétaire (2026-10-21, docs/FACTURATION.md §16) : page hébergée
// (ui_mode hosted_page), téléphone non demandé, TVA automatique coupée sauf BILLING_AUTOMATIC_TAX=1, moyen de paiement
// toujours demandé (abonnement : même avec une remise de 100 %, le renouvellement doit pouvoir être prélevé), bouton
// « auto », enregistrement du moyen de paiement proposé, identifiant d'intégration et contexte « web », codes promo
// (BILLING_PROMO_CODES, actif par défaut).
// Écarts VOULUS à ces réglages :
// - (plus d'écart sur l'adresse depuis le 2026-10-21 : `billing_address_collection: "auto"`, valeur de Checkout Studio ; le
//   pays de facturation reste demandé par le formulaire de carte de Stripe et sert au contrôle « France métropolitaine »,
//   CGV 1.2, facturation.ts refuseForeign ; une session sans pays est journalisée) ;
// - carte seulement (allowed_payment_method_types, CGV 4.2 ; l'API 2026-09-30 n'a plus payment_method_types) ;
// - case des conditions de Stripe si BILLING_REQUIRE_TERMS=1 ;
// - mode, adresses de retour et lignes : ceux du code (prix relu côté serveur, jamais venu du navigateur).
import type Stripe from "stripe";

/** Identifiant d'intégration de la page de paiement (réglage du propriétaire). */
export const CHECKOUT_INTEGRATION_ID = "hosted_web_0001";

export interface CheckoutInput {
  plan: "annuel" | "vie";
  /** Prix Stripe de l'offre (STRIPE_PRICE_ANNUEL / STRIPE_PRICE_VIE), relu et vérifié par le serveur avant la vente. */
  priceId: string;
  customer: string;
  userId: string;
  metadata: Record<string, string>;
  /** Adresse publique du site (PUBLIC_URL), sans barre finale. */
  publicUrl: string;
  /** Fin de validité de la page (secondes Unix ; 30 min au moins, exigé par Stripe). */
  expiresAt: number;
  /** Prix du catalogue, formaté (« 5,00 € ») : texte sous le bouton de paiement. */
  amountText: string;
  promoCodes: boolean;
  automaticTax: boolean;
  requireTerms: boolean;
  invoiceOnce: boolean;
  /** Premium à vie acheté par un compte dont l'abonnement est en cours : son renouvellement sera arrêté. */
  annualOpen?: boolean;
}

/** Texte affiché par Stripe au-dessus du bouton de paiement. Une remise (code promo, coupon « once ») ne vaut que pour
 *  le premier paiement : le renouvellement est annoncé au prix du catalogue. */
export function submitMessage(i: Pick<CheckoutInput, "plan" | "amountText" | "promoCodes" | "annualOpen">): string {
  if (i.plan === "annuel") {
    return `Abonnement annuel de ${i.amountText}, renouvelé automatiquement chaque année à la même date. Résiliable à tout moment depuis ton espace AETHRYON : il reste actif jusqu'à la fin de l'année payée.` +
      (i.promoCodes ? ` Un code promo ne vaut que pour ce premier paiement : chaque renouvellement est au prix de ${i.amountText} par an.` : "");
  }
  return `Paiement unique de ${i.amountText}, sans abonnement ni renouvellement. Les limites de l'offre sont celles affichées sur la page des offres, pour la durée de vie du service.` +
    (i.annualOpen ? " Ton abonnement annuel ne sera pas renouvelé ; sa période en cours n'est pas remboursée." : "");
}

/** Paramètres EXACTS de la création de la page de paiement (stripe.checkout.sessions.create). */
export function checkoutSessionParams(i: CheckoutInput): Stripe.Checkout.SessionCreateParams {
  const common = {
    ui_mode: "hosted_page",
    integration_identifier: CHECKOUT_INTEGRATION_ID,
    origin_context: "web",
    customer: i.customer,
    client_reference_id: i.userId,
    line_items: [{ price: i.priceId, quantity: 1 }],
    metadata: i.metadata,
    success_url: `${i.publicUrl}/dashboard/abonnement?paiement=retour&session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${i.publicUrl}/dashboard/abonnement?paiement=annule`,
    locale: "fr",
    allow_promotion_codes: i.promoCodes,
    allowed_payment_method_types: ["card"],
    billing_address_collection: "auto",
    phone_number_collection: { enabled: false },
    automatic_tax: { enabled: i.automaticTax },
    ...(i.automaticTax ? { customer_update: { address: "auto", name: "auto" } } : {}),
    saved_payment_method_options: { payment_method_save: "enabled" },
    submit_type: "auto",
    expires_at: i.expiresAt,
    ...(i.requireTerms ? { consent_collection: { terms_of_service: "required" } } : {}),
    custom_text: { submit: { message: submitMessage(i) } },
  } satisfies Stripe.Checkout.SessionCreateParams;
  if (i.plan === "annuel") {
    return { ...common, mode: "subscription", payment_method_collection: "always", subscription_data: { metadata: i.metadata } };
  }
  return {
    ...common,
    mode: "payment",
    payment_intent_data: { metadata: i.metadata, description: "AETHRYON Premium à vie" },
    ...(i.invoiceOnce ? { invoice_creation: { enabled: true, invoice_data: { metadata: i.metadata, description: "AETHRYON Premium à vie : paiement unique, sans renouvellement" } } } : {}),
  };
}

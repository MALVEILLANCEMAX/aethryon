// Simulateur de l'API Stripe pour les ESSAIS d'AETHRYON (account/src/facturation.ts) — jamais en production.
// - Sous-ensemble à état des points d'API utilisés par le vrai SDK « stripe » (clients, Checkout en mode abonnement ET
//   paiement unique, abonnements, échéanciers, factures, paiements de facture, PaymentIntents, charges, litiges,
//   remboursements, prix récurrents ou uniques, portail, événements) ;
// - clés d'idempotence respectées (même clé = même réponse) ;
// - événements signés comme ceux de Stripe (en-tête Stripe-Signature : t=…,v1=HMAC-SHA256(secret, "t.corps")) ;
// - pages HTML sobres de paiement et de portail, marquées « simulateur », pour les essais dans un navigateur (pile
//   d'aperçu locale) : aucune carte saisie, aucun paiement, aucune reprise de l'apparence de Stripe ;
// - création d'une page Checkout : tout paramètre INCONNU de l'API (liste de stripe-node 23.0.0) est refusé comme le fait
//   Stripe (une faute de frappe échoue aux essais), ainsi que les valeurs hors liste des réglages « Checkout Studio » ;
// - codes promo (allow_promotion_codes) : saisis sur la page simulée (simu.complete(id, { code })), jugés par le
//   simulateur (code inconnu : refusé par la page, rien ne change) ; remise appliquée au premier paiement seulement
//   (coupons « once ») ; 100 % en paiement unique : no_payment_required, aucun PaymentIntent.
// Ce n'est PAS le mode test de Stripe : il valide notre code (ordre des événements, doublons, litiges…), pas Stripe.
//   node fake-stripe.mjs   (PORT, PUBLIC_BASE, WEBHOOK_URL, WEBHOOK_SECRET, PRICE_ANNUEL, PRICE_VIE, AMOUNT_ANNUEL, AMOUNT_VIE)
import { createServer } from "node:http";
import { createHmac, randomBytes } from "node:crypto";

const rid = (p) => `${p}_${randomBytes(9).toString("base64url").replace(/[-_]/g, "x")}`;
const DAY = 86_400;

/** Paramètres de premier niveau de POST /v1/checkout/sessions (Checkout.SessionCreateParams de stripe-node 23.0.0,
 *  API 2026-09-30.endive) : tout autre nom est refusé, comme par l'API (« Received unknown parameter »). */
export const CHECKOUT_PARAMS = new Set(("adaptive_pricing after_expiration allow_promotion_codes allowed_payment_method_types automatic_tax " +
  "billing_address_collection branding_settings cancel_url client_reference_id consent_collection currency custom_fields custom_text customer " +
  "customer_account customer_creation customer_email customer_update discounts excluded_payment_method_types expand expires_at " +
  "integration_identifier invoice_creation line_items locale managed_payments metadata mode name_collection optional_items origin_context " +
  "payment_intent_data payment_method_collection payment_method_configuration payment_method_data payment_method_options permissions " +
  "phone_number_collection redirect_on_completion return_url saved_payment_method_options setup_intent_data shipping_address_collection " +
  "shipping_options submit_type subscription_data success_url tax_id_collection ui_mode wallet_options").split(" "));
/** Valeurs permises des réglages « Checkout Studio » (mêmes types) ; sous-clés connues de leurs objets. */
const CHECKOUT_ENUMS = {
  ui_mode: ["elements", "embedded_page", "form", "hosted_page"], origin_context: ["mobile_app", "web"],
  submit_type: ["auto", "book", "donate", "pay", "subscribe"], payment_method_collection: ["always", "if_required"],
  billing_address_collection: ["auto", "required"], allow_promotion_codes: ["true", "false"],
};
const CHECKOUT_NESTED = {
  automatic_tax: ["enabled", "liability"], phone_number_collection: ["enabled"],
  saved_payment_method_options: ["allow_redisplay_filters", "payment_method_remove", "payment_method_save"],
};
/** Contrôle des paramètres d'une création de page Checkout : message d'erreur de l'API, ou null. */
export function checkoutParamError(b) {
  for (const k of Object.keys(b)) if (!CHECKOUT_PARAMS.has(k)) return `Received unknown parameter: ${k}`;
  for (const [k, ok] of Object.entries(CHECKOUT_ENUMS)) if (b[k] !== undefined && !ok.includes(b[k])) return `Invalid ${k}: ${b[k]}`;
  for (const [k, ok] of Object.entries(CHECKOUT_NESTED)) {
    if (b[k] === undefined) continue;
    for (const sub of Object.keys(b[k])) if (!ok.includes(sub)) return `Received unknown parameter: ${k}[${sub}]`;
  }
  if (b.automatic_tax && !["true", "false"].includes(b.automatic_tax.enabled)) return "Invalid automatic_tax[enabled]";
  if (b.phone_number_collection && !["true", "false"].includes(b.phone_number_collection.enabled)) return "Invalid phone_number_collection[enabled]";
  if (b.saved_payment_method_options?.payment_method_save !== undefined && !["enabled", "disabled"].includes(b.saved_payment_method_options.payment_method_save)) return "Invalid saved_payment_method_options[payment_method_save]";
  if (b.payment_method_collection !== undefined && b.mode !== "subscription") return "payment_method_collection can only be set in subscription mode";
  if (b.allow_promotion_codes !== undefined && b.discounts !== undefined) return "You may only specify one of these parameters: allow_promotion_codes, discounts";
  return null;
}
/** Codes promo du simulateur (comme créés par le propriétaire : coupons « once »). */
const PROMOS = { BIENVENUE67: { id: "promo_bienvenue67", percent_off: 67, duration: "once" }, OFFERT100: { id: "promo_offert100", percent_off: 100, duration: "once" } };

/** Corps « application/x-www-form-urlencoded » à crochets (a[b][0][c]=v) → objet ; les nombres restent des chaînes. */
export function parseForm(text) {
  const out = {};
  for (const part of text.split("&")) {
    if (!part) continue;
    const [k, v = ""] = part.split("=").map((x) => decodeURIComponent(x.replace(/\+/g, " ")));
    const keys = k.replace(/\]/g, "").split("[");
    let o = out;
    keys.forEach((key, i) => {
      const last = i === keys.length - 1;
      const nextIsIndex = !last && /^\d*$/.test(keys[i + 1]);
      if (last) { if (key === "" && Array.isArray(o)) o.push(v); else o[key] = v; return; }
      if (key === "" && Array.isArray(o)) { const n = nextIsIndex ? [] : {}; o.push(n); o = n; return; }
      if (o[key] === undefined) o[key] = nextIsIndex ? [] : {};
      o = o[key];
    });
  }
  return out;
}

export function signature(payload, secret, t = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

export function createFakeStripe(opts) {
  const o = { publicBase: "http://127.0.0.1:0", webhookUrl: null, webhookSecret: "whsec_simulateur0000000000", prices: {}, promotionCodes: PROMOS, ...opts };
  const st = {
    offset: 0, customers: new Map(), sessions: new Map(), subs: new Map(), schedules: new Map(), invoices: new Map(),
    payments: new Map(), charges: new Map(), refunds: new Map(), portals: new Map(), events: [], idem: new Map(), calls: [],
    intents: new Map(), disputes: new Map(),
    /** Panne simulée de l'API (essais de résistance) : toutes les requêtes répondent 500. */
    down: false,
  };
  const now = () => Math.floor(Date.now() / 1000) + st.offset;
  const prices = new Map();
  // Prix : récurrent (interval : « year » ou « month ») ou unique (sans interval), comme les deux offres V2.
  for (const [plan, p] of Object.entries(o.prices)) {
    prices.set(p.id, { id: p.id, object: "price", unit_amount: p.amount, currency: "eur", type: p.interval ? "recurring" : "one_time",
      recurring: p.interval ? { interval: p.interval, interval_count: 1 } : null, product: `prod_${plan}`, active: true, livemode: false });
  }
  const periodOf = (price) => (price.recurring?.interval === "year" ? 365 : 30) * DAY;

  const list = (url, data) => ({ object: "list", url, has_more: false, data });
  const emit = (type, object) => {
    const ev = { id: rid("evt"), object: "event", api_version: "2026-09-30.endive", created: now(), livemode: false, type, data: { object: JSON.parse(JSON.stringify(object)) }, pending_webhooks: 1, request: { id: null } };
    st.events.push(ev);
    return ev;
  };
  async function deliver(ev, { secret = o.webhookSecret, t } = {}) {
    if (!o.webhookUrl) return null;
    const payload = JSON.stringify(ev);
    const res = await fetch(o.webhookUrl, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signature(payload, secret, t) }, body: payload });
    return { status: res.status, body: await res.text() };
  }

  const priceObj = (id) => prices.get(id) ?? { id, object: "price", unit_amount: 0, currency: "eur", type: "recurring", recurring: { interval: "month", interval_count: 1 } };
  /** Vue d'une session, PaymentIntent et charge développés à la demande (expand). */
  const sessionView = (cs, expand = []) => {
    const out = JSON.parse(JSON.stringify(cs, (k, v) => (k.startsWith("_") ? undefined : v)));
    if (cs.payment_intent && expand.some((e) => e.endsWith("payment_intent") || e.includes("payment_intent."))) {
      out.payment_intent = intentView(cs.payment_intent, expand.some((e) => e.includes("latest_charge")));
    }
    return out;
  };
  const intentView = (id, withCharge) => {
    const pi = st.intents.get(id);
    if (!pi) return id;
    return { ...pi, latest_charge: withCharge && pi.latest_charge ? { ...st.charges.get(pi.latest_charge) } : pi.latest_charge };
  };
  function makeInvoice(sub, amount, status = "paid", billingReason = "subscription_cycle") {
    const inv = {
      id: rid("in"), object: "invoice", customer: sub.customer, status, total: amount, amount_paid: status === "paid" ? amount : 0,
      amount_due: amount, currency: "eur", number: `AETH-${String(st.invoices.size + 1).padStart(4, "0")}`, created: now(),
      period_start: sub.items.data[0].current_period_start, period_end: sub.items.data[0].current_period_end,
      hosted_invoice_url: `${o.publicBase}/facture/${st.invoices.size + 1}`, invoice_pdf: `${o.publicBase}/facture/${st.invoices.size + 1}.pdf`,
      billing_reason: billingReason, livemode: false,
      parent: { type: "subscription_details", subscription_details: { subscription: sub.id, metadata: sub.metadata } },
    };
    st.invoices.set(inv.id, inv);
    // Facture à 0 € (remise de 100 %) : payée sans aucun paiement, comme chez Stripe.
    if (status === "paid" && amount > 0) {
      const pi = rid("pi"); const ch = rid("ch");
      st.charges.set(ch, { id: ch, object: "charge", customer: sub.customer, amount, amount_refunded: 0, currency: "eur", payment_intent: pi, refunded: false, livemode: false });
      st.payments.set(rid("inpay"), { object: "invoice_payment", invoice: inv.id, status: "paid", amount_paid: amount, payment: { type: "payment_intent", payment_intent: pi }, _charge: ch });
    }
    sub.latest_invoice = inv.id;
    return inv;
  }
  const subView = (s) => JSON.parse(JSON.stringify(s));

  // ---- simulation (essais) --------------------------------------------------------------------------------------
  const simu = {
    /** Paiement accepté sur la page Checkout : abonnement actif, facture payée, trois événements. `code` : code promo
     *  saisi sur la page (refusé si la page ne les permet pas ou si le code est inconnu : la page reste ouverte). */
    complete(sessionId, opts = {}) {
      const cs = st.sessions.get(sessionId);
      if (!cs || cs.status !== "open") throw new Error("session inconnue ou close");
      const t = now();
      let discount = 0;
      if (opts.code !== undefined) {
        if (cs.allow_promotion_codes !== true) throw new Error("code promo : la page de paiement n'en accepte pas");
        const promo = o.promotionCodes[opts.code];
        if (!promo) throw new Error("code promo invalide : refusé par la page de paiement");
        discount = Math.round(priceObj(cs._price).unit_amount * promo.percent_off / 100);
        cs.discounts = [{ promotion_code: promo.id, coupon: { id: `coupon_${promo.id}`, percent_off: promo.percent_off, duration: promo.duration } }];
      }
      // Pays de facturation : toujours demandé par le formulaire de carte de Stripe (même en « auto ») ; France par défaut.
      {
        cs.customer_details = { email: null, name: "Client d'essai", address: { country: opts.country ?? "FR", postal_code: "38600", city: "Fontaine", line1: "1 rue de l'Essai", line2: null, state: null } };
      }
      const price = priceObj(cs._price);
      const amount = price.unit_amount - discount;
      cs.amount_total = amount; cs.total_details = { amount_discount: discount, amount_shipping: 0, amount_tax: 0 };
      if (cs.mode === "payment") {
        // Remise de 100 % : rien à payer, aucun PaymentIntent (no_payment_required).
        if (amount === 0) {
          cs.status = "complete"; cs.payment_status = "no_payment_required"; cs.payment_intent = null;
          return [emit("checkout.session.completed", sessionView(cs))];
        }
        // Paiement unique accepté : PaymentIntent réussi, charge (reçu), session payée.
        const pi = cs.payment_intent ?? rid("pi"), ch = rid("ch");
        st.charges.set(ch, { id: ch, object: "charge", customer: cs.customer, amount, amount_refunded: 0, currency: "eur", payment_intent: pi,
          refunded: false, disputed: false, created: t, livemode: false, receipt_url: `${o.publicBase}/recu/${ch}` });
        st.intents.set(pi, { id: pi, object: "payment_intent", customer: cs.customer, amount, currency: "eur", status: "succeeded",
          latest_charge: ch, metadata: { ...(cs._piMeta ?? {}) }, created: t, livemode: false });
        cs.status = "complete"; cs.payment_status = "paid"; cs.payment_intent = pi;
        return [emit("checkout.session.completed", sessionView(cs)), emit("payment_intent.succeeded", st.intents.get(pi))];
      }
      const sub = {
        id: rid("sub"), object: "subscription", customer: cs.customer, status: "active", cancel_at_period_end: false, cancel_at: null,
        canceled_at: null, created: t, livemode: false, metadata: { ...(cs._subMeta ?? {}) }, schedule: null, latest_invoice: null,
        items: { object: "list", data: [{ id: rid("si"), object: "subscription_item", price, quantity: 1, current_period_start: t, current_period_end: t + periodOf(price) }] },
      };
      if (cs.discounts?.length) sub.discounts = cs.discounts.map((d) => ({ ...d }));
      st.subs.set(sub.id, sub);
      // Coupon « once » : la remise vaut pour la première facture seulement (les renouvellements sont au prix plein).
      const inv = makeInvoice(sub, amount, "paid", "subscription_create");
      cs.status = "complete"; cs.subscription = sub.id; cs.payment_status = "paid";
      return [emit("checkout.session.completed", sessionView(cs)), emit("customer.subscription.created", subView(sub)), emit("invoice.paid", inv)];
    },
    /** Carte refusée sur la page de paiement : la page reste ouverte. Paiement unique : PaymentIntent en échec et
     *  événement payment_intent.payment_failed ; abonnement : rien n'est créé chez Stripe (aucun événement). */
    decline(sessionId) {
      const cs = st.sessions.get(sessionId);
      if (!cs || cs.status !== "open") throw new Error("session inconnue ou close");
      if (cs.mode !== "payment") return [];
      const pi = cs.payment_intent ?? rid("pi");
      st.intents.set(pi, { id: pi, object: "payment_intent", customer: cs.customer, amount: priceObj(cs._price).unit_amount, currency: "eur", status: "requires_payment_method",
        latest_charge: null, last_payment_error: { code: "card_declined", decline_code: "generic_decline" }, metadata: { ...(cs._piMeta ?? {}) }, created: now(), livemode: false });
      cs.payment_intent = pi;
      return [emit("payment_intent.payment_failed", st.intents.get(pi))];
    },
    /** Session forgée (essais de robustesse) : champs remplacés tels quels, aucun événement. */
    patchSession(sessionId, patch) { Object.assign(st.sessions.get(sessionId), patch); },
    /** Page de paiement abandonnée : la session expire (aucun paiement). */
    expire(sessionId) {
      const cs = st.sessions.get(sessionId);
      cs.status = "expired";
      return [emit("checkout.session.expired", sessionView(cs))];
    },
    /** Remboursement d'un achat unique (total par défaut, ou d'un montant). */
    refundPurchase(sessionId, amount = null) {
      const cs = st.sessions.get(sessionId);
      const ch = st.charges.get(st.intents.get(cs.payment_intent).latest_charge);
      ch.amount_refunded = Math.min(ch.amount, ch.amount_refunded + (amount ?? ch.amount)); ch.refunded = ch.amount_refunded >= ch.amount;
      return [emit("charge.refunded", ch)];
    },
    /** Litige sur un achat unique : ouvert (needs_response), puis clos (won / lost). */
    disputePurchase(sessionId, status = "needs_response", type = "charge.dispute.created") {
      const cs = st.sessions.get(sessionId);
      const ch = st.charges.get(st.intents.get(cs.payment_intent).latest_charge);
      ch.disputed = true;
      let d = [...st.disputes.values()].find((x) => x.charge === ch.id);
      if (!d) { d = { id: rid("dp"), object: "dispute", charge: ch.id, payment_intent: ch.payment_intent, amount: ch.amount, status, livemode: false }; st.disputes.set(d.id, d); }
      d.status = status;
      return [emit(type, { ...d })];
    },
    /** Échéance : renouvellement payé, ou fin d'un abonnement résilié, ou passage à la phase suivante d'un échéancier. */
    endPeriod(subId) {
      const s = st.subs.get(subId);
      const it = s.items.data[0];
      // L'échéance arrive MAINTENANT (la période est recalée) : l'horloge reste celle du serveur essayé.
      const span = periodOf(it.price);
      it.current_period_end = now() - 1; it.current_period_start = it.current_period_end - span;
      if (s.cancel_at_period_end) {
        s.status = "canceled"; s.canceled_at = now();
        return [emit("customer.subscription.deleted", subView(s))];
      }
      const sched = s.schedule && st.schedules.get(s.schedule);
      if (sched && sched.phases[1]) {
        it.price = priceObj(sched.phases[1].items[0].price);
        sched.status = "released"; s.schedule = null;
      }
      it.current_period_start = it.current_period_end; it.current_period_end += span;
      s.status = "active";
      const inv = makeInvoice(s, it.price.unit_amount);
      return [emit("invoice.paid", inv), emit("customer.subscription.updated", subView(s))];
    },
    /** Renouvellement refusé (carte expirée…) : past_due, facture ouverte. */
    failRenewal(subId) {
      const s = st.subs.get(subId);
      const it = s.items.data[0];
      // Renouvellement manqué MAINTENANT : nouvelle période impayée qui commence à l'instant.
      it.current_period_start = now() - 60; it.current_period_end = it.current_period_start + periodOf(it.price);
      s.status = "past_due";
      const inv = makeInvoice(s, it.price.unit_amount, "open");
      return [emit("invoice.payment_failed", inv), emit("customer.subscription.updated", subView(s))];
    },
    /** Relances épuisées : impayé (unpaid). */
    unpaid(subId) { const s = st.subs.get(subId); s.status = "unpaid"; return [emit("customer.subscription.updated", subView(s))]; },
    /** Résiliation faite par le client dans le portail de Stripe (à l'échéance), ou annulée depuis ce portail. */
    portalCancel(subId, cancel = true) { const s = st.subs.get(subId); s.cancel_at_period_end = cancel; s.canceled_at = cancel ? now() : null; return [emit("customer.subscription.updated", subView(s))]; },
    /** Remboursement TOTAL du dernier paiement (fait dans le tableau de bord de Stripe, par exemple). */
    refundLatest(subId) {
      const s = st.subs.get(subId);
      const pay = [...st.payments.values()].reverse().find((p) => p.invoice === s.latest_invoice);
      const ch = st.charges.get(pay._charge);
      ch.amount_refunded = ch.amount; ch.refunded = true;
      return [emit("charge.refunded", ch)];
    },
    /** Litige (contestation bancaire) : ouvert, puis clos (won / lost). */
    dispute(subId, status = "needs_response", type = "charge.dispute.created") {
      const s = st.subs.get(subId);
      const pay = [...st.payments.values()].reverse().find((p) => p.invoice === s.latest_invoice);
      return [emit(type, { id: rid("dp"), object: "dispute", charge: pay._charge, payment_intent: st.charges.get(pay._charge).payment_intent, amount: st.charges.get(pay._charge).amount, status, livemode: false })];
    },
    advance(seconds) { st.offset += seconds; },
  };

  // ---- API -------------------------------------------------------------------------------------------------------
  const notFound = (what) => ({ status: 404, body: { error: { type: "invalid_request_error", code: "resource_missing", message: `No such ${what}` } } });
  function api(method, path, q, b) {
    let m;
    if (method === "GET" && (m = path.match(/^\/v1\/prices\/([^/]+)$/))) return prices.has(m[1]) ? { body: prices.get(m[1]) } : notFound("price");
    if (method === "POST" && path === "/v1/customers") {
      const c = { id: rid("cus"), object: "customer", email: b.email ?? null, metadata: b.metadata ?? {}, created: now(), livemode: false };
      st.customers.set(c.id, c);
      return { body: c };
    }
    if (method === "POST" && path === "/v1/checkout/sessions") {
      const bad = checkoutParamError(b);
      if (bad) return { status: 400, body: { error: { type: "invalid_request_error", code: "parameter_unknown", message: bad } } };
      const id = `cs_test_${randomBytes(18).toString("hex")}`;
      const price = b.line_items?.[0]?.price;
      if (!prices.has(price)) return { status: 400, body: { error: { type: "invalid_request_error", message: "No such price" } } };
      const p = prices.get(price);
      // Comme Stripe : un prix récurrent exige le mode abonnement, un prix unique le mode paiement.
      const okMode = (b.mode === "subscription" && p.type === "recurring") || (b.mode === "payment" && p.type === "one_time");
      if (!okMode || !b.customer || !st.customers.has(b.customer)) return { status: 400, body: { error: { type: "invalid_request_error", message: "bad session (mode / price type / customer)" } } };
      if (b.payment_method_types) return { status: 400, body: { error: { type: "invalid_request_error", message: "payment_method_types n'est plus accepté avec cette version d'API" } } };
      const expiresAt = b.expires_at ? Number(b.expires_at) : now() + DAY;
      if (expiresAt < now() + 30 * 60 - 5 || expiresAt > now() + DAY) return { status: 400, body: { error: { type: "invalid_request_error", message: "expires_at doit être entre 30 min et 24 h" } } };
      const cs = {
        id, object: "checkout.session", mode: b.mode, status: "open", payment_status: "unpaid", customer: b.customer,
        client_reference_id: b.client_reference_id ?? null, metadata: b.metadata ?? {}, subscription: null, payment_intent: null, success_url: b.success_url,
        cancel_url: b.cancel_url, url: `${o.publicBase}/paiement/${id}`, livemode: false, locale: b.locale ?? null, expires_at: expiresAt,
        amount_total: p.unit_amount, currency: "eur", created: now(), submit_type: b.submit_type ?? null,
        invoice_creation: b.invoice_creation ? { enabled: b.invoice_creation.enabled === "true" } : null,
        _price: price, _subMeta: b.subscription_data?.metadata ?? {}, _piMeta: b.payment_intent_data?.metadata ?? {}, _custom: b.custom_text ?? null,
        allowed_payment_method_types: b.allowed_payment_method_types ?? null, billing_address_collection: b.billing_address_collection ?? null,
        customer_details: null, ui_mode: b.ui_mode ?? "hosted_page", allow_promotion_codes: b.allow_promotion_codes === "true",
        total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 }, discounts: [],
        automatic_tax: { enabled: b.automatic_tax?.enabled === "true", status: null },
        phone_number_collection: { enabled: b.phone_number_collection?.enabled === "true" },
        saved_payment_method_options: b.saved_payment_method_options ?? null, integration_identifier: b.integration_identifier ?? null,
        origin_context: b.origin_context ?? null, payment_method_collection: b.payment_method_collection ?? (b.mode === "subscription" ? "always" : null),
        /** Paramètres reçus, tels quels (chaînes du formulaire) : vérifiés par les essais. */
        _params: b,
      };
      st.sessions.set(id, cs);
      return { body: cs };
    }
    if (method === "GET" && (m = path.match(/^\/v1\/checkout\/sessions\/([^/]+)$/))) return st.sessions.has(m[1]) ? { body: sessionView(st.sessions.get(m[1]), [].concat(q.expand ?? [])) } : notFound("checkout.session");
    if (method === "GET" && (m = path.match(/^\/v1\/checkout\/sessions\/([^/]+)\/line_items$/))) {
      const cs = st.sessions.get(m[1]);
      if (!cs) return notFound("checkout.session");
      return { body: list(path, [{ id: rid("li"), object: "item", quantity: 1, price: priceObj(cs._price), amount_total: cs.amount_total }]) };
    }
    if (method === "GET" && path === "/v1/checkout/sessions") {
      const expand = [].concat(q.expand ?? []);
      const data = [...st.sessions.values()].filter((cs) => !q.customer || cs.customer === q.customer).reverse().map((cs) => sessionView(cs, expand));
      return { body: list(path, data.slice(0, Number(q.limit ?? 10))) };
    }
    if (method === "GET" && (m = path.match(/^\/v1\/payment_intents\/([^/]+)$/))) {
      return st.intents.has(m[1]) ? { body: intentView(m[1], [].concat(q.expand ?? []).includes("latest_charge")) } : notFound("payment_intent");
    }
    if (method === "GET" && path === "/v1/disputes") {
      const data = [...st.disputes.values()].filter((d) => (!q.charge || d.charge === q.charge) && (!q.payment_intent || d.payment_intent === q.payment_intent));
      return { body: list(path, data) };
    }
    if (method === "GET" && path === "/v1/subscriptions") {
      const data = [...st.subs.values()].filter((s) => (!q.customer || s.customer === q.customer) && (q.status === "all" || !q.status ? true : s.status === q.status));
      return { body: list("/v1/subscriptions", data.map(subView).reverse()) };
    }
    if ((m = path.match(/^\/v1\/subscriptions\/([^/]+)$/))) {
      const s = st.subs.get(m[1]);
      if (!s) return notFound("subscription");
      if (method === "GET") return { body: subView(s) };
      if (method === "DELETE") {
        s.status = "canceled"; s.canceled_at = now(); s.cancel_at_period_end = false;
        emit("customer.subscription.deleted", subView(s));
        return { body: subView(s) };
      }
      if (method === "POST") {
        if (b.cancel_at_period_end !== undefined) s.cancel_at_period_end = b.cancel_at_period_end === "true";
        if (b.metadata) s.metadata = { ...s.metadata, ...b.metadata };
        const newPrice = b.items?.[0]?.price;
        if (newPrice) {
          const it = s.items.data[0];
          const before = it.price.unit_amount;
          it.price = priceObj(newPrice);
          if (b.proration_behavior === "always_invoice") {
            const left = (it.current_period_end - now()) / (it.current_period_end - it.current_period_start);
            const diff = Math.max(0, Math.round((it.price.unit_amount - before) * left));
            if (diff > 0) emit("invoice.paid", makeInvoice(s, diff, "paid", "subscription_update"));
          }
        }
        emit("customer.subscription.updated", subView(s));
        return { body: subView(s) };
      }
    }
    if (method === "POST" && path === "/v1/subscription_schedules") {
      const s = st.subs.get(b.from_subscription);
      if (!s) return notFound("subscription");
      const it = s.items.data[0];
      const sc = { id: rid("sub_sched"), object: "subscription_schedule", subscription: s.id, status: "active", end_behavior: "release",
        phases: [{ start_date: it.current_period_start, end_date: it.current_period_end, items: [{ price: it.price.id, quantity: 1 }] }] };
      st.schedules.set(sc.id, sc); s.schedule = sc.id;
      return { body: sc };
    }
    if ((m = path.match(/^\/v1\/subscription_schedules\/([^/]+)(\/release)?$/))) {
      const sc = st.schedules.get(m[1]);
      if (!sc) return notFound("subscription_schedule");
      if (method === "GET") return { body: sc };
      if (m[2]) { sc.status = "released"; const s = st.subs.get(sc.subscription); if (s) s.schedule = null; emit("subscription_schedule.released", sc); return { body: sc }; }
      if (b.phases) sc.phases = b.phases.map((p) => ({ ...p, start_date: p.start_date ? Number(p.start_date) : undefined, end_date: p.end_date ? Number(p.end_date) : undefined }));
      if (b.end_behavior) sc.end_behavior = b.end_behavior;
      return { body: sc };
    }
    if (method === "GET" && path === "/v1/invoices") {
      const data = [...st.invoices.values()].filter((i) => (!q.customer || i.customer === q.customer)
        && (!q.subscription || i.parent?.subscription_details?.subscription === q.subscription) && (!q.status || i.status === q.status));
      return { body: list("/v1/invoices", data.reverse().slice(0, Number(q.limit ?? 10))) };
    }
    if (method === "GET" && path === "/v1/invoice_payments") {
      const data = [...st.payments.entries()].filter(([, p]) => p.invoice === q.invoice).map(([id, p]) => { const { _charge, ...rest } = p; return { id, ...rest }; });
      return { body: list("/v1/invoice_payments", data) };
    }
    if (method === "POST" && path === "/v1/refunds") {
      const ch = [...st.charges.values()].find((c) => (b.payment_intent && c.payment_intent === b.payment_intent) || (b.charge && c.id === b.charge));
      if (!ch) return notFound("payment_intent");
      const amount = b.amount ? Number(b.amount) : ch.amount - ch.amount_refunded;
      if (amount > ch.amount - ch.amount_refunded) return { status: 400, body: { error: { type: "invalid_request_error", code: "amount_too_large", message: "Refund amount too large" } } };
      ch.amount_refunded += amount; ch.refunded = ch.amount_refunded >= ch.amount;
      const r = { id: rid("re"), object: "refund", amount, charge: ch.id, payment_intent: ch.payment_intent, reason: b.reason ?? null, status: "succeeded", metadata: b.metadata ?? {} };
      st.refunds.set(r.id, r);
      return { body: r };
    }
    if (method === "GET" && (m = path.match(/^\/v1\/charges\/([^/]+)$/))) return st.charges.has(m[1]) ? { body: st.charges.get(m[1]) } : notFound("charge");
    if (method === "POST" && path === "/v1/billing_portal/sessions") {
      if (!st.customers.has(b.customer)) return notFound("customer");
      const p = { id: rid("bps"), object: "billing_portal.session", customer: b.customer, return_url: b.return_url, flow: b.flow_data ?? null, url: "", livemode: false };
      p.url = `${o.publicBase}/portail/${p.id}`;
      st.portals.set(p.id, p);
      return { body: p };
    }
    if (method === "GET" && path === "/v1/events") {
      const gte = Number(q.created?.gte ?? 0);
      return { body: list("/v1/events", st.events.filter((e) => e.created >= gte).slice().reverse()) };
    }
    return { status: 404, body: { error: { type: "invalid_request_error", message: `simulateur : ${method} ${path} non pris en charge` } } };
  }

  // ---- pages HTML (navigateur) ------------------------------------------------------------------------------------
  const page = (title, inner) => `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:520px;margin:48px auto;padding:0 20px;color:#141413;background:#faf8f3}
.tag{display:inline-block;padding:2px 10px;border-radius:99px;background:#e9e0d0;font-size:13px}h1{font-size:24px}
button,a.b{display:inline-flex;align-items:center;min-height:44px;padding:0 18px;border-radius:99px;border:1px solid #141413;background:#141413;color:#faf8f3;font:inherit;cursor:pointer;text-decoration:none;margin:6px 8px 0 0}
.sec{background:transparent;color:#141413}.box{border:1px solid #e2d8c9;border-radius:16px;padding:16px 18px;margin:16px 0;background:#fff}</style>
<body><p class="tag">Simulateur local — essais AETHRYON, aucun paiement réel</p>${inner}</body></html>`;
  const eur = (c) => (c / 100).toFixed(2).replace(".", ",") + " €";
  function html(method, path, body) {
    let m;
    // Page de paiement : champ « Code promo » seulement si la session les permet (allow_promotion_codes) ; un code
    // inconnu est refusé par la page (elle se réaffiche avec le refus, rien ne change), comme sur Stripe.
    const checkoutPage = (cs, error = "") => {
      const p = priceObj(cs._price);
      const once = cs.mode === "payment";
      const per = p.recurring?.interval === "year" ? "par an" : "par mois";
      const promo = cs.allow_promotion_codes === true
        ? `<p><label>Code promo <input name="code" autocomplete="off" data-simu="code"></label></p>${error ? `<p role="alert" data-simu="code-refuse">${error}</p>` : ""}` : "";
      return page("Paiement (simulateur)", `<h1>${once ? "Paiement unique" : "Abonnement"} : ${p.product.replace("prod_", "")}</h1>
<div class="box"><p><b>${eur(p.unit_amount)}</b> ${once ? "une seule fois" : per}, TTC.</p><p>${cs._custom?.submit?.message ?? ""}</p><p>Carte de test du simulateur (aucune saisie).</p></div>
<form method="post" action="/paiement/${cs.id}/payer">${promo}<button type="submit" data-simu="payer">${once ? "Payer" : "S'abonner"} (simulation)</button>
<a class="b sec" href="${cs.cancel_url}" data-simu="annuler">Annuler</a></form>`);
    };
    if ((m = path.match(/^\/paiement\/([^/]+)$/)) && method === "GET") {
      const cs = st.sessions.get(m[1]);
      if (!cs) return { status: 404, html: page("Introuvable", "<h1>Session inconnue</h1>") };
      return { html: checkoutPage(cs) };
    }
    if ((m = path.match(/^\/paiement\/([^/]+)\/payer$/)) && method === "POST") {
      const cs = st.sessions.get(m[1]);
      if (!cs) return { status: 404, html: page("Introuvable", "<h1>Session inconnue</h1>") };
      const code = String(parseForm(body ?? "").code ?? "").trim().toUpperCase();
      if (code && (cs.allow_promotion_codes !== true || !o.promotionCodes[code])) return { html: checkoutPage(cs, "Ce code n'est pas valide.") };
      return { async: async () => { for (const ev of simu.complete(cs.id, code ? { code } : {})) await deliver(ev); return cs.success_url.replace("{CHECKOUT_SESSION_ID}", cs.id); } };
    }
    if ((m = path.match(/^\/portail\/([^/]+)$/)) && method === "GET") {
      const p = st.portals.get(m[1]);
      if (!p) return { status: 404, html: page("Introuvable", "<h1>Session inconnue</h1>") };
      const sub = [...st.subs.values()].reverse().find((s) => s.customer === p.customer && s.status !== "canceled");
      const inv = [...st.invoices.values()].filter((i) => i.customer === p.customer);
      const flow = p.flow?.type ?? null;
      return { html: page("Portail (simulateur)", `<h1>${flow === "subscription_cancel" ? "Résilier l'abonnement" : flow === "payment_method_update" ? "Moyen de paiement" : "Ton abonnement"}</h1>
<div class="box"><p>Carte de test •••• 4242</p>${flow === "payment_method_update" ? `<form method="post" action="/portail/${p.id}/carte"><button data-simu="carte">Remplacer la carte (simulation)</button></form>` : ""}</div>
${sub && flow !== "payment_method_update" ? `<div class="box"><p>Abonnement : ${sub.status}${sub.cancel_at_period_end ? " (résilié à l'échéance)" : ""}</p>
<form method="post" action="/portail/${p.id}/resilier"><button data-simu="resilier">Résilier à la fin de la période</button></form></div>` : ""}
<div class="box"><p>Factures : ${inv.length}</p>${inv.map((i) => `<p>${i.number} — ${eur(i.total)} — ${i.status}</p>`).join("")}</div>
<a class="b sec" href="${p.return_url}" data-simu="retour">Retour</a>`) };
    }
    if ((m = path.match(/^\/portail\/([^/]+)\/(resilier|carte)$/)) && method === "POST") {
      const p = st.portals.get(m[1]);
      return { async: async () => {
        if (m[2] === "resilier") {
          const sub = [...st.subs.values()].reverse().find((s) => s.customer === p.customer && s.status !== "canceled");
          if (sub) { sub.cancel_at_period_end = true; await deliver(emit("customer.subscription.updated", subView(sub))); }
          return p.flow?.after_completion?.redirect?.return_url ?? p.return_url;
        }
        return p.return_url;
      } };
    }
    return null;
  }

  // ---- serveur ---------------------------------------------------------------------------------------------------
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://simulateur.local");
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const text = Buffer.concat(chunks).toString("utf8");
    st.calls.push({ method: req.method, path: url.pathname, idem: req.headers["idempotency-key"] ?? null, auth: (req.headers.authorization ?? "").startsWith("Bearer sk_test_") || (req.headers.authorization ?? "").startsWith("Bearer rk_test_") });
    const send = (status, type, out) => { res.writeHead(status, { "content-type": type }); res.end(out); };
    // Pages du navigateur.
    const h = html(req.method, url.pathname, text);
    if (h) {
      if (h.async) { const to = await h.async(); res.writeHead(303, { location: to }); res.end(); return; }
      return send(h.status ?? 200, "text/html; charset=utf-8", h.html);
    }
    // Commandes de simulation (essais de bout en bout).
    let m;
    if ((m = url.pathname.match(/^\/__simu\/(echeance|echec|impaye|remboursement|litige|litige-clos|expirer|achat-remboursement|achat-litige|achat-litige-clos)\/([^/]+)$/)) && req.method === "POST") {
      const id = m[2];
      const statut = url.searchParams.get("statut") ?? "won";
      const evs = m[1] === "echeance" ? simu.endPeriod(id) : m[1] === "echec" ? simu.failRenewal(id) : m[1] === "impaye" ? simu.unpaid(id)
        : m[1] === "remboursement" ? simu.refundLatest(id) : m[1] === "litige" ? simu.dispute(id) : m[1] === "litige-clos" ? simu.dispute(id, statut, "charge.dispute.closed")
        : m[1] === "expirer" ? simu.expire(id) : m[1] === "achat-remboursement" ? simu.refundPurchase(id)
        : m[1] === "achat-litige" ? simu.disputePurchase(id) : simu.disputePurchase(id, statut, "charge.dispute.closed");
      const results = [];
      for (const ev of evs) results.push({ type: ev.type, ...(await deliver(ev)) });
      return send(200, "application/json", JSON.stringify({ evenements: results }));
    }
    if (url.pathname === "/__simu/etat") {
      return send(200, "application/json", JSON.stringify({ abonnements: [...st.subs.values()].map((s) => ({ id: s.id, status: s.status, prix: s.items.data[0].price.id, resilie: s.cancel_at_period_end, echeancier: s.schedule })),
        achats: [...st.sessions.values()].filter((cs) => cs.mode === "payment").map((cs) => ({ session: cs.id, statut: cs.status, paye: cs.payment_status })),
        remboursements: [...st.refunds.values()].map((r) => ({ montant: r.amount, motif: r.reason })), evenements: st.events.length }));
    }
    // API (clé de test exigée, comme l'API de Stripe exige une clé).
    if (!url.pathname.startsWith("/v1/")) return send(404, "text/plain", "inconnu");
    if (!st.calls.at(-1).auth) return send(401, "application/json", JSON.stringify({ error: { type: "invalid_request_error", message: "Clé de test exigée par le simulateur" } }));
    if (st.down) return send(500, "application/json", JSON.stringify({ error: { type: "api_error", message: "panne simulée" } }));
    const key = req.headers["idempotency-key"];
    if (req.method === "POST" && key && st.idem.has(key)) { const r = st.idem.get(key); return send(r.status, "application/json", r.out); }
    const q = parseForm(url.search.slice(1));
    const b = req.method === "GET" ? {} : parseForm(text);
    const r = api(req.method, url.pathname, q, b);
    const out = JSON.stringify(r.body);
    if (req.method === "POST" && key) st.idem.set(key, { status: r.status ?? 200, out });
    send(r.status ?? 200, "application/json", out);
  });

  return {
    server, state: st, simu, emit, deliver,
    listen(port = 0, host = "127.0.0.1") {
      return new Promise((resolve) => server.listen(port, host, () => {
        const a = server.address();
        if (o.publicBase.endsWith(":0")) o.publicBase = `http://${host}:${a.port}`;
        resolve(a.port);
      }));
    },
    set webhookUrl(u) { o.webhookUrl = u; },
    close() { return new Promise((r) => server.close(() => r())); },
  };
}

// Lancement direct : simulateur pour la pile d'aperçu (docs/FACTURATION.md, « Essais de bout en bout »).
if (import.meta.url === `file://${process.argv[1]}`) {
  const env = process.env;
  const f = createFakeStripe({
    publicBase: env.PUBLIC_BASE ?? `http://127.0.0.1:${env.PORT ?? 12111}`,
    webhookUrl: env.WEBHOOK_URL ?? null,
    webhookSecret: env.WEBHOOK_SECRET,
    prices: { annuel: { id: env.PRICE_ANNUEL, amount: Number(env.AMOUNT_ANNUEL ?? 500), interval: "year" }, vie: { id: env.PRICE_VIE, amount: Number(env.AMOUNT_VIE ?? 2000) } },
  });
  await f.listen(Number(env.PORT ?? 12111), env.HOST ?? "0.0.0.0");
  console.log(`simulateur Stripe à l'écoute (${env.PORT ?? 12111})`);
}

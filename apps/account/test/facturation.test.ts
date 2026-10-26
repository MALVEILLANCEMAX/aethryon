// Facturation V2 (src/facturation.ts, migration 011, docs/FACTURATION.md) : Annuel (abonnement) et À vie (paiement
// unique). Le VRAI SDK « stripe » contre le simulateur local (fake-stripe.mjs) ; événements signés comme ceux de Stripe,
// livrés au webhook de l'API publique. Le simulateur valide NOTRE code (preuves, ordre, doublons, litiges…), pas Stripe.
// Couvert : configuration, paiement → droit (preuve exigée), retour non probant, prix de mauvais type, un seul contrat
// (doublons remboursés, deux onglets), À vie bloque l'annuel, annuel → À vie (renouvellement arrêté, jamais l'inverse),
// remboursement, litige (suspendu, rendu, perdu), page expirée, signature, rejeu, ordre, impayé, résiliation en ligne,
// rétractation (intégrale pour les deux offres, accusé complet), confirmation (CGV jointes, vendeur, médiateur, TVA) et
// rappel de reconduction (une fois, date limite la veille), commande hors de France (annulée, remboursée), rapprochement,
// suppression du compte, quotas communs à tous les accès, historique d'un an des offres payantes, facturation fermée.
// Delta du 2026-10-21 (docs/FACTURATION.md §16) : paramètres « Checkout Studio » exacts, codes promo (montant PAYÉ partout,
// renouvellement au prix du catalogue, 100 % À vie prouvé par la remise, France toujours contrôlée), carte refusée,
// déjà Premium, aucun droit sans abonnement, vente de Premium à vie coupable (BILLING_OFFRE_VIE=0).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkoutParamError, createFakeStripe, signature } from "./fake-stripe.mjs";
import { Browser, fakeMailer, harness, internalCall, newUser, type FakeMailer, type Harness } from "./helpers.ts";
import { CGV_VERSION, entitlementFor, purchaseRight, renewalDeadline, sessionGrantsLifetime, withdrawalRefund, WEBHOOK_PATH } from "../src/facturation.ts";
import { checkoutSessionParams } from "../src/checkout-params.ts";
import { ConfigError, loadBilling } from "../src/config.ts";

const WHSEC = "whsec_" + "essai".repeat(8);
const PRICES = { annuel: { id: "price_annuelEssai01", amount: 500, interval: "year" as const }, vie: { id: "price_vieEssai01", amount: 2000 } };
const SELLER = {
  BILLING_SELLER_NAME: "Vendeur d'essai", BILLING_SELLER_ADDRESS: "1 rue de l'Essai, 75000 Paris", BILLING_SELLER_EMAIL: "contact@example.test",
  BILLING_SELLER_PHONE: "01 23 45 67 89", BILLING_MEDIATOR: "Médiateur d'essai, 2 place de l'Essai, 75000 Paris, https://mediateur.example.test",
};
const VAT = "TVA non applicable, art. 293 B du CGI";
/** CGV publiées par le site (dist/legal/cgv.txt) : servies par un petit serveur local pendant les essais. */
const CGV_TEXT = `CONDITIONS GÉNÉRALES DE VENTE\n\nOffres Premium et Premium à vie d'AETHRYON. Version ${CGV_VERSION}, en vigueur à compter du 17 octobre 2026.\n\n1. QUI VEND\n`;
async function cgvServer(text = CGV_TEXT) {
  const srv = createServer((req, res) => {
    if (req.url === "/legal/cgv.txt") { res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }); res.end(text); return; }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/legal/cgv.txt`, close: () => new Promise<void>((r) => srv.close(() => r())) };
}

type Fake = ReturnType<typeof createFakeStripe>;
interface Env { h: Harness; fake: Fake; mails: FakeMailer; close(): Promise<void> }

async function setup(extra: Record<string, string> = {}, prices: Record<string, { id: string; amount: number; interval?: "year" | "month" }> = PRICES): Promise<Env> {
  const fake = createFakeStripe({ webhookSecret: WHSEC, prices });
  const port = await fake.listen();
  const cgv = await cgvServer();
  const dir = mkdtempSync(join(tmpdir(), "aethryon-facturation-"));
  const w = (n: string, v: string) => { const p = join(dir, n); writeFileSync(p, v, { mode: 0o600 }); return p; };
  const mails = fakeMailer();
  const h = await harness({
    BILLING: "test", STRIPE_SECRET_KEY_FILE: w("sk", "sk_test_simulateur0000000001"), STRIPE_WEBHOOK_SECRET_FILE: w("wh", WHSEC),
    STRIPE_PRICE_ANNUEL: PRICES.annuel.id, STRIPE_PRICE_VIE: PRICES.vie.id, STRIPE_API_BASE: `http://127.0.0.1:${port}`,
    PLANS_ACTIVE: "1", BILLING_TERMS_URL: cgv.url, ...SELLER, ...extra,
  }, { mailer: mails });
  return { h, fake, mails, async close() { h.close(); await fake.close(); await cgv.close(); } };
}

/** Livre des événements au webhook comme Stripe (corps brut signé). */
async function deliver(env: Env, events: { id: string }[], opts: { secret?: string; t?: number } = {}) {
  const out = [];
  for (const ev of events) {
    const payload = JSON.stringify(ev);
    const res = await env.h.s.publicApp.request(WEBHOOK_PATH, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signature(payload, opts.secret ?? WHSEC, opts.t) }, body: payload });
    out.push({ status: res.status, body: await res.json() as { outcome?: string; error?: string } });
  }
  return out;
}

const sessionOf = (url: string) => new URL(url).pathname.split("/").pop()!;
const pay = async (b: Browser, plan: "annuel" | "vie") => {
  const r = await b.json("/api/facturation/paiement", { method: "POST", body: { offre: plan, executionImmediate: true, cgv: CGV_VERSION } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return sessionOf(r.body.url);
};
/** Compte connecté qui paie une offre (page de paiement simulée), événements livrés. */
async function buy(env: Env, email: string, plan: "annuel" | "vie", b?: Browser, country?: string) {
  b = b ?? await newUser(env.h, email);
  const sessionId = await pay(b, plan);
  await deliver(env, env.fake.simu.complete(sessionId, country ? { country } : {}));
  const sub = plan === "annuel" ? [...env.fake.state.subs.values()].at(-1)! : null;
  return { b, sessionId, sub };
}
const state = async (b: Browser) => (await b.json("/api/facturation")).body;
const userId = (env: Env, email: string) => (env.h.s.db.prepare('SELECT id FROM "user" WHERE email = ?').get(email) as { id: string }).id;
const settle = () => new Promise((x) => setTimeout(x, 40));

test("configuration : fermée par défaut ; test exige une clé de TEST ; réel refusé sans clé réelle, sans confirmation, sans vendeur", () => {
  const dir = mkdtempSync(join(tmpdir(), "aethryon-conf-"));
  const w = (n: string, v: string) => { const p = join(dir, n); writeFileSync(p, v); return p; };
  const base = { STRIPE_WEBHOOK_SECRET_FILE: w("wh", WHSEC), STRIPE_PRICE_ANNUEL: PRICES.annuel.id, STRIPE_PRICE_VIE: PRICES.vie.id };
  assert.equal(loadBilling({}), null);
  assert.equal(loadBilling({ BILLING: "off" }), null);
  const live = w("live", "sk_live_" + "x".repeat(24)), testKey = w("test", "sk_test_" + "x".repeat(24));
  assert.throws(() => loadBilling({ ...base, BILLING: "test", STRIPE_SECRET_KEY_FILE: live }), ConfigError, "clé réelle en mode test");
  assert.throws(() => loadBilling({ ...base, BILLING: "live", STRIPE_SECRET_KEY_FILE: testKey }), ConfigError, "clé de test en mode réel");
  assert.throws(() => loadBilling({ ...base, BILLING: "live", STRIPE_SECRET_KEY_FILE: live, ...SELLER }), /décision du propriétaire/, "réel sans confirmation");
  assert.throws(() => loadBilling({ ...base, BILLING: "live", STRIPE_SECRET_KEY_FILE: live, BILLING_LIVE_CONFIRMED: "oui" }), /identité du vendeur/, "réel sans vendeur");
  const { BILLING_SELLER_PHONE: _phone, ...noPhone } = SELLER;
  assert.throws(() => loadBilling({ ...base, BILLING: "live", STRIPE_SECRET_KEY_FILE: live, BILLING_LIVE_CONFIRMED: "oui", ...noPhone, BILLING_VAT_MENTION: VAT }), /médiateur/, "réel sans téléphone");
  const { BILLING_MEDIATOR: _med, ...noMediator } = SELLER;
  assert.throws(() => loadBilling({ ...base, BILLING: "live", STRIPE_SECRET_KEY_FILE: live, BILLING_LIVE_CONFIRMED: "oui", ...noMediator, BILLING_VAT_MENTION: VAT }), /médiateur/, "réel sans médiateur");
  assert.throws(() => loadBilling({ ...base, BILLING: "live", STRIPE_SECRET_KEY_FILE: live, BILLING_LIVE_CONFIRMED: "oui", ...SELLER }), /mention de TVA/, "réel sans mention de TVA confirmée");
  assert.throws(() => loadBilling({ ...base, BILLING: "live", STRIPE_SECRET_KEY_FILE: live, BILLING_LIVE_CONFIRMED: "oui", ...SELLER, BILLING_SELLER_PHONE: "01\n02" , BILLING_VAT_MENTION: VAT }), /une ligne/);
  assert.throws(() => loadBilling({ ...base, BILLING: "live", STRIPE_SECRET_KEY_FILE: live, BILLING_LIVE_CONFIRMED: "oui", ...SELLER, BILLING_VAT_MENTION: VAT, STRIPE_API_BASE: "http://127.0.0.1:1" }), /simulateur/);
  const real = loadBilling({ ...base, BILLING: "live", STRIPE_SECRET_KEY_FILE: live, BILLING_LIVE_CONFIRMED: "oui", ...SELLER, BILLING_VAT_MENTION: VAT })!;
  assert.deepEqual([real.mode, real.seller?.phone, real.seller?.mediator, real.vatMention, real.termsUrl], ["live", SELLER.BILLING_SELLER_PHONE, SELLER.BILLING_MEDIATOR, VAT, null]);
  assert.throws(() => loadBilling({ ...base, BILLING: "test", STRIPE_SECRET_KEY_FILE: testKey, STRIPE_PRICE_VIE: PRICES.annuel.id }), /différer/);
  const ok = loadBilling({ ...base, BILLING: "test", STRIPE_SECRET_KEY_FILE: testKey })!;
  assert.deepEqual([ok.mode, ok.prices.annuel, ok.prices.vie, ok.seller, ok.vatMention], ["test", PRICES.annuel.id, PRICES.vie.id, null, VAT]);
});

test("droit d'un abonnement annuel (calcul pur) : actif, résilié à l'échéance, impayé dans et après le délai de grâce, terminé, litige", () => {
  const end = "2027-11-15T10:00:00.000Z";
  const now = new Date("2027-11-01T10:00:00Z");
  const s = (status: string, cancel = 0) => ({ status, plan: "annuel" as const, current_period_end: end, cancel_at_period_end: cancel });
  assert.deepEqual(entitlementFor(s("active"), null, 7, now), { endsAt: "2027-11-17T10:00:00.000Z", revoked: false }, "marge de renouvellement de 2 jours");
  assert.deepEqual(entitlementFor(s("active", 1), null, 7, now), { endsAt: end, revoked: false }, "résilié : jusqu'à l'échéance, sans marge");
  assert.equal(entitlementFor(s("past_due"), null, 7, new Date("2027-11-20T10:00:00Z")).revoked, false, "impayé : 5 jours après, encore dans le délai");
  assert.equal(entitlementFor(s("past_due"), null, 7, new Date("2027-11-23T10:00:00Z")).revoked, true, "impayé : délai de 7 jours dépassé");
  for (const st of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]) assert.equal(entitlementFor(s(st), null, 7, now).revoked, true, st);
  assert.equal(entitlementFor(s("active"), "litige", 7, now).revoked, true, "litige : suspendu");
  assert.equal(entitlementFor({ ...s("active"), plan: null }, null, 7, now).revoked, true, "prix inconnu : jamais de droit");
});

test("droit d'un achat À vie (calcul pur) : permanent ; remboursement total ou litige perdu le retirent, litige en cours le suspend", () => {
  const p = (refunded: number, dispute: string | null, plan: "vie" | null = "vie") => purchaseRight({ plan, amount: 2000, refunded_amount: refunded, dispute_status: dispute });
  assert.deepEqual(p(0, null), { revoked: false, etat: "actif" });
  assert.deepEqual(p(500, null), { revoked: false, etat: "actif" }, "remboursement partiel (geste) : le droit reste");
  assert.deepEqual(p(2000, null), { revoked: true, etat: "rembourse" });
  for (const d of ["needs_response", "under_review", "warning_needs_response", "warning_under_review"]) assert.deepEqual(p(0, d), { revoked: true, etat: "suspendu" }, d);
  assert.deepEqual(p(0, "won"), { revoked: false, etat: "actif" }, "litige gagné : rendu");
  assert.deepEqual(p(0, "warning_closed"), { revoked: false, etat: "actif" });
  assert.deepEqual(p(0, "lost"), { revoked: true, etat: "retire" });
  assert.deepEqual(p(0, null, null), { revoked: true, etat: "retire" }, "prix inconnu : jamais de droit");
});

test("rétractation (calcul pur) : prorata de l'année avec demande expresse ; tout sans elle", () => {
  const start = 1_000_000, end = start + 365 * 86_400;
  assert.equal(withdrawalRefund(500, start, end, start + 3 * 86_400, true), 496, "3 jours sur 365");
  assert.equal(withdrawalRefund(500, start, end, start, true), 500);
  assert.equal(withdrawalRefund(500, start, end, end + 10, true), 0);
  assert.equal(withdrawalRefund(500, start, end, start + 3 * 86_400, false), 500, "sans demande expresse : tout est remboursé");
});

test("Annuel : page Stripe hébergée (abonnement d'un an), client unique, consentement exigé, droit, quotas, confirmation une fois", async () => {
  const env = await setup();
  try {
    const b = await newUser(env.h, "annuel@example.test");
    const refus = await b.json("/api/facturation/paiement", { method: "POST", body: { offre: "annuel", cgv: CGV_VERSION } });
    assert.deepEqual([refus.status, refus.body.error], [400, "consent_required"]);
    const sansCgv = await b.json("/api/facturation/paiement", { method: "POST", body: { offre: "annuel", executionImmediate: true } });
    assert.deepEqual([sansCgv.status, sansCgv.body.error], [400, "terms_required"], "CGV non acceptées");
    const vieilles = await b.json("/api/facturation/paiement", { method: "POST", body: { offre: "annuel", executionImmediate: true, cgv: "0.9" } });
    assert.deepEqual([vieilles.status, vieilles.body.error], [409, "terms_changed"], "version des CGV différente de celle publiée");
    assert.equal(env.fake.state.sessions.size, 0, "rien chez Stripe sans la demande expresse ni les CGV en vigueur");
    const sessionId = await pay(b, "annuel");
    const cs = env.fake.state.sessions.get(sessionId);
    assert.deepEqual([cs.mode, cs.client_reference_id, cs.metadata.aethryon_plan, cs.metadata.execution_immediate, cs.metadata.cgv], ["subscription", userId(env, "annuel@example.test"), "annuel", "v3-2026-10-16", CGV_VERSION]);
    assert.deepEqual([cs.allowed_payment_method_types, cs.billing_address_collection], [["card"], "auto"], "carte seulement, adresse de facturation selon Checkout Studio");
    const consent = env.h.s.db.prepare("SELECT text_version FROM ytc_billing_consent WHERE user_id = ?").get(userId(env, "annuel@example.test")) as { text_version: string };
    assert.equal(consent.text_version, `v3-2026-10-16+cgv-${CGV_VERSION}`, "demande expresse et version des CGV enregistrées avant le paiement");
    assert.ok(cs.expires_at - Math.floor(Date.now() / 1000) <= 30 * 60 + 5, "page de paiement valable 30 min");
    assert.match(cs._custom.submit.message, /Abonnement annuel de 5,00\s€, renouvelé automatiquement/);
    assert.equal((await state(b)).offre.id, "free", "avant le paiement : Gratuit");
    const out = await deliver(env, env.fake.simu.complete(sessionId));
    assert.deepEqual(out.map((x) => x.status), [200, 200, 200]);
    const s = await state(b);
    assert.equal(s.offre.id, "annuel");
    assert.equal(s.abonnement.etat, "actif");
    const year = Date.parse(s.abonnement.renouvellement) - Date.now();
    assert.ok(year > 364 * 86_400_000 && year < 366 * 86_400_000, "renouvellement dans un an");
    assert.deepEqual(s.prix, { annuel: { montant: 500, devise: "eur", type: "annuel" }, vie: { montant: 2000, devise: "eur", type: "unique" } }, "prix RÉELS lus chez Stripe");
    assert.equal(s.retractation.contrat, "annuel");
    assert.equal((await b.json("/api/me")).body.today.limit, 40, "quotas d'Annuel");
    assert.equal(env.fake.state.customers.size, 1);
    assert.ok(env.fake.state.calls.filter((c) => c.method === "POST" && c.path.startsWith("/v1/")).every((c) => c.idem), "clé d'idempotence sur chaque création");
    // Confirmation du contrat (L221-13) : une seule, même si les événements sont rejoués ou relus.
    await env.h.s.billing.reconcile();
    await settle();
    const conf = env.mails.sent.filter((m) => m.subject.startsWith("Confirmation"));
    assert.equal(conf.length, 1);
    assert.match(conf[0]!.text, /renouvelé automatiquement chaque année/);
    assert.match(conf[0]!.text, /Abonnement annuel de 5,00\s€ \(TVA non applicable, art\. 293 B du CGI\)/, "mention de TVA, jamais « TTC » seul");
    assert.doesNotMatch(conf[0]!.text, /TTC/);
    assert.match(conf[0]!.text, /Formulaire de rétractation/);
    assert.match(conf[0]!.text, /Vendeur d'essai, 1 rue de l'Essai, 75000 Paris, contact@example\.test, 01 23 45 67 89/);
    assert.match(conf[0]!.text, /Médiateur de la consommation .*Médiateur d'essai, 2 place de l'Essai/);
    assert.match(conf[0]!.text, /remboursé en totalité/);
    // CGV jointes (support durable, L221-13) : le texte publié par le site, tel quel.
    assert.equal(conf[0]!.attachments?.length, 1);
    assert.equal(conf[0]!.attachments![0]!.filename, `CGV-AETHRYON-v${CGV_VERSION}.txt`);
    assert.equal(conf[0]!.attachments![0]!.content.toString("utf8"), CGV_TEXT);
    assert.match(conf[0]!.text, new RegExp(`version ${CGV_VERSION.replace(".", "\\.")}, jointes à cet e-mail`));
  } finally { await env.close(); }
});

test("À vie : paiement unique (mode payment), droit permanent sans abonnement, quotas, confirmation sans renouvellement", async () => {
  const env = await setup();
  try {
    const b = await newUser(env.h, "vie@example.test");
    const sessionId = await pay(b, "vie");
    const cs = env.fake.state.sessions.get(sessionId);
    assert.deepEqual([cs.mode, cs.submit_type, cs.metadata.aethryon_plan], ["payment", "auto", "vie"]);
    assert.match(cs._custom.submit.message, /Paiement unique de 20,00\s€, sans abonnement ni renouvellement/);
    assert.equal((await state(b)).offre.id, "free");
    await deliver(env, env.fake.simu.complete(sessionId));
    const s = await state(b);
    assert.equal(s.offre.id, "vie");
    assert.equal(s.abonnement, null, "aucun abonnement");
    assert.deepEqual([s.vie.etat, s.vie.montant, s.vie.reference], ["actif", 2000, sessionId]);
    assert.equal(s.retractation.contrat, "vie");
    assert.equal((await b.json("/api/me")).body.today.limit, 40);
    assert.equal(env.fake.state.subs.size, 0);
    await settle();
    const conf = env.mails.sent.filter((m) => m.subject === "Confirmation : AETHRYON Premium à vie");
    assert.equal(conf.length, 1);
    assert.match(conf[0]!.text, /Paiement unique de 20,00\s€ \(TVA non applicable, art\. 293 B du CGI\), sans abonnement ni renouvellement/);
    assert.equal(conf[0]!.attachments?.[0]?.filename, `CGV-AETHRYON-v${CGV_VERSION}.txt`);
    assert.match(conf[0]!.text, /ni stockage, ni trafic, ni calcul illimités/);
    // Historique : le reçu de Stripe (lien hébergé).
    const f = (await b.json("/api/facturation/factures")).body.factures;
    assert.equal(f.length, 1);
    assert.deepEqual([f[0].objet, f[0].montant, f[0].statut], ["Premium à vie", 2000, "paid"]);
    assert.match(f[0].lien, /\/recu\/ch_/);
  } finally { await env.close(); }
});

test("preuve exigée : retour sans paiement → rien ; session d'un autre compte refusée ; paiement sans webhook → le retour relit Stripe", async () => {
  const env = await setup();
  try {
    const a = await newUser(env.h, "a@example.test");
    const other = await newUser(env.h, "b@example.test");
    const sessionId = await pay(a, "vie");
    assert.equal((await a.json("/api/facturation/retour", { method: "POST", body: { session: sessionId } })).body.offre.id, "free", "session ouverte : aucun droit");
    assert.equal((await other.json("/api/facturation/retour", { method: "POST", body: { session: sessionId } })).status, 404);
    env.fake.simu.complete(sessionId); // payé chez Stripe, webhook PAS reçu
    assert.equal((await a.json("/api/facturation/retour", { method: "POST", body: { session: sessionId } })).body.offre.id, "vie");
    assert.equal((await state(other)).offre.id, "free");
  } finally { await env.close(); }
});

test("prix de mauvais type chez Stripe (À vie récurrent) : vente de l'offre fermée, aucun paiement possible", async () => {
  const env = await setup({}, { annuel: PRICES.annuel, vie: { id: PRICES.vie.id, amount: 2000, interval: "month" } });
  try {
    const b = await newUser(env.h, "prix@example.test");
    const r = await b.json("/api/facturation/paiement", { method: "POST", body: { offre: "vie", executionImmediate: true, cgv: CGV_VERSION } });
    assert.deepEqual([r.status, r.body.error], [503, "offer_unavailable"]);
    assert.equal(env.fake.state.sessions.size, 0);
    assert.equal((await state(b)).prix.vie, null, "le prix n'est pas affiché");
  } finally { await env.close(); }
});

test("À vie une seule fois : second achat refusé ; deux onglets payés → le second remboursé ; À vie bloque l'annuel", async () => {
  const env = await setup();
  try {
    const { b } = await buy(env, "une@example.test", "vie");
    for (const plan of ["vie", "annuel"]) {
      const r = await b.json("/api/facturation/paiement", { method: "POST", body: { offre: plan, executionImmediate: true, cgv: CGV_VERSION } });
      assert.deepEqual([r.status, r.body.error], [409, "already_lifetime"], plan);
    }
    // Course : deux pages ouvertes avant tout paiement (fenêtres de 10 min différentes), payées toutes les deux.
    const c = await newUser(env.h, "onglets@example.test");
    const s1 = await pay(c, "vie");
    env.fake.state.idem.clear(); // seconde page dans une autre fenêtre de 10 min (clé d'idempotence différente)
    const s2 = await pay(c, "vie");
    assert.notEqual(s1, s2);
    await deliver(env, env.fake.simu.complete(s1));
    await new Promise((x) => setTimeout(x, 1100));
    await deliver(env, env.fake.simu.complete(s2));
    const dup = [...env.fake.state.refunds.values()].filter((r) => r.reason === "duplicate");
    assert.equal(dup.length, 1, "le second paiement est remboursé");
    assert.equal(dup[0]!.amount, 2000);
    const s = await state(c);
    assert.deepEqual([s.offre.id, s.vie.reference], ["vie", s1], "le premier achat reste");
    // Double clic : même page de paiement (même clé d'idempotence dans la fenêtre de 10 min).
    const d = await newUser(env.h, "doubleclic@example.test");
    assert.equal(await pay(d, "vie"), await pay(d, "vie"));
  } finally { await env.close(); }
});

test("Annuel → À vie : renouvellement de l'annuel arrêté (période gardée, rien de prélevé ensuite) ; reprise refusée ; jamais l'inverse", async () => {
  const env = await setup();
  try {
    const { b, sub } = await buy(env, "monte@example.test", "annuel");
    const sessionId = await pay(b, "vie");
    assert.match(env.fake.state.sessions.get(sessionId)._custom.submit.message, /abonnement annuel ne sera pas renouvelé/);
    await deliver(env, env.fake.simu.complete(sessionId));
    const s = await state(b);
    assert.equal(s.offre.id, "vie");
    assert.deepEqual([s.abonnement.etat, s.abonnement.arretParVie], ["resilie", true]);
    assert.equal(env.fake.state.subs.get(sub!.id).cancel_at_period_end, true, "chez Stripe : plus de renouvellement");
    assert.equal(env.fake.state.subs.get(sub!.id).metadata.aethryon_arret, "vie");
    const r = await b.json("/api/facturation/reprendre", { method: "POST" });
    assert.deepEqual([r.status, r.body.error], [409, "already_lifetime"]);
    await deliver(env, env.fake.simu.endPeriod(sub!.id));
    const after = await state(b);
    assert.deepEqual([after.offre.id, after.abonnement.etat], ["vie", "termine"], "l'annuel se termine, À vie reste");
    assert.equal([...env.fake.state.invoices.values()].filter((i) => i.billing_reason === "subscription_cycle").length, 0, "aucun renouvellement prélevé");
  } finally { await env.close(); }
});

test("annuel payé APRÈS l'achat À vie (pages ouvertes avant) : résilié et remboursé, À vie intact", async () => {
  const env = await setup();
  try {
    const b = await newUser(env.h, "apres@example.test");
    const annual = await pay(b, "annuel");
    const life = await pay(b, "vie");
    await deliver(env, env.fake.simu.complete(life));
    await new Promise((x) => setTimeout(x, 1100));
    await deliver(env, env.fake.simu.complete(annual));
    const sub = [...env.fake.state.subs.values()].at(-1)!;
    assert.equal(sub.status, "canceled");
    assert.equal([...env.fake.state.refunds.values()].filter((r) => r.reason === "duplicate" && r.amount === 500).length, 1);
    assert.equal((await state(b)).offre.id, "vie");
  } finally { await env.close(); }
});

test("À vie : remboursement total → retiré ; partiel → gardé ; litige ouvert → suspendu, gagné → rendu, perdu → retiré", async () => {
  const env = await setup();
  try {
    const one = await buy(env, "rembourse@example.test", "vie");
    const part = env.fake.simu.refundPurchase(one.sessionId, 500);
    assert.equal((await deliver(env, part))[0]!.body.outcome, "achat_relu");
    assert.equal((await state(one.b)).offre.id, "vie", "geste partiel : le droit reste");
    await deliver(env, env.fake.simu.refundPurchase(one.sessionId));
    const s1 = await state(one.b);
    assert.deepEqual([s1.offre.id, s1.vie.etat], ["free", "rembourse"]);
    const two = await buy(env, "litige@example.test", "vie");
    assert.equal((await deliver(env, env.fake.simu.disputePurchase(two.sessionId)))[0]!.body.outcome, "litige_ouvert");
    let s = await state(two.b);
    assert.deepEqual([s.offre.id, s.vie.etat], ["free", "suspendu"]);
    assert.equal((await deliver(env, env.fake.simu.disputePurchase(two.sessionId, "won", "charge.dispute.closed")))[0]!.body.outcome, "litige_leve");
    s = await state(two.b);
    assert.deepEqual([s.offre.id, s.vie.etat], ["vie", "actif"], "litige gagné : droit rendu");
    const three = await buy(env, "perdu@example.test", "vie");
    await deliver(env, env.fake.simu.disputePurchase(three.sessionId));
    assert.equal((await deliver(env, env.fake.simu.disputePurchase(three.sessionId, "lost", "charge.dispute.closed")))[0]!.body.outcome, "litige_perdu");
    s = await state(three.b);
    assert.deepEqual([s.offre.id, s.vie.etat], ["free", "retire"]);
  } finally { await env.close(); }
});

test("page de paiement expirée ou abandonnée : aucun droit ; un nouvel essai reste possible", async () => {
  const env = await setup();
  try {
    const b = await newUser(env.h, "expire@example.test");
    const sessionId = await pay(b, "vie");
    assert.equal((await deliver(env, env.fake.simu.expire(sessionId)))[0]!.body.outcome, "synchronise");
    assert.equal((await state(b)).offre.id, "free");
    env.fake.state.idem.clear();
    const again = await pay(b, "vie");
    assert.notEqual(again, sessionId);
  } finally { await env.close(); }
});

test("webhook : signature fausse ou périmée refusée ; rejeu appliqué une fois ; ordre indifférent ; contenu mensonger ignoré", async () => {
  const env = await setup();
  try {
    const b = await newUser(env.h, "ordre@example.test");
    const evs = env.fake.simu.complete(await pay(b, "annuel"));
    assert.equal((await deliver(env, [evs[0]!], { secret: "whsec_" + "faux".repeat(8) }))[0]!.status, 400, "mauvaise signature");
    assert.equal((await deliver(env, [evs[0]!], { t: Math.floor(Date.now() / 1000) - 600 }))[0]!.status, 400, "horodatage de 10 min : rejeu refusé");
    assert.equal((await state(b)).offre.id, "free");
    const out = await deliver(env, [evs[2]!, evs[1]!, evs[0]!]);
    assert.deepEqual(out.map((x) => x.body.outcome), ["synchronise", "synchronise", "synchronise"]);
    assert.equal((await state(b)).offre.id, "annuel");
    assert.equal((await deliver(env, [evs[0]!]))[0]!.body.outcome, "deja");
    const sub = [...env.fake.state.subs.values()][0]!;
    await deliver(env, [env.fake.emit("customer.subscription.deleted", { ...sub, status: "canceled" })]);
    assert.equal((await state(b)).offre.id, "annuel", "l'état vient de Stripe, pas du contenu de l'événement");
    // Achat À vie : événement « payé » mensonger sur une session ouverte → aucun droit.
    const c = await newUser(env.h, "mensonge@example.test");
    const open = await pay(c, "vie");
    const cs = env.fake.state.sessions.get(open);
    await deliver(env, [env.fake.emit("checkout.session.completed", { ...cs, status: "complete", payment_status: "paid" })]);
    assert.equal((await state(c)).offre.id, "free");
    await settle();
    assert.equal(env.mails.sent.filter((m) => m.subject.startsWith("Confirmation")).length, 1, "une seule confirmation (l'annuel)");
  } finally { await env.close(); }
});

test("Annuel impayé : accès pendant le délai de grâce, puis Gratuit ; relances épuisées (unpaid) : Gratuit", async () => {
  const env = await setup({ BILLING_GRACE_DAYS: "0" });
  try {
    const { b, sub } = await buy(env, "impaye@example.test", "annuel");
    await deliver(env, env.fake.simu.failRenewal(sub!.id));
    const s = await state(b);
    assert.equal(s.abonnement.etat, "impaye");
    assert.equal(s.offre.id, "free", "délai de grâce nul : coupé");
  } finally { await env.close(); }
  const env2 = await setup({ BILLING_GRACE_DAYS: "7" });
  try {
    const x = await buy(env2, "grace@example.test", "annuel");
    await deliver(env2, env2.fake.simu.failRenewal(x.sub!.id));
    assert.equal((await state(x.b)).offre.id, "annuel", "7 jours de grâce pendant les relances de Stripe");
    await deliver(env2, env2.fake.simu.unpaid(x.sub!.id));
    assert.equal((await state(x.b)).offre.id, "free");
  } finally { await env2.close(); }
});

test("Annuel : résiliation en ligne (accusé avec la date de fin et la référence), accès jusqu'à l'échéance, reprise, puis Gratuit", async () => {
  const env = await setup();
  try {
    const { b, sub } = await buy(env, "resilie@example.test", "annuel");
    assert.equal((await b.json("/api/facturation/resilier", { method: "POST", body: {} })).status, 400, "confirmation exigée");
    const r = await b.json("/api/facturation/resilier", { method: "POST", body: { confirme: true } });
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.abonnement.etat, r.body.offre.id], ["resilie", "annuel"]);
    await settle();
    const mail = env.mails.sent.find((m) => m.subject.startsWith("Résiliation"))!;
    assert.match(mail.text, /reste active jusqu'au \d{1,2} \S+ 20\d\d/);
    assert.match(mail.text, new RegExp(`référence ${sub!.id}`));
    const acks = () => env.mails.sent.filter((m) => m.subject.startsWith("Résiliation")).length;
    await deliver(env, env.fake.simu.portalCancel(sub!.id)); // l'événement de Stripe arrive ensuite : pas de second accusé
    await env.h.s.billing.reconcile();
    await settle();
    assert.equal(acks(), 1, "un seul accusé pour une résiliation");
    assert.equal((await b.json("/api/facturation/reprendre", { method: "POST" })).body.abonnement.etat, "actif");
    // Résiliation faite dans le portail de Stripe : accusé aussi (L215-1-1), une fois, même si l'événement est rejoué.
    const portal = env.fake.simu.portalCancel(sub!.id);
    await deliver(env, portal);
    await deliver(env, portal);
    await settle();
    assert.equal(acks(), 2, "résiliation depuis le portail : accusé envoyé une fois");
    assert.equal((await state(b)).abonnement.etat, "resilie");
    await deliver(env, env.fake.simu.portalCancel(sub!.id, false)); // reprise depuis le portail
    assert.equal((await state(b)).abonnement.etat, "actif");
    await b.json("/api/facturation/resilier", { method: "POST", body: { confirme: true } });
    await deliver(env, env.fake.simu.endPeriod(sub!.id));
    const s = await state(b);
    assert.deepEqual([s.offre.id, s.abonnement.etat], ["free", "termine"]);
    // À vie n'a rien à résilier.
    const v = await buy(env, "vie-resilie@example.test", "vie");
    assert.equal((await v.b.json("/api/facturation/resilier", { method: "POST", body: { confirme: true } })).body.error, "no_subscription");
  } finally { await env.close(); }
});

test("rétractation sous 14 jours : Annuel et À vie remboursés en entier ; accusés complets (nom, contrat, référence, date et heure) ; refusée après 14 jours", async () => {
  const env = await setup();
  try {
    const a = await buy(env, "retracte-annuel@example.test", "annuel");
    const r = await a.b.json("/api/facturation/retracter", { method: "POST", body: { confirme: true } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.offre.id, "free");
    const ra = [...env.fake.state.refunds.values()].find((x) => x.metadata?.aethryon_motif === "retractation")!;
    assert.equal(ra.amount, 500, "annuel : intégral (CGV 8.4), même avec la demande de démarrage immédiat");
    await settle();
    const ackA = env.mails.sent.find((m) => m.subject === "Rétractation de ton offre AETHRYON Premium enregistrée")!;
    assert.match(ackA.text, new RegExp(`se rétracte du contrat AETHRYON Premium, référence ${a.sub!.id}, conclu le `), "contenu de la déclaration");
    assert.match(ackA.text, /\(compte retracte-annuel@example\.test\)/);
    assert.match(ackA.text, /Nous avons bien reçu, le \d{1,2} \S+ \d{4} (à|,) \d{2}:\d{2}/, "date et heure de l'envoi");
    assert.match(ackA.text, /Remboursement : 5,00/);
    const v = await buy(env, "retracte-vie@example.test", "vie");
    const rv = await v.b.json("/api/facturation/retracter", { method: "POST", body: { confirme: true } });
    assert.equal(rv.status, 200, JSON.stringify(rv.body));
    assert.deepEqual([rv.body.offre.id, rv.body.vie.etat], ["free", "rembourse"]);
    const refunds = [...env.fake.state.refunds.values()].filter((x) => x.metadata?.aethryon_motif === "retractation");
    assert.equal(refunds.at(-1)!.amount, 2000, "À vie : intégral");
    await settle();
    assert.ok(env.mails.sent.some((m) => m.subject === "Rétractation de ton offre AETHRYON Premium à vie enregistrée" && /Remboursement : 20,00/.test(m.text)));
    const late = await buy(env, "tard@example.test", "vie");
    env.h.s.db.prepare("UPDATE ytc_billing_purchase SET paid_at = ? WHERE stripe_session_id = ?").run(new Date(Date.now() - 15 * 86_400_000).toISOString(), late.sessionId);
    const refus = await late.b.json("/api/facturation/retracter", { method: "POST", body: { confirme: true } });
    assert.deepEqual([refus.status, refus.body.error], [409, "withdrawal_expired"]);
    assert.equal((await state(late.b)).retractation, null);
  } finally { await env.close(); }
});

test("rappel de reconduction (L215-1) : e-mail dédié avec encadré, date limite la veille, une fois par échéance, seulement entre 60 et 33 jours avant", async () => {
  const env = await setup();
  try {
    const { sub } = await buy(env, "rappel@example.test", "annuel");
    const at = (days: number) => env.h.s.db.prepare("UPDATE ytc_billing_subscription SET current_period_end = ? WHERE stripe_subscription_id = ?").run(new Date(Date.now() + days * 86_400_000).toISOString(), sub!.id);
    const notices = () => env.mails.sent.filter((m) => m.subject.startsWith("Ton abonnement AETHRYON Premium se renouvelle"));
    at(100);
    assert.equal(await env.h.s.billing.renewalNotices(), 0, "trop tôt (plus de 3 mois)");
    at(45);
    assert.equal(await env.h.s.billing.renewalNotices(), 1);
    assert.equal(await env.h.s.billing.renewalNotices(), 0, "une seule fois pour cette échéance");
    await settle();
    assert.equal(notices().length, 1);
    const end = (env.h.s.db.prepare("SELECT current_period_end AS e FROM ytc_billing_subscription WHERE stripe_subscription_id = ?").get(sub!.id) as { e: string }).e;
    assert.match(notices()[0]!.text, new RegExp(`refuser cette reconduction jusqu'au ${renewalDeadline(end)} inclus`), "la veille de l'échéance");
    assert.match(notices()[0]!.text, /au prix de 5,00\s€ \(TVA non applicable, art\. 293 B du CGI\)/);
    assert.match(notices()[0]!.html ?? "", /border:2px solid #b8925a/, "encadré apparent");
    at(32);
    env.h.s.db.prepare("UPDATE ytc_billing_subscription SET renewal_notice_for = NULL WHERE stripe_subscription_id = ?").run(sub!.id);
    assert.equal(await env.h.s.billing.renewalNotices(), 0, "trop tard (moins d'un mois avant la veille) : jamais envoyé hors délai");
  } finally { await env.close(); }
});

test("webhook manqué : le rapprochement relit Stripe et rattrape un achat À vie et un abonnement", async () => {
  const env = await setup();
  try {
    const a = await newUser(env.h, "rattrape@example.test");
    env.fake.simu.complete(await pay(a, "vie")); // événements jamais livrés
    const b = await newUser(env.h, "rattrape2@example.test");
    env.fake.simu.complete(await pay(b, "annuel"));
    assert.equal((await state(a)).offre.id, "free");
    const out = await env.h.s.billing.reconcile();
    assert.ok(out.evenements >= 5);
    assert.equal((await state(a)).offre.id, "vie");
    assert.equal((await state(b)).offre.id, "annuel");
    assert.equal((await env.h.s.billing.reconcile()).evenements, 0, "rien de neuf la seconde fois");
  } finally { await env.close(); }
});

test("suppression du compte : annuel résilié chez Stripe AVANT ; Stripe injoignable → refusée ; À vie seul : rien à arrêter", async () => {
  const env = await setup();
  try {
    const { b, sub } = await buy(env, "supprime@example.test", "annuel");
    env.fake.state.down = true;
    assert.notEqual((await b.req("/api/auth/delete-user", { method: "POST", body: {} })).status, 200);
    assert.ok(env.h.s.db.prepare('SELECT 1 FROM "user" WHERE email = ?').get("supprime@example.test"), "compte gardé");
    env.fake.state.down = false;
    assert.equal((await b.req("/api/auth/delete-user", { method: "POST", body: {} })).status, 200);
    assert.equal(env.fake.state.subs.get(sub!.id)!.status, "canceled");
    const v = await buy(env, "supprime-vie@example.test", "vie");
    env.fake.state.down = true;
    assert.equal((await v.b.req("/api/auth/delete-user", { method: "POST", body: {} })).status, 200, "aucun prélèvement futur à arrêter");
    env.fake.state.down = false;
    assert.equal(env.h.s.db.prepare("SELECT count(*) AS n FROM ytc_billing_purchase").get()!.n, 0, "effacé avec le compte (les reçus restent chez Stripe)");
  } finally { await env.close(); }
});

test("quotas : communs à tous les accès ; offre payante dans le raccourci, limites de Gratuit dans Discord (parité) ; plafond de 30 jours", async () => {
  const env = await setup();
  try {
    await buy(env, "quota@example.test", "vie");
    const uid = userId(env, "quota@example.test");
    const shortcut = await env.h.s.keys.create(uid, "iPhone", null);
    const discord = await env.h.s.keys.createDiscordKey(uid, "session");
    const job = (secret: string) => internalCall(env.h, "/internal/v1/authorize", { key: secret, action: "create_job", fmt: "mp4", platform: "tiktok" });
    for (let i = 0; i < 10; i++) assert.equal((await job(shortcut.secret)).status, 200);
    const d = await job(discord.secret);
    assert.deepEqual([d.body.allow, d.body.reason], [false, "quota_exceeded"], "Discord : limites de Gratuit (10)");
    const s = await job(shortcut.secret);
    assert.deepEqual([s.body.allow, s.body.limits.daily], [true, 40]);
    const ins = env.h.s.db.prepare("INSERT INTO ytc_usage (id, user_id, key_id, day, fmt, platform, state, created_at, updated_at) VALUES (?, ?, ?, ?, 'mp4', 'tiktok', 'done', ?, ?)");
    const t = new Date(Date.now() - 5 * 86_400_000).toISOString();
    for (let i = 0; i < 589; i++) ins.run(`vieux-${i}`, uid, shortcut.key.id, "2026-01-01", t, t);
    assert.equal((await job(shortcut.secret)).body.allow, false, "600 sur 30 jours atteints");
  } finally { await env.close(); }
});

test("quotas : DISCORD_PAID_BENEFITS=1 applique aussi l'offre dans Discord ; offres inactives : limites globales", async () => {
  const env = await setup({ DISCORD_PAID_BENEFITS: "1" });
  try {
    await buy(env, "discord@example.test", "annuel");
    const discord = await env.h.s.keys.createDiscordKey(userId(env, "discord@example.test"), "session");
    const r = await internalCall(env.h, "/internal/v1/authorize", { key: discord.secret, action: "access" });
    assert.equal(r.body.limits.daily, 40);
  } finally { await env.close(); }
  const env2 = await setup({ PLANS_ACTIVE: "0" });
  try {
    const { b } = await buy(env2, "inactif@example.test", "vie");
    assert.equal((await b.json("/api/me")).body.today.limit, 10, "PLANS_ACTIVE=0 : la limite globale reste");
  } finally { await env2.close(); }
});

test("facturation fermée (BILLING=off) : aucune route d'achat, webhook 404, état « indisponible », offre Gratuit", async () => {
  const h = await harness({});
  try {
    const b = await newUser(h, "ferme@example.test");
    const s = await b.json("/api/facturation");
    assert.deepEqual([s.body.disponible, s.body.offre.id, s.body.prix], [false, "free", { annuel: null, vie: null }]);
    assert.equal((await b.json("/api/facturation/paiement", { method: "POST", body: { offre: "vie", executionImmediate: true, cgv: CGV_VERSION } })).status, 404);
    const res = await h.s.publicApp.request(WEBHOOK_PATH, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=0" }, body: "{}" });
    assert.equal(res.status, 404);
    assert.equal((await b.json("/api/abonnement")).body.checkout, false);
  } finally { h.close(); }
});

test("ventes fermées (BILLING_SALES=fermees) : aucun nouvel achat ; facturation, webhooks et contrats en cours gardés", async () => {
  const env = await setup({ BILLING_SALES: "fermees" });
  try {
    const b = await newUser(env.h, "ventes-fermees@example.test");
    const st = await state(b);
    assert.equal(st.disponible, true, "la facturation reste ouverte pour les clients existants");
    assert.equal(st.vente, false, "aucun nouvel achat annoncé");
    const r = await b.json("/api/facturation/paiement", { method: "POST", body: { offre: "annuel", executionImmediate: true, cgv: CGV_VERSION } });
    assert.deepEqual([r.status, r.body.error], [403, "sales_closed"]);
    // Le webhook reste servi (signature vérifiée) : les renouvellements et remboursements des clients continuent d'arriver.
    const w = await env.h.s.publicApp.request(WEBHOOK_PATH, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=0" }, body: "{}" });
    assert.equal(w.status, 400, "webhook servi, signature vérifiée");
  } finally { await env.close(); }
});

test("date limite de non-reconduction (calcul pur) : la veille de l'échéance, heure de Paris, changements d'heure compris", () => {
  assert.equal(renewalDeadline("2027-11-15T10:00:00.000Z"), "14 novembre 2027");
  assert.equal(renewalDeadline("2027-11-15T23:30:00.000Z"), "15 novembre 2027", "00 h 30 le 16 à Paris : la veille est le 15");
  assert.equal(renewalDeadline("2027-03-28T00:30:00.000Z"), "27 mars 2027", "nuit du passage à l'heure d'été");
  assert.equal(renewalDeadline("2027-10-31T00:30:00.000Z"), "30 octobre 2027", "nuit du retour à l'heure d'hiver");
  assert.equal(renewalDeadline("2028-01-01T10:00:00.000Z"), "31 décembre 2027");
  assert.equal(renewalDeadline("2028-03-01T10:00:00.000Z"), "29 février 2028", "année bissextile");
});

test("commande hors de France métropolitaine : annulée et remboursée en totalité, aucun droit, un seul e-mail ; France : acceptée", async () => {
  const env = await setup();
  try {
    const v = await buy(env, "belgique@example.test", "vie", undefined, "BE");
    let s = await state(v.b);
    assert.equal(s.offre.id, "free", "aucun droit ouvert");
    const rv = [...env.fake.state.refunds.values()].filter((x) => x.metadata?.aethryon_motif === "hors_france");
    assert.deepEqual(rv.map((x) => x.amount), [2000], "À vie : remboursé en totalité");
    const a = await buy(env, "suisse@example.test", "annuel", undefined, "CH");
    s = await state(a.b);
    assert.equal(s.offre.id, "free");
    assert.equal(env.fake.state.subs.get(a.sub!.id)!.status, "canceled", "abonnement résilié tout de suite");
    assert.equal([...env.fake.state.refunds.values()].filter((x) => x.metadata?.aethryon_motif === "hors_france").length, 2, "annuel remboursé aussi");
    // Rejeu et rapprochement : rien de plus (ni remboursement, ni e-mail).
    await env.h.s.billing.reconcile();
    await settle();
    const refusals = env.mails.sent.filter((m) => /est annulée et remboursée/.test(m.subject));
    assert.equal(refusals.length, 2, "un e-mail par commande refusée");
    assert.match(refusals[0]!.text, /réservées aux résidents de France métropolitaine/);
    assert.equal(env.mails.sent.filter((m) => m.subject.startsWith("Confirmation")).length, 0, "jamais de confirmation de contrat");
    assert.equal([...env.fake.state.refunds.values()].filter((x) => x.metadata?.aethryon_motif === "hors_france").length, 2);
    const fr = await buy(env, "france@example.test", "vie", undefined, "FR");
    assert.equal((await state(fr.b)).offre.id, "vie", "adresse de facturation en France : droit ouvert");
  } finally { await env.close(); }
});

test("CGV introuvables sur le site : la commande reste possible (version du serveur) et la confirmation part quand même, avec le lien", async () => {
  const env = await setup({ BILLING_TERMS_URL: "http://127.0.0.1:9/legal/cgv.txt" });
  try {
    const v = await buy(env, "sans-cgv@example.test", "vie");
    assert.equal((await state(v.b)).offre.id, "vie");
    await settle();
    const conf = env.mails.sent.find((m) => m.subject === "Confirmation : AETHRYON Premium à vie")!;
    assert.equal(conf.attachments, undefined);
    assert.match(conf.text, /Conditions générales de vente : https?:\/\/\S+\/cgv\n/);
  } finally { await env.close(); }
});

test("historique : 90 jours pour Gratuit, 1 an pour un compte Annuel ou À vie actif (offres appliquées)", async () => {
  const env = await setup();
  try {
    await buy(env, "historique-vie@example.test", "vie");
    await newUser(env.h, "historique-gratuit@example.test");
    const ins = env.h.s.db.prepare("INSERT INTO ytc_usage (id, user_id, key_id, day, fmt, platform, state, created_at, updated_at) VALUES (?, ?, NULL, ?, 'mp4', 'youtube', 'done', ?, ?)");
    const old = (email: string, days: number) => {
      const t = new Date(Date.now() - days * 86_400_000).toISOString();
      ins.run(`u-${email}-${days}`, userId(env, email), t.slice(0, 10), t, t);
    };
    for (const e of ["historique-vie@example.test", "historique-gratuit@example.test"]) { old(e, 120); old(e, 400); }
    await env.h.s.usage.purge();
    const left = (email: string) => (env.h.s.db.prepare("SELECT id FROM ytc_usage WHERE user_id = ? ORDER BY id").all(userId(env, email)) as { id: string }[]).map((r) => r.id);
    assert.deepEqual(left("historique-vie@example.test"), ["u-historique-vie@example.test-120"], "payant : gardé 1 an");
    assert.deepEqual(left("historique-gratuit@example.test"), [], "Gratuit : 90 jours");
  } finally { await env.close(); }
});

// ---- delta du 2026-10-21 : codes promo, paramètres « Checkout Studio », scénarios du propriétaire ----------------------

const refundsBy = (env: Env, motif: string) => [...env.fake.state.refunds.values()].filter((x) => x.metadata?.aethryon_motif === motif).map((x) => x.amount as number);
const confirmations = (env: Env) => env.mails.sent.filter((m) => m.subject.startsWith("Confirmation"));

test("preuve d'un achat Premium à vie (calcul pur) : payée ; à 0 € seulement avec une remise réellement appliquée ; fin d'un achat sans paiement", () => {
  const cs = (payment_status: string, amount_total: number, amount_discount: number, status = "complete", mode = "payment") =>
    sessionGrantsLifetime({ mode, status, payment_status, amount_total, total_details: { amount_discount } } as never);
  assert.equal(cs("paid", 2000, 0), true, "payée");
  assert.equal(cs("paid", 660, 1340), true, "payée avec un code promo de 67 %");
  assert.equal(cs("no_payment_required", 0, 2000), true, "code promo de 100 % : remise appliquée");
  assert.equal(cs("no_payment_required", 0, 0), false, "0 € SANS remise : aucun droit");
  assert.equal(cs("no_payment_required", 100, 1900), false, "reste dû sans paiement : aucun droit");
  assert.equal(cs("unpaid", 2000, 0), false);
  assert.equal(cs("paid", 2000, 0, "open"), false, "page non terminée");
  assert.equal(cs("paid", 500, 0, "complete", "subscription"), false, "un abonnement n'est jamais un achat À vie");
  for (const m of ["retractation", "doublon", "hors_france"]) {
    assert.deepEqual(purchaseRight({ plan: "vie", amount: 0, refunded_amount: 0, dispute_status: m }), { revoked: true, etat: "retire" }, m);
  }
  assert.deepEqual(purchaseRight({ plan: "vie", amount: 0, refunded_amount: 0, dispute_status: null }), { revoked: false, etat: "actif" }, "0 € par une remise : actif");
});

test("page de paiement : paramètres « Checkout Studio » exacts (abonnement et paiement unique), écarts voulus gardés ; paramètre inconnu refusé", async () => {
  const env = await setup();
  try {
    const b = await newUser(env.h, "studio@example.test");
    const uid = userId(env, "studio@example.test");
    const annuel = env.fake.state.sessions.get(await pay(b, "annuel"));
    const p = annuel._params;
    const common = ["allow_promotion_codes", "allowed_payment_method_types", "automatic_tax", "billing_address_collection", "cancel_url", "client_reference_id",
      "custom_text", "customer", "expires_at", "integration_identifier", "line_items", "locale", "metadata", "mode", "origin_context", "phone_number_collection",
      "saved_payment_method_options", "submit_type", "success_url", "ui_mode"];
    assert.deepEqual(Object.keys(p).sort(), [...common, "payment_method_collection", "subscription_data"].sort(), "abonnement : ces paramètres, aucun autre");
    assert.deepEqual([p.ui_mode, p.integration_identifier, p.origin_context, p.submit_type, p.payment_method_collection, p.mode],
      ["hosted_page", "hosted_web_0001", "web", "auto", "always", "subscription"]);
    assert.deepEqual([p.allow_promotion_codes, p.phone_number_collection, p.automatic_tax, p.saved_payment_method_options],
      ["true", { enabled: "false" }, { enabled: "false" }, { payment_method_save: "enabled" }], "codes promo, téléphone non demandé, TVA automatique coupée, enregistrement proposé");
    // Adresse « auto » (Checkout Studio) ; écart voulu : carte seulement ; mode, retours et ligne du code.
    assert.deepEqual([p.billing_address_collection, p.allowed_payment_method_types, p.locale], ["auto", ["card"], "fr"]);
    assert.deepEqual(p.line_items, [{ price: PRICES.annuel.id, quantity: "1" }], "prix relu côté serveur");
    assert.match(p.success_url, /\/dashboard\/abonnement\?paiement=retour&session=\{CHECKOUT_SESSION_ID\}$/);
    assert.match(p.cancel_url, /\/dashboard\/abonnement\?paiement=annule$/);
    assert.deepEqual([p.client_reference_id, p.subscription_data.metadata.aethryon_user], [uid, uid]);
    assert.match(p.custom_text.submit.message, /Un code promo ne vaut que pour ce premier paiement : chaque renouvellement est au prix de 5,00\s€ par an\./);
    env.fake.state.idem.clear();
    const vie = env.fake.state.sessions.get(await pay(b, "vie"))._params;
    assert.deepEqual(Object.keys(vie).sort(), [...common, "payment_intent_data"].sort(), "paiement unique : sans payment_method_collection (abonnement seulement)");
    assert.deepEqual([vie.mode, vie.submit_type, vie.payment_intent_data.description], ["payment", "auto", "AETHRYON Premium à vie"]);
    // Le module partagé (banc du mode test réel) produit exactement ce que le serveur envoie.
    const shared = checkoutSessionParams({ plan: "annuel", priceId: PRICES.annuel.id, customer: annuel.customer, userId: uid, metadata: annuel.metadata,
      publicUrl: env.h.s.cfg.publicUrl, expiresAt: Number(p.expires_at), amountText: "5,00 €", promoCodes: true, automaticTax: false, requireTerms: false, invoiceOnce: false });
    assert.deepEqual(Object.keys(shared).sort(), Object.keys(p).sort());
    assert.equal(checkoutParamError({ ...p }), null);
    // Faute de frappe : refusée comme par l'API (et jamais une page créée).
    const stripe = env.h.s.billing.stripe!;
    const before = env.fake.state.sessions.size;
    await assert.rejects(stripe.checkout.sessions.create({ ...shared, alow_promotion_codes: true } as never), /unknown parameter: alow_promotion_codes/);
    await assert.rejects(stripe.checkout.sessions.create({ ...shared, ui_mode: "hosted" } as never), /Invalid ui_mode/);
    await assert.rejects(stripe.checkout.sessions.create({ ...shared, mode: "payment", line_items: [{ price: PRICES.vie.id, quantity: 1 }] } as never), /payment_method_collection can only be set in subscription mode/);
    await assert.rejects(stripe.checkout.sessions.create({ ...shared, saved_payment_method_options: { payment_method_sav: "enabled" } } as never), /unknown parameter: saved_payment_method_options\[payment_method_sav\]/);
    assert.equal(env.fake.state.sessions.size, before);
  } finally { await env.close(); }
  // Réglages : codes promo coupés, TVA automatique et case des conditions de Stripe activées, Premium à vie fermé.
  const env2 = await setup({ BILLING_PROMO_CODES: "0", BILLING_AUTOMATIC_TAX: "1", BILLING_REQUIRE_TERMS: "1", BILLING_OFFRE_VIE: "0" });
  try {
    const b = await newUser(env2.h, "reglages@example.test");
    const id = await pay(b, "annuel");
    const p = env2.fake.state.sessions.get(id)._params;
    assert.deepEqual([p.allow_promotion_codes, p.automatic_tax, p.customer_update, p.consent_collection],
      ["false", { enabled: "true" }, { address: "auto", name: "auto" }, { terms_of_service: "required" }]);
    assert.doesNotMatch(p.custom_text.submit.message, /code promo/);
    assert.throws(() => env2.fake.simu.complete(id, { code: "BIENVENUE67" }), /n'en accepte pas/, "codes promo coupés : la page n'en prend pas");
    const vie = await b.json("/api/facturation/paiement", { method: "POST", body: { offre: "vie", executionImmediate: true, cgv: CGV_VERSION } });
    assert.deepEqual([vie.status, vie.body.error], [503, "offer_unavailable"], "BILLING_OFFRE_VIE=0 : vente de Premium à vie fermée");
    const s = await state(b);
    assert.deepEqual([s.prix.vie, s.prix.annuel?.montant], [null, 500], "Premium reste en vente");
  } finally { await env2.close(); }
});

test("code promo sur Premium (67 %, une fois) : 1,65 € payés dans la confirmation, l'historique et la rétractation ; renouvellement annoncé et prélevé à 5,00 €", async () => {
  const env = await setup();
  try {
    // Abonnement avec code promo, puis renouvellement au prix plein.
    const b = await newUser(env.h, "promo-annuel@example.test");
    const id = await pay(b, "annuel");
    await deliver(env, env.fake.simu.complete(id, { code: "BIENVENUE67" }));
    let s = await state(b);
    assert.deepEqual([s.offre.id, s.offre.nom, s.abonnement.etat], ["annuel", "Premium", "actif"]);
    assert.equal(s.prix.annuel.montant, 500, "prix de l'offre (renouvellement) : celui du catalogue");
    await settle();
    const conf = confirmations(env);
    assert.equal(conf.length, 1);
    assert.equal(conf[0]!.subject, "Confirmation : AETHRYON Premium");
    assert.match(conf[0]!.text, /Abonnement annuel : 1,65\s€ \(TVA non applicable, art\. 293 B du CGI\) payés pour la première année, code promo compris, puis 5,00\s€ \(TVA non applicable, art\. 293 B du CGI\) par an, renouvelé automatiquement/);
    let f = (await b.json("/api/facturation/factures")).body.factures;
    assert.deepEqual(f.map((x: { montant: number }) => x.montant), [165], "historique : montant PAYÉ");
    const sub = [...env.fake.state.subs.values()].at(-1)!;
    const portal = await b.json("/api/facturation/portail", { method: "POST", body: { action: "accueil" } });
    assert.equal(portal.status, 200, "« Gérer mon abonnement » : accueil du portail");
    assert.equal([...env.fake.state.portals.values()].at(-1)!.flow, null, "aucun parcours imposé");
    // Rappel de reconduction : 5,00 € (coupon « once »).
    const row = env.h.s.billing.subscriptions(userId(env, "promo-annuel@example.test"))[0]!;
    assert.equal(await env.h.s.billing.renewalNotices(Date.parse(row.current_period_end!) - 45 * 86_400_000), 1);
    await settle();
    assert.match(env.mails.sent.find((m) => m.subject.startsWith("Ton abonnement AETHRYON Premium se renouvelle"))!.text, /au prix de 5,00\s€ \(TVA/);
    // Renouvellement (scénario 4) : facture de 5,00 €, droit prolongé d'un an, aucune nouvelle confirmation.
    const out = await deliver(env, env.fake.simu.endPeriod(sub.id));
    assert.deepEqual(out.map((x) => x.body.outcome), ["synchronise", "synchronise"]);
    s = await state(b);
    assert.equal(s.abonnement.etat, "actif");
    assert.ok(Date.parse(s.abonnement.renouvellement) - Date.now() > 364 * 86_400_000, "prochaine échéance dans un an");
    f = (await b.json("/api/facturation/factures")).body.factures;
    assert.deepEqual(f.map((x: { montant: number }) => x.montant).sort((x: number, y: number) => x - y), [165, 500], "renouvellement au prix plein");
    await settle();
    assert.equal(confirmations(env).length, 1, "une seule confirmation par contrat");
    // Rétractation : remboursement du montant PAYÉ (1,65 €), jamais du prix catalogue.
    const c = await newUser(env.h, "promo-retracte@example.test");
    const id2 = await pay(c, "annuel");
    await deliver(env, env.fake.simu.complete(id2, { code: "BIENVENUE67" }));
    const r = await c.json("/api/facturation/retracter", { method: "POST", body: { confirme: true } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.offre.id, "free");
    assert.deepEqual(refundsBy(env, "retractation"), [165], "remboursé : 1,65 €");
    await settle();
    assert.match(env.mails.sent.find((m) => m.subject === "Rétractation de ton offre AETHRYON Premium enregistrée" && m.to === "promo-retracte@example.test")!.text, /Remboursement : 1,65/);
  } finally { await env.close(); }
});

test("code promo sur Premium à vie : 67 % → 6,60 € payés et remboursés ; 100 % → droit sans paiement prouvé par la remise, rétractation sans remboursement ; 0 € sans remise et code invalide : aucun droit", async () => {
  const env = await setup();
  try {
    // 67 % : montant payé partout.
    const a = await newUser(env.h, "vie67@example.test");
    const ida = await pay(a, "vie");
    await deliver(env, env.fake.simu.complete(ida, { code: "BIENVENUE67" }));
    let s = await state(a);
    assert.deepEqual([s.offre.id, s.offre.nom, s.vie.montant], ["vie", "Premium à vie", 660]);
    await settle();
    assert.match(env.mails.sent.find((m) => m.to === "vie67@example.test" && m.subject === "Confirmation : AETHRYON Premium à vie")!.text,
      /Paiement unique de 6,60\s€ \(TVA non applicable, art\. 293 B du CGI\), code promo compris \(prix de l'offre : 20,00\s€\), sans abonnement ni renouvellement/);
    assert.deepEqual((await a.json("/api/facturation/factures")).body.factures.map((x: { montant: number }) => x.montant), [660]);
    assert.equal((await a.json("/api/facturation/retracter", { method: "POST", body: { confirme: true } })).body.offre.id, "free");
    assert.deepEqual(refundsBy(env, "retractation"), [660], "rétractation : le montant PAYÉ");
    // 100 % : no_payment_required, aucune charge ; droit accordé (remise réelle), une confirmation à 0 €.
    const z = await newUser(env.h, "vie100@example.test");
    const idz = await pay(z, "vie");
    const evs = env.fake.simu.complete(idz, { code: "OFFERT100" });
    const cs = env.fake.state.sessions.get(idz);
    assert.deepEqual([cs.payment_status, cs.amount_total, cs.total_details.amount_discount, cs.payment_intent], ["no_payment_required", 0, 2000, null]);
    assert.deepEqual((await deliver(env, evs)).map((x) => x.body.outcome), ["synchronise"]);
    assert.equal((await deliver(env, evs))[0]!.body.outcome, "deja", "webhook en double : appliqué une fois");
    s = await state(z);
    assert.deepEqual([s.offre.id, s.vie.montant, s.vie.etat], ["vie", 0, "actif"]);
    await settle();
    const conf0 = env.mails.sent.filter((m) => m.to === "vie100@example.test" && m.subject.startsWith("Confirmation"));
    assert.equal(conf0.length, 1);
    assert.match(conf0[0]!.text, /Paiement unique de 0,00\s€ \(TVA non applicable, art\. 293 B du CGI\), code promo compris \(prix de l'offre : 20,00\s€\)/);
    let f = (await z.json("/api/facturation/factures")).body.factures;
    assert.deepEqual(f.map((x: { montant: number; statut: string; lien: string | null }) => [x.montant, x.statut, x.lien]), [[0, "paid", null]], "historique : 0 €, aucun reçu chez Stripe");
    const nbRefunds = env.fake.state.refunds.size;
    const rz = await z.json("/api/facturation/retracter", { method: "POST", body: { confirme: true } });
    assert.equal(rz.status, 200, JSON.stringify(rz.body));
    assert.deepEqual([rz.body.offre.id, rz.body.vie.etat], ["free", "retire"], "rétractation : droit retiré");
    assert.equal(env.fake.state.refunds.size, nbRefunds, "rien à rembourser");
    await env.h.s.billing.reconcile();
    assert.equal((await state(z)).offre.id, "free", "la rétractation tient après une relecture complète");
    f = (await z.json("/api/facturation/factures")).body.factures;
    assert.deepEqual(f.map((x: { statut: string }) => x.statut), ["void"]);
    // 0 € SANS remise (session forgée) : aucun droit, ni par le retour ni par un événement.
    const x = await newUser(env.h, "forge0@example.test");
    const idx = await pay(x, "vie");
    env.fake.simu.patchSession(idx, { status: "complete", payment_status: "no_payment_required", amount_total: 0, total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 } });
    assert.equal((await x.json("/api/facturation/retour", { method: "POST", body: { session: idx } })).body.offre.id, "free", "retour : aucun droit");
    await deliver(env, [env.fake.emit("checkout.session.completed", { ...env.fake.state.sessions.get(idx), _params: undefined })]);
    assert.equal((await state(x)).offre.id, "free", "événement : aucun droit");
    // Code invalide : refusé par la page (Stripe juge), rien ne change ; le paiement au prix plein reste possible.
    const y = await newUser(env.h, "code-faux@example.test");
    const idy = await pay(y, "annuel");
    assert.throws(() => env.fake.simu.complete(idy, { code: "FAUX2026" }), /code promo invalide/);
    assert.deepEqual([env.fake.state.sessions.get(idy).status, (await state(y)).offre.id], ["open", "free"]);
    await deliver(env, env.fake.simu.complete(idy));
    assert.deepEqual((await y.json("/api/facturation/factures")).body.factures.map((v: { montant: number }) => v.montant), [500]);
  } finally { await env.close(); }
});

test("Premium à vie à 100 % avec une adresse hors de France : aucun droit, rien à rembourser, un seul e-mail", async () => {
  const env = await setup();
  try {
    const b = await newUser(env.h, "offert-belgique@example.test");
    const id = await pay(b, "vie");
    await deliver(env, env.fake.simu.complete(id, { code: "OFFERT100", country: "BE" }));
    assert.equal((await state(b)).offre.id, "free", "contrôle France appliqué même sans paiement");
    await env.h.s.billing.reconcile();
    await env.h.s.billing.reconcile();
    await settle();
    const mails = env.mails.sent.filter((m) => m.to === "offert-belgique@example.test");
    assert.deepEqual(mails.map((m) => m.subject), ["Ta commande AETHRYON Premium à vie est annulée"], "un seul e-mail, jamais de confirmation");
    assert.match(mails[0]!.text, /Rien n'a été prélevé \(code promo de 100 %\)/);
    assert.equal(env.fake.state.refunds.size, 0);
    const row = env.h.s.db.prepare("SELECT dispute_status FROM ytc_billing_purchase WHERE stripe_session_id = ?").get(id) as { dispute_status: string };
    assert.equal(row.dispute_status, "hors_france");
  } finally { await env.close(); }
});

test("carte refusée sur la page de paiement (scénario 2) : aucun droit, aucune confirmation ; le paiement réussit ensuite", async () => {
  const env = await setup();
  try {
    const v = await newUser(env.h, "refus-vie@example.test");
    const idv = await pay(v, "vie");
    assert.deepEqual((await deliver(env, env.fake.simu.decline(idv))).map((x) => x.body.outcome), ["synchronise"]);
    assert.equal((await state(v)).offre.id, "free");
    assert.equal((await v.json("/api/facturation/retour", { method: "POST", body: { session: idv } })).body.offre.id, "free", "retour après refus : rien");
    await deliver(env, env.fake.simu.complete(idv));
    assert.equal((await state(v)).offre.id, "vie", "nouvel essai réussi sur la même page");
    const a = await newUser(env.h, "refus-annuel@example.test");
    const ida = await pay(a, "annuel");
    assert.deepEqual(env.fake.simu.decline(ida), [], "abonnement refusé : rien n'est créé chez Stripe");
    assert.equal(env.fake.state.subs.size, 0);
    assert.equal((await state(a)).offre.id, "free");
    await deliver(env, env.fake.simu.complete(ida));
    assert.equal((await state(a)).offre.id, "annuel");
    await settle();
    assert.equal(confirmations(env).length, 2, "une confirmation par paiement réussi, aucune pour un refus");
  } finally { await env.close(); }
});

test("déjà Premium (scénario 9) : second abonnement refusé, même webhook manqué (relu chez Stripe) ; Premium à vie refuse tout nouvel achat", async () => {
  const env = await setup();
  try {
    const b = await newUser(env.h, "deja@example.test");
    env.fake.simu.complete(await pay(b, "annuel")); // payé chez Stripe, webhook PAS reçu
    env.fake.state.idem.clear();
    const again = await b.json("/api/facturation/paiement", { method: "POST", body: { offre: "annuel", executionImmediate: true, cgv: CGV_VERSION } });
    assert.deepEqual([again.status, again.body.error], [409, "already_subscribed"], "Stripe relu avant d'ouvrir une page");
    assert.equal((await state(b)).offre.id, "annuel");
    assert.equal(env.fake.state.sessions.size, 1, "aucune seconde page de paiement");
    const v = await buy(env, "deja-vie@example.test", "vie");
    env.fake.state.idem.clear();
    for (const offre of ["annuel", "vie"]) {
      const r = await v.b.json("/api/facturation/paiement", { method: "POST", body: { offre, executionImmediate: true, cgv: CGV_VERSION } });
      assert.deepEqual([r.status, r.body.error], [409, "already_lifetime"], offre);
    }
  } finally { await env.close(); }
});

test("accès Premium sans abonnement (scénario 10) : aucune route ni aucun événement ne donne de droit", async () => {
  const env = await setup();
  try {
    const b = await newUser(env.h, "sans@example.test");
    const uid = userId(env, "sans@example.test");
    const post = (path: string, body: Record<string, unknown> = {}) => b.json(path, { method: "POST", body });
    assert.equal((await post("/api/facturation/retour", { session: "cs_test_" + "a".repeat(40) })).status, 502, "session inconnue chez Stripe : rien");
    assert.equal((await post("/api/facturation/retour", { session: "pas-une-session" })).status, 400);
    assert.deepEqual([(await post("/api/facturation/reprendre")).body.error, (await post("/api/facturation/resilier", { confirme: true })).body.error,
      (await post("/api/facturation/retracter", { confirme: true })).body.error, (await post("/api/facturation/portail", { action: "accueil" })).body.error],
    ["nothing_to_resume", "no_subscription", "withdrawal_expired", "no_customer"]);
    // Événements signés mais sans contrat réel chez Stripe : ignorés (client inconnu, ou relu sans rien).
    const fakeSub = { id: "sub_faux0001", object: "subscription", customer: "cus_inconnu01", status: "active", metadata: { aethryon_user: uid }, items: { data: [] } };
    const out = await deliver(env, [env.fake.emit("customer.subscription.created", fakeSub), env.fake.emit("invoice.paid", { id: "in_faux0001", customer: "cus_inconnu01" })]);
    assert.deepEqual(out.map((x) => x.status), [200, 200]);
    const s = await state(b);
    assert.deepEqual([s.offre.id, s.abonnement, s.vie], ["free", null, null]);
    assert.equal((await b.json("/api/me")).body.today.limit, 10, "limites de Gratuit");
    assert.equal(env.h.s.db.prepare("SELECT COUNT(*) AS n FROM ytc_entitlement WHERE user_id = ?").get(uid)!.n, 0, "aucun droit enregistré");
  } finally { await env.close(); }
});

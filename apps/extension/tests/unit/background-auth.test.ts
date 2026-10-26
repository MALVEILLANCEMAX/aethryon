// Service worker : connexion au compte (PKCE S256 + state, launchWebAuthFlow), compte, déconnexion.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { harness, TT_URL } from "./fakes/harness.ts";
import { EXT_ID, until } from "./fakes/chrome.ts";
import { API, SITE, TOKEN } from "./fakes/backend.ts";
import { json } from "./fakes/fetch.ts";
import { b64url, deviceLabel, parseRedirect, s256 } from "../../src/background/auth.ts";

const NB = " ";
const REDIRECT = `https://${EXT_ID}.chromiumapp.org/aethryon`;
const B64URL_43 = /^[A-Za-z0-9_-]{43}$/;

test("connexion : URL d'autorisation exacte, PKCE S256 vérifié par le serveur, échange du code, liaison enregistrée", async (t) => {
  const h = harness(t, { linked: false });
  h.browser.authFlow = (url) => h.backend.authorize(url);
  const r = await h.page({ type: "auth.login" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(h.browser.authFlows.length, 1);
  const flow = h.browser.authFlows[0]!;
  assert.equal(flow.interactive, true);
  const u = new URL(flow.url);
  assert.equal(`${u.origin}${u.pathname}`, `${SITE}/extension/autoriser`);
  assert.deepEqual([...u.searchParams.keys()], ["redirect_uri", "state", "code_challenge", "code_challenge_method", "appareil"]);
  assert.equal(u.searchParams.get("redirect_uri"), REDIRECT);
  assert.ok(flow.url.includes(`redirect_uri=${encodeURIComponent(REDIRECT)}&state=`), "redirect_uri encodé");
  const state = u.searchParams.get("state")!;
  const challenge = u.searchParams.get("code_challenge")!;
  assert.match(state, B64URL_43);
  assert.match(challenge, B64URL_43);
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.ok(u.searchParams.get("appareil")!.length > 0);

  // corps de l'échange : exactement {code, code_verifier, redirect_uri}
  assert.equal(h.backend.tokenBodies.length, 1);
  const body = h.backend.tokenBodies[0];
  assert.deepEqual(Object.keys(body).sort(), ["code", "code_verifier", "redirect_uri"]);
  assert.equal(body.redirect_uri, REDIRECT);
  assert.match(body.code_verifier, B64URL_43);
  assert.notEqual(body.code_verifier, state);
  assert.equal(createHash("sha256").update(body.code_verifier).digest("base64url"), challenge, "challenge = S256(verifier)");
  const call = h.net.calls.find((c) => c.url === `${SITE}/api/extension/token`)!;
  assert.equal(call.method, "POST");
  assert.equal(call.headers["content-type"], "application/json");
  assert.equal(call.headers.authorization, undefined);
  assert.equal(call.init.credentials, "omit", "aucun cookie du site");

  const auth = h.browser.auth;
  assert.equal(auth.token, TOKEN);
  assert.equal(auth.email, "alice@example.test");
  assert.equal(auth.expiresAt, "2027-01-08T12:00:00.000Z");
  assert.ok(Number.isFinite(Date.parse(auth.linkedAt)));
  assert.equal(r.data.connected, true);
  assert.deepEqual(r.data.today, { used: 3, limit: 10, remaining: 7, resetAt: "2026-10-10T22:00:00Z" });
  assert.equal(h.browser.accessLevel.local, "TRUSTED_CONTEXTS", "storage.local réservé aux contextes de confiance");
  for (const s of h.leaks()) assert.ok(!s.includes(TOKEN));
});

test("connexion : state différent → refus, AUCUN échange de code ; refus de l'utilisateur ; fenêtre fermée ; retour ailleurs", async (t) => {
  const h = harness(t, { linked: false });
  h.browser.authFlow = (url) => h.backend.authorize(url, { state: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" });
  let r = await h.page({ type: "auth.login" });
  assert.deepEqual(r.error, { code: "auth_state", message: `La réponse de connexion n'a pas pu être vérifiée${NB}: recommence.`, retryable: true });
  assert.equal(h.backend.tokenBodies.length, 0);
  assert.equal(h.browser.auth, undefined);

  h.browser.authFlow = (url) => h.backend.authorize(url, { deny: true });
  r = await h.page({ type: "auth.login" });
  assert.equal(r.error.code, "auth_denied");
  assert.equal(r.error.message, `Autorisation refusée${NB}: l'extension n'est pas connectée à ton compte.`);

  h.browser.authFlow = null; // fenêtre fermée
  r = await h.page({ type: "auth.login" });
  assert.deepEqual(r.error, { code: "auth_cancelled", message: "Connexion annulée.", retryable: true });

  h.browser.authFlow = (url) => h.backend.authorize(url).replace(REDIRECT, "https://evil.test/aethryon");
  r = await h.page({ type: "auth.login" });
  assert.equal(r.error.code, "auth_failed");
  assert.equal(h.backend.tokenBodies.length, 0);
  assert.equal(h.browser.auth, undefined);
});

test("connexion : échange refusé (texte du serveur), jeton mal formé refusé, deux clics = une seule fenêtre", async (t) => {
  const h = harness(t, { linked: false });
  h.browser.authFlow = (url) => h.backend.authorize(url).replace(/code=[^&]+/, "code=c_inconnu_0123456789abcdef");
  let r = await h.page({ type: "auth.login" });
  assert.deepEqual(r.error, { code: "auth_code", message: `Code de connexion invalide ou expiré${NB}: recommence.`, retryable: true });

  h.backend.token = "pas_un_jeton_ytc";
  h.browser.authFlow = (url) => h.backend.authorize(url);
  r = await h.page({ type: "auth.login" });
  assert.equal(r.error.code, "auth_failed");
  assert.equal(h.browser.auth, undefined);

  h.backend.token = TOKEN;
  let open = 0;
  h.browser.authFlow = async (url) => {
    open++;
    await new Promise((res) => setTimeout(res, 20));
    return h.backend.authorize(url);
  };
  const [a, b] = await Promise.all([h.page({ type: "auth.login" }), h.page({ type: "auth.login" })]);
  assert.equal(open, 1);
  assert.equal(a.ok && b.ok, true);
});

test("compte : vue complète ; hors ligne, 404, 5xx → état dégradé (motif, dernier état connu « stale ») ; 401 = déconnecté", async (t) => {
  const h = harness(t);
  let r = await h.page({ type: "account.refresh" });
  assert.deepEqual(r.data, {
    connected: true, email: "alice@example.test", name: "Alice",
    today: { used: 3, limit: 10, remaining: 7, resetAt: "2026-10-10T22:00:00Z" }, activeJobs: 0,
    recent: [{ createdAt: "2026-10-10T18:00:00Z", platform: "tiktok", fmt: "mp4", state: "done", errorMessage: null }],
  });
  const me = h.net.calls.find((c) => c.url === `${SITE}/api/extension/me`)!;
  assert.equal(me.headers.authorization, `Bearer ${TOKEN}`);

  h.backend.meStatus = 0; // hors ligne
  r = await h.page({ type: "account.refresh" });
  assert.deepEqual(r.data.degraded, { reason: "network" });
  assert.equal(r.data.stale, true);
  assert.equal(r.data.today.used, 3, "dernières infos connues");

  h.backend.meStatus = 404; // service de l'extension absent du serveur (pas encore déployé)
  r = await h.page({ type: "account.refresh" });
  assert.equal(r.data.connected, true, "liaison gardée");
  assert.deepEqual(r.data.degraded, { reason: "missing", status: 404 });
  assert.equal(r.data.email, "alice@example.test");
  assert.equal(r.data.stale, true);

  h.backend.meStatus = 503;
  r = await h.page({ type: "account.refresh" });
  assert.deepEqual(r.data.degraded, { reason: "unavailable", status: 503 });
  const init = await h.page({ type: "popup.init" });
  assert.deepEqual([init.data.account.connected, init.data.account.degraded], [true, { reason: "unavailable", status: 503 }]);

  h.backend.meStatus = 200;
  h.backend.me = { user: { email: "x@y.test" }, today: { used: 0, limit: null, remaining: null } };
  r = await h.page({ type: "account.refresh" });
  assert.deepEqual(r.data.today, { used: 0, limit: null, remaining: null }, "illimité");
  assert.equal(r.data.degraded, undefined, "service revenu : plus d'état dégradé");

  h.backend.valid.clear();
  r = await h.page({ type: "account.refresh" });
  assert.deepEqual(r, { ok: false, error: { code: "auth_required", message: `La connexion de l'extension n'est plus valide. Reconnecte-la pour continuer.`, retryable: false } });
  assert.equal(h.browser.auth, undefined);
  assert.equal(h.browser.store.local.get("accountCache"), undefined);
  r = await h.page({ type: "account.refresh" });
  assert.equal(r.data.connected, false);
  assert.equal(r.data.notice.reason, "invalid");
});

const LOST = {
  revoked_user: `Cette extension a été déconnectée de ton compte depuis «${NB}Mes jetons${NB}». Reconnecte-la pour continuer.`,
  revoked_admin: "Un administrateur AETHRYON a révoqué l'accès de cette extension. Reconnecte-la pour continuer.",
  revoked_replay: `Accès révoqué par sécurité${NB}: un code de connexion a été réutilisé. Reconnecte l'extension pour continuer.`,
  revoked: "L'accès de cette extension à ton compte a été révoqué. Reconnecte-la pour continuer.",
  expired: `Connexion expirée (30 jours)${NB}: reconnecte-toi.`,
  invalid: "La connexion de l'extension n'est plus valide. Reconnecte-la pour continuer.",
};

test("clé révoquée (par l'utilisateur, un administrateur, un rejeu) : déconnecté, motif exact montré jusqu'à la prochaine connexion", async (t) => {
  for (const [by, reason] of [["user", "revoked_user"], ["admin", "revoked_admin"], ["replay", "revoked_replay"], [null, "revoked"]] as const) {
    const h = harness(t);
    h.backend.valid.delete(TOKEN);
    h.backend.revokedBy.set(TOKEN, by);
    const r = await h.page({ type: "account.refresh" });
    assert.deepEqual(r, { ok: false, error: { code: "auth_required", message: LOST[reason], retryable: false } }, String(by));
    assert.equal(h.browser.auth, undefined, "liaison effacée");
    const init = await h.page({ type: "popup.init" });
    assert.equal(init.data.account.connected, false);
    assert.deepEqual([init.data.account.notice.reason, init.data.account.notice.message], [reason, LOST[reason]]);
    assert.equal(typeof init.data.account.notice.at, "number");
    // job demandé ensuite : même motif
    const j = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
    assert.deepEqual(j.error, { code: "auth_required", message: LOST[reason], retryable: false });
    // nouvelle connexion : le motif disparaît
    h.backend.valid.add(TOKEN);
    h.backend.revokedBy.clear();
    h.browser.authFlow = (url) => h.backend.authorize(url);
    assert.equal((await h.page({ type: "auth.login" })).ok, true);
    const after = await h.page({ type: "popup.init" });
    assert.equal(after.data.account.connected, true);
    assert.equal(after.data.account.notice, undefined);
    assert.equal(h.browser.store.local.get("authNotice"), undefined);
  }
});

test("conversion refusée par ytapi (401) : le motif est demandé au compte (expirée) et devient l'erreur du job", async (t) => {
  const h = harness(t);
  h.backend.valid.delete(TOKEN);
  h.backend.expired.add(TOKEN);
  const r = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  assert.equal(r.ok, true);
  // Le job en échec est annoncé (onglet, pages) avec le motif, puis la liste est vidée (déconnexion).
  await until(() => h.browser.pageMessages.some((m: any) => m.type === "job.update" && m.job.state === "error"));
  const failed = h.browser.pageMessages.find((m: any) => m.type === "job.update" && m.job.state === "error");
  assert.deepEqual(failed.job.error, { code: "auth_required", message: LOST.expired, retryable: false });
  await until(() => h.browser.jobs.length === 0, 2000, "liste vidée");
  assert.deepEqual(h.browser.pageMessages.find((m: any) => m.type === "auth.changed"), { type: "auth.changed", connected: false, reason: "expired", message: LOST.expired });
  assert.equal(h.browser.auth, undefined);
  assert.ok(h.net.calls.some((c) => c.url === `${SITE}/api/extension/me` && c.headers.authorization === `Bearer ${TOKEN}`), "motif demandé à /me");
  const init = await h.page({ type: "popup.init" });
  assert.equal(init.data.account.notice.reason, "expired");
});

test("liaison expirée localement : motif « expirée » sans appel réseau (popup.init et job.start)", async (t) => {
  const h = harness(t);
  h.browser.store.local.set("auth", { ...h.browser.auth, expiresAt: "2020-01-01T00:00:00.000Z" });
  const j = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  assert.deepEqual(j.error, { code: "auth_required", message: LOST.expired, retryable: false });
  const init = await h.page({ type: "popup.init" });
  assert.deepEqual([init.data.account.connected, init.data.account.notice.reason], [false, "expired"]);
  assert.equal(h.net.calls.filter((c) => c.url.startsWith(SITE)).length, 0, "aucun appel au compte");
  assert.equal(h.browser.auth, undefined);
});

test("compte suspendu : liaison conservée (403 ≠ 401), état « suspendu », conversion refusée avec le texte du serveur ; réactivation → normal", async (t) => {
  const h = harness(t);
  h.backend.suspended = true;
  let init = await h.page({ type: "popup.init" });
  assert.deepEqual([init.data.account.connected, init.data.account.suspended], [true, true]);
  assert.equal(init.data.account.email, "alice@example.test", "liaison gardée");
  const r = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  assert.equal(r.ok, true);
  await until(() => h.job()?.state === "error");
  assert.deepEqual(h.job().error, { code: "account_suspended", message: "Ce compte est suspendu.", retryable: false });
  assert.equal(h.browser.auth.token, TOKEN, "liaison conservée");
  h.backend.suspended = false;
  init = await h.page({ type: "popup.init" });
  assert.deepEqual([init.data.account.connected, init.data.account.suspended], [true, undefined]);
});

test("401 de ytapi alors que le compte accepte encore la clé : liaison conservée, erreur relançable", async (t) => {
  const h = harness(t);
  h.backend.onCreate = () => json(401, { error: "unauthorized", detail: "Jeton absent ou invalide." });
  await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => h.job()?.state === "error");
  assert.deepEqual(h.job().error, { code: "unauthorized", message: `Le service de conversion a refusé la connexion${NB}: réessaie dans un instant.`, retryable: true });
  assert.equal(h.browser.auth.token, TOKEN);
  const init = await h.page({ type: "popup.init" });
  assert.deepEqual([init.data.account.connected, init.data.account.notice], [true, undefined]);
});

test("déconnexion volontaire : aucun motif affiché ensuite (même après un refus antérieur)", async (t) => {
  const h = harness(t);
  h.browser.store.local.set("authNotice", { reason: "revoked_admin", message: "ancien", at: 1 });
  assert.equal((await h.page({ type: "auth.logout" })).ok, true);
  const init = await h.page({ type: "popup.init" });
  assert.deepEqual(init.data.account, { connected: false });
});

test("compte : 404 sans aucun état connu → liaison gardée (e-mail, nom, expiration), état dégradé « missing », jamais un quota inventé", async (t) => {
  const h = harness(t);
  h.browser.store.local.set("auth", { token: TOKEN, expiresAt: "2027-01-01T00:00:00.000Z", email: "a@b.test", name: "A", linkedAt: "2026-10-10T10:00:00.000Z" });
  h.backend.meStatus = 404;
  const r = await h.page({ type: "account.refresh" });
  assert.deepEqual(r.data, { connected: true, email: "a@b.test", name: "A", expiresAt: "2027-01-01T00:00:00.000Z", degraded: { reason: "missing", status: 404 } });
});

test("liaison expirée localement : considérée comme absente", async (t) => {
  const h = harness(t);
  h.browser.store.local.set("auth", { token: TOKEN, expiresAt: "2020-01-01T00:00:00.000Z", email: "a@b.test", name: "A", linkedAt: "x" });
  const r = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  assert.equal(r.error.code, "auth_required");
});

test("déconnexion : conversions en cours annulées (DELETE), révocation (POST Bearer), liaison et cache effacés", async (t) => {
  const h = harness(t);
  await h.page({ type: "account.refresh" });
  assert.ok(h.browser.store.local.get("accountCache"));
  h.backend.onPoll = () => new Promise(() => undefined);
  await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => h.job()?.jobId === "job_0001");
  const r = await h.page({ type: "auth.logout" });
  assert.deepEqual(r, { ok: true, data: { connected: false } });
  assert.equal(h.backend.logouts, 1);
  const call = h.net.calls.find((c) => c.url === `${SITE}/api/extension/logout`)!;
  assert.equal(call.method, "POST");
  assert.equal(call.headers.authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(h.backend.deleted, ["job_0001"]);
  assert.ok(h.browser.pageMessages.some((m: any) => m.type === "job.update" && m.job.state === "cancelled"), "« Annulé » annoncé à l'onglet et aux pages");
  assert.deepEqual(h.browser.jobs, [], "liste des téléchargements effacée");
  assert.deepEqual(h.browser.pageMessages.at(-1), { type: "auth.changed", connected: false, reason: "signed_out" });
  assert.equal(h.browser.auth, undefined);
  assert.equal(h.browser.store.local.get("accountCache"), undefined);
  // hors ligne : déconnexion locale quand même
  const g = harness(t);
  g.backend.offline = true;
  const r2 = await g.page({ type: "auth.logout" });
  assert.equal(r2.ok, true);
  assert.equal(g.browser.auth, undefined);
  void API;
});

test("PKCE : base64url et S256 conformes au vecteur de la RFC 7636 (annexe B)", async () => {
  assert.equal(await s256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  assert.equal(b64url(new Uint8Array([251, 255, 191])), "-_-_");
  const ok = parseRedirect(`${REDIRECT}?code=abcdefghijklmnop&state=S`, REDIRECT, "S");
  assert.deepEqual(ok, { code: "abcdefghijklmnop" });
  const mismatch = parseRedirect(`${REDIRECT}?code=abcdefghijklmnop&state=T`, REDIRECT, "S");
  assert.equal("error" in mismatch ? mismatch.error.code : "", "auth_state");
  assert.ok("error" in parseRedirect(`${REDIRECT}/autre?code=abcdefghijklmnop&state=S`, REDIRECT, "S"));
  assert.ok("error" in parseRedirect(undefined, REDIRECT, "S"));
});

test("nom de l'appareil : « Chrome · Windows », Edge, macOS, repli sur userAgent", () => {
  assert.equal(deviceLabel({ userAgentData: { brands: [{ brand: "Google Chrome" }, { brand: "Chromium" }], platform: "Windows" } }), "Chrome · Windows");
  assert.equal(deviceLabel({ userAgentData: { brands: [{ brand: "Microsoft Edge" }, { brand: "Chromium" }], platform: "macOS" } }), "Edge · macOS");
  assert.equal(deviceLabel({ userAgentData: { brands: [{ brand: "Chromium" }], platform: "Linux" } }), "Chromium · Linux");
  assert.equal(deviceLabel({ userAgent: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36" }), "Chrome · ChromeOS");
  assert.equal(deviceLabel(undefined), "Chrome");
  void json;
});

test("nouvelle connexion alors qu'une liaison existe : l'ancienne clé est révoquée (aucune clé oubliée)", async (t) => {
  const h = harness(t);
  const old = `ytc_${"O".repeat(64)}`;
  h.browser.store.local.set("auth", { token: old, expiresAt: null, email: "a@b.test", name: "A", linkedAt: "2026-10-01T00:00:00.000Z" });
  h.backend.valid.add(old);
  h.browser.authFlow = (url) => h.backend.authorize(url);
  const r = await h.page({ type: "auth.login" });
  assert.equal(r.ok, true);
  assert.equal(h.browser.auth.token, TOKEN);
  assert.equal(h.backend.logouts, 1);
  assert.equal(h.backend.valid.has(old), false, "ancienne clé révoquée");
  assert.equal(h.backend.valid.has(TOKEN), true);
  const call = h.net.calls.find((c) => c.url === `${SITE}/api/extension/logout`)!;
  assert.equal(call.headers.authorization, `Bearer ${old}`);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { Browser, googleLogin, harness, newUser, ORIGIN } from "./helpers.ts";

test("configuration publique sans identifiants Google", async () => {
  const h = await harness({}, { google: false });
  try {
    const b = new Browser(h);
    const cfg = await b.json("/api/config");
    assert.equal(cfg.status, 200);
    assert.equal(cfg.body.googleEnabled, false);
    assert.equal(cfg.body.keysActive, false); // jamais annoncé actif sans USER_KEYS_ACTIVE=1
    assert.equal(cfg.body.icloudUrl, null);
    assert.deepEqual(cfg.body.quotas, { daily: 10, maxActive: 1, maxKeys: 2, exportMinutes: null }, "aucune limite d'export annoncée tant qu'elle ne s'applique pas");
    const r = await b.json("/api/auth/sign-in/social", { method: "POST", body: { provider: "google" } });
    assert.equal(r.status, 503);
    assert.equal(r.body.error, "google_disabled");
    assert.equal((await b.json("/api/health")).body.status, "ok");
  } finally { h.close(); }
});

test("inscription Google : session, jetons Google et avatar non stockés, PKCE", async () => {
  const h = await harness();
  try {
    const b = new Browser(h);
    const r = await googleLogin(b, { sub: "g-1", email: "Alice@Example.test", email_verified: true, name: "Alice", picture: "https://example.test/p.png" });
    assert.equal(r.status, 302);
    assert.equal(r.location, "/dashboard");
    const authUrl = new URL(r.authUrl!);
    assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");
    assert.equal(authUrl.searchParams.get("scope"), "email profile openid");
    assert.ok([...b.jar.keys()].some((k) => k === "__Secure-better-auth.session_token"));
    const acct = h.s.dbs.auth.prepare("SELECT accessToken, refreshToken, idToken FROM account").get() as Record<string, unknown>;
    assert.deepEqual({ ...acct }, { accessToken: null, refreshToken: null, idToken: null });
    const user = h.s.dbs.auth.prepare('SELECT email, image, role, status FROM "user"').get() as Record<string, unknown>;
    assert.equal(user.email, "alice@example.test");
    assert.equal(user.image, null);
    assert.equal(user.role, "user");
    assert.equal(user.status, "active");
    const me = await b.json("/api/me");
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, "alice@example.test");
    assert.equal(me.body.today.limit, 10);
    assert.equal(me.body.keys.max, 2);
    // retour : toujours pas de jetons Google
    const b2 = new Browser(h);
    await googleLogin(b2, { sub: "g-1", email: "alice@example.test", email_verified: true, name: "Alice" });
    const acct2 = h.s.dbs.auth.prepare("SELECT accessToken, refreshToken, idToken FROM account").all();
    assert.equal(acct2.length, 1);
    assert.deepEqual({ ...acct2[0] }, { accessToken: null, refreshToken: null, idToken: null });
  } finally { h.close(); }
});

test("e-mail non vérifié refusé, aucun compte créé", async () => {
  const h = await harness();
  try {
    const r = await googleLogin(new Browser(h), { sub: "g-2", email: "bob@example.test", email_verified: false, name: "Bob" });
    assert.equal(r.status, 302);
    assert.match(String(r.location), /\/connexion\?error=email_not_verified/);
    assert.equal((h.s.db.prepare('SELECT count(*) n FROM "user"').get() as { n: number }).n, 0);
  } finally { h.close(); }
});

test("plafond d'inscriptions et liste d'invités", async () => {
  const h = await harness({ MAX_USERS: "1" });
  try {
    await newUser(h, "first@example.test");
    const r = await googleLogin(new Browser(h), { sub: "g-x", email: "second@example.test", email_verified: true, name: "S" });
    assert.match(String(r.location), /error=signups_closed/);
  } finally { h.close(); }
  const h2 = await harness({ ALLOWED_EMAILS: "ok@example.test" });
  try {
    const r = await googleLogin(new Browser(h2), { sub: "g-y", email: "nope@example.test", email_verified: true, name: "N" });
    assert.match(String(r.location), /error=not_invited/);
    await newUser(h2, "ok@example.test");
  } finally { h2.close(); }
});

test("administrateur promu par ADMIN_EMAILS ; compte suspendu ne peut plus se connecter", async () => {
  const h = await harness({ ADMIN_EMAILS: "boss@example.test" });
  try {
    const boss = await newUser(h, "boss@example.test");
    assert.equal((await boss.json("/api/me")).body.user.role, "admin");
    const u = await newUser(h, "user@example.test", { sub: "g-susp" });
    const uid = (await u.json("/api/me")).body.user.id;
    const s = await boss.json(`/api/admin/users/${uid}/status`, { method: "POST", body: { status: "suspended" } });
    assert.equal(s.status, 200);
    assert.equal((await u.json("/api/me")).status, 401);
    const r = await googleLogin(new Browser(h), { sub: "g-susp", email: "user@example.test", email_verified: true, name: "user" });
    assert.match(String(r.location), /error=account_suspended/);
  } finally { h.close(); }
});

test("CSRF : origine absente ou étrangère refusée, JSON obligatoire", async () => {
  const h = await harness();
  try {
    const b = await newUser(h, "csrf@example.test");
    assert.equal((await b.json("/api/keys", { method: "POST", body: { name: "x" }, origin: "https://evil.example" })).status, 403);
    assert.equal((await b.json("/api/keys", { method: "POST", body: { name: "x" }, origin: null })).status, 403);
    const res = await h.s.publicApp.request("/api/keys", { method: "POST", headers: { cookie: b.cookie(), origin: ORIGIN, "content-type": "text/plain", "x-real-ip": b.ip }, body: "name=x" });
    assert.equal(res.status, 415);
    assert.equal((await b.json("/api/auth/sign-out", { method: "POST", body: {}, origin: "https://evil.example" })).status, 403);
  } finally { h.close(); }
});

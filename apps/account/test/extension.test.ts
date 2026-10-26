// Connexion de l'extension navigateur (docs/EXTENSION.md §7) : code d'autorisation + PKCE S256, clé
// d'extension, /me, déconnexion, limites, origines, migration 004.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { ConfigError, loadConfig, parseExtensionIds } from "../src/config.ts";
import { appliedVersions, migrateDown, migrateUp } from "../src/db.ts";
import { cleanDeviceLabel, codeHash } from "../src/extension.ts";
import { extensionKeyName } from "../src/keys.ts";
import { Browser, googleCallback, harness, internalCall, newUser, ORIGIN, type Harness } from "./helpers.ts";

const EXT = "dnllfjakdgmgfiompaheickmbjjlgjdc";   // build de développement (préproduction)
const EXT2 = "necpohicddjeaeaaomaakehcbccapabg";  // build « installation locale » (production)
const UNKNOWN = "abcdefghijklmnopabcdefghijklmnop";
const REDIRECT = `https://${EXT}.chromiumapp.org/aethryon`;
const REDIRECT2 = `https://${EXT2}.chromiumapp.org/aethryon`;
const EXT_ORIGIN = `chrome-extension://${EXT}`;
const ENV = { EXTENSION_IDS: `${EXT}, ${EXT2}` };
const NB = " ";

const b64 = (n = 32) => randomBytes(n).toString("base64url");
function pkce() {
  const verifier = b64(32);
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url"), state: b64(32) };
}
type Pkce = ReturnType<typeof pkce>;

let ipN = 1;
const freshIp = () => `198.51.100.${(ipN++ % 250) + 1}`;

function authorize(b: Browser, p: Pkce, over: Record<string, unknown> = {}) {
  return b.json("/api/extension/authorize", {
    method: "POST",
    body: { redirect_uri: REDIRECT, state: p.state, code_challenge: p.challenge, code_challenge_method: "S256", appareil: "Chrome · Linux", ...over },
  });
}

/** Requête « du service worker » : aucun cookie, origine de l'extension par défaut. */
async function ext(h: Harness, path: string, init: { method?: string; body?: unknown; raw?: string; headers?: Record<string, string>; origin?: string | null; token?: string; ip?: string } = {}) {
  const headers: Record<string, string> = { "x-real-ip": init.ip ?? freshIp(), ...(init.headers ?? {}) };
  if (init.origin !== null) headers.origin = init.origin ?? EXT_ORIGIN;
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  let body: string | undefined;
  if (init.raw !== undefined) body = init.raw;
  else if (init.body !== undefined) { body = JSON.stringify(init.body); headers["content-type"] ??= "application/json"; }
  const res = await h.s.publicApp.request(path, { method: init.method ?? "GET", headers, body });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: (text ? JSON.parse(text) : null) as any };
}

const tokenReq = (h: Harness, code: string, p: Pkce, over: Record<string, unknown> = {}, init: Parameters<typeof ext>[2] = {}) =>
  ext(h, "/api/extension/token", { method: "POST", body: { code, code_verifier: p.verifier, redirect_uri: REDIRECT, ...over }, ...init });

const codeOf = (redirect: string) => new URL(redirect).searchParams.get("code")!;

/** Parcours complet : consentement (session) puis échange (extension) → jeton. */
async function link(h: Harness, b: Browser, appareil = "Chrome · Linux") {
  const p = pkce();
  const a = await authorize(b, p, { appareil });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const t = await tokenReq(h, codeOf(a.body.redirect), p);
  assert.equal(t.status, 200, JSON.stringify(t.body));
  return t.body as { token: string; expiresAt: string; user: { email: string; name: string } };
}

test("configuration EXTENSION_IDS : 32 lettres a–p, liste, doublons, ConfigError sinon", async () => {
  assert.deepEqual(parseExtensionIds(undefined), []);
  assert.deepEqual(parseExtensionIds(""), []);
  assert.deepEqual(parseExtensionIds(` ${EXT} ,${EXT2},${EXT},`), [EXT, EXT2]);
  for (const bad of ["abc", EXT.toUpperCase(), `${EXT}q`, "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", `${EXT};${EXT2}`]) {
    assert.throws(() => parseExtensionIds(bad), ConfigError, bad);
  }
  const h = await harness(ENV);
  try {
    assert.deepEqual(h.cfg.extensionIds, [EXT, EXT2]);
    assert.throws(() => loadConfig({ ...h.env, EXTENSION_IDS: "pas-un-identifiant" } as NodeJS.ProcessEnv), ConfigError);
  } finally { h.close(); }
});

test("parcours PKCE complet : consentement → code (haché, 120 s) → jeton d'extension → /me → ytapi l'accepte", async () => {
  const h = await harness(ENV);
  try {
    const b = await newUser(h, "pkce@example.test", { name: "Léa Martin" });
    const p = pkce();
    const a = await authorize(b, p);
    assert.equal(a.status, 200);
    const u = new URL(a.body.redirect);
    assert.equal(`${u.origin}${u.pathname}`, REDIRECT);
    assert.deepEqual([...u.searchParams.keys()], ["code", "state"]);
    assert.equal(u.searchParams.get("state"), p.state);
    const code = u.searchParams.get("code")!;
    assert.match(code, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(a.body.redirect, `${REDIRECT}?code=${code}&state=${p.state}`);
    // en base : l'empreinte seulement, 120 s
    const row = h.s.db.prepare("SELECT * FROM ytc_ext_code").get() as Record<string, string | null>;
    assert.equal(row.code_hash, codeHash(code));
    assert.ok(!JSON.stringify(row).includes(code));
    assert.equal(Date.parse(row.expires_at!) - Date.parse(row.created_at!), 120_000);
    assert.equal(row.device_label, "Chrome · Linux");
    assert.equal(row.used_at, null);

    const t = await tokenReq(h, code, p);
    assert.equal(t.status, 200, JSON.stringify(t.body));
    assert.deepEqual(Object.keys(t.body).sort(), ["expiresAt", "token", "user"]);
    assert.match(t.body.token, /^ytc_[A-Za-z]{64}$/);
    assert.deepEqual(t.body.user, { email: "pkce@example.test", name: "Léa Martin" });
    const days = (Date.parse(t.body.expiresAt) - Date.now()) / 86_400_000;
    assert.ok(days > 29.9 && days <= 30, `expiration à 30 jours (S1) (${days})`);
    assert.equal(t.headers.get("cache-control"), "no-store");

    // la clé : type extension, appareil, nom, listée à part, jamais le secret
    const keys = (await b.json("/api/keys")).body.keys as { id: string; kind: string; deviceLabel: string | null; name: string; status: string; expiresAt: string }[];
    assert.equal(keys.length, 1);
    assert.deepEqual([keys[0]!.kind, keys[0]!.deviceLabel, keys[0]!.name, keys[0]!.status], ["extension", "Chrome · Linux", "Extension Chrome · Chrome · Linux", "active"]);
    assert.equal(keys[0]!.expiresAt, t.body.expiresAt);
    assert.ok(!JSON.stringify(keys).includes(t.body.token));
    const used = h.s.db.prepare("SELECT used_at, key_id FROM ytc_ext_code").get() as { used_at: string | null; key_id: string };
    assert.ok(used.used_at);
    assert.equal(used.key_id, keys[0]!.id);

    // /me avec la clé ; ytapi (API interne) l'accepte : même compte, même quota
    const me = await ext(h, "/api/extension/me", { token: t.body.token });
    assert.equal(me.status, 200);
    assert.deepEqual(me.body.user, { email: "pkce@example.test", name: "Léa Martin" });
    const allow = await internalCall(h, "/internal/v1/authorize", { key: t.body.token, action: "access" });
    assert.equal(allow.body.allow, true);
    assert.equal(allow.body.user_id, (await b.json("/api/me")).body.user.id);

    // journaux : ni code, ni vérificateur, ni jeton, ni e-mail
    const logs = h.logs.join("\n");
    for (const secret of [code, p.verifier, p.challenge, t.body.token, t.body.token.slice(4, 24), "pkce@example.test"]) assert.ok(!logs.includes(secret));
    assert.match(logs, /extension key issued/);
  } finally { h.close(); }
});

test("PKCE : mauvais vérificateur → invalid_grant et code brûlé ; vérificateur mal formé → invalid_request", async () => {
  const h = await harness(ENV);
  try {
    const b = await newUser(h, "verif@example.test");
    const p = pkce();
    const code = codeOf((await authorize(b, p)).body.redirect);
    const short = await tokenReq(h, code, p, { code_verifier: "trop-court" });
    assert.deepEqual([short.status, short.body.error], [400, "invalid_request"]);
    const wrong = await tokenReq(h, code, p, { code_verifier: pkce().verifier });
    assert.deepEqual([wrong.status, wrong.body.error], [400, "invalid_grant"]);
    assert.equal(wrong.body.message, `Code de connexion invalide, expiré ou déjà utilisé${NB}: relance la connexion depuis l'extension.`);
    // le bon vérificateur ensuite : le code a été brûlé au premier échec
    const late = await tokenReq(h, code, p);
    assert.deepEqual([late.status, late.body.error], [400, "invalid_grant"]);
    assert.equal((await b.json("/api/keys")).body.keys.length, 0);
    // code inconnu
    const unknown = await tokenReq(h, b64(32), p);
    assert.deepEqual([unknown.status, unknown.body.error], [400, "invalid_grant"]);
  } finally { h.close(); }
});

test("code expiré (120 s) → invalid_grant, aucune clé", async () => {
  const h = await harness(ENV);
  try {
    const b = await newUser(h, "expire@example.test");
    const p = pkce();
    const code = codeOf((await authorize(b, p)).body.redirect);
    h.s.db.prepare("UPDATE ytc_ext_code SET expires_at = ? WHERE code_hash = ?").run(new Date(Date.now() - 1000).toISOString(), codeHash(code));
    const t = await tokenReq(h, code, p);
    assert.deepEqual([t.status, t.body.error], [400, "invalid_grant"]);
    assert.equal((h.s.db.prepare("SELECT count(*) n FROM apikey").get() as { n: number }).n, 0);
  } finally { h.close(); }
});

test("rejeu d'un code utilisé → invalid_grant ET révocation de la clé émise (ytapi la refuse aussitôt)", async () => {
  const h = await harness(ENV);
  try {
    const b = await newUser(h, "replay@example.test");
    const p = pkce();
    const code = codeOf((await authorize(b, p)).body.redirect);
    const first = await tokenReq(h, code, p);
    assert.equal(first.status, 200);
    assert.equal((await ext(h, "/api/extension/me", { token: first.body.token })).status, 200);
    const again = await tokenReq(h, code, p);
    assert.deepEqual([again.status, again.body.error], [400, "invalid_grant"]);
    assert.ok(!("token" in again.body));
    const k = (await b.json("/api/keys")).body.keys[0];
    assert.equal(k.status, "revoked");
    const meta = h.s.db.prepare("SELECT revoked_reason FROM ytc_key_meta WHERE key_id = ?").get(k.id) as { revoked_reason: string };
    assert.equal(meta.revoked_reason, "replay");
    const me = await ext(h, "/api/extension/me", { token: first.body.token });
    assert.deepEqual([me.status, me.body.error, me.body.revokedBy], [401, "token_revoked", "replay"]);
    const refused = await internalCall(h, "/internal/v1/authorize", { key: first.body.token, action: "access" });
    assert.deepEqual([refused.body.allow, refused.body.reason], [false, "invalid_key"]);
    assert.match(h.logs.join("\n"), /extension code replayed/);
  } finally { h.close(); }
});

test("S2 : rejeu d'un code SANS le bon vérificateur → invalid_grant, mais la clé émise n'est PAS révoquée", async () => {
  const h = await harness(ENV);
  try {
    const b = await newUser(h, "s2@example.test");
    const p = pkce();
    const code = codeOf((await authorize(b, p)).body.redirect);
    const first = await tokenReq(h, code, p);
    assert.equal(first.status, 200);
    const intrus = await tokenReq(h, code, { ...p, verifier: b64(32) });
    assert.deepEqual([intrus.status, intrus.body.error], [400, "invalid_grant"]);
    assert.equal((await ext(h, "/api/extension/me", { token: first.body.token })).status, 200, "toujours connectée");
    assert.match(h.logs.join("\n"), /extension code reused without proof/);
    const encore = await tokenReq(h, code, p); // le vrai détenteur rejoue : là, révocation (preuve de possession)
    assert.equal(encore.status, 400);
    assert.equal((await ext(h, "/api/extension/me", { token: first.body.token })).status, 401);
  } finally { h.close(); }
});

test("S1 : une clé d'extension ne se renomme pas (409) ; S3 : /me limité à 60 par minute et par clé (429)", async () => {
  const h = await harness(ENV);
  try {
    const b = await newUser(h, "s1s3@example.test");
    const t = await link(h, b);
    const k = (await b.json("/api/keys")).body.keys.find((x: { kind: string }) => x.kind === "extension");
    const r = await b.json(`/api/keys/${k.id}`, { method: "PATCH", body: { name: "Autre nom" } });
    assert.deepEqual([r.status, r.body.error], [409, "rename_forbidden"]);
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await ext(h, "/api/extension/me", { token: t.token })).status;
    assert.equal(last, 429, "61e lecture dans la minute");
    const other = await link(h, b, "Chrome · Autre"); // une autre clé garde sa propre limite
    assert.equal((await ext(h, "/api/extension/me", { token: other.token })).status, 200);
  } finally { h.close(); }
});

test("deux échanges simultanés du même code : un seul jeton, aussitôt révoqué (rejeu), aucune clé orpheline", async () => {
  const h = await harness(ENV);
  try {
    const b = await newUser(h, "race@example.test");
    const p = pkce();
    const code = codeOf((await authorize(b, p)).body.redirect);
    const [x, y] = await Promise.all([tokenReq(h, code, p), tokenReq(h, code, p)]);
    assert.deepEqual([x.status, y.status].sort(), [200, 400]);
    const ok = x.status === 200 ? x : y;
    assert.equal((await ext(h, "/api/extension/me", { token: ok.body.token })).status, 401, "le jeton émis est révoqué");
    assert.equal((h.s.db.prepare("SELECT count(*) n FROM apikey").get() as { n: number }).n, 1, "la clé du perdant est supprimée");
    assert.equal((h.s.db.prepare("SELECT count(*) n FROM apikey k LEFT JOIN ytc_key_meta m ON m.key_id = k.id WHERE m.key_id IS NULL").get() as { n: number }).n, 0);
  } finally { h.close(); }
});

test("URI de retour : exacte et autorisée (consentement, refus, échange)", async () => {
  const h = await harness(ENV);
  try {
    const b = await newUser(h, "redirect@example.test");
    const bads = [
      `https://${UNKNOWN}.chromiumapp.org/aethryon`, `http://${EXT}.chromiumapp.org/aethryon`, `https://${EXT}.chromiumapp.org/aethryon/`,
      `https://${EXT}.chromiumapp.org/autre`, `https://${EXT}.chromiumapp.org/aethryon?x=1`, `https://${EXT}.chromiumapp.org.evil.test/aethryon`,
      `https://evil.test/aethryon`, `${REDIRECT}#f`, REDIRECT.toUpperCase(), 42, null,
    ];
    for (const r of bads) {
      const a = await authorize(b, pkce(), { redirect_uri: r });
      assert.deepEqual([a.status, a.body.error], [400, "invalid_redirect_uri"], String(r));
      const d = await b.json("/api/extension/deny", { method: "POST", body: { redirect_uri: r, state: b64(32) } });
      assert.deepEqual([d.status, d.body.error], [400, "invalid_redirect_uri"], String(r));
    }
    assert.equal(h.s.db.prepare("SELECT count(*) n FROM ytc_ext_code").get()!.n, 0);
    // second identifiant autorisé : accepté, mais l'échange doit présenter la MÊME URI que le consentement
    const p = pkce();
    const a2 = await authorize(b, p, { redirect_uri: REDIRECT2 });
    assert.equal(a2.status, 200);
    assert.ok(a2.body.redirect.startsWith(`${REDIRECT2}?code=`));
    const mismatch = await tokenReq(h, codeOf(a2.body.redirect), p, { redirect_uri: REDIRECT });
    assert.deepEqual([mismatch.status, mismatch.body.error], [400, "invalid_grant"]);
    const unknownRedirect = await tokenReq(h, b64(32), p, { redirect_uri: `https://${UNKNOWN}.chromiumapp.org/aethryon` }, { origin: null });
    assert.deepEqual([unknownRedirect.status, unknownRedirect.body.error], [400, "invalid_redirect_uri"]);
    // champs du consentement
    for (const over of [{ state: "court" }, { code_challenge: "x".repeat(42) }, { code_challenge_method: "plain" }, { appareil: 12 }, { extra: 1 }]) {
      const r = await authorize(b, pkce(), over);
      assert.deepEqual([r.status, r.body.error], [400, "invalid_request"], JSON.stringify(over));
    }
  } finally { h.close(); }
});

test("refus : redirect_uri?error=access_denied&state=… ; consentement et refus exigent session + origine du site + JSON", async () => {
  const h = await harness(ENV);
  try {
    const b = await newUser(h, "deny@example.test");
    const state = b64(32);
    const d = await b.json("/api/extension/deny", { method: "POST", body: { redirect_uri: REDIRECT, state } });
    assert.equal(d.status, 200);
    assert.equal(d.body.redirect, `${REDIRECT}?error=access_denied&state=${state}`);
    assert.equal(h.s.db.prepare("SELECT count(*) n FROM ytc_ext_code").get()!.n, 0);
    // sans session
    const anon = new Browser(h);
    assert.equal((await authorize(anon, pkce())).status, 401);
    assert.equal((await anon.json("/api/extension/deny", { method: "POST", body: { redirect_uri: REDIRECT, state } })).status, 401);
    // origine de l'extension ou absente : refusée sur les routes de session (CSRF du site)
    for (const origin of [EXT_ORIGIN, "https://evil.test", null]) {
      const r = await b.json("/api/extension/authorize", { method: "POST", origin, body: { redirect_uri: REDIRECT, state, code_challenge: pkce().challenge, code_challenge_method: "S256" } });
      assert.deepEqual([r.status, r.body.error], [403, "invalid_origin"], String(origin));
    }
    // formulaire (type « simple ») avec le cookie et la bonne origine : refusé (CSRF)
    const form = await h.s.publicApp.request("/api/extension/authorize", {
      method: "POST", body: "redirect_uri=x",
      headers: { cookie: b.cookie(), origin: ORIGIN, "x-real-ip": b.ip, "content-type": "application/x-www-form-urlencoded" },
    });
    assert.equal(form.status, 415);
  } finally { h.close(); }
});

test("origines : /token et /logout acceptent une origine absente ou chrome-extension://<id autorisé>, rien d'autre", async () => {
  const h = await harness(ENV);
  try {
    const b = await newUser(h, "origin@example.test");
    const exchange = async (origin: string | null) => {
      const p = pkce();
      const code = codeOf((await authorize(b, p)).body.redirect);
      return tokenReq(h, code, p, {}, { origin });
    };
    for (const origin of [ORIGIN, "https://evil.test", "null", `chrome-extension://${UNKNOWN}`, `chrome-extension://${EXT2}`, `${EXT_ORIGIN}/`]) {
      const r = await exchange(origin);
      assert.deepEqual([r.status, r.body.error], [403, "invalid_origin"], origin);
    }
    const tokens: string[] = [];
    for (const origin of [null, EXT_ORIGIN]) {
      const r = await exchange(origin);
      assert.equal(r.status, 200, String(origin));
      tokens.push(r.body.token);
    }
    // JSON obligatoire sur /token, corps exactement {code, code_verifier, redirect_uri}
    const p = pkce();
    const code = codeOf((await authorize(b, p)).body.redirect);
    const body = JSON.stringify({ code, code_verifier: p.verifier, redirect_uri: REDIRECT });
    for (const ct of ["text/plain", "application/x-www-form-urlencoded", ""]) {
      const r = await ext(h, "/api/extension/token", { method: "POST", raw: body, headers: ct ? { "content-type": ct } : {} });
      assert.equal(r.status, 415, ct);
    }
    assert.equal((await tokenReq(h, code, p, { extra: 1 })).body.error, "invalid_request");
    assert.equal((await ext(h, "/api/extension/token", { method: "POST", body: { code, code_verifier: p.verifier } })).body.error, "invalid_request");
    assert.equal((await ext(h, "/api/extension/token", { method: "POST", raw: "[]", headers: { "content-type": "application/json" } })).body.error, "invalid_request");
    // le code n'a pas été consommé par ces requêtes refusées avant lecture
    assert.equal((await tokenReq(h, code, p)).status, 200);

    // /logout : mêmes règles d'origine (révocation idempotente : 204)
    for (const origin of [ORIGIN, "https://evil.test", `chrome-extension://${UNKNOWN}`]) {
      const r = await ext(h, "/api/extension/logout", { method: "POST", origin, token: tokens[0] });
      assert.deepEqual([r.status, r.body?.error], [403, "invalid_origin"], origin);
    }
    assert.equal((await ext(h, "/api/extension/me", { token: tokens[0] })).status, 200, "toujours valide après les refus");
    assert.equal((await ext(h, "/api/extension/logout", { method: "POST", origin: null, token: tokens[0] })).status, 204);
    assert.equal((await ext(h, "/api/extension/logout", { method: "POST", origin: `chrome-extension://${EXT2}`, token: tokens[1] })).status, 204);
    const text = await ext(h, "/api/extension/logout", { method: "POST", raw: "x", headers: { "content-type": "text/plain" }, token: tokens[1] });
    assert.equal(text.status, 415);
    // /me : origine étrangère refusée
    assert.equal((await ext(h, "/api/extension/me", { origin: "https://evil.test", token: tokens[1] })).status, 403);
  } finally { h.close(); }
});

test("cookie seul refusé : /me, /logout et /token ne lisent jamais la session", async () => {
  const h = await harness(ENV);
  try {
    const b = await newUser(h, "cookie@example.test");
    const t = await link(h, b);
    // le navigateur connecté (cookie de session) sans Bearer
    const me = await b.json("/api/extension/me");
    assert.deepEqual([me.status, me.body.error], [401, "invalid_token"]);
    assert.match(String((await b.req("/api/extension/me")).headers.get("www-authenticate")), /^Bearer/);
    const out = await b.json("/api/extension/logout", { method: "POST", origin: null });
    assert.deepEqual([out.status, out.body.error], [401, "invalid_token"]);
    const out2 = await b.json("/api/extension/logout", { method: "POST" }); // origine du site + cookie
    assert.equal(out2.status, 403);
    const tok = await b.json("/api/extension/token", { method: "POST", origin: null, body: {} });
    assert.equal(tok.status, 400);
    // la clé d'extension n'a pas été touchée
    assert.equal((await ext(h, "/api/extension/me", { token: t.token })).status, 200);
    // Bearer mal formé, inconnu, ou clé du RACCOURCI : refusés
    const shortcut = (await b.json("/api/keys", { method: "POST", body: { name: "iPhone" } })).body.secret as string;
    for (const token of [shortcut, `ytc_${"Q".repeat(64)}`]) {
      assert.equal((await ext(h, "/api/extension/me", { token })).status, 401);
      assert.equal((await ext(h, "/api/extension/logout", { method: "POST", token })).status, 401);
    }
    assert.equal((await ext(h, "/api/extension/me", { headers: { authorization: `Basic ${t.token}` } })).status, 401);
    assert.equal((await ext(h, "/api/extension/me", { headers: { authorization: `Bearer ${t.token} x` } })).status, 401);
    const list = (await b.json("/api/keys")).body.keys as { kind: string; status: string }[];
    assert.ok(list.every((k) => k.status === "active"), "aucune clé révoquée par ces refus");
    // une clé d'extension ne se « régénère » pas en clé du raccourci
    const extKey = list.find((k) => k.kind === "extension") as unknown as { id: string };
    const rot = await b.json(`/api/keys/${extKey.id}/rotate`, { method: "POST" });
    assert.deepEqual([rot.status, rot.body.error], [409, "extension_key"]);
  } finally { h.close(); }
});

test("limites : 3 extensions actives au plus (409 vers « Mes jetons »), plafond du raccourci inchangé et séparé", async () => {
  const h = await harness(ENV);
  try {
    const b = await newUser(h, "limits@example.test");
    // 2 jetons du raccourci (MAX_KEYS_PER_USER = 2), puis 3 extensions : les deux plafonds sont séparés
    for (const name of ["iPhone", "iPad"]) assert.equal((await b.json("/api/keys", { method: "POST", body: { name } })).status, 201);
    const tokens = [];
    for (const d of ["Chrome · Windows", "Edge · macOS"]) tokens.push((await link(h, b, d)).token);
    // deux codes demandés avec 2 extensions actives : le second échange dépasse la limite → 409, code brûlé
    const p1 = pkce(), p2 = pkce();
    const c1 = codeOf((await authorize(b, p1, { appareil: "Brave · Linux" })).body.redirect);
    const c2 = codeOf((await authorize(b, p2, { appareil: "Opera · Linux" })).body.redirect);
    assert.equal((await tokenReq(h, c1, p1)).status, 200);
    const over = await tokenReq(h, c2, p2);
    assert.deepEqual([over.status, over.body.error], [409, "too_many_extensions"]);
    const msg = `Tu as déjà 3 extensions connectées à ton compte${NB}: révoque un appareil dans «${NB}Mes jetons${NB}», puis reconnecte l'extension.`;
    assert.equal(over.body.message, msg);
    assert.ok((h.s.db.prepare("SELECT used_at FROM ytc_ext_code WHERE code_hash = ?").get(codeHash(c2)) as { used_at: string | null }).used_at);
    // le consentement refuse aussi, avant d'émettre un code
    const a4 = await authorize(b, pkce());
    assert.deepEqual([a4.status, a4.body.error, a4.body.message], [409, "too_many_extensions", msg]);
    // le raccourci : toujours 2 actifs, 3e refusé ; /api/me ne compte que les jetons du raccourci
    const me = (await b.json("/api/me")).body;
    assert.deepEqual(me.keys, { active: 2, max: 2 });
    assert.deepEqual([(await b.json("/api/keys", { method: "POST", body: { name: "Trop" } })).status], [409]);
    const all = (await b.json("/api/keys")).body.keys as { id: string; kind: string; status: string; deviceLabel: string | null }[];
    assert.deepEqual(all.filter((k) => k.kind === "extension").map((k) => k.deviceLabel).sort(), ["Brave · Linux", "Chrome · Windows", "Edge · macOS"]);
    assert.ok(all.filter((k) => k.kind === "shortcut").every((k) => k.deviceLabel === null));
    // révoquer un appareil dans « Mes jetons » libère une place
    const edge = all.find((k) => k.deviceLabel === "Edge · macOS")!;
    assert.equal((await b.json(`/api/keys/${edge.id}/revoke`, { method: "POST" })).status, 200);
    assert.equal((await ext(h, "/api/extension/me", { token: tokens[1] })).status, 401);
    await link(h, b, "Chromium · Linux");
    // un jeton du raccourci révoqué libère une place pour le raccourci, pas pour l'extension
    const iphone = all.find((k) => k.kind === "shortcut")!;
    assert.equal((await b.json(`/api/keys/${iphone.id}/revoke`, { method: "POST" })).status, 200);
    assert.equal((await authorize(b, pkce())).status, 409);
    assert.equal((await b.json("/api/keys", { method: "POST", body: { name: "Nouveau" } })).status, 201);
  } finally { h.close(); }
});

test("/api/extension/me : forme exacte (quota du jour, jobs actifs, 5 dernières conversions)", async () => {
  const h = await harness(ENV);
  try {
    const b = await newUser(h, "me@example.test", { name: "Camille" });
    const { token } = await link(h, b);
    // 6 conversions par la clé d'extension (comme ytapi) : 4 terminées, 1 en attente, 1 en erreur (la plus récente)
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await internalCall(h, "/internal/v1/authorize", { key: token, action: "create_job", fmt: i % 2 ? "mp3" : "mp4", platform: "tiktok" });
      assert.equal(r.body.allow, true);
      ids.push(r.body.usage_id);
      h.s.db.prepare("UPDATE ytc_usage SET created_at = ? WHERE id = ?").run(new Date(Date.now() - (10 - i) * 1000).toISOString(), r.body.usage_id);
    }
    for (const id of ids.slice(0, 4)) assert.equal((await internalCall(h, `/internal/v1/usage/${id}`, { state: "done", size_bytes: 10 })).status, 200);
    assert.equal((await internalCall(h, `/internal/v1/usage/${ids[5]}`, { state: "error", error_code: "private" })).status, 200);
    const me = await ext(h, "/api/extension/me", { token });
    assert.equal(me.status, 200);
    assert.deepEqual(Object.keys(me.body).sort(), ["activeJobs", "features", "recent", "today", "user"]);
    assert.deepEqual(me.body.features, { tools: false }, "AETHRYON Tools fermé (TOOLS_ENABLED absent)");
    assert.deepEqual(me.body.user, { email: "me@example.test", name: "Camille" });
    const site = (await b.json("/api/me")).body.today;
    assert.deepEqual(Object.keys(me.body.today).sort(), Object.keys(site).sort(), "même forme que /api/me");
    assert.equal(me.body.today.used, 5, "l'échec n'est pas décompté du quota");
    assert.deepEqual([me.body.today.limit, me.body.today.remaining], [10, 5]);
    assert.equal(me.body.activeJobs, 1);
    assert.equal(me.body.recent.length, 5);
    for (const r of me.body.recent) assert.deepEqual(Object.keys(r).sort(), ["createdAt", "errorMessage", "fmt", "platform", "state"]);
    assert.deepEqual(me.body.recent.map((r: { state: string }) => r.state), ["error", "reserved", "done", "done", "done"], "plus récentes d'abord");
    assert.equal(me.body.recent[0].errorMessage, "La vidéo est privée.");
    assert.equal(me.body.recent[1].errorMessage, null);
    assert.deepEqual([me.body.recent[0].platform, me.body.recent[0].fmt], ["tiktok", "mp3"]);
    // ligne « en attente » vieille de plus de 3 h : plus comptée
    h.s.db.prepare("UPDATE ytc_usage SET updated_at = ? WHERE id = ?").run(new Date(Date.now() - 4 * 3_600_000).toISOString(), ids[4]!);
    assert.equal((await ext(h, "/api/extension/me", { token })).body.activeJobs, 0);
  } finally { h.close(); }
});

test("déconnexion : 204, clé révoquée (motif « user »), ytapi la refuse ensuite, idempotente", async () => {
  const h = await harness(ENV);
  try {
    const b = await newUser(h, "logout@example.test");
    const { token } = await link(h, b);
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key: token, action: "access" })).body.allow, true);
    const out = await ext(h, "/api/extension/logout", { method: "POST", token });
    assert.equal(out.status, 204);
    const k = (await b.json("/api/keys")).body.keys[0];
    assert.equal(k.status, "revoked");
    assert.equal((h.s.db.prepare("SELECT revoked_reason FROM ytc_key_meta WHERE key_id = ?").get(k.id) as { revoked_reason: string }).revoked_reason, "user");
    const refused = await internalCall(h, "/internal/v1/authorize", { key: token, action: "create_job", fmt: "mp4", platform: "tiktok" });
    assert.deepEqual([refused.body.allow, refused.body.reason], [false, "invalid_key"]);
    assert.equal((await ext(h, "/api/extension/me", { token })).status, 401);
    assert.equal((await ext(h, "/api/extension/logout", { method: "POST", token })).status, 204, "idempotente");
    assert.equal((await ext(h, "/api/extension/logout", { method: "POST" })).status, 401, "sans jeton");
  } finally { h.close(); }
});

test("compte suspendu : échange refusé (403), /me 403 account_suspended puis 200 après réactivation ; appareil nettoyé ; nom de clé ≤ 40", async () => {
  const h = await harness({ ...ENV, ADMIN_EMAILS: "boss@example.test" });
  try {
    const admin = await newUser(h, "boss@example.test");
    const b = await newUser(h, "susp@example.test");
    const uid = (await b.json("/api/me")).body.user.id as string;
    const { token } = await link(h, b, "Chrome‮ · \u0000Linux​   x".padEnd(80, "y"));
    const k = (await b.json("/api/keys")).body.keys[0];
    assert.equal(k.deviceLabel, `Chrome · Linux x${"y".repeat(44)}`);
    assert.ok(Array.from(k.name as string).length <= 40);
    assert.ok((k.name as string).startsWith("Extension Chrome · Chrome · Linux"));
    const p = pkce();
    const code = codeOf((await authorize(b, p)).body.redirect);
    assert.equal((await admin.json(`/api/admin/users/${uid}/status`, { method: "POST", body: { status: "suspended" } })).status, 200);
    const t = await tokenReq(h, code, p);
    assert.deepEqual([t.status, t.body.error], [403, "account_suspended"]);
    const me = await ext(h, "/api/extension/me", { token });
    assert.deepEqual([me.status, me.body.error, me.body.message], [403, "account_suspended", "Ce compte est suspendu."]);
    assert.equal(me.headers.get("www-authenticate"), null, "pas une erreur de jeton : la liaison reste valable");
    assert.equal((await admin.json(`/api/admin/users/${uid}/status`, { method: "POST", body: { status: "active" } })).status, 200);
    assert.equal((await ext(h, "/api/extension/me", { token })).status, 200, "réactivation : l'extension remarche sans nouvelle connexion");
  } finally { h.close(); }
});

test("/me : motif exact du refus (révoquée depuis « Mes jetons » ou par un administrateur, expirée, inconnue, clé du raccourci)", async () => {
  const h = await harness({ ...ENV, ADMIN_EMAILS: "chef@example.test" });
  try {
    const admin = await newUser(h, "chef@example.test");
    const b = await newUser(h, "motifs@example.test");
    const expectRefusal = async (token: string, status: number, error: string, message: string, revokedBy?: string | null) => {
      const r = await ext(h, "/api/extension/me", { token });
      assert.deepEqual([r.status, r.body.error, r.body.message], [status, error, message], token.slice(0, 8));
      if (revokedBy !== undefined) assert.equal(r.body.revokedBy, revokedBy);
      else assert.ok(!("revokedBy" in r.body));
      assert.equal(r.headers.get("www-authenticate"), 'Bearer realm="aethryon"');
    };
    const REVOKED = `L'accès de cette extension à ton compte a été révoqué${NB}: reconnecte-la pour continuer.`;
    const EXPIRED = `La connexion de cette extension a expiré${NB}: reconnecte-la pour continuer.`;
    const INVALID = `Jeton d'extension absent, invalide ou révoqué${NB}: reconnecte l'extension à ton compte.`;
    const byDevice = async (d: string) => ((await b.json("/api/keys")).body.keys as { id: string; deviceLabel: string | null }[]).find((k) => k.deviceLabel === d)!;

    // révoquée depuis « Mes jetons » (site) → motif « user »
    const site = await link(h, b, "Appareil site");
    assert.equal((await b.json(`/api/keys/${(await byDevice("Appareil site")).id}/revoke`, { method: "POST" })).status, 200);
    await expectRefusal(site.token, 401, "token_revoked", REVOKED, "user");

    // révoquée depuis le Control Center → motif « admin »
    const cc = await link(h, b, "Appareil admin");
    assert.equal((await admin.json(`/api/admin/keys/${(await byDevice("Appareil admin")).id}/revoke`, { method: "POST" })).status, 200);
    await expectRefusal(cc.token, 401, "token_revoked", REVOKED, "admin");

    // expirée (date dépassée en base, avant toute purge de Better Auth)
    const old = await link(h, b, "Appareil expiré");
    const id = (await byDevice("Appareil expiré")).id;
    const cur = (h.s.db.prepare("SELECT expiresAt FROM apikey WHERE id = ?").get(id) as { expiresAt: string | number }).expiresAt;
    h.s.db.prepare("UPDATE apikey SET expiresAt = ? WHERE id = ?").run(typeof cur === "number" ? Date.now() - 1000 : new Date(Date.now() - 1000).toISOString(), id);
    await expectRefusal(old.token, 401, "token_expired", EXPIRED);

    // inconnue, et clé du raccourci présentée à /me
    await expectRefusal(`ytc_${"Z".repeat(64)}`, 401, "invalid_token", INVALID);
    const shortcut = (await b.json("/api/keys", { method: "POST", body: { name: "iPhone" } })).body.secret as string;
    await expectRefusal(shortcut, 401, "invalid_token", INVALID);
    // jeton mal formé : refus générique, sans en-tête de motif
    const bad = await ext(h, "/api/extension/me", { headers: { authorization: "Bearer pas-un-jeton" } });
    assert.deepEqual([bad.status, bad.body.error], [401, "invalid_token"]);
  } finally { h.close(); }
});

test("nettoyage de l'appareil et nom de clé", () => {
  assert.equal(cleanDeviceLabel("Chrome · Linux"), "Chrome · Linux");
  assert.equal(cleanDeviceLabel("  "), "Appareil inconnu");
  assert.equal(cleanDeviceLabel(undefined), "Appareil inconnu");
  assert.equal(cleanDeviceLabel("a\u0007b⁦c﻿d"), "a b c d");
  assert.equal(Array.from(cleanDeviceLabel("é".repeat(100))).length, 60);
  assert.equal(extensionKeyName("Chrome · Linux"), "Extension Chrome · Chrome · Linux");
  const long = extensionKeyName("x".repeat(60));
  assert.equal(Array.from(long).length, 40);
  assert.ok(long.endsWith("…"));
});

test("retour après connexion Google : callbackURL = page d'autorisation (chemin relatif) accepté et suivi", async () => {
  const h = await harness(ENV);
  try {
    const b = new Browser(h);
    const p = pkce();
    const suite = `/extension/autoriser?redirect_uri=${encodeURIComponent(REDIRECT)}&state=${p.state}&code_challenge=${p.challenge}&code_challenge_method=S256&appareil=${encodeURIComponent("Chrome · Linux")}`;
    const r1 = await b.req("/api/auth/sign-in/social", { method: "POST", body: { provider: "google", callbackURL: suite, newUserCallbackURL: suite, errorCallbackURL: "/connexion" } });
    assert.equal(r1.status, 200);
    const { url } = (await r1.json()) as { url: string };
    const r2 = await googleCallback(b, url, { sub: "g-suite", email: "suite@example.test", email_verified: true, name: "Suite" });
    assert.equal(r2.status, 302);
    assert.ok(String(r2.headers.get("location")).endsWith(suite), String(r2.headers.get("location")));
    assert.equal((await b.json("/api/me")).body.user.email, "suite@example.test");
    // URL absolue d'un autre site : refusée par Better Auth (pas de redirection ouverte)
    const evil = await new Browser(h).req("/api/auth/sign-in/social", { method: "POST", body: { provider: "google", callbackURL: "https://evil.test/x" } });
    assert.equal(evil.status, 403);
    const slashes = await new Browser(h).req("/api/auth/sign-in/social", { method: "POST", body: { provider: "google", callbackURL: "/\\evil.test" } });
    assert.equal(slashes.status, 403);
  } finally { h.close(); }
});

test("Control Center : AdminKey porte kind et deviceLabel, filtre ?kind=", async () => {
  const h = await harness({ ...ENV, ADMIN_EMAILS: "root@example.test" });
  try {
    const admin = await newUser(h, "root@example.test");
    const b = await newUser(h, "owner@example.test");
    await b.json("/api/keys", { method: "POST", body: { name: "iPhone" } });
    await link(h, b, "Edge · Windows");
    const all = await admin.json("/api/admin/keys");
    assert.equal(all.status, 200);
    assert.deepEqual(all.body.items.map((k: { kind: string; deviceLabel: string | null }) => [k.kind, k.deviceLabel]).sort(), [["extension", "Edge · Windows"], ["shortcut", null]]);
    const onlyExt = await admin.json("/api/admin/keys?kind=extension");
    assert.deepEqual([onlyExt.body.total, onlyExt.body.items[0].name], [1, "Extension Chrome · Edge · Windows"]);
    assert.equal((await admin.json("/api/admin/keys?kind=shortcut")).body.total, 1);
    assert.equal((await admin.json("/api/admin/keys?kind=autre")).status, 400);
    assert.equal((await admin.json("/api/admin/keys?q=Edge")).body.total, 1);
    const uid = (await b.json("/api/me")).body.user.id;
    const detail = await admin.json(`/api/admin/users/${uid}`);
    assert.ok(detail.body.keys.some((k: { kind: string }) => k.kind === "extension"));
    // révocation par l'administrateur : la clé d'extension est refusée aussitôt
    const id = onlyExt.body.items[0].id;
    assert.equal((await admin.json(`/api/admin/keys/${id}/revoke`, { method: "POST" })).status, 200);
    assert.equal((await admin.json("/api/admin/keys?kind=extension&state=revoked")).body.total, 1);
  } finally { h.close(); }
});

test("purge : clé (raccourci ou extension) expirée depuis plus de 30 jours effacée avec ses métadonnées ; métadonnées orphelines effacées ; clés actives intactes", async () => {
  const h = await harness(ENV);
  try {
    const b = await newUser(h, "retention@example.test");
    const old = await link(h, b, "Ancien appareil");
    const recent = await link(h, b, "Appareil récent");
    const keep = await link(h, b, "Appareil actif");
    const ids = Object.fromEntries(((await b.json("/api/keys")).body.keys as { id: string; deviceLabel: string }[]).map((k) => [k.deviceLabel, k.id]));
    const set = (id: string, iso: string) => {
      const cur = (h.s.db.prepare("SELECT expiresAt FROM apikey WHERE id = ?").get(id) as { expiresAt: string | number }).expiresAt;
      h.s.db.prepare("UPDATE apikey SET expiresAt = ? WHERE id = ?").run(typeof cur === "number" ? Date.parse(iso) : iso, id);
    };
    set(ids["Ancien appareil"]!, new Date(Date.now() - 31 * 86_400_000).toISOString());  // expirée il y a 31 jours
    set(ids["Appareil récent"]!, new Date(Date.now() - 2 * 86_400_000).toISOString());   // expirée il y a 2 jours
    // métadonnées orphelines : clé supprimée par Better Auth (vérification d'une clé expirée)
    h.s.db.prepare("INSERT INTO ytc_key_meta (key_id, user_id, created_at, kind) VALUES ('orpheline', (SELECT id FROM \"user\" WHERE email = 'retention@example.test'), ?, 'extension')").run(new Date().toISOString());
    await h.s.usage.purge();
    const left = (h.s.db.prepare("SELECT id FROM apikey").all() as { id: string }[]).map((r) => r.id).sort();
    assert.deepEqual(left, [ids["Appareil récent"]!, ids["Appareil actif"]!].sort(), "seule la clé expirée depuis plus de 30 jours est effacée");
    const metas = (h.s.db.prepare("SELECT key_id FROM ytc_key_meta").all() as { key_id: string }[]).map((r) => r.key_id).sort();
    assert.deepEqual(metas, left, "aucune métadonnée sans clé");
    assert.equal((await ext(h, "/api/extension/me", { token: keep.token })).status, 200);
    void old; void recent;
  } finally { h.close(); }
});

test("purge : codes d'autorisation effacés 24 h après leur expiration", async () => {
  const h = await harness(ENV);
  try {
    const b = await newUser(h, "purge@example.test");
    const a = codeOf((await authorize(b, pkce())).body.redirect);
    const old = codeOf((await authorize(b, pkce())).body.redirect);
    h.s.db.prepare("UPDATE ytc_ext_code SET expires_at = ? WHERE code_hash = ?").run(new Date(Date.now() - 25 * 3_600_000).toISOString(), codeHash(old));
    await h.s.usage.purge();
    const left = (h.s.db.prepare("SELECT code_hash FROM ytc_ext_code").all() as { code_hash: string }[]).map((r) => r.code_hash);
    assert.deepEqual(left, [codeHash(a)]);
  } finally { h.close(); }
});

test("migration 004 : up → down → up (données conservées, motif « replay », types de clés)", async () => {
  const h = await harness(ENV);
  try {
    const db = h.s.db;
    const b = await newUser(h, "mig4@example.test");
    const short = (await b.json("/api/keys", { method: "POST", body: { name: "iPhone" } })).body.key.id as string;
    const p = pkce();
    const code = codeOf((await authorize(b, p)).body.redirect);
    const { token } = (await tokenReq(h, code, p)).body;
    await tokenReq(h, code, p); // rejeu → motif « replay »
    const extId = ((await b.json("/api/keys")).body.keys as { id: string; kind: string }[]).find((k) => k.kind === "extension")!.id;
    db.prepare("UPDATE ytc_key_meta SET last_used_at = ? WHERE key_id = ?").run("2026-10-10T10:00:00.000Z", short);
    const cols = () => (db.prepare("PRAGMA table_info(ytc_key_meta)").all() as { name: string }[]).map((c) => c.name);
    const tables = () => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'ytc_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
    const indexes = () => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'ytc_key_meta' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name);
    // 005 (Discord) est au-dessus : on redescend d'abord à 004 (sans clé « discord », rien n'est perdu).
    assert.deepEqual(appliedVersions(db), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    assert.deepEqual(migrateDown(db, 12), [16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
    assert.deepEqual(appliedVersions(db), [1, 2, 3, 4]);
    assert.deepEqual(cols(), ["key_id", "user_id", "revoked_at", "revoked_reason", "replaced_by", "created_at", "last_used_at", "kind", "device_label"]);

    assert.deepEqual(migrateDown(db, 1), [4]);
    assert.ok(!tables().includes("ytc_ext_code"));
    assert.deepEqual(cols(), ["key_id", "user_id", "revoked_at", "revoked_reason", "replaced_by", "created_at", "last_used_at"]);
    assert.deepEqual(indexes(), ["ytc_key_meta_user"]);
    const rows = db.prepare("SELECT key_id, revoked_at, revoked_reason, last_used_at FROM ytc_key_meta ORDER BY key_id").all() as { key_id: string; revoked_at: string | null; revoked_reason: string | null; last_used_at: string | null }[];
    assert.equal(rows.length, 2);
    const ex = rows.find((r) => r.key_id === extId)!;
    assert.ok(ex.revoked_at, "la clé reste révoquée");
    assert.equal(ex.revoked_reason, null, "« replay » n'existe pas avant 004");
    assert.equal(rows.find((r) => r.key_id === short)!.last_used_at, "2026-10-10T10:00:00.000Z");
    assert.throws(() => db.prepare("UPDATE ytc_key_meta SET revoked_reason = 'replay' WHERE key_id = ?").run(short));

    assert.deepEqual(migrateUp(db), [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    assert.deepEqual(cols(), ["key_id", "user_id", "revoked_at", "revoked_reason", "replaced_by", "created_at", "last_used_at", "kind", "device_label"]);
    assert.deepEqual(indexes(), ["ytc_key_meta_user"]);
    assert.ok(tables().includes("ytc_ext_code"));
    const kinds = db.prepare("SELECT kind, count(*) n FROM ytc_key_meta GROUP BY kind").all() as { kind: string; n: number }[];
    assert.deepEqual(kinds.map((k) => [k.kind, Number(k.n)]), [["shortcut", 2]], "le type n'est pas récupérable après un retour arrière : « shortcut » par défaut");
    db.prepare("UPDATE ytc_key_meta SET revoked_reason = 'replay' WHERE key_id = ?").run(extId);
    assert.throws(() => db.prepare("UPDATE ytc_key_meta SET kind = 'autre' WHERE key_id = ?").run(short));
    assert.deepEqual(migrateUp(db), []);
    assert.deepEqual(appliedVersions(db), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    // contrainte de clé étrangère conservée : suppression du compte → méta effacée
    assert.equal(token.length, 68);
    assert.equal((await b.json("/api/auth/delete-user", { method: "POST", body: {} })).status, 200);
    assert.equal((db.prepare("SELECT count(*) n FROM ytc_key_meta").get() as { n: number }).n, 0);
  } finally { h.close(); }
});

test("« Ouvrir dans Tools » depuis l'extension : lien du seul compte (fragment, 55 min, empreinte), Tools fermé → 404, clé requise", async () => {
  const closed = await harness(ENV);
  try {
    const b = await newUser(closed, "tools-ferme@example.test");
    const { token } = await link(closed, b);
    const r = await ext(closed, "/api/extension/outils", { method: "POST", token, body: { job_id: "abcdef123456" } });
    assert.deepEqual([r.status, r.body.error], [404, "tools_unavailable"]);
  } finally { closed.close(); }

  const h = await harness({ ...ENV, TOOLS_ENABLED: "1" });
  try {
    const b = await newUser(h, "tools@example.test");
    const { token } = await link(h, b);
    assert.deepEqual((await ext(h, "/api/extension/me", { token })).body.features, { tools: true });
    const ok = await ext(h, "/api/extension/outils", { method: "POST", token, body: { job_id: "Job_abc-123456" } });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const m = /^https?:\/\/[^/]+\/outils\/studio#ref=([A-Za-z0-9_-]{40,})$/.exec(ok.body.url);
    assert.ok(m, ok.body.url);
    assert.ok(Date.parse(ok.body.expiresAt) - Date.now() > 50 * 60_000 && Date.parse(ok.body.expiresAt) - Date.now() <= 55 * 60_000 + 5_000);
    const row = h.s.db.prepare("SELECT token_hash, user_id, job_id, origin FROM ytc_outils_ref").get() as Record<string, string>;
    assert.equal(row.origin, "extension");
    assert.equal(row.job_id, "Job_abc-123456");
    assert.notEqual(row.token_hash, m![1], "seule l'empreinte est gardée");
    // Refus : sans clé, avec la session seule, clé du raccourci, identifiant invalide, champ en trop, autre origine.
    assert.equal((await ext(h, "/api/extension/outils", { method: "POST", body: { job_id: "Job_abc-123456" } })).status, 401);
    assert.equal((await b.json("/api/extension/outils", { method: "POST", body: { job_id: "Job_abc-123456" } })).status, 403, "depuis le site (session seule) : origine refusée");
    const shortcut = (await b.json("/api/keys", { method: "POST", body: { name: "iPhone" } })).body.secret as string;
    assert.equal((await ext(h, "/api/extension/outils", { method: "POST", token: shortcut, body: { job_id: "Job_abc-123456" } })).status, 401);
    assert.equal((await ext(h, "/api/extension/outils", { method: "POST", token, body: { job_id: "../x" } })).status, 400);
    assert.equal((await ext(h, "/api/extension/outils", { method: "POST", token, body: { job_id: "Job_abc-123456", url: "x" } })).status, 400);
    assert.equal((await ext(h, "/api/extension/outils", { method: "POST", token, body: { job_id: "Job_abc-123456" }, origin: "https://evil.example" })).status, 403);
    // 30 liens par 10 min et par clé (le premier lien et les deux demandes mal formées ont déjà compté).
    for (let i = 4; i <= 30; i++) assert.equal((await ext(h, "/api/extension/outils", { method: "POST", token, body: { job_id: `Job_${i}_abcdef` } })).status, 201);
    assert.equal((await ext(h, "/api/extension/outils", { method: "POST", token, body: { job_id: "Job_31_abcdef" } })).status, 429);
  } finally { h.close(); }
});

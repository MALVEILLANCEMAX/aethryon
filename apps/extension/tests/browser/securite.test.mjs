// ESSAIS DE SÉCURITÉ du protocole de connexion de l'extension, contre la PRÉPRODUCTION (account et site de cette
// branche, ytapi à faux worker), pour l'audit docs/AUDIT-SECURITE-EXTENSION.md : chaque essai est une attaque réelle
// envoyée au vrai serveur, avec la réponse exacte attendue. Résultats bruts (statuts, codes d'erreur ; jamais un
// secret) écrits dans tests/out/securite/essais.json.
//   rejeu d'un code, PKCE erroné (vérificateur faux, méthode « plain », défi mal formé), redirection étrangère,
//   identifiant d'extension inconnu, CSRF (origine, type de contenu, session absente), cookie à la place de la clé,
//   clé du raccourci présentée comme clé d'extension, 4ᵉ appareil, jeton révoqué (« Mes jetons », administrateur),
//   compte suspendu, clickjacking de la page de consentement (en-têtes + vrai Chromium), fuite dans les journaux.
// Utilisateurs jetables (adresses en .test) supprimés à la fin ; account redémarré ensuite (limiteurs en mémoire
// remis à zéro pour les suites suivantes). Aucun secret affiché.
//   node --test tests/browser/securite.test.mjs        (pile de préproduction démarrée)
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTAINERS, DEV_EXTENSION_ID, ORIGIN, preprodAvailable, testSession, web, WEB, YTAPI } from "../support/preprod.mjs";
import { PW_PATH } from "./ui-helpers.mjs";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "tests", "out", "securite");
const PP = preprodAvailable();
const RUN = Date.now().toString(36);
const REDIRECT = `https://${DEV_EXTENSION_ID}.chromiumapp.org/aethryon`;
const EXT_ORIGIN = `chrome-extension://${DEV_EXTENSION_ID}`;
const UNKNOWN_ID = "abcdefghijklmnop".repeat(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (n = 32) => randomBytes(n).toString("base64url");
const s256 = (v) => createHash("sha256").update(v).digest("base64url");

describe("essais de sécurité du protocole de connexion (serveur réel de préproduction)", { skip: PP ? false : "préproduction arrêtée" }, () => {
  const secrets = [];
  const evidence = [];
  const users = {};
  let admin;

  /** Trace d'un essai (aucun secret : statut, code d'erreur, motif). */
  const note = (trial, attempt, res, extra = {}) => {
    evidence.push({ trial, attempt, status: res.status, error: res.body?.error ?? null, ...extra });
    return res;
  };
  const json = async (res) => ({ status: res.status, body: await res.json().catch(() => null), headers: res.headers });

  /** Consentement (comme la page /extension/autoriser) : renvoie {status, body, code, verifier}. */
  async function authorize(cookie, over = {}) {
    const verifier = b64();
    const body = { redirect_uri: REDIRECT, state: b64(), code_challenge: s256(verifier), code_challenge_method: "S256", appareil: `Essai-${RUN}`, ...over };
    const r = await web(cookie, "/api/extension/authorize", { method: "POST", body });
    const code = r.status === 200 ? new URL(r.body.redirect).searchParams.get("code") : null;
    if (code) secrets.push(code, verifier);
    return { ...r, code, verifier };
  }
  /** Échange du code (comme le service worker) ; origine de l'extension par défaut. */
  async function exchange(body, { origin = EXT_ORIGIN } = {}) {
    const headers = { "content-type": "application/json" };
    if (origin) headers.origin = origin;
    const r = await json(await fetch(`${WEB}/api/extension/token`, { method: "POST", headers, body: JSON.stringify(body) }));
    if (r.body?.token) secrets.push(r.body.token);
    return r;
  }
  const me = async (token, headers = {}) => json(await fetch(`${WEB}/api/extension/me`, { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } }));
  // 429 : limite de débit de ytapi (20 requêtes par minute et par adresse, avant tout contrôle du jeton) atteinte par
  // les essais qui précèdent ; elle ne dit rien du jeton : on attend le délai annoncé (Retry-After) et on redemande.
  const ytapiStatus = async (token) => {
    for (let i = 0; ; i++) {
      const r = await fetch(`${YTAPI}/jobs/essai-securite`, { headers: { authorization: `Bearer ${token}` } });
      if (r.status !== 429 || i === 2) return r.status;
      await new Promise((ok) => setTimeout(ok, (Number(r.headers.get("retry-after")) || 30) * 1000 + 500));
    }
  };
  async function link(cookie, tag) {
    const a = await authorize(cookie, { appareil: `${tag}-${RUN}` });
    assert.equal(a.status, 200, `autorisation ${tag}`);
    const t = await exchange({ code: a.code, code_verifier: a.verifier, redirect_uri: REDIRECT });
    assert.equal(t.status, 200, `échange ${tag}`);
    const key = (await web(cookie, "/api/keys")).body.keys.find((k) => k.kind === "extension" && k.deviceLabel === `${tag}-${RUN}`);
    return { token: t.body.token, keyId: key.id };
  }

  before(async () => {
    mkdirSync(OUT, { recursive: true });
    admin = testSession("admin@preprod.test", { admin: true });
    secrets.push(admin.split("=").slice(1).join("="));
    for (const u of ["a", "b"]) {
      const email = `ext-securite-${u}-${RUN}@preprod.test`;
      const cookie = testSession(email);
      secrets.push(cookie.split("=").slice(1).join("="));
      users[u] = { email, cookie, id: (await web(cookie, "/api/me")).body.user.id };
    }
  });

  after(async () => {
    writeFileSync(join(OUT, "essais.json"), `${JSON.stringify({ date: new Date().toISOString(), essais: evidence }, null, 2)}\n`);
    for (const u of Object.values(users)) {
      await web(admin, `/api/admin/users/${u.id}/status`, { method: "POST", body: { status: "active" } }).catch(() => undefined);
      const c = testSession(u.email); // session fraîche (la suspension a supprimé les précédentes)
      await web(c, "/api/auth/delete-user", { method: "POST", body: {} }).catch(() => undefined);
    }
    // Limiteurs d'account (en mémoire) remis à zéro : ces essais font volontairement beaucoup d'échanges.
    execFileSync("docker", ["restart", CONTAINERS.account], { stdio: "ignore" });
    for (let i = 0; i < 60; i++) {
      if (execFileSync("docker", ["inspect", CONTAINERS.account, "-f", "{{.State.Health.Status}}"]).toString().trim() === "healthy") break;
      await sleep(1000);
    }
  });

  test("rejeu d'un code : second échange refusé (400 invalid_grant) et la clé émise avec ce code est révoquée (motif « replay ») ; ytapi la refuse", async () => {
    const T = "rejeu";
    const a = await authorize(users.a.cookie);
    const first = note(T, "premier échange", await exchange({ code: a.code, code_verifier: a.verifier, redirect_uri: REDIRECT }));
    assert.equal(first.status, 200);
    assert.equal(await ytapiStatus(first.body.token), 404, "clé acceptée par ytapi avant le rejeu (job inconnu)");
    const again = note(T, "même code rejoué", await exchange({ code: a.code, code_verifier: a.verifier, redirect_uri: REDIRECT }));
    assert.deepEqual([again.status, again.body.error, "token" in again.body], [400, "invalid_grant", false]);
    const m = note(T, "/me avec la clé émise", await me(first.body.token), { revokedBy: null });
    evidence.at(-1).revokedBy = m.body?.revokedBy ?? null;
    assert.deepEqual([m.status, m.body.error, m.body.revokedBy], [401, "token_revoked", "replay"]);
    const y = await ytapiStatus(first.body.token);
    evidence.push({ trial: T, attempt: "ytapi avec la clé révoquée", status: y, error: null });
    assert.equal(y, 401);
  });

  test("PKCE erroné : vérificateur faux → 400 et code brûlé (le bon vérificateur ne passe plus) ; méthode « plain », défi ou vérificateur mal formés refusés", async () => {
    const T = "pkce";
    const a = await authorize(users.a.cookie);
    const wrong = note(T, "vérificateur faux", await exchange({ code: a.code, code_verifier: b64(), redirect_uri: REDIRECT }));
    assert.deepEqual([wrong.status, wrong.body.error], [400, "invalid_grant"]);
    const right = note(T, "bon vérificateur après l'échec", await exchange({ code: a.code, code_verifier: a.verifier, redirect_uri: REDIRECT }));
    assert.deepEqual([right.status, right.body.error], [400, "invalid_grant"], "code brûlé");
    const plain = note(T, "méthode plain", await authorize(users.a.cookie, { code_challenge_method: "plain" }));
    assert.deepEqual([plain.status, plain.body.error], [400, "invalid_request"]);
    const shortChallenge = note(T, "défi de 42 caractères", await authorize(users.a.cookie, { code_challenge: "c".repeat(42) }));
    assert.deepEqual([shortChallenge.status, shortChallenge.body.error], [400, "invalid_request"]);
    const b = await authorize(users.a.cookie);
    const badVerifier = note(T, "vérificateur trop court (42)", await exchange({ code: b.code, code_verifier: "v".repeat(42), redirect_uri: REDIRECT }));
    assert.deepEqual([badVerifier.status, badVerifier.body.error], [400, "invalid_request"]);
    const keys = (await web(users.a.cookie, "/api/keys")).body.keys.filter((k) => k.kind === "extension" && k.status === "active");
    assert.equal(keys.length, 0, "aucune clé créée par ces essais (la clé du rejeu est révoquée)");
  });

  test("redirection étrangère : seule l'URI de retour EXACTE d'un identifiant autorisé est acceptée (autorisation, refus, échange)", async () => {
    const T = "redirection";
    const variants = {
      "autre site": "https://evil.test/aethryon",
      "http au lieu de https": `http://${DEV_EXTENSION_ID}.chromiumapp.org/aethryon`,
      "autre chemin": `https://${DEV_EXTENSION_ID}.chromiumapp.org/autre`,
      "barre oblique finale": `${REDIRECT}/`,
      "paramètre ajouté": `${REDIRECT}?next=https://evil.test`,
      "majuscules": REDIRECT.replace("chromiumapp", "ChromiumApp"),
      "sous-domaine": `https://x.${DEV_EXTENSION_ID}.chromiumapp.org/aethryon`,
      "port": `https://${DEV_EXTENSION_ID}.chromiumapp.org:444/aethryon`,
    };
    for (const [name, uri] of Object.entries(variants)) {
      const r = note(T, `autorisation : ${name}`, await authorize(users.a.cookie, { redirect_uri: uri }));
      assert.deepEqual([r.status, r.body.error], [400, "invalid_redirect_uri"], name);
    }
    const deny = note(T, "refus vers un autre site", await web(users.a.cookie, "/api/extension/deny", { method: "POST", body: { redirect_uri: "https://evil.test/aethryon", state: b64() } }));
    assert.deepEqual([deny.status, deny.body.error], [400, "invalid_redirect_uri"]);
    const a = await authorize(users.a.cookie);
    const t = note(T, "échange avec une autre URI que celle du code", await exchange({ code: a.code, code_verifier: a.verifier, redirect_uri: "https://evil.test/aethryon" }));
    assert.deepEqual([t.status, t.body.error], [400, "invalid_redirect_uri"]);
    // La redirection renvoyée par le serveur vise exactement l'URI demandée (la page la revérifie avant de la suivre).
    const ok = new URL((await web(users.a.cookie, "/api/extension/authorize", { method: "POST", body: { redirect_uri: REDIRECT, state: b64(), code_challenge: s256(b64()), code_challenge_method: "S256" } })).body.redirect);
    assert.equal(`${ok.origin}${ok.pathname}`, REDIRECT);
    assert.deepEqual([...ok.searchParams.keys()].sort(), ["code", "state"]);
    secrets.push(ok.searchParams.get("code"));
  });

  test("identifiant d'extension inconnu (bien formé) : autorisation refusée (400) ; origine chrome-extension://<inconnu> refusée (403) sur /token, /me et /logout", async () => {
    const T = "identifiant inconnu";
    const r = note(T, "autorisation pour un identifiant non autorisé", await authorize(users.a.cookie, { redirect_uri: `https://${UNKNOWN_ID}.chromiumapp.org/aethryon` }));
    assert.deepEqual([r.status, r.body.error], [400, "invalid_redirect_uri"]);
    const a = await authorize(users.a.cookie);
    const t = note(T, "échange depuis une autre extension", await exchange({ code: a.code, code_verifier: a.verifier, redirect_uri: REDIRECT }, { origin: `chrome-extension://${UNKNOWN_ID}` }));
    assert.deepEqual([t.status, t.body.error], [403, "invalid_origin"]);
    const m = note(T, "/me depuis une autre extension", await me(`ytc_${"a".repeat(64)}`, { origin: `chrome-extension://${UNKNOWN_ID}` }));
    assert.deepEqual([m.status, m.body.error], [403, "invalid_origin"]);
    const lo = note(T, "/logout depuis un site web", await json(await fetch(`${WEB}/api/extension/logout`, { method: "POST", headers: { origin: "https://evil.test", authorization: `Bearer ytc_${"a".repeat(64)}` } })));
    assert.deepEqual([lo.status, lo.body.error], [403, "invalid_origin"]);
    // Le code n'a pas été consommé par l'essai refusé : l'extension autorisée peut encore l'échanger.
    const legit = note(T, "échange légitime du même code ensuite", await exchange({ code: a.code, code_verifier: a.verifier, redirect_uri: REDIRECT }));
    assert.equal(legit.status, 200);
    await json(await fetch(`${WEB}/api/extension/logout`, { method: "POST", headers: { origin: EXT_ORIGIN, authorization: `Bearer ${legit.body.token}` } }));
  });

  test("CSRF et confusion de jetons : autorisation sans session (401), d'une origine étrangère (403) ou sans JSON (415) ; le cookie ne remplace jamais la clé ; une clé du raccourci n'est pas une clé d'extension", async () => {
    const T = "csrf";
    const body = { redirect_uri: REDIRECT, state: b64(), code_challenge: s256(b64()), code_challenge_method: "S256" };
    const anon = note(T, "autorisation sans session", await json(await fetch(`${WEB}/api/extension/authorize`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body) })));
    assert.deepEqual([anon.status, anon.body.error], [401, "unauthorized"]);
    const foreign = note(T, "autorisation depuis un autre site (cookie présent)", await json(await fetch(`${WEB}/api/extension/authorize`, { method: "POST", headers: { cookie: users.a.cookie, origin: "https://evil.test", "content-type": "application/json" }, body: JSON.stringify(body) })));
    assert.deepEqual([foreign.status, foreign.body.error], [403, "invalid_origin"]);
    const form = note(T, "autorisation en formulaire (text/plain)", await json(await fetch(`${WEB}/api/extension/authorize`, { method: "POST", headers: { cookie: users.a.cookie, origin: ORIGIN, "content-type": "text/plain" }, body: JSON.stringify(body) })));
    assert.deepEqual([form.status, form.body.error], [415, "unsupported_media_type"]);
    const cookieOnly = note(T, "/me avec le seul cookie de session", await me(null, { cookie: users.a.cookie }));
    assert.deepEqual([cookieOnly.status, cookieOnly.body.error], [401, "invalid_token"]);
    const shortcut = (await web(users.a.cookie, "/api/keys", { method: "POST", body: { name: "iPhone essai" } })).body.secret;
    secrets.push(shortcut);
    const sk = note(T, "/me avec une clé du raccourci", await me(shortcut));
    assert.deepEqual([sk.status, sk.body.error], [401, "invalid_token"]);
    const forged = note(T, "/me avec une clé inventée", await me(`ytc_${"Z".repeat(64)}`));
    assert.deepEqual([forged.status, forged.body.error], [401, "invalid_token"]);
  });

  test("4ᵉ appareil : avec 3 extensions liées, une 4ᵉ autorisation est refusée (409 too_many_extensions) ; la révocation d'un appareil libère une place", async () => {
    const T = "4e appareil";
    const linked = [];
    for (const n of [1, 2, 3]) linked.push(await link(users.b.cookie, `Appareil${n}`));
    const fourth = note(T, "4ᵉ autorisation", await authorize(users.b.cookie, { appareil: `Appareil4-${RUN}` }));
    assert.deepEqual([fourth.status, fourth.body.error], [409, "too_many_extensions"]);
    await web(users.b.cookie, `/api/keys/${linked[0].keyId}/revoke`, { method: "POST" });
    const again = note(T, "autorisation après une révocation", await authorize(users.b.cookie, { appareil: `Appareil4-${RUN}` }));
    assert.equal(again.status, 200);
    // Nettoyage : les liaisons restantes sont révoquées (déconnexion par l'extension).
    for (const l of linked.slice(1)) await fetch(`${WEB}/api/extension/logout`, { method: "POST", headers: { origin: EXT_ORIGIN, authorization: `Bearer ${l.token}` } });
  });

  test("jeton révoqué : depuis « Mes jetons » (motif user) puis par un administrateur (motif admin) → /me 401 avec le motif, ytapi 401 ; déconnexion idempotente (204)", async () => {
    const T = "jeton révoqué";
    const byUser = await link(users.a.cookie, "RevoqueUtilisateur");
    await web(users.a.cookie, `/api/keys/${byUser.keyId}/revoke`, { method: "POST" });
    const m1 = note(T, "/me après révocation dans « Mes jetons »", await me(byUser.token));
    evidence.at(-1).revokedBy = m1.body?.revokedBy ?? null;
    assert.deepEqual([m1.status, m1.body.error, m1.body.revokedBy], [401, "token_revoked", "user"]);
    const y1 = await ytapiStatus(byUser.token);
    evidence.push({ trial: T, attempt: "ytapi après révocation dans « Mes jetons »", status: y1, error: null });
    assert.equal(y1, 401);
    const byAdmin = await link(users.a.cookie, "RevoqueAdmin");
    assert.equal((await web(admin, `/api/admin/keys/${byAdmin.keyId}/revoke`, { method: "POST" })).status, 200);
    const m2 = note(T, "/me après révocation par un administrateur", await me(byAdmin.token));
    evidence.at(-1).revokedBy = m2.body?.revokedBy ?? null;
    assert.deepEqual([m2.status, m2.body.error, m2.body.revokedBy], [401, "token_revoked", "admin"]);
    assert.equal(await ytapiStatus(byAdmin.token), 401);
    const lo = note(T, "déconnexion avec une clé déjà révoquée", await json(await fetch(`${WEB}/api/extension/logout`, { method: "POST", headers: { origin: EXT_ORIGIN, authorization: `Bearer ${byAdmin.token}` } })));
    assert.equal(lo.status, 204);
  });

  test("compte suspendu : sessions supprimées (autorisation 401), code émis avant la suspension refusé (403 account_suspended), clé existante → /me 403 ; réactivation → /me 200", async () => {
    const T = "compte suspendu";
    const kept = await link(users.b.cookie, "AvantSuspension");
    const pending = await authorize(users.b.cookie, { appareil: `Suspendu-${RUN}` });
    assert.equal(pending.status, 200);
    assert.equal((await web(admin, `/api/admin/users/${users.b.id}/status`, { method: "POST", body: { status: "suspended" } })).status, 200);
    const auth = note(T, "autorisation avec la session d'avant la suspension", await authorize(users.b.cookie));
    assert.deepEqual([auth.status, auth.body.error], [401, "unauthorized"]);
    const t = note(T, "échange d'un code émis avant la suspension", await exchange({ code: pending.code, code_verifier: pending.verifier, redirect_uri: REDIRECT }));
    assert.deepEqual([t.status, t.body.error], [403, "account_suspended"]);
    const m = note(T, "/me avec une clé existante", await me(kept.token));
    assert.deepEqual([m.status, m.body.error], [403, "account_suspended"]);
    const y = await ytapiStatus(kept.token);
    evidence.push({ trial: T, attempt: "ytapi avec la clé d'un compte suspendu", status: y, error: null });
    assert.ok([401, 403].includes(y), `ytapi refuse (${y})`);
    assert.equal((await web(admin, `/api/admin/users/${users.b.id}/status`, { method: "POST", body: { status: "active" } })).status, 200);
    const back = note(T, "/me après réactivation", await me(kept.token));
    assert.equal(back.status, 200);
    users.b.cookie = testSession(users.b.email);
    secrets.push(users.b.cookie.split("=").slice(1).join("="));
  });

  test("clickjacking : la page de consentement interdit tout cadre (CSP frame-ancestors 'none', X-Frame-Options DENY, COOP) et un vrai Chromium refuse de l'afficher dans la page d'un autre site", { timeout: 60_000 }, async () => {
    const T = "clickjacking";
    const q = `redirect_uri=${encodeURIComponent(REDIRECT)}&state=${"s".repeat(43)}&code_challenge=${"c".repeat(43)}&code_challenge_method=S256&appareil=Essai`;
    const res = await fetch(`${WEB}/extension/autoriser?${q}`, { headers: { cookie: users.a.cookie } });
    const h = (n) => res.headers.get(n) ?? "";
    evidence.push({ trial: T, attempt: "en-têtes de /extension/autoriser", status: res.status, error: null, csp: h("content-security-policy"), xfo: h("x-frame-options"), coop: h("cross-origin-opener-policy"), referrer: h("referrer-policy") });
    assert.equal(res.status, 200);
    assert.match(h("content-security-policy"), /frame-ancestors 'none'/);
    assert.equal(h("x-frame-options"), "DENY");
    assert.equal(h("cross-origin-opener-policy"), "same-origin");
    assert.equal(h("referrer-policy"), "strict-origin-when-cross-origin");
    // Vrai navigateur : une page d'un autre site tente d'encadrer la page de consentement (session présente).
    const { chromium } = require(PW_PATH);
    const browser = await chromium.launch();
    try {
      const ctx = await browser.newContext();
      const i = users.a.cookie.indexOf("=");
      await ctx.addCookies([{ name: users.a.cookie.slice(0, i), value: users.a.cookie.slice(i + 1), domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
      await ctx.route("https://evil.test/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><title>piège</title><iframe id="f" src="${ORIGIN}/extension/autoriser?${q}" width="800" height="600"></iframe>` }));
      const page = await ctx.newPage();
      await page.goto("https://evil.test/");
      await sleep(2500);
      const frame = page.frames().find((f) => f !== page.mainFrame());
      const inside = await frame?.evaluate(() => document.body?.innerText ?? "").catch(() => "(inaccessible)");
      evidence.push({ trial: T, attempt: "iframe depuis un autre site (Chromium)", status: null, error: null, frameUrl: frame?.url() ?? null, consentShown: /Autoriser l'extension/.test(inside ?? "") });
      assert.ok(frame, "cadre présent dans la page piège");
      assert.ok(!/Autoriser l'extension/.test(inside ?? ""), "la page de consentement n'est jamais rendue dans le cadre");
      assert.match(frame.url(), /^chrome-error:|^about:blank/, `cadre bloqué (${frame.url()})`);
    } finally {
      await browser.close();
    }
  });

  test("journaux : aucun code, vérificateur, jeton ni cookie de ces essais dans les journaux du site, d'account et d'ytapi ; aucune query string journalisée par nginx", () => {
    const T = "journaux";
    for (const [role, c] of Object.entries(CONTAINERS)) {
      const logs = execFileSync("sh", ["-c", `docker logs --since 30m ${c} 2>&1`], { maxBuffer: 128 * 1024 * 1024 }).toString();
      const found = secrets.filter((s) => s && (logs.includes(s) || logs.includes(s.slice(4, 24))));
      evidence.push({ trial: T, attempt: `journaux de ${role}`, status: null, error: null, secretsTested: secrets.length, found: found.length });
      assert.equal(found.length, 0, `secret dans les journaux de ${c}`);
      if (role === "web") assert.ok(!/\/extension\/autoriser\?/.test(logs) && !/code_challenge=/.test(logs), "nginx : chemin seul, jamais la query string");
    }
  });
});

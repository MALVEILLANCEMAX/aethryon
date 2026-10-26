// Protection anti-bot (src/antibot.ts) : défi exigé, preuve vérifiée CÔTÉ SERVEUR par un faux Cap (même contrat que
// siteverify de Cap 3.1.15 : jeton supprimé à la lecture, expiration), rejeu, contournement par requête directe,
// ticket expiré, blocage temporaire, connexion après échecs, travaux du site, clients à clé et OAuth jamais défiés,
// compteurs réels du Control Center sans donnée personnelle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Browser, fakeMailer, harness, newUser, type Harness } from "./helpers.ts";
import { loadConfig, ConfigError } from "../src/config.ts";
import { ipPrefix } from "../src/antibot.ts";
import { migrateDown, migrateUp, appliedVersions } from "../src/db.ts";

const SITE_KEY = "a1b2c3d4e5";
const SECRET = "sk-" + "Z".repeat(40);
const PASSWORD = "cheval-agrafe-42";
const NAV = { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "accept-language": "fr-FR,fr;q=0.9" };

/** Faux Cap : siteverify comme Cap 3.1.15 (GETDEL, expiration, secret vérifié) ; `mint` = un défi résolu dans le navigateur. */
async function fakeCap() {
  const tokens = new Map<string, number>();
  const calls: { secretOk: boolean; response: string }[] = [];
  let down = false;
  const srv: HttpServer = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => { raw += d; });
    req.on("end", () => {
      const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
      if (down) return send(503, { error: "redis down" });
      if (req.method === "GET" && req.url === "/health") return send(200, { ok: true });
      const m = /^\/([0-9a-f]{10})\/siteverify$/.exec(req.url ?? "");
      if (req.method !== "POST" || !m) return send(404, { error: "not found" });
      const { secret, response } = JSON.parse(raw || "{}") as { secret?: string; response?: string };
      calls.push({ secretOk: secret === SECRET, response: String(response) });
      if (m[1] !== SITE_KEY || secret !== SECRET) return send(403, { success: false, error: "Invalid site key or secret" });
      const exp = tokens.get(String(response));
      tokens.delete(String(response)); // GETDEL
      if (!exp) return send(404, { success: false, error: "Token not found" });
      if (exp < Date.now()) return send(403, { success: false, error: "Token expired" });
      return send(200, { success: true });
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`, tokens, calls,
    set down(v: boolean) { down = v; },
    mint(ttlMs = 2 * 3_600_000) { const t = `${SITE_KEY}:${randomBytes(12).toString("base64url")}:${randomBytes(16).toString("hex")}`; tokens.set(t, Date.now() + ttlMs); return t; },
    close() { srv.close(); },
  };
}

async function setup(env: Record<string, string> = {}) {
  const cap = await fakeCap();
  const dir = mkdtempSync(join(tmpdir(), "ytc2-antibot-"));
  const secretFile = join(dir, "cap_secret");
  writeFileSync(secretFile, SECRET, { mode: 0o600 });
  const m = fakeMailer();
  const h = await harness({ ANTIBOT: "on", CAP_INTERNAL_URL: cap.url, CAP_SITE_KEY: SITE_KEY, CAP_SECRET_FILE: secretFile, TOOLS_ENABLED: "1", ...env }, { mailer: m });
  return { h, cap, m, close() { h.close(); cap.close(); } };
}

type J = { status: number; body: any; headers: Headers };
async function call(b: Browser, path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<J> {
  const res = await b.req(path, { ...init, headers: { ...NAV, ...(init.headers ?? {}) } });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}
/** Action, défi exigé, preuve résolue (jeton du faux Cap), même action rejouée avec la preuve. */
async function withProof(b: Browser, cap: Awaited<ReturnType<typeof fakeCap>>, path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const first = await call(b, path, init);
  assert.equal(first.status, 403, JSON.stringify(first.body));
  assert.equal(first.body.error, "challenge_required");
  const token = cap.mint();
  const second = await call(b, path, { ...init, headers: { ...(init.headers ?? {}), "x-aethryon-challenge": first.body.challenge.ticket, "x-aethryon-verification": token } });
  return { first, second, token, ticket: first.body.challenge.ticket as string };
}
const flushRows = async (h: Harness) => {
  await h.s.antibot.flush();
  return Object.fromEntries((h.s.db.prepare("SELECT metric || '/' || action AS k, sum(n) AS n FROM ytc_security_counter GROUP BY metric, action").all() as { k: string; n: number }[]).map((r) => [r.k, Number(r.n)]));
};

test("configuration : off par défaut sans rien lire ; on/observe exigent Cap (URL interne, clé, secret sk-)", () => {
  const base = { PUBLIC_URL: "https://x.test", BETTER_AUTH_SECRET_FILE: "/nonexistent", INTERNAL_TOKEN_FILE: "/nonexistent" };
  assert.throws(() => loadConfig({ ...base }), ConfigError); // secrets requis par ailleurs : on teste loadAntibot ci-dessous
  const dir = mkdtempSync(join(tmpdir(), "ytc2-antibot-cfg-"));
  const w = (n: string, v: string) => { const p = join(dir, n); writeFileSync(p, v); return p; };
  const env = { PUBLIC_URL: "https://x.test", BETTER_AUTH_SECRET_FILE: w("a", "s".repeat(40)), INTERNAL_TOKEN_FILE: w("i", "t".repeat(40)) };
  assert.equal(loadConfig(env).antibot.mode, "off");
  assert.equal(loadConfig(env).antibot.secret, null);
  assert.throws(() => loadConfig({ ...env, ANTIBOT: "oui" }), /ANTIBOT doit valoir/);
  assert.throws(() => loadConfig({ ...env, ANTIBOT: "on" }), /CAP_INTERNAL_URL/);
  assert.throws(() => loadConfig({ ...env, ANTIBOT: "on", CAP_INTERNAL_URL: "http://ytc-cap:3000", CAP_SITE_KEY: "XYZ" }), /CAP_SITE_KEY/);
  assert.throws(() => loadConfig({ ...env, ANTIBOT: "on", CAP_INTERNAL_URL: "http://ytc-cap:3000", CAP_SITE_KEY: SITE_KEY, CAP_SECRET_FILE: w("c", "pas-un-secret") }), /CAP_SECRET_FILE/);
  const ok = loadConfig({ ...env, ANTIBOT: "observe", CAP_INTERNAL_URL: "http://ytc-cap:3000/", CAP_SITE_KEY: SITE_KEY, CAP_SECRET_FILE: w("d", SECRET) }).antibot;
  assert.deepEqual([ok.mode, ok.capUrl, ok.siteKey, ok.ticketTtlS, ok.passTtlS, ok.blockS], ["observe", "http://ytc-cap:3000", SITE_KEY, 300, 1800, 900]);
  assert.equal(loadConfig({ ...env, ANTIBOT: "on", CAP_INTERNAL_URL: "http://ytc-cap:3000", CAP_SITE_KEY_FILE: w("k", `${SITE_KEY}\n`), CAP_SECRET_FILE: w("e", SECRET) }).antibot.siteKey, SITE_KEY);
});

test("IP tronquée pour le journal : /24 et /48, jamais l'adresse complète", () => {
  assert.equal(ipPrefix("203.0.113.42"), "203.0.113.0/24");
  assert.equal(ipPrefix("::ffff:198.51.100.7"), "198.51.100.0/24");
  assert.equal(ipPrefix("2001:db8:1:2::1"), "2001:db8:1::/48");
  assert.equal(ipPrefix("unknown"), null);
});

test("ANTIBOT=off : aucun défi, aucune requête vers Cap (comportement d'avant)", async () => {
  const cap = await fakeCap();
  const m = fakeMailer();
  const h = await harness({ CAP_INTERNAL_URL: cap.url }, { mailer: m });
  try {
    const r = await call(new Browser(h), "/api/inscription/demande", { method: "POST", body: { email: "a@example.test" } });
    assert.equal(r.status, 202);
    assert.equal(m.sent.length, 1);
    assert.equal(cap.calls.length, 0);
  } finally { h.close(); cap.close(); }
});

test("inscription : défi exigé (aucun e-mail), preuve vérifiée par le serveur → 202 + X-Aethryon-Verification ; rejeu refusé", async () => {
  const t = await setup();
  try {
    const b = new Browser(t.h);
    const { first, second, token } = await withProof(b, t.cap, "/api/inscription/demande", { method: "POST", body: { email: "lea@example.test" } });
    assert.deepEqual(Object.keys(first.body.challenge).sort(), ["action", "endpoint", "expiresInSeconds", "ticket"]);
    assert.equal(first.body.challenge.endpoint, `/cap/${SITE_KEY}/`);
    assert.equal(first.body.challenge.action, "inscription");
    assert.equal(first.headers.get("x-aethryon-verification"), null);
    assert.equal(second.status, 202, JSON.stringify(second.body));
    assert.equal(second.headers.get("x-aethryon-verification"), "ok");
    assert.equal(t.m.sent.length, 1, "un seul e-mail : après la preuve");
    assert.ok(t.cap.calls.every((x) => x.secretOk), "secret transmis à Cap");
    // Rejeu du même jeton avec un nouveau ticket : refusé (liste locale), Cap n'est même pas rappelé.
    const again = await call(b, "/api/inscription/demande", { method: "POST", body: { email: "lea@example.test" } });
    const n = t.cap.calls.length;
    const replay = await call(b, "/api/inscription/demande", { method: "POST", body: { email: "lea@example.test" }, headers: { "x-aethryon-challenge": again.body.challenge.ticket, "x-aethryon-verification": token } });
    assert.deepEqual([replay.status, replay.body.error], [403, "challenge_failed"]);
    assert.equal(t.cap.calls.length, n);
    // Jeton déjà consommé chez Cap (autre processus account, redémarrage) : Cap le refuse (GETDEL).
    const fresh = t.cap.mint();
    t.cap.tokens.delete(fresh);
    const third = await call(b, "/api/inscription/demande", { method: "POST", body: { email: "lea@example.test" } });
    const r = await call(b, "/api/inscription/demande", { method: "POST", body: { email: "lea@example.test" }, headers: { "x-aethryon-challenge": third.body.challenge.ticket, "x-aethryon-verification": fresh } });
    assert.deepEqual([r.status, r.body.error], [403, "challenge_failed"]);
    assert.equal(t.m.sent.length, 1);
    const c = await flushRows(t.h);
    assert.equal(c["challenge_issued/inscription"], 3);
    assert.equal(c["challenge_passed/inscription"], 1);
    assert.equal(c["challenge_replay/inscription"], 1);
    assert.equal(c["challenge_failed/inscription"], 1);
  } finally { t.close(); }
});

test("contournement du site par requête directe : jeton inventé, jeton sans ticket, ticket d'un autre sujet", async () => {
  const t = await setup();
  try {
    const body = { email: "x@example.test" };
    const b = new Browser(t.h);
    const fake = `${SITE_KEY}:${"A".repeat(16)}:${"b".repeat(32)}`;
    // Jeton seul, sans ticket.
    assert.equal((await call(b, "/api/inscription/demande", { method: "POST", body, headers: { "x-aethryon-verification": fake } })).body.error, "challenge_failed");
    // Ticket valable, jeton inventé (Cap ne le connaît pas).
    let ch = await call(b, "/api/inscription/demande", { method: "POST", body });
    assert.equal((await call(b, "/api/inscription/demande", { method: "POST", body, headers: { "x-aethryon-challenge": ch.body.challenge.ticket, "x-aethryon-verification": fake } })).body.error, "challenge_failed");
    // Ticket émis pour un autre sujet (autre IP et autre navigateur) : refusé même avec un vrai jeton.
    ch = await call(b, "/api/inscription/demande", { method: "POST", body });
    const other = new Browser(t.h);
    assert.equal((await call(other, "/api/inscription/demande", { method: "POST", body, headers: { "x-aethryon-challenge": ch.body.challenge.ticket, "x-aethryon-verification": t.cap.mint() } })).body.error, "challenge_failed");
    assert.equal(t.m.sent.length, 0, "aucun e-mail sans preuve acceptée");
  } finally { t.close(); }
});

test("ticket expiré → challenge_expired (puis nouveau défi) ; Cap indisponible → 503 verification_unavailable", async () => {
  const t = await setup({ ANTIBOT_TICKET_TTL_S: "1" });
  try {
    const b = new Browser(t.h);
    const body = { email: "y@example.test" };
    const ch = await call(b, "/api/inscription/demande", { method: "POST", body });
    await new Promise((r) => setTimeout(r, 1100));
    const r = await call(b, "/api/inscription/demande", { method: "POST", body, headers: { "x-aethryon-challenge": ch.body.challenge.ticket, "x-aethryon-verification": t.cap.mint() } });
    assert.deepEqual([r.status, r.body.error], [403, "challenge_expired"]);
    // Jeton Cap expiré (2 h dépassées côté Cap) : refusé par siteverify.
    const ch2 = await call(b, "/api/inscription/demande", { method: "POST", body });
    const r2 = await call(b, "/api/inscription/demande", { method: "POST", body, headers: { "x-aethryon-challenge": ch2.body.challenge.ticket, "x-aethryon-verification": t.cap.mint(-1000) } });
    assert.deepEqual([r2.status, r2.body.error], [403, "challenge_failed"]);
    t.cap.down = true;
    const ch3 = await call(b, "/api/inscription/demande", { method: "POST", body });
    const r3 = await call(b, "/api/inscription/demande", { method: "POST", body, headers: { "x-aethryon-challenge": ch3.body.challenge.ticket, "x-aethryon-verification": t.cap.mint() } });
    assert.deepEqual([r3.status, r3.body.error, r3.headers.get("retry-after")], [503, "verification_unavailable", "10"]);
    assert.equal(t.m.sent.length, 0);
    const c = await flushRows(t.h);
    assert.equal(c["challenge_expired/inscription"], 1);
    assert.equal(c["verify_unavailable/inscription"], 1);
  } finally { t.close(); }
});

test("niveau 3 : 5 preuves refusées → 429 temporarily_blocked (Retry-After), un autre navigateur n'est pas touché", async () => {
  const t = await setup();
  try {
    const b = new Browser(t.h);
    const body = { email: "z@example.test" };
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const ch = await call(b, "/api/inscription/demande", { method: "POST", body });
      codes.push((await call(b, "/api/inscription/demande", { method: "POST", body, headers: { "x-aethryon-challenge": ch.body.challenge.ticket, "x-aethryon-verification": `${SITE_KEY}:faux${i}:${"c".repeat(20)}` } })).body.error);
    }
    assert.deepEqual(codes, ["challenge_failed", "challenge_failed", "challenge_failed", "challenge_failed", "temporarily_blocked"]);
    const blocked = await call(b, "/api/inscription/demande", { method: "POST", body });
    assert.deepEqual([blocked.status, blocked.body.error], [429, "temporarily_blocked"]);
    assert.ok(Number(blocked.headers.get("retry-after")) > 800);
    // Même IP, autre navigateur (autre agent HTTP) : jamais l'IP seule → simple défi, pas de blocage.
    const sameIp = new Browser(t.h); sameIp.ip = b.ip;
    const r = await call(sameIp, "/api/inscription/demande", { method: "POST", body, headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0 Safari/537.36" } });
    assert.equal(r.body.error, "challenge_required");
    const c = await flushRows(t.h);
    assert.equal(c["block_started/inscription"], 1);
    assert.ok((c["blocked/inscription"] ?? 0) >= 1);
    assert.equal(c["rate_limited/inscription"] ?? 0, 0, "un blocage n'est pas compté deux fois");
  } finally { t.close(); }
});

test("connexion : 3 échecs → défi à chaque tentative (même depuis un autre réseau) ; bonne preuve + bon mot de passe → 200", async () => {
  const t = await setup();
  try {
    // Compte à mot de passe créé par le parcours réel (défi de l'inscription compris).
    const s = new Browser(t.h);
    const { second } = await withProof(s, t.cap, "/api/inscription/demande", { method: "POST", body: { email: "mdp@example.test" } });
    assert.equal(second.status, 202);
    const token = /#([A-Za-z0-9_-]{43})/.exec(t.m.sent.at(-1)!.text)![1]!;
    assert.equal((await call(s, "/api/inscription/terminer", { method: "POST", body: { token, name: "Mia", password: PASSWORD } })).status, 201);

    const b = new Browser(t.h);
    const bad = { email: "mdp@example.test", password: "mauvais-mot-de-passe" };
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) codes.push((await call(b, "/api/auth/sign-in/email", { method: "POST", body: bad })).status);
    assert.deepEqual(codes, [401, 401, 401]);
    // 4e tentative, même depuis un autre réseau : l'adresse visée exige un défi.
    const elsewhere = new Browser(t.h);
    const r = await call(elsewhere, "/api/auth/sign-in/email", { method: "POST", body: { email: "MDP@example.test", password: PASSWORD } });
    assert.deepEqual([r.status, r.body.error, r.body.challenge.action], [403, "challenge_required", "connexion"]);
    const ok = await call(elsewhere, "/api/auth/sign-in/email", { method: "POST", body: { email: "mdp@example.test", password: PASSWORD }, headers: { "x-aethryon-challenge": r.body.challenge.ticket, "x-aethryon-verification": t.cap.mint() } });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("x-aethryon-verification"), "ok");
    assert.equal((await call(elsewhere, "/api/me")).body.user.email, "mdp@example.test");
    // Réussite : compteur de l'adresse remis à zéro → plus de défi.
    assert.equal((await call(new Browser(t.h), "/api/auth/sign-in/email", { method: "POST", body: { email: "mdp@example.test", password: PASSWORD } })).status, 200);
    // « Mot de passe oublié » : toujours un défi (un e-mail part).
    const reset = await call(new Browser(t.h), "/api/auth/request-password-reset", { method: "POST", body: { email: "mdp@example.test" } });
    assert.deepEqual([reset.status, reset.body.challenge.action], [403, "mot_de_passe"]);
    // Ticket de connexion présenté sur « mot de passe oublié » : autre action → refusé.
    const lg = new Browser(t.h);
    for (let i = 0; i < 3; i++) await call(lg, "/api/auth/sign-in/email", { method: "POST", body: bad });
    const ch = await call(lg, "/api/auth/sign-in/email", { method: "POST", body: bad });
    const cross = await call(lg, "/api/auth/request-password-reset", { method: "POST", body: { email: "mdp@example.test" }, headers: { "x-aethryon-challenge": ch.body.challenge.ticket, "x-aethryon-verification": t.cap.mint() } });
    assert.equal(cross.body.error, "challenge_failed");
    // Aucune adresse e-mail dans la base de sécurité.
    await t.h.s.antibot.flush();
    const dump = JSON.stringify(t.h.s.db.prepare("SELECT * FROM ytc_security_event").all()) + JSON.stringify(t.h.s.db.prepare("SELECT * FROM ytc_security_counter").all());
    assert.ok(!dump.includes("mdp@") && !dump.includes(b.ip), "ni e-mail ni IP complète");
  } finally { t.close(); }
});

test("Google OAuth et sessions jamais défiés ; webhook Stripe, routes à clé (extension, Premiere, Desktop) jamais défiés", async () => {
  const t = await setup();
  try {
    const u = await newUser(t.h, "google@example.test"); // échoue si le flux de redirection change
    assert.equal((await call(u, "/api/me")).body.user.email, "google@example.test");
    const anon = new Browser(t.h);
    for (const [method, path] of [["POST", "/api/facturation/webhook"], ["GET", "/api/extension/me"], ["POST", "/api/premiere/appairage"], ["POST", "/api/desktop/appairage"], ["GET", "/api/auth/get-session"], ["POST", "/api/auth/sign-out"]] as const) {
      for (let i = 0; i < 3; i++) {
        const r = await call(anon, path, { method, headers: { "user-agent": "curl/8.5.0", authorization: "Bearer ytc_" + "A".repeat(64) } });
        assert.notEqual(r.body?.error, "challenge_required", `${method} ${path}`);
      }
    }
    assert.equal((await flushRows(t.h))["challenge_issued/connexion"] ?? 0, 0);
  } finally { t.close(); }
});

test("travaux du site : niveau 1 sans défi, défi au-delà du seuil, laissez-passer serveur ; agent d'outil défié d'emblée ; Authorization ne dispense pas", async () => {
  const t = await setup({ ANTIBOT_TRAVAUX_SEUIL: "3" });
  try {
    t.h.ytapi.handler = async ({ url }) => (url.pathname === "/preview"
      ? new Response(JSON.stringify({ platform: "tiktok", title: "Test", duration: 10, qualities: [], media_count: 1 }), { headers: { "content-type": "application/json" } })
      : null);
    const u = await newUser(t.h, "outils@example.test");
    const body = { url: "https://www.tiktok.com/@nasa/video/7300000000000000000" };
    const st: number[] = [];
    for (let i = 0; i < 3; i++) st.push((await call(u, "/api/outils/apercu", { method: "POST", body })).status);
    assert.deepEqual(st, [200, 200, 200], "niveau 1 : aucun défi");
    const { first, second } = await withProof(u, t.cap, "/api/outils/apercu", { method: "POST", body });
    assert.equal(first.body.challenge.action, "travaux");
    assert.equal(second.status, 200);
    assert.equal(second.headers.get("x-aethryon-verification"), "ok");
    for (let i = 0; i < 5; i++) assert.equal((await call(u, "/api/outils/apercu", { method: "POST", body })).status, 200, "laissez-passer de 30 min");
    // Script avec la session volée d'un autre compte : agent d'outil + sans Sec-Fetch → défi dès la première action,
    // même avec un en-tête Authorization ajouté.
    const v = await newUser(t.h, "script@example.test");
    const r = await v.req("/api/outils/apercu", { method: "POST", body, headers: { "user-agent": "python-requests/2.32", authorization: "Bearer ytc_" + "B".repeat(64) } });
    assert.deepEqual([r.status, ((await r.json()) as { error: string }).error], [403, "challenge_required"]);
  } finally { t.close(); }
});

test("requêtes limitées : chaque 429 (protections existantes) comptée ; section « Sécurité » : chiffres réels, admin seulement", async () => {
  const t = await setup();
  try {
    const x = new Browser(t.h);
    const codes: number[] = [];
    // Limite existante de Better Auth (5/min/IP) : 6e tentative → 429 ; la 4e et la 5e exigent déjà un défi (3 échecs).
    for (let i = 0; i < 3; i++) codes.push((await call(x, "/api/auth/sign-in/email", { method: "POST", body: { email: "n@example.test", password: "mauvais-mot-de-passe" } })).status);
    assert.deepEqual(codes, [401, 401, 401]);
    const user = await newUser(t.h, "user@example.test");
    assert.equal((await call(user, "/api/admin/securite")).status, 403);
    const admin = await newUser(t.h, "boss@example.test");
    t.h.s.db.prepare("UPDATE \"user\" SET role = 'admin' WHERE email = 'boss@example.test'").run();
    // Limite de création de clés existante (10 par heure) : 11e → 429, comptée.
    for (let i = 0; i < 11; i++) await call(admin, "/api/keys", { method: "POST", body: { name: `k${i}` } });
    const rep = await call(admin, "/api/admin/securite");
    assert.equal(rep.status, 200);
    assert.equal(rep.body.mode, "on");
    assert.equal(rep.body.cap, "ok");
    assert.equal(rep.body.capConfigured, true);
    assert.ok(rep.body.jour.rate_limited.parAction.keys >= 1, JSON.stringify(rep.body.jour));
    assert.equal(rep.body.jour.login_failed.total, 3);
    assert.ok(Array.isArray(rep.body.evenements));
    for (const e of rep.body.evenements) {
      assert.match(e.subject, /^[0-9a-f]{12}$/);
      assert.ok(e.ipPrefix === null || /\/(24|48)$/.test(e.ipPrefix));
    }
    assert.ok(!JSON.stringify(rep.body).includes(SECRET), "secret jamais renvoyé");
  } finally { t.close(); }
});

test("ANTIBOT=observe : rien n'est demandé, les décisions sont comptées", async () => {
  const t = await setup({ ANTIBOT: "observe" });
  try {
    const r = await call(new Browser(t.h), "/api/inscription/demande", { method: "POST", body: { email: "obs@example.test" } });
    assert.equal(r.status, 202);
    assert.equal(t.m.sent.length, 1);
    assert.equal((await flushRows(t.h))["challenge_observed/inscription"], 1);
  } finally { t.close(); }
});

test("migration 016 : tables créées, retour arrière propre, remontée", async () => {
  const t = await setup();
  try {
    const db = t.h.s.db;
    assert.ok(appliedVersions(db).includes(16));
    await t.h.s.antibot.flush();
    t.h.s.antibot.stop();
    migrateDown(db, 1);
    assert.ok(!appliedVersions(db).includes(16));
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'ytc_security%'").get()!.n, 0);
    migrateUp(db);
    assert.ok(appliedVersions(db).includes(16));
  } finally { t.close(); }
});

// Liaison Discord (docs/DISCORD-BOT.md §17) : configuration, OAuth2 contre un FAUX serveur Discord local
// (fake-discord.ts, vrai HTTP sur 127.0.0.1 ; aucune requête vers Discord), states, erreurs, unicité,
// déliaison, API interne du bot (secret, réseau), clés « discord » (type, durée, plafond, suspension),
// quota partagé, lien de téléchargement, export, suppression du compte, purge, journaux.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { ConfigError, loadConfig } from "../src/config.ts";
import { DISCORD_KEY_TTL_S, MAX_DISCORD_KEYS } from "../src/keys.ts";
import { MAX_PENDING_DOWNLOADS, sha } from "../src/discord.ts";
import { Browser, googleLogin, harness, INTERNAL, internalCall, newUser, ORIGIN, type Harness } from "./helpers.ts";
import { startFakeDiscord, type FakeDiscord, type FakeProfile } from "./fake-discord.ts";

const CLIENT_ID = "1558821698734923796";
const CLIENT_SECRET = "faux-secret-client-" + "c".repeat(24);
const BOT_TOKEN = "faux-secret-du-bot-" + "b".repeat(40);
const REDIRECT = `${ORIGIN}/api/discord/callback`;
let seq = 1;
/** Identifiant Discord fictif (18 chiffres) propre à ce lancement. */
const did = () => `9${String(Date.now()).slice(-9)}${String(seq++).padStart(8, "0")}`;

interface Bench { h: Harness; fake: FakeDiscord; files: { secret: string; bot: string }; close(): Promise<void> }

async function setup(opts: { env?: Record<string, string>; linking?: boolean; bot?: boolean } = {}): Promise<Bench> {
  const fake = await startFakeDiscord({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT });
  const sdir = mkdtempSync(join(tmpdir(), "ytc2-discord-secrets-"));
  const secret = join(sdir, "discord_client_secret");
  const bot = join(sdir, "discord_internal_token");
  writeFileSync(secret, CLIENT_SECRET + "\n", { mode: 0o600 });
  writeFileSync(bot, BOT_TOKEN, { mode: 0o600 });
  const env: Record<string, string> = {
    ADMIN_EMAILS: "admin@example.test",
    ...(opts.linking === false ? {} : { DISCORD_CLIENT_ID: CLIENT_ID, DISCORD_CLIENT_SECRET_FILE: secret, DISCORD_OAUTH_BASE: fake.url }),
    ...(opts.bot === false ? {} : { DISCORD_INTERNAL_TOKEN_FILE: bot }),
    ...(opts.env ?? {}),
  };
  const h = await harness(env, { discordTimeoutMs: 400 });
  return { h, fake, files: { secret, bot }, async close() { h.close(); await fake.close(); rmSync(sdir, { recursive: true, force: true }); } };
}

/** Appel de l'API interne du bot (en mémoire ; le réseau est testé à part avec un vrai serveur). */
async function bot(h: Harness, path: string, body: unknown, token: string | null = BOT_TOKEN) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers["x-bot-token"] = token;
  const res = await h.s.discordInternalApp!.request(path, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** Démarre la liaison depuis le site : URL d'autorisation Discord (et son state). */
async function start(b: Browser) {
  const r = await b.json<{ url: string }>("/api/discord/link", { method: "POST" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const url = new URL(r.body.url);
  return { url, state: url.searchParams.get("state")! };
}

/** Passage chez le faux Discord (navigateur) : URL de retour vers account (?code&state ou ?error&state). */
async function authorize(fake: FakeDiscord, url: URL, profile?: FakeProfile, deny = false): Promise<URL> {
  if (profile) fake.next.profile = profile;
  fake.next.deny = deny;
  const res = await fetch(url, { redirect: "manual" });
  assert.equal(res.status, 302);
  return new URL(res.headers.get("location")!);
}

/** Retour sur account avec la session du navigateur : résultat lu dans la redirection vers le site. */
async function callback(b: Browser, back: URL): Promise<string | null> {
  const res = await b.req(back.pathname + back.search);
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get("location")!);
  assert.equal(loc.origin + loc.pathname, `${ORIGIN}/dashboard/discord`);
  return loc.searchParams.get("liaison");
}

async function link(b: Browser, fake: FakeDiscord, profile: FakeProfile): Promise<string | null> {
  const { url } = await start(b);
  return callback(b, await authorize(fake, url, profile));
}

const tokenCalls = (fake: FakeDiscord) => fake.calls.filter((c) => c.path === "/api/oauth2/token").length;
const uidOf = async (b: Browser) => (await b.json("/api/me")).body.user.id as string;

// ---- configuration ---------------------------------------------------------------------------------

test("configuration : fermée sans identifiant ou sans secret ; valeurs invalides refusées ; adresse de retour exacte", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ytc2-discord-cfg-"));
  try {
    const w = (n: string, v: string) => { const p = join(dir, n); writeFileSync(p, v); return p; };
    const base = {
      PUBLIC_URL: "https://raccourci.example.test", BETTER_AUTH_SECRET_FILE: w("a", "a".repeat(40)), INTERNAL_TOKEN_FILE: w("i", INTERNAL),
      DB_PATH: join(dir, "x.sqlite"),
    } as NodeJS.ProcessEnv;
    const secret = w("s", CLIENT_SECRET);
    const c0 = loadConfig(base);
    assert.equal(c0.discord, null);
    assert.equal(c0.discordInternal, null);
    assert.equal(loadConfig({ ...base, DISCORD_CLIENT_ID: CLIENT_ID }).discord, null, "secret absent : fermée sans erreur");
    assert.equal(loadConfig({ ...base, DISCORD_CLIENT_ID: CLIENT_ID, DISCORD_CLIENT_SECRET_FILE: join(dir, "absent") }).discord, null);
    assert.equal(loadConfig({ ...base, DISCORD_CLIENT_ID: CLIENT_ID, DISCORD_CLIENT_SECRET_FILE: w("vide", "\n") }).discord, null);
    assert.equal(loadConfig({ ...base, DISCORD_CLIENT_SECRET_FILE: secret }).discord, null, "identifiant absent : fermée");
    const c = loadConfig({ ...base, DISCORD_CLIENT_ID: CLIENT_ID, DISCORD_CLIENT_SECRET_FILE: secret })!.discord!;
    assert.deepEqual([c.clientId, c.redirectUri, c.oauthBase, c.apiBase, c.cdnBase],
      [CLIENT_ID, "https://raccourci.example.test/api/discord/callback", "https://discord.com", "https://discord.com/api", "https://cdn.discordapp.com"]);
    assert.throws(() => loadConfig({ ...base, DISCORD_CLIENT_ID: "abc", DISCORD_CLIENT_SECRET_FILE: secret }), ConfigError);
    assert.throws(() => loadConfig({ ...base, DISCORD_CLIENT_ID: CLIENT_ID, DISCORD_CLIENT_SECRET_FILE: w("court", "trop-court") }), ConfigError);
    // Le secret ne part jamais en clair vers un hôte public ; http seulement pour un faux serveur local.
    assert.throws(() => loadConfig({ ...base, DISCORD_CLIENT_ID: CLIENT_ID, DISCORD_CLIENT_SECRET_FILE: secret, DISCORD_OAUTH_BASE: "http://discord.example.test" }), ConfigError);
    assert.throws(() => loadConfig({ ...base, DISCORD_CLIENT_ID: CLIENT_ID, DISCORD_CLIENT_SECRET_FILE: secret, DISCORD_API_BASE: "http://api.example.test/api" }), ConfigError);
    assert.throws(() => loadConfig({ ...base, DISCORD_CLIENT_ID: CLIENT_ID, DISCORD_CLIENT_SECRET_FILE: secret, DISCORD_OAUTH_BASE: "https://discord.com/?x=1" }), ConfigError);
    assert.throws(() => loadConfig({ ...base, DISCORD_CLIENT_ID: CLIENT_ID, DISCORD_CLIENT_SECRET_FILE: secret, DISCORD_CDN_BASE: "http://cdn.example.test" }), ConfigError);
    const local = loadConfig({ ...base, DISCORD_CLIENT_ID: CLIENT_ID, DISCORD_CLIENT_SECRET_FILE: secret, DISCORD_OAUTH_BASE: "http://localhost:18187", DISCORD_API_BASE: "http://faux-discord:8087/api", DISCORD_CDN_BASE: "http://faux-discord:8087" }).discord!;
    assert.deepEqual([local.oauthBase, local.apiBase, local.cdnBase], ["http://localhost:18187", "http://faux-discord:8087/api", "http://faux-discord:8087"]);
    // Secret interne du bot : absent → API fermée ; trop court ou identique à celui de ytapi → refus.
    const bi = loadConfig({ ...base, DISCORD_INTERNAL_TOKEN_FILE: w("b", BOT_TOKEN), DISCORD_INTERNAL_ALLOW_FROM: "10.251.40.0/24" }).discordInternal!;
    assert.deepEqual([bi.port, bi.allowFrom !== null], [3002, true]);
    assert.throws(() => loadConfig({ ...base, DISCORD_INTERNAL_TOKEN_FILE: w("b2", "court") }), ConfigError);
    assert.throws(() => loadConfig({ ...base, DISCORD_INTERNAL_TOKEN_FILE: w("b3", INTERNAL) }), /différer du jeton interne de ytapi/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("fonction fermée : statut honnête, démarrage refusé (503), retour « fermee », déliaison possible, pas d'API du bot", async () => {
  const B = await setup({ linking: false, bot: false });
  try {
    const { h } = B;
    assert.equal(h.s.discordInternalApp, null);
    const u = await newUser(h, "ferme@example.test");
    assert.deepEqual((await u.json("/api/discord")).body, { enabled: false, linked: false, discord: null });
    const r = await u.json("/api/discord/link", { method: "POST" });
    assert.deepEqual([r.status, r.body.error], [503, "discord_disabled"]);
    assert.match(r.body.message, /pas encore ouverte/);
    const cb = await u.req(`/api/discord/callback?code=x&state=${"a".repeat(43)}`);
    assert.equal(new URL(cb.headers.get("location")!).searchParams.get("liaison"), "fermee");
    assert.equal((await u.req("/api/discord/unlink", { method: "POST" })).status, 204);
    assert.equal(tokenCalls(B.fake), 0);
  } finally { await B.close(); }
});

// ---- liaison OAuth2 -----------------------------------------------------------------------------------

test("liaison complète (faux Discord) : scope identify, state lié, jeton d'accès jamais conservé ni journalisé", async () => {
  const B = await setup();
  try {
    const { h, fake } = B;
    const u = await newUser(h, "lien@example.test");
    assert.deepEqual((await u.json("/api/discord")).body, { enabled: true, linked: false, discord: null });
    const { url, state } = await start(u);
    assert.equal(url.origin + url.pathname, `${fake.url}/oauth2/authorize`);
    assert.deepEqual(Object.fromEntries([...url.searchParams].filter(([k]) => k !== "state")),
      { client_id: CLIENT_ID, response_type: "code", redirect_uri: REDIRECT, scope: "identify", prompt: "consent" });
    assert.match(state, /^[A-Za-z0-9_-]{43}$/);
    // Seule l'empreinte du state est en base, liée au compte et à la session.
    const row = h.s.db.prepare("SELECT * FROM ytc_discord_state").get() as Record<string, string | null>;
    assert.equal(row.state_hash, sha(state));
    assert.equal(row.user_id, await uidOf(u));
    assert.equal(row.used_at, null);
    assert.ok(Math.abs(Date.parse(row.expires_at!) - Date.now() - 600_000) < 5000, "10 minutes");
    const id = did();
    const back = await authorize(fake, url, { id, username: "malvu.test" });
    assert.equal(back.origin + back.pathname, REDIRECT);
    assert.equal(await callback(u, back), "ok");
    const st = (await u.json("/api/discord")).body;
    assert.equal(st.enabled, true);
    assert.equal(st.linked, true);
    assert.equal(st.discord.name, "malvu.test");
    assert.ok(Date.parse(st.discord.linkedAt) > 0);
    assert.equal(st.discord.lastUsedAt, null);
    assert.ok(!("id" in st.discord), "le statut du site ne renvoie pas l'identifiant Discord");
    // Échange par client confidentiel (HTTP Basic), puis /users/@me.
    assert.deepEqual(fake.calls.filter((c) => c.path === "/api/oauth2/token").map((c) => [c.clientOk, c.grant]), [[true, "authorization_code"]]);
    assert.equal(fake.calls.filter((c) => c.path === "/api/v10/users/@me").length, 1);
    // Ce qui est conservé : identifiant, nom, dates. Jamais le jeton d'accès ni le code (base et journal).
    const cols = (h.s.db.prepare("PRAGMA table_info(ytc_discord_link)").all() as { name: string }[]).map((c) => c.name);
    // 007 : nom affiché et EMPREINTE publique de l'image de profil (jamais de jeton).
    assert.deepEqual(cols, ["discord_user_id", "user_id", "discord_name", "linked_at", "last_used_at", "discord_display", "discord_avatar"]);
    const linkRow = h.s.db.prepare("SELECT discord_user_id, discord_name FROM ytc_discord_link").get() as { discord_user_id: string; discord_name: string };
    assert.deepEqual([linkRow.discord_user_id, linkRow.discord_name], [id, "malvu.test"]);
    h.s.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const files = [h.cfg.dbPath, `${h.cfg.dbPath}-wal`].filter((f) => existsSync(f)).map((f) => readFileSync(f).toString("latin1")).join("");
    assert.equal(fake.issued.length, 2, "un code, un jeton d'accès");
    for (const secret of [...fake.issued, CLIENT_SECRET, state]) assert.ok(!files.includes(secret), "aucun code, jeton, secret ni state en clair dans la base");
    const logs = h.logs.join("\n");
    for (const s of [...fake.issued, CLIENT_SECRET, state, id, "malvu.test"]) assert.ok(!logs.includes(s), `journal sans ${s.slice(0, 6)}…`);
    assert.match(logs, /discord linked/);
  } finally { await B.close(); }
});

test("state : usage unique, expiré, autre compte, autre session, sans session, format invalide → « expiree » sans échange du code", async () => {
  const B = await setup();
  try {
    const { h, fake } = B;
    const a = await newUser(h, "a@example.test");
    const b = await newUser(h, "b@example.test");
    // Rejeu : le même retour présenté deux fois.
    const s1 = await start(a);
    const back1 = await authorize(fake, s1.url, { id: did(), username: "a.discord" });
    assert.equal(await callback(a, back1), "ok");
    const calls = tokenCalls(fake);
    assert.equal(await callback(a, back1), "expiree");
    assert.equal(tokenCalls(fake), calls, "aucun échange de code pour un state rejoué");
    assert.equal((await a.req("/api/discord/unlink", { method: "POST" })).status, 204);
    // Expiré (10 min).
    const s2 = await start(a);
    h.s.db.prepare("UPDATE ytc_discord_state SET expires_at = ? WHERE state_hash = ?").run(new Date(Date.now() - 1000).toISOString(), sha(s2.state));
    assert.equal(await callback(a, await authorize(fake, s2.url, { id: did(), username: "x" })), "expiree");
    // State d'un autre compte : refusé, puis brûlé (le titulaire ne peut plus l'utiliser).
    const s3 = await start(a);
    const back3 = await authorize(fake, s3.url, { id: did(), username: "x" });
    assert.equal(await callback(b, back3), "expiree");
    assert.equal(await callback(a, back3), "expiree");
    // Même compte, AUTRE session (deux connexions Google du même compte).
    const profile = { sub: "g-discord-sessions", email: "deux@example.test", email_verified: true, name: "Deux" };
    const p1 = new Browser(h); await googleLogin(p1, profile);
    const p2 = new Browser(h); await googleLogin(p2, profile);
    assert.equal(await uidOf(p1), await uidOf(p2));
    const s4 = await start(p1);
    assert.equal(await callback(p2, await authorize(fake, s4.url, { id: did(), username: "x" })), "expiree");
    // Sans session (autre navigateur, cookie absent) : refusé et brûlé.
    const s5 = await start(a);
    const back5 = await authorize(fake, s5.url, { id: did(), username: "x" });
    assert.equal(await callback(new Browser(h), back5), "expiree");
    assert.equal(await callback(a, back5), "expiree");
    // State absent ou mal formé.
    for (const q of ["code=abc", `code=abc&state=${"%00".repeat(5)}`, "code=abc&state=court"]) {
      const r = await a.req(`/api/discord/callback?${q}`);
      assert.equal(new URL(r.headers.get("location")!).searchParams.get("liaison"), "expiree");
    }
    assert.equal(tokenCalls(fake), calls, "aucun de ces retours n'a déclenché d'échange");
    assert.equal((await a.json("/api/discord")).body.linked, false);
    assert.equal((h.s.db.prepare("SELECT count(*) n FROM ytc_discord_state WHERE used_at IS NULL").get() as { n: number }).n, 0, "tous les states présentés sont consommés");
  } finally { await B.close(); }
});

test("annulation chez Discord (access_denied) → « annulee » ; state consommé ; aucune liaison", async () => {
  const B = await setup();
  try {
    const { h, fake } = B;
    const u = await newUser(h, "annule@example.test");
    const s = await start(u);
    const back = await authorize(fake, s.url, undefined, true);
    assert.equal(back.searchParams.get("error"), "access_denied");
    assert.equal(await callback(u, back), "annulee");
    assert.equal(await callback(u, back), "expiree");
    assert.equal(tokenCalls(fake), 0);
    assert.equal((await u.json("/api/discord")).body.linked, false);
  } finally { await B.close(); }
});

test("erreurs de Discord (500, réponse illisible, /users/@me en erreur, compte robot, délai) → « echec », rien n'est lié", async () => {
  const B = await setup();
  try {
    const { h, fake } = B;
    const u = await newUser(h, "erreurs@example.test");
    for (const fail of ["token_500", "token_invalid_json", "me_500", "me_bot", "token_slow"] as const) {
      const s = await start(u);
      const back = await authorize(fake, s.url, { id: did(), username: "x" });
      fake.fail = fail;
      assert.equal(await callback(u, back), "echec", fail);
      fake.fail = null;
    }
    // Code absent ou invalide avec un state valide.
    const s = await start(u);
    const back = await authorize(fake, s.url, { id: did(), username: "x" });
    back.searchParams.set("code", "code invalide !");
    assert.equal(await callback(u, back), "echec");
    assert.equal((await u.json("/api/discord")).body.linked, false);
    assert.match(h.logs.join("\n"), /discord link failed.*token_http_500/);
    assert.match(h.logs.join("\n"), /token_timeout/);
  } finally { await B.close(); }
});

test("unicité : un Discord déjà lié à un autre compte est refusé ; une 2e liaison exige la déliaison ; même Discord : nom mis à jour", async () => {
  const B = await setup();
  try {
    const { h, fake } = B;
    const a = await newUser(h, "u1@example.test");
    const b = await newUser(h, "u2@example.test");
    const id = did();
    assert.equal(await link(a, fake, { id, username: "premier" }), "ok");
    assert.equal(await link(b, fake, { id, username: "premier" }), "deja-liee");
    assert.equal((await b.json("/api/discord")).body.linked, false);
    // Compte déjà lié : nouveau démarrage refusé (409) tant qu'il n'est pas délié.
    const again = await a.json("/api/discord/link", { method: "POST" });
    assert.deepEqual([again.status, again.body.error], [409, "already_linked"]);
    // Liaison en cours pendant laquelle le compte a été lié ailleurs (deux onglets) : autre Discord refusé.
    const c = await newUser(h, "u3@example.test");
    const pending = await start(c);
    assert.equal(await link(c, fake, { id: did(), username: "onglet1" }), "ok");
    assert.equal(await callback(c, await authorize(fake, pending.url, { id: did(), username: "onglet2" })), "autre-discord");
    // Même Discord re-présenté (même compte) : nom mis à jour, date de liaison conservée.
    const before = (await c.json("/api/discord")).body.discord;
    const cid = (h.s.db.prepare("SELECT discord_user_id FROM ytc_discord_link WHERE user_id = ?").get(await uidOf(c)) as { discord_user_id: string }).discord_user_id;
    h.s.db.prepare("DELETE FROM ytc_discord_link WHERE user_id = ?").run(await uidOf(c));
    assert.equal(await link(c, fake, { id: cid, username: "renomme", discriminator: "0042" }), "ok");
    const after = (await c.json("/api/discord")).body.discord;
    assert.equal(after.name, "renomme#0042", "ancien format nom#1234 conservé");
    assert.ok(before.linkedAt);
    assert.throws(() => h.s.db.prepare("INSERT INTO ytc_discord_link (discord_user_id, user_id, discord_name, linked_at) VALUES (?, ?, 'x', 'y')").run(id, "autre"), /constraint/i);
  } finally { await B.close(); }
});

test("protections du site : session obligatoire, origine du site et JSON exigés (démarrage, déliaison)", async () => {
  const B = await setup();
  try {
    const { h } = B;
    const anon = new Browser(h);
    assert.equal((await anon.json("/api/discord")).status, 401);
    assert.equal((await anon.json("/api/discord/link", { method: "POST" })).status, 401);
    assert.equal((await anon.json("/api/discord/unlink", { method: "POST" })).status, 401);
    const u = await newUser(h, "csrf@example.test");
    for (const path of ["/api/discord/link", "/api/discord/unlink"]) {
      assert.equal((await u.json(path, { method: "POST", origin: "https://evil.example" })).body.error, "invalid_origin");
      assert.equal((await u.json(path, { method: "POST", origin: null })).body.error, "invalid_origin");
      // Formulaire (type « simple », envoyable par une page tierce) : refusé même avec l'origine du site.
      const form = await h.s.publicApp.request(path, {
        method: "POST", body: "a=1",
        headers: { cookie: u.cookie(), origin: ORIGIN, "content-type": "application/x-www-form-urlencoded", "x-real-ip": u.ip },
      });
      assert.equal(form.status, 415, `${path} : formulaire refusé`);
    }
    assert.equal((h.s.db.prepare("SELECT count(*) n FROM ytc_discord_state").get() as { n: number }).n, 0);
  } finally { await B.close(); }
});

// ---- API interne du bot ----------------------------------------------------------------------------

test("API interne du bot : secret absent, faux ou celui de ytapi → 401 ; le secret du bot n'ouvre pas l'API de ytapi ; corps stricts", async () => {
  const B = await setup();
  try {
    const { h } = B;
    const body = { discord_user_id: did() };
    assert.equal((await bot(h, "/internal/v1/discord/resolve", body, null)).status, 401);
    assert.equal((await bot(h, "/internal/v1/discord/resolve", body, "faux")).status, 401);
    assert.equal((await bot(h, "/internal/v1/discord/resolve", body, INTERNAL)).status, 401, "le jeton de ytapi n'ouvre pas l'API du bot");
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key: "ytc_x", action: "access" }, BOT_TOKEN)).status, 401, "le secret du bot n'ouvre pas l'API de ytapi");
    assert.equal((await bot(h, "/internal/v1/discord/resolve", body)).status, 200);
    for (const bad of [{}, { discord_user_id: "123" }, { discord_user_id: 123456789012345678 }, { ...body, extra: 1 }, null, []]) {
      assert.equal((await bot(h, "/internal/v1/discord/resolve", bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await bot(h, "/internal/v1/discord/download", { ...body, job_id: "../../x" })).status, 400);
    assert.equal((await bot(h, "/internal/v1/discord/inconnue", body)).status, 404);
    const health = await h.s.discordInternalApp!.request("/internal/v1/discord/health", { headers: { "x-bot-token": BOT_TOKEN } });
    assert.deepEqual(await health.json(), { status: "ok", linking: true });
  } finally { await B.close(); }
});

test("API interne du bot : restreinte au réseau (DISCORD_INTERNAL_ALLOW_FROM), vrai serveur HTTP local", async () => {
  for (const [cidr, expected] of [["127.0.0.0/8", 200], ["10.251.40.0/24", 403]] as const) {
    const B = await setup({ env: { DISCORD_INTERNAL_ALLOW_FROM: cidr } });
    const srv = serve({ fetch: B.h.s.discordInternalApp!.fetch, port: 0, hostname: "127.0.0.1" });
    try {
      await new Promise((r) => srv.once("listening", r));
      const port = (srv.address() as AddressInfo).port;
      const res = await fetch(`http://127.0.0.1:${port}/internal/v1/discord/resolve`, {
        method: "POST", headers: { "content-type": "application/json", "x-bot-token": BOT_TOKEN }, body: JSON.stringify({ discord_user_id: did() }),
      });
      assert.equal(res.status, expected, `${cidr}`);
      if (expected === 403) assert.equal(((await res.json()) as { error: string }).error, "forbidden");
      else assert.deepEqual(await res.json(), { linked: false });
    } finally {
      await new Promise((r) => srv.close(r));
      await B.close();
    }
  }
});

test("resolve : non lié, lié (quota au format de /api/me, concurrence max, e-mail masqué), suspendu signalé", async () => {
  const B = await setup();
  try {
    const { h, fake } = B;
    const admin = await newUser(h, "admin@example.test");
    const u = await newUser(h, "alice@example.test");
    const id = did();
    assert.deepEqual((await bot(h, "/internal/v1/discord/resolve", { discord_user_id: id })).body, { linked: false });
    assert.equal(await link(u, fake, { id, username: "lie" }), "ok");
    const r = (await bot(h, "/internal/v1/discord/resolve", { discord_user_id: id })).body;
    const me = (await u.json("/api/me")).body;
    assert.equal(r.linked, true);
    assert.equal(r.status, "active");
    assert.deepEqual(r.today, me.today, "même format et mêmes valeurs que /api/me");
    assert.equal(r.maxActive, me.maxActive);
    assert.equal(r.user.email, "i•••@example.test");
    assert.equal(r.discord.name, "lie");
    assert.ok(!JSON.stringify(r).includes("alice@"), "e-mail jamais en clair");
    assert.ok((await u.json("/api/discord")).body.discord.lastUsedAt, "dernière utilisation enregistrée");
    await admin.json(`/api/admin/users/${me.user.id}/status`, { method: "POST", body: { status: "suspended" } });
    assert.deepEqual((await bot(h, "/internal/v1/discord/resolve", { discord_user_id: id })).body, { linked: true, status: "suspended" });
  } finally { await B.close(); }
});

test("clé de conversion : type discord, 15 min, plafond, release ; jamais pour un compte non lié, suspendu, ni en pause", async () => {
  const B = await setup();
  try {
    const { h, fake } = B;
    const admin = await newUser(h, "admin@example.test");
    const u = await newUser(h, "cle@example.test");
    const id = did();
    const nl = await bot(h, "/internal/v1/discord/session", { discord_user_id: id });
    assert.deepEqual([nl.status, nl.body.error], [404, "not_linked"]);
    assert.equal(await link(u, fake, { id, username: "cle" }), "ok");
    const s = await bot(h, "/internal/v1/discord/session", { discord_user_id: id });
    assert.equal(s.status, 201);
    assert.match(s.body.key, /^ytc_[A-Za-z0-9]{64}$/);
    assert.ok(Math.abs(Date.parse(s.body.expiresAt) - Date.now() - DISCORD_KEY_TTL_S * 1000) < 10_000, "15 minutes");
    const meta = h.s.db.prepare("SELECT kind, revoked_at FROM ytc_key_meta WHERE key_id = ?").get(s.body.keyId) as { kind: string; revoked_at: string | null };
    assert.deepEqual([meta.kind, meta.revoked_at], ["discord", null]);
    // La clé est une clé ytc_ ordinaire pour ytapi (autorisation « access » acceptée).
    const ok = await internalCall(h, "/internal/v1/authorize", { key: s.body.key, action: "access" });
    assert.deepEqual([ok.body.allow, ok.body.key_id, ok.body.key_kind], [true, s.body.keyId, "discord"]);
    // Plafond : MAX_DISCORD_KEYS actives.
    const more = [];
    for (let i = 1; i < MAX_DISCORD_KEYS; i++) more.push((await bot(h, "/internal/v1/discord/session", { discord_user_id: id })).body);
    const over = await bot(h, "/internal/v1/discord/session", { discord_user_id: id });
    assert.deepEqual([over.status, over.body.error], [429, "too_many_sessions"]);
    // Release : révoquée (motif « released »), idempotent, la place se libère.
    assert.equal((await bot(h, "/internal/v1/discord/release", { discord_user_id: id, key_id: s.body.keyId })).status, 204);
    assert.equal((await bot(h, "/internal/v1/discord/release", { discord_user_id: id, key_id: s.body.keyId })).status, 204);
    const rel = h.s.db.prepare("SELECT revoked_reason FROM ytc_key_meta WHERE key_id = ?").get(s.body.keyId) as { revoked_reason: string };
    assert.equal(rel.revoked_reason, "released");
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key: s.body.key, action: "access" })).body.reason, "invalid_key");
    assert.equal((await bot(h, "/internal/v1/discord/session", { discord_user_id: id })).status, 201);
    // Clé d'un autre compte : introuvable pour ce Discord.
    const other = await newUser(h, "autre@example.test");
    const oid = did();
    assert.equal(await link(other, fake, { id: oid, username: "autre" }), "ok");
    assert.equal((await bot(h, "/internal/v1/discord/release", { discord_user_id: oid, key_id: more[0].keyId })).status, 404);
    // Pause des conversions : aucune clé.
    await admin.json("/api/admin/settings", { method: "POST", body: { conversionsPaused: true } });
    const paused = await bot(h, "/internal/v1/discord/session", { discord_user_id: oid });
    assert.deepEqual([paused.status, paused.body.error], [503, "service_paused"]);
    await admin.json("/api/admin/settings", { method: "POST", body: { conversionsPaused: false } });
    // Suspension : aucune clé, et les clés déjà émises sont refusées par l'autorisation de ytapi.
    const key2 = (await bot(h, "/internal/v1/discord/session", { discord_user_id: oid })).body.key;
    await admin.json(`/api/admin/users/${await uidOf(other)}/status`, { method: "POST", body: { status: "suspended" } });
    const susp = await bot(h, "/internal/v1/discord/session", { discord_user_id: oid });
    assert.deepEqual([susp.status, susp.body.error], [403, "account_suspended"]);
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key: key2, action: "create_job", fmt: "mp3" })).body.reason, "user_suspended");
    // Clé expirée : refusée par l'autorisation (Better Auth), comme toute clé ytc_.
    assert.equal((await bot(h, "/internal/v1/discord/release", { discord_user_id: id, key_id: more[1].keyId })).status, 204);
    const k3 = (await bot(h, "/internal/v1/discord/session", { discord_user_id: id })).body;
    assert.ok(k3.keyId, JSON.stringify(k3));
    const cur = h.s.db.prepare("SELECT expiresAt FROM apikey WHERE id = ?").get(k3.keyId) as { expiresAt: string | number };
    const past = typeof cur.expiresAt === "number" ? Date.now() - 1000 : new Date(Date.now() - 1000).toISOString();
    h.s.db.prepare("UPDATE apikey SET expiresAt = ? WHERE id = ?").run(past, k3.keyId);
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key: k3.key, action: "access" })).body.reason, "expired");
    // Journaux : aucune clé, aucun identifiant Discord.
    const logs = h.logs.join("\n");
    for (const v of [s.body.key, key2, k3.key, id, oid]) assert.ok(!logs.includes(v));
  } finally { await B.close(); }
});

test("quota partagé : même compteur et même historique pour le raccourci et Discord", async () => {
  const B = await setup();
  try {
    const { h, fake } = B;
    const u = await newUser(h, "quota@example.test");
    const short = (await u.json("/api/keys", { method: "POST", body: { name: "iPhone" } })).body.secret as string;
    const id = did();
    assert.equal(await link(u, fake, { id, username: "quota" }), "ok");
    const d = (await bot(h, "/internal/v1/discord/session", { discord_user_id: id })).body;
    for (let i = 0; i < 9; i++) assert.equal((await internalCall(h, "/internal/v1/authorize", { key: short, action: "create_job", fmt: "mp3", platform: "youtube" })).body.allow, true);
    const last = await internalCall(h, "/internal/v1/authorize", { key: d.key, action: "create_job", fmt: "mp4", platform: "tiktok" });
    assert.deepEqual([last.body.allow, last.body.remaining_today], [true, 0]);
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key: d.key, action: "create_job", fmt: "mp4" })).body.reason, "quota_exceeded");
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key: short, action: "create_job", fmt: "mp4" })).body.reason, "quota_exceeded");
    const me = (await u.json("/api/me")).body;
    assert.deepEqual([me.today.used, me.today.remaining], [10, 0]);
    assert.equal((await u.json("/api/activity")).body.items.length, 10, "même historique");
    const viaDiscord = h.s.db.prepare("SELECT count(*) n FROM ytc_usage WHERE key_id = ?").get(d.keyId) as { n: number };
    assert.equal(viaDiscord.n, 1);
    const r = (await bot(h, "/internal/v1/discord/resolve", { discord_user_id: id })).body;
    assert.deepEqual([r.today.used, r.today.remaining], [10, 0]);
  } finally { await B.close(); }
});

test("déliaison : liaison supprimée, clés discord révoquées (motif unlink), liens et states effacés ; idempotente", async () => {
  const B = await setup();
  try {
    const { h, fake } = B;
    const u = await newUser(h, "delie@example.test");
    const id = did();
    assert.equal(await link(u, fake, { id, username: "delie" }), "ok");
    const k = (await bot(h, "/internal/v1/discord/session", { discord_user_id: id })).body;
    assert.equal((await bot(h, "/internal/v1/discord/download", { discord_user_id: id, job_id: "job-delie" })).status, 201);
    assert.equal((await u.req("/api/discord/unlink", { method: "POST" })).status, 204);
    assert.deepEqual((await u.json("/api/discord")).body, { enabled: true, linked: false, discord: null });
    const meta = h.s.db.prepare("SELECT revoked_reason FROM ytc_key_meta WHERE key_id = ?").get(k.keyId) as { revoked_reason: string };
    assert.equal(meta.revoked_reason, "unlink");
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key: k.key, action: "access" })).body.reason, "invalid_key");
    for (const t of ["ytc_discord_link", "ytc_discord_download", "ytc_discord_state"]) {
      assert.equal((h.s.db.prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n, 0, t);
    }
    assert.deepEqual((await bot(h, "/internal/v1/discord/resolve", { discord_user_id: id })).body, { linked: false });
    assert.equal((await u.req("/api/discord/unlink", { method: "POST" })).status, 204);
    // Le même Discord peut ensuite être lié à un autre compte.
    const v = await newUser(h, "relie@example.test");
    assert.equal(await link(v, fake, { id, username: "delie" }), "ok");
  } finally { await B.close(); }
});

test("Mes jetons sans clés discord ; export : liaison et clés ; rotation d'une clé discord refusée", async () => {
  const B = await setup();
  try {
    const { h, fake } = B;
    const u = await newUser(h, "export@example.test");
    await u.json("/api/keys", { method: "POST", body: { name: "iPhone" } });
    const id = did();
    assert.equal(await link(u, fake, { id, username: "export" }), "ok");
    const k = (await bot(h, "/internal/v1/discord/session", { discord_user_id: id })).body;
    const list = (await u.json("/api/keys")).body.keys as { kind: string }[];
    assert.deepEqual(list.map((x) => x.kind), ["shortcut"]);
    assert.equal((await u.json("/api/me")).body.keys.active, 1, "le plafond du raccourci ne compte pas les clés discord");
    const ex = (await u.json("/api/account/export")).body;
    assert.equal(ex.discord.discordUserId, id);
    assert.equal(ex.discord.name, "export");
    assert.ok(ex.discord.linkedAt);
    assert.deepEqual((ex.keys as { kind: string }[]).map((x) => x.kind).sort(), ["discord", "shortcut"]);
    assert.ok(!JSON.stringify(ex).includes(k.key), "jamais le secret d'une clé");
    const rot = await u.json(`/api/keys/${k.keyId}/rotate`, { method: "POST" });
    assert.deepEqual([rot.status, rot.body.error], [409, "discord_key"]);
  } finally { await B.close(); }
});

test("suppression du compte : liaison, states, liens et clés discord suivent (cascade)", async () => {
  const B = await setup();
  try {
    const { h, fake } = B;
    const u = await newUser(h, "supprime@example.test");
    const id = did();
    assert.equal(await link(u, fake, { id, username: "supprime" }), "ok");
    await start(u).catch(() => undefined); // déjà lié : 409, aucun state
    const k = (await bot(h, "/internal/v1/discord/session", { discord_user_id: id })).body;
    await bot(h, "/internal/v1/discord/download", { discord_user_id: id, job_id: "job-x" });
    const uid = await uidOf(u);
    h.s.db.prepare("INSERT INTO ytc_discord_state (state_hash, user_id, session_hash, created_at, expires_at) VALUES ('s', ?, 'x', 'a', 'b')").run(uid);
    assert.equal((await u.json("/api/auth/delete-user", { method: "POST", body: {} })).status, 200);
    for (const t of ["ytc_discord_link", "ytc_discord_state", "ytc_discord_download", "ytc_key_meta"]) {
      assert.equal((h.s.db.prepare(`SELECT count(*) n FROM ${t} WHERE user_id = ?`).get(uid) as { n: number }).n, 0, t);
    }
    assert.equal((h.s.db.prepare("SELECT count(*) n FROM apikey WHERE referenceId = ?").get(uid) as { n: number }).n, 0);
    assert.equal((await internalCall(h, "/internal/v1/authorize", { key: k.key, action: "access" })).body.allow, false);
    assert.deepEqual((await bot(h, "/internal/v1/discord/resolve", { discord_user_id: id })).body, { linked: false });
  } finally { await B.close(); }
});

// ---- livraison du fichier -------------------------------------------------------------------------

test("lien de téléchargement : usage unique, 10 min, sans clé ; fichier relayé depuis ytapi avec une clé éphémère", async () => {
  const B = await setup();
  try {
    const { h, fake } = B;
    const u = await newUser(h, "fichier@example.test");
    const id = did();
    assert.equal(await link(u, fake, { id, username: "fichier" }), "ok");
    const uid = await uidOf(u);
    h.ytapi.files.set("job-ok", { userId: uid, body: "contenu-du-mp4", type: "video/mp4", name: "Titre [abc].mp4" });
    const get = async (url: string) => {
      const p = new URL(url);
      return h.s.publicApp.request(p.pathname + p.search, { headers: { "x-real-ip": "198.51.100.7" } });
    };
    const errOf = (res: Response) => {
      assert.equal(res.status, 302);
      const l = new URL(res.headers.get("location")!);
      assert.equal(l.origin + l.pathname, `${ORIGIN}/discord/telechargement`);
      return l.searchParams.get("erreur");
    };
    const mk = async (job: string) => {
      const r = await bot(h, "/internal/v1/discord/download", { discord_user_id: id, job_id: job });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return r.body as { url: string; expiresAt: string };
    };
    const d = await mk("job-ok");
    assert.match(d.url, new RegExp(`^${ORIGIN}/api/discord/telechargement\\?jeton=[A-Za-z0-9_-]{43}$`));
    assert.ok(!d.url.includes("ytc_"), "aucune clé dans le lien");
    assert.ok(Math.abs(Date.parse(d.expiresAt) - Date.now() - 600_000) < 5000, "10 minutes");
    const res = await get(d.url);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "contenu-du-mp4");
    assert.equal(res.headers.get("content-type"), "video/mp4");
    assert.equal(res.headers.get("content-disposition"), 'attachment; filename="Titre [abc].mp4"');
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    // La clé éphémère de ytapi a été révoquée aussitôt (motif « released »), et n'est jamais sortie d'account.
    const eph = h.s.db.prepare("SELECT revoked_reason FROM ytc_key_meta WHERE kind = 'discord' AND user_id = ?").all(uid) as { revoked_reason: string | null }[];
    assert.deepEqual(eph.map((r) => r.revoked_reason), ["released"]);
    assert.ok(h.ytapi.calls.some((c) => c.path === "/jobs/job-ok/file" && c.bearer), "ytapi appelé avec une clé ytc_ en Bearer");
    // Usage unique.
    assert.equal(errOf(await get(d.url)), "utilise");
    // Expiré.
    const d2 = await mk("job-ok");
    h.s.db.prepare("UPDATE ytc_discord_download SET expires_at = ? WHERE token_hash = ?").run(new Date(Date.now() - 1000).toISOString(), sha(new URL(d2.url).searchParams.get("jeton")!));
    assert.equal(errOf(await get(d2.url)), "expire");
    // Inconnu ou mal formé.
    assert.equal(errOf(await get(`${ORIGIN}/api/discord/telechargement?jeton=${"A".repeat(43)}`)), "invalide");
    assert.equal(errOf(await get(`${ORIGIN}/api/discord/telechargement?jeton=court`)), "invalide");
    assert.equal(errOf(await get(`${ORIGIN}/api/discord/telechargement`)), "invalide");
    // ytapi injoignable : erreur passagère, le lien reste utilisable ensuite.
    const d3 = await mk("job-ok");
    h.ytapi.networkError = true;
    assert.equal(errOf(await get(d3.url)), "indisponible");
    h.ytapi.networkError = false;
    assert.equal((await get(d3.url)).status, 200);
    // Fichier expiré chez ytapi (410) : lien consommé.
    const d4 = await mk("job-ok");
    h.ytapi.fileStatus = 410;
    assert.equal(errOf(await get(d4.url)), "fichier-expire");
    h.ytapi.fileStatus = null;
    assert.equal(errOf(await get(d4.url)), "utilise");
    // Job d'un autre compte : ytapi répond 404 avec la clé de CE compte.
    h.ytapi.files.set("job-autre", { userId: "quelqu-un-d-autre", body: "x", type: "audio/mpeg", name: "x.mp3" });
    assert.equal(errOf(await get((await mk("job-autre")).url)), "fichier-expire");
    // Liens en attente plafonnés.
    for (let i = 0; i < MAX_PENDING_DOWNLOADS; i++) await mk(`job-p${i}`);
    const over = await bot(h, "/internal/v1/discord/download", { discord_user_id: id, job_id: "job-trop" });
    assert.deepEqual([over.status, over.body.error], [429, "too_many_downloads"]);
    // Après la déliaison, les liens en attente ne valent plus rien.
    const pend = (h.s.db.prepare("SELECT count(*) n FROM ytc_discord_download WHERE used_at IS NULL").get() as { n: number }).n;
    assert.ok(pend >= MAX_PENDING_DOWNLOADS);
    await u.req("/api/discord/unlink", { method: "POST" });
    assert.equal((h.s.db.prepare("SELECT count(*) n FROM ytc_discord_download").get() as { n: number }).n, 0);
    // Journaux : ni jeton de lien, ni clé, ni nom de fichier.
    const logs = h.logs.join("\n");
    for (const v of [new URL(d.url).searchParams.get("jeton")!, "Titre [abc]", id]) assert.ok(!logs.includes(v), v);
  } finally { await B.close(); }
});

test("purge : states et liens expirés depuis plus d'un jour effacés, les autres gardés", async () => {
  const B = await setup();
  try {
    const { h } = B;
    const u = await newUser(h, "purge-discord@example.test");
    const uid = await uidOf(u);
    const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
    const ins = (t: string, col: string, k: string, exp: string) =>
      h.s.db.prepare(`INSERT INTO ${t} (${col}, user_id, ${t === "ytc_discord_state" ? "session_hash" : "job_id"}, created_at, expires_at) VALUES (?, ?, 'x', ?, ?)`).run(k, uid, iso(-1), exp);
    ins("ytc_discord_state", "state_hash", "vieux", iso(-25 * 3_600_000));
    ins("ytc_discord_state", "state_hash", "recent", iso(-3_600_000));
    ins("ytc_discord_download", "token_hash", "vieux", iso(-25 * 3_600_000));
    ins("ytc_discord_download", "token_hash", "actif", iso(600_000));
    await h.s.usage.purge();
    assert.deepEqual((h.s.db.prepare("SELECT state_hash k FROM ytc_discord_state").all() as { k: string }[]).map((r) => r.k), ["recent"]);
    assert.deepEqual((h.s.db.prepare("SELECT token_hash k FROM ytc_discord_download").all() as { k: string }[]).map((r) => r.k), ["actif"]);
  } finally { await B.close(); }
});

test("profil Discord (migration 007) : nom affiché et image à la liaison, tenus à jour par le bot ; /api/discord : profil et activité ; image relayée par le site", async () => {
  const B = await setup();
  try {
    const b = await newUser(B.h, "profil@example.test");
    const id = did();
    const avatar = "a".repeat(32);
    assert.equal(await link(b, B.fake, { id, username: "lea.atelier", global_name: "Léa", avatar }), "ok");
    let st = (await b.json("/api/discord")).body;
    assert.equal(st.discord.name, "lea.atelier");
    assert.equal(st.discord.displayName, "Léa");
    assert.equal(st.discord.avatarVersion, "aaaaaaaa", "version de l'image (fin de l'empreinte publique), jamais une URL externe");
    assert.deepEqual(st.activity, { conversions30d: 0, saved: 0, prefs: { fmt: "mp4", quality: "auto", visibility: "private" } });
    // Le bot voit le compte avec un nouveau nom affiché et une nouvelle image : account les reprend.
    const newer = "a_" + "b".repeat(32);
    const r = await bot(B.h, "/internal/v1/discord/resolve", { discord_user_id: id, profile: { name: "lea.atelier", display: "Léa ✦", avatar: newer } });
    assert.equal(r.status, 200);
    st = (await b.json("/api/discord")).body;
    assert.equal(st.discord.displayName, "Léa ✦");
    assert.equal(st.discord.avatarVersion, "bbbbbbbb");
    // Profil invalide : ignoré (empreinte au mauvais format), le reste de la réponse inchangé ; corps inconnu refusé.
    assert.equal((await bot(B.h, "/internal/v1/discord/resolve", { discord_user_id: id, profile: { name: "lea.atelier", display: null, avatar: "../../x" } })).status, 200);
    assert.equal((await b.json("/api/discord")).body.discord.avatarVersion, null, "image invalide → image par défaut");
    assert.equal((await bot(B.h, "/internal/v1/discord/resolve", { discord_user_id: id, autre: 1 })).status, 400);
    assert.equal((await bot(B.h, "/internal/v1/discord/resolve", { discord_user_id: id })).status, 200, "sans profil : comme avant");
    // Image relayée : session obligatoire ; le CDN de Discord est appelé par le serveur, jamais par le navigateur.
    assert.equal((await new Browser(B.h).req("/api/discord/avatar")).status, 401);
    await bot(B.h, "/internal/v1/discord/resolve", { discord_user_id: id, profile: { name: "lea.atelier", display: "Léa", avatar } });
    const asked: string[] = [];
    (B.h.s.discord as unknown as { cdnFetch: () => typeof fetch }).cdnFetch = () => (async (u: string | URL | Request) => {
      asked.push(String(u));
      return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "content-type": "image/png" } });
    }) as typeof fetch;
    const img = await b.req("/api/discord/avatar?v=aaaaaaaa");
    assert.equal(img.status, 200);
    assert.equal(img.headers.get("content-type"), "image/png");
    assert.match(img.headers.get("cache-control") ?? "", /^private/);
    assert.deepEqual(asked, [`https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=128`]);
    await b.req("/api/discord/avatar?v=aaaaaaaa");
    assert.equal(asked.length, 1, "gardée en mémoire une heure");
    // Export RGPD : le profil Discord y figure.
    const ex = (await b.json("/api/account/export")).body;
    assert.equal(ex.discord.displayName, "Léa");
    assert.equal(ex.discord.avatarHash, avatar);
    // Déliaison : plus de profil, plus d'image.
    await b.json("/api/discord/unlink", { method: "POST" });
    assert.equal((await b.req("/api/discord/avatar")).status, 404);
  } finally { await B.close(); }
});

// ---- V3.5 : « Continuer avec Discord » (compte DÉJÀ lié seulement) -----------------------------------------------

/** Démarre une connexion par Discord depuis un navigateur sans session : URL de Discord, jeton du navigateur posé. */
async function startLogin(b: Browser, retour?: string) {
  const r = await b.json<{ url: string }>("/api/discord/login", { method: "POST", body: retour === undefined ? {} : { retour } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(b.jar.get("aethryon_dl"), "jeton du navigateur posé (cookie HttpOnly)");
  return new URL(r.body.url);
}

/** Suit le retour de Discord puis, s'il y en a une, la création de la session : redirection finale. */
async function finishLogin(b: Browser, back: URL): Promise<{ first: URL; final: URL }> {
  const r1 = await b.req(back.pathname + back.search);
  assert.equal(r1.status, 302);
  const first = new URL(r1.headers.get("location")!);
  if (first.pathname !== "/api/auth/discord-session") return { first, final: first };
  const r2 = await b.req(first.pathname + first.search);
  assert.equal(r2.status, 302);
  return { first, final: new URL(r2.headers.get("location")!) };
}

test("connexion Discord fermée sans DISCORD_LOGIN : 503, /api/config le dit, route de session absente", async () => {
  const B = await setup();
  try {
    const { h } = B;
    const anon = new Browser(h);
    assert.equal((await anon.json("/api/config")).body.discordLogin, false);
    const r = await anon.json("/api/discord/login", { method: "POST" });
    assert.deepEqual([r.status, r.body.error], [503, "discord_login_disabled"]);
    assert.equal((await anon.req("/api/auth/discord-session?ticket=x")).status, 404);
  } finally { await B.close(); }
});

test("« Continuer avec Discord » : compte lié → session sur CE compte (droits inchangés), page de retour du site seulement", async () => {
  const B = await setup({ env: { DISCORD_LOGIN: "1" } });
  try {
    const { h, fake } = B;
    const owner = await newUser(h, "discord.login@example.test");
    const id = did();
    assert.equal(await link(owner, fake, { id, username: "pilote" }), "ok");
    const uid = await uidOf(owner);
    const anon = new Browser(h);
    assert.equal((await anon.json("/api/config")).body.discordLogin, true);
    // Scope identify seulement (aucune adresse e-mail demandée), même adresse de retour que la liaison.
    const url = await startLogin(anon, "/dashboard/compte");
    assert.equal(url.searchParams.get("scope"), "identify");
    assert.equal(url.searchParams.get("redirect_uri"), REDIRECT);
    const { first, final } = await finishLogin(anon, await authorize(fake, url, { id, username: "pilote" }));
    assert.equal(first.pathname, "/api/auth/discord-session");
    assert.equal(final.href, `${ORIGIN}/dashboard/compte`);
    const me = await anon.json("/api/me");
    assert.equal(me.status, 200);
    assert.equal(me.body.user.id, uid, "le compte AETHRYON lié, rien d'autre");
    assert.equal(anon.jar.has("aethryon_dl"), false, "jeton du navigateur effacé");
    // Le ticket ne sert qu'une fois.
    const replay = await anon.req(first.pathname + first.search);
    assert.equal(new URL(replay.headers.get("location")!).href, `${ORIGIN}/connexion?discord=expiree`);
    // Page de retour hors du site : ignorée (l'espace).
    const anon2 = new Browser(h);
    const url2 = await startLogin(anon2, "//evil.example/piege");
    const r2 = await finishLogin(anon2, await authorize(fake, url2, { id, username: "pilote" }));
    assert.equal(r2.final.href, `${ORIGIN}/dashboard`);
  } finally { await B.close(); }
});

test("« Continuer avec Discord » refusé : Discord non lié, autre navigateur, annulation, compte suspendu — jamais de session ni de compte créé", async () => {
  const B = await setup({ env: { DISCORD_LOGIN: "1" } });
  try {
    const { h, fake } = B;
    const users = () => (h.s.dbs.auth.prepare('SELECT COUNT(*) AS n FROM "user"').get() as { n: number }).n;
    const before = users();
    // 1. Discord inconnu d'AETHRYON : aucune création de compte.
    const a = new Browser(h);
    const u1 = await startLogin(a);
    const r1 = await finishLogin(a, await authorize(fake, u1, { id: did(), username: "inconnu" }));
    assert.equal(r1.final.href, `${ORIGIN}/connexion?discord=non-liee`);
    assert.equal((await a.json("/api/me")).status, 401);
    assert.equal(users(), before, "aucun compte créé");
    // 2. Retour reçu par un AUTRE navigateur (sans le jeton) : refusé avant l'échange du code.
    const owner = await newUser(h, "lie.ailleurs@example.test");
    const id = did();
    assert.equal(await link(owner, fake, { id, username: "lie" }), "ok");
    const b = new Browser(h);
    const u2 = await startLogin(b);
    const back = await authorize(fake, u2, { id, username: "lie" });
    const tokensBefore = tokenCalls(fake);
    const thief = new Browser(h);
    const r2 = await finishLogin(thief, back);
    assert.equal(r2.final.href, `${ORIGIN}/connexion?discord=expiree`);
    assert.equal(tokenCalls(fake), tokensBefore, "code jamais échangé");
    assert.equal((await thief.json("/api/me")).status, 401);
    // Le state est consommé : le bon navigateur ne peut pas le rejouer non plus.
    assert.equal((await finishLogin(b, back)).final.href.startsWith(`${ORIGIN}/dashboard/discord`), true, "state inconnu : traité comme une liaison, refusée sans session");
    // 3. Annulation chez Discord.
    const c = new Browser(h);
    const u3 = await startLogin(c);
    assert.equal((await finishLogin(c, await authorize(fake, u3, { id, username: "lie" }, true))).final.href, `${ORIGIN}/connexion?discord=annulee`);
    // 4. Compte suspendu : refusé à la création de la session.
    const admin = await newUser(h, "admin@example.test");
    await admin.json(`/api/admin/users/${await uidOf(owner)}/status`, { method: "POST", body: { status: "suspended" } });
    const d = new Browser(h);
    const u4 = await startLogin(d);
    assert.equal((await finishLogin(d, await authorize(fake, u4, { id, username: "lie" }))).final.href, `${ORIGIN}/connexion?discord=suspendu`);
    assert.equal((await d.json("/api/me")).status, 401);
  } finally { await B.close(); }
});

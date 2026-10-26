// Liaison et conversion du bot (docs/DISCORD-BOT.md §17), sans Discord ni réseau : faux fetch (account, ytapi),
// fausse horloge, faux message. Vérifie les drapeaux, le client de l'API interne, le client de ytapi, le
// déroulé de /convert (un seul message, paliers, fenêtre de 15 min, clé rendue), /account et les textes d'erreur.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ConfigError, featuresOf, loadConfig, readInternalToken } from "../src/config.ts";
import { AccountClient, AccountError } from "../src/account.ts";
import { YtapiClient, YtapiError, type Job } from "../src/ytapi.ts";
import { ERROR_FALLBACK_TEXT, ERROR_TEXT, SERVICE_TEXT, BOT_TEXT } from "../src/errors.ts";
import { MAX_POLL_FAILURES, runConversion, type ConvertDeps } from "../src/convert.ts";
import { createFlights } from "../src/live.ts";
import { failureText, type Reply } from "../src/replies.ts";
import { addSecret, redact } from "../src/log.ts";

const IDS = { DISCORD_CLIENT_ID: "1558821698734923796", DISCORD_GUILD_ID: "1309973220362944633" };
const SITE = "https://raccourci.malvu.fr";
const DUSER = "123456789012345678";
const SECRET = "secret-interne-du-bot-" + "x".repeat(32);
const KEY = "ytc_" + "K".repeat(64);
const VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ-titre-secret";

// ---- configuration ---------------------------------------------------------------------------------

test("drapeaux : liaison et conversion fermées par défaut ; conversion sans liaison refusée ; valeurs strictes", () => {
  const c = loadConfig(IDS);
  assert.deepEqual([c.linkEnabled, c.convertEnabled], [false, false]);
  assert.equal(c.accountUrl, "http://account-discord:3002");
  assert.equal(c.ytapiUrl, "https://api.malvu.fr/media");
  const closed = { link: false, convert: false, files: false, library: false, guildConfig: false, autoEmbeds: false, preview: false, compress: false, clip: false, gif: false, tools: false };
  assert.deepEqual(featuresOf({}), closed, "toutes les fonctions fermées par défaut");
  assert.deepEqual(featuresOf({ LINK_ENABLED: "1" }), { ...closed, link: true });
  assert.deepEqual(featuresOf({ LINK_ENABLED: "1", CONVERT_ENABLED: "1" }), { ...closed, link: true, convert: true });
  assert.throws(() => loadConfig({ ...IDS, CONVERT_ENABLED: "1" }), /exige LINK_ENABLED=1/);
  // Version 2 : dépendances entre fonctions (rien n'apparaît qui ne marcherait pas).
  assert.throws(() => featuresOf({ LINK_ENABLED: "1", FILES_ENABLED: "1" }), /FILES_ENABLED=1 exige CONVERT_ENABLED=1/);
  assert.throws(() => featuresOf({ LINK_ENABLED: "1", CONVERT_ENABLED: "1", AUTO_EMBEDS_ENABLED: "1" }), /exige GUILD_CONFIG_ENABLED=1/);
  assert.throws(() => featuresOf({ LINK_ENABLED: "1", CONVERT_ENABLED: "1", COMPRESS_ENABLED: "1" }), /exige FILES_ENABLED=1/);
  assert.equal(loadConfig({ ...IDS, AETHRYON_EMOJI: "<:aethryon:1234567890123456789>" }).emoji, "<:aethryon:1234567890123456789>");
  assert.throws(() => loadConfig({ ...IDS, AETHRYON_EMOJI: "🦉 <script>" }), /AETHRYON_EMOJI/);
  assert.throws(() => loadConfig({ ...IDS, LINK_ENABLED: "oui" }), ConfigError);
  assert.throws(() => loadConfig({ ...IDS, ACCOUNT_INTERNAL_URL: "https://account.example.test" }), /http:\/\/ du réseau interne/);
  assert.equal(loadConfig({ ...IDS, ACCOUNT_INTERNAL_URL: "http://ytc-account:3002/" }).accountUrl, "http://ytc-account:3002");
});

test("secret interne : lu dans son fichier, jamais cité dans les erreurs, masqué dans les journaux", () => {
  assert.equal(readInternalToken({ DISCORD_INTERNAL_TOKEN_FILE: "/x" }, () => `${SECRET}\n`), SECRET);
  assert.throws(() => readInternalToken({}, () => { throw new Error("ENOENT"); }), /discord-liaison-secrets\.sh/);
  try { readInternalToken({}, () => "court"); assert.fail(); } catch (e) { assert.ok(e instanceof ConfigError); assert.doesNotMatch(e.message, /court/); }
  addSecret(SECRET);
  assert.equal(redact(`appel ${SECRET} fini`), "appel [secret] fini");
  assert.equal(redact(`clé ${KEY} et lien https://x/api/discord/telechargement?jeton=${"a".repeat(43)}`), "clé [secret] et lien https://x/api/discord/telechargement?jeton=[secret]");
});

// ---- textes ----------------------------------------------------------------------------------------

test("ERROR_TEXT du bot = table de docs/ERREURS.md (codes et textes identiques) ; repli pour un code inconnu", () => {
  const md = readFileSync(new URL("../../../docs/api/ERREURS.md", import.meta.url), "utf8");
  const rows = new Map<string, string>();
  let header: string[] | null = null;
  for (const line of md.split("\n")) {
    if (!line.trim().startsWith("|")) { if (header && rows.size) break; continue; }
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    if (!header) { if (cells.some((c) => /^code/i.test(c)) && cells.some((c) => /^texte/i.test(c))) header = cells.map((c) => c.toLowerCase()); continue; }
    const m = /^`([a-z_]+)`$/.exec(cells[header.findIndex((c) => c.startsWith("code"))] ?? "");
    if (m) rows.set(m[1]!, cells[header.findIndex((c) => c.startsWith("texte"))]!);
  }
  assert.ok(rows.size >= 38, `table lue (${rows.size} codes)`);
  assert.deepEqual(Object.keys(ERROR_TEXT).sort(), [...rows.keys()].sort());
  for (const [code, text] of rows) assert.equal(ERROR_TEXT[code], text, code);
  assert.equal(failureText("code_inconnu"), ERROR_FALLBACK_TEXT);
  assert.equal(failureText("bot_check"), ERROR_TEXT.bot_check);
  assert.equal(failureText("quota_exceeded"), SERVICE_TEXT.quota_exceeded);
  assert.equal(failureText("not_linked"), BOT_TEXT.not_linked);
  assert.match(failureText("api_unreachable"), /ne répond pas/);
  assert.doesNotMatch(failureText("auth_unavailable"), /jeton/, "le mot « jeton » n'a pas de sens dans Discord");
});

// ---- client de l'API interne d'account -------------------------------------------------------------

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
function fakeFetch(handler: (c: Call) => { status: number; body?: unknown; headers?: Record<string, string> } | "throw" | "hang") {
  const calls: Call[] = [];
  const fn = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => {
    const c: Call = { url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null };
    calls.push(c);
    const r = handler(c);
    if (r === "throw") return Promise.reject(new TypeError("fetch failed"));
    if (r === "hang") return new Promise<never>((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "TimeoutError" }))));
    const text = r.body === undefined ? "" : JSON.stringify(r.body);
    return Promise.resolve({ status: r.status, headers: { get: (n: string) => r.headers?.[n.toLowerCase()] ?? null }, text: async () => text });
  };
  return { fn, calls };
}

test("client account : secret en en-tête, corps JSON, réponses typées, erreurs ramenées à des codes stables", async () => {
  const today = { used: 3, limit: 10, remaining: 7, unlimited: false, bonus: 0, resetAt: "2026-10-11T22:00:00.000Z" };
  const linked = { linked: true, status: "active", user: { name: "Alice", email: "a•••@example.com" }, discord: { name: "malvu", linkedAt: "2026-10-11T10:00:00.000Z", lastUsedAt: null }, today, maxActive: 1 };
  const f = fakeFetch((c) => (c.url.endsWith("/resolve") ? { status: 200, body: linked } : c.url.endsWith("/session") ? { status: 201, body: { key: KEY, keyId: "kid12345", expiresAt: "x" } } : c.url.endsWith("/release") ? { status: 204 } : { status: 201, body: { url: `${SITE}/api/discord/telechargement?jeton=${"t".repeat(43)}`, expiresAt: "x" } }));
  const a = new AccountClient("http://account-discord:3002", SECRET, f.fn as never);
  assert.deepEqual(await a.resolve(DUSER), linked);
  assert.equal((await a.session(DUSER)).key, KEY);
  assert.equal(await a.release(DUSER, "kid12345"), true);
  assert.match((await a.download(DUSER, "job-1")).url, /telechargement\?jeton=/);
  for (const c of f.calls) {
    assert.equal(c.method, "POST");
    assert.equal(c.headers["x-bot-token"], SECRET);
    assert.equal((c.body as { discord_user_id: string }).discord_user_id, DUSER);
    assert.ok(c.url.startsWith("http://account-discord:3002/internal/v1/discord/"));
  }
  const err = async (status: number, body: unknown, call: (x: AccountClient) => Promise<unknown> = (x) => x.session(DUSER)) => {
    const x = new AccountClient("http://a:3002", SECRET, fakeFetch(() => ({ status, body })).fn as never);
    try { await call(x); assert.fail("refus attendu"); } catch (e) { assert.ok(e instanceof AccountError); return e.code; }
  };
  assert.equal(await err(404, { error: "not_linked" }), "not_linked");
  assert.equal(await err(403, { error: "account_suspended" }), "account_suspended");
  assert.equal(await err(503, { error: "service_paused" }), "service_paused");
  assert.equal(await err(429, { error: "too_many_sessions" }), "too_many_sessions");
  assert.equal(await err(401, { error: "unauthorized" }), "link_unavailable", "secret refusé : configuration, pas l'utilisateur");
  assert.equal(await err(403, { error: "forbidden" }), "link_unavailable", "réseau refusé");
  assert.equal(await err(500, { error: "internal_error" }), "link_unavailable");
  assert.equal(await err(200, "pas un objet", (x) => x.resolve(DUSER)), "link_unavailable");
  const down = new AccountClient("http://a:3002", SECRET, fakeFetch(() => "throw").fn as never);
  await assert.rejects(down.resolve(DUSER), (e: AccountError) => e.code === "link_unavailable");
  assert.equal(await down.release(DUSER, "kid12345"), false, "release ne lève jamais");
  const slow = new AccountClient("http://a:3002", SECRET, fakeFetch(() => "hang").fn as never);
  const t0 = Date.now();
  // AbortSignal.timeout n'empêche pas Node de s'arrêter (minuterie « unref ») : le bot vivant, si ; ici, une minuterie témoin.
  const alive = setInterval(() => undefined, 1000);
  try {
    await assert.rejects(slow.resolve(DUSER), (e: AccountError) => e.code === "link_unavailable");
  } finally { clearInterval(alive); }
  const waited = Date.now() - t0;
  assert.ok(waited >= 2900 && waited < 4500, `délai de 3 s (${waited} ms)`);
  const none = fakeFetch(() => ({ status: 200, body: {} }));
  await assert.rejects(new AccountClient("http://a:3002", SECRET, none.fn as never).resolve("pas-un-id"), (e: AccountError) => e.code === "bad_request");
  assert.equal(none.calls.length, 0, "identifiant invalide : aucun appel");
});

// ---- client de ytapi ---------------------------------------------------------------------------------

test("client ytapi : clé en Bearer seulement, corps {url, fmt[, quality|bitrate]}, titre et taille lus (affichage privé), erreurs typées", async () => {
  const f = fakeFetch((c) => c.method === "POST"
    ? { status: 202, body: { job_id: "job-1", status: "queued", stage: null, progress: 0, platform: "youtube", title: "Titre secret", filename: "Titre secret [x].mp4" } }
    : { status: 200, body: { job_id: "job-1", status: "error", progress: 40, platform: "youtube", error: "bot_check", detail: "…" } });
  const y = new YtapiClient("https://api.example.test/media", f.fn as never);
  const j = await y.createJob(KEY, VIDEO, "mp4");
  // Version 2 : titre et nom du fichier lus pour la carte PRIVÉE du résultat (jamais journalisés ni conservés).
  assert.deepEqual(j, { id: "job-1", status: "queued", stage: null, progress: 0, platform: "youtube", error: null,
    title: "Titre secret", filename: "Titre secret [x].mp4", sizeBytes: null, mediaType: null, notes: [], retryAfterS: null });
  assert.equal(f.calls[0]!.url, "https://api.example.test/media/jobs");
  assert.equal(f.calls[0]!.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(f.calls[0]!.body, { url: VIDEO, fmt: "mp4" });
  await y.createJob(KEY, VIDEO, { fmt: "mp4", quality: "720" });
  assert.deepEqual(f.calls.at(-1)!.body, { url: VIDEO, fmt: "mp4", quality: "720" }, "qualité transmise pour un MP4");
  await y.createJob(KEY, VIDEO, { fmt: "mp3", quality: "720", bitrate: 320 });
  assert.deepEqual(f.calls.at(-1)!.body, { url: VIDEO, fmt: "mp3", bitrate: 320 }, "débit pour un MP3, jamais de qualité vidéo");
  f.calls.splice(1);
  const e = await y.job(KEY, "job-1", 99);
  assert.equal(f.calls[1]!.url, "https://api.example.test/media/jobs/job-1?wait=25", "attente bornée à 25 s");
  assert.ok(!f.calls[1]!.url.includes(KEY), "jamais la clé dans l'URL");
  assert.deepEqual([e.status, e.error], ["error", "bot_check"]);
  const q = new YtapiClient("https://a", fakeFetch(() => ({ status: 429, body: { error: "quota_exceeded", detail: "…" }, headers: { "retry-after": "3600" } })).fn as never);
  await assert.rejects(q.createJob(KEY, VIDEO, "mp3"), (x: YtapiError) => x.code === "quota_exceeded" && x.status === 429 && x.retryAfterS === 3600);
  const down = new YtapiClient("https://a", fakeFetch(() => "throw").fn as never);
  await assert.rejects(down.job(KEY, "job-1", 20), (x: YtapiError) => x.code === "api_unreachable");
  await assert.rejects(y.job(KEY, "../x", 1), (x: YtapiError) => x.code === "bad_job");
  const html = new YtapiClient("https://a", fakeFetch(() => ({ status: 502, body: "<html>" })).fn as never);
  await assert.rejects(html.job(KEY, "job-1", 1), (x: YtapiError) => x.code === "api_unreachable");
});

// ---- déroulé de /convert --------------------------------------------------------------------------

interface Bench {
  deps: ConvertDeps; edits: Reply[]; released: string[]; created: { key: string; url: string; fmt: string }[]; polls: number; clock: { t: number };
}
function bench(o: {
  session?: () => Promise<{ key: string; keyId: string; expiresAt: string | null }>;
  create?: (n: number) => Job;
  jobs?: ((n: number) => Job | YtapiError)[];
  pollMs?: number;
  download?: () => Promise<{ url: string; expiresAt: string }>;
  editFails?: boolean;
} = {}): Bench {
  const clock = { t: 1_000_000 };
  const b: Bench = { deps: null as never, edits: [], released: [], created: [], polls: 0, clock };
  let sessions = 0;
  b.deps = {
    siteUrl: SITE,
    now: () => clock.t,
    sleep: async (ms) => { clock.t += ms; },
    edit: async (r) => { if (o.editFails) throw Object.assign(new Error("Unknown interaction"), { name: "DiscordAPIError" }); b.edits.push(r); },
    account: {
      session: o.session ?? (async () => ({ key: `${KEY.slice(0, -1)}${++sessions}`, keyId: `kid-${sessions}`, expiresAt: null })),
      release: async (_d, keyId) => { b.released.push(keyId); return true; },
      download: o.download ?? (async () => ({ url: `${SITE}/api/discord/telechargement?jeton=${"T".repeat(43)}`, expiresAt: "x" })),
    },
    ytapi: {
      createJob: async (key, url, fmt) => { b.created.push({ key, url, fmt }); return o.create ? o.create(b.created.length) : { id: "job-1", status: "queued", stage: null, progress: 0, platform: "youtube", error: null }; },
      job: async (_k, _id, waitS) => {
        const step = o.jobs?.[b.polls] ?? (() => ({ id: "job-1", status: "done", stage: null, progress: 100, platform: "youtube", error: null } as Job));
        b.polls++;
        clock.t += o.pollMs ?? waitS * 1000;
        const r = step(b.polls);
        if (r instanceof YtapiError) throw r;
        return r;
      },
    },
  };
  return b;
}
const J = (status: Job["status"], progress: number | null, error: string | null = null): Job => ({ id: "job-1", status, stage: null, progress, platform: "tiktok", error });
const req = (startedAt = 1_000_000) => ({ discordUserId: DUSER, url: VIDEO, fmt: "mp4" as const, startedAt });
const text = (r: Reply) => JSON.stringify(r);

test("/convert : un seul message mis à jour (file, paliers réels, terminé) puis lien à usage unique ; clé rendue", async () => {
  const b = bench({ jobs: [() => J("running", 10), () => J("running", 30), () => J("running", 60), () => J("done", 100)] });
  const o = await runConversion(b.deps, req());
  assert.deepEqual([o.outcome, o.edits], ["done", 5]);
  const titles = b.edits.map((r) => r.embeds?.[0]?.title);
  assert.deepEqual(titles, ["Demande reçue", "Conversion en cours", "Conversion en cours", "Conversion en cours", "Conversion terminée"]);
  assert.deepEqual(b.edits.slice(1, 4).map((r) => r.embeds![0]!.description), [
    "Récupération et conversion du média (MP4)… 10 %", "Récupération et conversion du média (MP4)… 30 %", "Récupération et conversion du média (MP4)… 60 %",
  ]);
  const done = b.edits.at(-1)!;
  assert.deepEqual(done.components, [{ type: 1, components: [{ type: 2, style: 5, label: "Télécharger", url: `${SITE}/api/discord/telechargement?jeton=${"T".repeat(43)}` }] }]);
  assert.deepEqual(done.embeds![0]!.fields, [{ name: "Format", value: "MP4", inline: true }, { name: "Plateforme", value: "TikTok", inline: true }]);
  assert.equal(done.embeds![0]!.color, 0xd4af7c);
  assert.deepEqual(b.released, ["kid-1"]);
  assert.equal(b.created[0]!.key.startsWith("ytc_"), true);
  for (const r of b.edits) {
    assert.ok(!text(r).includes("dQw4w9WgXcQ") && !text(r).includes("titre-secret"), "jamais le lien de la vidéo");
    assert.ok(!text(r).includes("ytc_"), "jamais la clé");
  }
});

test("/convert : paliers de 25 % et 5 s minimum entre deux modifications ; état inchangé → aucune modification", async () => {
  const b = bench({ pollMs: 1000, jobs: [() => J("queued", 0), () => J("running", 5), () => J("running", 20), () => J("running", 24), () => J("running", 26), () => J("running", 27), () => J("running", 80), () => J("done", 100)] });
  const o = await runConversion(b.deps, req());
  assert.equal(o.outcome, "done");
  // file (t0) ; running 5 % à +2 s : trop tôt ; 20 % à +3 s : trop tôt ; 24 % à +4 s : trop tôt ; 26 % à +5 s : palier 1 → envoyé ;
  // 27 % : même palier ; 80 % à +7 s : < 5 s depuis l'envoi → attendu ; terminé : toujours envoyé.
  const desc = b.edits.map((r) => `${r.embeds![0]!.title}|${r.embeds![0]!.description ?? ""}`);
  assert.deepEqual(desc, ["Demande reçue|Ta conversion MP4 est en file d'attente.", "Conversion en cours|Récupération et conversion du média (MP4)… 26 %", desc.at(-1)]);
  assert.match(desc.at(-1)!, /^Conversion terminée/);
});

test("/convert : compte non lié → invitation à lier (bouton vers l'espace), aucune conversion, aucune clé", async () => {
  const b = bench({ session: async () => { throw new AccountError("not_linked", 404); } });
  const o = await runConversion(b.deps, req());
  assert.equal(o.outcome, "not_linked");
  assert.equal(b.created.length, 0);
  assert.deepEqual(b.released, []);
  assert.equal(b.edits.length, 1);
  assert.equal(b.edits[0]!.embeds![0]!.title, "Compte non lié");
  assert.deepEqual(b.edits[0]!.components![0]!.components[0], { type: 2, style: 5, label: "Lier mon compte", url: `${SITE}/dashboard/discord` });
});

test("/convert : refus d'account (suspendu, pause, plafond, injoignable) → texte clair, aucun job", async () => {
  for (const [code, expected] of [["account_suspended", "Ce compte est suspendu."], ["service_paused", SERVICE_TEXT.service_paused], ["too_many_sessions", SERVICE_TEXT.too_many_sessions], ["link_unavailable", BOT_TEXT.link_unavailable]] as const) {
    const b = bench({ session: async () => { throw new AccountError(code, 403); } });
    const o = await runConversion(b.deps, req());
    assert.deepEqual([o.outcome, o.code], ["refused", code]);
    assert.equal(b.created.length, 0);
    assert.equal(b.edits[0]!.embeds![0]!.description, expected);
    assert.equal(b.edits[0]!.embeds![0]!.color, 0xa3372b);
    assert.match(b.edits[0]!.embeds![0]!.footer!.text, new RegExp(`Code : ${code}`));
  }
});

test("/convert : refus de ytapi à la création (quota, conversion active, lien) → texte du catalogue, clé rendue", async () => {
  for (const [code, expected] of [["quota_exceeded", SERVICE_TEXT.quota_exceeded], ["active_job_limit", SERVICE_TEXT.active_job_limit], ["unsupported_url", ERROR_TEXT.unsupported_url], ["platform_disabled", SERVICE_TEXT.platform_disabled]] as const) {
    const b = bench();
    b.deps.ytapi.createJob = async () => { throw new YtapiError(code, 429); };
    const o = await runConversion(b.deps, req());
    assert.deepEqual([o.outcome, o.code], ["error", code]);
    assert.equal(b.edits.at(-1)!.embeds![0]!.description, expected);
    assert.deepEqual(b.released, ["kid-1"]);
  }
});

test("/convert : clé refusée par ytapi (401) → UNE nouvelle clé, puis réussite ; les deux clés rendues", async () => {
  const b = bench();
  let n = 0;
  const create = b.deps.ytapi.createJob;
  b.deps.ytapi.createJob = async (k, u, f) => { if (++n === 1) throw new YtapiError("unauthorized", 401); return create(k, u, f); };
  const o = await runConversion(b.deps, req());
  assert.equal(o.outcome, "done");
  assert.deepEqual([...new Set(b.released)].sort(), ["kid-1", "kid-2"]);
  const b2 = bench();
  b2.deps.ytapi.createJob = async () => { throw new YtapiError("unauthorized", 401); };
  const o2 = await runConversion(b2.deps, req());
  assert.deepEqual([o2.outcome, o2.code], ["error", "unauthorized"], "pas de deuxième nouvelle clé");
  assert.equal(b2.edits.at(-1)!.embeds![0]!.description, SERVICE_TEXT.unauthorized);
});

test("/convert : échec de conversion (bot_check, cancelled) → texte de docs/ERREURS.md et code", async () => {
  for (const code of ["bot_check", "cancelled", "code_futur"]) {
    const b = bench({ jobs: [() => J("running", 40), () => J("error", 40, code)] });
    const o = await runConversion(b.deps, req());
    assert.deepEqual([o.outcome, o.code], ["error", code]);
    const e = b.edits.at(-1)!.embeds![0]!;
    assert.equal(e.title, "Conversion impossible");
    assert.equal(e.description, code === "code_futur" ? ERROR_FALLBACK_TEXT : ERROR_TEXT[code]);
    assert.deepEqual(b.released, ["kid-1"]);
  }
});

test("/convert : fenêtre de 15 min de Discord → « La conversion continue… » vers 14 min, suivi arrêté, clé rendue", async () => {
  const b = bench({ jobs: Array.from({ length: 200 }, () => () => J("running", 50)) });
  const o = await runConversion(b.deps, req());
  assert.equal(o.outcome, "window_closed");
  assert.ok(b.clock.t - 1_000_000 >= 14 * 60_000 && b.clock.t - 1_000_000 < 15 * 60_000, "arrêt entre 14 et 15 min");
  const last = b.edits.at(-1)!;
  assert.equal(last.embeds![0]!.description, BOT_TEXT.discord_window_closed);
  assert.equal(last.components![0]!.components[0]!.url, `${SITE}/dashboard/activite`);
  assert.deepEqual(b.released, ["kid-1"]);
  assert.ok(b.polls <= 45, `long polling de 20 s (${b.polls} interrogations)`);
});

test("/convert : ytapi injoignable un moment → le suivi reprend ; trop d'échecs d'affilée → abandon clair", async () => {
  const ko = () => new YtapiError("api_unreachable", 0);
  const b = bench({ jobs: [ko, ko, () => J("running", 60), () => J("done", 100)] });
  assert.equal((await runConversion(b.deps, req())).outcome, "done");
  const b2 = bench({ jobs: Array.from({ length: MAX_POLL_FAILURES + 1 }, () => ko) });
  const o2 = await runConversion(b2.deps, req());
  assert.deepEqual([o2.outcome, o2.code], ["error", "api_unreachable"]);
  assert.match(b2.edits.at(-1)!.embeds![0]!.description!, /ne répond pas/);
  const b3 = bench({ jobs: [() => new YtapiError("account_suspended", 403)] });
  const o3 = await runConversion(b3.deps, req());
  assert.deepEqual([o3.outcome, o3.code, b3.polls], ["error", "account_suspended", 1], "refus définitif : pas de nouvel essai");
});

test("/convert : lien de téléchargement non créé → message honnête ; message Discord en erreur → le suivi continue", async () => {
  const b = bench({ download: async () => { throw new AccountError("link_unavailable", 0); } });
  const o = await runConversion(b.deps, req());
  assert.deepEqual([o.outcome, o.code], ["error", "link_not_created"]);
  assert.equal(b.edits.at(-1)!.embeds![0]!.description, BOT_TEXT.download_unavailable);
  const errors: unknown[] = [];
  const b2 = bench({ editFails: true });
  b2.deps.onEditError = (e) => errors.push(e);
  const o2 = await runConversion(b2.deps, req());
  assert.deepEqual([o2.outcome, o2.edits], ["done", 0]);
  assert.ok(errors.length >= 2);
  assert.deepEqual(b2.released, ["kid-1"]);
});

// ---- /account, garde-fous, aide, commandes -----------------------------------------------------

test("garde-fous : une conversion suivie à la fois par personne, plafond global, identifiants oubliés à la fin", () => {
  const f = createFlights(2);
  assert.equal(f.start("a"), "ok");
  assert.equal(f.start("a"), "in_progress");
  assert.equal(f.start("b"), "ok");
  assert.equal(f.start("c"), "busy");
  f.end("a"); f.end("b");
  assert.equal(f.size(), 0);
});


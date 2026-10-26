// Tests unitaires du bot (aucun appel à Discord). Le « token » utilisé ici est FICTIF, généré à l'exécution.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { ConfigError, inviteUrl, loadConfig, readToken, tokenAppId, TOKEN_SHAPE } from "../src/config.ts";
import { isHealthy } from "../src/health.ts";
import { addSecret, redact } from "../src/log.ts";
import { conversionErrorText } from "../src/errors.ts";
import { isSupportedLink, isYouTubeMusicHost, isYouTubeMusicLink } from "../src/handlers.ts";
import { createStatusReader, type ServiceStatus } from "../src/status.ts";
import { createRateLimiter } from "../src/ratelimit.ts";

const b64 = (n: number) => randomBytes(n).toString("base64url");
const fakeToken = () => `${b64(18)}.${b64(5)}.${b64(28)}`;
const env = { DISCORD_CLIENT_ID: "1558821698734923796", DISCORD_GUILD_ID: "1309973220362944633" };

test("configuration : identifiants numériques exigés, adresses par défaut", () => {
  const c = loadConfig(env);
  assert.equal(c.clientId, env.DISCORD_CLIENT_ID);
  assert.equal(c.siteUrl, "https://raccourci.malvu.fr");
  assert.throws(() => loadConfig({ ...env, DISCORD_GUILD_ID: "abc" }), ConfigError);
  assert.throws(() => loadConfig({ DISCORD_GUILD_ID: env.DISCORD_GUILD_ID }), ConfigError);
});

test("token : lu dans le fichier secret, jamais cité dans les erreurs", () => {
  const t = fakeToken();
  assert.ok(TOKEN_SHAPE.test(t));
  assert.equal(readToken({ DISCORD_BOT_TOKEN_FILE: "/x" }, () => `${t}\n`), t);
  assert.throws(() => readToken({ DISCORD_BOT_TOKEN_FILE: "/absent" }, () => { throw new Error("ENOENT"); }), /introuvable/);
  try { readToken({ DISCORD_BOT_TOKEN_FILE: "/x" }, () => "pas-un-token"); assert.fail(); }
  catch (e) { assert.ok(e instanceof ConfigError); assert.doesNotMatch(String(e.message), /pas-un-token/); }
});

test("token : application vérifiée hors ligne (1er segment = ID public du bot)", () => {
  const t = `${Buffer.from(env.DISCORD_CLIENT_ID).toString("base64url")}.${b64(5)}.${b64(28)}`;
  assert.equal(tokenAppId(t), env.DISCORD_CLIENT_ID);
  assert.equal(tokenAppId(fakeToken()), null);
});

test("journal : le token (et tout ce qui y ressemble) est masqué", () => {
  const t = fakeToken();
  addSecret(t);
  assert.equal(redact(`connexion ${t} ok`), "connexion [secret] ok");
  const other = fakeToken();
  assert.equal(redact(`x ${other}`), "x [secret]");
});

const status: ServiceStatus = { site: "ok", conversion: "down", maintenance: "Maintenance ce soir.", platforms: { youtube: true, tiktok: false, x: null }, quotas: { daily: 10, maxActive: 1 }, checkedAt: Date.UTC(2026, 9, 11, 12, 0) };

test("liens pris en charge : YouTube, TikTok, X en https uniquement", () => {
  for (const ok of ["https://youtu.be/x", "https://m.youtube.com/watch?v=1", "https://vm.tiktok.com/abc", "https://x.com/a/status/1", "https://twitter.com/a/status/1"]) assert.ok(isSupportedLink(ok), ok);
  for (const ko of ["http://youtube.com/watch?v=1", "https://youtube.com.evil.test/x", "https://instagram.com/p/1", "javascript:alert(1)", "pas une url"]) assert.ok(!isSupportedLink(ko), ko);
});

test("YouTube Music (fermé le 2026-10-23) : jamais un lien pris en charge, sous aucune écriture ; les liens classiques et voisins restent acceptés", () => {
  for (const music of ["https://music.youtube.com/watch?v=1", "https://MUSIC.YOUTUBE.COM/watch?v=1", "https://music.youtube.com./watch?v=1", "https://music.youtube.com:443/watch?v=1",
                       "https://m.music.youtube.com/watch?v=1", "https://www.music.youtube.com/playlist?list=PL1", "https://music.youtu.be/x", "https://youtubemusic.com/"]) {
    assert.ok(!isSupportedLink(music), music);
    assert.ok(isYouTubeMusicLink(music), music);
  }
  for (const music of ["music.youtube.com/watch?v=1", "//music.youtube.com/watch?v=1", "  https://music.youtube.com/x  "]) assert.ok(isYouTubeMusicLink(music), music);
  for (const classic of ["https://www.youtube.com/watch?v=1", "https://m.youtube.com/watch?v=1", "https://youtu.be/x", "https://youtube.com/shorts/x", "https://notmusic.youtube.com/watch?v=1",
                         "https://www.tiktok.com/@a/video/1", "https://x.com/a/status/1", "https://example.com/?u=https://music.youtube.com/"]) assert.ok(!isYouTubeMusicLink(classic), classic);
  assert.ok(isSupportedLink("https://www.youtube.com/watch?v=1") && isSupportedLink("https://m.youtube.com/watch?v=1") && isSupportedLink("https://youtu.be/x"));
  assert.ok(!isYouTubeMusicHost("notmusic.youtube.com") && isYouTubeMusicHost("music.youtube.com"));
  assert.equal(conversionErrorText("youtube_music_not_accepted"), "Les liens YouTube Music ne sont pas acceptés : AETHRYON ne télécharge pas le catalogue musical commercial.");
});

test("état du service : lecture des adresses publiques, cache 30 s, panne détectée", async () => {
  let calls = 0; let t = 0;
  const fetchFn = async (url: string) => { calls++; return url.endsWith("/api/config")
    ? { ok: true, json: async () => ({ maintenanceMessage: null, platforms: { youtube: true, tiktok: true, twitter: false }, quotas: { daily: 10, maxActive: 1 } }) }
    : { ok: false, json: async () => ({}) }; };
  const read = createStatusReader("https://site.test", "https://api.test/health", fetchFn, 30_000, () => t);
  const s = await read();
  assert.deepEqual([s.site, s.conversion, s.platforms.x, s.quotas?.daily], ["ok", "down", false, 10]);
  assert.deepEqual(s.pauses, [], "/api/status illisible : aucune pause annoncée");
  await read(); assert.equal(calls, 3, "en cache (config, santé, état)");
  t = 31_000; await read(); assert.equal(calls, 6, "relu après 30 s");
});

test("limite anti-abus : 5 commandes par 30 s et par personne, en mémoire", () => {
  let t = 0;
  const l = createRateLimiter(5, 30_000, () => t);
  for (let i = 0; i < 5; i++) assert.ok(l.allow("u1"));
  assert.ok(!l.allow("u1"));
  assert.ok(l.allow("u2"));
  t = 30_001; assert.ok(l.allow("u1"));
  t = 70_000; l.sweep(); assert.equal(l.size(), 0, "oublié après la fenêtre");
});

test("invitation : bot + commandes slash, aucune permission demandée", () => {
  const u = new URL(inviteUrl(env.DISCORD_CLIENT_ID));
  assert.equal(u.searchParams.get("client_id"), env.DISCORD_CLIENT_ID);
  assert.equal(u.searchParams.get("scope"), "bot applications.commands");
  assert.equal(u.searchParams.get("permissions"), "0");
});

test("santé Docker : battement de moins de 60 s exigé", () => {
  assert.ok(isHealthy(() => "1000", 50_000));
  assert.ok(!isHealthy(() => "1000", 70_000));
  assert.ok(!isHealthy(() => { throw new Error("absent"); }, 0));
  assert.ok(!isHealthy(() => "n'importe quoi", 0));
});

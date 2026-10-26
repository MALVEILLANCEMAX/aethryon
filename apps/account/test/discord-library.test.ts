// Bot Discord v2 (docs/DISCORD-BOT.md §18) côté account : liens canoniques, migration 006 (up → down → up),
// préférences, médias enregistrés (recherche, filtres, doublons, plafond, validation), historique, déliaison depuis
// Discord, fichier pour pièce jointe (borné), réglages de serveur, limites, export, suppression du compte, purge.
// Liaison réelle contre le FAUX Discord local (fake-discord.ts) ; aucune requête vers Discord.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appliedVersions, migrateDown, migrateUp } from "../src/db.ts";
import { canonicalMedia, cleanText, DEFAULT_GUILD, GUILD_RETENTION_DAYS, MAX_SAVED, mergeGuild } from "../src/discord-library.ts";
import { YOUTUBE_MUSIC_CODE, YOUTUBE_MUSIC_TEXT } from "../src/youtube-music.ts";
import { Browser, harness, newUser, ORIGIN, type Harness } from "./helpers.ts";
import { startFakeDiscord, type FakeDiscord, type FakeProfile } from "./fake-discord.ts";

const CLIENT_ID = "1558821698734923796";
const CLIENT_SECRET = "faux-secret-client-" + "c".repeat(24);
const BOT_TOKEN = "faux-secret-du-bot-" + "b".repeat(40);
let seq = 1;
const did = () => `8${String(Date.now()).slice(-9)}${String(seq++).padStart(8, "0")}`;

interface Bench { h: Harness; fake: FakeDiscord; close(): Promise<void> }
async function setup(): Promise<Bench> {
  const fake = await startFakeDiscord({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: `${ORIGIN}/api/discord/callback` });
  const sdir = mkdtempSync(join(tmpdir(), "ytc2-discord-lib-"));
  const secret = join(sdir, "discord_client_secret");
  const botFile = join(sdir, "discord_internal_token");
  writeFileSync(secret, CLIENT_SECRET, { mode: 0o600 });
  writeFileSync(botFile, BOT_TOKEN, { mode: 0o600 });
  const h = await harness({
    ADMIN_EMAILS: "admin@example.test", DISCORD_CLIENT_ID: CLIENT_ID, DISCORD_CLIENT_SECRET_FILE: secret,
    DISCORD_OAUTH_BASE: fake.url, DISCORD_INTERNAL_TOKEN_FILE: botFile,
  }, { discordTimeoutMs: 400 });
  return { h, fake, async close() { h.close(); await fake.close(); rmSync(sdir, { recursive: true, force: true }); } };
}
async function bot(h: Harness, path: string, body: unknown) {
  const res = await h.s.discordInternalApp!.request(path, { method: "POST", headers: { "content-type": "application/json", "x-bot-token": BOT_TOKEN }, body: JSON.stringify(body) });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* corps binaire */ }
  return { status: res.status, body: parsed as any, headers: res.headers };
}
async function link(b: Browser, fake: FakeDiscord, profile: FakeProfile) {
  const r = await b.json<{ url: string }>("/api/discord/link", { method: "POST" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  fake.next.profile = profile;
  fake.next.deny = false;
  const back = new URL((await fetch(r.body.url, { redirect: "manual" })).headers.get("location")!);
  const res = await b.req(back.pathname + back.search);
  assert.equal(new URL(res.headers.get("location")!).searchParams.get("liaison"), "ok");
}
async function linked(B: Bench, email: string) {
  const u = await newUser(B.h, email);
  const id = did();
  await link(u, B.fake, { id, username: email.split("@")[0]! });
  const uid = (await u.json("/api/me")).body.user.id as string;
  return { u, id, uid };
}

// ---- liens canoniques ----------------------------------------------------------------------------

test("liens canoniques : YouTube (watch, youtu.be, shorts), TikTok (vidéo, liens courts), X ; tout le reste refusé", () => {
  const ok: [string, string, string][] = [
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42&list=PL1", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"],
    ["https://m.youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube.com/shorts/dQw4w9WgXcQ", "youtube"],
    ["https://www.tiktok.com/@nasa/video/7391234567890123456?is_from_webapp=1", "https://www.tiktok.com/@nasa/video/7391234567890123456", "tiktok"],
    ["https://vm.tiktok.com/ZMabc123/", "https://vm.tiktok.com/ZMabc123/", "tiktok"],
    ["https://www.tiktok.com/t/ZTabc123/", "https://www.tiktok.com/t/ZTabc123/", "tiktok"],
    ["https://twitter.com/NASA/status/1883228395842023524?s=20", "https://x.com/NASA/status/1883228395842023524", "x"],
    ["https://x.com/NASA/status/1883228395842023524/video/1", "https://x.com/NASA/status/1883228395842023524/video/1", "x"],
  ];
  for (const [raw, url, platform] of ok) assert.deepEqual(canonicalMedia(raw), { url, platform }, raw);
  for (const raw of [
    "http://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://evil.com/watch?v=dQw4w9WgXcQ", "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
    "https://user:pw@www.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/playlist?list=PL1",
    "https://www.youtube.com/@chaine", "https://www.tiktok.com/@nasa", "https://www.tiktok.com/@nasa/photo/7391234567890123456",
    "https://x.com/NASA", "https://instagram.com/p/abc", "javascript:alert(1)", "pas un lien", "https://www.youtube.com/watch?v=court",
    // YouTube Music (fermé le 2026-10-23) n'est plus réécrit en lien YouTube classique.
    "https://music.youtube.com/watch?v=dQw4w9WgXcQ", "https://MUSIC.YOUTUBE.COM/watch?v=dQw4w9WgXcQ", "https://m.music.youtube.com/watch?v=dQw4w9WgXcQ",
  ]) assert.equal(canonicalMedia(raw), null, raw);
  assert.equal(cleanText("  Titre‮ inversé\u0000 \n avec   espaces ", 200), "Titre inversé avec espaces");
  assert.equal(cleanText("x".repeat(500), 200)?.length, 200);
  assert.equal(cleanText(42, 10), null);
});

test("réglages de serveur : défauts, correctif partiel, refus d'un champ inconnu ou d'une valeur invalide", () => {
  assert.equal(DEFAULT_GUILD.autoEmbeds, false, "détection automatique désactivée par défaut");
  assert.equal(DEFAULT_GUILD.share, false, "résultats privés par défaut");
  assert.equal(DEFAULT_GUILD.original, "keep", "message d'origine gardé par défaut");
  const g = mergeGuild(DEFAULT_GUILD, { autoEmbeds: true, platforms: ["x", "tiktok", "x"], channels: ["123456789012345678"], perHour: 10 });
  assert.deepEqual(g.platforms, ["tiktok", "x"]);
  assert.equal(g.perHour, 10);
  for (const bad of [{ inconnu: 1 }, { autoEmbeds: "oui" }, { platforms: ["instagram"] }, { channels: ["#general"] }, { perHour: 0 }, { perHour: 500 },
    { original: "delete" }, { mode: "spam" }, { quality: "4k" }, null, [], "texte"]) {
    assert.throws(() => mergeGuild(DEFAULT_GUILD, bad), /invalide|Réglage/, JSON.stringify(bad));
  }
});

// ---- migration 006 ------------------------------------------------------------------------------

test("migration 006 : up → down → up ; tables nouvelles seulement, données existantes intactes", async () => {
  const h = await harness({ ADMIN_EMAILS: "admin@example.test" });
  try {
    const db = h.s.db;
    const before = appliedVersions(db);
    assert.equal(before.at(-1), 15);
    const u = await newUser(h, "mig@example.test");
    const uid = (await u.json("/api/me")).body.user.id as string;
    await u.json("/api/keys", { method: "POST", body: { name: "iPhone" } });
    const snap = () => JSON.stringify(["user", "apikey", "ytc_key_meta", "ytc_usage", "ytc_discord_link"].map((t) => db.prepare(`SELECT * FROM "${t}" ORDER BY 1`).all()));
    const ref = snap();
    await h.s.library.setPrefs(uid, { fmt: "mp3" });
    await h.s.library.savedAdd(uid, { url: "https://youtu.be/dQw4w9WgXcQ", title: "Essai" });
    assert.deepEqual(migrateDown(db, 10), [15, 14, 13, 12, 11, 10, 9, 8, 7, 6]);
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
    for (const t of ["ytc_user_pref", "ytc_saved_media", "ytc_discord_guild"]) assert.ok(!names.includes(t), `${t} supprimée`);
    assert.equal(snap(), ref, "données 001–005 identiques après le retour arrière");
    migrateUp(db);
    assert.equal(appliedVersions(db).at(-1), 15);
    assert.equal(snap(), ref, "données 001–005 identiques après la remontée");
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal((db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check, "ok");
    // Les contraintes protègent la base même si le code était contourné.
    assert.throws(() => db.prepare("INSERT INTO ytc_saved_media (id, user_id, platform, source_url, saved_at) VALUES ('abcdefgh', ?, 'youtube', 'http://non-https.test/x', 'x')").run(uid));
    assert.throws(() => db.prepare("INSERT INTO ytc_user_pref (user_id, fmt, updated_at) VALUES (?, 'gif', 'x')").run(uid));
  } finally { h.close(); }
});

// ---- API interne du bot -------------------------------------------------------------------------

test("préférences : défauts, modification validée, compte non lié ou suspendu refusé", async () => {
  const B = await setup();
  try {
    const { h } = B;
    const { id, uid } = await linked(B, "prefs@example.test");
    assert.deepEqual((await bot(h, "/internal/v1/discord/prefs", { discord_user_id: id })).body, { fmt: "mp4", quality: "auto", visibility: "private", locale: "auto" });
    const set = await bot(h, "/internal/v1/discord/prefs/set", { discord_user_id: id, fmt: "mp3", visibility: "share" });
    assert.equal(set.status, 200);
    assert.deepEqual(set.body, { fmt: "mp3", quality: "auto", visibility: "share", locale: "auto" });
    for (const bad of [{ fmt: "gif" }, { quality: "4k" }, { locale: "de" }, { inconnu: "x" }, { fmt: 4 }]) {
      assert.equal((await bot(h, "/internal/v1/discord/prefs/set", { discord_user_id: id, ...bad })).status, 400, JSON.stringify(bad));
    }
    assert.equal((await bot(h, "/internal/v1/discord/prefs", { discord_user_id: did() })).body.error, "not_linked");
    h.s.db.prepare('UPDATE "user" SET status = ? WHERE id = ?').run("suspended", uid);
    assert.equal((await bot(h, "/internal/v1/discord/prefs", { discord_user_id: id })).body.error, "account_suspended");
  } finally { await B.close(); }
});

test("médias enregistrés : ajout canonique sans doublon, plateforme déduite, recherche littérale, filtres, retrait, plafond, isolation", async () => {
  const B = await setup();
  try {
    const { h } = B;
    const a = await linked(B, "saved-a@example.test");
    const b = await linked(B, "saved-b@example.test");
    const add = (who: string, body: Record<string, unknown>) => bot(h, "/internal/v1/discord/saved/add", { discord_user_id: who, ...body });
    const r1 = await add(a.id, { url: "https://www.tiktok.com/@nasa/video/7391234567890123456?is_from_webapp=1", title: "Lancement ‮Artemis", creator: "NASA", duration_s: 42 });
    assert.equal(r1.status, 201, JSON.stringify(r1.body));
    assert.equal(r1.body.item.platform, "tiktok");
    assert.equal(r1.body.item.url, "https://www.tiktok.com/@nasa/video/7391234567890123456");
    assert.equal(r1.body.item.title, "Lancement Artemis", "titre nettoyé (aucun caractère de mise en forme)");
    const again = await add(a.id, { url: "https://www.tiktok.com/@nasa/video/7391234567890123456" });
    assert.equal(again.status, 200);
    assert.equal(again.body.created, false);
    assert.equal(again.body.item.id, r1.body.item.id, "même référence, pas de doublon");
    await add(a.id, { url: "https://youtu.be/dQw4w9WgXcQ", title: "100% coton_", media_type: "audio" });
    await add(a.id, { url: "https://x.com/NASA/status/1883228395842023524", title: "Décollage" });
    const list = (q: Record<string, unknown> = {}) => bot(h, "/internal/v1/discord/saved/list", { discord_user_id: a.id, ...q });
    assert.equal((await list()).body.total, 3);
    assert.equal((await list()).body.max, MAX_SAVED);
    assert.deepEqual((await list({ platform: "x" })).body.items.map((i: any) => i.title), ["Décollage"]);
    assert.deepEqual((await list({ type: "audio" })).body.items.map((i: any) => i.title), ["100% coton_"]);
    assert.deepEqual((await list({ q: "nasa" })).body.items.map((i: any) => i.creator), ["NASA"], "recherche dans l'auteur");
    assert.equal((await list({ q: "%" })).body.total, 1, "« % » cherché littéralement (pas de joker)");
    assert.equal((await list({ q: "_" })).body.total, 1, "« _ » cherché littéralement");
    // Liens refusés, champs inconnus refusés.
    for (const url of ["https://evil.com/x", "http://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/playlist?list=PL1"]) {
      const r = await add(a.id, { url });
      assert.ok(r.status === 400, `${url} → ${r.status}`);
    }
    assert.equal((await add(a.id, { url: "https://youtu.be/dQw4w9WgXcQ", platform: "youtube" })).status, 400, "la plateforme n'est jamais fournie par le bot");
    // YouTube Music : fermé le 2026-10-23, refus clair avec le code stable, rien d'enregistré.
    for (const url of ["https://music.youtube.com/watch?v=dQw4w9WgXcQ", "https://MUSIC.YOUTUBE.COM/watch?v=dQw4w9WgXcQ", "https://m.music.youtube.com/playlist?list=PL1"]) {
      const r = await add(a.id, { url });
      assert.deepEqual([r.status, r.body.error, r.body.message], [400, YOUTUBE_MUSIC_CODE, YOUTUBE_MUSIC_TEXT], url);
    }
    assert.equal((await list()).body.total, 3, "aucun lien YouTube Music enregistré");
    // Isolation : B ne voit ni ne retire les médias de A.
    assert.equal((await bot(h, "/internal/v1/discord/saved/list", { discord_user_id: b.id })).body.total, 0);
    assert.equal((await bot(h, "/internal/v1/discord/saved/get", { discord_user_id: b.id, id: r1.body.item.id })).status, 404);
    assert.equal((await bot(h, "/internal/v1/discord/saved/remove", { discord_user_id: b.id, id: r1.body.item.id })).body.removed, false);
    assert.equal((await bot(h, "/internal/v1/discord/saved/remove", { discord_user_id: a.id, id: r1.body.item.id })).body.removed, true);
    assert.equal((await list()).body.total, 2);
    // Plafond : MAX_SAVED références par compte.
    const db = h.s.db;
    const ins = db.prepare("INSERT INTO ytc_saved_media (id, user_id, platform, source_url, saved_at) VALUES (?, ?, 'x', ?, ?)");
    for (let i = 0; i < MAX_SAVED - 2; i++) ins.run(`plein${String(i).padStart(6, "0")}`, a.uid, `https://x.com/u/status/${1000000 + i}`, new Date().toISOString());
    const full = await add(a.id, { url: "https://x.com/u/status/999999999" });
    assert.equal(full.status, 429);
    assert.equal(full.body.error, "saved_limit");
    // « Tout effacer » : seulement la bibliothèque du compte lié qui le demande.
    await add(b.id, { url: "https://x.com/NASA/status/1883228395842023524" });
    const cleared = await bot(h, "/internal/v1/discord/saved/clear", { discord_user_id: a.id });
    assert.deepEqual([cleared.status, cleared.body.removed], [200, MAX_SAVED]);
    assert.equal((await list()).body.total, 0);
    assert.equal((await bot(h, "/internal/v1/discord/saved/list", { discord_user_id: b.id })).body.total, 1, "l'autre compte garde la sienne");
    assert.equal((await bot(h, "/internal/v1/discord/saved/clear", { discord_user_id: "1" })).status, 400);
  } finally { await B.close(); }
});

test("historique, déliaison depuis Discord (clés révoquées, liaison effacée), limite de lecture du compte", async () => {
  const B = await setup();
  try {
    const { h } = B;
    const { id, uid } = await linked(B, "hist@example.test");
    const now = new Date().toISOString();
    h.s.db.prepare("INSERT INTO ytc_usage (id, user_id, key_id, day, fmt, platform, state, created_at, updated_at) VALUES ('u1', ?, NULL, ?, 'mp4', 'tiktok', 'done', ?, ?)")
      .run(uid, now.slice(0, 10), now, now);
    const hist = await bot(h, "/internal/v1/discord/history", { discord_user_id: id, limit: 5 });
    assert.equal(hist.status, 200, JSON.stringify(hist.body));
    assert.equal(hist.body.items.length, 1);
    assert.equal(hist.body.items[0].fmt, "mp4");
    assert.ok(!JSON.stringify(hist.body).includes("http"), "jamais de lien dans l'historique");
    assert.equal((await bot(h, "/internal/v1/discord/history", { discord_user_id: id, limit: 99 })).status, 400);
    // Une clé de conversion en cours, puis déliaison depuis Discord.
    assert.equal((await bot(h, "/internal/v1/discord/session", { discord_user_id: id })).status, 201);
    const un = await bot(h, "/internal/v1/discord/unlink", { discord_user_id: id });
    assert.deepEqual(un.body, { unlinked: true });
    const keys = h.s.db.prepare("SELECT revoked_reason FROM ytc_key_meta WHERE user_id = ? AND kind = 'discord'").all(uid) as { revoked_reason: string }[];
    assert.ok(keys.length > 0 && keys.every((k) => k.revoked_reason === "unlink"), "clés « discord » révoquées (unlink)");
    assert.deepEqual((await bot(h, "/internal/v1/discord/resolve", { discord_user_id: id })).body, { linked: false });
    assert.deepEqual((await bot(h, "/internal/v1/discord/unlink", { discord_user_id: id })).body, { unlinked: false }, "idempotent");
    assert.ok(!h.logs.some((l) => l.includes(id)), "identifiant Discord jamais journalisé");
    // Lecture du compte : bornée par identifiant Discord (la page « Lier » interroge pendant l'autorisation).
    const other = did();
    let limited = 0;
    for (let i = 0; i < 605; i++) if ((await bot(h, "/internal/v1/discord/resolve", { discord_user_id: other })).status === 429) limited++;
    assert.equal(limited, 5);
  } finally { await B.close(); }
});

test("fichier pour pièce jointe : servi s'il tient dans la limite, 413 (taille connue) sinon, 410 si effacé ; clé éphémère révoquée", async () => {
  const B = await setup();
  try {
    const { h } = B;
    const { id, uid } = await linked(B, "file@example.test");
    h.ytapi.files.set("job-court", { userId: uid, body: "x".repeat(1000), type: "video/mp4", name: "Court [a].mp4" });
    const ok = await bot(h, "/internal/v1/discord/file", { discord_user_id: id, job_id: "job-court", max_bytes: 5000 });
    assert.equal(ok.status, 200);
    assert.equal(ok.body, "x".repeat(1000));
    assert.equal(ok.headers.get("content-length"), "1000");
    assert.equal(ok.headers.get("content-disposition"), 'attachment; filename="Court [a].mp4"');
    const big = await bot(h, "/internal/v1/discord/file", { discord_user_id: id, job_id: "job-court", max_bytes: 999 });
    assert.equal(big.status, 413);
    assert.deepEqual(big.body, { error: "too_large", size: 1000 });
    const gone = await bot(h, "/internal/v1/discord/file", { discord_user_id: id, job_id: "job-absent", max_bytes: 5000 });
    assert.equal(gone.status, 410);
    const keys = h.s.db.prepare("SELECT revoked_reason FROM ytc_key_meta WHERE user_id = ? AND kind = 'discord'").all(uid) as { revoked_reason: string | null }[];
    assert.ok(keys.length === 3 && keys.every((k) => k.revoked_reason === "released"), "chaque clé éphémère rendue");
    assert.equal((await bot(h, "/internal/v1/discord/file", { discord_user_id: id, job_id: "job-court", max_bytes: 0 })).status, 400);
    assert.equal((await bot(h, "/internal/v1/discord/file", { discord_user_id: did(), job_id: "job-court", max_bytes: 5000 })).body.error, "not_linked");
  } finally { await B.close(); }
});

test("réglages de serveur : défauts, modification validée, oubli ; purge après la durée de conservation", async () => {
  const B = await setup();
  try {
    const { h } = B;
    const gid = "112233445566778899";
    const g0 = await bot(h, "/internal/v1/discord/guild", { guild_id: gid });
    assert.deepEqual(g0.body, { settings: DEFAULT_GUILD, stored: false });
    const set = await bot(h, "/internal/v1/discord/guild/set", { guild_id: gid, settings: { autoEmbeds: true, platforms: ["tiktok"], original: "suppress" } });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.equal(set.body.settings.autoEmbeds, true);
    assert.equal((await bot(h, "/internal/v1/discord/guild", { guild_id: gid })).body.stored, true);
    assert.equal((await bot(h, "/internal/v1/discord/guild/set", { guild_id: gid, settings: { original: "delete" } })).status, 400, "suppression du message d'origine : jamais proposée");
    assert.equal((await bot(h, "/internal/v1/discord/guild/set", { guild_id: "pas-un-id", settings: {} })).status, 400);
    const stored = h.s.db.prepare("SELECT settings FROM ytc_discord_guild WHERE guild_id = ?").get(gid) as { settings: string };
    assert.ok(!/\d{17,20}/.test(stored.settings.replace(gid, "")), "aucun identifiant d'utilisateur stocké");
    assert.deepEqual((await bot(h, "/internal/v1/discord/guild/forget", { guild_id: gid })).body, { forgotten: true });
    await bot(h, "/internal/v1/discord/guild/set", { guild_id: gid, settings: { buttons: false } });
    const old = new Date(Date.now() - (GUILD_RETENTION_DAYS + 1) * 86_400_000).toISOString();
    h.s.db.prepare("UPDATE ytc_discord_guild SET updated_at = ? WHERE guild_id = ?").run(old, gid);
    assert.deepEqual(await h.s.library.purge(), { guilds: 1 });
  } finally { await B.close(); }
});

test("export du compte : préférences et médias enregistrés ; suppression du compte : tout effacé", async () => {
  const B = await setup();
  try {
    const { h } = B;
    const { u, id, uid } = await linked(B, "export@example.test");
    await bot(h, "/internal/v1/discord/prefs/set", { discord_user_id: id, quality: "720" });
    await bot(h, "/internal/v1/discord/saved/add", { discord_user_id: id, url: "https://youtu.be/dQw4w9WgXcQ", title: "Gardée" });
    const exp = await u.json("/api/account/export");
    assert.equal(exp.body.library.prefs.quality, "720");
    assert.deepEqual(exp.body.library.saved.map((s: any) => s.title), ["Gardée"]);
    assert.equal((await u.json("/api/auth/delete-user", { method: "POST", body: {} })).status, 200);
    for (const t of ["ytc_user_pref", "ytc_saved_media"]) {
      assert.equal(Number((h.s.db.prepare(`SELECT count(*) AS n FROM ${t} WHERE user_id = ?`).get(uid) as { n: number }).n), 0, `${t} effacée avec le compte`);
    }
  } finally { await B.close(); }
});

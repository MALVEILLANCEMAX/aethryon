// Intégration du bot v2 sur une pile JETABLE (scratchpad/dl/e2e-v2.sh), lancée dans un conteneur placé comme le bot de
// production : réseau interne vers account (API du bot, port 3002) et ytapi de PRÉPRODUCTION de la branche (faux worker
// pour les plateformes : aucune plateforme contactée ; vrai ffmpeg pour les extraits, la compression et les GIF ;
// MEDIA_TOOLS_ENABLED=true). Le VRAI routeur du bot (src/v2/router.ts) reçoit de fausses interactions Discord : seul
// Discord est simulé. PAS dans `npm test` (fichier sans « .test ») : il exige la pile.
//   node --test --test-concurrency=1 test/integration-pile.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AccountClient } from "../src/account.ts";
import { YtapiClient } from "../src/ytapi.ts";
import { ERROR_TEXT } from "../src/errors.ts";
import { createFlights } from "../src/live.ts";
import { createRateLimiter } from "../src/ratelimit.ts";
import type { V2Reply } from "../src/replies.ts";
import { createRouter } from "../src/v2/router.ts";
import type { Features } from "../src/v2/ui.ts";
import { ix, last, textOf } from "./fakes-v2.ts";

const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} manquant`); return v; };
const ACCOUNT = env("ACCOUNT_INTERNAL_URL");          // http://account-discord:3002 (réseau ytc2-x1-discord)
const YTAPI = env("YTAPI_URL");                       // http://ytc2-x1-ytapi:8000 (à la place de l'adresse publique)
const SITE = env("SITE_INTERNAL");                    // http://ytc2-x1-web:8080 (nginx du site)
const PUBLIC = env("PUBLIC_URL");                     // http://localhost:18110 (adresse publique vue par account)
const FAKE = env("FAKE_DISCORD");                     // http://discord-fake:8087
const TOKEN = readFileSync(env("DISCORD_INTERNAL_TOKEN_FILE"), "utf8").trim();
const COOKIE = readFileSync(env("COOKIE_FILE"), "utf8").trim();
const SEED = String(Date.now() % 100000).padStart(5, "0");
const TT = (n: number) => `https://www.tiktok.com/@e2e/video/7${SEED}${String(n).padStart(13, "0")}`;
const DID = `7${String(Date.now()).slice(-9)}00000042`;
const GUILD = "1300000000000000042";
const F: Features = { link: true, convert: true, files: true, library: true, guildConfig: true, autoEmbeds: false, preview: true, compress: true, clip: true, gif: true };

const account = new AccountClient(ACCOUNT, TOKEN);
const ytapi = new YtapiClient(YTAPI);
const logs: string[] = [];
const router = createRouter({
  brand: { site: PUBLIC, emoji: null }, features: F, account, ytapi,
  readStatus: async () => ({ site: "ok", conversion: "ok", maintenance: null, platforms: { youtube: true, tiktok: true, x: true }, quotas: { daily: 10, maxActive: 1 }, checkedAt: Date.now() }),
  flights: createFlights(), limiter: createRateLimiter(100, 30_000), uiLimiter: createRateLimiter(100, 30_000),
  log: (level, msg, data) => logs.push(JSON.stringify({ level, msg, ...data })),
  convert: { minEditMs: 300, pollWaitS: 5 },
});

async function site(path: string, init: { method?: string; body?: unknown } = {}) {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = { cookie: COOKIE };
  if (method !== "GET") { headers.origin = PUBLIC; headers["content-type"] = "application/json"; }
  const res = await fetch(`${SITE}${path}`, { method, headers, body: method === "GET" ? undefined : JSON.stringify(init.body ?? {}), redirect: "manual" });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body, location: res.headers.get("location") };
}

/** Une interaction de l'utilisateur lié (même profil Discord que la liaison : nom, nom d'affichage, image), sur un
 *  serveur de test (Discord simulé), puis attente du message final. */
const AVATAR = "0123456789abcdef0123456789abcdef";
const PROFILE = { username: "bot.integration", globalName: "Bot Intégration", avatar: AVATAR };
const as = (kind: Parameters<typeof ix>[0], o: Parameters<typeof ix>[1] = {}) => ix(kind, { userId: DID, guildId: GUILD, profile: PROFILE, ...o });
async function until(i: { calls: { m: string; r?: unknown }[] }, re: RegExp, ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (i.calls.some((c) => (c.m === "edit" || c.m === "reply" || c.m === "update") && re.test(textOf(c.r)))) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`attendu ${re} ; reçu ${textOf(last(i)?.r).slice(0, 300)}`);
}
const used = async () => (await site("/api/me")).body.today.used as number;
const file = (r: unknown) => (r as V2Reply).files?.[0] as { attachment: Buffer; name: string } | undefined;

async function linkByFakeDiscord() {
  const start = await site("/api/discord/link", { method: "POST" });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const auth = new URL(start.body.url);
  assert.equal(auth.searchParams.get("scope"), "identify");
  assert.ok(auth.searchParams.get("state"), "state OAuth présent");
  await fetch(`${FAKE}/__fake/next`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profile: { id: DID, username: "bot.integration" } }) });
  const consent = await fetch(`${FAKE}${auth.pathname}${auth.search}`, { redirect: "manual" });
  assert.equal(consent.status, 302);
  const back = new URL(consent.headers.get("location")!);
  const done = await site(back.pathname + back.search);
  assert.equal(done.status, 302);
  assert.equal(done.location, `${PUBLIC}/dashboard/discord?liaison=ok`);
}

let resultCard: V2Reply;
let resultJob = "";

test("liaison par le site et le faux Discord (state, code, /users/@me), puis /account status dans le bot", async () => {
  await linkByFakeDiscord();
  const st = await site("/api/discord");
  assert.deepEqual([st.body.enabled, st.body.linked, st.body.discord.name], [true, true, "bot.integration"]);
  const i = as("command", { commandName: "account", subcommand: "status" });
  await router.handle(i);
  const t = textOf(last(i, "edit").r);
  assert.match(t, /Ton compte AETHRYON/);
  assert.match(t, /@bot\.integration/);
  assert.match(t, /10 conversions restantes aujourd'hui \(0\/10\)/);
  assert.equal(last(i, "defer").eph, true, "réponse privée");
  // Profil Discord (migration 007) : le bot le transmet à account, l'espace l'affiche (image relayée par le site).
  const after = (await site("/api/discord")).body.discord;
  assert.deepEqual([after.name, after.displayName, after.avatarVersion], ["bot.integration", "Bot Intégration", AVATAR.slice(-8)]);
});

test("/preview : carte privée avec les données de ytapi (préproduction), aucune unité de quota", async () => {
  const i = as("command", { commandName: "preview", opts: { url: TT(1) } });
  await router.handle(i);
  await until(i, /APERÇU/);
  const t = textOf(last(i, "edit").r);
  assert.match(t, /Démonstration préproduction/);
  assert.equal(await used(), 0, "aucune unité de quota");
});

test("/convert : fichier JOINT (vrai MP4 servi par ytapi via account), quota et historique partagés avec le site", async () => {
  const i = as("command", { commandName: "convert", opts: { url: TT(2), format: "mp4" } });
  await router.handle(i);
  await until(i, /MÉDIA PRÊT/);
  resultCard = last(i, "edit").r as V2Reply;
  const f = file(resultCard);
  assert.ok(f, "pièce jointe");
  assert.equal(f!.attachment.subarray(4, 8).toString("latin1"), "ftyp", "un vrai MP4");
  assert.match(f!.name, /\.mp4$/);
  resultJob = /ae:share:\d+:([A-Za-z0-9_-]+)|ae:gifm:\d+:([A-Za-z0-9_-]+)/.exec(textOf(resultCard))!.slice(1).find(Boolean)!;
  assert.ok(resultJob, "identifiant du job sur la carte");
  for (const c of i.calls) assert.doesNotMatch(textOf(c.r), /ytc_[A-Za-z0-9]{20}/, "aucune clé dans Discord");
  assert.equal(await used(), 1);
  const act = await site("/api/activity");
  assert.deepEqual([act.body.items[0].state, act.body.items[0].fmt], ["done", "mp4"]);
  const h = as("command", { commandName: "history" });
  await router.handle(h);
  assert.match(textOf(last(h, "edit").r), /TikTok · MP4 · ✓ Terminée/);
});

test("« Compresser pour Discord » : fichier dérivé (vrai ffmpeg), aucune unité de quota", async () => {
  const c = as("button", { customId: `ae:cmp:${DID}:${resultJob}`, messageComponents: resultCard.components, messageEphemeral: true });
  await router.handle(c);
  await until(c, /MÉDIA PRÊT|ÉCHEC/);
  const t = textOf(last(c, "edit").r);
  assert.match(t, /MÉDIA PRÊT/, t.slice(0, 300));
  assert.match(t, /tenait déjà dans la taille demandée/, "l'échantillon est déjà léger : rendu tel quel, et c'est dit");
  assert.equal(await used(), 1);
});

test("/clip : extrait coupé par ffmpeg dans ytapi, une unité", async () => {
  const i = as("command", { commandName: "clip", opts: { url: TT(3), start: "0", end: "1", format: "mp4" } });
  await router.handle(i);
  await until(i, /MÉDIA PRÊT/);
  const f = file(last(i, "edit").r);
  assert.equal(f!.attachment.subarray(4, 8).toString("latin1"), "ftyp");
  assert.match(f!.name, /extrait/);
  assert.equal(await used(), 2);
});

test("/gif : conversion MP4 (une unité) puis GIF tiré du fichier (vrai ffmpeg), joint", async () => {
  const i = as("command", { commandName: "gif", opts: { url: TT(4), start: "0", duration: 1 } });
  await router.handle(i);
  await until(i, /MÉDIA PRÊT/, 90_000);
  const f = file(last(i, "edit").r);
  assert.equal(f!.attachment.subarray(0, 4).toString("latin1"), "GIF8", "un vrai GIF");
  assert.match(f!.name, /\.gif$/);
  assert.equal(await used(), 3, "le GIF compte une seule unité (la conversion MP4)");
});

test("« Faire un GIF… » depuis le résultat MP4 : modale puis GIF dérivé, aucune unité", async () => {
  const open = as("button", { customId: `ae:gifm:${DID}:${resultJob}`, messageComponents: resultCard.components, messageEphemeral: true });
  await router.handle(open);
  const modal = last(open, "showModal").r as unknown as { custom_id: string };
  assert.equal(modal.custom_id, `ae:gif:${DID}:${resultJob}`);
  const sent = as("modal", { customId: modal.custom_id, fields: { start: "0", duration: "1" }, messageComponents: resultCard.components, messageEphemeral: true });
  await router.handle(sent);
  await until(sent, /MÉDIA PRÊT/);
  assert.equal(file(last(sent, "edit").r)!.attachment.subarray(0, 4).toString("latin1"), "GIF8");
  assert.equal(await used(), 3);
});

test("bibliothèque : enregistrer depuis une carte, /saved, retirer (base du compte, migration 006)", async () => {
  const s = as("button", { customId: `ae:save:${DID}`, messageComponents: resultCard.components });
  await router.handle(s);
  await until(s, /Enregistré/);
  const l = as("command", { commandName: "saved" });
  await router.handle(l);
  const t = textOf(last(l, "edit").r);
  assert.match(t, /Tes médias enregistrés/);
  assert.match(t, /1\/200/);
  const id = /"value":"([A-Za-z0-9_-]{8,32})"/.exec(t)![1]!;
  const rm = as("button", { customId: `ae:saved:rm:${DID}:${id}` });
  await router.handle(rm);
  assert.match(textOf(last(rm, "update").r), /Retiré/);
  assert.equal((await account.savedList(DID, {})).total, 0);
});

test("/config : réglage enregistré pour le serveur (permission « Gérer le serveur » exigée)", async () => {
  const no = as("command", { commandName: "config" });
  await router.handle(no);
  assert.match(textOf(last(no, "reply").r), /Permission requise/);
  const open = as("command", { commandName: "config", canManageGuild: true });
  await router.handle(open);
  assert.match(textOf(last(open, "edit").r), /Réglages du serveur/);
  // Partage permis par défaut (docs/DISCORD-BOT.md §19) : le bouton l'interdit, « Réinitialiser » le permet de nouveau.
  const share = as("button", { customId: "ae:cfg:share", canManageGuild: true });
  await router.handle(share);
  assert.equal((await account.guild(GUILD)).settings.share, false);
  const reset = as("button", { customId: "ae:cfg:reset", canManageGuild: true });
  await router.handle(reset);
  assert.equal((await account.guild(GUILD)).settings.share, true);
});

test("échec du catalogue (faux worker « fail-test » → private) : texte de docs/ERREURS.md, échec NON décompté du quota", async () => {
  const i = as("command", { commandName: "convert", opts: { url: "https://www.tiktok.com/@fail-test/video/7000000000000000001", format: "mp3" } });
  await router.handle(i);
  await until(i, /ÉCHEC/);
  assert.match(textOf(last(i, "edit").r), new RegExp(ERROR_TEXT.private!));
  assert.equal(await used(), 3, "un échec ne compte pas (docs/DEPLOIEMENT.md §20)");
});

test("compte Discord non lié : invitation à lier, aucune conversion", async () => {
  const i = ix("command", { userId: "700000000000000099", guildId: GUILD, commandName: "convert", opts: { url: TT(5) } });
  await router.handle(i);
  await until(i, /Compte non lié/);
  assert.equal(await used(), 3);
});

test("isolement : le secret du bot n'ouvre pas l'API interne de ytapi (port 3001) ; faux secret refusé sur 3002", async () => {
  const internal = new URL(ACCOUNT); internal.port = "3001";
  const r = await fetch(`${internal.origin}/internal/v1/authorize`, { method: "POST", headers: { "content-type": "application/json", "x-internal-token": TOKEN }, body: "{}" });
  assert.equal(r.status, 403, "réseau du bot refusé sur l'API de ytapi");
  const bad = await fetch(`${ACCOUNT}/internal/v1/discord/resolve`, { method: "POST", headers: { "content-type": "application/json", "x-bot-token": "faux" }, body: JSON.stringify({ discord_user_id: DID }) });
  assert.equal(bad.status, 401);
});

test("déliaison DEPUIS DISCORD (confirmation), puis nouvelle liaison et déliaison par le SITE", async () => {
  const yes = as("button", { customId: "ae:acct:unlink-yes" });
  await router.handle(yes);
  assert.match(textOf(last(yes, "edit").r), /Compte délié/);
  assert.deepEqual(await account.resolve(DID), { linked: false });
  assert.equal((await site("/api/discord")).body.linked, false, "le site le voit aussi");
  await assert.rejects(account.session(DID), (e: { code?: string }) => e.code === "not_linked");
  await linkByFakeDiscord();
  assert.equal((await account.resolve(DID)).linked, true);
  assert.equal((await site("/api/discord/unlink", { method: "POST" })).status, 204);
  assert.deepEqual(await account.resolve(DID), { linked: false });
});

test("journaux du bot : ni lien, ni titre, ni identifiant Discord, ni clé", () => {
  const all = logs.join("\n");
  assert.ok(logs.length > 10);
  assert.doesNotMatch(all, /tiktok\.com|Démonstration|ytc_|jeton=/);
  assert.ok(!all.includes(DID));
});

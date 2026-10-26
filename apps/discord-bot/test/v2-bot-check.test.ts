// Panne du 2026-10-13 00:05 (heure de Paris) : YouTube impose au serveur une vérification anti-robot (« Sign in to confirm
// you're not a bot ») ; le bot affichait un texte vague, sans heure de reprise ni bouton pour réessayer. Ces tests
// verrouillent la carte précise (cause, plateforme, ce qui n'est pas en cause, quota, heure de reprise), le bouton
// « Réessayer » et le journal de diagnostic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { errorCard, type Features } from "../src/v2/ui.ts";
import { YtapiClient, YtapiError } from "../src/ytapi.ts";
import { ALL, bench, fakeYtapi, ix, last, settle, SITE, textOf } from "./fakes-v2.ts";

const F: Features = { ...ALL };
const b = { site: SITE, emoji: null };
const YT = "https://www.youtube.com/watch?v=zmW8hgV39IU";
const NOW = Date.UTC(2026, 9, 12, 22, 5, 30);
const ended = async (i: { calls: { m: string; r?: unknown }[] }) => {
  for (let k = 0; k < 60 && !i.calls.some((c) => c.m === "edit" && /ÉCHEC|MÉDIA PRÊT/.test(textOf(c.r))); k++) await settle();
  await settle(); // journal « conversion » et fin du vol, écrits juste après la dernière carte
};

test("carte bot_check YouTube : cause précise, rien n'est reproché à l'utilisateur, heure de reprise, bouton Réessayer", () => {
  const card = textOf(errorCard(b, "bot_check", { url: YT, platform: "youtube" }, "1", "mp4", 840, NOW));
  assert.match(card, /YouTube indisponible pour le moment/);
  assert.match(card, /YouTube impose au serveur AETHRYON une vérification anti-robot/);
  assert.match(card, /Ni ta vidéo ni ton compte ne sont en cause/);
  assert.match(card, /pas décompté de ton quota/);
  assert.match(card, /TikTok et X ne sont pas concernés/);
  const at = Math.ceil((NOW + 840_000) / 1000);
  assert.ok(card.includes(`<t:${at}:t>`) && card.includes(`<t:${at}:R>`), "heure locale de Discord + durée relative");
  assert.match(card, /"label":"Réessayer","custom_id":"ae:conv:1:mp4"/);
  assert.match(card, /Code.: bot_check/u);
  assert.ok(!/cookie/i.test(card), "aucune invitation à fournir des cookies ou un compte");
});

test("carte upstream_rate_limited sans délai connu : « réessaie plus tard », pas de mention TikTok/X hors YouTube", () => {
  const card = textOf(errorCard(b, "upstream_rate_limited", { url: "https://www.tiktok.com/@nasa/video/1", platform: "tiktok" }, "1", "mp3"));
  assert.match(card, /TikTok indisponible pour le moment/);
  assert.match(card, /TikTok limite pour le moment le nombre de demandes/);
  assert.match(card, /Réessaie un peu plus tard/);
  assert.ok(!card.includes("<t:") && !card.includes("ne sont pas concernés"));
  assert.match(card, /"label":"Réessayer"/);
});

test("les autres échecs gardent leur texte de docs/ERREURS.md ; un GIF n'a pas de bouton Réessayer", () => {
  const card = textOf(errorCard(b, "private", { url: YT, platform: "youtube" }, "1", "mp4"));
  assert.match(card, /Conversion impossible/);
  assert.match(card, /La vidéo est privée/);
  assert.ok(!card.includes("Réessayer"));
  assert.ok(!textOf(errorCard(b, "bot_check", { url: YT, platform: "youtube" }, "1", "gif", 60, NOW)).includes("Réessayer"));
});

test("client ytapi : retry_after_s d'un job en échec lu (borné), refus 503 + Retry-After conservé", async () => {
  const body = { job_id: "lztY0XJwDydJp448", status: "error", stage: "error", progress: 0, platform: "youtube", error: "bot_check", detail: "…", retry_after_s: 899 };
  let reply: { status: number; body: unknown; headers?: Record<string, string> } = { status: 503, body };
  const fetchFn = async () => ({ status: reply.status, headers: { get: (n: string) => reply.headers?.[n.toLowerCase()] ?? null }, text: async () => JSON.stringify(reply.body) });
  const y = new YtapiClient("https://api.example.test/media", fetchFn as never);
  const job = await y.job("k", "lztY0XJwDydJp448", 1);
  assert.deepEqual([job.status, job.error, job.retryAfterS], ["error", "bot_check", 899]);
  reply = { status: 503, body: { ...body, retry_after_s: 10 ** 9 } };
  assert.equal((await y.job("k", "lztY0XJwDydJp448", 1)).retryAfterS, 86_400);
  reply = { status: 503, body: { error: "bot_check", detail: "…" }, headers: { "retry-after": "612" } };
  await assert.rejects(y.createJob("k", YT, "mp4"), (e: unknown) => e instanceof YtapiError && e.code === "bot_check" && e.retryAfterS === 612);
});

test("/convert pendant la pause YouTube (refus immédiat de ytapi) : carte précise, clé rendue, journal avec plateforme et délai", async () => {
  const y = fakeYtapi();
  y.api.createJob = async (_k: string, url: string) => { y.calls.push({ url, params: "mp4" }); throw new YtapiError("bot_check", 503, 612); };
  const B = bench(F, y);
  const i = ix("command", { commandName: "convert", opts: { url: YT, format: "mp4" } });
  await B.router.handle(i);
  await ended(i);
  const card = textOf(last(i, "edit").r);
  assert.match(card, /YouTube indisponible pour le moment/);
  assert.match(card, /<t:\d+:t>/);
  assert.match(card, /"label":"Réessayer"/);
  const log = B.logs.find((l) => l.includes('"msg":"conversion"'));
  assert.ok(log, B.logs.join("\n"));
  assert.match(log!, /"resultat":"error","code":"bot_check"/);
  assert.match(log!, /"plateforme":"youtube","reprise_s":612/);
  assert.ok(!log!.includes("zmW8hgV39IU") && !log!.includes("youtube.com"), "jamais le lien dans le journal");
  assert.equal(B.acc.state.released, B.acc.state.sessions, "la clé de 15 min est rendue aussitôt");
});

test("job YouTube en échec bot_check pendant le suivi : délai de ytapi repris dans la carte ; Réessayer relance une conversion", async () => {
  const y = fakeYtapi({ error: "bot_check" });
  const poll = y.api.job.bind(y.api);
  y.api.job = async (k: string, id: string) => {
    const j = await poll(k, id);
    return j.status === "error" ? { ...j, platform: "youtube", retryAfterS: 899 } : j;
  };
  const B = bench(F, y);
  const i = ix("command", { commandName: "convert", opts: { url: YT, format: "mp4" } });
  await B.router.handle(i);
  await ended(i);
  const card = textOf(last(i, "edit").r);
  assert.match(card, /YouTube impose au serveur AETHRYON une vérification anti-robot/);
  const m = /"label":"Réessayer","custom_id":"(ae:conv:[^"]+)"/.exec(card);
  assert.ok(m, card);
  assert.ok(B.logs.some((l) => l.includes('"reprise_s":899')), B.logs.join("\n"));
  // Réessayer (après la pause) : une nouvelle conversion part vers ytapi, avec le même lien.
  y.api.job = poll;
  const before = y.calls.length;
  const again = ix("component", { customId: m![1], messageComponents: (last(i, "edit").r as { components: unknown[] }).components });
  await B.router.handle(again);
  for (let k = 0; k < 60 && y.calls.length === before; k++) await settle();
  assert.equal(y.calls.length, before + 1);
  assert.equal(y.calls.at(-1)!.url, YT);
});

test("/status : pause YouTube annoncée avec sa cause et l'heure de reprise ; pauses illisibles ou finies ignorées", async () => {
  const { parsePauses } = await import("../src/status.ts");
  const now = Date.UTC(2026, 9, 12, 22, 10, 0);
  const until = "2026-10-12T22:20:13.000Z";
  assert.deepEqual(parsePauses([{ platform: "youtube", reason: "bot_check", until }], now), [{ platform: "youtube", reason: "bot_check", until: Date.parse(until) }]);
  assert.deepEqual(parsePauses([{ platform: "twitter", reason: "autre", until }], now), [{ platform: "x", reason: "upstream_rate_limited", until: Date.parse(until) }]);
  assert.deepEqual(parsePauses([{ platform: "youtube", reason: "bot_check", until: "2026-10-12T22:00:00Z" }, { platform: "vimeo", until }, "x", null], now), []);
  assert.deepEqual(parsePauses({ platform: "youtube" }, now), []);
  assert.deepEqual(parsePauses([{ platform: "youtube", reason: "bot_check", until: "2026-10-20T00:00:00Z" }], now), [], "au-delà de 24 h : ignoré");

  const B = bench(F);
  const at = B.deps.now!() + 600_000;
  B.deps.readStatus = async () => ({ site: "ok", conversion: "ok", maintenance: null, platforms: { youtube: true, tiktok: true, x: true }, quotas: { daily: 10, maxActive: 1 },
    pauses: [{ platform: "youtube", reason: "bot_check", until: at }], checkedAt: B.deps.now!() });
  const i = ix("command", { commandName: "status" });
  await B.router.handle(i);
  const card = textOf(last(i, "edit").r);
  assert.match(card, /YouTube : en pause\*\* \(la plateforme impose au serveur une vérification anti-robot\)/);
  assert.ok(card.includes(`<t:${Math.ceil(at / 1000)}:t>`), card);
  assert.match(card, /Conversions : opérationnel/);
});

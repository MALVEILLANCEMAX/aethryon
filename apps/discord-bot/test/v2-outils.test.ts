// Bot v2, outils (docs/DISCORD-BOT.md §18) : aperçu privé, compression pour Discord, extraits, GIF, modales. Faux account,
// faux ytapi, fausses interactions : la logique est prouvée ici ; les encodages réels le sont dans ytapi
// (tests/test_media_tools_ffmpeg.py, vrai ffmpeg) et le rendu dans Discord sur le serveur de test.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { V2Reply } from "../src/replies.ts";
import { createAuto, type AutoMessage } from "../src/v2/auto.ts";
import { commandsV2 } from "../src/v2/commands.ts";
import { clipProblem, createRouter, fitFor, gifProblem, parseTime } from "../src/v2/router.ts";
import { createRateLimiter } from "../src/ratelimit.ts";
import { sourceOf, type Features } from "../src/v2/ui.ts";
import { YtapiClient, YtapiError } from "../src/ytapi.ts";
import { ALL, bench, fakeYtapi, GUILD, ix, last, MB, ME, OTHER, PREVIEW, settle, SITE, textOf, TIKTOK } from "./fakes-v2.ts";

const TOOLS: Features = { ...ALL, preview: true, compress: true, clip: true, gif: true };
const done = async (i: { calls: { m: string; r?: unknown }[] }, what = "MÉDIA PRÊT") => {
  for (let k = 0; k < 40 && !i.calls.some((c) => c.m === "edit" && textOf(c.r).includes(what)); k++) await settle();
};
const card = (url: string, owner = ME) => [{ type: 17, components: [{ type: 1, components: [{ type: 2, style: 5, label: "Source", url }, { type: 2, style: 1, label: "MP4", custom_id: `ae:conv:${owner}:mp4` }] }] }];

test("temps saisis : secondes, minutes:secondes, heures ; extraits et GIF validés avant tout appel", () => {
  assert.deepEqual(["75", "75,5", "1:15", "01:02:03", "0:15.25", " 9 "].map(parseTime), [75, 75.5, 75, 3723, 15.25, 9]);
  for (const bad of ["", "abc", "1:75", "-3", "1:2:3:4", "99:00:00", "1e3", null]) assert.equal(parseTime(bad), null, String(bad));
  assert.equal(clipProblem("mp4", 10, 40), null);
  assert.match(clipProblem("mp4", 40, 10)!, /après son début/);
  assert.match(clipProblem("mp4", 0, 181)!, /3 minutes/);
  assert.equal(clipProblem("mp3", 0, 600), null, "10 minutes de son");
  assert.match(clipProblem("mp4", null, 10)!, /illisible/);
  assert.equal(gifProblem(0, 5), null);
  assert.match(gifProblem(0, 31)!, /1 à 30/);
  assert.match(gifProblem(null, 5)!, /illisible/);
  assert.equal(fitFor(10 * MB), Math.floor(10 * MB * 0.95));
});

test("client ytapi : extrait (start_s/end_s), dérivés (compress, gif), aperçu en liste blanche, route absente → tools_unavailable", async () => {
  const calls: { url: string; body: unknown; auth: string }[] = [];
  let answer: { status: number; body: unknown } = { status: 202, body: { job_id: "j1", status: "queued" } };
  const fetchFn = async (url: string, init: { headers: Record<string, string>; body?: string }) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null, auth: init.headers.authorization! });
    return { status: answer.status, headers: { get: () => null }, text: async () => JSON.stringify(answer.body) };
  };
  const y = new YtapiClient("https://api.example.test/media", fetchFn as never);
  await y.createJob("ytc_k", TIKTOK, { fmt: "mp4", quality: "720", start: 15, end: 45.5 });
  assert.deepEqual(calls[0]!.body, { url: TIKTOK, fmt: "mp4", quality: "720", start_s: 15, end_s: 45.5 });
  await y.derive("ytc_k", "j1", { op: "compress", maxBytes: 9_961_472.7 });
  assert.equal(calls[1]!.url, "https://api.example.test/media/jobs/j1/derive");
  assert.deepEqual(calls[1]!.body, { op: "compress", max_bytes: 9_961_472 });
  await y.derive("ytc_k", "j1", { op: "gif", start: 3, duration: 5, maxBytes: 2 * MB, width: 480, fps: 15 });
  assert.deepEqual(calls[2]!.body, { op: "gif", start_s: 3, duration_s: 5, max_bytes: 2 * MB, gif_width: 480, gif_fps: 15 });
  await assert.rejects(y.derive("ytc_k", "../x", { op: "compress", maxBytes: MB }), (e: unknown) => e instanceof YtapiError && e.code === "bad_job");
  answer = { status: 200, body: { platform: "tiktok", title: "T", uploader: "nasa", duration: 24, thumbnail: "http://insecure/t.jpg", is_gif: false,
    audio: "yes", qualities: [{ quality: 720, est_size_bytes: 9000, h264: true }], est_size_bytes: { mp3_192: 600 }, media_count: 1, url_stream: "https://cdn/secret" } };
  const p = await y.preview("ytc_k", TIKTOK);
  assert.deepEqual(calls[3]!.body, { url: TIKTOK }, "le lien voyage dans le corps, jamais dans l'URL");
  assert.equal(calls[3]!.auth, "Bearer ytc_k");
  assert.equal(p.thumbnail, null, "miniature https seulement");
  assert.deepEqual([p.title, p.uploader, p.durationS, p.mp3Bytes[192], p.qualities[0]!.estSizeBytes], ["T", "nasa", 24, 600, 9000]);
  assert.ok(!JSON.stringify(p).includes("secret"), "champ inconnu ignoré");
  assert.equal(p.audioAvailable, true);
  answer = { status: 200, body: { platform: "twitter", audio: "unknown", media_count: 1 } };
  assert.equal((await y.preview("ytc_k", TIKTOK)).audioAvailable, null, "son inconnu (post X) : jamais « pas de son »");
  answer = { status: 404, body: { error: "not_found", detail: "Route inconnue." } };
  await assert.rejects(y.preview("ytc_k", TIKTOK), (e: unknown) => e instanceof YtapiError && e.code === "tools_unavailable");
  await assert.rejects(y.derive("ytc_k", "j1", { op: "compress", maxBytes: MB }), (e: unknown) => e instanceof YtapiError && e.code === "tools_unavailable");
  answer = { status: 404, body: { error: "not_found", detail: "Vidéo supprimée ou inaccessible." } };
  await assert.rejects(y.preview("ytc_k", TIKTOK), (e: unknown) => e instanceof YtapiError && e.code === "not_found", "une vraie vidéo introuvable reste « not_found »");
});

test("/preview : carte privée avec les données réelles (titre neutralisé, durée, tailles ≈), clé rendue, aucun job ni quota", async () => {
  const B = bench(TOOLS);
  const i = ix("command", { commandName: "preview", opts: { url: TIKTOK }, attachmentSizeLimit: 10 * MB });
  await B.router.handle(i);
  assert.deepEqual(i.calls[0], { m: "defer", eph: true });
  const t = textOf(last(i, "edit").r);
  assert.match(t, /APERÇU/);
  assert.doesNotMatch(t, /@everyone \*\*/, "titre de la plateforme neutralisé");
  assert.match(t, /@nasa/);
  assert.match(t, /00:24/);
  assert.match(t, /MP4\u00a0≈\u00a025\u00a0Mo/);
  assert.match(t, /au-delà de la limite d'envoi ici/, "la limite réelle de la conversation est comparée");
  assert.match(t, /MP3\u00a0≈\u00a0586\u00a0Ko/);
  assert.match(t, /"type":12,"items":\[\{"media":\{"url":"https:\/\/p16\.tiktokcdn\.example\/t\.jpg"\}/, "grande miniature d'abord");
  assert.match(t, /ae:conv:112233445566778899:mp4/);
  assert.match(t, /ae:clipm:112233445566778899/);
  assert.doesNotMatch(t, /quota/, "carte courte : rien sur le quota");
  assert.equal(sourceOf((last(i, "edit").r as V2Reply).components), TIKTOK);
  assert.deepEqual(B.y.previews, [TIKTOK]);
  assert.equal(B.y.calls.length, 0, "aucune conversion");
  assert.equal(B.acc.state.released, B.acc.state.sessions, "chaque clé demandée est rendue");
  assert.doesNotMatch(B.logs.join("\n"), /tiktok\.com|Artemis|112233445566778899|ytc_k/);
  // Le titre réel sert ensuite aux autres cartes (enregistrement, résultat).
  assert.equal(B.router.metas.get(TIKTOK)?.title, PREVIEW.title);
});

test("aperçu : YouTube Music (fermé le 2026-10-23) refusé avec le texte de docs/ERREURS.md, aucun appel à ytapi ; un lien classique garde son aperçu", async () => {
  const B = bench(TOOLS, fakeYtapi());
  for (const url of ["https://music.youtube.com/watch?v=dQw4w9WgXcQ", "https://MUSIC.YOUTUBE.COM/watch?v=dQw4w9WgXcQ", "https://m.music.youtube.com/watch?v=dQw4w9WgXcQ"]) {
    const i = ix("command", { commandName: "preview", opts: { url } });
    await B.router.handle(i);
    const t = textOf(last(i, "reply").r);
    assert.ok(t.includes("Les liens YouTube Music ne sont pas acceptés : AETHRYON ne télécharge pas le catalogue musical commercial."), url);
    assert.ok(t.includes("APERÇU") && !t.includes("Lien non pris en charge"), url);
  }
  assert.equal(B.y.previews.length, 0, "aucun aperçu demandé à ytapi");
  const ok = ix("command", { commandName: "preview", opts: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } });
  await B.router.handle(ok);
  assert.equal(B.y.previews.length, 1, "le lien classique est prévisualisé comme avant");
});

test("aperçu : son inconnu (post X) → MP3 proposé sans taille inventée", async () => {
  const B = bench(TOOLS, fakeYtapi({ preview: { ...PREVIEW, platform: "twitter", audioAvailable: null, mp3Bytes: {} } }));
  const i = ix("command", { commandName: "preview", opts: { url: TIKTOK } });
  await B.router.handle(i);
  const t = textOf(last(i, "edit").r);
  assert.match(t, /ae:conv:112233445566778899:mp3/);
  assert.doesNotMatch(t, /MP3\u00a0≈/, "aucune taille inventée");
  assert.doesNotMatch(t, /MP3 impossible/);
});

test("aperçu : GIF muet → pas de MP3 ; direct → aucun bouton de conversion ; non lié → invitation ; fonction fermée → message clair", async () => {
  const gif = bench(TOOLS, fakeYtapi({ preview: { ...PREVIEW, isGif: true, audioAvailable: false } }));
  const a = ix("command", { commandName: "preview", opts: { url: TIKTOK } });
  await gif.router.handle(a);
  const ta = textOf(last(a, "edit").r);
  assert.doesNotMatch(ta, /ae:conv:\d+:mp3/);
  assert.match(ta, /MP3 impossible \(vidéo muette\)/);
  const live = bench(TOOLS, fakeYtapi({ preview: { ...PREVIEW, live: true } }));
  const b = ix("command", { commandName: "preview", opts: { url: TIKTOK } });
  await live.router.handle(b);
  assert.doesNotMatch(textOf(last(b, "edit").r), /ae:conv:/);
  assert.match(textOf(last(b, "edit").r), /Direct ou première/);
  const nl = bench(TOOLS);
  nl.acc.state.linked.delete(ME);
  const c = ix("command", { commandName: "preview", opts: { url: TIKTOK } });
  await nl.router.handle(c);
  assert.match(textOf(last(c, "edit").r), /Compte non lié/);
  assert.equal(nl.y.previews.length, 0);
  const off = bench(ALL);
  const d = ix("button", { customId: `ae:prev:${ME}`, messageComponents: card(TIKTOK) });
  await off.router.handle(d);
  assert.match(textOf(last(d, "reply").r), /Pas encore ouvert/);
});

test("menu Applications : lié → aperçu réel ; non lié → carte de choix avec l'aperçu natif de Discord ; aperçu en échec → carte de choix et raison", async () => {
  const target = { content: `regarde ${TIKTOK}`, urls: [], authorId: OTHER, embeds: [{ url: TIKTOK, title: "Titre vu par Discord", author: "NASA", thumbnail: "https://media.discordapp.example/t.jpg" }] };
  const B = bench(TOOLS);
  const i = ix("messageMenu", { commandName: "Convert with AETHRYON", target });
  await B.router.handle(i);
  assert.match(textOf(last(i, "edit").r), /APERÇU/);
  const N = bench(TOOLS);
  N.acc.state.linked.delete(ME);
  const j = ix("messageMenu", { commandName: "Convert with AETHRYON", target });
  await N.router.handle(j);
  const tj = textOf(last(j, "edit").r);
  assert.match(tj, /Titre vu par Discord/);
  assert.match(tj, /@NASA/);
  assert.match(tj, /Lie ton compte AETHRYON pour voir l'aperçu/);
  assert.match(tj, /ae:conv:112233445566778899:mp4/, "on peut quand même choisir un format");
  assert.equal(N.y.previews.length, 0, "aucune requête pour un compte non lié");
  const F = bench(TOOLS, fakeYtapi({ preview: "bot_check" }));
  const k = ix("messageMenu", { commandName: "Convert with AETHRYON", target });
  await F.router.handle(k);
  const tk = textOf(last(k, "edit").r);
  assert.match(tk, /Aperçu indisponible\u00a0: Plateforme temporairement indisponible/);
  assert.match(tk, /ae:conv:112233445566778899:mp4/);
  assert.equal(F.acc.state.released, F.acc.state.sessions);
});

test("« Compresser pour Discord » : fichier dérivé du job (aucune conversion ni quota), taille visée sous la limite, réduction signalée, nouveau message", async () => {
  const B = bench(TOOLS, fakeYtapi({ size: 30 * MB, deriveSize: 9 * MB }));
  const i = ix("command", { commandName: "convert", opts: { url: TIKTOK }, attachmentSizeLimit: 10 * MB });
  await B.router.handle(i);
  await done(i);
  const result = last(i, "edit").r as V2Reply;
  const tr = textOf(result);
  assert.match(tr, /ae:cmp:112233445566778899:job-1/);
  assert.match(tr, /Trop lourd pour Discord ici \(30\u00a0Mo\)/);
  assert.match(tr, /"label":"Compresser pour Discord"/);
  B.acc.state.files.set("job-2", { bytes: Buffer.alloc(9 * MB, 2), name: "Lancement (compressé) [abc].mp4", type: "video/mp4" });
  const c = ix("button", { customId: "ae:cmp:112233445566778899:job-1", messageComponents: result.components, messageEphemeral: true, attachmentSizeLimit: 10 * MB });
  await B.router.handle(c);
  assert.deepEqual(c.calls[0], { m: "defer", eph: true }, "nouveau message privé : le lien « Télécharger » du résultat reste");
  await done(c);
  assert.equal(B.y.calls.length, 1, "aucune nouvelle conversion");
  assert.deepEqual(B.y.derives, [{ from: "job-1", p: { op: "compress", maxBytes: fitFor(10 * MB) } }]);
  const out = last(c, "edit").r as V2Reply;
  assert.equal(out.files?.[0]?.attachment.length, 9 * MB);
  assert.match(out.files![0]!.name, /\.mp4$/);
  const to = textOf(out);
  assert.match(to, /Image réduite à 540p/, "la perte de qualité est dite");
  assert.doesNotMatch(to, /ae:cmp:|ae:gifm:/, "pas de nouveau dérivé à partir d'un dérivé");
  // Le bouton d'un autre ne sert à personne.
  const o = ix("button", { customId: "ae:cmp:112233445566778899:job-1", userId: OTHER, messageComponents: result.components });
  await B.router.handle(o);
  assert.match(textOf(last(o, "reply").r), /n'est pas pour toi/);
});

test("compression impossible (cannot_fit) : message clair, le résultat d'origine reste téléchargeable", async () => {
  const B = bench(TOOLS, fakeYtapi({ size: 30 * MB, deriveError: "cannot_fit" }));
  const i = ix("command", { commandName: "convert", opts: { url: TIKTOK }, attachmentSizeLimit: 10 * MB });
  await B.router.handle(i);
  await done(i);
  const result = last(i, "edit").r as V2Reply;
  const c = ix("button", { customId: "ae:cmp:112233445566778899:job-1", messageComponents: result.components, messageEphemeral: true, attachmentSizeLimit: 10 * MB });
  await B.router.handle(c);
  await done(c, "ÉCHEC");
  assert.match(textOf(last(c, "edit").r), /Impossible de faire tenir ce média dans la taille demandée/);
  assert.ok(!i.calls.slice(i.calls.indexOf(i.calls.find((x) => x.r === result)!) + 1).some((x) => x.m === "edit"), "la carte du résultat n'est pas touchée");
});

test("/clip : extrait transmis à ytapi (une conversion), nom et durée de l'extrait ; temps invalides refusés sans job", async () => {
  const B = bench(TOOLS);
  B.acc.state.files.set("job-1", { bytes: Buffer.alloc(MB, 1), name: "Lancement (extrait 15s-45s) [abc].mp4", type: "video/mp4" });
  const i = ix("command", { commandName: "clip", opts: { url: TIKTOK, start: "0:15", end: "45" } });
  await B.router.handle(i);
  await done(i);
  assert.deepEqual(B.y.calls[0]!.params, { fmt: "mp4", quality: null, start: 15, end: 45 });
  assert.match(textOf(last(i, "edit").r), /extrait 00:15–00:45/);
  for (const [start, end, why] of [["1:00", "0:30", /après son début/], ["0", "4:00", /3 minutes/], ["x", "10", /illisible/]] as const) {
    const C = bench(TOOLS);
    const j = ix("command", { commandName: "clip", opts: { url: TIKTOK, start, end } });
    await C.router.handle(j);
    assert.match(textOf(last(j, "reply").r), why);
    assert.equal(C.y.calls.length, 0);
  }
  const mp3 = bench(TOOLS);
  const k = ix("command", { commandName: "clip", opts: { url: TIKTOK, start: "0", end: "9:00", format: "mp3" } });
  await mp3.router.handle(k);
  await done(k, "MÉDIA PRÊT");
  assert.deepEqual(mp3.y.calls[0]!.params, { fmt: "mp3", quality: null, start: 0, end: 540 });
});

test("/gif : conversion MP4 720p (une unité) puis GIF tiré de son fichier, joint en .gif ; durée hors limites refusée", async () => {
  const B = bench(TOOLS);
  B.acc.state.files.set("job-2", { bytes: Buffer.alloc(2 * MB, 3), name: "Lancement (GIF) [abc].gif", type: "image/gif" });
  const i = ix("command", { commandName: "gif", opts: { url: TIKTOK, start: "0:03", duration: 4 }, attachmentSizeLimit: 25 * MB });
  await B.router.handle(i);
  await done(i);
  assert.deepEqual(B.y.calls.map((c) => c.params), [{ fmt: "mp4", quality: "720" }]);
  assert.deepEqual(B.y.derives, [{ from: "job-1", p: { op: "gif", start: 3, duration: 4, maxBytes: fitFor(25 * MB), width: 480, fps: 15 } }]);
  const out = last(i, "edit").r as V2Reply;
  assert.equal(out.files?.[0]?.name, "Lancement_GIF_abc.gif");
  assert.match(textOf(out), /"type":12/, "GIF affiché dans une galerie");
  assert.match(textOf(out), /GIF/);
  assert.ok(i.calls.some((c) => c.m === "edit" && /Téléchargement/.test(textOf(c.r))), "étape 1 suivie");
  const C = bench(TOOLS);
  const j = ix("command", { commandName: "gif", opts: { url: TIKTOK, duration: 45 } });
  await C.router.handle(j);
  assert.match(textOf(last(j, "reply").r), /1 à 30 secondes/);
  assert.equal(C.y.calls.length, 0);
});

test("« Faire un GIF… » sur un résultat MP4 : modale, puis GIF dérivé du job sans nouvelle conversion ; « Extrait… » : modale puis extrait", async () => {
  const B = bench(TOOLS);
  B.acc.state.files.set("job-1", { bytes: Buffer.alloc(3 * MB, 1), name: "Lancement [abc].mp4", type: "video/mp4" });
  const i = ix("command", { commandName: "convert", opts: { url: TIKTOK } });
  await B.router.handle(i);
  await done(i);
  const result = last(i, "edit").r as V2Reply;
  assert.match(textOf(result), /ae:gifm:112233445566778899:job-1/);
  const open = ix("button", { customId: "ae:gifm:112233445566778899:job-1", messageComponents: result.components, messageEphemeral: true });
  await B.router.handle(open);
  const modal = last(open, "showModal").r as unknown as { custom_id: string; components: { type: number; component: { custom_id: string } }[] };
  assert.equal(modal.custom_id, "ae:gif:112233445566778899:job-1");
  assert.deepEqual(modal.components.map((c) => [c.type, c.component.custom_id]), [[18, "start"], [18, "duration"]]);
  B.acc.state.files.set("job-2", { bytes: Buffer.alloc(MB, 3), name: "Lancement (GIF) [abc].gif", type: "image/gif" });
  const sent = ix("modal", { customId: modal.custom_id, fields: { start: "0:02", duration: "3" }, messageComponents: result.components, messageEphemeral: true });
  await B.router.handle(sent);
  await done(sent);
  assert.equal(B.y.calls.length, 1, "aucune nouvelle conversion");
  assert.deepEqual(B.y.derives[0], { from: "job-1", p: { op: "gif", start: 2, duration: 3, maxBytes: fitFor(20 * MB), width: 480, fps: 15 } });
  // Extrait depuis une carte d'aperçu.
  const P = bench(TOOLS);
  const clipOpen = ix("button", { customId: `ae:clipm:${ME}`, messageComponents: card(TIKTOK), messageEphemeral: true });
  await P.router.handle(clipOpen);
  const cm = last(clipOpen, "showModal").r as unknown as { custom_id: string };
  assert.equal(cm.custom_id, `ae:clip:${ME}`);
  const clipSent = ix("modal", { customId: cm.custom_id, fields: { start: "5", end: "0:20", fmt: "mp3" }, messageComponents: card(TIKTOK) });
  await P.router.handle(clipSent);
  await done(clipSent);
  assert.deepEqual(P.y.calls[0]!.params, { fmt: "mp3", quality: null, start: 5, end: 20 });
  // La modale d'un autre n'est pas acceptée.
  const other = ix("modal", { customId: `ae:clip:${OTHER}`, fields: { start: "1", end: "2", fmt: "mp4" }, messageComponents: card(TIKTOK) });
  await P.router.handle(other);
  assert.match(textOf(last(other, "reply").r), /pas pour toi/);
});

test("commandes : /preview, /clip, /gif seulement avec leurs fonctions ; options bornées ; contextes en global", () => {
  assert.deepEqual(commandsV2(ALL, "guild").filter((c) => ["preview", "clip", "gif"].includes(c.name)), []);
  const g = commandsV2(TOOLS, "global");
  const by = (n: string) => g.find((c) => c.name === n)!;
  assert.deepEqual(by("clip").options!.map((o) => [o.name, !!o.required]), [["url", true], ["start", true], ["end", true], ["format", false]]);
  assert.deepEqual(by("gif").options!.map((o) => o.name), ["url", "start", "duration"]);
  assert.deepEqual([by("gif").options![2]!.min_value, by("gif").options![2]!.max_value], [1, 30]);
  for (const n of ["preview", "clip", "gif"]) {
    assert.deepEqual([by(n).integration_types, by(n).contexts], [[0, 1], [0, 1, 2]], n);
    assert.ok(by(n).description!.length <= 100 && by(n).description_localizations!.fr.length <= 100, n);
  }
  assert.ok(commandsV2(TOOLS, "global").length <= 25, "petit nombre de commandes");
});

test("carte automatique : titre, auteur et miniature de l'aperçu natif de Discord (aucune requête), boutons Extrait et GIF", async () => {
  const auto = createAuto({
    brand: { site: SITE, emoji: null }, features: { ...TOOLS, autoEmbeds: true }, log: () => undefined,
    guildSettings: async () => ({ autoEmbeds: true, platforms: ["youtube", "tiktok", "x"], channels: [], buttons: true, share: false, quality: "auto", perHour: 30, original: "keep", mode: "card" }),
  });
  const calls: unknown[] = [];
  const m: AutoMessage = {
    id: "m1", guildId: GUILD, channelId: "555555555555555555", content: TIKTOK, authorId: OTHER, authorIsBot: false, webhook: false, system: false, canManageMessages: false,
    embeds: [{ url: TIKTOK, title: "Décollage [vu par Discord]", author: "NASA", thumbnail: "https://media.discordapp.example/t.jpg" }],
    async reply(r) { calls.push(r); }, async react() { /* */ }, async suppressEmbeds() { /* */ },
  };
  assert.equal(await auto.onMessage(m), "card");
  const t = textOf(calls[0]);
  assert.match(t, /Décollage \\\\\[vu par Discord\\\\\]/, "titre neutralisé (Markdown échappé)");
  assert.match(t, /@NASA/);
  assert.match(t, /media\.discordapp\.example\/t\.jpg/);
  assert.match(t, /ae:clipm:\*/);
  assert.match(t, /ae:gifm:\*/);
});

test("bibliothèque : « Tout effacer… » demande confirmation, puis efface seulement la bibliothèque de la personne", async () => {
  const B = bench(TOOLS);
  await B.acc.api.savedAdd(ME, { url: TIKTOK, title: "Un" });
  await B.acc.api.savedAdd(ME, { url: "https://x.com/NASA/status/1883228395842023524", title: "Deux" });
  await B.acc.api.savedAdd(ME, { url: "https://youtu.be/dQw4w9WgXcQ", title: "Trois" });
  const l = ix("command", { commandName: "saved" });
  await B.router.handle(l);
  assert.match(textOf(last(l, "edit").r), /ae:saved:clear:112233445566778899/);
  const ask = ix("button", { customId: `ae:saved:clear:${ME}` });
  await B.router.handle(ask);
  assert.match(textOf(last(ask, "update").r), /Les 3 références de ta bibliothèque seront effacées définitivement/);
  assert.equal((B.acc.state.saved.get(ME) ?? []).length, 3, "rien d'effacé avant la confirmation");
  const other = ix("button", { customId: `ae:saved:clear-yes:${ME}`, userId: OTHER });
  await B.router.handle(other);
  assert.match(textOf(last(other, "reply").r), /n'est pas pour toi/);
  const yes = ix("button", { customId: `ae:saved:clear-yes:${ME}` });
  await B.router.handle(yes);
  assert.match(textOf(last(yes, "update").r), /3 références effacées définitivement/);
  assert.equal((B.acc.state.saved.get(ME) ?? []).length, 0);
});

test("déliaison : la carte dit où restent les médias enregistrés et comment les effacer (pas « sur le site »)", async () => {
  const B = bench(TOOLS);
  const c = ix("command", { commandName: "account", subcommand: "unlink" });
  await B.router.handle(c);
  const t = textOf(last(c, "reply").r);
  assert.match(t, /restent attachés à ton compte \(ils figurent dans l'export de tes données\)/);
  assert.match(t, /Tout effacer/);
});

test("limite par serveur : au-delà de N actions par minute dans un serveur, réponse claire ; les autres serveurs ne sont pas touchés", async () => {
  const B = bench(TOOLS);
  const router = createRouter({ ...B.deps, guildLimiter: createRateLimiter(2, 60_000) });
  for (const user of ["100000000000000001", "100000000000000002"]) {
    const i = ix("command", { commandName: "preview", opts: { url: TIKTOK }, userId: user });
    await router.handle(i);
    assert.doesNotMatch(textOf(last(i)?.r), /Serveur très sollicité/);
  }
  const third = ix("command", { commandName: "preview", opts: { url: TIKTOK }, userId: "100000000000000003" });
  await router.handle(third);
  assert.match(textOf(last(third, "reply").r), /Serveur très sollicité/);
  const elsewhere = ix("command", { commandName: "preview", opts: { url: TIKTOK }, userId: "100000000000000003", guildId: "999999999999999999" });
  await router.handle(elsewhere);
  assert.doesNotMatch(textOf(last(elsewhere)?.r), /Serveur très sollicité/);
  const help = ix("command", { commandName: "help", userId: "100000000000000004" });
  await router.handle(help);
  assert.match(textOf(last(help, "reply").r), /AETHRYON sur Discord/, "la navigation (aide) n'est pas comptée");
});

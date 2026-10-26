// 3.6.0 : client du contrat des extraits dans le VRAI service worker (src/background), contre le faux serveur
// (tests/unit/fakes/backend.ts) : startMs/endMs entiers, étapes réelles annoncées aux pages, progression montrée
// seulement si mesurée, extraction partielle impossible, annulation (DELETE), réseau coupé, GET /limites (accord,
// cache, absence), lecteur de l'onglet relayé pour le popup.
/* eslint-disable @typescript-eslint/no-explicit-any */
import "./fakes/setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, TT_URL, YT_URL } from "./fakes/harness.ts";
import { until } from "./fakes/chrome.ts";
import { API } from "./fakes/backend.ts";
import { MSG } from "../../src/background/errors.ts";
import { json } from "./fakes/fetch.ts";

const clipUpdates = (h: ReturnType<typeof harness>, key: string) =>
  h.browser.pageMessages.filter((m: any) => m.type === "job.update" && m.job.key === key).map((m: any) => m.job);

test("étapes réelles : analyse → récupération (mesurée) → conversion (sans mesure) → finalisation → terminé ; startMs/endMs entiers", async (t) => {
  const h = harness(t);
  h.backend.script = [
    { status: "running", stage: "recuperation", etape: "recuperation", progression: 0.35 },
    { status: "running", stage: "conversion", etape: "conversion", progression: undefined },
    { status: "running", stage: "finalisation", etape: "finalisation" },
  ];
  const r = await h.page({ type: "job.start", url: YT_URL, fmt: "mp4", clip: { start: 7987.8, end: 8063.7 }, quality: "1080" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.etape, undefined, "en file : aucune étape encore (« En attente du serveur »)");
  assert.equal(r.data.progress, undefined, "aucune progression avant une mesure");
  await until(() => h.browser.downloadCalls.length === 1, 3000, "fichier lancé");
  assert.deepEqual(h.backend.creates[0], { url: YT_URL, fmt: "mp4", quality: "1080", startMs: 7_987_800, endMs: 8_063_700 });
  assert.ok(h.net.calls.some((c) => c.url === `${API}/jobs/job_0001?wait=0&change=true`), "suivi en direct des étapes (&change=true)");
  const seen = clipUpdates(h, r.data.key);
  const recup = seen.find((j: any) => j.etape === "recuperation");
  assert.equal(recup?.progress, 35, "progression mesurée → pourcentage");
  const conv = seen.find((j: any) => j.etape === "conversion");
  assert.equal(conv?.progress, undefined, "conversion sans mesure → aucun pourcentage");
  assert.ok(seen.some((j: any) => j.etape === "finalisation"));
  const order = [...new Set(seen.map((j: any) => j.etape))];
  assert.deepEqual(order, [undefined, "recuperation", "conversion", "finalisation"], "file d'attente, puis les étapes annoncées");
  // Le navigateur enregistre le fichier : finalisation, octets mesurés ; terminé seulement quand le fichier est écrit.
  const dlId = 1;
  h.browser.downloadProgress(dlId, 500, 1000);
  await until(() => h.job(r.data.key)?.progress === 50, 2000, "octets reçus mesurés");
  assert.equal(h.job(r.data.key).etape, "finalisation");
  h.browser.downloadComplete(dlId);
  await until(() => h.job(r.data.key)?.state === "done", 2000, "fichier écrit");
  assert.equal(h.job(r.data.key).etape, "termine");
});

test("anciennes étapes du serveur (avant le contrat) traduites, sans pourcentage inventé à partir de « progress »", async (t) => {
  const h = harness(t);
  h.backend.script = [{ status: "running", stage: "downloading", progress: 40 }, { status: "running", stage: "clipping", progress: 80 }];
  const r = await h.page({ type: "job.start", url: TT_URL, fmt: "mp3", clip: { start: 1, end: 11 } });
  await until(() => h.browser.downloadCalls.length === 1, 3000, "fichier lancé");
  const seen = clipUpdates(h, r.data.key);
  assert.ok(seen.some((j: any) => j.etape === "recuperation" && j.progress === undefined), "downloading → récupération, sans pourcentage");
  assert.ok(seen.some((j: any) => j.etape === "conversion" && j.progress === undefined), "clipping → conversion");
  assert.deepEqual(h.backend.creates[0], { url: TT_URL, fmt: "mp3", bitrate: 192, startMs: 1_000, endMs: 11_000 });
});

test("serveur d'avant le contrat (startMs refusé, 400) : une nouvelle demande en secondes (start_s, end_s), sans rien perdre", async (t) => {
  const h = harness(t);
  h.backend.msRefused = true;
  const r = await h.page({ type: "job.start", url: YT_URL, fmt: "mp4", clip: { start: 12.345, end: 42.5 } });
  await until(() => h.browser.downloadCalls.length === 1, 3000, "fichier lancé");
  assert.deepEqual(h.backend.creates, [
    { url: YT_URL, fmt: "mp4", quality: "best", startMs: 12_345, endMs: 42_500 },
    { url: YT_URL, fmt: "mp4", quality: "best", start_s: 12.345, end_s: 42.5 },
  ]);
  assert.equal(h.job(r.data.key).error, undefined);
  // GIF : contrat refusé deux fois → extrait MP4 en secondes, puis GIF tiré de l'extrait (comme la 3.5.2).
  const g = harness(t);
  g.backend.msRefused = true;
  await g.page({ type: "job.start", url: YT_URL, fmt: "mp4", clip: { start: 5, end: 15 }, gif: true });
  await until(() => g.browser.downloadCalls.length === 1, 3000, "GIF lancé");
  assert.deepEqual(g.backend.creates.map((c: any) => [c.fmt, "startMs" in c, "start_s" in c]), [["gif", true, false], ["mp4", true, false], ["mp4", false, true]]);
  assert.equal(g.backend.derives.length, 1);
});

test("vidéo entière : comportement inchangé (étapes et progression d'avant)", async (t) => {
  const h = harness(t);
  const r = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4" });
  await until(() => h.browser.downloadCalls.length === 1, 3000, "fichier lancé");
  const seen = clipUpdates(h, r.data.key);
  assert.ok(seen.every((j: any) => j.etape === undefined), "pas d'étape d'extrait");
  assert.ok(seen.some((j: any) => j.progress === 40), "progression d'avant");
  assert.ok(h.net.calls.every((c) => !c.url.includes("change=true")), "suivi d'avant (sans &change=true)");
});

test("extraction partielle impossible : message dédié, non relançable tel quel, rien téléchargé", async (t) => {
  const h = harness(t);
  h.backend.script = [{ status: "error", stage: "error", etape: "analyse", error: "extrait_partiel_impossible", detail: "La source ne permet pas la récupération partielle (4 Go)." }];
  const r = await h.page({ type: "job.start", url: YT_URL, fmt: "mp4", clip: { start: 0, end: 60 } });
  await until(() => h.job(r.data.key)?.state === "error", 3000, "erreur");
  const e = h.job(r.data.key).error;
  assert.equal(e.code, "extrait_partiel_impossible");
  assert.equal(e.message, MSG.partialImpossible.replace(" : ", " : "));
  assert.equal(e.retryable, false);
  assert.equal(h.browser.downloadCalls.length, 0, "aucun téléchargement");
  // Refus dès la création (422 du serveur) : même message.
  const h2 = harness(t);
  h2.backend.onCreate = () => json(422, { error: "extrait_partiel_impossible", detail: "Récupération partielle impossible." });
  const r2 = await h2.page({ type: "job.start", url: YT_URL, fmt: "mp4", clip: { start: 0, end: 60 } });
  await until(() => h2.job(r2.data.key)?.state === "error", 3000, "erreur à la création");
  assert.equal(h2.job(r2.data.key).error.code, "extrait_partiel_impossible");
  assert.match(h2.job(r2.data.key).error.message, /^Cette vidéo ne permet pas de récupérer seulement le passage choisi/);
});

test("refus du serveur (422 : extrait trop long), quota (429), réseau coupé : erreurs claires", async (t) => {
  const h = harness(t);
  h.backend.onCreate = () => json(422, { error: "extrait_trop_long", detail: "L'extrait dépasse la durée maximale autorisée (10 min)." });
  const a = await h.page({ type: "job.start", url: YT_URL, fmt: "mp4", clip: { start: 0, end: 900 } });
  await until(() => h.job(a.data.key)?.state === "error", 3000, "422");
  assert.deepEqual([h.job(a.data.key).error.code, h.job(a.data.key).error.retryable], ["extrait_trop_long", false]);
  assert.match(h.job(a.data.key).error.message, /durée maximale autorisée/);
  const q = harness(t);
  q.backend.onCreate = () => json(429, { error: "quota_exceeded", detail: "Tu as atteint ta limite de conversions pour aujourd'hui." });
  const b = await q.page({ type: "job.start", url: YT_URL, fmt: "mp3", clip: { start: 0, end: 30 } });
  await until(() => q.job(b.data.key)?.state === "error", 3000, "429");
  assert.equal(q.job(b.data.key).error.code, "quota_exceeded");
  const n = harness(t);
  n.backend.offline = true;
  const c = await n.page({ type: "job.start", url: YT_URL, fmt: "mp4", clip: { start: 0, end: 30 } });
  await until(() => n.job(c.data.key)?.state === "error", 3000, "réseau");
  assert.deepEqual([n.job(c.data.key).error.code, n.job(c.data.key).error.retryable], ["network", true]);
});

test("annulation pendant la récupération : DELETE /jobs/{id}, « cancelled », plus aucun suivi", async (t) => {
  const h = harness(t, { timing: { minPollIntervalMs: 5 } }); // un suivi toutes les 5 ms au plus (la boucle rend la main)
  // Récupération qui dure : chaque suivi répond « en cours ».
  h.backend.onPoll = (job) => {
    Object.assign(job, { status: "running", stage: "recuperation", etape: "recuperation" });
    job.polls++;
    return json(200, h.backend.body(job));
  };
  const r = await h.page({ type: "job.start", url: YT_URL, fmt: "mp4", clip: { start: 10, end: 20 } });
  await until(() => h.job(r.data.key)?.etape === "recuperation", 3000, "récupération en cours");
  const c = await h.page({ type: "job.cancel", key: r.data.key });
  assert.equal(c.ok, true);
  assert.equal(h.job(r.data.key).state, "cancelled");
  assert.deepEqual(h.backend.deleted, ["job_0001"]);
  const polls = h.backend.jobs.get("job_0001")!.polls;
  await new Promise((res) => setTimeout(res, 100));
  assert.equal(h.backend.jobs.get("job_0001")!.polls, polls, "suivi arrêté");
  // Relance : nouvelle demande, de nouveau depuis l'analyse.
  const again = await h.page({ type: "job.retry", key: r.data.key });
  assert.equal(again.ok, true);
  assert.equal(again.data.etape, undefined, "relance : de nouveau en file");
  await until(() => h.backend.creates.length === 2, 2000, "nouvelle demande au serveur");
  assert.deepEqual(h.backend.creates[1], { url: YT_URL, fmt: "mp4", quality: "best", startMs: 10_000, endMs: 20_000 });
  await h.page({ type: "job.cancel", key: r.data.key });
});

test("limites : aucune requête avant l'accord ; GET /limites lu puis gardé ; absent (404) → « indisponible » ; quota du compte", async (t) => {
  const none = harness(t, { consent: false });
  const r0 = await none.page({ type: "limits.get" });
  assert.deepEqual(r0.data, { limits: null, quota: null, source: "indisponible" });
  assert.equal(none.backend.limitsRequests, 0, "rien avant l'accord à la notice");
  const h = harness(t);
  await h.page({ type: "popup.init" }); // compte lu (quota du jour)
  const r = await h.content({ type: "limits.get" }, YT_URL, 7);
  assert.equal(r.ok, true, "autorisé à une page (deux nombres, rien du compte)");
  assert.equal(r.data.source, "serveur");
  assert.equal(r.data.limits.extraitDureeMaxMs, 600_000);
  assert.deepEqual(r.data.quota, { used: 3, limit: 10, remaining: 7 });
  assert.equal(JSON.stringify(r.data).includes("alice"), false, "ni e-mail ni nom");
  await h.page({ type: "limits.get" });
  assert.equal(h.backend.limitsRequests, 1, "gardé 60 s");
  assert.ok(h.net.calls.some((c) => c.url === `${API}/limites`));
  const old = harness(t);
  old.backend.limitsStatus = 404;
  const r2 = await old.page({ type: "limits.get" });
  assert.deepEqual([r2.data.limits, r2.data.source], [null, "indisponible"], "serveur d'avant le contrat : rien d'inventé");
  const off = harness(t);
  off.backend.limitsStatus = "network";
  assert.equal((await off.page({ type: "limits.get" })).data.source, "indisponible");
});

test("lecteur de l'onglet piloté depuis le popup : relayé au content script de l'onglet actif, réponse revalidée ; refusé aux pages web", async (t) => {
  const h = harness(t, { linked: false });
  h.browser.activeTab = { id: 7 } as any;
  const got: any[] = [];
  h.browser.tabResponder = (_id, msg) => {
    got.push(msg);
    return { currentTime: 12.3456, duration: 32_400, paused: true, previewing: false, extra: "ignoré" };
  };
  const r = await h.page({ type: "player", op: "seek", t: 7987.8 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data, { currentTime: 12.346, duration: 32_400, paused: true, previewing: false });
  assert.deepEqual(got[0], { type: "player.cmd", op: "seek", t: 7987.8 });
  assert.equal(h.browser.tabMessages[0]!.tabId, 7);
  await h.page({ type: "player", op: "preview", start: 2, end: 4.5 });
  assert.deepEqual(got[1], { type: "player.cmd", op: "preview", start: 2, end: 4.5 });
  for (const bad of [{ type: "player", op: "seek" }, { type: "player", op: "seek", t: -1 }, { type: "player", op: "preview", start: 5, end: 4 }, { type: "player", op: "eval" },
    { type: "player", op: "times", x: 1 }, { type: "player", op: "seek", t: 90_000 }]) {
    assert.equal(await h.page(bad), undefined, `refusé : ${JSON.stringify(bad)}`);
  }
  assert.equal(await h.content({ type: "player", op: "times" }), undefined, "une page web ne pilote pas le lecteur par ce canal");
  h.browser.tabResponder = () => undefined;
  const none = await h.page({ type: "player", op: "times" });
  assert.deepEqual([none.ok, none.error.code], [false, "no_player"]);
});

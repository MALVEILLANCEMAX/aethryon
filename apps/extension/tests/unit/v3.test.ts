// Extension V3 : extraits instantanés, GIF tiré d'un extrait, image de la vidéo, miniature, « Ouvrir dans Tools »,
// « Afficher dans le dossier » — fonctions pures, validation des messages, et service worker réel contre les faux
// serveurs (même banc que background-jobs.test.ts).
/* eslint-disable @typescript-eslint/no-explicit-any */
import "./fakes/setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { clipAt, clipLabel, clipLength, parseClip, timecode } from "../../src/shared/clip.ts";
import { parseBgRequest } from "../../src/shared/messages.ts";
import { fileBase, fileTime, frameFileName, imageExt, thumbFileName } from "../../src/background/filenames.ts";
import { gifBody, requestBody, thumbSources } from "../../src/background/jobs.ts";
import { parseGrab } from "../../src/background/worker.ts";
import { sanitizeDetect } from "../../src/background/detect.ts";
import { harness, TT_URL, YT_URL } from "./fakes/harness.ts";
import { until } from "./fakes/chrome.ts";
import { API, SITE } from "./fakes/backend.ts";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const NB = " ";

test("extrait instantané : avant, autour, après l'instant de lecture ; borné à la vidéo sans perdre sa durée", () => {
  assert.deepEqual(clipAt(83.46, 30, "after", 600), { start: 83.5, end: 113.5 });
  assert.deepEqual(clipAt(83.46, 30, "before", 600), { start: 53.5, end: 83.5 });
  assert.deepEqual(clipAt(83.46, 30, "around", 600), { start: 68.5, end: 98.5 });
  assert.deepEqual(clipAt(5, 30, "before", 600), { start: 0, end: 30 }, "au début : glisse vers la droite");
  assert.deepEqual(clipAt(590, 30, "after", 600), { start: 570, end: 600 }, "à la fin : glisse vers la gauche");
  assert.deepEqual(clipAt(3, 30, "after", 12), { start: 0, end: 12 }, "vidéo plus courte que l'extrait : toute la vidéo");
  assert.deepEqual(clipAt(10, 15, "after"), { start: 10, end: 25 }, "durée inconnue : pas de borne de fin");
  assert.equal(clipAt(Number.NaN, 30, "after", 60), null);
  assert.equal(clipAt(10, 30, "after", 0.04), null, "trop court (moins d'un dixième de seconde)");
});

// 3.6.0 : plus aucune durée maximale écrite dans l'extension (ni 180 s, ni 600 s, ni 30 s) : celle du serveur (GET
// /limites), revérifiée par lui. Un message ne vérifie plus que la forme : 0 ≤ début < fin ≤ 24 h, au moins 0,1 s.
test("extrait reçu dans un message : forme vérifiée, aucune limite de durée fixe (celle du serveur), clés exactes, à la ms", () => {
  assert.deepEqual(parseClip({ start: 10, end: 190 }), { start: 10, end: 190 });
  assert.deepEqual(parseClip({ start: 10, end: 190.5 }), { start: 10, end: 190.5 }, "plus de 180 s : le serveur décide");
  assert.deepEqual(parseClip({ start: 0, end: 31 }), { start: 0, end: 31 }, "GIF de plus de 30 s : le serveur décide");
  assert.deepEqual(parseClip({ start: 7987.8, end: 8063.7 }), { start: 7987.8, end: 8063.7 }, "02:13:07.800 → 02:14:23.700 dans une vidéo de 9 h");
  assert.deepEqual(parseClip({ start: 1.23456, end: 2.0004 }), { start: 1.235, end: 2 }, "arrondi à la milliseconde");
  assert.equal(parseClip({ start: -1, end: 5 }), null);
  assert.equal(parseClip({ start: 5, end: 5.05 }), null, "moins d'un dixième de seconde");
  assert.equal(parseClip({ start: 5, end: 4 }), null, "fin avant le début");
  assert.equal(parseClip({ start: 0, end: 86_400.5 }), null, "au-delà de 24 h");
  assert.equal(parseClip({ start: 1, end: 5, x: 1 }), null);
  assert.equal(parseClip({ start: "1", end: 5 }), null);
  assert.equal(parseClip([1, 5]), null);
  assert.equal(timecode(83.9), "1:23");
  assert.equal(timecode(3723), "1:02:03");
  assert.equal(clipLabel({ start: 83, end: 113 }), `1:23${NB}→${NB}1:53`);
  assert.equal(clipLength({ start: 0, end: 30 }), `30${NB}s`);
  assert.equal(clipLength({ start: 0, end: 90 }), `1${NB}min 30${NB}s`);
});

test("messages V3 : job.start avec extrait ou GIF, image, miniature, Tools, dossier — tout le reste refusé", () => {
  const start = (x: Record<string, unknown>) => parseBgRequest({ type: "job.start", url: YT_URL, fmt: "mp4", ...x });
  assert.deepEqual(start({ clip: { start: 1, end: 31 } }), { type: "job.start", url: YT_URL, fmt: "mp4", clip: { start: 1, end: 31 } });
  assert.deepEqual(start({ clip: { start: 1, end: 31 }, gif: true }), { type: "job.start", url: YT_URL, fmt: "mp4", clip: { start: 1, end: 31 }, gif: true });
  assert.equal(start({ gif: true }), null, "GIF sans extrait");
  assert.deepEqual(start({ clip: { start: 1, end: 40 }, gif: true }), { type: "job.start", url: YT_URL, fmt: "mp4", clip: { start: 1, end: 40 }, gif: true },
    "3.6.0 : GIF de plus de 30 s transmis, le serveur applique sa propre limite");
  assert.equal(parseBgRequest({ type: "job.start", url: YT_URL, fmt: "mp3", clip: { start: 1, end: 5 }, gif: true }), null, "GIF en MP3");
  assert.deepEqual(start({ clip: { start: 1, end: 400 } }), { type: "job.start", url: YT_URL, fmt: "mp4", clip: { start: 1, end: 400 } }, "3.6.0 : extrait de plus de 180 s transmis");
  assert.equal(start({ clip: { start: 4, end: 1 } }), null, "fin avant le début");
  assert.equal(start({ gif: "oui", clip: { start: 1, end: 5 } }), null);

  assert.deepEqual(parseBgRequest({ type: "frame.capture" }), { type: "frame.capture" });
  assert.equal(parseBgRequest({ type: "frame.capture", tab: 3 }), null);
  const frame = { type: "frame.save", url: TT_URL, dataUrl: PNG, at: 12.5, title: "Titre" };
  assert.deepEqual(parseBgRequest(frame), frame);
  assert.equal(parseBgRequest({ ...frame, dataUrl: "data:image/jpeg;base64,AAAA" }), null, "PNG seulement");
  assert.equal(parseBgRequest({ ...frame, dataUrl: `${PNG}<script>` }), null, "base64 strict");
  assert.equal(parseBgRequest({ ...frame, dataUrl: `data:image/png;base64,${"A".repeat(32_000_001)}` }), null, "taille bornée");
  assert.equal(parseBgRequest({ ...frame, at: -3 }), null);
  assert.equal(parseBgRequest({ ...frame, extra: 1 }), null);
  assert.deepEqual(parseBgRequest({ type: "thumb.save", url: YT_URL, thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg" }),
    { type: "thumb.save", url: YT_URL, thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg" });
  assert.equal(parseBgRequest({ type: "thumb.save", url: YT_URL }), null);
  assert.deepEqual(parseBgRequest({ type: "tools.open", key: "AbCdEfGh12345678" }), { type: "tools.open", key: "AbCdEfGh12345678" });
  assert.deepEqual(parseBgRequest({ type: "tools.open", url: TT_URL }), { type: "tools.open", url: TT_URL });
  assert.equal(parseBgRequest({ type: "tools.open", key: "AbCdEfGh12345678", url: TT_URL }), null, "l'un OU l'autre");
  assert.equal(parseBgRequest({ type: "tools.open", key: "../x" }), null);
  assert.deepEqual(parseBgRequest({ type: "download.show", key: "AbCdEfGh12345678" }), { type: "download.show", key: "AbCdEfGh12345678" });
});

test("noms de fichiers enregistrés par l'extension : lisibles, sans caractère interdit, bornés", () => {
  assert.equal(fileBase(`  La nuit: « chouettes » / partie 1?*  `, "x"), "La nuit « chouettes » partie 1");
  assert.equal(fileBase("..\u0007..", "Image AETHRYON"), "Image AETHRYON");
  assert.equal(fileBase("a".repeat(300), "x").length, 100);
  assert.equal(fileTime(83.9), "1m23s");
  assert.equal(fileTime(3723), "1h02m03s");
  assert.equal(frameFileName("Ma vidéo", 83.4), "Ma vidéo (image 1m23s).png");
  assert.equal(frameFileName(undefined), "Image AETHRYON (image de la vidéo).png");
  assert.equal(imageExt("https://p16-sign.tiktokcdn.com/obj/abc.webp?x=1"), "webp");
  assert.equal(imageExt("https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/a.jpg"), "jpg");
  assert.equal(imageExt("https://pbs.twimg.com/media/a?format=png&name=large"), "png");
  assert.equal(thumbFileName("Ma vidéo", "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg"), "Ma vidéo (miniature).jpg");
});

test("corps des demandes : extrait en millisecondes entières (startMs, endMs), GIF demandé au serveur ; miniatures YouTube en grand avec repli", () => {
  const base = { key: "k", url: YT_URL, platform: "youtube", fmt: "mp4", quality: "720", state: "queued", createdAt: 0, updatedAt: 0 } as any;
  assert.deepEqual(requestBody({ ...base, clip: { start: 12.5, end: 42.5 } }), { url: YT_URL, fmt: "mp4", quality: "720", startMs: 12_500, endMs: 42_500 });
  assert.deepEqual(requestBody({ ...base, clip: { start: 7987.8, end: 8063.7 } }), { url: YT_URL, fmt: "mp4", quality: "720", startMs: 7_987_800, endMs: 8_063_700 },
    "9 h : 02:13:07.800 → 02:14:23.700, entiers exacts");
  assert.deepEqual(requestBody({ ...base, fmt: "mp3", quality: undefined, bitrate: 192, clip: { start: 0.001, end: 0.101 } }), { url: YT_URL, fmt: "mp3", bitrate: 192, startMs: 1, endMs: 101 });
  assert.deepEqual(requestBody({ ...base, kind: "gif", clip: { start: 5, end: 15 } }), { url: YT_URL, fmt: "gif", startMs: 5_000, endMs: 15_000 }, "GIF : format du contrat, sans qualité");
  assert.deepEqual(requestBody({ ...base, kind: "gif", gifLegacy: true, clip: { start: 5, end: 15 } }), { url: YT_URL, fmt: "mp4", quality: "720", startMs: 5_000, endMs: 15_000 },
    "serveur ancien : extrait MP4, puis GIF tiré");
  for (const b of [requestBody({ ...base, clip: { start: 12.5, end: 42.5 } })]) assert.equal("start_s" in b || "end_s" in b, false, "plus de secondes flottantes");
  assert.deepEqual(requestBody(base), { url: YT_URL, fmt: "mp4", quality: "720" });
  assert.deepEqual(gifBody({ start: 12.5, end: 22.5 }), { op: "gif", start_s: 0, duration_s: 10, gif_width: 480, gif_fps: 12, max_bytes: 8 * 1024 * 1024 });
  assert.deepEqual(thumbSources("https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg"),
    { primary: "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg", fallback: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" });
  assert.deepEqual(thumbSources("https://p16-sign-va.tiktokcdn.com/obj/x.jpeg?e=1"), { primary: "https://p16-sign-va.tiktokcdn.com/obj/x.jpeg?e=1" });
  assert.equal(thumbSources("https://evil.example/x.jpg"), null);
  assert.equal(thumbSources("http://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg"), null);
});

test("réponses des pages : instant de lecture et durée bornés ; image ou motif d'échec vérifiés", () => {
  const d = sanitizeDetect({ media: { url: YT_URL, title: "T", currentTime: 700, duration: 600 }, hint: null });
  assert.equal(d.media?.duration, 600);
  assert.equal(d.media?.currentTime, 600, "instant ramené à la fin");
  assert.equal(sanitizeDetect({ media: { url: YT_URL, currentTime: Number.POSITIVE_INFINITY, duration: -1 }, hint: null }).media?.currentTime, undefined);
  assert.deepEqual(parseGrab({ ok: true, dataUrl: PNG, width: 1, height: 1, at: 3 }), { ok: true, dataUrl: PNG, width: 1, height: 1, at: 3 });
  assert.deepEqual(parseGrab({ ok: false, reason: "tainted", rect: { x: 0, y: 10, width: 640, height: 360 }, viewport: { width: 1280, height: 800 }, at: 2 }),
    { ok: false, reason: "tainted", rect: { x: 0, y: 10, width: 640, height: 360 }, viewport: { width: 1280, height: 800 }, at: 2 });
  assert.deepEqual(parseGrab({ ok: false, reason: "tainted", rect: { x: -5, y: 0, width: 1, height: 1 } }), { ok: false, reason: "tainted" }, "rectangle invalide ignoré");
  assert.equal(parseGrab({ ok: false, reason: "autre" }), null);
  assert.equal(parseGrab({ ok: true, dataUrl: 3 }), null);
});

test("extrait MP4 : une conversion avec startMs/endMs, extrait visible dans la liste", async (t) => {
  const h = harness(t);
  const r = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4", clip: { start: 12, end: 42 } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.clip, { start: 12, end: 42 });
  await until(() => h.browser.downloadCalls.length === 1, 2000, "téléchargement lancé");
  assert.deepEqual(h.backend.creates[0], { url: TT_URL, fmt: "mp4", quality: "best", startMs: 12_000, endMs: 42_000 });
  assert.equal(h.backend.derives.length, 0);
});

test("GIF (3.6.0) : demandé directement au serveur (fmt « gif », startMs, endMs) → fichier GIF, aucun GIF tiré en plus", async (t) => {
  const h = harness(t);
  const r = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4", clip: { start: 5, end: 45 }, gif: true, title: "Danse" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.kind, "gif");
  await until(() => h.browser.downloadCalls.length === 1, 3000, "GIF téléchargé");
  assert.deepEqual({ url: h.backend.creates[0].url, startMs: h.backend.creates[0].startMs, endMs: h.backend.creates[0].endMs }, { url: TT_URL, startMs: 5_000, endMs: 45_000 });
  assert.equal(h.backend.creates[0].fmt, "gif");
  assert.equal(h.backend.creates[0].quality, undefined);
  assert.equal(h.backend.derives.length, 0);
  assert.match(h.browser.downloadCalls[0]!.url!, /\/jobs\/job_0001\/file\/.*\.gif$/);
});

test("GIF sur un serveur d'avant le contrat (400 sur fmt « gif » + passage) : extrait MP4 (720p) → GIF tiré de l'extrait ; rien d'interne ne sort", async (t) => {
  const h = harness(t);
  h.backend.gifClipRefused = true;
  const r = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4", clip: { start: 5, end: 15 }, gif: true, title: "Danse" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.kind, "gif");
  await until(() => h.browser.downloadCalls.length === 1, 3000, "GIF téléchargé");
  assert.equal(h.backend.creates[0].fmt, "gif", "d'abord la demande du contrat");
  assert.deepEqual(h.backend.creates[1], { url: TT_URL, fmt: "mp4", quality: "720", startMs: 5_000, endMs: 15_000 });
  assert.equal(h.backend.derives.length, 1);
  assert.deepEqual(h.backend.derives[0], { source: "job_0001", body: { op: "gif", start_s: 0, duration_s: 10, gif_width: 480, gif_fps: 12, max_bytes: 8 * 1024 * 1024 } });
  assert.match(h.browser.downloadCalls[0]!.url!, /\/jobs\/job_0002\/file\/.*\.gif$/);
  const view = h.job();
  assert.equal(view.sourceJobId, "job_0001", "gardé en interne pour Tools");
  const listed = (await h.page({ type: "jobs.list" })).data[0];
  assert.equal(listed.sourceJobId, undefined, "jamais transmis aux pages");
  assert.equal(listed.jobId, "job_0002");
});

test("GIF (serveur ancien) : service worker arrêté entre l'extrait et le GIF → reprise sur le job du GIF, aucun second extrait", async (t) => {
  const h = harness(t);
  h.backend.gifClipRefused = true;
  h.backend.script = [{ status: "running", stage: "downloading", progress: 40 }, { status: "running", stage: "downloading", progress: 80 }];
  const r = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4", clip: { start: 0, end: 8 }, gif: true });
  await until(() => h.backend.derives.length === 1 && h.job()?.jobId === "job_0002", 3000, "GIF demandé");
  h.restart();
  await until(() => h.browser.downloadCalls.length === 1, 3000, "GIF téléchargé après la reprise");
  assert.equal(h.backend.creates.filter((c) => c.fmt === "mp4").length, 1, "un seul extrait");
  assert.equal(h.backend.derives.length, 1, "un seul GIF");
  assert.equal(h.job(r.data.key).jobId, "job_0002");
});

test("GIF (serveur ancien) refusé par le serveur : erreur expliquée, relance depuis l'extrait", async (t) => {
  const h = harness(t);
  h.backend.gifClipRefused = true;
  let refuse = true;
  h.backend.onDerive = () => (refuse ? new Response(JSON.stringify({ error: "gif_too_long", detail: "Vidéo trop longue pour un GIF." }), { status: 413, headers: { "content-type": "application/json" } }) : undefined);
  const r = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4", clip: { start: 0, end: 8 }, gif: true });
  await until(() => h.job(r.data.key)?.state === "error", 3000, "erreur");
  assert.equal(h.job(r.data.key).error.code, "gif_too_long");
  refuse = false;
  const again = await h.page({ type: "job.retry", key: r.data.key });
  assert.equal(again.ok, true);
  await until(() => h.browser.downloadCalls.length === 1, 3000, "GIF après relance");
  assert.equal(h.backend.creates.filter((c) => c.fmt === "mp4").length, 2, "la relance refait l'extrait");
});

test("image envoyée par la page : PNG vérifié, enregistrée par le navigateur sous un nom lisible, jamais relancée", async (t) => {
  const h = harness(t, { linked: false });
  const r = await h.content({ type: "frame.save", url: TT_URL, dataUrl: PNG, at: 83.4, title: "Danse: finale" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.kind, "frame");
  const call = h.browser.downloadCalls[0]!;
  assert.equal(call.url, PNG);
  assert.equal(call.filename, "Danse finale (image 1m23s).png");
  h.browser.downloadComplete(1);
  await until(() => h.job(r.data.key)?.state === "done", 1000, "image enregistrée");
  assert.equal(h.net.calls.length, 0, "aucune requête : ni compte, ni serveur");
  assert.equal(JSON.stringify([...h.browser.store.session.entries()]).includes("iVBOR"), false, "l'image n'est jamais stockée");
  const bad = await h.content({ type: "frame.save", url: TT_URL, dataUrl: "data:image/png;base64,QUFBQUFBQUFBQUFB" });
  assert.equal(bad.ok, false, "pas un PNG");
  const other = await h.content({ type: "frame.save", url: YT_URL, dataUrl: PNG });
  assert.equal(other.ok, false, "vidéo d'une autre plateforme que la page");
  h.browser.downloadInterrupt(1, "NETWORK_FAILED");
  const retry = await h.page({ type: "job.retry", key: r.data.key });
  assert.equal(retry.ok, true, "rien à relancer pour une image déjà enregistrée");
});

test("capture depuis le popup : lue sur la page, sinon capture de l'onglet ; vidéo protégée refusée", async (t) => {
  const h = harness(t, { linked: false });
  let grab: any = { ok: true, dataUrl: PNG, width: 1, height: 1, at: 4 };
  h.browser.tabResponder = (_id, msg) => (msg.type === "detect.request" ? { media: { url: YT_URL, title: "Vidéo" }, hint: null } : grab);
  const ok = await h.page({ type: "frame.capture" });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(h.browser.downloadCalls[0]!.filename, "Vidéo (image 0m04s).png");
  grab = { ok: false, reason: "drm", at: 4 };
  const drm = await h.page({ type: "frame.capture" });
  assert.deepEqual([drm.ok, drm.error.code], [false, "drm"]);
  assert.match(drm.error.message, /prot[ée]g[ée]e \(DRM\)/);
  grab = { ok: false, reason: "tainted" };
  const tainted = await h.page({ type: "frame.capture" });
  assert.deepEqual([tainted.ok, tainted.error.code], [false, "tainted"], "sans place de la vidéo : bouton de la barre d'outils conseillé");
  grab = { ok: false, reason: "no_video" };
  assert.equal((await h.page({ type: "frame.capture" })).error.code, "no_video");
  assert.equal(h.browser.captureCalls, 0);
});

test("miniature : grande taille YouTube, repli automatique si elle n'existe pas ; hôte inconnu refusé", async (t) => {
  const h = harness(t, { linked: false });
  const r = await h.page({ type: "thumb.save", url: YT_URL, thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg", title: "Clip" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(h.browser.downloadCalls[0]!.url, "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg");
  assert.equal(h.browser.downloadCalls[0]!.filename, "Clip (miniature).jpg");
  h.browser.downloadInterrupt(1, "SERVER_BAD_CONTENT");
  await until(() => h.browser.downloadCalls.length === 2, 1000, "repli lancé");
  assert.equal(h.browser.downloadCalls[1]!.url, "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  h.browser.downloadComplete(2);
  await until(() => h.job(r.data.key)?.state === "done", 1000, "miniature enregistrée");
  const bad = await h.page({ type: "thumb.save", url: YT_URL, thumbnail: "https://evil.example/a.jpg" });
  assert.deepEqual([bad.ok, bad.error.code], [false, "no_thumbnail"]);
});

test("« Ouvrir dans Tools » : fichier déjà converti → lien de l'éditeur ; vidéo seule → /outils#lien= ; Tools fermé expliqué", async (t) => {
  const h = harness(t);
  const r = await h.page({ type: "job.start", url: TT_URL, fmt: "mp4", clip: { start: 0, end: 8 }, gif: true });
  await until(() => h.browser.downloadCalls.length === 1, 3000, "GIF prêt");
  const open = await h.page({ type: "tools.open", key: r.data.key });
  assert.equal(open.ok, true, JSON.stringify(open));
  assert.deepEqual(h.backend.toolsLinks[0], { job_id: "job_0001" }, "le média du serveur (3.6.0 : le GIF fabriqué directement) s'ouvre dans l'éditeur");
  assert.equal(h.browser.createdTabs.at(-1), `${SITE}/outils/studio#ref=${"R".repeat(43)}`);
  const byUrl = await h.page({ type: "tools.open", url: `${TT_URL}?is_from_webapp=1` });
  assert.equal(byUrl.ok, true);
  assert.equal(h.browser.createdTabs.at(-1), `${SITE}/outils#lien=${encodeURIComponent(TT_URL)}`, "lien canonique, dans le fragment");
  h.backend.toolsOpen = false;
  const closed = await h.page({ type: "tools.open", key: r.data.key });
  assert.deepEqual([closed.ok, closed.error.code], [false, "tools_unavailable"]);
  const frame = await h.content({ type: "frame.save", url: TT_URL, dataUrl: PNG });
  const none = await h.page({ type: "tools.open", key: frame.data.key });
  assert.deepEqual([none.ok, none.error.code], [false, "no_media"], "une image n'a pas de média sur le serveur");
});

test("« Afficher dans le dossier » : seulement un fichier terminé et encore présent", async (t) => {
  const h = harness(t, { linked: false });
  const r = await h.content({ type: "frame.save", url: TT_URL, dataUrl: PNG });
  const early = await h.page({ type: "download.show", key: r.data.key });
  assert.equal(early.ok, false, "pas encore écrit");
  h.browser.downloadComplete(1);
  await until(() => h.job(r.data.key)?.state === "done", 1000, "écrit");
  const shown = await h.page({ type: "download.show", key: r.data.key });
  assert.equal(shown.ok, true, JSON.stringify(shown));
  assert.deepEqual(h.browser.showCalls, [1]);
  // V3.5 : « Afficher » depuis le menu de la page, pour un fichier de CET onglet seulement.
  const fromPage = await h.content({ type: "download.show", key: r.data.key });
  assert.equal(fromPage.ok, true, JSON.stringify(fromPage));
  assert.deepEqual(h.browser.showCalls, [1, 1]);
  const otherTab = await h.content({ type: "download.show", key: r.data.key }, TT_URL, 8);
  assert.deepEqual([otherTab.ok, otherTab.error?.code], [false, "not_found"], "un autre onglet ne peut pas montrer ce fichier");
  assert.deepEqual(h.browser.showCalls, [1, 1]);
  void API;
});

test("compatibilité : serveur actuel sans « features » (production 1.0.0) → Tools caché ; « features.tools » vrai → proposé ; faux → caché", async (t) => {
  const old = harness(t);
  assert.equal("features" in old.backend.me, false, "réponse /me de la 1.0.0");
  const a = await old.page({ type: "popup.init" });
  assert.equal(a.data.account.connected, true);
  assert.equal(a.data.account.tools, undefined, "aucun bouton Tools sans l'annonce du serveur");
  const open = harness(t);
  open.backend.me = { ...open.backend.me, features: { tools: true } };
  assert.equal((await open.page({ type: "popup.init" })).data.account.tools, true);
  const closed = harness(t);
  closed.backend.me = { ...closed.backend.me, features: { tools: false } };
  assert.equal((await closed.page({ type: "popup.init" })).data.account.tools, false);
});

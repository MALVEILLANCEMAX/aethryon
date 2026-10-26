// AETHRYON Tools (src/outils/edit.ts, format.ts) : corps d'export conformes au contrat de ytapi, recadrage en pixels de
// l'image affichée, rapports d'image avec rotation, limites dites avant l'envoi, saisies de temps.
//   node --test web/tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { MediaInfo } from "../src/outils/api.ts";
import { carriedEdits, cropPixels, estimateSize, exportBody, exportProblem, fitRatio, initialEdit, outputDims, resize, sampleBody } from "../src/outils/edit.ts";
import { bytes, bytesRange, parseTime, spanLabel, timecode } from "../src/outils/format.ts";

const video: MediaInfo = { duration: 60, size_bytes: 52_235_403, bit_rate: 6_964_000, has_video: true, has_audio: true, container: "mov,mp4",
  width: 1920, height: 1080, fps: 30, video_codec: "h264", audio_codec: "aac", audio_bit_rate: 128_000, playable: true };
const silent: MediaInfo = { ...video, has_audio: false, audio_codec: undefined, audio_bit_rate: null };
const sound: MediaInfo = { duration: 180, size_bytes: 4_321_533, bit_rate: 192_000, has_video: false, has_audio: true, container: "mp3", playable: true };

test("export vidéo : passage, recadrage en pixels, orientation, vitesse, son et sortie ; rien de superflu", () => {
  const e = { ...initialEdit(video), start: 4, end: 11 };
  assert.deepEqual(exportBody("couper", e, video), { op: "video", start_s: 4, duration_s: 7 });
  const tuned = { ...e, crop: { x: 0.25, y: 0, w: 0.5, h: 1 }, rotate: 90 as const, flipH: true, speed: 2, volumeDb: -6, fadeIn: 0.5, container: "webm" as const, quality: "haute" as const, height: 720 };
  assert.deepEqual(exportBody("recadrer", tuned, video), {
    op: "video", start_s: 4, duration_s: 7, crop: { x: 480, y: 0, w: 960, h: 1080 }, rotate: 90, flip: "h", speed: 2,
    volume_db: -6, fade_in_s: 0.5, container: "webm", quality: "haute", height: 720,
  });
  assert.deepEqual(exportBody("couper", { ...e, mute: true, volumeDb: -6 }, video), { op: "video", start_s: 4, duration_s: 7, mute: true });
  assert.equal(exportBody("couper", { ...e, volumeDb: 3 }, silent).volume_db, undefined, "pas de réglage du son sans son");
});

test("export audio, GIF, compression et échantillon : les champs que ytapi accepte pour chaque opération", () => {
  const e = { ...initialEdit(video), start: 20, end: 30.5, crop: { x: 0, y: 0, w: 0.5, h: 0.5 }, rotate: 180 as const, volumeDb: 4, fadeOut: 2 };
  const audio = exportBody("audio", e, video);
  assert.deepEqual(audio, { op: "audio", start_s: 20, duration_s: 10.5, volume_db: 4, fade_out_s: 2, audio_format: "mp3", bitrate: 192 });
  assert.equal(exportBody("audio", { ...e, audioFormat: "wav" }, video).bitrate, undefined);
  const gif = exportBody("gif", e, video);
  assert.deepEqual(gif, { op: "gif", start_s: 20, duration_s: 10.5, crop: { x: 0, y: 0, w: 960, h: 540 }, rotate: 180, gif_width: 480, gif_fps: 12 });
  const small = exportBody("compresser", { ...e, crop: null, rotate: 0, targetMb: 8 }, video);
  assert.equal(small.op, "compress");
  assert.equal(small.max_bytes, 8 * 1024 * 1024);
  assert.equal(sampleBody({ ...e, crop: null, targetMb: 8 }, video).op, "echantillon");
});

test("recadrage : pixels bornés à l'image, rapport de SORTIE respecté même après un quart de tour", () => {
  assert.deepEqual(cropPixels({ x: 0.99, y: 0.99, w: 0.5, h: 0.5 }, video), { x: 1901, y: 1064, w: 19, h: 16 });
  const nine16 = fitRatio(9 / 16, 1920, 1080, 0);
  assert.ok(Math.abs((nine16.w * 1920) / (nine16.h * 1080) - 9 / 16) < 1e-9 && nine16.h === 1);
  const turned = fitRatio(9 / 16, 1920, 1080, 90); // tourné : 16:9 dans l'image d'origine
  assert.ok(Math.abs((turned.w * 1920) / (turned.h * 1080) - 16 / 9) < 1e-9);
  const e = { ...initialEdit(video), crop: nine16, rotate: 0 as const };
  assert.deepEqual(outputDims(e, video, "recadrer"), { w: 606, h: 1080 });
  // Un coin tiré avec un rapport imposé garde le rapport et reste dans l'image.
  const r = resize({ x: 0.3, y: 0, w: 0.3164, h: 1 }, "se", 0.4, 0.4, 9 / 16, 16 / 9);
  assert.ok(r.x + r.w <= 1 + 1e-9 && r.y + r.h <= 1 + 1e-9);
  assert.ok(Math.abs((r.w * (16 / 9)) / r.h - 9 / 16) < 1e-6);
});

test("limites dites avant l'envoi : GIF 30 s, vidéo 15 min, compression impossible, son absent", () => {
  const e = initialEdit(video, { videoMaxS: 900, gifMaxS: 30 });
  assert.match(exportProblem("gif", e, video, { gifMaxS: 30 }) ?? "", /GIF dure au plus 30/);
  assert.equal(exportProblem("gif", { ...e, end: 10 }, video, { gifMaxS: 30 }), null);
  assert.equal(exportProblem("gif", { ...e, end: 50, speed: 1.25 }, video, { gifMaxS: 30 }), "Un GIF dure au plus 30 s : raccourcis la sélection.");
  assert.match(exportProblem("audio", e, silent) ?? "", /pas de son/);
  assert.match(exportProblem("couper", e, sound) ?? "", /pas d'image/);
  const long: MediaInfo = { ...video, duration: 3000 };
  assert.match(exportProblem("couper", { ...initialEdit(long), end: 3000 }, long, { videoMaxS: 900 }) ?? "", /15\u00a0min/);
  assert.match(exportProblem("compresser", { ...initialEdit(long), end: 900, targetMb: 8 }, long) ?? "", /trop long pour tenir dans 8\u00a0Mo/);
});

test("tailles estimées : très proches pour un MP3 à débit constant, plafond pour la compression, jamais dites exactes", () => {
  const e = { ...initialEdit(video), start: 0, end: 10 };
  assert.deepEqual(estimateSize("audio", e, video), { bytes: 240_000, exact: false });
  assert.deepEqual(estimateSize("compresser", { ...e, targetMb: 25 }, video), { bytes: 25 * 1024 * 1024, exact: false });
  assert.equal(estimateSize("couper", e, video)?.exact, false);
});

test("temps : affichage à la française, saisies tolérées, refus des valeurs impossibles", () => {
  assert.equal(timecode(83.46, 2), "1:23,46");
  assert.equal(timecode(3723.5), "1:02:03,5");
  assert.equal(spanLabel(17), "17,0 s");
  assert.equal(parseTime("1:23,5"), 83.5);
  assert.equal(parseTime("83.25"), 83.25);
  assert.equal(parseTime("01:02:03"), 3723);
  assert.equal(parseTime("1:75"), null);
  assert.equal(parseTime("abc"), null);
  assert.equal(bytes(5_266_726), "5,0 Mo");
});

test("retouches réglées ailleurs : dites dans l'export qu'elles touchent, jamais dans celui qu'elles ne touchent pas", () => {
  const e = { ...initialEdit(video), crop: fitRatio(9 / 16, 1920, 1080, 0), ratio: "9:16" as const, rotate: 90 as const, speed: 2, volumeDb: 4, fadeOut: 1 };
  const ids = (t: Parameters<typeof carriedEdits>[0], m = video, x = e) => carriedEdits(t, x, m).map((c) => c.id);
  assert.deepEqual(ids("gif"), ["crop", "rotate"]);
  assert.deepEqual(ids("compresser"), ["crop", "rotate", "speed", "volume", "fades"]);
  assert.deepEqual(ids("couper"), ["crop", "rotate", "volume", "fades"]);
  assert.deepEqual(ids("recadrer"), ["speed", "volume", "fades"]);
  assert.deepEqual(ids("audio"), [], "le son ne garde ni recadrage ni rotation ; ses réglages sont dans son panneau");
  assert.deepEqual(ids("couper", silent), ["crop", "rotate"], "pas de réglage du son sur un fichier muet");
  assert.deepEqual(ids("compresser", video, { ...e, mute: true }), ["crop", "rotate", "speed", "mute"]);
  const crop = carriedEdits("gif", e, video)[0]!;
  assert.equal(crop.label, "Recadrage 9:16");
  assert.deepEqual(crop.clear, { crop: null, ratio: "original" });
  assert.equal(carriedEdits("gif", { ...e, ratio: "libre" }, video)[0]!.label, "Recadrage libre");
});

// ---- mode son (src/outils/audio.ts, AudioStage.tsx) --------------------------------------------------------------
import { bandLevel, clippedShare, gainAt, levelAt, logBands, soundFacts } from "../src/outils/audio.ts";

test("son : gain de l'export comme la chaîne de ytapi (volume, puis fondus linéaires en temps de sortie, après la vitesse)", () => {
  const s = { start: 10, end: 20, speed: 1, volumeDb: 0, fadeIn: 0, fadeOut: 0 };
  assert.equal(gainAt(9.99, s), 0, "hors de la sélection : rien n'est exporté");
  assert.equal(gainAt(15, s), 1);
  assert.ok(Math.abs(gainAt(15, { ...s, volumeDb: 6 }) - 1.9953) < 1e-3, "+6 dB ≈ ×2");
  const f = { ...s, fadeIn: 2, fadeOut: 4 };
  assert.equal(gainAt(10, f), 0);
  assert.equal(gainAt(11, f), 0.5);
  assert.equal(gainAt(12, f), 1);
  assert.equal(gainAt(18, f), 0.5, "fondu de sortie : 4 s avant la fin");
  // Vitesse ×2 : 10 s de source = 5 s exportées ; un fondu de 2 s couvre 4 s de source.
  const fast = { ...f, speed: 2, fadeOut: 0 };
  assert.equal(gainAt(12, fast), 0.5);
  assert.equal(gainAt(14, fast), 1);
  // Fondu plus long que l'export : ytapi le borne à la durée exportée.
  assert.equal(gainAt(15, { ...s, fadeIn: 30 }), 0.5);
});

test("son : part de la sélection qui risque de saturer (crête × gain > 255), jamais hors de la sélection", () => {
  const peaks = Array.from({ length: 100 }, (_, i) => (i < 50 ? 100 : 200)); // 100 s, un point par seconde
  const s = { start: 0, end: 100, speed: 1, volumeDb: 0, fadeIn: 0, fadeOut: 0 };
  assert.equal(clippedShare(peaks, 100, s), 0, "sans amplification : rien ne sature");
  assert.ok(Math.abs(clippedShare(peaks, 100, { ...s, volumeDb: 3 }) - 0.5) < 0.02, "+3 dB : les crêtes à 200 passent 255");
  assert.equal(clippedShare(peaks, 100, { ...s, start: 0, end: 49, volumeDb: 3 }), 0, "passage calme seulement");
  assert.ok(clippedShare(peaks, 100, { ...s, volumeDb: 9 }) > 0.98);
  assert.equal(clippedShare([], 100, s), 0);
});

test("son : bandes du spectre logarithmiques, croissantes, au moins une case chacune ; niveaux bornés", () => {
  const bands = logBands(56, 45, 16000, 48000, 4096);
  assert.equal(bands.length, 56);
  for (let i = 0; i < bands.length; i++) {
    const [a, b] = bands[i]!;
    assert.ok(a >= 1 && b > a && b <= 2048, `bande ${i} : [${a}, ${b}[`);
    if (i) assert.ok(a >= bands[i - 1]![0], "jamais en arrière");
  }
  // 330 Hz (case ≈ 28 à 48 kHz / 4096) tombe dans une bande du premier tiers.
  const k = bands.findIndex(([a, b]) => a <= 28 && 28 < b);
  assert.ok(k > 10 && k < 25, `330 Hz dans la bande ${k}`);
  const data = new Uint8Array(2048); data[28] = 255;
  assert.equal(bandLevel(data, bands[k]!), 1);
  assert.equal(bandLevel(new Uint8Array(2048), bands[k]!), 0);
  assert.equal(levelAt([0, 255, 0], 3, 1.5, 0.1), 1);
  assert.equal(levelAt([], 3, 1.5), 0);
});

test("son : caractéristiques dites telles que la sonde les donne (débit du son seul pour une vidéo)", () => {
  assert.deepEqual(soundFacts({ ...sound, audio_codec: "mp3", sample_rate: 44100, channels: 2 }), ["MP3", "3 min", "192 kbit/s", "44,1 kHz", "Stéréo"]);
  const facts = soundFacts({ ...video, sample_rate: 48000, channels: 1 });
  assert.deepEqual(facts, ["AAC", "1 min", "128 kbit/s", "48 kHz", "Mono"]);
  assert.ok(!soundFacts({ ...video, audio_bit_rate: null }).some((f) => f.includes("6964")), "jamais le débit total de la vidéo");
});

test("GIF : taille dite en fourchette (aplats à vraie vidéo), jamais un seul chiffre trompeur", () => {
  const e = { ...initialEdit(video), start: 0, end: 10, gifWidth: 480, gifFps: 12 };
  const est = estimateSize("gif", e, video)!;
  assert.ok(est.range, "fourchette");
  const [lo, hi] = est.range!;
  assert.ok(lo < est.bytes && est.bytes < hi && !est.exact);
  // Mesuré sur un décollage filmé (480 × 854, 12 i/s, 10 s) : 14 Mo, dans la fourchette d'une vidéo 16:9 de même surface.
  const px = 480 * 270 * 12 * 10;
  assert.equal(Math.round(lo), Math.round(px * 0.08));
  assert.equal(Math.round(hi), Math.round(px * 0.32));
  assert.equal(bytesRange(3.8 * 1024 * 1024, 15 * 1024 * 1024), "3,8 à 15\u00a0Mo", "l'unité dite une fois");
  assert.equal(bytesRange(800 * 1024, 2 * 1024 * 1024), "800\u00a0Ko à 2,0\u00a0Mo");
});

test("lien venu de l'extension (#lien=) : seul un lien reconnu est repris, rien d'autre", async () => {
  const { linkFromHash } = await import("../src/outils/link.ts");
  const tiktok = "https://www.tiktok.com/@nasa/video/7691727731800673549";
  assert.equal(linkFromHash(`#lien=${encodeURIComponent(tiktok)}`), tiktok);
  assert.equal(linkFromHash(`#lien=${encodeURIComponent("https://vimeo.com/1")}`), null);
  assert.equal(linkFromHash("#lien=%E0%A4%A"), null);
  assert.equal(linkFromHash(`#ref=abc`), null);
});

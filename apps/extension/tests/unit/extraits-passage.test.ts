// 3.6.0 : modèle d'un extrait (src/shared/extrait.ts) — bornes, poignées qui ne se croisent pas, champs qui font
// suivre l'autre borne, durée maximale du SERVEUR (jamais une constante), pas du clavier, vérification avant l'envoi ;
// vidéos de 10 min, 3 h et 9 h. (La loupe de 3.6 est remplacée par la lentille de TimeLens : tests/unit/timelens.test.ts.)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkRange, edgeLimits, initialRange, keyStep, MIN_CLIP_MS, moveEdge, normalize, shiftRange, toMs, toSeconds, type Bounds,
} from "../../src/shared/extrait.ts";

const NB = " ";
const MIN10 = 600_000;
const H3 = 10_800_000;
const H9 = 32_400_000;
const free = (d: number): Bounds => ({ durationMs: d, maxMs: null });
const capped = (d: number, max: number): Bounds => ({ durationMs: d, maxMs: max });

test("passage initial : 30 s depuis l'instant de lecture (avant, autour, après), borné à la vidéo et à la limite du serveur", () => {
  assert.deepEqual(initialRange(83_460, 30_000, "after", free(MIN10)), { startMs: 83_460, endMs: 113_460 });
  assert.deepEqual(initialRange(83_460, 30_000, "before", free(MIN10)), { startMs: 53_460, endMs: 83_460 });
  assert.deepEqual(initialRange(83_460, 30_000, "around", free(MIN10)), { startMs: 68_460, endMs: 98_460 });
  assert.deepEqual(initialRange(5_000, 30_000, "before", free(MIN10)), { startMs: 0, endMs: 30_000 }, "glisse au début");
  assert.deepEqual(initialRange(590_000, 30_000, "after", free(MIN10)), { startMs: 570_000, endMs: 600_000 }, "glisse à la fin");
  assert.deepEqual(initialRange(3_000, 30_000, "after", free(12_000)), { startMs: 0, endMs: 12_000 }, "vidéo plus courte : toute la vidéo");
  assert.deepEqual(initialRange(7_987_800, 30_000, "after", free(H9)), { startMs: 7_987_800, endMs: 8_017_800 }, "9 h");
  assert.deepEqual(initialRange(1_000, 30_000, "after", capped(MIN10, 10_000)), { startMs: 1_000, endMs: 11_000 }, "limite du serveur plus courte");
  assert.deepEqual(initialRange(undefined, 30_000, "after", free(MIN10)), { startMs: 0, endMs: 30_000 }, "instant inconnu : le début");
});

test("poignées (glisser) : bornées à la vidéo, jamais croisées (0,1 s au moins), l'autre suit au-delà de la limite du serveur", () => {
  const r = { startMs: 10_000, endMs: 40_000 };
  assert.deepEqual(moveEdge(r, "start", 39_990, free(MIN10), "drag"), { startMs: 39_900, endMs: 40_000 }, "s'arrête à 0,1 s de la fin");
  assert.deepEqual(moveEdge(r, "end", 0, free(MIN10), "drag"), { startMs: 10_000, endMs: 10_000 + MIN_CLIP_MS });
  assert.deepEqual(moveEdge(r, "start", -500, free(MIN10), "drag"), { startMs: 0, endMs: 40_000 }, "pas avant 0");
  assert.deepEqual(moveEdge(r, "end", 900_000, free(MIN10), "drag"), { startMs: 10_000, endMs: MIN10 }, "pas après la durée");
  assert.deepEqual(moveEdge(r, "end", 100_000, capped(MIN10, 60_000), "drag"), { startMs: 40_000, endMs: 100_000 }, "limite de 60 s : le début suit");
  assert.deepEqual(moveEdge(r, "start", 0, capped(MIN10, 30_000), "drag"), { startMs: 0, endMs: 30_000 }, "limite : la fin suit");
  assert.deepEqual(moveEdge(r, "start", 12_345.6, free(MIN10), "drag"), { startMs: 12_346, endMs: 40_000 }, "millisecondes entières");
});

test("champs et « = lecteur » (set) : début > fin → la fin suit en gardant la durée ; fin < début → le début suit ; bornes", () => {
  const r = { startMs: 10_000, endMs: 40_000 };
  assert.deepEqual(moveEdge(r, "start", 80_000, free(MIN10), "set"), { startMs: 80_000, endMs: 110_000 });
  assert.deepEqual(moveEdge(r, "end", 5_000, free(MIN10), "set"), { startMs: 0, endMs: 5_000 }, "le début recule (borné à 0)");
  assert.deepEqual(moveEdge(r, "start", 590_000, free(MIN10), "set"), { startMs: 590_000, endMs: MIN10 }, "près de la fin : passage raccourci");
  assert.deepEqual(moveEdge(r, "start", MIN10, free(MIN10), "set"), { startMs: MIN10 - MIN_CLIP_MS, endMs: MIN10 }, "début à la fin exacte : 0,1 s");
  assert.deepEqual(moveEdge(r, "end", 0, free(MIN10), "set"), { startMs: 0, endMs: MIN_CLIP_MS });
  assert.deepEqual(moveEdge(r, "end", 1_200_000, capped(H9, MIN10), "set"), { startMs: 600_000, endMs: 1_200_000 }, "au-delà de la limite : le début suit");
  assert.deepEqual(moveEdge({ startMs: 7_987_800, endMs: 8_063_700 }, "start", 8_100_000, free(H9), "set"), { startMs: 8_100_000, endMs: 8_175_900 }, "9 h : 75,9 s gardées");
});

test("passage entier glissé : durée gardée, arrêt aux bords", () => {
  const r = { startMs: 10_000, endMs: 40_000 };
  assert.deepEqual(shiftRange(r, 5_000, free(MIN10)), { startMs: 15_000, endMs: 45_000 });
  assert.deepEqual(shiftRange(r, -50_000, free(MIN10)), { startMs: 0, endMs: 30_000 });
  assert.deepEqual(shiftRange(r, 10_000_000, free(MIN10)), { startMs: 570_000, endMs: 600_000 });
  assert.deepEqual(shiftRange({ startMs: H9 - 60_000, endMs: H9 - 1_000 }, 30_000, free(H9)), { startMs: H9 - 59_000, endMs: H9 });
});

test("normalisation : vidéo très courte, passage hors bornes, limite qui change (format, limites arrivées après coup)", () => {
  assert.deepEqual(normalize({ startMs: -10, endMs: 999_999 }, free(MIN10)), { startMs: 0, endMs: MIN10 });
  assert.deepEqual(normalize({ startMs: 0, endMs: 0 }, free(50)), { startMs: 0, endMs: 50 }, "vidéo de 50 ms");
  assert.deepEqual(normalize({ startMs: 0, endMs: 0 }, free(0)), { startMs: 0, endMs: 0 });
  assert.deepEqual(normalize({ startMs: 100_000, endMs: 400_000 }, capped(MIN10, 120_000)), { startMs: 100_000, endMs: 220_000 }, "nouvelle limite : la fin recule");
  assert.deepEqual(normalize({ startMs: 100_000, endMs: 400_000 }, capped(MIN10, 120_000), "end"), { startMs: 280_000, endMs: 400_000 });
});

test("clavier : flèches 1 image (cadence connue) ou 100 ms, Maj 1 s, Alt 10 ms, Page 10 s, Début/Fin ; Ctrl laissé au navigateur", () => {
  assert.equal(keyStep({ key: "ArrowRight" }), 100);
  assert.equal(keyStep({ key: "ArrowUp" }), 100);
  assert.equal(keyStep({ key: "ArrowLeft" }), -100);
  assert.equal(keyStep({ key: "ArrowDown" }), -100);
  assert.equal(keyStep({ key: "ArrowRight", shiftKey: true }), 1_000);
  assert.equal(keyStep({ key: "ArrowLeft", altKey: true }), -10);
  assert.equal(keyStep({ key: "ArrowRight", altKey: true, shiftKey: true }), 10, "Alt l'emporte (le plus fin)");
  assert.equal(keyStep({ key: "ArrowRight" }, 1000 / 24), 1000 / 24, "une image à 24 i/s");
  assert.equal(keyStep({ key: "ArrowLeft" }, 1000 / 60), -1000 / 60, "une image à 60 i/s");
  assert.equal(keyStep({ key: "ArrowRight" }, 1_000), 100, "cadence invraisemblable : 100 ms");
  assert.equal(keyStep({ key: "ArrowRight", shiftKey: true }, 1000 / 24), 1_000, "Maj : toujours 1 s");
  assert.equal(keyStep({ key: "PageUp" }), 10_000);
  assert.equal(keyStep({ key: "PageDown" }), -10_000);
  assert.equal(keyStep({ key: "Home" }), "home");
  assert.equal(keyStep({ key: "End" }), "end");
  assert.equal(keyStep({ key: "ArrowRight", ctrlKey: true }), null);
  assert.equal(keyStep({ key: "Tab" }), null, "Tab passe à l'autre poignée");
  assert.equal(keyStep({ key: "a" }), null);
  // Bornes d'une poignée (aria-valuemin / aria-valuemax).
  const r = { startMs: 7_987_800, endMs: 8_063_700 };
  assert.deepEqual(edgeLimits(r, "start", free(H9)), { min: 0, max: 8_063_600 });
  assert.deepEqual(edgeLimits(r, "end", free(H9)), { min: 7_987_900, max: H9 });
  // Une suite de pas reste en millisecondes entières (image de 41,667 ms).
  let x = { startMs: 1_000, endMs: 5_000 };
  for (let i = 0; i < 7; i++) x = moveEdge(x, "start", x.startMs + (keyStep({ key: "ArrowRight" }, 1000 / 24) as number), free(MIN10), "drag");
  assert.ok(Number.isInteger(x.startMs) && Math.abs(x.startMs - (1_000 + 7 * 41.667)) <= 4, `${x.startMs}`);
});

test("vérification avant l'envoi : ordre, négatif, trop court, au-delà de la durée, au-delà de la limite du serveur ; durée inconnue", () => {
  assert.deepEqual(checkRange({ startMs: 0, endMs: 30_000 }, { durationMs: MIN10, maxMs: MIN10 }), { ok: true });
  assert.deepEqual(checkRange({ startMs: 7_987_800, endMs: 8_063_700 }, { durationMs: H9, maxMs: MIN10 }), { ok: true }, "75,9 s dans 9 h");
  const bad = (r: { startMs: number; endMs: number }, b: { durationMs: number | null; maxMs: number | null }) => {
    const c = checkRange(r, b);
    assert.equal(c.ok, false);
    return c as { ok: false; problem: string; message: string };
  };
  assert.equal(bad({ startMs: -1, endMs: 10 }, { durationMs: MIN10, maxMs: null }).problem, "negative");
  assert.equal(bad({ startMs: 10_000, endMs: 10_000 }, { durationMs: MIN10, maxMs: null }).problem, "order");
  assert.equal(bad({ startMs: 10_000, endMs: 10_050 }, { durationMs: MIN10, maxMs: null }).problem, "too_short");
  const beyond = bad({ startMs: 0, endMs: 600_001 }, { durationMs: MIN10, maxMs: null });
  assert.equal(beyond.problem, "beyond_duration");
  assert.equal(beyond.message, "La fin dépasse la durée de la vidéo (00:10:00.000).");
  const long = bad({ startMs: 0, endMs: 660_000 }, { durationMs: H3, maxMs: MIN10 });
  assert.equal(long.problem, "too_long");
  assert.equal(long.message, `Le serveur accepte des extraits de 10${NB}min au plus${NB}: raccourcis le passage.`);
  assert.deepEqual(checkRange({ startMs: 0, endMs: 3 * 3_600_000 }, { durationMs: null, maxMs: null }), { ok: true }, "durée et limite inconnues : le serveur juge");
  assert.equal(bad({ startMs: 0.5, endMs: 10 }, { durationMs: MIN10, maxMs: null }).problem, "order", "jamais de fraction de milliseconde");
});

test("secondes (messages internes) ↔ millisecondes entières (serveur)", () => {
  assert.deepEqual(toMs({ start: 7987.8, end: 8063.7 }), { startMs: 7_987_800, endMs: 8_063_700 });
  assert.deepEqual(toMs({ start: 0.1 + 0.2, end: 1.0000001 }), { startMs: 300, endMs: 1_000 }, "flottants arrondis");
  assert.deepEqual(toSeconds({ startMs: 7_987_800, endMs: 8_063_700 }), { start: 7987.8, end: 8063.7 });
  for (let ms = 0; ms < 32_400_000; ms += 777_777) assert.equal(toMs(toSeconds({ startMs: ms, endMs: ms + 1 })).startMs, ms);
});

// 3.8.0 : la loupe (src/extrait/loupe.ts) est remplacée par la lentille de TimeLens : tests/unit/timelens.test.ts.

// 3.8.0 (TimeLens) : modèle pur de l'écran Extrait (src/shared/timelens.ts) — vecteurs de D-SPEC §A.3 et §A.10.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyPreset, dragEdge, edgePan, effectiveRange, hint, HINT_REPEAT_MS, keepVisible, lensSpan, lensWindowAt, nearLimit, presetBlock,
  presetChecked, rubber, snap, type EditorEvent, type HintMemory,
} from "../../src/shared/timelens.ts";

const B10 = { durationMs: 600_000, maxMs: 600_000 };

test("applyPreset : depuis le début, recul à la fin de la vidéo, désactivé au-delà de la vidéo ou du format", () => {
  const r = { startMs: 12_500, endMs: 42_500 };
  assert.deepEqual(applyPreset(r, 15_000, B10, 600_000), { startMs: 12_500, endMs: 27_500 });
  assert.deepEqual(applyPreset(r, 120_000, B10, 600_000), { startMs: 12_500, endMs: 132_500 });
  assert.deepEqual(applyPreset({ startMs: 590_000, endMs: 595_000 }, 30_000, B10, 600_000), { startMs: 570_000, endMs: 600_000 });
  assert.equal(applyPreset({ startMs: 0, endMs: 5_000 }, 30_000, { durationMs: 20_000, maxMs: 600_000 }, 600_000), null, "plus long que la vidéo");
  assert.equal(applyPreset(r, 60_000, B10, 30_000), null, "GIF de 30 s");
  assert.deepEqual(applyPreset(r, 30_000, B10, 30_000), { startMs: 12_500, endMs: 42_500 }, "30 s en GIF : permis");
  assert.equal(presetBlock(30_000, 20_000, null), "video");
  assert.equal(presetBlock(60_000, 600_000, 30_000), "format");
  assert.equal(presetBlock(60_000, null, null), null, "durée inconnue : permis");
});

test("presetChecked : à 1 ms près", () => {
  assert.equal(presetChecked({ startMs: 0, endMs: 30_000 }, 30_000), true);
  assert.equal(presetChecked({ startMs: 0, endMs: 30_001 }, 30_000), true);
  assert.equal(presetChecked({ startMs: 0, endMs: 30_002 }, 30_000), false);
});

test("dragEdge : l'autre borne ne bouge JAMAIS ; butée à la limite (overMs), aux bords et à 100 ms", () => {
  const r = { startMs: 60_000, endMs: 90_000 };
  const big = { durationMs: 32_400_000, maxMs: 600_000 };
  let x = dragEdge(r, "end", 1_000_000, big);
  assert.deepEqual(x.range, { startMs: 60_000, endMs: 660_000 }, "fin = début + G exactement");
  assert.equal(x.overMs, 1_000_000 - 660_000);
  x = dragEdge(r, "start", 0, { durationMs: 32_400_000, maxMs: 60_000 });
  assert.deepEqual(x.range, { startMs: 30_000, endMs: 90_000 }, "début = fin − G, la fin reste");
  assert.equal(x.overMs, 30_000);
  x = dragEdge(r, "end", 10_000, big);
  assert.deepEqual(x.range, { startMs: 60_000, endMs: 60_100 }, "jamais de croisement");
  assert.equal(x.overMs, 0);
  x = dragEdge(r, "start", -5_000, big);
  assert.deepEqual(x.range, { startMs: 0, endMs: 90_000 });
  x = dragEdge(r, "end", 99_999_999, { durationMs: 120_000, maxMs: null });
  assert.deepEqual(x.range, { startMs: 60_000, endMs: 120_000 }, "G inconnu : bornée à la vidéo seulement");
  assert.equal(x.overMs, 0);
});

test("rubber, nearLimit, snap (29,97 im/s, cadence inconnue)", () => {
  assert.equal(rubber(0), 0);
  assert.equal(rubber(18), 9);
  assert.ok(rubber(10_000) < 18 && rubber(10_000) > 17.9);
  assert.equal(rubber(-4), 0);
  assert.equal(nearLimit(539_999, 600_000), false);
  assert.equal(nearLimit(540_000, 600_000), true);
  assert.equal(nearLimit(540_000, null), false);
  const f = 1000 / 29.97;
  assert.equal(snap(1_000, f), Math.round(30 * f));
  assert.equal(snap(1_234, null), 1_230);
  assert.equal(snap(1_236, 2), 1_240, "cadence hors plage : aux 10 ms");
});

test("lentille : 4 s ou la vidéo, fenêtre figée sous le pointeur SANS bornage, défilement aux bords, rattrapage juste assez", () => {
  assert.equal(lensSpan(600_000), 4_000);
  assert.equal(lensSpan(2_500), 2_500);
  const msPerPx = 4_000 / 300;
  const w = lensWindowAt(1_000, 200, 10, msPerPx, 4_000);
  assert.ok(Math.abs(w.w0 - (1_000 - 190 * msPerPx)) < 1e-9 && w.w0 < 0, "hors vidéo (avant 0) gardé, pas de saut");
  assert.equal(w.w1 - w.w0, 4_000);
  assert.equal(edgePan(160, 10, 300, 4_000, 1_000), 0, "milieu : rien");
  assert.equal(edgePan(310, 10, 300, 4_000, 1_000), 3_000, "hors bande à droite : 3 s par seconde");
  assert.equal(edgePan(0, 10, 300, 4_000, 500), -1_500, "hors bande à gauche : vers le passé");
  assert.ok(Math.abs(edgePan(298, 10, 300, 4_000, 1_000) - 3_000 * (12 / 24) ** 2) < 1e-9, "profondeur 12 px : quart de la vitesse");
  assert.equal(keepVisible(0, 2_000, msPerPx, 300), 0, "au milieu : la fenêtre ne bouge pas");
  const w2 = keepVisible(0, 3_900, msPerPx, 300);
  assert.ok(Math.abs((3_900 - w2) / msPerPx - 276) < 1e-9, "glisse juste assez : aiguille à 24 px du bord droit");
});

test("effectiveRange : GIF non destructif (seul le début est exporté)", () => {
  const r = { startMs: 10_000, endMs: 85_000 };
  assert.deepEqual(effectiveRange(r, 30_000), { startMs: 10_000, endMs: 40_000 });
  assert.deepEqual(effectiveRange(r, null), r);
  assert.deepEqual(effectiveRange(r, 600_000), r);
  assert.notEqual(effectiveRange(r, null), r, "copie, jamais l'état lui-même");
});

test("hint : quatre règles, une par ouverture, 7 jours, désactivation (horloge injectée)", () => {
  const mem = (o: Partial<HintMemory> = {}): HintMemory => ({ off: false, last: {}, shownThisOpen: false, ...o });
  const t0 = 1_000_000;
  const open: EditorEvent = { type: "open", at: t0 };
  assert.equal(hint([open], t0 + 9_999, mem()), null);
  assert.equal(hint([open], t0 + 10_000, mem()), "inaction");
  assert.equal(hint([open, { type: "pointer", at: t0 + 1 }], t0 + 20_000, mem()), null, "une interaction : pas d'inaction");
  const choices: EditorEvent[] = [open, { type: "preset", at: t0 + 1_000 }, { type: "format", at: t0 + 3_000 }, { type: "preset", at: t0 + 8_500 }];
  assert.equal(hint(choices, t0 + 8_600, mem()), "hesitation");
  assert.equal(hint([open, { type: "preset", at: t0 }, { type: "preset", at: t0 + 5_000 }, { type: "preset", at: t0 + 9_000 }], t0 + 9_100, mem()), null, "3 choix en 9 s : non");
  assert.equal(hint([open, { type: "limit-bump", at: t0 + 2 }], t0 + 3, mem()), "butee");
  const coarse: EditorEvent[] = [open, { type: "coarse-drag-end", at: t0 + 1 }, { type: "coarse-drag-end", at: t0 + 2 }];
  assert.equal(hint(coarse, t0 + 3, mem()), "precision");
  assert.equal(hint([...coarse, { type: "fine-used", at: t0 + 3 }], t0 + 4, mem()), null, "lentille déjà utilisée");
  assert.equal(hint([open], t0 + 10_000, mem({ shownThisOpen: true })), null, "une par ouverture");
  assert.equal(hint([open], t0 + 10_000, mem({ off: true })), null, "désactivées");
  assert.equal(hint([open], t0 + 10_000, mem({ last: { inaction: t0 - 1_000 } })), null, "déjà vue il y a moins de 7 jours");
  assert.equal(hint([open], t0 + 10_000, mem({ last: { inaction: t0 + 10_000 - HINT_REPEAT_MS } })), "inaction", "7 jours après");
  assert.equal(hint([{ type: "limit-bump", at: t0 - 5 }, open], t0 + 1, mem()), null, "seulement depuis la dernière ouverture");
  assert.equal(hint([open, { type: "limit-bump", at: t0 + 1 }, { type: "export", at: t0 + 2 }], t0 + 3, mem()), null, "jamais après l'export");
});

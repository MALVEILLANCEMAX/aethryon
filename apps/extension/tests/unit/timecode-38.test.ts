// 3.8.0 (TimeLens) : formats de l'écran Extrait (src/shared/timecode.ts) — vecteurs de D-SPEC §A.3.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDureeHorloge, formatInstantCourt, formatLentille, formatParle } from "../../src/shared/timecode.ts";

const NB = "\u00a0";

test("formatDureeHorloge : dixièmes seulement s'ils ne sont pas nuls, arrondi au dixième", () => {
  const v: [number, string][] = [[30_000, "0:30"], [42_500, "0:42.5"], [75_900, "1:15.9"], [600_000, "10:00"], [4_500, "0:04.5"], [59_960, "1:00"], [3_723_000, "1:02:03"], [100, "0:00.1"], [0, "0:00"]];
  for (const [ms, want] of v) assert.equal(formatDureeHorloge(ms), want, String(ms));
});

test("formatInstantCourt : heures sur demande", () => {
  assert.equal(formatInstantCourt(12_500), "0:12.5");
  assert.equal(formatInstantCourt(83_000), "1:23");
  assert.equal(formatInstantCourt(83_000, { hours: true }), "0:01:23");
  assert.equal(formatInstantCourt(7_987_800, { hours: true }), "2:13:07.8");
});

test("formatLentille : minutes, secondes et millisecondes", () => {
  assert.equal(formatLentille(83_400), "1:23.400");
  assert.equal(formatLentille(83_400, { hours: true }), "0:01:23.400");
});

test("formatParle : lecteurs d'écran, singulier en dessous de 2", () => {
  const v: [number, string][] = [
    [12_500, `12,5${NB}secondes`], [1_000, `1${NB}seconde`], [1_500, `1,5${NB}seconde`], [83_400, `1${NB}minute 23,4${NB}secondes`],
    [600_000, `10${NB}minutes`], [7_987_800, `2${NB}heures 13${NB}minutes 7,8${NB}secondes`], [0, `0${NB}seconde`], [3_600_000, `1${NB}heure`],
  ];
  for (const [ms, want] of v) assert.equal(formatParle(ms), want, String(ms));
});

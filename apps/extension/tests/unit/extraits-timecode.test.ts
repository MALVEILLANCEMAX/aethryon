// 3.6.0 : timecodes des extraits (src/shared/timecode.ts) — saisie libre normalisée en HH:MM:SS.mmm, millisecondes
// entières, vidéos de plusieurs heures (jusqu'à 9 h et au-delà), refus expliqués.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatLength, formatLimit, formatShort, formatTick, formatTimecode, MAX_TIMECODE_MS, parseTimecode, timecodeErrorText,
} from "../../src/shared/timecode.ts";

const NB = " ";
const ok = (raw: string) => {
  const r = parseTimecode(raw);
  assert.equal(r.ok, true, `« ${raw} » devrait être accepté (${JSON.stringify(r)})`);
  return (r as { ok: true; ms: number }).ms;
};
const ko = (raw: string) => {
  const r = parseTimecode(raw);
  assert.equal(r.ok, false, `« ${raw} » devrait être refusé (${JSON.stringify(r)})`);
  return (r as { ok: false; error: string }).error;
};

test("format HH:MM:SS.mmm : toujours complet, millisecondes entières, 9 h et plus", () => {
  assert.equal(formatTimecode(0), "00:00:00.000");
  assert.equal(formatTimecode(80_000), "00:01:20.000");
  assert.equal(formatTimecode(5_445_500), "01:30:45.500");
  assert.equal(formatTimecode(7_987_800), "02:13:07.800");
  assert.equal(formatTimecode(32_400_000), "09:00:00.000");
  assert.equal(formatTimecode(32_399_999), "08:59:59.999");
  assert.equal(formatTimecode(80_000.4), "00:01:20.000", "arrondi à la milliseconde");
  assert.equal(formatTimecode(80_000.6), "00:01:20.001");
  assert.equal(formatTimecode(-5), "00:00:00.000", "jamais négatif");
  assert.equal(formatTimecode(Number.NaN), "00:00:00.000");
});

test("saisies du brief : 00:01:20, 01:30:45.500, 02:13:07.800 ; saisies partielles « 1:20 », « 80 », « 1:30:45.5 »", () => {
  assert.equal(ok("00:01:20"), 80_000);
  assert.equal(ok("01:30:45.500"), 5_445_500);
  assert.equal(ok("02:13:07.800"), 7_987_800);
  assert.equal(ok("02:14:23.700"), 8_063_700);
  assert.equal(ok("1:20"), 80_000, "min:s");
  assert.equal(ok("80"), 80_000, "secondes seules");
  assert.equal(ok("1:30:45.5"), 5_445_500, "h:min:s.d");
  assert.equal(ok("4000"), 4_000_000, "secondes au-delà d'une heure");
  assert.equal(ok("90:00"), 5_400_000, "le premier champ peut dépasser 59 (90 minutes)");
  assert.equal(ok("1:5"), 65_000, "un seul chiffre accepté");
  assert.equal(ok("0:05:00.5"), 300_500);
  assert.equal(ok("9:00:00"), 32_400_000, "9 h");
  assert.equal(ok("8:59:59.999"), 32_399_999);
});

test("décimales : point ou virgule, arrondi à la milliseconde, « .5 », millisecondes seules", () => {
  assert.equal(ok("80,5"), 80_500);
  assert.equal(ok("80.5"), 80_500);
  assert.equal(ok("95,25"), 95_250);
  assert.equal(ok(".5"), 500);
  assert.equal(ok(",25"), 250);
  assert.equal(ok("12."), 12_000, "point final sans chiffre");
  assert.equal(ok("1:20.1234"), 80_123, "au-delà de 3 chiffres : arrondi");
  assert.equal(ok("1:20.9996"), 81_000, "arrondi qui passe à la seconde suivante");
  assert.equal(ok("0.001"), 1);
});

test("espaces, insécables et unités : « 1 : 20 », « 1 h 20 min », « 2h13m7.8s », « 90 s », « 500 ms »", () => {
  assert.equal(ok("  1 : 20  "), 80_000);
  assert.equal(ok(`1${NB}:${NB}20`), 80_000);
  assert.equal(ok("1 h 20 min"), 4_800_000);
  assert.equal(ok("2h13m7.8s"), 7_987_800);
  assert.equal(ok("2 heures"), 7_200_000);
  assert.equal(ok("90 s"), 90_000);
  assert.equal(ok("5 min"), 300_000);
  assert.equal(ok("500 ms"), 500);
  assert.equal(ok("1 min 30 s"), 90_000);
  assert.equal(ok("１:２０"), 80_000, "chiffres pleine chasse normalisés (NFKC)");
});

test("refus expliqués : vide, illisible, minutes ou secondes ≥ 60, négatif, au-delà de 24 h", () => {
  assert.equal(ko(""), "empty");
  assert.equal(ko("   "), "empty");
  assert.equal(ko("abc"), "invalid");
  assert.equal(ko("1:20:"), "invalid");
  assert.equal(ko(":20"), "invalid");
  assert.equal(ko("1::2"), "invalid");
  assert.equal(ko("1.2.3"), "invalid");
  assert.equal(ko("1:2:3:4"), "invalid");
  assert.equal(ko("."), "invalid");
  assert.equal(ko("1h20x"), "invalid");
  assert.equal(ko("1:75"), "range", "secondes ≥ 60");
  assert.equal(ko("1:60:00"), "range", "minutes ≥ 60");
  assert.equal(ko("-5"), "negative");
  assert.equal(ko("−1:20"), "negative", "signe moins typographique");
  assert.equal(ko("-"), "invalid");
  assert.equal(ko("25:00:00"), "too_long");
  assert.equal(ok("-0"), 0, "moins zéro : zéro");
  assert.equal(ok("24:00:00"), MAX_TIMECODE_MS, "24 h tout juste");
  for (const e of ["empty", "invalid", "negative", "range", "too_long"] as const) {
    const t = timecodeErrorText(e);
    assert.ok(t.length > 10);
    assert.doesNotMatch(t, / [?!:;%»]/, `typographie : ${t}`);
    assert.doesNotMatch(t, /'/, `apostrophe typographique : ${t}`);
  }
});

test("aller-retour : tout timecode formaté se relit à l'identique (pas de 1 ms, de 0 à 9 h)", () => {
  for (let ms = 0; ms <= 32_400_000; ms += 1_234_567) assert.equal(ok(formatTimecode(ms)), ms);
  for (const ms of [0, 1, 999, 1_000, 59_999, 60_000, 3_599_999, 3_600_000, 32_400_000]) assert.equal(ok(formatTimecode(ms)), ms);
});

test("formes courtes : infobulles, graduations, durées et limites (typographie française)", () => {
  assert.equal(formatShort(80_500), "1:20.500");
  assert.equal(formatShort(80_500, { digits: 1 }), "1:20.5");
  assert.equal(formatShort(80_500, { digits: 0 }), "1:20");
  assert.equal(formatShort(80_500, { hours: true }), "0:01:20.500");
  assert.equal(formatShort(7_987_800), "2:13:07.800");
  assert.equal(formatShort(32_400_000, { digits: 0 }), "9:00:00");
  assert.equal(formatTick(10_000), "0:10");
  assert.equal(formatTick(7_500), "0:07.5");
  assert.equal(formatTick(7_250), "0:07.250");
  assert.equal(formatTick(7_200_000), "2:00:00");
  assert.equal(formatLength(500), `0,5${NB}s`);
  assert.equal(formatLength(30_000), `30${NB}s`);
  assert.equal(formatLength(75_900), `1${NB}min 15,9${NB}s`);
  assert.equal(formatLength(600_000), `10${NB}min`);
  assert.equal(formatLength(59_990), `1${NB}min`, "arrondi au dixième qui atteint la minute");
  assert.equal(formatLength(7_500_000), `2${NB}h${NB}05${NB}min`);
  assert.equal(formatLength(32_400_000), `9${NB}h`);
  assert.equal(formatLimit(30_000), `30${NB}s`);
  assert.equal(formatLimit(600_000), `10${NB}min`);
  assert.equal(formatLimit(90_000), `1${NB}min 30${NB}s`);
  assert.equal(formatLimit(3_600_000), `1${NB}h`);
  assert.equal(formatLimit(5_400_000), `1${NB}h 30${NB}min`);
});

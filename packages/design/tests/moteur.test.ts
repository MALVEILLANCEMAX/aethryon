// Moteur de thèmes : couleur, six thèmes, 27 contrastes, 1 000 thèmes au hasard, correction automatique.
//   node --test design/tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { apca, contraste, hexVersOklch, oklch } from "../src/couleur.ts";
import { PAIRES, contrastesConformes, corrigerContrastes, resoudreTheme, verifierContrastes } from "../src/moteur.ts";
import { normaliserDoc } from "../src/schema.ts";
import { BASES, CUSTOM_EXEMPLE, OFFICIELS, ROLES, docOfficiel } from "../src/themes.ts";
import { prng, themeGenere, themeRetouche } from "./aleatoire.ts";

const SIX = [...BASES.map((b) => docOfficiel(b)), normaliserDoc(CUSTOM_EXEMPLE)];

test("couleur : contraste WCAG, OKLCH aller-retour, APCA de référence", () => {
  assert.equal(Math.round(contraste("#000000", "#FFFFFF") * 100) / 100, 21);
  assert.equal(contraste("#777777", "#777777"), 1);
  for (const hex of ["#101113", "#C2A066", "#FAF8F3", "#5E8FB8", "#000000", "#FFFFFF"]) {
    const [L, C, H] = hexVersOklch(hex);
    assert.equal(oklch(L, C, H), hex, hex);
  }
  // Valeurs publiées par l'APCA-W3 (0.0.98G) : noir sur blanc 106,04 ; blanc sur noir -107,88.
  assert.equal(Math.round(apca("#000000", "#FFFFFF") * 100) / 100, 106.04);
  assert.equal(Math.round(apca("#FFFFFF", "#000000") * 100) / 100, -107.88);
  // Hors gamut : la chroma est réduite, la couleur reste valide.
  assert.match(oklch(0.7, 0.4, 145), /^#[0-9A-F]{6}$/);
});

test("27 paires contrôlées, toutes présentes dans les rôles et dérivés", () => {
  assert.equal(PAIRES.length, 27);
  for (const [a] of PAIRES) assert.ok((ROLES as readonly string[]).includes(a));
});

test("les six thèmes passent les 27 paires (WCAG 2.x AA)", () => {
  for (const d of SIX) {
    const r = resoudreTheme(d);
    const echecs = verifierContrastes(r).filter((m) => !m.ok);
    assert.deepEqual(echecs, [], `${d.name} : ${echecs.map((e) => `${e.a}/${e.b} ${e.v}`).join(", ")}`);
  }
});

test("port fidèle : valeurs du tableau DESIGN_SYSTEM.md § 3.2 (démonstration validée)", () => {
  const v = (d: Parameters<typeof resoudreTheme>[0], a: string, b: string) => verifierContrastes(resoudreTheme(d)).find((m) => m.a === a && m.b === b)?.v;
  assert.equal(v(docOfficiel("obsidian"), "text", "canvas"), 15.48);
  assert.equal(v(docOfficiel("ivory"), "thread", "surface"), 3.12);
  assert.equal(v(docOfficiel("minimal"), "control", "canvas"), 3.18);
  assert.equal(v(docOfficiel("midnight"), "on-accent", "accent"), 10.57);
  assert.equal(v(docOfficiel("oled"), "err", "err-soft"), 7.17);
  assert.equal(v(normaliserDoc(CUSTOM_EXEMPLE), "text", "canvas"), 15.83);
  assert.equal(v(normaliserDoc(CUSTOM_EXEMPLE), "control", "surface"), 3.35);
});

test("un thème officiel sans retouche garde EXACTEMENT ses valeurs", () => {
  for (const b of BASES) {
    const r = resoudreTheme(docOfficiel(b));
    assert.equal(r.officiel, true);
    assert.deepEqual(r.c, OFFICIELS[b].c);
  }
  assert.equal(resoudreTheme(normaliserDoc(CUSTOM_EXEMPLE)).officiel, false);
});

test("1 000 thèmes générés au hasard : 0 paire sous le seuil (standard et élevé)", () => {
  const r = prng(20261026);
  let eleves = 0;
  for (let i = 0; i < 1000; i++) {
    const d = themeGenere(r, i);
    if (d.seeds?.contrast === "eleve") eleves++;
    const t = resoudreTheme(d);
    const echecs = verifierContrastes(t).filter((m) => !m.ok);
    assert.equal(echecs.length, 0, `thème ${i} (${JSON.stringify(d.seeds)}, base ${d.base}) : ${echecs.map((e) => `${e.a}/${e.b} ${e.v}<${e.seuil}`).join(", ")}`);
  }
  assert.ok(eleves > 200, "le tirage couvre aussi le contraste élevé");
});

test("retouches libres : jamais corrigées en silence ; « Corriger » n'aggrave jamais et ne modifie pas l'entrée", () => {
  const r = prng(7);
  let avant = 0, apres = 0;
  for (let i = 0; i < 500; i++) {
    const t = resoudreTheme(themeRetouche(r, i));
    const copie = JSON.stringify(t);
    const e0 = verifierContrastes(t).filter((m) => !m.ok).length;
    const { theme, corrections } = corrigerContrastes(t);
    assert.equal(JSON.stringify(t), copie, "entrée inchangée");
    const e1 = verifierContrastes(theme).filter((m) => !m.ok).length;
    if (e0) avant++;
    if (e1) apres++;
    assert.ok(e1 <= e0, `retouche ${i} : ${e0} -> ${e1}`);
    if (e0 && !e1) assert.ok(corrections.length > 0);
  }
  // Mesure de la démonstration (THEME_ENGINE.md § 11) : 491 en échec avant, 64 après. Le port reste dans ces ordres.
  assert.ok(avant > 450, `en échec avant correction : ${avant}`);
  assert.ok(apres < 100, `encore en échec après correction : ${apres}`);
  console.log(`  retouches libres : ${avant}/500 en échec avant, ${apres}/500 après « Corriger » (non applicables)`);
});

test("contraste élevé : seuils 7 / 4,5", () => {
  const t = resoudreTheme({ ...docOfficiel("obsidian"), seeds: { contrast: "eleve" } });
  assert.deepEqual(t.seuils, { texte: 7, ui: 4.5 });
  assert.ok(contrastesConformes(t));
  assert.ok(verifierContrastes(t).every((m) => m.seuil === 7 || m.seuil === 4.5));
});

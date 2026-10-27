// Persistance (stockage local avec repli, clé versionnée, relecture revalidée), script de démarrage, variables CSS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { resoudreTheme } from "../src/moteur.ts";
import { CLE_APPARENCE, creerPersistance, lirePreference, stockageMemoire, type Stockage } from "../src/persistance.ts";
import { normaliserDoc } from "../src/schema.ts";
import { BASES, CUSTOM_EXEMPLE, docOfficiel, type DocTheme } from "../src/themes.ts";
import { ATTRIBUTS, VARIABLES_VALEUR, variablesTheme } from "../src/variables.ts";
import { prng, themeGenere } from "./aleatoire.ts";

const ICI = import.meta.dirname;
const EGEE = JSON.parse(readFileSync(join(ICI, "fixtures/v1/egee-essai.json"), "utf8")) as DocTheme;
const BOOT = readFileSync(join(ICI, "../genere/theme-boot.js"), "utf8");

test("écriture puis relecture : thème officiel, puis thème personnel gardé en passant à un officiel", () => {
  const s = stockageMemoire();
  const p = creerPersistance({ stockage: s });
  assert.equal(p.persistant, true);
  assert.equal(p.lire().actif, "obsidian");
  assert.equal(p.ecrire({ actif: "ivory" }), true);
  assert.equal(p.lire().actif, "ivory");
  assert.equal(p.ecrire({ actif: "custom", perso: EGEE }), true);
  assert.equal(p.lire().perso?.name, "Égée (essai)");
  p.ecrire({ actif: "midnight" });
  const l = p.lire();
  assert.equal(l.actif, "midnight");
  assert.equal(l.perso?.id, "perso.egee-essai", "le thème personnel reste disponible");
  const brut = JSON.parse(s.getItem(CLE_APPARENCE) ?? "{}");
  assert.equal(brut.v, 1);
  assert.deepEqual(brut.cache.vars, {}, "officiel : aucune variable en ligne, la feuille suffit");
  assert.equal(brut.cache.attrs[ATTRIBUTS.theme], "midnight");
  p.effacer();
  assert.equal(p.lire().actif, "obsidian");
});

test("repli : stockage absent, qui lève, ou plein -> jamais d'exception, préférence gardée pour la session", () => {
  const leve: Stockage = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("SecurityError"); }, removeItem() { throw new Error("SecurityError"); } };
  for (const stockage of [null, leve]) {
    const p = creerPersistance({ stockage });
    assert.doesNotThrow(() => p.lire());
    assert.equal(p.ecrire({ actif: "oled" }), false, "pas gardé durablement");
    assert.equal(p.lire().actif, "oled", "mais gardé pour la session");
    assert.equal(p.persistant, false);
    assert.doesNotThrow(() => p.effacer());
  }
  // Quota plein : la lecture marche, l'écriture échoue ; la mémoire prime ensuite.
  const vrai = stockageMemoire();
  vrai.setItem(CLE_APPARENCE, JSON.stringify({ v: 1, actif: "ivory", perso: null, cache: null, maj: 1 }));
  const plein: Stockage = { getItem: (k) => vrai.getItem(k), setItem() { throw new Error("QuotaExceededError"); }, removeItem: (k) => vrai.removeItem(k) };
  const p = creerPersistance({ stockage: plein });
  assert.equal(p.lire().actif, "ivory");
  assert.equal(p.ecrire({ actif: "minimal" }), false);
  assert.equal(p.lire().actif, "minimal");
});

test("relecture : enregistrement abîmé, d'une autre version ou trafiqué -> ignoré (Obsidian), jamais appliqué", () => {
  for (const brut of [null, "", "{", "[]", "null", JSON.stringify({ v: 2, actif: "ivory" }), JSON.stringify({ v: 1, actif: "dracula" }), "x".repeat(70000)]) {
    assert.equal(lirePreference(brut).actif, "obsidian", String(brut).slice(0, 30));
  }
  const trafique = { v: 1, actif: "custom", perso: { ...EGEE, tokens: { "c-text": "url(https://exemple.test/x)" } }, cache: null, maj: 3 };
  const l = lirePreference(JSON.stringify(trafique));
  assert.equal(l.perso, null, "thème personnel invalide écarté");
  assert.equal(l.actif, "custom", "« custom » sans thème personnel = l'exemple Vert-de-gris");
});

test("clé versionnée et identique dans le script de démarrage", () => {
  assert.equal(CLE_APPARENCE, "aethryon.apparence.v1");
  assert.ok(BOOT.includes(`"${CLE_APPARENCE}"`), "theme-boot.js lit la même clé");
  assert.ok(Buffer.byteLength(BOOT) < 1024, `theme-boot.js < 1 Ko (${Buffer.byteLength(BOOT)} o)`);
});

/** Exécute genere/theme-boot.js dans un faux navigateur et rend ce qu'il a posé. */
function demarrer(stocke: string | null, lève = false) {
  const attrs: Record<string, string> = {}, vars: Record<string, string> = {};
  const ctx = {
    localStorage: { getItem: () => { if (lève) throw new Error("SecurityError"); return stocke; } },
    document: { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v; }, style: { setProperty: (k: string, v: string) => { vars[k] = v; } } } },
  };
  runInNewContext(BOOT, ctx);
  return { attrs, vars };
}

test("theme-boot.js : rien sans préférence, applique le cache d'un thème personnel, refuse toute valeur inattendue", () => {
  assert.deepEqual(demarrer(null), { attrs: {}, vars: {} });
  assert.deepEqual(demarrer("{abîmé"), { attrs: {}, vars: {} });
  assert.deepEqual(demarrer("x", true), { attrs: {}, vars: {} });
  const s = stockageMemoire();
  creerPersistance({ stockage: s }).ecrire({ actif: "custom", perso: EGEE });
  const r = demarrer(s.getItem(CLE_APPARENCE));
  const attendu = variablesTheme(resoudreTheme(normaliserDoc(EGEE)));
  assert.deepEqual(r.attrs, attendu.attrs);
  assert.deepEqual(r.vars, attendu.vars);
  // Enregistrement trafiqué : seules les valeurs sûres passent.
  const pirate = { v: 1, cache: {
    attrs: { "data-eg-theme": "custom", onload: "alert(1)", "data-eg-mode": "x\" onclick=\"y", style: "background:red" },
    vars: { "--eg-c-text": "red;background:url(https://exemple.test)", "--eg-c-canvas": "#123456", "--eg-r-panel": "8px", "--autre": "#FFFFFF", "--eg-x": "expression(alert(1))" },
  } };
  const p = demarrer(JSON.stringify(pirate));
  assert.deepEqual(p.attrs, { "data-eg-theme": "custom" });
  assert.deepEqual(p.vars, { "--eg-c-canvas": "#123456", "--eg-r-panel": "8px" });
});

test("variables : le script de démarrage accepte tout ce que le moteur produit (200 thèmes au hasard)", () => {
  const r = prng(99);
  const s = stockageMemoire();
  const p = creerPersistance({ stockage: s });
  for (let i = 0; i < 200; i++) {
    const doc = themeGenere(r, i);
    p.ecrire({ actif: "custom", perso: doc });
    const attendu = variablesTheme(resoudreTheme(normaliserDoc(doc)));
    const obtenu = demarrer(s.getItem(CLE_APPARENCE));
    assert.deepEqual(obtenu.vars, attendu.vars, `thème ${i}`);
    assert.deepEqual(obtenu.attrs, attendu.attrs, `thème ${i}`);
    for (const k of Object.keys(attendu.vars)) assert.ok(VARIABLES_VALEUR.includes(k), k);
  }
});

test("feuille egide.css : chaque thème officiel y porte exactement les valeurs du moteur", () => {
  const css = readFileSync(join(ICI, "../genere/egide.css"), "utf8");
  for (const b of BASES) {
    const sel = b === "obsidian" ? ':root, [data-eg-theme="obsidian"] {' : `[data-eg-theme="${b}"] {`;
    const i = css.indexOf(sel);
    assert.ok(i > 0, sel);
    const blocTexte = css.slice(i, css.indexOf("}", i));
    const { vars, attrs } = variablesTheme(resoudreTheme(docOfficiel(b)));
    assert.equal(attrs[ATTRIBUTS.theme], b);
    for (const [k, v] of Object.entries(vars)) assert.ok(blocTexte.includes(`${k}: ${v};`), `${b} : ${k}: ${v}`);
  }
  assert.equal(variablesTheme(resoudreTheme(normaliserDoc(CUSTOM_EXEMPLE))).theme, "custom");
  assert.ok(!/@import|url\(\s*["']?(https?:|data:)/i.test(css), "aucune ressource externe ni data: dans la feuille");
});

// Validateur strict, migrations, import / export (fichiers d'exemple gardés pour toujours : tests/fixtures/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MIGRATIONS, VERSION_SCHEMA, migrer, renommerJetons, type TableMigrations } from "../src/migrations.ts";
import { exporterTheme, importerTheme, normaliserDoc, validerObjet, validerTexte } from "../src/schema.ts";
import { TAILLE_MAX } from "../src/themes.ts";

const ICI = import.meta.dirname;
const lire = (p: string) => readFileSync(join(ICI, p), "utf8");
const dossier = (d: string) => readdirSync(join(ICI, d)).filter((f) => f.endsWith(".json")).map((f) => [f, lire(join(d, f))] as const);

test("fichiers d'exemple v1 et six thèmes publiés : acceptés, aller-retour export -> import identique", () => {
  const tous = [...dossier("fixtures/v1"), ...dossier("../themes")];
  assert.ok(tous.length >= 11);
  for (const [f, texte] of tous) {
    const v = validerTexte(texte);
    assert.ok(v.ok, `${f} : ${v.ok ? "" : v.erreurs.join(" / ")}`);
    if (!v.ok) continue;
    const export1 = exporterTheme(v.doc);
    const v2 = validerTexte(export1);
    assert.ok(v2.ok, `${f} : export revalidé`);
    if (v2.ok) assert.equal(exporterTheme(v2.doc), export1, `${f} : aller-retour stable`);
  }
});

const ATTENDUS: Record<string, RegExp> = {
  "url-dans-couleur.json": /couleur #RRGGBB uniquement/,
  "var-dans-couleur.json": /couleur #RRGGBB uniquement/,
  "cle-inconnue-script.json": /Clé inconnue à la racine : script/,
  "version-future.json": /version plus récente d'AETHRYON \(schemaVersion 3\)/,
  "json-casse.json": /pas du JSON valide/,
  "trop-lourd.json": /trop lourd : 17 Ko \(16 Ko au plus\)/,
  "prereglage-inconnu.json": /typography\.preset/,
  "prereglage-prototype.json": /typography\.preset/,
  "densite-prototype.json": /density/,
  "proto-pollution.json": /Clé inconnue à la racine : __proto__/,
  "schema-etranger.json": /seule l'adresse du schéma AETHRYON/,
  "nom-bidi.json": /caractères de contrôle ou de direction/,
  "rayon-hors-bornes.json": /r-panel/,
  "graines-tableau.json": /seeds » doit être un objet/,
  "accent-javascript.json": /seeds\.accent/,
  "jeton-non-personnalisable.json": /non personnalisable/,
  "base-inconnue.json": /base » doit être/,
  "id-invalide.json": /« id »/,
  "mouvement-absent.json": /motion\.intensity/,
  "effet-texte.json": /effects\.sheen/,
  "tableau-racine.json": /objet JSON/,
};

test("fichiers invalides : tous refusés, avec un message clair (et rien d'appliqué)", () => {
  const fichiers = dossier("fixtures/invalides");
  assert.equal(fichiers.length, Object.keys(ATTENDUS).length);
  for (const [f, texte] of fichiers) {
    const v = validerTexte(texte);
    assert.equal(v.ok, false, `${f} devait être refusé`);
    if (v.ok) continue;
    const motif = ATTENDUS[f];
    assert.ok(motif, `motif attendu pour ${f}`);
    assert.ok(v.erreurs.some((e) => motif.test(e)), `${f} : ${v.erreurs.join(" / ")}`);
    const imp = importerTheme(texte);
    assert.equal(imp.ok, false, `${f} : import refusé`);
  }
  assert.equal(({} as Record<string, unknown>).polluee, undefined, "aucune pollution de prototype");
});

test("taille : 16 Ko pile accepté par la règle d'octets, un octet de plus refusé", () => {
  const base = { format: "aethryon-theme", schemaVersion: 1, id: "perso.taille", name: "Taille", base: "obsidian", author: "" };
  const vide = JSON.stringify(base).length;
  const juste = JSON.stringify({ ...base, author: "" }).replace('"author":""', `"author":""${" ".repeat(TAILLE_MAX - vide)}`);
  assert.equal(new TextEncoder().encode(juste).length, TAILLE_MAX);
  assert.ok(validerTexte(juste).ok);
  assert.equal(validerTexte(juste + " ").ok, false);
});

test("import : valide mais contrastes en échec -> chargé, NON applicable", () => {
  const texte = JSON.stringify({ format: "aethryon-theme", schemaVersion: 1, id: "perso.illisible", name: "Illisible", base: "obsidian", tokens: { "c-text-2": "#2A2B30" } });
  const r = importerTheme(texte);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.applicable, false);
    assert.ok(r.contrastes.some((m) => !m.ok && m.a === "text-2"));
  }
  const bon = importerTheme(lire("fixtures/v1/egee-essai.json"));
  assert.ok(bon.ok && bon.applicable);
});

test("normaliser : chaque section présente, valeurs de la base", () => {
  const v = validerTexte(lire("fixtures/v1/minimal-champs-requis.json"));
  assert.ok(v.ok);
  if (!v.ok) return;
  const n = normaliserDoc(v.doc);
  assert.deepEqual(n.typography, { preset: "egide", scale: 1 });
  assert.equal(n.density, "standard");
  assert.deepEqual(n.motion, { intensity: "complete" });
  assert.deepEqual(n.effects, { sheen: true, grain: true });
  assert.ok(validerObjet(n).ok);
});

test("migrations : v1 courante, version future ou inconnue refusée, entrée jamais modifiée", () => {
  assert.equal(VERSION_SCHEMA, 1);
  assert.deepEqual(Object.keys(MIGRATIONS), []);
  const doc = JSON.parse(lire("fixtures/v1/egee-essai.json"));
  const gel = JSON.stringify(doc);
  const m = migrer(doc);
  assert.ok(m.ok && m.depuis === 1 && m.rapport.length === 0);
  assert.equal(JSON.stringify(doc), gel);
  for (const v of [0, -1, 1.5, "1", null]) assert.equal(migrer({ ...doc, schemaVersion: v }).ok, false, String(v));
  const futur = migrer({ ...doc, schemaVersion: 2 });
  assert.ok(!futur.ok && /plus récente/.test(futur.erreur));
});

test("migrations : chaîne d'étapes (table fictive 1 -> 2 -> 3), alias de jetons, jetons retirés, étape manquante", () => {
  const table: TableMigrations = {
    1: (d, rapport) => renommerJetons(d, { "c-thread": "c-fil" }, ["c-focus"], rapport),
    2: (d, rapport) => { rapport.push("Nouvelle section « layout » : valeurs de la base."); return { ...d, layout: { queue: "right" } }; },
  };
  const doc = { format: "aethryon-theme", schemaVersion: 1, id: "perso.m", name: "M", base: "obsidian", tokens: { "c-thread": "#C9A86B", "c-focus": "#E2C58E", "r-panel": 4 } };
  const m = migrer(doc, table, 3);
  assert.ok(m.ok);
  if (m.ok) {
    assert.equal(m.doc.schemaVersion, 3);
    assert.deepEqual(m.doc.tokens, { "c-fil": "#C9A86B", "r-panel": 4 });
    assert.deepEqual(m.doc.layout, { queue: "right" });
    assert.equal(m.rapport.length, 3);
  }
  assert.equal(doc.schemaVersion, 1, "entrée intacte");
  const trou = migrer(doc, { 2: table[2]! }, 3);
  assert.ok(!trou.ok && /Aucune migration connue de la version 1/.test(trou.erreur));
});

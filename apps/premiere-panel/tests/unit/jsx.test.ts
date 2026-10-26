// Script hôte ExtendScript (cep/jsx/aethryon.jsx) exécuté dans node:vm contre un FAUX modèle de projet Premiere.
// Cela vérifie sa logique (liste fermée, JSON sans eval, chutier, déduplication, vérification, nettoyage) ;
// le comportement réel de Premiere reste NON TESTÉ DANS PREMIERE.
import { describe, expect, it } from "vitest";
import vm from "node:vm";
import { monde, SOURCE, T, type Item } from "../faux-premiere";

describe("script hôte ExtendScript (faux Premiere)", () => {
  it("liste fermée et charge contrôlée : rien d'autre n'est exécuté", () => {
    const m = monde();
    expect(m.appel("ping")).toMatchObject({ ok: true, premiere: "26.5.2", version: "2.0.0" });
    expect(m.appel("eval")).toMatchObject({ ok: false, code: "refuse" });
    expect(m.appel("hasOwnProperty")).toMatchObject({ ok: false });
    const brut = vm.runInContext(`AETHRYON.appel("ping", "\\"); app.quit(); (\\"")`, m.contexte);
    expect(JSON.parse(brut)).toMatchObject({ ok: false, code: "charge" });
  });
  it("JSON aller-retour sans eval (accents, guillemets, retours, U+2028)", () => {
    const m = monde();
    const j = m.contexte.AETHRYON as { _json: { versJson(v: unknown): string; lireJson(t: string): unknown } };
    const v = { a: "Été « AETHRYON »\n\"x\"\u2028", n: [1, 2.5, -3e2, true, null], o: { "clé": "valeur" } };
    expect(j._json.lireJson(j._json.versJson(v))).toEqual(v);
    expect(JSON.parse(j._json.versJson(v))).toEqual(v);
    expect(() => j._json.lireJson('{"a": 1} ; app.quit()')).toThrow(/JSON invalide/);
  });
  it("importe dans le chutier « AETHRYON » (créé une fois), vérifie dans le projet, ne réimporte jamais", () => {
    const A = "C:\\M\\clip.mp4", B = "C:\\M\\son.mp3";
    const m = monde({ existants: [A, B] });
    const r = m.appel("importer", { chemins: [A, B], mode: "aethryon" });
    expect(r).toMatchObject({ ok: true, chutier: "AETHRYON", projet: "Montage-voyage" });
    expect(r.resultats.map((x: { ok: boolean }) => x.ok)).toEqual([true, true]);
    const bins = m.root.children!.filter((x) => x.type === T.BIN && x.name === "AETHRYON");
    expect(bins).toHaveLength(1);
    expect(bins[0]!.children!).toHaveLength(2);
    const r2 = m.appel("importer", { chemins: ["c:/m/CLIP.mp4".replace(/\//g, "\\")], mode: "aethryon" });
    expect(r2.resultats[0]).toMatchObject({ ok: true, deja: true });
    expect(m.importes).toHaveLength(1);
    expect(m.root.children!.filter((x) => x.name === "AETHRYON")).toHaveLength(1);
  });
  it("chutier sélectionné, racine, fichier absent, import refusé, hors ligne, aucun projet", () => {
    const ok = "C:\\M\\a.mp4", webm = "C:\\M\\b.webm", hl = "C:\\M\\hors-ligne.mp4";
    const m = monde({ existants: [ok, webm, hl], refuse: /\.webm$/ });
    const rushes = (m.root.createBin as (n: string) => Item)("Rushes");
    m.selectionner(rushes);
    expect(m.appel("importer", { chemins: [ok], mode: "selection" })).toMatchObject({ ok: true, chutier: "Rushes" });
    expect(rushes.children!).toHaveLength(1);
    const r = m.appel("importer", { chemins: ["C:\\M\\absent.mp4", webm, hl], mode: "racine" });
    expect(r.ok).toBe(false);
    expect(r.resultats).toEqual([
      { chemin: "C:\\M\\absent.mp4", ok: false, code: "introuvable" },
      { chemin: webm, ok: false, code: "absentApres", detail: "" },
      { chemin: hl, ok: true, horsLigne: true },
    ]);
    expect(monde({ sansProjet: true }).appel("importer", { chemins: [ok] })).toMatchObject({ ok: false, code: "aucunProjet" });
  });
  it("présence dans le projet et dans la séquence (preuves du glisser), insertion à la tête de lecture", () => {
    const A = "C:\\M\\clip.mp4", S = "C:\\M\\son.mp3";
    const m = monde({ existants: [A, S] });
    expect(m.appel("presentsDansProjet", { chemins: [A] }).presents).toEqual([]);
    const r = m.appel("insererTeteLecture", { chemin: A, mode: "aethryon" });
    expect(r).toMatchObject({ ok: true });
    expect(r.message).toMatch(/4\.20 s/);
    expect(m.appel("presentsDansProjet", { chemins: [A, S] }).presents).toEqual([A]);
    expect(m.appel("presentsDansSequence", { chemins: [A, S] })).toMatchObject({ presents: [A], sequence: "Séquence 01" });
    expect(m.appel("insererTeteLecture", { chemin: S, mode: "aethryon" })).toMatchObject({ ok: true });
    expect(m.appel("presentsDansSequence", { chemins: [S] }).presents).toEqual([S]);
  });
  it("essai du diagnostic : chutier temporaire créé, import vérifié, puis supprimé", () => {
    const E = "C:\\R\\essai-aethryon-import.mp4";
    const m = monde({ existants: [E] });
    const r = m.appel("essaiImport", { chemin: E });
    expect(r).toMatchObject({ ok: true, importe: true, nettoye: true });
    expect(r.chutierTemporaire).toMatch(/^AETHRYON · diagnostic /);
    expect(m.root.children!).toHaveLength(0);
  });
  it("ouvre le moniteur source seulement pour un fichier présent", () => {
    const m = monde({ existants: ["C:\\a.mp4"] });
    expect(m.appel("ouvrirMoniteurSource", { chemin: "C:\\a.mp4" })).toMatchObject({ ok: true });
    expect(m.appel("ouvrirMoniteurSource", { chemin: "C:\\b.mp4" })).toMatchObject({ ok: false });
  });
});

describe("syntaxe ExtendScript", () => {
  it("le script hôte est de l'ECMAScript 3 valide (ExtendScript), sans eval ni chargement de fichier", async () => {
    const { parse } = await import("acorn");
    expect(() => parse(SOURCE, { ecmaVersion: 3, sourceType: "script" })).not.toThrow();
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\beval\s*\(|\$\.evalFile|new Function|\bJSON\.|\$\.include/);
  });
});

// Socle Égide dans l'extension (lot 0, câblé au lot 3) : le paquet design/ s'importe (pages), le thème s'applique, la feuille d'une
// racine Shadow DOM (menu injecté du lot 4) est sûre et s'empaquette en content script (IIFE, Chrome 140).
//   node --test extension/tests/unit/egide.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { EGIDE_CSS_SHADOW, docOfficiel, resoudreTheme, variablesTheme, verifierContrastes } from "../../src/shared/egide.ts";

const EXT = join(import.meta.dirname, "..", "..");

test("pages : thème posé avant le premier rendu (theme-boot.js externe), socle puis feuille commune puis feuille de la page", () => {
  for (const page of ["popup", "options", "welcome"]) {
    const html = readFileSync(join(EXT, `src/${page}/${page}.html`), "utf8");
    assert.match(html, new RegExp(`<html lang="fr" class="${page}" data-eg-theme="obsidian">`));
    assert.match(html, /<body class="eg-page">/);
    const boot = html.indexOf('<script src="../egide/genere/theme-boot.js"></script>');
    const socle = html.indexOf("../egide/genere/egide.css");
    const commune = html.indexOf("../egide/extension.css");
    const propre = html.indexOf(`href="${page}.css"`);
    assert.ok(boot > 0 && boot < socle && socle < commune && commune < propre, page);
    assert.match(readFileSync(join(EXT, `src/${page}/${page}.ts`), "utf8"), /demarrerApparence\(document\.documentElement\)/);
  }
  const r = resoudreTheme(docOfficiel("obsidian"));
  assert.ok(verifierContrastes(r).every((m) => m.ok));
  assert.equal(variablesTheme(r).attrs["data-eg-theme"], "obsidian");
});

test("racine Shadow DOM : feuille sans @font-face, sans URL, jetons sur :host et .eg-racine", () => {
  assert.ok(EGIDE_CSS_SHADOW.length > 10000);
  assert.ok(!/@font-face|@import|url\(\s*["']?(https?:|data:|\/\/)/i.test(EGIDE_CSS_SHADOW));
  assert.ok(EGIDE_CSS_SHADOW.includes(":host,.eg-racine{"));
  assert.ok(!EGIDE_CSS_SHADOW.includes(":root"));
});

test("content script : creerRacineOmbre s'empaquette en IIFE pour Chrome 140, sans adresse de test", async () => {
  const r = await build({
    stdin: { contents: 'import { creerRacineOmbre, bouton } from "./src/shared/egide.ts"; const h = document.createElement("div"); creerRacineOmbre(h).enveloppe.append(bouton({ libelle: "Télécharger 30 s", variante: "principal" }));', resolveDir: EXT, loader: "ts" },
    bundle: true, write: false, minify: true, format: "iife", target: "chrome140", logLevel: "silent",
  });
  const js = r.outputFiles[0]?.text ?? "";
  assert.ok(js.length > 20000 && js.length < 120000, `${js.length} octets`);
  assert.ok(!/localhost|127\.0\.0\.1|pr[eé]prod|sourceMappingURL|\beval\(|new Function\(/i.test(js));
  console.log(`  content script minimal avec racine Égide : ${(js.length / 1024).toFixed(1)} Kio minifié`);
});

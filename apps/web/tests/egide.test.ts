// Socle Égide dans le site (lot 0) : la copie src/egide est celle de design/ (contrôle complet : design/scripts/build.mjs
// --check), le site l'importe et applique Obsidian ; le thème reste une donnée validée.
//   node --test web/tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLE_APPARENCE, docOfficiel, importerTheme, resoudreTheme, variablesTheme, verifierContrastes } from "../src/lib/egide.ts";

const WEB = join(import.meta.dirname, "..");

test("le site déclare Obsidian et charge la feuille Égide après celle de Tailwind (ordre des couches gardé)", () => {
  assert.match(readFileSync(join(WEB, "index.html"), "utf8"), /<html lang="fr" data-eg-theme="obsidian">/);
  const main = readFileSync(join(WEB, "src/main.tsx"), "utf8");
  assert.ok(main.indexOf('import "./styles.css";') < main.indexOf('import "./egide/genere/egide.css";'));
  const css = readFileSync(join(WEB, "src/egide/genere/egide.css"), "utf8");
  assert.ok(css.includes(':root, [data-eg-theme="obsidian"] {') && css.includes("--eg-c-canvas: #101113;"));
});

test("Obsidian résolu par le moteur importé : 27 contrastes conformes, valeurs de la feuille", () => {
  const r = resoudreTheme(docOfficiel("obsidian"));
  assert.ok(verifierContrastes(r).every((m) => m.ok));
  const { vars, attrs } = variablesTheme(r);
  assert.equal(attrs["data-eg-theme"], "obsidian");
  assert.equal(vars["--eg-c-accent"], "#C2A066");
  assert.equal(CLE_APPARENCE, "aethryon.apparence.v1");
  assert.equal(importerTheme('{"format":"aethryon-theme","schemaVersion":1,"id":"x.y","name":"X","base":"obsidian","tokens":{"c-text":"url(a)"}}').ok, false);
});

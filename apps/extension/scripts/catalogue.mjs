// Copie du catalogue des plateformes pour l'extension (3.9.0) : node scripts/catalogue.mjs [--check]
// Source UNIQUE : docs/api/CATALOGUE-PLATEFORMES.json, lui-même généré depuis le registre ytapi/app/plateformes.json par
// scripts/sync-plateformes.py (vérifié par `make test`). Écrit src/shared/catalogue-donnees.ts : seulement ce que
// l'interface montre (nom, catégorie, pictogramme neutre, état, domaines, formats compatibles, fonctions indisponibles
// et leur raison, attribution obligatoire). Les états du catalogue sont renommés pour l'interface (« preparation » pour
// une bêta désactivée) : le paquet distribué ne contient aucun libellé de préproduction (contrôle de scripts/build.mjs).
// --check : n'écrit rien, code 1 si la copie diffère (lancé par la construction et par les essais).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "..", "..", "docs", "api", "CATALOGUE-PLATEFORMES.json");
export const CIBLE = join(ROOT, "src", "shared", "catalogue-donnees.ts");
const STATUTS = { disponible: "disponible", prete_a_ouvrir: "prete", preproduction: "preparation", indisponible: "indisponible", refusee: "refusee" };

export function rendre() {
  const c = JSON.parse(readFileSync(SOURCE, "utf8"));
  const plateformes = c.plateformes.map((p) => {
    const statut = STATUTS[p.statut];
    if (!statut) throw new Error(`catalogue : état inconnu « ${p.statut} » (${p.id})`);
    const indisponibles = {};
    for (const f of p.fonctions_indisponibles ?? []) indisponibles[f.fonction] = f.raison;
    return { id: p.id, nom: p.nom, categorie: p.categorie, icone: p.icone, statut, domaines: p.domaines, formats: p.formats_compatibles ?? [], indisponibles, attribution: p.attribution_obligatoire === true };
  });
  const corps = JSON.stringify({ version: c.version, categories: c.categories, plateformes }, null, 1);
  return "// FICHIER GÉNÉRÉ par scripts/catalogue.mjs depuis docs/api/CATALOGUE-PLATEFORMES.json (registre unique des plateformes) :\n"
    + "// ne pas modifier à la main. Vérifié par la construction et par tests/unit/apparence.test.ts (--check).\n"
    + `export const CATALOGUE_DONNEES = ${corps} as const;\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const texte = rendre();
  if (process.argv.includes("--check")) {
    let actuel = "";
    try { actuel = readFileSync(CIBLE, "utf8"); } catch { /* absent */ }
    if (actuel !== texte) {
      console.error("catalogue : src/shared/catalogue-donnees.ts n'est plus à jour (node scripts/catalogue.mjs)");
      process.exit(1);
    }
  } else {
    writeFileSync(CIBLE, texte);
    console.log(`catalogue : ${CIBLE} écrit`);
  }
}

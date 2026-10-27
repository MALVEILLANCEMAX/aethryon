// Copie du CATALOGUE DES PLATEFORMES pour le site (contexte Docker web/) : docs/api/CATALOGUE-PLATEFORMES.json, lui-même
// généré par scripts/sync-plateformes.py depuis le registre UNIQUE ytapi/app/plateformes.json. Aucune donnée ajoutée
// ici : le site lit cette copie (src/lib/catalogue.ts) ; l'ouverture réelle en production des bêtas validées est dans
// src/lib/catalogue.ts (PLATEFORMES_BETA de ytapi), rien d'autre.
//   node web/scripts/catalogue-plateformes.mjs          écrit src/lib/catalogue-plateformes.ts
//   node web/scripts/catalogue-plateformes.mjs --check  échoue si la copie diffère (essai tests/catalogue.test.ts)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const SOURCE = fileURLToPath(new URL("../../../docs/api/CATALOGUE-PLATEFORMES.json", import.meta.url));
const CIBLE = fileURLToPath(new URL("../src/lib/catalogue-plateformes.ts", import.meta.url));

export function rendre(texte) {
  const c = JSON.parse(texte);
  const garder = ["id", "nom", "categorie", "icone", "etat", "statut", "domaines", "formats_compatibles", "fonctions_indisponibles", "attribution_obligatoire", "valide"];
  const corps = {
    version: c.version, ytdlp: c.ytdlp, formats: c.formats, categories: c.categories,
    plateformes: c.plateformes.map((p) => Object.fromEntries(garder.filter((k) => k in p).map((k) => [k, p[k]]))),
  };
  return "// FICHIER GÉNÉRÉ par web/scripts/catalogue-plateformes.mjs depuis docs/api/CATALOGUE-PLATEFORMES.json (registre unique :\n" +
    "// ytapi/app/plateformes.json) : ne pas modifier à la main. Vérifié par tests/catalogue.test.ts.\n" +
    "export type StatutCatalogue = \"disponible\" | \"prete_a_ouvrir\" | \"preproduction\" | \"indisponible\" | \"refusee\";\n" +
    "export type FormatCatalogue = \"mp4\" | \"mp3\" | \"gif\" | \"extrait\";\n" +
    "export interface PlateformeCatalogue {\n" +
    "  id: string; nom: string; categorie: \"populaires\" | \"musique\" | \"streaming\" | \"autres\"; icone: string; etat: string;\n" +
    "  statut: StatutCatalogue; domaines: readonly string[]; formats_compatibles: readonly FormatCatalogue[];\n" +
    "  fonctions_indisponibles: readonly { fonction: FormatCatalogue; raison: string }[]; attribution_obligatoire: boolean; valide?: string;\n" +
    "}\n\n" +
    `export const CATALOGUE_PLATEFORMES: { version: string; ytdlp: string; formats: Record<FormatCatalogue, string>; categories: readonly { id: PlateformeCatalogue["categorie"]; nom: string }[]; plateformes: readonly PlateformeCatalogue[] } = ${JSON.stringify(corps, null, 2)};\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const attendu = rendre(readFileSync(SOURCE, "utf8"));
  if (process.argv.includes("--check")) {
    const actuel = existsSync(CIBLE) ? readFileSync(CIBLE, "utf8") : "";
    if (actuel !== attendu) { console.error("src/lib/catalogue-plateformes.ts diffère du catalogue : relancer node web/scripts/catalogue-plateformes.mjs"); process.exit(1); }
    console.log("OK : copie du catalogue des plateformes à jour");
  } else { writeFileSync(CIBLE, attendu); console.log("écrit", CIBLE); }
}

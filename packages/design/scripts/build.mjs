// Bâti du socle Égide (sans réseau). Source unique : src/*.ts (moteur, jetons, icônes, composants) et css/*.css.
//   node scripts/build.mjs            écrit les fichiers générés (genere/, src/genere/, themes/, schema/)
//   node scripts/build.mjs --check    régénère EN MÉMOIRE et échoue (code 1) si un fichier versionné diffère, si la
//                                     chouette n'est plus le fichier maître packages/brand/master, si la copie du site
//                                     (apps/web/src/egide) n'est pas identique, ou si un budget de taille est dépassé
//   node scripts/build.mjs --sync     écrit, puis copie le paquet dans apps/web/src/egide (contexte Docker du site)
// Sorties :
//   genere/egide.css           document (site, Desktop, pages d'extension) : couches, polices, jetons, base, composants, éditeur
//   genere/egide-shadow.css    racine Shadow DOM (:host, sans @font-face, sans éditeur) ; même texte minifié dans
//   src/genere/css-shadow.ts   (EGIDE_CSS_SHADOW, importable par un content script)
//   genere/theme-boot.js       démarrage sans flash (script EXTERNE, CSP stricte), < 1 Ko
//   genere/icones.svg          sprite des icônes (symboles eg-i-<nom>)
//   genere/tokens.json         jetons au format DTCG (futur Android / iOS : Compose, SwiftUI)
//   genere/contrastes.md       27 paires × 6 thèmes (WCAG 2.x + APCA en information)
//   genere/taille.json         mesures de taille (brut, minifié, gzip, brotli) et budgets
//   themes/*.aethryon-theme.json   les six thèmes en fichiers d'exemple valides
//   schema/aethryon-theme.v1.json  JSON Schema publié (documentation et outils ; le validateur reste src/schema.ts)
import { build, transform } from "esbuild";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const ICI = join(dirname(fileURLToPath(import.meta.url)), "..");
const RACINE_DEPOT = join(ICI, "..", ".."); // packages/design -> racine du dépôt
const CHECK = process.argv.includes("--check");
const SYNC = process.argv.includes("--sync");
const lire = (p) => readFileSync(join(ICI, p), "utf8");
const ENTETE = "/* Généré par design/scripts/build.mjs — ne pas éditer à la main (source : design/src, design/css). */\n";

const F = await import(join(ICI, "src/feuille.ts"));
const M = await import(join(ICI, "src/moteur.ts"));
const T = await import(join(ICI, "src/themes.ts"));
const S = await import(join(ICI, "src/schema.ts"));
const J = await import(join(ICI, "src/jetons.ts"));
const I = await import(join(ICI, "src/icones.ts"));
const C = await import(join(ICI, "src/couleur.ts"));

const sorties = new Map(); // chemin relatif à design/ -> contenu (string | Buffer)

// ---- Feuilles ------------------------------------------------------------------------------------------------
const base = lire("css/base.css"), composants = lire("css/composants.css"), editeur = lire("css/editeur.css"), polices = lire("css/polices.css");
const egide = ENTETE + F.ORDRE_COUCHES + polices + F.cssJetons(":root") + base + composants + editeur;
const shadow = ENTETE + F.versShadow(F.ORDRE_COUCHES + F.cssJetons(":root") + base + composants);
sorties.set("genere/egide.css", egide);
sorties.set("genere/egide-shadow.css", shadow);
const shadowMin = (await transform(shadow, { loader: "css", minify: true, target: "chrome120" })).code.trim();
sorties.set("src/genere/css-shadow.ts",
  "// Généré par design/scripts/build.mjs depuis css/ (racine Shadow DOM : :host, sans @font-face) — ne pas éditer.\n" +
  `export const EGIDE_CSS_SHADOW = ${JSON.stringify(shadowMin)};\n`);

// ---- Script de démarrage (externe, autonome) -----------------------------------------------------------------
const boot = await build({ entryPoints: [join(ICI, "src/boot.ts")], bundle: true, write: false, minify: true, format: "iife", target: "es2020", legalComments: "none" });
const bootJs = "/* AETHRYON Égide : thème au démarrage (design/src/boot.ts) */\n" + boot.outputFiles[0].text;
sorties.set("genere/theme-boot.js", bootJs);

// ---- Icônes, thèmes, schéma, jetons natifs, contrastes ------------------------------------------------------
sorties.set("genere/icones.svg", I.spriteIcones());
const docs = [...T.BASES.map((b) => T.docOfficiel(b)), T.CUSTOM_EXEMPLE];
for (const d of docs) sorties.set(`themes/${d.id.replace(/^(officiel|exemple)\./, "")}.aethryon-theme.json`, S.exporterTheme(d));

const couleurRoles = Object.fromEntries(T.ROLES.map((r) => [`c-${r}`, { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" }]));
const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: T.SCHEMA_URL,
  title: "AETHRYON — thème (aethryon-theme v1)",
  description: "Un thème est une DONNÉE : aucune clé inconnue, aucune URL (sauf $schema), couleurs #RRGGBB uniquement, nombres bornés. Fichier de 16 Ko au plus (contrôlé par le validateur). Validateur de référence : design/src/schema.ts.",
  type: "object", additionalProperties: false, required: ["format", "schemaVersion", "id", "name", "base"],
  properties: {
    $schema: { const: T.SCHEMA_URL },
    format: { const: T.FORMAT },
    schemaVersion: { const: 1 },
    id: { type: "string", pattern: "^[a-z0-9.-]{3,64}$" },
    name: { type: "string", minLength: 1, maxLength: 40 },
    author: { type: "string", maxLength: 60 },
    base: { enum: [...T.BASES] },
    seeds: { type: "object", additionalProperties: false, properties: {
      accent: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" }, neutralHue: { type: "number", minimum: 0, maximum: 360 },
      neutralChroma: { type: "number", minimum: 0, maximum: 0.04 }, background: { type: "number", minimum: 0, maximum: 100 }, contrast: { enum: ["standard", "eleve"] },
    } },
    tokens: { type: "object", additionalProperties: false, properties: { ...couleurRoles, "r-panel": { type: "number", minimum: 0, maximum: 20 } } },
    typography: { type: "object", additionalProperties: false, properties: { preset: { enum: Object.keys(J.TYPOS) }, scale: { type: "number", minimum: 0.9, maximum: 1.25 } } },
    density: { enum: Object.keys(J.DENSITES) },
    motion: { type: "object", additionalProperties: false, required: ["intensity"], properties: { intensity: { enum: Object.keys(J.MOUVEMENTS) } } },
    effects: { type: "object", additionalProperties: false, properties: { sheen: { type: "boolean" }, grain: { type: "boolean" } } },
  },
};
sorties.set("schema/aethryon-theme.v1.json", JSON.stringify(schema, null, 2) + "\n");

const dtcg = { $description: "AETHRYON Égide — jetons (DTCG). Généré par design/scripts/build.mjs.", couleur: {}, espacement: {}, rayon: {}, typographie: {}, duree: {}, courbe: {}, bordure: {} };
for (const d of docs) {
  const r = M.resoudreTheme(S.normaliserDoc(d));
  const nom = d.id.replace(/^(officiel|exemple)\./, "");
  dtcg.couleur[nom] = Object.fromEntries(Object.entries(M.couleursCompletes(r)).map(([k, v]) => [k, { $type: "color", $value: v }]));
  dtcg.rayon[nom] = { panel: { $type: "dimension", $value: `${r.panel}px` } };
}
for (const [k, v] of Object.entries(J.ESPACEMENTS)) dtcg.espacement[k] = { $type: "dimension", $value: `${v}px` };
for (const [k, v] of Object.entries(J.RAPPORTS_RAYONS)) dtcg.rayon[`rapport-${k}`] = { $type: "number", $value: v };
for (const [k, v] of Object.entries(J.TAILLES_TEXTE)) dtcg.typographie[`taille-${k}`] = { $type: "dimension", $value: `${v}px` };
for (const [k, v] of Object.entries(J.FAMILLES)) dtcg.typographie[`famille-${k}`] = { $type: "fontFamily", $value: v.split(",").map((x) => x.trim().replace(/^"|"$/g, "")) };
for (const [k, v] of Object.entries(J.DUREES)) dtcg.duree[k] = { $type: "duration", $value: `${v}ms` };
for (const [k, v] of Object.entries(J.COURBES)) dtcg.courbe[k] = { $type: "cubicBezier", $value: v.replace(/^cubic-bezier\(|\)$/g, "").split(",").map(Number) };
for (const [k, v] of Object.entries(J.BORDURES)) dtcg.bordure[k] = { $type: "dimension", $value: v };
sorties.set("genere/tokens.json", JSON.stringify(dtcg, null, 2) + "\n");

const fr = (v) => String(Math.round(v * 100) / 100).replace(".", ",");
let md = "# Contrastes des six thèmes (généré)\n\nGénéré par `design/scripts/build.mjs` à partir du moteur (`src/moteur.ts`). WCAG 2.x : seuils 4,5:1 (texte) et 3:1 (contrôles, fil, focus).\nAPCA (Lc) donné à titre d'information seulement.\n\n";
md += `| Paire | Seuil | ${docs.map((d) => d.name).join(" | ")} |\n|---|---|${docs.map(() => "---").join("|")}|\n`;
const mesures = docs.map((d) => M.verifierContrastes(M.resoudreTheme(S.normaliserDoc(d))));
const toutes = docs.map((d) => M.couleursCompletes(M.resoudreTheme(S.normaliserDoc(d))));
M.PAIRES.forEach(([a, b, s], i) => {
  md += `| \`${a}\` / \`${b}\` | ${fr(s)} | ${mesures.map((m, j) => `${fr(m[i].v)}${m[i].ok ? "" : " ❌"} (Lc ${Math.round(C.apca(toutes[j][a], toutes[j][b]))})`).join(" | ")} |\n`;
});
const minMarge = Math.min(...mesures.flat().map((m) => m.v / m.seuil));
md += `\n${mesures.flat().filter((m) => !m.ok).length} échec sur ${mesures.flat().length} mesures ; marge minimale (ratio / seuil) : ${fr(minMarge)}.\n`;
sorties.set("genere/contrastes.md", md);

// ---- Mesures de taille (budgets documentés dans README.md) ---------------------------------------------------
const gz = (b) => gzipSync(b, { level: 9 }).length;
const br = (b) => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
// La feuille d'ombre (texte) est mesurée à part : remplacée ici par une chaîne vide.
const sansOmbre = { name: "sans-ombre", setup(b) {
  b.onResolve({ filter: /css-shadow\.ts$/ }, (a) => ({ path: a.path, namespace: "vide" }));
  b.onLoad({ filter: /.*/, namespace: "vide" }, () => ({ contents: 'export const EGIDE_CSS_SHADOW = "";', loader: "ts" }));
} };
async function paquet(code) {
  const r = await build({ stdin: { contents: code, resolveDir: join(ICI, "src"), loader: "ts" }, bundle: true, write: false, minify: true, format: "esm", target: "es2021", legalComments: "none", treeShaking: true, plugins: [sansOmbre] });
  return Buffer.from(r.outputFiles[0].text);
}
const egideMin = Buffer.from((await transform(egide, { loader: "css", minify: true, target: "chrome120" })).code);
const mesurer = (b) => ({ octets: b.length, gzip: gz(b), brotli: br(b) });
const taille = {
  css: {
    "egide.css (brut)": mesurer(Buffer.from(egide)),
    "egide.css (minifié)": mesurer(egideMin),
    "EGIDE_CSS_SHADOW (minifié)": mesurer(Buffer.from(shadowMin)),
  },
  js: {
    "theme-boot.js": mesurer(Buffer.from(bootJs)),
    "moteur seul (demarrerTheme, appliquerTheme, persistance)": mesurer(await paquet('export { demarrerTheme, appliquerTheme, choisirTheme, reinitialiserTheme, creerPersistance } from "./index.ts";')),
    "moteur + import/export + contrastes": mesurer(await paquet('export { demarrerTheme, appliquerTheme, choisirTheme, reinitialiserTheme, creerPersistance, importerTheme, exporterTheme, validerTexte, verifierContrastes, corrigerContrastes } from "./index.ts";')),
    "composants DOM (sans éditeur) + icônes + chouette": mesurer(await paquet('export { bouton, champ, segment, pastille, pastillePlateforme, noeud, fil, majFil, carteMedia, menu, dialogue, attacherInfobulle, regionToasts, toast, icone, medaille, veille, sceau, etatVide, meandre, configurerEgide } from "./index.ts";')),
    "complet (tout sauf EGIDE_CSS_SHADOW)": mesurer(await paquet('export * from "./index.ts";')),
  },
  polices: Object.fromEntries(readdirSync(join(ICI, "fonts")).filter((f) => f.endsWith(".woff2")).map((f) => [f, statSync(join(ICI, "fonts", f)).size])),
};
// Budgets (gzip) : socle CSS ≤ 12 Kio, moteur ≤ 8 Kio, complet ≤ 24 Kio, démarrage ≤ 1 Kio brut.
const BUDGETS = [
  ["css", "egide.css (minifié)", "gzip", 12 * 1024],
  ["css", "EGIDE_CSS_SHADOW (minifié)", "gzip", 10 * 1024],
  ["js", "theme-boot.js", "octets", 1024],
  ["js", "moteur seul (demarrerTheme, appliquerTheme, persistance)", "gzip", 8 * 1024],
  ["js", "complet (tout sauf EGIDE_CSS_SHADOW)", "gzip", 24 * 1024],
];
taille.budgets = BUDGETS.map(([g, k, unite, max]) => ({ mesure: `${k} (${unite})`, valeur: taille[g][k][unite], max, ok: taille[g][k][unite] <= max }));
sorties.set("genere/taille.json", JSON.stringify(taille, null, 2) + "\n");

// ---- Écriture ou contrôle -------------------------------------------------------------------------------------
const problemes = [];
const egal = (a, b) => Buffer.compare(Buffer.isBuffer(a) ? a : Buffer.from(a), Buffer.isBuffer(b) ? b : Buffer.from(b)) === 0;
for (const [rel, contenu] of sorties) {
  const p = join(ICI, rel);
  if (CHECK) {
    if (!existsSync(p)) problemes.push(`${rel} absent (lancer node packages/design/scripts/build.mjs)`);
    else if (!egal(readFileSync(p), contenu)) problemes.push(`${rel} n'est pas à jour (lancer node packages/design/scripts/build.mjs)`);
  } else {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, contenu);
  }
}
for (const b of taille.budgets) if (!b.ok) problemes.push(`budget dépassé : ${b.mesure} = ${b.valeur} > ${b.max}`);
// Chouette : le fichier maître, jamais redessiné.
const empreinte = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const maitre = join(RACINE_DEPOT, "packages/brand/master/aethryon-master.svg");
if (existsSync(maitre) && empreinte(maitre) !== empreinte(join(ICI, "assets/aethryon-master.svg"))) problemes.push("assets/aethryon-master.svg diffère du fichier maître packages/brand/master/aethryon-master.svg");
// Polices : licences présentes à côté de chaque fichier.
for (const f of ["marcellus", "hanken-grotesk", "geist-mono"]) if (!existsSync(join(ICI, `fonts/LICENSE-${f}.txt`))) problemes.push(`fonts/LICENSE-${f}.txt absent (licence OFL)`);

// ---- Copie du paquet pour le site (contexte Docker = apps/web/) -------------------------------------------------
const WEB = join(RACINE_DEPOT, "apps/web/src/egide");
const PAQUET = ["src", "genere/egide.css", "genere/theme-boot.js", "genere/icones.svg", "fonts", "assets", "LISEZMOI-COPIE.md"];
const fichiersDe = (racine, rel) => {
  const p = join(racine, rel);
  if (!existsSync(p)) return [];
  return statSync(p).isDirectory() ? readdirSync(p).flatMap((f) => fichiersDe(racine, join(rel, f))) : [rel];
};
if (SYNC && !CHECK) {
  rmSync(WEB, { recursive: true, force: true });
  for (const rel of PAQUET) {
    if (!existsSync(join(ICI, rel))) continue;
    mkdirSync(dirname(join(WEB, rel)), { recursive: true });
    cpSync(join(ICI, rel), join(WEB, rel), { recursive: true });
  }
}
if (existsSync(WEB)) {
  const attendus = new Set(PAQUET.flatMap((rel) => fichiersDe(ICI, rel)));
  const presents = new Set(fichiersDe(WEB, ".").map((f) => relative(".", f)));
  for (const f of attendus) if (!presents.has(f) || !egal(readFileSync(join(WEB, f)), readFileSync(join(ICI, f)))) problemes.push(`apps/web/src/egide/${f} diffère de packages/design/${f} (lancer node packages/design/scripts/build.mjs --sync)`);
  for (const f of presents) if (!attendus.has(f)) problemes.push(`apps/web/src/egide/${f} n'existe pas dans packages/design/ (copie à refaire : --sync)`);
}

const k = (n) => `${(n / 1024).toFixed(1)} Kio`;
console.log(`egide.css ${k(taille.css["egide.css (minifié)"].octets)} minifié, ${k(taille.css["egide.css (minifié)"].gzip)} gzip ; shadow ${k(taille.css["EGIDE_CSS_SHADOW (minifié)"].gzip)} gzip ; theme-boot.js ${taille.js["theme-boot.js"].octets} o`);
for (const [nom, m] of Object.entries(taille.js)) if (nom !== "theme-boot.js") console.log(`  JS ${nom} : ${k(m.octets)} minifié, ${k(m.gzip)} gzip`);
if (problemes.length) { console.error("ÉCHEC\n- " + problemes.join("\n- ")); process.exit(1); }
console.log(CHECK ? "check : OK (fichiers générés à jour, chouette maître, copie du site, budgets)" : `écrit : ${sorties.size} fichiers${SYNC ? " + copie apps/web/src/egide" : ""}`);

// Construit le dossier de l'extension CEP, NON SIGNÉ, prêt à être signé en ZXP (auto-signé horodaté) par l'étape de
// l'installateur : sortie/fr.aethryon.premiere/ + sortie/SHA256SUMS.
//   - interface : vite build --mode cep (script classique, Chromium 99), dans client/ ;
//   - manifeste CSXS/manifest.xml (version injectée), script hôte jsx/aethryon.jsx, icônes, licences des polices ;
//   - contrôles : manifeste en XML bien formé (scripts/xml-bien-forme.mjs, puis expat s'il est présent), aucun lien
//     symbolique (problème connu de novembre 2024), aucune carte de source, aucun fichier de maquette ni de banc,
//     toutes les ressources du manifeste présentes, aucun eval dans le script livré ;
//   - option --livrer <dossier> : copie le résultat (dossier + SHA256SUMS) dans <dossier>.
// Rien n'est signé, publié ni envoyé.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { contreEpreuveExpat, verifierXml } from "./xml-bien-forme.mjs";

const ici = dirname(fileURLToPath(import.meta.url));
const racine = join(ici, "..");
const { version } = JSON.parse(readFileSync(join(racine, "package.json"), "utf8"));
const versionSource = /VERSION = "([^"]+)"/.exec(readFileSync(join(racine, "src", "version.ts"), "utf8"))[1];
if (version !== versionSource) throw new Error(`Versions différentes : package.json ${version}, src/version.ts ${versionSource}`);

const sortie = join(racine, "sortie");
const ext = join(sortie, "fr.aethryon.premiere");
rmSync(sortie, { recursive: true, force: true });
mkdirSync(ext, { recursive: true });

console.log("1. Interface (vite build --mode cep)");
execFileSync(join(racine, "node_modules", ".bin", "vite"), ["build", "--mode", "cep", "--logLevel", "warn"], { cwd: racine, stdio: "inherit" });

console.log("2. Assemblage");
cpSync(join(racine, "dist", "cep"), join(ext, "client"), { recursive: true });
mkdirSync(join(ext, "CSXS"), { recursive: true });
writeFileSync(join(ext, "CSXS", "manifest.xml"), readFileSync(join(racine, "cep", "CSXS", "manifest.xml"), "utf8").replaceAll("@VERSION@", version));
mkdirSync(join(ext, "jsx"), { recursive: true });
cpSync(join(racine, "cep", "jsx", "aethryon.jsx"), join(ext, "jsx", "aethryon.jsx"));
cpSync(join(racine, "cep", "icons"), join(ext, "icons"), { recursive: true });
mkdirSync(join(ext, "LICENCES"), { recursive: true });
for (const f of ["LICENSE-Inter.txt", "LICENSE-PlayfairDisplay.txt"]) cpSync(join(racine, "src", "assets", "fonts", f), join(ext, "LICENCES", f));
const preact = readFileSync(join(racine, "node_modules", "preact", "LICENSE"), "utf8");
writeFileSync(join(ext, "LICENCES", "LICENSE-preact.txt"), `Preact ${JSON.parse(readFileSync(join(racine, "node_modules", "preact", "package.json"), "utf8")).version} (MIT)\n\n${preact}`);
writeFileSync(join(ext, "LICENCES", "MARQUE.txt"), "Logo et logotype AETHRYON : marque du propriétaire d'AETHRYON (fichiers officiels copiés sans modification).\nPolices Inter et Playfair Display : SIL Open Font License 1.1 (fichiers ci-contre).\n");

console.log("3. Contrôles");
const tous = [];
const parcourir = (d) => {
  for (const n of readdirSync(d)) {
    const c = join(d, n);
    const st = lstatSync(c);
    if (st.isSymbolicLink()) throw new Error("Lien symbolique interdit dans le paquet : " + c);
    if (st.isDirectory()) parcourir(c);
    else tous.push(c);
  }
};
parcourir(ext);
const rel = (c) => relative(ext, c).split("\\").join("/");
const interdits = tous.filter((c) => /\.map$|\.debug$|\.DS_Store$|__MACOSX|maquette|banc|\.ts$|\.tsx$/.test(rel(c)));
if (interdits.length) throw new Error("Fichiers interdits dans le paquet : " + interdits.map(rel).join(", "));
const manifeste = readFileSync(join(ext, "CSXS", "manifest.xml"), "utf8");
// XML bien formé (un « -- » dans un commentaire suffit à faire refuser le manifeste) : contrôle intégré, puis
// contre-épreuve par expat (Python) quand il est présent sur la machine de construction.
const malForme = verifierXml(manifeste);
if (malForme) throw new Error("CSXS/manifest.xml n'est pas du XML bien formé : " + malForme);
const expat = contreEpreuveExpat(join(ext, "CSXS", "manifest.xml"));
if (expat && expat !== "absent") throw new Error("CSXS/manifest.xml refusé par expat : " + expat);
console.log(`   manifeste : XML bien formé (contrôle intégré${expat === "absent" ? ", expat absent" : " et expat"})`);
if (/@VERSION@/.test(manifeste)) throw new Error("Version non injectée dans le manifeste");
for (const m of manifeste.matchAll(/>\.\/([^<]+)</g)) if (!existsSync(join(ext, m[1]))) throw new Error("Ressource du manifeste absente : " + m[1]);
if (/PlayerDebugMode|--disable-web-security|--mixed-context/.test(manifeste.replace(/<!--[\s\S]*?-->/g, ""))) throw new Error("Option interdite dans le manifeste");
const html = readFileSync(join(ext, "client", "index.html"), "utf8");
if (/type="module"|https?:\/\/(?!www\.w3\.org)/.test(html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ""))) throw new Error("index.html : module ES ou ressource distante");
const js = readFileSync(join(ext, "client", "assets", "aethryon.js"), "utf8");
if (/\beval\(|new Function\(/.test(js)) throw new Error("eval ou new Function dans le script livré");
if (/creerHoteMaquette|__banc|maquette\/medias/.test(js)) throw new Error("Code de maquette ou de banc dans le paquet");
for (const attendu of ["com.adobe.cep.dnd.file.", "AETHRYON.appel(", "/api/premiere/appairage", "raccourci.malvu.fr", "api.malvu.fr/media"]) {
  if (!js.includes(attendu)) throw new Error("Script livré incomplet : " + attendu + " absent");
}

console.log("4. Empreintes");
const lignes = tous.map((c) => `${createHash("sha256").update(readFileSync(c)).digest("hex")}  fr.aethryon.premiere/${rel(c)}`).sort((a, b) => a.slice(66).localeCompare(b.slice(66)));
writeFileSync(join(sortie, "SHA256SUMS"), lignes.join("\n") + "\n");
const taille = tous.reduce((s, c) => s + lstatSync(c).size, 0);
console.log(`   ${tous.length} fichiers, ${(taille / 1024).toFixed(0)} Ko, version ${version}`);

const i = process.argv.indexOf("--livrer");
if (i > 0 && process.argv[i + 1]) {
  const cible = process.argv[i + 1];
  rmSync(join(cible, "fr.aethryon.premiere"), { recursive: true, force: true });
  mkdirSync(cible, { recursive: true });
  cpSync(ext, join(cible, "fr.aethryon.premiere"), { recursive: true });
  cpSync(join(sortie, "SHA256SUMS"), join(cible, "SHA256SUMS"));
  cpSync(join(racine, "README.md"), join(cible, "README.md"));
  // Preuves : captures choisies et bilans des essais (s'ils ont été lancés).
  const rendus = join(racine, "tests", "e2e", "rendus");
  const captures = ["accueil-lien-480", "accueil-progression-480", "accueil-importe-480", "accueil-lien-300", "accueil-vide-960", "bibliotheque-grille-480", "bibliotheque-liste-300", "bibliotheque-apercu-960", "bibliotheque-selection-480", "bibliotheque-filtres-300", "compte-attente-300", "compte-connecte-480", "reglages-480", "diagnostic-480", "bout-en-bout-A3-telechargement", "bout-en-bout-B3-bibliotheque", "compte-indisponible-480", "bout-en-bout-C2-accord", "bout-en-bout-C6-importe", "bout-en-bout-C7-deconnecte"];
  rmSync(join(cible, "captures"), { recursive: true, force: true });
  mkdirSync(join(cible, "captures"), { recursive: true });
  for (const c of captures) if (existsSync(join(rendus, c + ".png"))) cpSync(join(rendus, c + ".png"), join(cible, "captures", c + ".png"));
  rmSync(join(cible, "essais"), { recursive: true, force: true });
  mkdirSync(join(cible, "essais"), { recursive: true });
  for (const f of ["bilan.json", "bout-en-bout.json"]) if (existsSync(join(rendus, f))) cpSync(join(rendus, f), join(cible, "essais", f === "bilan.json" ? "rendus.json" : f));
  console.log("5. Livré dans " + cible);
}

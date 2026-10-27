// Construction de l'extension : node scripts/build.mjs --target=dev|prod [--out=<dossier>]
// - prod : LA version distribuée (ZIP téléchargé sur https://raccourci.malvu.fr/extension, installé à la main
//          en mode développeur — aucun store) : https://api.malvu.fr/media et https://raccourci.malvu.fr,
//          clé publique « installation locale » (src/manifest-key.prod.json : identifiant stable
//          necpohicddjeaeaaomaakehcbccapabg, autorisé par le serveur), minifiée, sans carte de sources, sans
//          aucune adresse de test (vérifié ci-dessous) ;
// - dev  : API et site de PRÉPRODUCTION (http://127.0.0.1:18111, http://localhost:18110, ou AETHRYON_API /
//          AETHRYON_SITE), nom « AETHRYON (dev) », identifiant figé par src/manifest-key.dev.json ; avis de
//          mise à jour lu sur la pile de test (AETHRYON_UPDATE_URL, sinon <site>/downloads/extension/latest.json).
// Les anciennes cibles « store » et « --sans-youtube » sont supprimées (2026-10-11 : distribution directe
// seulement, YouTube compris ; docs/EXTENSION-STORE.md).
// Aucun code distant : tout est empaqueté. Marque : tête et logotype générés depuis brand/master
// (src/shared/brand-head.ts), icônes lues dans brand/master/png (jamais dans les fichiers publics du site).
import { build, transform } from "esbuild";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BRAND_PNG = join(ROOT, "..", "..", "packages", "brand", "master", "png");
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
if (args.target === "store" || "sans-youtube" in args) {
  console.error("build : les cibles « store » et « --sans-youtube » n'existent plus (distribution directe seulement, docs/EXTENSION-STORE.md).");
  process.exit(2);
}
const target = args.target === "dev" ? "dev" : "prod";
const OUT = resolve(ROOT, args.out ?? (target === "dev" ? "dist-dev" : "dist")); // chemin absolu accepté
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error(`build : version invalide dans package.json (${pkg.version})`);

const PROD = {
  api: "https://api.malvu.fr/media",
  site: "https://raccourci.malvu.fr",
  update: "https://raccourci.malvu.fr/downloads/extension/latest.json",
};
const ENDPOINTS = target === "dev"
  ? (() => {
    const site = process.env.AETHRYON_SITE ?? "http://localhost:18110";
    return { api: process.env.AETHRYON_API ?? "http://127.0.0.1:18111", site, update: process.env.AETHRYON_UPDATE_URL ?? `${site}/downloads/extension/latest.json` };
  })()
  : PROD; // production : aucune variable d'environnement ne peut changer ces adresses

// Catalogue des plateformes (copie de docs/api/CATALOGUE-PLATEFORMES.json) : jamais une copie périmée dans un paquet.
execFileSync(process.execPath, [join(ROOT, "scripts", "catalogue.mjs"), "--check"], { stdio: "inherit" });

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Statut public, affiché dans le popup, les réglages, la page d'accueil et chrome://extensions (version_name) : vide
// (« Version 3.5.2 », aucun libellé) depuis que le propriétaire a déclaré l'extension publique (2026-10-18) ; « bêta »
// du 2026-10-11 au 2026-10-18 ; « en développement » avant. À changer seulement sur sa décision. La construction de
// développement dit toujours « préproduction ».
const RELEASE_STATUS = ""; // extension publique (décision du propriétaire, 2026-10-18)
const define = {
  __AETHRYON_TARGET__: JSON.stringify(target),
  __RELEASE_STATUS__: JSON.stringify(RELEASE_STATUS),
  __API_BASE__: JSON.stringify(ENDPOINTS.api),
  __SITE_BASE__: JSON.stringify(ENDPOINTS.site),
  __UPDATE_URL__: JSON.stringify(ENDPOINTS.update),
  __VERSION__: JSON.stringify(pkg.version),
};
// Chrome 140 au minimum (manifeste et syntaxe) : c'est la première version où chrome.storage.local.setAccessLevel
// existe (code de Chromium : refusé hors storage.session jusqu'à M139, accepté et appliqué pour local depuis M140,
// branche 7339). Avant, le jeton de storage.local serait lisible depuis un content script (docs/AUDIT-SECURITE-EXTENSION.md).
const MIN_CHROME = 140;
// Feuilles écrites dans du TypeScript (racines Shadow DOM du menu des pages et de l'éditeur d'extrait : une feuille
// adoptée ne se charge pas par <link>) : en production, le texte CSS de chaque gabarit `export const X = `…`` est
// minifié par esbuild (même analyseur que les feuilles des pages), sans rien changer d'autre au module.
const CSS_EN_TS = /[\\/]src[\\/](extrait[\\/]css|content[\\/]common[\\/]styles)\.ts$/;
const cssEnLigne = {
  name: "css-en-ligne",
  setup(b) {
    if (target !== "prod") return;
    b.onLoad({ filter: CSS_EN_TS }, async (args) => {
      let src = readFileSync(args.path, "utf8");
      const parts = [];
      const re = /(=\s*)`([^`$]*)`/g;
      for (const m of src.matchAll(re)) parts.push(m);
      for (const m of parts.reverse()) {
        // Texte brut du gabarit = texte CSS seulement sans barre oblique inverse (aucune séquence d'échappement JS).
        if (m[2].includes("\\")) throw new Error(`build : barre oblique inverse dans une feuille en TypeScript (${relative(ROOT, args.path)})`);
        const css = (await transform(m[2], { loader: "css", minify: true, target: `chrome${MIN_CHROME}`, logLevel: "error" })).code.trim();
        if (/[`\\]|\$\{/.test(css)) throw new Error(`build : feuille minifiée inattendue (${relative(ROOT, args.path)})`);
        src = src.slice(0, m.index) + m[1] + "`" + css + "`" + src.slice(m.index + m[0].length);
      }
      return { contents: src, loader: "ts" };
    });
  },
};
const common = {
  bundle: true, minify: target === "prod", sourcemap: target === "dev" ? "inline" : false, target: `chrome${MIN_CHROME}`, define,
  logLevel: "warning", legalComments: "none", charset: "utf8", plugins: [cssEnLigne],
};
/** Feuille d'une page, minifiée en production (aucun @import : chaque page lie ses feuilles). */
async function feuille(src, out) {
  mkdirSync(dirname(out), { recursive: true });
  const css = readFileSync(src, "utf8");
  if (target !== "prod") { writeFileSync(out, css); return; }
  writeFileSync(out, (await transform(css, { loader: "css", minify: true, target: `chrome${MIN_CHROME}`, legalComments: "none", logLevel: "error" })).code);
}

// Service worker (module), content scripts (IIFE, un par plateforme), pages de l'extension.
await build({ ...common, entryPoints: [join(ROOT, "src/background/index.ts")], outfile: join(OUT, "background.js"), format: "esm" });
for (const name of ["youtube", "tiktok", "x"]) {
  await build({ ...common, entryPoints: [join(ROOT, `src/content/${name}.ts`)], outfile: join(OUT, `content/${name}.js`), format: "iife" });
}
for (const page of ["popup", "options", "welcome"]) {
  await build({ ...common, entryPoints: [join(ROOT, `src/${page}/${page}.ts`)], outfile: join(OUT, `${page}/${page}.js`), format: "iife" });
  cpSync(join(ROOT, `src/${page}/${page}.html`), join(OUT, `${page}/${page}.html`));
  await feuille(join(ROOT, `src/${page}/${page}.css`), join(OUT, `${page}/${page}.css`));
}

// Icônes officielles de l'identité V1 (tuile obsidienne + tête maître), lues dans brand/master/png.
const assets = join(OUT, "assets");
mkdirSync(join(assets, "icons"), { recursive: true });
for (const s of [16, 32, 48, 128]) cpSync(join(BRAND_PNG, `aethryon-extension-${s}.png`), join(assets, `icons/icon-${s}.png`));
// Égide (paquet partagé design/, lot 3 de la refonte) : feuille du document (minifiée en production), démarrage du
// thème sans flash (theme-boot.js, script EXTERNE permis par la CSP des pages), polices OFL avec leurs licences (même
// disposition que dans design/ : egide.css lit ../fonts/), chouette maître (fichier tel quel, contrôlé ci-dessous) et
// feuille commune des pages de l'extension. Le JavaScript du socle est empaqueté par esbuild depuis src/shared/egide.ts.
// Plus d'Inter ni de Playfair (remplacées par Hanken Grotesk et Marcellus).
const DESIGN = join(ROOT, "..", "..", "packages", "design");
await feuille(join(DESIGN, "genere/egide.css"), join(OUT, "egide/genere/egide.css"));
cpSync(join(DESIGN, "genere/theme-boot.js"), join(OUT, "egide/genere/theme-boot.js"));
cpSync(join(DESIGN, "fonts"), join(OUT, "egide/fonts"), { recursive: true });
cpSync(join(DESIGN, "assets/aethryon-master.svg"), join(OUT, "egide/aethryon-master.svg"));
if (!readFileSync(join(OUT, "egide/aethryon-master.svg")).equals(readFileSync(join(ROOT, "..", "..", "packages/brand/master/aethryon-master.svg")))) {
  throw new Error("build : la chouette de design/assets diffère du fichier maître brand/master/aethryon-master.svg");
}
await feuille(join(ROOT, "src/shared/extension.css"), join(OUT, "egide/extension.css"));

// Manifeste.
const apiOrigin = new URL(ENDPOINTS.api).origin;
const siteOrigin = new URL(ENDPOINTS.site).origin;
const updateOrigin = new URL(ENDPOINTS.update).origin;
// Production : latest.json est sur le site (même origine, aucune permission de plus) ; une pile de test peut
// le servir ailleurs (build dev seulement).
const hosts = [...new Set([apiOrigin, siteOrigin, ...(target === "dev" ? [updateOrigin] : [])])].map((o) => `${o}/*`);
if (target === "prod" && updateOrigin !== siteOrigin) throw new Error("build : latest.json doit être servi par le site (aucune permission d'hôte supplémentaire)");
const manifest = {
  manifest_version: 3,
  name: target === "dev" ? "AETHRYON (dev)" : "AETHRYON",
  short_name: "AETHRYON",
  version: pkg.version,
  // Sans libellé (version publique) : pas de version_name, Chrome montre la version seule.
  ...(target === "dev" ? { version_name: `${pkg.version} (préproduction)` } : RELEASE_STATUS ? { version_name: `${pkg.version} (${RELEASE_STATUS})` } : {}),
  description: "Télécharge les vidéos YouTube, TikTok et X en MP4 ou MP3, extrait, GIF ou image, avec ton compte AETHRYON.",
  minimum_chrome_version: String(MIN_CHROME),
  icons: { 16: "assets/icons/icon-16.png", 32: "assets/icons/icon-32.png", 48: "assets/icons/icon-48.png", 128: "assets/icons/icon-128.png" },
  action: {
    default_title: "AETHRYON",
    default_popup: "popup/popup.html",
    default_icon: { 16: "assets/icons/icon-16.png", 32: "assets/icons/icon-32.png" },
  },
  options_ui: { page: "options/options.html", open_in_tab: true },
  background: { service_worker: "background.js", type: "module" },
  // activeTab (V3, aucun avertissement à l'installation) : capture de l'onglet visible quand l'utilisateur clique sur
  // l'icône puis sur « Image » et que la page ne peut pas lire l'image de la vidéo elle-même (docs/EXTENSION-V3.md).
  permissions: ["storage", "downloads", "identity", "alarms", "activeTab"],
  // Facultatives : notifications (réglage), nativeMessaging (3.5.2 : lien local avec AETHRYON Desktop, demandé quand
  // l'utilisateur choisit « Envoyer vers » › « Premiere Pro » ; accepté en facultatif par Chrome 153, vérifié).
  optional_permissions: ["notifications", "nativeMessaging"],
  host_permissions: hosts,
  content_scripts: [
    { matches: ["https://www.youtube.com/*", "https://m.youtube.com/*"], js: ["content/youtube.js"], run_at: "document_idle" },
    { matches: ["https://www.tiktok.com/*"], js: ["content/tiktok.js"], run_at: "document_idle" },
    { matches: ["https://x.com/*", "https://twitter.com/*", "https://mobile.twitter.com/*"], js: ["content/x.js"], run_at: "document_idle" },
  ],
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" },
  key: JSON.parse(readFileSync(join(ROOT, `src/manifest-key.${target}.json`), "utf8")).key,
};
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// Production : paquet autonome et propre — aucune carte de sources, aucun fichier de test ou source, aucune
// adresse ni aucun libellé de test ou de préproduction, aucun tracé de logo de marque (docs/MARQUES.md :
// pictogrammes neutres seulement ; mêmes signatures que web/scripts/check-dist.mjs). Le ZIP distribué est fait
// de ce dossier (scripts/zip.mjs).
const BRAND_LOGO_PATHS = { youtube: "M23.498 6.186", tiktok: "M12.525.02c1.31", x: "M14.234 10.162" };
if (target === "prod") {
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
  walk(OUT);
  const allowed = /\.(js|html|css|json|png|woff2|txt|svg)$/;
  const forbidden = [/localhost/i, /127\.0\.0\.1/, /:1811\d/, /pr[eé]prod/i, /sourceMappingURL/, /(@|\/\/)[a-z0-9.-]+\.test\b/i, /dnllfjakdgmgfiompaheickmbjjlgjdc/,
    ...Object.values(BRAND_LOGO_PATHS).map((s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))];
  for (const f of files) {
    const rel = relative(OUT, f);
    if (!allowed.test(f) || /\.(ts|map)$/.test(f)) throw new Error(`build prod : fichier inattendu dans le paquet (${rel})`);
    if (/\.(js|html|css|json|svg)$/.test(f)) {
      const text = readFileSync(f, "utf8");
      for (const re of forbidden) if (re.test(text)) throw new Error(`build prod : « ${re.source} » trouvé dans ${rel}`);
    }
  }
}
console.log(`extension ${target} ${pkg.version} construite dans ${OUT} (API ${ENDPOINTS.api}, site ${ENDPOINTS.site}, mises à jour ${ENDPOINTS.update})`);

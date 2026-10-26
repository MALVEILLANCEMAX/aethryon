// Pré-rendu des pages publiques, après `vite build` (dist/) et `vite build --ssr src/entry-static.tsx`
// (.prerender/). Écrit, à partir de dist/index.html (gabarit produit par Vite) :
//   dist/index.html, dist/aide/index.html, dist/installer/index.html, dist/confidentialite/index.html,
//   dist/connexion/index.html : le VRAI contenu de chaque page (mêmes composants que le navigateur) ;
//   dist/accueil-solution-<id>.html : l'accueil avec l'onglet <id> ouvert (lien /?solution=<id>) ;
//   dist/404.html : la page 404 de l'application (servie avec le statut 404 à toute adresse inconnue) ;
//   dist/app.html : la coque neutre (racine vide) des routes de l'application (compte requis) ;
//   dist/sitemap.xml : les seules pages publiques (servi par nginx seulement si INDEXING=1) ;
//   dist/robots.txt : remplacé seulement si INDEXING=1 (sinon celui de public/ : « Disallow: / ») ;
//   dist/assets/sans-js-<empreinte>.css : la feuille des lecteurs sans JavaScript (<noscript>).
// Les attributs style="" produits par React/Motion sont retirés (CSP : style-src 'self') ; les positions
// statiques des composants sont en classes. Vérifie d'abord que nginx/default.conf sert ces fichiers aux
// mêmes adresses que les routes de l'application (une route oubliée par nginx fait échouer le build).
// Variables : INDEXING=0|1 (défaut 0), VITE_CONTROL_CENTER=0|1 (défaut 1). Rien n'est écrit en cas d'échec.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const web = new URL("../", import.meta.url).pathname;
const dist = join(web, "dist");
const fail = (msg) => { console.error(`prerender : ÉCHEC\n  ${msg}`); process.exit(1); };

const INDEXING = process.env.INDEXING ?? "0";
if (INDEXING !== "0" && INDEXING !== "1") fail(`INDEXING doit valoir 0 ou 1 (reçu : ${INDEXING})`);
const CONTROL_CENTER = process.env.VITE_CONTROL_CENTER !== "0";

const { render, routes, PUBLIC_PAGES, HOME_VARIANTS, NOT_FOUND_PATH, legalTexts } = await import(pathToFileURL(join(web, ".prerender/entry-static.js")).href);
const fileOf = (path) => (path === "/" ? "index.html" : `${path.slice(1)}/index.html`);

// ---- 1. nginx et routes : mêmes adresses ---------------------------------------------------------
// Chaque route sans paramètre : page publique → `location = <chemin>` qui sert son fichier pré-rendu ;
// route de l'application → `location = <chemin>` (ou un préfixe, ex. /admin/) qui sert app.html. Toute
// autre adresse tombe dans `location /` : 404 (dist/404.html). Simule les blocs que le Dockerfile retire.
function nginxLocations() {
  let conf = readFileSync(join(web, "nginx/default.conf"), "utf8");
  const drop = (name) => { conf = conf.replace(new RegExp(`^[ \\t]*# >>> ${name}\\b[\\s\\S]*?^[ \\t]*# <<< ${name}\\b.*$`, "m"), ""); };
  drop(CONTROL_CENTER ? "sans-control-center" : "control-center");
  const exact = new Map(), prefix = new Map();
  for (const part of conf.split(/^\s*location\s+/m).slice(1)) {
    const m = part.match(/^(=\s*)?(\S+)\s*\{/);
    if (!m || m[2].startsWith("~") || m[2].startsWith("@")) continue;
    const served = part.match(/(?:^|[;{])\s*try_files\s+(\S+)/m)?.[1] ?? null;
    (m[1] ? exact : prefix).set(m[2], served);
  }
  // Accueil : `try_files $ytc_accueil` ; la table `map $arg_solution $ytc_accueil` doit servir index.html
  // par défaut et exactement une variante par onglet (valeur exacte, sensible à la casse : « ~^id$ »).
  const map = conf.match(/^map \$arg_solution \$ytc_accueil \{([\s\S]*?)^\}/m)?.[1] ?? "";
  const entries = new Map([...map.matchAll(/^\s*(\S+)\s+(\S+);/gm)].map((m) => [m[1], m[2]]));
  if (exact.get("/") === "$ytc_accueil") exact.set("/", entries.get("default") ?? null);
  const variants = [...entries].filter(([k]) => k !== "default").map(([k, v]) => `${k} ${v}`).sort();
  return { exact, prefix, conf, variants };
}
function leaves(list, base = "") {
  const out = [];
  for (const r of list) {
    const path = r.path === undefined ? base : r.path.startsWith("/") ? r.path : `${base.replace(/\/$/, "")}/${r.path}`;
    if (r.index) out.push(base || "/");
    else if (r.children?.length) out.push(...leaves(r.children, path));
    else if (r.path !== undefined) out.push(path);
  }
  return out;
}
{
  const { exact, prefix, conf, variants } = nginxLocations();
  const problems = [];
  const expectedVariants = HOME_VARIANTS.map((v) => `~^${v.id}$ /${v.file}`).sort();
  if (JSON.stringify(variants) !== JSON.stringify(expectedVariants)) {
    problems.push(`map $arg_solution $ytc_accueil : ${JSON.stringify(variants)}, attendu ${JSON.stringify(expectedVariants)}`);
  }
  const servedAt = (p) => {
    if (exact.has(p)) return exact.get(p);
    const pre = [...prefix.keys()].filter((k) => k !== "/" && p.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    return pre ? prefix.get(pre) : "404";
  };
  const known = new Set();
  for (const p of leaves(routes)) {
    if (p === "/*") continue; // page 404 de l'application : location / (404.html)
    known.add(p);
    const expected = PUBLIC_PAGES.includes(p) ? `/${fileOf(p)}` : "/app.html";
    const got = servedAt(p);
    if (got !== expected) {
      problems.push(/[:*]/.test(p)
        ? `${p} : route à paramètre hors d'un préfixe nginx qui sert ${expected}`
        : `${p} : nginx sert ${got === "404" ? "une 404" : got}, attendu ${expected}${got === "/index.html" ? " (la page d'accueil pré-rendue !)" : ""}`);
    }
  }
  for (const [p, served] of exact) {
    if ((served === "/app.html" || /\/index\.html$/.test(served ?? "")) && !known.has(p)) problems.push(`location = ${p} sert ${served} mais aucune route ne correspond (soft 404)`);
  }
  if (!/location\s+\/\s*\{[^}]*error_page\s+404\s+\/404\.html/.test(conf)) problems.push("location / : « error_page 404 /404.html » absent (adresses inconnues)");
  if (problems.length) fail(`nginx/default.conf et routes.tsx ne concordent pas (Control Center ${CONTROL_CENTER ? "inclus" : "exclu"}) :\n  ${problems.join("\n  ")}`);
}

// ---- 2. Gabarit ---------------------------------------------------------------------------------
// dist/index.html tel que produit par Vite ; dist/app.html (copie exacte) si le pré-rendu est relancé.
const templateFile = existsSync(join(dist, "app.html")) ? "app.html" : "index.html";
const template = readFileSync(join(dist, templateFile), "utf8");
if (!template.includes('<div id="root"></div>')) fail(`dist/${templateFile} : <div id="root"></div> introuvable (relancer vite build)`);
const ogUrl = template.match(/<meta property="og:url" content="([^"]+)"/)?.[1];
if (!ogUrl) fail(`dist/${templateFile} : meta og:url absente (origine publique du site)`);
const origin = new URL(ogUrl).origin;
const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Polices du texte affiché d'emblée (sous-ensembles latins d'Inter et de Playfair Display) : préchargées,
// elles sont prêtes au premier affichage du HTML statique ; sinon le texte, déjà visible avec la police de
// secours, changerait de métrique à leur arrivée (décalage de mise en page).
const assets = readdirSync(join(dist, "assets"));
const fonts = [/^inter-latin-wght-normal-[\w-]+\.woff2$/, /^playfair-display-latin-wght-normal-[\w-]+\.woff2$/].map((re) => {
  const f = assets.find((a) => re.test(a));
  if (!f) fail(`police introuvable dans dist/assets (${re}) : nom changé par @fontsource ? adapter scripts/prerender.mjs`);
  return `<link rel="preload" href="/assets/${f}" as="font" type="font/woff2" crossorigin>`;
});

// Feuille des lecteurs sans JavaScript : nom haché (cache long de /assets/).
const sansJs = readFileSync(join(web, "src/sans-js.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s*\n\s*/g, "").trim() + "\n";
const sansJsFile = `assets/sans-js-${createHash("sha256").update(sansJs).digest("hex").slice(0, 10)}.css`;

// ---- 3. Rendu de chaque page (en mémoire) --------------------------------------------------------
const strippedStyles = new Map(); // propriété CSS → nombre d'attributs style retirés qui la contenaient
function staticHtml(path, html) {
  for (const bad of [/<script/i, /<style/i, /<template/i, /<!--\$[?!]-->/]) {
    if (bad.test(html)) fail(`${path} : le rendu contient ${bad} (Suspense non résolu ou script : interdit dans le HTML statique)`);
  }
  // Ressources que React place en tête (ex. préchargement de l'image prioritaire du héros) → <head>.
  const head = [];
  html = html.replace(/^(?:<link\b[^>]*>)+/, (links) => {
    for (const l of links.match(/<link\b[^>]*>/g)) {
      head.push(l.replace(/\bimageSrcSet=/, "imagesrcset=").replace(/\bimageSizes=/, "imagesizes=").replace(/\bfetchPriority=/, "fetchpriority=").replace(/\/>$/, ">"));
    }
    return "";
  });
  // Attributs style (Motion : état initial des animations ; valeurs posées par le script) : retirés, la
  // CSP les bloquerait. Ce qui sert à la mise en page doit être en classes (bilan affiché à la fin).
  html = html.replace(/\sstyle="([^"]*)"/g, (_, decl) => {
    for (const prop of decl.split(";").map((d) => d.split(":")[0].trim()).filter(Boolean)) strippedStyles.set(prop, (strippedStyles.get(prop) ?? 0) + 1);
    return "";
  });
  return { html, head };
}

function page({ html, head, title, canonical, robots }) {
  let out = template
    .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(title)}</title>`)
    .replace(/(<meta property="og:title" content=")[^"]*"/, (_, a) => `${a}${escapeHtml(title)}"`)
    .replace(/(<meta name="robots" content=")[^"]*"/, (_, a) => `${a}${robots}"`)
    .replace('<div id="root"></div>', () => `<div id="root">${html}</div>`);
  const extra = [];
  if (canonical) {
    out = out.replace(/(<meta property="og:url" content=")[^"]*"/, (_, a) => `${a}${origin}${canonical}"`);
    extra.push(`<link rel="canonical" href="${origin}${canonical}">`);
  }
  extra.push(...fonts, ...head, `<noscript><link rel="stylesheet" href="/${sansJsFile}"></noscript>`);
  return out.replace("  </head>", () => `${extra.map((l) => `    ${l}\n`).join("")}  </head>`);
}

const robotsOf = (isPublic) => (INDEXING === "1" && isPublic ? "index, follow" : "noindex, nofollow");
const files = new Map(); // fichier de dist → contenu
const report = [];
const documents = [
  ...PUBLIC_PAGES.map((path) => ({ path, file: fileOf(path), canonical: path, label: path })),
  // Liens directs vers une solution : même page que l'accueil (lien canonique /), autre onglet ouvert.
  ...HOME_VARIANTS.map((v) => ({ path: v.path, file: v.file, canonical: "/", label: v.path })),
  { path: NOT_FOUND_PATH, file: "404.html", canonical: null, label: "(inconnue)" },
];
for (const { path, file, canonical, label } of documents) {
  const { html, title } = await render(path, origin);
  const { html: body, head } = staticHtml(path, html);
  files.set(file, page({ html: body, head, title, canonical, robots: robotsOf(canonical !== null) }));
  report.push(`${label.padEnd(22)} → dist/${file.padEnd(34)} ${String(Buffer.byteLength(body)).padStart(6)} octets  « ${title} »`);
}
// Coque des routes de l'application : le gabarit tel quel (racine vide, « noindex »).
files.set("app.html", template);
// Identifiant de cette construction : le nom haché du script d'entrée, le même dans chaque document. Lu par
// src/lib/version.ts (un onglet resté sur une version précédente le compare au sien) ; servi sans cache (nginx).
const entry = template.match(/<script type="module"[^>]*src="\/assets\/(index-[\w-]+\.js)"/)?.[1];
if (!entry) fail(`dist/${templateFile} : script d'entrée /assets/index-….js introuvable`);
files.set("version.json", `${JSON.stringify({ build: entry })}\n`);
files.set(sansJsFile, sansJs);
files.set("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PUBLIC_PAGES.map((p) => `  <url><loc>${origin}${p}</loc></url>\n`).join("")}</urlset>\n`);
// Versions texte des pages juridiques (dist/legal/cgv.txt : jointe à la confirmation de commande par le serveur).
const texts = legalTexts(origin);
for (const [rel, content] of Object.entries(texts)) files.set(rel, content);
if (INDEXING === "1") {
  files.set("robots.txt", ["User-agent: *", "Disallow: /dashboard", "Disallow: /outils/studio", "Disallow: /admin", "Disallow: /api/", "Disallow: /downloads/", "", `Sitemap: ${origin}/sitemap.xml`, ""].join("\n"));
}

// ---- 4. Écriture --------------------------------------------------------------------------------
for (const [rel, content] of files) {
  const file = join(dist, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}
const styles = [...strippedStyles].map(([k, n]) => `${k} ×${n}`).join(", ");
console.log(`prerender : ${PUBLIC_PAGES.length} pages publiques + ${HOME_VARIANTS.length} liens directs de l'accueil + 404 + coque (INDEXING=${INDEXING}, Control Center ${CONTROL_CENTER ? "inclus" : "exclu"}, origine ${origin})
  ${report.join("\n  ")}
  versions texte des pages juridiques : ${Object.keys(texts).map((f) => `dist/${f}`).join(", ") || "aucune (informations légales non publiées)"}
  attributs style retirés (états initiaux des animations, valeurs posées par le script) : ${styles || "aucun"}
  nginx/default.conf : chaque route est servie par le bon fichier`);

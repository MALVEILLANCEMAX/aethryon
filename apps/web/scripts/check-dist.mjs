// Vérifie que le build respecte la CSP du site : aucun script inline, aucun attribut style="", aucun
// gestionnaire d'événement inline, aucune data: URI, aucune URL externe chargée (scripts, styles, polices,
// images), et ce dans CHAQUE document HTML produit (pages pré-rendues, 404, coque de l'application).
// Vérifie aussi que le lien iCloud du raccourci n'est écrit nulle part en dur (une seule source :
// /api/config → useShortcutUrl(), docs/ADMIN.md §7), et que le pré-rendu (scripts/prerender.mjs) a produit
// ce qu'attend nginx : le vrai contenu des pages publiques, une coque vide pour l'application, la page 404,
// le plan du site, et la politique d'indexation demandée (INDEXING, défaut 0 : « noindex » partout).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const web = new URL("../", import.meta.url).pathname;
const dist = join(web, "dist");
const INDEXING = process.env.INDEXING ?? "0";
const errors = [];
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const files = walk(dist);
const origin = new URL(readFileSync(join(dist, "app.html"), "utf8").match(/<meta property="og:url" content="([^"]+)"/)?.[1] ?? "https://invalide.test").origin;

for (const f of files) {
  const rel = f.slice(dist.length + 1);
  if (f.endsWith(".html")) {
    let html = readFileSync(f, "utf8");
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (!/\bsrc=/.test(m[1])) errors.push(`${rel} : script inline`);
    }
    if (/\sstyle\s*=/i.test(html)) errors.push(`${rel} : attribut style=`);
    if (/<style[\s>]/i.test(html)) errors.push(`${rel} : bloc <style>`);
    if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(html)) errors.push(`${rel} : gestionnaire d'événement inline (on…=)`);
    if (/\b(?:src|href|srcset|imagesrcset|poster|data|action)\s*=\s*["']?\s*(?:data|javascript):/i.test(html)) errors.push(`${rel} : URI data: ou javascript: dans un attribut`);
    // Lien canonique : adresse absolue du site lui-même (rien n'est chargé) ; tout autre lien absolu est refusé.
    html = html.replace(/<link rel="canonical" href="([^"]+)">/g, (_, href) => {
      if (!href.startsWith(`${origin}/`)) errors.push(`${rel} : lien canonique hors du site (${href})`);
      return "";
    });
    // Liens d'ajout du bot Discord (lib/discord.ts, bot public) : une NAVIGATION vers la page d'autorisation de Discord,
    // jamais une ressource chargée ; seulement sur une ancre <a>, seulement pour l'application AETHRYON, exactement
    // l'une des deux installations prévues (compte, serveur).
    html = html.replace(/<a\b[^>]*?\shref="(https:\/\/discord\.com\/oauth2\/authorize\?[^"]+)"/g, (tag, href) => {
      const ok = [
        "https://discord.com/oauth2/authorize?client_id=1558821698734923796&amp;integration_type=1&amp;scope=applications.commands",
        "https://discord.com/oauth2/authorize?client_id=1558821698734923796&amp;integration_type=0&amp;scope=applications.commands+bot&amp;permissions=274878286912",
      ].includes(href);
      if (!ok) errors.push(`${rel} : lien Discord inattendu ${href}`);
      return ok ? tag.replace(href, "#discord-ajout") : tag;
    });
    // Soutien (lib/soutien.ts, pied de page) : une NAVIGATION vers la page Buy Me a Coffee du propriétaire, jamais une ressource
    // chargée ; seulement sur une ancre <a>, adresse exacte, nouvel onglet SANS référent (noopener noreferrer).
    html = html.replace(/<a\b[^>]*?\shref="(https:\/\/buymeacoffee\.com\/[^"]*)"[^>]*>/g, (tag, href) => {
      const ok = href === "https://buymeacoffee.com/malvoyance" && /\starget="_blank"/.test(tag) && /\srel="noopener noreferrer"/.test(tag);
      if (!ok) errors.push(`${rel} : lien de soutien inattendu ou non sécurisé ${tag}`);
      return ok ? tag.replace(href, "#soutien") : tag;
    });
    // Dépôt GitHub officiel (lib/github.ts) : une NAVIGATION vers le dépôt, jamais une ressource chargée ; seulement sur une
    // ancre <a>, adresse exacte, nouvel onglet SANS référent, et SEULEMENT si le site est construit avec VITE_GITHUB_PUBLIC=1
    // (dépôt public) : sinon le moindre lien vers github.com est refusé.
    html = html.replace(/<a\b[^>]*?\shref="(https:\/\/github\.com\/[^"]*)"[^>]*>/g, (tag, href) => {
      const ok = process.env.VITE_GITHUB_PUBLIC === "1" && href === "https://github.com/MALVEILLANCEMAX/aethryon"
        && /\starget="_blank"/.test(tag) && /\srel="noopener noreferrer"/.test(tag);
      if (!ok) errors.push(`${rel} : lien GitHub inattendu, non sécurisé ou dépôt non public (VITE_GITHUB_PUBLIC≠1) ${tag}`);
      return ok ? tag.replace(href, "#github") : tag;
    });
    for (const m of html.matchAll(/\b(?:src|href|srcset|imagesrcset)=["'](https?:)?\/\/[^"']+/gi)) errors.push(`${rel} : ressource externe ${m[0]}`);
  }
  if (f.endsWith(".css")) {
    const css = readFileSync(f, "utf8");
    if (/url\(\s*["']?data:/i.test(css)) errors.push(`${rel} : data: URI dans le CSS`);
    if (/url\(\s*["']?https?:/i.test(css)) errors.push(`${rel} : URL externe dans le CSS`);
    if (/@import\s+["']?https?:/i.test(css)) errors.push(`${rel} : @import externe`);
  }
  if (f.endsWith(".js")) {
    let js = readFileSync(f, "utf8");
    // Widget Cap (@cap.js/widget, chargé seulement sur défi, élément caché) : sa feuille de style interne dessine la
    // case à cocher avec deux SVG en data: — jamais affichés (widget masqué) et refusés de toute façon par la CSP
    // (img-src 'self'). Exception limitée à ces deux images dans ce seul fichier.
    if (/^assets\/cap\.min-[\w-]+\.js$/.test(rel)) js = js.replace(/url\(\\?["']?data:image\/svg\+xml,[^)]*\)/g, "url()");
    if (/["'`]data:(image|font|text)\//.test(js)) errors.push(`${rel} : data: URI dans le JS`);
    if (/new Function\(|\beval\(/.test(js)) errors.push(`${rel} : eval/new Function`);
  }
  if (/\.(js|html|css|json|xml|txt)$/.test(f) && /icloud\.com\/shortcuts\/[0-9a-f]{32}/i.test(readFileSync(f, "utf8"))) {
    errors.push(`${rel} : lien iCloud du raccourci écrit en dur (il doit venir de /api/config)`);
  }
}

// ---- Documents attendus par nginx (scripts/prerender.mjs) ------------------------------------------
const { PUBLIC_PAGES, HOME_VARIANTS, DEFAULT_SOLUTION } = await import(pathToFileURL(join(web, ".prerender/entry-static.js")).href);
const read = (rel) => (existsSync(join(dist, rel)) ? readFileSync(join(dist, rel), "utf8") : null);
// Identifiant de la construction (src/lib/version.ts) : présent et identique au script d'entrée de chaque document.
const build = (() => { try { return JSON.parse(read("version.json") ?? "null")?.build ?? null; } catch { return null; } })();
if (!build || !/^index-[\w-]+\.js$/.test(build) || !existsSync(join(dist, "assets", build))) errors.push(`version.json absent ou invalide (${build})`);
const shell = read("app.html");
if (shell && !shell.includes(`src="/assets/${build}"`)) errors.push(`app.html : script d'entrée différent de version.json (${build})`);
const rootOf = (html) => html.match(/<div id="root">([\s\S]*)<\/div>\s*<noscript>/)?.[1] ?? null;
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const robotsMeta = (html) => html.match(/<meta name="robots" content="([^"]*)"/)?.[1];
const typoWarnings = [];
const pages = [
  ...PUBLIC_PAGES.map((p) => ({ path: p, canonical: p, rel: p === "/" ? "index.html" : `${p.slice(1)}/index.html`, isPublic: true, panel: p === "/" ? DEFAULT_SOLUTION : null })),
  // Liens directs /?solution=<id> : l'accueil avec CET onglet ouvert, lien canonique /.
  ...HOME_VARIANTS.map((v) => ({ path: v.path, canonical: "/", rel: v.file, isPublic: true, panel: v.id })),
];
for (const { path, canonical: wanted = null, rel, isPublic, panel = null } of [...pages, { path: "(404)", rel: "404.html", isPublic: false }]) {
  const html = read(rel);
  if (!html) { errors.push(`${rel} absent (pré-rendu de ${path})`); continue; }
  const root = rootOf(html);
  if (!root || text(root).length < 200) errors.push(`${rel} : contenu pré-rendu absent ou trop court`);
  if ((root?.match(/<h1\b/g) ?? []).length !== 1) errors.push(`${rel} : un seul <h1> attendu dans le contenu pré-rendu`);
  if (!/<title>[^<]*AETHRYON[^<]*<\/title>/.test(html)) errors.push(`${rel} : titre absent`);
  if (!/<script type="module"[^>]*src="\/assets\/index-[^"]+\.js"/.test(html)) errors.push(`${rel} : script de l'application absent`);
  const entry = html.match(/<script type="module"[^>]*src="\/assets\/(index-[\w-]+\.js)"/)?.[1];
  if (entry && entry !== build) errors.push(`${rel} : script d'entrée ${entry}, mais version.json annonce ${build}`);
  const sansJs = html.match(/<noscript><link rel="stylesheet" href="\/(assets\/sans-js-[0-9a-f]+\.css)"><\/noscript>/)?.[1];
  if (!sansJs || !existsSync(join(dist, sansJs))) errors.push(`${rel} : feuille sans JavaScript absente`);
  // Typographie française : espace insécable avant « : ; ! ? » » et après « « » (une ligne ne commence jamais
  // par un deux-points ou un point d'interrogation). Avertissement : ne bloque pas une mise en ligne.
  const visible = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, "").replace(/&nbsp;|&#160;/g, "\u00a0");
  const typo = [...visible.matchAll(/\S [:;!?»]|« \S/g)].map((m) => visible.slice(Math.max(0, m.index - 24), m.index + 6).replace(/\s+/g, " "));
  if (typo.length) typoWarnings.push(`${rel} : ${typo.length} (« ${typo[0]} »)`);
  const canonical = html.match(/<link rel="canonical" href="([^"]+)">/)?.[1];
  if (isPublic && canonical !== `${origin}${wanted}`) errors.push(`${rel} : lien canonique ${canonical ?? "absent"}, attendu ${origin}${wanted}`);
  if (panel) {
    const open = [...html.matchAll(/<div\b[^>]*\bdata-panel="([a-z]+)"[^>]*>/g)].filter((m) => !/\sdata-sans-js=""/.test(m[0])).map((m) => m[1]);
    if (JSON.stringify(open) !== JSON.stringify([panel])) errors.push(`${rel} : onglet ouvert ${JSON.stringify(open)}, attendu « ${panel} » (${path})`);
  }
  if (!isPublic && canonical) errors.push(`${rel} : la page 404 n'a pas de lien canonique`);
  const want = INDEXING === "1" && isPublic ? "index, follow" : "noindex, nofollow";
  if (robotsMeta(html) !== want) errors.push(`${rel} : meta robots « ${robotsMeta(html)} », attendu « ${want} » (INDEXING=${INDEXING})`);
}
{
  const html = read("app.html");
  if (!html) errors.push("app.html absent (coque des routes de l'application)");
  else {
    if (!html.includes('<div id="root"></div>')) errors.push("app.html : la coque de l'application doit avoir une racine VIDE (jamais le contenu d'une autre page)");
    if (robotsMeta(html) !== "noindex, nofollow") errors.push("app.html : meta robots doit rester « noindex, nofollow »");
  }
}
{
  const sitemap = read("sitemap.xml");
  const locs = [...(sitemap ?? "").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (JSON.stringify(locs) !== JSON.stringify(PUBLIC_PAGES.map((p) => `${origin}${p}`))) errors.push(`sitemap.xml : ${locs.length} adresses, attendu exactement les pages publiques`);
  const robots = read("robots.txt") ?? "";
  if (INDEXING === "1" ? !robots.includes(`Sitemap: ${origin}/sitemap.xml`) || /^Disallow:\s*\/\s*$/m.test(robots) : !/^Disallow:\s*\/\s*$/m.test(robots)) {
    errors.push(`robots.txt : ne correspond pas à INDEXING=${INDEXING}`);
  }
}

// Égide (design/, lot 0) : script de démarrage du thème EXTERNE (src/egide/genere/theme-boot.js, haché), en tête de
// CHAQUE document, avant les feuilles et le module (thème posé avant le premier rendu, sans script en ligne) ; thème
// Obsidian déclaré sur <html> (le site reste identique : seuls les éléments .eg-* lisent les jetons).
for (const f of files.filter((x) => x.endsWith(".html"))) {
  const rel = f.slice(dist.length + 1), html = readFileSync(f, "utf8");
  const boot = html.match(/<script src="\/(assets\/theme-boot-[0-9a-f]{10}\.js)"><\/script>/);
  if (!boot || !existsSync(join(dist, boot[1]))) { errors.push(`${rel} : script de démarrage Égide absent`); continue; }
  const avant = (re) => { const i = html.search(re); return i >= 0 && i < boot.index; };
  if (avant(/<link rel="stylesheet"/) || avant(/<script type="module"/)) errors.push(`${rel} : le démarrage Égide doit précéder les feuilles et le module`);
  if (!html.includes('<html lang="fr" data-eg-theme="obsidian">')) errors.push(`${rel} : <html data-eg-theme="obsidian"> absent`);
}

// Marques (docs/MARQUES.md) : aucun tracé des logos YouTube, TikTok ou X dans le site ; le seul logo de marque
// servi est celui de Discord, fichiers officiels NON MODIFIÉS (empreintes du registre brand/platforms/).
// Exception explicite : VITE_LOGOS_PLATEFORMES=officiels (src/lib/logos.ts), choix du propriétaire, qui en assume
// le risque (les trois propriétaires refusent leur logo à un service de conversion) : signalé, jamais par défaut.
const LOGOS = process.env.VITE_LOGOS_PLATEFORMES ?? "neutres";
if (LOGOS !== "neutres" && LOGOS !== "officiels") errors.push(`VITE_LOGOS_PLATEFORMES doit valoir neutres ou officiels (reçu : ${LOGOS})`);
const BRAND_PATHS = { youtube: "M23.498 6.186", tiktok: "M12.525.02c1.31", x: "M14.234 10.162" };
let brandHits = 0;
for (const f of files.filter((f) => /\.(js|html|css|svg)$/.test(f))) {
  const text = readFileSync(f, "utf8");
  for (const [brand, sig] of Object.entries(BRAND_PATHS)) {
    if (!text.includes(sig)) continue;
    brandHits++;
    if (LOGOS !== "officiels") errors.push(`${relative(dist, f)} : tracé du logo ${brand} (interdit, docs/MARQUES.md)`);
  }
}
if (LOGOS === "officiels") console.warn(`check-dist : ATTENTION, logos officiels de YouTube, TikTok et X inclus (${brandHits} occurrence(s)) : décision du propriétaire requise avant la production (docs/MARQUES.md).`);
const DISCORD = {
  "discord-symbol-blurple.svg": "d06eaa51e78a9984ebbd3fbc82f0245ac2ecb5bf0150f537204397c1da5c7bd8",
  "discord-symbol-white.svg": "de4cc484cdc0e3a8f3a58a84b0c80c5ac8acefeebf730930545ff3b279b5d0a3",
  "discord-symbol-black.svg": "2d1bd85831cdab67a5b8c893a218a47c3892b66a9fd073659022b8c8669fff2e",
};
for (const [name, sum] of Object.entries(DISCORD)) {
  const path = join(dist, "brand/platforms/discord", name);
  if (!existsSync(path)) { errors.push(`brand/platforms/discord/${name} absent`); continue; }
  if (createHash("sha256").update(readFileSync(path)).digest("hex") !== sum) errors.push(`brand/platforms/discord/${name} : fichier modifié (le logo officiel doit rester intact)`);
}
const GOOGLE_G = "7ef5808a4b85445193707e58f9098ebb300fff8a037f1c7eb0347a3a4c10d05b"; // brand/platforms/google/SOURCES.md
const gPath = join(dist, "brand/platforms/google/google-g.png");
if (!existsSync(gPath) || createHash("sha256").update(readFileSync(gPath)).digest("hex") !== GOOGLE_G) errors.push("brand/platforms/google/google-g.png absent ou modifié");
const brandDirs = existsSync(join(dist, "brand/platforms")) ? readdirSync(join(dist, "brand/platforms")) : [];
if (brandDirs.some((d) => d !== "discord" && d !== "google")) errors.push(`brand/platforms : seuls Discord (bot) et Google (connexion) ont un logo autorisé (${brandDirs.join(", ")})`);

// Informations légales (src/lib/legal.tsx) : un champ manquant s'affiche « À compléter » (data-legal-missing). Refusé,
// sauf aperçu explicite (ALLOW_LEGAL_PLACEHOLDERS=1) : aucune page juridique incomplète ne part en production.
const missing = new Set();
for (const f of files.filter((x) => x.endsWith(".html"))) for (const m of readFileSync(f, "utf8").matchAll(/data-legal-missing="([a-zA-Z]+)"/g)) missing.add(m[1]);
if (missing.size) {
  if (process.env.ALLOW_LEGAL_PLACEHOLDERS === "1") console.warn(`check-dist : APERÇU avec informations légales à compléter : ${[...missing].join(", ")}`);
  else errors.push(`informations légales à compléter (src/lib/legal.tsx) : ${[...missing].join(", ")} — construction refusée hors aperçu (ALLOW_LEGAL_PLACEHOLDERS=1)`);
}
if (typoWarnings.length) console.warn(`check-dist : typographie — espaces sécables avant la ponctuation (mettre une espace insécable, \\u00a0) :\n  ${typoWarnings.join("\n  ")}`);
const total = files.reduce((n, f) => n + statSync(f).size, 0);
if (errors.length) {
  console.error("check-dist : ÉCHEC\n  " + errors.join("\n  "));
  process.exit(1);
}
const html = files.filter((f) => f.endsWith(".html")).length;
console.log(`check-dist : OK (${files.length} fichiers, ${(total / 1024).toFixed(0)} Kio ; ${html} documents HTML : aucun inline/data:/externe, contenu pré-rendu des ${PUBLIC_PAGES.length} pages publiques, des ${HOME_VARIANTS.length} liens directs de l'accueil et de la 404, coque vide, plan du site, INDEXING=${INDEXING} ; aucun lien iCloud en dur)`);

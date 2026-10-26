// Exporte TOUTES les ressources vectorielles de la marque AETHRYON depuis la géométrie unique
// (src/ui/brand/athena/geometry.ts) et le logotype vectorisé (src/ui/brand/athena/wordmark.ts) :
//   brand/logo/       symbole, logotype, logos horizontal et vertical, versions monochromes
//   brand/mascot/     chouette de face, trois quarts, profil, tête, et ses expressions
//   brand/favicon/    favicon SVG (version optique des petites tailles)
//   brand/icons/      icône d'application (iOS, Android, PWA « maskable », avatar Discord), extension
// Le composant React (AthenaOwl, AthenaSymbol) rend le même graphe : site et fichiers ne divergent pas.
//
//   node scripts/export-owl-svgs.mjs           écrit les fichiers
//   node scripts/export-owl-svgs.mjs --check   vérifie que les fichiers versionnés sont à jour (code 1 sinon)
// Node 22 importe directement le TypeScript de la géométrie (types effacés), aucune dépendance.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const BRAND = join(WEB, "..", "brand");
const G = await import(join(WEB, "src/ui/brand/athena/geometry.ts"));
const { WORDMARK } = await import(join(WEB, "src/ui/brand/athena/wordmark.ts"));
const IC = await import(join(WEB, "src/ui/brand/athena/icon-data.ts"));
const { color: C } = await import(join(WEB, "src/design/tokens.ts"));
// Logotype alternatif (au choix du propriétaire) : Playfair Display 500, mêmes réglages (brand/tools/wordmarks.json).
const WM_ALT = (() => {
  const w = JSON.parse(readFileSync(join(WEB, "..", "brand/tools/wordmarks.json"), "utf8")).playfair;
  return { d: w.d, bbox: w.bbox, capHeight: 708 };
})();
const CHECK = process.argv.includes("--check");

const files = new Map();
const n = G.n2;
const HEADER = "Généré par web/scripts/export-owl-svgs.mjs depuis web/src/ui/brand/athena/geometry.ts — ne pas éditer à la main.";

/** Document SVG autonome (aucune ressource externe, aucun bitmap, aucun filtre). */
function doc({ viewBox, width, height, title, desc, body, defs = "" }) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}" role="img" aria-labelledby="title">`,
    `  <title id="title">${title}</title>`,
    `  <desc>${desc} ${HEADER}</desc>`,
    ...(defs ? [`  <defs>\n${defs}\n  </defs>`] : []),
    body,
    "</svg>",
    "",
  ].join("\n");
}
/** Contenu d'un toSvg (sans la balise <svg> ni <title>) pour l'imbriquer dans une composition. */
function inner(nodes, opts = {}) {
  const { defs, rest } = G.hoistClips(nodes);
  return {
    defs: defs.map((d) => G.nodeToSvg(d, opts, 2)).join("\n"),
    body: rest.map((r) => G.nodeToSvg(r, opts, 2)).join("\n"),
  };
}

// ---- Symbole (piste C « Plein et négatif ») --------------------------------------------------------
const M = G.MEDALLION;
const SYM_VB = [M.cx - M.r, M.cy - M.r, 2 * M.r, 2 * M.r];
const symbolNodes = (o) => G.headNodes(o.ground ?? "ivory", o);
/** Symbole monochrome sur médaillon : le médaillon est l'encre, la tête est réservée (couleur du support),
 *  les yeux, sourcils et bec restent de l'encre. Une seule couleur, règle evenodd. */
function monoMedallionPath(small = false) {
  const d = G.symbolMonoMedallionPath(small);
  return d;
}

function symbolFile({ small = false, title, desc, size = 512 }) {
  const { defs, body } = inner(symbolNodes({ small, medallion: true }), {});
  return doc({ viewBox: G.symbolViewBox({ medallion: true, small }), width: size, height: size, title, desc, defs, body: `  <g id="symbol">\n${body}\n  </g>` });
}

// ---- Logotype ---------------------------------------------------------------------------------------
const WM = WORDMARK;
/** Groupe du logotype : hauteur des capitales `capH`, ligne de base à (x, y). */
function wordmarkGroup(x, y, capH, fill, id = "wordmark", wm = WM) {
  const s = capH / wm.capHeight;
  return { g: `  <g id="${id}" transform="translate(${n(x - wm.bbox.x * s)} ${n(y)}) scale(${(Math.round(s * 1e5) / 1e5)})">\n    <path d="${wm.d}" fill="${fill}"/>\n  </g>`, w: wm.bbox.w * s };
}

/** Logo horizontal : symbole (côté S) + logotype (capitales 0,30 S), centrés sur l'axe du symbole. */
function horizontal({ ink, symbol, title, desc, wordmark = WM }) {
  const S = 2 * M.r, capH = S * 0.3, gap = S * 0.24;
  const wm = wordmarkGroup(S + gap, S / 2 + capH / 2, capH, ink, "wordmark", wordmark);
  const W = S + gap + wm.w;
  return doc({
    viewBox: `0 0 ${n(W)} ${n(S)}`, width: n(W / S * 64), height: 64, title, desc, defs: symbol.defs,
    body: `  <g id="symbol" transform="translate(${n(-SYM_VB[0])} ${n(-SYM_VB[1])})">\n${symbol.body}\n  </g>\n${wm.g}`,
  });
}
/** Logo vertical : symbole centré au-dessus du logotype (capitales 0,20 S). */
function stacked({ ink, symbol, title, desc }) {
  const S = 2 * M.r, capH = S * 0.2, gap = S * 0.17;
  const wmW = WM.bbox.w * (capH / WM.capHeight);
  const W = Math.max(S, wmW);
  const wm = wordmarkGroup((W - wmW) / 2, S + gap + capH, capH, ink);
  const H = S + gap + capH;
  return doc({
    viewBox: `0 0 ${n(W)} ${n(H)}`, width: n(W / H * 160), height: 160, title, desc, defs: symbol.defs,
    body: `  <g id="symbol" transform="translate(${n((W - S) / 2 - SYM_VB[0])} ${n(-SYM_VB[1])})">\n${symbol.body}\n  </g>\n${wm.g}`,
  });
}

const colourSymbol = inner(symbolNodes({ medallion: true }));
const darkSymbol = inner(G.headNodes("obsidian", { medallion: false }));
const monoDarkSymbol = { defs: "", body: `    <path id="symbol-mono" d="${monoMedallionPath()}" fill="${C.obsidian}" fill-rule="evenodd"/>` };
const monoLightSymbol = inner(G.headNodes("obsidian", { medallion: false, mono: true }));

files.set("logo/aethryon-symbol.svg", symbolFile({
  title: "AETHRYON — symbole",
  desc: "La tête de la chouette d'Athéna : capuchon ivoire foncé et disque facial ivoire (le V du front naît de leur rencontre), yeux noirs évidés au regard posé, un reflet, bec champagne, sur médaillon obsidienne (l'obole d'Athènes). Fonctionne sur fond clair et sombre ; à 24 px et moins, utiliser aethryon-symbol-small.svg (version optique).",
}));
files.set("logo/aethryon-symbol-dark.svg", doc({
  viewBox: SYM_VB.map(n).join(" "), width: 512, height: 512,
  title: "AETHRYON — symbole sur fond sombre",
  desc: "Tête seule, sans médaillon, pour les fonds obsidienne ou graphite : les yeux évidés prennent la couleur du fond.",
  defs: darkSymbol.defs, body: `  <g id="symbol">\n${darkSymbol.body}\n  </g>`,
}));
{
  const s = 0.3 * 2 * M.r;
  const W = WM.bbox.w * (s / WM.capHeight);
  const wm = wordmarkGroup(0, s, s, C.obsidian);
  files.set("logo/aethryon-wordmark.svg", doc({
    viewBox: `0 0 ${n(W)} ${n(s * 1.03)}`, width: n(W / s * 24), height: n(24 * 1.03),
    title: "AETHRYON — logotype",
    desc: "Geist Medium, capitales espacées 0,20 em, crénage optique ; contours vectorisés (aucune police requise). Obsidienne ; ivoire sur fond sombre.",
    body: wm.g,
  }));
}
files.set("logo/aethryon-symbol-small.svg", symbolFile({
  small: true, size: 24,
  title: "AETHRYON — symbole, version optique des petites tailles",
  desc: "Même tête, yeux et reflet agrandis pour rester lisibles de 16 à 24 px (favicon, barre d'outils, liste).",
}));
files.set("logo/aethryon-symbol-mono-dark.svg", doc({
  viewBox: SYM_VB.map(n).join(" "), width: 512, height: 512,
  title: "AETHRYON — symbole monochrome obsidienne (fonds clairs)",
  desc: "Une seule couleur : médaillon d'encre, tête réservée, yeux et bec à l'encre, reflet réservé. Gravure, tampon, impression une couleur.",
  body: `  <g id="symbol">\n${monoDarkSymbol.body}\n  </g>`,
}));
files.set("logo/aethryon-symbol-mono-light.svg", doc({
  viewBox: SYM_VB.map(n).join(" "), width: 512, height: 512,
  title: "AETHRYON — symbole monochrome ivoire (fonds sombres)",
  desc: "Une seule couleur : tête ivoire, yeux et bec évidés (ils prennent la couleur du fond).",
  defs: monoLightSymbol.defs, body: `  <g id="symbol">\n${monoLightSymbol.body}\n  </g>`,
}));
files.set("logo/aethryon-horizontal.svg", horizontal({ ink: C.obsidian, symbol: colourSymbol, title: "AETHRYON — logo horizontal", desc: "Symbole sur médaillon et logotype obsidienne, pour fonds clairs (ivoire, perle, sable)." }));
files.set("logo/aethryon-horizontal-dark.svg", horizontal({ ink: C.ivory, symbol: darkSymbol, title: "AETHRYON — logo horizontal, fond sombre", desc: "Tête ivoire sans médaillon et logotype ivoire, pour fonds obsidienne ou graphite." }));
files.set("logo/aethryon-horizontal-playfair.svg", horizontal({ ink: C.obsidian, symbol: colourSymbol, wordmark: WM_ALT, title: "AETHRYON — logo horizontal, logotype alternatif Playfair Display", desc: "Variante soumise au choix du propriétaire : Playfair Display 500, capitales espacées 0,20 em, crénage optique." }));
{
  const s = 0.3 * 2 * M.r;
  const W = WM_ALT.bbox.w * (s / WM_ALT.capHeight);
  const wm = wordmarkGroup(0, s, s, C.obsidian, "wordmark", WM_ALT);
  files.set("logo/aethryon-wordmark-playfair.svg", doc({
    viewBox: `0 0 ${n(W)} ${n(s * 1.03)}`, width: n(W / s * 24), height: n(24 * 1.03),
    title: "AETHRYON — logotype alternatif (Playfair Display)",
    desc: "Playfair Display 500, capitales espacées 0,20 em, crénage optique ; contours vectorisés. Au choix du propriétaire.",
    body: wm.g,
  }));
}
files.set("logo/aethryon-stacked.svg", stacked({ ink: C.obsidian, symbol: colourSymbol, title: "AETHRYON — logo vertical", desc: "Symbole centré au-dessus du logotype, pour fonds clairs." }));
files.set("logo/aethryon-monochrome-dark.svg", horizontal({ ink: C.obsidian, symbol: monoDarkSymbol, title: "AETHRYON — logo monochrome obsidienne (fonds clairs)", desc: "Une seule couleur : médaillon d'encre, tête réservée, yeux, sourcils et bec à l'encre." }));
files.set("logo/aethryon-monochrome-light.svg", horizontal({ ink: C.ivory, symbol: monoLightSymbol, title: "AETHRYON — logo monochrome ivoire (fonds sombres)", desc: "Une seule couleur : tête ivoire évidée (yeux, sourcils, bec prennent la couleur du fond)." }));

// ---- Favicon et icônes ------------------------------------------------------------------------------
files.set("favicon/favicon.svg", symbolFile({
  small: true,
  title: "AETHRYON",
  desc: "Favicon : version optique des petites tailles (yeux et reflet agrandis), lisible à 16 px sur onglet clair ou sombre.",
}).replace('width="512" height="512"', 'width="32" height="32"'));
/** Icône d'application : carré obsidienne plein cadre ; tête dans la zone sûre (cercle de 80 %). */
function appIcon({ title, desc }) {
  const size = 512;
  const head = inner(G.headNodes("obsidian", { medallion: false }));
  // Cadre de la tête (pointes des aigrettes → menton), centré ; échelle telle que les pointes restent
  // dans le cercle de sécurité « maskable » (rayon 40 %).
  const F = G.HEAD_FRAME;
  const cx = 200, cy = F.y + F.h / 2 + 4;
  const tip = Math.hypot(cx - F.x, cy - F.y);
  const k = (0.38 * size) / tip;
  return doc({
    viewBox: `0 0 ${size} ${size}`, width: size, height: size, title, desc, defs: head.defs,
    body: `  <rect id="tile" width="${size}" height="${size}" fill="${C.obsidian}"/>\n  <g id="symbol" transform="translate(${n(size / 2 - cx * k)} ${n(size / 2 - cy * k)}) scale(${Math.round(k * 1e4) / 1e4})">\n${head.body}\n  </g>`,
  });
}
files.set("icons/app-icon.svg", appIcon({ title: "AETHRYON — icône d'application", desc: "Carré plein cadre (iOS arrondit lui-même les coins ; Android et PWA : « maskable », tête dans le cercle de sécurité de 80 %). Sert aussi d'avatar rond (Discord) : rien d'utile hors du cercle." }));

// ---- Mascotte ---------------------------------------------------------------------------------------
const POSES = { "owl-three-quarter": "three-quarter", "owl-front": "front", "owl-profile": "side" };
const EXPR_FR = {
  neutral: "neutre, calme", curious: "curieuse (tête inclinée, aigrettes dressées)", content: "contente (yeux rieurs)",
  closed: "yeux fermés (sommeil, clignement)", focused: "concentrée (paupières mi-closes, regard bas)", success: "réussite (aile levée, étincelle)",
  concerned: "préoccupée (discrète, jamais alarmante)", welcome: "bienvenue (premier contact : tête inclinée, aile à demi levée)",
};
function mascot(pose, expr, title) {
  const state = G.stateFor(expr);
  const { defs, body } = inner(G.owlScene(pose), { rig: G.rigTransforms(pose, state) });
  return doc({
    viewBox: `0 0 ${G.SIZE} ${G.SIZE}`, width: G.SIZE, height: G.SIZE, title,
    desc: `Mascotte AETHRYON — pose ${pose}, expression ${EXPR_FR[expr]}. Groupes nommés (head, face-left, eye-left-iris, beak, wing-left…), aplats de la palette uniquement.`,
    defs, body,
  });
}
for (const [file, pose] of Object.entries(POSES)) files.set(`mascot/${file}.svg`, mascot(pose, "neutral", `Chouette AETHRYON — ${{ "three-quarter": "trois quarts", front: "face", side: "profil" }[pose]}`));
for (const expr of G.EXPRESSIONS) files.set(`mascot/expressions/${expr}.svg`, mascot("three-quarter", expr, `Chouette AETHRYON — ${EXPR_FR[expr]}`));
{
  // Tête de la mascotte (écriture des facettes), de face : illustrations, avatars de réponses du robot.
  const nodes = [G.mascotHead()];
  const { defs, body } = inner(nodes, { rig: G.rigTransforms("front", G.REST) });
  const F = G.HEAD_FRAME, pad = 14;
  files.set("mascot/owl-head.svg", doc({
    viewBox: `${n(F.x - pad)} ${n(F.y - pad)} ${n(F.w + 2 * pad)} ${n(F.w + 2 * pad)}`, width: 256, height: 256,
    title: "Chouette AETHRYON — tête", desc: "Tête de la mascotte (plans ivoire et champagne, yeux noirs), de face, expression neutre.", defs, body,
  }));
}

// ---- Pictogrammes (grille 24, trait 1,6, currentColor ; couleur par défaut : encre) ---------------------
for (const name of IC.ICON_NAMES) {
  const kebab = name.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
  files.set(`icons/ui/${kebab}.svg`, [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="${IC.ICON_STROKE}" stroke-linecap="round" stroke-linejoin="round" color="${C.ink}" role="img" aria-labelledby="title">`,
    `  <title id="title">${IC.ICONS[name].label}</title>`,
    `  ${IC.iconMarkup(name)}`,
    "</svg>",
    "",
  ].join("\n"));
}

// ---- Écriture / vérification -------------------------------------------------------------------------
let stale = 0, written = 0;
for (const [rel, content] of files) {
  const path = join(BRAND, rel);
  const prev = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (CHECK) {
    if (prev !== content) { stale++; console.error(`à régénérer : brand/${rel}`); }
    continue;
  }
  if (prev !== content) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); written++; }
}
if (CHECK) {
  if (stale) { console.error(`export-owl-svgs : ${stale} fichier(s) en retard sur la géométrie`); process.exit(1); }
  console.log(`export-owl-svgs : ${files.size} fichiers à jour`);
} else console.log(`export-owl-svgs : ${files.size} fichiers (${written} écrits) dans brand/`);

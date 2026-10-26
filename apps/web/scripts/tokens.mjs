// Générateur des jetons AETHRYON depuis la source unique src/design/tokens.ts.
//   node scripts/tokens.mjs           écrit les sorties (proposition : rien ne les importe encore)
//   node scripts/tokens.mjs --check   prouve l'égalité avec les jetons d'aujourd'hui + contrastes (code 1 sinon)
// Sorties :
//   src/design/generated/theme.css        bloc @theme de Tailwind 4 (site, espace personnel, Control Center),
//                                          mêmes NOMS de variables que src/styles.css : adoption sans retouche
//   ../extension/src/shared/tokens.css    variables du popup et des réglages (clair + sombre), mêmes noms
//   src/design/generated/tokens.json      export DTCG (Design Tokens Community Group) pour les outils
//   src/design/generated/contrast.md      contrastes WCAG des paires texte/fond documentées
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const T = await import(join(WEB, "src/design/tokens.ts"));
const CHECK = process.argv.includes("--check");
const HEADER = "/* Généré par web/scripts/tokens.mjs depuis web/src/design/tokens.ts — ne pas éditer à la main. */";

// ---- WCAG ---------------------------------------------------------------------------------------------
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// ---- Sorties ------------------------------------------------------------------------------------------
const theme = [HEADER, "@theme {", ...T.webTheme.map(([k, v]) => `  ${k}: ${v};`), "}", ""].join("\n");
const ext = [
  HEADER,
  ":root {",
  "  color-scheme: light dark;",
  ...T.extensionTheme.map(([k, v]) => `  ${k}: ${v};`),
  "}",
  "@media (prefers-color-scheme: dark) {",
  "  :root {",
  ...T.extensionTheme.filter(([, , d]) => d !== null).map(([k, , d]) => `    ${k}: ${d};`),
  "  }",
  "}",
  "",
].join("\n");
const dtcg = {
  $description: "AETHRYON — jetons de design (format DTCG). Source : web/src/design/tokens.ts.",
  color: Object.fromEntries(Object.entries(T.color).map(([k, v]) => [k, { $type: "color", $value: v }])),
  owl: Object.fromEntries(Object.entries(T.owl).map(([k, v]) => [k, { $type: "color", $value: v }])),
  radius: Object.fromEntries(Object.entries(T.radius).map(([k, v]) => [k, { $type: "dimension", $value: v }])),
  duration: Object.fromEntries(Object.entries(T.duration).map(([k, v]) => [k, { $type: "duration", $value: `${v}ms` }])),
  easing: Object.fromEntries(Object.entries(T.ease).map(([k, v]) => [k, { $type: "cubicBezier", $value: v.replace(/cubic-bezier\(|\)/g, "").split(",").map(Number) }])),
  shadow: Object.fromEntries(Object.entries(T.shadow).map(([k, v]) => [k, { $type: "shadow", $value: v }])),
  font: Object.fromEntries(Object.entries(T.font).map(([k, v]) => [k, { $type: "fontFamily", $value: v }])),
  space: Object.fromEntries(T.space.map((v) => [String(v), { $type: "dimension", $value: `${v}px` }])),
};
const rows = T.contrastPairs.map(([fg, bg, min, use]) => {
  const r = contrast(T.color[fg], T.color[bg]);
  const ok = min === 0 ? "décor seulement" : r >= min ? "conforme" : "ÉCHEC";
  return { fg, bg, min, use, r, ok };
});
const contrastMd = [
  "<!-- Généré par web/scripts/tokens.mjs — ne pas éditer à la main. -->",
  "| Texte | Fond | Rapport | Seuil | Usage | Verdict |",
  "|---|---|---|---|---|---|",
  ...rows.map((x) => `| ${x.fg} \`${T.color[x.fg]}\` | ${x.bg} \`${T.color[x.bg]}\` | ${x.r.toFixed(2).replace(".", ",")}:1 | ${x.min ? `${x.min}:1` : "—"} | ${x.use} | ${x.ok} |`),
  "",
].join("\n");

const OUTPUTS = [
  [join(WEB, "src/design/generated/theme.css"), theme],
  [join(WEB, "..", "extension/src/shared/tokens.css"), ext],
  [join(WEB, "src/design/generated/tokens.json"), JSON.stringify(dtcg, null, 2) + "\n"],
  [join(WEB, "src/design/generated/contrast.md"), contrastMd],
];

// ---- Comparaison avec les feuilles actuelles ----------------------------------------------------------
const norm = (v) => v.replace(/\/\*[\s\S]*?\*\//g, "").trim().replace(/\s+/g, " ").toLowerCase();
function vars(block) {
  const out = new Map();
  for (const m of block.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1], norm(m[2]));
  return out;
}
function blockAfter(css, start) {
  const i = css.indexOf(start);
  if (i < 0) return "";
  let depth = 0, j = css.indexOf("{", i);
  for (let k = j; k < css.length; k++) {
    if (css[k] === "{") depth++;
    else if (css[k] === "}" && --depth === 0) return css.slice(j + 1, k);
  }
  return "";
}
function compare(label, current, generated) {
  const same = [], diff = [], added = [], missing = [];
  for (const [k, v] of generated) {
    if (!current.has(k)) added.push(k);
    else if (current.get(k) === v) same.push(k);
    else diff.push(`${k} : actuel « ${current.get(k)} » ≠ généré « ${v} »`);
  }
  for (const k of current.keys()) if (!generated.has(k)) missing.push(k);
  console.log(`${label} : ${same.length} identiques, ${diff.length} différents, ${added.length} nouveaux (additifs), ${missing.length} absents de la source`);
  for (const d of diff) console.log(`  ≠ ${d}`);
  if (added.length) console.log(`  + ${added.join(", ")}`);
  if (missing.length) console.log(`  − ${missing.join(", ")}`);
  return diff.length + missing.length;
}

if (CHECK) {
  let problems = 0;
  const styles = readFileSync(join(WEB, "src/styles.css"), "utf8");
  problems += compare("Site (src/styles.css, @theme)", vars(blockAfter(styles, "@theme")), new Map(T.webTheme.map(([k, v]) => [k, norm(v)])));
  const popup = readFileSync(join(WEB, "..", "extension/src/popup/popup.css"), "utf8");
  const light = vars(blockAfter(popup, ":root"));
  light.delete("--color-scheme");
  const dark = vars(blockAfter(blockAfter(popup, "@media (prefers-color-scheme: dark)"), ":root") || "");
  const darkFromRoot = vars(blockAfter(popup.slice(popup.indexOf("@media (prefers-color-scheme: dark)")), ":root"));
  problems += compare("Extension, clair (popup.css :root)", light, new Map(T.extensionTheme.map(([k, v]) => [k, norm(v)])));
  problems += compare("Extension, sombre (popup.css @media dark)", dark.size ? dark : darkFromRoot, new Map(T.extensionTheme.filter(([, , d]) => d !== null).map(([k, , d]) => [k, norm(d)])));
  const failed = rows.filter((x) => x.ok === "ÉCHEC");
  console.log(`Contrastes : ${rows.length - failed.length}/${rows.length} conformes${failed.length ? ` — ÉCHECS : ${failed.map((x) => `${x.fg}/${x.bg} ${x.r.toFixed(2)}`).join(", ")}` : ""}`);
  for (const [path, content] of OUTPUTS) if (!existsSync(path) || readFileSync(path, "utf8") !== content) { console.log(`à régénérer : ${path}`); problems++; }
  if (problems || failed.length) process.exit(1);
  console.log("tokens : OK (valeurs identiques aux feuilles actuelles pour chaque nom existant)");
} else {
  for (const [path, content] of OUTPUTS) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
  console.log(`tokens : ${OUTPUTS.length} fichiers écrits`);
}

// Corrige la typographie française DANS LES TEXTES SEULEMENT (littéraux de chaîne, gabarits, texte JSX), jamais
// dans le code : espace insécable avant « : », espace fine insécable avant ; ! ?, espaces insécables dans « ».
// Usage : node scripts/typographie.mjs <fichiers…>
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const ts = createRequire(import.meta.url)("typescript");
const NB = " ", FINE = " ";

for (const f of process.argv.slice(2)) {
  const texte = readFileSync(f, "utf8");
  const src = ts.createSourceFile(f, texte, ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const plages = [];
  const visiter = (n) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) || ts.isJsxText(n)) {
      plages.push([n.getStart(src), n.getEnd()]);
    }
    ts.forEachChild(n, visiter);
  };
  visiter(src);
  let sortie = texte;
  for (const [a, b] of plages.sort((x, y) => y[0] - x[0])) {
    const morceau = sortie.slice(a, b);
    if (!/[a-zà-ÿ]{2}/i.test(morceau) || /^["'`](https?:|data:|\/|[A-Za-z]:\\)/.test(morceau)) continue;
    const corrige = morceau
      .replace(/([A-Za-zÀ-ÿ0-9)»%]) ([;!?])(?=[\s"'`<$]|$)/g, `$1${FINE}$2`)
      .replace(/([A-Za-zÀ-ÿ0-9)»%]) :(?=[\s"'`<$]|$)/g, `$1${NB}:`)
      .replace(/« /g, `«${NB}`)
      .replace(/ »/g, `${NB}»`);
    sortie = sortie.slice(0, a) + corrige + sortie.slice(b);
  }
  if (sortie !== texte) {
    writeFileSync(f, sortie);
    console.log("corrigé :", f);
  }
}

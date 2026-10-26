// Qualité transversale : typographie française de TOUS les textes de l'interface (analyse syntaxique TypeScript),
// et compatibilité avec Chromium 99 (CEP 12) du CSS et du JavaScript livrés.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const RACINE = join(__dirname, "..", "..");
function fichiers(dossier: string, ext: RegExp): string[] {
  return readdirSync(dossier).flatMap((n) => {
    const c = join(dossier, n);
    return statSync(c).isDirectory() ? fichiers(c, ext) : ext.test(n) ? [c] : [];
  });
}

/** Textes visibles : littéraux de chaîne, gabarits et texte JSX (les imports, clés et sélecteurs sont ignorés). */
function textes(fichier: string): { texte: string; ligne: number }[] {
  const src = ts.createSourceFile(fichier, readFileSync(fichier, "utf8"), ts.ScriptTarget.Latest, true, fichier.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const sortie: { texte: string; ligne: number }[] = [];
  const visiter = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) || ts.isJsxText(n)) {
      sortie.push({ texte: n.getText(src), ligne: src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1 });
    }
    ts.forEachChild(n, visiter);
  };
  visiter(src);
  return sortie;
}

describe("typographie française de l'interface", () => {
  const sources = [...fichiers(join(RACINE, "src", "ui"), /\.tsx?$/), ...fichiers(join(RACINE, "src", "etat"), /\.ts$/), join(RACINE, "src", "api", "client.ts"), join(RACINE, "src", "lib", "urls.ts"), join(RACINE, "src", "noeud", "services.ts")];
  it("pas d'espace ordinaire avant : ; ! ? ni à l'intérieur de « », pas d'apostrophe droite dans un mot", () => {
    const fautes: string[] = [];
    for (const f of sources) {
      for (const { texte, ligne } of textes(f)) {
        if (!/[a-zà-ÿ]{2}/i.test(texte) || /^["'`]\s*[.#\[]/.test(texte) || /^["'`](https?:|data:|\/|[A-Za-z]:\\)/.test(texte)) continue;
        const t = texte.replace(/\$\{[^}]*\}/g, "X");
        const probleme =
          /[A-Za-zÀ-ÿ0-9)»%] [;!?](?=[\s"'`<]|$)/.test(t) ? "espace ordinaire avant ; ! ?" :
          /[A-Za-zÀ-ÿ0-9)»%] :(?=[\s"'`<]|$)/.test(t) ? "espace ordinaire avant :" :
          /« |«(?=[A-Za-zÀ-ÿ])| »|[A-Za-zÀ-ÿ]»/.test(t) ? "guillemets sans espace insécable" :
          /[A-Za-zÀ-ÿ]'[A-Za-zÀ-ÿ]/.test(t) && !/class|aria|data-|querySelector/.test(t) ? "apostrophe droite" : null;
        if (probleme) fautes.push(`${f.replace(RACINE + "/", "")}:${ligne} ${probleme} : ${t.slice(0, 90)}`);
      }
    }
    expect(fautes).toEqual([]);
  });
});

describe("compatibilité Chromium 99 (CEP 12)", () => {
  it("CSS : ni :has(), ni requêtes de conteneur, ni imbrication, ni color-mix, ni text-wrap", () => {
    for (const f of fichiers(join(RACINE, "src", "styles"), /\.css$/)) {
      const css = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(css, f).not.toMatch(/:has\(|@container|container-type|color-mix\(|text-wrap|@layer|:is\(|&\s*[.:{]|\binset-inline|\bdvh\b|\bsvh\b/);
    }
  });
  it("JavaScript : aucune API postérieure à Chromium 99 dans les sources", () => {
    for (const f of fichiers(join(RACINE, "src"), /\.tsx?$/)) {
      const code = readFileSync(f, "utf8").replace(/\/\/.*$/gm, "");
      expect(code, f).not.toMatch(/\.at\(-?\d|structuredClone|\.toSorted\(|\.toReversed\(|\.findLastIndex\(|Promise\.withResolvers|AbortSignal\.(any|timeout)|Array\.fromAsync|\.replaceAll\(|Object\.groupBy|\.hasOwn\(/);
    }
  });
});

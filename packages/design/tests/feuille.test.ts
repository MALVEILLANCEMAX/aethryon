// Isolation de la feuille : brancher Égide ne change AUCUN écran existant (site, Desktop, popup). Toute règle vise une
// classe .eg-* ou un attribut data-eg-* ; sur :root / :host il n'y a que des variables --eg-* ; tout est en couches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ICI = import.meta.dirname;

function regles(css: string): { sel: string; corps: string }[] {
  const propre = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@font-face\s*\{[^}]*\}/g, "").replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*\s*\}/g, "");
  const out: { sel: string; corps: string }[] = [];
  for (const m of propre.matchAll(/([^{};]+)\{([^{}]*)\}/g)) out.push({ sel: (m[1] ?? "").trim(), corps: m[2] ?? "" });
  return out;
}

/** Sépare une liste de sélecteurs sur les virgules de premier niveau (pas celles de :is(…)). */
function decouper(sel: string): string[] {
  const out: string[] = [];
  let p = 0, cur = "";
  for (const c of sel) {
    if (c === "(") p++;
    if (c === ")") p--;
    if (c === "," && p === 0) { out.push(cur.trim()); cur = ""; } else cur += c;
  }
  return [...out, cur.trim()].filter(Boolean);
}

for (const [fichier, racine] of [["egide.css", ":root"], ["egide-shadow.css", ":host"]] as const) {
  test(`${fichier} : aucune règle hors du périmètre Égide`, () => {
    const css = readFileSync(join(ICI, "../genere", fichier), "utf8");
    const l = regles(css);
    assert.ok(l.length > 150, `${l.length} règles lues`);
    for (const { sel, corps } of l) {
      for (const partie of decouper(sel)) {
        if (partie === racine) {
          const decl = corps.split(";").map((d) => d.trim()).filter(Boolean);
          assert.ok(decl.every((d) => d.startsWith("--eg-")), `${partie} ne déclare que des variables --eg-* (${decl.find((d) => !d.startsWith("--eg-"))})`);
          continue;
        }
        if (/^::view-transition-(old|new)\(root\)$/.test(partie)) continue;
        assert.ok(/\.eg-|\[data-eg-/.test(partie), `sélecteur hors périmètre : « ${partie} »`);
      }
    }
    // Hors des couches : seulement @font-face, @keyframes et la déclaration d'ordre.
    const horsCouches = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@layer [a-z, ]+;/g, "").replace(/@font-face\s*\{[^}]*\}/g, "");
    let profondeur = 0, dehors = "";
    for (let i = 0; i < horsCouches.length; i++) {
      if (profondeur === 0 && horsCouches.startsWith("@layer", i)) { const j = horsCouches.indexOf("{", i); i = j; profondeur = 1; continue; }
      const c = horsCouches[i];
      if (c === "{") profondeur++;
      else if (c === "}") profondeur--;
      else if (profondeur === 0) dehors += c;
    }
    assert.equal(dehors.trim(), "", "tout est rangé dans @layer theme / base / components");
  });
}

// Génération de la partie « jetons » des feuilles egide.css (document) et EGIDE_CSS_SHADOW (racine Shadow DOM), À
// PARTIR DU MOTEUR : les blocs des thèmes officiels sont exactement ce que resoudreTheme() calcule (une seule source).
// Utilisé par scripts/build.mjs (et par les essais) ; jamais à l'exécution dans les produits.
import {
  BORDURES, COURBES, DIMENSIONS, DUREES, EFFETS_MODE, ESPACEMENTS, FAMILLES, MOUVEMENTS, PLANS, PREFIXE, RAYON_PASTILLE, TAILLES_TEXTE, TITRE_HEROS,
} from "./jetons.ts";
import { resoudreTheme } from "./moteur.ts";
import { BASES, docOfficiel } from "./themes.ts";
import { valeursCategorielles, variablesTheme } from "./variables.ts";

export type Racine = ":root" | ":host";

const bloc = (selecteur: string, decl: Record<string, string>, retrait = "  "): string =>
  `${retrait}${selecteur} {\n${Object.entries(decl).map(([k, v]) => `${retrait}  ${k}: ${v};`).join("\n")}\n${retrait}}`;

/** Jetons statiques (indépendants du thème), posés une fois sur la racine. */
export function jetonsStatiques(): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(ESPACEMENTS)) o[`${PREFIXE}s-${k}`] = `${v}px`;
  o[`${PREFIXE}f-ui`] = FAMILLES.ui;
  o[`${PREFIXE}f-mono`] = FAMILLES.mono;
  o[`${PREFIXE}f-marque`] = FAMILLES.display;
  o[`${PREFIXE}fs-d-xl`] = TITRE_HEROS;
  o[`${PREFIXE}r-pill`] = RAYON_PASTILLE;
  for (const [k, v] of Object.entries(BORDURES)) o[`${PREFIXE}b-${k}`] = v;
  for (const [k, v] of Object.entries(COURBES)) o[`${PREFIXE}e-${k}`] = v;
  for (const [k, v] of Object.entries(PLANS)) o[`${PREFIXE}z-${k}`] = String(v);
  return o;
}

/** Jetons CALCULÉS par portée (taille du texte, densité, mouvement) : redéclarés sur chaque élément qui porte un thème. */
export function jetonsDePortee(): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(TAILLES_TEXTE)) o[`${PREFIXE}fs-${k}`] = `calc(${v}px * var(${PREFIXE}t-scale))`;
  for (const [k, v] of Object.entries(DIMENSIONS)) o[`${PREFIXE}${k}`] = `calc(${v}px * var(${PREFIXE}density))`;
  for (const [k, v] of Object.entries(DUREES)) o[`${PREFIXE}d-${k}`] = `calc(${v}ms * var(${PREFIXE}motion-scale))`;
  return o;
}

/** Feuille des jetons (couche « theme ») pour une racine de document ou de Shadow DOM. */
export function cssJetons(racine: Racine): string {
  const L: string[] = ["@layer theme {"];
  L.push(bloc(racine, jetonsStatiques()));
  // Les six thèmes : les cinq bases officielles (Obsidian par défaut sur la racine) ; « custom » = variables en ligne.
  for (const b of BASES) {
    const r = resoudreTheme(docOfficiel(b));
    const sel = b === "obsidian" ? `${racine}, [data-eg-theme="obsidian"]` : `[data-eg-theme="${b}"]`;
    L.push(bloc(sel, { ...variablesTheme(r).vars, ...valeursCategorielles(r) }));
  }
  // Choix fermés portés par des attributs (thèmes personnels, réglages) : APRÈS les blocs, ils l'emportent.
  for (const mode of ["sombre", "clair"] as const) {
    const fx = EFFETS_MODE[mode];
    L.push(bloc(`[data-eg-mode="${mode}"]`, {
      [`${PREFIXE}color-scheme`]: mode === "sombre" ? "dark" : "light",
      [`${PREFIXE}sheen`]: fx.sheen, [`${PREFIXE}shadow-pop`]: fx["shadow-pop"], [`${PREFIXE}shadow-1`]: fx["shadow-1"], [`${PREFIXE}scrim`]: fx.scrim,
    }));
  }
  L.push(bloc(`[data-eg-sheen="0"]`, { [`${PREFIXE}sheen`]: "none" }));
  L.push(bloc(`[data-eg-oled="1"]`, { [`${PREFIXE}shadow-pop`]: `0 0 0 1px var(${PREFIXE}c-line-strong)`, [`${PREFIXE}shadow-1`]: "none" }));
  L.push(bloc(`[data-eg-typo="egide"], [data-eg-typo="lecture"]`, { [`${PREFIXE}f-display`]: FAMILLES.display, [`${PREFIXE}f-display-w`]: "400", [`${PREFIXE}f-display-ls`]: "-.005em" }));
  L.push(bloc(`[data-eg-typo="sobre"]`, { [`${PREFIXE}f-display`]: FAMILLES.ui, [`${PREFIXE}f-display-w`]: "640", [`${PREFIXE}f-display-ls`]: "-.02em" }));
  for (const [k, [ms, mv]] of Object.entries(MOUVEMENTS)) L.push(bloc(`[data-eg-motion="${k}"]`, { [`${PREFIXE}motion-scale`]: String(ms), [`${PREFIXE}move`]: String(mv) }));
  // Jetons calculés : sur la racine, sur chaque portée à thème et sur .eg-scope.
  L.push(bloc(`${racine}, [data-eg-theme], .eg-scope`, jetonsDePortee()));
  // Le système demande moins de mouvement : « réduite », sauf choix explicite dans un thème personnel.
  L.push("  @media (prefers-reduced-motion: reduce) {");
  L.push(bloc(`${racine}, [data-eg-theme]`, { [`${PREFIXE}motion-scale`]: "0.5", [`${PREFIXE}move`]: "0" }, "    "));
  L.push(bloc(`[data-eg-motion="aucune"]`, { [`${PREFIXE}motion-scale`]: "0", [`${PREFIXE}move`]: "0" }, "    "));
  for (const k of ["complete", "douce"] as const) {
    const [ms, mv] = MOUVEMENTS[k];
    L.push(bloc(`[data-eg-motion-explicite="1"][data-eg-motion="${k}"]`, { [`${PREFIXE}motion-scale`]: String(ms), [`${PREFIXE}move`]: String(mv) }, "    "));
  }
  L.push("  }", "}");
  return L.join("\n") + "\n";
}

/** Déclaration de l'ordre des couches, identique à celle de Tailwind 4 (le site garde ses utilitaires au-dessus). */
export const ORDRE_COUCHES = "@layer theme, base, components, utilities;\n";

/**
 * Passe une feuille écrite pour un document en feuille de racine Shadow DOM, sans @font-face : « :root » devient
 * « :host, .eg-racine ». Les jetons sont redéclarés sur .eg-racine (élément INTERNE que la page ne peut pas cibler) :
 * une règle de la page sur l'élément hôte l'emporterait sur :host et ses variables hériteraient dans l'ombre.
 */
export function versShadow(css: string): string {
  return css.replace(/@font-face\s*\{[^}]*\}\s*/g, "").replace(/:root\b/g, ":host, .eg-racine");
}

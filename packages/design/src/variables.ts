// Thème résolu -> variables CSS « --eg-* » et attributs « data-eg-* ».
// Deux familles : les VALEURS (couleurs #RRGGBB, rayons en px, nombres) posées par CSSOM (style.setProperty, permis
// par la CSP stricte du site) et les CHOIX FERMÉS (mode, typographie, mouvement, reflet, grain, OLED) portés par des
// attributs que la feuille egide.css traduit en variables (voile, ombres, reflet, familles, durées). Ainsi le script
// de démarrage n'écrit jamais que des couleurs et des nombres validés, jamais une valeur CSS libre.
import { DENSITES, EFFETS_MODE, FAMILLES, MOUVEMENTS, PREFIXE, RAPPORTS_RAYONS } from "./jetons.ts";
import { couleursCompletes, type ThemeResolu } from "./moteur.ts";
import { DERIVES, ROLES, type ThemeId } from "./themes.ts";

/** Noms des attributs posés sur la portée (racine du document, racine Shadow DOM ou aperçu). */
export const ATTRIBUTS = {
  theme: "data-eg-theme",
  mode: "data-eg-mode",
  motion: "data-eg-motion",
  motionExplicite: "data-eg-motion-explicite",
  typo: "data-eg-typo",
  sheen: "data-eg-sheen",
  grain: "data-eg-grain",
  oled: "data-eg-oled",
  contraste: "data-eg-contrast",
} as const;

/** Noms de toutes les variables de VALEUR qu'un thème peut poser en ligne (liste fermée, relue par le démarrage). */
export const VARIABLES_VALEUR: readonly string[] = [
  ...ROLES.map((r) => `${PREFIXE}c-${r}`),
  ...DERIVES.map((d) => `${PREFIXE}c-${d}`),
  `${PREFIXE}r-panel`, `${PREFIXE}r-control`, `${PREFIXE}r-media`, `${PREFIXE}r-sheet`,
  `${PREFIXE}density`, `${PREFIXE}t-scale`, `${PREFIXE}lh-body`,
];

export interface VariablesTheme {
  /** Identifiant posé dans data-eg-theme : la base pour un thème officiel pur, « custom » sinon. */
  theme: ThemeId;
  vars: Record<string, string>;
  attrs: Record<string, string>;
}

const arrondi = (v: number, n = 4) => String(Math.round(v * 10 ** n) / 10 ** n);

export function rayons(panel: number): Record<string, string> {
  const p = Math.max(0, Math.min(20, panel));
  return {
    [`${PREFIXE}r-panel`]: `${p}px`,
    [`${PREFIXE}r-control`]: `${Math.round(p * RAPPORTS_RAYONS.control)}px`,
    [`${PREFIXE}r-media`]: `${Math.round(p * RAPPORTS_RAYONS.media)}px`,
    [`${PREFIXE}r-sheet`]: `${Math.round(p * RAPPORTS_RAYONS.sheet)}px`,
  };
}

/** Variables et attributs d'un thème résolu. */
export function variablesTheme(r: ThemeResolu): VariablesTheme {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(couleursCompletes(r))) vars[`${PREFIXE}c-${k}`] = v;
  Object.assign(vars, rayons(r.panel));
  vars[`${PREFIXE}density`] = arrondi(DENSITES[r.densite] ?? 1);
  vars[`${PREFIXE}t-scale`] = arrondi((r.typo === "lecture" ? 1.06 : 1) * r.echelle);
  vars[`${PREFIXE}lh-body`] = r.typo === "lecture" ? "1.6" : "1.5";
  const attrs: Record<string, string> = {
    [ATTRIBUTS.theme]: r.officiel ? r.base : "custom",
    [ATTRIBUTS.mode]: r.mode,
    [ATTRIBUTS.motion]: r.mouvement,
    [ATTRIBUTS.typo]: r.typo,
    [ATTRIBUTS.sheen]: r.effets.sheen ? "1" : "0",
    [ATTRIBUTS.grain]: r.effets.grain ? "1" : "0",
    [ATTRIBUTS.oled]: r.oled ? "1" : "0",
    [ATTRIBUTS.contraste]: r.contraste,
  };
  if (r.mouvementExplicite) attrs[ATTRIBUTS.motionExplicite] = "1";
  return { theme: r.officiel ? r.base : "custom", vars, attrs };
}

/**
 * Valeurs « catégorielles » d'un thème résolu, celles que la feuille déduit des attributs. Utilisées pour écrire
 * les blocs des thèmes officiels dans egide.css (le thème s'applique alors avec le seul attribut data-eg-theme).
 */
export function valeursCategorielles(r: ThemeResolu): Record<string, string> {
  const fx = EFFETS_MODE[r.mode];
  const [ms, mv] = MOUVEMENTS[r.mouvement];
  return {
    [`${PREFIXE}color-scheme`]: r.mode === "sombre" ? "dark" : "light",
    [`${PREFIXE}sheen`]: r.effets.sheen ? fx.sheen : "none",
    [`${PREFIXE}shadow-pop`]: r.oled ? `0 0 0 1px ${r.c["line-strong"]}` : fx["shadow-pop"],
    [`${PREFIXE}shadow-1`]: r.oled ? "none" : fx["shadow-1"],
    [`${PREFIXE}scrim`]: fx.scrim,
    [`${PREFIXE}motion-scale`]: String(ms),
    [`${PREFIXE}move`]: String(mv),
    [`${PREFIXE}f-display`]: r.typo === "sobre" ? FAMILLES.ui : FAMILLES.display,
    [`${PREFIXE}f-display-w`]: r.typo === "sobre" ? "640" : "400",
    [`${PREFIXE}f-display-ls`]: r.typo === "sobre" ? "-.02em" : "-.005em",
  };
}

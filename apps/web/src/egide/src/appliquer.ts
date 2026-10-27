// Application d'un thème à une PORTÉE : la racine du document (site, Desktop), un élément d'une racine Shadow DOM
// (extension) ou un sous-arbre d'aperçu (éditeur). Seulement par CSSOM et attributs : aucune feuille ni aucun
// script ajoutés, ce que la CSP stricte du site permet (style-src 'self' n'interdit pas style.setProperty).
import { resoudreTheme, type ThemeResolu } from "./moteur.ts";
import { normaliserDoc } from "./schema.ts";
import { CUSTOM_EXEMPLE, docOfficiel, estBase, type DocTheme, type ThemeId } from "./themes.ts";
import { ATTRIBUTS, VARIABLES_VALEUR, variablesTheme } from "./variables.ts";

/** Ce qu'on peut appliquer : l'identifiant d'un des six thèmes, un document (déjà validé) ou un thème résolu. */
export type EntreeTheme = ThemeId | DocTheme | ThemeResolu;

/** Nom de l'événement émis sur la portée après chaque application (detail : { theme: ThemeResolu }). */
export const EVENEMENT_THEME = "eg-theme";

function estResolu(x: EntreeTheme): x is ThemeResolu {
  return typeof x === "object" && "c" in x && "seuils" in x;
}

/** Résout une entrée en thème complet (« custom » sans document = l'exemple Vert-de-gris). */
export function resoudreEntree(entree: EntreeTheme): ThemeResolu {
  if (typeof entree === "string") return resoudreTheme(estBase(entree) ? docOfficiel(entree) : normaliserDoc(CUSTOM_EXEMPLE));
  if (estResolu(entree)) return entree;
  return resoudreTheme(normaliserDoc(entree));
}

/** Retire de la portée tout ce qu'un thème y a posé (variables en ligne et attributs data-eg-*). */
export function retirerTheme(cible: HTMLElement): void {
  for (const v of VARIABLES_VALEUR) cible.style.removeProperty(v);
  for (const a of Object.values(ATTRIBUTS)) cible.removeAttribute(a);
}

export interface OptionsApplication {
  /** Fondu croisé natif (View Transitions) quand c'est possible et que le mouvement n'est pas coupé. */
  transition?: boolean;
}

/**
 * Applique un thème à une portée et renvoie le thème résolu. Un thème officiel sans retouche n'écrit AUCUNE variable
 * en ligne : la feuille egide.css porte ses valeurs ([data-eg-theme="…"]). Un thème personnalisé écrit ses couleurs
 * et ses nombres en ligne.
 */
export function appliquerTheme(cible: HTMLElement, entree: EntreeTheme, options: OptionsApplication = {}): ThemeResolu {
  const r = resoudreEntree(entree);
  const poser = () => {
    const { vars, attrs } = variablesTheme(r);
    retirerTheme(cible);
    for (const [k, v] of Object.entries(attrs)) cible.setAttribute(k, v);
    if (!r.officiel) for (const [k, v] of Object.entries(vars)) cible.style.setProperty(k, v);
    cible.dispatchEvent(new CustomEvent(EVENEMENT_THEME, { detail: { theme: r }, bubbles: false }));
  };
  const doc = cible.ownerDocument as Document & { startViewTransition?: (f: () => void) => unknown };
  const reduit = doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (options.transition && typeof doc.startViewTransition === "function" && !reduit && r.mouvement !== "aucune" && cible === doc.documentElement) {
    doc.startViewTransition(poser);
  } else poser();
  return r;
}

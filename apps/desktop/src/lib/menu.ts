// Navigation PURE d'un menu (D-SPEC §B.5.4) : surbrillance initiale sur le premier élément actif, flèches en boucle
// qui sautent les éléments désactivés, Début et Fin, première lettre en cycle ; position sous le pointeur, retournée
// si elle déborde (marge de 8 px). Aucune dépendance au DOM : essais dans menu.test.ts.
import { sansAccents } from "./bibliotheque";

export interface ElementNavigable { libelle: string; desactive?: boolean }

/** Index du premier élément actif, ou -1 si tous sont désactivés. */
export function premierActif(el: readonly ElementNavigable[]): number {
  return el.findIndex((e) => !e.desactive);
}

export function dernierActif(el: readonly ElementNavigable[]): number {
  for (let i = el.length - 1; i >= 0; i--) if (!el[i].desactive) return i;
  return -1;
}

/** Élément actif suivant (sens +1) ou précédent (−1), en boucle. Depuis -1 : premier ou dernier actif. */
export function suivant(el: readonly ElementNavigable[], courant: number, sens: 1 | -1): number {
  const n = el.length;
  if (n === 0) return -1;
  if (courant < 0) return sens === 1 ? premierActif(el) : dernierActif(el);
  for (let k = 1; k <= n; k++) {
    const i = (((courant + sens * k) % n) + n) % n;
    if (!el[i].desactive) return i;
  }
  return courant;
}

/** Premier élément actif dont le libellé commence par cette lettre, après le courant, en cycle (sans accents). */
export function parLettre(el: readonly ElementNavigable[], courant: number, lettre: string): number {
  const l = sansAccents(lettre).toLowerCase();
  if (!l || l.length !== 1) return courant;
  const n = el.length;
  for (let k = 1; k <= n; k++) {
    const i = (((courant + k) % n) + n) % n;
    if (!el[i].desactive && sansAccents(el[i].libelle).toLowerCase().startsWith(l)) return i;
  }
  return courant;
}

export type Touche = "ArrowDown" | "ArrowUp" | "Home" | "End" | string;

/** Nouvelle surbrillance pour une touche de navigation, ou `null` si la touche ne navigue pas. */
export function naviguer(el: readonly ElementNavigable[], courant: number, touche: Touche): number | null {
  if (touche === "ArrowDown") return suivant(el, courant, 1);
  if (touche === "ArrowUp") return suivant(el, courant, -1);
  if (touche === "Home") return premierActif(el);
  if (touche === "End") return dernierActif(el);
  if (touche.length === 1 && /\p{L}|\d/u.test(touche)) return parLettre(el, courant, touche);
  return null;
}

/**
 * Position d'un menu de taille (l, h) ouvert au point (x, y) : (x + 2, y + 2), retourné à gauche ou en haut s'il
 * déborde, toujours à 8 px au moins des bords. `origine` : coin d'où le menu grandit (transform-origin).
 */
export function positionAuPoint(x: number, y: number, l: number, h: number, vue: { largeur: number; hauteur: number }, marge = 8): { x: number; y: number; origine: string } {
  let px = x + 2;
  let py = y + 2;
  let ox = "left";
  let oy = "top";
  if (px + l > vue.largeur - marge) { px = x - 2 - l; ox = "right"; }
  if (py + h > vue.hauteur - marge) { py = y - 2 - h; oy = "bottom"; }
  px = Math.max(marge, Math.min(px, vue.largeur - l - marge));
  py = Math.max(marge, Math.min(py, vue.hauteur - h - marge));
  return { x: px, y: py, origine: `${oy} ${ox}` };
}

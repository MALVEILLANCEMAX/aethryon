// Grille virtualisée de la Bibliothèque (pure, testée) : seules les cartes visibles (plus une marge) sont rendues, à
// position calculée ; des dizaines de milliers de médias gardent quelques dizaines de nœuds dans le DOM.

export interface ReglesGrille {
  /** Largeur minimale d'une carte (px) : le nombre de colonnes en découle. */
  min: number;
  ecartX: number;
  ecartY: number;
  /** Hauteur de la miniature / largeur (16:9 = 0,5625). */
  ratio: number;
  /** Hauteur fixe du bloc de texte sous la miniature (titre, méta), écart compris. */
  texte: number;
  /** Colonnes au moins (2) et au plus. */
  minCol?: number;
  maxCol?: number;
}

export interface Disposition {
  colonnes: number;
  largeurCarte: number;
  hauteurCarte: number;
  /** Pas vertical d'une ligne (carte + écart). */
  pas: number;
  ecartX: number;
}

export function disposer(largeur: number, r: ReglesGrille): Disposition {
  const l = Math.max(0, largeur);
  const brut = Math.floor((l + r.ecartX) / (r.min + r.ecartX));
  const colonnes = Math.max(r.minCol ?? 2, Math.min(r.maxCol ?? 12, brut || 1));
  const largeurCarte = Math.max(1, (l - r.ecartX * (colonnes - 1)) / colonnes);
  const hauteurCarte = Math.round(largeurCarte * r.ratio + r.texte);
  return { colonnes, largeurCarte, hauteurCarte, pas: hauteurCarte + r.ecartY, ecartX: r.ecartX };
}

/** Disposition en liste : une colonne, lignes de hauteur fixe. */
export function disposerListe(largeur: number, hauteurLigne: number): Disposition {
  return { colonnes: 1, largeurCarte: Math.max(1, largeur), hauteurCarte: hauteurLigne, pas: hauteurLigne, ecartX: 0 };
}

export function hauteurTotale(d: Disposition, total: number): number {
  if (total <= 0) return 0;
  const lignes = Math.ceil(total / d.colonnes);
  return lignes * d.pas - (d.pas - d.hauteurCarte);
}

export function position(d: Disposition, i: number): { x: number; y: number } {
  const ligne = Math.floor(i / d.colonnes);
  const col = i % d.colonnes;
  return { x: Math.round(col * (d.largeurCarte + d.ecartX)), y: ligne * d.pas };
}

/**
 * Plage [debut, fin) des éléments à rendre : lignes coupant la vue [haut, haut + hauteurVue] (coordonnées de la
 * grille), plus `marge` lignes de chaque côté (défilement sans trou).
 */
export function plage(d: Disposition, total: number, haut: number, hauteurVue: number, marge = 2): { debut: number; fin: number } {
  if (total <= 0) return { debut: 0, fin: 0 };
  const premiere = Math.max(0, Math.floor(haut / d.pas) - marge);
  const derniere = Math.max(0, Math.floor((haut + Math.max(0, hauteurVue)) / d.pas) + marge);
  const debut = Math.min(total, premiere * d.colonnes);
  const fin = Math.min(total, (derniere + 1) * d.colonnes);
  return { debut, fin: Math.max(debut, fin) };
}

/**
 * Défilement à appliquer pour rendre l'élément i entièrement visible (null s'il l'est déjà). `haut` : défilement
 * actuel de la grille ; `entete` : hauteur masquée en haut de la vue (barre d'outils collante).
 */
export function defilementPour(d: Disposition, i: number, haut: number, hauteurVue: number, entete = 0): number | null {
  const { y } = position(d, i);
  if (y < haut + entete) return Math.max(0, y - entete);
  if (y + d.hauteurCarte > haut + hauteurVue) return y + d.hauteurCarte - hauteurVue;
  return null;
}

// Jetons de mouvement 3.8 (C-PLAN §B.3 et §I.1, D-SPEC §B.2), miroir de styles/tokens.css. Aucune bibliothèque :
// les ressorts de masse 1 sont fournis en `linear()` (calculés par outils/ressorts2.mjs), joués par CSS ou par WAAPI.
// Règles : seulement transform et opacity ; jamais d'animation pour une action au clavier ; mouvement réduit du
// système ET réglage « Réduire les animations » (lib/mouvement.ts) ; aucune progression inventée.
import { mouvementReduit } from "./mouvement";

/** Durées en millisecondes. */
export const DUREE = { appui: 80, survol: 140, petite: 200, menu: 120, menuSortie: 90, moyenne: 280, grande: 420, hero: 620 } as const;
/** La sortie dure 0,65 × l'entrée. */
export const SORTIE = 0.65;
export const COURBE = {
  out: "cubic-bezier(0.22, 0.8, 0.26, 1)",
  in: "cubic-bezier(0.32, 0, 0.67, 0)",
  inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
} as const;

export interface Ressort { raideur: number; amortissement: number; duree: number; courbe: string }
export const RESSORT: Record<"vif" | "doux" | "aimant" | "retour", Ressort> = {
  vif: { raideur: 520, amortissement: 34, duree: 289, courbe: "linear(0, 0.115 8.3%, 0.344 16.7%, 0.576 25%, 0.764 33.3%, 0.894 41.7%, 0.973 50%, 1.013 58.3%, 1.028 66.7%, 1.029 75%, 1.024 83.3%, 1.016 91.7%, 1)" },
  doux: { raideur: 260, amortissement: 30, duree: 346, courbe: "linear(0, 0.082 8.3%, 0.247 16.7%, 0.424 25%, 0.58 33.3%, 0.705 41.7%, 0.8 50%, 0.869 58.3%, 0.916 66.7%, 0.948 75%, 0.969 83.3%, 0.982 91.7%, 1)" },
  aimant: { raideur: 380, amortissement: 24, duree: 324, courbe: "linear(0, 0.111 8.3%, 0.346 16.7%, 0.599 25%, 0.812 33.3%, 0.96 41.7%, 1.046 50%, 1.081 58.3%, 1.084 66.7%, 1.068 75%, 1.047 83.3%, 1.026 91.7%, 1)" },
  retour: { raideur: 300, amortissement: 26, duree: 380, courbe: "linear(0, 0.114 8.3%, 0.342 16.7%, 0.574 25%, 0.761 33.3%, 0.89 41.7%, 0.969 50%, 1.01 58.3%, 1.026 66.7%, 1.028 75%, 1.023 83.3%, 1.016 91.7%, 1)" },
};

/** Cascade : 24 ms par élément, 8 éléments au plus (les suivants arrivent ensemble). */
export const CASCADE = { pas: 24, max: 8 } as const;
export function delaiCascade(i: number): number {
  return Math.max(0, Math.min(i, CASCADE.max)) * CASCADE.pas;
}

/** Au-delà de ce nombre de cartes visibles, pas d'animation de mise en page (60 images par seconde d'abord). */
export const MAX_MISE_EN_PAGE = 60;

export interface Position { x: number; y: number }

/** Position dans le conteneur (offsetLeft/Top) : insensible au défilement de la page. */
function position(el: HTMLElement): Position {
  return { x: el.offsetLeft, y: el.offsetTop };
}

/**
 * Animation de mise en page (FLIP) en WAAPI, ressort `doux` : chaque élément part de son ancienne position et glisse
 * vers la nouvelle (transform seul). Renvoie le nombre d'éléments animés (0 en mouvement réduit ou au-delà du seuil).
 */
export function animerMiseEnPage(avant: Map<string, Position>, elements: Iterable<HTMLElement>, cle: (e: HTMLElement) => string | null): number {
  if (mouvementReduit() || avant.size === 0) return 0;
  const liste = [...elements];
  if (liste.length > MAX_MISE_EN_PAGE) return 0;
  let n = 0;
  for (const el of liste) {
    const id = cle(el);
    const a = id ? avant.get(id) : undefined;
    if (!a || typeof el.animate !== "function") continue;
    const b = position(el);
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], { duration: RESSORT.doux.duree, easing: RESSORT.doux.courbe });
    n += 1;
  }
  return n;
}

/** Positions actuelles (après un rendu), pour la prochaine animation de mise en page. */
export function mesurer(elements: Iterable<HTMLElement>, cle: (e: HTMLElement) => string | null): Map<string, Position> {
  const m = new Map<string, Position>();
  for (const el of elements) {
    const id = cle(el);
    if (id) m.set(id, position(el));
  }
  return m;
}

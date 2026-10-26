// Petits magasins « vivants » de l'éditeur, hors de React : pendant un geste (poignée, déplacement de la sélection,
// barre du lecteur), la frise, le lecteur, la barre flottante et les champs de temps suivent la sélection SANS rendre
// tout l'éditeur à chaque mouvement de pointeur ; la retouche (Edit) n'est validée qu'au lâcher.
// Lecture dans un composant : useLive(magasin) (useSyncExternalStore) ; lecture hors de React : magasin.get() et
// magasin.subscribe() (la frise pose alors ses variables CSS elle-même).
import { useSyncExternalStore } from "react";

export interface Store<T> {
  get(): T;
  set(v: T): void;
  subscribe(fn: () => void): () => void;
}

export function store<T>(initial: T, same: (a: T, b: T) => boolean = Object.is): Store<T> {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(v) {
      if (same(value, v)) return;
      value = v;
      for (const fn of [...subs]) fn();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => { subs.delete(fn); };
    },
  };
}

export function useLive<T>(s: Store<T>): T {
  return useSyncExternalStore(s.subscribe, s.get, s.get);
}

/** Passage sélectionné, en secondes. `gesture` : un geste est en cours (la retouche n'est pas encore validée). */
export interface Span { start: number; end: number; gesture?: "start" | "end" | "move" | null }

export const sameSpan = (a: Span, b: Span) =>
  Math.abs(a.start - b.start) < 1e-6 && Math.abs(a.end - b.end) < 1e-6 && (a.gesture ?? null) === (b.gesture ?? null);

/** Aimantation : le point d'attache (secondes) et ce qu'il est, pour le guide de la frise ; null sans attache. */
export interface Snap { t: number; what: "playhead" | "start" | "end" | "media-start" | "media-end" | "second" }

// Un seul magasin d'état pour tout le panneau (DESIGN-SYSTEM §7.6 : « un seul magasin d'état »).
// Abonnement + sélecteur : une page ne se redessine que si la tranche qu'elle lit a changé.

import { useEffect, useRef, useState } from "preact/hooks";

export interface Magasin<E> {
  lire(): E;
  ecrire(maj: Partial<E> | ((e: E) => Partial<E>)): void;
  abonner(f: (e: E) => void): () => void;
}

export function creerMagasin<E extends object>(initial: E): Magasin<E> {
  let etat = initial;
  const abonnes = new Set<(e: E) => void>();
  let prevu = false;
  const annoncer = () => {
    prevu = false;
    for (const f of abonnes) f(etat);
  };
  return {
    lire: () => etat,
    ecrire(maj) {
      const partiel = typeof maj === "function" ? maj(etat) : maj;
      etat = { ...etat, ...partiel };
      // Regroupe les écritures d'un même tour : un seul rendu.
      if (!prevu) {
        prevu = true;
        queueMicrotask(annoncer);
      }
    },
    abonner(f) {
      abonnes.add(f);
      return () => abonnes.delete(f);
    },
  };
}

function egalSuperficiel(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  // Seuls les objets simples et les tableaux sont comparés champ par champ ; un Set, une Map, une date… par identité.
  const simple = (o: object) => Array.isArray(o) || Object.getPrototypeOf(o) === Object.prototype || Object.getPrototypeOf(o) === null;
  if (!simple(a as object) || !simple(b as object)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}

export function useSelection<E, T>(m: Magasin<E>, choisir: (e: E) => T): T {
  const [valeur, poser] = useState(() => choisir(m.lire()));
  const ref = useRef({ choisir, valeur });
  ref.current.choisir = choisir;
  ref.current.valeur = valeur;
  useEffect(() => {
    const verifier = (e: E) => {
      const v = ref.current.choisir(e);
      if (!egalSuperficiel(v, ref.current.valeur)) {
        ref.current.valeur = v;
        poser(() => v);
      }
    };
    verifier(m.lire());
    return m.abonner(verifier);
  }, [m]);
  return valeur;
}

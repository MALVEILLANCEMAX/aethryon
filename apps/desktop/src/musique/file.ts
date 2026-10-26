// File d'attente du lecteur (logique pure, essayée par vitest) : ordre de lecture, aléatoire, répétition, précédent /
// suivant, ajouts « à la suite » ou « à la fin », retrait, déplacement. Une référence = `loc:<id>` (fichier local) ou
// `cloud:<id>` (écoute sécurisée par lien signé). L'aléatoire garde le morceau en cours en tête, puis mélange le reste
// (Fisher–Yates) : rien ne se répète avant que tout soit passé.
import type { Repetition } from "./types";

export interface File {
  /** Références dans l'ordre naturel (celui de l'album, de la playlist ou de la sélection). */
  refs: string[];
  /** Ordre de lecture : indices dans `refs`. */
  ordre: number[];
  /** Position dans `ordre` du morceau en cours. */
  pos: number;
  aleatoire: boolean;
  repetition: Repetition;
}

export type Alea = () => number;

function melanger(v: number[], alea: Alea): number[] {
  const a = v.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(alea() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const VIDE: File = { refs: [], ordre: [], pos: 0, aleatoire: false, repetition: "non" };

export function creer(refs: string[], depart = 0, aleatoire = false, repetition: Repetition = "non", alea: Alea = Math.random): File {
  if (refs.length === 0) return { ...VIDE, aleatoire, repetition };
  const d = Math.min(Math.max(0, depart), refs.length - 1);
  const naturel = refs.map((_, i) => i);
  const ordre = aleatoire ? [d, ...melanger(naturel.filter((i) => i !== d), alea)] : naturel;
  return { refs: refs.slice(), ordre, pos: aleatoire ? 0 : d, aleatoire, repetition };
}

export function courant(f: File): string | null {
  return f.ordre.length ? f.refs[f.ordre[f.pos]] ?? null : null;
}

/** Morceaux à venir (après le morceau en cours), dans l'ordre de lecture. */
export function aVenir(f: File): string[] {
  return f.ordre.slice(f.pos + 1).map((i) => f.refs[i]);
}

/**
 * Morceau suivant. `auto` : fin naturelle du morceau (la répétition « un » rejoue le même) ; bouton « Suivant » : on
 * avance toujours. En fin de file : « tout » repart du début, sinon `null` (la lecture s'arrête).
 */
export function suivant(f: File, auto = false, alea: Alea = Math.random): File | null {
  if (!f.ordre.length) return null;
  if (auto && f.repetition === "un") return { ...f };
  if (f.pos + 1 < f.ordre.length) return { ...f, pos: f.pos + 1 };
  if (f.repetition === "non") return null;
  // « Tout » : nouveau tour ; en aléatoire, un nouveau mélange (le dernier joué ne revient pas en premier).
  if (f.aleatoire && f.ordre.length > 2) {
    const dernier = f.ordre[f.pos];
    let o = melanger(f.ordre, alea);
    if (o[0] === dernier) o = [...o.slice(1), dernier];
    return { ...f, ordre: o, pos: 0 };
  }
  return { ...f, pos: 0 };
}

/** « Précédent » : après 3 s de lecture, on revient au début du morceau ; sinon au morceau d'avant. */
export function precedent(f: File, positionS: number): { file: File; redemarrer: boolean } {
  if (!f.ordre.length) return { file: f, redemarrer: false };
  if (positionS > 3) return { file: f, redemarrer: true };
  if (f.pos > 0) return { file: { ...f, pos: f.pos - 1 }, redemarrer: false };
  if (f.repetition === "tout") return { file: { ...f, pos: f.ordre.length - 1 }, redemarrer: false };
  return { file: f, redemarrer: true };
}

export function basculerAleatoire(f: File, alea: Alea = Math.random): File {
  if (!f.ordre.length) return { ...f, aleatoire: !f.aleatoire };
  const c = f.ordre[f.pos];
  if (!f.aleatoire) {
    const reste = f.refs.map((_, i) => i).filter((i) => i !== c);
    return { ...f, aleatoire: true, ordre: [c, ...melanger(reste, alea)], pos: 0 };
  }
  return { ...f, aleatoire: false, ordre: f.refs.map((_, i) => i), pos: c };
}

export function cycleRepetition(r: Repetition): Repetition {
  return r === "non" ? "tout" : r === "tout" ? "un" : "non";
}

/** Ajoute des morceaux juste après celui en cours (« Lire ensuite ») ou à la fin (« Ajouter à la file »). */
export function ajouter(f: File, refs: string[], ou: "ensuite" | "fin"): File {
  if (!refs.length) return f;
  if (!f.ordre.length) return creer(refs, 0, f.aleatoire, f.repetition, () => 0.5);
  const base = f.refs.length;
  const nouveaux = refs.map((_, i) => base + i);
  const ordre = ou === "ensuite" ? [...f.ordre.slice(0, f.pos + 1), ...nouveaux, ...f.ordre.slice(f.pos + 1)] : [...f.ordre, ...nouveaux];
  return { ...f, refs: [...f.refs, ...refs], ordre };
}

/** Retire le n-ième morceau À VENIR (0 = le suivant). Le morceau en cours ne se retire pas d'ici. */
export function retirerAVenir(f: File, n: number): File {
  const p = f.pos + 1 + n;
  if (n < 0 || p >= f.ordre.length) return f;
  const ordre = f.ordre.slice();
  ordre.splice(p, 1);
  return { ...f, ordre };
}

/** Déplace un morceau à venir (glisser-déposer dans la file) : positions relatives aux morceaux à venir. */
export function deplacerAVenir(f: File, de: number, vers: number): File {
  const n = f.ordre.length - f.pos - 1;
  if (de < 0 || vers < 0 || de >= n || vers >= n || de === vers) return f;
  const venir = f.ordre.slice(f.pos + 1);
  const [x] = venir.splice(de, 1);
  venir.splice(vers, 0, x);
  return { ...f, ordre: [...f.ordre.slice(0, f.pos + 1), ...venir] };
}

/** Saute directement au n-ième morceau à venir. */
export function allerA(f: File, n: number): File {
  const p = f.pos + 1 + n;
  return p >= 0 && p < f.ordre.length ? { ...f, pos: p } : f;
}

/** Forme enregistrée par le cœur (lecture.json) : la file dans l'ordre de lecture, la position, les modes. */
export function versEtat(f: File): { file: string[]; index: number; aleatoire: boolean; repetition: Repetition } {
  return { file: f.ordre.map((i) => f.refs[i]), index: f.pos, aleatoire: f.aleatoire, repetition: f.repetition };
}

export function depuisEtat(e: { file: string[]; index: number; aleatoire: boolean; repetition: Repetition }): File {
  return { refs: e.file.slice(), ordre: e.file.map((_, i) => i), pos: Math.min(e.index, Math.max(0, e.file.length - 1)), aleatoire: e.aleatoire, repetition: e.repetition };
}

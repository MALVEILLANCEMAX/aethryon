// Adaptateur de SOURCE de la Bibliothèque. La grille ne lit jamais l'index directement : elle demande à une source le
// nombre de médias d'une requête (filtre, recherche, tri) et les médias d'une plage [debut, fin).
//  - Aujourd'hui : `vueInstantane` (tous les médias de l'instantané du cœur, en mémoire ; filtre et tri locaux).
//  - AETHRYON Index (feat/index, API paginée) : une source qui renvoie `undefined` pour les emplacements pas encore
//    chargés (la grille affiche un squelette) et charge les pages demandées par `charger` ; `ordre` vaut null tant que
//    tous les identifiants ne sont pas connus (Ctrl A et Maj + clic portent alors sur les médias chargés).
import { decompter, filtrer, trier, type Decompte, type Filtre, type Tri } from "./bibliotheque";
import type { Media } from "./types";

export interface RequeteMedias { filtre: Filtre; recherche: string; tri: Tri }

export interface VueSource {
  /** Nombre de médias de la requête. */
  total: number;
  /** Décomptes par type, recherche appliquée (puces de filtre). */
  decompte: Decompte;
  /** Médias de [debut, fin) ; `undefined` : emplacement pas encore chargé. */
  lire(debut: number, fin: number): (Media | undefined)[];
  /** Demande le chargement de [debut, fin) (source paginée) ; sans effet pour l'instantané. */
  charger(debut: number, fin: number): void;
  /** Tous les identifiants dans l'ordre, si la source les connaît. */
  ordre: string[] | null;
  /** Rang d'un média (−1 s'il est inconnu ou absent de la requête). */
  rang(id: string): number;
  /** Média chargé par identifiant. */
  media(id: string): Media | undefined;
}

/** Source « instantané » : filtre (type + recherche sans accents), tri, décomptes ; tout est en mémoire. */
export function vueInstantane(medias: Media[], q: RequeteMedias): VueSource {
  const recherches = q.recherche.trim() ? filtrer(medias, "tout", q.recherche) : medias;
  const visibles = trier(q.filtre === "tout" ? recherches : recherches.filter((m) => m.type === q.filtre), q.tri);
  const rangs = new Map<string, number>();
  visibles.forEach((m, i) => rangs.set(m.id, i));
  const parId = new Map(medias.map((m) => [m.id, m]));
  return {
    total: visibles.length,
    decompte: decompter(recherches),
    lire: (debut, fin) => visibles.slice(Math.max(0, debut), Math.max(0, fin)),
    charger: () => {},
    ordre: visibles.map((m) => m.id),
    rang: (id) => rangs.get(id) ?? -1,
    media: (id) => parId.get(id),
  };
}

/**
 * Empreinte d'une liste de médias (identifiant, état, nom, dates, durée, miniature, taille) : l'instantané du cœur est
 * relu toutes les 5 s ; si rien n'a changé, la Bibliothèque garde la même liste et ne refait ni filtre ni tri.
 */
export function empreinteMedias(medias: readonly Media[]): string {
  let h = 2166136261;
  const melanger = (t: string) => { for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } };
  for (const m of medias) {
    melanger(m.id); melanger(m.etat); melanger(m.nom); melanger(m.modifieLe); melanger(m.ajouteLe);
    melanger(m.miniature ?? ""); h ^= Math.round((m.duree ?? -1) * 1000); h = Math.imul(h, 16777619); h ^= m.taille | 0; h = Math.imul(h, 16777619);
  }
  return `${medias.length}:${(h >>> 0).toString(36)}`;
}

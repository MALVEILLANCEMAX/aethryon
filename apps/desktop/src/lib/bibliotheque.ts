// Logique de la bibliothèque (pure, testée) : état affiché d'un média, recherche, filtres, tri, décomptes.
import type { ImportFait, Instantane, Media, Transfert, TypeMedia } from "./types";

export type Filtre = "tout" | TypeMedia;
export type Tri = "ajout" | "nom" | "taille" | "duree";
export type EtatAffiche = "available" | "running" | "imported" | "missing" | "error";

export const TRIS: { id: Tri; libelle: string }[] = [
  { id: "ajout", libelle: "Ajout récent" },
  { id: "nom", libelle: "Nom" },
  { id: "taille", libelle: "Taille" },
  { id: "duree", libelle: "Durée" },
];

/** État affiché : « Importé » vient de `etat/imports.json` (panneau), jamais de l'index (contrat §3). */
export function etatAffiche(m: Media, imports: Record<string, ImportFait[]>): EtatAffiche {
  if (m.etat === "en-cours") return "running";
  if (m.etat === "introuvable") return "missing";
  if (m.etat === "erreur") return "error";
  return (imports[m.id]?.length ?? 0) > 0 ? "imported" : "available";
}

/** Recherche sans accents ni casse, sur le nom, l'extension et le titre d'origine. */
export function sansAccents(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Clé de recherche normalisée, gardée par média (dizaines de milliers de médias : on ne normalise qu'une fois).
const CLES = new Map<string, { source: string; cle: string }>();
export function cleRecherche(m: Media): string {
  const source = `${m.nom}.${m.ext} ${m.origine.titre ?? ""} ${m.ext}`;
  const c = CLES.get(m.id);
  if (c && c.source === source) return c.cle;
  const cle = sansAccents(source);
  if (CLES.size > 200_000) CLES.clear();
  CLES.set(m.id, { source, cle });
  return cle;
}

export function correspond(m: Media, requete: string): boolean {
  const q = sansAccents(requete.trim());
  if (!q) return true;
  const cible = cleRecherche(m);
  return q.split(/\s+/).every((mot) => cible.includes(mot));
}

export function filtrer(medias: Media[], filtre: Filtre, requete: string): Media[] {
  const mots = sansAccents(requete.trim()).split(/\s+/).filter(Boolean);
  return medias.filter((m) => (filtre === "tout" || m.type === filtre) && (mots.length === 0 || mots.every((mot) => cleRecherche(m).includes(mot))));
}

// Un seul interclasseur (localeCompare en crée un à chaque appel : 50 fois plus lent sur 50 000 médias).
const INTERCLASSEUR = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

export function trier(medias: Media[], tri: Tri): Media[] {
  const v = [...medias];
  const nom = (a: Media, b: Media) => INTERCLASSEUR.compare(a.nom, b.nom);
  switch (tri) {
    case "nom":
      return v.sort(nom);
    case "taille":
      return v.sort((a, b) => b.taille - a.taille || nom(a, b));
    case "duree":
      return v.sort((a, b) => (b.duree ?? -1) - (a.duree ?? -1) || nom(a, b));
    default:
      return v.sort((a, b) => b.ajouteLe.localeCompare(a.ajouteLe) || nom(a, b));
  }
}

export interface Decompte {
  tout: number;
  video: number;
  audio: number;
  image: number;
  disponibles: number;
  enCours: number;
  aVerifier: number;
}

export function decompter(medias: Media[]): Decompte {
  const d: Decompte = { tout: medias.length, video: 0, audio: 0, image: 0, disponibles: 0, enCours: 0, aVerifier: 0 };
  for (const m of medias) {
    d[m.type]++;
    if (m.etat === "disponible") d.disponibles++;
    else if (m.etat === "en-cours") d.enCours++;
    else d.aVerifier++;
  }
  return d;
}

/** Média le plus récent disponible (carte « Dernier média » de l'Accueil). */
export function dernierMedia(medias: Media[]): Media | null {
  return trier(medias.filter((m) => m.etat === "disponible"), "ajout")[0] ?? null;
}

/** Progression connue d'un média en cours (transfert relié par le nom attendu), sinon `null`. */
export function progressionMedia(m: Media, transferts: Transfert[]): number | null {
  const nom = `${m.nom}.${m.ext}`.toLowerCase();
  const t = transferts.find((x) => x.fichierAttendu?.toLowerCase() === nom && x.progression != null && x.etat !== "pret");
  return t?.progression ?? null;
}

/** Sélection multiple façon Explorateur : clic simple, Ctrl + clic (bascule), Maj + clic (plage). */
export function selectionner(selection: string[], ordre: string[], id: string, mode: "simple" | "bascule" | "plage", ancre: string | null): string[] {
  if (mode === "bascule") return selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id];
  if (mode === "plage" && ancre && ordre.includes(ancre)) {
    const a = ordre.indexOf(ancre);
    const b = ordre.indexOf(id);
    const [d, f] = a < b ? [a, b] : [b, a];
    return ordre.slice(d, f + 1);
  }
  return [id];
}

/** Nombre de médias ajoutés aujourd'hui dans le dossier principal. */
export function nouveauxAujourdhui(i: Instantane, maintenant = new Date()): number {
  return i.index.medias.filter((m) => {
    const d = new Date(m.ajouteLe);
    return d.getFullYear() === maintenant.getFullYear() && d.getMonth() === maintenant.getMonth() && d.getDate() === maintenant.getDate();
  }).length;
}

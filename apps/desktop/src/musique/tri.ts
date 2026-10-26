// Bibliothèque musicale : recherche (accents et casse ignorés), filtres, tri, albums et artistes, suggestions tirées
// de la SEULE bibliothèque de l'utilisateur (aucun service extérieur, aucune donnée envoyée).
import type { EntreeHistorique, Piste } from "./types";
import { classeQualite, type ClasseQualite } from "./qualite";

export const normaliser = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

export type Tri = "ajout" | "titre" | "artiste" | "album" | "duree" | "qualite";
export interface Filtres { q: string; qualite: ClasseQualite | ""; format: string; provenance: "" | "importe" | "local" }

export function filtrer(pistes: Piste[], f: Filtres): Piste[] {
  const q = normaliser(f.q);
  return pistes.filter((p) => {
    if (f.qualite && classeQualite(p.qualite) !== f.qualite) return false;
    if (f.format && p.qualite.codec !== f.format) return false;
    if (f.provenance === "importe" && !p.provenance) return false;
    if (f.provenance === "local" && p.provenance) return false;
    if (!q) return true;
    return normaliser([p.titre, p.album ?? "", p.artisteAlbum ?? "", ...p.artistes, p.genre ?? ""].join(" ")).includes(q);
  });
}

const RANG: Record<ClasseQualite, number> = { hires: 3, sansperte: 2, compresse: 1, inconnu: 0 };

export function trier(pistes: Piste[], t: Tri, ordreAjout: Map<string, number> = new Map()): Piste[] {
  const c = new Intl.Collator("fr", { sensitivity: "base", numeric: true });
  const a = pistes.slice();
  const art = (p: Piste) => p.artisteAlbum ?? p.artistes[0] ?? "";
  switch (t) {
    case "titre": return a.sort((x, y) => c.compare(x.titre, y.titre));
    case "artiste": return a.sort((x, y) => c.compare(art(x), art(y)) || c.compare(x.album ?? "", y.album ?? "") || (x.numero ?? 0) - (y.numero ?? 0));
    case "album": return a.sort((x, y) => c.compare(x.album ?? "￿", y.album ?? "￿") || (x.disque ?? 1) - (y.disque ?? 1) || (x.numero ?? 0) - (y.numero ?? 0) || c.compare(x.titre, y.titre));
    case "duree": return a.sort((x, y) => (y.dureeS ?? -1) - (x.dureeS ?? -1));
    case "qualite": return a.sort((x, y) => RANG[classeQualite(y.qualite)] - RANG[classeQualite(x.qualite)] || (y.qualite.frequenceHz ?? 0) - (x.qualite.frequenceHz ?? 0));
    default: return a.sort((x, y) => (ordreAjout.get(y.id) ?? 0) - (ordreAjout.get(x.id) ?? 0));
  }
}

export interface Album { cle: string; titre: string; artiste: string; annee: number | null; pochette: string | null; pistes: Piste[]; dureeS: number | null; ajout: number }

/** Albums (même titre ET même artiste de l'album), pistes rangées par disque puis numéro. Sans album : à part. */
export function albums(pistes: Piste[], ordreAjout: Map<string, number> = new Map()): Album[] {
  const m = new Map<string, Album>();
  for (const p of pistes) {
    if (!p.album) continue;
    const artiste = p.artisteAlbum ?? p.artistes[0] ?? "Artiste inconnu";
    const cle = `${normaliser(p.album)}\u0000${normaliser(artiste)}`;
    const a = m.get(cle) ?? { cle, titre: p.album, artiste, annee: p.annee, pochette: null, pistes: [], dureeS: 0, ajout: 0 };
    a.pistes.push(p);
    a.pochette ??= p.pochette;
    a.annee ??= p.annee;
    a.ajout = Math.max(a.ajout, ordreAjout.get(p.id) ?? 0);
    m.set(cle, a);
  }
  for (const a of m.values()) {
    a.pistes.sort((x, y) => (x.disque ?? 1) - (y.disque ?? 1) || (x.numero ?? 999) - (y.numero ?? 999));
    a.dureeS = a.pistes.every((p) => p.dureeS != null) ? a.pistes.reduce((s, p) => s + (p.dureeS ?? 0), 0) : null;
  }
  return [...m.values()].sort((x, y) => y.ajout - x.ajout);
}

export function artistes(pistes: Piste[]): { nom: string; n: number; pochette: string | null }[] {
  const m = new Map<string, { nom: string; n: number; pochette: string | null }>();
  for (const p of pistes) for (const a of p.artistes.length ? p.artistes : ["Artiste inconnu"]) {
    const k = normaliser(a);
    const e = m.get(k) ?? { nom: a, n: 0, pochette: null };
    e.n += 1;
    e.pochette ??= p.pochette;
    m.set(k, e);
  }
  return [...m.values()].sort((x, y) => y.n - x.n || x.nom.localeCompare(y.nom, "fr"));
}

/**
 * Suggestions issues de la bibliothèque personnelle SEULEMENT : morceaux des artistes et albums les plus écoutés
 * récemment (historique de lecture local) qui n'ont pas été joués dernièrement ; à défaut, les ajouts récents
 * pas encore écoutés. Aucune donnée ne quitte l'ordinateur.
 */
export function suggestions(pistes: Piste[], ecoutes: string[], ordreAjout: Map<string, number>, n = 8): { pistes: Piste[]; raison: string } {
  const parId = new Map(pistes.map((p) => [p.id, p]));
  const recents = new Set(ecoutes.slice(-30));
  const poids = new Map<string, number>();
  for (const [i, id] of ecoutes.entries()) {
    const p = parId.get(id);
    if (!p) continue;
    for (const a of p.artistes) poids.set(`a:${normaliser(a)}`, (poids.get(`a:${normaliser(a)}`) ?? 0) + 1 + i / ecoutes.length);
    if (p.album) poids.set(`l:${normaliser(p.album)}`, (poids.get(`l:${normaliser(p.album)}`) ?? 0) + 0.5);
  }
  const score = (p: Piste) => p.artistes.reduce((s, a) => s + (poids.get(`a:${normaliser(a)}`) ?? 0), 0) + (p.album ? poids.get(`l:${normaliser(p.album)}`) ?? 0 : 0);
  const candidats = pistes.filter((p) => !recents.has(p.id));
  const notes = candidats.map((p) => ({ p, s: score(p) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  if (notes.length) return { pistes: notes.slice(0, n).map((x) => x.p), raison: "D'après les artistes que tu écoutes" };
  return { pistes: trier(candidats, "ajout", ordreAjout).slice(0, n), raison: "Ajoutés récemment, pas encore écoutés" };
}

/** Imports récents (historique), du plus récent au plus ancien. */
export function importsRecents(h: EntreeHistorique[], n = 6): EntreeHistorique[] {
  return h.filter((e) => e.action === "import").slice(0, n);
}

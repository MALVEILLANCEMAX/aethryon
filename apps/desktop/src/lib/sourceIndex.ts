// Source PAGINÉE de la Bibliothèque (Nocturne-2) : AETHRYON Index (`bibliotheque_requete`) derrière l'adaptateur
// `VueSource` (lib/sourceMedias.ts). La grille ne demande que les plages visibles ; les pages (120 médias) arrivent à
// la demande, les emplacements pas encore chargés sont des squelettes ; les décomptes par type sont les totaux RÉELS
// de requêtes d'une ligne. Un média d'index.json garde l'objet de l'instantané (états, transferts, miniature) avec,
// en plus, ses informations d'index ; un média scanné ailleurs devient un `Media` marqué `indexe` (sans import direct).
import { useEffect, useMemo, useRef, useState } from "react";
import { estImportable, evenementsIndex, indexApi, urlMiniatureIndex, type ElementIndex, type RequeteIndex, type SourceIndex, type TriIndex } from "./index-medias";
import type { Decompte, Filtre, Tri } from "./bibliotheque";
import type { Media, MediaIndexe } from "./types";
import type { VueSource } from "./sourceMedias";
import type { Origine } from "./origineBibliotheque";

const PAGE = 120;
/** Mémoire bornée : 40 pages au plus (4 800 médias) ; les plus éloignées de la vue sont oubliées puis relues. */
const PAGES_MAX = 40;
const REGISTRE_MAX = 6000;
const TRIS: Record<Tri, TriIndex> = { ajout: "ajout", nom: "nom", taille: "taille", duree: "duree" };

/** Médias lus dans l'index (Aperçu, actions, menu) : identifiant → Media (les 6 000 derniers lus). */
export const registreIndex = new Map<string, Media>();
function noter(l: Media[]) {
  for (const m of l) { registreIndex.delete(m.id); registreIndex.set(m.id, m); }
  for (const id of registreIndex.keys()) { if (registreIndex.size <= REGISTRE_MAX) break; registreIndex.delete(id); }
}

export function versMedia(e: ElementIndex, biblio: ReadonlyMap<string, Media>): Media {
  const indexe: MediaIndexe = {
    sources: e.sources, volume: e.volume, dossier: e.dossier, enLigne: e.enLigne, etatFichier: e.etat, importable: estImportable(e),
    miniatureUrl: urlMiniatureIndex(e), doublons: e.doublons,
  };
  const b = biblio.get(e.id);
  if (b) return { ...b, indexe };
  return {
    id: e.id, chemin: e.chemin, nom: e.nom, ext: e.ext, type: e.type, taille: e.taille, ajouteLe: e.ajouteLe, modifieLe: e.modifieLe,
    duree: e.duree, largeur: e.largeur, hauteur: e.hauteur, ips: e.ips, codecVideo: e.codecVideo, codecAudio: e.codecAudio,
    miniature: null, etat: e.etat === "present" ? "disponible" : "introuvable", premiereCompatible: e.premiereCompatible,
    origine: { plateforme: "local", titre: e.titre }, indexe,
  };
}

export function sourcesDe(o: Origine): SourceIndex[] {
  return o === "scannes" ? ["index", "everything"] : [];
}

interface Etat { pages: Map<number, Media[]>; total: number; decompte: Decompte; version: number }
const VIDE: Decompte = { tout: 0, video: 0, audio: 0, image: 0, disponibles: 0, enCours: 0, aVerifier: 0 };

/** La source paginée d'une requête ; elle se recrée (nouvelle identité) quand une page arrive. `actif` faux : rien. */
export function useSourceIndex(actif: boolean, o: { filtre: Filtre; recherche: string; tri: Tri; origine: Origine }, biblio: ReadonlyMap<string, Media>): VueSource | null {
  const [etat, setEtat] = useState<Etat>({ pages: new Map(), total: 0, decompte: VIDE, version: 0 });
  const [rafraichi, setRafraichi] = useState(0);
  const enCours = useRef(new Set<number>());
  const jeton = useRef(0);
  const base: RequeteIndex = useMemo(() => ({ texte: o.recherche.trim(), tri: TRIS[o.tri], sources: sourcesDe(o.origine), taillePage: PAGE }), [o.recherche, o.tri, o.origine]);
  const types = o.filtre === "tout" ? undefined : [o.filtre];
  const cle = JSON.stringify([base, types, rafraichi]);

  // Nouvelle requête (ou index changé) : décomptes réels, première page.
  useEffect(() => {
    if (!actif) return;
    const j = ++jeton.current;
    enCours.current = new Set();
    const compter = (t?: Filtre) => indexApi.bibliotheque({ ...base, types: t && t !== "tout" ? [t] : undefined, page: 1, taillePage: 1 }).then((p) => p.total).catch(() => 0);
    void Promise.all([compter(), compter("video"), compter("audio"), compter("image"), indexApi.bibliotheque({ ...base, types, page: 1 })]).then(([tout, video, audio, image, p]) => {
      if (j !== jeton.current) return;
      const elements = p.elements.map((e) => versMedia(e, biblio));
      noter(elements);
      setEtat({ pages: new Map([[1, elements]]), total: p.total, decompte: { ...VIDE, tout, video, audio, image, disponibles: tout }, version: j });
    }).catch(() => {});
  }, [actif, cle]);

  // L'index change (scan, miniatures, bibliothèque) : relecture groupée (une fois toutes les 600 ms au plus).
  useEffect(() => {
    if (!actif) return;
    let t: number | undefined;
    const fin = evenementsIndex.changement((q) => {
      if (q !== "index" && q !== "miniatures" && q !== "bibliotheque") return;
      window.clearTimeout(t);
      t = window.setTimeout(() => setRafraichi((n) => n + 1), 600);
    });
    return () => { window.clearTimeout(t); fin.then((u) => u()).catch(() => {}); };
  }, [actif]);

  return useMemo(() => {
    // Rien de lu encore : pas de source. Ensuite, l'ancienne requête reste affichée jusqu'à l'arrivée de la nouvelle.
    if (!actif || etat.version === 0) return null;
    // Un média d'index.json suit l'instantané le plus récent (états, transferts, miniature) : relu à chaque rendu.
    const frais = (m: Media | undefined) => { const b = m && biblio.get(m.id); return b ? { ...b, indexe: m!.indexe } : m; };
    const lirePage = (n: number) => etat.pages.get(n);
    const parId = new Map<string, Media>();
    const rangs = new Map<string, number>();
    for (const [n, l] of etat.pages) l.forEach((m, i) => { parId.set(m.id, m); rangs.set(m.id, (n - 1) * PAGE + i); });
    const charger = (debut: number, fin: number) => {
      const j = jeton.current;
      for (let n = Math.floor(Math.max(0, debut) / PAGE) + 1; n <= Math.floor(Math.max(0, fin - 1) / PAGE) + 1; n++) {
        if (etat.pages.has(n) || enCours.current.has(n) || (n - 1) * PAGE >= etat.total) continue;
        enCours.current.add(n);
        indexApi.bibliotheque({ ...base, types, page: n }).then((p) => {
          if (j !== jeton.current) return;
          const elements = p.elements.map((e) => versMedia(e, biblio));
          noter(elements);
          setEtat((s) => {
            if (s.version !== j) return s;
            const pages = new Map(s.pages).set(n, elements);
            // Trop de pages : les plus éloignées de celle-ci sont oubliées (elles seront relues si on y revient).
            if (pages.size > PAGES_MAX) [...pages.keys()].sort((a, b) => Math.abs(b - n) - Math.abs(a - n)).slice(0, pages.size - PAGES_MAX).forEach((k) => pages.delete(k));
            return { ...s, total: p.total, pages };
          });
        }).catch(() => {}).finally(() => enCours.current.delete(n));
      }
    };
    const complet = etat.pages.size * PAGE >= etat.total;
    const v: VueSource = {
      total: etat.total,
      decompte: etat.decompte,
      lire: (debut, fin) => {
        const r: (Media | undefined)[] = [];
        for (let k = Math.max(0, debut); k < Math.min(fin, etat.total); k++) r.push(frais(lirePage(Math.floor(k / PAGE) + 1)?.[k % PAGE]));
        return r;
      },
      charger,
      ordre: complet ? [...rangs.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id) : null,
      rang: (id) => rangs.get(id) ?? -1,
      media: (id) => frais(parId.get(id) ?? registreIndex.get(id)),
    };
    return v;
  }, [actif, etat, cle, biblio]);
}

/** Nombre RÉEL de médias scannés (sources index et everything), relu quand l'index change ou qu'un scan finit. */
export function useScannes(actif: boolean): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!actif) return;
    let vivant = true;
    let t: number | undefined;
    const lire = () => { indexApi.rechercher({ page: 1, taillePage: 1 }).then((p) => { if (vivant) setN(p.total); }).catch(() => {}); };
    lire();
    const a = evenementsIndex.changement((q) => { if (q === "index") { window.clearTimeout(t); t = window.setTimeout(lire, 400); } });
    const b = evenementsIndex.fin(() => lire());
    return () => { vivant = false; window.clearTimeout(t); a.then((u) => u()).catch(() => {}); b.then((u) => u()).catch(() => {}); };
  }, [actif]);
  return n;
}

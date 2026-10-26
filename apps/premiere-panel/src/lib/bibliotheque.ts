// Modèle de la bibliothèque (fonctions pures : ni Premiere, ni disque, ni réseau).
// - Trois sources fusionnées par identifiant (sha1 du chemin normalisé, contrat d'échange §3) : le dossier des médias
//   lu directement, l'index d'AETHRYON Desktop quand il existe (facultatif), et les imports récents du panneau ;
// - recherche (sans accents, tous les mots), filtres (type, état, plateforme), tri ;
// - état affiché : Disponible, En cours, Importé, Introuvable, Erreur (DESIGN-SYSTEM §6).
// Repris et étendu du panneau bêta 2 (premiere/panneau/bibliotheque.js et fichiers.js).

import { sha1 } from "./sha1";
import { definition, duree, taille } from "./format";

export type TypeMedia = "video" | "audio" | "image";
export type EtatMedia = "disponible" | "en-cours" | "importe" | "introuvable" | "erreur";
export type EtatSource = "disponible" | "en-cours" | "introuvable" | "erreur";
export type SourceMedia = "dossier" | "desktop" | "recent";

export interface Origine {
  plateforme: string | null;
  titre: string | null;
  url?: string | null;
}

export interface Media {
  id: string;
  chemin: string;
  nom: string;
  ext: string;
  type: TypeMedia;
  taille: number | null;
  ajouteLe: string | null;
  modifieLe: string | null;
  duree: number | null;
  largeur: number | null;
  hauteur: number | null;
  ips: number | null;
  codecVideo: string | null;
  codecAudio: string | null;
  /** Chemin local d'une miniature fournie par AETHRYON Desktop (sinon générée dans le panneau). */
  miniature: string | null;
  etatSource: EtatSource;
  erreur: string | null;
  /** true : dans la liste d'import de Premiere ; false : refusé ; null : dépend du codec (non mesuré). */
  premiereCompatible: boolean | null;
  origine: Origine | null;
  sources: SourceMedia[];
}

/** Extension → [type, compatibilité Premiere connue sans analyser le fichier] (contrat §3). */
export const TYPES: Record<string, [TypeMedia, boolean | null]> = {
  mp4: ["video", null], mov: ["video", null], m4v: ["video", null], webm: ["video", false], mkv: ["video", false],
  mp3: ["audio", true], wav: ["audio", true], aac: ["audio", true], m4a: ["audio", true], opus: ["audio", false], ogg: ["audio", false],
  png: ["image", true], jpg: ["image", true], jpeg: ["image", true], gif: ["image", true],
};

/** Téléchargements inachevés : le nôtre (.part), Chrome (.crdownload), Edge et autres (.tmp, .partial…). */
const PARTIELS = [".part", ".crdownload", ".tmp", ".partial", ".download", ".opdownload"];
const SYSTEME = new Set(["desktop.ini", "thumbs.db", ".ds_store"]);

export function extension(nom: string): string {
  const i = nom.lastIndexOf(".");
  return i > 0 ? nom.slice(i + 1).toLowerCase() : "";
}

export function estPartiel(nom: string): boolean {
  const n = nom.toLowerCase();
  return n.startsWith("~$") || PARTIELS.some((s) => n.endsWith(s));
}

export function estIgnore(nom: string): boolean {
  return nom.startsWith(".") || SYSTEME.has(nom.toLowerCase());
}

/** Clé de comparaison d'un chemin (contrat §3) : séparateurs « \ », minuscules. */
export function cheminNormalise(chemin: string): string {
  return String(chemin || "").replace(/\//g, "\\").toLowerCase();
}

export function idPourChemin(chemin: string): string {
  return sha1(cheminNormalise(chemin));
}

export function nomDe(chemin: string): string {
  return String(chemin).split(/[\\/]/).pop() || String(chemin);
}

/** Chemin absolu Windows (C:\… ou \\serveur\…) ; POSIX accepté seulement hors Windows (banc d'essai). */
export function cheminAbsolu(v: unknown, posix = false): v is string {
  if (typeof v !== "string" || v.indexOf("\0") !== -1) return false;
  if (/^([A-Za-z]:\\|\\\\[^\\]+\\)/.test(v)) return true;
  return posix && /^\/[^/]/.test(v);
}

/** Vrai si « chemin » est DANS « dossier » (jamais égal, jamais par « .. »). */
export function estDans(chemin: string, dossier: string): boolean {
  const c = cheminNormalise(chemin).replace(/\\+$/, "");
  const d = cheminNormalise(dossier).replace(/\\+$/, "");
  if (!d || /(^|\\)\.\.(\\|$)/.test(c)) return false;
  return c.length > d.length + 1 && c.slice(0, d.length + 1) === d + "\\";
}

function vide(chemin: string, ext: string, type: TypeMedia, compat: boolean | null): Media {
  const fichier = nomDe(chemin);
  return {
    id: idPourChemin(chemin), chemin, nom: fichier.replace(/\.[^.]+$/, ""), ext, type,
    taille: null, ajouteLe: null, modifieLe: null, duree: null, largeur: null, hauteur: null, ips: null,
    codecVideo: null, codecAudio: null, miniature: null, etatSource: "disponible", erreur: null,
    premiereCompatible: compat, origine: null, sources: [],
  };
}

export interface EntreeDossier {
  nom: string;
  taille: number;
  /** Date de modification, en millisecondes. */
  modifie: number;
  /** Date de création, en millisecondes (ajout dans le dossier). */
  cree?: number;
  fichier: boolean;
}

/** Lecture directe du dossier des médias : fichiers connus et complets seulement. */
export function depuisDossier(entrees: EntreeDossier[], dossier: string, joindre: (a: string, b: string) => string): Media[] {
  const sortie: Media[] = [];
  for (const e of entrees) {
    if (!e.fichier || estIgnore(e.nom) || estPartiel(e.nom)) continue;
    const ext = extension(e.nom);
    const t = TYPES[ext];
    if (!t) continue;
    const m = vide(joindre(dossier, e.nom), ext, t[0], t[1]);
    m.taille = e.taille;
    m.modifieLe = new Date(e.modifie).toISOString();
    m.ajouteLe = new Date(Math.min(e.cree || e.modifie, e.modifie)).toISOString();
    m.sources = ["dossier"];
    sortie.push(m);
  }
  return sortie;
}

/** Fichiers .part de NOS téléchargements en cours (visibles « En cours » dans la bibliothèque). */
export function partielsAethryon(entrees: EntreeDossier[]): string[] {
  return entrees.filter((e) => e.fichier && /\.aethryon\.part$/i.test(e.nom)).map((e) => e.nom);
}

const nombre = (v: unknown) => (typeof v === "number" && isFinite(v) && v >= 0 ? v : null);
const texte = (v: unknown) => (typeof v === "string" && v ? v : null);
const ETATS_INDEX: Record<string, EtatSource> = { disponible: "disponible", "en-cours": "en-cours", introuvable: "introuvable", erreur: "erreur" };

/** Index d'AETHRYON Desktop (contrat §3), validé entrée par entrée. Un index illisible donne une liste vide. */
export function depuisIndexDesktop(objet: unknown, racineMiniatures: string | null, joindre: (a: string, b: string) => string, posix = false): Media[] {
  if (!objet || typeof objet !== "object") return [];
  const o = objet as { schema?: unknown; medias?: unknown };
  if (o.schema !== 1 || !Array.isArray(o.medias)) return [];
  const sortie: Media[] = [];
  for (const brut of o.medias as unknown[]) {
    if (!brut || typeof brut !== "object") continue;
    const e = brut as Record<string, unknown>;
    if (!cheminAbsolu(e.chemin, posix)) continue;
    const ext = (texte(e.ext) || extension(nomDe(e.chemin))).toLowerCase();
    const type = e.type === "video" || e.type === "audio" || e.type === "image" ? e.type : TYPES[ext]?.[0];
    if (!type) continue;
    const m = vide(e.chemin, ext, type, TYPES[ext]?.[1] ?? null);
    // L'identifiant est recalculé : jamais celui écrit dans le fichier (pas de confiance dans une donnée externe).
    m.nom = texte(e.nom) || m.nom;
    m.taille = nombre(e.taille);
    m.ajouteLe = texte(e.ajouteLe);
    m.modifieLe = texte(e.modifieLe);
    m.duree = nombre(e.duree);
    m.largeur = nombre(e.largeur);
    m.hauteur = nombre(e.hauteur);
    m.ips = nombre(e.ips);
    m.codecVideo = texte(e.codecVideo);
    m.codecAudio = texte(e.codecAudio);
    const mini = texte(e.miniature);
    if (mini && racineMiniatures && /^miniatures[\\/][0-9a-f]{40}\.jpg$/i.test(mini)) {
      m.miniature = joindre(racineMiniatures, mini.replace(/^miniatures[\\/]/i, ""));
    }
    m.etatSource = ETATS_INDEX[String(e.etat)] || "disponible";
    m.erreur = texte(e.erreur);
    if (e.premiereCompatible === true || e.premiereCompatible === false) m.premiereCompatible = e.premiereCompatible;
    const or = e.origine as Record<string, unknown> | undefined;
    if (or && typeof or === "object") m.origine = { plateforme: texte(or.plateforme), titre: texte(or.titre) };
    m.sources = ["desktop"];
    sortie.push(m);
  }
  return sortie;
}

/** Import récent fait par le panneau (fichier téléchargé depuis le serveur AETHRYON). */
export interface Recent {
  chemin: string;
  titre: string | null;
  plateforme: string | null;
  url: string | null;
  format: "mp4" | "mp3";
  le: string;
  duree?: number | null;
  taille?: number | null;
  /** Le fichier a-t-il été importé dans un projet (et lequel). */
  importeDans?: string | null;
}

export function depuisRecents(recents: Recent[], existe: (chemin: string) => boolean): Media[] {
  const sortie: Media[] = [];
  for (const r of recents) {
    const ext = extension(nomDe(r.chemin));
    const t = TYPES[ext];
    if (!t) continue;
    const m = vide(r.chemin, ext, t[0], ext === "mp4" || ext === "mp3" ? true : t[1]);
    m.ajouteLe = r.le;
    m.duree = r.duree ?? null;
    m.taille = r.taille ?? null;
    m.origine = { plateforme: r.plateforme, titre: r.titre, url: r.url };
    m.etatSource = existe(r.chemin) ? "disponible" : "introuvable";
    m.sources = ["recent"];
    sortie.push(m);
  }
  return sortie;
}

/**
 * Fusion sans doublon (même fichier = même identifiant, quelle que soit la casse ou le séparateur).
 * Règles : une valeur connue l'emporte sur une valeur absente ; le dossier prouve la présence du fichier
 * (« Introuvable » d'une autre source est alors ignoré) ; l'origine vient des imports récents puis de Desktop.
 */
export function fusionner(...listes: Media[][]): Media[] {
  const parId = new Map<string, Media>();
  for (const liste of listes) {
    for (const m of liste) {
      const a = parId.get(m.id);
      if (!a) {
        parId.set(m.id, { ...m, sources: [...m.sources] });
        continue;
      }
      const champs = ["taille", "ajouteLe", "modifieLe", "duree", "largeur", "hauteur", "ips", "codecVideo", "codecAudio", "miniature", "erreur"] as const;
      for (const c of champs) if (a[c] == null && m[c] != null) (a as unknown as Record<string, unknown>)[c] = m[c];
      if (a.premiereCompatible == null) a.premiereCompatible = m.premiereCompatible;
      if (!a.origine || (!a.origine.titre && m.origine?.titre)) a.origine = m.origine ?? a.origine;
      if (a.ajouteLe && m.ajouteLe && m.ajouteLe < a.ajouteLe) a.ajouteLe = m.ajouteLe;
      for (const s of m.sources) if (!a.sources.includes(s)) a.sources.push(s);
      const present = a.sources.includes("dossier");
      if (present) {
        if (m.etatSource === "en-cours" || m.etatSource === "erreur") a.etatSource = m.etatSource;
        else if (a.etatSource === "introuvable") a.etatSource = "disponible";
      } else if (m.etatSource !== "disponible") {
        a.etatSource = m.etatSource;
      }
    }
  }
  return [...parId.values()];
}

export interface ContexteEtat {
  operations: ReadonlySet<string>;
  erreurs: ReadonlyMap<string, string>;
  importes: ReadonlySet<string>;
}

export function etatAffiche(m: Media, ctx: ContexteEtat): EtatMedia {
  if (ctx.operations.has(m.id)) return "en-cours";
  if (m.etatSource === "introuvable") return "introuvable";
  if (m.etatSource === "en-cours") return "en-cours";
  if (ctx.erreurs.has(m.id) || m.etatSource === "erreur") return "erreur";
  if (ctx.importes.has(m.id)) return "importe";
  return "disponible";
}

export const LIBELLE_ETAT: Record<EtatMedia, string> = {
  disponible: "Disponible", "en-cours": "En cours", importe: "Importé", introuvable: "Introuvable", erreur: "Erreur",
};

// ---- Recherche, filtres, tri -------------------------------------------------------------------------------------------
export function plier(s: string | null | undefined): string {
  let t = String(s || "").toLowerCase();
  try {
    t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch {
    /* normalize absent : comparaison sans pliage des accents */
  }
  return t.replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/[’']/g, "'");
}

export type Tri = "recent" | "ancien" | "nom" | "taille" | "duree";
export type FiltreType = "tout" | TypeMedia;
export type FiltreEtat = "tous" | EtatMedia;
export type FiltrePlateforme = "toutes" | "youtube" | "tiktok" | "twitter" | "local";

export const LIBELLE_TRI: Record<Tri, string> = {
  recent: "Ajout récent", ancien: "Ajout ancien", nom: "Nom", taille: "Taille", duree: "Durée",
};

const parNom = (a: Media, b: Media) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base", numeric: true });
const TRIS: Record<Tri, (a: Media, b: Media) => number> = {
  recent: (a, b) => String(b.ajouteLe || "").localeCompare(String(a.ajouteLe || "")) || parNom(a, b),
  ancien: (a, b) => String(a.ajouteLe || "").localeCompare(String(b.ajouteLe || "")) || parNom(a, b),
  nom: parNom,
  taille: (a, b) => (b.taille || 0) - (a.taille || 0) || parNom(a, b),
  duree: (a, b) => (b.duree || 0) - (a.duree || 0) || parNom(a, b),
};

export interface OptionsFiltre {
  recherche?: string;
  type?: FiltreType;
  etat?: FiltreEtat;
  plateforme?: FiltrePlateforme;
  tri?: Tri;
}

export function plateformeDe(m: Media): Exclude<FiltrePlateforme, "toutes"> {
  const p = m.origine?.plateforme;
  return p === "youtube" || p === "tiktok" || p === "twitter" ? p : p === "x" ? "twitter" : "local";
}

export function filtrer(medias: Media[], o: OptionsFiltre, ctx: ContexteEtat): Media[] {
  const type = o.type && o.type !== "tout" ? o.type : null;
  const etat = o.etat && o.etat !== "tous" ? o.etat : null;
  const pf = o.plateforme && o.plateforme !== "toutes" ? o.plateforme : null;
  const mots = plier(o.recherche).split(/\s+/).filter(Boolean);
  const sortie = medias.filter((m) => {
    if (type && m.type !== type) return false;
    if (etat && etatAffiche(m, ctx) !== etat) return false;
    if (pf && plateformeDe(m) !== pf) return false;
    if (!mots.length) return true;
    const foin = plier([m.nom, m.ext, m.origine?.titre, m.origine?.plateforme === "twitter" ? "x" : m.origine?.plateforme].filter(Boolean).join(" "));
    return mots.every((mot) => foin.indexOf(mot) !== -1);
  });
  sortie.sort(TRIS[o.tri || "recent"] || TRIS.recent);
  return sortie;
}

export function compter(medias: Media[]): Record<FiltreType, number> {
  const n = { tout: medias.length, video: 0, audio: 0, image: 0 };
  for (const m of medias) n[m.type]++;
  return n;
}

/** Ligne de métadonnées courte : « MP4 · 0:12 · 1280 × 720 ». */
export function metaCourte(m: Media): string {
  const parts = [(m.ext || "").toUpperCase()];
  if (m.type !== "image" && m.duree != null) parts.push(duree(m.duree));
  if (m.type === "audio") {
    if (m.taille != null) parts.push(taille(m.taille));
  } else if (definition(m.largeur, m.hauteur)) parts.push(definition(m.largeur, m.hauteur));
  else if (m.taille != null) parts.push(taille(m.taille));
  return parts.filter(Boolean).join(" · ");
}

/** Le fichier peut-il partir vers Premiere (glisser, importer) ? Complet, présent, pas en erreur de source. */
export function pretPourPremiere(m: Media, ctx: ContexteEtat): boolean {
  const e = etatAffiche(m, ctx);
  return e === "disponible" || e === "importe" || (e === "erreur" && m.etatSource === "disponible");
}

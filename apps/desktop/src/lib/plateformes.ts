// Catalogue des plateformes au collage d'un lien (DESIGN_SYSTEM.md § 10, « Détection de plateforme »). Source UNIQUE :
// le catalogue des interfaces docs/api/CATALOGUE-PLATEFORMES.json, généré par scripts/sync-plateformes.py depuis le registre
// d'ytapi (ytapi/app/plateformes.json) et contrôlé par `make test` : mêmes plateformes, états, formats et raisons que
// l'API, le site et l'extension. Chargé à la demande (lib/catalogue.ts) ; ici, des règles PURES (essais vitest).
//
// État RÉEL : celui du registre, sauf les plateformes « prêtes à ouvrir » que la production a OUVERTES (PLATEFORMES_BETA,
// GET /media/platforms → « disponible » le 2026-10-26) : Bluesky et Wikimedia Commons (MP4, MP3, GIF ; extraits
// fermés, avec leur raison ; Wikimedia : auteur, licence et source à citer). Le serveur reste seul juge à la conversion
// (une plateforme coupée entre-temps répond « temporairement indisponible », message affiché tel quel).
// Aucun logo de marque : pictogramme neutre du catalogue + nom en toutes lettres.
import type { NomIcone } from "./egide";

export type StatutCatalogue = "disponible" | "prete_a_ouvrir" | "preproduction" | "indisponible" | "refusee";
export type Fonction = "mp4" | "mp3" | "gif" | "extrait";

export interface EntreeCatalogue {
  id: string;
  nom: string;
  categorie: string;
  icone: string;
  statut: StatutCatalogue;
  domaines: string[];
  formats_compatibles: string[];
  fonctions_indisponibles: { fonction: string; raison: string }[];
  attribution_obligatoire: boolean;
}

export interface Catalogue {
  version: string;
  categories: { id: string; nom: string }[];
  plateformes: EntreeCatalogue[];
}

/** Plateformes « prêtes à ouvrir » ouvertes en production (deploy-plateformes.sh --activer, 2026-10-26). */
export const OUVERTES_EN_PRODUCTION: readonly string[] = ["bluesky", "wikimedia"];

/** Ce qu'AETHRYON Desktop sait convertir lui-même (« Coller un lien ») : MP4 H.264 et MP3, jamais de GIF ni d'extrait. */
export const FORMATS_DESKTOP = ["mp4", "mp3"] as const;
export type FormatDesktop = (typeof FORMATS_DESKTOP)[number];

export type Statut = "en-ligne" | "bientot" | "preparation" | "indisponible" | "refusee";

export const STATUTS: Record<Statut, { libelle: string; ton: "ok" | "accent" | "neutre" | "warn" | "err"; icone: NomIcone }> = {
  "en-ligne": { libelle: "En ligne", ton: "ok", icone: "ok" },
  bientot: { libelle: "Bientôt", ton: "accent", icone: "horloge" },
  preparation: { libelle: "En préparation", ton: "neutre", icone: "horloge" },
  indisponible: { libelle: "Temporairement indisponible", ton: "warn", icone: "alerte" },
  refusee: { libelle: "Non prise en charge", ton: "err", icone: "interdit" },
};

const NOMS_FONCTIONS: Record<Fonction, string> = { mp4: "MP4", mp3: "MP3", gif: "GIF", extrait: "Extrait" };
const ICONES_CATALOGUE: Record<string, NomIcone> = { video: "video", vertical: "vertical", post: "post", image: "image", direct: "direct", archive: "archive", onde: "onde" };

export interface FormatVu { id: Fonction; nom: string; ok: boolean; raison: string | null }

export interface VuePlateforme {
  id: string;
  nom: string;
  categorie: string;
  icone: NomIcone;
  statut: Statut;
  /** Formats du catalogue : tous visibles, les indisponibles avec leur raison (DESIGN_SYSTEM.md § 10). */
  formats: FormatVu[];
  /** Raison affichée quand la plateforme n'est pas en ligne (texte du registre). */
  raison: string | null;
  /** Auteur, licence et source à citer (Wikimedia Commons). */
  attribution: boolean;
  /** AETHRYON Desktop peut convertir ce lien (plateforme en ligne et au moins MP4 ou MP3). */
  convertible: boolean;
}

export function statutDe(e: EntreeCatalogue): Statut {
  if (e.statut === "disponible") return "en-ligne";
  if (e.statut === "prete_a_ouvrir") return OUVERTES_EN_PRODUCTION.includes(e.id) ? "en-ligne" : "bientot";
  if (e.statut === "preproduction") return "preparation";
  return e.statut === "indisponible" ? "indisponible" : "refusee";
}

export function vuePlateforme(e: EntreeCatalogue): VuePlateforme {
  const statut = statutDe(e);
  const raisons = new Map(e.fonctions_indisponibles.map((f) => [f.fonction, f.raison]));
  const bientot = `${e.nom} : essais réussis, ouverture prochaine.`;
  const formats = (Object.keys(NOMS_FONCTIONS) as Fonction[]).map((id) => {
    const ok = statut === "en-ligne" && e.formats_compatibles.includes(id);
    const raison = ok ? null : raisons.get(id) ?? (statut === "bientot" ? bientot : `${NOMS_FONCTIONS[id]} : non proposé pour ${e.nom}.`);
    return { id, nom: NOMS_FONCTIONS[id], ok, raison };
  });
  const raison = statut === "en-ligne" ? null : statut === "bientot" ? bientot : e.fonctions_indisponibles[0]?.raison ?? null;
  const convertible = statut === "en-ligne" && formats.some((f) => f.ok && (FORMATS_DESKTOP as readonly string[]).includes(f.id));
  return { id: e.id, nom: e.nom, categorie: e.categorie, icone: ICONES_CATALOGUE[e.icone] ?? "video", statut, formats, raison, attribution: e.attribution_obligatoire, convertible };
}

/** Hôte d'une saisie (lien avec ou sans schéma), en minuscules, sans « www. » ni « m. » ; null si ce n'est pas un lien. */
export function hoteDe(saisie: string): string | null {
  const t = saisie.trim();
  if (!t || /\s/.test(t)) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const h = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
    return h.includes(".") ? h : null;
  } catch {
    return null;
  }
}

/** Plateforme d'un lien : le domaine le plus précis l'emporte (music.youtube.com → YouTube Music, pas YouTube). */
export function detecter(saisie: string, c: Catalogue): VuePlateforme | null {
  const h = hoteDe(saisie);
  if (!h) return null;
  let meilleure: EntreeCatalogue | null = null;
  let longueur = 0;
  for (const p of c.plateformes) {
    for (const d of p.domaines) {
      if ((h === d || h.endsWith(`.${d}`)) && d.length > longueur) { meilleure = p; longueur = d.length; }
    }
  }
  return meilleure ? vuePlateforme(meilleure) : null;
}

/** Catalogue par catégorie, dans l'ordre du registre (dialogue « Plateformes compatibles »). */
export function parCategorie(c: Catalogue): { id: string; nom: string; plateformes: VuePlateforme[] }[] {
  return c.categories.map((k) => ({ ...k, plateformes: c.plateformes.filter((p) => p.categorie === k.id).map(vuePlateforme) }));
}

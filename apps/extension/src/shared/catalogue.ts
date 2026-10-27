// Catalogue des plateformes pour le popup (3.9.0) : UNE seule source, docs/api/CATALOGUE-PLATEFORMES.json, généré par
// scripts/sync-plateformes.py depuis le registre unique ytapi/app/plateformes.json (vérifié par `make test`), copié par
// scripts/catalogue.mjs dans src/shared/catalogue-donnees.ts (vérifié par la construction et les essais). On y garde ce
// que l'interface montre : nom, catégorie, pictogramme NEUTRE (jamais un logo de marque), état, formats réellement
// compatibles et fonctions indisponibles avec leur raison, attribution obligatoire.
// État réel : une plateforme « prête à ouvrir » n'est utilisable que quand le serveur la dit « disponible »
// (GET <API>/platforms, public, lu par le service worker après l'accord sur la notice : message « platforms.get »).
// Le 2026-10-26, Wikimedia Commons et Bluesky le sont en production (MP4, MP3, GIF ; extraits fermés ; attribution
// Wikimedia) : c'est cette réponse qui le dit, jamais une valeur écrite ici.
import { CATALOGUE_DONNEES as CATALOGUE } from "./catalogue-donnees.ts";
import { BUILD_PLATFORMS } from "./platforms.ts";
import type { NomIcone } from "./egide.ts";

/** États du catalogue (« prete » : prête à ouvrir ; « preparation » : extracteur présent, ouverture en attente). */
export type Statut = "disponible" | "prete" | "preparation" | "indisponible" | "refusee";
export type Categorie = "populaires" | "musique" | "streaming" | "autres";
export type Fonction = "mp4" | "mp3" | "gif" | "extrait";

export interface PlateformeCatalogue {
  id: string;
  nom: string;
  categorie: Categorie;
  icone: NomIcone;
  statut: Statut;
  domaines: readonly string[];
  formats: readonly Fonction[];
  /** Fonctions indisponibles et leur raison (montrée telle quelle). */
  indisponibles: Readonly<Partial<Record<Fonction, string>>>;
  attribution: boolean;
}

const ICONES_NEUTRES = new Set<string>(["video", "vertical", "post", "image", "direct", "archive", "onde"]);
const FONCTIONS: readonly Fonction[] = ["mp4", "mp3", "gif", "extrait"];
const STATUTS: readonly Statut[] = ["disponible", "prete", "preparation", "indisponible", "refusee"];

export const CATEGORIES: readonly { id: Categorie; nom: string }[] = CATALOGUE.categories as unknown as { id: Categorie; nom: string }[];
export const NOMS_FORMATS: Readonly<Record<Fonction, string>> = { mp4: "MP4", mp3: "MP3", gif: "GIF", extrait: "Extrait" };

export const PLATEFORMES: readonly PlateformeCatalogue[] = CATALOGUE.plateformes.map((p) => {
  const indisponibles: Partial<Record<Fonction, string>> = {};
  for (const [f, raison] of Object.entries(p.indisponibles as Record<string, string>)) if ((FONCTIONS as readonly string[]).includes(f)) indisponibles[f as Fonction] = raison;
  return {
    id: p.id,
    nom: p.nom,
    categorie: p.categorie as Categorie,
    icone: (ICONES_NEUTRES.has(p.icone) ? p.icone : "video") as NomIcone,
    statut: ((STATUTS as readonly string[]).includes(p.statut) ? p.statut : "indisponible") as Statut,
    domaines: p.domaines,
    formats: (p.formats as readonly string[]).filter((f): f is Fonction => (FONCTIONS as readonly string[]).includes(f)),
    indisponibles,
    attribution: p.attribution === true,
  };
});

/** Plateforme d'un lien (domaine exact ou sous-domaine, à la frontière d'une étiquette), ou null. Aucune requête. */
export function plateformeDuLien(texte: string): PlateformeCatalogue | null {
  let host: string;
  try {
    const u = new URL(texte.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    host = u.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
  // La plus précise d'abord (music.youtube.com avant youtube.com).
  let meilleure: { p: PlateformeCatalogue; n: number } | null = null;
  for (const p of PLATEFORMES) {
    for (const d of p.domaines) {
      if ((host === d || host.endsWith(`.${d}`)) && (!meilleure || d.length > meilleure.n)) meilleure = { p, n: d.length };
    }
  }
  return meilleure?.p ?? null;
}

/** Disponibilité annoncée par le serveur (id → disponible), ou null tant qu'elle n'est pas connue. */
export type Disponibilites = Readonly<Record<string, boolean>> | null;

/**
 * « en_ligne » : convertie PAR L'EXTENSION (YouTube, TikTok, X) et ouverte sur le serveur. « serveur » : ouverte sur le
 * serveur AETHRYON (ex. Wikimedia Commons et Bluesky depuis le 2026-10-26) mais pas encore convertie par l'extension :
 * jamais montrée « En ligne » ici, aucun bouton de l'extension ne la convertit.
 */
export type EtatAffiche = "en_ligne" | "serveur" | "bientot" | "preparation" | "indisponible" | "refusee";

/** Plateformes que l'extension sait convertir (règles de lien du service worker, content scripts). */
const DANS_EXTENSION = new Set<string>(BUILD_PLATFORMS);

/** État montré : le statut du catalogue, corrigé par la réponse du serveur quand elle est connue. */
export function etatAffiche(p: PlateformeCatalogue, dispo: Disponibilites): EtatAffiche {
  if (p.statut === "refusee") return "refusee";
  if (dispo && p.id in dispo) {
    if (dispo[p.id]) return DANS_EXTENSION.has(p.id) ? "en_ligne" : "serveur";
    return p.statut === "disponible" ? "indisponible" : p.statut === "prete" ? "bientot" : p.statut === "preparation" ? "preparation" : "indisponible";
  }
  switch (p.statut) {
    case "disponible": return DANS_EXTENSION.has(p.id) ? "en_ligne" : "serveur";
    case "prete": return "bientot";
    case "preparation": return "preparation";
    default: return "indisponible";
  }
}

export const LIBELLES_ETAT: Readonly<Record<EtatAffiche, { mot: string; ton: "ok" | "warn" | "err" | "neutre" | "accent" }>> = {
  en_ligne: { mot: "En ligne", ton: "ok" },
  serveur: { mot: "Pas encore ici", ton: "accent" },
  bientot: { mot: "Bientôt", ton: "accent" },
  preparation: { mot: "En préparation", ton: "neutre" },
  indisponible: { mot: "Indisponible", ton: "warn" },
  refusee: { mot: "Non proposée", ton: "neutre" },
};

/** Phrase courte qui dit pourquoi une plateforme n'est pas utilisable (raison du catalogue, sinon l'état). */
export function raisonPlateforme(p: PlateformeCatalogue, etat: EtatAffiche): string {
  const r = p.indisponibles.mp4 ?? p.indisponibles.mp3 ?? Object.values(p.indisponibles)[0];
  if (etat === "en_ligne") return "";
  if (etat === "serveur") {
    const f = p.formats.filter((x) => x !== "extrait").map((x) => NOMS_FORMATS[x]).join(", ");
    return `${p.nom} est ouverte sur le serveur AETHRYON${f ? ` (${f})` : ""} ; bientôt dans l'extension.`;
  }
  if (etat === "bientot") return `${p.nom} ouvre bientôt.`;
  if (etat === "indisponible" && p.statut === "disponible") return `${p.nom} est temporairement indisponible.`;
  return r ?? `${p.nom} n'est pas proposée.`;
}

/** Validation de la réponse du service worker à « platforms.get ». */
export function lireDisponibilites(v: unknown): Disponibilites {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const out: Record<string, boolean> = {};
  for (const p of PLATEFORMES) {
    const x = (v as Record<string, unknown>)[p.id];
    if (typeof x === "boolean") out[p.id] = x;
  }
  return out;
}

// Étapes RÉELLES d'un extrait (3.6.0, contrat du serveur) : analyse de la source → récupération de l'extrait →
// conversion (si besoin) → finalisation → terminé. Un pourcentage n'est montré que si le serveur envoie une
// progression mesurable (`progression`, de 0 à 1) ; sinon, animation indéterminée et phrase descriptive.
// Pur ; testé par tests/unit/extraits-etapes.test.ts.

export const ETAPES = ["analyse", "recuperation", "conversion", "finalisation", "termine"] as const;
export type Etape = (typeof ETAPES)[number];

export const ETAPE_LABEL: Record<Etape, string> = {
  analyse: "Analyse de la source",
  recuperation: "Récupération de l’extrait",
  conversion: "Conversion",
  finalisation: "Finalisation",
  termine: "Terminé",
};

/** Libellé court du stepper (popup et menu étroits). */
export const ETAPE_SHORT: Record<Etape, string> = {
  analyse: "Analyse",
  recuperation: "Récupération",
  conversion: "Conversion",
  finalisation: "Finalisation",
  termine: "Terminé",
};

/** Ce qui se passe vraiment pendant l'étape (phrase montrée sous le titre quand il n'y a pas de pourcentage). */
export function etapeDetail(e: Etape, fmt: "mp4" | "mp3" | "gif", saving = false): string {
  switch (e) {
    case "analyse":
      return "Le serveur lit les formats de la vidéo et repère le passage.";
    case "recuperation":
      return "Seuls les segments du passage sont récupérés, jamais la vidéo entière.";
    case "conversion":
      return fmt === "gif" ? "Fabrication du GIF à partir du passage." : fmt === "mp3" ? "Encodage de l’audio en MP3." : "Encodage en MP4 (H.264 et AAC).";
    case "finalisation":
      return saving ? "Enregistrement du fichier dans Téléchargements." : "Le fichier est préparé sur le serveur.";
    case "termine":
    default:
      return "Fichier enregistré dans Téléchargements.";
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Anciennes étapes de ytapi (avant le contrat des extraits) → étape du contrat. « queued » et « attente » (job en file
 * sur le serveur) ne sont PAS une étape : rien n'a commencé (l'interface dit « En attente du serveur »).
 */
const WAITING = new Set(["attente", "queued", "waiting", "erreur", "annule", "error"]);
const LEGACY: Record<string, Etape> = {
  starting: "analyse", extracting: "analyse", checking: "analyse",
  downloading: "recuperation", fetching: "recuperation",
  clipping: "conversion", converting: "conversion", postprocessing: "conversion", merging: "conversion", compressing: "conversion",
  gif: "conversion", rendering: "conversion",
  finalizing: "finalisation", uploading: "finalisation",
  done: "termine",
};

export const isEtape = (v: unknown): v is Etape => typeof v === "string" && (ETAPES as readonly string[]).includes(v);

/** Étape d'un corps de job du serveur (`etape`, sinon `stage`, nouvelle ou ancienne forme) ; null si inconnue. */
export function etapeOf(body: unknown): Etape | null {
  if (!isObj(body)) return null;
  for (const k of ["etape", "stage"] as const) {
    const v = body[k];
    if (isEtape(v)) return v;
    if (typeof v === "string" && WAITING.has(v)) return null;
  }
  const s = body.stage;
  return typeof s === "string" && Object.hasOwn(LEGACY, s) ? LEGACY[s]! : null;
}

/**
 * Progression MESURABLE d'un corps de job (contrat : `progression` de 0 à 1) → pourcentage entier, ou null. L'ancien
 * champ `progress` (0–100, toujours présent même sans mesure) n'est PAS lu pour un extrait.
 */
export function progressionOf(body: unknown): number | null {
  if (!isObj(body)) return null;
  const p = body.progression;
  if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) return null;
  return Math.round(p * 100);
}

/** Rang d'une étape (0 à 4) ; une étape plus avancée n'est jamais remplacée par une précédente. */
export const etapeRank = (e: Etape): number => ETAPES.indexOf(e);
export function laterEtape(a: Etape | undefined, b: Etape | null): Etape | undefined {
  if (!b) return a;
  if (!a) return b;
  return etapeRank(b) >= etapeRank(a) ? b : a;
}

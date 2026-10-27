// Catalogue des plateformes tel que le site l'affiche : UNE source, la copie du catalogue des interfaces
// (catalogue-plateformes.ts ← docs/api/CATALOGUE-PLATEFORMES.json ← ytapi/app/plateformes.json). Seule information ajoutée :
// quelles bêtas VALIDÉES sont réellement ouvertes en production (variable PLATEFORMES_BETA de ytapi) ; une plateforme
// « prête à ouvrir » n'est dite « en ligne » que si elle y figure. États : en ligne, temporairement indisponible
// (plateforme coupée par l'administrateur : /api/config), bientôt, en préproduction, indisponible, refusée.
// Pictogrammes neutres du socle Égide uniquement : jamais de logo de marque (docs/MARQUES.md).
import { CATALOGUE_PLATEFORMES, type FormatCatalogue, type PlateformeCatalogue } from "./catalogue-plateformes.ts";

/** Ouvertes en production depuis le 2026-10-26 20:46 UTC (PLATEFORMES_BETA=wikimedia,bluesky ; MP4, MP3, GIF ; extraits
 *  fermés). À mettre à jour avec PLATEFORMES_BETA, et seulement alors. */
export const OUVERTES_EN_PRODUCTION: readonly string[] = ["wikimedia", "bluesky"];

/** Typographie française des raisons du catalogue (espace insécable avant « : ; ! ? » » et après « « »). */
const typo = (t: string) => t.replace(/[ \u00a0\u202f]+([:;!?»])/g, "\u00a0$1").replace(/«[ \u00a0\u202f]+/g, "«\u00a0");

export type EtatAffiche = "en-ligne" | "temp" | "bientot" | "preprod" | "indisponible" | "refusee";
export const ETATS: Record<EtatAffiche, { libelle: string; icone: "ok" | "horloge" | "reglages" | "barre" | "interdit"; ordre: number }> = {
  "en-ligne": { libelle: "En ligne", icone: "ok", ordre: 0 },
  temp: { libelle: "Temporairement indisponible", icone: "horloge", ordre: 1 },
  bientot: { libelle: "Bientôt", icone: "horloge", ordre: 2 },
  preprod: { libelle: "En préproduction", icone: "reglages", ordre: 3 },
  indisponible: { libelle: "Indisponible", icone: "barre", ordre: 4 },
  refusee: { libelle: "Refusée", icone: "interdit", ordre: 5 },
};
export const FORMATS: readonly FormatCatalogue[] = ["mp4", "mp3", "gif", "extrait"];
export const NOM_FORMAT: Record<FormatCatalogue, string> = CATALOGUE_PLATEFORMES.formats;
export const CATEGORIES = CATALOGUE_PLATEFORMES.categories;
export type Plateforme = PlateformeCatalogue;
export const PLATEFORMES: readonly Plateforme[] = CATALOGUE_PLATEFORMES.plateformes;

/** Clés de /api/config (plateformes que l'administrateur peut couper) pour les trois plateformes historiques. */
const CLE_CONFIG: Record<string, "youtube" | "tiktok" | "twitter"> = { youtube: "youtube", tiktok: "tiktok", twitter: "twitter" };

/** État affiché d'une plateforme ; `coupees` : plateformes coupées par l'administrateur (/api/config). */
export function etatAffiche(p: Plateforme, coupees?: Partial<Record<"youtube" | "tiktok" | "twitter", boolean>>): EtatAffiche {
  const ouverte = p.statut === "disponible" || (p.statut === "prete_a_ouvrir" && OUVERTES_EN_PRODUCTION.includes(p.id));
  if (ouverte) {
    const cle = CLE_CONFIG[p.id];
    return cle && coupees?.[cle] === false ? "temp" : "en-ligne";
  }
  if (p.statut === "prete_a_ouvrir") return "bientot";
  if (p.statut === "preproduction") return "preprod";
  return p.statut === "indisponible" ? "indisponible" : "refusee";
}

/** Formats réellement possibles maintenant (vide si la plateforme n'est pas en ligne). */
export function formatsOuverts(p: Plateforme, etat: EtatAffiche): readonly FormatCatalogue[] {
  return etat === "en-ligne" ? p.formats_compatibles : [];
}

/** Raison d'un format fermé, telle que le catalogue la donne (jamais inventée). */
export function raisonFormat(p: Plateforme, f: FormatCatalogue, etat: EtatAffiche): string {
  if (etat === "temp") return `${p.nom} est temporairement coupée par AETHRYON. Réessaie plus tard.`;
  return typo(p.fonctions_indisponibles.find((x) => x.fonction === f)?.raison ?? `${p.nom} : non proposé.`);
}

/** Raison générale d'une plateforme qui n'est pas en ligne (première raison du catalogue). */
export function raisonPlateforme(p: Plateforme, etat: EtatAffiche): string {
  if (etat === "en-ligne") return "";
  if (etat === "temp") return `${p.nom} est temporairement coupée par AETHRYON. Réessaie plus tard ; rien n'est perdu.`;
  if (etat === "bientot") return `${p.nom} : essais réussis, ouverture prochaine.`;
  return typo(p.fonctions_indisponibles[0]?.raison ?? "");
}

/** Plateforme d'un lien, sans réseau (frontière d'étiquette, domaine le plus long). */
export function plateformeDuLienCatalogue(texte: string): Plateforme | null {
  const t = texte.trim();
  if (!t) return null;
  let hote: string;
  try { hote = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`).hostname.toLowerCase().replace(/\.+$/, ""); } catch { return null; }
  let meilleure: Plateforme | null = null, l = 0;
  for (const p of PLATEFORMES) for (const d of p.domaines) if ((hote === d || hote.endsWith(`.${d}`)) && d.length > l) { meilleure = p; l = d.length; }
  return meilleure;
}

/** Plateformes en ligne aujourd'hui (pour le texte du héros, par exemple). */
export const EN_LIGNE: readonly Plateforme[] = PLATEFORMES.filter((p) => etatAffiche(p) === "en-ligne");

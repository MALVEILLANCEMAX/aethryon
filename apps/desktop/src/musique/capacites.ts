// Capacités → actions affichées (logique pure, essayée par vitest). Règle du brief : « ne jamais présenter une action
// comme disponible si elle ne fonctionne pas réellement ». Seules les actions présentes dans `fiche.actions` sont
// montrées ; l'import exige EN PLUS la capacité `AuthorizedDownload` ; un aperçu n'est montré qu'avec son lien
// « Ouvrir dans Apple Music » (décision du propriétaire) ; un catalogue commercial n'a jamais d'import.
import type { Action, EtatFiche, Fiche, PisteFiche } from "./types";

export const PLATEFORMES: Record<string, string> = {
  spotify: "Spotify", apple: "Apple Music", soundcloud: "SoundCloud", deezer: "Deezer",
  archive: "Internet Archive", commons: "Wikimedia Commons", podcast: "Podcast", fichier: "Fichier audio",
};
const CATALOGUES = new Set(["spotify", "apple", "soundcloud", "deezer"]);

export interface Detection { id: string; nom: string; refuse?: string }

/** Détection immédiate pendant la frappe (indicative : le serveur décide). */
export function detecter(texte: string): Detection | null {
  const t = texte.trim();
  if (!t) return null;
  if (/^spotify:(track|album|playlist|artist|episode|show):/i.test(t)) return { id: "spotify", nom: "Spotify" };
  let u: URL;
  try { u = new URL(t); } catch { return null; }
  if (u.protocol !== "https:") return { id: "inconnu", nom: "Lien", refuse: "Seuls les liens https:// sont acceptés." };
  const h = u.hostname.toLowerCase().replace(/^www\./, "");
  if (h === "music.youtube.com") return { id: "youtube-music", nom: "YouTube Music", refuse: "Les liens YouTube Music ne sont pas acceptés : AETHRYON ne télécharge pas le catalogue musical commercial." };
  if (/(^|\.)spotify\.com$/.test(h) || h === "spotify.link") return { id: "spotify", nom: "Spotify" };
  if (h === "music.apple.com" || h === "itunes.apple.com" || h === "podcasts.apple.com" || h === "geo.music.apple.com") return { id: "apple", nom: "Apple Music" };
  if (h === "soundcloud.com" || h === "m.soundcloud.com" || h === "on.soundcloud.com") return { id: "soundcloud", nom: "SoundCloud" };
  if (h === "deezer.com" || h === "deezer.page.link" || h === "link.deezer.com") return { id: "deezer", nom: "Deezer" };
  if (h === "archive.org") return { id: "archive", nom: "Internet Archive" };
  if (h === "commons.wikimedia.org" || h === "upload.wikimedia.org") return { id: "commons", nom: "Wikimedia Commons" };
  if (/(^|\.)(youtube\.com|youtu\.be|bandcamp\.com|tidal\.com|qobuz\.com|music\.amazon\.[a-z.]+)$/.test(h)) return { id: "non-pris", nom: h, refuse: "Cette plateforme n'est pas prise en charge par AETHRYON Music." };
  if (/\.(mp3|ogg|oga|opus|flac|wav|m4a)$/i.test(u.pathname)) return { id: "fichier", nom: "Fichier audio" };
  if (/(\.rss|\.xml|\/feed|\/rss)$/i.test(u.pathname) || h.startsWith("feeds.")) return { id: "podcast", nom: "Podcast (RSS)" };
  return { id: "inconnu", nom: h };
}

export interface EtatAffiche { libelle: string; ton: "ok" | "or" | "neutre"; explication: string }
export const ETATS: Record<EtatFiche, EtatAffiche> = {
  lien_reconnu: { libelle: "Lien reconnu", ton: "neutre", explication: "Le lien est valide, mais ses informations ne sont pas lisibles pour l'instant." },
  identifie: { libelle: "Titre identifié", ton: "neutre", explication: "Informations officielles. Aucun fichier : ce service n'autorise pas le téléchargement." },
  correspondance: { libelle: "Déjà dans ta bibliothèque", ton: "ok", explication: "Un fichier que tu possèdes correspond à ce titre." },
  telechargeable: { libelle: "Téléchargeable", ton: "or", explication: "La source autorise explicitement le téléchargement." },
};

export interface Choix { cle: string; libelle: string; champ: "fichier" | "episode"; valeur: string; dureeS: number | null; detail: string | null }

export interface Plan {
  etat: EtatAffiche;
  plateforme: string;
  catalogue: boolean;
  ouvrir: { libelle: string; url: string } | null;
  lecteurOfficiel: { url: string; hauteur: number; note: string | null; libelle: string } | null;
  apercu: { url: string; libelle: string; mention: string | null; lien: { libelle: string; url: string } } | null;
  ecouter: { url: string; type: string | null } | null;
  enregistrer: boolean;
  importer: { corps: Record<string, unknown>; attestationRequise: boolean; attestation: string | null; choix: Choix[] } | null;
  restrictions: string[];
  manque: string[];
  avertissements: string[];
}

const action = (f: Fiche, id: string): Action | undefined => f.actions.find((a) => a.id === id);
const https = (u: unknown): u is string => typeof u === "string" && u.startsWith("https://");

/** Choix proposés pour un import multiple : fichiers d'un élément Internet Archive, épisodes d'un podcast. */
export function choixImport(f: Fiche): Choix[] {
  const out: Choix[] = [];
  for (const [i, p] of (f.pistes ?? []).entries()) {
    const fic = (p.fichiers ?? []).find((x) => x.original) ?? (p.fichiers ?? [])[0];
    if (fic?.nom) out.push({ cle: `f:${fic.nom}`, libelle: p.titre || fic.nom, champ: "fichier", valeur: fic.nom, dureeS: p.dureeS ?? fic.dureeS ?? null, detail: [fic.format, fic.taille ? `${(Math.round(fic.taille / 1e5) / 10).toLocaleString("fr-FR")}\u00a0Mo` : null].filter(Boolean).join(" · ") || null });
    else if (f.connecteur === "podcast" && p.id) out.push({ cle: `e:${p.id}`, libelle: p.titre || `Épisode ${i + 1}`, champ: "episode", valeur: String(p.id), dureeS: p.dureeS ?? null, detail: null });
  }
  return out;
}

export function plan(f: Fiche): Plan {
  const catalogue = CATALOGUES.has(f.connecteur);
  const o = action(f, "ouvrir");
  const lo = action(f, "lecteur_officiel");
  const ap = action(f, "apercu");
  const ec = action(f, "ecouter");
  const im = action(f, "importer");
  const peutImporter = !catalogue && !!im?.requete && f.capacites.includes("AuthorizedDownload");
  return {
    etat: ETATS[f.etat] ?? ETATS.lien_reconnu,
    plateforme: PLATEFORMES[f.connecteur] ?? f.connecteur,
    catalogue,
    ouvrir: o && https(o.url) ? { libelle: o.libelle ?? "Ouvrir la source", url: o.url } : null,
    lecteurOfficiel: lo && https(lo.embed) ? { url: lo.embed, hauteur: Math.min(Math.max(lo.hauteur ?? 152, 80), 520), note: lo.note ?? null, libelle: `Lecteur officiel ${PLATEFORMES[f.connecteur] ?? ""}`.trim() } : null,
    // Un aperçu SANS son lien « Ouvrir dans Apple Music » n'est jamais montré.
    apercu: ap && https(ap.url) && ap.lien && https(ap.lien.url) ? { url: ap.url, libelle: ap.libelle ?? "Aperçu de 30 s", mention: ap.mention ?? null, lien: ap.lien } : null,
    ecouter: ec && https(ec.url) ? { url: ec.url, type: ec.type ?? null } : null,
    enregistrer: !!action(f, "enregistrer_lien"),
    importer: peutImporter ? { corps: { ...im!.requete!.corps }, attestationRequise: !!im!.attestationRequise, attestation: im!.attestation ?? null, choix: choixImport(f) } : null,
    restrictions: f.restrictions ?? [],
    manque: f.manque ?? [],
    avertissements: f.avertissements ?? [],
  };
}

/** Corps d'import pour un choix (fichier ou épisode) ; `attestation` : case cochée par l'utilisateur. */
export function corpsPour(p: Plan, choix: Choix | null, attestation: boolean): Record<string, unknown> | null {
  if (!p.importer) return null;
  if (p.importer.attestationRequise && !attestation) return null;
  // ytapi ne pré-remplit plus `attestation` (3.8) ; par prudence on l'ôte quand même : seule la case cochée la remet.
  const { attestation: _pre, ...c }: Record<string, unknown> = { ...p.importer.corps };
  if (choix) c[choix.champ] = choix.valeur;
  if (p.importer.attestationRequise) c.attestation = true;
  return c;
}

/** Durée totale d'un album ou d'une playlist quand toutes les durées sont connues, sinon null. */
export function dureeTotale(pistes: PisteFiche[] | undefined): number | null {
  if (!pistes?.length) return null;
  let t = 0;
  for (const p of pistes) { if (p.dureeS == null) return null; t += p.dureeS; }
  return t;
}

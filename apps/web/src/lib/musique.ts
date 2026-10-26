// AETHRYON Music dans l'espace (/dashboard/musique) : détection de la plateforme, états, actions RÉELLES d'une fiche
// (cloud-music/MUSIC-API.md). Mêmes règles que le Desktop : seules les actions présentes dans la fiche sont montrées ;
// l'import exige `AuthorizedDownload` et n'existe jamais pour un catalogue commercial ; un aperçu n'est montré qu'avec
// son lien « Ouvrir dans Apple Music ». Fonctions pures, essayées par tests/musique.test.ts.
export type EtatFiche = "lien_reconnu" | "identifie" | "correspondance" | "telechargeable";
export interface Action { id: string; libelle?: string; url?: string; embed?: string; hauteur?: number; note?: string; mention?: string; lien?: { libelle: string; url: string }; requete?: { methode: string; chemin: string; corps: Record<string, unknown> }; attestationRequise?: boolean; attestation?: string }
export interface Fichier { nom: string; format?: string | null; taille?: number | null; original?: boolean }
export interface PisteFiche { titre: string; artistes: string[]; dureeS?: number | null; numero?: number | null; id?: string | null; fichiers?: Fichier[] }
export interface Fiche {
  connecteur: string; type: string; url: string; etat: EtatFiche; titre: string | null; artistes: string[]; album?: string | null; dureeS?: number | null; date?: string | null;
  pochette?: string | null; pistes?: PisteFiche[]; pistesTotal?: number | null; licence?: { code: string; nom: string; url?: string | null } | null; attribution?: string | null;
  capacites: string[]; actions: Action[]; restrictions?: string[]; manque?: string[]; avertissements?: string[];
}
export interface ImportVue {
  id: string; etat: "en_file" | "telechargement" | "verification" | "etiquetage" | "termine" | "echec" | "annule"; titre: string | null; artistes: string[]; connecteur: string;
  progression: { octets: number; total: number | null; pourcentage: number | null } | null; erreur: { code: string; detail: string } | null; licence: { nom: string } | null;
  fichier: { nom: string; taille: number; url: string } | null; cloud: { libelle: string } | null; disponibleJusquA: string | null;
}
export interface EntreeHistorique { action: "analyse" | "import"; url: string; connecteur: string; titre: string | null; artistes: string[]; pochette: string | null; etat: string; importId: string | null; origine: "site" | "desktop"; creeLe: string; majLe: string }

export const PLATEFORMES: Record<string, string> = { spotify: "Spotify", apple: "Apple Music", soundcloud: "SoundCloud", deezer: "Deezer", archive: "Internet Archive", commons: "Wikimedia Commons", podcast: "Podcast", fichier: "Fichier audio" };
const CATALOGUES = new Set(["spotify", "apple", "soundcloud", "deezer"]);
export const ETATS: Record<EtatFiche, { libelle: string; tone: "neutral" | "ok" | "gold"; texte: string }> = {
  lien_reconnu: { libelle: "Lien reconnu", tone: "neutral", texte: "Le lien est valide, mais ses informations ne sont pas lisibles pour l'instant." },
  identifie: { libelle: "Titre identifié", tone: "neutral", texte: "Informations officielles. Aucun fichier : ce service n'autorise pas le téléchargement." },
  correspondance: { libelle: "Déjà dans ta bibliothèque", tone: "ok", texte: "Un fichier que tu possèdes correspond à ce titre." },
  telechargeable: { libelle: "Téléchargeable", tone: "gold", texte: "La source autorise explicitement le téléchargement." },
};
export const ETAPES: Record<ImportVue["etat"], string> = { en_file: "En file d'attente", telechargement: "Téléchargement par le serveur", verification: "Vérification du fichier", etiquetage: "Étiquetage", termine: "Prêt", echec: "Échec", annule: "Annulé" };

/** Détection pendant la frappe (indicative ; le serveur décide). */
export function detecter(texte: string): { id: string; nom: string; refuse?: string } | null {
  const t = texte.trim();
  if (!t) return null;
  if (/^spotify:(track|album|playlist|artist|episode|show):/i.test(t)) return { id: "spotify", nom: "Spotify" };
  let u: URL;
  try { u = new URL(t); } catch { return null; }
  if (u.protocol !== "https:") return { id: "inconnu", nom: "Lien", refuse: "Seuls les liens https:// sont acceptés." };
  const h = u.hostname.toLowerCase().replace(/^www\./, "");
  if (h === "music.youtube.com") return { id: "youtube-music", nom: "YouTube Music", refuse: "Les liens YouTube Music ne sont pas acceptés : AETHRYON ne télécharge pas le catalogue musical commercial." };
  if (/(^|\.)spotify\.com$/.test(h)) return { id: "spotify", nom: "Spotify" };
  if (/^(music|itunes|podcasts|geo\.music)\.apple\.com$/.test(h)) return { id: "apple", nom: "Apple Music" };
  if (/^(m\.|on\.)?soundcloud\.com$/.test(h)) return { id: "soundcloud", nom: "SoundCloud" };
  if (h === "deezer.com" || h === "link.deezer.com") return { id: "deezer", nom: "Deezer" };
  if (h === "archive.org") return { id: "archive", nom: "Internet Archive" };
  if (h === "commons.wikimedia.org" || h === "upload.wikimedia.org") return { id: "commons", nom: "Wikimedia Commons" };
  if (/\.(mp3|ogg|oga|opus|flac|wav|m4a)$/i.test(u.pathname)) return { id: "fichier", nom: "Fichier audio" };
  if (/(\.rss|\.xml|\/feed|\/rss)$/i.test(u.pathname) || h.startsWith("feeds.")) return { id: "podcast", nom: "Podcast (RSS)" };
  return { id: "inconnu", nom: h };
}

const https = (u: unknown): u is string => typeof u === "string" && u.startsWith("https://");
const act = (f: Fiche, id: string) => f.actions.find((a) => a.id === id);

export interface Choix { cle: string; libelle: string; champ: "fichier" | "episode"; valeur: string }
export function plan(f: Fiche) {
  const catalogue = CATALOGUES.has(f.connecteur);
  const o = act(f, "ouvrir"), lo = act(f, "lecteur_officiel"), ap = act(f, "apercu"), ec = act(f, "ecouter"), im = act(f, "importer");
  const choix: Choix[] = [];
  for (const [i, p] of (f.pistes ?? []).entries()) {
    const fic = (p.fichiers ?? []).find((x) => x.original) ?? (p.fichiers ?? [])[0];
    if (fic?.nom) choix.push({ cle: `f:${fic.nom}`, libelle: p.titre || fic.nom, champ: "fichier", valeur: fic.nom });
    else if (f.connecteur === "podcast" && p.id) choix.push({ cle: `e:${p.id}`, libelle: p.titre || `Épisode ${i + 1}`, champ: "episode", valeur: String(p.id) });
  }
  return {
    catalogue,
    plateforme: PLATEFORMES[f.connecteur] ?? f.connecteur,
    etat: ETATS[f.etat] ?? ETATS.lien_reconnu,
    ouvrir: o && https(o.url) ? { libelle: o.libelle ?? "Ouvrir la source", url: o.url } : null,
    lecteurOfficiel: lo && https(lo.embed) ? { url: lo.embed, hauteur: Math.min(Math.max(lo.hauteur ?? 152, 80), 520), note: lo.note ?? null } : null,
    apercu: ap && https(ap.url) && ap.lien && https(ap.lien.url) ? { url: ap.url, mention: ap.mention ?? null, lien: ap.lien } : null,
    ecouter: ec && https(ec.url) ? { url: ec.url } : null,
    importer: !catalogue && im?.requete && f.capacites.includes("AuthorizedDownload") ? { corps: { ...im.requete.corps }, attestationRequise: !!im.attestationRequise, attestation: im.attestation ?? null, choix } : null,
  };
}

export function corpsImport(p: ReturnType<typeof plan>, choix: Choix | null, attestation: boolean): Record<string, unknown> | null {
  if (!p.importer || (p.importer.attestationRequise && !attestation)) return null;
  // ytapi ne pré-remplit plus `attestation` (3.8) ; par prudence on l'ôte quand même : seule la case cochée la remet.
  const { attestation: _pre, ...c }: Record<string, unknown> = { ...p.importer.corps };
  if (choix) c[choix.champ] = choix.valeur;
  if (p.importer.attestationRequise) c.attestation = true;
  return c;
}

/** Avancement d'un import : fraction RÉELLE si le total est connu, sinon null (aucun pourcentage inventé). */
export function fraction(i: Pick<ImportVue, "progression" | "etat">): number | null {
  if (i.etat === "termine") return 1;
  const p = i.progression;
  return p && p.total ? Math.min(1, p.octets / p.total) : null;
}

export function duree(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s) || s < 0) return "—";
  const t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`;
}

/** Message d'erreur du relais (codes d'account et d'AETHRYON Music). */
export function erreurMusique(code: string, message: string): string {
  if (code === "music_closed") return "AETHRYON Music n'est pas encore ouvert sur ce serveur.";
  if (code === "rate_limited" || code === "trop_d_imports") return "Trop de demandes en peu de temps : réessaie dans quelques minutes.";
  return message || "Action impossible pour le moment.";
}

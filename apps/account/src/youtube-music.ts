// YouTube Music (music.youtube.com) est FERMÉ au convertisseur (décision du propriétaire, 2026-10-23) : AETHRYON ne
// télécharge pas le catalogue musical commercial. ytapi (app/urls.py) reste la référence et refuse ces liens avant tout
// travail ; account les refuse aussi avant de relayer ou d'enregistrer quoi que ce soit (même code, même texte que
// docs/ERREURS.md). Seul l'hôte décide : les liens YouTube classiques (youtube.com, m.youtube.com, youtu.be, Shorts)
// ne changent pas. Aucune requête n'est faite et aucun lien n'est suivi.

export const YOUTUBE_MUSIC_CODE = "youtube_music_not_accepted";
export const YOUTUBE_MUSIC_TEXT = "Les liens YouTube Music ne sont pas acceptés : AETHRYON ne télécharge pas le catalogue musical commercial.";

const DOMAINS = ["music.youtube.com", "music.youtu.be", "music.youtube-nocookie.com", "youtubemusic.com"] as const;

/** music.youtube.com et ses sous-domaines (frontière d'étiquette : notmusic.youtube.com n'en est pas un), casse et point final ignorés. */
export function isYouTubeMusicHost(host: string): boolean {
  const bare = host.trim().toLowerCase().replace(/\.+$/, "");
  return bare !== "" && DOMAINS.some((d) => bare === d || bare.endsWith(`.${d}`));
}

function hostnameOf(text: string): string {
  for (const attempt of [text, `https://${text.replace(/^\/+/, "")}`]) {
    try {
      const h = new URL(attempt).hostname;
      if (h) return h;
    } catch { /* essai suivant */ }
  }
  return "";
}

/** Le lien désigne-t-il YouTube Music, quelle que soit son écriture (avec ou sans schéma, port, identifiants, casse) ? */
export function isYouTubeMusicUrl(raw: unknown): boolean {
  return typeof raw === "string" && raw.length <= 4096 && isYouTubeMusicHost(hostnameOf(raw.trim()));
}

// Lien d'une plateforme prise en charge (avant tout appel réseau ; ytapi reste la référence au moment d'une conversion).
// Version 2 : les réponses des commandes sont dans v2/router.ts et v2/ui.ts.
// YouTube Music (music.youtube.com) est FERMÉ depuis le 2026-10-23 (décision du propriétaire) : jamais accepté, même
// s'il est un sous-domaine de youtube.com ; une commande qui en reçoit un lien répond par le refus de docs/ERREURS.md.
const SUPPORTED = /^(?:www\.|m\.)?youtube\.com$|^youtu\.be$|^(?:www\.|m\.|vm\.|vt\.)?tiktok\.com$|^(?:www\.|mobile\.)?(?:x|twitter)\.com$/;

/** Lien d'une plateforme prise en charge (https uniquement). */
export function isSupportedLink(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" && SUPPORTED.test(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

const MUSIC_DOMAINS = ["music.youtube.com", "music.youtu.be", "music.youtube-nocookie.com", "youtubemusic.com"] as const;

/** music.youtube.com et ses sous-domaines (frontière d'étiquette), casse et point final ignorés. */
export function isYouTubeMusicHost(host: string): boolean {
  const bare = host.trim().toLowerCase().replace(/\.+$/, "");
  return bare !== "" && MUSIC_DOMAINS.some((d) => bare === d || bare.endsWith(`.${d}`));
}

/** Le lien désigne-t-il YouTube Music, quelle que soit son écriture (avec ou sans schéma, port, casse) ? */
export function isYouTubeMusicLink(raw: string): boolean {
  if (typeof raw !== "string" || raw.length > 4096) return false;
  const text = raw.trim();
  for (const attempt of [text, `https://${text.replace(/^\/+/, "")}`]) {
    try {
      const h = new URL(attempt).hostname;
      if (h) return isYouTubeMusicHost(h);
    } catch { /* essai suivant */ }
  }
  return false;
}

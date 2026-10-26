// Reconnaissance LOCALE d'un lien collé dans le champ du héros : aucune requête, aucun envoi. Mêmes règles que le
// service de conversion (ytapi/app/urls.py, config.py ALLOWED_DOMAINS) pour ne jamais promettre ce qu'il refuserait :
// une vidéo à la fois (ni playlist, ni chaîne, ni recherche), pas de diaporama photo TikTok, trois plateformes.
import type { PlatformId } from "./brand.ts";

export type Probe =
  | { state: "vide" }
  | { state: "ok"; platform: PlatformId; label: string }
  | { state: "refus"; platform?: PlatformId; message: string };

const HOSTS: readonly [string, PlatformId][] = [
  ["youtube.com", "youtube"], ["youtu.be", "youtube"], ["youtube-nocookie.com", "youtube"],
  ["tiktok.com", "tiktok"], ["x.com", "x"], ["twitter.com", "x"],
];

const COLLECTION = "Une vidéo à la fois : les playlists, chaînes et recherches ne sont pas prises en charge.";

// YouTube Music (music.youtube.com) est FERMÉ au convertisseur depuis le 2026-10-23 (décision du propriétaire) : même
// code et même texte que ytapi (docs/ERREURS.md, `youtube_music_not_accepted`). Seul l'hôte décide ; le lien n'est jamais suivi.
export const YOUTUBE_MUSIC_TEXT = "Les liens YouTube Music ne sont pas acceptés\u00a0: AETHRYON ne télécharge pas le catalogue musical commercial.";
const MUSIC_DOMAINS = ["music.youtube.com", "music.youtu.be", "music.youtube-nocookie.com", "youtubemusic.com"] as const;

/** music.youtube.com et ses sous-domaines (frontière d'étiquette : notmusic.youtube.com n'en est pas un). */
export function isYouTubeMusicHost(host: string): boolean {
  const bare = host.trim().toLowerCase().replace(/\.+$/, "");
  return bare !== "" && MUSIC_DOMAINS.some((d) => bare === d || bare.endsWith(`.${d}`));
}

/** Une redirection (youtube.com/redirect?q=…) qui désigne un lien YouTube Music : seul le message change, rien n'est suivi. */
function carriesMusicLink(params: URLSearchParams): boolean {
  for (const value of params.values()) {
    let text = value;
    for (let i = 0; i < 3; i++) {
      for (const m of text.matchAll(/(?:[a-z][a-z0-9+.-]*:)?\/\/([^/?#\s\\]+)/gi)) {
        try { if (isYouTubeMusicHost(new URL(`https://${m[1]!}`).hostname)) return true; } catch { /* hôte illisible */ }
      }
      try { if (isYouTubeMusicHost(new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text.replace(/^\/+/, "")}`).hostname)) return true; } catch { /* pas un lien */ }
      let decoded: string;
      try { decoded = decodeURIComponent(text); } catch { break; }
      if (decoded === text) break;
      text = decoded;
    }
  }
  return false;
}

export function probeLink(raw: string): Probe {
  const text = raw.trim();
  if (!text) return { state: "vide" };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { state: "refus", message: "Ce texte n'est pas un lien." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { state: "refus", message: "Ce texte n'est pas un lien." };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isYouTubeMusicHost(host)) return { state: "refus", message: YOUTUBE_MUSIC_TEXT };
  const platform = HOSTS.find(([h]) => host === h || host.endsWith(`.${h}`))?.[1];
  if (!platform) return { state: "refus", message: "Ce site n'est pas pris en charge : YouTube, TikTok et X seulement." };
  const path = url.pathname;

  if (platform === "youtube") {
    if (host === "youtu.be") return path.replace(/\//g, "") ? { state: "ok", platform, label: "Vidéo YouTube reconnue" } : { state: "refus", platform, message: COLLECTION };
    if (/^\/embed\/videoseries/i.test(path)) return { state: "refus", platform, message: COLLECTION };
    if (url.searchParams.get("v")) return { state: "ok", platform, label: "Vidéo YouTube reconnue" };
    if (/^\/shorts\/[A-Za-z0-9_-]+\/?$/i.test(path)) return { state: "ok", platform, label: "Short YouTube reconnu" };
    if (/^\/(?:live|embed|v|e|clip)\/[A-Za-z0-9_-]+\/?$/i.test(path)) return { state: "ok", platform, label: "Vidéo YouTube reconnue" };
    if (carriesMusicLink(url.searchParams)) return { state: "refus", message: YOUTUBE_MUSIC_TEXT };
    return { state: "refus", platform, message: COLLECTION };
  }
  if (platform === "tiktok") {
    if (/\/photo\//i.test(path)) return { state: "refus", platform, message: "Les diaporamas photo TikTok ne sont pas pris en charge." };
    if (/\/video\/\d+/.test(path) || /^(?:vm|vt)\.tiktok\.com$/.test(host) && path.length > 2) return { state: "ok", platform, label: "Vidéo TikTok reconnue" };
    return { state: "refus", platform, message: COLLECTION };
  }
  if (/\/status(?:es)?\/\d+/.test(path)) return { state: "ok", platform, label: "Publication X reconnue" };
  return { state: "refus", platform, message: "Colle le lien d'une publication X (…/status/…)." };
}

/** Exemples joués dans le champ au repos (fictifs, jamais une œuvre réelle). */
export const PROBE_EXAMPLES: readonly { text: string; platform: PlatformId }[] = [
  { text: "youtube.com/watch?v=aethryon-01", platform: "youtube" },
  { text: "tiktok.com/@atelier/video/7395021…", platform: "tiktok" },
  { text: "x.com/atelier/status/1840557…", platform: "x" },
];

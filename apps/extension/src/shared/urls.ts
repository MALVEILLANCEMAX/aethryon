// Détection, normalisation et validation STRICTES des liens de médias pris en charge.
// Même périmètre que ytapi (app/urls.py) : YouTube (watch, youtu.be, Shorts — youtube-urls.ts), TikTok
// (vidéo, liens courts), X/Twitter (publication). Tout le reste est
// refusé : pas d'Instagram, pas de chaînes, pas de playlists, pas de diaporamas TikTok, pas de directs.
// Utilisé par les content scripts ET, à nouveau, par le service worker avant tout appel à l'API (une
// page ne peut jamais imposer une autre URL).
import { isYouTubeHost, isYouTubeThumbHost, parseYouTube } from "./youtube-urls.ts";

export { youtubeThumbnail } from "./youtube-urls.ts";

export type Platform = "youtube" | "tiktok" | "twitter";
export type MediaKind = "video" | "short" | "post" | "shortlink";

export interface MediaRef {
  platform: Platform;
  kind: MediaKind;
  /** URL canonique envoyée à l'API (https, sans paramètres de suivi). */
  url: string;
  /** Identifiant stable de la vidéo (YouTube 11 caractères, TikTok/X numérique, code de lien court). */
  id: string;
  /** X : rang de la vidéo dans la publication (1 = première), seulement si l'URL le précise. */
  index?: number;
}

export const PLATFORM_LABEL: Record<Platform, string> = { youtube: "YouTube", tiktok: "TikTok", twitter: "X" };

const NUM_ID = /^[0-9]{6,25}$/;
const TT_USER = /^@[A-Za-z0-9._-]{0,40}$/;
const X_USER = /^[A-Za-z0-9_]{1,20}$/;
const SHORT_CODE = /^[A-Za-z0-9]{4,20}$/;

const TT_HOSTS = new Set(["www.tiktok.com", "tiktok.com", "m.tiktok.com"]);
const TT_SHORT_HOSTS = new Set(["vm.tiktok.com", "vt.tiktok.com"]);
const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com", "mobile.x.com"]);

/** Hôte d'une page sur laquelle l'extension a un content script. */
export function platformOfHost(hostname: string): Platform | null {
  const h = hostname.toLowerCase();
  if (isYouTubeHost(h)) return "youtube";
  if (TT_HOSTS.has(h)) return "tiktok";
  if (X_HOSTS.has(h)) return "twitter";
  return null;
}

/** Analyse une URL ; null si elle n'est pas un média pris en charge. Ne fait aucune requête. */
export function parseMediaUrl(input: string): MediaRef | null {
  if (typeof input !== "string" || input.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password || (u.port && u.port !== "443" && u.port !== "80")) return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);

  // YouTube
  const youtube = parseYouTube(host, parts, u);
  if (youtube !== undefined) return youtube;

  // TikTok
  if (TT_SHORT_HOSTS.has(host)) {
    const code = parts[0];
    return parts.length === 1 && code && SHORT_CODE.test(code)
      ? { platform: "tiktok", kind: "shortlink", url: `https://${host}/${code}/`, id: code }
      : null;
  }
  if (TT_HOSTS.has(host)) {
    if (parts.length === 2 && parts[0] === "t" && parts[1] && SHORT_CODE.test(parts[1])) {
      return { platform: "tiktok", kind: "shortlink", url: `https://www.tiktok.com/t/${parts[1]}/`, id: parts[1] };
    }
    if (parts.length === 3 && parts[1] === "video" && parts[0] && TT_USER.test(parts[0]) && parts[2] && NUM_ID.test(parts[2])) {
      return { platform: "tiktok", kind: "video", url: `https://www.tiktok.com/${parts[0]}/video/${parts[2]}`, id: parts[2] };
    }
    return null; // profils, diaporamas (/photo/), directs, accueil : non pris en charge
  }

  // X / Twitter
  if (X_HOSTS.has(host)) {
    // /<utilisateur>/status/<id> ou /<utilisateur>/status/<id>/video/<n>
    if (parts.length >= 3 && parts[1] === "status" && parts[0] && X_USER.test(parts[0]) && parts[2] && NUM_ID.test(parts[2])) {
      const ref: MediaRef = { platform: "twitter", kind: "post", url: `https://x.com/${parts[0]}/status/${parts[2]}`, id: parts[2] };
      if (parts.length === 3) return ref;
      if (parts.length === 5 && parts[3] === "video" && parts[4] && /^[1-9][0-9]?$/.test(parts[4])) {
        return { ...ref, index: Number(parts[4]) };
      }
      return null;
    }
    return null;
  }
  return null;
}

/** Clé d'unicité d'un média (une seule commande par vidéo dans une page). */
export function mediaKey(ref: Pick<MediaRef, "platform" | "id" | "index">): string {
  return `${ref.platform}:${ref.id}${ref.index ? `#${ref.index}` : ""}`;
}

/** Miniature affichable dans le popup : seulement des CDN connus des plateformes, en https. */
export function safeThumbnail(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 2048) return null;
  try {
    const u = new URL(input);
    if (u.protocol !== "https:") return null;
    const h = u.hostname.toLowerCase();
    const ok = isYouTubeThumbHost(h) || h === "pbs.twimg.com" || h === "video.twimg.com" ||
      /(^|\.)tiktokcdn(-[a-z0-9]+)?\.com$/.test(h) || /(^|\.)tiktokcdn\.com$/.test(h) || /(^|\.)ibyteimg\.com$/.test(h);
    return ok ? u.toString() : null;
  } catch {
    return null;
  }
}


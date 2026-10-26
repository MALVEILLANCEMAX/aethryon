// Liens YouTube pris en charge (watch, youtu.be, Shorts) — même périmètre que ytapi (app/urls.py).
import type { MediaRef } from "./urls.ts";

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_HOSTS = new Set(["www.youtube.com", "youtube.com", "m.youtube.com"]);

/** Hôte d'une page YouTube (où l'extension a un content script). */
export function isYouTubeHost(host: string): boolean {
  return YT_HOSTS.has(host);
}

/** Miniatures YouTube affichables dans le popup (CDN officiel, https). */
export function isYouTubeThumbHost(host: string): boolean {
  return host === "i.ytimg.com" || host.endsWith(".ytimg.com");
}

function yt(id: string, kind: "video" | "short"): MediaRef {
  return kind === "short"
    ? { platform: "youtube", kind, url: `https://www.youtube.com/shorts/${id}`, id }
    : { platform: "youtube", kind, url: `https://www.youtube.com/watch?v=${id}`, id };
}

/** URL YouTube → média ; null : YouTube, mais rien de pris en charge ; undefined : ce n'est pas YouTube. */
export function parseYouTube(host: string, parts: string[], u: URL): MediaRef | null | undefined {
  if (host === "youtu.be") {
    const id = parts[0];
    return parts.length === 1 && id && YT_ID.test(id) ? yt(id, "video") : null;
  }
  if (!YT_HOSTS.has(host)) return undefined;
  if (parts.length === 1 && parts[0] === "watch") {
    const v = u.searchParams.get("v");
    return v && YT_ID.test(v) ? yt(v, "video") : null;
  }
  if (parts.length === 2 && parts[0] === "shorts" && parts[1] && YT_ID.test(parts[1])) return yt(parts[1], "short");
  return null;
}

/** Miniature officielle d'une vidéo YouTube (sans requête préalable). */
export function youtubeThumbnail(id: string): string | null {
  return YT_ID.test(id) ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null;
}

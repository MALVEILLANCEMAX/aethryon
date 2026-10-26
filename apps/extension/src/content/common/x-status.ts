// X / Twitter : attribution d'une vidéo à SA publication (logique pure, sans DOM).
// - Lien d'une publication : le <time> d'une publication est dans un lien /<compte>/status/<id> ; à
//   défaut, le lien « statistiques » (/status/<id>/analytics) de sa barre d'actions.
// - Une vidéo d'une publication CITÉE appartient au lien de la publication citée, jamais à la
//   publication qui la cite ; si la publication citée n'expose aucun lien, aucune commande (on ne
//   devine pas).
// - Plusieurs vidéos : videoCount = nombre de vidéos ; le menu propose « Vidéo 1, 2… » (index).
// Testé par tests/unit/content-x.test.ts.
import { parseMediaUrl, platformOfHost } from "../../shared/urls.ts";

export interface XStatus {
  /** URL canonique https://x.com/<compte>/status/<id> (validée par parseMediaUrl). */
  url: string;
  id: string;
  /** Compte (sans @) ; null pour les liens génériques /i/status/<id>. */
  handle: string | null;
}

const STATUS_PATH = /^\/([A-Za-z0-9_]{1,20})\/status\/([0-9]{6,25})(\/(?:photo|video)\/[1-9][0-9]?|\/analytics|\/quotes|\/retweets|\/likes|\/history)?\/?$/;
const WEB_STATUS_PATH = /^\/i\/web\/status\/([0-9]{6,25})\/?$/;

/** href (relatif ou absolu) d'un lien de publication X → publication canonique, ou null. */
export function statusFromHref(href: string | null | undefined, base = "https://x.com/"): XStatus | null {
  if (typeof href !== "string" || !href || href.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(href, base);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || platformOfHost(u.hostname) !== "twitter") return null;
  let user: string;
  let id: string;
  const m = STATUS_PATH.exec(u.pathname);
  if (m) {
    user = m[1]!;
    id = m[2]!;
  } else {
    const w = WEB_STATUS_PATH.exec(u.pathname);
    if (!w) return null;
    user = "i";
    id = w[1]!;
  }
  const ref = parseMediaUrl(`https://x.com/${user}/status/${id}`);
  if (!ref || ref.platform !== "twitter") return null;
  return { url: ref.url, id: ref.id, handle: user === "i" ? null : user };
}

/** Un lien trouvé dans une publication (relevé du DOM, voir src/content/x.ts). */
export interface XLinkInfo {
  href: string;
  /** Le lien contient un <time> (horodatage de la publication). */
  hasTime: boolean;
  /** Le lien est à l'intérieur de la publication citée. */
  inQuote: boolean;
}

function isAnalytics(href: string): boolean {
  try {
    return new URL(href, "https://x.com/").pathname.endsWith("/analytics");
  } catch {
    return false;
  }
}

/** Publication elle-même : horodatage hors citation, sinon lien « statistiques » hors citation. */
export function chooseOwnStatus(links: readonly XLinkInfo[]): XStatus | null {
  for (const l of links) {
    if (l.hasTime && !l.inQuote) {
      const s = statusFromHref(l.href);
      if (s) return s;
    }
  }
  for (const l of links) {
    if (!l.inQuote && isAnalytics(l.href)) {
      const s = statusFromHref(l.href);
      if (s) return s;
    }
  }
  return null;
}

/** Publication citée : horodatage dans la citation, sinon tout lien de publication dans la citation. */
export function chooseQuoteStatus(links: readonly XLinkInfo[], own: XStatus | null): XStatus | null {
  const inQuote = links.filter((l) => l.inQuote);
  for (const pass of [true, false]) {
    for (const l of inQuote) {
      if (pass && !l.hasTime) continue;
      const s = statusFromHref(l.href);
      if (s && s.id !== own?.id) return s;
    }
  }
  return null;
}

export interface XPostScan {
  own: XStatus | null;
  /** Vidéos de la publication, hors publication citée. */
  ownVideos: number;
  quote: { status: XStatus | null; videos: number } | null;
}

export interface XBinding {
  status: XStatus;
  videoCount: number;
  /** « actions » : barre d'actions de la publication ; « quote » : sous la carte de la publication citée. */
  placement: "actions" | "quote";
}

/** Commandes à afficher pour une publication : aucune sans vidéo, une par publication qui a des vidéos. */
export function planXBindings(scan: XPostScan): XBinding[] {
  const out: XBinding[] = [];
  if (scan.own && scan.ownVideos > 0) out.push({ status: scan.own, videoCount: scan.ownVideos, placement: "actions" });
  const q = scan.quote;
  if (q && q.videos > 0 && q.status && q.status.id !== scan.own?.id) out.push({ status: q.status, videoCount: q.videos, placement: "quote" });
  return out;
}

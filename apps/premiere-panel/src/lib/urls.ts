// Reconnaissance STRICTE des liens pris en charge, sans aucune requête (reconnaissance « à la frappe »).
// Copie fidèle du périmètre de l'extension navigateur (extension/src/shared/urls.ts et youtube-urls.ts), lui-même
// aligné sur ytapi (app/urls.py) : YouTube (watch, youtu.be, Shorts), TikTok (vidéo, liens courts), X/Twitter
// (publication). Tout le reste est refusé : pas de chaînes, de playlists, de diaporamas TikTok ni de directs.

export type Plateforme = "youtube" | "tiktok" | "twitter";
export type GenreLien = "video" | "short" | "post" | "shortlink";

export interface LienMedia {
  plateforme: Plateforme;
  genre: GenreLien;
  /** URL canonique envoyée à l'API (https, sans paramètre de suivi). */
  url: string;
  /** Identifiant stable (YouTube 11 caractères, TikTok/X numérique, code de lien court). */
  id: string;
  /** X : rang de la vidéo dans la publication, seulement si l'URL le précise. */
  rang?: number;
}

export const NOM_PLATEFORME: Record<Plateforme, string> = { youtube: "YouTube", tiktok: "TikTok", twitter: "X" };

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_HOSTS = new Set(["www.youtube.com", "youtube.com", "m.youtube.com"]);
const NUM_ID = /^[0-9]{6,25}$/;
const TT_USER = /^@[A-Za-z0-9._-]{0,40}$/;
const X_USER = /^[A-Za-z0-9_]{1,20}$/;
const SHORT_CODE = /^[A-Za-z0-9]{4,20}$/;
const TT_HOSTS = new Set(["www.tiktok.com", "tiktok.com", "m.tiktok.com"]);
const TT_SHORT_HOSTS = new Set(["vm.tiktok.com", "vt.tiktok.com"]);
const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com", "mobile.x.com"]);

function yt(id: string, genre: "video" | "short"): LienMedia {
  return genre === "short"
    ? { plateforme: "youtube", genre, url: `https://www.youtube.com/shorts/${id}`, id }
    : { plateforme: "youtube", genre, url: `https://www.youtube.com/watch?v=${id}`, id };
}

/** Plateforme devinée dès les premiers caractères (même incomplets), pour l'affichage instantané. */
export function plateformeProbable(saisie: string): Plateforme | null {
  const s = saisie.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
  if (/^(m\.)?youtube\.com|^youtu\.be/.test(s)) return "youtube";
  if (/^(vm\.|vt\.|m\.)?tiktok\.com/.test(s)) return "tiktok";
  if (/^(mobile\.)?(x|twitter)\.com/.test(s)) return "twitter";
  return null;
}

/** Analyse un lien ; null s'il n'est pas un média pris en charge. */
export function analyserLien(saisie: string): LienMedia | null {
  if (typeof saisie !== "string" || saisie.length > 2048) return null;
  let brut = saisie.trim();
  if (!/^https?:\/\//i.test(brut) && /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(brut)) brut = "https://" + brut;
  let u: URL;
  try {
    u = new URL(brut);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password || (u.port && u.port !== "443" && u.port !== "80")) return null;
  const hote = u.hostname.toLowerCase();
  const p = u.pathname.split("/").filter(Boolean);

  if (hote === "youtu.be") return p.length === 1 && YT_ID.test(p[0]!) ? yt(p[0]!, "video") : null;
  if (YT_HOSTS.has(hote)) {
    if (p.length === 1 && p[0] === "watch") {
      const v = u.searchParams.get("v");
      return v && YT_ID.test(v) ? yt(v, "video") : null;
    }
    if (p.length === 2 && p[0] === "shorts" && YT_ID.test(p[1]!)) return yt(p[1]!, "short");
    return null;
  }
  if (TT_SHORT_HOSTS.has(hote)) {
    const code = p[0];
    return p.length === 1 && code && SHORT_CODE.test(code)
      ? { plateforme: "tiktok", genre: "shortlink", url: `https://${hote}/${code}/`, id: code }
      : null;
  }
  if (TT_HOSTS.has(hote)) {
    if (p.length === 2 && p[0] === "t" && SHORT_CODE.test(p[1]!)) {
      return { plateforme: "tiktok", genre: "shortlink", url: `https://www.tiktok.com/t/${p[1]}/`, id: p[1]! };
    }
    if (p.length === 3 && p[1] === "video" && TT_USER.test(p[0]!) && NUM_ID.test(p[2]!)) {
      return { plateforme: "tiktok", genre: "video", url: `https://www.tiktok.com/${p[0]}/video/${p[2]}`, id: p[2]! };
    }
    return null;
  }
  if (X_HOSTS.has(hote)) {
    if (p.length >= 3 && p[1] === "status" && X_USER.test(p[0]!) && NUM_ID.test(p[2]!)) {
      const ref: LienMedia = { plateforme: "twitter", genre: "post", url: `https://x.com/${p[0]}/status/${p[2]}`, id: p[2]! };
      if (p.length === 3) return ref;
      if (p.length === 5 && p[3] === "video" && /^[1-9][0-9]?$/.test(p[4]!)) return { ...ref, rang: Number(p[4]) };
    }
    return null;
  }
  return null;
}

// YouTube Music (music.youtube.com) est FERMÉ depuis le 2026-10-23 (décision du propriétaire) : jamais reconnu comme
// média (analyserLien le refuse déjà : hôtes exacts), et refusé ici avec le texte du service (docs/ERREURS.md).
export const TEXTE_YOUTUBE_MUSIC = "Les liens YouTube Music ne sont pas acceptés\u00a0: AETHRYON ne télécharge pas le catalogue musical commercial.";
const DOMAINES_MUSIQUE = ["music.youtube.com", "music.youtu.be", "music.youtube-nocookie.com", "youtubemusic.com"] as const;

/** music.youtube.com et ses sous-domaines (frontière d'étiquette), casse et point final ignorés. */
export function estHoteYouTubeMusic(hote: string): boolean {
  const nu = hote.trim().toLowerCase().replace(/\.+$/, "");
  return nu !== "" && DOMAINES_MUSIQUE.some((d) => nu === d || nu.endsWith(`.${d}`));
}

/** La saisie désigne-t-elle YouTube Music, avec ou sans schéma, port, casse ? (aucune requête) */
export function estLienYouTubeMusic(saisie: string): boolean {
  if (typeof saisie !== "string" || saisie.length > 4096) return false;
  const brut = saisie.trim();
  for (const essai of [brut, `https://${brut.replace(/^\/+/, "")}`]) {
    try {
      const h = new URL(essai).hostname;
      if (h) return estHoteYouTubeMusic(h);
    } catch { /* essai suivant */ }
  }
  return false;
}

/** Explique pourquoi un lien reconnu comme plateforme n'est pas pris en charge (message honnête). */
export function raisonRefus(saisie: string): string {
  if (estLienYouTubeMusic(saisie)) return TEXTE_YOUTUBE_MUSIC;
  const pf = plateformeProbable(saisie);
  if (!saisie.trim()) return "";
  if (!pf) return "Colle un lien YouTube, TikTok ou X.";
  if (pf === "youtube") return "Ce lien YouTube n’est pas une vidéo (chaîne, playlist ou direct) : colle le lien d’une vidéo ou d’un Short.";
  if (pf === "tiktok") return "Ce lien TikTok n’est pas une vidéo (profil, diaporama ou direct).";
  return "Ce lien X n’est pas une publication : colle le lien d’un post qui contient une vidéo.";
}

/** Miniatures distantes admises (CDN officiels, https), en repli quand le serveur n'en fournit pas. */
export function miniatureSure(entree: unknown): string | null {
  if (typeof entree !== "string" || entree.length > 2048) return null;
  try {
    const u = new URL(entree);
    if (u.protocol !== "https:") return null;
    const h = u.hostname.toLowerCase();
    const ok = h === "i.ytimg.com" || h.endsWith(".ytimg.com") || h === "pbs.twimg.com" || h === "video.twimg.com" ||
      /(^|\.)tiktokcdn(-[a-z0-9]+)?\.com$/.test(h) || /(^|\.)ibyteimg\.com$/.test(h);
    return ok ? u.toString() : null;
  } catch {
    return null;
  }
}

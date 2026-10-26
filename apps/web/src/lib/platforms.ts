// Registre des plateformes et applications EXTERNES citées par AETHRYON : projection, pour le site, du registre
// complet brand/platforms/registre.json (sources officielles, citations exactes, contacts ; docs/MARQUES.md).
// Vérification : 2026-10-11.
//
// Règle : aucun logo de marque sans autorisation vérifiée. Décision C → le NOM en texte (usage nominatif) et un
// pictogramme neutre qui décrit un FORMAT (vidéo, vidéo verticale, publication…), jamais une imitation : ni
// rectangle arrondi + triangle (icône YouTube), ni note de musique (TikTok), ni glyphe X, ni couleurs des marques.
// Seule exception sur le site : le logo officiel de Discord, NON MODIFIÉ, dans la présentation du bot (licence des
// Developer Terms de Discord), au moins 20 px de haut, avec le mot « Discord » juste à côté.
import type { PlatformId } from "./brand.ts";

/** A : logo officiel utilisable · B : sous conditions (précisées) · C : pas de logo, texte + pictogramme neutre. */
export type Decision = "A" | "B" | "C";
/** Pictogrammes neutres de repli (ui/brand/PlatformGlyph.tsx). */
export type Glyph = "video" | "vertical" | "post" | "chat" | "phone" | "browser";

export interface PlatformEntry {
  name: string;
  owner: string;
  /** source : contenu converti · acces : façon d'utiliser AETHRYON · navigateur · connexion : bouton de connexion. */
  role: "source" | "acces" | "navigateur" | "connexion";
  decision: Decision;
  glyph: Glyph | null;
  /** Page officielle des règles de marque (lue le 2026-10-11). */
  rules: string;
  /** Conditions vérifiées, en une phrase (détail et citations : docs/MARQUES.md). */
  conditions: string;
  /** Adresses que le service accepte réellement (ytapi : app/urls.py), affichées pour la reconnaissance. */
  domains?: readonly string[];
  /** Logo officiel autorisé : où, quels fichiers (non modifiés, dans public/brand/platforms/), taille minimale. */
  logo?: { usage: "presentation-bot"; files: { blurple: string; white: string; black: string }; aspect: number; minHeight: number };
  /** Mention de propriété (pied de page). */
  trademark: string;
}

export const PLATFORM_REGISTRY = {
  youtube: {
    name: "YouTube", owner: "Google LLC", role: "source", decision: "C", glyph: "video",
    rules: "https://brand.youtube/",
    conditions: "Aucune voie d'autorisation pour un service de conversion ; « Never display a YouTube trademark on a site or app that violates the YouTube Terms of Service ».",
    domains: ["youtube.com", "youtu.be"],
    trademark: "YouTube et YouTube Shorts sont des marques de Google LLC.",
  },
  tiktok: {
    name: "TikTok", owner: "TikTok", role: "source", decision: "C", glyph: "vertical",
    rules: "https://www.tiktokbrandhub.com/legal",
    conditions: "Logo interdit sans permission écrite préalable ; le nom peut désigner la plateforme.",
    domains: ["tiktok.com"],
    trademark: "TikTok est une marque de ses titulaires.",
  },
  x: {
    name: "X", owner: "X Corp.", role: "source", decision: "C", glyph: "post",
    rules: "https://about.x.com/fr/who-we-are/brand-toolkit",
    conditions: "Nom et logo réservés à un consentement écrit exprès (CGU X) : nom en texte seulement, sobrement.",
    domains: ["x.com", "twitter.com"],
    trademark: "X est une marque de X Corp.",
  },
  discord: {
    name: "Discord", owner: "Discord Inc.", role: "acces", decision: "B", glyph: "chat",
    rules: "https://discord.com/branding",
    conditions: "Logo officiel non modifié, de façon incidente, seulement pour présenter le bot ; jamais dans son nom ; ≥ 20 px ; mot « Discord » à côté du symbole.",
    logo: {
      usage: "presentation-bot",
      files: { blurple: "/brand/platforms/discord/discord-symbol-blurple.svg", white: "/brand/platforms/discord/discord-symbol-white.svg", black: "/brand/platforms/discord/discord-symbol-black.svg" },
      aspect: 126.644 / 96,
      minHeight: 20,
    },
    trademark: "Discord est une marque de Discord Inc.",
  },
  iphone: {
    name: "iPhone", owner: "Apple Inc.", role: "acces", decision: "C", glyph: "phone",
    rules: "https://www.apple.com/legal/intellectual-property/guidelinesfor3rdparties.html",
    conditions: "Aucune icône Apple (pas même l'icône de l'app Raccourcis) sans licence écrite ; « iPhone » en texte, jamais traduit ; éviter « iOS ».",
    trademark: "iPhone est une marque d'Apple Inc., déposée aux États-Unis et dans d'autres pays et régions.",
  },
  chrome: {
    name: "Google Chrome", owner: "Google LLC", role: "navigateur", decision: "C", glyph: "browser",
    rules: "https://developer.chrome.com/docs/webstore/branding",
    conditions: "Icône soumise à permission (Partner Marketing Hub) ; badge du Chrome Web Store impossible hors store : nom en texte.",
    trademark: "Google Chrome est une marque de Google LLC.",
  },
  edge: {
    name: "Microsoft Edge", owner: "Microsoft", role: "navigateur", decision: "C", glyph: "browser",
    rules: "https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks",
    conditions: "« Don't use Microsoft's logos, icons, or designs, in any manner » sans licence : nom en texte.",
    trademark: "Microsoft et Microsoft Edge sont des marques du groupe de sociétés Microsoft.",
  },
  google: {
    name: "Google", owner: "Google LLC", role: "connexion", decision: "A", glyph: "browser",
    rules: "https://developers.google.com/identity/branding-guidelines",
    conditions: "« G » standard actuel (dégradé), non modifié, sur fond blanc, uniquement dans le bouton de connexion.",
    trademark: "Google est une marque de Google LLC.",
  },
  brave: {
    name: "Brave", owner: "Brave Software", role: "navigateur", decision: "C", glyph: "browser",
    rules: "https://brave.com/terms-of-use/",
    conditions: "Consentement écrit préalable exigé ; le kit public ne vaut pas licence : nom en texte.",
    trademark: "Brave est une marque de Brave Software.",
  },
} as const satisfies Record<string, PlatformEntry>;

export type RegistryId = keyof typeof PLATFORM_REGISTRY;

/** Les sources réellement prises en charge (lib/brand.ts PLATFORMS) ont toutes une entrée. */
export const sourceEntry = (id: PlatformId): PlatformEntry => PLATFORM_REGISTRY[id];

/** Mention de non-affiliation et de propriété (pied de page). */
export const TRADEMARK_NOTICE =
  "AETHRYON est un service indépendant, sans lien avec Google, TikTok, X, Discord ou Apple, ni approuvé par eux. " +
  [PLATFORM_REGISTRY.youtube, PLATFORM_REGISTRY.tiktok, PLATFORM_REGISTRY.x, PLATFORM_REGISTRY.discord, PLATFORM_REGISTRY.iphone].map((p) => p.trademark).join(" ");

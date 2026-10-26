// Repères des plateformes externes, d'après le registre lib/platforms.ts (docs/MARQUES.md).
// - PlatformGlyph : pictogramme NEUTRE dessiné pour AETHRYON (trait 1,6, couleur héritée + un accent or) qui
//   décrit un format, jamais une marque. Décoratif : le nom de la plateforme est toujours écrit à côté.
// - DiscordMark : le logo officiel de Discord, fichier NON MODIFIÉ (public/brand/platforms/discord/), réservé à la
//   présentation du bot ; hauteur imposée d'au moins 20 px ; le mot « Discord » l'accompagne toujours.
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { PLATFORM_REGISTRY, type Glyph, type RegistryId } from "../../lib/platforms.ts";

/** Accent unique (or de la planche) : une seule touche par pictogramme, jamais une couleur de marque. */
const ACC = "text-gold";

// La FORME dit le format : paysage (vidéo longue), portrait empilé (flux de vidéos courtes), carte (publication
// avec vidéo). Dessinés pour AETHRYON, trait 1,6, coins arrondis ; vérifiés de 14 à 64 px (banc de comparaison).
const PATHS: Record<Glyph, ReactNode> = {
  // YouTube : lecteur paysage, barre de lecture (partie lue en or) et tête de lecture — jamais le rectangle plein
  // avec triangle de l'icône YouTube, jamais de rouge
  video: <><rect x="2.5" y="5.25" width="19" height="13.5" rx="3.2" /><path d="M6.2 15h11.6" opacity={0.3} /><path d="M6.2 15h6" strokeWidth={2.2} className={ACC} /><circle cx="12.6" cy="15" r="1.5" fill="currentColor" stroke="none" /></>,
  // TikTok : carte portrait devant une autre (flux vertical), légende — jamais la note de musique du logo TikTok
  vertical: <><path d="M5.1 16.4V7.3a2.6 2.6 0 0 1 2.6-2.6" strokeWidth={1.8} className={ACC} /><rect x="8" y="2.75" width="10.75" height="18.5" rx="2.9" /><path d="M10.9 16.6h3.4" opacity={0.45} /></>,
  // X : publication avec média intégré (aplat or léger) — jamais de glyphe X
  post: <><rect x="3.5" y="3.5" width="17" height="17" rx="3.4" /><circle cx="7.7" cy="7.9" r="1.5" fill="currentColor" stroke="none" /><path d="M10.7 7.9h5.6" opacity={0.55} /><rect x="6.5" y="11.1" width="11" height="6.4" rx="1.5" fill="currentColor" opacity={0.45} stroke="none" className={ACC} /></>,
  // discussion (Discord, hors présentation du bot) : bulle avec une commande « / »
  chat: <><path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5h-8.5L6 20v-3.5H5A1.5 1.5 0 0 1 3.5 15V6.5A1.5 1.5 0 0 1 5 5z" /><path d="M10.6 13.2l2.8-5" strokeWidth={1.9} className={ACC} /></>,
  // smartphone générique (sans encoche ni silhouette d'iPhone)
  phone: <><rect x="6" y="2.5" width="12" height="19" rx="3" /><path d="M10.5 5.5h3" /></>,
  // navigateur générique
  browser: <><rect x="3" y="4.5" width="18" height="15" rx="2.5" /><path d="M3 8.5h18" /><path d="M6 6.5h.01M8.5 6.5h.01" className={ACC} strokeWidth={2} /></>,
};

export function PlatformGlyph({ id, size = 22, className }: { id: RegistryId; size?: number; className?: string }) {
  const glyph = PLATFORM_REGISTRY[id].glyph;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" className={cn("shrink-0", className)} data-glyph={glyph} data-platform-glyph={id}>
      {PATHS[glyph]}
    </svg>
  );
}

/** Logo officiel de Discord (symbole), pour la présentation du bot SEULEMENT. Décoratif (alt vide) : le mot
 *  « Discord » est affiché juste à côté par l'appelant. */
export function DiscordMark({ tone = "blurple", height = 20, className }: { tone?: "blurple" | "white" | "black"; height?: number; className?: string }) {
  const logo = PLATFORM_REGISTRY.discord.logo;
  const h = Math.max(logo.minHeight, height);
  return <img src={logo.files[tone]} alt="" width={Math.round(h * logo.aspect)} height={h} className={cn("shrink-0", className)} data-official-logo="discord" decoding="async" />;
}

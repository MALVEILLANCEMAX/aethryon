// Repère d'une plateforme selon le réglage de lib/logos.ts : vrai logo (mode « officiels ») ou pictogramme neutre
// AETHRYON (défaut, docs/MARQUES.md). Discord : toujours le fichier officiel non modifié, mais seulement là où le bot
// est présenté (`bot`) en mode neutre — ailleurs, la bulle neutre. Toujours décoratif : le nom est écrit à côté.
import { cn } from "../../lib/cn.ts";
import { LOGO_PATHS, OFFICIAL_LOGOS, type LogoId } from "../../lib/logos.ts";
import type { RegistryId } from "../../lib/platforms.ts";
import { DiscordMark, PlatformGlyph } from "./PlatformGlyph.tsx";

const LOGO_OF: Partial<Record<RegistryId, LogoId>> = { youtube: "youtube", tiktok: "tiktok", x: "x", iphone: "apple", chrome: "chrome", brave: "brave" };

export function OfficialLogo({ id, size = 20, className }: { id: LogoId; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" focusable="false"
      className={cn("shrink-0", className)} data-logo={id}>
      <path d={LOGO_PATHS[id].d} />
    </svg>
  );
}

export function PlatformMark({ id, size = 20, bot = false, tone = "light", className }: {
  id: RegistryId;
  size?: number;
  /** Présentation du bot Discord : seul endroit où le logo officiel de Discord est permis en mode neutre. */
  bot?: boolean;
  /** Fond sur lequel le repère est posé (pour le fichier Discord officiel : blanc sur sombre, noir sur clair). */
  tone?: "light" | "dark";
  className?: string;
}) {
  if (id === "discord" && (bot || OFFICIAL_LOGOS)) {
    return <DiscordMark tone={tone === "dark" ? "white" : "black"} height={Math.max(20, Math.round(size * 0.8))} className={cn("discord-mark", className)} />;
  }
  const logo = LOGO_OF[id];
  if (OFFICIAL_LOGOS && logo) return <OfficialLogo id={logo} size={size} className={className} />;
  return <PlatformGlyph id={id} size={size} className={className} />;
}

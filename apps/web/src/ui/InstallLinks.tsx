// Liens d'installation du raccourci, tous alimentés par useShortcutUrl() (une seule source : /api/config).
// Le parcours guidé /installer reste l'entrée principale (le raccourci demande le jeton à l'import) ;
// ces liens servent à réinstaller ou mettre à jour quand on a déjà son jeton.
import type { ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "../lib/cn.ts";
import { ICLOUD_REL, useShortcutUrl } from "../lib/shortcut.ts";
import { ButtonA, ButtonLink } from "./Button.tsx";
import { IconArrowUpRight, IconDownload, ShortcutTile } from "./Icon.tsx";

const textLink = "text-gold-text underline decoration-gold/50 underline-offset-4 transition-colors hover:decoration-gold-text";
/** Sur écran étroit, le texte du bouton peut passer à la ligne (jamais d'icône écrasée ni de débordement). */
const wrap = "h-auto min-h-12 whitespace-normal py-2 leading-tight sm:whitespace-nowrap";

/** « depuis le lien iCloud officiel » s'il est publié, sinon « depuis la page Installer » (préposition incluse). */
export function InstallTextLink({ className }: { className?: string }) {
  const { icloudUrl } = useShortcutUrl();
  if (icloudUrl) {
    return <>depuis le <a href={icloudUrl} rel={ICLOUD_REL} className={cn(textLink, className)}>lien iCloud officiel</a> (ou la page <Link to="/installer" className={cn(textLink, className)}>Installer</Link>)</>;
  }
  return <>depuis la page <Link to="/installer" className={cn(textLink, className)}>Installer</Link></>;
}

/** Boutons de réinstallation : lien iCloud (principal) + fichier signé (secours), ou parcours guidé. */
export function InstallButtons({ className, tone = "light", label }: { className?: string; tone?: "light" | "night"; label?: ReactNode }) {
  const { icloudUrl, fallbackDownload } = useShortcutUrl();
  const night = tone === "night";
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:flex-wrap", className)}>
      {icloudUrl ? (
        <ButtonA href={icloudUrl} rel={ICLOUD_REL} variant={night ? "light" : "primary"} className={wrap} icon={<ShortcutTile size={22} className="shrink-0" />} trailing={<IconArrowUpRight size={16} />}>
          {label ?? "Installer dans Raccourcis"}
        </ButtonA>
      ) : (
        <ButtonLink to="/installer" variant={night ? "light" : "primary"} className={wrap} icon={<IconDownload size={18} className="shrink-0" />}>{label ?? "Installer le raccourci"}</ButtonLink>
      )}
      <ButtonA href={fallbackDownload} download="AETHRYON.shortcut" variant={night ? "night" : "ghost"} className={wrap} icon={<IconDownload size={18} className="shrink-0" />}>Télécharger le fichier signé</ButtonA>
    </div>
  );
}

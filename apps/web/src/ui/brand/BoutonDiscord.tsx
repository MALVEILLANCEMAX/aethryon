// Bouton aux couleurs de Discord (demande du propriétaire, 2026-10-29) : fond Blurple #5865F2 (survol #4752C4), texte
// blanc pur #fff (contraste 4,6:1 ; « white » du thème est un ivoire), symbole officiel BLANC non modifié, 20 px de haut au moins, le mot « Discord » toujours dans
// le libellé. Réservé aux actions de l'application Discord d'AETHRYON : se connecter, relier son compte (docs/MARQUES.md).
// La taille (hauteur, largeur, corps du texte) vient de la page ; classes jointes SANS tailwind-merge, qui prendrait
// « text-corps » pour une couleur et retirerait le blanc.
import type { ButtonHTMLAttributes } from "react";
import { DiscordMark } from "./PlatformGlyph.tsx";

export function BoutonDiscord({ chargement = false, className, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { chargement?: boolean }) {
  return (
    <button type="button" {...p} aria-busy={chargement || undefined} data-discord-bouton=""
      className={["relative inline-flex items-center justify-center gap-3 rounded-full bg-[#5865F2] px-6 font-medium text-[#fff] shadow-card transition-[background-color,translate,box-shadow] duration-200 hover:-translate-y-px hover:bg-[#4752C4] hover:shadow-raised focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#5865F2] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none motion-reduce:hover:translate-y-0", className].filter(Boolean).join(" ")}>
      {chargement
        ? <span className="size-5 animate-spin rounded-full border-2 border-[#fff] border-r-transparent motion-reduce:animate-none" aria-hidden="true" />
        : <DiscordMark tone="white" height={20} />}
      <span>{children}</span>
    </button>
  );
}

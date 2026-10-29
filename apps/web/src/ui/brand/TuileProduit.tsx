// Tuiles des produits (2026-10-28) : la famille de PremiereMark (choix du propriétaire, 2026-10-18) étendue aux autres
// façons d'utiliser AETHRYON. Même tuile obsidienne de 64, même halo et même liseré champagne ; au centre, un glyphe
// Phosphor plein (licence MIT, ui/ph/ph.ts) en feuille d'or. Aucune marque tierce : ni logo de navigateur, ni pomme,
// ni logo de Discord ; le nom du produit reste toujours écrit à côté. Couleurs fixes (un objet, comme une icône d'app).
// Les pages intérieures (« Le Passage ») prennent la même tuile pour leur emblème (TuileGlyphe : aide, pages légales…).
import { useId } from "react";
import { cn } from "../../lib/cn.ts";
import { PH_PLEIN, type NomPlein } from "../ph/ph.ts";
import { PremiereMark } from "./PremiereMark.tsx";

export type Produit = "extension" | "premiere" | "iphone" | "discord" | "tools" | "web" | "desktop";

const GLYPHE = { extension: "extension", iphone: "telephone", discord: "discussion", tools: "ciseaux", web: "profil", desktop: "navigateur" } as const;

/** Glyphe de 34 unités centré dans la tuile de 64 (grille Phosphor de 256). */
const GLYPHE_T = "translate(15 15) scale(0.1328125)";

/** La tuile obsidienne et son glyphe d'or ; `label` la nomme pour les lecteurs d'écran, sinon elle est décorative. */
export function TuileGlyphe({ glyphe, size = 40, label, className, produit }: { glyphe: NomPlein; size?: number; label?: string; className?: string; produit?: string }) {
  const id = useId().replace(/[^\w-]/g, "");
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} fill="none" className={cn("tuile-produit shrink-0", className)} data-produit={produit}
      role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
      <defs>
        <radialGradient id={`tp-halo-${id}`} cx="50%" cy="40%" r="58%">
          <stop offset="0" stopColor="#D4AF7C" stopOpacity="0.22" />
          <stop offset="1" stopColor="#D4AF7C" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`tp-or-${id}`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#F4E4C1" />
          <stop offset="0.55" stopColor="#D4AF7C" />
          <stop offset="1" stopColor="#A57C45" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="#0F0F10" />
      <rect width="64" height="64" rx="14" fill={`url(#tp-halo-${id})`} />
      <rect x="0.5" y="0.5" width="63" height="63" rx="13.5" stroke="#D4AF7C" strokeOpacity="0.28" />
      <path d={PH_PLEIN[glyphe]} transform={GLYPHE_T} fill={`url(#tp-or-${id})`} />
    </svg>
  );
}

export function TuileProduit({ produit, size = 40, label, className }: { produit: Produit; size?: number; label?: string; className?: string }) {
  if (produit === "premiere") return <PremiereMark size={size} label={label} className={className} />;
  return <TuileGlyphe glyphe={GLYPHE[produit]} size={size} label={label} className={className} produit={produit} />;
}

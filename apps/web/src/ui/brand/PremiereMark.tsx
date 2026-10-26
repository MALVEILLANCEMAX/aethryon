// Icône du logiciel « AETHRYON pour Premiere Pro » (choix du propriétaire, 2026-10-18) : la tête maître sur une
// tuile obsidienne (dessin identique au maître, sans liseré : fond sombre), au-dessus d'une piste de montage et d'une
// tête de lecture or champagne. Identité propre à AETHRYON : ni violet, ni lettres « Pr », ni rien qui imite l'icône
// d'Adobe (docs/MARQUES.md) ; le nom « Premiere Pro » reste toujours en texte, à côté.
import { useId } from "react";
import { cn } from "../../lib/cn.ts";
import { HEAD } from "./head.ts";

interface Props {
  size?: number;
  /** Nom accessible ; absent = décorative. */
  label?: string;
  className?: string;
}

/** Tête maître réduite à 60 % et centrée en (32, 26) dans la tuile de 64. */
const HEAD_T = "translate(12.8 6.2) scale(0.6)";

export function PremiereMark({ size = 44, label, className }: Props) {
  const halo = `premiere-halo-${useId().replace(/[^\w-]/g, "")}`;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} fill="none" className={cn("shrink-0", className)}
      role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false" data-premiere-mark="">
      <defs>
        <radialGradient id={halo} cx="50%" cy="40%" r="58%">
          <stop offset="0" stopColor="#D4AF7C" stopOpacity="0.2" />
          <stop offset="1" stopColor="#D4AF7C" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="#0F0F10" />
      <rect width="64" height="64" rx="14" fill={`url(#${halo})`} />
      <rect x="0.5" y="0.5" width="63" height="63" rx="13.5" stroke="#D4AF7C" strokeOpacity="0.28" />
      <g transform={HEAD_T}>
        <path d={HEAD.shell.d} fill={HEAD.shell.fill} />
        <path d={HEAD.faceLeft.d} fill={HEAD.faceLeft.fill} />
        <path d={HEAD.faceRight.d} fill={HEAD.faceRight.fill} />
        <path d={HEAD.eyeLeft.d} fill={HEAD.eyeLeft.fill} />
        <path d={HEAD.eyeRight.d} fill={HEAD.eyeRight.fill} />
        <circle cx={HEAD.glintLeft.cx} cy={HEAD.glintLeft.cy} r={HEAD.glintLeft.r} fill={HEAD.glintLeft.fill} />
        <circle cx={HEAD.glintRight.cx} cy={HEAD.glintRight.cy} r={HEAD.glintRight.r} fill={HEAD.glintRight.fill} />
        <path d={HEAD.browLeft.d} fill={HEAD.browLeft.fill} />
        <path d={HEAD.browRight.d} fill={HEAD.browRight.fill} />
        <path d={HEAD.browLine.d} stroke={HEAD.browLine.stroke} strokeWidth={HEAD.browLine.strokeWidth} />
        <path d={HEAD.beakLeft.d} fill={HEAD.beakLeft.fill} />
        <path d={HEAD.beakRight.d} fill={HEAD.beakRight.fill} />
      </g>
      {/* Piste de montage : trois plans, puis la tête de lecture. */}
      <path d="M9 52h46" stroke="#3A3631" strokeWidth="1" strokeLinecap="round" />
      <rect x="10" y="49" width="14" height="6" rx="1.6" fill="#D7C2A5" />
      <rect x="26" y="49" width="10" height="6" rx="1.6" fill="#E8D5B7" fillOpacity="0.85" />
      <rect x="38" y="49" width="16" height="6" rx="1.6" fill="#AC8150" fillOpacity="0.9" />
      <path d="M34 46.2v11.6" stroke="#D4AF7C" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M31.4 44.4h5.2L34 47.2Z" fill="#D4AF7C" />
    </svg>
  );
}

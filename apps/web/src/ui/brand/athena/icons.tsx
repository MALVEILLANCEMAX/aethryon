// Jeu de pictogrammes AETHRYON pour React (proposition) : mêmes données que brand/icons/ui/*.svg
// (icon-data.ts). Couleur héritée (currentColor), taille en px, décoratif par défaut (aria-hidden) ;
// donner `title` pour un pictogramme porteur de sens sans texte voisin. Les consommateurs actuels de
// ui/Icon.tsx ne sont PAS modifiés : la migration se fera page par page.
import type { SVGProps } from "react";
import { ICONS, ICON_STROKE, type IconEl, type IconName } from "./icon-data.ts";

export type { IconName } from "./icon-data.ts";

interface Props extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  /** Côté en px (grille 24). */
  size?: number;
  /** Nom accessible : rend le pictogramme visible des lecteurs d'écran. */
  title?: string;
}

function El({ el }: { el: IconEl }) {
  if ("d" in el) return <path d={el.d} />;
  if ("rect" in el) {
    const [x, y, width, height, rx] = el.rect;
    return <rect x={x} y={y} width={width} height={height} rx={rx} />;
  }
  const [cx, cy, r] = el.circle;
  return <circle cx={cx} cy={cy} r={r} opacity={el.opacity} {...(el.fill ? { fill: "currentColor", stroke: "none" } : {})} />;
}

export function AthenaIcon({ name, size = 20, title, ...rest }: Props) {
  const icon = ICONS[name];
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...rest}
    >
      {(icon.els as readonly IconEl[]).map((el, i) => <El key={i} el={el} />)}
    </svg>
  );
}

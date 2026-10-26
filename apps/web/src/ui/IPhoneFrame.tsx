// Cadre d'iPhone en SVG (technique de l'iPhone de Magic UI, MIT : cadre SVG + écran en DOM superposé,
// pas de foreignObject). L'écran est un conteneur de requêtes (cqw) : son contenu se met à l'échelle.
import { useId, type ReactNode } from "react";
import { cn } from "../lib/cn.ts";

const W = 433, H = 882;
// Écran : x 21, y 19, 391 × 844, rayon 54 (unités du cadre). En classes, en pourcentages du cadre :
// le HTML pré-rendu n'a pas d'attribut style (CSP), et le navigateur affiche ainsi la même chose.
//   21/433, 19/882, 391/433, 844/882 ; rayon 54/391 en largeur, 54/844 en hauteur.
const SCREEN = "left-[4.8499%] top-[2.1542%] w-[90.3002%] h-[95.6916%] rounded-[13.8107%_/_6.3981%]";

export function IPhoneFrame({ children, className, label }: { children?: ReactNode; className?: string; label?: string }) {
  const id = "p" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <div className={cn("relative aspect-[433/882] w-full select-none", className)} role={label ? "img" : undefined} aria-label={label}>
      <svg viewBox={`-4 0 ${W + 8} ${H}`} className="absolute inset-0 h-full w-[calc(100%+(8/433*100%))] -translate-x-[calc(4/441*100%)]" aria-hidden>
        <defs>
          <linearGradient id={`${id}-body`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#4a4642" />
            <stop offset="0.35" stopColor="#1f1d1b" />
            <stop offset="0.7" stopColor="#2e2b28" />
            <stop offset="1" stopColor="#56514b" />
          </linearGradient>
        </defs>
        {/* boutons latéraux */}
        <rect x="-3" y="170" width="5" height="32" rx="2" fill="#34302c" />
        <rect x="-3" y="232" width="5" height="58" rx="2" fill="#34302c" />
        <rect x="-3" y="304" width="5" height="58" rx="2" fill="#34302c" />
        <rect x={W - 2} y="262" width="5" height="96" rx="2" fill="#34302c" />
        {/* corps */}
        <rect x="0" y="0" width={W} height={H} rx="70" fill={`url(#${id}-body)`} />
        <rect x="1.5" y="1.5" width={W - 3} height={H - 3} rx="68.5" fill="none" stroke="rgb(255 255 255 / 0.12)" />
        <rect x="9" y="8" width={W - 18} height={H - 16} rx="62" fill="#07080a" />
      </svg>
      <div className={cn("absolute overflow-hidden bg-black [container-type:inline-size]", SCREEN)}>
        {children}
        {/* Dynamic Island */}
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-[2.6%] z-50 h-[4.3%] w-[32%] -translate-x-1/2 rounded-full bg-black" />
      </div>
    </div>
  );
}

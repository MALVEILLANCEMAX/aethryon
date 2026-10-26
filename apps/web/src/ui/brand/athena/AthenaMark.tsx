// Version VECTORIELLE de ui/brand/OwlMark.tsx (même API : size, blink, follow, look, wink, className), substituée
// à la construction quand VITE_MASCOT=vector (vite.config.ts) : la petite tête devient le symbole C3 — la
// même tête que la mascotte, sur son médaillon obsidienne (invisible sur fond sombre, contraste sur fond
// clair). Clignement, regard imposé et suivi du pointeur passent par le même lecteur que la mascotte.
// Décorative (aria-hidden) ; immobile si l'utilisateur réduit les animations.
import { useEffect, useId, useMemo, useRef } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "../../../lib/cn.ts";
import { MEDALLION, mascotHead, rigTransforms, stateFor, symbolViewBox } from "./geometry.ts";
import { OwlPlayer } from "./player.ts";
import { renderNodes, safePrefix } from "./render.tsx";

interface Props {
  size?: number;
  blink?: boolean;
  follow?: boolean;
  look?: { x: number; y: number } | null;
  /** Clignement unique : chaque nouvelle valeur non nulle déclenche un clignement (aucun en mouvement réduit). */
  wink?: number;
  className?: string;
}

export function OwlMark({ size = 28, blink = false, follow = false, look = null, wink = 0, className }: Props) {
  const reduced = useReducedMotion() ?? false;
  const prefix = safePrefix(useId(), "mark");
  const svg = useRef<SVGSVGElement>(null);
  const player = useRef<OwlPlayer | null>(null);
  const tree = useMemo(() => renderNodes([mascotHead()], prefix, rigTransforms("front", stateFor("neutral"))), [prefix]);
  const animated = blink || follow || !!look || wink > 0;

  useEffect(() => {
    if (!svg.current || !animated) return;
    const p = new OwlPlayer(svg.current, { pose: "front", expression: "neutral", look, follow, blink, breathe: false, reduced });
    player.current = p;
    return () => { p.destroy(); player.current = null; };
  }, [animated, follow, blink, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { player.current?.update({ look }); }, [look?.x, look?.y]); // eslint-disable-line react-hooks/exhaustive-deps
  // Clignement unique, après le même court temps de pose que la version raster (OwlMark.tsx).
  useEffect(() => {
    if (!wink || reduced) return;
    const t = window.setTimeout(() => player.current?.wink(), 650);
    return () => window.clearTimeout(t);
  }, [wink, reduced]);

  const R = MEDALLION;
  return (
    <svg ref={svg} viewBox={symbolViewBox({ medallion: true })} width={size} height={size} fill="none" aria-hidden="true" focusable="false" className={cn("owl-mark shrink-0", className)} data-mascot="vector">
      <circle cx={R.cx} cy={R.cy} r={R.r} fill="#0F0F10" />
      {tree}
    </svg>
  );
}

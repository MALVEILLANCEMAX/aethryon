// Chouette d'Athéna vectorielle (proposition) — composant React.
// Même géométrie que les fichiers de brand/ (geometry.ts) ; animations par transform et opacity
// uniquement (OwlPlayer) : clignements à intervalles humains, respiration, regard (cible ou pointeur),
// transitions d'expression par ressort Motion. En pause hors écran et onglet masqué, immobile si
// l'utilisateur réduit les animations. Carré réservé par width/height + viewBox : aucun décalage de
// mise en page. Décorative par défaut ; `label` lui donne un nom accessible (role="img").
// CSP : aucun attribut style, aucune ressource externe ; les transformations sont des attributs SVG.
import { useEffect, useId, useMemo, useRef } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "../../../lib/cn.ts";
import { owlScene, rigTransforms, stateFor, type Expression, type Pose } from "./geometry.ts";
import { OwlPlayer } from "./player.ts";
import { renderNodes, safePrefix } from "./render.tsx";

export interface AthenaOwlProps {
  expression?: Expression;
  pose?: Pose;
  /** Côté en px ; absent : le SVG remplit son conteneur (qui réserve le carré). */
  size?: number;
  /** Nom accessible ; absent : décorative (aria-hidden). */
  label?: string;
  /** Regard imposé, −1 → 1 : tourne la tête et les yeux vers une cible (survol d'une plateforme…). */
  look?: { x: number; y: number } | null;
  /** Les yeux suivent discrètement le pointeur (souris seulement). */
  follow?: boolean;
  blink?: boolean;
  breathe?: boolean;
  className?: string;
}

export function AthenaOwl({ expression = "neutral", pose = "three-quarter", size, label, look = null, follow = false, blink = true, breathe = true, className }: AthenaOwlProps) {
  const reduced = useReducedMotion() ?? false;
  const prefix = safePrefix(useId(), "owl");
  const svg = useRef<SVGSVGElement>(null);
  const player = useRef<OwlPlayer | null>(null);
  // Le graphe ne dépend que de la pose ; l'état initial est celui du premier rendu (pas de saut).
  const tree = useMemo(() => renderNodes(owlScene(pose), prefix, rigTransforms(pose, stateFor(expression))), [pose, prefix]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!svg.current) return;
    const p = new OwlPlayer(svg.current, { pose, expression, look, follow, blink, breathe, reduced });
    player.current = p;
    return () => { p.destroy(); player.current = null; };
  }, [pose, follow, blink, breathe, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { player.current?.update({ expression, look }); }, [expression, look?.x, look?.y]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <svg
      ref={svg}
      viewBox="0 0 400 400"
      width={size ?? "100%"}
      height={size ?? "100%"}
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
      className={cn("athena-owl", className)}
      data-expression={expression}
      data-pose={pose}
    >
      {tree}
    </svg>
  );
}

// Symbole AETHRYON (tête de la chouette, piste C3) — composant React, immobile. Même géométrie que
// brand/logo/*.svg. Sur fond clair : médaillon obsidienne ; sur fond sombre : tête seule. Version
// optique automatiquement jusqu'à 40 px (yeux agrandis, filet épaissi, médaillon resserré).
import { useId, useMemo } from "react";
import { cn } from "../../../lib/cn.ts";
import { headNodes, symbolViewBox, type Ground } from "./geometry.ts";
import { renderNodes, safePrefix } from "./render.tsx";

interface Props {
  size?: number;
  /** Fond sur lequel le symbole est posé. */
  ground?: Ground;
  /** Une seule couleur (currentColor n'est pas utilisé : obsidienne sur clair, ivoire sur sombre). */
  mono?: boolean;
  label?: string;
  className?: string;
}

export function AthenaSymbol({ size = 32, ground = "ivory", mono = false, label, className }: Props) {
  const prefix = safePrefix(useId(), "sym");
  const small = size <= 40;
  const medallion = ground === "ivory";
  const o = { small, medallion, mono: mono && !medallion };
  const tree = useMemo(() => renderNodes(headNodes(ground, o), prefix), [ground, small, medallion, o.mono, prefix]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <svg viewBox={symbolViewBox(o)} width={size} height={size} role={label ? "img" : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : true} focusable="false" className={cn("shrink-0", className)}>
      {tree}
    </svg>
  );
}

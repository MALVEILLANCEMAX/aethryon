// Logo AETHRYON : tête maître (OwlMark, tracés du logo) + logotype en Marcellus, choisi par le propriétaire
// le 2026-10-11. Le logotype est en contours vectoriels (wordmark.ts, généré depuis brand/master) : aucune
// police à charger, rendu identique partout. Sur fond clair (tone « ink »), la tête porte le liseré champagne
// validé ; sur fond sombre (tone « ivory »), le dessin strictement identique au maître.
import { cn } from "../../lib/cn.ts";
import { OwlMark } from "./OwlMark.tsx";
import { WORDMARK } from "./wordmark.ts";

// Hauteur de capitale ≈ 0,4 × la hauteur de la tête : en petit, le logotype garde un peu plus de corps que
// dans le logo horizontal (0,31) pour rester lisible (capitales de 10 px au minimum).
const SIZES = {
  sm: { mark: 28, cap: 10, gap: "gap-2.5" },
  md: { mark: 32, cap: 11.5, gap: "gap-3" },
  lg: { mark: 42, cap: 15, gap: "gap-3.5" },
} as const;

interface Props {
  size?: keyof typeof SIZES;
  tone?: "ink" | "ivory";
  blink?: boolean;
  className?: string;
}

export function BrandLogo({ size = "md", tone = "ink", blink = false, className }: Props) {
  const s = SIZES[size];
  const h = s.cap * WORDMARK.heightPerCap;
  return (
    <span className={cn("inline-flex items-center", s.gap, className)}>
      <OwlMark size={s.mark} blink={blink} surface={tone === "ink" ? "light" : "dark"} />
      <svg viewBox={WORDMARK.viewBox} width={(h * WORDMARK.ratio).toFixed(2)} height={h.toFixed(2)} role="img" aria-label="AETHRYON"
        className={cn("wordmark-svg", tone === "ink" ? "wordmark-svg--ink" : "wordmark-svg--ivory")}>
        <path d={WORDMARK.d} />
      </svg>
    </span>
  );
}

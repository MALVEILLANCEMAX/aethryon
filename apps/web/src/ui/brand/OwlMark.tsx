// La chouette maître (Égide v2, DESIGN_SYSTEM.md § 9) : le fichier maître seul (brand/master/aethryon-master.svg, servi
// tel quel), dans un <img> : jamais redessiné, recoloré, déformé ni animé. Les anciennes options (clignement, regard qui
// suit, clin d'œil, liseré clair) sont acceptées et IGNORÉES : la chouette signe, elle ne bouge pas.
import { cn } from "../../lib/cn.ts";
import { CHOUETTE } from "../../lib/apparence.ts";

interface Props {
  size?: number;
  blink?: boolean;
  follow?: boolean;
  look?: { x: number; y: number } | null;
  wink?: number;
  surface?: "light" | "dark";
  pad?: number;
  className?: string;
}

export function OwlMark({ size = 28, pad = 0, className }: Props) {
  const t = Math.round(size * (64 / (64 + 2 * pad)));
  return <img src={CHOUETTE} alt="" aria-hidden="true" width={t} height={t} draggable={false} decoding="async" className={cn("eg-chouette owl-mark", className)} />;
}

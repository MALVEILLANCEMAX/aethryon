// Logo AETHRYON, Égide v2 : la chouette maître (fichier maître, <img>) et le logotype en capitales espacées
// (Marcellus, police du socle). Une seule forme, quel que soit le fond : le thème donne la couleur du texte.
import { cn } from "../../lib/cn.ts";
import { Chouette } from "../egide/Egide.tsx";

const SIZES = { sm: { mark: 26, fs: "text-note" }, md: { mark: 30, fs: "text-ui" }, lg: { mark: 40, fs: "text-corps" } } as const;

interface Props {
  size?: keyof typeof SIZES;
  tone?: "ink" | "ivory";
  blink?: boolean;
  className?: string;
}

export function BrandLogo({ size = "md", className }: Props) {
  const s = SIZES[size];
  return <span className={cn("eg-marque", s.fs, className)}><Chouette taille={s.mark} /><span>AETHRYON</span></span>;
}

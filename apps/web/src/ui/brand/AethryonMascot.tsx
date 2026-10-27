// Mascotte AETHRYON, Égide v2 (DESIGN_SYSTEM.md § 9) : la chouette maître sur sa médaille, aux seuls moments qui
// comptent, et JAMAIS animée elle-même : attente (« processing ») = la veille, un fil tourne autour ; succès = le sceau,
// frappé une fois ; état vide, curiosité ou erreur = la médaille immobile (le statut est toujours dit en texte). Taille
// ramenée à la carte d'usage (36 à 72 px) : la chouette signe, elle n'occupe plus l'écran. Mouvement réduit : rien ne
// bouge (jetons du socle). Les anciennes options (regard, pose, rejouer) sont acceptées et ignorées, sauf `replayKey`
// qui refrappe le sceau.
import { cn } from "../../lib/cn.ts";
import { Medaille, Veille } from "../egide/Egide.tsx";

export type MascotState = "idle" | "curious" | "processing" | "success" | "error";
export type MascotPose = "three-quarter" | "front" | "profile";

interface Props {
  state?: MascotState;
  size?: number;
  label?: string;
  className?: string;
  paused?: boolean;
  replayKey?: string | number;
  look?: -1 | 1;
  still?: boolean;
  pose?: MascotPose;
}

const TAILLES = [36, 44, 56, 64, 72] as const;
const taille = (s: number) => TAILLES.reduce((m, t) => (Math.abs(t - s * 0.42) < Math.abs(m - s * 0.42) ? t : m), 56 as (typeof TAILLES)[number]);

export function AethryonMascot({ state = "idle", size = 256, label = "", className, replayKey = 0, still = false }: Props) {
  const t = taille(size);
  if (state === "processing" && !still) {
    return <span className={cn("egw-mascotte", className)}><Veille libelle={label || "Chargement"} /></span>;
  }
  return (
    <span className={cn("egw-mascotte", className)} role={label ? "img" : undefined} aria-label={label || undefined}>
      <Medaille key={state === "success" ? String(replayKey) : "m"} taille={t} sceau={state === "success"} frappe={state === "success" && !still} />
    </span>
  );
}

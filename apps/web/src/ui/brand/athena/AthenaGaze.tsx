// Version VECTORIELLE de ui/brand/OwlGaze.tsx (même API, mêmes attributs data-*), substituée au moment de la
// construction quand VITE_MASCOT=vector (vite.config.ts, extension « aethryon-vector-mascot ») : aucune page
// n'est modifiée. Là où la version raster fond enchaîné entre des poses du kit, la chouette vectorielle
// TOURNE vraiment la tête et les yeux vers la cible (plateforme survolée, bouton visé), par ressort.
import { AthenaOwl } from "./AthenaOwl.tsx";

export type OwlPose = "front" | "three-quarter" | "profile";
export interface Gaze { pose: OwlPose; mirror: boolean; curious?: boolean }
export const gazeKey = (g: Gaze) => `${g.curious ? "three-quarter-curious" : `${g.pose}-neutral`}${g.mirror ? "|m" : ""}`;

/** Regard → direction (−1 → 1). Les cibles de l'accueil (styles.css, .orbit-slot) : YouTube en haut à
 *  gauche, X en haut à droite, TikTok devant en bas ; les appels du héros sont au-dessus de la chouette. */
function lookOf(g: Gaze): { x: number; y: number } | null {
  if (g.curious) return { x: g.mirror ? -0.55 : 0.55, y: -0.75 };
  if (g.pose === "profile") return { x: g.mirror ? -1 : 1, y: -0.25 };
  if (g.pose === "front") return { x: 0, y: 1 };
  return null;
}

interface Props {
  gaze: Gaze;
  /** Conservés pour compatibilité avec OwlGaze (images) : sans objet en vectoriel. */
  sizes?: string;
  priority?: boolean;
  warm?: boolean;
  className?: string;
}

export function OwlGaze({ gaze, className }: Props) {
  const look = lookOf(gaze);
  return (
    <span aria-hidden="true" className={className} data-owl-gaze="" data-pose={gaze.curious ? "three-quarter" : gaze.pose} data-mirror={gaze.mirror} data-expression={gaze.curious ? "curious" : "neutral"} data-mascot="vector">
      <AthenaOwl expression={gaze.curious ? "curious" : "neutral"} look={look} className="block h-full w-full" />
    </span>
  );
}

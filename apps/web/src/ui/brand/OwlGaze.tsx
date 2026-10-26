// La chouette du héros : la tête maître elle-même (OwlMark, tracés du logo), au centre de l'orbite des
// plateformes. Quand le visiteur vise une plateforme ou un appel, ses yeux se tournent VRAIMENT vers la
// cible (translation du groupe des yeux, comme sur le logo) ; au repos, ils suivent le pointeur. Clignement
// du kit. Aucune image, aucune tête redessinée, aucune rotation simulée.
//
// Les attributs data-pose / data-mirror / data-expression décrivent la direction du regard (tests de bout
// en bout) : profile = vers le côté (miroir : à gauche), front = vers le visiteur (en bas), three-quarter
// = repos. Décorative : l'état est toujours donné en texte ailleurs.
import { OwlMark } from "./OwlMark.tsx";

export type OwlPose = "front" | "three-quarter" | "profile";
export interface Gaze { pose: OwlPose; mirror: boolean; curious?: boolean }
export const gazeKey = (g: Gaze) => `${g.curious ? "three-quarter-curious" : `${g.pose}-neutral`}${g.mirror ? "|m" : ""}`;

/** Regard → direction des yeux (−1 → 1). Cibles de l'accueil (styles.css, .orbit-slot) : YouTube en haut à
 *  gauche, X en haut à droite, TikTok devant en bas ; les appels du héros sont au-dessus de la chouette. */
function lookOf(g: Gaze): { x: number; y: number } | null {
  if (g.curious) return { x: g.mirror ? -0.55 : 0.55, y: -0.85 };
  if (g.pose === "profile") return { x: g.mirror ? -1 : 1, y: -0.2 };
  if (g.pose === "front") return { x: 0, y: 1 };
  return null;
}

interface Props {
  gaze: Gaze;
  /** Conservés pour compatibilité (anciennes poses en images) : sans objet en vectoriel. */
  sizes?: string;
  priority?: boolean;
  warm?: boolean;
  className?: string;
}

export function OwlGaze({ gaze, className }: Props) {
  return (
    <span aria-hidden="true" className={className} data-owl-gaze="" data-pose={gaze.curious ? "three-quarter" : gaze.pose} data-mirror={gaze.mirror} data-expression={gaze.curious ? "curious" : "neutral"}>
      <OwlMark size={320} blink follow look={lookOf(gaze)} className="owl-gaze-head" />
    </span>
  );
}

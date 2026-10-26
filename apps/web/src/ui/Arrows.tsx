// Petites flèches décoratives (tracé fin, dessiné une fois à l'apparition) : elles désignent sans rien dire —
// le champ du héros, la démonstration, l'offre. Toujours cachées aux lecteurs d'écran.
import { cn } from "../lib/cn.ts";

const SHAPES = {
  // courbe qui descend vers la droite (vers un champ, une carte)
  courbe: { box: "0 0 72 56", body: "M4 6C24 4 48 14 60 40", head: "M51 36.5 60 41.5 62.5 31.5" },
  // boucle légère puis descente (ton « croquis »)
  boucle: { box: "0 0 64 72", body: "M8 6c22 2 30 18 18 26-10 7-18-6-6-12 14-7 30 6 34 34", head: "M45 49 54 60 59 47" },
  // flèche droite vers le bas (défilement)
  bas: { box: "0 0 20 52", body: "M10 4v40", head: "M3.5 37 10 44.5 16.5 37" },
  // coin vers le haut à droite (lien sortant)
  coin: { box: "0 0 28 28", body: "M6 22 21 7", head: "M10 6.5h11.5V18" },
} as const;

export function Arrow({ shape, className, light = false, delayed = false, bob = false }: {
  shape: keyof typeof SHAPES;
  className?: string;
  /** Sur fond clair : encre atténuée au lieu de l'ivoire. */
  light?: boolean;
  delayed?: boolean;
  bob?: boolean;
}) {
  const s = SHAPES[shape];
  const svg = (
    <svg viewBox={s.box} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
      className={cn("deco-arrow", light && "on-light", bob ? "block size-full" : className)} data-delay={delayed ? "1" : undefined}>
      <path d={s.body} pathLength={1} />
      <path d={s.head} pathLength={1} />
    </svg>
  );
  // Balancement en boucle : porté par une boîte HTML (transform composité, aucun travail de la page à chaque image) ;
  // animé sur le SVG lui-même, il recalculait et redessinait la page 60 fois par seconde, même immobile.
  return bob ? <span aria-hidden="true" className={cn("deco-arrow-bob inline-block", className)}>{svg}</span> : svg;
}

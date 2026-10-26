// Marque officielle : chouette (maître dès 32 px, petit logo de 16 à 24 px) et logotype Marcellus en contours. Tracés
// verrouillés : on n'anime que #eyes et les reflets, par CLASSES CSS posées sur l'élément (clignement 205 ms, regard
// ± 1,4 / ± 0,98, balayage « processing » ± 1,1 en 2,6 s) : aucun rendu React par mouvement.
// Nocturne : au-dessus de 24 px, la chouette est ÉCLAIRÉE (ui/chouette.tsx, mêmes tracés, dégradés et reflet) ; le
// petit logo (≤ 24 px) reste plat pour sa lisibilité ; `plat` force le dessin d'origine.
import { useEffect, useRef, type Ref } from "react";
import { MARQUE } from "./marque-donnees";
import { mouvementReduit } from "../lib/mouvement";
import { ChouetteRelief } from "./chouette";

type Variante = "master" | "petit" | "clair";

/** Clin d'œil : relance l'animation CSS `.cligne` (205 ms) sans rendu React (SVG ou chouette en profondeur). */
export function cligner(svg: Element | null): void {
  if (!svg || mouvementReduit()) return;
  svg.classList.remove("cligne");
  void svg.getBoundingClientRect();
  svg.classList.add("cligne");
  window.setTimeout(() => svg.classList.remove("cligne"), 240);
}

/** Regard (unités du dessin), borné à ± 1,4 et ± 0,98 ; transition CSS de 200 ms. */
export function regarder(svg: Element | null, dx: number, dy: number): void {
  const yeux = svg?.querySelector<SVGGElement>("#eyes");
  if (!yeux) return;
  const x = Math.max(-1.4, Math.min(1.4, dx));
  const y = Math.max(-0.98, Math.min(0.98, dy));
  yeux.style.transform = x || y ? `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)` : "";
}

export function Chouette({ taille, variante, vivante = false, traitement = false, clin = 0, refSvg, plat = false }: {
  taille: number;
  variante?: Variante;
  /** Dessin d'origine sans éclairage (fichiers officiels, comparaisons). */
  plat?: boolean;
  /** Clignements et regards occasionnels (un seul grand symbole animé par écran). */
  vivante?: boolean;
  /** Balayage des yeux pendant une opération (installation). */
  traitement?: boolean;
  /** Incrémenter pour déclencher un clin d'œil (animation de succès). */
  clin?: number;
  refSvg?: Ref<SVGSVGElement>;
}) {
  const clair = typeof document !== "undefined" && document.documentElement.dataset.theme === "light";
  const v: Variante = variante ?? (taille <= 24 ? "petit" : clair ? "clair" : "master");
  const svg = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!vivante || mouvementReduit()) return;
    let actif = true;
    let t: number | undefined;
    const suivant = () => {
      t = window.setTimeout(() => {
        if (!actif) return;
        if (document.visibilityState === "visible" && document.hasFocus()) {
          if (Math.random() < 0.6) cligner(svg.current);
          else regarder(svg.current, (Math.random() * 2 - 1) * 1.4, (Math.random() * 2 - 1) * 0.98);
        }
        suivant();
      }, 2800 + Math.random() * 3600);
    };
    suivant();
    return () => { actif = false; window.clearTimeout(t); };
  }, [vivante]);

  useEffect(() => {
    if (clin) cligner(svg.current);
  }, [clin]);

  const lier = (el: SVGSVGElement | null) => {
    svg.current = el;
    if (typeof refSvg === "function") refSvg(el);
    else if (refSvg) (refSvg as { current: SVGSVGElement | null }).current = el;
  };
  if (!plat && v !== "petit") return <ChouetteRelief taille={taille} refSvg={lier} className={traitement ? "owl--traitement" : undefined} />;
  return (
    <svg
      ref={lier}
      className={`owl${traitement ? " owl--traitement" : ""}`}
      width={taille}
      height={taille}
      viewBox={MARQUE[v].viewBox}
      role="img"
      aria-label="AETHRYON"
      dangerouslySetInnerHTML={{ __html: MARQUE[v].body }}
    />
  );
}

/** Logotype « AETHRYON » (Marcellus en contours) : hauteur de boîte = 1,0425 × capitales, largeur = 8,5528 × hauteur. */
export function Logotype({ capitales, couleur = "currentColor" }: { capitales: number; couleur?: string }) {
  const h = +(capitales * 1.0425).toFixed(2);
  const l = +(h * 8.5528).toFixed(2);
  return (
    <svg className="wordmark" width={l} height={h} viewBox={MARQUE.wordmark.viewBox} role="img" aria-label="AETHRYON">
      <path fill={couleur} d={MARQUE.wordmark.d} />
    </svg>
  );
}

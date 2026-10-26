// Marque officielle : chouette (maître dès 32 px, petit logo de 16 à 24 px, liseré pour fonds clairs) et logotype
// Marcellus en contours. Tracés verrouillés : seul le groupe #eyes bouge (clignement de 205 ms, regard ± 1,4 unité,
// balayage « processing » ± 1,1 en 2,6 s), exactement comme OwlMark.tsx du site. Aucune rotation, ombre ni lueur.
import { useEffect, useRef, useState } from "react";
import { MARQUE } from "./marque-donnees";
import { mouvementReduit } from "../lib/mouvement";

type Variante = "master" | "petit" | "clair";

export function Chouette({ taille, variante, vivante = false, traitement = false, clin = 0 }: {
  taille: number;
  variante?: Variante;
  /** Clignements et regards occasionnels (un seul grand symbole animé par écran). */
  vivante?: boolean;
  /** Balayage des yeux pendant une opération (installation). */
  traitement?: boolean;
  /** Incrémenter pour déclencher un clin d'œil (animation de succès). */
  clin?: number;
}) {
  const clair = typeof document !== "undefined" && document.documentElement.dataset.theme === "light";
  const v: Variante = variante ?? (taille <= 24 ? "petit" : clair ? "clair" : "master");
  const [regard, setRegard] = useState<[number, number]>([0, 0]);
  const [ferme, setFerme] = useState(false);
  const minuterie = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!vivante || mouvementReduit()) return;
    let actif = true;
    const suivant = () => {
      minuterie.current = window.setTimeout(() => {
        if (!actif) return;
        if (Math.random() < 0.6) {
          setFerme(true);
          window.setTimeout(() => actif && setFerme(false), 205);
        } else {
          setRegard([(Math.random() * 2 - 1) * 1.4, (Math.random() * 2 - 1) * 0.98]);
        }
        suivant();
      }, 2800 + Math.random() * 3600);
    };
    suivant();
    return () => {
      actif = false;
      window.clearTimeout(minuterie.current);
    };
  }, [vivante]);

  useEffect(() => {
    if (!clin || mouvementReduit()) return;
    setFerme(true);
    const t = window.setTimeout(() => setFerme(false), 205);
    return () => window.clearTimeout(t);
  }, [clin]);

  let corps: string = MARQUE[v].body;
  const [dx, dy] = regard;
  if (dx || dy || ferme) {
    const t = `translate(${dx.toFixed(2)} ${dy.toFixed(2)})` + (ferme ? " translate(32 33.4) scale(1 0.08) translate(-32 -33.4)" : "");
    corps = corps.replace('<g id="eyes">', `<g id="eyes" transform="${t}">`);
  }
  return (
    <svg
      className={`owl${traitement ? " owl--traitement" : ""}`}
      width={taille}
      height={taille}
      viewBox={MARQUE[v].viewBox}
      role="img"
      aria-label="AETHRYON"
      dangerouslySetInnerHTML={{ __html: corps }}
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

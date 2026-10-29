// Décor de l'accueil : deux ailes de chouette originales en trame de points (dessinées par web/scripts/ailes.mjs), dans
// des coins opposés, derrière le contenu, coupées par les bords. Couleur : l'encre du thème, peu contrastée ; l'or patiné
// aux pointes de quelques rémiges. Arrivée : elles glissent une fois depuis leur coin, respirent deux fois, puis se posent
// (aucune boucle sans fin : la page au repos ne calcule rien). Mouvement réduit : posées d'emblée.
// Chargé à part (import dynamique), après l'affichage : le décor ne retarde ni le champ ni le premier rendu.
import { AILE_BAS, AILE_HAUT, type Aile } from "./ailes.gen.ts";

function Trace({ a, cls }: { a: Aile; cls: string }) {
  return (
    <svg className={`ac-aile ${cls}`} viewBox={`0 0 ${a.w} ${a.h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <g fill="none" strokeLinecap="round">
        <path className="ac-p3" d={a.s3} />
        <path className="ac-p2" d={a.s2} />
        <path className="ac-p1" d={a.s1} />
        <path className="ac-o2" d={a.o2} />
        <path className="ac-o1" d={a.o1} />
      </g>
    </svg>
  );
}

export default function Ailes() {
  return (
    <div className="ac-ailes" aria-hidden="true">
      <Trace a={AILE_HAUT} cls="ac-aile--haut" />
      <Trace a={AILE_BAS} cls="ac-aile--bas" />
    </div>
  );
}

/** Un fragment d'aile, très discret, au pied du panneau du menu (même fichier : déjà chargé sur l'accueil). */
export function FragmentAile() {
  return <div className="ac-panneau-aile" aria-hidden="true"><Trace a={AILE_BAS} cls="ac-aile--panneau" /></div>;
}

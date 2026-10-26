// Barre de lecture interactive (Nocturne-2), partagée par le mini-lecteur, la scène et « En écoute » :
//  - la piste fine s'épaissit au survol et une bulle donne le temps sous le pointeur (pointeur fin seulement) ;
//  - glisser suit le pointeur 1:1 (capture du pointeur, prise là où l'on a cliqué) et ne cherche qu'au RELÂCHEMENT
//    (aucun grésillement pendant le glisser) ; un simple clic cherche aussitôt ;
//  - clavier : ← → (5 s), Pg préc./Pg suiv. (30 s), Début, Fin ; l'élément natif <input type="range"> reste dessous
//    (nom, valeur, focus, lecteurs d'écran) ;
//  - la progression avance en linéaire au rythme des mesures (≈ 4 par seconde) ; un saut (recherche, morceau suivant)
//    est instantané ; aucun mouvement en mouvement réduit.
import { useRef, useState, type KeyboardEvent as KE, type PointerEvent as PE } from "react";
import "../styles/musique-lecteur.css";
import { duree, typo } from "../lib/format";
import * as L from "./lecteur";

export function BarreLecture({ l, compact, className }: { l: L.EtatLecteur; compact?: boolean; className?: string }) {
  const d = l.duree ?? l.info?.dureeS ?? null;
  const piste = useRef<HTMLDivElement>(null);
  const natif = useRef<HTMLInputElement>(null);
  const [glisse, setGlisse] = useState<number | null>(null);
  const [survol, setSurvol] = useState<{ x: number; t: number } | null>(null);
  const pos = Math.min(l.position, d ?? l.position);
  const v = glisse ?? pos;
  const frac = d ? Math.max(0, Math.min(1, v / d)) : 0;
  // Saut (recherche, autre morceau) : pas de glissement de la barre.
  const avant = useRef(pos);
  const saut = Math.abs(pos - avant.current) > 1.2;
  avant.current = pos;

  const lire = (x: number) => {
    const r = piste.current!.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (x - r.left) / Math.max(1, r.width)));
    return { t: f * (d ?? 0), x: f * r.width };
  };
  const bas = (e: PE<HTMLDivElement>) => {
    if (!d || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    natif.current?.focus({ preventScroll: true });
    setGlisse(lire(e.clientX).t);
  };
  const bouge = (e: PE<HTMLDivElement>) => {
    if (!d) return;
    const a = lire(e.clientX);
    if (glisse != null) setGlisse(a.t);
    if (e.pointerType === "mouse") setSurvol(a);
  };
  const haut = (e: PE<HTMLDivElement>) => {
    if (glisse == null) return;
    L.chercher(lire(e.clientX).t);
    setGlisse(null);
  };
  const clavier = (e: KE<HTMLInputElement>) => {
    if (!d) return;
    const pas: Record<string, number> = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 30, PageDown: -30 };
    let cible: number | null = null;
    if (e.key in pas) cible = pos + pas[e.key];
    else if (e.key === "Home") cible = 0;
    else if (e.key === "End") cible = Math.max(0, d - 0.5);
    if (cible == null) return;
    e.preventDefault();
    L.chercher(Math.max(0, Math.min(d, cible)));
  };
  return (
    <div className={`mu-temps${compact ? " mu-temps--compact" : ""}${className ? " " + className : ""}`}>
      <span className="mu-chiffre">{duree(v)}</span>
      <div className="mu-bl" ref={piste} data-glisse={glisse != null ? "" : undefined} data-saut={saut ? "" : undefined} data-inactif={!d ? "" : undefined}
        onPointerDown={bas} onPointerMove={bouge} onPointerUp={haut} onPointerCancel={() => setGlisse(null)} onPointerLeave={() => setSurvol(null)}>
        <span className="mu-bl-piste" aria-hidden="true"><i className="mu-bl-rempli" style={{ transform: `scaleX(${frac})` }} /></span>
        {/* Pouce : translation en unités du conteneur (100cqw = largeur de la piste), rien ne déborde. */}
        <span className="mu-bl-pouce" aria-hidden="true" style={{ transform: `translateX(calc(${frac.toFixed(4)} * 100cqw))` }} />
        {survol && glisse == null && d ? <span className="mu-bl-bulle" aria-hidden="true" style={{ transform: `translateX(${survol.x.toFixed(1)}px)` }}><span>{duree(survol.t)}</span></span> : null}
        <input ref={natif} type="range" className="mu-curseur mu-bl-natif" min={0} max={d ?? 0} step="any" value={d ? v : 0} disabled={!d} tabIndex={d ? 0 : -1}
          aria-label="Position dans le morceau" aria-valuetext={typo(`${duree(v)} sur ${duree(d)}`)} onKeyDown={clavier} onChange={() => {}} />
      </div>
      <span className="mu-chiffre">{duree(d)}</span>
    </div>
  );
}

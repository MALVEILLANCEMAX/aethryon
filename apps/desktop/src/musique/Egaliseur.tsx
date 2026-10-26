// Égaliseur discret (Nocturne-2) : quatre barres qui suivent le spectre RÉEL du morceau en cours (l'AnalyserNode du
// lecteur : graves, bas-médiums, médiums, aigus). UNE boucle pour tous les égaliseurs affichés, écrite dans le DOM
// (aucun rendu React par image). Jamais d'animation feinte : en pause, morceau non analysable (écoute Cloud), fenêtre
// cachée ou mouvement réduit, les barres sont immobiles ; l'état reste dit par la forme (barres hautes et or en
// lecture, trois points bas et ternes en pause).
import { useEffect, useRef } from "react";
import { mouvementReduit } from "../lib/mouvement";
import { analyseurAudio } from "./lecteur";

// Bandes en cases de fréquence (fftSize 512 : ≈ 86 à 94 Hz par case).
const BANDES: [number, number][] = [[1, 3], [3, 11], [11, 45], [45, 130]];
const abonnes = new Set<HTMLElement>();
const donnees = new Uint8Array(256);
const lisse = new Float32Array(4);
let raf = 0;

function image() {
  raf = 0;
  const an = analyseurAudio();
  if (!an || abonnes.size === 0 || document.hidden || mouvementReduit()) return;
  an.getByteFrequencyData(donnees);
  for (let b = 0; b < 4; b++) {
    const [a, z] = BANDES[b];
    let s = 0;
    for (let k = a; k < z; k++) s += donnees[k];
    const v = s / (z - a) / 255;
    lisse[b] = lisse[b] * 0.55 + v * 0.45;
  }
  for (const el of abonnes) {
    const barres = el.children;
    for (let b = 0; b < 4 && b < barres.length; b++) (barres[b] as HTMLElement).style.transform = `scaleY(${(0.16 + 0.84 * Math.min(1, lisse[b] * 1.3)).toFixed(3)})`;
  }
  raf = requestAnimationFrame(image);
}

function relancer() {
  if (!raf) raf = requestAnimationFrame(image);
}

/** `actif` : le morceau représenté est EN LECTURE (sinon barres au repos). */
export function Egaliseur({ actif, className }: { actif: boolean; className?: string }) {
  const boite = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = boite.current;
    if (!el || !actif) return;
    abonnes.add(el);
    relancer();
    const vis = () => { if (!document.hidden) relancer(); };
    document.addEventListener("visibilitychange", vis);
    return () => {
      abonnes.delete(el);
      document.removeEventListener("visibilitychange", vis);
      for (const b of Array.from(el.children)) (b as HTMLElement).style.transform = "";
    };
  }, [actif]);
  return (
    <span ref={boite} className={`mu-egaliseur${className ? " " + className : ""}`} data-actif={actif ? "" : undefined} aria-hidden="true">
      <i /><i /><i /><i />
    </span>
  );
}

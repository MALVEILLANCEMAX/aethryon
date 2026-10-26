// Visualisation audio sobre : une ligne d'horizon champagne faite du spectre RÉEL (AnalyserNode), dessinée sur un
// canvas, une fois par image, sans React (aucun rendu par image). Rien ne bouge quand rien ne joue : en pause, onglet
// caché, mouvement réduit (une ligne fixe), ou source sans signal analysable (écoute Cloud) : jamais d'animation feinte.
import { useEffect, useRef } from "react";
import { mouvementReduit } from "../lib/mouvement";
import { analyseurAudio, useLecteur } from "./lecteur";

export function Visualiseur({ hauteur = 48, barres = 48, className }: { hauteur?: number; barres?: number; className?: string }) {
  const toile = useRef<HTMLCanvasElement>(null);
  const l = useLecteur();
  const anime = l.enLecture && l.visualisable && !mouvementReduit();
  useEffect(() => {
    const c = toile.current;
    if (!c) return;
    const g = c.getContext("2d");
    if (!g) return;
    let raf = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const taille = () => { const r = c.getBoundingClientRect(); c.width = Math.max(1, Math.round(r.width * dpr)); c.height = Math.round(hauteur * dpr); };
    taille();
    const ro = new ResizeObserver(taille);
    ro.observe(c);
    const or = getComputedStyle(c).getPropertyValue("--ae-gold").trim() || "#d4af7c";
    const donnees = new Uint8Array(256);
    const lisse = new Float32Array(barres);
    const dessiner = (niveaux: Float32Array | null) => {
      const w = c.width, h = c.height, mid = h / 2;
      g.clearRect(0, 0, w, h);
      const pas = w / barres;
      const largeur = Math.max(1, pas * 0.42);
      g.fillStyle = or;
      for (let i = 0; i < barres; i++) {
        const v = niveaux ? niveaux[i] : 0;
        const a = Math.max(1 * dpr, v * (h * 0.46));
        // Plus lumineux au centre de la ligne, comme une source unique venue d'en haut.
        g.globalAlpha = 0.28 + 0.5 * (1 - Math.abs(i - barres / 2) / (barres / 2)) * (niveaux ? 1 : 0.4);
        const x = i * pas + (pas - largeur) / 2;
        g.beginPath();
        g.roundRect(x, mid - a, largeur, a * 2, largeur / 2);
        g.fill();
      }
      g.globalAlpha = 1;
    };
    const image = () => {
      const an = analyseurAudio();
      if (!an) { dessiner(null); return; }
      an.getByteFrequencyData(donnees);
      // Bandes logarithmiques (graves à gauche), lissage temporel doux.
      const n = Math.min(donnees.length, an.frequencyBinCount);
      for (let i = 0; i < barres; i++) {
        const a = Math.floor(Math.pow(i / barres, 1.6) * n * 0.82), b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / barres, 1.6) * n * 0.82));
        let s = 0;
        for (let k = a; k < b; k++) s += donnees[k];
        const v = s / (b - a) / 255;
        lisse[i] = lisse[i] * 0.6 + v * 0.4;
      }
      dessiner(lisse);
      raf = requestAnimationFrame(image);
    };
    if (anime) raf = requestAnimationFrame(image); else dessiner(null);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [anime, hauteur, barres]);
  return <canvas ref={toile} className={`mu-visu${className ? " " + className : ""}`} style={{ height: hauteur }} data-anime={anime ? "" : undefined} aria-hidden="true" />;
}

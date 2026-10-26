// Bulles d'aide (DESIGN-NOCTURNE.md §5) : verre sombre chaud, touche du raccourci ; après 500 ms de survol ou au focus
// clavier, apparition en fondu. Une fois une bulle ouverte, les voisines s'ouvrent SANS délai ni animation pendant
// 600 ms (la barre d'outils paraît plus rapide). Un seul écouteur pour toute l'application : tout élément portant
// `data-bulle` en reçoit une (« Importer dans Premiere (Ctrl I) » → texte + touche).
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface Bulle {
  texte: string;
  touche: string | null;
  x: number;
  y: number;
  dessous: boolean;
  /** Ouverte juste après une autre : sans délai ni animation. */
  instant: boolean;
}

/** Fenêtre pendant laquelle une bulle voisine s'ouvre aussitôt. */
const VOISINES_MS = 600;

export function separerTouche(libelle: string): [string, string | null] {
  const m = libelle.match(/^(.*?)\s*\(((?:Ctrl|Maj|Échap|Espace|Entrée|Alt)[^)]*|[←→])\)$/);
  return m ? [m[1], m[2]] : [libelle, null];
}

export function Bulles() {
  const [b, setB] = useState<Bulle | null>(null);
  useEffect(() => {
    let minuterie: number | undefined;
    let cible: HTMLElement | null = null;
    let derniere = 0;
    let ouverte = false;
    const montrer = (el: HTMLElement, instant = false) => {
      const r = el.getBoundingClientRect();
      const [texte, touche] = separerTouche(el.dataset.bulle ?? "");
      const dessous = r.top < 64;
      ouverte = true;
      setB({ texte, touche, x: r.left + r.width / 2, y: dessous ? r.bottom + 8 : r.top - 8, dessous, instant });
    };
    const cacher = () => {
      window.clearTimeout(minuterie);
      if (ouverte) derniere = performance.now();
      ouverte = false;
      cible = null;
      setB(null);
    };
    const survol = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-bulle]");
      if (el === cible) return;
      cacher();
      if (!el) return;
      cible = el;
      if (performance.now() - derniere < VOISINES_MS) { montrer(el, true); return; }
      minuterie = window.setTimeout(() => cible === el && el.isConnected && montrer(el), 500);
    };
    const focus = (e: FocusEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-bulle]");
      if (el && el.matches(":focus-visible")) {
        cible = el;
        minuterie = window.setTimeout(() => montrer(el), 500);
      }
    };
    document.addEventListener("pointerover", survol);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", cacher);
    document.addEventListener("pointerdown", cacher, true);
    document.addEventListener("keydown", cacher, true);
    window.addEventListener("scroll", cacher, true);
    return () => {
      document.removeEventListener("pointerover", survol);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", cacher);
      document.removeEventListener("pointerdown", cacher, true);
      document.removeEventListener("keydown", cacher, true);
      window.removeEventListener("scroll", cacher, true);
      window.clearTimeout(minuterie);
    };
  }, []);
  if (!b) return null;
  return createPortal(
    <div className={`bulle${b.dessous ? " bulle--dessous" : ""}`} data-instant={b.instant ? "" : undefined} style={{ left: b.x, top: b.y }} role="tooltip">
      <span className="tip">{b.texte}{b.touche && <span className="kbd">{b.touche}</span>}</span>
    </div>,
    document.body,
  );
}

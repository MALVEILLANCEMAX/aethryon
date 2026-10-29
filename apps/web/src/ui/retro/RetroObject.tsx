// Objet rétro décoratif (caché aux lecteurs d'écran). Le HTML pré-rendu montre l'affiche (image fixe du même
// rendu, public/media/retro/) ; quand l'objet approche de l'écran, le moteur WebGL (chargé à part : il ne pèse pas sur
// la page) prend le relais et l'anime quelques secondes, puis l'objet se pose (renderer.ts : plus aucune image au repos).
// Pause hors de l'écran et quand l'onglet est caché ; image fixe si le mouvement n'est pas complet (système ou réglage
// « Mouvement » du thème Égide, suivi en direct) ; sans WebGL, l'affiche reste ; objet masqué (display: none) : aucun
// moteur. Taille d'affichage par classe (jamais d'attribut style : CSP du site).
// Égide (2026-10-28) : les objets reviennent à la demande du propriétaire, avec les mêmes règles qu'en V3.5.
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn.ts";
import { useMouvementComplet } from "../../lib/mouvement.ts";
import type { RetroKind } from "./objects.ts";
import type { RetroRenderer } from "./renderer.ts";

/** Instant de l'image fixe : le meilleur angle de chaque objet (affiche, mouvement réduit). */
export const STILL_T: Record<RetroKind, number> = { cube: 1.2, disquette: 1.1, disque: 0.9, sablier: 1.5, cookie: 1.4 };

const SIZES = {
  xs: "w-[76px] sm:w-[88px]",
  sm: "w-[132px] sm:w-[156px]",
  md: "w-[176px] sm:w-[220px]",
  lg: "w-[220px] sm:w-[300px]",
  /** Largeur donnée par la classe de l'emplacement (accueil Égide). */
  libre: "",
} as const;

/** Commandes d'un objet vivant (V3.5 : le cookie bondit quand on accepte). Sans WebGL ou sans mouvement : rien. */
export interface RetroHandle { bounce(): void }

/**
 * `follow` : l'objet se tourne un peu vers le pointeur (souris seulement, mouvement complet), amorti par le moteur.
 * `handle` : reçoit les commandes de l'objet une fois le moteur prêt et animé (null avant, et après le démontage).
 */
export function RetroObject({ kind, label, size = "md", className, follow = false, handle }: { kind: RetroKind; label?: string; size?: keyof typeof SIZES; className?: string; follow?: boolean; handle?: (h: RetroHandle | null) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [renderer, setRenderer] = useState<RetroRenderer | null>(null);
  const anime = useMouvementComplet();

  // Moteur : créé une fois, quand l'objet approche de l'écran (un objet masqué n'en a jamais).
  useEffect(() => {
    const box = wrap.current, el = canvasRef.current;
    if (!box || !el) return;
    let disposed = false;
    let r: RetroRenderer | null = null;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      void (async () => {
        const [{ RetroRenderer }, { buildObject }] = await Promise.all([import("./renderer.ts"), import("./objects.ts")]);
        if (disposed) return;
        const css = box.clientWidth || 200;
        const scale = css >= 260 ? 3 : 2;
        el.width = el.height = Math.max(48, Math.round(css / scale));
        try {
          r = new RetroRenderer(el, buildObject(kind, label));
        } catch {
          return; // pas de WebGL : l'affiche reste
        }
        r.still(STILL_T[kind]);
        r.setRest(STILL_T[kind]);
        setRenderer(r);
      })();
    }, { rootMargin: "200px 0px" });
    io.observe(box);
    return () => {
      disposed = true;
      io.disconnect();
      r?.dispose();
      setRenderer(null);
    };
  }, [kind, label]);

  // Lecture : à l'écran, onglet affiché et mouvement complet ; sinon l'image fixe.
  useEffect(() => {
    const box = wrap.current;
    if (!renderer || !box) return;
    if (!anime) {
      renderer.stop();
      renderer.still(STILL_T[kind]);
      return;
    }
    let visible = false;
    const sync = () => {
      if (visible && !document.hidden) renderer.start(); else renderer.stop();
    };
    // Direction du pointeur depuis le centre de l'objet, rapportée à la demi-largeur de l'écran (−1 → 1).
    const aim = (e: PointerEvent) => {
      if (!visible || e.pointerType !== "mouse") return;
      const r = box.getBoundingClientRect();
      renderer.setTilt((e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2), (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2));
    };
    handle?.({ bounce: () => { renderer.bounce(); renderer.start(); } });
    const io = new IntersectionObserver((entries) => { visible = entries.some((e) => e.isIntersecting); sync(); }, { rootMargin: "120px 0px" });
    io.observe(box);
    document.addEventListener("visibilitychange", sync);
    const suivre = follow && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (suivre) window.addEventListener("pointermove", aim, { passive: true });
    return () => {
      handle?.(null);
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      if (suivre) window.removeEventListener("pointermove", aim);
      renderer.stop();
    };
  }, [renderer, anime, kind, follow]);

  return (
    <div ref={wrap} aria-hidden="true" className={cn("retro-object", SIZES[size], className)} data-retro={kind} data-live={renderer ? "" : undefined}>
      <img src={`/media/retro/${kind}.png`} alt="" width={300} height={300} className="retro-poster" decoding="async" loading="lazy" />
      <canvas ref={canvasRef} className="retro-canvas" />
    </div>
  );
}

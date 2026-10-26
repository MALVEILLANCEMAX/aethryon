// Objet rétro décoratif (caché aux lecteurs d'écran). Le HTML pré-rendu montre l'affiche (image fixe du même
// rendu, public/media/retro/) ; au chargement, le moteur WebGL (chargé à part : il ne pèse pas sur la page) prend
// le relais et anime l'objet. Pause hors de l'écran et quand l'onglet est caché ; image fixe en mouvement réduit ;
// sans WebGL, l'affiche reste. Taille d'affichage par classe (jamais d'attribut style : CSP du site).
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn.ts";
import { useCalm } from "../../lib/hooks.ts";
import type { RetroKind } from "./objects.ts";

/** Instant de l'image fixe : le meilleur angle de chaque objet (affiche, mouvement réduit). */
export const STILL_T: Record<RetroKind, number> = { cube: 1.2, disquette: 1.1, disque: 0.9, sablier: 1.5, cookie: 1.4 };

const SIZES = {
  xs: "w-[76px] sm:w-[88px]",
  sm: "w-[132px] sm:w-[156px]",
  md: "w-[176px] sm:w-[220px]",
  lg: "w-[220px] sm:w-[300px]",
} as const;

/** Commandes d'un objet vivant (V3.5 : le cookie bondit quand on accepte). Sans WebGL ou en mouvement réduit : rien. */
export interface RetroHandle { bounce(): void }

/**
 * `follow` : l'objet se tourne un peu vers le pointeur (souris seulement, hors mouvement réduit), amorti par le moteur.
 * `handle` : reçoit les commandes de l'objet une fois le moteur prêt (null avant, et après le démontage).
 */
export function RetroObject({ kind, label, size = "md", className, follow = false, handle }: { kind: RetroKind; label?: string; size?: keyof typeof SIZES; className?: string; follow?: boolean; handle?: (h: RetroHandle | null) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);
  const calm = useCalm();

  useEffect(() => {
    const box = wrap.current, el = canvasRef.current;
    if (!box || !el) return;
    let disposed = false;
    let renderer: import("./renderer.ts").RetroRenderer | null = null;
    let io: IntersectionObserver | null = null;
    let visible = false;
    const sync = () => {
      if (!renderer || calm) return;
      if (visible && !document.hidden) renderer.start(); else renderer.stop();
    };
    // Direction du pointeur depuis le centre de l'objet, rapportée à la demi-largeur de l'écran (−1 → 1).
    const aim = (e: PointerEvent) => {
      if (!renderer || !visible || e.pointerType !== "mouse") return;
      const r = box.getBoundingClientRect();
      renderer.setTilt((e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2), (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2));
    };
    void (async () => {
      const [{ RetroRenderer }, { buildObject }] = await Promise.all([import("./renderer.ts"), import("./objects.ts")]);
      if (disposed) return;
      const css = box.clientWidth || 200;
      const scale = css >= 260 ? 3 : 2;
      el.width = el.height = Math.max(48, Math.round(css / scale));
      try {
        renderer = new RetroRenderer(el, buildObject(kind, label));
      } catch {
        return; // pas de WebGL : l'affiche reste
      }
      renderer.still(STILL_T[kind]);
      setLive(true);
      if (calm) return;
      const r = renderer;
      handle?.({ bounce: () => { r.bounce(); r.start(); } });
      io = new IntersectionObserver((entries) => { visible = entries.some((e) => e.isIntersecting); sync(); }, { rootMargin: "120px 0px" });
      io.observe(box);
      document.addEventListener("visibilitychange", sync);
      if (follow && window.matchMedia("(hover: hover) and (pointer: fine)").matches) window.addEventListener("pointermove", aim, { passive: true });
    })();
    return () => {
      disposed = true;
      handle?.(null);
      io?.disconnect();
      window.removeEventListener("pointermove", aim);
      document.removeEventListener("visibilitychange", sync);
      renderer?.dispose();
    };
  }, [kind, label, calm, follow]);

  return (
    <div ref={wrap} aria-hidden="true" className={cn("retro-object", SIZES[size], className)} data-retro={kind} data-live={live ? "" : undefined}>
      <img src={`/media/retro/${kind}.png`} alt="" width={300} height={300} className="retro-poster" decoding="async" loading="lazy" />
      <canvas ref={canvasRef} className="retro-canvas" />
    </div>
  );
}

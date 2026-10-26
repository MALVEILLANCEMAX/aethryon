// Relief au survol (docs/DESIGN.md §6) : la carte s'incline de 2,5° au plus vers le pointeur et un reflet champagne
// suit la souris. Variables CSS (--rx, --ry, --mx, --my) posées par le CSSOM après le démarrage (aucun attribut style
// dans le HTML pré-rendu, CSP) ; seulement avec un pointeur fin et hors mouvement réduit.
import { useEffect, type RefObject } from "react";

export function useTilt(ref: RefObject<HTMLElement | null>, max = 2.5): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    let last: PointerEvent | null = null;
    const apply = () => {
      raf = 0;
      if (!last) return;
      const r = el.getBoundingClientRect();
      const x = (last.clientX - r.left) / r.width;   // 0 → 1
      const y = (last.clientY - r.top) / r.height;
      el.style.setProperty("--ry", `${((x - 0.5) * 2 * max).toFixed(2)}deg`);
      el.style.setProperty("--rx", `${((0.5 - y) * 2 * max).toFixed(2)}deg`);
      el.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
      el.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
    };
    const move = (e: PointerEvent) => {
      if (!fine.matches || calm.matches || e.pointerType !== "mouse") return;
      last = e;
      el.dataset.tilt = "";
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const leave = () => {
      last = null;
      delete el.dataset.tilt;
      for (const v of ["--rx", "--ry"]) el.style.setProperty(v, "0deg");
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerleave", leave); if (raf) cancelAnimationFrame(raf); };
  }, [ref, max]);
}

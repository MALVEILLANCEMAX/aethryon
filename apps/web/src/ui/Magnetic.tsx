// Aimant discret (docs/DESIGN.md §6) : l'élément suit le pointeur de quelques pixels quand on l'approche, puis
// revient en ressort. Seulement avec un pointeur fin qui survole (souris, pavé) et hors mouvement réduit ; au
// toucher et au pré-rendu, rien ne bouge. Transform uniquement, posé par motion APRÈS le démarrage : le premier
// rendu est identique au HTML pré-rendu (aucun attribut style, CSP).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useMotionValue, useSpring } from "motion/react";
import { cn } from "../lib/cn.ts";
import { useCalm } from "../lib/hooks.ts";

/** Pointeur fin qui survole : la seule situation où un effet de survol a un sens. */
export function useFinePointer(): boolean {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => setFine(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return fine;
}

export function Magnetic({ children, strength = 6, className }: { children: ReactNode; strength?: number; className?: string }) {
  const calm = useCalm();
  const fine = useFinePointer();
  const ref = useRef<HTMLSpanElement>(null);
  const x = useSpring(useMotionValue(0), { stiffness: 320, damping: 22, mass: 0.6 });
  const y = useSpring(useMotionValue(0), { stiffness: 320, damping: 22, mass: 0.6 });
  const on = fine && !calm;
  return (
    <motion.span
      ref={ref}
      className={cn("inline-flex", className)}
      style={on ? { x, y } : undefined}
      onPointerMove={on ? (e) => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        // -1 → 1 sur chaque axe depuis le centre : déplacement borné à `strength` px.
        x.set(((e.clientX - r.left) / r.width - 0.5) * 2 * strength);
        y.set(((e.clientY - r.top) / r.height - 0.5) * 2 * strength * 0.6);
      } : undefined}
      onPointerLeave={on ? () => { x.set(0); y.set(0); } : undefined}
    >
      {children}
    </motion.span>
  );
}

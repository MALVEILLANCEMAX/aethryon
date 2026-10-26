// Icônes qui se transforment d'un état à l'autre (principe « Icon morph » d'Arc UI, MIT, réécrit pour AETHRYON :
// trait 1,6, nos ressorts, aucune balise <style>, aucun flou). Le changement d'état s'explique de lui-même ; les
// ressorts sont interruptibles (un double toucher revient en arrière sans saut). Mouvement réduit : simple fondu.
// Décoratives : le bouton qui les porte garde son nom accessible (aria-label, aria-expanded…).
// Pré-rendu : à l'état de repos, rien ne dépend d'un style posé par JavaScript (la coche n'existe pas encore).
// Origine des transformations : le centre de chaque forme (défaut de motion pour le SVG).
import { AnimatePresence, motion } from "motion/react";
import { useCalm } from "../lib/hooks.ts";
import { DUR, EASE, SPRING } from "../lib/motion.ts";

const svg = (size: number) => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const,
});

/** Copie → coche : la feuille de devant s'efface sous celle de derrière, puis la coche se dessine. */
export function CopyCheckIcon({ done, size = 18, className }: { done: boolean; size?: number; className?: string }) {
  const calm = useCalm();
  const t = calm ? { duration: DUR.calm } : SPRING.snappy;
  return (
    <svg {...svg(size)} className={className}>
      <motion.g initial={false} animate={done ? { opacity: 0, scale: 0.6 } : { opacity: 1, scale: 1 }} transition={t}>
        <rect x="8" y="8" width="12" height="12" rx="2.5" />
        <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
      </motion.g>
      <AnimatePresence initial={false}>
        {done && (
          <motion.path
            key="check"
            d="M5 12.5l4.5 4.5L19 7.5"
            initial={calm ? { opacity: 0 } : { pathLength: 0, opacity: 1 }}
            animate={calm ? { opacity: 1 } : { pathLength: 1, opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: DUR.exit, ease: EASE.exit } }}
            transition={calm ? { duration: DUR.calm } : { duration: DUR.component, ease: EASE.soft, delay: 0.06 }}
          />
        )}
      </AnimatePresence>
    </svg>
  );
}

/** Menu ↔ fermer : les traits du haut et du bas pivotent jusqu'à former la croix, celui du milieu s'efface. */
export function MenuIcon({ open, size = 20, className }: { open: boolean; size?: number; className?: string }) {
  const calm = useCalm();
  const t = calm ? { duration: 0 } : SPRING.snappy;
  return (
    <svg {...svg(size)} className={className}>
      <motion.path d="M4 7h16" initial={false} animate={open ? { y: 5, rotate: 45 } : { y: 0, rotate: 0 }} transition={t} />
      <motion.path d="M4 12h16" initial={false} animate={{ opacity: open ? 0 : 1 }} transition={calm ? { duration: 0 } : { duration: DUR.exit }} />
      <motion.path d="M4 17h16" initial={false} animate={open ? { y: -5, rotate: -45 } : { y: 0, rotate: 0 }} transition={t} />
    </svg>
  );
}

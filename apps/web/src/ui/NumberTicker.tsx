// Compteur animé (technique Number Ticker de Magic UI, MIT) : un ressort pilote textContent, sans
// re-rendu React. Valeurs RÉELLES uniquement. Sans animation si l'utilisateur la refuse.
// - from="zero" (défaut) : compte depuis 0 à la première apparition (chiffres d'un tableau de bord).
// - from="previous" (principe « Animated counter » d'Arc UI) : affiche d'emblée la valeur, puis roule de
//   l'ANCIENNE valeur vers la nouvelle à chaque changement (quota mis à jour en direct).
// Lecteurs d'écran : la valeur finale est en sr-only, les chiffres qui roulent sont masqués.
import { useEffect, useRef } from "react";
import { useInView, useMotionValue, useReducedMotion, useSpring } from "motion/react";

const nf = new Intl.NumberFormat("fr-FR");

export function NumberTicker({ value, className, from = "zero" }: { value: number; className?: string; from?: "zero" | "previous" }) {
  const ref = useRef<HTMLSpanElement>(null);
  const calm = useReducedMotion();
  const start = calm || from === "previous" ? value : 0;
  const mv = useMotionValue(start);
  // « previous » : ressort sans dépassement (un compteur d'état ne doit jamais afficher une valeur fausse).
  const spring = useSpring(mv, from === "previous" ? { stiffness: 280, damping: 32, mass: 0.9 } : { damping: 40, stiffness: 140 });
  const inView = useInView(ref, { once: true, margin: "0px" });
  useEffect(() => {
    if (calm) { mv.jump(value); return; }
    if (inView || from === "previous") mv.set(value);
  }, [inView, value, mv, calm, from]);
  useEffect(() => spring.on("change", (v) => { if (ref.current) ref.current.textContent = nf.format(Math.round(v)); }), [spring]);
  return (
    <span className={className}>
      <span className="sr-only">{nf.format(value)}</span>
      <span ref={ref} aria-hidden className="tabular">{nf.format(start)}</span>
    </span>
  );
}

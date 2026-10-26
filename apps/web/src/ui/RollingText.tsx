// Texte dont les chiffres tournent comme un compteur mécanique (prix des offres, quota, caractères restants) : chaque
// chiffre est une ROUE (0 à 9 empilés) qui tourne jusqu'à sa nouvelle valeur en passant par les chiffres
// intermédiaires, à la manière de NumberFlow. Les positions sont comptées depuis la droite (une colonne garde son rôle
// quand la longueur change) ; les roues partent l'une après l'autre, de droite à gauche. La rotation est une
// transition CSS sur transform (compositeur) ; la position d'une roue est un attribut (data-d) lu par une règle
// prédéclarée (premium.css) : le HTML pré-rendu montre déjà le bon chiffre, sans attribut style (CSP). Une colonne qui
// apparaît s'ouvre en largeur et sa roue part de 0 ; une colonne qui disparaît se referme (Motion, sans
// `mode="popLayout"`, qui injecterait une balise <style>). Fondu en haut et en bas de la fenêtre (masque).
// Lecteurs d'écran : la valeur entière, une fois (`silent` : le parent la donne déjà). Mouvement réduit : immédiat.
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { cn } from "../lib/cn.ts";
import { useCalm } from "../lib/hooks.ts";
import { EASE } from "../lib/motion.ts";

// Roue bouclée : un 9 au-dessus du 0 et un 0 sous le 9, pour que le léger dépassement du ressort montre le chiffre
// voisin (comme une vraie roue) et jamais du vide.
const DIGITS = ["9", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

/** Une roue : affichée d'emblée sur son chiffre ; une roue NOUVELLE part de 0 puis tourne jusqu'à lui. */
function Wheel({ digit, place, fresh }: { digit: string; place: number; fresh: boolean }) {
  const [kick, setKick] = useState(fresh);
  useEffect(() => {
    if (!kick) return;
    // Deux images : la roue est d'abord peinte sur 0, puis la transition l'amène à son chiffre.
    let f = requestAnimationFrame(() => { f = requestAnimationFrame(() => setKick(false)); });
    return () => cancelAnimationFrame(f);
  }, [kick]);
  return (
    <span className="roll-col" data-place={Math.min(place, 6)}>
      <span className="roll-ghost">0</span>
      <span className="roll-wheel" data-d={kick ? "0" : digit}>
        {DIGITS.map((n, i) => <span key={i}>{n}</span>)}
      </span>
    </span>
  );
}

export function RollingText({ value, className, label, silent = false }: { value: string; className?: string; label?: string; silent?: boolean }) {
  const calm = useCalm();
  // Colonnes présentes au premier rendu : pas d'entrée animée (ni au chargement, ni dans le HTML pré-rendu).
  const [first] = useState(() => new Set(Array.from(value).map((_, i, a) => a.length - 1 - i)));
  const chars = Array.from(value);
  const open = calm ? { duration: 0 } : { duration: 0.42, ease: EASE.soft };
  return (
    <span className={cn("roll", className)}>
      {!silent && <span className="sr-only">{label ?? value}</span>}
      <span aria-hidden="true" className="roll-track">
        <AnimatePresence initial={false}>
          {chars.map((ch, i) => {
            const place = chars.length - 1 - i; // clé stable : position depuis la droite
            const digit = /[0-9]/.test(ch);
            const key = digit ? `d${place}` : `s${place}-${ch}`;
            return (
              <motion.span key={key} className="roll-slot" initial={{ width: 0, opacity: 0 }} animate={{ width: "auto", opacity: 1 }}
                exit={{ width: 0, opacity: 0 }} transition={open}>
                {digit ? <Wheel digit={ch} place={place} fresh={!first.has(place)} /> : <span className="roll-sep">{ch}</span>}
              </motion.span>
            );
          })}
        </AnimatePresence>
      </span>
    </span>
  );
}

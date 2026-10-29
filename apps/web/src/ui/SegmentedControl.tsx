// Contrôle segmenté (MP3 / MP4, choix d'un navigateur…) : pastille qui glisse (layoutId, ressort « glide »).
// Deux sémantiques, un seul composant (principes du « Segmented control » d'Arc UI, MIT, réécrits) :
// - « radio » (défaut) : choix de formulaire. role="radiogroup", UNE tabulation, flèches + Début/Fin ; le focus
//   SUIT la valeur choisie (avant : la valeur changeait mais le focus restait sur l'ancien bouton).
// - « toggle » : changement de vue (ex. guide d'installation par navigateur). role="group", boutons aria-pressed,
//   chacun atteignable par Tab ; les flèches restent disponibles et déplacent aussi le focus.
// Clavier : la pastille saute (pas de glissement) pour suivre une action répétée ; elle glisse au pointeur.
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "../lib/cn.ts";
import { useCalm } from "../lib/hooks.ts";
import { SPRING } from "../lib/motion.ts";

/** `icon` : pictogramme décoratif avant le libellé (aria-hidden chez l'appelant). */
interface Option<T extends string> { value: T; label: string; hint?: string; icon?: ReactNode }
interface Props<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
  size?: "md" | "sm";
  semantics?: "radio" | "toggle";
  /** Conservé pour compatibilité : Égide n'a qu'une forme de segments (le thème du document). */
  tone?: "light" | "night";
  /** Occupe toute la largeur disponible, options de même largeur (cartes étroites, jusqu'à 320 px). */
  fill?: boolean;
}

export function SegmentedControl<T extends string>({ options, value, onChange, label, className, size = "md", semantics = "radio", tone = "light", fill = false }: Props<T>) {
  const group = useId();
  const calm = useCalm();
  const refs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});
  const [viaKeys, setViaKeys] = useState(false);
  const radio = semantics === "radio";

  const go = (next: T) => {
    setViaKeys(true);
    onChange(next);
    refs.current[next]?.focus({ preventScroll: true });
  };
  const onKey = (e: KeyboardEvent) => {
    const i = options.findIndex((o) => o.value === value);
    const at = (k: number) => options[(k + options.length) % options.length]!.value;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); go(at(i + 1)); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); go(at(i - 1)); }
    else if (e.key === "Home") { e.preventDefault(); go(options[0]!.value); }
    else if (e.key === "End") { e.preventDefault(); go(options[options.length - 1]!.value); }
  };

  return (
    <div role={radio ? "radiogroup" : "group"} aria-label={label} onKeyDown={onKey} onPointerDown={() => setViaKeys(false)}
      className={cn(fill ? "flex w-full" : "inline-flex max-w-full", "rounded-control border border-control bg-sunken p-0.5", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => { refs.current[o.value] = el; }}
            type="button"
            {...(radio ? { role: "radio", "aria-checked": active, tabIndex: active ? 0 : -1 } : { "aria-pressed": active })}
            onClick={() => onChange(o.value)}
            className={cn("relative rounded-[calc(var(--eg-r-control)-2px)] font-semibold transition-colors",
              fill ? "min-w-0 flex-1 px-2" : "shrink-0",
              size === "md" ? (fill ? "h-11 text-ui sm:text-ui" : "h-11 min-w-[72px] px-3 text-ui sm:min-w-[96px] sm:px-4") : fill ? "h-9 text-sm" : "h-9 min-w-[72px] px-3 text-sm",
              active ? "text-fg" : "text-fg-2 hover:text-fg")}
          >
            {active && (
              <motion.span layoutId={`seg-${group}`} className="absolute inset-0 rounded-[inherit] bg-raised shadow-[0_0_0_1px_var(--eg-c-line-strong)]"
                transition={calm || viaKeys ? { duration: 0 } : SPRING.glide} />
            )}
            <span className={cn("relative", o.icon && "inline-flex items-center justify-center gap-1.5")}>{o.icon}{o.label}</span>
            {o.hint && <span className="relative ml-1.5 text-xs font-medium opacity-75">{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

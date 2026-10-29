// Boîte de dialogue : <dialog> natif (focus piégé, Échap, élément inerte derrière) + entrée Motion.
// Concept « Animated Modal » d'Aceternity, réécrit sans flou animé (coûteux sur iPhone).
import { useEffect, useId, useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "../lib/cn.ts";
import { useCalm } from "../lib/hooks.ts";
import { DUR, EASE, SPRING } from "../lib/motion.ts";
import { IconClose } from "./Icon.tsx";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  dismissible?: boolean; // false : ni Échap ni clic extérieur (ex. jeton non encore copié)
  className?: string;
  /** Illustration au-dessus du titre (ex. coche de réussite) ; avec `centered`, titre et texte centrés. */
  hero?: ReactNode;
  centered?: boolean;
  /** 760 px au lieu de 520 (aide des raccourcis en deux colonnes) : la boîte entière reste centrée et dans l'écran. */
  wide?: boolean;
}

export function Dialog({ open, onClose, title, description, children, footer, dismissible = true, className, hero, centered = false, wide = false }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();
  const calm = useCalm();
  useEffect(() => {
    const d = ref.current;
    if (d && open && !d.open) {
      opener.current = document.activeElement;
      d.showModal();
    }
  }, [open]);
  /** Fin de la sortie : fermeture réelle du <dialog>, focus rendu au déclencheur. */
  const closed = () => {
    const d = ref.current;
    if (d?.open && !open) {
      d.close();
      (opener.current as HTMLElement | null)?.focus?.();
    }
  };
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); if (dismissible) onClose(); }}
      onClick={(e) => { if (dismissible && e.target === ref.current) onClose(); }}
      className={cn("m-auto max-h-[calc(100dvh-32px)] overflow-visible bg-transparent p-0 text-ink backdrop:bg-[var(--eg-scrim)]",
        wide ? "w-[min(760px,calc(100vw-24px))]" : "w-[min(520px,calc(100vw-24px))]")}
    >
      <AnimatePresence onExitComplete={closed}>
      {open && (
        <motion.div
          key="panel"
          initial={calm ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={calm ? { opacity: 0, transition: { duration: DUR.calm } } : { opacity: 0, y: 8, scale: 0.98, transition: { duration: DUR.exit, ease: EASE.exit } }}
          transition={calm ? { duration: DUR.calm } : SPRING.soft}
          className={cn("max-h-[calc(100dvh-32px)] overflow-y-auto rounded-panel border border-line bg-ivory p-6 shadow-raised sm:p-8", className)}
        >
          <div className={cn("flex items-start gap-4", centered && "relative justify-center text-center")}>
            <div className="min-w-0 flex-1">
              {hero && <div className={cn("mb-4", centered && "flex justify-center")}>{hero}</div>}
              <h2 id={titleId} className="font-display text-titre-m leading-tight tracking-[-0.01em]">{title}</h2>
              {description && <div className="mt-2 text-ui leading-relaxed text-ink-soft">{description}</div>}
            </div>
            {dismissible && (
              <button type="button" onClick={onClose} aria-label="Fermer" className={cn("-mr-2 -mt-1 grid size-10 place-items-center rounded-full text-muted transition-colors hover:bg-sand/60 hover:text-ink", centered && "absolute right-0 top-0")}>
                <IconClose size={18} />
              </button>
            )}
          </div>
          {children && <div className="mt-5">{children}</div>}
          {footer && <div className={cn("mt-6 flex flex-col-reverse gap-2 sm:flex-row", centered ? "sm:justify-center" : "sm:justify-end")}>{footer}</div>}
        </motion.div>
      )}
      </AnimatePresence>
    </dialog>
  );
}

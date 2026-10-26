// Code à 6 chiffres (inscription par e-mail) : six grandes cases, mais UN SEUL vrai champ, transparent, posé sur elles —
// comme les meilleures saisies de code : le collage d'un code entier (« 482 913 » compris), le remplissage automatique
// (autocomplete="one-time-code" : iOS le propose depuis Mail), les gestionnaires de mots de passe, le clavier
// numérique sur téléphone et les lecteurs d'écran (un champ nommé, pas six) marchent sans rien de particulier.
// États : saisie (case courante soulignée d'or, curseur qui clignote), vérification (cases qui respirent), erreur
// (secousse, bord rouge), réussite (cases dorées, coche). Mouvement réduit : aucune secousse ni pulsation.
import { useEffect, useRef, type ReactNode } from "react";
import { animate, motion, useMotionValue, AnimatePresence, type AnimationPlaybackControls } from "motion/react";
import { cn } from "../lib/cn.ts";
import { useCalm } from "../lib/hooks.ts";
import { SPRING } from "../lib/motion.ts";

export type CodeStatus = "idle" | "verifying" | "error" | "success";

export function CodeInput({ id, value, onChange, onComplete, status, length = 6, label, describedBy, autoFocus, disabled, after }: {
  id: string; value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; status: CodeStatus;
  length?: number; label: string; describedBy?: string; autoFocus?: boolean; disabled?: boolean; after?: ReactNode;
}) {
  const calm = useCalm();
  const input = useRef<HTMLInputElement>(null);
  const shake = useMotionValue(0);
  const shaking = useRef<AnimationPlaybackControls | null>(null);
  const prevStatus = useRef(status);
  useEffect(() => {
    if (status === "error" && prevStatus.current !== "error" && !calm) {
      shaking.current?.stop();
      shaking.current = animate(shake, 0, { type: "spring", velocity: -260, stiffness: 900, damping: 14, restDelta: 0.1 });
    }
    prevStatus.current = status;
  }, [status, calm, shake]);

  const set = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, "").slice(0, length);
    onChange(digits);
    if (digits.length === length && digits !== value) onComplete?.(digits);
  };
  // Le curseur reste en fin de saisie : on corrige en effaçant, comme sur un téléphone.
  const keepEnd = () => { const el = input.current; if (el && el.selectionStart !== el.value.length) el.setSelectionRange(el.value.length, el.value.length); };
  const active = Math.min(value.length, length - 1);
  const busy = status === "verifying" || status === "success";

  return (
    <motion.div className={cn("otp", `is-${status}`)} style={{ x: shake }} data-code={status}>
      <input
        ref={input} id={id} className="otp-input" value={value} onChange={(e) => set(e.target.value)} onSelect={keepEnd} onFocus={keepEnd}
        inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" maxLength={length + 2} enterKeyHint="go"
        aria-label={label} aria-describedby={describedBy} aria-invalid={status === "error" || undefined} aria-busy={status === "verifying" || undefined}
        autoFocus={autoFocus} disabled={disabled || busy} spellCheck={false} autoCorrect="off"
      />
      <div className="otp-cells" aria-hidden="true">
        {Array.from({ length }, (_, i) => {
          const ch = value[i];
          return (
            <span key={i} className={cn("otp-cell", ch && "is-filled", i === active && !busy && "is-active", i === Math.floor(length / 2) && "is-gap")}>
              <AnimatePresence initial={false}>
                {ch && (
                  <motion.span key={ch + i} className="otp-digit" initial={calm ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.85 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.08 } }} transition={calm ? { duration: 0.1 } : SPRING.snappy}>
                    {ch}
                  </motion.span>
                )}
              </AnimatePresence>
              {i === active && !ch && !busy && <span className="otp-caret" />}
            </span>
          );
        })}
      </div>
      {after}
    </motion.div>
  );
}

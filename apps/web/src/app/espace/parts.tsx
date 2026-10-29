// Petits éléments de l'espace personnel : repère d'étape, unités du quota, dates relatives à venir.
import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "../../lib/cn.ts";
import { DUR } from "../../lib/motion.ts";
import type { StepState } from "../../lib/onboarding.ts";
import { IconCheck } from "../../ui/Icon.tsx";

/** Repère d'une étape : or coché si faite, obsidienne si en cours, ivoire si à venir. */
export function StepMarker({ state, n, small = false, label, className }: { state: StepState; n: number; small?: boolean; label?: string; className?: string }) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        "grid shrink-0 place-items-center rounded-full border font-semibold transition-[background-color,border-color,color] duration-300 [font-variant-numeric:lining-nums]",
        small ? "size-7 text-note" : "size-9 text-ui",
        state === "done" ? "border-gold bg-gold text-on-accent" : state === "current" ? "border-thread bg-surface text-fg" : "border-line-strong bg-ivory text-muted",
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span aria-hidden key={state === "done" ? "fait" : "numero"} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ duration: DUR.micro }}>
          {state === "done" ? <IconCheck size={small ? 15 : 17} strokeWidth={2.2} /> : n}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/**
 * Unités du quota du jour : une capsule par conversion (jusqu'à 30), sinon une barre continue.
 * Décoratif : les nombres sont toujours écrits à côté.
 */
export function Pips({ used, total, className }: { used: number; total: number; className?: string }) {
  const n = Math.max(0, total);
  // Mise à jour en direct : les pastilles se remplissent une à une (40 ms d'écart) depuis l'ancienne valeur ; à la
  // remise à zéro, elles se vident de droite à gauche.
  const before = useRef(used);
  const from = before.current;
  useEffect(() => { before.current = used; }, [used]);
  if (n > 0 && n <= 30) {
    return (
      <span aria-hidden className={cn("flex gap-1", className)} data-pips={n}>
        {Array.from({ length: n }, (_, i) => (
          <span key={i}
            style={i >= Math.min(from, used) && i < Math.max(from, used) ? { transitionDelay: `${(used > from ? i - from : from - 1 - i) * 40}ms` } : undefined}
            className={cn("h-2 min-w-0 flex-1 rounded-full transition-colors duration-340 motion-reduce:transition-none", i < used ? "bg-sunken" : "bg-sand ring-1 ring-inset ring-line-strong/60")} />
        ))}
      </span>
    );
  }
  const ratio = n > 0 ? Math.min(1, used / n) : 0;
  return (
    <span aria-hidden className={cn("block h-2 overflow-hidden rounded-full bg-sand", className)}>
      <span className="block h-full origin-left rounded-full bg-sunken transition-transform duration-700 ease-[var(--ease-soft)]" style={{ transform: `scaleX(${ratio})` }} />
    </span>
  );
}

const NB = " ";

/** « dans 25 min », « dans 6 h 05 » ; null si l'instant est passé ou illisible. */
export function fmtUntil(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const min = Math.max(1, Math.ceil(ms / 60_000));
  if (min < 60) return `dans ${min}${NB}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `dans ${h}${NB}h${m ? `${NB}${String(m).padStart(2, "0")}` : ""}`;
}

const parisDayFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long" });
/** Jour du quota (heure de Paris, comme le serveur), ex. « samedi 11 octobre ». */
export const parisToday = (now = new Date()) => parisDayFmt.format(now);

export const PLATFORM_NAME: Record<string, string> = { youtube: "YouTube", tiktok: "TikTok", x: "X", twitter: "X" };

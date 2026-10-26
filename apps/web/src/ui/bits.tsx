// Petits éléments partagés : pastille d'état, badge, squelette, carte, champ texte.
import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn.ts";

/** Pastille d'état. Seul « busy » (une VRAIE conversion suivie en direct) pulse ; « ok » reste immobile :
 *  aucun mouvement perpétuel décoratif (règle du système de mouvement). */
export function StatusDot({ tone }: { tone: "ok" | "warn" | "bad" | "muted" | "busy" }) {
  const c = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", muted: "bg-beige", busy: "bg-gold" }[tone];
  return (
    <span aria-hidden className={cn("relative inline-flex size-2 rounded-full", c)}>
      {tone === "busy" && <span className="absolute -inset-0.5 animate-ping rounded-full bg-gold/50 motion-reduce:hidden" />}
    </span>
  );
}

type Tone = "neutral" | "gold" | "ok" | "warn" | "bad" | "night";
export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  const t: Record<Tone, string> = {
    neutral: "bg-sand/60 text-ink-soft ring-line-strong/60",
    gold: "bg-gold/15 text-gold-text ring-gold/35",
    ok: "bg-ok-bg text-ok ring-ok/20",
    warn: "bg-warn-bg text-warn ring-warn/20",
    bad: "bg-bad-bg text-bad ring-bad/20",
    night: "bg-white/[0.06] text-mist ring-white/10",
  };
  return <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium ring-1 ring-inset", t[tone], className)}>{children}</span>;
}

/** Emplacement de chargement : pulsation FINIE (≈ 20 s, styles.css .pulse-finite), puis repos. */
export function Skeleton({ className, night = false }: { className?: string; night?: boolean }) {
  return <div aria-hidden className={cn("pulse-finite rounded-[10px]", night ? "bg-white/[0.06]" : "bg-sand/70", className)} />;
}

export function Card({ children, className, as: Tag = "div", night = false }: { children: ReactNode; className?: string; as?: "div" | "section" | "article"; night?: boolean }) {
  return (
    <Tag className={cn(
      "rounded-[22px] border",
      night ? "border-night-line bg-night text-ivory shadow-night" : "border-line bg-pearl/60 shadow-card",
      className,
    )}>
      {children}
    </Tag>
  );
}

export function TextInput({ label, hint, id, className, ...rest }: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const inputId = id ?? `in-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className={className}>
      <label htmlFor={inputId} className="text-sm font-medium text-ink-soft">{label}</label>
      <input
        id={inputId}
        className="mt-2 h-12 w-full rounded-[14px] border border-field bg-white/70 px-3.5 text-[16px] text-ink placeholder:text-muted transition-colors focus:border-gold-text focus:bg-white focus:outline-none focus-visible:outline-2 focus-visible:outline-gold-text"
        {...rest}
      />
      {hint && <p className="mt-1.5 text-[13.5px] text-muted">{hint}</p>}
    </div>
  );
}

/** Disponibilité d'un point d'accès, même code que l'accueil : point plein = disponible, demi-point = en
 *  développement, cercle vide = à venir. Décoratif : le statut est toujours écrit à côté. */
export function AccessDot({ state, className }: { state: "ready" | "dev" | "soon"; className?: string }) {
  return (
    <span aria-hidden className={cn("relative inline-block size-2 shrink-0 overflow-hidden rounded-full", state === "ready" ? "bg-gold" : "ring-1 ring-inset ring-gold", className)}>
      {state === "dev" && <span className="absolute inset-y-0 left-0 w-1/2 bg-gold" />}
    </span>
  );
}

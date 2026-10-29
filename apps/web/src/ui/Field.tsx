// Champs de formulaire des pages de compte (inscription, connexion, mot de passe) : libellé visible, aide, erreur
// reliée au champ (aria-describedby, aria-invalid), cible de 48 px. Mot de passe : bouton « Afficher » de 44 px qui
// ne quitte jamais le champ (le gestionnaire de mots de passe garde la main : autocomplete juste).
import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { IconEye, IconEyeOff } from "./Icon.tsx";

const INPUT = "h-12 w-full min-w-0 rounded-card border border-field bg-white px-3.5 text-corps text-ink placeholder:text-muted " +
  "transition-[border-color,box-shadow] duration-150 focus:border-gold-text focus:outline-none focus:ring-[3px] focus:ring-gold/25 " +
  "aria-[invalid=true]:border-bad disabled:opacity-60";

export function Field({ id, label, hint, error, children, className }: { id: string; label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={id} className="text-ui font-medium text-ink">{label}</label>
      {children}
      {error ? <p id={`${id}-erreur`} className="text-note text-bad" role="alert">{error}</p>
        : hint ? <p id={`${id}-aide`} className="text-note leading-relaxed text-muted">{hint}</p> : null}
    </div>
  );
}

/** Attributs d'accessibilité d'un champ selon son aide et son erreur. */
const described = (id: string, hint: boolean, error: boolean) => ({
  "aria-describedby": error ? `${id}-erreur` : hint ? `${id}-aide` : undefined,
  "aria-invalid": error || undefined,
});

export function TextInput({ id, hasHint = false, hasError = false, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { id: string; hasHint?: boolean; hasError?: boolean }) {
  return <input id={id} {...described(id, hasHint, hasError)} {...p} className={cn(INPUT, className)} />;
}

export function PasswordInput({ id, hasHint = false, hasError = false, className, ...p }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { id: string; hasHint?: boolean; hasError?: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input id={id} type={shown ? "text" : "password"} spellCheck={false} autoCapitalize="off" {...described(id, hasHint, hasError)} {...p} className={cn(INPUT, "pr-14", className)} />
      <button type="button" onClick={() => setShown((v) => !v)} aria-pressed={shown} aria-controls={id}
        className="absolute right-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-control text-ink-soft transition-colors hover:bg-pearl hover:text-ink">
        {shown ? <IconEyeOff size={19} /> : <IconEye size={19} />}
        <span className="sr-only">{shown ? "Masquer le mot de passe" : "Afficher le mot de passe"}</span>
      </button>
    </div>
  );
}

/** Message d'état sous un formulaire (erreur ou information), annoncé aux lecteurs d'écran. */
export function FormNote({ tone, icon, children }: { tone: "bad" | "warn" | "ok" | "info"; icon: ReactNode; children: ReactNode }) {
  const t = { bad: "border-bad/20 bg-bad-bg text-bad", warn: "border-warn/20 bg-warn-bg text-warn", ok: "border-ok/20 bg-ok-bg text-ok", info: "border-line bg-pearl text-ink" }[tone];
  return (
    <p role={tone === "bad" ? "alert" : "status"} className={cn("flex gap-2.5 rounded-card border p-3.5 text-ui leading-relaxed", t)}>
      <span className="mt-0.5 shrink-0">{icon}</span><span className="min-w-0">{children}</span>
    </p>
  );
}

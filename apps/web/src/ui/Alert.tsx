// Encart d'information (principes de l'« Alert » d'Arc UI, MIT, réécrits sur nos jetons) : tons info, ok, warn,
// bad ; icône, titre, texte. Annonce aux lecteurs d'écran SEULEMENT pour un message qui apparaît ou change
// (live) : un encart présent dès le chargement n'est pas une région live. Ton « bad » + live → role="alert".
import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { IconAlert, IconCheck, IconInfo } from "./Icon.tsx";

type Tone = "info" | "ok" | "warn" | "bad";
const TONE: Record<Tone, { box: string; icon: string; Icon: typeof IconInfo }> = {
  info: { box: "border-line bg-pearl", icon: "text-gold-text", Icon: IconInfo },
  ok: { box: "border-ok/25 bg-ok-bg", icon: "text-ok", Icon: IconCheck },
  warn: { box: "border-gold/40 bg-pearl", icon: "text-gold-text", Icon: IconAlert },
  bad: { box: "border-bad/25 bg-bad-bg", icon: "text-bad", Icon: IconAlert },
};

interface Props {
  tone?: Tone;
  title?: ReactNode;
  children: ReactNode;
  /** Message qui apparaît ou change pendant la visite : annoncé (polite, ou assertive pour « bad »). */
  live?: boolean;
  /** Repère de page (ex. « Installation manuelle ») : rendu en <aside> nommé. */
  landmark?: string;
  className?: string;
}

export function Alert({ tone = "info", title, children, live = false, landmark, className }: Props) {
  const t = TONE[tone];
  const Tag = landmark ? "aside" : "div";
  const role = live ? (tone === "bad" ? "alert" : "status") : undefined;
  return (
    <Tag aria-label={landmark} role={role} data-alert={tone}
      className={cn("flex gap-3.5 rounded-[20px] border p-4 sm:gap-4 sm:p-5", t.box, className)}>
      <t.Icon size={21} className={cn("mt-0.5 shrink-0", t.icon)} />
      <div className="min-w-0 space-y-1.5 text-[15px] leading-relaxed text-ink-soft">
        {title && <p className="font-semibold text-ink">{title}</p>}
        {children}
      </div>
    </Tag>
  );
}

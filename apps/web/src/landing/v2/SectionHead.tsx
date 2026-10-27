// En-tête de section : un titre court, une phrase au plus. Plus de numéro ni de libellé au-dessus (revue produit du
// 2026-10-15 : les sections ne forment pas une suite, le repère « 01 — Démo » n'apportait rien).
import { motion } from "motion/react";
import { cn } from "../../lib/cn.ts";
import { inView, reveal, revealGroup } from "../../lib/motion.ts";

export function SectionHead({ id, title, lead, center = false, tone = "light", className }: {
  id: string;
  title: string;
  lead?: string;
  center?: boolean;
  /** Fond de la section : texte secondaire en brume sur l'obsidienne. */
  tone?: "light" | "dark";
  className?: string;
}) {
  return (
    <motion.header variants={revealGroup} {...inView(`tete-${id}`)} className={cn("max-w-[42rem]", center && "mx-auto text-center", className)}>
      <motion.h2 variants={reveal} id={id} className="font-display text-title font-medium">{title}</motion.h2>
      {lead && <motion.p variants={reveal} className={cn("mt-4 text-[17px] leading-relaxed sm:text-lead", tone === "dark" ? "text-fg-2" : "text-ink-soft")}>{lead}</motion.p>}
    </motion.header>
  );
}

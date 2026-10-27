// Carte des pages de compte sans session (fin d'inscription, mot de passe oublié, nouveau mot de passe) : la même
// carte ivoire que la connexion, centrée, la chouette en tête. Coque de l'application (aucun pré-rendu : le contenu
// dépend du lien reçu par e-mail).
import type { ReactNode } from "react";
import { motion } from "motion/react";
import { DUR, EASE } from "../lib/motion.ts";
import { OwlMark } from "../ui/brand/OwlMark.tsx";

export function CompteCarte({ title, lead, children, data }: { title: string; lead?: ReactNode; children: ReactNode; data: string }) {
  return (
    <section className="relative overflow-hidden pb-24 pt-28 sm:pt-36" data-compte={data}>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10" />
      <div className="container-site flex justify-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.reveal, ease: EASE.soft }}
          className="w-full max-w-[460px] rounded-[30px] border border-line bg-ivory p-7 shadow-raised sm:p-10"
        >
          <OwlMark size={46} blink />
          <h1 className="page-title mt-6">{title}</h1>
          {lead && <p className="mt-3 text-[16px] leading-relaxed text-ink-soft">{lead}</p>}
          <div className="mt-8">{children}</div>
        </motion.div>
      </div>
    </section>
  );
}

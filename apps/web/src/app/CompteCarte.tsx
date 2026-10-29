// Carte des pages de compte sans session (fin d'inscription, mot de passe oublié, nouveau mot de passe) : la même
// carte que la connexion, centrée, sous l'arche du « Passage » (la chouette à la clé de voûte). Coque de l'application (aucun pré-rendu : le contenu
// dépend du lien reçu par e-mail).
import type { ReactNode } from "react";
import { motion } from "motion/react";
import { DUR, EASE } from "../lib/motion.ts";
import { OwlMark } from "../ui/brand/OwlMark.tsx";
import { Seuil } from "../ui/passage/Passage.tsx";

export function CompteCarte({ title, lead, children, data }: { title: string; lead?: ReactNode; children: ReactNode; data: string }) {
  return (
    <section className="relative overflow-hidden pb-24 pt-28 sm:pt-36" data-compte={data}>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10" />
      <div className="container-site flex justify-center">
        <Seuil className="max-w-[460px]" couronne={<OwlMark size={42} blink />}>
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.reveal, ease: EASE.soft }}
          className="seuil-carte w-full rounded-panel border border-line bg-ivory p-7 shadow-raised sm:p-10"
        >
          <h1 className="page-title">{title}</h1>
          {lead && <p className="mt-3 text-corps leading-relaxed text-ink-soft">{lead}</p>}
          <div className="mt-8">{children}</div>
        </motion.div>
        </Seuil>
      </div>
    </section>
  );
}

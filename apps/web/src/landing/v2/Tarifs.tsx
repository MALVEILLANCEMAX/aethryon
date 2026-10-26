// Section « Tarif » (lib/offres.ts, ui/offres/Pricing.tsx), modèle V2 : Gratuit, Premium 5 € par an, Premium à vie 20 €.
// - « apercu » : les trois offres, les payantes « Bientôt » à leurs prix fixés, « Me prévenir », la note « rien n'est
//   en vente », les mentions vraies.
// - « reelles » (défaut) : l'offre réelle seule, avec le sablier 3D (le quota qui revient chaque jour).
// - « vente » : les trois offres à vendre ; « Choisir » mène au récapitulatif de l'espace.
// Sous les cartes (revue produit du 2026-10-15) : ce que toutes partagent et la règle de Discord, dits une fois, puis le
// comparatif détaillé, replié.
import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "motion/react";
import { useCalm, useConfig } from "../../lib/hooks.ts";
import { inView, reveal, revealGroup } from "../../lib/motion.ts";
import { OFFRES_MODE, REASSURANCES, REASSURANCES_VENTE } from "../../lib/offres.ts";
import { PricingCommon, PricingCompare, PricingNote, PricingPlans } from "../../ui/offres/Pricing.tsx";
import { RetroObject } from "../../ui/retro/RetroObject.tsx";
import { SectionHead } from "./SectionHead.tsx";

function ReassureIcon({ name }: { name: (typeof REASSURANCES)[number]["icon"] }) {
  const p = {
    card: <><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="M3 10h18M7 15h4" /></>,
    repeat: <><path d="M4 12a8 8 0 0 1 13.7-5.6M20 12a8 8 0 0 1-13.7 5.6" /><path d="M17.5 3v3.6h-3.6M6.5 21v-3.6h3.6" /></>,
    trash: <><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" /><path d="M10.5 11v5.5M13.5 11v5.5" /></>,
    lock: <><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>,
  }[name];
  return <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p}</svg>;
}

/** Le quota du jour en image : un point par conversion (valeur réelle de /api/config), qui se remplissent une fois
 *  à l'arrivée dans l'écran ; le chiffre en grand. Au-delà de 30 (réglage du Control Center), 30 points. */
function QuotaMeter() {
  const cfg = useConfig();
  const calm = useCalm();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, amount: 0.6 });
  // Pré-rendu et mouvement réduit : points pleins d'emblée. Sinon, ils se remplissent quand le compteur arrive à l'écran.
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!calm) setArmed(true); }, [calm]);
  const daily = cfg.data?.quotas.daily;
  const n = Math.min(daily ?? 10, 30);
  return (
    <div ref={ref} className="quota-meter" data-quota="" data-armed={armed && !seen ? "" : undefined}>
      <p className="flex items-baseline gap-3"><b className="font-display text-[clamp(3.4rem,2.6rem+2.4vw,4.6rem)] font-medium leading-none tabular text-ink">{daily ?? "…"}</b><span className="text-[17px] text-ink-soft">conversions par jour</span></p>
      <ol className="quota-dots" aria-hidden="true">{Array.from({ length: n }, (_, i) => <li key={i} />)}</ol>
      <p className="mt-4 text-[14px] text-muted">Le compteur repart à minuit, heure de Paris.</p>
    </div>
  );
}

export function Tarifs() {
  const apercu = OFFRES_MODE === "apercu";
  const vente = OFFRES_MODE === "vente";
  const reassure = vente ? REASSURANCES_VENTE : REASSURANCES;
  return (
    <section id="tarifs" aria-labelledby="tarifs-title" className="section-light seam tarifs relative overflow-hidden bg-pearl py-24 sm:py-32" data-offres-mode={OFFRES_MODE}>
      <div className="container-site relative">
        <div className="tarifs-head">
          <SectionHead id="tarifs-title"
            title={vente ? "Gratuit pour commencer. Premium pour aller plus loin." : apercu ? "Gratuit pour commencer. Bientôt, Premium pour aller plus loin." : "Gratuit pendant la bêta."}
            lead={apercu ? "Premium ouvrira aux prix affichés. Rien n'est en vente aujourd'hui." : undefined} />
        </div>

        {apercu || vente ? (
          <>
            <motion.div variants={revealGroup} {...inView("tarifs-grille")} className="mt-12 sm:mt-14">
              <PricingPlans context="accueil" />
            </motion.div>
            <PricingCommon className="mt-7" />
            <PricingCompare className="mt-5" />
            <PricingNote className="mt-5" />
          </>
        ) : (
          <motion.div variants={revealGroup} {...inView("tarifs-offre")} className="mt-12 grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:gap-6">
            <motion.div variants={reveal} className="quota-visual">
              <RetroObject kind="sablier" size="md" className="retro-plinth on-light shrink-0" />
              <QuotaMeter />
            </motion.div>
            <PricingPlans context="accueil" only={["free"]} />
          </motion.div>
        )}

        <motion.ul variants={revealGroup} {...inView("tarifs-garanties")} className="reassure mt-6" aria-label="Garanties">
          {reassure.map((r) => (
            <motion.li key={r.title} variants={reveal}>
              <span className="reassure-icon"><ReassureIcon name={r.icon} /></span>
              <b>{r.title}</b>
              <span className="sr-only">{r.text}</span>
            </motion.li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}

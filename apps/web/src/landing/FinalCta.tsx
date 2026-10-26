// Appel final (obsidienne) : la chouette (tête vectorielle officielle, qui cligne et suit du regard), la promesse
// de la marque, et les deux portes d'entrée — créer un compte, ou se connecter à celui qu'on a déjà.
import { motion } from "motion/react";
import { inView, reveal } from "../lib/motion.ts";
import { useMe } from "../lib/hooks.ts";
import { ButtonLink } from "../ui/Button.tsx";
import { OwlMark } from "../ui/brand/OwlMark.tsx";
import { IconArrowRight } from "../ui/Icon.tsx";
import { Arrow } from "../ui/Arrows.tsx";

export function FinalCta() {
  const me = useMe();
  const signedIn = !!me.data && !me.error;
  return (
    // Nom distinct du héros (même phrase de marque) : deux zones ne doivent pas porter le même nom (axe, landmark-unique).
    <section aria-label="Commencer avec AETHRYON" className="hero-night seam relative">
      <motion.div {...inView("appel-final")} variants={reveal} className="container-site relative flex flex-col items-center pb-24 pt-24 text-center sm:pb-28 sm:pt-32">
        <div className="relative">
          <div aria-hidden className="absolute -inset-10 rounded-full bg-[radial-gradient(closest-side,rgb(212_175_124/0.2),transparent)]" />
          <OwlMark size={84} blink follow surface="dark" className="relative" />
          <Arrow shape="boucle" className="absolute -right-[92px] -top-[26px] hidden h-[72px] w-[64px] sm:block" />
        </div>
        <h2 id="final-title" className="mt-8 max-w-3xl font-display text-[clamp(2.4rem,1.6rem+3.4vw,4.4rem)] font-medium leading-[1.02] tracking-[-0.02em] text-ivory">
          <span className="block">Un lien entre.</span><span className="block text-gold-light">Un fichier sort.</span>
        </h2>
        <p className="mt-5 max-w-md text-lead text-mist">Gratuit pendant la bêta, avec Google ou ton adresse e-mail.</p>
        <div className="mt-10 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center">
          {signedIn
            ? <ButtonLink to="/dashboard" variant="light" size="lg" trailing={<IconArrowRight size={18} />}>Ouvrir mon espace</ButtonLink>
            : <>
                <ButtonLink to="/commencer" variant="light" size="lg" trailing={<IconArrowRight size={18} />}>Commencer gratuitement</ButtonLink>
                <ButtonLink to="/connexion" variant="night" size="lg">J'ai déjà un compte</ButtonLink>
              </>}
        </div>
      </motion.div>
    </section>
  );
}

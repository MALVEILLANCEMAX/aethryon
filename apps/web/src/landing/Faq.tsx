// FAQ dépliable : bouton + aria-expanded/aria-controls, hauteur animée (Motion), accessible au clavier.
import { useId, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Link } from "react-router";
import { cn } from "../lib/cn.ts";
import { useConfig } from "../lib/hooks.ts";
import { DUR, EASE, inView, reveal } from "../lib/motion.ts";
import { IconChevron } from "../ui/Icon.tsx";
import { usePrerender } from "../lib/prerender.ts";
import { EXTENSION_AVAILABLE, EXTENSION_PAGE } from "../lib/extension.ts";
import { DISCORD_PUBLIC } from "../lib/discord.ts";
import { SectionHead } from "./v2/SectionHead.tsx";

const link = "text-gold-text underline decoration-gold/50 underline-offset-4 transition-colors hover:decoration-gold-text";

function Item({ q, children }: { q: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const prerender = usePrerender();
  const answer = <div className="max-w-2xl pb-6 text-[16px] leading-relaxed text-ink-soft">{children}</div>;
  return (
    <div className="border-b border-line">
      <h3>
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="group flex min-h-[68px] w-full items-center justify-between gap-6 py-4 text-left text-[17.5px] font-medium text-ink">
          {q}
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-full border border-line text-gold-text transition-[rotate,background-color] duration-300 group-hover:bg-pearl", open && "rotate-180")}>
            <IconChevron size={18} />
          </span>
        </button>
      </h3>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div id={id} role="region" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: DUR.component, ease: EASE.soft }} className="overflow-hidden">
            {answer}
          </motion.div>
        )}
      </AnimatePresence>
      {/* Pré-rendu : la réponse est dans le HTML, masquée (robots ; lecteurs sans JavaScript : sans-js.css). */}
      {prerender && !open && <div id={id} role="region" data-sans-js="">{answer}</div>}
    </div>
  );
}

export function Faq() {
  const cfg = useConfig();
  const q = cfg.data?.quotas; // jamais de chiffre inventé : sans réponse du serveur, la réponse reste générale
  return (
    <section id="faq" aria-labelledby="faq-title" className="py-20 sm:py-28">
      <div className="container-site grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionHead id="faq-title" title="Questions fréquentes" />
          <motion.p {...inView("faq-aide")} variants={reveal} className="mt-4 text-[16px] text-ink-soft">Autre chose ? L'<Link to="/aide" className={link}>aide</Link> propose un diagnostic.</motion.p>
        </div>
        <div className="border-t border-line">
          <Item q="Sur quels appareils ça marche ?">
            <ul className="list-disc space-y-1.5 pl-5 marker:text-gold">
              <li>iPhone : le raccourci AETHRYON, dans l'app Raccourcis (conçu pour iOS 27 ; iPad et Mac non essayés).</li>
              <li>Ordinateur : {EXTENSION_AVAILABLE ? <>l'<Link to={EXTENSION_PAGE} className={link}>extension</Link> pour Chrome, Edge et Brave</> : "l'extension, en développement"}, et <Link to="/outils" className={link}>AETHRYON Tools</Link> dans n'importe quel navigateur.</li>
              <li>Discord : {DISCORD_PUBLIC ? "le bot AETHRYON, depuis la page Discord de ton espace." : "le bot AETHRYON, en développement."}</li>
            </ul>
          </Item>
          <Item q="C'est quoi, un jeton ?">La clé personnelle du raccourci iPhone : tu la crées dans ton espace et tu la colles une fois dans le raccourci. Ne la partage jamais ; perdue, elle se régénère.</Item>
          <Item q="Où vont les fichiers ?">Sur iPhone, la vidéo va dans Photos et le MP3 dans Fichiers. Sur ordinateur, dans Téléchargements. Le raccourci confirme seulement une fois le fichier réellement enregistré.</Item>
          <Item q="Combien de conversions puis-je faire ?">{q
            ? `Pendant la bêta : ${q.daily} par jour et ${q.maxActive === 1 ? "une" : q.maxActive} à la fois. Le compteur repart à zéro à minuit, heure de Paris. Suivre une conversion ou télécharger son fichier ne compte pas.`
            : "Pendant la bêta, le nombre de conversions par jour et le nombre de conversions simultanées sont limités ; les chiffres exacts s'affichent dès que le serveur répond. Le compteur repart à zéro à minuit, heure de Paris."}</Item>
          <Item q="Quelles données sont conservées ?">Ton e-mail vérifié, ton nom, ton mot de passe haché si tu en as un, l'empreinte de tes jetons et un historique sans lien ni titre de vidéo. Détail et suppression du compte : <Link to="/confidentialite" className={link}>Confidentialité</Link>.</Item>
          <Item q="Ça ne marche pas, que faire ?">L'<Link to="/aide" className={link}>aide</Link> couvre le jeton refusé, le raccourci absent, le téléchargement impossible et les limites atteintes.</Item>
        </div>
      </div>
    </section>
  );
}

// FAQ dépliable : bouton + aria-expanded/aria-controls, hauteur animée (Motion), accessible au clavier.
// « Atelier de nuit » (2026-10-28) : le titre reste en place à gauche ; les questions sont des tuiles pleines, sans filet.
// 2026-10-29 : en français, anglais ou espagnol (la langue choisie dans la barre).
import { useId, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Link } from "react-router";
import { useConfig } from "../lib/hooks.ts";
import { DUR, EASE } from "../lib/motion.ts";
import { usePrerender } from "../lib/prerender.ts";
import { EXTENSION_AVAILABLE, EXTENSION_PAGE } from "../lib/extension.ts";
import { DISCORD_PUBLIC } from "../lib/discord.ts";
import { useLangue, type Langue } from "../lib/langue.ts";
import { useT } from "../i18n/accueil.ts";

const link = "text-gold-text underline decoration-gold/50 underline-offset-4 transition-colors hover:decoration-gold-text";

function Item({ q, children }: { q: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const prerender = usePrerender();
  const answer = <div className="fq-reponse">{children}</div>;
  return (
    <div className="fq-tuile" data-ouvert={open || undefined}>
      <h3>
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="fq-question">
          {q}
          <span className="fq-signe" aria-hidden="true"><span /><span /></span>
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

type Quotas = { daily: number; maxActive: number } | undefined;

/** Les six questions, dans la langue choisie ; jamais de chiffre inventé : sans réponse du serveur, la réponse reste générale. */
function questions(l: Langue, q: Quotas): { q: string; r: ReactNode }[] {
  const ext = (fr: boolean) => EXTENSION_AVAILABLE;
  if (l === "en") return [
    { q: "Which devices does it work on?", r: (
      <ul className="list-disc space-y-1.5 pl-5 marker:text-gold">
        <li>iPhone: the AETHRYON shortcut, in the Shortcuts app (built for iOS 27; iPad and Mac not tested).</li>
        <li>Computer: {ext(false) ? <>the <Link to={EXTENSION_PAGE} className={link}>extension</Link> for Chrome, Edge and Brave</> : "the extension, in development"}, and <Link to="/outils" className={link}>AETHRYON Tools</Link> in any browser.</li>
        <li>Discord: {DISCORD_PUBLIC ? "the AETHRYON bot, from the Discord page of your space." : "the AETHRYON bot, in development."}</li>
      </ul>) },
    { q: "What's a token?", r: "The personal key of the iPhone shortcut: you create it in your space and paste it once into the shortcut. Never share it; if lost, it can be regenerated." },
    { q: "Where do the files go?", r: "On iPhone, videos go to Photos and MP3s to Files. On a computer, to Downloads. The shortcut only confirms once the file is actually saved." },
    { q: "How many conversions can I make?", r: q
      ? `During the beta: ${q.daily} a day and ${q.maxActive} at a time. The counter resets at midnight, Paris time. Following a conversion or downloading its file doesn't count.`
      : "During the beta, conversions per day and simultaneous conversions are limited; the exact numbers show as soon as the server answers. The counter resets at midnight, Paris time." },
    { q: "What data is kept?", r: <>Your verified email, your name, your hashed password if you have one, the fingerprint of your tokens and a history with no video link or title. Details and account deletion: <Link to="/confidentialite" className={link}>Privacy</Link> (in French).</> },
    { q: "It doesn't work, what should I do?", r: <>The <Link to="/aide" className={link}>help</Link> (in French) covers a rejected token, a missing shortcut, a failed download and reached limits.</> },
  ];
  if (l === "es") return [
    { q: "¿En qué dispositivos funciona?", r: (
      <ul className="list-disc space-y-1.5 pl-5 marker:text-gold">
        <li>iPhone: el atajo AETHRYON, en la app Atajos (pensado para iOS 27; iPad y Mac sin probar).</li>
        <li>Ordenador: {ext(false) ? <>la <Link to={EXTENSION_PAGE} className={link}>extensión</Link> para Chrome, Edge y Brave</> : "la extensión, en desarrollo"}, y <Link to="/outils" className={link}>AETHRYON Tools</Link> en cualquier navegador.</li>
        <li>Discord: {DISCORD_PUBLIC ? "el bot AETHRYON, desde la página Discord de tu espacio." : "el bot AETHRYON, en desarrollo."}</li>
      </ul>) },
    { q: "¿Qué es un token?", r: "La clave personal del atajo de iPhone: la creas en tu espacio y la pegas una vez en el atajo. No la compartas nunca; si la pierdes, se puede regenerar." },
    { q: "¿Adónde van los archivos?", r: "En iPhone, el vídeo va a Fotos y el MP3 a Archivos. En el ordenador, a Descargas. El atajo solo confirma cuando el archivo se ha guardado de verdad." },
    { q: "¿Cuántas conversiones puedo hacer?", r: q
      ? `Durante la beta: ${q.daily} al día y ${q.maxActive} a la vez. El contador se reinicia a medianoche, hora de París. Seguir una conversión o descargar su archivo no cuenta.`
      : "Durante la beta, las conversiones diarias y simultáneas están limitadas; las cifras exactas aparecen en cuanto responde el servidor. El contador se reinicia a medianoche, hora de París." },
    { q: "¿Qué datos se conservan?", r: <>Tu correo verificado, tu nombre, tu contraseña cifrada si tienes una, la huella de tus tokens y un historial sin enlace ni título de vídeo. Detalle y eliminación de la cuenta: <Link to="/confidentialite" className={link}>Privacidad</Link> (en francés).</> },
    { q: "No funciona, ¿qué hago?", r: <>La <Link to="/aide" className={link}>ayuda</Link> (en francés) cubre el token rechazado, el atajo ausente, la descarga imposible y los límites alcanzados.</> },
  ];
  return [
    { q: "Sur quels appareils ça marche ?", r: (
      <ul className="list-disc space-y-1.5 pl-5 marker:text-gold">
        <li>iPhone : le raccourci AETHRYON, dans l'app Raccourcis (conçu pour iOS 27 ; iPad et Mac non essayés).</li>
        <li>Ordinateur : {ext(true) ? <>l'<Link to={EXTENSION_PAGE} className={link}>extension</Link> pour Chrome, Edge et Brave</> : "l'extension, en développement"}, et <Link to="/outils" className={link}>AETHRYON Tools</Link> dans n'importe quel navigateur.</li>
        <li>Discord : {DISCORD_PUBLIC ? "le bot AETHRYON, depuis la page Discord de ton espace." : "le bot AETHRYON, en développement."}</li>
      </ul>) },
    { q: "C'est quoi, un jeton ?", r: "La clé personnelle du raccourci iPhone : tu la crées dans ton espace et tu la colles une fois dans le raccourci. Ne la partage jamais ; perdue, elle se régénère." },
    { q: "Où vont les fichiers ?", r: "Sur iPhone, la vidéo va dans Photos et le MP3 dans Fichiers. Sur ordinateur, dans Téléchargements. Le raccourci confirme seulement une fois le fichier réellement enregistré." },
    { q: "Combien de conversions puis-je faire ?", r: q
      ? `Pendant la bêta : ${q.daily} par jour et ${q.maxActive === 1 ? "une" : q.maxActive} à la fois. Le compteur repart à zéro à minuit, heure de Paris. Suivre une conversion ou télécharger son fichier ne compte pas.`
      : "Pendant la bêta, le nombre de conversions par jour et le nombre de conversions simultanées sont limités ; les chiffres exacts s'affichent dès que le serveur répond. Le compteur repart à zéro à minuit, heure de Paris." },
    { q: "Quelles données sont conservées ?", r: <>Ton e-mail vérifié, ton nom, ton mot de passe haché si tu en as un, l'empreinte de tes jetons et un historique sans lien ni titre de vidéo. Détail et suppression du compte : <Link to="/confidentialite" className={link}>Confidentialité</Link>.</> },
    { q: "Ça ne marche pas, que faire ?", r: <>L'<Link to="/aide" className={link}>aide</Link> couvre le jeton refusé, le raccourci absent, le téléchargement impossible et les limites atteintes.</> },
  ];
}

export function Faq() {
  const cfg = useConfig();
  const t = useT();
  const langue = useLangue();
  const q = cfg.data?.quotas;
  return (
    <section id="faq" aria-labelledby="faq-title" className="at-section fq">
      <div className="fq-tete">
        <h2 id="faq-title" className="at-h2">{t.questions}</h2>
        <p className="fq-aide">{t.problemePrecis} <Link to="/aide">{t.touteAide}</Link></p>
      </div>
      <div className="fq-liste">
        {questions(langue, q).map((x) => <Item key={x.q} q={x.q}>{x.r}</Item>)}
      </div>
    </section>
  );
}

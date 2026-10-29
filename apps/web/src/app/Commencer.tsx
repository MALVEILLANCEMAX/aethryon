// « Commencer » : la création du compte, distincte de « Se connecter » (compte existant, /connexion).
// Deux façons : Google, ou une adresse e-mail — parcours en trois étapes SANS quitter la page (app/inscription/
// Parcours.tsx) : l'adresse, le code à 6 chiffres reçu par e-mail (l'adresse est vérifiée AVANT que le compte n'existe),
// puis le nom et le mot de passe. Pendant les étapes 2 et 3, Google s'efface. Le lien de l'e-mail mène à la même étape 3
// (/inscription). Sans relais d'e-mails sur le serveur (/api/config emailEnabled faux), l'e-mail reste « Bientôt ».
// Inscriptions fermées (réglage du Control Center, /api/config signupsOpen) : la page le dit et renvoie vers la
// connexion. Visuel : la carte sous l'arche du « Passage » (la chouette à la clé), et le passage du compte au premier
// fichier en trois nœuds sur le fil d'or (tuiles des produits, formats en étiquettes).
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { signInWithGoogle } from "../lib/auth.ts";
import { safeReturnPath } from "../lib/safe.ts";
import { ApiError } from "../lib/api.ts";
import { useConfig, useDocumentTitle, useMe } from "../lib/hooks.ts";
import { DUR, EASE } from "../lib/motion.ts";
import { isStaticBoot } from "../lib/prerender.ts";
import { OwlMark } from "../ui/brand/OwlMark.tsx";
import { TuileProduit, type Produit } from "../ui/brand/TuileProduit.tsx";
import { GoogleG, IconAlert, IconInfo, IconLock } from "../ui/Icon.tsx";
import { Etiquette, Icone } from "../ui/egide/Egide.tsx";
import { Seuil } from "../ui/passage/Passage.tsx";
import { EmailSignupFlow } from "./inscription/Parcours.tsx";

/** Les façons d'utiliser AETHRYON avec un compte : la tuile du produit et son nom, toujours écrit. */
const CM_PRODUITS: [Produit, string][] = [["iphone", "iPhone"], ["extension", "Navigateur"], ["discord", "Discord"], ["premiere", "Premiere Pro"], ["desktop", "Windows"]];

export default function Commencer() {
  useDocumentTitle("Créer un compte");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // « suite » : la page où revenir une fois le compte créé (ex. /premium?offre=annuel), chemin relatif de ce site seulement.
  const next = safeReturnPath(params.get("suite")) ?? "/dashboard";
  const cfg = useConfig();
  const me = useMe();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  // Étape du parcours par e-mail : au-delà de l'adresse, Google et le séparateur s'effacent.
  const [emailStep, setEmailStep] = useState<"email" | "code" | "profil">("email");
  const focusOnEmail = emailStep !== "email";

  // Déjà connecté : rien à créer, direction l'espace.
  useEffect(() => { if (me.data && !me.error) navigate(next, { replace: true }); }, [me.data, me.error, navigate, next]);

  const closed = cfg.data ? !cfg.data.signupsOpen : false;
  // HTML pré-rendu : le formulaire (le serveur de production l'ouvre) ; serveur sans relais d'e-mails : « Bientôt ».
  const emailOn = cfg.data ? cfg.data.emailEnabled === true : true;
  const googleOff = cfg.data ? !cfg.data.googleEnabled : false;
  const go = async () => {
    setState("loading");
    setMessage(null);
    try {
      await signInWithGoogle(next);
    } catch (e) {
      setState("error");
      setMessage(e instanceof ApiError && !e.isNetwork ? e.message : "La création du compte n'a pas pu démarrer. Vérifie ta connexion et réessaie.");
    }
  };
  const q = cfg.data?.quotas;

  return (
    <section className="hero-night min-h-[100dvh] pb-24 pt-28 sm:pt-36" data-page-commencer="">
      <div className="container-site grid items-start gap-10 lg:grid-cols-[minmax(0,470px)_minmax(0,1fr)] lg:gap-16">
        <Seuil couronne={<OwlMark size={42} blink />}>
        <motion.div
          initial={isStaticBoot() ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.reveal, ease: EASE.soft }}
          className="seuil-carte rounded-panel border border-line bg-ivory p-7 text-ink shadow-raised sm:p-10"
        >
          <h1 className="page-title">Crée ton compte</h1>
          {!focusOnEmail && <p className="mt-3 text-corps leading-relaxed text-ink-soft">Gratuit pendant la bêta{q ? ` : ${q.daily} conversions par jour` : ""}. Un compte sert à toutes les façons d'utiliser AETHRYON.</p>}

          {!focusOnEmail && <div className="mt-8">
            <button
              type="button"
              onClick={go}
              disabled={state === "loading" || closed || googleOff || cfg.loading}
              aria-busy={state === "loading" || undefined}
              className="relative flex h-14 w-full items-center justify-center gap-3 rounded-full border border-[#747775] bg-[#fff] text-corps font-medium text-[#1f1f1f] shadow-card transition-[translate,box-shadow] duration-200 hover:-translate-y-px hover:shadow-raised active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
              data-commencer-google=""
            >
              {state === "loading"
                ? <><span className="size-5 animate-spin rounded-full border-2 border-[#1f1f1f] border-r-transparent motion-reduce:animate-none" />Redirection vers Google…</>
                : <><GoogleG size={20} />Créer mon compte avec Google</>}
            </button>
            <AnimatePresence>
              {state === "error" && message && (
                <motion.p role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 flex gap-2.5 rounded-card border border-bad/20 bg-bad-bg p-3.5 text-ui text-bad">
                  <IconAlert size={18} className="mt-0.5 shrink-0" />{message}
                </motion.p>
              )}
            </AnimatePresence>
            {closed && (
              <p className="mt-4 flex gap-2.5 rounded-card border border-warn/20 bg-warn-bg p-3.5 text-ui text-warn">
                <IconInfo size={18} className="mt-0.5 shrink-0" />Les inscriptions sont fermées pour le moment : seuls les comptes existants peuvent se connecter.
              </p>
            )}
            {googleOff && !closed && (
              <p className="mt-4 flex gap-2.5 rounded-card border border-warn/20 bg-warn-bg p-3.5 text-ui text-warn">
                <IconInfo size={18} className="mt-0.5 shrink-0" />La connexion Google n'est pas encore configurée sur ce serveur.
              </p>
            )}
          </div>}

          {!focusOnEmail && <div className="my-7 flex items-center gap-3 text-note text-muted" aria-hidden="true"><span className="h-px flex-1 bg-line" />ou<span className="h-px flex-1 bg-line" /></div>}
          {emailOn ? <div className={focusOnEmail ? "mt-8" : undefined}><EmailSignupFlow disabled={closed} onStep={setEmailStep} next={next} /></div> : (
          <div className="flex items-start gap-3 rounded-card border border-dashed border-line-strong p-4" data-commencer-email-bientot="">
            <span className="grid size-9 shrink-0 place-items-center rounded-control bg-pearl text-gold-text">
              <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="m3.5 7 8.5 6 8.5-6" /></svg>
            </span>
            <div>
              <p className="flex flex-wrap items-center gap-2 text-ui font-medium text-ink">Avec une adresse e-mail <span className="rounded-full bg-sand px-2 py-0.5 text-petit font-semibold text-gold-text">Bientôt</span></p>
              <p className="mt-1 text-note leading-relaxed text-muted">E-mail et mot de passe arrivent. Pour l'instant, Google seulement.</p>
            </div>
          </div>
          )}

          <p className="mt-8 text-center text-ui text-ink-soft">Déjà un compte ? <Link to={next !== "/dashboard" ? `/connexion?suite=${encodeURIComponent(next)}` : "/connexion"} className="font-medium text-gold-text underline decoration-gold/50 underline-offset-4 hover:decoration-gold-text" data-commencer-connexion="">Se connecter</Link></p>
          <div className="mt-7 flex gap-3 border-t border-line pt-6 text-note leading-relaxed text-ink-soft">
            <IconLock size={17} className="mt-0.5 shrink-0 text-gold-text" />
            <p>Seuls ton e-mail vérifié, ton nom et ton mot de passe haché sont gardés. <Link to="/confidentialite" className="text-gold-text underline decoration-gold/50 underline-offset-4">Confidentialité</Link></p>
          </div>
        </motion.div>
        </Seuil>

        {/* Le passage, du compte au premier fichier : trois nœuds sur le fil d'or (une vraie suite : liste ordonnée). */}
        <div className="cm-passage">
          <h2 className="cm-titre">Du compte au premier fichier.</h2>
          <ol className="cm-etapes">
            <li>
              <span className="cm-noeud" aria-hidden="true"><Icone nom="profil" duo /></span>
              <div><b>Ton compte AETHRYON</b><span className="cm-note">{emailOn ? "Google ou adresse e-mail" : "Google, un clic"}</span></div>
            </li>
            <li>
              <span className="cm-noeud" aria-hidden="true"><Icone nom="telephone" duo /></span>
              <div>
                <b>Ton appareil</b>
                <ul className="cm-produits">
                  {CM_PRODUITS.map(([p, nom]) => <li key={p}><TuileProduit produit={p} size={26} />{nom}</li>)}
                </ul>
              </div>
            </li>
            <li>
              <span className="cm-noeud" aria-hidden="true"><Icone nom="convertir" duo /></span>
              <div><b>Ton premier fichier</b><span className="cm-note">Un lien YouTube, TikTok ou X <Icone nom="droite" taille="s" className="cm-fleche" /> <Etiquette ton="accent">MP4</Etiquette> <Etiquette ton="accent">MP3</Etiquette></span></div>
            </li>
          </ol>
        </div>
      </div>
    </section>
  );
}

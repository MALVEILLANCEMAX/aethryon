// « Commencer » : la création du compte, distincte de « Se connecter » (compte existant, /connexion).
// Deux façons : Google, ou une adresse e-mail — parcours en trois étapes SANS quitter la page (app/inscription/
// Parcours.tsx) : l'adresse, le code à 6 chiffres reçu par e-mail (l'adresse est vérifiée AVANT que le compte n'existe),
// puis le nom et le mot de passe. Pendant les étapes 2 et 3, Google s'efface. Le lien de l'e-mail mène à la même étape 3
// (/inscription). Sans relais d'e-mails sur le serveur (/api/config emailEnabled faux), l'e-mail reste « Bientôt ».
// Inscriptions fermées (réglage du Control Center, /api/config signupsOpen) : la page le dit et renvoie vers la
// connexion. Visuel : les trois étapes (compte → appareil → premier fichier) et la chouette.
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { signInWithGoogle } from "../lib/auth.ts";
import { safeReturnPath } from "../lib/safe.ts";
import { ApiError } from "../lib/api.ts";
import { useConfig, useDocumentTitle, useMe } from "../lib/hooks.ts";
import { DUR, EASE } from "../lib/motion.ts";
import { isStaticBoot } from "../lib/prerender.ts";
import { OwlMark } from "../ui/brand/OwlMark.tsx";
import { PlatformMark } from "../ui/brand/PlatformMark.tsx";
import { GoogleG, IconAlert, IconCheck, IconInfo, IconLock } from "../ui/Icon.tsx";
import { EmailSignupFlow } from "./inscription/Parcours.tsx";
import { Arrow } from "../ui/Arrows.tsx";

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="start-step">
      <span className="start-step-num">{n}</span>
      <div className="min-w-0">
        <p className="text-[15.5px] font-semibold text-fg">{title}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-fg-2">{children}</div>
      </div>
    </li>
  );
}

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
        <motion.div
          initial={isStaticBoot() ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.reveal, ease: EASE.soft }}
          className="rounded-[30px] bg-ivory p-7 text-ink shadow-raised sm:p-10"
        >
          <OwlMark size={44} blink />
          <h1 className="page-title mt-6">Crée ton compte</h1>
          {!focusOnEmail && <p className="mt-3 text-[16px] leading-relaxed text-ink-soft">Gratuit pendant la bêta{q ? ` : ${q.daily} conversions par jour` : ""}. Un compte sert à toutes les façons d'utiliser AETHRYON.</p>}

          {!focusOnEmail && <div className="mt-8">
            <button
              type="button"
              onClick={go}
              disabled={state === "loading" || closed || googleOff || cfg.loading}
              aria-busy={state === "loading" || undefined}
              className="relative flex h-14 w-full items-center justify-center gap-3 rounded-full border border-[#747775] bg-[#fff] text-[16.5px] font-medium text-[#1f1f1f] shadow-card transition-[translate,box-shadow] duration-200 hover:-translate-y-px hover:shadow-raised active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
              data-commencer-google=""
            >
              {state === "loading"
                ? <><span className="size-5 animate-spin rounded-full border-2 border-[#1f1f1f] border-r-transparent motion-reduce:animate-none" />Redirection vers Google…</>
                : <><GoogleG size={20} />Créer mon compte avec Google</>}
            </button>
            <AnimatePresence>
              {state === "error" && message && (
                <motion.p role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 flex gap-2.5 rounded-[16px] border border-bad/20 bg-bad-bg p-3.5 text-[14.5px] text-bad">
                  <IconAlert size={18} className="mt-0.5 shrink-0" />{message}
                </motion.p>
              )}
            </AnimatePresence>
            {closed && (
              <p className="mt-4 flex gap-2.5 rounded-[16px] border border-warn/20 bg-warn-bg p-3.5 text-[14.5px] text-warn">
                <IconInfo size={18} className="mt-0.5 shrink-0" />Les inscriptions sont fermées pour le moment : seuls les comptes existants peuvent se connecter.
              </p>
            )}
            {googleOff && !closed && (
              <p className="mt-4 flex gap-2.5 rounded-[16px] border border-warn/20 bg-warn-bg p-3.5 text-[14.5px] text-warn">
                <IconInfo size={18} className="mt-0.5 shrink-0" />La connexion Google n'est pas encore configurée sur ce serveur.
              </p>
            )}
          </div>}

          {!focusOnEmail && <div className="my-7 flex items-center gap-3 text-[13px] text-muted" aria-hidden="true"><span className="h-px flex-1 bg-line" />ou<span className="h-px flex-1 bg-line" /></div>}
          {emailOn ? <div className={focusOnEmail ? "mt-8" : undefined}><EmailSignupFlow disabled={closed} onStep={setEmailStep} next={next} /></div> : (
          <div className="flex items-start gap-3 rounded-[18px] border border-dashed border-line-strong p-4" data-commencer-email-bientot="">
            <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-pearl text-gold-text">
              <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="m3.5 7 8.5 6 8.5-6" /></svg>
            </span>
            <div>
              <p className="flex flex-wrap items-center gap-2 text-[15px] font-medium text-ink">Avec une adresse e-mail <span className="rounded-full bg-sand px-2 py-0.5 text-[11.5px] font-semibold text-gold-text">Bientôt</span></p>
              <p className="mt-1 text-[13.5px] leading-relaxed text-muted">E-mail et mot de passe arrivent. Pour l'instant, Google seulement.</p>
            </div>
          </div>
          )}

          <p className="mt-8 text-center text-[15px] text-ink-soft">Déjà un compte ? <Link to={next !== "/dashboard" ? `/connexion?suite=${encodeURIComponent(next)}` : "/connexion"} className="font-medium text-gold-text underline decoration-gold/50 underline-offset-4 hover:decoration-gold-text" data-commencer-connexion="">Se connecter</Link></p>
          <div className="mt-7 flex gap-3 border-t border-line pt-6 text-[13.5px] leading-relaxed text-ink-soft">
            <IconLock size={17} className="mt-0.5 shrink-0 text-gold-text" />
            <p>Seuls ton e-mail vérifié, ton nom et ton mot de passe haché sont gardés. <Link to="/confidentialite" className="text-gold-text underline decoration-gold/50 underline-offset-4">Confidentialité</Link></p>
          </div>
        </motion.div>

        <div className="relative lg:pt-6">
          <h2 className="font-display text-[clamp(2rem,1.5rem+2vw,3rem)] font-medium leading-[1.05] text-fg">Du compte au premier fichier.</h2>
          <ol className="mt-8 grid gap-3" aria-label="Étapes">
            <Step n={1} title="Ton compte AETHRYON"><span className="start-chip"><IconCheck size={13} />{emailOn ? "Google ou e-mail" : "Google, un clic"}</span></Step>
            <Step n={2} title="Ton appareil">
              <span className="start-chip"><PlatformMark id="iphone" size={14} tone="dark" />Raccourci iPhone</span>
              <span className="start-chip"><PlatformMark id="chrome" size={14} tone="dark" />Extension</span>
            </Step>
            <Step n={3} title="Ton premier fichier">
              <span className="start-chip"><PlatformMark id="youtube" size={14} tone="dark" />YouTube</span>
              <span className="start-chip"><PlatformMark id="tiktok" size={14} tone="dark" />TikTok</span>
              <span className="start-chip"><PlatformMark id="x" size={14} tone="dark" />X</span>
              <span className="text-gold">→ MP4 · MP3</span>
            </Step>
          </ol>
          <Arrow shape="courbe" className="absolute -left-[70px] top-[42%] hidden h-[56px] w-[72px] rotate-180 lg:block" />
        </div>
      </div>
    </section>
  );
}

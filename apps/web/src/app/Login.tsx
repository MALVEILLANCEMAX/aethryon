// Connexion : « Continuer avec Google », et l'adresse e-mail avec son mot de passe quand le serveur a un relais
// d'e-mails (/api/config emailEnabled ; sinon « bientôt »). États : prêt, chargement, erreur, et message honnête si
// Google n'est pas encore configuré sur le serveur. Sur grand écran, la chouette suit l'action RÉELLE : concentrée
// pendant la redirection ou la vérification, interrogative sur une vraie erreur.
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { authMessage, signInWithDiscord, signInWithEmail, signInWithGoogle, DISCORD_LOGIN_ERRORS, LOGIN_ERRORS } from "../lib/auth.ts";
import { PlatformMark } from "../ui/brand/PlatformMark.tsx";
import { resetAll } from "../lib/store.ts";
import { Button } from "../ui/Button.tsx";
import { Field, PasswordInput, TextInput } from "../ui/Field.tsx";
import { ApiError } from "../lib/api.ts";
import { useConfig, useDocumentTitle, useMe } from "../lib/hooks.ts";
import { safeReturnPath } from "../lib/safe.ts";
import { DUR, EASE } from "../lib/motion.ts";
import { AethryonMascot } from "../ui/brand/AethryonMascot.tsx";
import { isStaticBoot } from "../lib/prerender.ts";
import { OwlMark } from "../ui/brand/OwlMark.tsx";
import { GoogleG, IconAlert, IconInfo, IconLock } from "../ui/Icon.tsx";

export default function Login() {
  useDocumentTitle("Connexion");
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const cfg = useConfig();
  const me = useMe();
  // « suite » : retour après la connexion (ex. page d'autorisation de l'extension), chemin relatif de ce
  // site seulement ; sinon l'espace personnel.
  const next = safeReturnPath(params.get("suite")) ?? "/dashboard";
  const errCode = params.get("error");
  // V3.5 : retour d'une connexion par Discord refusée (?discord=<motif>).
  const discordCode = params.get("discord");
  const firstError = errCode ? LOGIN_ERRORS[errCode] ?? "La connexion n'a pas abouti. Réessaie." : discordCode ? DISCORD_LOGIN_ERRORS[discordCode] ?? "La connexion Discord n'a pas abouti. Réessaie." : null;
  const [state, setState] = useState<"idle" | "loading" | "discord" | "error">(firstError ? "error" : "idle");
  const [message, setMessage] = useState<string | null>(firstError);

  useEffect(() => { if (me.data && !me.error) navigate(next, { replace: true }); }, [me.data, me.error, navigate, next]);

  const googleOff = cfg.data && !cfg.data.googleEnabled;
  // HTML pré-rendu : le formulaire (le serveur de production l'ouvre) ; serveur sans relais d'e-mails : « bientôt ».
  const emailOn = cfg.data ? cfg.data.emailEnabled === true : true;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pwState, setPwState] = useState<"idle" | "loading">("idle");
  const [pwError, setPwError] = useState<string | null>(null);
  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) { setPwError("Indique ton adresse e-mail et ton mot de passe."); return; }
    setPwState("loading");
    setPwError(null);
    try {
      await signInWithEmail(email.trim(), password);
      resetAll(); // le compte change : rien de l'état « déconnecté » ne doit rester en mémoire
      navigate(next, { replace: true });
    } catch (err) {
      setPwState("idle");
      setPwError(authMessage(err, "Connexion impossible. Réessaie dans un instant."));
    }
  };
  const go = async () => {
    setState("loading");
    setMessage(null);
    try {
      await signInWithGoogle(next);
    } catch (e) {
      setState("error");
      setMessage(e instanceof ApiError && !e.isNetwork ? e.message : "Connexion impossible. Vérifie ta connexion et réessaie.");
    }
  };
  const goDiscord = async () => {
    setState("discord");
    setMessage(null);
    try {
      await signInWithDiscord(next);
    } catch (e) {
      setState("error");
      setMessage(e instanceof ApiError && !e.isNetwork ? e.message : "Connexion impossible. Vérifie ta connexion et réessaie.");
    }
  };
  const discordOn = cfg.data?.discordLogin === true;
  const owl = state === "loading" || state === "discord" || pwState === "loading" ? "processing" : state === "error" || pwError ? "error" : "idle";

  return (
    <section className="relative overflow-hidden pb-24 pt-28 sm:pt-36">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(50%_45%_at_70%_35%,rgb(233_224_208/0.6),transparent_70%)]" />
      <div className="container-site grid items-center justify-items-center gap-12 lg:grid-cols-[minmax(0,460px)_minmax(0,380px)] lg:justify-center lg:gap-20">
        <motion.div
          initial={isStaticBoot() ? false : { opacity: 0, y: 16 }} // page pré-rendue : déjà affichée
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.reveal, ease: EASE.soft }}
          className="w-full max-w-[460px] rounded-[30px] border border-line bg-ivory p-7 shadow-raised sm:p-10"
        >
          <OwlMark size={46} blink />
          <h1 className="page-title mt-6">Connexion</h1>
          <p className="mt-3 text-[16px] leading-relaxed text-ink-soft">{emailOn
            ? (discordOn ? "Ton compte existant, avec Google, Discord ou ton adresse e-mail." : "Ton compte existant, avec Google ou avec ton adresse e-mail.")
            : (discordOn ? "Ton compte existant, avec Google ou Discord : pas de mot de passe à retenir." : "Ton compte existant, avec Google : pas de mot de passe à retenir.")}</p>
          {/* Ouverte par l'extension (fenêtre d'autorisation) : dire pourquoi, et qu'on y revient ensuite. */}
          {next.startsWith("/extension/autoriser") && (
            <p className="mt-4 flex gap-2.5 rounded-[16px] border border-line bg-pearl p-3.5 text-[14.5px] leading-relaxed text-ink" data-login-extension="">
              <IconInfo size={18} className="mt-0.5 shrink-0 text-gold-text" />
              Connecte-toi pour autoriser l'extension AETHRYON : tu reviendras ensuite à la page d'autorisation, dans cette même fenêtre.
            </p>
          )}
          {/* Ouverte depuis la page d'accord de Premiere Pro : même explication. */}
          {next.startsWith("/premiere/connecter") && (
            <p className="mt-4 flex gap-2.5 rounded-[16px] border border-line bg-pearl p-3.5 text-[14.5px] leading-relaxed text-ink" data-login-premiere="">
              <IconInfo size={18} className="mt-0.5 shrink-0 text-gold-text" />
              Connecte-toi pour autoriser AETHRYON pour Premiere Pro : tu reviendras ensuite à la page d'accord, avec le même code.
            </p>
          )}

          <div className="mt-8">
            <button
              type="button"
              onClick={go}
              disabled={state === "loading" || state === "discord" || !!googleOff || cfg.loading}
              aria-busy={state === "loading" || undefined}
              className="relative flex h-14 w-full items-center justify-center gap-3 rounded-full border border-line-strong bg-white text-[16.5px] font-medium text-[#1f1f1f] shadow-card transition-[background-color,translate,box-shadow] duration-200 hover:-translate-y-px hover:shadow-raised active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <AnimatePresence mode="wait" initial={false}>
                {state === "loading" ? (
                  <motion.span key="l" className="flex items-center gap-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <span className="size-5 animate-spin rounded-full border-2 border-[#1f1f1f] border-r-transparent motion-reduce:animate-none" />
                    Redirection vers Google…
                  </motion.span>
                ) : (
                  <motion.span key="i" className="flex items-center gap-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <GoogleG size={20} /> Continuer avec Google
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
            {/* V3.5 : compte dont Discord est déjà lié (Espace › Discord) ; jamais de création de compte par Discord. */}
            {discordOn && (
              <button
                type="button"
                onClick={goDiscord}
                disabled={state === "loading" || state === "discord"}
                aria-busy={state === "discord" || undefined}
                data-login-discord=""
                className="relative mt-3 flex h-14 w-full items-center justify-center gap-3 rounded-full border border-line-strong bg-ivory text-[16.5px] font-medium text-ink shadow-card transition-[background-color,translate,box-shadow] duration-200 hover:-translate-y-px hover:bg-pearl hover:shadow-raised active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {state === "discord" ? (
                  <span className="flex items-center gap-3"><span className="size-5 animate-spin rounded-full border-2 border-ink border-r-transparent motion-reduce:animate-none" />Redirection vers Discord…</span>
                ) : (
                  <span className="flex items-center gap-3"><PlatformMark id="discord" size={20} /> Continuer avec Discord</span>
                )}
              </button>
            )}
            <AnimatePresence>
              {googleOff && (
                <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-4 flex gap-2.5 rounded-[16px] border border-warn/20 bg-warn-bg p-3.5 text-[14.5px] text-warn">
                  <IconInfo size={18} className="mt-0.5 shrink-0" />
                  La connexion Google n'est pas encore configurée sur ce serveur. Elle sera disponible dès que l'administrateur l'aura activée.
                </motion.p>
              )}
              {state === "error" && message && (
                <motion.p role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 flex gap-2.5 rounded-[16px] border border-bad/20 bg-bad-bg p-3.5 text-[14.5px] text-bad">
                  <IconAlert size={18} className="mt-0.5 shrink-0" />
                  {message}
                </motion.p>
              )}
            </AnimatePresence>
            {cfg.data && !cfg.data.signupsOpen && <p className="mt-4 text-[14px] text-muted">Les nouvelles inscriptions sont fermées : seuls les comptes existants peuvent se connecter.</p>}
            {!emailOn && <p className="mt-4 text-[13.5px] text-muted" data-login-email-bientot="">Connexion par e-mail et mot de passe : bientôt.</p>}
          </div>
          {emailOn && (
            <>
              <div className="my-7 flex items-center gap-3 text-[13px] text-muted" aria-hidden="true"><span className="h-px flex-1 bg-line" />ou<span className="h-px flex-1 bg-line" /></div>
              <form onSubmit={signIn} noValidate className="grid gap-4" data-login-email="">
                <Field id="connexion-email" label="Adresse e-mail">
                  <TextInput id="connexion-email" type="email" inputMode="email" autoComplete="username" autoCapitalize="off" spellCheck={false} maxLength={254}
                    value={email} onChange={(e) => { setEmail(e.target.value); setPwError(null); }} hasError={!!pwError} />
                </Field>
                <Field id="connexion-mdp" label="Mot de passe" error={pwError}>
                  <PasswordInput id="connexion-mdp" autoComplete="current-password" maxLength={128} value={password} onChange={(e) => { setPassword(e.target.value); setPwError(null); }} hasError={!!pwError} />
                </Field>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <Button type="submit" variant="primary" className="h-12 px-6" loading={pwState === "loading"}>{pwState === "loading" ? "Connexion…" : "Se connecter"}</Button>
                  <Link to="/mot-de-passe" className="inline-flex min-h-11 items-center text-[14.5px] text-gold-text underline decoration-gold/50 underline-offset-4 hover:decoration-gold-text" data-login-oubli="">Mot de passe oublié ?</Link>
                </div>
              </form>
            </>
          )}
          <p className="mt-7 text-center text-[15px] text-ink-soft">Pas encore de compte ? <Link to={params.get("suite") && next !== "/dashboard" ? `/commencer?suite=${encodeURIComponent(next)}` : "/commencer"} className="font-medium text-gold-text underline decoration-gold/50 underline-offset-4 hover:decoration-gold-text" data-login-commencer="">Commencer</Link></p>

          <div className="mt-8 flex gap-3 border-t border-line pt-6 text-[14px] leading-relaxed text-ink-soft">
            <IconLock size={18} className="mt-0.5 shrink-0 text-gold-text" />
            <p>Seuls ton e-mail vérifié, ton nom et ton mot de passe haché sont gardés ; aucun accès à ton compte Google. <Link to="/confidentialite" className="text-gold-text underline decoration-gold/50 underline-offset-4 hover:decoration-gold-text">Confidentialité</Link></p>
          </div>
        </motion.div>
        <div className="relative hidden w-full max-w-[380px] lg:block">
          <div aria-hidden className="arch-line absolute inset-x-[8%] bottom-[7%] top-[3%] bg-[linear-gradient(180deg,rgb(244_239_231/0.9),rgb(250_248_243/0))]" />
          <div aria-hidden className="floor-shadow absolute bottom-[4.5%] left-1/2 h-[7%] w-[58%] -translate-x-1/2" />
          <AethryonMascot state={owl} size={380} look={-1} className="relative w-full" />
        </div>
      </div>
    </section>
  );
}

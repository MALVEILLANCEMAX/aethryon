// Connexion : « Continuer avec Google », et l'adresse e-mail avec son mot de passe quand le serveur a un relais
// d'e-mails (/api/config emailEnabled ; sinon « bientôt »). États : prêt, chargement, erreur, et message honnête si
// Google n'est pas encore configuré sur le serveur. Sur grand écran, la chouette suit l'action RÉELLE : concentrée
// pendant la redirection ou la vérification, interrogative sur une vraie erreur.
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { authMessage, signInWithDiscord, signInWithEmail, signInWithGoogle, DISCORD_LOGIN_ERRORS, LOGIN_ERRORS } from "../lib/auth.ts";
import { resetAll } from "../lib/store.ts";
import { Button } from "../ui/Button.tsx";
import { Field, PasswordInput, TextInput } from "../ui/Field.tsx";
import { ApiError } from "../lib/api.ts";
import { useConfig, useDocumentTitle, useMe } from "../lib/hooks.ts";
import { safeReturnPath } from "../lib/safe.ts";
import { DUR, EASE } from "../lib/motion.ts";
import { isStaticBoot } from "../lib/prerender.ts";
import { OwlMark } from "../ui/brand/OwlMark.tsx";
import { Seuil } from "../ui/passage/Passage.tsx";
import { GoogleG, IconAlert, IconInfo, IconLock } from "../ui/Icon.tsx";
import { BoutonDiscord } from "../ui/brand/BoutonDiscord.tsx";

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

  return (
    <section className="relative overflow-hidden pb-24 pt-28 sm:pt-36">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10" />
      <div className="container-site grid items-center justify-items-center gap-12">
        <Seuil className="max-w-[460px]" couronne={<OwlMark size={42} blink />}>
        <motion.div
          initial={isStaticBoot() ? false : { opacity: 0, y: 16 }} // page pré-rendue : déjà affichée
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.reveal, ease: EASE.soft }}
          className="seuil-carte w-full rounded-panel border border-line bg-ivory p-7 shadow-raised sm:p-10"
        >
          <h1 className="page-title">Connexion</h1>
          <p className="mt-3 text-corps leading-relaxed text-ink-soft">{emailOn
            ? (discordOn ? "Ton compte existant, avec Google, Discord ou ton adresse e-mail." : "Ton compte existant, avec Google ou avec ton adresse e-mail.")
            : (discordOn ? "Ton compte existant, avec Google ou Discord : pas de mot de passe à retenir." : "Ton compte existant, avec Google : pas de mot de passe à retenir.")}</p>
          {/* Ouverte par l'extension (fenêtre d'autorisation) : dire pourquoi, et qu'on y revient ensuite. */}
          {next.startsWith("/extension/autoriser") && (
            <p className="mt-4 flex gap-2.5 rounded-card border border-line bg-pearl p-3.5 text-ui leading-relaxed text-ink" data-login-extension="">
              <IconInfo size={18} className="mt-0.5 shrink-0 text-gold-text" />
              Connecte-toi pour autoriser l'extension AETHRYON : tu reviendras ensuite à la page d'autorisation, dans cette même fenêtre.
            </p>
          )}
          {/* Ouverte depuis la page d'accord de Premiere Pro : même explication. */}
          {next.startsWith("/premiere/connecter") && (
            <p className="mt-4 flex gap-2.5 rounded-card border border-line bg-pearl p-3.5 text-ui leading-relaxed text-ink" data-login-premiere="">
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
              className="relative flex h-14 w-full items-center justify-center gap-3 rounded-full border border-[#747775] bg-[#fff] text-corps font-medium text-[#1f1f1f] shadow-card transition-[background-color,translate,box-shadow] duration-200 hover:-translate-y-px hover:shadow-raised active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
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
              <BoutonDiscord onClick={goDiscord} disabled={state === "loading" || state === "discord"} chargement={state === "discord"}
                className="mt-3 h-14 w-full text-corps" data-login-discord="">
                {state === "discord" ? "Redirection vers Discord…" : "Continuer avec Discord"}
              </BoutonDiscord>
            )}
            <AnimatePresence>
              {googleOff && (
                <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-4 flex gap-2.5 rounded-card border border-warn/20 bg-warn-bg p-3.5 text-ui text-warn">
                  <IconInfo size={18} className="mt-0.5 shrink-0" />
                  La connexion Google n'est pas encore configurée sur ce serveur. Elle sera disponible dès que l'administrateur l'aura activée.
                </motion.p>
              )}
              {state === "error" && message && (
                <motion.p role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 flex gap-2.5 rounded-card border border-bad/20 bg-bad-bg p-3.5 text-ui text-bad">
                  <IconAlert size={18} className="mt-0.5 shrink-0" />
                  {message}
                </motion.p>
              )}
            </AnimatePresence>
            {cfg.data && !cfg.data.signupsOpen && <p className="mt-4 text-ui text-muted">Les nouvelles inscriptions sont fermées : seuls les comptes existants peuvent se connecter.</p>}
            {!emailOn && <p className="mt-4 text-note text-muted" data-login-email-bientot="">Connexion par e-mail et mot de passe : bientôt.</p>}
          </div>
          {emailOn && (
            <>
              <div className="my-7 flex items-center gap-3 text-note text-muted" aria-hidden="true"><span className="h-px flex-1 bg-line" />ou<span className="h-px flex-1 bg-line" /></div>
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
                  <Link to="/mot-de-passe" className="inline-flex min-h-11 items-center text-ui text-gold-text underline decoration-gold/50 underline-offset-4 hover:decoration-gold-text" data-login-oubli="">Mot de passe oublié ?</Link>
                </div>
              </form>
            </>
          )}
          <p className="mt-7 text-center text-ui text-ink-soft">Pas encore de compte ? <Link to={params.get("suite") && next !== "/dashboard" ? `/commencer?suite=${encodeURIComponent(next)}` : "/commencer"} className="font-medium text-gold-text underline decoration-gold/50 underline-offset-4 hover:decoration-gold-text" data-login-commencer="">Commencer</Link></p>

          <div className="mt-8 flex gap-3 border-t border-line pt-6 text-ui leading-relaxed text-ink-soft">
            <IconLock size={18} className="mt-0.5 shrink-0 text-gold-text" />
            <p>Seuls ton e-mail vérifié, ton nom et ton mot de passe haché sont gardés ; aucun accès à ton compte Google. <Link to="/confidentialite" className="text-gold-text underline decoration-gold/50 underline-offset-4 hover:decoration-gold-text">Confidentialité</Link></p>
          </div>
        </motion.div>
        </Seuil>
      </div>
    </section>
  );
}

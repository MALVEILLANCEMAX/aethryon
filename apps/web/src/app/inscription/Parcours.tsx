// Inscription par e-mail, sans quitter la page (/commencer) : 1. l'adresse → 2. le code à 6 chiffres reçu par e-mail
// (ui/CodeInput.tsx ; « Renvoyer » après le délai du serveur) → 3. le nom et le mot de passe (ui/PasswordStrength.tsx),
// puis l'espace. Le lien de l'e-mail reste une autre porte (/inscription), qui mène à la même étape 3 (ProfileStep).
// Mémoire de l'onglet (sessionStorage, essais protégés) : l'étape, l'adresse et, après le code, le jeton de 15 minutes,
// pour qu'un rechargement (retour depuis Mail sur iPhone) reprenne au bon endroit ; effacée à la fin ou à l'abandon.
// Réponses du serveur identiques qu'un compte existe ou non : la page dit « si tu peux créer un compte, un code
// t'attend », jamais plus.
import { useEffect, useRef, useState, type FormEvent, type Ref } from "react";
import { useNavigate } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { ApiError } from "../../lib/api.ts";
import { authMessage, finishSignup, requestSignup, verifySignupCode, type SignupRequest } from "../../lib/auth.ts";
import { useCalm } from "../../lib/hooks.ts";
import { DUR, EASE } from "../../lib/motion.ts";
import { passwordProblem } from "../../lib/password.ts";
import { resetAll } from "../../lib/store.ts";
import { Button } from "../../ui/Button.tsx";
import { CodeInput, type CodeStatus } from "../../ui/CodeInput.tsx";
import { Field, FormNote, TextInput } from "../../ui/Field.tsx";
import { IconAlert, IconArrowRight, IconCheck, IconMail } from "../../ui/Icon.tsx";
import { PasswordStrength } from "../../ui/PasswordStrength.tsx";

const NB = " ";
const KEY = "aethryon:inscription";
const link = "font-medium text-gold-text underline decoration-gold/50 underline-offset-4 hover:decoration-gold-text";

type Step =
  | { kind: "email" }
  | { kind: "code"; email: string; sentAt: number; resendAfter: number }
  | { kind: "profil"; email: string; token: string };

const save = (s: Step) => { try { if (s.kind === "email") sessionStorage.removeItem(KEY); else sessionStorage.setItem(KEY, JSON.stringify({ ...s, at: Date.now() })); } catch { /* stockage indisponible */ } };
function load(): Step {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return { kind: "email" };
    const s = JSON.parse(raw) as Step & { at: number };
    // Au-delà de 15 minutes, le code et le jeton ne valent plus rien : on repart de l'adresse.
    if (Date.now() - s.at > 15 * 60_000) { sessionStorage.removeItem(KEY); return { kind: "email" }; }
    return s;
  } catch { return { kind: "email" }; }
}

/** Trois points : où l'on en est (une vraie suite d'étapes). */
function Progress({ at }: { at: 1 | 2 | 3 }) {
  return (
    <ol className="signup-progress" aria-label={`Étape ${at} sur 3`}>
      {[1, 2, 3].map((n) => <li key={n} className={n < at ? "is-done" : n === at ? "is-on" : undefined} aria-hidden="true" />)}
    </ol>
  );
}

/** Étape 3, partagée avec la page du lien (qui a déjà son titre : `titled` faux) : le nom, le mot de passe (même
 * politique que le serveur), le compte. */
export function ProfileStep({ token, email, onExpired, headingRef, titled = true, next = "/dashboard" }: { token: string; email: string; onExpired: () => void; headingRef?: Ref<HTMLHeadingElement>; titled?: boolean; next?: string }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ field: "name" | "password" | "form"; text: string } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError({ field: "name", text: "Indique un nom : il s'affiche dans ton espace." });
    const problem = passwordProblem(password, { email, name });
    if (problem) return setError({ field: "password", text: problem.message });
    setSending(true);
    setError(null);
    try {
      await finishSignup(token, name.trim(), password);
      save({ kind: "email" });
      resetAll();
      navigate(next, { replace: true });
    } catch (err) {
      setSending(false);
      const code = err instanceof ApiError ? err.code : "";
      if (code === "invalid_token") { save({ kind: "email" }); onExpired(); return; }
      if (code === "invalid_name") setError({ field: "name", text: "Indique un nom de 80 caractères au plus." });
      else if (code.startsWith("password_") || code === "invalid_password") setError({ field: "password", text: authMessage(err, "Ce mot de passe n'est pas accepté.") });
      else if (code === "account_exists") setError({ field: "form", text: "Un compte existe déjà avec cette adresse : connecte-toi." });
      else setError({ field: "form", text: authMessage(err, "Le compte n'a pas pu être créé. Réessaie dans un instant.") });
    }
  };
  return (
    <form onSubmit={submit} noValidate className="grid gap-5" data-etape="profil">
      <div>
        {titled && <h2 ref={headingRef} tabIndex={-1} className="signup-title">Choisis ton nom et ton mot de passe</h2>}
        <p className={titled ? "signup-lead" : "signup-lead is-alone"}><IconCheck size={16} className="text-ok" />Adresse vérifiée{NB}: <span className="font-medium text-ink [overflow-wrap:anywhere]" data-inscription-email="">{email}</span></p>
      </div>
      {/* Pour le gestionnaire de mots de passe : l'identifiant du compte, invisible. */}
      <input type="email" name="email" autoComplete="username" value={email} readOnly hidden />
      <Field id="inscription-nom" label="Ton nom" error={error?.field === "name" ? error.text : null} hint="Un prénom ou un pseudo : il s'affiche dans ton espace.">
        <TextInput id="inscription-nom" autoComplete="name" maxLength={80} value={name} hasHint hasError={error?.field === "name"}
          onChange={(e) => { setName(e.target.value); if (error?.field === "name") setError(null); }} />
      </Field>
      <PasswordStrength id="inscription-mdp" label="Mot de passe" value={password} context={{ email, name }} error={error?.field === "password" ? error.text : null}
        onValueChange={(v) => { setPassword(v); if (error?.field === "password") setError(null); }}
        tip="Astuce : une phrase de quelques mots est solide et facile à retenir." />
      {error?.field === "form" && <FormNote tone="bad" icon={<IconAlert size={18} />}>{error.text}</FormNote>}
      <Button type="submit" variant="primary" className="h-12 w-full" loading={sending} trailing={sending ? undefined : <IconArrowRight size={16} />}>
        {sending ? "Création du compte…" : "Créer mon compte"}
      </Button>
      <p className="text-[13px] leading-relaxed text-muted">Ton mot de passe est haché{NB}: personne ne peut le lire, pas même nous.</p>
    </form>
  );
}

/** Le parcours complet, pour /commencer. `onStep` : la page masque Google pendant les étapes 2 et 3. */
export function EmailSignupFlow({ disabled, onStep, next }: { disabled: boolean; onStep?: (kind: Step["kind"]) => void; next?: string }) {
  const calm = useCalm();
  // Toujours l'étape 1 au premier rendu (page pré-rendue : même HTML qu'au serveur), puis reprise de l'onglet.
  const [step, setStepState] = useState<Step>({ kind: "email" });
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const setStep = (s: Step) => { save(s); setStepState(s); moved.current = true; };
  useEffect(() => {
    const s = load();
    if (s.kind !== "email") { setStepState(s); setEmail(s.email); }
  }, []);
  useEffect(() => { onStep?.(step.kind); }, [step.kind, onStep]);
  // Changement d'étape : le titre de la nouvelle étape reçoit le focus (lecteurs d'écran, clavier).
  useEffect(() => { if (moved.current) heading.current?.focus(); }, [step.kind]);

  // ---- étape 1 : l'adresse
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const send = async (target: string): Promise<SignupRequest | null> => {
    try { return await requestSignup(target); } catch (err) { setEmailError(authMessage(err, "L'envoi n'a pas abouti. Réessaie dans un instant.")); return null; }
  };
  const submitEmail = async (e: FormEvent) => {
    e.preventDefault();
    const v = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { setEmailError("Indique une adresse e-mail valide."); return; }
    setSending(true);
    setEmailError(null);
    const r = await send(v);
    setSending(false);
    if (r) setStep({ kind: "code", email: v, sentAt: Date.now(), resendAfter: r.resendAfterSeconds });
  };

  // ---- étape 2 : le code
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<CodeStatus>("idle");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (step.kind !== "code") return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step.kind]);
  const wait = step.kind === "code" ? Math.max(0, Math.ceil(step.resendAfter - (now - step.sentAt) / 1000)) : 0;
  const verify = async (value: string) => {
    if (step.kind !== "code") return;
    setStatus("verifying");
    setCodeError(null);
    try {
      const r = await verifySignupCode(step.email, value);
      setStatus("success");
      window.setTimeout(() => setStep({ kind: "profil", email: r.email, token: r.token }), calm ? 0 : 650);
    } catch (err) {
      setStatus("error");
      setCodeError(authMessage(err, "La vérification n'a pas abouti. Réessaie dans un instant."));
      window.setTimeout(() => { setCode(""); setStatus("idle"); }, calm ? 0 : 900);
    }
  };
  const resend = async () => {
    if (step.kind !== "code" || wait > 0) return;
    setCodeError(null);
    const r = await send(step.email);
    if (r) { setCode(""); setStatus("idle"); setStep({ ...step, sentAt: Date.now(), resendAfter: r.resendAfterSeconds }); }
  };

  const motionProps = calm
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: DUR.calm } }
    : { initial: { opacity: 0, x: 18 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -12, transition: { duration: DUR.exit } }, transition: { duration: DUR.component, ease: EASE.soft } };

  return (
    <div className="signup" data-inscription-etape={step.kind}>
      <AnimatePresence mode="wait" initial={false}>
        {step.kind === "email" && (
          <motion.form key="email" {...motionProps} onSubmit={submitEmail} noValidate className="grid gap-3" data-commencer-email="">
            <Field id="inscription-email" label="Adresse e-mail" error={emailError} hint="Un code à 6 chiffres t'y attendra.">
              <TextInput id="inscription-email" type="email" inputMode="email" autoComplete="email" autoCapitalize="off" spellCheck={false} maxLength={254}
                value={email} onChange={(e) => { setEmail(e.target.value); setEmailError(null); }} disabled={disabled} hasHint hasError={!!emailError} placeholder="toi@exemple.fr" />
            </Field>
            <Button type="submit" variant="primary" className="h-12 w-full" loading={sending} disabled={disabled} icon={<IconMail size={18} />}>
              {sending ? "Envoi…" : "Recevoir le code"}
            </Button>
          </motion.form>
        )}
        {step.kind === "code" && (
          <motion.div key="code" {...motionProps} className="grid gap-5" data-etape="code">
            <Progress at={2} />
            <div>
              <h2 ref={heading} tabIndex={-1} className="signup-title">Saisis le code reçu</h2>
              <p className="signup-lead">
                Envoyé à <span className="font-medium text-ink [overflow-wrap:anywhere]" data-code-email="">{step.email}</span>{NB}·{" "}
                <button type="button" className={`${link} inline-flex min-h-11 items-center`} onClick={() => { setCode(""); setStatus("idle"); setCodeError(null); setStep({ kind: "email" }); }}>Modifier</button>
              </p>
            </div>
            <CodeInput id="inscription-code" label="Code à 6 chiffres reçu par e-mail" value={code} status={status} autoFocus
              onChange={(v) => { setCode(v); if (status === "error") setStatus("idle"); if (codeError) setCodeError(null); }}
              onComplete={(v) => void verify(v)} describedBy={codeError ? "inscription-code-erreur" : "inscription-code-aide"} />
            {codeError
              ? <p id="inscription-code-erreur" role="alert" className="text-[14px] leading-relaxed text-bad">{codeError}</p>
              : <p id="inscription-code-aide" className="text-[14px] leading-relaxed text-muted">Si cette adresse peut créer un compte, un code t'attend (valable 10 minutes). Rien reçu{NB}? Regarde dans les indésirables.</p>}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <Button variant="secondary" className="h-11" disabled={wait > 0 || status === "verifying"} onClick={() => void resend()} data-renvoyer="">
                {wait > 0 ? <>Renvoyer dans <span className="tabular">{wait}{NB}s</span></> : "Renvoyer le code"}
              </Button>
              <p className="text-[13px] text-muted">Tu peux aussi ouvrir le lien de l'e-mail.</p>
            </div>
            <span className="sr-only" role="status">{status === "verifying" ? "Vérification du code…" : status === "success" ? "Code juste." : ""}</span>
          </motion.div>
        )}
        {step.kind === "profil" && (
          <motion.div key="profil" {...motionProps} className="grid gap-5">
            <Progress at={3} />
            <ProfileStep token={step.token} email={step.email} headingRef={heading} next={next}
              onExpired={() => { setStep({ kind: "email" }); setEmailError("Le délai est dépassé : redemande un code, c'est immédiat."); }} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

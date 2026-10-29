// /mot-de-passe (demande d'un lien) et /mot-de-passe/nouveau (choix du nouveau mot de passe) : Better Auth, routes
// /api/auth/request-password-reset et /api/auth/reset-password (account, src/auth.ts). La demande répond pareil que
// l'adresse ait un compte ou non ; un compte Google peut ainsi AJOUTER un mot de passe (l'adresse est prouvée par le
// lien). Le jeton du lien arrive après le « # » (dans aucun journal), lu une fois puis retiré de l'adresse.
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { authMessage, requestPasswordReset, resetPassword, takeHashToken } from "../lib/auth.ts";
import { passwordProblem } from "../lib/password.ts";
import { ApiError } from "../lib/api.ts";
import { useConfig, useDocumentTitle } from "../lib/hooks.ts";
import { Button } from "../ui/Button.tsx";
import { Field, FormNote, TextInput } from "../ui/Field.tsx";
import { IconCheck, IconInfo, IconMail } from "../ui/Icon.tsx";
import { PasswordStrength } from "../ui/PasswordStrength.tsx";
import { CompteCarte } from "./CompteCarte.tsx";

const link = "font-medium text-gold-text underline decoration-gold/50 underline-offset-4 hover:decoration-gold-text";
const NB = " ";

export function MotDePasseOublie() {
  useDocumentTitle("Mot de passe oublié");
  const cfg = useConfig();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const off = cfg.data ? cfg.data.emailEnabled !== true : false;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { setError("Indique une adresse e-mail valide."); return; }
    setState("sending");
    setError(null);
    try {
      await requestPasswordReset(v);
      setState("sent");
    } catch (err) {
      setState("idle");
      setError(authMessage(err, "L'envoi n'a pas abouti. Réessaie dans un instant."));
    }
  };
  return (
    <CompteCarte data="mot-de-passe" title="Mot de passe oublié" lead="Indique l'adresse de ton compte : un lien t'y attendra pour choisir un nouveau mot de passe. Compte créé avec Google ? Ce lien t'en ajoute un.">
      {off ? (
        <FormNote tone="warn" icon={<IconInfo size={18} />}>Les mots de passe ne sont pas encore ouverts sur ce serveur{NB}: connecte-toi avec Google.</FormNote>
      ) : state === "sent" ? (
        <div className="rounded-panel border border-line bg-pearl p-5" role="status" data-mdp-envoye="">
          <p className="flex items-center gap-2.5 text-corps font-semibold text-ink"><IconMail size={20} className="text-gold-text" />Regarde ta boîte mail</p>
          <p className="mt-2 text-ui leading-relaxed text-ink-soft">Si cette adresse a un compte AETHRYON, un lien valable une heure vient de partir. Rien reçu{NB}? Regarde dans les indésirables, ou vérifie l'adresse.</p>
          <button type="button" onClick={() => setState("idle")} className={`${link} mt-3 inline-flex min-h-11 items-center text-ui`}>Changer d'adresse</button>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="grid gap-4">
          <Field id="oubli-email" label="Adresse e-mail" error={error}>
            <TextInput id="oubli-email" type="email" inputMode="email" autoComplete="email" autoCapitalize="off" spellCheck={false} maxLength={254}
              value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} hasError={!!error} />
          </Field>
          <Button type="submit" variant="primary" className="h-12 w-full" loading={state === "sending"} icon={<IconMail size={18} />}>{state === "sending" ? "Envoi…" : "Recevoir le lien"}</Button>
        </form>
      )}
      <p className="mt-7 text-center text-ui text-ink-soft"><Link to="/connexion" className={link}>Retour à la connexion</Link></p>
    </CompteCarte>
  );
}

export function NouveauMotDePasse() {
  useDocumentTitle("Nouveau mot de passe");
  const [token] = useState(takeHashToken);
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "invalid">(token ? "idle" : "invalid");
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(password);
    if (problem) { setError(problem.message); return; }
    setState("sending");
    setError(null);
    try {
      await resetPassword(token!, password);
      setState("done");
    } catch (err) {
      if (err instanceof ApiError && err.code.toLowerCase() === "invalid_token") { setState("invalid"); return; }
      setState("idle");
      setError(authMessage(err, "Le mot de passe n'a pas pu être changé. Réessaie dans un instant."));
    }
  };
  if (state === "invalid") {
    return (
      <CompteCarte data="nouveau-mdp-invalide" title="Ce lien n'est plus valable" lead="Un lien de mot de passe sert une seule fois et une heure au plus. Demande-en un nouveau.">
        <Link to="/mot-de-passe" className="inline-flex h-12 items-center rounded-full bg-sunken px-6 text-ui font-medium text-fg">Recevoir un nouveau lien</Link>
      </CompteCarte>
    );
  }
  if (state === "done") {
    return (
      <CompteCarte data="nouveau-mdp-fait" title="Mot de passe enregistré" lead="Tes autres sessions ont été fermées par sécurité. Connecte-toi avec ton nouveau mot de passe.">
        <FormNote tone="ok" icon={<IconCheck size={18} />}>C'est fait{NB}: ce mot de passe sert dès maintenant.</FormNote>
        <Link to="/connexion" className="mt-6 inline-flex h-12 items-center rounded-full bg-sunken px-6 text-ui font-medium text-fg" data-nouveau-mdp-connexion="">Se connecter</Link>
      </CompteCarte>
    );
  }
  return (
    <CompteCarte data="nouveau-mdp" title="Choisis un nouveau mot de passe">
      <form onSubmit={submit} noValidate className="grid gap-5">
        <PasswordStrength id="nouveau-mdp" label="Nouveau mot de passe" value={password} error={error} onValueChange={(v) => { setPassword(v); setError(null); }}
          tip="Astuce : une phrase de quelques mots est solide et facile à retenir." />
        <Button type="submit" variant="primary" className="h-12 w-full" loading={state === "sending"}>{state === "sending" ? "Enregistrement…" : "Enregistrer le mot de passe"}</Button>
      </form>
    </CompteCarte>
  );
}

// Espace personnel › Ton compte (/dashboard/compte) : comment on se connecte à ce compte (Google relié, mot de passe
// défini : /api/me « login », lu sur le serveur), le changement de mot de passe (Better Auth /change-password : mot de
// passe actuel exigé, autres sessions fermées), l'ajout d'un mot de passe à un compte Google (lien « mot de passe
// oublié » envoyé à SON adresse, qui prouve qu'elle lui appartient), puis l'export et la suppression des données.
import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { authMessage, changePassword, PASSWORD_MAX, requestPasswordReset } from "../lib/auth.ts";
import { passwordProblem } from "../lib/password.ts";
import { useConfig, useDocumentTitle, useMe } from "../lib/hooks.ts";
import { Button } from "../ui/Button.tsx";
import { Field, FormNote, PasswordInput } from "../ui/Field.tsx";
import { GoogleG, IconCheck, IconDownload, IconInfo, IconLock, IconMail, IconTrash } from "../ui/Icon.tsx";
import { PasswordStrength } from "../ui/PasswordStrength.tsx";
import { useToast } from "../ui/Toasts.tsx";
import { PageHeader } from "./common.tsx";

const NB = " ";
const link = "text-gold-text underline decoration-gold/50 underline-offset-4 transition-colors hover:decoration-gold-text";

function Card({ title, id, children, data }: { title: string; id: string; children: ReactNode; data: string }) {
  return (
    <section aria-labelledby={id} className="rounded-[26px] border border-line bg-ivory p-5 shadow-card sm:p-7" data-compte-section={data}>
      <h2 id={id} className="font-display text-[22px] font-medium">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Method({ icon, name, on, onText, offText, hint }: { icon: ReactNode; name: string; on: boolean; onText: string; offText: string; hint?: ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-3.5" data-methode={name} data-etat={on ? "oui" : "non"}>
      <span className="grid size-10 shrink-0 place-items-center rounded-[13px] bg-pearl text-gold-text ring-1 ring-line">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[15.5px] font-medium text-ink">
          {name}
          <span className={on ? "inline-flex items-center gap-1 rounded-full bg-ok-bg px-2.5 py-0.5 text-[12.5px] font-semibold text-ok" : "rounded-full bg-sand/70 px-2.5 py-0.5 text-[12.5px] font-semibold text-ink-soft"}>
            {on ? <><IconCheck size={13} />{onText}</> : offText}
          </span>
        </p>
        {hint && <p className="mt-1 text-[14px] leading-relaxed text-muted">{hint}</p>}
      </div>
    </li>
  );
}

/** Changement de mot de passe : actuel + nouveau ; la session en cours reste ouverte, les autres sont fermées. */
function ChangePassword() {
  const toast = useToast();
  const me = useMe();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ field: "current" | "next"; text: string } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!current) return setError({ field: "current", text: "Indique ton mot de passe actuel." });
    const problem = passwordProblem(next, { email: me.data?.user.email, name: me.data?.user.name });
    if (problem) return setError({ field: "next", text: problem.message });
    if (next === current) return setError({ field: "next", text: "Choisis un mot de passe différent de l'actuel." });
    setSending(true);
    setError(null);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      toast.show("success", "Mot de passe changé", "Tes autres sessions ont été fermées ; celle-ci reste ouverte.");
    } catch (err) {
      const text = authMessage(err, "Le mot de passe n'a pas pu être changé. Réessaie dans un instant.");
      setError({ field: /actuel/.test(text) ? "current" : "next", text });
    } finally {
      setSending(false);
    }
  };
  return (
    <form onSubmit={submit} noValidate className="grid max-w-md gap-5" data-changer-mdp="">
      {/* Pour le gestionnaire de mots de passe : l'identifiant du compte, invisible. */}
      <input type="email" name="email" autoComplete="username" value={me.data?.user.email ?? ""} readOnly hidden />
      <Field id="mdp-actuel" label="Mot de passe actuel" error={error?.field === "current" ? error.text : null}>
        <PasswordInput id="mdp-actuel" autoComplete="current-password" maxLength={PASSWORD_MAX} value={current}
          onChange={(e) => { setCurrent(e.target.value); if (error?.field === "current") setError(null); }} hasError={error?.field === "current"} />
      </Field>
      <PasswordStrength id="mdp-nouveau" label="Nouveau mot de passe" value={next} error={error?.field === "next" ? error.text : null}
        context={{ email: me.data?.user.email, name: me.data?.user.name }}
        onValueChange={(v) => { setNext(v); if (error?.field === "next") setError(null); }} />
      <div><Button type="submit" variant="primary" className="h-12 px-6" loading={sending}>{sending ? "Enregistrement…" : "Changer le mot de passe"}</Button></div>
    </form>
  );
}

/** Compte Google sans mot de passe : un lien envoyé à SON adresse permet d'en ajouter un. */
function AddPassword({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setState("sending");
    setError(null);
    try {
      await requestPasswordReset(email);
      setState("sent");
    } catch (err) {
      setState("idle");
      setError(authMessage(err, "L'envoi n'a pas abouti. Réessaie dans un instant."));
    }
  };
  if (state === "sent") {
    return <FormNote tone="ok" icon={<IconMail size={18} />}>Un lien valable une heure vient de partir vers <span className="font-medium [overflow-wrap:anywhere]">{email}</span>{NB}: ouvre-le pour choisir ton mot de passe. Rien reçu{NB}? Regarde dans les indésirables.</FormNote>;
  }
  return (
    <div className="grid gap-3" data-ajouter-mdp="">
      <p className="max-w-xl text-[15px] leading-relaxed text-ink-soft">Tu te connectes avec Google. Pour te connecter aussi avec un mot de passe, reçois un lien à <span className="font-medium text-ink [overflow-wrap:anywhere]">{email}</span>{NB}: il prouve que l'adresse est à toi.</p>
      {error && <FormNote tone="bad" icon={<IconInfo size={18} />}>{error}</FormNote>}
      <div><Button variant="secondary" className="h-12 px-6" loading={state === "sending"} icon={<IconMail size={18} />} onClick={send}>{state === "sending" ? "Envoi…" : "Recevoir le lien"}</Button></div>
    </div>
  );
}

export default function Compte() {
  useDocumentTitle("Ton compte");
  const me = useMe();
  const cfg = useConfig();
  const user = me.data?.user;
  const login = me.data?.login;
  const emailOn = cfg.data?.emailEnabled === true;
  if (!user) return null; // DashboardLayout affiche déjà le chargement ou l'erreur
  return (
    <div data-page-compte="">
      <PageHeader title="Ton compte" lead="Comment tu te connectes, ton mot de passe, et tes données." />
      <div className="mt-8 grid gap-5">
        <Card title="Connexion" id="compte-connexion" data="connexion">
          <p className="text-[15px] text-ink-soft">Adresse vérifiée{NB}: <span className="font-medium text-ink [overflow-wrap:anywhere]" data-compte-email="">{user.email}</span></p>
          {login && (
            <ul className="mt-2 divide-y divide-line" aria-label="Façons de te connecter">
              <Method icon={<GoogleG size={18} />} name="Google" on={login.google} onText="Relié" offText="Pas relié"
                hint={!login.google && cfg.data?.googleEnabled ? <>Connecte-toi une fois avec Google, avec cette même adresse{NB}: il se relie tout seul.</> : undefined} />
              <Method icon={<IconLock size={18} />} name="Mot de passe" on={login.password} onText="Défini" offText="Aucun" />
            </ul>
          )}
        </Card>

        <Card title="Mot de passe" id="compte-mdp" data="mot-de-passe">
          {!emailOn ? (
            <FormNote tone="info" icon={<IconInfo size={18} />}>Les mots de passe ne sont pas ouverts sur ce serveur{NB}: tu te connectes avec Google.</FormNote>
          ) : login?.password ? <ChangePassword /> : <AddPassword email={user.email} />}
          {emailOn && login?.password && <p className="mt-4 text-[14px] text-muted">Mot de passe oublié{NB}? <Link to="/mot-de-passe" className={link}>Recevoir un lien</Link>.</p>}
        </Card>

        <Card title="Tes données" id="compte-donnees" data="donnees">
          <ul className="flex flex-wrap gap-x-6 gap-y-1">
            <li><a href="/api/account/export" download="youtube-converter-mes-donnees.json" className={`${link} inline-flex min-h-11 items-center gap-2 text-[15px]`}><IconDownload size={17} />Exporter mes données</a></li>
            <li><Link to="/confidentialite#donnees" className={`${link} inline-flex min-h-11 items-center gap-2 text-[15px]`}><IconTrash size={17} />Supprimer mon compte</Link></li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

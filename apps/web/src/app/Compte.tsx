// Espace personnel › Ton compte (/dashboard/compte) : comment on se connecte à ce compte (Google relié, mot de passe
// défini : /api/me « login », lu sur le serveur ; Discord relié ou à relier : /api/discord, la liaison existante), le changement de mot de passe (Better Auth /change-password : mot de
// passe actuel exigé, autres sessions fermées), l'ajout d'un mot de passe à un compte Google (lien « mot de passe
// oublié » envoyé à SON adresse, qui prouve qu'elle lui appartient), puis l'export et la suppression des données.
import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { authMessage, changePassword, PASSWORD_MAX, requestPasswordReset } from "../lib/auth.ts";
import { passwordProblem } from "../lib/password.ts";
import { api } from "../lib/api.ts";
import { useConfig, useDocumentTitle, useMe } from "../lib/hooks.ts";
import { useResource } from "../lib/store.ts";
import type { DiscordStatus } from "../lib/types.ts";
import { Button } from "../ui/Button.tsx";
import { Field, FormNote, PasswordInput } from "../ui/Field.tsx";
import { GooglePastille, IconCheck, IconDownload, IconInfo, IconLock, IconMail, IconTrash } from "../ui/Icon.tsx";
import { PasswordStrength } from "../ui/PasswordStrength.tsx";
import { useToast } from "../ui/Toasts.tsx";
import { BoutonDiscord } from "../ui/brand/BoutonDiscord.tsx";
import { DiscordMark } from "../ui/brand/PlatformGlyph.tsx";
import { PageHeader, toastError } from "./common.tsx";

const NB = " ";
const link = "text-gold-text underline decoration-gold/50 underline-offset-4 transition-colors hover:decoration-gold-text";

function Card({ title, id, children, data }: { title: string; id: string; children: ReactNode; data: string }) {
  return (
    <section aria-labelledby={id} className="rounded-panel border border-line bg-ivory p-5 shadow-card sm:p-7" data-compte-section={data}>
      <h2 id={id} className="font-display text-titre-s">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Une façon de se connecter : sa pastille ronde (le « G » sur blanc, le symbole Discord sur Blurple), son état, une aide
 *  et, au besoin, l'action qui la relie. */
function Method({ pastille, name, on, onText, offText, hint, action }: { pastille: ReactNode; name: string; on: boolean; onText: string; offText: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-3 py-3.5" data-methode={name} data-etat={on ? "oui" : "non"}>
      {pastille}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ui font-medium text-ink">
          {name}
          <span className={on ? "inline-flex items-center gap-1 rounded-full bg-ok-bg px-2.5 py-0.5 text-note font-semibold text-ok" : "rounded-full bg-sand/70 px-2.5 py-0.5 text-note font-semibold text-ink-soft"}>
            {on ? <><IconCheck size={13} />{onText}</> : offText}
          </span>
        </p>
        {hint && <p className="mt-1 text-ui leading-relaxed text-muted">{hint}</p>}
      </div>
      {action}
    </li>
  );
}

/** Discord : relié (nom, lien vers la gestion) ou à relier, avec la liaison qui existe déjà (POST /api/discord/link →
 *  autorisation chez Discord → retour dans Espace › Discord). Rien quand la liaison est fermée sur le serveur. */
function DiscordMethod() {
  const toast = useToast();
  const st = useResource<DiscordStatus>("/api/discord", 60_000);
  const [starting, setStarting] = useState(false);
  const d = st.data;
  if (!d || (!d.enabled && !d.linked)) return null;
  const relier = async () => {
    setStarting(true);
    try {
      const { url } = await api<{ url: string }>("/api/discord/link", { method: "POST" });
      window.location.assign(url);
    } catch (e) {
      setStarting(false);
      toastError(toast, e, "Liaison impossible");
      void st.reload();
    }
  };
  return (
    <Method name="Discord" on={d.linked} onText="Relié" offText="Pas relié"
      pastille={<span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#5865F2]" aria-hidden="true"><DiscordMark tone="white" height={20} /></span>}
      hint={d.linked && d.discord
        ? <><span className="text-ink-soft [overflow-wrap:anywhere]">@{d.discord.name}</span> <Link to="/dashboard/discord" className={link}>Gérer la liaison</Link></>
        : <>Relie-le une fois{NB}: «{NB}Continuer avec Discord{NB}» ouvrira ensuite ce compte.</>}
      action={!d.linked && (
        <BoutonDiscord onClick={relier} chargement={starting} disabled={starting} className="h-11 text-ui" data-relier-discord="">
          {starting ? "Ouverture de Discord…" : "Relier Discord"}
        </BoutonDiscord>
      )} />
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
      <p className="max-w-xl text-ui leading-relaxed text-ink-soft">Tu te connectes avec Google. Pour te connecter aussi avec un mot de passe, reçois un lien à <span className="font-medium text-ink [overflow-wrap:anywhere]">{email}</span>{NB}: il prouve que l'adresse est à toi.</p>
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
          <p className="text-ui text-ink-soft">Adresse vérifiée{NB}: <span className="font-medium text-ink [overflow-wrap:anywhere]" data-compte-email="">{user.email}</span></p>
          {login && (
            <ul className="mt-2 divide-y divide-line" aria-label="Façons de te connecter">
              <Method pastille={<GooglePastille size={40} />} name="Google" on={login.google} onText="Relié" offText="Pas relié"
                hint={!login.google && cfg.data?.googleEnabled ? <>Connecte-toi une fois avec Google, avec cette même adresse{NB}: il se relie tout seul.</> : undefined} />
              <DiscordMethod />
              <Method pastille={<span className="grid size-10 shrink-0 place-items-center rounded-full bg-pearl text-gold-text ring-1 ring-line" aria-hidden="true"><IconLock size={18} /></span>}
                name="Mot de passe" on={login.password} onText="Défini" offText="Aucun" />
            </ul>
          )}
        </Card>

        <Card title="Mot de passe" id="compte-mdp" data="mot-de-passe">
          {!emailOn ? (
            <FormNote tone="info" icon={<IconInfo size={18} />}>Les mots de passe ne sont pas ouverts sur ce serveur{NB}: tu te connectes avec Google.</FormNote>
          ) : login?.password ? <ChangePassword /> : <AddPassword email={user.email} />}
          {emailOn && login?.password && <p className="mt-4 text-ui text-muted">Mot de passe oublié{NB}? <Link to="/mot-de-passe" className={link}>Recevoir un lien</Link>.</p>}
        </Card>

        <Card title="Tes données" id="compte-donnees" data="donnees">
          <ul className="flex flex-wrap gap-x-6 gap-y-1">
            <li><a href="/api/account/export" download="youtube-converter-mes-donnees.json" className={`${link} inline-flex min-h-11 items-center gap-2 text-ui`}><IconDownload size={17} />Exporter mes données</a></li>
            <li><Link to="/confidentialite#donnees" className={`${link} inline-flex min-h-11 items-center gap-2 text-ui`}><IconTrash size={17} />Supprimer mon compte</Link></li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

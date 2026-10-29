// Page d'accord « AETHRYON pour Premiere Pro » (/premiere/connecter, account/src/premiere.ts). Le panneau de
// Premiere ouvre cette page dans le navigateur avec ?code=ABCD-EFGH et affiche le même code ; il attend ensuite
// la décision (il interroge le serveur toutes les 3 s). Même structure et même ton que la page de consentement de
// l'extension navigateur (ExtensionAuthorize.tsx), hors de la coque du site : rien ne détourne de la décision.
// - Code vérifié AVANT toute requête (8 lettres sans voyelle) ; absent ou invalide → champ pour le saisir.
// - Sans session : /connexion?suite=<cette page> (chemin reconstruit avec le seul code vérifié), retour ici après.
// - La demande est lue par POST /api/premiere/demande (le code ne passe dans aucune adresse d'API) ; « Autoriser » →
//   POST /api/premiere/autoriser, « Refuser » → POST /api/premiere/refuser (session + CSRF du site).
// - États clairs : en attente, autorisé (retourne dans Premiere), refusé, expiré, déjà utilisé, fermé, code inconnu.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { useDocumentTitle, useMe } from "../lib/hooks.ts";
import { connectPath, formatUserCode, normalizeUserCode, parseDemande, stateOfRefusal, type Demande, type DemandeState } from "../lib/premiere.ts";
import { invalidate } from "../lib/store.ts";
import { AethryonMascot, type MascotState } from "../ui/brand/AethryonMascot.tsx";
import { Button, ButtonLink } from "../ui/Button.tsx";
import { IconAlert, IconCheck, IconClose, IconFilm, IconLock } from "../ui/Icon.tsx";
import { TextInput } from "../ui/bits.tsx";
import { Frame, Loading } from "./ExtensionAuthorize.tsx";

const NB = "\u00a0"; // espace insécable
const NETWORK = "Connexion impossible. Vérifie ta connexion et réessaie.";
const SERVER = "Le serveur AETHRYON ne répond pas pour le moment\u00a0: réessaie dans un instant.";
const UNKNOWN_DEVICE = "Ordinateur inconnu";

type Lookup =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; demande: Demande }
  | { kind: "closed" }
  | { kind: "unknown"; message: string }
  | { kind: "error"; message: string };
type Action = "allow" | "deny";
type Phase = { kind: "ready" } | { kind: "busy"; action: Action } | { kind: "error"; code: string; message: string };

/** Fin de parcours (autorisé, refusé, expiré, déjà utilisé) : un message, aucun bouton de décision. */
const FINAL: Record<Exclude<DemandeState, "en-attente">, { title: string; body: string; owl: MascotState; tone: "ok" | "neutral" | "bad" }> = {
  autorise: {
    title: "Premiere Pro est connecté",
    body: `Retourne dans Premiere Pro${NB}: le panneau AETHRYON se connecte tout seul dans quelques secondes. Tu peux fermer cet onglet.`,
    owl: "success", tone: "ok",
  },
  refuse: {
    title: "Connexion refusée",
    body: `Premiere Pro n'a reçu aucun accès à ton compte. Si c'était une erreur, relance la connexion depuis le panneau AETHRYON de Premiere Pro${NB}: un nouveau code s'affichera.`,
    owl: "idle", tone: "neutral",
  },
  expire: {
    title: "Ce code a expiré",
    body: `Un code n'est valable que 10${NB}minutes. Relance la connexion depuis le panneau AETHRYON de Premiere Pro${NB}: un nouveau code s'affichera.`,
    owl: "curious", tone: "neutral",
  },
  utilise: {
    title: "Ce code a déjà été utilisé",
    body: `Chaque code ne sert qu'une fois. Si Premiere Pro n'est pas connecté, relance la connexion depuis son panneau AETHRYON${NB}: un nouveau code s'affichera.`,
    owl: "curious", tone: "neutral",
  },
};

/** Saisie du code (lien ouvert sans code, code invalide ou inconnu). */
function CodeEntry({ error, initial }: { error: string | null; initial: string }) {
  const navigate = useNavigate();
  const [value, setValue] = useState(initial);
  const [local, setLocal] = useState<string | null>(null);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = normalizeUserCode(value);
    if (!code) { setLocal(`Code invalide${NB}: 8 lettres, comme celles affichées dans Premiere Pro (par exemple BCDF-GHJK).`); return; }
    setLocal(null);
    navigate(connectPath(code), { replace: true });
  };
  const message = local ?? error;
  return (
    <Frame label="Code de connexion de Premiere Pro" produit="premiere">
      <div className="flex items-center gap-4 sm:gap-5">
        <AethryonMascot still state="curious" size={92} className="-my-2 shrink-0" />
        <div className="min-w-0">
          <p className="text-note font-semibold uppercase tracking-[0.16em] text-gold-text">Premiere Pro</p>
          <h1 className="font-display mt-1.5 text-titre-m leading-[1.15] tracking-[-0.01em] sm:text-titre-m">Saisis le code affiché dans Premiere Pro</h1>
        </div>
      </div>
      <form onSubmit={submit} className="mt-6" noValidate>
        <TextInput
          label="Code de connexion"
          name="code"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          maxLength={12}
          placeholder="BCDF-GHJK"
          hint="8 lettres, affichées dans le panneau AETHRYON de Premiere Pro."
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? "code-erreur" : undefined}
          className="[&_input]:font-semibold [&_input]:tracking-[0.14em] [&_input]:uppercase"
        />
        {message && (
          <p id="code-erreur" role="alert" className="mt-3 flex gap-2.5 text-ui leading-relaxed text-bad">
            <IconAlert size={18} aria-hidden className="mt-0.5 shrink-0" />{message}
          </p>
        )}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <ButtonLink to="/dashboard" variant="secondary">Mon espace</ButtonLink>
          <Button type="submit" variant="primary">Continuer</Button>
        </div>
      </form>
    </Frame>
  );
}

function Message({ title, body, owl, alert, children }: { title: string; body: string; owl: MascotState; alert?: boolean; children?: React.ReactNode }) {
  return (
    <Frame label={title} produit="premiere">
      <div className="flex flex-col items-center text-center" role={alert ? "alert" : "status"}>
        <AethryonMascot still={owl !== "success"} state={owl} size={112} />
        <h1 className="font-display mt-4 text-titre-m leading-tight">{title}</h1>
        <p className="mt-3 text-ui leading-relaxed text-ink-soft">{body}</p>
      </div>
      <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">{children}</div>
    </Frame>
  );
}

export default function PremiereConnect() {
  useDocumentTitle("Connecter Premiere Pro");
  const location = useLocation();
  const navigate = useNavigate();
  const rawCode = useMemo(() => {
    const q = new URLSearchParams(location.search);
    return q.getAll("code").length === 1 ? q.get("code") : null;
  }, [location.search]);
  const code = useMemo(() => normalizeUserCode(rawCode), [rawCode]);
  const me = useMe();
  const [lookup, setLookup] = useState<Lookup>({ kind: "idle" });
  const [phase, setPhase] = useState<Phase>({ kind: "ready" });
  const reqId = useRef(0);

  // Sans session : connexion, puis retour ici (avec le seul code vérifié).
  const toLogin = useMemo(() => `/connexion?suite=${encodeURIComponent(connectPath(code))}`, [code]);
  useEffect(() => {
    if (me.error?.status === 401) navigate(toLogin, { replace: true });
  }, [toLogin, me.error, navigate]);

  const signedIn = !!me.data && !me.error;
  const load = useCallback(async () => {
    if (!code) return;
    const id = ++reqId.current;
    setLookup({ kind: "loading" });
    try {
      const r = parseDemande(await api<unknown>("/api/premiere/demande", { method: "POST", body: { codeUtilisateur: formatUserCode(code) } }));
      if (id !== reqId.current) return;
      setLookup(r ? { kind: "ready", demande: r } : { kind: "error", message: SERVER });
    } catch (e) {
      if (id !== reqId.current) return;
      if (e instanceof ApiError && e.status === 401) { invalidate("/api/me"); return; }
      // Fermée (PREMIERE_CONNEXION ≠ 1), ou account sans ces routes (404 « not_found », retour arrière) : « pas encore disponible ».
      if (e instanceof ApiError && (e.code === "premiere_closed" || (e.status === 404 && e.code === "not_found"))) setLookup({ kind: "closed" });
      else if (e instanceof ApiError && (e.code === "unknown_code" || e.code === "invalid_code")) setLookup({ kind: "unknown", message: e.message });
      else if (e instanceof ApiError) setLookup({ kind: "error", message: e.isServer ? SERVER : e.message });
      else setLookup({ kind: "error", message: NETWORK });
    }
  }, [code]);
  useEffect(() => { if (signedIn && code) void load(); }, [signedIn, code, load]);

  // Expiration pendant que la page est ouverte : la demande est relue à l'échéance (le serveur fait foi).
  const expiresAt = lookup.kind === "ready" && lookup.demande.etat === "en-attente" ? Date.parse(lookup.demande.expireLe) : null;
  useEffect(() => {
    if (expiresAt === null || Number.isNaN(expiresAt)) return;
    const t = window.setTimeout(() => void load(), Math.max(0, expiresAt - Date.now()) + 1000);
    return () => window.clearTimeout(t);
  }, [expiresAt, load]);

  if (!code) return <CodeEntry error={rawCode ? `Ce lien ne contient pas de code valide${NB}: saisis celui affiché dans Premiere Pro.` : null} initial="" />;
  if (!me.data || me.error?.status === 401) {
    if (me.error && me.error.status !== 401) {
      return (
        <Message title="Session impossible à vérifier" body={me.error.isServer ? SERVER : me.error.message} owl="error" alert>
          <Button variant="primary" onClick={() => void me.reload()}>Réessayer</Button>
        </Message>
      );
    }
    return <Loading />;
  }
  if (lookup.kind === "idle" || lookup.kind === "loading") return <Loading />;
  if (lookup.kind === "closed") {
    return (
      <Message title="Pas encore disponible" body={`La connexion de Premiere Pro à ton compte n'est pas encore ouverte sur AETHRYON${NB}: aucune autorisation n'a été donnée.`} owl="curious">
        <ButtonLink to="/dashboard" variant="secondary">Mon espace</ButtonLink>
      </Message>
    );
  }
  if (lookup.kind === "unknown") return <CodeEntry error={lookup.message} initial={formatUserCode(code)} />;
  if (lookup.kind === "error") {
    return (
      <Message title="Demande impossible à lire" body={lookup.message} owl="error" alert>
        <Button variant="primary" onClick={() => void load()}>Réessayer</Button>
      </Message>
    );
  }

  const d = lookup.demande;
  if (d.etat !== "en-attente") {
    const f = FINAL[d.etat];
    return (
      <Message title={f.title} body={f.body} owl={f.owl}>
        <ButtonLink to="/dashboard/cles" variant={d.etat === "autorise" ? "primary" : "secondary"}>Mes jetons</ButtonLink>
      </Message>
    );
  }

  const user = me.data.user;
  const limit = (me.data.today as { limit: number | null }).limit;
  const busy = phase.kind === "busy";
  const owl: MascotState = phase.kind === "busy" ? "processing" : phase.kind === "error" ? "error" : "idle";
  const device = d.appareil?.hote ?? UNKNOWN_DEVICE;

  const decide = async (action: Action) => {
    if (busy) return;
    setPhase({ kind: "busy", action });
    try {
      const r = await api<{ etat?: unknown }>(action === "allow" ? "/api/premiere/autoriser" : "/api/premiere/refuser", { method: "POST", body: { codeUtilisateur: d.codeUtilisateur } });
      const etat = r?.etat === "autorise" || r?.etat === "refuse" ? r.etat : null;
      if (!etat) { setPhase({ kind: "error", code: "bad_response", message: SERVER }); return; }
      setPhase({ kind: "ready" });
      setLookup({ kind: "ready", demande: { ...d, etat } });
      if (etat === "autorise") invalidate("/api/keys");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { invalidate("/api/me"); return; }
      const st = e instanceof ApiError ? stateOfRefusal(e.data) : null;
      if (st && st !== "en-attente") { setPhase({ kind: "ready" }); setLookup({ kind: "ready", demande: { ...d, etat: st } }); return; }
      if (e instanceof ApiError) setPhase({ kind: "error", code: e.code, message: e.isServer ? SERVER : e.message });
      else setPhase({ kind: "error", code: "network", message: NETWORK });
    }
  };

  return (
    <Frame label="Connexion d'AETHRYON pour Premiere Pro" produit="premiere">
      <div className="flex items-center gap-4 sm:gap-5">
        <AethryonMascot state={owl} size={92} className="-my-2 shrink-0" />
        <div className="min-w-0">
          <p className="text-note font-semibold uppercase tracking-[0.16em] text-gold-text">Premiere Pro</p>
          <h1 className="font-display mt-1.5 text-titre-m leading-[1.15] tracking-[-0.01em] sm:text-titre-m">
            Connecter AETHRYON pour Premiere Pro{NB}?
          </h1>
        </div>
      </div>

      <div className="mt-6 rounded-card border border-gold/50 bg-ivory px-4 py-4 text-center">
        <p className="text-note text-ink-soft">Code affiché dans Premiere Pro</p>
        <p className="tabular mt-1 text-titre-m font-semibold tracking-[0.18em] text-ink sm:text-[34px]" data-premiere-code="">{d.codeUtilisateur}</p>
        <p className="mt-1 text-note text-ink-soft">Vérifie qu'il est identique, lettre pour lettre.</p>
      </div>

      <dl className="mt-4 divide-y divide-line rounded-card border border-line bg-ivory text-ui">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-3">
          <dt className="text-ink-soft">Ordinateur</dt>
          <dd className="min-w-0 break-words font-medium">{device}</dd>
        </div>
        {d.appareil?.versionPremiere && (
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-3">
            <dt className="text-ink-soft">Premiere Pro</dt>
            <dd className="min-w-0 break-words font-medium">{d.appareil.versionPremiere}</dd>
          </div>
        )}
        {d.appareil?.versionExtension && (
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-3">
            <dt className="text-ink-soft">Panneau AETHRYON</dt>
            <dd className="min-w-0 break-words font-medium">{d.appareil.versionExtension}</dd>
          </div>
        )}
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-3">
          <dt className="text-ink-soft">Compte</dt>
          <dd className="min-w-0 break-all font-medium">{user.email}</dd>
        </div>
      </dl>
      <p className="mt-2 text-note leading-relaxed text-muted">Nom de l'ordinateur et versions donnés par Premiere Pro, à titre indicatif.</p>

      <div className="mt-6 grid gap-5 sm:grid-cols-2 sm:gap-6">
        <section aria-labelledby="peut">
          <h2 id="peut" className="text-ui font-semibold">Le panneau pourra</h2>
          <ul className="mt-2.5 space-y-2.5 text-ui leading-snug text-ink-soft">
            <li className="flex gap-2.5"><IconCheck size={18} aria-hidden className="mt-px shrink-0 text-ok" />Convertir des vidéos avec ton compte</li>
            <li className="flex gap-2.5">
              <IconCheck size={18} aria-hidden className="mt-px shrink-0 text-ok" />
              <span>Utiliser ton quota, le même que le raccourci et l'extension{typeof limit === "number" ? ` (${limit} conversion${limit > 1 ? "s" : ""} par jour)` : ""}</span>
            </li>
            <li className="flex gap-2.5"><IconCheck size={18} aria-hidden className="mt-px shrink-0 text-ok" />Voir ton quota et tes 5 dernières conversions</li>
          </ul>
        </section>
        <section aria-labelledby="peut-pas">
          <h2 id="peut-pas" className="text-ui font-semibold">Il n'aura aucun accès</h2>
          <ul className="mt-2.5 space-y-2.5 text-ui leading-snug text-ink-soft">
            <li className="flex gap-2.5"><IconClose size={18} aria-hidden className="mt-px shrink-0 text-bad" />À ton mot de passe ni à tes cookies</li>
            <li className="flex gap-2.5"><IconClose size={18} aria-hidden className="mt-px shrink-0 text-bad" />À ton historique de navigation</li>
            <li className="flex gap-2.5"><IconClose size={18} aria-hidden className="mt-px shrink-0 text-bad" />Aux réglages de ton compte ni à tes jetons</li>
          </ul>
        </section>
      </div>

      <p className="mt-6 flex gap-2.5 border-t border-line pt-5 text-ui leading-relaxed text-ink-soft">
        <IconLock size={18} aria-hidden className="mt-0.5 shrink-0 text-gold-text" />
        <span>La connexion expire après 30{NB}jours. Tu peux la révoquer à tout moment dans «{NB}Mes jetons{NB}», depuis ton espace personnel, ou par «{NB}Se déconnecter{NB}» dans le panneau.</span>
      </p>

      {phase.kind === "error" && (
        <div role="alert" className="mt-5 flex gap-2.5 rounded-card border border-bad/20 bg-bad-bg p-3.5 text-ui leading-relaxed text-bad">
          <IconAlert size={18} aria-hidden className="mt-0.5 shrink-0" />
          <div>
            <p>{phase.message}</p>
            {phase.code === "too_many_premiere" && (
              <Link to="/dashboard/cles" target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex min-h-11 items-center font-medium underline decoration-bad/40 underline-offset-4 hover:decoration-bad">
                Ouvrir «{NB}Mes jetons{NB}» dans un nouvel onglet
              </Link>
            )}
          </div>
        </div>
      )}

      {/* RFC 8628 §5.4 : un lien reçu d'un tiers (message, e-mail) peut viser à connecter SON Premiere à ton compte. */}
      <p className="mt-6 flex gap-2.5 text-ui leading-relaxed text-ink-soft" data-consent-rappel="">
        <IconFilm size={18} aria-hidden className="mt-0.5 shrink-0 text-gold-text" />
        <span>Autorise seulement si tu viens de cliquer sur «{NB}Se connecter{NB}» dans le panneau AETHRYON de Premiere Pro, sur ton ordinateur, et si le code est le même. Sinon, refuse.</span>
      </p>
      <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" disabled={busy} loading={phase.kind === "busy" && phase.action === "deny"} onClick={() => void decide("deny")}>
          Refuser
        </Button>
        <Button variant="primary" disabled={busy} loading={phase.kind === "busy" && phase.action === "allow"} onClick={() => void decide("allow")}>
          Autoriser
        </Button>
      </div>
      <p role="status" aria-live="polite" className="mt-4 min-h-[21px] text-center text-ui text-ink-soft sm:text-right">
        {phase.kind === "busy" ? (phase.action === "allow" ? "Autorisation en cours…" : "Refus en cours…") : null}
      </p>
    </Frame>
  );
}

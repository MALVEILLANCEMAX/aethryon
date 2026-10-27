// Fiche utilisateur : statistiques, activité, erreurs, jetons (révocation), quota (limite, illimité,
// simultanées, bonus du jour, remise à zéro), rôle, suspension. Chaque action sensible passe par une
// confirmation qui nomme sa conséquence ; le serveur reste seul juge (dernier administrateur, soi-même).
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useOutletContext, useParams } from "react-router";
import { cn } from "../../lib/cn.ts";
import { Button } from "../../ui/Button.tsx";
import { Skeleton } from "../../ui/bits.tsx";
import { useToast } from "../../ui/Toasts.tsx";
import { HBars } from "../charts.tsx";
import { ActionCell, AuditDetails, ConversionList } from "../cells.tsx";
import { adminMutate, qs, useAdmin } from "../data.ts";
import { fmtDate, fmtDateTime, fmtDuration, fmtNum, fmtPct, fmtRelative, platformLabel } from "../format.ts";
import { IconBan, IconCrown, IconGift, IconReset } from "../icons.tsx";
import type { AdminKey, AdminMe, Page, Quotas, UserDetail as Detail, UserRow } from "../types.ts";
import {
  AdminPage, BackLink, ConfirmDialog, DisabledReason, EmptyState, ErrorState, KeyBadge, KeyValues, Meter, Mono, Monogram, Panel,
  ResultBadge, RoleBadge, StatusBadge, TextField, linkCls,
} from "../ui.tsx";

type Pending =
  | { kind: "role"; role: "user" | "admin" }
  | { kind: "status"; status: "active" | "suspended" }
  | { kind: "quota"; body: { dailyLimit: number | null; unlimited: boolean; maxActive: number | null }; summary: ReactNode[] }
  | { kind: "grant"; amount: number; reason: string }
  | { kind: "reset" }
  | { kind: "revoke"; key: AdminKey };

const intIn = (v: string, min: number, max: number) => {
  if (!/^\d+$/.test(v.trim())) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
};

function QuotaEditor({ d, global, onSubmit }: { d: Detail; global: Quotas["global"] | undefined; onSubmit: (p: Extract<Pending, { kind: "quota" }>) => void }) {
  const p = d.policy;
  const tech = global?.techMaxActive ?? d.effective.maxActive;
  const initDaily = p.unlimited ? "unlimited" : p.dailyLimit === null ? "global" : "custom";
  const [daily, setDaily] = useState<"global" | "custom" | "unlimited">(initDaily);
  const [dailyVal, setDailyVal] = useState(p.dailyLimit === null ? "" : String(p.dailyLimit));
  const [active, setActive] = useState<"global" | "custom">(p.maxActive === null ? "global" : "custom");
  const [activeVal, setActiveVal] = useState(p.maxActive === null ? "" : String(p.maxActive));
  const [errors, setErrors] = useState<{ daily?: string; active?: string }>({});
  const gid = useId();
  useEffect(() => {
    setDaily(p.unlimited ? "unlimited" : p.dailyLimit === null ? "global" : "custom");
    setDailyVal(p.dailyLimit === null ? "" : String(p.dailyLimit));
    setActive(p.maxActive === null ? "global" : "custom");
    setActiveVal(p.maxActive === null ? "" : String(p.maxActive));
  }, [p.dailyLimit, p.unlimited, p.maxActive]);

  const describe = (mode: string, val: number | null, unl: boolean) =>
    unl ? "illimité" : mode === "global" || val === null ? `globale (${global ? fmtNum(global.dailyLimit) : "—"}/jour)` : `${fmtNum(val)}/jour`;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    const dv = daily === "custom" ? intIn(dailyVal, 0, 10_000) : null;
    if (daily === "custom" && dv === null) errs.daily = "Nombre entier de 0 à 10 000.";
    const av = active === "custom" ? intIn(activeVal, 1, tech) : null;
    if (active === "custom" && av === null) errs.active = `Nombre entier de 1 à ${tech} (plafond technique).`;
    setErrors(errs);
    if (errs.daily || errs.active) return;
    const body = { dailyLimit: daily === "custom" ? dv : null, unlimited: daily === "unlimited", maxActive: active === "custom" ? av : null };
    const summary: ReactNode[] = [];
    const before = describe(p.dailyLimit === null ? "global" : "custom", p.dailyLimit, p.unlimited);
    const after = describe(daily, body.dailyLimit, body.unlimited);
    if (before !== after) summary.push(<>Limite quotidienne : {before} → <strong className="font-semibold text-ink">{after}</strong></>);
    const aBefore = p.maxActive === null ? `globale (${global ? fmtNum(global.maxActive) : "—"})` : fmtNum(p.maxActive);
    const aAfter = body.maxActive === null ? `globale (${global ? fmtNum(global.maxActive) : "—"})` : fmtNum(body.maxActive);
    if (aBefore !== aAfter) summary.push(<>Conversions simultanées : {aBefore} → <strong className="font-semibold text-ink">{aAfter}</strong></>);
    if (!summary.length) { setErrors({ daily: "Aucun changement à enregistrer." }); return; }
    onSubmit({ kind: "quota", body, summary });
  };
  const radio = "size-5 accent-[var(--eg-c-accent)]";
  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <fieldset>
        <legend className="text-[14.5px] font-medium text-ink">Limite quotidienne</legend>
        <div className="mt-2 space-y-1">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14.5px]"><input type="radio" name={`${gid}-d`} checked={daily === "global"} onChange={() => setDaily("global")} className={radio} />Limite globale{global ? ` (${fmtNum(global.dailyLimit)} par jour)` : ""}</label>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14.5px]"><input type="radio" name={`${gid}-d`} checked={daily === "custom"} onChange={() => setDaily("custom")} className={radio} />Personnalisée</label>
            {daily === "custom" && (
              <TextField label="Conversions par jour" className="w-44" inputMode="numeric" value={dailyVal} onChange={(e) => setDailyVal(e.target.value)} error={errors.daily} hint="0 à 10 000" />
            )}
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14.5px]"><input type="radio" name={`${gid}-d`} checked={daily === "unlimited"} onChange={() => setDaily("unlimited")} className={radio} />Illimitée</label>
          {daily !== "custom" && errors.daily && <p role="alert" className="text-[13px] text-bad">{errors.daily}</p>}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-[14.5px] font-medium text-ink">Conversions simultanées</legend>
        <div className="mt-2 space-y-1">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14.5px]"><input type="radio" name={`${gid}-a`} checked={active === "global"} onChange={() => setActive("global")} className={radio} />Valeur globale{global ? ` (${fmtNum(global.maxActive)})` : ""}</label>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14.5px]"><input type="radio" name={`${gid}-a`} checked={active === "custom"} onChange={() => setActive("custom")} className={radio} />Personnalisée</label>
            {active === "custom" && (
              <TextField label="Simultanées" className="w-44" inputMode="numeric" value={activeVal} onChange={(e) => setActiveVal(e.target.value)} error={errors.active} hint={`1 à ${tech} (plafond technique)`} />
            )}
          </div>
        </div>
      </fieldset>
      <p className="text-[13px] leading-relaxed text-muted">Le plafond technique ({tech} jobs actifs par utilisateur), la capacité de ytapi et les limites de durée et de taille ne sont jamais levés, même en illimité.</p>
      <Button type="submit" variant="primary">Enregistrer le quota</Button>
    </form>
  );
}

function GrantForm({ disabledReason, onSubmit }: { disabledReason: string | null; onSubmit: (p: Extract<Pending, { kind: "grant" }>) => void }) {
  const [amount, setAmount] = useState("5");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<{ amount?: string; reason?: string }>({});
  const rid = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = intIn(amount, 1, 1000);
    const errs: typeof err = {};
    if (n === null) errs.amount = "Nombre entier de 1 à 1 000.";
    if (reason.length > 140) errs.reason = "140 caractères au plus.";
    setErr(errs);
    if (errs.amount || errs.reason || n === null) return;
    onSubmit({ kind: "grant", amount: n, reason: reason.trim() });
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <div className="grid gap-3">
        <TextField label="Conversions en plus" className="max-w-[180px]" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} error={err.amount} disabled={!!disabledReason} />
        <TextField label="Motif (facultatif)" value={reason} maxLength={140} onChange={(e) => setReason(e.target.value)} error={err.reason} hint={`${reason.length} / 140 · visible dans le journal`} disabled={!!disabledReason} />
      </div>
      <Button type="submit" variant="secondary" icon={<IconGift size={17} />} disabled={!!disabledReason} aria-describedby={disabledReason ? rid : undefined}>Accorder pour aujourd'hui</Button>
      {disabledReason && <DisabledReason id={rid}>{disabledReason}</DisabledReason>}
    </form>
  );
}

export default function UserDetail() {
  const { id = "" } = useParams();
  const me = useOutletContext<AdminMe>();
  const toast = useToast();
  const path = `/users/${encodeURIComponent(id)}`;
  const r = useAdmin<Detail>(path, 10_000);
  const admins = useAdmin<Page<UserRow>>(`/users${qs({ role: "admin", status: "active", pageSize: 1 })}`, 30_000);
  const quotas = useAdmin<Quotas>("/quotas", 60_000);
  const [pending, setPending] = useState<Pending | null>(null);
  const [openAudit, setOpenAudit] = useState<string | null>(null);
  const roleReasonId = useId();
  const statusReasonId = useId();
  const resetReasonId = useId();
  const { hash } = useLocation();
  const loaded = !!r.data;
  // Ancre (#quota depuis la page Quotas) : défilement une fois la fiche chargée.
  useEffect(() => {
    if (loaded && hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: "start" });
  }, [loaded, hash]);

  if (!r.data) {
    return (
      <div className="space-y-5">
        <BackLink to="/admin/users">Utilisateurs</BackLink>
        {r.error ? <ErrorState error={r.error} onRetry={r.reload} /> : (
          <div aria-busy="true" className="space-y-5"><span className="sr-only" role="status">Chargement…</span><Skeleton className="h-16 w-80" /><div className="grid gap-5 lg:grid-cols-3"><Skeleton className="h-64 lg:col-span-2" /><Skeleton className="h-64" /></div></div>
        )}
      </div>
    );
  }
  const d = r.data;
  const u = d.user;
  const self = u.id === me.id;
  const activeAdmins = admins.data?.total ?? null;
  const lastAdmin = u.role === "admin" && u.status === "active" && activeAdmins !== null && activeAdmins <= 1;
  const roleBlocked = u.role === "admin" ? (self ? "C'est ton propre compte : un autre administrateur doit te rétrograder." : lastAdmin ? "Dernier administrateur actif : promeus d'abord un autre compte." : null) : null;
  const statusBlocked = u.status === "active" ? (self ? "Tu ne peux pas suspendre ton propre compte." : lastAdmin ? "Dernier administrateur actif : il ne peut pas être suspendu." : null) : null;
  const eff = d.effective;
  const limit = eff.unlimited ? null : eff.dailyLimit; // effective.dailyLimit inclut déjà le bonus du jour
  const who = u.name || u.email;
  const refresh = ["/users", "/quotas", "/overview", "/keys", "/audit"];

  const run = async () => {
    if (!pending) return;
    const base = `/users/${encodeURIComponent(u.id)}`;
    switch (pending.kind) {
      case "role":
        await adminMutate("POST", `${base}/role`, { role: pending.role }, refresh);
        toast.show("success", pending.role === "admin" ? "Administrateur promu" : "Rôle retiré", who);
        break;
      case "status":
        await adminMutate("POST", `${base}/status`, { status: pending.status }, refresh);
        toast.show("success", pending.status === "suspended" ? "Compte suspendu" : "Compte réactivé", who);
        break;
      case "quota":
        await adminMutate("PUT", `${base}/quota`, pending.body, refresh);
        toast.show("success", "Quota enregistré", who);
        break;
      case "grant":
        await adminMutate("POST", `${base}/quota/grant`, pending.reason ? { amount: pending.amount, reason: pending.reason } : { amount: pending.amount }, refresh);
        toast.show("success", "Bonus accordé", `${pending.amount} conversion${pending.amount > 1 ? "s" : ""} de plus aujourd'hui`);
        break;
      case "reset":
        await adminMutate("POST", `${base}/quota/reset`, {}, refresh);
        toast.show("success", "Compteur remis à zéro", who);
        break;
      case "revoke":
        await adminMutate("POST", `/keys/${encodeURIComponent(pending.key.id)}/revoke`, {}, refresh);
        toast.show("success", "Jeton révoqué", pending.key.name);
        break;
    }
    await r.reload();
  };

  const dialog = (() => {
    if (!pending) return null;
    switch (pending.kind) {
      case "role":
        return pending.role === "admin"
          ? { title: `Promouvoir ${who} administrateur ?`, confirm: "Promouvoir", tone: "primary" as const, text: <>Ce compte pourra ouvrir le Control Center : voir tous les comptes, modifier les quotas et les réglages, suspendre des comptes et révoquer des jetons. Son quota devient illimité (appliqué par le serveur).</> }
          : { title: `Retirer le rôle administrateur à ${who} ?`, confirm: "Retirer le rôle", tone: "danger" as const, text: <>Ce compte perd immédiatement l'accès au Control Center et redevient soumis aux quotas des utilisateurs.</> };
      case "status":
        return pending.status === "suspended"
          ? { title: `Suspendre ${who} ?`, confirm: "Suspendre le compte", tone: "danger" as const, text: <>Ses sessions sont fermées et ses jetons refusés aussitôt (le raccourci affichera « Jeton refusé »), jusqu'à la réactivation. Ses données et son historique sont conservés.</> }
          : { title: `Réactiver ${who} ?`, confirm: "Réactiver", tone: "primary" as const, text: <>Le compte pourra de nouveau se connecter, et ses jetons non révoqués seront acceptés.</> };
      case "quota":
        return { title: `Modifier le quota de ${who} ?`, confirm: "Enregistrer", tone: "primary" as const, text: <>Le nouveau quota s'applique dès la prochaine conversion :<ul className="mt-2 list-disc space-y-1 pl-5 marker:text-gold">{pending.summary.map((s, i) => <li key={i}>{s}</li>)}</ul></> };
      case "grant":
        return { title: `Accorder ${pending.amount} conversion${pending.amount > 1 ? "s" : ""} à ${who} ?`, confirm: "Accorder le bonus", tone: "primary" as const, text: <>Bonus valable aujourd'hui seulement (jour de Paris) : sa limite du jour passe de {limit === null ? "—" : fmtNum(limit)} à <strong className="font-semibold text-ink">{limit === null ? "—" : fmtNum(limit + pending.amount)}</strong>. Il disparaît à minuit.{pending.reason ? <> Motif : « {pending.reason} ».</> : null}</> };
      case "reset":
        return { title: `Remettre à zéro le compteur de ${who} ?`, confirm: "Remettre à zéro", tone: "danger" as const, text: <>Les {fmtNum(eff.todayUsed)} conversion{eff.todayUsed > 1 ? "s" : ""} déjà faite{eff.todayUsed > 1 ? "s" : ""} aujourd'hui ne comptent plus : ce compte retrouve toute sa limite du jour. Le registre anti-abus du jour repart aussi à zéro.</> };
      case "revoke":
        return { title: `Révoquer le jeton « ${pending.key.name} » ?`, confirm: "Révoquer", tone: "danger" as const, text: <>Le raccourci qui l'utilise est refusé immédiatement (« Jeton refusé »). L'utilisateur devra créer un nouveau jeton. Action définitive.</> };
    }
  })();

  const successRate = d.stats.done + d.stats.error > 0 ? d.stats.done / (d.stats.done + d.stats.error) : null;
  const byPlatform = Object.entries(d.stats.byPlatform ?? {}).filter(([, v]) => typeof v === "number");
  return (
    <>
      <BackLink to="/admin/users">Utilisateurs</BackLink>
      <AdminPage
        docTitle={who}
        eyebrow={<span className="inline-flex flex-wrap items-center gap-2"><RoleBadge role={u.role} /><StatusBadge status={u.status} />{self && <span className="text-muted">C'est toi</span>}</span>}
        title={u.name || "Sans nom"}
        lead={<span className="inline-flex flex-wrap items-center gap-x-2">{u.email}<span className="text-muted">· inscrit le {fmtDate(u.createdAt)} · actif {fmtRelative(u.lastActiveAt)}</span></span>}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
            <div className="flex flex-wrap gap-2">
              {u.role === "admin" ? (
                <Button size="sm" variant="secondary" className="h-11" icon={<IconCrown size={16} />} disabled={!!roleBlocked} aria-describedby={roleBlocked ? roleReasonId : undefined} onClick={() => setPending({ kind: "role", role: "user" })}>Retirer le rôle admin</Button>
              ) : (
                <Button size="sm" variant="secondary" className="h-11" icon={<IconCrown size={16} />} disabled={u.status === "suspended"} onClick={() => setPending({ kind: "role", role: "admin" })}>Promouvoir admin</Button>
              )}
              {u.status === "suspended" ? (
                <Button size="sm" variant="primary" className="h-11" onClick={() => setPending({ kind: "status", status: "active" })}>Réactiver</Button>
              ) : (
                <Button size="sm" variant="danger" className="h-11" icon={<IconBan size={16} />} disabled={!!statusBlocked} aria-describedby={statusBlocked ? statusReasonId : undefined} onClick={() => setPending({ kind: "status", status: "suspended" })}>Suspendre</Button>
              )}
            </div>
            {roleBlocked && <DisabledReason id={roleReasonId}>{roleBlocked}</DisabledReason>}
            {statusBlocked && <DisabledReason id={statusReasonId}>{statusBlocked}</DisabledReason>}
            {u.role !== "admin" && u.status === "suspended" && <p className="text-[13px] text-muted">Réactive le compte avant de le promouvoir.</p>}
          </div>
        }
      >
        {r.error ? <ErrorState compact error={r.error} onRetry={r.reload} /> : null}
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-5">
            <Panel id="quota" title="Quota du jour" description={eff.unlimited ? (u.role === "admin" ? "Illimité : rôle administrateur (appliqué par le serveur)." : "Illimité (politique personnalisée).") : "Remise à zéro automatique à minuit, heure de Paris."}>
              <div className="grid grid-cols-3 gap-3 sm:gap-4">
                <div><p className="text-[13px] text-ink-soft">Utilisées</p><p className="tabular text-[26px] font-semibold">{fmtNum(eff.todayUsed)}<span className="text-[15px] font-normal text-muted"> / {limit === null ? "∞" : fmtNum(limit)}</span></p></div>
                <div><p className="text-[13px] text-ink-soft">Restantes</p><p className="tabular text-[26px] font-semibold">{eff.remaining === null ? "∞" : fmtNum(eff.remaining)}</p></div>
                <div><p className="text-[13px] text-ink-soft">Simultanées</p><p className="tabular text-[26px] font-semibold">{fmtNum(eff.maxActive)}</p></div>
              </div>
              {limit !== null && <Meter className="mt-4" value={eff.todayUsed} max={Math.max(1, limit)} label={`${eff.todayUsed} conversions utilisées sur ${limit} aujourd'hui`} />}
              <p className="tabular mt-3 text-[13px] text-muted">
                {eff.todayBonus > 0 ? <>Dont bonus du jour : +{fmtNum(eff.todayBonus)}. </> : null}
                {d.policy.resetAt ? <>Dernière remise à zéro : {fmtDateTime(d.policy.resetAt)}.</> : null}
              </p>
              <div className="mt-5 grid gap-6 border-t border-line pt-5 lg:grid-cols-2">
                <div>
                  <h3 className="text-[14.5px] font-medium">Bonus pour aujourd'hui</h3>
                  <p className="mb-3 mt-0.5 text-[13px] text-muted">Conversions en plus, valables jusqu'à minuit.</p>
                  <GrantForm disabledReason={eff.unlimited ? "Quota illimité : un bonus ne changerait rien." : null} onSubmit={setPending} />
                </div>
                <div>
                  <h3 className="text-[14.5px] font-medium">Compteur du jour</h3>
                  <p className="mb-3 mt-0.5 text-[13px] text-muted">Annule les conversions comptées aujourd'hui.</p>
                  <Button variant="secondary" icon={<IconReset size={17} />} disabled={eff.todayUsed === 0} aria-describedby={eff.todayUsed === 0 ? resetReasonId : undefined} onClick={() => setPending({ kind: "reset" })}>Remettre à zéro</Button>
                  {eff.todayUsed === 0 && <DisabledReason id={resetReasonId}>Rien à remettre à zéro : aucune conversion comptée aujourd'hui.</DisabledReason>}
                </div>
              </div>
            </Panel>

            <Panel title="Politique de quota" description={u.role === "admin" ? "Ce compte est administrateur : quota illimité quel que soit ce réglage. La politique s'appliquera s'il redevient utilisateur." : "Limite propre à ce compte ; sinon, les valeurs globales s'appliquent."}>
              <QuotaEditor d={d} global={quotas.data?.global} onSubmit={setPending} />
            </Panel>

            <Panel
              title="Activité récente"
              description="Les 20 dernières conversions (sans lien ni titre de vidéo, par conception)."
              actions={d.recentActivity.length ? <Link to={`/admin/conversions${qs({ userId: u.id })}`} className={cn(linkCls, "inline-flex min-h-11 items-center text-[14px]")}>Toutes ses conversions</Link> : null}
            >
              {d.recentActivity.length ? (
                <ConversionList items={d.recentActivity} href={(c) => `/admin/conversions${qs({ userId: u.id, open: c.id })}`} />
              ) : <EmptyState title="Aucune conversion">Ce compte n'a encore rien converti.</EmptyState>}
            </Panel>

            <Panel title="Erreurs récentes" description="Les 10 derniers échecs, avec le texte vu sur l'iPhone.">
              {d.recentErrors.length ? (
                <ul className="divide-y divide-line">
                  {d.recentErrors.map((c) => (
                    <li key={c.id} className="py-2.5 first:pt-0 last:pb-0">
                      <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted"><Mono>{c.errorCode ?? "inconnu"}</Mono>{platformLabel(c.platform)} · {c.fmt.toUpperCase()} · {fmtDateTime(c.createdAt)}</p>
                      <p className="mt-1 text-[14px] text-ink">{c.errorMessage ?? "La conversion a échoué."}</p>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[14px] text-muted">Aucun échec récent.</p>}
            </Panel>
          </div>

          <div className="min-w-0 space-y-5">
            <Panel title="Compte">
              <div className="mb-4 flex items-center gap-3">
                <Monogram initials={u.initials} name={who} admin={u.role === "admin"} size={48} />
                <p className="text-[13px] leading-snug text-muted">Initiales à la place de la photo Google, qui n'est pas conservée (confidentialité).</p>
              </div>
              <KeyValues items={[
                ["Identifiant", <Mono key="id">{u.id}</Mono>],
                ["Inscription", fmtDateTime(u.createdAt)],
                ["Dernière activité", fmtDateTime(u.lastActiveAt)],
                ["Conversions (30 j)", fmtNum(u.conversions30d)],
                ["Conversions (total)", fmtNum(u.conversionsTotal)],
                ["Jetons actifs", fmtNum(u.activeKeys)],
              ]} />
            </Panel>

            <Panel title="Statistiques" description="Depuis la création du compte.">
              <KeyValues items={[
                ["Conversions", fmtNum(d.stats.total)],
                ["Réussies", fmtNum(d.stats.done)],
                ["Échecs", fmtNum(d.stats.error)],
                ["Taux de réussite", fmtPct(successRate)],
                ["Durée moyenne", fmtDuration(d.stats.avgDurationS)],
                ["MP4 / MP3", `${fmtNum(d.stats.byFormat?.mp4 ?? 0)} / ${fmtNum(d.stats.byFormat?.mp3 ?? 0)}`],
              ]} />
              {byPlatform.length > 0 && (
                <div className="mt-4 border-t border-line pt-4">
                  <HBars items={byPlatform.map(([k, v]) => ({ key: k, label: platformLabel(k), value: v as number, display: fmtNum(v as number) }))} />
                </div>
              )}
            </Panel>

            <Panel title="Jetons" description="Préfixe visible seulement : la valeur n'est jamais stockée en clair.">
              {d.keys.length ? (
                <ul className="divide-y divide-line">
                  {d.keys.map((k) => (
                    <li key={k.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[14.5px] font-medium">{k.name || "Sans nom"}</p>
                          <p className="mt-0.5"><Mono>{k.start ? `${k.start}…` : "ytc_…"}</Mono></p>
                        </div>
                        <KeyBadge state={k.state} reason={k.revokedReason} />
                      </div>
                      <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
                        Créé le {fmtDate(k.createdAt)} · {k.lastUsedAt ? <>utilisé {fmtRelative(k.lastUsedAt)}</> : "jamais utilisé"}{k.expiresAt ? <> · expire le {fmtDate(k.expiresAt)}</> : null}{k.revokedAt ? <> · révoqué le {fmtDate(k.revokedAt)}</> : null}
                      </p>
                      {k.state === "active" && (
                        <button type="button" onClick={() => setPending({ kind: "revoke", key: k })} className="mt-2 inline-flex min-h-11 items-center rounded-full border border-bad/25 bg-bad-bg px-4 text-[13.5px] font-medium text-bad transition-colors hover:border-bad/45">
                          Révoquer<span className="sr-only"> le jeton {k.name}</span>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[14px] text-muted">Aucun jeton.</p>}
            </Panel>

            <Panel title="Journal" description="Les 20 derniers événements d'administration le concernant.">
              {d.audit.length ? (
                <ul className="divide-y divide-line">
                  {d.audit.map((e) => {
                    return (
                      <li key={e.id} className="py-2.5 first:pt-0 last:pb-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 text-[14px]"><ActionCell action={e.action} /></div>
                          <ResultBadge result={e.result} />
                        </div>
                        <p className="mt-1 text-[12.5px] text-muted">{fmtDateTime(e.at)} · {e.actorLabel ?? (e.actorId ? e.actorId : "Système")}</p>
                        {e.details !== null && e.details !== undefined && e.details !== "" && (
                          <button type="button" aria-expanded={openAudit === e.id} onClick={() => setOpenAudit(openAudit === e.id ? null : e.id)} className={cn(linkCls, "mt-1 inline-flex min-h-11 items-center text-[13px]")}>{openAudit === e.id ? "Masquer les détails" : "Voir les détails"}</button>
                        )}
                        {openAudit === e.id && <div className="mt-1"><AuditDetails details={e.details} /></div>}
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="text-[14px] text-muted">Aucun événement.</p>}
            </Panel>
          </div>
        </div>
      </AdminPage>

      <ConfirmDialog
        open={!!pending && !!dialog}
        onClose={() => setPending(null)}
        title={dialog?.title ?? ""}
        consequence={dialog?.text}
        confirmLabel={dialog?.confirm ?? "Confirmer"}
        tone={dialog?.tone ?? "danger"}
        onConfirm={run}
      />
    </>
  );
}

// Quotas : limites commerciales globales (modifiables), plafond technique (jamais levé), comptes à la
// limite aujourd'hui, politiques personnalisées, évolution sur 30 jours.
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { ApiError } from "../../lib/api.ts";
import { Button } from "../../ui/Button.tsx";
import { Skeleton } from "../../ui/bits.tsx";
import { useToast } from "../../ui/Toasts.tsx";
import { DataDetails, Legend, LineChart, SERIES } from "../charts.tsx";
import { TodayCell, UserCell } from "../cells.tsx";
import { adminMutate, useAdmin } from "../data.ts";
import { fmtDateTime, fmtDay, fmtNum } from "../format.ts";
import type { CustomPolicyRow, Quotas as QuotasData, UserRow } from "../types.ts";
import { AdminPage, ConfirmDialog, DataTable, EmptyState, Gate, KeyValues, Kpi, Panel, TextField, type Column } from "../ui.tsx";

const intIn = (v: string, min: number, max: number) => (/^\d+$/.test(v.trim()) && Number(v) >= min && Number(v) <= max ? Number(v) : null);

function GlobalForm({ g, onDone }: { g: QuotasData["global"]; onDone: () => unknown }) {
  const toast = useToast();
  const [daily, setDaily] = useState(String(g.dailyLimit));
  const [active, setActive] = useState(String(g.maxActive));
  const [errors, setErrors] = useState<{ daily?: string; active?: string; server?: string }>({});
  const [pending, setPending] = useState<{ dailyLimit?: number; maxActive?: number } | null>(null);
  useEffect(() => { setDaily(String(g.dailyLimit)); setActive(String(g.maxActive)); }, [g.dailyLimit, g.maxActive]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const d = intIn(daily, 0, 10_000);
    const a = intIn(active, 1, g.techMaxActive);
    const errs: typeof errors = {};
    if (d === null) errs.daily = "Nombre entier de 0 à 10 000.";
    if (a === null) errs.active = `Nombre entier de 1 à ${g.techMaxActive} (plafond technique).`;
    setErrors(errs);
    if (d === null || a === null) return;
    const body: { dailyLimit?: number; maxActive?: number } = {};
    if (d !== g.dailyLimit) body.dailyLimit = d;
    if (a !== g.maxActive) body.maxActive = a;
    if (!Object.keys(body).length) { setErrors({ server: "Aucun changement à enregistrer." }); return; }
    setPending(body);
  };
  return (
    <form onSubmit={submit} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Conversions par jour et par compte" inputMode="numeric" value={daily} onChange={(e) => setDaily(e.target.value)} error={errors.daily} hint="0 à 10 000 · remise à zéro à minuit (Paris)" />
        <TextField label="Conversions simultanées par compte" inputMode="numeric" value={active} onChange={(e) => setActive(e.target.value)} error={errors.active} hint={`1 à ${g.techMaxActive} (plafond technique)`} />
      </div>
      {errors.server && <p role="alert" className="mt-3 text-[13.5px] text-bad">{errors.server}</p>}
      <Button type="submit" variant="primary" className="mt-4">Enregistrer les limites globales</Button>
      <ConfirmDialog
        open={!!pending}
        onClose={() => setPending(null)}
        title="Modifier les limites globales ?"
        tone="primary"
        confirmLabel="Enregistrer"
        consequence={<>
          S'applique dès la prochaine conversion à tous les comptes sans politique personnalisée (les administrateurs restent illimités) :
          <ul className="mt-2 list-disc space-y-1 pl-5 marker:text-gold">
            {pending?.dailyLimit !== undefined && <li>Par jour : {fmtNum(g.dailyLimit)} → <strong className="font-semibold text-ink">{fmtNum(pending.dailyLimit)}</strong></li>}
            {pending?.maxActive !== undefined && <li>Simultanées : {fmtNum(g.maxActive)} → <strong className="font-semibold text-ink">{fmtNum(pending.maxActive)}</strong></li>}
          </ul>
        </>}
        onConfirm={async () => {
          if (!pending) return;
          try {
            await adminMutate("PUT", "/quotas/global", pending, ["/quotas", "/settings", "/users", "/overview"]);
          } catch (e) {
            if (e instanceof ApiError && e.status === 400) setErrors({ server: e.message });
            throw e;
          }
          toast.show("success", "Limites globales enregistrées");
          await onDone();
        }}
      />
    </form>
  );
}

export default function Quotas() {
  const navigate = useNavigate();
  const r = useAdmin<QuotasData>("/quotas", 15_000);
  const q = r.data;
  const atLimitCols: Column<UserRow>[] = [
    { id: "user", header: "Utilisateur", primary: true, cell: (u) => <UserCell u={u} /> },
    { id: "today", header: "Aujourd'hui", align: "right", cell: (u) => <TodayCell u={u} /> },
    { id: "30d", header: "30 jours", align: "right", cell: (u) => <span className="tabular">{fmtNum(u.conversions30d)}</span> },
  ];
  // Avec une politique (contrat : objet imbriqué), ses champs font foi tels quels : un null veut dire
  // « valeur globale », jamais « la limite effective du compte » (qui inclut le bonus du jour).
  const policyOf = (u: CustomPolicyRow) => u.policy
    ? { dailyLimit: u.policy.dailyLimit ?? null, unlimited: u.policy.unlimited ?? false, maxActive: u.policy.maxActive ?? null, resetAt: u.policy.resetAt ?? null }
    : { dailyLimit: u.dailyLimit ?? null, unlimited: u.unlimited ?? false, maxActive: u.maxActive ?? null, resetAt: u.resetAt ?? null };
  const customCols: Column<CustomPolicyRow>[] = [
    { id: "user", header: "Utilisateur", primary: true, cell: (u) => <UserCell u={u} /> },
    { id: "daily", header: "Par jour", cell: (u) => { const p = policyOf(u); return p.unlimited ? <span className="font-medium text-gold-text">Illimité</span> : p.dailyLimit === null ? <span className="text-muted">globale</span> : <span className="tabular">{fmtNum(p.dailyLimit)}</span>; } },
    { id: "active", header: "Simultanées", cell: (u) => { const p = policyOf(u); return p.maxActive === null ? <span className="text-muted">globale</span> : <span className="tabular">{fmtNum(p.maxActive)}</span>; } },
    { id: "today", header: "Aujourd'hui", align: "right", cell: (u) => <TodayCell u={u} /> },
    { id: "reset", header: "Remise à zéro", cell: (u) => <span className="whitespace-nowrap text-ink-soft">{fmtDateTime(policyOf(u).resetAt)}</span> },
  ];
  return (
    <AdminPage eyebrow="Comptes" title="Quotas" lead="Limites commerciales, modifiables ici ; les limites techniques protègent le serveur et ne sont jamais levées, même pour un administrateur.">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Kpi loading={!q} label="Par jour (global)" value={fmtNum(q?.global.dailyLimit)} sub="conversions par compte" />
        <Kpi loading={!q} label="Simultanées (global)" value={fmtNum(q?.global.maxActive)} sub={q ? <>plafond technique : {fmtNum(q.global.techMaxActive)}</> : null} />
        <Kpi loading={!q} label="Conversions aujourd'hui" value={fmtNum(q?.today.conversions)} sub="tous comptes" />
        <Kpi loading={!q} label="Comptes actifs aujourd'hui" value={fmtNum(q?.today.users)} sub={q ? <>{fmtNum(q.atLimit.length)} à la limite</> : null} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Panel title="Limites globales" description="Valeurs par défaut de tous les comptes sans politique personnalisée.">
          <Gate r={r} skeleton={<Skeleton className="h-40" />}>{(d) => <GlobalForm g={d.global} onDone={r.reload} />}</Gate>
        </Panel>
        <Panel title="Règles appliquées par le serveur">
          <KeyValues items={[
            ["Administrateur", "illimité, sans limite commerciale de simultanéité"],
            ["Politique personnalisée", "limite du compte, ou illimité"],
            ["Bonus du jour", "s'ajoute à la limite, jusqu'à minuit"],
            ["Simultanées effectives", "le plus petit entre la valeur choisie et le plafond technique"],
            ["Jamais levé", "plafond technique, capacité de ytapi, durée et taille maximales, limiteurs"],
          ]} />
        </Panel>
      </div>

      <Panel title="Évolution sur 30 jours" description="Conversions comptées et comptes actifs par jour.">
        <Gate r={r} skeleton={<Skeleton className="h-56" />}>
          {(d) => {
            const series = [{ key: "conversions", label: "Conversions", ...SERIES.gold }, { key: "users", label: "Comptes actifs", ...SERIES.graphite }];
            return (
              <>
                <Legend kind="line" series={[{ key: "c", label: "Conversions", swatch: "bg-gold-text" }, { key: "u", label: "Comptes actifs", swatch: "bg-raised" }]} />
                <div className="mt-3">
                  <LineChart
                    area={false}
                    summary={`Sur 30 jours : ${d.series.reduce((s, x) => s + x.conversions, 0)} conversions ; au plus ${Math.max(0, ...d.series.map((x) => x.users))} comptes actifs un même jour.`}
                    series={series}
                    data={d.series.map((p) => ({ label: fmtDay(p.day), full: fmtDay(p.day, true), values: { conversions: p.conversions, users: p.users } }))}
                  />
                </div>
                <DataDetails table={{ caption: "Conversions et comptes actifs par jour", columns: ["Jour", "Conversions", "Comptes actifs"], rows: d.series.map((p) => [fmtDay(p.day, true), fmtNum(p.conversions), fmtNum(p.users)]) }} />
              </>
            );
          }}
        </Gate>
      </Panel>

      <div className="grid gap-5 2xl:grid-cols-2">
        <Panel title="À la limite aujourd'hui" description="Comptes qui ont atteint leur limite du jour : accorde un bonus depuis leur fiche.">
          <Gate r={r} skeleton={<Skeleton className="h-32" />} isEmpty={(d) => d.atLimit.length === 0} empty={<EmptyState title="Personne à la limite">Aucun compte n'a atteint sa limite aujourd'hui.</EmptyState>}>
            {(d) => <DataTable caption="Comptes à la limite aujourd'hui" rows={d.atLimit} columns={atLimitCols} rowKey={(u) => u.id} onRowClick={(u) => navigate(`/admin/users/${encodeURIComponent(u.id)}#quota`)} rowLabel={(u) => u.email} mobileDetails={false} minWidth={480} />}
          </Gate>
        </Panel>
        <Panel title="Politiques personnalisées" description="Comptes avec une limite, une simultanéité ou un illimité propres.">
          <Gate r={r} skeleton={<Skeleton className="h-32" />} isEmpty={(d) => d.custom.length === 0} empty={<EmptyState title="Aucune politique personnalisée">Tous les comptes suivent les limites globales.</EmptyState>}>
            {(d) => <DataTable caption="Politiques de quota personnalisées" rows={d.custom} columns={customCols} rowKey={(u) => u.id} onRowClick={(u) => navigate(`/admin/users/${encodeURIComponent(u.id)}#quota`)} rowLabel={(u) => u.email} mobileDetails={false} minWidth={720} />}
          </Gate>
        </Panel>
      </div>
    </AdminPage>
  );
}

// Jetons API (clés ytc_) : actifs, révoqués, expirés ; type (raccourci ou extension navigateur, avec
// l'appareil lié), propriétaire, dates, dernière utilisation, révocation immédiate. Refus
// d'authentification agrégés par jour et par motif (jamais de jeton en clair).
import { useState } from "react";
import { useToast } from "../../ui/Toasts.tsx";
import { SegmentedControl } from "../../ui/SegmentedControl.tsx";
import { Skeleton } from "../../ui/bits.tsx";
import { IconKey } from "../../ui/Icon.tsx";
import { DataDetails, HBars, SERIES, StackedColumns } from "../charts.tsx";
import { keyColumns } from "../cells.tsx";
import { adminMutate, nextSort, qs, useAdmin, useFilters, useSearchInput } from "../data.ts";
import { AUTH_REASON, fmtDay, fmtFull, fmtNum, fmtRelative } from "../format.ts";
import type { AdminKey, AuthFailures, Page } from "../types.ts";
import { AdminPage, ConfirmDialog, DataTable, EmptyState, FilterBar, Gate, Mono, Pagination, Panel, SearchField, SelectField, SkeletonRows } from "../ui.tsx";

const PAGE_SIZE = 25;

function Failures() {
  const [days, setDays] = useState<"7" | "30">("7");
  const r = useAdmin<AuthFailures>(`/keys/auth-failures${qs({ days })}`, 30_000);
  return (
    <Panel
      title="Refus d'authentification"
      description="Jetons refusés par le service (agrégés par jour et par motif, sans conserver les jetons présentés)."
      actions={<SegmentedControl label="Période des refus" value={days} onChange={setDays} options={[{ value: "7", label: "7 jours" }, { value: "30", label: "30 jours" }]} />}
    >
      <Gate r={r} skeleton={<Skeleton className="h-56" />}>
        {(d) => {
          const total = d.series.reduce((s, x) => s + x.count, 0);
          const reasons = [...d.byReason].sort((a, b) => b.count - a.count);
          return (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <div className="min-w-0">
                <p className="tabular text-[13.5px] text-ink-soft"><span className="text-[22px] font-semibold text-ink">{fmtNum(total)}</span> refus sur {days} jours{d.lastAt ? <> · dernier {fmtRelative(d.lastAt)} ({fmtFull(d.lastAt)})</> : null}</p>
                <div className="mt-3">
                  <StackedColumns
                    height={190}
                    summary={`Refus d'authentification par jour sur ${days} jours : ${total} au total.`}
                    series={[{ key: "count", label: "Refus", ...SERIES.graphite }]}
                    data={d.series.map((p) => ({ label: fmtDay(p.day), full: fmtDay(p.day, true), values: { count: p.count } }))}
                    emptyText="Aucun refus sur la période."
                  />
                </div>
                <DataDetails table={{ caption: "Refus d'authentification par jour", columns: ["Jour", "Refus"], rows: d.series.map((p) => [fmtDay(p.day, true), fmtNum(p.count)]) }} />
              </div>
              <div className="min-w-0">
                <h3 className="mb-3 text-[14px] font-medium">Par motif</h3>
                <HBars
                  barClass="bg-graphite"
                  empty="Aucun refus sur la période."
                  items={reasons.map((x) => ({ key: x.reason, label: <>{AUTH_REASON[x.reason] ?? x.reason} <Mono className="ml-1">{x.reason}</Mono></>, value: x.count, display: fmtNum(x.count) }))}
                />
              </div>
            </div>
          );
        }}
      </Gate>
    </Panel>
  );
}

export default function ApiKeys() {
  const toast = useToast();
  const f = useFilters({ state: "", kind: "", q: "", userId: "", sort: "createdAt", dir: "desc" });
  const [search, setSearch] = useSearchInput(f.values.q, (v) => f.set({ q: v }, { replace: true }));
  const path = `/keys${qs({ state: f.values.state, kind: f.values.kind, userId: f.values.userId, q: f.values.q, sort: f.values.sort, dir: f.values.dir, page: f.page, pageSize: PAGE_SIZE })}`;
  const r = useAdmin<Page<AdminKey>>(path);
  const [revoke, setRevoke] = useState<AdminKey | null>(null);
  const sort = { key: f.values.sort, dir: f.values.dir === "asc" ? "asc" as const : "desc" as const };
  const columns = keyColumns({ onRevoke: setRevoke }).map((c) => (c.id === "created" ? { ...c, sortKey: "createdAt" } : c.id === "used" ? { ...c, sortKey: "lastUsedAt" } : c));
  return (
    <AdminPage
      eyebrow="Comptes"
      title="Clés API"
      lead="Jetons personnels ytc_ utilisés par le raccourci et par l'extension navigateur. Seul le préfixe est visible : la valeur n'est jamais stockée en clair ni affichée."
    >
      <FilterBar className="lg:grid-cols-[minmax(240px,2fr)_repeat(3,minmax(150px,1fr))]">
        <SearchField className="col-span-2 lg:col-span-1" label="Rechercher" value={search} onChange={setSearch} placeholder="Nom, préfixe, appareil ou e-mail" />
        <SelectField label="État" value={f.values.state} onChange={(v) => f.set({ state: v })} options={[{ value: "", label: "Tous" }, { value: "active", label: "Actifs" }, { value: "revoked", label: "Révoqués" }, { value: "expired", label: "Expirés" }]} />
        <SelectField label="Type" value={f.values.kind} onChange={(v) => f.set({ kind: v })} options={[{ value: "", label: "Tous" }, { value: "shortcut", label: "Raccourci" }, { value: "extension", label: "Extension" }, { value: "premiere", label: "Premiere" }, { value: "discord", label: "Discord" }]} />
        <SelectField className="col-span-2 sm:col-span-1" label="Trier par" value={`${f.values.sort}:${f.values.dir}`} onChange={(v) => { const [s, d] = v.split(":"); f.set({ sort: s, dir: d }); }} options={[
          { value: "createdAt:desc", label: "Création, récents d'abord" }, { value: "createdAt:asc", label: "Création, anciens d'abord" },
          { value: "lastUsedAt:desc", label: "Utilisés récemment" }, { value: "lastUsedAt:asc", label: "Utilisés il y a longtemps" },
        ]} />
      </FilterBar>

      <Gate
        r={r}
        skeleton={<SkeletonRows rows={6} />}
        isEmpty={(d) => d.total === 0}
        empty={<EmptyState icon={<IconKey size={20} />} title="Aucun jeton ne correspond">Modifie les filtres ou la recherche.</EmptyState>}
      >
        {(d) => (
          <>
            <DataTable caption="Jetons API" rows={d.items} columns={columns} rowKey={(k) => k.id} sort={sort} onSort={(k) => { const n = nextSort(sort, k); f.set({ sort: n.sort, dir: n.dir }); }} minWidth={1040} />
            <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={(p) => f.set({ page: String(p) })} label="Pages des jetons" />
          </>
        )}
      </Gate>

      <Failures />

      <ConfirmDialog
        open={!!revoke}
        onClose={() => setRevoke(null)}
        title={`Révoquer le jeton « ${revoke?.name ?? ""} » ?`}
        consequence={revoke?.kind === "discord"
          ? <>La clé de 15 minutes émise pour le bot Discord de {revoke.userEmail ?? "son propriétaire"} (<Mono>{revoke.start ? `${revoke.start}…` : "ytc_…"}</Mono>) est refusée immédiatement : la conversion qu'elle suivait ne peut plus être lancée ni suivie depuis Discord. La liaison Discord du compte n'est pas retirée. Action définitive.</>
          : revoke?.kind === "premiere"
          ? <>Premiere Pro de {revoke.userEmail ?? "son propriétaire"}{revoke.deviceLabel ? <> sur « {revoke.deviceLabel} »</> : null} (<Mono>{revoke.start ? `${revoke.start}…` : "ytc_…"}</Mono>) est déconnecté immédiatement : ses conversions sont refusées. Il devra reconnecter Premiere Pro depuis le panneau AETHRYON. Action définitive.</>
          : revoke?.kind === "extension"
          ? <>L'extension navigateur de {revoke.userEmail ?? "son propriétaire"}{revoke.deviceLabel ? <> sur « {revoke.deviceLabel} »</> : null} (<Mono>{revoke.start ? `${revoke.start}…` : "ytc_…"}</Mono>) est déconnectée immédiatement : ses conversions sont refusées. Il devra reconnecter l'extension. Action définitive.</>
          : <>Le raccourci de {revoke?.userEmail ?? "son propriétaire"} qui utilise ce jeton (<Mono>{revoke?.start ? `${revoke.start}…` : "ytc_…"}</Mono>) est refusé immédiatement, avec le message « Jeton refusé ». Il devra créer un nouveau jeton. Action définitive.</>}
        confirmLabel="Révoquer"
        onConfirm={async () => {
          if (!revoke) return;
          await adminMutate("POST", `/keys/${encodeURIComponent(revoke.id)}/revoke`, {}, ["/keys", "/users", "/overview"]);
          toast.show("success", "Jeton révoqué", revoke.name);
        }}
      />
    </AdminPage>
  );
}

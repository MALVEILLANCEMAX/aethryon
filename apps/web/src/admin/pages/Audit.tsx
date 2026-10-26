// Journal d'administration (ytc_admin_event) : qui a fait quoi, sur quoi, avec quel résultat.
// Filtres (action, acteur, résultat, cible) et pagination ; détails (avant/après) dépliables.
import { useMemo, useRef, useState } from "react";
import { IconInfo } from "../../ui/Icon.tsx";
import { ActionCell, AuditDetails, TargetCell } from "../cells.tsx";
import { qs, useAdmin, useFilters, useSearchInput } from "../data.ts";
import { ACTION_LABEL, fmtDateTime, fmtRelative, shortId } from "../format.ts";
import { IconScroll } from "../icons.tsx";
import type { AuditEvent, Page } from "../types.ts";
import { AdminPage, DataTable, Drawer, EmptyState, FilterBar, Gate, KeyValues, Mono, Pagination, ResultBadge, SearchField, SelectField, SkeletonRows, type Column } from "../ui.tsx";

const PAGE_SIZE = 50;

export default function Audit() {
  const f = useFilters({ action: "", actor: "", result: "", target: "" });
  const [action, setAction] = useSearchInput(f.values.action, (v) => f.set({ action: v }, { replace: true }));
  const [actor, setActor] = useSearchInput(f.values.actor, (v) => f.set({ actor: v }, { replace: true }));
  const [target, setTarget] = useSearchInput(f.values.target, (v) => f.set({ target: v }, { replace: true }));
  const r = useAdmin<Page<AuditEvent>>(`/audit${qs({ action: f.values.action, actor: f.values.actor, result: f.values.result, target: f.values.target, page: f.page, pageSize: PAGE_SIZE })}`, 15_000);
  const [open, setOpen] = useState<AuditEvent | null>(null);
  // Suggestions d'actions : celles connues + celles réellement vues dans le journal (jamais inventées).
  const seen = useRef(new Set<string>(Object.keys(ACTION_LABEL)));
  for (const e of r.data?.items ?? []) seen.current.add(e.action);
  const suggestions = useMemo(() => [...seen.current].sort(), [r.data]);

  const columns: Column<AuditEvent>[] = [
    { id: "at", header: "Date", primary: true, cell: (e) => (
      <div className="min-w-0">
        <p className="tabular whitespace-nowrap text-ink">{fmtDateTime(e.at)}</p>
        <p className="text-[12.5px] text-muted">{fmtRelative(e.at)}</p>
      </div>
    ) },
    { id: "actor", header: "Acteur", cell: (e) => (e.actorId || e.actorLabel ? <span className="block max-w-[220px] truncate">{e.actorLabel ?? shortId(e.actorId)}</span> : <span className="text-ink-soft">Système</span>) },
    { id: "action", header: "Action", cell: (e) => <ActionCell action={e.action} /> },
    { id: "target", header: "Cible", cell: (e) => <TargetCell e={e} /> },
    { id: "result", header: "Résultat", cell: (e) => <ResultBadge result={e.result} /> },
  ];

  return (
    <AdminPage eyebrow="Activité" title="Audit" lead="Chaque action d'administration, les refus d'accès et les amorçages de rôle, avec l'acteur au moment de l'action. Le journal ne contient ni jeton ni URL.">
      <FilterBar className="lg:grid-cols-4">
        <div className="col-span-2 min-w-0 sm:col-span-1">
          <SearchField label="Action" list="audit-actions" value={action} onChange={setAction} placeholder="ex. user.suspend" />
          <datalist id="audit-actions">{suggestions.map((a) => <option key={a} value={a}>{ACTION_LABEL[a] ?? a}</option>)}</datalist>
        </div>
        <SearchField label="Acteur" value={actor} onChange={setActor} placeholder="E-mail de l'administrateur" />
        <SearchField label="Cible" value={target} onChange={setTarget} placeholder="Identifiant" />
        <SelectField label="Résultat" value={f.values.result} onChange={(v) => f.set({ result: v })} options={[{ value: "", label: "Tous" }, { value: "ok", label: "Réussis" }, { value: "refused", label: "Refusés" }, { value: "error", label: "Erreurs" }]} />
      </FilterBar>

      <Gate
        r={r}
        skeleton={<SkeletonRows rows={10} />}
        isEmpty={(d) => d.total === 0}
        empty={<EmptyState icon={<IconScroll size={20} />} title="Aucun événement ne correspond">Modifie les filtres.</EmptyState>}
      >
        {(d) => (
          <>
            <DataTable caption="Journal d'administration" rows={d.items} columns={columns} rowKey={(e) => e.id} onRowClick={setOpen} rowLabel={(e) => `${fmtDateTime(e.at)}, ${e.action}`} minWidth={900} />
            <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={(p) => f.set({ page: String(p) })} label="Pages du journal" />
          </>
        )}
      </Gate>

      <p className="flex gap-2 text-[13px] leading-relaxed text-muted"><IconInfo size={16} className="mt-0.5 shrink-0" />Les refus d'accès au Control Center sont journalisés au plus une fois par compte et par 10 minutes.</p>

      <Drawer open={!!open} onClose={() => setOpen(null)} title="Événement du journal" subtitle={open ? fmtDateTime(open.at) : null}>
        {open && (
          <div className="space-y-5">
            <KeyValues items={[
              ["Action", <ActionCell key="a" action={open.action} />],
              ["Résultat", <ResultBadge key="r" result={open.result} />],
              ["Acteur", open.actorLabel ?? (open.actorId ? <Mono key="ac">{open.actorId}</Mono> : "Système")],
              ["Cible", <TargetCell key="t" e={open} />],
              ["Identifiant", <Mono key="id">{open.id}</Mono>],
            ]} />
            <section>
              <h3 className="mb-2 text-[14px] font-semibold">Détails</h3>
              <AuditDetails details={open.details} />
            </section>
          </div>
        )}
      </Drawer>
    </AdminPage>
  );
}

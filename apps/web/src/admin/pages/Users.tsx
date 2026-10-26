// Utilisateurs : recherche, filtres (rôle, statut), tri, pagination. Monogrammes : les avatars Google ne
// sont pas stockés (choix de confidentialité, docs/ADMIN.md §8).
import { useNavigate } from "react-router";
import { IconInfo } from "../../ui/Icon.tsx";
import { nextSort, qs, useAdmin, useFilters, useSearchInput } from "../data.ts";
import { fmtDate, fmtNum, fmtRelative } from "../format.ts";
import type { Page, UserRow } from "../types.ts";
import { AdminPage, DataTable, EmptyState, FilterBar, Gate, Pagination, RoleBadge, SearchField, SelectField, SkeletonRows, StatusBadge, type Column } from "../ui.tsx";
import { TodayCell, UserCell } from "../cells.tsx";
import { IconUsers } from "../icons.tsx";

const PAGE_SIZE = 25;
const SORTS = [
  { value: "createdAt:desc", label: "Inscription, récentes d'abord" },
  { value: "createdAt:asc", label: "Inscription, anciennes d'abord" },
  { value: "lastActiveAt:desc", label: "Activité récente d'abord" },
  { value: "lastActiveAt:asc", label: "Activité ancienne d'abord" },
  { value: "conversions:desc", label: "Conversions, plus d'abord" },
  { value: "email:asc", label: "E-mail, A → Z" },
  { value: "email:desc", label: "E-mail, Z → A" },
];

export default function Users() {
  const navigate = useNavigate();
  const f = useFilters({ q: "", role: "", status: "", sort: "createdAt", dir: "desc" });
  const [search, setSearch] = useSearchInput(f.values.q, (v) => f.set({ q: v }, { replace: true }));
  const path = `/users${qs({ q: f.values.q, role: f.values.role, status: f.values.status, sort: f.values.sort, dir: f.values.dir, page: f.page, pageSize: PAGE_SIZE })}`;
  const r = useAdmin<Page<UserRow>>(path);
  const sort = { key: f.values.sort, dir: f.values.dir === "asc" ? "asc" as const : "desc" as const };
  const columns: Column<UserRow>[] = [
    { id: "user", header: "Utilisateur", primary: true, cell: (u) => <UserCell u={u} />, className: "max-w-[300px]" },
    { id: "role", header: "Rôle", cell: (u) => <RoleBadge role={u.role} /> },
    { id: "status", header: "Statut", cell: (u) => <StatusBadge status={u.status} /> },
    { id: "created", header: "Inscription", sortKey: "createdAt", cell: (u) => <span className="text-ink-soft">{fmtDate(u.createdAt)}</span> },
    { id: "active", header: "Dernière activité", sortKey: "lastActiveAt", cell: (u) => <span className="text-ink-soft">{fmtRelative(u.lastActiveAt)}</span> },
    { id: "conv", header: "Conversions", sortKey: "conversions", align: "right", cell: (u) => <span className="tabular">{fmtNum(u.conversions30d)} <span className="text-muted">en 30 j · {fmtNum(u.conversionsTotal)} au total</span></span> },
    { id: "today", header: "Aujourd'hui", align: "right", cell: (u) => <TodayCell u={u} /> },
    { id: "keys", header: "Jetons actifs", align: "right", cell: (u) => <span className="tabular">{fmtNum(u.activeKeys)}</span> },
  ];
  return (
    <AdminPage
      eyebrow="Comptes"
      title="Utilisateurs"
      lead={r.data ? <>{fmtNum(r.data.total)} compte{r.data.total > 1 ? "s" : ""} correspond{r.data.total > 1 ? "ent" : ""} aux filtres.</> : "Comptes créés avec Google ou par e-mail (adresse toujours vérifiée)."}
    >
      <FilterBar className="lg:grid-cols-[minmax(240px,2fr)_repeat(3,minmax(160px,1fr))]">
        <SearchField className="col-span-2 lg:col-span-1" label="Rechercher" value={search} onChange={setSearch} placeholder="E-mail ou nom" />
        <SelectField label="Rôle" value={f.values.role} onChange={(v) => f.set({ role: v })} options={[{ value: "", label: "Tous les rôles" }, { value: "user", label: "Utilisateurs" }, { value: "admin", label: "Administrateurs" }]} />
        <SelectField label="Statut" value={f.values.status} onChange={(v) => f.set({ status: v })} options={[{ value: "", label: "Tous les statuts" }, { value: "active", label: "Actifs" }, { value: "suspended", label: "Suspendus" }]} />
        <SelectField className="col-span-2 sm:col-span-1" label="Trier par" value={`${f.values.sort}:${f.values.dir}`} onChange={(v) => { const [s, d] = v.split(":"); f.set({ sort: s, dir: d }); }} options={SORTS.some((o) => o.value === `${f.values.sort}:${f.values.dir}`) ? SORTS : [...SORTS, { value: `${f.values.sort}:${f.values.dir}`, label: "Tri personnalisé" }]} />
      </FilterBar>

      <Gate
        r={r}
        skeleton={<SkeletonRows rows={8} />}
        isEmpty={(d) => d.total === 0}
        empty={<EmptyState icon={<IconUsers size={20} />} title="Aucun compte ne correspond">Modifie la recherche ou les filtres.</EmptyState>}
      >
        {(d) => (
          <>
            <DataTable
              caption="Utilisateurs"
              rows={d.items}
              columns={columns}
              rowKey={(u) => u.id}
              sort={sort}
              onSort={(k) => { const n = nextSort(sort, k, { email: "asc" }); f.set({ sort: n.sort, dir: n.dir }); }}
              onRowClick={(u) => navigate(`/admin/users/${encodeURIComponent(u.id)}`)}
              rowLabel={(u) => u.email}
              minWidth={980}
              mobileDetails={false}
            />
            <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={(p) => f.set({ page: String(p) })} label="Pages des utilisateurs" />
          </>
        )}
      </Gate>

      <p className="flex gap-2 text-[13px] leading-relaxed text-muted">
        <IconInfo size={16} className="mt-0.5 shrink-0" />
        Les photos de profil Google ne sont pas conservées, par choix de confidentialité : chaque compte est représenté par ses initiales.
      </p>
    </AdminPage>
  );
}

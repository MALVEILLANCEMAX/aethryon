// Conversions : filtres (état, plateforme, format, utilisateur), tri, pagination, tiroir de détail avec la
// cause technique nettoyée (jamais d'URL ni de jeton). Annulation seulement pour une conversion réservée
// ou en cours dont le job ytapi est connu. Pas de bouton « relancer » : seul l'utilisateur relance.
import { useId, useState } from "react";
import { useToast } from "../../ui/Toasts.tsx";
import { Button } from "../../ui/Button.tsx";
import { Skeleton } from "../../ui/bits.tsx";
import { IconActivity } from "../../ui/Icon.tsx";
import { UserLink, conversionColumns } from "../cells.tsx";
import { adminMutate, nextSort, qs, useAdmin, useFilters, usePolling, useSearchInput } from "../data.ts";
import { clampPct, fmtBytes, fmtDateTime, fmtDuration, fmtFull, fmtNum, fmtPct, platformLabel, shortId } from "../format.ts";
import { IconStop } from "../icons.tsx";
import type { Conversion, ConversionDetail, Page } from "../types.ts";
import {
  AdminPage, ConfirmDialog, DataTable, DisabledReason, Drawer, EmptyState, ErrorState, FilterBar, Gate, KeyValues, Meter, Mono, Pagination,
  SearchField, SelectField, SkeletonRows, StateBadge,
} from "../ui.tsx";

const PAGE_SIZE = 25;
const STAGE: Record<string, string> = {
  queued: "En file d'attente", pending: "En attente", starting: "Démarrage", resolving: "Analyse du lien", extracting: "Analyse du lien",
  downloading: "Téléchargement", download: "Téléchargement", converting: "Conversion", transcoding: "Réencodage", merging: "Assemblage",
  postprocessing: "Finalisation", finalizing: "Finalisation", ready: "Prêt", done: "Terminé",
};
const CANCELLABLE = new Set(["reserved", "running"]);

function DetailBody({ id, onCancel }: { id: string; onCancel: (c: ConversionDetail) => void }) {
  const r = useAdmin<ConversionDetail>(`/conversions/${encodeURIComponent(id)}`, 3_000);
  const live = !!r.data && CANCELLABLE.has(r.data.state);
  usePolling(r.reload, 3_000, live);
  const reasonId = useId();
  if (!r.data) {
    return r.error ? <ErrorState error={r.error} onRetry={r.reload} /> : <div aria-busy="true" className="space-y-3"><span className="sr-only" role="status">Chargement…</span><Skeleton className="h-8 w-40" /><Skeleton className="h-48" /><Skeleton className="h-24" /></div>;
  }
  const c = r.data;
  const progress = c.live?.progress ?? null;
  const pct = progress === null ? null : clampPct(progress); // pourcentage (ytapi)
  const canCancel = CANCELLABLE.has(c.state) && !!c.jobId;
  return (
    <div className="space-y-6">
      {r.error ? <ErrorState compact error={r.error} onRetry={r.reload} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <StateBadge state={c.state} />
        <span className="text-[13.5px] text-muted">{platformLabel(c.platform)} · {c.fmt.toUpperCase()}</span>
      </div>

      {c.live && CANCELLABLE.has(c.state) && (
        <section aria-labelledby={`${reasonId}-live`} className="rounded-[16px] border border-gold/40 bg-pearl/70 p-4">
          <h3 id={`${reasonId}-live`} className="text-[14px] font-semibold">En direct (ytapi)</h3>
          <p className="mt-1 text-[14px] text-ink-soft" role="status">{c.live.stage ? STAGE[c.live.stage] ?? c.live.stage : "Étape inconnue"}{pct !== null ? ` · ${fmtPct(pct, true)}` : ""}</p>
          {pct !== null && <Meter className="mt-2" value={Math.round(pct)} max={100} label="Progression de la conversion" warnAt={2} badAt={2} />}
          <p className="mt-2 text-[12.5px] text-muted">Actualisé toutes les 3 secondes.</p>
        </section>
      )}

      <KeyValues items={[
        ["Utilisateur", <UserLink key="u" id={c.userId} email={c.userEmail} />],
        ["Jeton", c.keyName ?? "—"],
        ["Identifiant", <Mono key="id">{c.id}</Mono>],
        ["Job ytapi", c.jobId ? <Mono key="j">{c.jobId}</Mono> : "—"],
        ["Créée", fmtFull(c.createdAt)],
        ["Démarrée", fmtFull(c.startedAt)],
        ["Terminée", fmtFull(c.finishedAt)],
        ["Durée totale", fmtDuration(c.durationS)],
        ["Traitement", fmtDuration(c.processingS)],
        ["Taille du fichier", fmtBytes(c.sizeBytes)],
      ]} />

      {(c.errorCode || c.errorMessage) && (
        <section className="rounded-[16px] border border-bad/20 bg-bad-bg/60 p-4">
          <h3 className="text-[14px] font-semibold text-bad">Erreur</h3>
          <p className="mt-1.5 text-[14px] text-ink">{c.errorMessage ?? "La conversion a échoué."}</p>
          {c.errorCode && <p className="mt-1.5 text-[12.5px] text-ink-soft">Code <Mono>{c.errorCode}</Mono> · texte affiché sur l'iPhone et dans l'historique</p>}
        </section>
      )}

      <section>
        <h3 className="text-[14px] font-semibold">Cause technique</h3>
        {c.cause ? (
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-[12px] border border-line bg-white/60 p-3 font-mono text-[12.5px] leading-relaxed text-ink-soft">{c.cause}</pre>
        ) : <p className="mt-1 text-[14px] text-muted">Aucune cause technique enregistrée.</p>}
        <p className="mt-2 text-[12.5px] text-muted">Nettoyée par ytapi puis par account : jamais d'URL de vidéo, de jeton ni de cookie.</p>
      </section>

      {CANCELLABLE.has(c.state) && (
        <section className="border-t border-line pt-5">
          <Button variant="danger" icon={<IconStop size={17} />} disabled={!canCancel} aria-describedby={!canCancel ? reasonId : undefined} onClick={() => onCancel(c)}>Annuler la conversion</Button>
          {!canCancel && <DisabledReason id={reasonId}>Le job ytapi n'est pas encore connu : l'annulation propre n'est possible qu'une fois le job créé.</DisabledReason>}
        </section>
      )}
    </div>
  );
}

export default function Conversions() {
  const toast = useToast();
  const f = useFilters({ state: "", platform: "", fmt: "", q: "", userId: "", sort: "createdAt", dir: "desc" });
  const [search, setSearch] = useSearchInput(f.values.q, (v) => f.set({ q: v }, { replace: true }));
  const openId = f.extra("open");
  const path = `/conversions${qs({ state: f.values.state, platform: f.values.platform, fmt: f.values.fmt, userId: f.values.userId, q: f.values.q, sort: f.values.sort, dir: f.values.dir, page: f.page, pageSize: PAGE_SIZE })}`;
  const r = useAdmin<Page<Conversion>>(path, 10_000);
  const hasLive = !!r.data?.items.some((c) => CANCELLABLE.has(c.state));
  usePolling(r.reload, 10_000, hasLive || f.values.state === "running" || f.values.state === "reserved");
  const [cancel, setCancel] = useState<ConversionDetail | null>(null);
  const sort = { key: f.values.sort, dir: f.values.dir === "asc" ? "asc" as const : "desc" as const };
  const filterEmail = f.values.userId ? r.data?.items.find((c) => c.userId === f.values.userId)?.userEmail : null;

  return (
    <AdminPage
      eyebrow="Activité"
      title="Conversions"
      lead={r.data ? <>{fmtNum(r.data.total)} conversion{r.data.total > 1 ? "s" : ""} correspond{r.data.total > 1 ? "ent" : ""} aux filtres.</> : "Toutes les conversions, sans lien ni titre de vidéo (par conception)."}
    >
      <FilterBar className="lg:grid-cols-[minmax(220px,1.6fr)_repeat(4,minmax(140px,1fr))]">
        <SearchField className="col-span-2 lg:col-span-1" label="Rechercher" value={search} onChange={setSearch} placeholder="E-mail, identifiant, job" />
        <SelectField label="État" value={f.values.state} onChange={(v) => f.set({ state: v })} options={[
          { value: "", label: "Tous les états" }, { value: "done", label: "Terminées" }, { value: "error", label: "Échecs" },
          { value: "reserved", label: "Réservées" }, { value: "running", label: "En cours" }, { value: "cancelled", label: "Annulées" }, { value: "refunded", label: "Remboursées" },
        ]} />
        <SelectField label="Plateforme" value={f.values.platform} onChange={(v) => f.set({ platform: v })} options={[
          { value: "", label: "Toutes" }, { value: "youtube", label: "YouTube" }, { value: "tiktok", label: "TikTok" }, { value: "twitter", label: "X" },
        ]} />
        <SelectField label="Format" value={f.values.fmt} onChange={(v) => f.set({ fmt: v })} options={[{ value: "", label: "Tous" }, { value: "mp4", label: "MP4" }, { value: "mp3", label: "MP3" }]} />
        <SelectField className="col-span-2 sm:col-span-1" label="Trier par" value={`${f.values.sort}:${f.values.dir}`} onChange={(v) => { const [s, d] = v.split(":"); f.set({ sort: s, dir: d }); }} options={[
          { value: "createdAt:desc", label: "Plus récentes" }, { value: "createdAt:asc", label: "Plus anciennes" },
          { value: "durationS:desc", label: "Plus longues" }, { value: "durationS:asc", label: "Plus courtes" },
        ]} />
      </FilterBar>
      {f.values.userId && (
        <p className="flex flex-wrap items-center gap-2 text-[14px] text-ink-soft">
          Filtré sur l'utilisateur <Mono>{filterEmail ?? shortId(f.values.userId, 12)}</Mono>
          <button type="button" onClick={() => f.set({ userId: "" })} className="inline-flex min-h-11 items-center rounded-full border border-line px-3 text-[13.5px] text-ink transition-colors hover:bg-pearl">Retirer ce filtre</button>
        </p>
      )}

      <Gate
        r={r}
        skeleton={<SkeletonRows rows={8} />}
        isEmpty={(d) => d.total === 0}
        empty={<EmptyState icon={<IconActivity size={20} />} title="Aucune conversion ne correspond">Modifie les filtres ou la recherche.</EmptyState>}
      >
        {(d) => (
          <>
            <DataTable
              caption="Conversions"
              rows={d.items}
              columns={conversionColumns({ sortable: true })}
              rowKey={(c) => c.id}
              sort={sort}
              onSort={(k) => { const n = nextSort(sort, k); f.set({ sort: n.sort, dir: n.dir }); }}
              onRowClick={(c) => f.set({ open: c.id }, { keepPage: true })}
              rowLabel={(c) => `${fmtDateTime(c.createdAt)}, ${c.userEmail ?? ""}`}
              minWidth={960}
            />
            <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={(p) => f.set({ page: String(p) })} label="Pages des conversions" />
          </>
        )}
      </Gate>

      <Drawer open={!!openId} onClose={() => f.set({ open: "" }, { keepPage: true })} title="Détail de la conversion" subtitle={openId ? <Mono>{shortId(openId, 16)}</Mono> : null}>
        {openId && <DetailBody id={openId} onCancel={setCancel} />}
      </Drawer>

      <ConfirmDialog
        open={!!cancel}
        onClose={() => setCancel(null)}
        title="Annuler cette conversion ?"
        consequence={<>Le job <Mono>{cancel?.jobId ?? ""}</Mono> est arrêté proprement sur ytapi. Sur l'iPhone, {cancel?.userEmail ?? "l'utilisateur"} verra « La conversion a été annulée. » et devra relancer lui-même s'il le souhaite.</>}
        confirmLabel="Annuler la conversion"
        onConfirm={async () => {
          if (!cancel) return;
          await adminMutate("POST", `/conversions/${encodeURIComponent(cancel.id)}/cancel`, {}, ["/conversions", "/overview", "/system"]);
          toast.show("success", "Conversion annulée", cancel.jobId ? `Job ${cancel.jobId}` : undefined);
        }}
      />
    </AdminPage>
  );
}

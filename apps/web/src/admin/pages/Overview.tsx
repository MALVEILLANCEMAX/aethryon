// Vue d'ensemble : chiffres réels d'account (GET /api/admin/overview), alertes, conversions en cours et
// derniers échecs. Rafraîchie toutes les 30 s quand l'onglet est visible.
import { Link } from "react-router";
import { cn } from "../../lib/cn.ts";
import { IconAlert, IconCheck, IconInfo } from "../../ui/Icon.tsx";
import { Skeleton } from "../../ui/bits.tsx";
import { Donut, HBars, SLICE } from "../charts.tsx";
import { qs, useAdmin, usePolling } from "../data.ts";
import { fmtDuration, fmtNum, fmtPct, fmtRelative, platformLabel, toPct, type Tone } from "../format.ts";
import type { Alert, Conversion, Overview as OverviewData, Page } from "../types.ts";
import { AdminPage, EmptyState, ErrorState, Gate, Kpi, Mono, Panel, RefreshButton, StateBadge, ToneBadge, linkCls } from "../ui.tsx";

const LEVEL: Record<string, { label: string; tone: Tone; icon: typeof IconAlert }> = {
  critical: { label: "Critique", tone: "bad", icon: IconAlert },
  warning: { label: "Attention", tone: "warn", icon: IconAlert },
  info: { label: "Information", tone: "gold", icon: IconInfo },
};

function Alerts({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) {
    return <p className="flex items-center gap-2 text-[14.5px] text-ok"><IconCheck size={18} />Aucune alerte en cours.</p>;
  }
  const order = { critical: 0, warning: 1, info: 2 } as Record<string, number>;
  return (
    <ul className="divide-y divide-line">
      {[...alerts].sort((a, b) => (order[a.level] ?? 3) - (order[b.level] ?? 3)).map((a, i) => {
        const l = LEVEL[a.level] ?? LEVEL.info!;
        return (
          <li key={`${a.code}-${i}`} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-3">
            <ToneBadge tone={l.tone} className="self-start"><l.icon size={13} />{l.label}</ToneBadge>
            <div className="min-w-0 flex-1">
              <p className="text-[14.5px] leading-snug text-ink">{a.message}</p>
              <p className="mt-0.5 text-[12.5px] text-muted"><Mono>{a.code}</Mono> · {fmtRelative(a.at)}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function MiniList({ r, kind }: { r: ReturnType<typeof useAdmin<Page<Conversion>>>; kind: "running" | "error" }) {
  if (r.data === undefined) return r.error ? <ErrorState compact error={r.error} onRetry={r.reload} /> : <div className="space-y-2"><Skeleton className="h-11" /><Skeleton className="h-11" /><Skeleton className="h-11" /></div>;
  const items = r.data.items;
  if (!items.length) {
    return <EmptyState title={kind === "running" ? "Aucune conversion en cours" : "Aucun échec récent"}>{kind === "running" ? "Les conversions en cours de traitement apparaîtront ici." : "Rien à signaler."}</EmptyState>;
  }
  return (
    <ul className="divide-y divide-line">
      {items.map((c) => (
        <li key={c.id}>
          <Link to={`/admin/conversions${qs({ state: kind, open: c.id })}`} className="-mx-2 flex min-h-11 items-center gap-3 rounded-[10px] px-2 py-2 transition-colors hover:bg-pearl">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] text-ink">{c.userEmail ?? "Compte supprimé"}</p>
              <p className="truncate text-[12.5px] text-muted">
                {platformLabel(c.platform)} · {c.fmt.toUpperCase()} · {fmtRelative(c.createdAt)}
                {kind === "error" && c.errorCode ? <> · <Mono>{c.errorCode}</Mono></> : null}
              </p>
            </div>
            <StateBadge state={c.state} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function Overview() {
  const ov = useAdmin<OverviewData>("/overview", 20_000);
  const running = useAdmin<Page<Conversion>>(`/conversions${qs({ state: "running", pageSize: 5, sort: "createdAt", dir: "desc" })}`, 20_000);
  const failures = useAdmin<Page<Conversion>>(`/conversions${qs({ state: "error", pageSize: 5, sort: "createdAt", dir: "desc" })}`, 20_000);
  const refresh = () => Promise.all([ov.reload(), running.reload(), failures.reload()]);
  usePolling(refresh, 30_000);
  const o = ov.data;
  const rate = toPct(o?.conversions.successRate30d);
  const rateTone: Tone | undefined = rate === null ? undefined : rate >= 90 ? "ok" : rate >= 70 ? "warn" : "bad";
  const loading = !o;
  return (
    <AdminPage
      eyebrow="Control Center"
      title="Vue d'ensemble"
      lead="Ce qui se passe maintenant sur AETHRYON, mesuré par le service account. Actualisé toutes les 30 secondes."
      actions={<RefreshButton onRefresh={refresh} at={o ? ov.at : null} />}
    >
      {ov.error && !o ? <ErrorState error={ov.error} onRetry={ov.reload} /> : null}

      <Panel title="Alertes" description="Signalées par le serveur (file, disque, plateformes, erreurs).">
        {o ? <Alerts alerts={o.alerts} /> : ov.error ? <p className="text-[14px] text-muted">Indisponibles tant que la vue d'ensemble ne répond pas.</p> : <Skeleton className="h-12" />}
      </Panel>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-6">
        <Kpi loading={loading} label="Utilisateurs" value={fmtNum(o?.users.total)} sub={o && <>+{fmtNum(o.users.newToday)} aujourd'hui · +{fmtNum(o.users.new30d)} en 30 j</>} to="/admin/users" />
        <Kpi loading={loading} label="Actifs (24 h)" value={fmtNum(o?.users.active24h)} sub={o && <>{fmtNum(o.users.active30d)} sur 30 jours</>} />
        <Kpi loading={loading} label="Conversions aujourd'hui" value={fmtNum(o?.conversions.today)} sub={o && <>{fmtNum(o.conversions.last30d)} sur 30 jours</>} to="/admin/conversions" />
        <Kpi loading={loading} label="Réussite (30 j)" value={fmtPct(o?.conversions.successRate30d)} tone={rateTone} sub={o && <>{fmtNum(o.conversions.failures30d)} échec{o.conversions.failures30d > 1 ? "s" : ""}</>} to="/admin/analytics?period=30d" />
        <Kpi loading={loading} label="En cours" value={fmtNum(o?.conversions.running)} sub={o && <>ytapi : {o.jobs.active === null ? "—" : fmtNum(o.jobs.active)} actif{(o.jobs.active ?? 0) > 1 ? "s" : ""}, {o.jobs.queued === null ? "—" : fmtNum(o.jobs.queued)} en file</>} to="/admin/conversions?state=running" />
        <Kpi loading={loading} label="Durée moyenne (30 j)" value={fmtDuration(o?.conversions.avgDurationS30d)} sub="de la demande au fichier prêt" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Formats (30 jours)" description="Part des conversions MP3 et MP4.">
          <Gate r={ov} skeleton={<Skeleton className="h-36" />}>
            {(d) => (
              <Donut
                summary={`Formats sur 30 jours : ${fmtNum(d.conversions.byFormat.mp4)} MP4 et ${fmtNum(d.conversions.byFormat.mp3)} MP3.`}
                centerLabel="conversions"
                slices={[
                  { key: "mp4", label: "MP4 (vidéo, Photos)", value: d.conversions.byFormat.mp4, ...SLICE.gold },
                  { key: "mp3", label: "MP3 (audio, Fichiers)", value: d.conversions.byFormat.mp3, ...SLICE.graphite },
                ]}
              />
            )}
          </Gate>
        </Panel>
        <Panel title="Plateformes (30 jours)" description="Nombre de conversions par plateforme d'origine.">
          <Gate r={ov} skeleton={<Skeleton className="h-36" />}>
            {(d) => {
              const p = d.conversions.byPlatform;
              const total = p.youtube + p.tiktok + p.twitter + p.other;
              const pct = (v: number) => (total ? ` · ${Math.round((v / total) * 100)} %` : "");
              return (
                <HBars
                  items={(["youtube", "tiktok", "twitter", "other"] as const).map((k) => ({ key: k, label: platformLabel(k), value: p[k], display: <>{fmtNum(p[k])}<span className="font-normal text-muted">{pct(p[k])}</span></> }))}
                />
              );
            }}
          </Gate>
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="En cours" description="Conversions en traitement sur ytapi." actions={<Link to="/admin/conversions?state=running" className={cn(linkCls, "inline-flex min-h-11 items-center text-[14px]")}>Toutes</Link>}>
          <MiniList r={running} kind="running" />
        </Panel>
        <Panel title="Derniers échecs" description="Avec le code d'erreur (docs/ERREURS.md)." actions={<Link to="/admin/conversions?state=error" className={cn(linkCls, "inline-flex min-h-11 items-center text-[14px]")}>Tous</Link>}>
          <MiniList r={failures} kind="error" />
        </Panel>
      </div>
    </AdminPage>
  );
}

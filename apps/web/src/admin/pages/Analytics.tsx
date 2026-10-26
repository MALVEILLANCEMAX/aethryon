// Statistiques sur 24 h, 7 jours ou 30 jours (GET /api/admin/analytics). Ce que le serveur déclare non
// mesuré s'affiche « Non mesuré », jamais comme un zéro (docs/ADMIN.md §8).
import { SegmentedControl } from "../../ui/SegmentedControl.tsx";
import { Skeleton } from "../../ui/bits.tsx";
import { IconCheck, IconInfo } from "../../ui/Icon.tsx";
import { DataDetails, Donut, HBars, Legend, LineChart, SERIES, SLICE, StackedColumns } from "../charts.tsx";
import { useAdmin, useFilters } from "../data.ts";
import { fmtBytes, fmtDay, fmtDuration, fmtHour, fmtNum, fmtPct, metricLabel, platformLabel, toPct } from "../format.ts";
import type { Analytics as Data, Period } from "../types.ts";
import { AdminPage, Gate, Kpi, Meter, Mono, NotMeasured, Panel, RefreshButton } from "../ui.tsx";

const PERIODS: { value: Period; label: string }[] = [
  { value: "24h", label: "24 h" },
  { value: "7d", label: "7 jours" },
  { value: "30d", label: "30 jours" },
];
const PERIOD_TEXT: Record<Period, string> = { "24h": "les dernières 24 heures", "7d": "les 7 derniers jours", "30d": "les 30 derniers jours" };

export default function Analytics() {
  const f = useFilters({ period: "7d" });
  const period = (PERIODS.some((p) => p.value === f.values.period) ? f.values.period : "7d") as Period;
  const r = useAdmin<Data>(`/analytics?period=${period}`, 60_000);
  const d = r.data;
  const nm = new Set(d?.notMeasured ?? []);
  const measured = (k: string) => !nm.has(k);
  const label = (iso: string) => (period === "24h" ? fmtHour(iso) : fmtDay(iso));
  const full = (iso: string) => (period === "24h" ? `${fmtDay(iso)}, ${fmtHour(iso)}` : fmtDay(iso, true));
  const totals = d ? d.buckets.reduce((acc, b) => ({ c: acc.c + b.conversions, done: acc.done + b.done, error: acc.error + b.error, signups: acc.signups + b.signups }), { c: 0, done: 0, error: 0, signups: 0 }) : null;
  const rate = totals && totals.done + totals.error > 0 ? totals.done / (totals.done + totals.error) : null;

  return (
    <AdminPage
      eyebrow="Pilotage"
      title="Statistiques"
      lead={<>Mesures réelles d'account sur {PERIOD_TEXT[period]}. Heures et jours affichés à l'heure de ce navigateur.</>}
      actions={
        <>
          <SegmentedControl label="Période" value={period} onChange={(v) => f.set({ period: v }, { replace: true })} options={PERIODS} />
          <RefreshButton onRefresh={r.reload} at={d ? r.at : null} />
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Kpi loading={!d} label="Conversions" value={fmtNum(totals?.c)} sub={totals ? <>{fmtNum(totals.done)} réussies · {fmtNum(totals.error)} échecs</> : null} />
        <Kpi loading={!d} label="Taux de réussite" value={fmtPct(rate)} tone={rate === null ? undefined : rate >= 0.9 ? "ok" : rate >= 0.7 ? "warn" : "bad"} sub="réussies / (réussies + échecs)" />
        <Kpi loading={!d} label="Inscriptions" value={measured("signups") ? fmtNum(totals?.signups) : <NotMeasured what="Inscriptions" />} sub="nouveaux comptes" />
        <Kpi loading={!d} label="Volume servi" value={d && measured("bytesServed") && d.bytesServed !== null ? fmtBytes(d.bytesServed) : <NotMeasured what="Volume servi" />} sub="taille des fichiers produits" />
      </div>

      <Panel title="Conversions" description={period === "24h" ? "Par heure, réussies et échecs empilés." : "Par jour, réussies et échecs empilés."}>
        <Gate r={r} skeleton={<Skeleton className="h-60" />}>
          {(x) => (
            <>
              <Legend series={[{ key: "done", label: "Réussies", swatch: "bg-gold" }, { key: "error", label: "Échecs", swatch: "bg-bad" }]} />
              <div className="mt-3">
                <StackedColumns
                  summary={`Conversions sur ${PERIOD_TEXT[period].replace(/ /g, " ")} : ${totals?.done ?? 0} réussies et ${totals?.error ?? 0} échecs.`}
                  series={[{ key: "done", label: "Réussies", ...SERIES.gold }, { key: "error", label: "Échecs", ...SERIES.bad }]}
                  data={x.buckets.map((b) => ({ label: label(b.start), full: full(b.start), values: { done: b.done, error: b.error } }))}
                />
              </div>
              <DataDetails table={{
                caption: "Conversions par période",
                columns: [period === "24h" ? "Heure" : "Jour", "Total", "Réussies", "Échecs", "MP4", "MP3", "Durée moyenne"],
                rows: x.buckets.map((b) => [full(b.start), fmtNum(b.conversions), fmtNum(b.done), fmtNum(b.error), fmtNum(b.mp4), fmtNum(b.mp3), fmtDuration(b.avgDurationS)]),
              }} />
            </>
          )}
        </Gate>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Inscriptions" description="Nouveaux comptes (Google ou e-mail, adresse vérifiée).">
          <Gate r={r} skeleton={<Skeleton className="h-48" />}>
            {(x) => measured("signups") ? (
              <>
                <LineChart
                  height={190}
                  summary={`${totals?.signups ?? 0} inscriptions sur ${PERIOD_TEXT[period].replace(/ /g, " ")}.`}
                  series={[{ key: "signups", label: "Inscriptions", ...SERIES.gold }]}
                  data={x.buckets.map((b) => ({ label: label(b.start), full: full(b.start), values: { signups: b.signups } }))}
                />
                <DataDetails table={{ caption: "Inscriptions par période", columns: [period === "24h" ? "Heure" : "Jour", "Inscriptions"], rows: x.buckets.map((b) => [full(b.start), fmtNum(b.signups)]) }} />
              </>
            ) : <NotMeasured what="Inscriptions" />}
          </Gate>
        </Panel>
        <Panel title="Formats" description="Part des conversions MP4 et MP3.">
          <Gate r={r} skeleton={<Skeleton className="h-40" />}>
            {(x) => (
              <Donut
                summary={`Formats : ${x.formats.mp4} MP4 et ${x.formats.mp3} MP3.`}
                centerLabel="conversions"
                slices={[
                  { key: "mp4", label: "MP4 (vidéo, Photos)", value: x.formats.mp4, ...SLICE.gold },
                  { key: "mp3", label: "MP3 (audio, Fichiers)", value: x.formats.mp3, ...SLICE.graphite },
                ]}
              />
            )}
          </Gate>
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Réussite par plateforme" description="Réussies / (réussies + échecs), avec les volumes.">
          <Gate r={r} skeleton={<Skeleton className="h-40" />}>
            {(x) => measured("successByPlatform") ? (
              <HBars
                max={100}
                empty="Aucune conversion terminée sur la période."
                items={x.successByPlatform.map((p) => {
                  const pct = toPct(p.rate);
                  return { key: p.platform, label: platformLabel(p.platform), value: pct, display: fmtPct(pct, true), sub: <>{fmtNum(p.done)} réussies · {fmtNum(p.error)} échecs</> };
                })}
              />
            ) : <NotMeasured what="Réussite par plateforme" />}
          </Gate>
        </Panel>
        <Panel title="Durée par plateforme" description="De la demande au fichier prêt : moyenne (barre) et 90e centile (repère).">
          <Gate r={r} skeleton={<Skeleton className="h-40" />}>
            {(x) => measured("durationByPlatform") ? (
              <>
                <Legend series={[{ key: "avg", label: "Moyenne", swatch: "bg-gold" }, { key: "p90", label: "90e centile", swatch: "bg-graphite" }]} />
                <HBars
                  className="mt-4"
                  markerLabel="90e centile"
                  empty="Aucune durée mesurée sur la période."
                  items={x.durationByPlatform.map((p) => ({
                    key: p.platform, label: platformLabel(p.platform), value: p.avgS, marker: p.p90S,
                    display: p.avgS === null ? "Non mesuré" : fmtDuration(p.avgS),
                    sub: <>90e centile : {p.p90S === null ? "non mesuré" : fmtDuration(p.p90S)}</>,
                  }))}
                />
              </>
            ) : <NotMeasured what="Durée par plateforme" />}
          </Gate>
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title="Erreurs les plus fréquentes" description="Codes de docs/ERREURS.md et texte vu par l'utilisateur.">
          <Gate r={r} skeleton={<Skeleton className="h-40" />}>
            {(x) => measured("topErrors") ? (
              <HBars
                barClass="bg-bad"
                empty="Aucune erreur sur la période."
                items={x.topErrors.map((e) => ({ key: e.code, label: <Mono>{e.code}</Mono>, value: e.count, display: fmtNum(e.count), sub: e.message ?? undefined }))}
              />
            ) : <NotMeasured what="Erreurs" />}
          </Gate>
        </Panel>
        <Panel title="Utilisation des quotas" description="Moyenne de la part du quota du jour utilisée par les comptes actifs.">
          <Gate r={r} skeleton={<Skeleton className="h-28" />}>
            {(x) => measured("quota") && x.quota.avgUsedPct !== null ? (
              <div>
                <p className="tabular text-[28px] font-semibold">{fmtPct(x.quota.avgUsedPct, true)}</p>
                <Meter className="mt-2" value={Math.round(x.quota.avgUsedPct)} max={100} label="Utilisation moyenne du quota" />
                <p className="tabular mt-3 text-[14px] text-ink-soft">{fmtNum(x.quota.usersAtLimit)} compte{x.quota.usersAtLimit > 1 ? "s" : ""} à la limite aujourd'hui (mesure du jour, quelle que soit la période).</p>
              </div>
            ) : <NotMeasured what="Utilisation des quotas" />}
          </Gate>
        </Panel>
      </div>

      <Panel title="Ce qui est mesuré" description="Le serveur déclare lui-même ce qu'il mesure ; le reste n'est jamais estimé.">
        <Gate r={r} skeleton={<Skeleton className="h-16" />}>
          {(x) => (
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <h3 className="text-[14px] font-medium">Mesuré</h3>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {x.measured.length ? x.measured.map((m) => <li key={m} className="inline-flex items-center gap-1.5 rounded-full bg-ok-bg px-2.5 py-1 text-[12.5px] text-ok ring-1 ring-inset ring-ok/20"><IconCheck size={13} />{metricLabel(m)}</li>) : <li className="text-[14px] text-muted">—</li>}
                </ul>
              </div>
              <div>
                <h3 className="text-[14px] font-medium">Non mesuré</h3>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {x.notMeasured.length ? x.notMeasured.map((m) => <li key={m} className="inline-flex items-center gap-1.5 rounded-full bg-sand/60 px-2.5 py-1 text-[12.5px] text-ink-soft ring-1 ring-inset ring-line-strong/60"><IconInfo size={13} />{metricLabel(m)}</li>) : <li className="text-[14px] text-muted">—</li>}
                </ul>
                <p className="mt-2 text-[13px] leading-relaxed text-muted">CPU, mémoire des conteneurs et trafic réseau ne sont pas mesurés : l'application n'a volontairement aucun accès à Docker.</p>
              </div>
            </div>
          )}
        </Gate>
      </Panel>
    </AdminPage>
  );
}

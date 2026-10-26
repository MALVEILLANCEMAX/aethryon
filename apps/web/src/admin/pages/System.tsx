// Système : état mesuré par account (ytapi, base, disque, file, versions, latences, erreurs récentes).
// Lecture seule, volontairement : aucune commande serveur ni contrôle de Docker depuis le panneau.
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { Skeleton, StatusDot } from "../../ui/bits.tsx";
import { IconInfo } from "../../ui/Icon.tsx";
import { conversionColumns } from "../cells.tsx";
import { qs, useAdmin, usePolling } from "../data.ts";
import { fmtBytes, fmtDuration, fmtMs, fmtNum, platformLabel } from "../format.ts";
import type { SystemStatus } from "../types.ts";
import { AdminPage, DataTable, EmptyState, ErrorState, KeyValues, Meter, Mono, NotMeasured, Panel, RefreshButton, ToneBadge } from "../ui.tsx";

type Tone = "ok" | "warn" | "bad" | "muted";
const latencyTone = (ms: number | null | undefined, warn: number, bad: number): Tone => (ms === null || ms === undefined ? "muted" : ms >= bad ? "bad" : ms >= warn ? "warn" : "ok");
const TONE_TEXT: Record<Tone, string> = { ok: "Normal", warn: "Lent", bad: "Très lent", muted: "Inconnu" };

function Health({ tone, label }: { tone: Tone; label: string }) {
  return <span className="inline-flex items-center gap-2 text-[14px] font-medium"><StatusDot tone={tone} />{label}</span>;
}

/** Valeur inconnue du contrat (objet libre renvoyé par ytapi) : affichée telle quelle, sans interprétation. */
function Raw({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-muted">—</span>;
  if (typeof value === "boolean") return <span>{value ? "oui" : "non"}</span>;
  if (typeof value === "number") return <span className="tabular">{fmtNum(value)}</span>;
  if (typeof value === "string") return <span className="break-words">{value}</span>;
  return <Mono className="whitespace-pre-wrap break-all">{JSON.stringify(value)}</Mono>;
}

function PlatformState({ name, v }: { name: string; v: unknown }) {
  if (typeof v === "boolean") return <ToneBadge tone={v ? "ok" : "neutral"}>{v ? "Activée" : "Désactivée"}</ToneBadge>;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const enabled = typeof o.enabled === "boolean" ? o.enabled : null;
    const paused = o.paused === true || o.blocked === true;
    const state = typeof o.state === "string" ? o.state : typeof o.status === "string" ? o.status : null;
    const reason = typeof o.reason === "string" ? o.reason : typeof o.message === "string" ? o.message : null;
    return (
      <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
        {enabled !== null && <ToneBadge tone={enabled ? "ok" : "neutral"}>{enabled ? "Activée" : "Désactivée"}</ToneBadge>}
        {paused && <ToneBadge tone="warn">En pause</ToneBadge>}
        {state && <Mono>{state}</Mono>}
        {reason && <span className="text-[13px] text-muted">{reason}</span>}
        {enabled === null && !paused && !state && !reason && <Raw value={v} />}
      </span>
    );
  }
  return <Raw value={v ?? name} />;
}

export default function System() {
  const navigate = useNavigate();
  const r = useAdmin<SystemStatus>("/system", 10_000);
  usePolling(r.reload, 30_000);
  const s = r.data;
  return (
    <AdminPage
      eyebrow="Pilotage"
      title="Système"
      lead="État mesuré par le service account à chaque actualisation. Lecture seule : aucune commande serveur depuis le panneau, par conception."
      actions={<RefreshButton onRefresh={r.reload} at={s ? r.at : null} />}
    >
      {!s ? (r.error ? <ErrorState error={r.error} onRetry={r.reload} /> : (
        <div aria-busy="true" className="grid gap-5 md:grid-cols-2 xl:grid-cols-3"><span className="sr-only" role="status">Chargement…</span>{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-44" />)}</div>
      )) : (
        <>
          {r.error ? <ErrorState compact error={r.error} onRetry={r.reload} /> : null}
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            <Panel title="ytapi (conversion)">
              <div className="mb-3">{s.ytapi.reachable ? <Health tone={latencyTone(s.ytapi.latencyMs, 500, 2000)} label="Joignable" /> : <Health tone="bad" label="Injoignable" />}</div>
              <KeyValues items={[
                ["Latence (account → ytapi)", <span key="l" className="inline-flex items-center gap-2">{fmtMs(s.ytapi.latencyMs)}<span className="text-[12.5px] text-muted">{TONE_TEXT[latencyTone(s.ytapi.latencyMs, 500, 2000)]}</span></span>],
                ...(s.ytapi.error ? [["Erreur", <span key="e" className="text-bad">{s.ytapi.error}</span>] as [ReactNode, ReactNode]] : []),
              ]} />
              {s.ytapi.status && typeof s.ytapi.status === "object" && (
                <details className="mt-3 text-[13.5px]">
                  <summary className="inline-flex min-h-11 cursor-pointer items-center text-gold-text underline decoration-gold/50 underline-offset-4">État détaillé renvoyé par ytapi</summary>
                  <KeyValues className="mt-2" items={Object.entries(s.ytapi.status).map(([k, v]) => [<Mono key={k}>{k}</Mono>, <Raw key="v" value={v} />])} />
                </details>
              )}
            </Panel>

            <Panel title="Travaux (workers)">
              <KeyValues items={[
                ["Actifs", s.jobs.active === null ? "—" : fmtNum(s.jobs.active)],
                ["En file d'attente", s.jobs.queued === null ? "—" : fmtNum(s.jobs.queued)],
                ["Capacité", s.jobs.capacity === null ? "—" : fmtNum(s.jobs.capacity)],
              ]} />
              {s.jobs.active !== null && s.jobs.capacity ? (
                <Meter className="mt-4" value={s.jobs.active} max={s.jobs.capacity} label={`${s.jobs.active} travaux actifs sur ${s.jobs.capacity}`} />
              ) : null}
            </Panel>

            <Panel title="Disque (ytapi)">
              {s.disk.freeBytes === null ? <NotMeasured what="Espace disque" /> : (
                <>
                  <div className="mb-3">
                    {s.disk.floorBytes !== null && s.disk.freeBytes < s.disk.floorBytes ? <Health tone="bad" label="Sous le seuil : conversions refusées" />
                      : s.disk.floorBytes !== null && s.disk.freeBytes < s.disk.floorBytes * 2 ? <Health tone="warn" label="Proche du seuil" />
                      : <Health tone="ok" label="Espace suffisant" />}
                  </div>
                  <KeyValues items={[["Libre", fmtBytes(s.disk.freeBytes)], ["Seuil de refus", fmtBytes(s.disk.floorBytes)]]} />
                </>
              )}
            </Panel>

            <Panel title="Base de données (account)">
              <div className="mb-3">{s.database.ok && s.database.integrity === "ok" ? <Health tone={latencyTone(s.database.latencyMs, 50, 250)} label="Intègre" /> : <Health tone="bad" label={s.database.ok ? "Intégrité à vérifier" : "En erreur"} />}</div>
              <KeyValues items={[
                ["Latence", fmtMs(s.database.latencyMs)],
                ["Taille", fmtBytes(s.database.sizeBytes)],
                ["Journal WAL", fmtBytes(s.database.walBytes)],
                ["Intégrité", s.database.integrity === "ok" ? "ok" : <span key="i" className="text-bad">{s.database.integrity}</span>],
              ]} />
            </Panel>

            <Panel title="account">
              <KeyValues items={[["Version", <Mono key="v">{s.account.version}</Mono>], ["Démarré depuis", fmtDuration(s.account.uptimeS)]]} />
            </Panel>

            <Panel title="Versions (ytapi)">
              <KeyValues items={[
                ["yt-dlp", s.versions.ytDlp ? <Mono key="a">{s.versions.ytDlp}</Mono> : "—"],
                ["yt-dlp-ejs", s.versions.ytDlpEjs ? <Mono key="b">{s.versions.ytDlpEjs}</Mono> : "—"],
                ["ffmpeg", s.versions.ffmpeg ? <Mono key="c">{s.versions.ffmpeg}</Mono> : "—"],
                ["Deno", s.versions.deno ? <Mono key="d">{s.versions.deno}</Mono> : "—"],
              ]} />
            </Panel>
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:items-start">
            <Panel title="Plateformes" description="État déclaré par ytapi et réglages du panneau.">
              {Object.keys(s.platforms ?? {}).length ? (
                <KeyValues items={Object.entries(s.platforms).map(([k, v]) => [platformLabel(k), <PlatformState key={k} name={k} v={v} />])} />
              ) : <p className="text-[14px] text-muted">Aucune information.</p>}
            </Panel>
            <Panel title="Erreurs récentes" description="Derniers échecs de conversion, toutes plateformes." bodyClassName="pt-2 sm:pt-3">
              {s.recentErrors.length ? (
                <DataTable caption="Erreurs récentes" rows={s.recentErrors} columns={conversionColumns({ compact: true })} rowKey={(c) => c.id} onRowClick={(c) => navigate(`/admin/conversions${qs({ state: "error", open: c.id })}`)} rowLabel={(c) => c.errorCode ?? c.id} minWidth={720} />
              ) : <EmptyState title="Aucune erreur récente" />}
            </Panel>
          </div>

          <Panel title="Non mesuré">
            <p className="flex gap-2 text-[14px] leading-relaxed text-ink-soft"><IconInfo size={17} className="mt-0.5 shrink-0 text-gold-text" />CPU et mémoire des conteneurs, trafic réseau : non mesurés. L'application n'a volontairement aucun accès à Docker ni au système hôte ; ces mesures se lisent sur le serveur.</p>
          </Panel>
        </>
      )}
    </AdminPage>
  );
}

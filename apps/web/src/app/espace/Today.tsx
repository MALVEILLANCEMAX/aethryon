// « Aujourd'hui » : le quota du jour (unités réelles, remise à zéro au minuit de Paris calculé par le
// serveur), la dernière conversion suivie en direct avec la chouette, et l'état du service en tête (une pastille ;
// son message seulement quand tout ne va pas bien). Les jetons, l'offre et la sécurité sont dans la vue d'ensemble
// (Ensemble.tsx). Aucune donnée inventée : tant qu'une valeur n'est pas arrivée, un emplacement de chargement la
// remplace.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { cn } from "../../lib/cn.ts";
import { fmtRelative } from "../../lib/format.ts";
import { LIVE_PATH, type LiveConversion } from "../../lib/live.ts";
import { invalidate } from "../../lib/store.ts";
import type { QuotaView } from "../../lib/onboarding.ts";
import type { ServiceStatus } from "../../lib/types.ts";
import type { ApiError } from "../../lib/api.ts";
import { AethryonMascot, type MascotState } from "../../ui/brand/AethryonMascot.tsx";
import { Badge, Skeleton, StatusDot } from "../../ui/bits.tsx";
import { IconArrowRight } from "../../ui/Icon.tsx";
import { NumberTicker } from "../../ui/NumberTicker.tsx";
import { fmtUntil, parisToday, Pips, PLATFORM_NAME } from "./parts.tsx";

const link = "text-gold-text underline decoration-gold/50 underline-offset-4 transition-colors hover:decoration-gold-text";
const STATE = {
  ok: { tone: "ok", label: "Service opérationnel" },
  degraded: { tone: "warn", label: "Service ralenti" },
  paused: { tone: "warn", label: "Conversions suspendues" },
  down: { tone: "bad", label: "Service indisponible" },
} as const;

interface Props {
  quota: QuotaView;
  live: LiveConversion;
  mascot: MascotState;
  replayKey: string | number;
  status: { data?: ServiceStatus; error?: ApiError };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Re-rendu chaque minute (« dans 6 h 05 » reste juste), seulement si la page est visible. */
function useMinuteTick() {
  const [, setT] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => { if (!document.hidden) setT((t) => t + 1); }, 60_000);
    return () => window.clearInterval(id);
  }, []);
}

/** État du quota (principe « Usage meter » d'Arc UI) : à 2 restantes ou moins, puis à l'épuisement. */
type QuotaState = "ok" | "low" | "out";
const QUOTA_BADGE: Record<Exclude<QuotaState, "ok">, { tone: "warn" | "bad"; label: string }> = {
  low: { tone: "warn", label: "Bientôt atteint" },
  out: { tone: "bad", label: "Atteint" },
};
function quotaState(q: QuotaView): QuotaState {
  if (q.unlimited) return "ok";
  if (q.exhausted || (q.remaining ?? 1) <= 0) return "out";
  return (q.remaining ?? 99) <= 2 ? "low" : "ok";
}
/** UNE annonce polie quand l'état du quota CHANGE pendant la visite (jamais au chargement, jamais à chaque unité). */
function useQuotaAnnouncement(state: QuotaState, remaining: number | null) {
  const prev = useRef(state);
  const [said, setSaid] = useState("");
  useEffect(() => {
    if (prev.current === state) return;
    prev.current = state;
    setSaid(state === "out" ? "Quota du jour atteint." : state === "low" ? `Plus que ${remaining} conversion${remaining === 1 ? "" : "s"} aujourd'hui.` : "Quota du jour disponible.");
  }, [state, remaining]);
  return said;
}

export function Today({ quota, live, mascot, replayKey, status }: Props) {
  useMinuteTick();
  // Minuit à Paris (instant donné par le serveur) : le quota du jour est relu de lui-même.
  useEffect(() => {
    const ms = Date.parse(quota.resetAt) - Date.now();
    if (!Number.isFinite(ms) || ms <= 0 || ms > 86_400_000) return;
    const t = window.setTimeout(() => invalidate("/api/me", LIVE_PATH), ms + 1500);
    return () => window.clearTimeout(t);
  }, [quota.resetAt]);
  const until = fmtUntil(quota.resetAt);
  const qState = quotaState(quota);
  const said = useQuotaAnnouncement(qState, quota.remaining);
  const st = status.data ? STATE[status.data.state] : null;
  const latest = live.latest;
  return (
    <section aria-labelledby="today-title" className="overflow-hidden rounded-panel border border-line bg-pearl/50 shadow-card" data-today="">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pt-5 sm:px-7 sm:pt-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="today-title" className="font-display text-titre-m leading-tight">Aujourd’hui</h2>
          <p className="text-ui text-muted">{capitalize(parisToday())}</p>
        </div>
        {st ? (
          <p className="today-service" data-service={status.data!.state}><StatusDot tone={st.tone} />{st.label}</p>
        ) : status.error ? (
          <p className="today-service" data-service="inconnu"><StatusDot tone="muted" />Service : vérification impossible</p>
        ) : <Skeleton className="h-8 w-44 rounded-full" />}
      </div>
      {status.data && status.data.state !== "ok" && <p className="px-5 pt-2 text-ui leading-relaxed text-ink-soft sm:px-7" data-service-message="">{status.data.message}</p>}

      <div className="mt-2 grid divide-y divide-line lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:divide-x lg:divide-y-0">
        {/* Quota du jour */}
        <div className="px-5 pb-6 pt-4 sm:px-7" data-quota="">
          <div className="flex min-h-6 items-center justify-between gap-3">
            <p className="text-ui font-medium text-ink-soft">Quota du jour</p>
            {qState !== "ok" && <Badge tone={QUOTA_BADGE[qState].tone}>{QUOTA_BADGE[qState].label}</Badge>}
          </div>
          <span role="status" className="sr-only">{said}</span>
          {quota.unlimited ? (
            <>
              <p className="font-display tabular mt-2 text-[44px] leading-none">{quota.used}<span className="font-sans text-corps text-muted"> {quota.used > 1 ? "conversions" : "conversion"}</span></p>
              <p className="mt-4 text-ui leading-relaxed text-ink-soft">Sans limite quotidienne sur ce compte.</p>
            </>
          ) : (
            <>
              <p className="font-display tabular mt-2 text-[44px] leading-none" data-quota-used={quota.used} data-quota-limit={quota.limit}>
                <NumberTicker value={quota.used} from="previous" /><span className="font-sans text-corps text-muted"> sur {quota.limit}</span>
              </p>
              <Pips used={quota.used} total={quota.limit ?? 0} className="mt-4 max-w-[360px]" />
              <p className={cn("mt-3.5 text-ui leading-relaxed", quota.exhausted ? "font-medium text-warn" : "text-ink-soft")}>
                {quota.exhausted ? "Limite du jour atteinte." : `Il t'en reste ${quota.remaining}.`}
                {" "}Nouveau quota à minuit, heure de Paris{until ? `, ${until}` : ""}.
              </p>
              {quota.bonus > 0 && <p className="mt-1 text-note text-muted">Dont {quota.bonus} {quota.bonus > 1 ? "offertes" : "offerte"} pour aujourd'hui.</p>}
            </>
          )}
        </div>

        {/* Dernière conversion : état réel, suivi en direct */}
        <div className="flex items-start gap-4 px-5 py-5 sm:gap-5 sm:px-7 sm:py-6" data-derniere="">
          <div className="relative shrink-0">
            <AethryonMascot state={mascot} size={120} replayKey={replayKey} look={1} className="relative w-full" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-ui font-medium text-ink-soft">Dernière conversion</p>
            {live.loading && !live.items ? (
              <div aria-hidden><Skeleton className="mt-3 h-6 w-4/5" /><Skeleton className="mt-2.5 h-4 w-1/2" /></div>
            ) : live.error && !live.items ? (
              <p className="mt-2 text-ui leading-relaxed text-ink-soft">Impossible de la lire pour l'instant. Elle reviendra dès que le serveur répond.</p>
            ) : (
              <>
                <div role="status" aria-live="polite">
                  <p className="font-display mt-1.5 text-sous leading-snug">{live.label}</p>
                  {live.detail && <p className="mt-1 text-ui leading-relaxed text-ink-soft">{live.detail}</p>}
                  {!latest && <p className="mt-1 text-ui leading-relaxed text-ink-soft">Elle apparaîtra ici dès que ton raccourci l'enverra.</p>}
                </div>
                {latest && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">{latest.fmt.toUpperCase()}</Badge>
                    {latest.platform && <Badge tone="neutral">{PLATFORM_NAME[latest.platform] ?? latest.platform}</Badge>}
                    <span className="text-note text-muted">{fmtRelative(latest.finishedAt ?? latest.createdAt)}</span>
                    {live.busy && <span className="inline-flex items-center gap-2 text-note text-gold-text"><StatusDot tone="busy" />Suivi en direct</span>}
                  </div>
                )}
              </>
            )}
            <Link to="/dashboard/activite" className={cn(link, "mt-2 inline-flex min-h-11 items-center gap-1.5 text-ui")}>Toute l'activité<IconArrowRight size={15} /></Link>
          </div>
        </div>
      </div>

    </section>
  );
}

/** Silhouette du relevé pendant le premier chargement (mêmes proportions, aucun texte qui saute). */
export function TodaySkeleton() {
  return (
    <div aria-hidden className="overflow-hidden rounded-panel border border-line bg-pearl/50" data-today-chargement="">
      <div className="px-5 pt-5 sm:px-7 sm:pt-6"><Skeleton className="h-8 w-40" /></div>
      <div className="mt-2 grid gap-6 px-5 py-6 sm:px-7 lg:grid-cols-2">
        <div><Skeleton className="h-4 w-28" /><Skeleton className="mt-3 h-11 w-32" /><Skeleton className="mt-4 h-2 w-full max-w-[360px]" /><Skeleton className="mt-4 h-4 w-3/4" /></div>
        <div className="flex gap-5"><Skeleton className="size-[84px] shrink-0 rounded-full sm:size-[120px]" /><div className="flex-1"><Skeleton className="h-4 w-32" /><Skeleton className="mt-3 h-6 w-4/5" /><Skeleton className="mt-3 h-4 w-1/2" /></div></div>
      </div>
    </div>
  );
}

// Accueil de l'espace personnel. AETHRYON est UN service avec plusieurs accès : le guide « Bien démarrer »
// mène au raccourci iPhone (seul accès externe disponible aujourd'hui) et chaque étape se coche d'après les
// données RÉELLES du serveur (lib/onboarding.ts) ; « Aujourd'hui » résume le quota, la dernière conversion
// suivie en direct et l'état du service ; la « Vue d'ensemble » (V3) montre les appareils reliés, Discord, l'offre et
// la sécurité. Rien d'inventé : une valeur absente reste « en chargement ». La chouette reflète l'état réel de la dernière conversion ; la première conversion est
// saluée une seule fois (préférence locale, sans autre effet).
import { useEffect, useMemo, useRef, useState } from "react";
import { useConfig, useDocumentTitle, useMe, useStatus } from "../lib/hooks.ts";
import { useLatestConversion } from "../lib/live.ts";
import { invalidate, useResource } from "../lib/store.ts";
import { deriveGuide, firstConversion, mergeActivity, quotaView, STEP_ORDER, type StepState, type StepId } from "../lib/onboarding.ts";
import { readPref, writePref } from "../lib/prefs.ts";
import { useShortcutUrl } from "../lib/shortcut.ts";
import type { ActivityItem, ApiKey, Today as TodayData } from "../lib/types.ts";
import { KeysNotice } from "../ui/KeysNotice.tsx";
import { Skeleton } from "../ui/bits.tsx";
import { IconInfo } from "../ui/Icon.tsx";
import { useToast } from "../ui/Toasts.tsx";
import { Guide, GuideSkeleton, nextStepPhrase, STEP_TITLE } from "./espace/Guide.tsx";
import { Today, TodaySkeleton } from "./espace/Today.tsx";
import { Ensemble } from "./espace/Ensemble.tsx";
import { OutilsBand } from "./espace/OutilsBand.tsx";

/** Historique lu pour le guide : même ressource (et même cache) que la page Activité. */
const HISTORY_LIMIT = 50;
const HISTORY = `/api/activity?limit=${HISTORY_LIMIT}`;

export default function DashboardHome() {
  useDocumentTitle("Mon espace");
  const me = useMe();
  const cfg = useConfig();
  const status = useStatus();
  const { icloudUrl } = useShortcutUrl();
  const toast = useToast();
  const d = me.data;
  const live = useLatestConversion(!!d);
  const keys = useResource<{ keys: ApiKey[] }>(d ? "/api/keys" : null, 10_000);
  const history = useResource<{ items: ActivityItem[]; today: TodayData }>(d ? HISTORY : null, 10_000);

  // Une conversion apparaît ou change d'état (suivi en direct) : quota, jetons (dernière utilisation) et
  // historique sont relus, pour que le guide et le relevé suivent sans recharger la page.
  const sig = live.latest ? `${live.latest.id}:${live.latest.state}` : "";
  const lastSig = useRef<string | null>(null);
  useEffect(() => {
    if (!live.items) return;
    if (lastSig.current !== null && lastSig.current !== sig) invalidate("/api/me", "/api/keys", HISTORY);
    lastSig.current = sig;
  }, [sig, live.items]);

  const items = useMemo(() => mergeActivity(live.items, history.data?.items), [live.items, history.data]);
  const guide = useMemo(
    () => (keys.data && (history.data || live.items) ? deriveGuide(keys.data.keys, items) : null),
    [keys.data, history.data, live.items, items],
  );
  const failed = !guide && ((!keys.data && !!keys.error) || (!history.data && !live.items && !!history.error));
  const countIsFloor = history.data ? history.data.items.length >= HISTORY_LIMIT : (live.items?.length ?? 0) >= 5;

  // Première conversion : saluée une seule fois par compte (préférence locale), jamais pour un compte qui
  // convertit déjà depuis longtemps (voir firstConversion).
  // Décidé pendant le rendu (lecture locale synchrone) pour que la page ne se réorganise pas après coup ;
  // la préférence est écrite une fois le moment affiché.
  const uid = d?.user.id ?? "";
  const momentRef = useRef<ActivityItem | null>(null);
  if (!momentRef.current && uid && guide?.ready && history.data) {
    const candidate = firstConversion(items, HISTORY_LIMIT);
    if (candidate && !readPref(uid, "premiere-conversion")) momentRef.current = candidate;
  }
  const moment = momentRef.current;
  useEffect(() => {
    if (uid && moment) writePref(uid, "premiere-conversion", moment.id);
  }, [uid, moment]);

  // Lecteurs d'écran : une étape qui se coche pendant la visite (constat du serveur) est annoncée.
  const previous = useRef<Record<StepId, StepState> | null>(null);
  const [announce, setAnnounce] = useState("");
  useEffect(() => {
    if (!guide) return;
    const before = previous.current;
    previous.current = guide.steps;
    if (!before) return;
    const newly = STEP_ORDER.filter((id) => guide.steps[id] === "done" && before[id] !== "done");
    if (newly.length) setAnnounce(guide.ready ? "Tout est prêt." : `Étape faite : ${STEP_TITLE[newly[newly.length - 1]!]}.`);
  }, [guide]);

  const warned = useRef(false);
  useEffect(() => {
    const r = d?.today.remaining;
    if (warned.current || r == null) return;
    if (r > 0 && r <= 2) {
      warned.current = true;
      toast.show("info", "Limite presque atteinte", `Il te reste ${r} conversion${r > 1 ? "s" : ""} aujourd'hui.`);
    }
  }, [d, toast]);
  useEffect(() => {
    if (status.data && (status.data.state === "paused" || status.data.state === "down")) {
      toast.show("error", "Service indisponible", "Les conversions sont temporairement suspendues.");
    }
  }, [status.data, toast]);

  if (!d) return null; // la coque (DashboardLayout) affiche le chargement tant que /api/me n'a pas répondu
  const firstName = String(d.user.name ?? "").split(" ")[0]!.slice(0, 40);
  const keysLive = cfg.data ? cfg.data.keysActive : true;
  // Chapeau : `null` tant que l'avancement est inconnu (silhouette) ; `false` quand tout est prêt ou illisible — la page
  // parle d'elle-même, aucune phrase d'introduction.
  const lead: string | null | false = !keysLive
    ? "Les conversions avec un jeton personnel ouvriront bientôt."
    : !guide ? (failed ? false : null)
    : guide.ready ? false
    : guide.doneCount === 0 ? "Bienvenue dans ton espace. Quelques étapes, et tu fais ta première conversion."
    : `Prochaine étape : ${nextStepPhrase(guide)}.`;
  const maintenance = cfg.data?.maintenanceMessage?.trim();
  const quota = quotaView(live.today ?? d.today);

  const guideBlock = (
    <Guide
      userId={uid}
      guide={guide}
      failed={failed}
      onRetry={() => { void keys.reload(); void history.reload(); }}
      keysActive={keysLive}
      icloudUrl={icloudUrl}
      platforms={cfg.data?.platforms}
      busy={live.busy}
      moment={moment}
      countIsFloor={countIsFloor}
    />
  );
  const todayBlock = (
    <Today
      quota={quota}
      live={live}
      mascot={moment ? "success" : live.mascot}
      replayKey={moment ? moment.id : live.latest?.state === "done" ? live.latest.id : 0}
      status={status}
    />
  );
  const ensembleBlock = <><OutilsBand /><Ensemble me={d} quota={quota} /></>;
  // Tout est prêt : le relevé passe devant et la bande « Tout est prêt » se fait discrète, sauf le jour
  // de la première conversion (le moment est en tête). Tant que l'avancement n'est pas connu, une seule
  // silhouette occupe la place : l'ordre final s'affiche d'un coup, sans bloc qui saute (CLS).
  const quiet = guide?.ready && !moment;
  const resolved = !!guide || failed;

  return (
    <div>
      <h1 className="page-title">Bonjour{firstName ? ` ${firstName}` : ""}.</h1>
      {lead ? (
        <p className="mt-3 max-w-2xl text-corps leading-relaxed text-ink-soft" data-lead="">{lead}</p>
      ) : lead === null ? (
        <div className="mt-4" aria-hidden><Skeleton className="h-5 w-[min(100%,26rem)]" /></div>
      ) : null}
      {maintenance && (
        <p role="note" className="mt-5 flex gap-2.5 rounded-card border border-warn/20 bg-warn-bg p-4 text-ui leading-relaxed text-warn" data-maintenance="">
          <IconInfo size={18} className="mt-0.5 shrink-0" />
          <span>{maintenance}</span>
        </p>
      )}
      <KeysNotice className="mt-5" />
      <p className="sr-only" role="status" aria-live="polite" data-annonce="">{announce}</p>
      <div className="mt-8 space-y-5">
        {!resolved ? <><GuideSkeleton /><TodaySkeleton /></> : quiet ? <>{todayBlock}{ensembleBlock}{guideBlock}</> : <>{guideBlock}{todayBlock}{ensembleBlock}</>}
      </div>
    </div>
  );
}

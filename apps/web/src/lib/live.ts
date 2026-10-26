// Suivi en direct de la DERNIÈRE conversion réelle du compte (activité enregistrée par le serveur).
// Interrogation toutes les 4 s pendant une conversion en cours, toutes les 15 s sinon, uniquement
// quand l'onglet est visible. Aucune progression inventée : on ne connaît que l'état du travail
// (ytapi ne signale pas la récupération du fichier par le raccourci : « terminée » = fichier prêt).
import { useEffect } from "react";
import { load, useResource } from "./store.ts";
import type { ApiError } from "./api.ts";
import type { ActivityItem, Today } from "./types.ts";
import type { MascotState } from "../ui/brand/AethryonMascot.tsx";

export const LIVE_PATH = "/api/activity?limit=5";
const PATH = LIVE_PATH;
const RECENT_MS = 15 * 60_000; // une réussite ou une erreur « récente » reste exprimée par la chouette

export interface LiveConversion {
  latest: ActivityItem | null;
  /** État de la chouette dérivé de l'état réel (jamais d'un minuteur). */
  mascot: MascotState;
  /** Phrase d'état, à annoncer en texte (role="status"). */
  label: string;
  /** Précision sous la phrase d'état (message de l'échec), ou null. */
  detail: string | null;
  busy: boolean;
  loading: boolean;
  today?: Today;
  /** Les dernières conversions lues (5 au plus), plus récentes d'abord ; undefined avant la première réponse. */
  items?: ActivityItem[];
  error?: ApiError;
}

export function useLatestConversion(enabled = true): LiveConversion {
  const res = useResource<{ items: ActivityItem[]; today: Today }>(enabled ? PATH : null, 4_000);
  const latest = res.data?.items[0] ?? null;
  const busy = !!latest && (latest.state === "reserved" || latest.state === "running");

  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => { if (!document.hidden) void load(PATH, true); }, busy ? 4_000 : 15_000);
    return () => window.clearInterval(id);
  }, [enabled, busy]);

  let mascot: MascotState = "idle";
  let label = "Aucune conversion pour l’instant.";
  let detail: string | null = null;
  if (latest) {
    const at = new Date(latest.finishedAt ?? latest.createdAt).getTime();
    const recent = Date.now() - at < RECENT_MS;
    if (busy) { mascot = "processing"; label = "Conversion en cours sur le serveur…"; }
    // « Terminée » veut dire : le serveur a fini. Il ne sait pas si l'iPhone a récupéré le fichier.
    else if (latest.state === "done") { mascot = recent ? "success" : "idle"; label = "Conversion terminée sur le serveur."; }
    else if (latest.state === "error") { mascot = recent ? "error" : "idle"; label = "Dernière conversion en échec."; detail = latest.errorMessage ?? null; }
    else if (latest.state === "cancelled") label = "Dernière conversion annulée.";
    else if (latest.state === "refunded") label = "Dernière demande non démarrée (non décomptée).";
  }
  return { latest, mascot, label, detail, busy, loading: res.loading, today: res.data?.today, items: res.data?.items, error: res.error };
}

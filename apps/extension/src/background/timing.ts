// Délais du service worker (réglables pour les tests unitaires, jamais à l'exécution en production).
export interface Timing {
  /** Attente longue côté serveur : GET /jobs/<id>?wait=N (ytapi plafonne à 25 s). */
  pollWaitS: number;
  /** Délai d'une requête de suivi (< 30 s : au-delà, Chrome peut arrêter le service worker). */
  pollTimeoutMs: number;
  /** Écart minimal entre deux suivis (protège le serveur si ?wait= n'était pas respecté). */
  minPollIntervalMs: number;
  requestTimeoutMs: number;
  accountTimeoutMs: number;
  /** popup.init attend le compte au plus ce délai, puis affiche le dernier état connu. */
  popupAccountTimeoutMs: number;
  detectTimeoutMs: number;
  logoutTimeoutMs: number;
  /** Pauses entre deux suivis en échec (réseau, 5xx), puis la dernière valeur se répète. */
  backoffMs: readonly number[];
  /** Échecs consécutifs du suivi avant d'afficher une erreur réseau (le job reste relançable). */
  maxPollFailures: number;
  /** Lecture de la progression du téléchargement (downloads.search) tant que le worker vit. */
  progressIntervalMs: number;
  /** « Une conversion est déjà en cours » (429 active_job_limit) : attente locale maximale. */
  accountBusyMaxWaitMs: number;
  /** Bornes de l'attente avant une nouvelle tentative après un 429 (Retry-After). */
  retryAfterMinMs: number;
  retryAfterMaxMs: number;
  /** 3.5.2, lien avec AETHRYON Desktop (desktop.ts) : écart minimal entre deux progressions d'un même envoi. */
  desktopProgressMs: number;
  /** Port vers l'hôte gardé après le dernier envoi terminé, puis fermé (l'hôte s'arrête). */
  desktopIdleMs: number;
  /** Hôte absent ou en erreur : aucune nouvelle tentative avant ce délai. */
  desktopRetryMs: number;
  /** 3.6.1, mise à jour en un clic : délai entre la réussite (annoncée aux pages) et chrome.runtime.reload(). */
  updateReloadDelayMs: number;
  /** Mise à jour en un clic : durée maximale de l'échange avec AETHRYON Desktop. */
  updateTimeoutMs: number;
}

export const DEFAULT_TIMING: Timing = {
  pollWaitS: 20,
  pollTimeoutMs: 27_000,
  minPollIntervalMs: 1_000,
  requestTimeoutMs: 20_000,
  accountTimeoutMs: 8_000,
  popupAccountTimeoutMs: 3_000,
  detectTimeoutMs: 1_500,
  logoutTimeoutMs: 5_000,
  backoffMs: [2_000, 4_000, 8_000, 15_000, 25_000],
  maxPollFailures: 8,
  progressIntervalMs: 1_000,
  accountBusyMaxWaitMs: 15 * 60_000,
  retryAfterMinMs: 3_000,
  retryAfterMaxMs: 60_000,
  desktopProgressMs: 2_000,
  desktopIdleMs: 3_000,
  desktopRetryMs: 30_000,
  updateReloadDelayMs: 900,
  updateTimeoutMs: 6 * 60_000,
};

/** Pause interrompue par `signal` (résout à false si interrompue). */
export function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve(false);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

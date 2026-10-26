// État persistant du service worker, au-dessus de src/shared/storage.ts :
// - jobs (storage.session) : lectures-modifications-écritures sérialisées (un seul écrivain à la fois),
//   avec des champs internes (adresse du fichier) jamais transmis aux pages ni aux onglets ;
// - dernier état connu du compte (storage.local), lié à la liaison en cours (linkedAt).
import { getJobs, setJobs, type AuthState } from "../shared/storage.ts";
import type { AccountView, JobState, JobView } from "../shared/types.ts";

/** Job tel qu'il est stocké : la vue publique + des champs internes au service worker. */
export interface StoredJob extends JobView {
  /** file_url de ytapi (validé), pour relancer le seul téléchargement tant que le fichier existe. */
  fileUrl?: string;
  /** GIF (V3) : job ytapi de l'extrait MP4 dont le GIF est tiré ; jobId devient alors celui du GIF. */
  sourceJobId?: string;
  /** Miniature (V3) : adresse téléchargée par le navigateur, et une plus petite si la grande n'existe pas. */
  localUrl?: string;
  thumbFallback?: string;
  /**
   * 3.5.2 : nom du fichier tel que Chrome l'a écrit (le nom seul, sans nettoyage), pour le lien avec AETHRYON
   * Desktop (fichierAttendu) ; fileName, lui, est nettoyé pour l'affichage.
   */
  savedAs?: string;
  /** 3.6.0 : GIF demandé par l'ancien chemin (extrait MP4, puis GIF tiré de l'extrait), le serveur ayant refusé fmt « gif ». */
  gifLegacy?: true;
  /** 3.6.0 : serveur d'avant le contrat (startMs refusé par un 400) : passage envoyé en secondes (start_s, end_s). */
  clipSeconds?: true;
}

const VIEW_FIELDS = [
  "key", "jobId", "url", "platform", "fmt", "quality", "bitrate", "index", "title", "clip", "kind", "dest", "desktop", "state", "progress", "stage",
  "etape", "error", "createdAt", "updatedAt", "downloadId", "fileName", "bytes", "tabId",
] as const satisfies readonly (keyof JobView)[];

/** Copie blanche de la vue publique (liste fermée de champs : rien d'interne ne sort). */
export function toView(job: StoredJob): JobView {
  const out: Record<string, unknown> = {};
  for (const k of VIEW_FIELDS) if (job[k] !== undefined) out[k] = job[k];
  return out as unknown as JobView;
}

export const ACTIVE_STATES: ReadonlySet<JobState> = new Set(["queued", "converting", "downloading"]);
export const isActive = (j: Pick<JobView, "state">): boolean => ACTIVE_STATES.has(j.state);

export interface JobStore {
  all(): Promise<StoredJob[]>;
  get(key: string): Promise<StoredJob | undefined>;
  /**
   * Ajoute le job, sauf si un job actif `same` existe déjà (vérification et ajout atomiques) : renvoie
   * alors celui-ci (et lui rattache l'onglet demandeur s'il n'en avait pas).
   */
  insertUnlessActive(job: StoredJob, same: (j: StoredJob) => boolean): Promise<{ job: StoredJob; created: boolean }>;
  /** fn reçoit une copie et renvoie le job modifié, ou null pour ne rien écrire. */
  update(key: string, fn: (job: StoredJob) => StoredJob | null): Promise<{ before: StoredJob; after: StoredJob } | null>;
  remove(key: string): Promise<StoredJob | null>;
  /** Retire tous les jobs qui satisfont `pred` (déconnexion) ; renvoie leur nombre. */
  removeWhere(pred: (j: StoredJob) => boolean): Promise<number>;
}

/** `alive()` faux : le service worker est considéré comme arrêté, plus aucune écriture. */
export function createJobStore(alive: () => boolean): JobStore {
  let chain: Promise<unknown> = Promise.resolve();
  function locked<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  }
  const read = async (): Promise<StoredJob[]> => (await getJobs()) as StoredJob[];
  return {
    all: () => locked(read),
    get: (key) => locked(async () => (await read()).find((j) => j.key === key)),
    insertUnlessActive: (job, same) => locked(async () => {
      const jobs = await read();
      const existing = jobs.find((j) => isActive(j) && same(j));
      if (existing) {
        if (existing.tabId === undefined && job.tabId !== undefined && alive()) {
          existing.tabId = job.tabId;
          await setJobs(jobs);
        }
        return { job: existing, created: false };
      }
      if (!alive()) return { job, created: false };
      await setJobs([job, ...jobs]);
      return { job, created: true };
    }),
    update: (key, fn) => locked(async () => {
      if (!alive()) return null;
      const jobs = await read();
      const i = jobs.findIndex((j) => j.key === key);
      const before = jobs[i];
      if (!before) return null;
      const after = fn(structuredClone(before));
      if (!after) return null;
      jobs[i] = after;
      await setJobs(jobs);
      return { before, after };
    }),
    remove: (key) => locked(async () => {
      if (!alive()) return null;
      const jobs = await read();
      const gone = jobs.find((j) => j.key === key) ?? null;
      if (gone) await setJobs(jobs.filter((j) => j.key !== key));
      return gone;
    }),
    removeWhere: (pred) => locked(async () => {
      if (!alive()) return 0;
      const jobs = await read();
      const kept = jobs.filter((j) => !pred(j));
      if (kept.length !== jobs.length) await setJobs(kept);
      return jobs.length - kept.length;
    }),
  };
}

// ---- dernier état connu du compte (affiché hors ligne, marqué « stale ») ------------------------
const ACCOUNT_CACHE_KEY = "accountCache";

interface AccountCache { linkedAt: string; at: number; view: AccountView }

export async function readAccountCache(auth: AuthState): Promise<AccountView | null> {
  const c = (await chrome.storage.local.get(ACCOUNT_CACHE_KEY))[ACCOUNT_CACHE_KEY] as AccountCache | undefined;
  return c && c.linkedAt === auth.linkedAt && c.view && typeof c.view === "object" ? c.view : null;
}

export async function writeAccountCache(auth: AuthState, view: AccountView): Promise<void> {
  const entry: AccountCache = { linkedAt: auth.linkedAt, at: Date.now(), view: { ...view, stale: undefined } };
  delete entry.view.stale;
  await chrome.storage.local.set({ [ACCOUNT_CACHE_KEY]: entry });
}

export async function clearAccountCache(): Promise<void> {
  await chrome.storage.local.remove(ACCOUNT_CACHE_KEY);
}

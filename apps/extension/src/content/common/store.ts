// État des téléchargements par vidéo (clé mediaKey), indépendant des éléments affichés : si le bouton
// est recréé (navigation, nœud recyclé, passage au panneau flottant), il retrouve la progression.
import type { StartJob } from "../../shared/messages.ts";
import { IDLE, type JobDisplay, type SafeJob } from "./job.ts";

export interface Slot {
  display: JobDisplay;
  /** Clé locale du job (service worker), pour « Réessayer » et le suivi des job.update. */
  jobKey: string | null;
  job: SafeJob | null;
  /** Dernière requête envoyée (relance si aucun job n'a été créé). */
  payload: StartJob | null;
  at: number;
}

const EMPTY: Slot = { display: IDLE, jobKey: null, job: null, payload: null, at: 0 };
const MAX_SLOTS = 60;

export class JobStore {
  private slots = new Map<string, Slot>();
  private byJob = new Map<string, string>();
  private subs = new Map<string, Set<(s: Slot) => void>>();

  get(key: string): Slot {
    return this.slots.get(key) ?? EMPTY;
  }

  set(key: string, patch: Partial<Slot>): void {
    const next: Slot = { ...this.get(key), ...patch, at: Date.now() };
    this.slots.set(key, next);
    if (next.jobKey) this.byJob.set(next.jobKey, key);
    this.prune();
    for (const cb of this.subs.get(key) ?? []) {
      try {
        cb(next);
      } catch {
        /* un abonné défaillant n'empêche pas les autres */
      }
    }
  }

  mediaKeyForJob(jobKey: string): string | undefined {
    return this.byJob.get(jobKey);
  }

  subscribe(key: string, cb: (s: Slot) => void): () => void {
    let set = this.subs.get(key);
    if (!set) this.subs.set(key, (set = new Set()));
    set.add(cb);
    return () => {
      set.delete(cb);
      if (set.size === 0) this.subs.delete(key);
    };
  }

  clear(): void {
    this.slots.clear();
    this.byJob.clear();
    this.subs.clear();
  }

  private prune(): void {
    if (this.slots.size <= MAX_SLOTS) return;
    const idle = [...this.slots.entries()].filter(([k, s]) => !s.display.busy && !this.subs.has(k)).sort((a, b) => a[1].at - b[1].at);
    for (const [k, s] of idle.slice(0, this.slots.size - MAX_SLOTS)) {
      this.slots.delete(k);
      if (s.jobKey) this.byJob.delete(s.jobKey);
    }
  }
}

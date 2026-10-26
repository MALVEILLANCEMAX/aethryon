// Annuler / Rétablir (V3.5) : historique des réglages d'un média (passage, recadrage, vitesse, son, formats…), 60 pas
// au plus, en mémoire de l'onglet (le brouillon gardé, lui, est le DERNIER état : edit.ts keepEdit).
// Une rafale sur le même réglage (flèches répétées, curseur que l'on fait glisser, frappe dans un champ) compte pour
// UN pas : chaque changement des mêmes champs à moins de 700 ms du précédent prolonge le pas en cours. Un glisser de
// la frise n'arrive ici qu'une fois, au lâcher (sélection « vivante » hors de React, outils/live.ts).
// Rien ne se re-rend à chaque réglage : seuls les boutons Annuler et Rétablir s'abonnent, et seulement quand leur
// disponibilité change (useSyncExternalStore).
import type { Edit } from "./edit.ts";

const MAX = 60;
const COALESCE_MS = 700;

/** Champs qui diffèrent entre deux réglages (ordre stable), "" s'ils sont identiques. */
export function changedKeys(a: Edit, b: Edit): string {
  const keys: string[] = [];
  for (const k of Object.keys(b) as (keyof Edit)[]) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) keys.push(k);
  }
  return keys.sort().join(",");
}

export interface HistoryState { undo: boolean; redo: boolean }

export class EditHistory {
  private past: Edit[] = [];
  private future: Edit[] = [];
  private last = { keys: "", at: 0 };
  private snap: HistoryState = { undo: false, redo: false };
  private listeners = new Set<() => void>();

  /** Un réglage vient de changer (`prev` → nouvel état) : nouveau pas, ou prolongation du pas en cours. */
  record(prev: Edit, keys: string, now: number = performance.now()): void {
    if (!keys) return;
    const coalesce = keys === this.last.keys && now - this.last.at < COALESCE_MS && this.past.length > 0;
    this.last = { keys, at: now };
    if (!coalesce) {
      this.past.push(prev);
      if (this.past.length > MAX) this.past.shift();
    }
    this.future = [];
    this.emit();
  }

  /** Revient au pas précédent ; `current` part dans « Rétablir ». null s'il n'y a rien à annuler. */
  undo(current: Edit): Edit | null {
    const p = this.past.pop();
    if (!p) return null;
    this.future.push(current);
    this.last = { keys: "", at: 0 };
    this.emit();
    return p;
  }

  redo(current: Edit): Edit | null {
    const n = this.future.pop();
    if (!n) return null;
    this.past.push(current);
    this.last = { keys: "", at: 0 };
    this.emit();
    return n;
  }

  readonly subscribe = (f: () => void): (() => void) => {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  };

  readonly getSnapshot = (): HistoryState => this.snap;

  private emit(): void {
    const s = { undo: this.past.length > 0, redo: this.future.length > 0 };
    if (s.undo === this.snap.undo && s.redo === this.snap.redo) return;
    this.snap = s;
    for (const f of this.listeners) f();
  }
}

// Guide « Bien démarrer » de l'espace personnel. L'état de chaque étape est DÉDUIT des données réelles du
// serveur (/api/keys, /api/activity), jamais d'une supposition locale ni d'un minuteur :
//
//  1. Choisir ta façon d'utiliser AETHRYON : faite dès que le compte a un jeton (même révoqué) ou une
//     conversion. Aujourd'hui, seul le raccourci iPhone utilise un jeton.
//  2. Installer le raccourci : faite quand un jeton ACTIF a déjà servi (`lastUsedAt` : le service de
//     conversion l'a reçu, donc le raccourci est installé et le jeton collé). Sous-étapes : créer (un jeton
//     actif existe) ; copier puis coller à l'import (le site ne peut pas le voir : elles se cochent quand le
//     jeton sert).
//  3. Ta première conversion : faite quand l'activité contient une conversion terminée.
//  4. Retrouver ton activité : faite quand l'activité contient au moins une conversion (elle y est
//     inscrite, même en échec).
//  5. Gérer ton compte : repère toujours accessible. Aucune donnée du serveur ne dit qu'on « a géré » son
//     compte : jamais cochée, jamais bloquante.
//
// « Tout est prêt » = étapes 1 à 4 faites. Une étape faite redevient à faire si la réalité change (jeton
// régénéré : le nouveau n'a pas encore servi ; tous les jetons révoqués).
//
// Seuls les jetons du RACCOURCI comptent (kind « shortcut ») : une clé d'extension navigateur (kind
// « extension », listée à part dans « Mes jetons ») n'installe pas le raccourci et ne relie pas l'iPhone.
// Sans `kind` (serveur d'avant l'extension), une clé est un jeton du raccourci.
import type { ActivityItem, ApiKey, Today } from "./types.ts";

/** Jeton du raccourci iPhone (et non clé d'une extension navigateur). */
export const isShortcutKey = (k: Pick<ApiKey, "kind">): boolean => (k.kind ?? "shortcut") === "shortcut";

export type StepId = "acces" | "raccourci" | "conversion" | "activite";
export type StepState = "done" | "current" | "todo";
export const STEP_ORDER: readonly StepId[] = ["acces", "raccourci", "conversion", "activite"];

export interface Guide {
  steps: Record<StepId, StepState>;
  /** Première étape à faire, dans l'ordre ; null quand tout est prêt. */
  current: StepId | null;
  ready: boolean;
  doneCount: number;
  activeKeys: ApiKey[];
  /** Jeton actif qui a servi le plus récemment (preuve que le raccourci est relié). */
  usedKey: ApiKey | null;
  /** Un ancien jeton a servi, mais aucun jeton actif n'a encore servi (régénération, nouveau jeton). */
  replaced: boolean;
  /** Le compte a des jetons, mais aucun n'est actif (révoqués ou expirés). */
  noActiveKey: boolean;
  sub: { create: StepState; copy: StepState; install: StepState };
  /** Conversion terminée la plus récente. */
  latestDone: ActivityItem | null;
  /** Conversion la plus récente, quel que soit son état. */
  latest: ActivityItem | null;
  conversions: number;
  completedConversions: number;
}

/** Fusionne deux lectures de /api/activity (la plus fraîche en premier), sans doublon, plus récentes d'abord. */
export function mergeActivity(...lists: (readonly ActivityItem[] | undefined)[]): ActivityItem[] {
  const byId = new Map<string, ActivityItem>();
  for (const list of lists) for (const it of list ?? []) if (!byId.has(it.id)) byId.set(it.id, it);
  return [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export function deriveGuide(allKeys: readonly ApiKey[], items: readonly ActivityItem[]): Guide {
  const keys = allKeys.filter(isShortcutKey);
  const activeKeys = keys.filter((k) => k.status === "active");
  const usedKey = activeKeys
    .filter((k) => k.lastUsedAt)
    .sort((a, b) => (a.lastUsedAt! < b.lastUsedAt! ? 1 : -1))[0] ?? null;
  const anyKeyUsed = keys.some((k) => k.lastUsedAt);
  const completed = items.filter((i) => i.state === "done");

  const done: Record<StepId, boolean> = {
    acces: keys.length > 0 || items.length > 0,
    raccourci: usedKey !== null,
    conversion: completed.length > 0,
    activite: items.length > 0,
  };
  const current = STEP_ORDER.find((id) => !done[id]) ?? null;
  const steps = Object.fromEntries(
    STEP_ORDER.map((id) => [id, done[id] ? "done" : id === current ? "current" : "todo"]),
  ) as Record<StepId, StepState>;
  const hasActive = activeKeys.length > 0;

  return {
    steps,
    current,
    ready: current === null,
    doneCount: STEP_ORDER.filter((id) => done[id]).length,
    activeKeys,
    usedKey,
    replaced: !usedKey && anyKeyUsed && hasActive,
    noActiveKey: keys.length > 0 && !hasActive,
    sub: {
      create: hasActive ? "done" : "current",
      copy: usedKey ? "done" : hasActive ? "current" : "todo",
      install: usedKey ? "done" : hasActive ? "current" : "todo",
    },
    latestDone: completed[0] ?? null,
    latest: items[0] ?? null,
    conversions: items.length,
    completedConversions: completed.length,
  };
}

/**
 * Moment unique de la première conversion : seulement si l'historique chargé est complet (moins de
 * `windowSize` lignes), qu'il contient UNE seule conversion terminée et qu'elle date de moins de 24 h.
 * Un compte qui convertit depuis longtemps ne voit jamais « première conversion ».
 */
export function firstConversion(items: readonly ActivityItem[], windowSize: number, now = Date.now()): ActivityItem | null {
  if (items.length >= windowSize) return null;
  const completed = items.filter((i) => i.state === "done");
  if (completed.length !== 1) return null;
  const it = completed[0]!;
  const at = Date.parse(it.finishedAt ?? it.createdAt);
  return Number.isFinite(at) && now - at < 24 * 3_600_000 ? it : null;
}

export interface QuotaView {
  used: number;
  unlimited: boolean;
  /** Limite du jour (bonus compris), null si illimité. */
  limit: number | null;
  remaining: number | null;
  bonus: number;
  /** Limite quotidienne de base, hors bonus (ligne « offre »). */
  baseDaily: number | null;
  resetAt: string;
  exhausted: boolean;
}

/** Lecture tolérante de `today` (anciens serveurs : ni `unlimited` ni `bonus`). */
export function quotaView(t: Today): QuotaView {
  const unlimited = t.unlimited === true || t.limit === null;
  const bonus = Math.max(0, t.bonus ?? 0);
  const limit = unlimited ? null : t.limit;
  const remaining = unlimited ? null : t.remaining ?? Math.max(0, (limit ?? 0) - t.used);
  return {
    used: t.used,
    unlimited,
    limit,
    remaining,
    bonus,
    baseDaily: limit === null ? null : Math.max(0, limit - bonus),
    resetAt: t.resetAt,
    exhausted: !unlimited && (remaining ?? 0) <= 0,
  };
}

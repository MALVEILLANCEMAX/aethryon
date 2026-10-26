// Réglages modifiables par l'administrateur (table ytc_setting), avec valeurs par défaut.
// Les valeurs « vides » ("") signifient « valeur par défaut de la configuration du serveur ».
import type { DB } from "./db.ts";
import { nowIso } from "./time.ts";

export const PLATFORM_NAMES = ["youtube", "tiktok", "twitter"] as const;
export type PlatformName = (typeof PLATFORM_NAMES)[number];
export type Platforms = Record<PlatformName, boolean>;

export const SHORTCUT_URL_RE = /^https:\/\/www\.icloud\.com\/shortcuts\/[0-9a-f]{32}$/;
export const MAINTENANCE_MAX = 280;

export interface Settings {
  conversionsPaused: boolean;
  signupsOpen: boolean;
  dailyLimit: number | null;          // null = valeur de DAILY_CONVERSIONS
  maxActive: number | null;           // null = valeur de MAX_ACTIVE_JOBS (concurrence commerciale)
  maintenanceMessage: string | null;  // bandeau affiché par le site (≤ 280 caractères)
  platforms: Platforms;               // plateformes acceptées à la création d'un job
  shortcutUrl: string | null;         // null = ICLOUD_SHORTCUT_URL
}

export type SettingKey =
  | "conversions_paused" | "signups_open" | "daily_limit" | "max_active" | "maintenance_message" | "platforms" | "shortcut_url";

const DEFAULT_PLATFORMS: Platforms = { youtube: true, tiktok: true, twitter: true };
const DEFAULTS: Settings = {
  conversionsPaused: false, signupsOpen: true, dailyLimit: null, maxActive: null,
  maintenanceMessage: null, platforms: DEFAULT_PLATFORMS, shortcutUrl: null,
};

const intOrNull = (v: string): number | null => {
  if (v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

export function parsePlatforms(raw: string): Platforms {
  const out: Platforms = { ...DEFAULT_PLATFORMS };
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o && typeof o === "object") for (const p of PLATFORM_NAMES) if (typeof o[p] === "boolean") out[p] = o[p] as boolean;
  } catch { /* valeur illisible : toutes les plateformes restent actives */ }
  return out;
}

export function getSettings(db: DB): Settings {
  const rows = db.prepare("SELECT key, value FROM ytc_setting").all() as { key: string; value: string }[];
  const s: Settings = { ...DEFAULTS, platforms: { ...DEFAULT_PLATFORMS } };
  for (const r of rows) {
    if (r.key === "conversions_paused") s.conversionsPaused = r.value === "true";
    else if (r.key === "signups_open") s.signupsOpen = r.value === "true";
    else if (r.key === "daily_limit") s.dailyLimit = intOrNull(r.value);
    else if (r.key === "max_active") s.maxActive = intOrNull(r.value);
    else if (r.key === "maintenance_message") s.maintenanceMessage = r.value === "" ? null : r.value;
    else if (r.key === "platforms") s.platforms = parsePlatforms(r.value);
    else if (r.key === "shortcut_url") s.shortcutUrl = SHORTCUT_URL_RE.test(r.value) ? r.value : null;
  }
  return s;
}

/** Dernière modification d'un réglage (pour l'affichage « modifié le … par … »). */
export function settingsUpdated(db: DB): { updatedAt: string | null; updatedBy: string | null } {
  const r = db.prepare("SELECT updated_at, updated_by FROM ytc_setting ORDER BY updated_at DESC LIMIT 1").get() as
    | { updated_at: string; updated_by: string | null } | undefined;
  return { updatedAt: r?.updated_at ?? null, updatedBy: r?.updated_by ?? null };
}

export function setSetting(db: DB, key: SettingKey, value: string, by: string | null): void {
  db.prepare(
    "INSERT INTO ytc_setting (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
  ).run(key, value, nowIso(), by);
}

/** « x » (nom court de X dans certaines URL) est la plateforme twitter ; null si inconnue. */
export function normalizePlatform(raw: string | null | undefined): PlatformName | null {
  if (!raw) return null;
  const p = raw.toLowerCase();
  if (p === "x") return "twitter";
  return (PLATFORM_NAMES as readonly string[]).includes(p) ? (p as PlatformName) : null;
}

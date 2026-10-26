// Statistiques du Control Center, calculées à partir des lignes réelles de la base (aucune estimation).
// Jours et seaux quotidiens en heure de Paris ; seaux horaires alignés sur l'heure (Paris est à un
// nombre entier d'heures d'UTC, les heures pleines coïncident).
import type { Config } from "./config.ts";
import type { DB } from "./db.ts";
import { toIso } from "./http.ts";
import { statusOf } from "./keys.ts";
import { normalizePlatform } from "./settings.ts";
import { nextParisMidnight, parisDay } from "./time.ts";
import { ERROR_FALLBACK_TEXT, errorMessage, type Policy, type Today, type UsageService, type UsageState } from "./usage.ts";

export const PLATFORM_BUCKETS = ["youtube", "tiktok", "twitter", "other"] as const;
export type PlatformBucket = (typeof PLATFORM_BUCKETS)[number];
export const platformBucket = (p: string | null): PlatformBucket => normalizePlatform(p) ?? "other";

const DAY_MS = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;
const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 10_000) / 10_000 : null);
const avg = (xs: number[]) => (xs.length ? round1(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

/** Secondes entre deux dates ISO (0,1 s près), null si l'une manque ou si l'ordre est incohérent. */
export function secondsBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isFinite(ms) && ms >= 0 ? round1(ms / 1000) : null;
}

/** p90 par rang le plus proche. */
export function p90(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(0.9 * s.length) - 1)]!;
}

/** Début (instant UTC) d'un jour parisien AAAA-MM-JJ. */
export function parisDayStart(day: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return nextParisMidnight(new Date(Date.UTC(y, m - 1, d - 1, 12)));
}

/** Les `n` derniers jours parisiens (du plus ancien à aujourd'hui), par arithmétique de calendrier. */
export function lastParisDays(n: number, at = new Date()): string[] {
  const [y, m, d] = parisDay(at).split("-").map(Number) as [number, number, number];
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10));
  return out;
}

const maxIso = (...vs: (string | null)[]): string | null =>
  vs.reduce<string | null>((acc, v) => (v && (!acc || v > acc) ? v : acc), null);

/** Monogramme (les avatars Google ne sont pas stockés) : initiales du nom, sinon de l'e-mail. */
export function initials(name: string | null, email: string): string {
  const letters = (s: string) => s.split(/[\s._+-]+/).map((w) => Array.from(w).find((ch) => /\p{L}|\p{N}/u.test(ch)) ?? "").filter(Boolean);
  let l = letters((name ?? "").trim());
  if (!l.length) l = letters(email.split("@")[0] ?? "");
  return (l.length >= 2 ? l[0]! + l[l.length - 1]! : l[0] ?? "?").toLocaleUpperCase("fr-FR");
}

// ---- conversions ------------------------------------------------------------------------------

export interface UsageRow {
  id: string; user_id: string; key_id: string | null; day: string; fmt: string; platform: string | null; state: UsageState;
  error_code: string | null; size_bytes: number | null; created_at: string; updated_at: string; finished_at: string | null;
  job_id: string | null; started_at: string | null; cause: string | null; email: string | null;
}

export interface Conversion {
  id: string; jobId: string | null; userId: string; userEmail: string | null; platform: string | null; fmt: string; state: UsageState;
  errorCode: string | null; errorMessage: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null;
  durationS: number | null; processingS: number | null; sizeBytes: number | null;
}

export const CONVERSION_SELECT =
  "SELECT x.id, x.user_id, x.key_id, x.day, x.fmt, x.platform, x.state, x.error_code, x.size_bytes, x.created_at, x.updated_at, " +
  "x.finished_at, x.job_id, x.started_at, x.cause, u.email AS email FROM ytc_usage x LEFT JOIN \"user\" u ON u.id = x.user_id";

export function conversionView(r: UsageRow): Conversion {
  return {
    id: r.id, jobId: r.job_id, userId: r.user_id, userEmail: r.email, platform: r.platform, fmt: r.fmt, state: r.state,
    errorCode: r.error_code, errorMessage: r.error_code ? errorMessage(r.error_code) : null,
    createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at,
    durationS: secondsBetween(r.created_at, r.finished_at), processingS: secondsBetween(r.started_at, r.finished_at),
    sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
  };
}

export function recentConversions(db: DB, opts: { userId?: string; state?: UsageState; limit: number }): Conversion[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (opts.userId) { where.push("x.user_id = ?"); args.push(opts.userId); }
  if (opts.state) { where.push("x.state = ?"); args.push(opts.state); }
  const rows = db.prepare(`${CONVERSION_SELECT}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY x.created_at DESC, x.id DESC LIMIT ?`)
    .all(...args, opts.limit) as unknown as UsageRow[];
  return rows.map(conversionView);
}

interface Tally { total: number; done: number; error: number; byFormat: { mp3: number; mp4: number }; byPlatform: Record<PlatformBucket, number>; durations: number[] }
function tally(rows: { state: string; fmt: string; platform: string | null; created_at: string; finished_at: string | null }[]): Tally {
  const t: Tally = { total: 0, done: 0, error: 0, byFormat: { mp3: 0, mp4: 0 }, byPlatform: { youtube: 0, tiktok: 0, twitter: 0, other: 0 }, durations: [] };
  for (const r of rows) {
    if (r.state === "refunded") continue;
    t.total++;
    if (r.state === "done") {
      t.done++;
      const d = secondsBetween(r.created_at, r.finished_at);
      if (d !== null) t.durations.push(d);
    } else if (r.state === "error") t.error++;
    if (r.fmt === "mp3" || r.fmt === "mp4") t.byFormat[r.fmt]++;
    t.byPlatform[platformBucket(r.platform)]++;
  }
  return t;
}

/** Statistiques de toutes les conversions conservées d'un utilisateur. */
export function userConversionStats(db: DB, userId: string) {
  const rows = db.prepare("SELECT state, fmt, platform, created_at, finished_at FROM ytc_usage WHERE user_id = ?").all(userId) as
    { state: string; fmt: string; platform: string | null; created_at: string; finished_at: string | null }[];
  const t = tally(rows);
  return { total: t.total, done: t.done, error: t.error, byFormat: t.byFormat, byPlatform: t.byPlatform, avgDurationS: avg(t.durations) };
}

// ---- utilisateurs -----------------------------------------------------------------------------

export interface UserRow {
  id: string; email: string; name: string; initials: string; createdAt: string | null; lastActiveAt: string | null;
  role: string; status: string; conversions30d: number; conversionsTotal: number; todayUsed: number;
  dailyLimit: number | null; unlimited: boolean; activeKeys: number;
}

export interface UserFilter { q?: string; role?: "user" | "admin"; status?: "active" | "suspended"; id?: string }

/** Lignes « utilisateur » complètes (quota du jour compris), filtrées en SQL paramétré. */
export function userRows(db: DB, usage: UsageService, f: UserFilter = {}, quotas = usage.todayAll()): UserRow[] {
  const now = Date.now();
  const where: string[] = [];
  const args: (string | number)[] = [new Date(now - 30 * DAY_MS).toISOString(), new Date(now).toISOString()];
  if (f.id) { where.push("u.id = ?"); args.push(f.id); }
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
    where.push("(u.email LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')");
    args.push(like, like);
  }
  if (f.role === "admin") where.push("u.role = 'admin'");
  else if (f.role === "user") where.push("(u.role IS NULL OR u.role <> 'admin')");
  if (f.status === "suspended") where.push("u.status = 'suspended'");
  else if (f.status === "active") where.push("(u.status IS NULL OR u.status <> 'suspended')");
  const rows = db.prepare(
    "SELECT u.id, u.email, u.name, u.role, u.status, u.\"createdAt\" AS createdAt, u.\"lastLoginAt\" AS lastLoginAt, " +
    "(SELECT max(s.\"updatedAt\") FROM session s WHERE s.\"userId\" = u.id) AS lastSession, " +
    "(SELECT max(x.created_at) FROM ytc_usage x WHERE x.user_id = u.id) AS lastUsage, " +
    "(SELECT count(*) FROM ytc_usage x WHERE x.user_id = u.id AND x.state <> 'refunded') AS total, " +
    "(SELECT count(*) FROM ytc_usage x WHERE x.user_id = u.id AND x.state <> 'refunded' AND x.created_at >= ?1) AS c30, " +
    "(SELECT count(*) FROM apikey k LEFT JOIN ytc_key_meta m ON m.key_id = k.id WHERE k.referenceId = u.id " +
    "AND (k.enabled IS NULL OR k.enabled <> 0) AND m.revoked_at IS NULL AND (k.expiresAt IS NULL OR k.expiresAt > ?2)) AS activeKeys " +
    `FROM "user" u${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`,
  ).all(...args) as {
    id: string; email: string; name: string | null; role: string | null; status: string | null; createdAt: unknown; lastLoginAt: unknown;
    lastSession: unknown; lastUsage: string | null; total: number; c30: number; activeKeys: number;
  }[];
  return rows.map((r) => {
    const q = quotas.get(r.id);
    return {
      id: r.id, email: r.email, name: r.name ?? "", initials: initials(r.name, r.email),
      createdAt: toIso(r.createdAt), lastActiveAt: maxIso(toIso(r.lastLoginAt), toIso(r.lastSession), toIso(r.lastUsage)),
      role: r.role ?? "user", status: r.status ?? "active",
      conversions30d: Number(r.c30), conversionsTotal: Number(r.total),
      todayUsed: q?.used ?? 0, dailyLimit: q ? q.today.limit : null, unlimited: q?.policy.unlimited ?? false,
      activeKeys: Number(r.activeKeys),
    };
  });
}

// ---- vue d'ensemble ---------------------------------------------------------------------------

export function overviewStats(db: DB, usage: UsageService) {
  const now = Date.now();
  const today = parisDay();
  const since30 = new Date(now - 30 * DAY_MS).toISOString();
  const users = userRows(db, usage);
  const usersOut = {
    total: users.length,
    newToday: users.filter((u) => u.createdAt && parisDay(new Date(u.createdAt)) === today).length,
    new30d: users.filter((u) => u.createdAt && u.createdAt >= since30).length,
    active24h: users.filter((u) => u.lastActiveAt && Date.parse(u.lastActiveAt) >= now - DAY_MS).length,
    active30d: users.filter((u) => u.lastActiveAt && u.lastActiveAt >= since30).length,
  };
  const rows = db.prepare("SELECT state, fmt, platform, created_at, finished_at FROM ytc_usage WHERE created_at >= ? AND state <> 'refunded'").all(since30) as
    { state: string; fmt: string; platform: string | null; created_at: string; finished_at: string | null }[];
  const t = tally(rows);
  const count = (sql: string, ...a: string[]) => Number((db.prepare(sql).get(...a) as { n: number }).n);
  // Au-delà de 3 h (délai maximal d'un job : DOWNLOAD_TIMEOUT_S, 30 min par défaut, plus la file),
  // une ligne « reserved » ou « running » est un job perdu par ytapi (redémarrage) : non comptée.
  const staleBefore = new Date(now - 3 * 3_600_000).toISOString();
  const conversions = {
    today: usage.conversionsToday(),
    last30d: t.total,
    running: count("SELECT count(*) AS n FROM ytc_usage WHERE state = 'running' AND updated_at >= ?", staleBefore),
    successRate30d: ratio(t.done, t.done + t.error),
    failures30d: t.error,
    avgDurationS30d: avg(t.durations),
    byFormat: t.byFormat,
    byPlatform: t.byPlatform,
  };
  const localJobs = {
    active: conversions.running,
    queued: count("SELECT count(*) AS n FROM ytc_usage WHERE state = 'reserved' AND updated_at >= ?", staleBefore),
  };
  return { users: usersOut, conversions, localJobs };
}

// ---- quotas -----------------------------------------------------------------------------------

export function quotasStats(db: DB, cfg: Config, usage: UsageService) {
  const quotas = usage.todayAll();
  const rows = userRows(db, usage, {}, quotas);
  const policies = new Map((db.prepare("SELECT * FROM ytc_user_policy").all() as {
    user_id: string; daily_limit: number | null; unlimited: number; max_active: number | null; reset_at: string | null;
  }[]).map((p) => [p.user_id, p]));
  const atLimit = rows.filter((r) => !r.unlimited && r.dailyLimit !== null && r.todayUsed >= r.dailyLimit);
  const custom = rows
    .filter((r) => { const p = policies.get(r.id); return !!p && (p.daily_limit !== null || Number(p.unlimited) === 1 || p.max_active !== null); })
    .map((r) => {
      const p = policies.get(r.id)!;
      return { ...r, policy: { dailyLimit: p.daily_limit, unlimited: Number(p.unlimited) === 1, maxActive: p.max_active, resetAt: p.reset_at } };
    });
  const days = lastParisDays(30);
  const byDay = new Map((db.prepare(
    "SELECT day, count(*) AS n, count(DISTINCT user_id) AS u FROM ytc_usage WHERE day >= ? AND state <> 'refunded' GROUP BY day",
  ).all(days[0]!) as { day: string; n: number; u: number }[]).map((r) => [r.day, r]));
  const series = days.map((day) => ({ day, conversions: Number(byDay.get(day)?.n ?? 0), users: Number(byDay.get(day)?.u ?? 0) }));
  const t = series[series.length - 1]!;
  return {
    global: { dailyLimit: usage.globalDailyLimit(), maxActive: usage.globalMaxActive(), techMaxActive: cfg.techMaxActive },
    atLimit, custom, today: { conversions: t.conversions, users: t.users }, series,
  };
}

/** Utilisateurs à la limite aujourd'hui et taux moyen d'utilisation (utilisateurs actifs aujourd'hui, quota limité). */
export function quotaUse(quotas: Map<string, { used: number; policy: Policy; today: Today }>): { usersAtLimit: number; avgUsedPct: number | null } {
  let atLimit = 0;
  const pcts: number[] = [];
  for (const q of quotas.values()) {
    if (q.policy.unlimited) continue;
    if (q.used >= q.policy.dailyLimit) atLimit++;
    if (q.used > 0) pcts.push(q.policy.dailyLimit > 0 ? Math.min(100, (q.used / q.policy.dailyLimit) * 100) : 100);
  }
  return { usersAtLimit: atLimit, avgUsedPct: avg(pcts) };
}

// ---- analyses ---------------------------------------------------------------------------------

export type Period = "24h" | "7d" | "30d";

export const MEASURED = [
  "comptes et inscriptions",
  "sessions (dernière activité)",
  "conversions\u00a0: états, formats, plateformes, durées, tailles des fichiers produits",
  "erreurs (codes stables)",
  "quotas et bonus",
  "jetons et refus d'authentification agrégés",
  "file d'attente et disque de ytapi (API interne)",
  "taille et intégrité de la base, latences mesurées par account",
];
export const NOT_MEASURED = [
  "CPU des conteneurs (pas d'accès Docker depuis l'application, volontairement)",
  "mémoire des conteneurs (pas d'accès Docker depuis l'application, volontairement)",
  "trafic réseau réel (bytesServed = somme des tailles des fichiers produits, pas les octets téléchargés)",
];

export function analytics(db: DB, usage: UsageService, period: Period, now = new Date()) {
  const HOUR = 3_600_000;
  let starts: number[];
  let indexOf: (iso: string, day: string) => number;
  if (period === "24h") {
    const h0 = Math.floor(now.getTime() / HOUR) * HOUR - 23 * HOUR;
    starts = Array.from({ length: 24 }, (_, i) => h0 + i * HOUR);
    indexOf = (iso) => Math.floor((Date.parse(iso) - h0) / HOUR);
  } else {
    const days = lastParisDays(period === "7d" ? 7 : 30, now);
    starts = days.map((d) => parisDayStart(d).getTime());
    const pos = new Map(days.map((d, i) => [d, i]));
    indexOf = (_iso, day) => pos.get(day) ?? -1;
  }
  const since = new Date(starts[0]!).toISOString();
  const buckets = starts.map((s) => ({ start: new Date(s).toISOString(), conversions: 0, done: 0, error: 0, mp3: 0, mp4: 0, signups: 0, avgDurationS: null as number | null }));
  const durations = starts.map(() => [] as number[]);
  const rows = db.prepare(
    "SELECT day, state, fmt, platform, error_code, size_bytes, created_at, finished_at FROM ytc_usage WHERE created_at >= ? AND state <> 'refunded'",
  ).all(since) as { day: string; state: string; fmt: string; platform: string | null; error_code: string | null; size_bytes: number | null; created_at: string; finished_at: string | null }[];
  const perPlatform = new Map<PlatformBucket, { done: number; error: number; d: number[] }>(PLATFORM_BUCKETS.map((p) => [p, { done: 0, error: 0, d: [] }]));
  const formats = { mp3: 0, mp4: 0 };
  const errors = new Map<string, number>();
  let bytesServed = 0;
  for (const r of rows) {
    const i = indexOf(r.created_at, r.day);
    const b = buckets[i];
    if (!b) continue;
    b.conversions++;
    if (r.fmt === "mp3" || r.fmt === "mp4") { b[r.fmt]++; formats[r.fmt]++; }
    const pp = perPlatform.get(platformBucket(r.platform))!;
    if (r.state === "done") {
      b.done++; pp.done++;
      bytesServed += Number(r.size_bytes ?? 0);
      const d = secondsBetween(r.created_at, r.finished_at);
      if (d !== null) { durations[i]!.push(d); pp.d.push(d); }
    } else if (r.state === "error") {
      b.error++; pp.error++;
      const code = r.error_code ?? "";
      errors.set(code, (errors.get(code) ?? 0) + 1);
    }
  }
  buckets.forEach((b, i) => { b.avgDurationS = avg(durations[i]!); });
  const signups = db.prepare('SELECT "createdAt" AS c FROM "user" WHERE "createdAt" >= ?').all(since) as { c: unknown }[];
  for (const s of signups) {
    const iso = toIso(s.c);
    if (!iso) continue;
    const b = buckets[indexOf(iso, parisDay(new Date(iso)))];
    if (b) b.signups++;
  }
  return {
    period,
    buckets,
    successByPlatform: PLATFORM_BUCKETS.map((p) => { const x = perPlatform.get(p)!; return { platform: p, done: x.done, error: x.error, rate: ratio(x.done, x.done + x.error) }; }),
    durationByPlatform: PLATFORM_BUCKETS.map((p) => { const x = perPlatform.get(p)!; return { platform: p, avgS: avg(x.d), p90S: p90(x.d) }; }),
    formats,
    topErrors: [...errors].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10)
      .map(([code, count]) => ({ code: code || null, message: code ? errorMessage(code)! : ERROR_FALLBACK_TEXT, count })),
    quota: quotaUse(usage.todayAll()),
    bytesServed,
    measured: MEASURED,
    notMeasured: NOT_MEASURED,
  };
}

// ---- jetons -----------------------------------------------------------------------------------

export interface AdminKey {
  id: string; name: string; start: string; userId: string; userEmail: string | null; createdAt: string | null; expiresAt: string | null;
  lastUsedAt: string | null; revokedAt: string | null; revokedReason: string | null; state: "active" | "revoked" | "expired";
  kind: "shortcut" | "extension" | "discord" | "premiere" | "desktop"; deviceLabel: string | null; // type de clé (docs/ADMIN.md §6) ; appareil lié d'une extension ou du panneau Premiere
}

export function adminKeys(db: DB, f: { userId?: string; q?: string; keyId?: string; kind?: "shortcut" | "extension" | "discord" | "premiere" | "desktop" } = {}): AdminKey[] {
  const where: string[] = [];
  const args: string[] = [];
  if (f.userId) { where.push("k.referenceId = ?"); args.push(f.userId); }
  if (f.keyId) { where.push("k.id = ?"); args.push(f.keyId); }
  if (f.kind) { where.push("COALESCE(m.kind, 'shortcut') = ?"); args.push(f.kind); }
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
    where.push("(u.email LIKE ? ESCAPE '\\' OR k.name LIKE ? ESCAPE '\\' OR k.start LIKE ? ESCAPE '\\' OR m.device_label LIKE ? ESCAPE '\\')");
    args.push(like, like, like, like);
  }
  const rows = db.prepare(
    "SELECT k.id, k.name, k.start, k.referenceId, k.enabled, k.expiresAt, k.createdAt, k.lastRequest, m.revoked_at, m.revoked_reason, m.last_used_at, m.kind, m.device_label, u.email " +
    "FROM apikey k LEFT JOIN ytc_key_meta m ON m.key_id = k.id LEFT JOIN \"user\" u ON u.id = k.referenceId" +
    (where.length ? ` WHERE ${where.join(" AND ")}` : ""),
  ).all(...args) as {
    id: string; name: string | null; start: string | null; referenceId: string; enabled: number | null; expiresAt: string | number | null;
    createdAt: string | number; lastRequest: string | number | null; revoked_at: string | null; revoked_reason: string | null; last_used_at: string | null;
    kind: string | null; device_label: string | null; email: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id, name: r.name ?? "", start: r.start ?? "ytc_", userId: r.referenceId, userEmail: r.email,
    createdAt: toIso(r.createdAt), expiresAt: toIso(r.expiresAt),
    lastUsedAt: maxIso(toIso(r.last_used_at), toIso(r.lastRequest)),
    revokedAt: r.revoked_at, revokedReason: r.revoked_reason,
    state: statusOf(r),
    kind: r.kind === "extension" ? "extension" as const : r.kind === "discord" ? "discord" as const : r.kind === "premiere" ? "premiere" as const : r.kind === "desktop" ? "desktop" as const : "shortcut" as const,
    deviceLabel: r.kind === "extension" || r.kind === "premiere" || r.kind === "desktop" ? r.device_label ?? null : null,
  }));
}

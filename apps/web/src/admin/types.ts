// Contrat de l'API d'administration (docs/ADMIN.md §6), noms de champs à l'identique.
// Dates : ISO 8601 (UTC). Erreurs : { error, message }. Listes paginées : { items, total, page, pageSize }.

export interface Page<T> { items: T[]; total: number; page: number; pageSize: number }

export interface AdminMe { id: string; email: string; name: string; role: string }

export type AlertLevel = "info" | "warning" | "critical";
export interface Alert { level: AlertLevel; code: string; message: string; at: string }

export interface PlatformSplit { youtube: number; tiktok: number; twitter: number; other: number }
export interface FormatSplit { mp3: number; mp4: number }

export interface Overview {
  users: { total: number; newToday: number; new30d: number; active24h: number; active30d: number };
  conversions: {
    today: number; last30d: number; running: number; successRate30d: number | null; failures30d: number;
    avgDurationS30d: number | null; byFormat: FormatSplit; byPlatform: PlatformSplit;
  };
  jobs: { active: number | null; queued: number | null };
  alerts: Alert[];
}

export type Role = "user" | "admin";
export type UserStatus = "active" | "suspended";
export interface UserRow {
  id: string; email: string; name: string; initials: string; createdAt: string | null; lastActiveAt: string | null;
  role: Role | string; status: UserStatus | string; conversions30d: number; conversionsTotal: number; todayUsed: number;
  dailyLimit: number | null; unlimited: boolean; activeKeys: number;
}

export type ConversionState = "reserved" | "running" | "done" | "error" | "cancelled" | "refunded";
export interface Conversion {
  id: string; jobId: string | null; userId: string; userEmail: string | null; platform: string | null; fmt: string;
  state: ConversionState | string; errorCode: string | null; errorMessage: string | null; createdAt: string;
  startedAt: string | null; finishedAt: string | null; durationS: number | null; processingS: number | null; sizeBytes: number | null;
}
export interface ConversionDetail extends Conversion {
  cause: string | null; keyName: string | null; live?: { stage: string | null; progress: number | null } | null;
}

export type KeyState = "active" | "revoked" | "expired";
/** Type de clé : raccourci iPhone, extension navigateur, panneau Premiere Pro, ou clé de 15 min du bot Discord (docs/ADMIN.md §6). */
export type KeyKind = "shortcut" | "extension" | "discord" | "premiere";
export interface AdminKey {
  id: string; name: string; start: string | null; userId: string; userEmail: string | null; createdAt: string;
  expiresAt: string | null; lastUsedAt: string | null; revokedAt: string | null; revokedReason: string | null; state: KeyState | string;
  kind: KeyKind | string; deviceLabel: string | null;
}

export type AuditResult = "ok" | "refused" | "error";
export interface AuditEvent {
  id: string; at: string; actorId: string | null; actorLabel: string | null; action: string; targetType: string | null;
  target: string | null; details: unknown; result: AuditResult | string;
}

export interface Policy { dailyLimit: number | null; unlimited: boolean; maxActive: number | null; resetAt: string | null }
export interface UserDetail {
  user: UserRow;
  policy: Policy;
  effective: { dailyLimit: number | null; unlimited: boolean; maxActive: number; todayUsed: number; todayBonus: number; remaining: number | null };
  stats: { total: number; done: number; error: number; byFormat: Partial<FormatSplit>; byPlatform: Partial<PlatformSplit> & Record<string, number>; avgDurationS: number | null };
  keys: AdminKey[];
  recentActivity: Conversion[];
  recentErrors: Conversion[];
  audit: AuditEvent[];
}

export type CustomPolicyRow = UserRow & Partial<Policy> & { policy?: Policy };
export interface Quotas {
  global: { dailyLimit: number; maxActive: number; techMaxActive: number };
  atLimit: UserRow[];
  custom: CustomPolicyRow[];
  today: { conversions: number; users: number };
  series: { day: string; conversions: number; users: number }[];
}

export interface AuthFailures { byReason: { reason: string; count: number }[]; series: { day: string; count: number }[]; lastAt: string | null }

export type Period = "24h" | "7d" | "30d";
export interface Bucket { start: string; conversions: number; done: number; error: number; mp3: number; mp4: number; signups: number; avgDurationS: number | null }
export interface Analytics {
  period: Period;
  buckets: Bucket[];
  successByPlatform: { platform: string; done: number; error: number; rate: number | null }[];
  durationByPlatform: { platform: string; avgS: number | null; p90S: number | null }[];
  formats: FormatSplit;
  topErrors: { code: string; message: string | null; count: number }[];
  quota: { usersAtLimit: number; avgUsedPct: number | null };
  bytesServed: number | null;
  measured: string[];
  notMeasured: string[];
}

export interface SystemStatus {
  ytapi: { reachable: boolean; latencyMs: number | null; status?: Record<string, unknown> | null; error?: string | null };
  account: { uptimeS: number; version: string };
  database: { ok: boolean; latencyMs: number | null; sizeBytes: number | null; walBytes: number | null; integrity: string };
  jobs: { active: number | null; queued: number | null; capacity: number | null };
  disk: { freeBytes: number | null; floorBytes: number | null };
  versions: { ytDlp: string | null; ffmpeg: string | null; deno: string | null; ytDlpEjs: string | null };
  platforms: Record<string, unknown>;
  recentErrors: Conversion[];
}

export interface Settings {
  dailyLimit: number; maxActive: number; conversionsPaused: boolean; signupsOpen: boolean; maintenanceMessage: string | null;
  platforms: { youtube: boolean; tiktok: boolean; twitter: boolean }; shortcutUrl: string | null; techMaxActive: number;
  updatedAt: string | null; updatedBy: string | null;
}

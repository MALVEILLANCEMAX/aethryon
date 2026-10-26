// API d'administration du Control Center (docs/ADMIN.md §2 et §6), préfixe /api/admin.
// Garde unique sur /api/admin/* (401 sans session, 403 si le rôle relu en base n'est pas « admin »),
// revérifiée dans chaque route (défense en profondeur). Les mutations passent en plus par le contrôle
// d'origine + JSON de l'API publique, la limite de corps (32 Kio) et un limiteur dédié (60/min/admin).
// Requêtes SQL paramétrées ; tri par liste blanche. Chaque action sensible est inscrite au journal.
import type { Context, Hono } from "hono";
import { readFileSync, statSync } from "node:fs";
import type { Services } from "./app.ts";
import { audit, auditView, insertAudit, type AuditInput, type AuditRow } from "./audit.ts";
import { writeTx } from "./db.ts";
import { err, HttpError, Limiter, type SessionUser, type Vars } from "./http.ts";
import { log } from "./log.ts";
import { adminEligibility, countActiveAdmins } from "./roles.ts";
import {
  getSettings, MAINTENANCE_MAX, PLATFORM_NAMES, setSetting, settingsUpdated, SHORTCUT_URL_RE, type Platforms, type SettingKey,
} from "./settings.ts";
import * as stats from "./stats.ts";
import { CONTENT_ERROR_CODES } from "./status.ts";
import { nowIso } from "./time.ts";
import { USAGE_STATES, type PolicyRow } from "./usage.ts";
import type { YtapiResult } from "./ytapi.ts";

const NB = " "; // espace insécable (typographie française : avant « : », « ? », « ! », « ; »)

/** Toutes les routes de l'API d'administration (les tests vérifient que la liste est complète). */
export const ADMIN_ROUTES: readonly (readonly ["GET" | "POST" | "PUT", string])[] = [
  ["GET", "/api/admin/session"],
  ["GET", "/api/admin/securite"],
  ["GET", "/api/admin/me"],
  ["GET", "/api/admin/overview"],
  ["GET", "/api/admin/users"],
  ["GET", "/api/admin/users/:id"],
  ["POST", "/api/admin/users/:id/role"],
  ["POST", "/api/admin/users/:id/status"],
  ["PUT", "/api/admin/users/:id/quota"],
  ["POST", "/api/admin/users/:id/quota/grant"],
  ["POST", "/api/admin/users/:id/quota/reset"],
  ["GET", "/api/admin/quotas"],
  ["PUT", "/api/admin/quotas/global"],
  ["GET", "/api/admin/conversions"],
  ["GET", "/api/admin/conversions/:id"],
  ["POST", "/api/admin/conversions/:id/cancel"],
  ["GET", "/api/admin/keys"],
  ["GET", "/api/admin/keys/auth-failures"],
  ["POST", "/api/admin/keys/:id/revoke"],
  ["GET", "/api/admin/analytics"],
  ["GET", "/api/admin/system"],
  ["GET", "/api/admin/audit"],
  ["GET", "/api/admin/settings"],
  ["PUT", "/api/admin/settings"],
  ["POST", "/api/admin/settings"], // ancienne forme (page d'administration d'avant le Control Center)
];

export interface Alert { level: "info" | "warning" | "critical"; code: string; message: string; at: string }

const VERSION = (() => {
  try { return String((JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: unknown }).version ?? "inconnue"); }
  catch { return "inconnue"; }
})();

const PLATFORM_LABEL: Record<string, string> = { youtube: "YouTube", tiktok: "TikTok", twitter: "X" };
const hhmm = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
const gib = (n: number) => `${(n / 2 ** 30).toFixed(1).replace(".", ",")}${NB}Gio`;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// ---- lecture des paramètres -----------------------------------------------------------------

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

function paging(c: Context): { page: number; pageSize: number } {
  const p = c.req.query("page"), ps = c.req.query("pageSize");
  const page = p === undefined || p === "" ? 1 : Number(p);
  const pageSize = ps === undefined || ps === "" ? 25 : Number(ps);
  if (!isInt(page, 1, 1_000_000) || !isInt(pageSize, 1, 100)) {
    throw new HttpError(400, "invalid_query", `Pagination invalide${NB}: page ≥ 1 et pageSize entre 1 et 100.`);
  }
  return { page, pageSize };
}

function sorting<S extends string>(c: Context, allowed: readonly S[], def: S): { sort: S; dir: "asc" | "desc" } {
  const sort = (c.req.query("sort") || def) as S;
  const dir = c.req.query("dir") || "desc";
  if (!allowed.includes(sort)) throw new HttpError(400, "invalid_sort", `Tri impossible sur ce champ (possibles${NB}: ${allowed.join(", ")}).`);
  if (dir !== "asc" && dir !== "desc") throw new HttpError(400, "invalid_sort", "Sens de tri invalide (asc ou desc).");
  return { sort, dir };
}

function enumQuery<T extends string>(c: Context, name: string, allowed: readonly T[]): T | undefined {
  const v = c.req.query(name);
  if (v === undefined || v === "") return undefined;
  if (!allowed.includes(v as T)) throw new HttpError(400, "invalid_query", `Valeur invalide pour ${name} (possibles${NB}: ${allowed.join(", ")}).`);
  return v as T;
}

const textQuery = (c: Context, name: string, max = 100) => (c.req.query(name) ?? "").trim().slice(0, max);

function idParam(c: Context, notFound: [string, string]): string {
  const id = c.req.param("id") ?? "";
  if (!ID_RE.test(id)) throw new HttpError(404, notFound[0], notFound[1]);
  return id;
}

async function readObject(c: Context): Promise<Record<string, unknown>> {
  const b = obj(await c.req.json().catch(() => null));
  if (!b) throw new HttpError(400, "invalid_body", "Corps de requête invalide (objet JSON attendu).");
  return b;
}

function onlyFields(b: Record<string, unknown>, allowed: readonly string[]): void {
  for (const k of Object.keys(b)) {
    if (!allowed.includes(k)) throw new HttpError(400, "unknown_field", `Champ inconnu${NB}: ${k.slice(0, 40)}.`);
  }
}

/** Tri stable, valeurs nulles toujours en dernier. */
function sortRows<T extends { id: string }>(rows: T[], key: (r: T) => string | number | null, dir: "asc" | "desc"): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = key(a), y = key(b);
    if (x === null || y === null) return x === y ? a.id.localeCompare(b.id) : x === null ? 1 : -1;
    const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "fr");
    return cmp !== 0 ? sign * cmp : a.id.localeCompare(b.id);
  });
}

const pageOf = <T>(rows: T[], page: number, pageSize: number) =>
  ({ items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize });

const NOT_FOUND = {
  user: ["user_not_found", "Utilisateur introuvable."] as [string, string],
  key: ["key_not_found", "Jeton introuvable."] as [string, string],
  conversion: ["conversion_not_found", "Conversion introuvable."] as [string, string],
};

// ---- état de ytapi (API interne) ------------------------------------------------------------

function ytapiJobsOf(st: Record<string, unknown>): { active: number | null; queued: number | null; capacity: number | null } {
  const q = obj(st.queue);
  const j = obj(st.jobs) ?? obj(q?.jobs);
  const active = num(j?.running) ?? num(q?.running);
  const pending = num(q?.pending);
  const queued = num(j?.queued) ?? (pending !== null && active !== null ? Math.max(0, pending - active) : null);
  return { active, queued, capacity: num(q?.capacity) ?? num(st.capacity) };
}

function ytapiDiskOf(st: Record<string, unknown>): { freeBytes: number | null; floorBytes: number | null } {
  const d = obj(st.disk);
  const free = num(d?.free_bytes) ?? num(d?.freeBytes);
  return { freeBytes: free !== null && free >= 0 ? free : null, floorBytes: num(d?.floor_bytes) ?? num(d?.floorBytes) };
}

/** Sous-ensemble transmis au panneau (aucun secret : ni jetons, ni chemins de cookies). */
function ytapiStatusView(st: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ["status", "queue", "jobs", "platforms", "disk", "cache", "versions", "limits", "uptime_s", "started_at"]) {
    if (st[k] !== undefined) out[k] = st[k];
  }
  return out;
}

// ---- montage ---------------------------------------------------------------------------------

export function mountAdmin(app: Hono<{ Variables: Vars }>, s: Services): void {
  const { cfg, db, keys, usage, status, authorizer, ytapi } = s;
  const mutationLimiter = new Limiter(60, 60_000);
  const deniedAt = new Map<string, number>();
  let integrity: { at: number; value: string } | null = null;

  const requireAdmin = (c: Context<{ Variables: Vars }>): SessionUser => {
    const u = c.get("user");
    if (!u) throw new HttpError(401, "unauthorized", "Connecte-toi pour continuer.");
    if (u.role !== "admin") throw new HttpError(403, "forbidden", "Réservé aux administrateurs.");
    return u;
  };
  const actor = (u: SessionUser) => ({ actorId: u.id, actorLabel: u.email });
  const record = (e: AuditInput) => audit(db, e).catch((x) => { log("error", "audit write failed", { action: e.action, err: String(x) }); return ""; });

  const noteDenied = async (u: SessionUser, c: Context) => {
    const now = Date.now();
    const last = deniedAt.get(u.id);
    if (last !== undefined && now - last < 600_000) return;
    deniedAt.set(u.id, now);
    if (deniedAt.size > 10_000) for (const [k, t] of deniedAt) if (now - t >= 600_000) deniedAt.delete(k);
    await record({ ...actor(u), action: "admin.access_denied", targetType: "admin", target: c.req.path.slice(0, 200), details: { method: c.req.method }, result: "refused" });
  };

  // Garde unique.
  app.use("/api/admin/*", async (c, next) => {
    const u = c.get("user");
    const bare = c.req.path === "/api/admin/session"; // nginx auth_request : statut seul, sans corps
    if (!u) return bare ? c.body(null, 401) : err(c, 401, "unauthorized", "Connecte-toi pour continuer.");
    if (u.role !== "admin") {
      await noteDenied(u, c);
      return bare ? c.body(null, 403) : err(c, 403, "forbidden", "Réservé aux administrateurs.");
    }
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && !mutationLimiter.take(u.id)) {
      return err(c, 429, "rate_limited", `Trop d'actions d'administration en une minute${NB}: réessaie dans un instant.`);
    }
    await next();
  });

  const userExists = (id: string) => db.prepare('SELECT id, email, role, status FROM "user" WHERE id = ?').get(id) as
    { id: string; email: string; role: string | null; status: string | null } | undefined;
  const userRow = (id: string) => stats.userRows(db, usage, { id })[0] ?? null;
  const policyView = (p: PolicyRow | null) => ({
    dailyLimit: p?.daily_limit ?? null, unlimited: Number(p?.unlimited ?? 0) === 1, maxActive: p?.max_active ?? null, resetAt: p?.reset_at ?? null,
  });
  const effectiveOf = (id: string) => {
    const p = usage.policyFor(id);
    const used = usage.usedToday(id, undefined, p.resetAt);
    return {
      dailyLimit: p.unlimited ? null : p.dailyLimit, unlimited: p.unlimited, maxActive: p.maxActive,
      todayUsed: used, todayBonus: p.todayBonus, remaining: p.unlimited ? null : Math.max(0, p.dailyLimit - used),
    };
  };

  const dbIntegrity = (): string => {
    if (integrity && Date.now() - integrity.at < 60_000) return integrity.value;
    let value: string;
    try {
      const rows = db.prepare("PRAGMA quick_check").all() as Record<string, unknown>[];
      const msgs = rows.map((r) => String(Object.values(r)[0] ?? ""));
      value = msgs.length === 1 && msgs[0] === "ok" ? "ok" : msgs.slice(0, 3).join(`${NB}; `).slice(0, 300) || "inconnue";
    } catch (e) {
      value = `contrôle impossible${NB}: ${String((e as Error).message ?? e).slice(0, 200)}`;
    }
    integrity = { at: Date.now(), value };
    return value;
  };

  const alertsFor = (yt: YtapiResult<Record<string, unknown>>): Alert[] => {
    const now = nowIso();
    const out: Alert[] = [];
    const st = getSettings(db);
    if (!yt.ok && yt.unconfigured) {
      out.push({ level: "warning", code: "ytapi_internal_unconfigured", message: `API interne de ytapi non configurée (YTAPI_INTERNAL_URL doit être une adresse http:// du réseau interne)${NB}: supervision et annulation indisponibles.`, at: now });
    } else if (!yt.ok) {
      out.push({ level: "critical", code: "ytapi_unreachable", message: `Le service de conversion (ytapi) ne répond pas à account${NB}: ${yt.error}.`, at: now });
    } else {
      for (const [name, raw] of Object.entries(obj(yt.body.platforms) ?? {})) {
        const p = obj(raw);
        if (!p) continue;
        const state = str(p.state);
        const until = str(p.cooldown_until);
        const label = PLATFORM_LABEL[name] ?? name;
        const pause = until && !Number.isNaN(Date.parse(until)) ? ` (pause automatique jusqu'à ${hhmm.format(new Date(until))})` : "";
        const at = str(p.since) ?? str(p.last_error_at) ?? now;
        if (state === "bot_check") {
          out.push({ level: "warning", code: "platform_bot_check", message: `${label}${NB}: contrôle anti-robot, la plateforme bloque le serveur${pause}.`, at });
        } else if (until || state === "upstream_rate_limited") {
          out.push({ level: "warning", code: "platform_cooldown", message: `${label}${NB}: la plateforme limite le serveur${pause}.`, at });
        }
      }
      const disk = ytapiDiskOf(yt.body);
      if (disk.freeBytes !== null && disk.floorBytes !== null && disk.floorBytes > 0) {
        if (disk.freeBytes < disk.floorBytes) {
          out.push({ level: "critical", code: "disk_full", message: `Disque de ytapi saturé${NB}: ${gib(disk.freeBytes)} libres, sous le plancher de ${gib(disk.floorBytes)}.`, at: now });
        } else if (disk.freeBytes < 2 * disk.floorBytes) {
          out.push({ level: "warning", code: "disk_low", message: `Disque de ytapi bientôt plein${NB}: ${gib(disk.freeBytes)} libres (plancher ${gib(disk.floorBytes)}).`, at: now });
        }
      }
    }
    const ratio = usage.errorRatioLastHour(CONTENT_ERROR_CODES);
    if (ratio !== null && ratio > 0.5) {
      out.push({ level: "warning", code: "error_ratio", message: `${Math.round(ratio * 100)}${NB}% des conversions de la dernière heure ont échoué (erreurs du service, hors erreurs de contenu).`, at: now });
    }
    if (st.conversionsPaused) out.push({ level: "info", code: "conversions_paused", message: "Les conversions sont suspendues.", at: now });
    const off = PLATFORM_NAMES.filter((p) => !st.platforms[p]);
    if (off.length) out.push({ level: "info", code: "platform_disabled", message: `Plateformes désactivées${NB}: ${off.map((p) => PLATFORM_LABEL[p]).join(", ")}.`, at: now });
    const fails = authorizer.recentAuthFailures();
    if (fails > 50) out.push({ level: "warning", code: "auth_failures", message: `${fails} refus d'authentification de jetons sur la dernière heure.`, at: now });
    const integ = dbIntegrity();
    if (integ !== "ok") out.push({ level: "critical", code: "db_integrity", message: `Contrôle d'intégrité de la base en échec${NB}: ${integ}`, at: now });
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    return out.sort((a, b) => rank[a.level] - rank[b.level]);
  };

  // ---- session, profil, vue d'ensemble -------------------------------------------------------

  app.get("/api/admin/session", (c) => { requireAdmin(c); return c.body(null, 204); });

  // Section « Sécurité » (antibot.ts, migration 016) : compteurs réels par jour, événements suspects récents (sujet
  // haché, IP tronquée), état de l'interrupteur et de Cap. Rien d'inventé : un compteur jamais incrémenté vaut 0.
  app.get("/api/admin/securite", async (c) => {
    requireAdmin(c);
    const [report, cap] = await Promise.all([s.antibot.report(), s.antibot.capHealth()]);
    return c.json({ ...report, cap });
  });

  app.get("/api/admin/me", (c) => {
    const u = requireAdmin(c);
    return c.json({ id: u.id, email: u.email, name: u.name, role: u.role });
  });

  app.get("/api/admin/overview", async (c) => {
    requireAdmin(c);
    const o = stats.overviewStats(db, usage);
    const yt = await ytapi.status(5_000);
    const fromYt = yt.ok ? ytapiJobsOf(yt.body) : null;
    const jobs = fromYt && fromYt.active !== null && fromYt.queued !== null ? { active: fromYt.active, queued: fromYt.queued } : o.localJobs;
    return c.json({ users: o.users, conversions: o.conversions, jobs, alerts: alertsFor(yt) });
  });

  // ---- utilisateurs --------------------------------------------------------------------------

  app.get("/api/admin/users", (c) => {
    requireAdmin(c);
    const { page, pageSize } = paging(c);
    const { sort, dir } = sorting(c, ["createdAt", "lastActiveAt", "email", "conversions"] as const, "createdAt");
    const rows = stats.userRows(db, usage, {
      q: textQuery(c, "q"), role: enumQuery(c, "role", ["user", "admin"] as const), status: enumQuery(c, "status", ["active", "suspended"] as const),
    });
    const key = (r: stats.UserRow): string | number | null =>
      sort === "email" ? r.email : sort === "conversions" ? r.conversions30d * 1e9 + r.conversionsTotal : sort === "lastActiveAt" ? r.lastActiveAt : r.createdAt;
    return c.json(pageOf(sortRows(rows, key, dir), page, pageSize));
  });

  const auditFor = (id: string, limit: number) => (db.prepare(
    "SELECT * FROM ytc_admin_event WHERE target = ? OR (json_valid(details) AND json_extract(details, '$.userId') = ?) ORDER BY created_at DESC, id DESC LIMIT ?",
  ).all(id, id, limit) as unknown as AuditRow[]).map(auditView);

  app.get("/api/admin/users/:id", (c) => {
    requireAdmin(c);
    const id = idParam(c, NOT_FOUND.user);
    const user = userRow(id);
    if (!user) throw new HttpError(404, ...NOT_FOUND.user);
    return c.json({
      user,
      policy: policyView(usage.policyRow(id)),
      effective: effectiveOf(id),
      stats: stats.userConversionStats(db, id),
      keys: sortRows(stats.adminKeys(db, { userId: id }), (k) => k.createdAt, "desc"),
      recentActivity: stats.recentConversions(db, { userId: id, limit: 20 }),
      recentErrors: stats.recentConversions(db, { userId: id, state: "error", limit: 10 }),
      audit: auditFor(id, 20),
    });
  });

  app.post("/api/admin/users/:id/role", async (c) => {
    const a = requireAdmin(c);
    const id = idParam(c, NOT_FOUND.user);
    const b = await readObject(c);
    onlyFields(b, ["role"]);
    const role = b.role;
    if (role !== "user" && role !== "admin") throw new HttpError(400, "invalid_role", "Rôle invalide (user ou admin).");
    const target = userExists(id);
    if (!target) throw new HttpError(404, ...NOT_FOUND.user);
    const before = target.role ?? "user";
    if (before === role) return c.json({ ok: true, changed: false, user: userRow(id) });
    const refuse = async (status: number, code: string, message: string) => {
      await record({ ...actor(a), action: "user.role", targetType: "user", target: id, details: { before: { role: before }, requested: { role }, reason: code }, result: "refused" });
      return new HttpError(status, code, message);
    };
    if (role === "user" && id === a.id) throw await refuse(400, "self_action", "Tu ne peux pas retirer ton propre rôle d'administrateur.");
    // L'amorçage (ADMIN_EMAILS) re-promouvrait cette adresse à sa prochaine connexion : refus explicite.
    if (role === "user" && cfg.adminEmails.has(String(target.email ?? "").toLowerCase())) {
      throw await refuse(409, "admin_email_configured", `Cette adresse figure dans ADMIN_EMAILS (configuration du serveur)${NB}: elle redeviendrait administratrice à sa prochaine connexion. Retire-la d'abord de la configuration.`);
    }
    if (role === "admin") {
      const e = adminEligibility(db, id);
      if (!e.ok) throw await refuse(409, e.reason === "user_suspended" ? "user_suspended" : "not_eligible", e.message);
    }
    const done = await writeTx(db, () => {
      if (role === "user" && countActiveAdmins(db, id) === 0) return false;
      db.prepare('UPDATE "user" SET role = ? WHERE id = ?').run(role, id);
      insertAudit(db, { ...actor(a), action: "user.role", targetType: "user", target: id, details: { before: { role: before }, after: { role } } });
      return true;
    });
    if (!done) throw await refuse(409, "last_admin", "Impossible de retirer le dernier administrateur actif.");
    log("info", "admin action", { action: "user.role", actor: a.id, target: id, role });
    return c.json({ ok: true, changed: true, user: userRow(id) });
  });

  app.post("/api/admin/users/:id/status", async (c) => {
    const a = requireAdmin(c);
    const id = idParam(c, NOT_FOUND.user);
    const b = await readObject(c);
    onlyFields(b, ["status"]);
    const next = b.status;
    if (next !== "active" && next !== "suspended") throw new HttpError(400, "invalid_status", "État invalide (active ou suspended).");
    const target = userExists(id);
    if (!target) throw new HttpError(404, ...NOT_FOUND.user);
    const before = target.status ?? "active";
    const action = next === "suspended" ? "user.suspend" : "user.reactivate";
    const refuse = async (status: number, code: string, message: string) => {
      await record({ ...actor(a), action, targetType: "user", target: id, details: { before: { status: before }, requested: { status: next }, reason: code }, result: "refused" });
      return new HttpError(status, code, message);
    };
    if (id === a.id) throw await refuse(400, "self_action", "Tu ne peux pas suspendre ni réactiver ton propre compte.");
    if (before === next) return c.json({ ok: true, changed: false, status: next, user: userRow(id) });
    const done = await writeTx(db, () => {
      if (next === "suspended" && target.role === "admin" && countActiveAdmins(db, id) === 0) return false;
      db.prepare('UPDATE "user" SET status = ? WHERE id = ?').run(next, id);
      // Suspension : sessions supprimées tout de suite ; les jetons sont refusés à l'appel suivant (état relu).
      const sessions = next === "suspended" ? Number(db.prepare('DELETE FROM session WHERE "userId" = ?').run(id).changes) : 0;
      insertAudit(db, { ...actor(a), action, targetType: "user", target: id, details: { before: { status: before }, after: { status: next }, sessionsDeleted: sessions } });
      return true;
    });
    if (!done) throw await refuse(409, "last_admin", "Impossible de suspendre le dernier administrateur actif.");
    log("info", "admin action", { action, actor: a.id, target: id });
    return c.json({ ok: true, changed: true, status: next, user: userRow(id) });
  });

  // ---- quotas --------------------------------------------------------------------------------

  app.put("/api/admin/users/:id/quota", async (c) => {
    const a = requireAdmin(c);
    const id = idParam(c, NOT_FOUND.user);
    const b = await readObject(c);
    onlyFields(b, ["dailyLimit", "unlimited", "maxActive"]);
    if (!userExists(id)) throw new HttpError(404, ...NOT_FOUND.user);
    const cur = policyView(usage.policyRow(id));
    const tech = cfg.techMaxActive;
    if (b.dailyLimit !== undefined && b.dailyLimit !== null && !isInt(b.dailyLimit, 0, 10_000)) {
      throw new HttpError(400, "invalid_daily_limit", "Quota quotidien invalide (entier entre 0 et 10 000, ou null pour le quota global).");
    }
    if (b.unlimited !== undefined && typeof b.unlimited !== "boolean") throw new HttpError(400, "invalid_unlimited", `«${NB}unlimited${NB}» doit valoir true ou false.`);
    if (b.maxActive !== undefined && b.maxActive !== null && !isInt(b.maxActive, 1, tech)) {
      throw new HttpError(400, "invalid_max_active", `Concurrence invalide (entier entre 1 et ${tech}, ou null pour la valeur globale).`);
    }
    const v = {
      dailyLimit: b.dailyLimit === undefined ? cur.dailyLimit : (b.dailyLimit as number | null),
      unlimited: b.unlimited === undefined ? cur.unlimited : (b.unlimited as boolean),
      maxActive: b.maxActive === undefined ? cur.maxActive : (b.maxActive as number | null),
    };
    await writeTx(db, () => {
      const r = usage.setPolicySync(id, v, a.id);
      insertAudit(db, { ...actor(a), action: "quota.update", targetType: "quota", target: id, details: { before: policyView(r.before), after: policyView(r.after) } });
    });
    log("info", "admin action", { action: "quota.update", actor: a.id, target: id });
    return c.json({ policy: policyView(usage.policyRow(id)), effective: effectiveOf(id) });
  });

  app.post("/api/admin/users/:id/quota/grant", async (c) => {
    const a = requireAdmin(c);
    const id = idParam(c, NOT_FOUND.user);
    const b = await readObject(c);
    onlyFields(b, ["amount", "reason"]);
    if (!userExists(id)) throw new HttpError(404, ...NOT_FOUND.user);
    if (!isInt(b.amount, 1, 1000)) throw new HttpError(400, "invalid_amount", "Bonus invalide (entier entre 1 et 1000).");
    let reason: string | null = null;
    if (b.reason !== undefined && b.reason !== null) {
      if (typeof b.reason !== "string") throw new HttpError(400, "invalid_reason", "Motif invalide (texte de 140 caractères au plus).");
      reason = b.reason.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim() || null;
      if (reason && Array.from(reason).length > 140) throw new HttpError(400, "invalid_reason", "Motif invalide (texte de 140 caractères au plus).");
    }
    const grant = await writeTx(db, () => {
      const before = usage.policyFor(id).todayBonus;
      const g = usage.grantSync(id, b.amount as number, reason, a.id);
      insertAudit(db, { ...actor(a), action: "quota.grant", targetType: "quota", target: id, details: { day: g.day, amount: g.amount, reason, before: { todayBonus: before }, after: { todayBonus: before + g.amount } } });
      return g;
    });
    log("info", "admin action", { action: "quota.grant", actor: a.id, target: id, amount: grant.amount });
    return c.json({ grant, effective: effectiveOf(id) }, 201);
  });

  app.post("/api/admin/users/:id/quota/reset", async (c) => {
    const a = requireAdmin(c);
    const id = idParam(c, NOT_FOUND.user);
    if (!userExists(id)) throw new HttpError(404, ...NOT_FOUND.user);
    await writeTx(db, () => {
      const r = usage.resetTodaySync(id, a.id);
      insertAudit(db, { ...actor(a), action: "quota.reset", targetType: "quota", target: id, details: { before: { todayUsed: r.before }, after: { todayUsed: 0 }, resetAt: r.resetAt } });
    });
    log("info", "admin action", { action: "quota.reset", actor: a.id, target: id });
    return c.json({ effective: effectiveOf(id) });
  });

  app.get("/api/admin/quotas", (c) => {
    requireAdmin(c);
    return c.json(stats.quotasStats(db, cfg, usage));
  });

  app.put("/api/admin/quotas/global", async (c) => {
    const a = requireAdmin(c);
    const b = await readObject(c);
    onlyFields(b, ["dailyLimit", "maxActive"]);
    const changes = validateSettings(b);
    const out = await applySettings(a, changes, "quota.global");
    return c.json({ global: { dailyLimit: out.dailyLimit, maxActive: out.maxActive, techMaxActive: cfg.techMaxActive } });
  });

  // ---- conversions ---------------------------------------------------------------------------

  app.get("/api/admin/conversions", (c) => {
    requireAdmin(c);
    const { page, pageSize } = paging(c);
    const { sort, dir } = sorting(c, ["createdAt", "durationS"] as const, "createdAt");
    const where: string[] = [];
    const args: (string | number)[] = [];
    const state = enumQuery(c, "state", USAGE_STATES);
    if (state) { where.push("x.state = ?"); args.push(state); }
    const platform = enumQuery(c, "platform", stats.PLATFORM_BUCKETS);
    if (platform === "twitter") where.push("x.platform IN ('twitter', 'x')");
    else if (platform === "other") where.push("(x.platform IS NULL OR x.platform NOT IN ('youtube', 'tiktok', 'twitter', 'x'))");
    else if (platform) { where.push("x.platform = ?"); args.push(platform); }
    const fmt = enumQuery(c, "fmt", ["mp3", "mp4"] as const);
    if (fmt) { where.push("x.fmt = ?"); args.push(fmt); }
    const userId = textQuery(c, "userId", 64);
    if (userId) { where.push("x.user_id = ?"); args.push(userId); }
    const q = textQuery(c, "q");
    if (q) {
      where.push("(u.email LIKE ? ESCAPE '\\' OR x.id = ? OR x.job_id = ?)");
      args.push(`%${q.replace(/[\\%_]/g, (m) => "\\" + m)}%`, q, q);
    }
    const w = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const expr = sort === "durationS" ? "(julianday(x.finished_at) - julianday(x.created_at))" : "x.created_at";
    const d = dir === "asc" ? "ASC" : "DESC";
    const total = Number((db.prepare(`SELECT count(*) AS n FROM ytc_usage x LEFT JOIN "user" u ON u.id = x.user_id${w}`).get(...args) as { n: number }).n);
    const rows = db.prepare(`${stats.CONVERSION_SELECT}${w} ORDER BY ${expr} IS NULL, ${expr} ${d}, x.id ${d} LIMIT ? OFFSET ?`)
      .all(...args, pageSize, (page - 1) * pageSize) as unknown as stats.UsageRow[];
    return c.json({ items: rows.map(stats.conversionView), total, page, pageSize });
  });

  const conversionRow = (id: string) =>
    db.prepare(`${stats.CONVERSION_SELECT} WHERE x.id = ?`).get(id) as unknown as stats.UsageRow | undefined;

  app.get("/api/admin/conversions/:id", async (c) => {
    requireAdmin(c);
    const id = idParam(c, NOT_FOUND.conversion);
    const r = conversionRow(id);
    if (!r) throw new HttpError(404, ...NOT_FOUND.conversion);
    const key = r.key_id ? db.prepare("SELECT name FROM apikey WHERE id = ?").get(r.key_id) as { name: string | null } | undefined : undefined;
    const out: Record<string, unknown> = { ...stats.conversionView(r), cause: r.cause, keyName: key?.name ?? null };
    if (r.state === "reserved" || r.state === "running") {
      const jobs = await ytapi.jobs();
      if (jobs.ok) {
        const j = jobs.body.find((x) => (r.job_id && x.jobId === r.job_id) || x.usageId === r.id);
        if (j) out.live = { stage: j.stage, progress: j.progress };
      }
    }
    return c.json(out);
  });

  app.post("/api/admin/conversions/:id/cancel", async (c) => {
    const a = requireAdmin(c);
    const id = idParam(c, NOT_FOUND.conversion);
    const r = conversionRow(id);
    if (!r) throw new HttpError(404, ...NOT_FOUND.conversion);
    // Une conversion encore en file n'a pas reçu son job_id (envoyé au passage à « running ») :
    // on le demande à ytapi, qui connaît le job par l'identifiant d'usage.
    let jobId = r.job_id;
    if (!jobId && (r.state === "reserved" || r.state === "running")) {
      const live = await ytapi.jobs();
      if (live.ok) jobId = live.body.find((x) => x.usageId === r.id)?.jobId ?? null;
    }
    const base = { ...actor(a), action: "conversion.cancel", targetType: "job" as const, target: jobId ?? id };
    const details = { usageId: r.id, userId: r.user_id, state: r.state };
    if ((r.state !== "reserved" && r.state !== "running") || !jobId) {
      await record({ ...base, details: { ...details, reason: "not_cancellable" }, result: "refused" });
      throw new HttpError(409, "not_cancellable", "Seule une conversion en attente ou en cours, dont le job ytapi est connu, peut être annulée.");
    }
    const res = await ytapi.cancel(jobId);
    if (!res.ok) {
      if (res.status === 404 || res.status === 409) {
        await record({ ...base, details: { ...details, reason: "ytapi_refused", ytapi: res.error }, result: "refused" });
        throw new HttpError(409, "not_cancellable", "ytapi ne peut plus annuler ce job (déjà terminé ou inconnu).");
      }
      await record({ ...base, details: { ...details, reason: "ytapi_unreachable", ytapi: res.error }, result: "error" });
      throw new HttpError(502, "ytapi_unreachable", `ytapi n'a pas pu être joint pour annuler le job${NB}: ${res.error}.`);
    }
    await record({ ...base, details });
    log("info", "admin action", { action: "conversion.cancel", actor: a.id, usage: r.id, job: jobId });
    // L'état local passera à « cancelled » à réception de l'événement d'usage envoyé par ytapi.
    return c.json({ ok: true, id: r.id, jobId, state: r.state });
  });

  // ---- jetons --------------------------------------------------------------------------------

  app.get("/api/admin/keys", (c) => {
    requireAdmin(c);
    const { page, pageSize } = paging(c);
    const { sort, dir } = sorting(c, ["createdAt", "lastUsedAt"] as const, "createdAt");
    const state = enumQuery(c, "state", ["active", "revoked", "expired"] as const);
    const kind = enumQuery(c, "kind", ["shortcut", "extension", "discord", "premiere", "desktop"] as const);
    const rows = stats.adminKeys(db, { userId: textQuery(c, "userId", 64) || undefined, q: textQuery(c, "q") || undefined, kind })
      .filter((k) => !state || k.state === state);
    return c.json(pageOf(sortRows(rows, (k) => (sort === "lastUsedAt" ? k.lastUsedAt : k.createdAt), dir), page, pageSize));
  });

  app.get("/api/admin/keys/auth-failures", (c) => {
    requireAdmin(c);
    const raw = c.req.query("days");
    const days = raw === undefined || raw === "" ? 7 : Number(raw);
    if (!isInt(days, 1, 90)) throw new HttpError(400, "invalid_query", "Nombre de jours invalide (entre 1 et 90).");
    const list = stats.lastParisDays(days);
    const from = list[0]!;
    const byReason = (db.prepare("SELECT reason, sum(count) AS n FROM ytc_auth_failure WHERE day >= ? GROUP BY reason ORDER BY n DESC, reason").all(from) as
      { reason: string; n: number }[]).map((r) => ({ reason: r.reason, count: Number(r.n) }));
    const perDay = new Map((db.prepare("SELECT day, sum(count) AS n FROM ytc_auth_failure WHERE day >= ? GROUP BY day").all(from) as
      { day: string; n: number }[]).map((r) => [r.day, Number(r.n)]));
    const last = db.prepare("SELECT max(last_at) AS t FROM ytc_auth_failure WHERE day >= ?").get(from) as { t: string | null };
    return c.json({ byReason, series: list.map((day) => ({ day, count: perDay.get(day) ?? 0 })), lastAt: last.t ?? null });
  });

  app.post("/api/admin/keys/:id/revoke", async (c) => {
    const a = requireAdmin(c);
    const id = idParam(c, NOT_FOUND.key);
    const k = stats.adminKeys(db, { keyId: id })[0];
    if (!k) throw new HttpError(404, ...NOT_FOUND.key);
    await keys.revoke(k.userId, id, "admin");
    await record({
      ...actor(a), action: "key.revoke", targetType: "key", target: id,
      details: { userId: k.userId, name: k.name, start: k.start, before: { state: k.state }, after: { state: "revoked" } },
    });
    log("info", "admin action", { action: "key.revoke", actor: a.id, keyRef: id });
    return c.json({ key: stats.adminKeys(db, { keyId: id })[0] });
  });

  // ---- analyses, système, journal ------------------------------------------------------------

  app.get("/api/admin/analytics", (c) => {
    requireAdmin(c);
    const period = enumQuery(c, "period", ["24h", "7d", "30d"] as const) ?? "7d";
    return c.json(stats.analytics(db, usage, period));
  });

  app.get("/api/admin/system", async (c) => {
    requireAdmin(c);
    const t0 = performance.now();
    db.prepare("SELECT 1").get();
    const latencyMs = Math.round((performance.now() - t0) * 100) / 100;
    const size = (p: string) => { try { return statSync(p).size; } catch { return 0; } };
    const integ = dbIntegrity();
    const yt = await ytapi.status();
    const st = getSettings(db);
    const body = yt.ok ? yt.body : {};
    const versions = obj(body.versions) ?? {};
    const ytPlatforms = obj(body.platforms) ?? {};
    const platforms = Object.fromEntries(PLATFORM_NAMES.map((p) => {
      const x = obj(ytPlatforms[p]);
      return [p, {
        enabled: st.platforms[p], state: str(x?.state), since: str(x?.since), lastSuccess: str(x?.last_success),
        lastError: str(x?.last_error), lastErrorAt: str(x?.last_error_at), cooldownUntil: str(x?.cooldown_until),
      }];
    }));
    return c.json({
      ytapi: yt.ok
        ? { reachable: true, latencyMs: yt.latencyMs, status: ytapiStatusView(yt.body) }
        : { reachable: false, latencyMs: yt.latencyMs, error: yt.error },
      account: { uptimeS: Math.round(process.uptime()), version: VERSION },
      database: { ok: integ === "ok", latencyMs, sizeBytes: size(cfg.dbPath), walBytes: size(`${cfg.dbPath}-wal`), integrity: integ },
      jobs: yt.ok ? ytapiJobsOf(yt.body) : { active: null, queued: null, capacity: null },
      disk: yt.ok ? ytapiDiskOf(yt.body) : { freeBytes: null, floorBytes: null },
      versions: { ytDlp: str(versions.yt_dlp), ffmpeg: str(versions.ffmpeg), deno: str(versions.deno), ytDlpEjs: str(versions.yt_dlp_ejs) },
      platforms,
      recentErrors: stats.recentConversions(db, { state: "error", limit: 10 }),
    });
  });

  app.get("/api/admin/audit", (c) => {
    requireAdmin(c);
    const { page, pageSize } = paging(c);
    const where: string[] = [];
    const args: (string | number)[] = [];
    const action = textQuery(c, "action", 64);
    if (action) { where.push("(action = ? OR action LIKE ? ESCAPE '\\')"); args.push(action, `${action.replace(/[\\%_]/g, (m) => "\\" + m)}.%`); }
    const actorQ = textQuery(c, "actor", 320);
    if (actorQ) { where.push("(actor_user_id = ? OR actor_label LIKE ? ESCAPE '\\')"); args.push(actorQ, `%${actorQ.replace(/[\\%_]/g, (m) => "\\" + m)}%`); }
    const result = enumQuery(c, "result", ["ok", "refused", "error"] as const);
    if (result) { where.push("result = ?"); args.push(result); }
    const target = textQuery(c, "target", 200);
    if (target) { where.push("(target = ? OR target_type = ?)"); args.push(target, target); }
    const w = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const total = Number((db.prepare(`SELECT count(*) AS n FROM ytc_admin_event${w}`).get(...args) as { n: number }).n);
    const rows = db.prepare(`SELECT * FROM ytc_admin_event${w} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...args, pageSize, (page - 1) * pageSize) as unknown as AuditRow[];
    return c.json({ items: rows.map(auditView), total, page, pageSize });
  });

  // ---- réglages ------------------------------------------------------------------------------

  const settingsView = () => {
    const st = getSettings(db);
    const upd = settingsUpdated(db);
    const by = upd.updatedBy
      ? ((db.prepare('SELECT email FROM "user" WHERE id = ?').get(upd.updatedBy) as { email: string } | undefined)?.email ?? upd.updatedBy)
      : null;
    return {
      dailyLimit: st.dailyLimit ?? cfg.dailyConversions,
      maxActive: st.maxActive ?? cfg.maxActiveJobs,
      conversionsPaused: st.conversionsPaused,
      signupsOpen: st.signupsOpen,
      maintenanceMessage: st.maintenanceMessage,
      platforms: st.platforms,
      shortcutUrl: st.shortcutUrl ?? cfg.icloudShortcutUrl,
      techMaxActive: cfg.techMaxActive,
      updatedAt: upd.updatedAt,
      updatedBy: by,
    };
  };

  type Change = { key: SettingKey; field: string; stored: string; value: unknown };

  /** Validation stricte des champs de réglage présents ; renvoie les écritures à faire. */
  function validateSettings(b: Record<string, unknown>): Change[] {
    const out: Change[] = [];
    if (b.dailyLimit !== undefined) {
      if (b.dailyLimit !== null && !isInt(b.dailyLimit, 0, 10_000)) throw new HttpError(400, "invalid_limit", "Limite invalide (entier entre 0 et 10 000).");
      out.push({ key: "daily_limit", field: "dailyLimit", stored: b.dailyLimit === null ? "" : String(b.dailyLimit), value: b.dailyLimit });
    }
    if (b.maxActive !== undefined) {
      if (b.maxActive !== null && !isInt(b.maxActive, 1, cfg.techMaxActive)) {
        throw new HttpError(400, "invalid_max_active", `Concurrence invalide (entier entre 1 et ${cfg.techMaxActive}).`);
      }
      out.push({ key: "max_active", field: "maxActive", stored: b.maxActive === null ? "" : String(b.maxActive), value: b.maxActive });
    }
    for (const [field, key] of [["conversionsPaused", "conversions_paused"], ["signupsOpen", "signups_open"]] as const) {
      if (b[field] === undefined) continue;
      if (typeof b[field] !== "boolean") throw new HttpError(400, "invalid_value", `«${NB}${field}${NB}» doit valoir true ou false.`);
      out.push({ key, field, stored: String(b[field]), value: b[field] });
    }
    if (b.maintenanceMessage !== undefined) {
      const m = b.maintenanceMessage;
      if (m !== null && typeof m !== "string") throw new HttpError(400, "invalid_message", "Message de maintenance invalide (texte ou null).");
      const text = m === null ? "" : m.replace(/\r\n?/g, "\n").trim();
      if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(text)) throw new HttpError(400, "invalid_message", "Le message de maintenance contient des caractères de contrôle.");
      if (Array.from(text).length > MAINTENANCE_MAX) throw new HttpError(400, "invalid_message", `Message de maintenance trop long (${MAINTENANCE_MAX} caractères au plus).`);
      out.push({ key: "maintenance_message", field: "maintenanceMessage", stored: text, value: text || null });
    }
    if (b.platforms !== undefined) {
      const p = obj(b.platforms);
      if (!p) throw new HttpError(400, "invalid_platforms", "Plateformes invalides (objet { youtube, tiktok, twitter } de booléens).");
      const next: Platforms = { ...getSettings(db).platforms };
      for (const [k, v] of Object.entries(p)) {
        if (!(PLATFORM_NAMES as readonly string[]).includes(k) || typeof v !== "boolean") {
          throw new HttpError(400, "invalid_platforms", "Plateformes invalides (objet { youtube, tiktok, twitter } de booléens).");
        }
        next[k as keyof Platforms] = v;
      }
      out.push({ key: "platforms", field: "platforms", stored: JSON.stringify(next), value: next });
    }
    if (b.shortcutUrl !== undefined) {
      const u = b.shortcutUrl;
      const text = typeof u === "string" ? u.trim() : u;
      if (text !== null && (typeof text !== "string" || !SHORTCUT_URL_RE.test(text))) {
        throw new HttpError(400, "invalid_shortcut_url", `Lien iCloud invalide${NB}: il doit être de la forme https://www.icloud.com/shortcuts/ suivi de 32 caractères hexadécimaux.`);
      }
      out.push({ key: "shortcut_url", field: "shortcutUrl", stored: text ?? "", value: text });
    }
    return out;
  }

  async function applySettings(a: SessionUser, changes: Change[], action: string) {
    if (!changes.length) return settingsView();
    const before = settingsView() as Record<string, unknown>;
    await writeTx(db, () => {
      for (const ch of changes) setSetting(db, ch.key, ch.stored, a.id);
      const after = settingsView() as Record<string, unknown>;
      insertAudit(db, {
        ...actor(a), action, targetType: "setting", target: changes.map((ch) => ch.field).join(",").slice(0, 200),
        details: {
          before: Object.fromEntries(changes.map((ch) => [ch.field, before[ch.field]])),
          after: Object.fromEntries(changes.map((ch) => [ch.field, after[ch.field]])),
        },
      });
    });
    status.invalidate();
    log("info", "admin action", { action, actor: a.id, fields: changes.map((ch) => ch.field) });
    return settingsView();
  }

  app.get("/api/admin/settings", (c) => { requireAdmin(c); return c.json(settingsView()); });

  const putSettings = async (c: Context<{ Variables: Vars }>) => {
    const a = requireAdmin(c);
    const b = await readObject(c);
    onlyFields(b, ["dailyLimit", "maxActive", "conversionsPaused", "signupsOpen", "maintenanceMessage", "platforms", "shortcutUrl"]);
    return c.json(await applySettings(a, validateSettings(b), "settings.update"));
  };
  app.put("/api/admin/settings", putSettings);
  app.post("/api/admin/settings", putSettings);
}


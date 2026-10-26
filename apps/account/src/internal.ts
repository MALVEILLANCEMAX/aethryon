// API interne (port séparé, réseau Docker interne uniquement) appelée par ytapi.
// Chaque requête doit porter X-Internal-Token ; la comparaison se fait à temps constant.
import { Hono } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Auth } from "./auth.ts";
import { ipInCidr, type Config } from "./config.ts";
import { writeTx, type DB } from "./db.ts";
import { getSettings, normalizePlatform } from "./settings.ts";
import { nowIso, parisDay } from "./time.ts";
import { sanitizeCause, UNLIMITED_DAILY, USAGE_STATES, type Policy, type UsageService, type UsageState } from "./usage.ts";
import { log } from "./log.ts";
import { mountCloudInternal } from "./cloud/routes.ts";
import type { CloudService } from "./cloud/service.ts";

const digest = (v: string) => createHash("sha256").update(v).digest();

export type RefusalReason =
  | "invalid_key" | "expired" | "user_suspended" | "quota_exceeded" | "paused" | "format_not_allowed" | "platform_disabled";

export type Decision =
  | { allow: false; reason: RefusalReason; message: string; retry_after_s?: number }
  | { allow: true; user_id: string; key_id: string; key_name: string; key_kind: string; limits: { daily: number; max_active: number }; remaining_today: number; usage_id?: string };

const REFUSAL_TEXT: Record<RefusalReason, string> = {
  invalid_key: "Jeton absent ou invalide. Génère une nouvelle clé depuis ton espace personnel.",
  expired: "Ce jeton a expiré. Génère une nouvelle clé depuis ton espace personnel.",
  user_suspended: "Ce compte est suspendu.",
  quota_exceeded: "Tu as atteint ta limite de conversions pour aujourd'hui. Elle se réinitialise à minuit (heure de Paris).",
  paused: "Les conversions sont temporairement suspendues.",
  format_not_allowed: "Format non disponible : choisis MP3 ou MP4.",
  platform_disabled: "Cette plateforme est temporairement désactivée.",
};

/** Refus comptés comme « échecs d'authentification » pour l'alerte de la dernière heure. */
const AUTH_FAILURE_REASONS: ReadonlySet<RefusalReason> = new Set(["invalid_key", "expired", "user_suspended"]);
const LAST_USED_EVERY_MS = 60_000;

const refusal = (reason: RefusalReason, extra: { retry_after_s?: number } = {}): Decision =>
  ({ allow: false, reason, message: REFUSAL_TEXT[reason], ...extra });

/** Limites annoncées à ytapi : « illimité » = UNLIMITED_DAILY (ytapi ne décide que sur max_active). */
const limitsOf = (p: Policy) => ({ daily: p.unlimited ? UNLIMITED_DAILY : p.dailyLimit, max_active: p.maxActive });

export class Authorizer {
  private cfg: Config;
  private db: DB;
  private auth: Auth;
  private usage: UsageService;
  private authFailures: number[] = [];                 // instants des refus d'authentification (1 h, en mémoire)
  private lastUsedWrite = new Map<string, number>();   // dernière écriture de last_used_at par jeton
  constructor(cfg: Config, db: DB, auth: Auth, usage: UsageService) { this.cfg = cfg; this.db = db; this.auth = auth; this.usage = usage; }

  async authorize(body: unknown): Promise<Decision | { badRequest: string }> {
    const d = await this.decide(body);
    if ("badRequest" in d) return d;
    if (d.allow) await this.touchKey(d.key_id, d.user_id);
    else await this.recordRefusal(d.reason);
    return d;
  }

  /** Refus d'authentification des 60 dernières minutes (depuis le démarrage du processus). */
  recentAuthFailures(now = Date.now()): number {
    this.authFailures = this.authFailures.filter((t) => now - t < 3_600_000);
    return this.authFailures.length;
  }

  private async recordRefusal(reason: RefusalReason): Promise<void> {
    if (AUTH_FAILURE_REASONS.has(reason)) {
      this.authFailures.push(Date.now());
      if (this.authFailures.length > 20_000) this.recentAuthFailures();
    }
    try {
      const now = nowIso();
      await writeTx(this.db, () => {
        this.db.prepare(
          "INSERT INTO ytc_auth_failure (day, reason, count, last_at) VALUES (?, ?, 1, ?) " +
          "ON CONFLICT(day, reason) DO UPDATE SET count = count + 1, last_at = excluded.last_at",
        ).run(parisDay(), reason, now);
      });
    } catch (e) {
      log("warn", "auth failure not recorded", { reason, err: String(e) });
    }
  }

  /** Dernière utilisation d'un jeton : au plus une écriture par minute et par jeton. */
  private async touchKey(keyId: string, userId: string): Promise<void> {
    const now = Date.now();
    const last = this.lastUsedWrite.get(keyId);
    if (last !== undefined && now - last < LAST_USED_EVERY_MS) return;
    this.lastUsedWrite.set(keyId, now);
    if (this.lastUsedWrite.size > 10_000) for (const [k, t] of this.lastUsedWrite) if (now - t >= LAST_USED_EVERY_MS) this.lastUsedWrite.delete(k);
    try {
      const iso = new Date(now).toISOString();
      const before = new Date(now - LAST_USED_EVERY_MS).toISOString();
      await writeTx(this.db, () => {
        this.db.prepare(
          "INSERT INTO ytc_key_meta (key_id, user_id, created_at, last_used_at) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(key_id) DO UPDATE SET last_used_at = excluded.last_used_at " +
          "WHERE ytc_key_meta.last_used_at IS NULL OR ytc_key_meta.last_used_at < ?",
        ).run(keyId, userId, iso, iso, before);
      });
    } catch (e) {
      log("warn", "key last use not recorded", { err: String(e) });
    }
  }

  private async decide(body: unknown): Promise<Decision | { badRequest: string }> {
    const b = (body ?? {}) as Record<string, unknown>;
    const key = b.key, action = b.action;
    if (typeof key !== "string" || key.length < 10 || key.length > 200 || !key.startsWith("ytc_")) return refusal("invalid_key");
    if (action !== "access" && action !== "create_job") return { badRequest: "action invalide" };
    const platform = typeof b.platform === "string" ? b.platform.slice(0, 32) : null;

    const r = await this.auth.api.verifyApiKey({ body: { key } });
    if (!r.valid || !r.key) {
      const code = r.error?.code;
      if (code === "KEY_EXPIRED") return refusal("expired");
      return refusal("invalid_key");
    }
    const keyId = r.key.id;
    const userId = r.key.referenceId;
    const user = this.db.prepare('SELECT id, status FROM "user" WHERE id = ?').get(userId) as { id: string; status: string | null } | undefined;
    const meta = this.db.prepare("SELECT revoked_at, kind FROM ytc_key_meta WHERE key_id = ?").get(keyId) as { revoked_at: string | null; kind: string | null } | undefined;
    if (!user || meta?.revoked_at) return refusal("invalid_key");
    // Clé « desktop » (AETHRYON Desktop relié, desktop.ts) : depuis la 3.8.1, elle ouvre aussi les conversions d'ytapi
    // (« Coller un lien » du Desktop, « Envoyer vers › Premiere Pro » relayé par l'extension), exactement comme la clé
    // de l'extension : mêmes quotas, mêmes refus (révoquée ou expirée → invalid_key / expired), rien de plus.
    if (user.status === "suspended") return refusal("user_suspended");

    // key_kind « discord » : clé remise au bot pour un utilisateur ; ytapi ne lui applique que les limites par
    // utilisateur (tous les utilisateurs Discord arrivent de la même adresse, celle du bot).
    const base = { allow: true as const, user_id: userId, key_id: keyId, key_name: r.key.name ?? "", key_kind: meta?.kind ?? "shortcut" };

    if (action === "access") {
      const { today, policy } = this.usage.todayWithPolicy(userId, meta?.kind ?? null);
      return { ...base, limits: limitsOf(policy), remaining_today: today.remaining ?? UNLIMITED_DAILY };
    }

    const fmt = b.fmt;
    if (fmt !== "mp3" && fmt !== "mp4") return refusal("format_not_allowed");
    const settings = getSettings(this.db);
    if (settings.conversionsPaused) return refusal("paused", { retry_after_s: 300 });
    const pf = normalizePlatform(platform);
    if (pf && !settings.platforms[pf]) return refusal("platform_disabled");
    const c = await this.usage.consume(userId, keyId, fmt, platform);
    if (!c.ok) return refusal("quota_exceeded", { retry_after_s: c.retryAfterS });
    return { ...base, limits: limitsOf(c.policy), remaining_today: c.remaining, usage_id: c.usageId };
  }
}

const JOB_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export function createInternalApp(cfg: Config, authorizer: Authorizer, usage: UsageService, cloud: CloudService | null = null): Hono {
  const app = new Hono();
  const expected = digest(cfg.internalToken);

  app.use("*", async (c, next) => {
    // Défense en profondeur : seul le réseau interne (ytapi) peut joindre cette API, en plus du jeton.
    if (cfg.internalAllowFrom) {
      let remote = "";
      try { remote = getConnInfo(c).remote.address ?? ""; } catch { remote = ""; }
      if (!ipInCidr(remote, cfg.internalAllowFrom)) return c.json({ error: "forbidden", message: "Origine réseau refusée." }, 403);
    }
    const got = c.req.header("x-internal-token") ?? "";
    if (!timingSafeEqual(digest(got), expected)) return c.json({ error: "unauthorized", message: "Jeton interne absent ou invalide." }, 401);
    await next();
  });

  app.get("/internal/v1/health", (c) => c.json({ status: "ok" }));

  app.post("/internal/v1/authorize", async (c) => {
    const body = await c.req.json().catch(() => null);
    const t0 = Date.now();
    const d = await authorizer.authorize(body);
    if ("badRequest" in d) return c.json({ error: "bad_request", message: d.badRequest }, 400);
    log("info", "authorize", {
      action: (body as { action?: string } | null)?.action, allow: d.allow,
      reason: d.allow ? undefined : d.reason, user: d.allow ? d.user_id : undefined, ms: Date.now() - t0,
    });
    return c.json(d);
  });

  app.post("/internal/v1/usage/:id", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const state = body?.state;
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id) || typeof state !== "string" || !USAGE_STATES.includes(state as UsageState) || state === "reserved") {
      return c.json({ error: "bad_request", message: "Requête invalide." }, 400);
    }
    const str = (v: unknown, max: number) => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : null);
    const size = typeof body!.size_bytes === "number" && Number.isFinite(body!.size_bytes) && body!.size_bytes >= 0 ? Math.floor(body!.size_bytes) : null;
    const errorCode = str(body!.error_code, 64);
    // job_id : identifiant opaque du job ytapi (ignoré s'il n'a pas la forme attendue, pour ne pas perdre
    // la transition) ; cause : nettoyée une seconde fois ici (URL, jetons, suites opaques), ≤ 300.
    const rawJob = body!.job_id;
    const jobId = typeof rawJob === "string" && JOB_ID_RE.test(rawJob) ? rawJob : null;
    if (rawJob !== undefined && rawJob !== null && jobId === null) log("warn", "usage update: job_id ignored", { usage: id });
    const cause = sanitizeCause(body!.cause);
    const found = await usage.update(id, state as UsageState, { errorCode, platform: str(body!.platform, 32), sizeBytes: size, jobId, cause });
    // Trace de chaque transition (identifiant d'usage et code stable), pour retrouver la cause d'un échec
    // signalé depuis l'historique ; jamais d'e-mail, de jeton ni d'URL.
    log("info", "usage update", { usage: id, job: jobId, state, error_code: errorCode, found });
    if (!found) return c.json({ error: "not_found", message: "Utilisation inconnue." }, 404);
    return c.json({ ok: true });
  });

  // AETHRYON Cloud : offre de sauvegarde après un téléchargement, URL d'envoi, fin d'envoi (cloud/routes.ts).
  mountCloudInternal(app, cloud);

  app.notFound((c) => c.json({ error: "not_found", message: "Route inconnue." }, 404));
  app.onError((err, c) => {
    log("error", "internal error", { err: String(err) });
    return c.json({ error: "internal_error", message: "Erreur interne." }, 500);
  });
  return app;
}

// Quotas et historique d'utilisation. Une « unité » de quota est réservée à la création d'un job
// (jamais au polling ni au téléchargement). Ne comptent pas : une unité « refunded » (job jamais créé)
// ni une conversion en échec (« error », quelle qu'en soit la cause : plateforme qui bloque le serveur,
// vidéo supprimée…), qui reste dans l'historique avec son code. Les conversions annulées comptent.
// Règle effective (docs/ADMIN.md §3) : `policyFor(userId)` — rôle admin ou quota personnalisé
// illimité ⇒ aucune limite quotidienne ni commerciale de concurrence ; le plafond technique
// TECH_MAX_ACTIVE_PER_USER s'applique toujours.
// Offres (PLANS_ACTIVE=1, docs/FACTURATION.md §4) : la base devient celle de l'offre effective du compte (droits
// ytc_entitlement : web, manual, discord), plus un plafond sur 30 jours glissants ; les réglages manuels d'un
// administrateur restent prioritaires. Le décompte est COMMUN à tous les accès (raccourci, extension, Discord, Tools) :
// une conversion compte une fois, d'où qu'elle vienne. Sans DISCORD_PAID_BENEFITS, une demande venue du bot est jugée
// avec les limites de Free (aucun avantage payant dans Discord, Developer Policy de Discord).
import { createHmac } from "node:crypto";
import type { Config } from "./config.ts";
import { newId, writeTx, type DB } from "./db.ts";
import { getSettings, type Settings } from "./settings.ts";
import { effectivePlan, PLANS, type Entitlement, type Plan, type PlanId } from "./plans.ts";
import { nextParisMidnight, nowIso, parisDay } from "./time.ts";

export type UsageState = "reserved" | "running" | "done" | "error" | "cancelled" | "refunded";
const RANK: Record<UsageState, number> = { reserved: 0, running: 1, done: 2, error: 2, cancelled: 2, refunded: 2 };
export const USAGE_STATES = Object.keys(RANK) as UsageState[];
/** États qui ne consomment pas de quota (SQL) : job jamais créé, ou conversion en échec. */
const NOT_COUNTED = "'refunded', 'error'";
const FREE_STATES: ReadonlySet<UsageState> = new Set(["refunded", "error"]);

/**
 * Valeur annoncée à ytapi (`limits.daily`, `remaining_today`) pour un quota illimité : ytapi n'utilise
 * pas ces champs pour décider (seul `max_active` compte), un grand nombre évite tout cas particulier.
 */
export const UNLIMITED_DAILY = 1_000_000;

/** Quota du jour vu par l'utilisateur ; `limit` et `remaining` valent null quand il est illimité. */
export interface Today {
  used: number; limit: number | null; remaining: number | null; unlimited: boolean; bonus: number; resetAt: string;
  /** Offre appliquée et plafond sur 30 jours glissants (offres actives seulement ; null sinon). */
  plan?: PlanId; month?: { used: number; limit: number } | null;
}

export interface PolicyRow {
  user_id: string; daily_limit: number | null; unlimited: number; max_active: number | null;
  reset_day: string | null; reset_at: string | null; updated_at: string; updated_by: string | null;
}

export interface Policy {
  unlimited: boolean;          // rôle admin ou réglage « illimité » de l'utilisateur
  unlimitedByRole: boolean;    // illimité du seul fait du rôle admin
  baseDailyLimit: number;      // quota personnalisé, sinon quota global
  todayBonus: number;          // bonus accordés pour aujourd'hui (heure de Paris)
  dailyLimit: number;          // base + bonus (sans effet quand `unlimited`)
  maxActive: number;           // jobs actifs simultanés autorisés
  resetAt: string | null;      // remise à zéro manuelle du compteur d'aujourd'hui, s'il y en a une
  plan: PlanId;                // offre appliquée (« free » tant que les offres ne sont pas actives)
  monthlyLimit: number | null; // plafond sur 30 jours glissants (offres actives seulement)
}

/** Cause technique transmise par ytapi : nettoyée (URL, jetons, longues suites opaques), ≤ 300 caractères. */
export function sanitizeCause(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.slice(0, 4000).normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[url]")
    .replace(/\bwww\.\S+/gi, "[url]")
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\/\S*/gi, "[url]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [masqué]")
    .replace(/ytc_[A-Za-z0-9_-]*/g, "[jeton]")
    .replace(/[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/g, "[e-mail]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[masqué]")
    .replace(/\s+/g, " ")
    .trim();
  return s ? s.slice(0, 300) : null;
}

// Codes d'erreur de ytapi → texte affiché dans l'historique. Copie EXACTE de la table de
// docs/ERREURS.md (mêmes textes que le `detail` renvoyé à l'iPhone) ; vérifiée par
// scripts/check-error-codes.py et par les tests. Un code absent s'affiche avec le repli générique.
export const ERROR_TEXT: Readonly<Record<string, string>> = {
  not_found: "Vidéo supprimée ou inaccessible : la plateforme ne la trouve pas (lien erroné ou vidéo retirée).",
  unavailable: "Vidéo supprimée ou inaccessible depuis le serveur : la plateforme ne la fournit pas (retirée, masquée ou bloquée dans le pays du serveur).",
  no_video: "Ce post ne contient pas de vidéo.",
  media_index_not_found: "Ce post ne contient pas la vidéo demandée.",
  private: "La vidéo est privée.",
  age_restricted: "Vidéo soumise à une limite d'âge : la plateforme exige un compte connecté.",
  members_only: "Vidéo réservée aux membres de la chaîne.",
  geo_restricted: "Vidéo bloquée dans le pays du serveur.",
  login_required: "La plateforme exige un compte connecté pour cette vidéo.",
  unsupported_url: "Ce lien n'est pas pris en charge : partage une vidéo YouTube, TikTok ou X.",
  unsupported_content: "Ce contenu n'est pas pris en charge (diaporama photo ou contenu protégé).",
  playlist_not_supported: "Les playlists, chaînes et profils ne sont pas pris en charge : partage une vidéo.",
  youtube_music_not_accepted: "Les liens YouTube Music ne sont pas acceptés : AETHRYON ne télécharge pas le catalogue musical commercial.",
  platform_not_accepted: "Cette plateforme n'est pas acceptée : AETHRYON ne télécharge ni le streaming payant, ni les catalogues musicaux, ni les contenus protégés.",
  live_not_supported: "Les directs et les premières ne sont pas pris en charge.",
  short_link_unresolved: "Le lien court n'a pas pu être ouvert : ouvre la vidéo dans l'app puis partage-la à nouveau.",
  no_audio: "Cette vidéo n'a pas de son : MP3 impossible.",
  too_long: "Vidéo trop longue pour le service.",
  too_large: "Fichier trop volumineux pour le service.",
  transcode_too_long: "Vidéo trop longue pour être réencodée.",
  gif_too_long: "Vidéo trop longue pour un GIF.",
  clip_out_of_range: "L'extrait demandé commence après la fin de la vidéo.",
  cannot_fit: "Impossible de faire tenir ce média dans la taille demandée : il est trop long pour cette taille.",
  unsupported_file: "Ce fichier n'est pas une vidéo ou un son pris en charge.",
  resolution_too_high: "Image trop grande : le service accepte jusqu'à la 4K.",
  invalid_crop: "Le recadrage demandé sort de l'image.",
  bot_check: "Plateforme temporairement indisponible : elle impose au serveur une vérification anti-robot et bloque ses demandes ; ni ta vidéo ni ton compte ne sont en cause. Réessaie plus tard.",
  upstream_rate_limited: "Plateforme temporairement indisponible : elle limite le nombre de demandes du serveur ; ni ta vidéo ni ton compte ne sont en cause. Réessaie plus tard.",
  upstream_unavailable: "Plateforme temporairement indisponible : elle a renvoyé une erreur. Réessaie plus tard.",
  upstream_timeout: "Plateforme temporairement indisponible : elle n'a pas répondu à temps.",
  extractor_broken: "Plateforme temporairement indisponible : elle a changé son fonctionnement, le serveur doit être mis à jour.",
  platform_unavailable: "Plateforme temporairement indisponible : trop d'échecs récents, elle est mise en pause automatiquement ; ni ta vidéo ni ton compte ne sont en cause. Réessaie plus tard.",
  upstream_forbidden: "Échec de récupération du média : la plateforme a refusé l'accès au fichier (HTTP 403).",
  download_failed: "Échec de récupération du média : le téléchargement depuis la plateforme a été interrompu.",
  format_unavailable: "Échec de récupération du média : aucun format compatible n'est proposé.",
  upstream_error: "Échec de récupération du média (cause non identifiée).",
  conversion_failed: "Échec du traitement vidéo.",
  timeout: "Délai de conversion dépassé.",
  insufficient_storage: "Serveur saturé (espace disque) : réessaie plus tard.",
  server_busy: "Serveur occupé : réessaie dans un instant.",
  internal_error: "Erreur interne.",
  worker_crashed: "Erreur interne : le traitement s'est arrêté.",
  cookies_invalid: "Erreur interne : configuration du serveur à corriger.",
  proxy_unreachable: "Erreur interne : configuration du serveur à corriger.",
  proxy_bypass: "Erreur interne : configuration du serveur à corriger.",
  cancelled: "La conversion a été annulée.",
};
export const ERROR_FALLBACK_TEXT = "La conversion a échoué.";

export function errorMessage(code: string | null): string | null {
  if (!code) return null;
  return Object.hasOwn(ERROR_TEXT, code) ? ERROR_TEXT[code]! : ERROR_FALLBACK_TEXT;
}


export class UsageService {
  private db: DB;
  private cfg: Config;
  constructor(db: DB, cfg: Config) { this.db = db; this.cfg = cfg; }

  /** Identité anti-abus : HMAC de l'e-mail (stable si le compte est supprimé puis recréé). */
  identityOf(email: string): string {
    return createHmac("sha256", this.cfg.authSecret).update(`quota:${email.toLowerCase()}`).digest("base64url");
  }

  private identity(userId: string): string | null {
    const row = this.db.prepare('SELECT email FROM "user" WHERE id = ?').get(userId) as { email: string } | undefined;
    return row ? this.identityOf(row.email) : null;
  }

  private ledgerUsed(identity: string | null, day: string): number {
    if (!identity) return 0;
    const r = this.db.prepare("SELECT used FROM ytc_quota_ledger WHERE identity = ? AND day = ?").get(identity, day) as { used: number } | undefined;
    return r ? Number(r.used) : 0;
  }

  globalDailyLimit(st: Settings = getSettings(this.db)): number { return st.dailyLimit ?? this.cfg.dailyConversions; }
  globalMaxActive(st: Settings = getSettings(this.db)): number { return st.maxActive ?? this.cfg.maxActiveJobs; }

  policyRow(userId: string): PolicyRow | null {
    const r = this.db.prepare("SELECT * FROM ytc_user_policy WHERE user_id = ?").get(userId) as PolicyRow | undefined;
    return r ? { ...r } : null;
  }

  bonusToday(userId: string, day = parisDay()): number {
    const r = this.db.prepare("SELECT coalesce(sum(amount), 0) AS s FROM ytc_quota_grant WHERE user_id = ? AND day = ?").get(userId, day) as { s: number };
    return Number(r.s);
  }

  /** Règle effective, calcul pur (partagé par l'utilisateur seul et les listes). `plan` : offre effective quand les
   *  offres sont actives (null sinon) ; Free garde les réglages globaux (Control Center), Plus et Pro les leurs. */
  computePolicy(role: string | null, row: PolicyRow | null, bonus: number, st: Settings, day: string, plan: Plan | null = null): Policy {
    const unlimitedByRole = role === "admin";
    const unlimited = unlimitedByRole || Number(row?.unlimited ?? 0) === 1;
    const paid = plan && plan.id !== "free" ? plan : null;
    const base = row?.daily_limit ?? (paid ? paid.limits.daily : this.globalDailyLimit(st));
    const tech = this.cfg.techMaxActive;
    const maxActive = unlimited ? tech : Math.max(1, Math.min(tech, row?.max_active ?? (paid ? paid.limits.maxActive : this.globalMaxActive(st))));
    const resetAt = row && row.reset_day === day ? row.reset_at : null;
    return {
      unlimited, unlimitedByRole, baseDailyLimit: base, todayBonus: bonus, dailyLimit: base + bonus, maxActive, resetAt,
      plan: plan?.id ?? "free", monthlyLimit: plan && !unlimited ? plan.limits.monthly : null,
    };
  }

  // ---- Tools : minutes d'export pondérées (plans.ts exportWeight, migration 011 ytc_tools_export) -------------------

  /** Limite d'export du jour (minutes pondérées) : celle de l'offre effective ; sans offres actives, celle de Gratuit
   *  seulement si TOOLS_EXPORT_LIMIT=1 (coupée par défaut : décision du propriétaire) ; null = aucune (limite coupée,
   *  rôle admin ou réglage « illimité »). Les minutes sont comptées dans tous les cas. */
  exportLimit(userId: string): number | null {
    const policy = this.policyFor(userId);
    if (policy.unlimited) return null;
    const plan = this.planFor(userId);
    if (!plan && !this.cfg.toolsExportLimit) return null;
    return (plan ?? PLANS.free).limits.exportMinutesDaily;
  }

  /** Minutes d'export comptées aujourd'hui (réservées ou comptées ; les minutes rendues ne comptent pas). */
  exportUsed(userId: string, day = parisDay()): number {
    try {
      const r = this.db.prepare("SELECT coalesce(sum(minutes), 0) AS m FROM ytc_tools_export WHERE user_id = ? AND day = ? AND state <> 'rendu'").get(userId, day) as { m: number };
      return Math.round(Number(r.m) * 10) / 10;
    } catch (e) {
      // Base pas encore migrée (011) : rien n'a pu être compté. Toute autre erreur remonte.
      if (/no such table/i.test(String((e as Error).message))) return 0;
      throw e;
    }
  }

  /** Réserve atomiquement les minutes d'un export (avant de le demander à ytapi) ; refus si la limite du jour serait
   *  dépassée. Un export qui ne coûte rien (son, aperçu) est toujours accepté. La MÊME demande (même empreinte), déjà
   *  comptée aujourd'hui, n'est jamais refusée : ytapi la rejoint d'ordinaire sans travail nouveau (double clic, autre
   *  onglet, « Réessayer ») ; s'il refait vraiment l'export (fichier expiré), il est compté après coup. */
  async reserveExport(userId: string, op: string, minutes: number, key: string):
    Promise<{ ok: true; id: string; identical: boolean; minutes: number } | { ok: false; used: number; limit: number; minutes: number; retryAfterS: number }> {
    return writeTx(this.db, () => {
      const day = parisDay();
      const limit = this.exportLimit(userId);
      const used = this.exportUsed(userId, day);
      const identical = minutes > 0 && !!this.db.prepare("SELECT 1 FROM ytc_tools_export WHERE user_id = ? AND day = ? AND cle = ? AND state = 'compte'").get(userId, day, key);
      if (!identical && limit !== null && minutes > 0 && used + minutes > limit + 1e-9) {
        const retryAfterS = Math.max(1, Math.ceil((nextParisMidnight().getTime() - Date.now()) / 1000));
        return { ok: false as const, used, limit, minutes, retryAfterS };
      }
      const id = newId();
      this.db.prepare("INSERT INTO ytc_tools_export (id, user_id, day, cle, job_id, op, minutes, state, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, 'reserve', ?)")
        .run(id, userId, day, key, op, identical ? 0 : minutes, nowIso());
      return { ok: true as const, id, identical, minutes };
    });
  }

  /** Issue de la demande : « compte » (export créé par ytapi, avec ses minutes), « rendu » (refus, ou export identique
   *  déjà fait : aucun travail nouveau). */
  async settleExport(id: string, state: "compte" | "rendu", jobId: string | null = null, minutes: number | null = null): Promise<void> {
    await writeTx(this.db, () => {
      this.db.prepare("UPDATE ytc_tools_export SET state = ?, job_id = coalesce(?, job_id), minutes = coalesce(?, minutes) WHERE id = ? AND state = 'reserve'")
        .run(state, jobId, minutes, id);
    });
  }

  /** Droits actifs ou passés du compte (ytc_entitlement, migration 011). */
  entitlements(userId: string): Entitlement[] {
    const rows = this.db.prepare("SELECT plan, source, starts_at, ends_at, revoked_at FROM ytc_entitlement WHERE user_id = ?").all(userId) as
      { plan: Entitlement["plan"]; source: Entitlement["source"]; starts_at: string; ends_at: string | null; revoked_at: string | null }[];
    return rows.map((r) => ({ plan: r.plan, source: r.source, startsAt: r.starts_at, endsAt: r.ends_at, revoked: r.revoked_at !== null }));
  }

  /** Offre appliquée à une demande : null quand les offres ne sont pas actives (PLANS_ACTIVE) ; Free pour une demande
   *  du bot Discord sans DISCORD_PAID_BENEFITS ; sinon l'offre effective du compte. */
  planFor(userId: string, kind: string | null = null, now = new Date()): Plan | null {
    if (!this.cfg.plansActive) return null;
    if (kind === "discord" && !this.cfg.discordPaidBenefits) return PLANS.free;
    return effectivePlan(this.entitlements(userId), now);
  }

  policyFor(userId: string, day = parisDay(), kind: string | null = null): Policy {
    const u = this.db.prepare('SELECT role FROM "user" WHERE id = ?').get(userId) as { role: string | null } | undefined;
    return this.computePolicy(u?.role ?? null, this.policyRow(userId), this.bonusToday(userId, day), getSettings(this.db), day, this.planFor(userId, kind));
  }

  /** Conversions comptées sur les 30 derniers jours (fenêtre glissante, tous accès confondus). */
  usedMonth(userId: string, now = new Date()): number {
    const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const r = this.db.prepare(`SELECT count(*) AS n FROM ytc_usage WHERE user_id = ? AND created_at > ? AND state NOT IN (${NOT_COUNTED})`).get(userId, since) as { n: number };
    return Number(r.n);
  }

  /** Secondes avant qu'une unité ne sorte de la fenêtre de 30 jours (la plus ancienne comptée). */
  private monthRetryAfter(userId: string, now = new Date()): number {
    const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const r = this.db.prepare(`SELECT min(created_at) AS t FROM ytc_usage WHERE user_id = ? AND created_at > ? AND state NOT IN (${NOT_COUNTED})`).get(userId, since) as { t: string | null };
    const leaves = r.t ? Date.parse(r.t) + 30 * 86_400_000 : now.getTime() + 3600_000;
    return Math.max(60, Math.ceil((leaves - now.getTime()) / 1000));
  }

  /** Limite quotidienne effective du jour (bonus compris). */
  dailyLimitFor(userId: string): number {
    return this.policyFor(userId).dailyLimit;
  }

  /**
   * Unités consommées aujourd'hui : le plus grand du compte (lignes postérieures à la remise à zéro
   * du jour, s'il y en a une) et du registre anti-abus.
   */
  usedToday(userId: string, day = parisDay(), resetAt?: string | null): number {
    const since = resetAt === undefined ? this.policyFor(userId, day).resetAt : resetAt;
    const r = this.db.prepare(
      `SELECT count(*) AS n FROM ytc_usage WHERE user_id = ? AND day = ? AND state NOT IN (${NOT_COUNTED}) AND (? IS NULL OR created_at > ?)`,
    ).get(userId, day, since, since) as { n: number };
    return Math.max(Number(r.n), this.ledgerUsed(this.identity(userId), day));
  }

  private todayFrom(used: number, p: Policy, month: Today["month"] = null): Today {
    const resetAt = nextParisMidnight().toISOString();
    const extra = this.cfg.plansActive ? { plan: p.plan, month } : {};
    if (p.unlimited) return { used, limit: null, remaining: null, unlimited: true, bonus: p.todayBonus, resetAt, ...extra };
    // Reste du jour : borné aussi par le plafond sur 30 jours (une offre payante ne dépasse jamais son mois).
    const monthLeft = month ? Math.max(0, month.limit - month.used) : Infinity;
    return { used, limit: p.dailyLimit, remaining: Math.max(0, Math.min(p.dailyLimit - used, monthLeft)), unlimited: false, bonus: p.todayBonus, resetAt, ...extra };
  }

  /** Quota du jour et règle effective, calculés ensemble (`kind` : accès qui demande, ex. « discord »). */
  todayWithPolicy(userId: string, kind: string | null = null): { today: Today; policy: Policy } {
    const day = parisDay();
    const policy = this.policyFor(userId, day, kind);
    const month = policy.monthlyLimit !== null ? { used: this.usedMonth(userId), limit: policy.monthlyLimit } : null;
    return { today: this.todayFrom(this.usedToday(userId, day, policy.resetAt), policy, month), policy };
  }

  today(userId: string): Today {
    return this.todayWithPolicy(userId).today;
  }

  /** Quota du jour de tous les utilisateurs, en quelques requêtes (listes de l'administration). */
  todayAll(): Map<string, { used: number; policy: Policy; today: Today }> {
    const day = parisDay();
    const st = getSettings(this.db);
    const users = this.db.prepare('SELECT id, email, role FROM "user"').all() as { id: string; email: string; role: string | null }[];
    const policies = new Map((this.db.prepare("SELECT * FROM ytc_user_policy").all() as unknown as PolicyRow[]).map((r) => [r.user_id, { ...r }]));
    const bonuses = new Map((this.db.prepare("SELECT user_id, sum(amount) AS s FROM ytc_quota_grant WHERE day = ? GROUP BY user_id").all(day) as { user_id: string; s: number }[])
      .map((r) => [r.user_id, Number(r.s)]));
    const counts = new Map((this.db.prepare(
      "SELECT x.user_id, count(*) AS n FROM ytc_usage x LEFT JOIN ytc_user_policy p ON p.user_id = x.user_id " +
      "WHERE x.day = ? AND x.state NOT IN (" + NOT_COUNTED + ") AND (p.reset_day IS NULL OR p.reset_day <> ? OR p.reset_at IS NULL OR x.created_at > p.reset_at) GROUP BY x.user_id",
    ).all(day, day) as { user_id: string; n: number }[]).map((r) => [r.user_id, Number(r.n)]));
    const ledger = new Map((this.db.prepare("SELECT identity, used FROM ytc_quota_ledger WHERE day = ?").all(day) as { identity: string; used: number }[])
      .map((r) => [r.identity, Number(r.used)]));
    const out = new Map<string, { used: number; policy: Policy; today: Today }>();
    for (const u of users) {
      const policy = this.computePolicy(u.role, policies.get(u.id) ?? null, bonuses.get(u.id) ?? 0, st, day, this.planFor(u.id));
      const used = Math.max(counts.get(u.id) ?? 0, ledger.size ? ledger.get(this.identityOf(u.email)) ?? 0 : 0);
      out.set(u.id, { used, policy, today: this.todayFrom(used, policy) });
    }
    return out;
  }

  /** Réserve atomiquement une unité (sans limite quotidienne quand le quota est illimité). Avec les offres actives,
   *  la demande est jugée selon l'accès d'où elle vient (type de la clé : raccourci, extension, discord, outils) et le
   *  plafond sur 30 jours s'applique aussi. */
  async consume(userId: string, keyId: string, fmt: "mp3" | "mp4", platform: string | null):
    Promise<{ ok: true; usageId: string; remaining: number; policy: Policy } | { ok: false; retryAfterS: number; remaining: 0; policy: Policy; reason: "daily" | "monthly" }> {
    return writeTx(this.db, () => {
      const day = parisDay();
      const kind = (this.db.prepare("SELECT kind FROM ytc_key_meta WHERE key_id = ?").get(keyId) as { kind: string | null } | undefined)?.kind ?? null;
      const policy = this.policyFor(userId, day, kind);
      const used = this.usedToday(userId, day, policy.resetAt);
      if (!policy.unlimited && used >= policy.dailyLimit) {
        const retryAfterS = Math.max(1, Math.ceil((nextParisMidnight().getTime() - Date.now()) / 1000));
        return { ok: false as const, retryAfterS, remaining: 0 as const, policy, reason: "daily" as const };
      }
      const month = policy.monthlyLimit !== null ? this.usedMonth(userId) : 0;
      if (policy.monthlyLimit !== null && month >= policy.monthlyLimit) {
        return { ok: false as const, retryAfterS: this.monthRetryAfter(userId), remaining: 0 as const, policy, reason: "monthly" as const };
      }
      const id = newId();
      const now = nowIso();
      this.db.prepare(
        "INSERT INTO ytc_usage (id, user_id, key_id, day, fmt, platform, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, ?)",
      ).run(id, userId, keyId, day, fmt, platform, now, now);
      const identity = this.identity(userId);
      if (identity) {
        this.db.prepare(
          "INSERT INTO ytc_quota_ledger (identity, day, used) VALUES (?, ?, ?) ON CONFLICT(identity, day) DO UPDATE SET used = excluded.used",
        ).run(identity, day, used + 1);
      }
      const monthLeft = policy.monthlyLimit !== null ? policy.monthlyLimit - month - 1 : Infinity;
      const remaining = policy.unlimited ? UNLIMITED_DAILY : Math.max(0, Math.min(policy.dailyLimit - used - 1, monthLeft));
      return { ok: true as const, usageId: id, remaining, policy };
    });
  }

  /**
   * Transition d'état idempotente ; un état terminal n'est jamais écrasé. `jobId` (job ytapi) est
   * retenu une fois pour toutes ; `started_at` est posé au premier passage à « running ».
   */
  async update(usageId: string, state: UsageState, opts: {
    errorCode?: string | null; platform?: string | null; sizeBytes?: number | null; jobId?: string | null; cause?: string | null;
  }): Promise<boolean> {
    return writeTx(this.db, () => {
      const row = this.db.prepare("SELECT state, user_id, day FROM ytc_usage WHERE id = ?").get(usageId) as { state: UsageState; user_id: string; day: string } | undefined;
      if (!row) return false;
      // Unité rendue (job jamais créé, ou échec) : le registre anti-abus la rend aussi.
      if (FREE_STATES.has(state) && RANK[row.state] < 2) {
        const identity = this.identity(row.user_id);
        if (identity) this.db.prepare("UPDATE ytc_quota_ledger SET used = max(0, used - 1) WHERE identity = ? AND day = ?").run(identity, row.day);
      }
      if (RANK[state] < RANK[row.state] || (RANK[row.state] === 2 && row.state !== state)) {
        // ignoré, sans erreur ; l'identifiant du job reste utile pour le retrouver
        if (opts.jobId) this.db.prepare("UPDATE ytc_usage SET job_id = COALESCE(job_id, ?) WHERE id = ?").run(opts.jobId, usageId);
        return true;
      }
      const now = nowIso();
      this.db.prepare(
        "UPDATE ytc_usage SET state = ?, error_code = COALESCE(?, error_code), platform = COALESCE(?, platform), " +
        "size_bytes = COALESCE(?, size_bytes), job_id = COALESCE(job_id, ?), cause = COALESCE(?, cause), " +
        "started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, ?) ELSE started_at END, " +
        "updated_at = ?, finished_at = CASE WHEN ? = 2 THEN COALESCE(finished_at, ?) ELSE finished_at END WHERE id = ?",
      ).run(state, opts.errorCode ?? null, opts.platform ?? null, opts.sizeBytes ?? null, opts.jobId ?? null, opts.cause ?? null,
        state, now, now, RANK[state], now, usageId);
      return true;
    });
  }

  // ---- modifications par l'administrateur (synchrones : à appeler dans writeTx, avec l'audit) ----

  setPolicySync(userId: string, v: { dailyLimit: number | null; unlimited: boolean; maxActive: number | null }, by: string | null):
    { before: PolicyRow | null; after: PolicyRow } {
    const before = this.policyRow(userId);
    this.db.prepare(
      "INSERT INTO ytc_user_policy (user_id, daily_limit, unlimited, max_active, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(user_id) DO UPDATE SET daily_limit = excluded.daily_limit, unlimited = excluded.unlimited, " +
      "max_active = excluded.max_active, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
    ).run(userId, v.dailyLimit, v.unlimited ? 1 : 0, v.maxActive, nowIso(), by);
    return { before, after: this.policyRow(userId)! };
  }

  grantSync(userId: string, amount: number, reason: string | null, by: string | null): { id: string; day: string; amount: number; reason: string | null; createdAt: string } {
    const id = newId();
    const day = parisDay();
    const createdAt = nowIso();
    this.db.prepare("INSERT INTO ytc_quota_grant (id, user_id, day, amount, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, userId, day, amount, reason, by, createdAt);
    return { id, day, amount, reason, createdAt };
  }

  /** Remise à zéro du compteur d'aujourd'hui (et du registre anti-abus du jour). */
  resetTodaySync(userId: string, by: string | null): { before: number; resetAt: string } {
    const day = parisDay();
    const before = this.usedToday(userId, day);
    const now = nowIso();
    this.db.prepare(
      "INSERT INTO ytc_user_policy (user_id, unlimited, reset_day, reset_at, updated_at, updated_by) VALUES (?, 0, ?, ?, ?, ?) " +
      "ON CONFLICT(user_id) DO UPDATE SET reset_day = excluded.reset_day, reset_at = excluded.reset_at, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
    ).run(userId, day, now, now, by);
    const identity = this.identity(userId);
    if (identity) this.db.prepare("UPDATE ytc_quota_ledger SET used = 0 WHERE identity = ? AND day = ?").run(identity, day);
    return { before, resetAt: now };
  }

  activity(userId: string, limit = 50) {
    const rows = this.db.prepare(
      "SELECT u.id, u.created_at, u.finished_at, u.fmt, u.platform, u.state, u.error_code, m.kind FROM ytc_usage u " +
      "LEFT JOIN ytc_key_meta m ON m.key_id = u.key_id WHERE u.user_id = ? ORDER BY u.created_at DESC LIMIT ?",
    ).all(userId, Math.min(Math.max(limit, 1), 200)) as {
      id: string; created_at: string; finished_at: string | null; fmt: string; platform: string | null; state: UsageState; error_code: string | null;
      kind: string | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      finishedAt: r.finished_at,
      fmt: r.fmt,
      platform: r.platform,
      state: r.state,
      errorCode: r.error_code,
      errorMessage: r.state === "error" ? errorMessage(r.error_code) : null,
      // Accès d'où vient la conversion (type de la clé) : raccourci, extension, discord, outils ; null si la clé n'existe plus.
      source: r.kind ?? null,
    }));
  }

  /**
   * Part d'échecs sur la dernière heure (null si moins de 5 conversions terminées et comptées).
   * Les lignes dont le code figure dans `excludeCodes` (erreurs liées au contenu ou à l'utilisateur)
   * sont retirées du numérateur ET du dénominateur.
   */
  errorRatioLastHour(excludeCodes: readonly string[] = []): number | null {
    const since = new Date(Date.now() - 3_600_000).toISOString();
    const exclude = excludeCodes.length
      ? ` AND (error_code IS NULL OR error_code NOT IN (${excludeCodes.map(() => "?").join(", ")}))`
      : "";
    const r = this.db.prepare(
      "SELECT sum(CASE WHEN state = 'error' THEN 1 ELSE 0 END) AS e, count(*) AS n FROM ytc_usage WHERE updated_at >= ? AND state IN ('done', 'error')" + exclude,
    ).get(since, ...excludeCodes) as { e: number | null; n: number };
    return r.n < 5 ? null : Number(r.e ?? 0) / Number(r.n);
  }

  conversionsToday(): number {
    const r = this.db.prepare("SELECT count(*) AS n FROM ytc_usage WHERE day = ? AND state <> 'refunded'").get(parisDay()) as { n: number };
    return Number(r.n);
  }

  /** Purge de rétention (utilisation, journal d'administration, registre, bonus, refus, clés révoquées ou expirées, sessions expirées). */
  async purge(): Promise<{ usage: number; adminEvents: number; revokedKeys: number; expiredKeys: number; sessions: number }> {
    const now = new Date();
    const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
    const ledgerBefore = parisDay(new Date(now.getTime() - 2 * 86_400_000));
    const usageDayBefore = parisDay(new Date(now.getTime() - this.cfg.retentionUsageDays * 86_400_000));
    return writeTx(this.db, () => {
      // Historique : RETENTION_USAGE_DAYS (90 jours) ; plus long pour un compte qui a, en ce moment, une offre payante
      // active (plans.ts, historyDays : 1 an), quand les offres sont appliquées (PLANS_ACTIVE=1). Une offre qui s'arrête
      // ramène le compte à la durée de Gratuit à la purge suivante.
      const paidDays = PLANS.annuel.limits.historyDays;
      let u: { changes: number | bigint };
      if (this.cfg.plansActive && paidDays > this.cfg.retentionUsageDays) {
        const nowIsoStr = now.toISOString();
        u = this.db.prepare(
          "DELETE FROM ytc_usage WHERE created_at < ? AND user_id NOT IN (SELECT user_id FROM ytc_entitlement " +
          "WHERE revoked_at IS NULL AND starts_at <= ? AND (ends_at IS NULL OR ends_at > ?))",
        ).run(ago(this.cfg.retentionUsageDays), nowIsoStr, nowIsoStr);
        const older = this.db.prepare("DELETE FROM ytc_usage WHERE created_at < ?").run(ago(paidDays));
        u = { changes: Number(u.changes) + Number(older.changes) };
      } else {
        u = this.db.prepare("DELETE FROM ytc_usage WHERE created_at < ?").run(ago(this.cfg.retentionUsageDays));
      }
      const a = this.db.prepare("DELETE FROM ytc_admin_event WHERE created_at < ?").run(ago(this.cfg.retentionAdminEventDays));
      this.db.prepare("DELETE FROM ytc_quota_ledger WHERE day < ?").run(ledgerBefore);
      this.db.prepare("DELETE FROM ytc_quota_grant WHERE day < ?").run(usageDayBefore);
      this.db.prepare("DELETE FROM ytc_auth_failure WHERE day < ?").run(usageDayBefore);
      // Codes d'autorisation de l'extension : gardés 24 h après expiration (détection d'un rejeu), puis effacés.
      this.db.prepare("DELETE FROM ytc_ext_code WHERE expires_at < ?").run(ago(1));
      // Demandes d'appairage du panneau Premiere (migration 012) : de même, 24 h après expiration.
      this.db.prepare("DELETE FROM ytc_premiere_code WHERE expires_at < ?").run(ago(1));
      // Demandes de liaison d'AETHRYON Desktop (migration 014) : de même.
      this.db.prepare("DELETE FROM ytc_desktop_code WHERE expires_at < ?").run(ago(1));
      // Liaison Discord : états OAuth et liens de téléchargement, 24 h après expiration.
      this.db.prepare("DELETE FROM ytc_discord_state WHERE expires_at < ?").run(ago(1));
      this.db.prepare("DELETE FROM ytc_discord_download WHERE expires_at < ?").run(ago(1));
      // Liens « Ouvrir dans AETHRYON Tools » : 24 h après expiration.
      this.db.prepare("DELETE FROM ytc_outils_ref WHERE expires_at < ?").run(ago(1));
      // Minutes d'export de Tools : même durée que l'historique (la limite du jour n'en lit qu'un jour).
      this.db.prepare("DELETE FROM ytc_tools_export WHERE day < ?").run(usageDayBefore);
      this.db.prepare('DELETE FROM verification WHERE "expiresAt" < ?').run(now.toISOString());
      const s = this.db.prepare('DELETE FROM session WHERE "expiresAt" < ?').run(now.toISOString());
      const old = ago(30);
      const k = this.db.prepare("DELETE FROM apikey WHERE id IN (SELECT key_id FROM ytc_key_meta WHERE revoked_at IS NOT NULL AND revoked_at < ?)").run(old);
      this.db.prepare("DELETE FROM ytc_key_meta WHERE revoked_at IS NOT NULL AND revoked_at < ?").run(old);
      // Clés expirées depuis plus de 30 jours (Better Auth n'efface une clé expirée que s'il la vérifie) ;
      // puis métadonnées dont la clé n'existe plus (appareil lié, dates) : rien ne reste d'une clé effacée.
      const e = this.db.prepare("DELETE FROM apikey WHERE expiresAt IS NOT NULL AND expiresAt < ?").run(old);
      this.db.prepare("DELETE FROM ytc_key_meta WHERE key_id NOT IN (SELECT id FROM apikey)").run();
      return { usage: Number(u.changes), adminEvents: Number(a.changes), revokedKeys: Number(k.changes), expiredKeys: Number(e.changes), sessions: Number(s.changes) };
    });
  }
}

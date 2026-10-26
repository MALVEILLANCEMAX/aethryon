// API publique (même origine que le site, préfixe /api), derrière le nginx du site.
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { mountAdmin } from "./admin.ts";
import type { Auth } from "./auth.ts";
import type { Config } from "./config.ts";
import type { DB } from "./db.ts";
import { DISCORD_SESSIONLESS_PATHS, mountDiscord, type DiscordService } from "./discord.ts";
import type { LibraryService } from "./discord-library.ts";
import { EXTENSION_BEARER_PATHS, mountExtension } from "./extension.ts";
import { mountPremiere, PREMIERE_PANEL_PATHS } from "./premiere.ts";
import { DESKTOP_PATHS, mountDesktop } from "./desktop.ts";
import { err, HttpError, Limiter, toIso, type SessionUser, type Vars } from "./http.ts";
import type { Authorizer } from "./internal.ts";
import { KeyError, type KeyService } from "./keys.ts";
import { log } from "./log.ts";
import { getSettings } from "./settings.ts";
import type { StatusService } from "./status.ts";
import { nowIso } from "./time.ts";
import type { UsageService } from "./usage.ts";
import type { YtapiClient } from "./ytapi.ts";
import type { AccountMails } from "./mails.ts";
import { mountSignup } from "./signup.ts";
import { mountAbonnement, waitlistOf } from "./abonnement.ts";
import { effectivePlan, PLANS } from "./plans.ts";
import { mountOutils, TOOLS_CHUNK_MAX_BYTES, TOOLS_CHUNK_PATH, type ToolsService } from "./outils.ts";
import { mountFacturation, WEBHOOK_MAX_BYTES, WEBHOOK_PATH, type BillingService } from "./facturation.ts";
import { isCloudBearer, mountCloud } from "./cloud/routes.ts";
import { isMusicBearer, mountMusic, MUSIC_LARGE_BODY_MAX, MUSIC_LARGE_BODY_PATHS } from "./music.ts";
import type { CloudService } from "./cloud/service.ts";

export type { SessionUser } from "./http.ts";

export interface Services {
  cfg: Config; db: DB; auth: Auth; keys: KeyService; usage: UsageService; status: StatusService; authorizer: Authorizer; ytapi: YtapiClient;
  discord: DiscordService;
  /** Préférences, médias enregistrés, réglages de serveur Discord (migration 006). */
  library: LibraryService;
  /** E-mails de compte (inscription par e-mail, mot de passe oublié) ; `enabled` faux sans relais SMTP. */
  mails: AccountMails;
  /** AETHRYON Tools : relais vers ytapi (docs/OUTILS.md). */
  tools: ToolsService;
  /** Facturation (Stripe, docs/FACTURATION.md) : fermée tant que BILLING=off. */
  billing: BillingService;
  /** AETHRYON Cloud V1 (src/cloud/) ; null tant que CLOUD ≠ on. */
  cloud: CloudService | null;
}

export const CHANGELOG = [
  { version: "1.1", date: "2026-10-10", notes: ["Fichier signé distribué depuis le site.", "Messages d'erreur plus clairs (jeton, limites, service)."] },
];

export function createPublicApp(s: Services): Hono<{ Variables: Vars }> {
  const { cfg, db, auth, keys, usage, status, discord } = s;
  const app = new Hono<{ Variables: Vars }>();
  const ipLimiter = new Limiter(240, 60_000);
  const checkLimiter = new Limiter(10, 60_000);
  const mutateLimiter = new Limiter(10, 3_600_000); // création et régénération : 10 par heure et par compte
  const revokeLimiter = new Limiter(30, 3_600_000);

  // Journal + en-têtes communs.
  app.use("/api/*", async (c, next) => {
    const t0 = Date.now();
    await next();
    // Exceptions : l'image de profil Discord relayée (cache PRIVÉ d'un jour, versionné par ?v=) et les médias
    // d'AETHRYON Tools (lecture par plages, planche, vignettes : leur propre Cache-Control privé) ; le reste : no-store.
    const ownCache = c.res.status < 300 && (c.req.path === "/api/discord/avatar" || (c.req.path.startsWith("/api/outils/") && c.req.method === "GET" && c.res.headers.has("cache-control")));
    if (!ownCache) c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    log("info", "request", { method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - t0, user: c.get("user")?.id });
  });

  // Corps limités à 32 Kio ; seule exception : un morceau de fichier importé dans AETHRYON Tools (8 Mio au plus).
  const smallBodies = bodyLimit({ maxSize: 32 * 1024, onError: (c) => err(c, 413, "payload_too_large", "Requête trop volumineuse.") });
  const chunkBodies = bodyLimit({ maxSize: TOOLS_CHUNK_MAX_BYTES, onError: (c) => err(c, 413, "payload_too_large", "Morceau de fichier trop volumineux.") });
  // Webhook de Stripe : un événement (facture détaillée) peut dépasser 32 Kio.
  // AETHRYON Music : correspondances et synchronisation de playlists (500 titres, 10 000 candidats) jusqu'à 2 Mio.
  const musicBodies = bodyLimit({ maxSize: MUSIC_LARGE_BODY_MAX, onError: (c) => err(c, 413, "payload_too_large", "Requête trop volumineuse.") });
  const webhookBodies = bodyLimit({ maxSize: WEBHOOK_MAX_BYTES, onError: (c) => err(c, 413, "payload_too_large", "Événement trop volumineux.") });
  app.use("/api/*", (c, next) => (c.req.method === "PUT" && TOOLS_CHUNK_PATH.test(c.req.path) ? chunkBodies
    : c.req.method === "POST" && c.req.path === WEBHOOK_PATH ? webhookBodies
    : c.req.method === "POST" && MUSIC_LARGE_BODY_PATHS.has(c.req.path) ? musicBodies : smallBodies)(c, next));

  // Limite grossière par IP (l'IP vient du nginx du site, en-tête TRUST_PROXY_IP_HEADER).
  app.use("/api/*", async (c, next) => {
    const ip = c.req.header(cfg.ipHeader) ?? "unknown";
    if (!ipLimiter.take(ip)) return err(c, 429, "rate_limited", "Trop de requêtes, réessaie dans une minute.");
    await next();
  });

  // CSRF : toute requête qui modifie quelque chose doit venir de notre origine, en JSON.
  // Exception : les routes appelées par le service worker de l'extension (jeton PKCE, déconnexion par
  // Bearer) n'utilisent aucun cookie ; elles vérifient elles-mêmes origine (chrome-extension://<id
  // autorisé> ou absente) et type de contenu (src/extension.ts). De même pour les routes du panneau Premiere
  // (appairage, jeton, moi, déconnexion : code d'appareil ou Bearer, origine absente, « null » ou « file:// »,
  // src/premiere.ts) ; la page d'accord du site (/api/premiere/demande, autoriser, refuser) reste soumise à ce contrôle.
  app.use("/api/*", async (c, next) => {
    const m = c.req.method;
    // Webhook de Stripe : aucune origine ni cookie, authentifié par la signature de son corps (facturation.ts).
    // AETHRYON Cloud appelé avec une clé d'extension (Bearer, jamais un cookie) : origine contrôlée par cloud/routes.ts.
    if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS" && !EXTENSION_BEARER_PATHS.has(c.req.path) && !PREMIERE_PANEL_PATHS.has(c.req.path) && !DESKTOP_PATHS.has(c.req.path) && c.req.path !== WEBHOOK_PATH && !isCloudBearer(c.req.path, c.req.header("authorization")) && !isMusicBearer(c.req.path, c.req.header("authorization"))) {
      if (c.req.header("origin") !== cfg.publicOrigin) return err(c, 403, "invalid_origin", "Requête refusée (origine inattendue).");
      // Un type « simple » (formulaire, texte) est refusé partout ; hors Better Auth, le JSON est obligatoire.
      const ct = (c.req.header("content-type") ?? "").toLowerCase();
      const isJson = ct.startsWith("application/json");
      // Morceau d'un fichier importé (AETHRYON Tools) : octets bruts, même origine exigée (contrôlée ci-dessus).
      const isChunk = m === "PUT" && TOOLS_CHUNK_PATH.test(c.req.path) && ct === "application/octet-stream";
      if (!isChunk && ((ct && !isJson) || (!ct && !c.req.path.startsWith("/api/auth/")))) {
        return err(c, 415, "unsupported_media_type", "Le corps de la requête doit être du JSON.");
      }
    }
    await next();
  });

  // Session (hors routes Better Auth) : l'utilisateur vient toujours de la base, pour son état réel.
  // Les routes de l'extension authentifiées par code PKCE ou par Bearer ne lisent JAMAIS la session :
  // un cookie ne peut pas y remplacer la clé d'extension.
  app.use("/api/*", async (c, next) => {
    c.set("user", null);
    c.set("sessionId", null);
    if (!c.req.path.startsWith("/api/auth/") && !EXTENSION_BEARER_PATHS.has(c.req.path) && !PREMIERE_PANEL_PATHS.has(c.req.path) && !DESKTOP_PATHS.has(c.req.path) && !DISCORD_SESSIONLESS_PATHS.has(c.req.path) && c.req.path !== WEBHOOK_PATH && !isCloudBearer(c.req.path, c.req.header("authorization")) && !isMusicBearer(c.req.path, c.req.header("authorization"))) {
      const sess = await auth.api.getSession({ headers: c.req.raw.headers });
      if (sess?.user) {
        const row = db.prepare('SELECT id, email, name, role, status, "createdAt", "lastLoginAt" FROM "user" WHERE id = ?').get(sess.user.id) as
          | { id: string; email: string; name: string; role: string | null; status: string | null; createdAt: unknown; lastLoginAt: unknown }
          | undefined;
        if (row && row.status !== "suspended") {
          c.set("user", {
            id: row.id, email: row.email, name: row.name, role: row.role ?? "user", status: row.status ?? "active",
            createdAt: toIso(row.createdAt) ?? nowIso(), lastLoginAt: toIso(row.lastLoginAt),
          });
          c.set("sessionId", typeof sess.session?.id === "string" ? sess.session.id : null);
        }
      }
    }
    await next();
  });

  const requireUser = (c: Context<{ Variables: Vars }>): SessionUser | null => c.get("user");
  const unauthorized = (c: Context) => err(c, 401, "unauthorized", "Connecte-toi pour continuer.");

  // ---- public ------------------------------------------------------------------------------
  app.get("/api/health", (c) => c.json({ status: "ok" }));

  app.get("/api/config", (c) => {
    const st = getSettings(db);
    return c.json({
      googleEnabled: cfg.google !== null,
      // V3.5 : « Continuer avec Discord » (compte déjà lié seulement).
      discordLogin: s.discord.loginEnabled,
      // Inscription et connexion par e-mail et mot de passe (relais SMTP configuré).
      emailEnabled: s.mails.enabled,
      keysActive: cfg.keysActive,
      signupsOpen: st.signupsOpen,
      icloudUrl: st.shortcutUrl ?? cfg.icloudShortcutUrl, // une seule source : réglage, sinon ICLOUD_SHORTCUT_URL
      maintenanceMessage: st.maintenanceMessage,
      platforms: st.platforms,
      shortcutVersion: cfg.shortcutVersion,
      fallbackDownload: cfg.fallbackDownload,
      apiPublicUrl: cfg.apiPublicUrl,
      quotas: {
        daily: st.dailyLimit ?? cfg.dailyConversions, maxActive: st.maxActive ?? cfg.maxActiveJobs, maxKeys: cfg.maxKeysPerUser,
        // Minutes d'export de Tools de Gratuit, seulement quand une limite s'applique (TOOLS_EXPORT_LIMIT=1 ou
        // PLANS_ACTIVE=1) ; null : aucune limite quotidienne (le site n'annonce alors aucune ligne « export »).
        exportMinutes: cfg.toolsExportLimit || cfg.plansActive ? PLANS.free.limits.exportMinutesDaily : null,
      },
      changelog: CHANGELOG,
    });
  });

  app.get("/api/status", async (c) => c.json(await status.get()));

  // ---- Better Auth -------------------------------------------------------------------------
  // Seules les routes Better Auth réellement utilisées sont ouvertes (liste blanche). Les autres —
  // dont update-user, link-social, les routes du plugin de clés — répondent 404 : tout passe par /api/keys.
  // L'inscription par e-mail de Better Auth (/sign-up/email) reste FERMÉE : elle passe par /api/inscription/*
  // (adresse vérifiée avant la création, signup.ts). Connexion par mot de passe, mot de passe oublié et changement de
  // mot de passe (session + mot de passe actuel) : seulement quand l'envoi d'e-mails est configuré.
  const AUTH_ROUTES = new Set(["/api/auth/sign-in/social", "/api/auth/callback/google", "/api/auth/get-session",
    "/api/auth/sign-out", "/api/auth/delete-user", "/api/auth/ok", "/api/auth/error",
    // V3.5 : session ouverte par un ticket de connexion Discord (discord.ts), seulement si la fonction est ouverte.
    ...(s.discord.loginEnabled ? ["/api/auth/discord-session"] : []),
    ...(s.mails.enabled ? ["/api/auth/sign-in/email", "/api/auth/request-password-reset", "/api/auth/reset-password", "/api/auth/change-password"] : [])]);
  app.on(["GET", "POST"], "/api/auth/*", (c) => {
    if (!AUTH_ROUTES.has(c.req.path)) return err(c, 404, "not_found", "Route inconnue.");
    if (c.req.path === "/api/auth/sign-in/social" && !cfg.google) {
      return err(c, 503, "google_disabled", "La connexion Google n'est pas encore configurée sur ce serveur.");
    }
    return auth.handler(c.req.raw);
  });
  app.all("/api/auth/*", (c) => err(c, 404, "not_found", "Route inconnue."));

  // ---- inscription par e-mail (signup.ts) -----------------------------------------------------
  mountSignup(app, s);

  // ---- abonnement : offre réelle et « Me prévenir » (abonnement.ts) ----------------------------
  mountAbonnement(app, s);
  // ---- facturation : paiement, portail, factures, webhook (facturation.ts) ---------------------
  mountFacturation(app, s);

  // ---- compte ------------------------------------------------------------------------------
  app.get("/api/me", (c) => {
    const user = requireUser(c);
    if (!user) return unauthorized(c);
    const { today, policy } = usage.todayWithPolicy(user.id);
    // Façons de se connecter à ce compte (page « Ton compte ») : Google relié, mot de passe défini. Rien d'autre.
    const providers = (db.prepare("SELECT providerId FROM account WHERE userId = ?").all(user.id) as { providerId: string }[]).map((r) => r.providerId);
    return c.json({
      user,
      today, // { used, limit, remaining, unlimited, bonus, resetAt } ; limit et remaining valent null si illimité
      keys: { active: keys.activeCount(user.id), max: cfg.maxKeysPerUser },
      maxActive: policy.maxActive,
      login: { google: providers.includes("google"), password: providers.includes("credential") },
      // Tools : minutes d'export pondérées du jour (limit null : aucune limite, rôle admin).
      exportMinutes: { used: usage.exportUsed(user.id), limit: usage.exportLimit(user.id) },
    });
  });

  app.get("/api/keys", (c) => {
    const user = requireUser(c);
    if (!user) return unauthorized(c);
    return c.json({ keys: keys.list(user.id) });
  });

  app.post("/api/keys", async (c) => {
    const user = requireUser(c);
    if (!user) return unauthorized(c);
    if (!mutateLimiter.take(user.id)) return err(c, 429, "rate_limited", "Trop de jetons créés en peu de temps : réessaie dans une heure.");
    const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; expiresInDays?: unknown };
    const out = await keys.create(user.id, body.name, body.expiresInDays);
    log("info", "key created", { user: user.id, key: out.key.id });
    return c.json(out, 201);
  });

  app.patch("/api/keys/:id", async (c) => {
    const user = requireUser(c);
    if (!user) return unauthorized(c);
    const body = (await c.req.json().catch(() => ({}))) as { name?: unknown };
    return c.json({ key: await keys.rename(user.id, c.req.param("id"), body.name) });
  });

  app.post("/api/keys/:id/revoke", async (c) => {
    const user = requireUser(c);
    if (!user) return unauthorized(c);
    if (!revokeLimiter.take(user.id)) return err(c, 429, "rate_limited", "Trop de requêtes, réessaie plus tard.");
    const key = await keys.revoke(user.id, c.req.param("id"));
    log("info", "key revoked", { user: user.id, keyRef: key.id });
    return c.json({ key });
  });

  app.post("/api/keys/:id/rotate", async (c) => {
    const user = requireUser(c);
    if (!user) return unauthorized(c);
    if (!mutateLimiter.take(user.id)) return err(c, 429, "rate_limited", "Trop de jetons créés en peu de temps : réessaie dans une heure.");
    const out = await keys.rotate(user.id, c.req.param("id"));
    log("info", "key rotated", { user: user.id, keyRef: out.key.id });
    return c.json(out, 201);
  });

  app.post("/api/keys/check", async (c) => {
    const user = requireUser(c);
    if (!user) return unauthorized(c);
    if (!checkLimiter.take(user.id)) return err(c, 429, "rate_limited", "Trop de vérifications, réessaie dans une minute.");
    const body = (await c.req.json().catch(() => ({}))) as { secret?: unknown };
    return c.json(await keys.check(user.id, body.secret));
  });

  app.get("/api/activity", (c) => {
    const user = requireUser(c);
    if (!user) return unauthorized(c);
    const limit = Number(c.req.query("limit") ?? "50");
    return c.json({ items: usage.activity(user.id, Number.isFinite(limit) ? limit : 50), today: usage.today(user.id) });
  });

  app.get("/api/account/export", (c) => {
    const user = requireUser(c);
    if (!user) return unauthorized(c);
    const data = {
      exportedAt: nowIso(),
      user,
      // Toutes les clés, y compris celles de 15 min émises pour le bot Discord (type « discord »).
      keys: keys.list(user.id, { includeDiscord: true }),
      usage: usage.activity(user.id, 200),
      // Liaison Discord (docs/DISCORD-BOT.md §17) : identifiant et nom Discord seulement, ou null.
      discord: discord.exportFor(user.id),
      // Bot Discord v2 (docs/DISCORD-BOT.md §18) : préférences modifiées et médias enregistrés (références).
      library: s.library.exportFor(user.id),
      // Offre et facturation : offre effective, droits, contrats (références Stripe, dates, montants), demandes
      // expresses de démarrage, « Me prévenir ». Aucune donnée de carte : elles ne passent jamais par AETHRYON.
      abonnement: {
        offre: effectivePlan(usage.entitlements(user.id)).id,
        prevenir: waitlistOf(db, user.id),
        droits: db.prepare("SELECT plan, source, starts_at, ends_at, revoked_at FROM ytc_entitlement WHERE user_id = ? ORDER BY starts_at").all(user.id),
        abonnements: db.prepare("SELECT stripe_subscription_id AS reference, plan, status, current_period_end, cancel_at_period_end, created_at, canceled_at FROM ytc_billing_subscription WHERE user_id = ? ORDER BY created_at").all(user.id),
        achats: db.prepare("SELECT stripe_session_id AS reference, plan, amount, currency, refunded_amount, dispute_status, paid_at FROM ytc_billing_purchase WHERE user_id = ? ORDER BY paid_at").all(user.id),
        consentements: db.prepare("SELECT kind, text_version, plan, created_at FROM ytc_billing_consent WHERE user_id = ? ORDER BY created_at").all(user.id),
        exports_outils: db.prepare("SELECT day, op, minutes, state FROM ytc_tools_export WHERE user_id = ? ORDER BY created_at DESC LIMIT 500").all(user.id),
        historique_musique: db.prepare("SELECT action, url, connecteur, titre, etat, origine, created_at FROM ytc_music_historique WHERE user_id = ? ORDER BY id DESC LIMIT 200").all(user.id),
      },
      note: "Les jetons eux-mêmes ne sont jamais conservés en clair et ne peuvent donc pas être exportés.",
    };
    c.header("Content-Disposition", 'attachment; filename="youtube-converter-mes-donnees.json"');
    return c.json(data);
  });

  // ---- extension navigateur (docs/EXTENSION.md §7) ------------------------------------------
  mountExtension(app, s);

  // ---- AETHRYON pour Premiere Pro : page d'accord (premiere.ts, V2-CONNEXION.md) ---------------
  mountPremiere(app, s);
  mountDesktop(app, s);

  // ---- liaison Discord (docs/DISCORD-BOT.md §17) ----------------------------------------------
  mountDiscord(app, s);

  // ---- AETHRYON Tools (docs/OUTILS.md) ----------------------------------------------------------
  mountOutils(app, s);

  // ---- AETHRYON Cloud V1 : administrateur seulement (src/cloud/routes.ts) ------------------------
  mountCloud(app, s);
  mountMusic(app, s);

  // ---- administration (docs/ADMIN.md §2 et §6) ----------------------------------------------
  mountAdmin(app, s);

  app.notFound((c) => err(c, 404, "not_found", "Route inconnue."));
  app.onError((e, c) => {
    if (e instanceof KeyError || e instanceof HttpError) return err(c, e.status, e.code, e.message);
    log("error", "unhandled error", { path: c.req.path, err: String(e) });
    return err(c, 500, "internal_error", "Une erreur interne est survenue. Réessaie dans un instant.");
  });
  return app;
}

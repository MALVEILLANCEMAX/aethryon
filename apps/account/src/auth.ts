// Instance Better Auth : Google, et e-mail + mot de passe quand l'envoi d'e-mails est configuré ; sessions par cookie,
// plugin de clés API.
// Choix de sécurité (voir docs/CONTRAT.md §4 et README) :
// - jetons Google (access/refresh/id) jamais stockés, avatar non stocké ;
// - e-mail Google non vérifié refusé, plafond d'inscriptions, liste blanche optionnelle ;
// - inscription par e-mail : adresse vérifiée AVANT la création du compte (signup.ts) ; Better Auth ne crée un compte
//   « e-mail » que sur l'appel interne marqué (SIGNUP_HEADER), sa route publique restant fermée (app.ts) ;
// - liaison Google ↔ mot de passe seulement pour la même adresse, vérifiée des deux côtés (aucun compte non vérifié
//   n'existe), coupée sans envoi d'e-mails ;
// - limite de vérification par clé du plugin désactivée (sinon 10 vérifications par jour !) ;
// - les clés d'un utilisateur supprimé sont effacées (pas de clé de table étrangère dans le plugin).
import { betterAuth } from "better-auth";
import { APIError, createAuthEndpoint, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { BetterAuthPlugin } from "better-auth";
import { apiKey } from "@better-auth/api-key";
import type { Config } from "./config.ts";
import type { DB } from "./db.ts";
import { bootstrapAdmin, countActiveAdmins } from "./roles.ts";
import { getSettings } from "./settings.ts";
import { nowIso } from "./time.ts";
import { log } from "./log.ts";
import type { AccountMails } from "./mails.ts";
import { PASSWORD_MAX, PASSWORD_MIN, SIGNUP_HEADER, SIGNUP_MARK } from "./signup.ts";
import { passwordProblem } from "./password-policy.ts";

const NO_PROVIDER_TOKENS = {
  accessToken: null,
  refreshToken: null,
  idToken: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
};

// `db` est la connexion « auth » : les hooks s'exécutent dans le flux Better Auth (parfois dans sa
// transaction) et doivent donc utiliser cette même connexion, en instructions synchrones.
export interface AuthHooks {
  beforeDeleteUser?: (userId: string) => Promise<void>;
  /** V3.5 : ticket d'une connexion par Discord (discord.ts consumeTicket) → compte et page de retour, une fois. */
  discordTicket?: (ticket: string, nonce: string | null) => { userId: string; retour: string } | null;
}

/** Valeur d'un cookie dans l'en-tête Cookie (sans décodage : nos jetons sont en base64url). */
function cookieValue(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=") || null;
  }
  return null;
}

/**
 * V3.5 : « Continuer avec Discord ». La route GET /api/auth/discord-session reçoit le ticket d'une minute remis par le
 * retour de Discord (discord.ts : Discord vérifié, compte DÉJÀ lié, même navigateur) et ouvre la session avec les
 * outils de Better Auth (création, cookie signé, hooks de session : compte suspendu refusé, dernière connexion notée).
 */
function discordSession(cfg: Config, hooks: AuthHooks): BetterAuthPlugin {
  const secure = cfg.publicUrl.startsWith("https://");
  return {
    id: "aethryon-discord-session",
    endpoints: {
      aethryonDiscordSession: createAuthEndpoint("/discord-session", { method: "GET" }, async (ctx) => {
        const vers = (raison: string) => ctx.redirect(`${cfg.publicUrl}/connexion?discord=${raison}`);
        const req = ctx.request;
        if (!req || !hooks.discordTicket) throw vers("fermee");
        const ticket = new URL(req.url).searchParams.get("ticket") ?? "";
        const t = hooks.discordTicket(ticket, cookieValue(req.headers.get("cookie"), "aethryon_dl"));
        ctx.setCookie("aethryon_dl", "", { path: "/api", maxAge: 0, httpOnly: true, secure, sameSite: "lax" });
        if (!t) throw vers("expiree");
        const user = await ctx.context.internalAdapter.findUserById(t.userId);
        if (!user) throw vers("expiree");
        let session;
        try {
          session = await ctx.context.internalAdapter.createSession(t.userId);
        } catch {
          throw vers("suspendu"); // hook de création de session : compte suspendu
        }
        await setSessionCookie(ctx, { session, user });
        throw ctx.redirect(`${cfg.publicUrl}${t.retour}`);
      }),
    },
  };
}

export function createAuth(cfg: Config, db: DB, mails: AccountMails | null = null, hooks: AuthHooks = {}) {
  const emailOn = mails?.enabled === true;
  return betterAuth({
    appName: "YouTube Converter",
    baseURL: cfg.publicUrl,
    basePath: "/api/auth",
    secret: cfg.authSecret,
    database: db,
    trustedOrigins: [cfg.publicOrigin],
    telemetry: { enabled: false },
    onAPIError: { errorURL: `${cfg.publicUrl}/connexion` },
    emailAndPassword: emailOn
      ? {
          enabled: true,
          // L'adresse est vérifiée AVANT la création (signup.ts) : le compte naît vérifié, la session s'ouvre aussitôt.
          requireEmailVerification: false,
          autoSignIn: true,
          minPasswordLength: PASSWORD_MIN,
          maxPasswordLength: PASSWORD_MAX,
          resetPasswordTokenExpiresIn: 3600,
          revokeSessionsOnPasswordReset: true,
          // Envoi en arrière-plan (mails.ts) : la réponse ne dit pas si l'adresse a un compte.
          sendResetPassword: async ({ user, token }) => { mails!.resetPassword(user.email, token); },
        }
      : { enabled: false },
    socialProviders: cfg.google
      ? {
          google: {
            clientId: cfg.google.clientId,
            clientSecret: cfg.google.clientSecret,
            prompt: "select_account",
            disableIdTokenSignIn: true,
          },
        }
      : {},
    session: { expiresIn: cfg.sessionDays * 86_400, updateAge: 86_400 },
    account: { updateAccountOnSignIn: false, accountLinking: emailOn ? { enabled: true, trustedProviders: ["google"], requireLocalEmailVerified: true, allowDifferentEmails: false } : { enabled: false } },
    user: {
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "user", input: false },
        status: { type: "string", required: false, defaultValue: "active", input: false },
        lastLoginAt: { type: "date", required: false, input: false },
        // Ancien quota personnalisé : repris dans ytc_user_policy par la migration 003 et plus lu depuis.
        // La colonne reste déclarée pour que la reprise (et un éventuel retour arrière) la trouve.
        dailyLimitOverride: { type: "number", required: false, input: false },
      },
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          // Le dernier administrateur actif ne peut pas supprimer son compte (verrouillage de l'administration).
          const row = db.prepare('SELECT role, status FROM "user" WHERE id = ?').get(user.id) as { role: string | null; status: string | null } | undefined;
          if (row?.role === "admin" && row.status !== "suspended" && countActiveAdmins(db, user.id) === 0) {
            throw new APIError("FORBIDDEN", { code: "last_admin", message: "Tu es le dernier administrateur actif\u00a0: nomme d'abord un autre administrateur avant de supprimer ton compte." });
          }
          // Abonnement payant : résilié chez Stripe AVANT la suppression ; sinon la suppression est refusée.
          try {
            await hooks.beforeDeleteUser?.(user.id);
          } catch (e) {
            const known = e instanceof Error && "code" in e && typeof (e as { code?: unknown }).code === "string";
            throw new APIError("BAD_REQUEST", {
              code: known ? (e as { code: string }).code : "billing_cancel_failed",
              message: known ? e.message : "La résiliation de ton abonnement n'a pas pu être confirmée\u00a0: réessaie dans un instant.",
            });
          }
          // Le plugin n'a pas de clé étrangère vers "user" : sans cela, les clés resteraient valides.
          // ytc_usage et ytc_key_meta suivent par ON DELETE CASCADE.
          db.prepare("DELETE FROM apikey WHERE referenceId = ?").run(user.id);
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            // Compte « e-mail » : seulement par l'appel interne de signup.ts (adresse déjà vérifiée par son lien).
            const viaEmail = ctx?.path === "/sign-up/email";
            if (viaEmail && (!emailOn || ctx?.headers?.get(SIGNUP_HEADER) !== SIGNUP_MARK)) {
              throw new APIError("FORBIDDEN", { code: "email_signup_disabled", message: "Inscription par e-mail fermée." });
            }
            if (!viaEmail && user.emailVerified !== true) {
              throw new APIError("FORBIDDEN", { code: "email_not_verified", message: "Adresse e-mail Google non vérifiée." });
            }
            const email = String(user.email ?? "").toLowerCase();
            if (cfg.allowedEmails.size > 0 && !cfg.allowedEmails.has(email)) {
              throw new APIError("FORBIDDEN", { code: "not_invited", message: "Ce compte n'est pas invité." });
            }
            if (!getSettings(db).signupsOpen) {
              throw new APIError("FORBIDDEN", { code: "signups_closed", message: "Les inscriptions sont fermées." });
            }
            // Les comptes suspendus ne bloquent pas les places (ils peuvent être supprimés par l'admin).
            const { n } = db.prepare('SELECT count(*) AS n FROM "user" WHERE status IS NULL OR status <> \'suspended\'').get() as { n: number };
            if (n >= cfg.maxUsers) {
              throw new APIError("FORBIDDEN", { code: "signups_closed", message: "Les inscriptions sont fermées." });
            }
            // Toujours « user » à la création : la promotion éventuelle (ADMIN_EMAILS) se fait à la création
            // de la session, une fois la liaison Google enregistrée (docs/ADMIN.md §1).
            return {
              data: { ...user, emailVerified: true, image: null, role: "user", status: "active" },
            };
          },
        },
        update: {
          // Défense en profondeur (la route update-user est de toute façon fermée) : pas d'avatar,
          // nom borné, aucun champ de rôle ou d'état modifiable.
          before: async (data) => {
            const out: Record<string, unknown> = { ...data, image: null };
            if ("name" in data) {
              const name = typeof data.name === "string" ? data.name.trim().slice(0, 80) : "";
              if (!name) throw new APIError("BAD_REQUEST", { code: "invalid_name", message: "Nom invalide." });
              out.name = name;
            }
            return { data: out };
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const row = db.prepare('SELECT status FROM "user" WHERE id = ?').get(session.userId) as
              | { status: string | null }
              | undefined;
            if (row?.status === "suspended") {
              throw new APIError("FORBIDDEN", { code: "account_suspended", message: "Ce compte est suspendu." });
            }
            if (row) {
              db.prepare('UPDATE "user" SET "lastLoginAt" = ? WHERE id = ?').run(nowIso(), session.userId);
              // Amorçage seulement (e-mail dans ADMIN_EMAILS, vérifié, liaison Google) ; jamais de
              // rétrogradation automatique : le rôle en base fait foi.
              // Un échec de l'amorçage n'empêche pas la connexion (le compte reste « user », erreur journalisée).
              try {
                if (bootstrapAdmin(db, session.userId, cfg.adminEmails)) log("info", "role bootstrap", { user: session.userId });
              } catch (e) {
                log("error", "role bootstrap failed", { user: session.userId, err: String(e) });
              }
            }
            return { data: session };
          },
        },
      },
      account: {
        create: { before: async (account) => ({ data: { ...account, ...NO_PROVIDER_TOKENS } }) },
        update: { before: async (account) => ({ data: { ...account, ...NO_PROVIDER_TOKENS } }) },
      },
    },
    // Politique des mots de passe (password-policy.ts) aussi sur le changement et la réinitialisation : le site affiche
    // exactement les mêmes règles ; l'inscription l'applique dans signup.ts. La règle « différent de ton adresse et de
    // ton nom » a besoin du compte : la session (changement) ou le lien encore valable (réinitialisation, lu sans être
    // consommé — un refus laisse le lien utilisable). Lien inconnu : rien à vérifier, Better Auth le refuse ensuite.
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/change-password" && ctx.path !== "/reset-password") return;
        const body = ctx.body as { newPassword?: unknown; token?: unknown } | undefined;
        const pw = body?.newPassword;
        if (typeof pw !== "string") return; // Better Auth refuse ensuite le corps invalide
        let who: { email?: string; name?: string } = {};
        if (ctx.path === "/change-password") {
          const session = await getSessionFromCtx(ctx, { disableRefresh: true });
          if (session) who = { email: session.user.email, name: session.user.name };
        } else {
          const token = typeof body?.token === "string" ? body.token : typeof ctx.query?.token === "string" ? ctx.query.token : "";
          const row = token ? await ctx.context.internalAdapter.findVerificationValue(`reset-password:${token}`) : null;
          if (row && new Date(row.expiresAt).getTime() > Date.now()) {
            const user = await ctx.context.internalAdapter.findUserById(row.value);
            if (user) who = { email: user.email, name: user.name };
          }
        }
        const problem = passwordProblem(pw, who);
        if (problem) throw new APIError("BAD_REQUEST", { code: problem.code.toUpperCase(), message: problem.message });
      }),
    },
    rateLimit: {
      enabled: true, storage: "memory", window: 60, max: 120,
      // Mot de passe : 5 essais par minute et par adresse IP ; liens de réinitialisation : 3 par 10 minutes.
      customRules: { "/sign-in/email": { window: 60, max: 5 }, "/request-password-reset": { window: 600, max: 3 }, "/reset-password": { window: 600, max: 10 }, "/change-password": { window: 600, max: 5 } },
    },
    advanced: {
      useSecureCookies: cfg.publicUrl.startsWith("https://"),
      ipAddress: { ipAddressHeaders: [cfg.ipHeader] },
    },
    plugins: [
      apiKey({
        defaultPrefix: "ytc_",
        enableSessionForAPIKeys: false,
        rateLimit: { enabled: false },
        requireName: true,
        maximumNameLength: 40,
        // Durées en JOURS. Minimum 0,01 jour (14 min 24 s) : clés « discord » de 15 min (docs/DISCORD-BOT.md §17),
        // créées côté serveur seulement ; les durées proposées aux utilisateurs restent 30, 90 ou 365 jours (keys.ts).
        keyExpiration: { defaultExpiresIn: null, minExpiresIn: 0.01, maxExpiresIn: 365 },
      }),
      discordSession(cfg, hooks),
    ],
    logger: {
      level: "warn",
      log: (level, message) => log(level === "error" ? "error" : "warn", `better-auth: ${message}`),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

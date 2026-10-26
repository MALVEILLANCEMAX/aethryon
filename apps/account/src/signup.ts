// Inscription par e-mail et mot de passe (docs/CONTRAT.md, « Inscription par e-mail »). L'adresse est VÉRIFIÉE AVANT
// que le compte n'existe :
//   1. POST /api/inscription/demande {email} : un CODE à 6 chiffres (10 min) et un lien de secours (30 min) envoyés à
//      l'adresse, OU, si un compte existe déjà, un e-mail le disant à son propriétaire. Réponse identique dans les deux
//      cas (rien ne dit à un tiers si une adresse a un compte) ; envoi en arrière-plan. Une nouvelle demande annule la
//      précédente (un seul code valable à la fois).
//   1 bis. POST /api/inscription/code {email, code} : le code saisi sur la page (sans quitter l'onglet). Code tiré au
//      hasard (crypto.randomInt), gardé en HMAC lié à la demande (jamais en clair, jamais journalisé), 5 essais au plus
//      (au 5e échec, la demande est annulée, lien compris), usage unique ; réponse d'erreur identique quelle qu'en soit la
//      raison. Réussi : un jeton neuf remplace celui du lien (15 min) et sert à l'étape 3.
//   2. POST /api/inscription/verifier {token} : l'adresse visée par un lien encore valable (page « Termine ton
//      inscription »).
//   3. POST /api/inscription/terminer {token, name, password} : le lien est consommé, puis le compte est créé par Better
//      Auth (mot de passe haché par Better Auth, session ouverte). La route d'inscription de Better Auth reste FERMÉE au
//      public (liste blanche de app.ts) : seul ce serveur l'appelle, avec une marque connue de lui seul.
// Conséquences : aucun compte non vérifié n'existe jamais, personne ne peut réserver l'adresse d'un autre ni la relier
// ensuite à un compte Google ; la liaison Google ↔ mot de passe (même adresse, vérifiée des deux côtés) est donc sûre.
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import type { Services } from "./app.ts";
import { err, Limiter, type Vars } from "./http.ts";
import { log } from "./log.ts";
import { SAFE_ADDRESS } from "./mailer.ts";
import { PASSWORD_MAX, PASSWORD_MIN, passwordProblem } from "./password-policy.ts";
import { getSettings } from "./settings.ts";

export { PASSWORD_MAX, PASSWORD_MIN } from "./password-policy.ts";
export const TOKEN_TTL_MS = 30 * 60_000;
/** Code à 6 chiffres : 10 minutes, 5 essais, un nouvel envoi au plus par minute et par adresse. */
export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 10 * 60_000;
export const CODE_ATTEMPTS = 5;
/** Délai par défaut entre deux envois à la même adresse (réglage SIGNUP_RESEND_S). */
export const RESEND_AFTER_S = 60;
/** Après un code juste : 15 minutes pour choisir son nom et son mot de passe. */
export const TICKET_TTL_MS = 15 * 60_000;
/** En-tête posé par ce serveur seul sur l'appel interne à Better Auth (auth.ts, création du compte). */
export const SIGNUP_HEADER = "x-ytc-signup";
/** Marque du processus : tirée au démarrage, jamais exposée ; sans elle, Better Auth refuse de créer un compte par e-mail. */
export const SIGNUP_MARK = randomBytes(32).toString("hex");

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const CODE_RE = /^[0-9]{6}$/;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
/** Code à 6 chiffres, uniforme (crypto.randomInt), zéros de tête compris. */
export const newCode = (): string => String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");

/** Adresse normalisée (minuscules, sans espaces autour) si elle est acceptable, sinon null. */
export function normalizeEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return e.length <= 254 && SAFE_ADDRESS.test(e) ? e : null;
}

/** Nom affiché : 1 à 80 caractères, sans caractère de contrôle. */
export function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const n = v.normalize("NFC").replace(/\s+/g, " ").trim();
  return n.length >= 1 && n.length <= 80 && !/[\u0000-\u001f\u007f]/.test(n) ? n : null;
}

/** Corps JSON avec exactement les clés attendues (toutes des chaînes), sinon null. */
async function body<K extends string>(c: { req: { json: () => Promise<unknown> } }, keys: readonly K[]): Promise<Record<K, string> | null> {
  let b: unknown;
  try { b = await c.req.json(); } catch { return null; }
  if (!b || typeof b !== "object" || Array.isArray(b)) return null;
  const o = b as Record<string, unknown>;
  if (Object.keys(o).some((k) => !(keys as readonly string[]).includes(k)) || keys.some((k) => typeof o[k] !== "string")) return null;
  return o as Record<K, string>;
}

export function mountSignup(app: Hono<{ Variables: Vars }>, s: Services): void {
  const { cfg, db, auth, mails } = s;
  const ipLimiter = new Limiter(5, 10 * 60_000);       // demandes : 5 par 10 min et par adresse IP
  const emailLimiter = new Limiter(3, 60 * 60_000);    // 3 e-mails par heure et par adresse visée
  const resendLimiter = new Limiter(1, cfg.signupResendS * 1000); // un envoi par minute et par adresse (SIGNUP_RESEND_S)
  const checkLimiter = new Limiter(30, 10 * 60_000);   // vérifications et fins d'inscription : 30 par 10 min et par IP
  const codeLimiter = new Limiter(10, 15 * 60_000);    // codes saisis : 10 par 15 min et par adresse (en plus des 5 essais)
  // Clé des empreintes de codes : dérivée du secret du serveur (un vol de la base ne suffit pas à retrouver un code).
  const codeKey = createHash("sha256").update(`ytc-signup-code:${cfg.authSecret}`).digest();
  const codeHash = (rowKey: string, code: string) => createHmac("sha256", codeKey).update(`${rowKey}:${code}`).digest();
  const ip = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header(cfg.ipHeader) ?? "unknown";
  const closed = (c: Parameters<typeof err>[0]) => err(c, 503, "email_signup_disabled", "L'inscription par e-mail n'est pas ouverte sur ce serveur.");
  const signupsClosed = (): boolean => {
    if (!getSettings(db).signupsOpen) return true;
    const { n } = db.prepare('SELECT count(*) AS n FROM "user" WHERE status IS NULL OR status <> \'suspended\'').get() as { n: number };
    return n >= cfg.maxUsers;
  };
  const now = () => new Date().toISOString();
  /** Lien encore valable (non consommé, non expiré) : l'adresse visée, sinon null. */
  const pending = (token: string): string | null => {
    const r = db.prepare("SELECT email FROM ytc_signup_token WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?").get(hash(token), now()) as { email: string } | undefined;
    return r?.email ?? null;
  };

  app.post("/api/inscription/demande", async (c) => {
    if (!mails.enabled) return closed(c);
    const b = await body(c, ["email"]);
    const email = b ? normalizeEmail(b.email) : null;
    if (!email) return err(c, 400, "invalid_email", "Adresse e-mail invalide.");
    // Anti-bot (antibot.ts) : chaque demande envoie un e-mail à un tiers → défi Cap vérifié par le serveur.
    const g = await s.antibot.guard(c, "inscription", { email });
    if (g.deny) return g.deny;
    if (!ipLimiter.take(ip(c))) return err(c, 429, "rate_limited", "Trop de demandes : réessaie dans quelques minutes.");
    if (signupsClosed()) return err(c, 403, "signups_closed", "Les inscriptions sont fermées pour le moment.");
    // Même réponse que l'adresse ait un compte ou non, qu'elle soit invitée ou non, que l'e-mail parte ou non.
    const ok = () => c.json({ ok: true, expiresInMinutes: TOKEN_TTL_MS / 60_000, codeLength: CODE_LENGTH, codeExpiresInMinutes: CODE_TTL_MS / 60_000, resendAfterSeconds: cfg.signupResendS }, 202);
    if (!resendLimiter.take(email) || !emailLimiter.take(email)) return ok();
    db.prepare("DELETE FROM ytc_signup_token WHERE expires_at < ?").run(new Date(Date.now() - 86_400_000).toISOString());
    const user = db.prepare('SELECT id FROM "user" WHERE lower(email) = ?').get(email) as { id: string } | undefined;
    if (user) {
      const providers = (db.prepare("SELECT providerId FROM account WHERE userId = ?").all(user.id) as { providerId: string }[]).map((r) => r.providerId);
      mails.existing(email, { google: providers.includes("google"), password: providers.includes("credential") });
      log("info", "signup request", { outcome: "existing" });
      return ok();
    }
    if (cfg.allowedEmails.size > 0 && !cfg.allowedEmails.has(email)) {
      log("info", "signup request", { outcome: "not_invited" });
      return ok();
    }
    const token = randomBytes(32).toString("base64url");
    const code = newCode();
    const t = Date.now();
    const rowKey = hash(token);
    // Une seule demande valable par adresse : la nouvelle annule les précédentes (leur code ET leur lien).
    db.prepare("UPDATE ytc_signup_token SET used_at = ? WHERE email = ? AND used_at IS NULL").run(new Date(t).toISOString(), email);
    db.prepare("INSERT INTO ytc_signup_token (token_hash, email, created_at, expires_at, code_hash, code_expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(rowKey, email, new Date(t).toISOString(), new Date(t + TOKEN_TTL_MS).toISOString(), codeHash(rowKey, code).toString("hex"), new Date(t + CODE_TTL_MS).toISOString());
    mails.signup(email, token, code);
    log("info", "signup request", { outcome: "link" });
    return ok();
  });

  app.post("/api/inscription/code", async (c) => {
    if (!mails.enabled) return closed(c);
    if (!checkLimiter.take(ip(c))) return err(c, 429, "rate_limited", "Trop de tentatives : réessaie dans quelques minutes.");
    const b = await body(c, ["email", "code"]);
    const email = b ? normalizeEmail(b.email) : null;
    const bad = () => err(c, 400, "invalid_code", "Code incorrect ou expiré. Vérifie le dernier e-mail reçu, ou demande un nouveau code.");
    if (!email || !b || !CODE_RE.test(b.code)) return bad();
    if (!codeLimiter.take(email)) return err(c, 429, "rate_limited", "Trop de tentatives : demande un nouveau code dans quelques minutes.");
    const row = db.prepare("SELECT token_hash, code_hash, code_expires_at, code_attempts FROM ytc_signup_token WHERE email = ? AND used_at IS NULL AND code_hash IS NOT NULL ORDER BY created_at DESC LIMIT 1")
      .get(email) as { token_hash: string; code_hash: string; code_expires_at: string; code_attempts: number } | undefined;
    // Toujours un calcul d'empreinte (même durée qu'une demande existe ou non), puis une comparaison à temps constant.
    const candidate = codeHash(row?.token_hash ?? "absente", b.code);
    const stored = row ? Buffer.from(row.code_hash, "hex") : Buffer.alloc(candidate.length);
    const match = stored.length === candidate.length && timingSafeEqual(stored, candidate);
    if (!row || row.code_expires_at <= now() || row.code_attempts >= CODE_ATTEMPTS) return bad();
    if (!match) {
      // 5e échec : la demande est annulée (lien compris) ; il faut un nouveau code.
      db.prepare("UPDATE ytc_signup_token SET code_attempts = code_attempts + 1, used_at = CASE WHEN code_attempts + 1 >= ? THEN ? ELSE used_at END WHERE token_hash = ?")
        .run(CODE_ATTEMPTS, now(), row.token_hash);
      log("info", "signup code", { outcome: "wrong" });
      return bad();
    }
    // Juste : le code ne resservira pas ; un jeton neuf (15 min) remplace celui du lien pour l'étape suivante.
    const ticket = randomBytes(32).toString("base64url");
    const swapped = db.prepare("UPDATE ytc_signup_token SET token_hash = ?, code_hash = NULL, code_expires_at = NULL, expires_at = ? WHERE token_hash = ? AND used_at IS NULL AND code_hash IS NOT NULL")
      .run(hash(ticket), new Date(Date.now() + TICKET_TTL_MS).toISOString(), row.token_hash);
    if (Number(swapped.changes) !== 1) return bad();
    log("info", "signup code", { outcome: "ok" });
    return c.json({ ok: true, token: ticket, email });
  });

  app.post("/api/inscription/verifier", async (c) => {
    if (!mails.enabled) return closed(c);
    if (!checkLimiter.take(ip(c))) return err(c, 429, "rate_limited", "Trop de tentatives : réessaie dans quelques minutes.");
    const b = await body(c, ["token"]);
    const email = b && TOKEN_RE.test(b.token) ? pending(b.token) : null;
    if (!email) return err(c, 400, "invalid_token", "Ce lien n'est plus valable : il a expiré ou a déjà servi.");
    return c.json({ email });
  });

  app.post("/api/inscription/terminer", async (c) => {
    if (!mails.enabled) return closed(c);
    if (!checkLimiter.take(ip(c))) return err(c, 429, "rate_limited", "Trop de tentatives : réessaie dans quelques minutes.");
    const b = await body(c, ["token", "name", "password"]);
    if (!b || !TOKEN_RE.test(b.token)) return err(c, 400, "invalid_token", "Ce lien n'est plus valable : il a expiré ou a déjà servi.");
    const name = cleanName(b.name);
    if (!name) return err(c, 400, "invalid_name", "Indique un nom (80 caractères au plus).");
    if (b.password.length < PASSWORD_MIN || b.password.length > PASSWORD_MAX) {
      return err(c, 400, "invalid_password", `Le mot de passe doit faire entre ${PASSWORD_MIN} et ${PASSWORD_MAX} caractères.`);
    }
    // Politique commune (password-policy.ts) : un mot de passe courant ou reprenant l'adresse est refusé AVANT de
    // consommer le lien, pour qu'on puisse en choisir un autre avec le même lien.
    const target = pending(b.token);
    if (target) {
      const problem = passwordProblem(b.password, { email: target, name });
      if (problem) return err(c, 400, problem.code, problem.message);
    }
    // Lien consommé d'abord (une seule fois, même si deux envois arrivent ensemble).
    const used = db.prepare("UPDATE ytc_signup_token SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING email")
      .get(now(), hash(b.token), now()) as { email: string } | undefined;
    if (!used) return err(c, 400, "invalid_token", "Ce lien n'est plus valable : il a expiré ou a déjà servi.");
    if (db.prepare('SELECT 1 FROM "user" WHERE lower(email) = ?').get(used.email)) {
      return err(c, 409, "account_exists", "Un compte existe déjà avec cette adresse : connecte-toi.");
    }
    const headers = new Headers({ [SIGNUP_HEADER]: SIGNUP_MARK, "user-agent": c.req.header("user-agent") ?? "" });
    const realIp = c.req.header(cfg.ipHeader);
    if (realIp) headers.set(cfg.ipHeader, realIp);
    let res: Response;
    try {
      res = await auth.api.signUpEmail({ body: { email: used.email, name, password: b.password }, headers, asResponse: true });
    } catch (e) {
      log("warn", "signup failed", { err: e instanceof Error ? e.message : "?" });
      return err(c, 500, "signup_failed", "Le compte n'a pas pu être créé. Réessaie avec un nouveau lien.");
    }
    if (!res.ok) {
      let code = "signup_failed";
      try { code = String(((await res.json()) as { code?: string }).code ?? code).toLowerCase(); } catch { /* corps illisible */ }
      if (code === "signups_closed") return err(c, 403, "signups_closed", "Les inscriptions sont fermées pour le moment.");
      log("warn", "signup failed", { status: res.status, code });
      return err(c, 400, "signup_failed", "Le compte n'a pas pu être créé. Réessaie avec un nouveau lien.");
    }
    log("info", "signup done", {});
    for (const v of res.headers.getSetCookie()) c.header("set-cookie", v, { append: true });
    return c.json({ ok: true }, 201);
  });
}

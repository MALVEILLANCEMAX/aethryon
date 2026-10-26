// Connexion de l'extension navigateur AETHRYON (docs/EXTENSION.md §3 et §7) : code d'autorisation à
// usage unique (32 octets, 120 s, seule son empreinte SHA-256 est stockée) + PKCE S256 + `state`, URI de
// retour exacte (EXTENSION_IDS), échangé contre une clé ytc_ de type « extension ».
//
// Deux familles de routes :
// - /authorize et /deny : page de consentement du site → session Better Auth + contrôle CSRF du site
//   (origine du site, JSON), comme toute mutation de l'API publique ;
// - /token, /me, /logout : appelées par le service worker de l'extension, SANS cookie. Elles ne lisent
//   jamais la session (app.ts les exempte du middleware de session et du contrôle d'origine du site) :
//   seul le code + PKCE (token) ou la clé d'extension en Bearer (me, logout) authentifie. Origine admise :
//   absente, ou chrome-extension://<identifiant autorisé>.
// Journaux : identifiants internes seulement, jamais de code, de vérificateur, de jeton ni d'e-mail.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context, Hono } from "hono";
import type { Services } from "./app.ts";
import type { Config } from "./config.ts";
import { writeTx } from "./db.ts";
import { err, HttpError, Limiter, type Vars } from "./http.ts";
import { KeyError, MAX_EXTENSION_KEYS, TOO_MANY_EXTENSIONS_TEXT } from "./keys.ts";
import { log } from "./log.ts";
import { nowIso } from "./time.ts";

const NB = " "; // espace insécable (typographie française)

export const CODE_TTL_MS = 120_000;
/** Codes conservés (utilisés ou expirés) pour reconnaître un rejeu, puis purgés. */
export const CODE_RETENTION_MS = 24 * 3_600_000;
export const DEFAULT_DEVICE_LABEL = "Appareil inconnu";
const DEVICE_MAX = 60;
const ACTIVE_STALE_MS = 3 * 3_600_000;

const B64URL_43 = /^[A-Za-z0-9_-]{43}$/;          // state, code_challenge, code (32 octets en base64url)
const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;  // RFC 7636 §4.1
const BEARER_RE = /^Bearer (ytc_[A-Za-z0-9]{10,196})$/;
const EXT_ORIGIN_RE = /^chrome-extension:\/\/([a-p]{32})$/;

/** Routes appelées par l'extension elle-même : ni session, ni contrôle d'origine du site (app.ts). */
export const EXTENSION_BEARER_PATHS: ReadonlySet<string> = new Set(["/api/extension/token", "/api/extension/me", "/api/extension/logout", "/api/extension/outils"]);

export const redirectUriFor = (extensionId: string) => `https://${extensionId}.chromiumapp.org/aethryon`;

/** URI de retour → identifiant d'extension autorisé (comparaison EXACTE), sinon null. */
export function allowedRedirect(cfg: Config, raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  for (const id of cfg.extensionIds) if (raw === redirectUriFor(id)) return id;
  return null;
}

/**
 * Origine d'une requête de l'extension : absente (acceptée), ou chrome-extension://<id> avec un
 * identifiant autorisé — et, quand l'URI de retour est connue, le même identifiant qu'elle.
 */
export function extensionOriginOk(cfg: Config, origin: string | undefined, expectedId?: string): boolean {
  if (origin === undefined) return true;
  const m = EXT_ORIGIN_RE.exec(origin);
  if (!m || !cfg.extensionIds.includes(m[1]!)) return false;
  return expectedId === undefined || m[1] === expectedId;
}

/** Nom d'appareil envoyé par l'extension : texte nettoyé (contrôle, bidi, largeur nulle), ≤ 60 caractères. */
export function cleanDeviceLabel(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_DEVICE_LABEL;
  const s = raw.slice(0, 1000).normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f­؜᠎​-‏‪-‮⁠-⁯﻿￹-￻]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(s);
  const out = chars.length > DEVICE_MAX ? chars.slice(0, DEVICE_MAX).join("").trimEnd() : s;
  return out || DEFAULT_DEVICE_LABEL;
}

export const codeHash = (code: string) => createHash("sha256").update(code, "utf8").digest("base64url");
export const s256 = (verifier: string) => createHash("sha256").update(verifier, "ascii").digest("base64url");

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null);

// ---- erreurs (français, tutoiement, espaces insécables) ------------------------------------------

const TEXT = {
  invalidRequest: `Demande de connexion invalide${NB}: relance la connexion depuis l'extension AETHRYON.`,
  invalidRedirect: `Adresse de retour non autorisée${NB}: cette extension n'est pas reconnue par AETHRYON.`,
  invalidMethod: `Méthode de vérification non prise en charge${NB}: S256 attendue.`,
  invalidGrant: `Code de connexion invalide, expiré ou déjà utilisé${NB}: relance la connexion depuis l'extension.`,
  invalidOrigin: "Requête refusée (origine inattendue).",
  notJson: "Le corps de la requête doit être du JSON.",
  invalidToken: `Jeton d'extension absent, invalide ou révoqué${NB}: reconnecte l'extension à ton compte.`,
  revokedToken: `L'accès de cette extension à ton compte a été révoqué${NB}: reconnecte-la pour continuer.`,
  expiredToken: `La connexion de cette extension a expiré${NB}: reconnecte-la pour continuer.`,
  suspended: "Ce compte est suspendu.",
  rateLimited: `Trop de tentatives de connexion${NB}: réessaie dans une minute.`,
  tooManyCodes: `Trop de demandes d'autorisation${NB}: réessaie dans quelques minutes.`,
  unauthorized: "Connecte-toi pour continuer.",
  toolsClosed: "AETHRYON Tools n'est pas ouvert sur ce serveur.",
  toolsRateLimited: `Trop de liens « Ouvrir dans Tools » demandés${NB}: réessaie dans quelques minutes.`,
  invalidJob: "Média inconnu.",
} as const;

const invalidGrant = () => new HttpError(400, "invalid_grant", TEXT.invalidGrant);
const invalidRequest = () => new HttpError(400, "invalid_request", TEXT.invalidRequest);

/**
 * Refus d'une clé d'extension présentée en Bearer, avec son motif exact (docs/EXTENSION.md §7), pour que
 * l'extension dise à l'utilisateur pourquoi elle est déconnectée. Le motif n'est donné qu'au porteur de la
 * clé (qui en connaît déjà la valeur) : un jeton inconnu ou d'un autre type reste « invalid_token ».
 * Compte suspendu : 403 (la clé reste valable, l'extension remarche après une réactivation).
 */
export type BearerRefusal =
  | { status: 401; error: "invalid_token" | "token_expired" }
  | { status: 401; error: "token_revoked"; revokedBy: "user" | "admin" | "replay" | null }
  | { status: 403; error: "account_suspended" };
const INVALID_TOKEN: BearerRefusal = { status: 401, error: "invalid_token" };
const EXPIRED_TOKEN: BearerRefusal = { status: 401, error: "token_expired" };
const REVOKED_BY: ReadonlySet<string> = new Set(["user", "admin", "replay"]);
export type BearerOk = { keyId: string; expiresAt: string | null; user: { id: string; email: string; name: string } };

/**
 * Clé d'appareil (type « extension » ou « premiere ») présentée en Bearer → compte, ou refus motivé. La clé est
 * d'abord retrouvée par son empreinte (sans effet de bord) : révoquée ou expirée, le motif est connu avant que Better
 * Auth ne supprime une clé expirée à sa vérification ; une clé déjà purgée n'est plus qu'« invalide ». Une clé d'un
 * autre type reste « invalide » (une clé d'extension n'ouvre pas les routes du panneau Premiere, et inversement).
 */
export async function checkDeviceBearer(s: Services, authorization: string | undefined, kind: "extension" | "premiere" | "desktop"): Promise<BearerOk | BearerRefusal> {
  const { db, auth, keys } = s;
  const m = BEARER_RE.exec(authorization ?? "");
  if (!m) return INVALID_TOKEN;
  const k = await keys.lookupBySecret(m[1]!);
  if (!k || k.kind !== kind) return INVALID_TOKEN;
  if (k.status === "revoked") {
    const meta = db.prepare("SELECT revoked_reason FROM ytc_key_meta WHERE key_id = ?").get(k.id) as { revoked_reason: string | null } | undefined;
    const by = meta?.revoked_reason ?? null;
    return { status: 401, error: "token_revoked", revokedBy: by && REVOKED_BY.has(by) ? by as "user" | "admin" | "replay" : null };
  }
  if (k.status === "expired") return EXPIRED_TOKEN;
  let r: Awaited<ReturnType<typeof auth.api.verifyApiKey>>;
  try { r = await auth.api.verifyApiKey({ body: { key: m[1]! } }); } catch { return INVALID_TOKEN; }
  if (!r.valid || !r.key || r.key.id !== k.id) return r.error?.code === "KEY_EXPIRED" ? EXPIRED_TOKEN : INVALID_TOKEN;
  const u = db.prepare('SELECT id, email, name, status FROM "user" WHERE id = ?').get(r.key.referenceId) as
    { id: string; email: string; name: string | null; status: string | null } | undefined;
  if (!u) return INVALID_TOKEN;
  if (u.status === "suspended") return { status: 403, error: "account_suspended" };
  return { keyId: k.id, expiresAt: k.expiresAt, user: { id: u.id, email: u.email, name: u.name ?? "" } };
}

/** Secret ytc_ d'un en-tête « Authorization: Bearer … » bien formé, sinon null. */
export const bearerSecret = (authorization: string | undefined): string | null => BEARER_RE.exec(authorization ?? "")?.[1] ?? null;

interface CodeRow {
  code_hash: string; user_id: string; redirect_uri: string; code_challenge: string; device_label: string | null;
  key_id: string | null; created_at: string; expires_at: string; used_at: string | null;
}

/** Corps exactement composé des champs attendus (aucun champ inconnu). */
function readFields(body: unknown, allowed: readonly string[], required: readonly string[]): Record<string, unknown> {
  const b = obj(body);
  if (!b) throw invalidRequest();
  for (const k of Object.keys(b)) if (!allowed.includes(k)) throw invalidRequest();
  for (const k of required) if (!(k in b)) throw invalidRequest();
  return b;
}

function readRedirect(cfg: Config, b: Record<string, unknown>): { redirectUri: string; extensionId: string } {
  const extensionId = allowedRedirect(cfg, b.redirect_uri);
  if (!extensionId) throw new HttpError(400, "invalid_redirect_uri", TEXT.invalidRedirect);
  return { redirectUri: b.redirect_uri as string, extensionId };
}

function readState(b: Record<string, unknown>): string {
  if (typeof b.state !== "string" || !B64URL_43.test(b.state)) throw invalidRequest();
  return b.state;
}

export function mountExtension(app: Hono<{ Variables: Vars }>, s: Services): void {
  const { cfg, db, auth, keys, usage } = s;
  const authorizeLimiter = new Limiter(20, 600_000); // codes demandés : 20 par 10 min et par compte
  const tokenLimiter = new Limiter(20, 60_000);      // échanges : 20 par minute et par IP
  const meLimiter = new Limiter(60, 60_000);         // S3 : /api/extension/me, 60 par minute et par clé
  const logoutLimiter = new Limiter(30, 60_000);     // déconnexions : 30 par minute et par IP
  const toolsLimiter = new Limiter(30, 600_000);     // liens « Ouvrir dans Tools » : 30 par 10 min et par clé
  const ipOf = (c: Context) => c.req.header(cfg.ipHeader) ?? "unknown";

  /** Origine + type de contenu des routes de l'extension (JSON exigé si `json`, sinon absent ou JSON). */
  const extensionRequest = (c: Context, opts: { json: boolean; expectedId?: string }): Response | null => {
    if (!extensionOriginOk(cfg, c.req.header("origin"), opts.expectedId)) return err(c, 403, "invalid_origin", TEXT.invalidOrigin);
    const ct = (c.req.header("content-type") ?? "").toLowerCase();
    if (opts.json ? !ct.startsWith("application/json") : ct !== "" && !ct.startsWith("application/json")) {
      return err(c, 415, "unsupported_media_type", TEXT.notJson);
    }
    return null;
  };

  /** Code utilisé (ou brûlé) : n'est plus jamais échangeable. */
  const burn = (hash: string) => writeTx(db, () => {
    db.prepare("UPDATE ytc_ext_code SET used_at = COALESCE(used_at, ?) WHERE code_hash = ?").run(nowIso(), hash);
  });

  /** Code présenté une seconde fois : la clé émise avec lui est révoquée (RFC 6749 §4.1.2). */
  const onReplay = async (row: CodeRow) => {
    log("warn", "extension code replayed", { user: row.user_id, keyRef: row.key_id });
    if (!row.key_id) return;
    try {
      const k = keys.get(row.user_id, row.key_id);
      if (!k.revokedAt) await keys.revoke(row.user_id, row.key_id, "replay");
    } catch (e) {
      if (!(e instanceof KeyError && e.status === 404)) throw e; // clé déjà supprimée : rien à révoquer
    }
  };

  /** Clé d'extension présentée en Bearer → compte, ou refus motivé (checkDeviceBearer). */
  const bearer = (c: Context) => checkDeviceBearer(s, c.req.header("authorization"), "extension");
  const refuse = (c: Context, r: BearerRefusal) => {
    if (r.status === 403) return err(c, 403, r.error, TEXT.suspended);
    c.header("WWW-Authenticate", 'Bearer realm="aethryon"');
    if (r.error === "token_revoked") return c.json({ error: r.error, message: TEXT.revokedToken, revokedBy: r.revokedBy }, 401);
    return err(c, 401, r.error, r.error === "token_expired" ? TEXT.expiredToken : TEXT.invalidToken);
  };
  const invalidToken = (c: Context) => refuse(c, INVALID_TOKEN);

  // ---- page de consentement (session + CSRF du site) ----------------------------------------------

  app.post("/api/extension/authorize", async (c) => {
    const user = c.get("user");
    if (!user) return err(c, 401, "unauthorized", TEXT.unauthorized);
    const b = readFields(await c.req.json().catch(() => null),
      ["redirect_uri", "state", "code_challenge", "code_challenge_method", "appareil"],
      ["redirect_uri", "state", "code_challenge", "code_challenge_method"]);
    const { redirectUri } = readRedirect(cfg, b);
    const state = readState(b);
    if (typeof b.code_challenge !== "string" || !B64URL_43.test(b.code_challenge)) throw invalidRequest();
    if (b.code_challenge_method !== "S256") throw new HttpError(400, "invalid_request", TEXT.invalidMethod);
    if (b.appareil !== undefined && typeof b.appareil !== "string") throw invalidRequest();
    const device = cleanDeviceLabel(b.appareil);
    if (keys.activeCount(user.id, "extension") >= MAX_EXTENSION_KEYS) throw new HttpError(409, "too_many_extensions", TOO_MANY_EXTENSIONS_TEXT);
    if (!authorizeLimiter.take(user.id)) return err(c, 429, "rate_limited", TEXT.tooManyCodes);
    const code = randomBytes(32).toString("base64url");
    const now = Date.now();
    await writeTx(db, () => {
      db.prepare(
        "INSERT INTO ytc_ext_code (code_hash, user_id, redirect_uri, code_challenge, device_label, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(codeHash(code), user.id, redirectUri, b.code_challenge as string, device, new Date(now).toISOString(), new Date(now + CODE_TTL_MS).toISOString());
    });
    log("info", "extension code issued", { user: user.id });
    return c.json({ redirect: `${redirectUri}?code=${code}&state=${state}` });
  });

  app.post("/api/extension/deny", async (c) => {
    const user = c.get("user");
    if (!user) return err(c, 401, "unauthorized", TEXT.unauthorized);
    const b = readFields(await c.req.json().catch(() => null), ["redirect_uri", "state"], ["redirect_uri", "state"]);
    const { redirectUri } = readRedirect(cfg, b);
    const state = readState(b);
    log("info", "extension authorization denied", { user: user.id });
    return c.json({ redirect: `${redirectUri}?error=access_denied&state=${state}` });
  });

  // ---- service worker de l'extension (sans cookie) ------------------------------------------------

  app.post("/api/extension/token", async (c) => {
    const bad = extensionRequest(c, { json: true });
    if (bad) return bad;
    if (!tokenLimiter.take(ipOf(c))) return err(c, 429, "rate_limited", TEXT.rateLimited);
    const b = readFields(await c.req.json().catch(() => null), ["code", "code_verifier", "redirect_uri"], ["code", "code_verifier", "redirect_uri"]);
    if (typeof b.code !== "string" || !B64URL_43.test(b.code)) throw invalidRequest();
    if (typeof b.code_verifier !== "string" || !VERIFIER_RE.test(b.code_verifier)) throw invalidRequest();
    const { redirectUri, extensionId } = readRedirect(cfg, b);
    if (!extensionOriginOk(cfg, c.req.header("origin"), extensionId)) return err(c, 403, "invalid_origin", TEXT.invalidOrigin);

    const hash = codeHash(b.code);
    const row = db.prepare("SELECT * FROM ytc_ext_code WHERE code_hash = ?").get(hash) as CodeRow | undefined;
    if (!row) throw invalidGrant();
    if (row.used_at) {
      // S2 : un code rejoué ne révoque la clé émise que si le demandeur prouve détenir le vérificateur PKCE ; sans
      // cette preuve (code seul, intercepté), simple refus : personne ne peut ainsi forcer une déconnexion.
      if (sameText(s256(b.code_verifier), row.code_challenge)) await onReplay({ ...row });
      else log("warn", "extension code reused without proof", { user: row.user_id });
      throw invalidGrant();
    }
    const refuse = async (reason: string): Promise<never> => {
      await burn(hash);
      log("warn", "extension token refused", { reason, user: row.user_id });
      throw invalidGrant();
    };
    if (Date.parse(row.expires_at) <= Date.now()) return refuse("expired");
    if (row.redirect_uri !== redirectUri) return refuse("redirect_mismatch");
    if (!sameText(s256(b.code_verifier), row.code_challenge)) return refuse("pkce");
    const u = db.prepare('SELECT id, email, name, status FROM "user" WHERE id = ?').get(row.user_id) as
      { id: string; email: string; name: string | null; status: string | null } | undefined;
    if (!u) return refuse("user");
    if (u.status === "suspended") {
      await burn(hash);
      throw new HttpError(403, "account_suspended", TEXT.suspended);
    }

    let issued: Awaited<ReturnType<typeof keys.createExtensionKey>>;
    try {
      issued = await keys.createExtensionKey(u.id, row.device_label ?? DEFAULT_DEVICE_LABEL, (keyId) => {
        // Même transaction que l'enregistrement de la clé : usage unique garanti (conditionnel).
        const now = nowIso();
        const r = db.prepare("UPDATE ytc_ext_code SET used_at = ?, key_id = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?").run(now, keyId, hash, now);
        return Number(r.changes) === 1;
      });
    } catch (e) {
      if (e instanceof KeyError && e.code === "too_many_extensions") await burn(hash);
      throw e;
    }
    if (!issued) {
      // Course perdue : le code vient d'être utilisé par une autre requête (rejeu) ou d'expirer.
      const now = db.prepare("SELECT * FROM ytc_ext_code WHERE code_hash = ?").get(hash) as CodeRow | undefined;
      if (now?.used_at && sameText(s256(b.code_verifier), now.code_challenge)) await onReplay({ ...now });
      throw invalidGrant();
    }
    log("info", "extension key issued", { user: u.id, keyRef: issued.key.id });
    return c.json({ token: issued.secret, expiresAt: issued.key.expiresAt, user: { email: u.email, name: u.name ?? "" } });
  });

  app.get("/api/extension/me", async (c) => {
    if (!extensionOriginOk(cfg, c.req.header("origin"))) return err(c, 403, "invalid_origin", TEXT.invalidOrigin);
    const who = await bearer(c);
    if ("status" in who) return refuse(c, who);
    if (!meLimiter.take(who.keyId)) return err(c, 429, "rate_limited", TEXT.rateLimited);
    const today = usage.today(who.user.id);
    const since = new Date(Date.now() - ACTIVE_STALE_MS).toISOString();
    const active = db.prepare("SELECT count(*) AS n FROM ytc_usage WHERE user_id = ? AND state IN ('reserved', 'running') AND updated_at >= ?")
      .get(who.user.id, since) as { n: number };
    const recent = usage.activity(who.user.id, 5).map((a) => ({
      createdAt: a.createdAt, platform: a.platform, fmt: a.fmt, state: a.state, errorMessage: a.errorMessage,
    }));
    // features.tools : AETHRYON Tools ouvert ici (l'extension montre « Ouvrir dans Tools » seulement alors).
    return c.json({ user: { email: who.user.email, name: who.user.name }, today, activeJobs: Number(active.n), recent,
                    features: { tools: s.tools.enabled } });
  });

  /**
   * « Ouvrir dans AETHRYON Tools » depuis l'extension : lien vers l'éditeur pour un média que le serveur a DÉJÀ
   * récupéré pour ce compte (job ytapi de l'extension) — ni nouveau téléchargement, ni nouvelle conversion. Jeton
   * à usage du seul compte, 55 min, dans le fragment (#ref=), jamais dans une adresse envoyée à un serveur ; seule
   * son empreinte est gardée. Un job d'un autre compte donne un lien qui ne mène à rien (404 dans l'éditeur).
   */
  app.post("/api/extension/outils", async (c) => {
    const bad = extensionRequest(c, { json: true });
    if (bad) return bad;
    const who = await bearer(c);
    if ("status" in who) return refuse(c, who);
    if (!s.tools.enabled) return err(c, 404, "tools_unavailable", TEXT.toolsClosed);
    if (!toolsLimiter.take(who.keyId)) return err(c, 429, "rate_limited", TEXT.toolsRateLimited);
    const b = readFields(await c.req.json().catch(() => null), ["job_id"], ["job_id"]);
    if (typeof b.job_id !== "string" || !/^[A-Za-z0-9_-]{6,40}$/.test(b.job_id)) return err(c, 400, "invalid_job", TEXT.invalidJob);
    const ref = await s.tools.createRef(who.user.id, b.job_id, "extension");
    return c.json({ url: `${cfg.publicUrl}/outils/studio#ref=${ref.token}`, expiresAt: ref.expiresAt }, 201);
  });

  app.post("/api/extension/logout", async (c) => {
    const bad = extensionRequest(c, { json: false });
    if (bad) return bad;
    if (!logoutLimiter.take(ipOf(c))) return err(c, 429, "rate_limited", TEXT.rateLimited);
    const m = BEARER_RE.exec(c.req.header("authorization") ?? "");
    if (!m) return invalidToken(c);
    const k = await keys.lookupBySecret(m[1]!);
    if (!k || k.kind !== "extension") return invalidToken(c);
    // Idempotent : une clé déjà révoquée répond 204 sans rien changer.
    if (!k.revokedAt) {
      await keys.revoke(k.userId, k.id, "user");
      log("info", "extension logout", { user: k.userId, keyRef: k.id });
    }
    return c.body(null, 204);
  });
}

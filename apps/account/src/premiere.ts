// Connexion du panneau AETHRYON pour Premiere Pro (v2) au compte, par une page d'accord
// (<notes internes non publiées> ; flux inspiré de l'OAuth 2.0 Device Authorization Grant,
// RFC 8628) : aucune redirection, aucun serveur local dans Premiere, aucun mot de passe saisi dans le panneau.
//
// 1. Le panneau demande un appairage : POST /api/premiere/appairage (sans session, limité par IP) → code d'appareil
//    (secret de 32 octets, seule son empreinte SHA-256 est gardée), code utilisateur « ABCD-EFGH », 10 min.
// 2. Il ouvre /premiere/connecter?code=ABCD-EFGH dans le navigateur ; l'utilisateur connecté y voit le code et
//    l'ordinateur, puis autorise ou refuse (POST /api/premiere/autoriser | refuser : session + CSRF du site, comme
//    toute mutation de l'API publique ; POST /api/premiere/demande pour lire la demande). Refus et expiration sont
//    définitifs pour ce code.
// 3. Le panneau interroge POST /api/premiere/jeton toutes les `intervalle` secondes : 428 en attente, 200 clé « premiere »
//    (une seule fois), 403 refusé, 410 expiré ou déjà utilisé (la clé remise est alors révoquée : rejeu), 429 trop rapide.
// 4. Clé « premiere » : ytc_, 30 jours, mêmes droits et même quota qu'une clé d'extension (ytapi /jobs, /preview,
//    fichier), lecture du compte et des 5 dernières conversions (GET /api/premiere/moi), « Se déconnecter »
//    (POST /api/premiere/deconnexion) ; révocable dans « Mes jetons ».
//
// Les routes du panneau (appairage, jeton, moi, deconnexion) ne lisent JAMAIS la session (app.ts les exempte du
// middleware de session et du contrôle d'origine du site) : seul le code d'appareil ou la clé en Bearer authentifie.
// Origine admise : absente (requête Node du panneau) ou « null » / « file:// » (page locale du panneau CEP) ; toute
// origine web est refusée. Aucun en-tête CORS n'est jamais envoyé.
// Fermées tant que PREMIERE_CONNEXION ≠ 1 (sauf moi et deconnexion, qui ne servent qu'à une clé déjà remise).
// Journaux : identifiants internes et préfixe d'empreinte seulement ; jamais de code d'appareil, de code utilisateur,
// de clé ni d'e-mail.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context, Hono } from "hono";
import type { Services } from "./app.ts";
import { writeTx } from "./db.ts";
import { bearerSecret, checkDeviceBearer, cleanDeviceLabel, DEFAULT_DEVICE_LABEL, type BearerRefusal } from "./extension.ts";
import { err, HttpError, Limiter, type Vars } from "./http.ts";
import { KeyError, MAX_PREMIERE_KEYS, TOO_MANY_PREMIERE_TEXT } from "./keys.ts";
import { log } from "./log.ts";

const NB = "\u00a0"; // espace insécable (typographie française)

/** Durée de vie d'une demande d'appairage (s) : `expireDans`. */
export const PAIRING_TTL_S = 600;
/** Intervalle minimal entre deux interrogations de /jeton pour un même code (s) : `intervalle`. */
export const POLL_INTERVAL_S = 3;
/** Marge accordée au panneau (gigue de son minuteur) : une interrogation à 2,5 s d'intervalle passe encore. */
const POLL_TOLERANCE_MS = 500;
/** Demandes gardées 24 h après expiration (reconnaître un code rejoué), puis effacées par la purge. */
export const PAIRING_RETENTION_MS = 24 * 3_600_000;
/** Lettres du code utilisateur (RFC 8628 §6.1) : 20 consonnes, ni voyelle (aucun mot), ni 0/O ni 1/I. */
export const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
const USER_CODE_RE = /^[BCDFGHJKLMNPQRSTVWXZ]{8}$/;
const DEVICE_CODE_RE = /^[A-Za-z0-9_-]{43}$/; // 32 octets en base64url
const VERSION_MAX = 32;
const ACTIVE_STALE_MS = 3 * 3_600_000;

/** Routes appelées par le panneau lui-même : ni session, ni contrôle d'origine du site (app.ts). */
export const PREMIERE_PANEL_PATHS: ReadonlySet<string> = new Set([
  "/api/premiere/appairage", "/api/premiere/jeton", "/api/premiere/moi", "/api/premiere/deconnexion",
]);

/** Horloge des demandes d'appairage (expiration, cadence) ; les tests l'avancent pour simuler l'attente. */
export const premiereClock = { now: (): number => Date.now() };
const now = () => premiereClock.now();
const nowIso = () => new Date(now()).toISOString();

export const premiereHash = (deviceCode: string) => createHash("sha256").update(deviceCode, "utf8").digest("base64url");

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Code utilisateur aléatoire (8 lettres de USER_CODE_ALPHABET, tirage uniforme par rejet). */
export function newUserCode(): string {
  let out = "";
  while (out.length < 8) {
    for (const b of randomBytes(16)) {
      if (b >= 240) continue; // 240 = 12 × 20 : aucune lettre favorisée
      out += USER_CODE_ALPHABET[b % 20];
      if (out.length === 8) break;
    }
  }
  return out;
}

/** Saisie de l'utilisateur ou paramètre ?code= → 8 lettres (majuscules, sans espace ni tiret), sinon null. */
export function normalizeUserCode(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 32) return null;
  const s = raw.toUpperCase().replace(/[\s\-‐-―.]/g, "");
  return USER_CODE_RE.test(s) ? s : null;
}
export const formatUserCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;

/** Information donnée par le panneau (nom d'hôte, versions) : texte nettoyé et borné, ou null si absente ou vide. */
function cleanInfo(raw: unknown, max: number): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") throw invalidRequest();
  const v = cleanDeviceLabel(raw);
  if (v === DEFAULT_DEVICE_LABEL && raw.trim() !== DEFAULT_DEVICE_LABEL) return null;
  const chars = Array.from(v);
  return chars.length > max ? chars.slice(0, max).join("").trimEnd() : v;
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null);

// ---- textes (français, tutoiement, espaces insécables) -------------------------------------------

const TEXT = {
  closed: `La connexion de Premiere Pro n'est pas encore ouverte sur ce serveur.`,
  invalidRequest: `Demande invalide${NB}: relance la connexion depuis le panneau AETHRYON de Premiere Pro.`,
  invalidOrigin: "Requête refusée (origine inattendue).",
  notJson: "Le corps de la requête doit être du JSON.",
  pairingRateLimited: `Trop de demandes de connexion depuis cette adresse${NB}: réessaie dans quelques minutes.`,
  busy: `Trop de demandes de connexion en ce moment${NB}: réessaie dans quelques minutes.`,
  pending: "En attente de ton accord sur le site AETHRYON.",
  slowDown: `Interrogation trop rapide${NB}: attends l'intervalle indiqué.`,
  pollRateLimited: `Trop de requêtes${NB}: réessaie dans une minute.`,
  invalidDeviceCode: `Code d'appareil inconnu${NB}: relance la connexion depuis le panneau AETHRYON.`,
  denied: "Connexion refusée sur le site AETHRYON.",
  expired: `Ce code a expiré${NB}: relance la connexion depuis le panneau AETHRYON.`,
  used: `Ce code a déjà servi${NB}: par sécurité, l'accès qu'il a ouvert est révoqué. Relance la connexion depuis le panneau AETHRYON.`,
  suspended: "Ce compte est suspendu.",
  unauthorized: "Connecte-toi pour continuer.",
  invalidCode: `Code invalide${NB}: 8 lettres, comme ABCD-EFGH, celles affichées dans Premiere Pro.`,
  unknownCode: `Code inconnu${NB}: vérifie le code affiché dans Premiere Pro, ou relance la connexion depuis le panneau AETHRYON.`,
  lookupRateLimited: `Trop de codes essayés${NB}: réessaie dans quelques minutes.`,
  decideRateLimited: `Trop de demandes${NB}: réessaie dans quelques minutes.`,
  codeExpired: `Ce code a expiré${NB}: relance la connexion depuis le panneau AETHRYON de Premiere Pro.`,
  codeUsed: `Ce code a déjà été utilisé${NB}: relance la connexion depuis le panneau AETHRYON de Premiere Pro.`,
  codeDenied: `Cette demande a été refusée${NB}: relance la connexion depuis le panneau AETHRYON de Premiere Pro.`,
  invalidToken: `Clé absente, invalide ou révoquée${NB}: reconnecte Premiere Pro à ton compte.`,
  revokedToken: `L'accès de Premiere Pro à ton compte a été révoqué${NB}: reconnecte-le pour continuer.`,
  expiredToken: `La connexion de Premiere Pro a expiré (30 jours)${NB}: reconnecte-le pour continuer.`,
  meRateLimited: `Trop de requêtes${NB}: réessaie dans une minute.`,
} as const;

const invalidRequest = () => new HttpError(400, "invalid_request", TEXT.invalidRequest);

/** Corps exactement composé des champs attendus (aucun champ inconnu). */
function readFields(body: unknown, allowed: readonly string[], required: readonly string[]): Record<string, unknown> {
  const b = obj(body);
  if (!b) throw invalidRequest();
  for (const k of Object.keys(b)) if (!allowed.includes(k)) throw invalidRequest();
  for (const k of required) if (!(k in b)) throw invalidRequest();
  return b;
}

/** Origine d'une requête du panneau : absente (Node), « null » ou « file:// » (page locale CEP) ; jamais une page web. */
export function panelOriginOk(origin: string | undefined): boolean {
  return origin === undefined || origin === "null" || origin === "file://";
}

type Status = "pending" | "approved" | "denied" | "issued";
interface PairingRow {
  device_hash: string; user_code: string; status: Status; user_id: string | null; host: string | null;
  premiere_version: string | null; extension_version: string | null; key_id: string | null;
  created_at: string; expires_at: string; decided_at: string | null; issued_at: string | null;
}

/** État d'une demande vu par la page d'accord (`moi` : le compte connecté). */
export type PageState = "en-attente" | "autorise" | "refuse" | "expire" | "utilise";
function pageState(r: PairingRow, me: string, at = now()): PageState {
  if (r.status === "issued") return "utilise";
  if (r.status === "approved") return r.user_id === me ? "autorise" : "utilise";
  if (r.status === "denied") return r.user_id === me ? "refuse" : "utilise";
  return Date.parse(r.expires_at) <= at ? "expire" : "en-attente";
}

export function mountPremiere(app: Hono<{ Variables: Vars }>, s: Services): void {
  const { cfg, db, keys, usage } = s;
  const pairingLimiter = new Limiter(10, 600_000);      // appairages : 10 par 10 min et par IP
  const pairingGlobal = new Limiter(600, 600_000);      // et 600 par 10 min en tout (base jamais remplie de demandes)
  const pollLimiter = new Limiter(60, 60_000);          // interrogations : 60 par minute et par IP (plusieurs PC derrière un routeur)
  const badCodeLimiter = new Limiter(20, 600_000);      // codes d'appareil inconnus : 20 par 10 min et par IP
  const lookupLimiter = new Limiter(60, 600_000);       // page d'accord : 60 lectures par 10 min et par compte
  const unknownLimiter = new Limiter(10, 600_000);      // codes utilisateur inconnus : 10 par 10 min et par compte
  const decideLimiter = new Limiter(20, 600_000);       // accords et refus : 20 par 10 min et par compte
  const meLimiter = new Limiter(60, 60_000);            // /moi : 60 par minute et par clé
  const logoutLimiter = new Limiter(30, 60_000);        // déconnexions : 30 par minute et par IP
  const lastPoll = new Map<string, number>();           // dernière interrogation acceptée, par empreinte de code
  const ipOf = (c: Context) => c.req.header(cfg.ipHeader) ?? "unknown";
  const ref = (hash: string) => hash.slice(0, 10); // préfixe d'empreinte (ni le code ni l'empreinte entière)

  const closed = (c: Context) => err(c, 404, "premiere_closed", TEXT.closed);
  /** Réponse d'état au panneau : { etat, message } (+ champs), avec son code HTTP. */
  const etat = (c: Context, status: number, value: string, message: string, extra: Record<string, unknown> = {}) =>
    c.json({ etat: value, message, ...extra }, status as 400);

  /** Origine + type de contenu des routes du panneau (JSON exigé si `json`, sinon absent ou JSON). */
  const panelRequest = (c: Context, opts: { json: boolean }): Response | null => {
    if (!panelOriginOk(c.req.header("origin"))) return err(c, 403, "invalid_origin", TEXT.invalidOrigin);
    const ct = (c.req.header("content-type") ?? "").toLowerCase();
    if (opts.json ? !ct.startsWith("application/json") : ct !== "" && !ct.startsWith("application/json")) {
      return err(c, 415, "unsupported_media_type", TEXT.notJson);
    }
    return null;
  };

  const read = (hash: string) => db.prepare("SELECT * FROM ytc_premiere_code WHERE device_hash = ?").get(hash) as PairingRow | undefined;
  const byUserCode = (code: string) => {
    const r = db.prepare("SELECT * FROM ytc_premiere_code WHERE user_code = ?").get(code) as PairingRow | undefined;
    return r && sameText(r.user_code, code) ? r : undefined;
  };

  /** Code d'appareil présenté après la remise de la clé : la clé remise est révoquée (motif « replay »). */
  const onReplay = async (row: PairingRow) => {
    log("warn", "premiere device code replayed", { pairing: ref(row.device_hash), user: row.user_id, keyRef: row.key_id });
    if (!row.key_id || !row.user_id) return;
    try {
      const k = keys.get(row.user_id, row.key_id);
      if (!k.revokedAt) await keys.revoke(row.user_id, row.key_id, "replay");
    } catch (e) {
      if (!(e instanceof KeyError && e.status === 404)) throw e; // clé déjà effacée : rien à révoquer
    }
  };

  const pruneLastPoll = (at: number) => {
    if (lastPoll.size <= 10_000) return;
    for (const [k, t] of lastPoll) if (at - t > PAIRING_TTL_S * 1000) lastPoll.delete(k);
  };

  // ---- panneau Premiere (sans session) -----------------------------------------------------------

  app.post("/api/premiere/appairage", async (c) => {
    if (!cfg.premiereLink) return closed(c);
    const bad = panelRequest(c, { json: true });
    if (bad) return bad;
    if (!pairingLimiter.take(ipOf(c))) return err(c, 429, "rate_limited", TEXT.pairingRateLimited);
    const b = readFields(await c.req.json().catch(() => null), ["hote", "versionPremiere", "versionExtension"], []);
    const host = cleanInfo(b.hote, 60);
    const premiereVersion = cleanInfo(b.versionPremiere, VERSION_MAX);
    const extensionVersion = cleanInfo(b.versionExtension, VERSION_MAX);
    if (!pairingGlobal.take("all")) return err(c, 503, "busy", TEXT.busy);

    const deviceCode = randomBytes(32).toString("base64url");
    const hash = premiereHash(deviceCode);
    const t0 = now();
    let userCode = "";
    // Code utilisateur unique (contrainte UNIQUE) : une collision (≈ 1 sur 25 milliards par demande gardée) fait retirer.
    for (let attempt = 0; ; attempt++) {
      userCode = newUserCode();
      try {
        await writeTx(db, () => {
          db.prepare(
            "INSERT INTO ytc_premiere_code (device_hash, user_code, status, host, premiere_version, extension_version, created_at, expires_at) " +
            "VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)",
          ).run(hash, userCode, host, premiereVersion, extensionVersion, new Date(t0).toISOString(), new Date(t0 + PAIRING_TTL_S * 1000).toISOString());
        });
        break;
      } catch (e) {
        if (attempt < 4 && /UNIQUE constraint failed: ytc_premiere_code\.user_code/.test(String(e))) continue;
        throw e;
      }
    }
    log("info", "premiere pairing requested", { pairing: ref(hash) });
    return c.json({
      codeAppareil: deviceCode,
      codeUtilisateur: formatUserCode(userCode),
      urlVerification: `${cfg.publicUrl}/premiere/connecter`,
      expireDans: PAIRING_TTL_S,
      intervalle: POLL_INTERVAL_S,
    });
  });

  app.post("/api/premiere/jeton", async (c) => {
    if (!cfg.premiereLink) return closed(c);
    const bad = panelRequest(c, { json: true });
    if (bad) return bad;
    const ip = ipOf(c);
    if (!pollLimiter.take(ip)) {
      c.header("Retry-After", "60");
      return c.json({ error: "rate_limited", etat: "trop-rapide", message: TEXT.pollRateLimited, intervalle: POLL_INTERVAL_S }, 429);
    }
    const b = readFields(await c.req.json().catch(() => null), ["codeAppareil"], ["codeAppareil"]);
    if (typeof b.codeAppareil !== "string" || !DEVICE_CODE_RE.test(b.codeAppareil)) throw invalidRequest();
    const hash = premiereHash(b.codeAppareil);
    const row = read(hash);
    if (!row || !sameText(row.device_hash, hash)) {
      if (!badCodeLimiter.take(ip)) {
        c.header("Retry-After", "600");
        return c.json({ error: "rate_limited", etat: "trop-rapide", message: TEXT.pollRateLimited, intervalle: POLL_INTERVAL_S }, 429);
      }
      return c.json({ error: "invalid_grant", etat: "invalide", message: TEXT.invalidDeviceCode }, 400);
    }

    // Cadence (RFC 8628 §3.5, « slow_down ») : une interrogation trop proche de la précédente acceptée est refusée
    // sans rien changer (elle ne repousse pas la suivante).
    const t0 = now();
    const last = lastPoll.get(hash);
    if (last !== undefined && t0 - last < POLL_INTERVAL_S * 1000 - POLL_TOLERANCE_MS) {
      c.header("Retry-After", String(POLL_INTERVAL_S));
      return c.json({ error: "slow_down", etat: "trop-rapide", message: TEXT.slowDown, intervalle: POLL_INTERVAL_S }, 429);
    }
    lastPoll.set(hash, t0);
    pruneLastPoll(t0);

    if (row.status === "issued") {
      await onReplay(row);
      return etat(c, 410, "deja-utilise", TEXT.used);
    }
    if (row.status === "denied") return etat(c, 403, "refuse", TEXT.denied);
    if (Date.parse(row.expires_at) <= t0) return etat(c, 410, "expire", TEXT.expired);
    if (row.status === "pending") return etat(c, 428, "en-attente", TEXT.pending, { intervalle: POLL_INTERVAL_S });

    // Autorisée : clé « premiere » remise une seule fois (transaction conditionnelle).
    const u = db.prepare('SELECT id, email, name, status FROM "user" WHERE id = ?').get(row.user_id) as
      { id: string; email: string; name: string | null; status: string | null } | undefined;
    const burn = () => writeTx(db, () => {
      db.prepare("UPDATE ytc_premiere_code SET status = 'denied' WHERE device_hash = ? AND status = 'approved'").run(hash);
    });
    if (!u) {
      await burn();
      return etat(c, 410, "expire", TEXT.expired);
    }
    if (u.status === "suspended") {
      await burn();
      log("warn", "premiere key refused", { reason: "suspended", pairing: ref(hash), user: u.id });
      return c.json({ error: "account_suspended", etat: "refuse", message: TEXT.suspended }, 403);
    }
    const label = row.host ?? DEFAULT_DEVICE_LABEL;
    let issued: Awaited<ReturnType<typeof keys.createPremiereKey>>;
    try {
      issued = await keys.createPremiereKey(u.id, label, (keyId) => {
        const t = nowIso();
        const r = db.prepare(
          "UPDATE ytc_premiere_code SET status = 'issued', key_id = ?, issued_at = ? WHERE device_hash = ? AND status = 'approved' AND user_id = ? AND expires_at > ?",
        ).run(keyId, t, hash, u.id, t);
        return Number(r.changes) === 1;
      });
    } catch (e) {
      if (e instanceof KeyError && e.code === "too_many_premiere") {
        await burn();
        return c.json({ error: "too_many_premiere", etat: "refuse", message: e.message }, 409);
      }
      throw e;
    }
    if (!issued) {
      // Course perdue : la clé vient d'être remise à une autre requête (rejeu) ou le code vient d'expirer.
      const again = read(hash);
      if (again?.status === "issued") {
        await onReplay(again);
        return etat(c, 410, "deja-utilise", TEXT.used);
      }
      return etat(c, 410, "expire", TEXT.expired);
    }
    log("info", "premiere key issued", { pairing: ref(hash), user: u.id, keyRef: issued.key.id });
    return c.json({ cle: issued.secret, expireLe: issued.key.expiresAt, compte: { email: u.email, nom: u.name ?? "" } });
  });

  const refuseBearer = (c: Context, r: BearerRefusal) => {
    if (r.status === 403) return err(c, 403, r.error, TEXT.suspended);
    c.header("WWW-Authenticate", 'Bearer realm="aethryon"');
    if (r.error === "token_revoked") return c.json({ error: r.error, message: TEXT.revokedToken, revokedBy: r.revokedBy }, 401);
    return err(c, 401, r.error, r.error === "token_expired" ? TEXT.expiredToken : TEXT.invalidToken);
  };

  app.get("/api/premiere/moi", async (c) => {
    if (!panelOriginOk(c.req.header("origin"))) return err(c, 403, "invalid_origin", TEXT.invalidOrigin);
    const who = await checkDeviceBearer(s, c.req.header("authorization"), "premiere");
    if ("status" in who) return refuseBearer(c, who);
    if (!meLimiter.take(who.keyId)) return err(c, 429, "rate_limited", TEXT.meRateLimited);
    const today = usage.today(who.user.id);
    const since = new Date(Date.now() - ACTIVE_STALE_MS).toISOString(); // historique des conversions : horloge réelle
    const active = db.prepare("SELECT count(*) AS n FROM ytc_usage WHERE user_id = ? AND state IN ('reserved', 'running') AND updated_at >= ?")
      .get(who.user.id, since) as { n: number };
    const recentes = usage.activity(who.user.id, 5).map((a) => ({
      creeLe: a.createdAt, plateforme: a.platform, format: a.fmt, etat: a.state, erreur: a.errorMessage,
    }));
    return c.json({
      compte: { email: who.user.email, nom: who.user.name },
      quota: { utilise: today.used, limite: today.limit, restant: today.remaining, illimite: today.unlimited, reinitialiseLe: today.resetAt },
      conversionsEnCours: Number(active.n),
      recentes,
      cle: { expireLe: who.expiresAt },
    });
  });

  app.post("/api/premiere/deconnexion", async (c) => {
    const bad = panelRequest(c, { json: false });
    if (bad) return bad;
    if (!logoutLimiter.take(ipOf(c))) return err(c, 429, "rate_limited", TEXT.meRateLimited);
    const secret = bearerSecret(c.req.header("authorization"));
    const k = secret ? await keys.lookupBySecret(secret) : null;
    if (!k || k.kind !== "premiere") return refuseBearer(c, { status: 401, error: "invalid_token" });
    // Idempotent : une clé déjà révoquée répond 204 sans rien changer.
    if (!k.revokedAt) {
      await keys.revoke(k.userId, k.id, "user");
      log("info", "premiere logout", { user: k.userId, keyRef: k.id });
    }
    return c.body(null, 204);
  });

  // ---- page d'accord du site (session + CSRF du site) ------------------------------------------------

  /** Compte connecté + code utilisateur lu dans le corps ; null après une réponse d'erreur. */
  const sitePrelude = async (c: Context<{ Variables: Vars }>, limiter: Limiter, limitedText: string) => {
    if (!cfg.premiereLink) return { res: closed(c) };
    const user = c.get("user");
    if (!user) return { res: err(c, 401, "unauthorized", TEXT.unauthorized) };
    if (!limiter.take(user.id)) return { res: err(c, 429, "rate_limited", limitedText) };
    const b = readFields(await c.req.json().catch(() => null), ["codeUtilisateur"], ["codeUtilisateur"]);
    const code = normalizeUserCode(b.codeUtilisateur);
    if (!code) return { res: err(c, 400, "invalid_code", TEXT.invalidCode) };
    const row = byUserCode(code);
    if (!row) {
      if (!unknownLimiter.take(user.id)) return { res: err(c, 429, "rate_limited", TEXT.lookupRateLimited) };
      return { res: err(c, 404, "unknown_code", TEXT.unknownCode) };
    }
    return { user, row, code };
  };

  const view = (row: PairingRow, me: string) => {
    const state = pageState(row, me);
    const mine = row.user_id === me || state === "en-attente" || state === "expire";
    return {
      codeUtilisateur: formatUserCode(row.user_code),
      etat: state,
      // Ordinateur (informations du panneau, indicatives) : seulement pour une demande libre ou décidée par ce compte.
      appareil: mine ? { hote: row.host, versionPremiere: row.premiere_version, versionExtension: row.extension_version } : null,
      creeLe: row.created_at,
      expireLe: row.expires_at,
    };
  };

  app.post("/api/premiere/demande", async (c) => {
    const p = await sitePrelude(c, lookupLimiter, TEXT.lookupRateLimited);
    if ("res" in p) return p.res;
    return c.json(view(p.row, p.user.id));
  });

  /** Refus d'une décision sur une demande qui n'est plus « en attente » : code et texte selon son état. */
  const notPending = (c: Context, row: PairingRow, me: string) => {
    const st = pageState(row, me);
    if (st === "expire") return c.json({ error: "code_expired", etat: st, message: TEXT.codeExpired }, 410);
    if (st === "refuse") return c.json({ error: "code_denied", etat: st, message: TEXT.codeDenied }, 409);
    return c.json({ error: "code_used", etat: st, message: TEXT.codeUsed }, 409);
  };

  app.post("/api/premiere/autoriser", async (c) => {
    const p = await sitePrelude(c, decideLimiter, TEXT.decideRateLimited);
    if ("res" in p) return p.res;
    const { user, row } = p;
    // Double clic ou page rechargée : déjà autorisée par ce compte, rien ne change.
    if (row.status === "approved" && row.user_id === user.id && Date.parse(row.expires_at) > now()) return c.json({ etat: "autorise" });
    if (row.status !== "pending" || Date.parse(row.expires_at) <= now()) return notPending(c, row, user.id);
    if (keys.activeCount(user.id, "premiere") >= MAX_PREMIERE_KEYS) return err(c, 409, "too_many_premiere", TOO_MANY_PREMIERE_TEXT);
    const changed = await writeTx(db, () => {
      const t = nowIso();
      return Number(db.prepare(
        "UPDATE ytc_premiere_code SET status = 'approved', user_id = ?, decided_at = ? WHERE device_hash = ? AND status = 'pending' AND expires_at > ?",
      ).run(user.id, t, row.device_hash, t).changes);
    });
    if (changed !== 1) return notPending(c, read(row.device_hash) ?? row, user.id);
    log("info", "premiere pairing approved", { pairing: ref(row.device_hash), user: user.id });
    return c.json({ etat: "autorise" });
  });

  app.post("/api/premiere/refuser", async (c) => {
    const p = await sitePrelude(c, decideLimiter, TEXT.decideRateLimited);
    if ("res" in p) return p.res;
    const { user, row } = p;
    if (row.status === "denied" && row.user_id === user.id) return c.json({ etat: "refuse" });
    if (row.status !== "pending" || Date.parse(row.expires_at) <= now()) return notPending(c, row, user.id);
    const changed = await writeTx(db, () => {
      const t = nowIso();
      return Number(db.prepare(
        "UPDATE ytc_premiere_code SET status = 'denied', user_id = ?, decided_at = ? WHERE device_hash = ? AND status = 'pending' AND expires_at > ?",
      ).run(user.id, t, row.device_hash, t).changes);
    });
    if (changed !== 1) return notPending(c, read(row.device_hash) ?? row, user.id);
    log("info", "premiere pairing denied", { pairing: ref(row.device_hash), user: user.id });
    return c.json({ etat: "refuse" });
  });
}

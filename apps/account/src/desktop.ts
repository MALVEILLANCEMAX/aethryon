// Liaison d'AETHRYON Desktop au compte (cloud-music/CLOUD-UI.md), par une page d'accord : même flux que le panneau
// Premiere (premiere.ts ; RFC 8628, « Device Authorization Grant »), mêmes codes, même cadence, même usage unique.
// Aucun mot de passe saisi dans le Desktop, aucun serveur local, aucune redirection.
//
// 1. Le cœur Rust du Desktop demande un appairage : POST /api/desktop/appairage {hote?, versionDesktop?} (sans session,
//    limité par IP) → code d'appareil (32 octets, seule son empreinte SHA-256 est gardée), code « ABCD-EFGH », 10 min.
// 2. Il ouvre /desktop/connecter?code=ABCD-EFGH dans le navigateur ; l'utilisateur connecté y voit le code et le nom de
//    l'ordinateur, puis autorise ou refuse (POST /api/desktop/demande | autoriser | refuser : session + CSRF du site).
// 3. Le cœur interroge POST /api/desktop/jeton toutes les `intervalle` secondes : 428 en attente, 200 clé « desktop »
//    (une seule fois), 403 refusé, 410 expiré ou déjà utilisé (la clé remise est alors révoquée : rejeu), 429 trop rapide.
// 4. Clé « desktop » : ytc_, 30 jours, au plus 3 ordinateurs ; GET /api/desktop/moi (compte, administrateur, état du
//    cloud), POST /api/desktop/deconnexion ; AETHRYON Cloud (/api/cloud/*, administrateur relu en base à chaque appel,
//    cloud/routes.ts) ; révocable dans « Mes jetons ».
//
// Le cœur Rust envoie ses requêtes SANS en-tête Origin (ureq) : toute requête qui en porte un (page web, extension,
// panneau CEP) est refusée sur les routes du Desktop. La session n'est JAMAIS lue sur ces routes (app.ts les exempte du
// middleware de session et du contrôle d'origine du site) : seul le code d'appareil ou la clé en Bearer authentifie.
// Fermées tant que DESKTOP_CONNEXION ≠ 1 (sauf moi et deconnexion, qui ne servent qu'à une clé déjà remise).
// Journaux : identifiants internes et préfixe d'empreinte seulement ; jamais de code, de clé ni d'e-mail.
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Context, Hono } from "hono";
import type { Services } from "./app.ts";
import { writeTx } from "./db.ts";
import { bearerSecret, checkDeviceBearer, cleanDeviceLabel, DEFAULT_DEVICE_LABEL, type BearerRefusal } from "./extension.ts";
import { err, HttpError, Limiter, type Vars } from "./http.ts";
import { KeyError, MAX_DESKTOP_KEYS, TOO_MANY_DESKTOP_TEXT } from "./keys.ts";
import { log } from "./log.ts";
import { formatUserCode, newUserCode, normalizeUserCode, PAIRING_TTL_S, POLL_INTERVAL_S, premiereHash as deviceHash } from "./premiere.ts";

const NB = " "; // espace insécable (typographie française)
const POLL_TOLERANCE_MS = 500;
const DEVICE_CODE_RE = /^[A-Za-z0-9_-]{43}$/; // 32 octets en base64url
const VERSION_RE = /^[0-9A-Za-z.+-]{1,32}$/;

/** Routes appelées par le cœur du Desktop lui-même : ni session, ni contrôle d'origine du site (app.ts). */
export const DESKTOP_PATHS: ReadonlySet<string> = new Set([
  "/api/desktop/appairage", "/api/desktop/jeton", "/api/desktop/moi", "/api/desktop/deconnexion",
]);

/** Horloge des demandes (expiration, cadence) ; les essais l'avancent pour simuler l'attente. */
export const desktopClock = { now: (): number => Date.now() };
const now = () => desktopClock.now();
const nowIso = () => new Date(now()).toISOString();

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const TEXT = {
  closed: "La liaison d'AETHRYON Desktop n'est pas encore ouverte sur ce serveur.",
  invalidRequest: `Demande invalide${NB}: relance la liaison depuis AETHRYON Desktop (Paramètres › Compte).`,
  invalidOrigin: "Requête refusée (origine inattendue).",
  notJson: "Le corps de la requête doit être du JSON.",
  pairingRateLimited: `Trop de demandes de liaison depuis cette adresse${NB}: réessaie dans quelques minutes.`,
  busy: `Trop de demandes de liaison en ce moment${NB}: réessaie dans quelques minutes.`,
  pending: "En attente de ton accord sur le site AETHRYON.",
  slowDown: `Interrogation trop rapide${NB}: attends l'intervalle indiqué.`,
  pollRateLimited: `Trop de requêtes${NB}: réessaie dans une minute.`,
  invalidDeviceCode: `Code d'appareil inconnu${NB}: relance la liaison depuis AETHRYON Desktop.`,
  denied: "Liaison refusée sur le site AETHRYON.",
  expired: `Ce code a expiré${NB}: relance la liaison depuis AETHRYON Desktop.`,
  used: `Ce code a déjà servi${NB}: par sécurité, l'accès qu'il a ouvert est révoqué. Relance la liaison depuis AETHRYON Desktop.`,
  suspended: "Ce compte est suspendu.",
  unauthorized: "Connecte-toi pour continuer.",
  invalidCode: `Code invalide${NB}: 8 lettres, comme ABCD-EFGH, celles affichées dans AETHRYON Desktop.`,
  unknownCode: `Code inconnu${NB}: vérifie le code affiché dans AETHRYON Desktop, ou relance la liaison.`,
  lookupRateLimited: `Trop de codes essayés${NB}: réessaie dans quelques minutes.`,
  decideRateLimited: `Trop de demandes${NB}: réessaie dans quelques minutes.`,
  codeExpired: `Ce code a expiré${NB}: relance la liaison depuis AETHRYON Desktop.`,
  codeUsed: `Ce code a déjà été utilisé${NB}: relance la liaison depuis AETHRYON Desktop.`,
  codeDenied: `Cette demande a été refusée${NB}: relance la liaison depuis AETHRYON Desktop.`,
  invalidToken: `Clé absente, invalide ou révoquée${NB}: relie de nouveau AETHRYON Desktop à ton compte.`,
  revokedToken: `L'accès d'AETHRYON Desktop à ton compte a été révoqué${NB}: relie-le de nouveau pour continuer.`,
  expiredToken: `La liaison d'AETHRYON Desktop a expiré (30 jours)${NB}: relie-le de nouveau pour continuer.`,
  meRateLimited: `Trop de requêtes${NB}: réessaie dans une minute.`,
} as const;

const invalidRequest = () => new HttpError(400, "invalid_request", TEXT.invalidRequest);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null);

/** Corps exactement composé des champs attendus (aucun champ inconnu). */
function readFields(body: unknown, allowed: readonly string[], required: readonly string[]): Record<string, unknown> {
  const b = obj(body);
  if (!b) throw invalidRequest();
  for (const k of Object.keys(b)) if (!allowed.includes(k)) throw invalidRequest();
  for (const k of required) if (!(k in b)) throw invalidRequest();
  return b;
}

/** Nom de l'ordinateur donné par le Desktop : texte nettoyé (contrôles, direction) et borné, ou null. */
function cleanHost(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") throw invalidRequest();
  const v = cleanDeviceLabel(raw);
  if (v === DEFAULT_DEVICE_LABEL && raw.trim() !== DEFAULT_DEVICE_LABEL) return null;
  const chars = Array.from(v);
  return chars.length > 60 ? chars.slice(0, 60).join("").trimEnd() : v;
}

function cleanVersion(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string" || !VERSION_RE.test(raw)) throw invalidRequest();
  return raw;
}

/** Les requêtes du cœur du Desktop ne portent AUCUNE origine (client HTTP natif) : toute origine est refusée. */
export const desktopOriginOk = (origin: string | undefined): boolean => origin === undefined;

type Status = "pending" | "approved" | "denied" | "issued";
interface PairingRow {
  device_hash: string; user_code: string; status: Status; user_id: string | null; host: string | null;
  desktop_version: string | null; key_id: string | null; created_at: string; expires_at: string;
  decided_at: string | null; issued_at: string | null;
}

export type PageState = "en-attente" | "autorise" | "refuse" | "expire" | "utilise";
function pageState(r: PairingRow, me: string, at = now()): PageState {
  if (r.status === "issued") return "utilise";
  if (r.status === "approved") return r.user_id === me ? "autorise" : "utilise";
  if (r.status === "denied") return r.user_id === me ? "refuse" : "utilise";
  return Date.parse(r.expires_at) <= at ? "expire" : "en-attente";
}

export function mountDesktop(app: Hono<{ Variables: Vars }>, s: Services): void {
  const { cfg, db, keys } = s;
  const pairingLimiter = new Limiter(10, 600_000);      // appairages : 10 par 10 min et par IP
  const pairingGlobal = new Limiter(600, 600_000);      // et 600 par 10 min en tout
  const pollLimiter = new Limiter(60, 60_000);          // interrogations : 60 par minute et par IP
  const badCodeLimiter = new Limiter(20, 600_000);      // codes d'appareil inconnus : 20 par 10 min et par IP
  const lookupLimiter = new Limiter(60, 600_000);       // page d'accord : 60 lectures par 10 min et par compte
  const unknownLimiter = new Limiter(10, 600_000);      // codes utilisateur inconnus : 10 par 10 min et par compte
  const decideLimiter = new Limiter(20, 600_000);       // accords et refus : 20 par 10 min et par compte
  const meLimiter = new Limiter(60, 60_000);            // /moi : 60 par minute et par clé
  const logoutLimiter = new Limiter(30, 60_000);        // déconnexions : 30 par minute et par IP
  const lastPoll = new Map<string, number>();
  const ipOf = (c: Context) => c.req.header(cfg.ipHeader) ?? "unknown";
  const ref = (hash: string) => hash.slice(0, 10);

  const closed = (c: Context) => err(c, 404, "desktop_closed", TEXT.closed);
  const etat = (c: Context, status: number, value: string, message: string, extra: Record<string, unknown> = {}) =>
    c.json({ etat: value, message, ...extra }, status as 400);

  const coreRequest = (c: Context, opts: { json: boolean }): Response | null => {
    if (!desktopOriginOk(c.req.header("origin"))) return err(c, 403, "invalid_origin", TEXT.invalidOrigin);
    const ct = (c.req.header("content-type") ?? "").toLowerCase();
    if (opts.json ? !ct.startsWith("application/json") : ct !== "" && !ct.startsWith("application/json")) {
      return err(c, 415, "unsupported_media_type", TEXT.notJson);
    }
    return null;
  };

  const read = (hash: string) => db.prepare("SELECT * FROM ytc_desktop_code WHERE device_hash = ?").get(hash) as PairingRow | undefined;
  const byUserCode = (code: string) => {
    const r = db.prepare("SELECT * FROM ytc_desktop_code WHERE user_code = ?").get(code) as PairingRow | undefined;
    return r && sameText(r.user_code, code) ? r : undefined;
  };

  const onReplay = async (row: PairingRow) => {
    log("warn", "desktop device code replayed", { pairing: ref(row.device_hash), user: row.user_id, keyRef: row.key_id });
    if (!row.key_id || !row.user_id) return;
    try {
      const k = keys.get(row.user_id, row.key_id);
      if (!k.revokedAt) await keys.revoke(row.user_id, row.key_id, "replay");
    } catch (e) {
      if (!(e instanceof KeyError && e.status === 404)) throw e;
    }
  };

  const pruneLastPoll = (at: number) => {
    if (lastPoll.size <= 10_000) return;
    for (const [k, t] of lastPoll) if (at - t > PAIRING_TTL_S * 1000) lastPoll.delete(k);
  };

  // ---- cœur du Desktop (sans session) ------------------------------------------------------------

  app.post("/api/desktop/appairage", async (c) => {
    if (!cfg.desktopLink) return closed(c);
    const bad = coreRequest(c, { json: true });
    if (bad) return bad;
    if (!pairingLimiter.take(ipOf(c))) return err(c, 429, "rate_limited", TEXT.pairingRateLimited);
    const b = readFields(await c.req.json().catch(() => null), ["hote", "versionDesktop"], []);
    const host = cleanHost(b.hote);
    const version = cleanVersion(b.versionDesktop);
    if (!pairingGlobal.take("all")) return err(c, 503, "busy", TEXT.busy);

    const deviceCode = randomBytes(32).toString("base64url");
    const hash = deviceHash(deviceCode);
    const t0 = now();
    let userCode = "";
    for (let attempt = 0; ; attempt++) {
      userCode = newUserCode();
      try {
        await writeTx(db, () => {
          db.prepare(
            "INSERT INTO ytc_desktop_code (device_hash, user_code, status, host, desktop_version, created_at, expires_at) VALUES (?, ?, 'pending', ?, ?, ?, ?)",
          ).run(hash, userCode, host, version, new Date(t0).toISOString(), new Date(t0 + PAIRING_TTL_S * 1000).toISOString());
        });
        break;
      } catch (e) {
        if (attempt < 4 && /UNIQUE constraint failed: ytc_desktop_code\.user_code/.test(String(e))) continue;
        throw e;
      }
    }
    log("info", "desktop pairing requested", { pairing: ref(hash) });
    return c.json({
      codeAppareil: deviceCode,
      codeUtilisateur: formatUserCode(userCode),
      urlVerification: `${cfg.publicUrl}/desktop/connecter`,
      expireDans: PAIRING_TTL_S,
      intervalle: POLL_INTERVAL_S,
    });
  });

  app.post("/api/desktop/jeton", async (c) => {
    if (!cfg.desktopLink) return closed(c);
    const bad = coreRequest(c, { json: true });
    if (bad) return bad;
    const ip = ipOf(c);
    if (!pollLimiter.take(ip)) {
      c.header("Retry-After", "60");
      return c.json({ error: "rate_limited", etat: "trop-rapide", message: TEXT.pollRateLimited, intervalle: POLL_INTERVAL_S }, 429);
    }
    const b = readFields(await c.req.json().catch(() => null), ["codeAppareil"], ["codeAppareil"]);
    if (typeof b.codeAppareil !== "string" || !DEVICE_CODE_RE.test(b.codeAppareil)) throw invalidRequest();
    const hash = deviceHash(b.codeAppareil);
    const row = read(hash);
    if (!row || !sameText(row.device_hash, hash)) {
      if (!badCodeLimiter.take(ip)) {
        c.header("Retry-After", "600");
        return c.json({ error: "rate_limited", etat: "trop-rapide", message: TEXT.pollRateLimited, intervalle: POLL_INTERVAL_S }, 429);
      }
      return c.json({ error: "invalid_grant", etat: "invalide", message: TEXT.invalidDeviceCode }, 400);
    }
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

    const u = db.prepare('SELECT id, email, name, status FROM "user" WHERE id = ?').get(row.user_id) as
      { id: string; email: string; name: string | null; status: string | null } | undefined;
    const burn = () => writeTx(db, () => {
      db.prepare("UPDATE ytc_desktop_code SET status = 'denied' WHERE device_hash = ? AND status = 'approved'").run(hash);
    });
    if (!u) {
      await burn();
      return etat(c, 410, "expire", TEXT.expired);
    }
    if (u.status === "suspended") {
      await burn();
      log("warn", "desktop key refused", { reason: "suspended", pairing: ref(hash), user: u.id });
      return c.json({ error: "account_suspended", etat: "refuse", message: TEXT.suspended }, 403);
    }
    let issued: Awaited<ReturnType<typeof keys.createDesktopKey>>;
    try {
      issued = await keys.createDesktopKey(u.id, row.host ?? DEFAULT_DEVICE_LABEL, (keyId) => {
        const t = nowIso();
        const r = db.prepare(
          "UPDATE ytc_desktop_code SET status = 'issued', key_id = ?, issued_at = ? WHERE device_hash = ? AND status = 'approved' AND user_id = ? AND expires_at > ?",
        ).run(keyId, t, hash, u.id, t);
        return Number(r.changes) === 1;
      });
    } catch (e) {
      if (e instanceof KeyError && e.code === "too_many_desktop") {
        await burn();
        return c.json({ error: "too_many_desktop", etat: "refuse", message: e.message }, 409);
      }
      throw e;
    }
    if (!issued) {
      const again = read(hash);
      if (again?.status === "issued") {
        await onReplay(again);
        return etat(c, 410, "deja-utilise", TEXT.used);
      }
      return etat(c, 410, "expire", TEXT.expired);
    }
    log("info", "desktop key issued", { pairing: ref(hash), user: u.id, keyRef: issued.key.id });
    return c.json({ cle: issued.secret, expireLe: issued.key.expiresAt, compte: { email: u.email, nom: u.name ?? "" } });
  });

  const refuseBearer = (c: Context, r: BearerRefusal) => {
    if (r.status === 403) return err(c, 403, r.error, TEXT.suspended);
    c.header("WWW-Authenticate", 'Bearer realm="aethryon"');
    if (r.error === "token_revoked") return c.json({ error: r.error, message: TEXT.revokedToken, revokedBy: r.revokedBy }, 401);
    return err(c, 401, r.error, r.error === "token_expired" ? TEXT.expiredToken : TEXT.invalidToken);
  };

  // Compte relié : identité, rôle relu en base, état du cloud (la section CLOUD du Desktop n'apparaît que si
  // `cloud.disponible` ; le serveur refuse de toute façon chaque appel au cloud d'un non-administrateur).
  app.get("/api/desktop/moi", async (c) => {
    if (!desktopOriginOk(c.req.header("origin"))) return err(c, 403, "invalid_origin", TEXT.invalidOrigin);
    const who = await checkDeviceBearer(s, c.req.header("authorization"), "desktop");
    if ("status" in who) return refuseBearer(c, who);
    if (!meLimiter.take(who.keyId)) return err(c, 429, "rate_limited", TEXT.meRateLimited);
    const role = (db.prepare('SELECT role FROM "user" WHERE id = ?').get(who.user.id) as { role: string | null } | undefined)?.role ?? null;
    const admin = role === "admin";
    const raison = !admin ? "non_admin" : !s.cloud ? "ferme" : null;
    return c.json({
      compte: { email: who.user.email, nom: who.user.name },
      administrateur: admin,
      cloud: { disponible: raison === null, raison },
      cle: { expireLe: who.expiresAt },
    });
  });

  app.post("/api/desktop/deconnexion", async (c) => {
    const bad = coreRequest(c, { json: false });
    if (bad) return bad;
    if (!logoutLimiter.take(ipOf(c))) return err(c, 429, "rate_limited", TEXT.meRateLimited);
    const secret = bearerSecret(c.req.header("authorization"));
    const k = secret ? await keys.lookupBySecret(secret) : null;
    if (!k || k.kind !== "desktop") return refuseBearer(c, { status: 401, error: "invalid_token" });
    if (!k.revokedAt) {
      await keys.revoke(k.userId, k.id, "user");
      log("info", "desktop logout", { user: k.userId, keyRef: k.id });
    }
    return c.body(null, 204);
  });

  // ---- page d'accord du site (session + CSRF du site) ------------------------------------------------

  const sitePrelude = async (c: Context<{ Variables: Vars }>, limiter: Limiter, limitedText: string) => {
    if (!cfg.desktopLink) return { res: closed(c) };
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
      appareil: mine ? { hote: row.host, versionDesktop: row.desktop_version } : null,
      creeLe: row.created_at,
      expireLe: row.expires_at,
    };
  };

  app.post("/api/desktop/demande", async (c) => {
    const p = await sitePrelude(c, lookupLimiter, TEXT.lookupRateLimited);
    if ("res" in p) return p.res;
    return c.json(view(p.row, p.user.id));
  });

  const notPending = (c: Context, row: PairingRow, me: string) => {
    const st = pageState(row, me);
    if (st === "expire") return c.json({ error: "code_expired", etat: st, message: TEXT.codeExpired }, 410);
    if (st === "refuse") return c.json({ error: "code_denied", etat: st, message: TEXT.codeDenied }, 409);
    return c.json({ error: "code_used", etat: st, message: TEXT.codeUsed }, 409);
  };

  app.post("/api/desktop/autoriser", async (c) => {
    const p = await sitePrelude(c, decideLimiter, TEXT.decideRateLimited);
    if ("res" in p) return p.res;
    const { user, row } = p;
    if (row.status === "approved" && row.user_id === user.id && Date.parse(row.expires_at) > now()) return c.json({ etat: "autorise" });
    if (row.status !== "pending" || Date.parse(row.expires_at) <= now()) return notPending(c, row, user.id);
    if (keys.activeCount(user.id, "desktop") >= MAX_DESKTOP_KEYS) return err(c, 409, "too_many_desktop", TOO_MANY_DESKTOP_TEXT);
    const changed = await writeTx(db, () => {
      const t = nowIso();
      return Number(db.prepare(
        "UPDATE ytc_desktop_code SET status = 'approved', user_id = ?, decided_at = ? WHERE device_hash = ? AND status = 'pending' AND expires_at > ?",
      ).run(user.id, t, row.device_hash, t).changes);
    });
    if (changed !== 1) return notPending(c, read(row.device_hash) ?? row, user.id);
    log("info", "desktop pairing approved", { pairing: ref(row.device_hash), user: user.id });
    return c.json({ etat: "autorise" });
  });

  app.post("/api/desktop/refuser", async (c) => {
    const p = await sitePrelude(c, decideLimiter, TEXT.decideRateLimited);
    if ("res" in p) return p.res;
    const { user, row } = p;
    if (row.status === "denied" && row.user_id === user.id) return c.json({ etat: "refuse" });
    if (row.status !== "pending" || Date.parse(row.expires_at) <= now()) return notPending(c, row, user.id);
    const changed = await writeTx(db, () => {
      const t = nowIso();
      return Number(db.prepare(
        "UPDATE ytc_desktop_code SET status = 'denied', user_id = ?, decided_at = ? WHERE device_hash = ? AND status = 'pending' AND expires_at > ?",
      ).run(user.id, t, row.device_hash, t).changes);
    });
    if (changed !== 1) return notPending(c, read(row.device_hash) ?? row, user.id);
    log("info", "desktop pairing denied", { pairing: ref(row.device_hash), user: user.id });
    return c.json({ etat: "refuse" });
  });
}

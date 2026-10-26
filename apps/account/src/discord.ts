// Liaison d'un compte Discord au compte AETHRYON (docs/DISCORD-BOT.md §3.1 et §17), côté account :
// - site (session obligatoire, mêmes contrôles d'origine et de JSON que les autres routes modifiantes) :
//   POST /api/discord/link (démarre : `state` aléatoire à usage unique, lié au compte ET à la session, 10 min,
//   scope identify seulement), GET /api/discord/callback (retour de Discord : state vérifié AVANT l'échange du
//   code, lecture de /users/@me, liaison), GET /api/discord (statut), POST /api/discord/unlink (déliaison :
//   clés « discord » révoquées, liens de téléchargement effacés) ;
// - bot (API interne, discord-internal.ts) : qui est ce compte Discord, clé ytc_ « discord » de 15 min, lien de
//   téléchargement à usage unique ;
// - GET /api/discord/telechargement?jeton=… : relais du fichier depuis ytapi (clé « discord » éphémère créée et
//   révoquée par account : la clé ne sort jamais d'account ; le bot n'envoie jamais de fichier dans Discord).
// Jamais conservés : jeton d'accès Discord (jeté après /users/@me), code, state, clés et liens (empreintes
// SHA-256 seulement). Jamais journalisés : identifiant ou nom Discord, code, state, jeton, clé, lien.
import { createHash, randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Config, DiscordConfig } from "./config.ts";
import { writeTx, type DB } from "./db.ts";
import { err, Limiter, type SessionUser, type Vars } from "./http.ts";
import { KeyError, type KeyService } from "./keys.ts";
import { log } from "./log.ts";
import { getSettings } from "./settings.ts";
import { nowIso } from "./time.ts";
import type { Today, UsageService } from "./usage.ts";

const NB = " "; // espace insécable (typographie française)

export const STATE_TTL_MS = 10 * 60_000;
export const DOWNLOAD_TTL_MS = 10 * 60_000;
// États et liens : gardés un jour après expiration (diagnostic), puis effacés par la purge quotidienne (usage.ts).
/** Liens de téléchargement en attente (non utilisés, non expirés) par compte. */
export const MAX_PENDING_DOWNLOADS = 5;
const LAST_USED_EVERY_MS = 60_000;
const DISCORD_TIMEOUT_MS = 8000;
const YTAPI_HEADERS_TIMEOUT_MS = 20_000;

const SNOWFLAKE = /^\d{17,20}$/;
/** CDN public de Discord (images de profil), lu par le serveur seulement. */
const DISCORD_CDN = "https://cdn.discordapp.com";
const B64URL_43 = /^[A-Za-z0-9_-]{43}$/;              // state et jeton de téléchargement (32 octets)
const CODE_RE = /^[A-Za-z0-9._~-]{1,200}$/;            // code d'autorisation Discord (opaque)
export const JOB_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export const sha = (v: string) => createHash("sha256").update(v, "utf8").digest("base64url");
const token32 = () => randomBytes(32).toString("base64url");

/** Résultats du retour OAuth, lus par la page « Discord » du site (?liaison=…). */
export type LinkResult = "ok" | "annulee" | "expiree" | "deja-liee" | "autre-discord" | "echec" | "fermee";
/** V3.5 : issue d'une connexion par Discord, lue par la page /connexion (?discord=…). */
export type LoginRefusal = "annulee" | "expiree" | "non-liee" | "echec" | "fermee" | "suspendu";
export type LoginResult = { ok: true; ticket: string } | { ok: false; reason: LoginRefusal };
/** Jeton du navigateur qui a demandé la connexion (cookie HttpOnly, 10 min) : seul lui peut la terminer. */
export const LOGIN_NONCE_COOKIE = "aethryon_dl";
/** Ticket remis par le retour de Discord à Better Auth (création de la session) : usage unique, 60 s. */
export const TICKET_TTL_MS = 60_000;
/** Connexions en cours gardées en mémoire au plus (au-delà : refus poli, réessayer). */
const MAX_PENDING_LOGINS = 2000;

/** Page où revenir après la connexion : un chemin du site seulement (jamais une autre origine), sinon l'espace. */
export function safeRetour(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 200 || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/dashboard";
  return /^\/[A-Za-z0-9/_\-?=&.%]*$/.test(raw) ? raw : "/dashboard";
}
/** Erreurs du lien de téléchargement, lues par la page /discord/telechargement (?erreur=…). */
export type DownloadError = "invalide" | "expire" | "utilise" | "fichier-expire" | "indisponible" | "limite" | "compte";

export const TEXT = {
  disabled: `La liaison avec Discord n'est pas encore ouverte.`,
  alreadyLinked: `Ton compte est déjà lié à un compte Discord${NB}: délie-le d'abord pour en lier un autre.`,
  tooManyStarts: `Trop de tentatives de liaison${NB}: réessaie dans quelques minutes.`,
  tooManyUnlinks: `Trop de demandes${NB}: réessaie dans quelques minutes.`,
  unauthorized: "Connecte-toi pour continuer.",
  notLinked: "Ce compte Discord n'est lié à aucun compte AETHRYON.",
  loginDisabled: `La connexion avec Discord n'est pas encore ouverte.`,
  busy: `Trop de connexions en cours${NB}: réessaie dans un instant.`,
  suspended: "Ce compte est suspendu.",
  paused: "Les conversions sont temporairement suspendues.",
  tooManyDownloads: `Trop de liens de téléchargement en attente${NB}: utilise d'abord ceux déjà reçus.`,
} as const;

/** Nom Discord affiché : nom d'utilisateur (ancien format : nom#1234), nettoyé (contrôle, bidi), ≤ 64 caractères. */
export function cleanDiscordName(username: unknown, discriminator: unknown): string | null {
  if (typeof username !== "string") return null;
  const base = username.slice(0, 200).normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g, "")
    .trim();
  if (!base) return null;
  const tag = typeof discriminator === "string" && /^\d{4}$/.test(discriminator) && discriminator !== "0000" ? `#${discriminator}` : "";
  return Array.from(base + tag).slice(0, 64).join("");
}

/** « alice@example.com » → « a•••@example.com » (affiché par le bot, au seul titulaire du compte). */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
}

export interface LinkView {
  name: string; linkedAt: string; lastUsedAt: string | null;
  /** Nom affiché sur Discord (global_name), s'il diffère du nom d'utilisateur ; null sinon. */
  displayName: string | null;
  /** Version de l'image de profil (8 premiers signes de son empreinte) pour /api/discord/avatar ; null : image par défaut. */
  avatarVersion: string | null;
}
interface LinkRow {
  discord_user_id: string; user_id: string; discord_name: string; linked_at: string; last_used_at: string | null;
  discord_display: string | null; discord_avatar: string | null;
}
/** Profil Discord public (nom d'utilisateur, nom affiché, empreinte de l'image), tel que Discord le donne. */
export interface DiscordProfile { name: string; display: string | null; avatar: string | null }
/** Empreinte d'image de profil Discord (« a_ » : animée). */
export const AVATAR_RE = /^(a_)?[0-9a-f]{32}$/;
/** Nom affiché (global_name) nettoyé comme le nom d'utilisateur, ≤ 32 caractères ; null s'il est absent ou vide. */
export function cleanDisplayName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = cleanDiscordName(v, null);
  return s ? Array.from(s).slice(0, 32).join("") : null;
}

/** Réponse de l'API interne « qui est ce compte Discord ». */
export type Resolved =
  | { linked: false }
  | { linked: true; status: "suspended" }
  | { linked: true; status: "active"; user: { name: string; email: string }; discord: LinkView; today: Today; maxActive: number };

/** Refus de l'API interne du bot (statut HTTP, code stable, texte français). */
export class DiscordError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

class OAuthFailure extends Error {}

/**
 * Client OAuth2 de Discord (serveur → Discord) : échange du code (client confidentiel, authentification
 * HTTP Basic), puis /users/@me avec le jeton d'accès, qui est ensuite jeté (jamais stocké ni journalisé).
 * Aucune redirection suivie (le secret ne doit aller nulle part ailleurs). Délai de 8 s par appel.
 */
export class DiscordOAuth {
  private cfg: DiscordConfig;
  private fetchImpl: () => typeof fetch;
  private timeoutMs: number;
  constructor(cfg: DiscordConfig, fetchImpl?: typeof fetch, timeoutMs = DISCORD_TIMEOUT_MS) {
    this.cfg = cfg; this.fetchImpl = () => fetchImpl ?? globalThis.fetch; this.timeoutMs = timeoutMs;
  }

  authorizeUrl(state: string): string {
    const q = new URLSearchParams({
      client_id: this.cfg.clientId, response_type: "code", redirect_uri: this.cfg.redirectUri,
      scope: "identify", state, prompt: "consent",
    });
    return `${this.cfg.oauthBase}/oauth2/authorize?${q}`;
  }

  /** Code → identité Discord { id, name, display, avatar } ; OAuthFailure (motif sans secret) si Discord refuse ou ne répond pas. */
  async identify(code: string): Promise<{ id: string } & DiscordProfile> {
    const basic = Buffer.from(`${encodeURIComponent(this.cfg.clientId)}:${encodeURIComponent(this.cfg.clientSecret)}`).toString("base64");
    let res: Response;
    try {
      res = await this.fetchImpl()(`${this.cfg.apiBase}/oauth2/token`, {
        method: "POST",
        headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: this.cfg.redirectUri }).toString(),
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new OAuthFailure((e as { name?: string })?.name === "TimeoutError" ? "token_timeout" : "token_network");
    }
    const tok = (await res.json().catch(() => null)) as { access_token?: unknown; token_type?: unknown; scope?: unknown } | null;
    if (res.status !== 200 || !tok) throw new OAuthFailure(`token_http_${res.status}`);
    const access = tok.access_token;
    if (typeof access !== "string" || access.length < 8 || access.length > 512 || !/^bearer$/i.test(String(tok.token_type ?? ""))) throw new OAuthFailure("token_shape");
    if (typeof tok.scope === "string" && !tok.scope.split(/\s+/).includes("identify")) throw new OAuthFailure("token_scope");
    let me: Response;
    try {
      me = await this.fetchImpl()(`${this.cfg.apiBase}/v10/users/@me`, {
        headers: { authorization: `Bearer ${access}`, accept: "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new OAuthFailure((e as { name?: string })?.name === "TimeoutError" ? "me_timeout" : "me_network");
    }
    const user = (await me.json().catch(() => null)) as { id?: unknown; username?: unknown; discriminator?: unknown; bot?: unknown; global_name?: unknown; avatar?: unknown } | null;
    if (me.status !== 200 || !user) throw new OAuthFailure(`me_http_${me.status}`);
    if (typeof user.id !== "string" || !SNOWFLAKE.test(user.id)) throw new OAuthFailure("me_id");
    if (user.bot === true) throw new OAuthFailure("me_bot");
    const name = cleanDiscordName(user.username, user.discriminator);
    if (!name) throw new OAuthFailure("me_name");
    const display = cleanDisplayName(user.global_name);
    return { id: user.id, name, display: display && display !== name ? display : null, avatar: typeof user.avatar === "string" && AVATAR_RE.test(user.avatar) ? user.avatar : null };
  }
}

export interface DiscordDeps {
  cfg: Config; db: DB; keys: KeyService; usage: UsageService;
  /** fetch des appels à Discord (défaut : fetch global). */
  discordFetch?: typeof fetch;
  /** fetch des appels à ytapi (relais du fichier ; défaut : fetch global). */
  ytapiFetch?: typeof fetch;
  /** Délai des appels à Discord (défaut 8 s ; réduit dans les tests). */
  discordTimeoutMs?: number;
}

export class DiscordService {
  readonly cfg: Config;
  readonly oauth: DiscordOAuth | null;
  private db: DB;
  private keys: KeyService;
  private usage: UsageService;
  private ytapiFetch: () => typeof fetch;
  private cdnFetch: () => typeof fetch;
  private lastUsedWrite = new Map<string, number>();
  /** Images de profil relayées (empreinte → octets), une heure au plus, 300 au plus. */
  private avatars = new Map<string, { at: number; type: string; bytes: Uint8Array }>();
  /** V3.5 : connexions par Discord en cours (empreinte du state → empreinte du jeton du navigateur), 10 min, en
   *  mémoire (un redémarrage d'account les annule : il suffit de recommencer) ; tickets (60 s, usage unique). */
  private logins = new Map<string, { nonce: string; retour: string; expires: number }>();
  private tickets = new Map<string, { userId: string; nonce: string; retour: string; expires: number }>();
  constructor(d: DiscordDeps) {
    this.cfg = d.cfg; this.db = d.db; this.keys = d.keys; this.usage = d.usage;
    this.oauth = d.cfg.discord ? new DiscordOAuth(d.cfg.discord, d.discordFetch, d.discordTimeoutMs) : null;
    this.ytapiFetch = () => d.ytapiFetch ?? globalThis.fetch;
    this.cdnFetch = () => d.discordFetch ?? globalThis.fetch;
  }

  /** Image de profil Discord du compte lié, relayée par le site (aucune ressource externe chargée par le navigateur,
   *  aucune adresse IP de visiteur transmise à Discord) : l'image publique (empreinte) ou l'image par défaut de Discord.
   *  PNG, 128 px, 1 Mo au plus ; null si non lié ou si le CDN de Discord ne répond pas. */
  async avatarImage(userId: string): Promise<{ type: string; bytes: Uint8Array } | null> {
    const a = this.avatarOf(userId);
    if (!a) return null;
    const key = a.hash ? `${a.discordUserId}/${a.hash}` : `defaut/${Number((BigInt(a.discordUserId) >> 22n) % 6n)}`;
    const hit = this.avatars.get(key);
    if (hit && Date.now() - hit.at < 3_600_000) return hit;
    const cdn = this.cfg.discord?.cdnBase ?? DISCORD_CDN;
    const url = a.hash
      ? `${cdn}/avatars/${a.discordUserId}/${a.hash}.png?size=128`
      : `${cdn}/embed/avatars/${key.split("/")[1]}.png`;
    try {
      const res = await this.cdnFetch()(url, { redirect: "manual", signal: AbortSignal.timeout(4000) });
      const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
      if (res.status !== 200 || !/^image\/(png|webp|gif|jpeg)$/.test(type)) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length === 0 || bytes.length > 1_000_000) return null;
      if (this.avatars.size >= 300) this.avatars.delete(this.avatars.keys().next().value!);
      const out = { at: Date.now(), type, bytes };
      this.avatars.set(key, out);
      return out;
    } catch {
      return null;
    }
  }

  get enabled(): boolean { return this.oauth !== null; }
  /** « Continuer avec Discord » ouvert (DISCORD_LOGIN=1 et liaison configurée). */
  get loginEnabled(): boolean { return this.oauth !== null && this.cfg.discord?.login === true; }

  // ---- V3.5 : connexion par Discord d'un compte DÉJÀ lié --------------------------------------------------------
  // Jamais de création de compte ni de liaison ici : le compte Discord doit avoir été lié depuis l'espace, par
  // quelqu'un déjà connecté (preuve que les deux comptes ont le même propriétaire). Les droits (Premium compris)
  // sont ceux du compte AETHRYON, inchangés.

  /** Démarre : state (32 octets, empreinte gardée 10 min) lié au jeton du navigateur (cookie posé par la route). */
  startLogin(nonce: string, retour: string): string {
    if (!this.oauth || !this.loginEnabled) throw new DiscordError(503, "discord_login_disabled", TEXT.loginDisabled);
    this.purgeLogins();
    if (this.logins.size >= MAX_PENDING_LOGINS) throw new DiscordError(503, "busy", TEXT.busy);
    const state = token32();
    this.logins.set(sha(state), { nonce: sha(nonce), retour: safeRetour(retour), expires: Date.now() + STATE_TTL_MS });
    return this.oauth.authorizeUrl(state);
  }

  /** Ce retour de Discord est-il celui d'une connexion (et non d'une liaison) ? */
  isLoginState(state: string | undefined): boolean {
    return typeof state === "string" && B64URL_43.test(state) && this.logins.has(sha(state));
  }

  /**
   * Retour de Discord pour une connexion. Ordre imposé : (1) state connu, non expiré, consommé (usage unique, quel que
   * soit le résultat), venu du MÊME navigateur (jeton) ; (2) seulement alors, échange du code et /users/@me ;
   * (3) compte AETHRYON lié à ce Discord, sinon refus ; ticket d'une minute pour la création de la session.
   */
  async finishLogin(nonce: string | null, q: { code?: string; state?: string; error?: string }): Promise<LoginResult> {
    if (!this.oauth || !this.loginEnabled) return { ok: false, reason: "fermee" };
    const hash = sha(q.state ?? "");
    const st = this.logins.get(hash);
    this.logins.delete(hash);
    if (!st || st.expires < Date.now() || !nonce || sha(nonce) !== st.nonce) {
      log("warn", "discord login refused", { reason: st ? "browser" : "state" });
      return { ok: false, reason: "expiree" };
    }
    if (q.error) return { ok: false, reason: q.error === "access_denied" ? "annulee" : "echec" };
    if (!q.code || !CODE_RE.test(q.code)) return { ok: false, reason: "echec" };
    let who: { id: string } & DiscordProfile;
    try {
      who = await this.oauth.identify(q.code);
    } catch (e) {
      log("warn", "discord login failed", { reason: e instanceof OAuthFailure ? e.message : "unknown" });
      return { ok: false, reason: "echec" };
    }
    const link = this.linkOfDiscord(who.id);
    if (!link) {
      log("info", "discord login refused", { reason: "not_linked" });
      return { ok: false, reason: "non-liee" };
    }
    // Profil à jour (nom, image), comme à chaque passage par Discord.
    await writeTx(this.db, () => {
      this.db.prepare("UPDATE ytc_discord_link SET discord_name = ?, discord_display = ?, discord_avatar = ? WHERE user_id = ?").run(who.name, who.display, who.avatar, link.user_id);
    });
    this.purgeLogins();
    const ticket = token32();
    this.tickets.set(sha(ticket), { userId: link.user_id, nonce: st.nonce, retour: st.retour, expires: Date.now() + TICKET_TTL_MS });
    log("info", "discord login", { user: link.user_id });
    return { ok: true, ticket };
  }

  /** Ticket présenté à Better Auth par le MÊME navigateur : compte et page de retour, une seule fois, 60 s. */
  consumeTicket(ticket: string, nonce: string | null): { userId: string; retour: string } | null {
    if (!B64URL_43.test(ticket)) return null;
    const h = sha(ticket);
    const t = this.tickets.get(h);
    this.tickets.delete(h);
    if (!t || t.expires < Date.now() || !nonce || sha(nonce) !== t.nonce) return null;
    return { userId: t.userId, retour: t.retour };
  }

  private purgeLogins(): void {
    const now = Date.now();
    for (const [k, v] of this.logins) if (v.expires < now) this.logins.delete(k);
    for (const [k, v] of this.tickets) if (v.expires < now) this.tickets.delete(k);
  }

  private linkOfUser(userId: string): LinkRow | undefined {
    return this.db.prepare("SELECT * FROM ytc_discord_link WHERE user_id = ?").get(userId) as LinkRow | undefined;
  }
  private linkOfDiscord(discordUserId: string): LinkRow | undefined {
    return this.db.prepare("SELECT * FROM ytc_discord_link WHERE discord_user_id = ?").get(discordUserId) as LinkRow | undefined;
  }
  private view(r: LinkRow): LinkView {
    return { name: r.discord_name, linkedAt: r.linked_at, lastUsedAt: r.last_used_at, displayName: r.discord_display ?? null, avatarVersion: r.discord_avatar ? r.discord_avatar.slice(-8) : null };
  }

  /** Statut pour la page du site (le compte lié reste visible et déliable même si la fonction est fermée). */
  status(userId: string): { enabled: boolean; linked: boolean; discord: LinkView | null } {
    const r = this.linkOfUser(userId);
    return { enabled: this.enabled, linked: !!r, discord: r ? this.view(r) : null };
  }

  /** Démarre la liaison : `state` (32 octets) dont seule l'empreinte est stockée, lié au compte et à la session. */
  async start(user: SessionUser, sessionId: string): Promise<string> {
    if (!this.oauth) throw new DiscordError(503, "discord_disabled", TEXT.disabled);
    if (this.linkOfUser(user.id)) throw new DiscordError(409, "already_linked", TEXT.alreadyLinked);
    const state = token32();
    const now = Date.now();
    await writeTx(this.db, () => {
      this.db.prepare("INSERT INTO ytc_discord_state (state_hash, user_id, session_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
        .run(sha(state), user.id, sha(sessionId), new Date(now).toISOString(), new Date(now + STATE_TTL_MS).toISOString());
    });
    return this.oauth.authorizeUrl(state);
  }

  /**
   * Retour de Discord. Ordre imposé : (1) state reconnu, non expiré, jamais utilisé, du MÊME compte et de la
   * MÊME session, consommé atomiquement ; (2) seulement alors, échange du code et lecture de /users/@me ;
   * (3) liaison (refus si ce Discord est lié à un autre compte, ou ce compte à un autre Discord).
   */
  async finish(user: SessionUser | null, sessionId: string | null, q: { code?: string; state?: string; error?: string }): Promise<LinkResult> {
    if (!this.oauth) return "fermee";
    const state = q.state ?? "";
    if (!B64URL_43.test(state)) {
      log("warn", "discord link refused", { reason: "state_format" });
      return "expiree";
    }
    const hash = sha(state);
    const now = nowIso();
    if (!user || !sessionId) {
      // Retour sans session (cookie absent ou expiré) : impossible de vérifier à qui appartient le state ; brûlé.
      await writeTx(this.db, () => { this.db.prepare("UPDATE ytc_discord_state SET used_at = COALESCE(used_at, ?) WHERE state_hash = ?").run(now, hash); });
      log("warn", "discord link refused", { reason: "no_session" });
      return "expiree";
    }
    const claimed = await writeTx(this.db, () => {
      const r = this.db.prepare(
        "UPDATE ytc_discord_state SET used_at = ? WHERE state_hash = ? AND used_at IS NULL AND expires_at > ? AND user_id = ? AND session_hash = ?",
      ).run(now, hash, now, user.id, sha(sessionId));
      if (Number(r.changes) === 1) return true;
      // Quel que soit le motif (inconnu, expiré, rejoué, autre compte ou autre session), le state est brûlé.
      this.db.prepare("UPDATE ytc_discord_state SET used_at = COALESCE(used_at, ?) WHERE state_hash = ?").run(now, hash);
      return false;
    });
    if (!claimed) {
      log("warn", "discord link refused", { user: user.id, reason: "state" });
      return "expiree";
    }
    if (q.error) {
      log("info", "discord link cancelled", { user: user.id });
      return q.error === "access_denied" ? "annulee" : "echec";
    }
    if (!q.code || !CODE_RE.test(q.code)) return "echec";
    let who: { id: string } & DiscordProfile;
    try {
      who = await this.oauth.identify(q.code);
    } catch (e) {
      log("warn", "discord link failed", { user: user.id, reason: e instanceof OAuthFailure ? e.message : "unknown" });
      return "echec";
    }
    const result = await writeTx(this.db, (): LinkResult => {
      const mine = this.linkOfUser(user.id);
      if (mine && mine.discord_user_id !== who.id) return "autre-discord";
      const other = this.linkOfDiscord(who.id);
      if (other && other.user_id !== user.id) return "deja-liee";
      if (mine) {
        this.db.prepare("UPDATE ytc_discord_link SET discord_name = ?, discord_display = ?, discord_avatar = ? WHERE user_id = ?").run(who.name, who.display, who.avatar, user.id);
      } else {
        this.db.prepare("INSERT INTO ytc_discord_link (discord_user_id, user_id, discord_name, discord_display, discord_avatar, linked_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(who.id, user.id, who.name, who.display, who.avatar, nowIso());
      }
      return "ok";
    }).catch((e: unknown) => {
      // Course perdue sur l'unicité (même Discord lié au même instant à un autre compte).
      if (/UNIQUE|constraint/i.test(String((e as Error)?.message))) return "deja-liee" as const;
      throw e;
    });
    log(result === "ok" ? "info" : "warn", result === "ok" ? "discord linked" : "discord link refused", { user: user.id, ...(result === "ok" ? {} : { reason: result }) });
    return result;
  }

  /** Déliaison : clés « discord » actives révoquées (motif « unlink »), liens et états en attente effacés. */
  async unlink(userId: string): Promise<boolean> {
    const had = !!this.linkOfUser(userId);
    const revoked = await this.keys.revokeKind(userId, "discord", "unlink");
    await writeTx(this.db, () => {
      this.db.prepare("DELETE FROM ytc_discord_link WHERE user_id = ?").run(userId);
      this.db.prepare("DELETE FROM ytc_discord_download WHERE user_id = ?").run(userId);
      this.db.prepare("DELETE FROM ytc_discord_state WHERE user_id = ?").run(userId);
    });
    if (had || revoked) log("info", "discord unlinked", { user: userId, revokedKeys: revoked });
    return had;
  }

  /** Données de la liaison pour l'export du compte (l'identifiant Discord appartient à l'utilisateur). */
  exportFor(userId: string): { discordUserId: string; name: string; displayName: string | null; avatarHash: string | null; linkedAt: string; lastUsedAt: string | null } | null {
    const r = this.linkOfUser(userId);
    return r ? { discordUserId: r.discord_user_id, name: r.discord_name, displayName: r.discord_display, avatarHash: r.discord_avatar, linkedAt: r.linked_at, lastUsedAt: r.last_used_at } : null;
  }

  /** Ce qui est relié à Discord pour ce compte, pour l'espace : conversions lancées depuis Discord (30 jours, clés
   *  « discord » encore connues), médias enregistrés, préférences du bot. Lecture seule. */
  activity(userId: string): { conversions30d: number; saved: number; prefs: { fmt: string; quality: string; visibility: string } } {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const conv = this.db.prepare(
      "SELECT count(*) AS n FROM ytc_usage u JOIN ytc_key_meta k ON k.key_id = u.key_id WHERE u.user_id = ? AND k.kind = 'discord' AND u.state = 'done' AND u.created_at >= ?",
    ).get(userId, since) as { n: number };
    const saved = this.db.prepare("SELECT count(*) AS n FROM ytc_saved_media WHERE user_id = ?").get(userId) as { n: number };
    const p = this.db.prepare("SELECT fmt, quality, visibility FROM ytc_user_pref WHERE user_id = ?").get(userId) as { fmt: string; quality: string; visibility: string } | undefined;
    return { conversions30d: Number(conv.n), saved: Number(saved.n), prefs: p ?? { fmt: "mp4", quality: "auto", visibility: "private" } };
  }

  /** Empreinte de l'image de profil du compte lié (relais /api/discord/avatar). */
  avatarOf(userId: string): { discordUserId: string; hash: string | null } | null {
    const r = this.linkOfUser(userId);
    return r ? { discordUserId: r.discord_user_id, hash: r.discord_avatar } : null;
  }

  /** Le bot a vu ce compte Discord dans une interaction : nom d'utilisateur, nom affiché et image tenus à jour (une
   *  écriture seulement s'ils ont changé). */
  private async refreshProfile(r: LinkRow, p: DiscordProfile | null | undefined): Promise<void> {
    if (!p) return;
    const name = cleanDiscordName(p.name, null);
    const display = cleanDisplayName(p.display);
    const avatar = typeof p.avatar === "string" && AVATAR_RE.test(p.avatar) ? p.avatar : null;
    if (!name) return;
    const disp = display && display !== name ? display : null;
    if (name === r.discord_name && disp === (r.discord_display ?? null) && avatar === (r.discord_avatar ?? null)) return;
    try {
      await writeTx(this.db, () => {
        this.db.prepare("UPDATE ytc_discord_link SET discord_name = ?, discord_display = ?, discord_avatar = ? WHERE discord_user_id = ?").run(name, disp, avatar, r.discord_user_id);
      });
      r.discord_name = name; r.discord_display = disp; r.discord_avatar = avatar;
    } catch (e) {
      log("warn", "discord profile not recorded", { err: String(e) });
    }
  }

  // ---- API interne du bot -----------------------------------------------------------------------

  private async touch(r: LinkRow): Promise<void> {
    const now = Date.now();
    const last = this.lastUsedWrite.get(r.user_id);
    if (last !== undefined && now - last < LAST_USED_EVERY_MS) return;
    this.lastUsedWrite.set(r.user_id, now);
    if (this.lastUsedWrite.size > 10_000) for (const [k, t] of this.lastUsedWrite) if (now - t >= LAST_USED_EVERY_MS) this.lastUsedWrite.delete(k);
    try {
      await writeTx(this.db, () => { this.db.prepare("UPDATE ytc_discord_link SET last_used_at = ? WHERE user_id = ?").run(new Date(now).toISOString(), r.user_id); });
    } catch (e) {
      log("warn", "discord last use not recorded", { err: String(e) });
    }
  }

  /** Compte lié et actif, ou refus typé (non lié 404, suspendu 403). */
  private activeLink(discordUserId: string): { link: LinkRow; user: { id: string; email: string; name: string | null } } {
    const link = this.linkOfDiscord(discordUserId);
    if (!link) throw new DiscordError(404, "not_linked", TEXT.notLinked);
    const user = this.db.prepare('SELECT id, email, name, status FROM "user" WHERE id = ?').get(link.user_id) as
      { id: string; email: string; name: string | null; status: string | null } | undefined;
    if (!user) throw new DiscordError(404, "not_linked", TEXT.notLinked);
    if (user.status === "suspended") throw new DiscordError(403, "account_suspended", TEXT.suspended);
    return { link, user };
  }

  /** « Qui est ce compte Discord ? » : lié ou non, état, nom, e-mail masqué, quota du jour (format de /api/me). */
  async resolve(discordUserId: string, profile?: DiscordProfile | null): Promise<Resolved> {
    const link = this.linkOfDiscord(discordUserId);
    if (!link) return { linked: false };
    const u = this.db.prepare('SELECT email, name, status FROM "user" WHERE id = ?').get(link.user_id) as
      { email: string; name: string | null; status: string | null } | undefined;
    if (!u) return { linked: false };
    if (u.status === "suspended") return { linked: true, status: "suspended" };
    await this.touch(link);
    await this.refreshProfile(link, profile);
    const { today, policy } = this.usage.todayWithPolicy(link.user_id);
    return {
      linked: true, status: "active",
      user: { name: u.name ?? "", email: maskEmail(u.email) },
      discord: this.view(link),
      today, maxActive: policy.maxActive,
    };
  }

  /**
   * Clé ytc_ « discord » de 15 min pour lancer UNE conversion avec le quota du compte (ytapi la valide comme
   * toute clé : même compteur, même historique). Jamais pour un compte non lié ou suspendu, ni pendant une
   * pause des conversions ; au plus MAX_DISCORD_KEYS actives.
   */
  async session(discordUserId: string): Promise<{ key: string; keyId: string; expiresAt: string | null }> {
    const { link, user } = this.activeLink(discordUserId);
    if (getSettings(this.db).conversionsPaused) throw new DiscordError(503, "service_paused", TEXT.paused);
    await this.touch(link);
    let out: Awaited<ReturnType<KeyService["createDiscordKey"]>>;
    try {
      out = await this.keys.createDiscordKey(user.id, "session");
    } catch (e) {
      if (e instanceof KeyError) throw new DiscordError(e.status, e.code, e.message);
      throw e;
    }
    log("info", "discord key issued", { user: user.id, keyRef: out.key.id });
    return { key: out.secret, keyId: out.key.id, expiresAt: out.key.expiresAt };
  }

  /** Fin de conversion : la clé « discord » est rendue (révoquée, motif « released »). Idempotent. */
  async release(discordUserId: string, keyId: string): Promise<void> {
    const link = this.linkOfDiscord(discordUserId);
    if (!link) throw new DiscordError(404, "not_linked", TEXT.notLinked);
    const meta = this.db.prepare("SELECT kind, revoked_at FROM ytc_key_meta WHERE key_id = ? AND user_id = ?").get(keyId, link.user_id) as
      { kind: string; revoked_at: string | null } | undefined;
    if (!meta || meta.kind !== "discord") throw new DiscordError(404, "key_not_found", "Clé introuvable.");
    if (meta.revoked_at) return;
    try {
      await this.keys.revoke(link.user_id, keyId, "released");
    } catch (e) {
      if (e instanceof KeyError && e.status === 404) return; // déjà effacée (expirée) : rien à rendre
      throw e;
    }
  }

  /** Compte AETHRYON actif lié à cet identifiant Discord (bibliothèque, préférences) ; refus typé sinon. */
  userOf(discordUserId: string): string {
    return this.activeLink(discordUserId).user.id;
  }

  /** Déliaison demandée depuis Discord (/account unlink, après confirmation) : mêmes effets que depuis le site. */
  async unlinkFromDiscord(discordUserId: string): Promise<boolean> {
    const link = this.linkOfDiscord(discordUserId);
    if (!link) return false;
    await this.unlink(link.user_id);
    log("info", "discord unlinked from bot", { user: link.user_id });
    return true;
  }

  /** Historique récent du compte lié (date, format, plateforme, état, erreur : jamais de lien ni de titre). */
  history(discordUserId: string, limit: number) {
    const { link, user } = this.activeLink(discordUserId);
    void this.touch(link);
    return { items: this.usage.activity(user.id, Math.min(Math.max(limit, 1), 25)), today: this.usage.todayWithPolicy(user.id).today };
  }

  /**
   * Fichier d'un job du compte lié, pour une PIÈCE JOINTE Discord (le bot l'envoie à l'utilisateur, en privé par
   * défaut) : refusé (413, taille connue) s'il dépasse `maxBytes`, la limite de la conversation Discord. Même
   * mécanique que le lien de téléchargement : clé « discord » éphémère, révoquée dès la réponse de ytapi.
   */
  async fileFor(discordUserId: string, jobId: string, maxBytes: number): Promise<{ ok: true; res: Response } | { ok: false; status: number; error: string; size?: number }> {
    const { link, user } = this.activeLink(discordUserId);
    await this.touch(link);
    const base = this.cfg.ytapiInternalUrl;
    if (!base || !base.startsWith("http://")) return { ok: false, status: 503, error: "download_unavailable" };
    let key: Awaited<ReturnType<KeyService["createDiscordKey"]>>;
    try {
      key = await this.keys.createDiscordKey(user.id, "download");
    } catch (e) {
      if (e instanceof KeyError) return { ok: false, status: e.status, error: e.code };
      throw e;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), YTAPI_HEADERS_TIMEOUT_MS);
    let up: Response;
    try {
      up = await this.ytapiFetch()(`${base}/jobs/${encodeURIComponent(jobId)}/file`, {
        headers: { authorization: `Bearer ${key.secret}`, accept: "*/*" }, redirect: "manual", signal: ctrl.signal,
      });
    } catch {
      clearTimeout(timer);
      await this.keys.revoke(user.id, key.key.id, "released").catch(() => undefined);
      return { ok: false, status: 503, error: "download_unavailable" };
    }
    clearTimeout(timer);
    await this.keys.revoke(user.id, key.key.id, "released").catch(() => undefined);
    if (up.status !== 200 || !up.body) {
      await up.body?.cancel().catch(() => undefined);
      return { ok: false, status: up.status === 404 || up.status === 410 ? 410 : 503, error: up.status === 404 || up.status === 410 ? "file_gone" : "download_unavailable" };
    }
    const len = up.headers.get("content-length");
    const size = len && /^\d+$/.test(len) ? Number(len) : null;
    if (size === null || size > maxBytes) {
      await up.body.cancel().catch(() => undefined);
      return { ok: false, status: 413, error: "too_large", ...(size !== null ? { size } : {}) };
    }
    const headers = new Headers({
      "content-type": up.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition": up.headers.get("content-disposition") ?? "attachment",
      "content-length": String(size),
      "cache-control": "no-store",
    });
    log("info", "discord file served to bot", { user: user.id, job: jobId, bytes: size });
    return { ok: true, res: new Response(up.body, { status: 200, headers }) };
  }

  /** Lien de téléchargement à usage unique (10 min) pour un job du compte lié ; seule l'empreinte est stockée. */
  async createDownload(discordUserId: string, jobId: string): Promise<{ url: string; expiresAt: string }> {
    const { link, user } = this.activeLink(discordUserId);
    await this.touch(link);
    const token = token32();
    const now = Date.now();
    const expiresAt = new Date(now + DOWNLOAD_TTL_MS).toISOString();
    await writeTx(this.db, () => {
      const pending = this.db.prepare("SELECT count(*) AS n FROM ytc_discord_download WHERE user_id = ? AND used_at IS NULL AND expires_at > ?")
        .get(user.id, new Date(now).toISOString()) as { n: number };
      if (Number(pending.n) >= MAX_PENDING_DOWNLOADS) throw new DiscordError(429, "too_many_downloads", TEXT.tooManyDownloads);
      this.db.prepare("INSERT INTO ytc_discord_download (token_hash, user_id, job_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
        .run(sha(token), user.id, jobId, new Date(now).toISOString(), expiresAt);
    });
    log("info", "discord download link issued", { user: user.id, job: jobId });
    return { url: `${this.cfg.publicUrl}/api/discord/telechargement?jeton=${token}`, expiresAt };
  }

  /**
   * Utilisation d'un lien : réservé atomiquement (usage unique), puis fichier demandé à ytapi avec une clé
   * « discord » éphémère du compte (révoquée dès la réponse de ytapi). Erreur passagère (ytapi injoignable,
   * 5xx, limite) : le lien redevient utilisable jusqu'à son expiration ; fichier expiré : lien consommé.
   */
  async download(token: string): Promise<{ ok: true; res: Response } | { ok: false; error: DownloadError }> {
    if (!B64URL_43.test(token)) return { ok: false, error: "invalide" };
    const hash = sha(token);
    const now = nowIso();
    const row = await writeTx(this.db, () => {
      const r = this.db.prepare("UPDATE ytc_discord_download SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?").run(now, hash, now);
      const found = this.db.prepare("SELECT user_id, job_id, used_at FROM ytc_discord_download WHERE token_hash = ?").get(hash) as
        { user_id: string; job_id: string; used_at: string | null } | undefined;
      return found ? { ...found, claimed: Number(r.changes) === 1 } : null;
    });
    if (!row) return { ok: false, error: "invalide" };
    if (!row.claimed) return { ok: false, error: row.used_at ? "utilise" : "expire" };
    const release = () => writeTx(this.db, () => {
      this.db.prepare("UPDATE ytc_discord_download SET used_at = NULL WHERE token_hash = ? AND used_at = ?").run(hash, now);
    }).catch(() => undefined);
    const u = this.db.prepare('SELECT status FROM "user" WHERE id = ?').get(row.user_id) as { status: string | null } | undefined;
    if (!u || u.status === "suspended" || !this.linkOfUser(row.user_id)) return { ok: false, error: "compte" };
    const base = this.cfg.ytapiInternalUrl;
    if (!base || !base.startsWith("http://")) {
      log("error", "discord download: YTAPI_INTERNAL_URL is not an internal http:// address");
      await release();
      return { ok: false, error: "indisponible" };
    }
    let key: Awaited<ReturnType<KeyService["createDiscordKey"]>>;
    try {
      key = await this.keys.createDiscordKey(row.user_id, "download");
    } catch (e) {
      log("warn", "discord download: key not issued", { user: row.user_id, err: e instanceof KeyError ? e.code : String(e) });
      await release();
      return { ok: false, error: "indisponible" };
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), YTAPI_HEADERS_TIMEOUT_MS); // en-têtes seulement : jamais pendant le flux
    let up: Response;
    try {
      up = await this.ytapiFetch()(`${base}/jobs/${encodeURIComponent(row.job_id)}/file`, {
        headers: { authorization: `Bearer ${key.secret}`, accept: "*/*" },
        redirect: "manual",
        signal: ctrl.signal,
      });
    } catch {
      clearTimeout(timer);
      await this.keys.revoke(row.user_id, key.key.id, "released").catch(() => undefined);
      log("warn", "discord download: ytapi unreachable", { user: row.user_id, job: row.job_id });
      await release();
      return { ok: false, error: "indisponible" };
    }
    clearTimeout(timer);
    // La clé n'a servi qu'à ouvrir la réponse : rendue tout de suite (le flux continue).
    await this.keys.revoke(row.user_id, key.key.id, "released").catch(() => undefined);
    if (up.status !== 200 || !up.body) {
      await up.body?.cancel().catch(() => undefined);
      const gone = up.status === 404 || up.status === 410;
      log("warn", "discord download: ytapi refused", { user: row.user_id, job: row.job_id, status: up.status });
      if (!gone) await release();
      return { ok: false, error: gone ? "fichier-expire" : up.status === 429 ? "limite" : "indisponible" };
    }
    const headers = new Headers({
      "content-type": up.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition": up.headers.get("content-disposition") ?? "attachment",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    const len = up.headers.get("content-length");
    if (len && /^\d+$/.test(len)) headers.set("content-length", len);
    log("info", "discord download served", { user: row.user_id, job: row.job_id });
    return { ok: true, res: new Response(up.body, { status: 200, headers }) };
  }
}

/** Chemins publics qui ne lisent pas la session : le lien de téléchargement est un secret porteur à part entière. */
export const DISCORD_SESSIONLESS_PATHS: ReadonlySet<string> = new Set(["/api/discord/telechargement"]);

export function mountDiscord(app: Hono<{ Variables: Vars }>, s: { cfg: Config; discord: DiscordService }): void {
  const { cfg, discord } = s;
  const startLimiter = new Limiter(10, 600_000);     // démarrages : 10 par 10 min et par compte
  const unlinkLimiter = new Limiter(10, 600_000);    // déliaisons : 10 par 10 min et par compte
  const downloadLimiter = new Limiter(30, 60_000);   // liens utilisés : 30 par minute et par IP
  const back = (r: LinkResult) => `${cfg.publicUrl}/dashboard/discord?liaison=${r}`;
  const fail = (e: DownloadError) => `${cfg.publicUrl}/discord/telechargement?erreur=${e}`;
  const discordError = (c: Context, e: unknown) => {
    if (e instanceof DiscordError) return err(c, e.status, e.code, e.message);
    throw e;
  };

  app.get("/api/discord", (c) => {
    const user = c.get("user");
    if (!user) return err(c, 401, "unauthorized", TEXT.unauthorized);
    const st = discord.status(user.id);
    return c.json(st.linked ? { ...st, activity: discord.activity(user.id) } : st);
  });

  // Image de profil Discord du compte lié, servie par le site (même origine : CSP inchangée). Session obligatoire ;
  // gardée en cache privé (le paramètre ?v= change avec l'image).
  app.get("/api/discord/avatar", async (c) => {
    const user = c.get("user");
    if (!user) return err(c, 401, "unauthorized", TEXT.unauthorized);
    const img = await discord.avatarImage(user.id);
    if (!img) return c.body(null, 404);
    return c.body(img.bytes as unknown as ArrayBuffer, 200, { "content-type": img.type, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" });
  });

  app.post("/api/discord/link", async (c) => {
    const user = c.get("user");
    const sessionId = c.get("sessionId");
    if (!user || !sessionId) return err(c, 401, "unauthorized", TEXT.unauthorized);
    if (!discord.enabled) return err(c, 503, "discord_disabled", TEXT.disabled);
    if (!startLimiter.take(user.id)) return err(c, 429, "rate_limited", TEXT.tooManyStarts);
    try {
      return c.json({ url: await discord.start(user, sessionId) });
    } catch (e) { return discordError(c, e); }
  });

  // V3.5 : « Continuer avec Discord » (sans session) : jeton du navigateur en cookie HttpOnly, adresse de Discord.
  const loginLimiter = new Limiter(20, 600_000); // démarrages : 20 par 10 min et par adresse IP
  const secure = cfg.publicUrl.startsWith("https://");
  app.post("/api/discord/login", async (c) => {
    if (!discord.loginEnabled) return err(c, 503, "discord_login_disabled", TEXT.loginDisabled);
    if (!loginLimiter.take(c.req.header(cfg.ipHeader) ?? "unknown")) return err(c, 429, "rate_limited", TEXT.tooManyStarts);
    const body = (await c.req.json().catch(() => null)) as { retour?: unknown } | null;
    const nonce = token32();
    try {
      const url = discord.startLogin(nonce, safeRetour(body?.retour));
      setCookie(c, LOGIN_NONCE_COOKIE, nonce, { path: "/api", httpOnly: true, secure, sameSite: "Lax", maxAge: STATE_TTL_MS / 1000 });
      return c.json({ url });
    } catch (e) { return discordError(c, e); }
  });

  // Retour de Discord (navigation de premier niveau : les cookies SameSite=Lax sont présents) : connexion (state
  // d'une connexion en cours) ou liaison.
  app.get("/api/discord/callback", async (c) => {
    const one = (k: string) => { const v = c.req.query(k); return typeof v === "string" ? v.slice(0, 500) : undefined; };
    c.header("Referrer-Policy", "no-referrer");
    const q = { code: one("code"), state: one("state"), error: one("error") };
    if (discord.isLoginState(q.state)) {
      const r = await discord.finishLogin(getCookie(c, LOGIN_NONCE_COOKIE) ?? null, q);
      if (!r.ok) {
        deleteCookie(c, LOGIN_NONCE_COOKIE, { path: "/api", secure });
        return c.redirect(`${cfg.publicUrl}/connexion?discord=${r.reason}`, 302);
      }
      // La session est créée par Better Auth (route /api/auth/discord-session), avec ce ticket d'une minute.
      return c.redirect(`${cfg.publicUrl}/api/auth/discord-session?ticket=${r.ticket}`, 302);
    }
    const result = await discord.finish(c.get("user"), c.get("sessionId"), q);
    return c.redirect(back(result), 302);
  });

  app.post("/api/discord/unlink", async (c) => {
    const user = c.get("user");
    if (!user) return err(c, 401, "unauthorized", TEXT.unauthorized);
    if (!unlinkLimiter.take(user.id)) return err(c, 429, "rate_limited", TEXT.tooManyUnlinks);
    await discord.unlink(user.id);
    return c.body(null, 204);
  });

  // Lien de téléchargement remis par le bot (secret porteur à usage unique, 10 min) : jeton dans la query
  // string (jamais journalisée par nginx ni par account), réponse jamais mise en cache.
  app.get("/api/discord/telechargement", async (c) => {
    c.header("Referrer-Policy", "no-referrer");
    if (!downloadLimiter.take(c.req.header(cfg.ipHeader) ?? "unknown")) return c.redirect(fail("limite"), 302);
    const out = await discord.download(c.req.query("jeton") ?? "");
    if (!out.ok) return c.redirect(fail(out.error), 302);
    return out.res;
  });
}

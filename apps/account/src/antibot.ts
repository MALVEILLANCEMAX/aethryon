// Protection anti-bot progressive (docs/SECURITE-ANTIBOT.md) : Cap.js auto-hébergé, vérifié CÔTÉ SERVEUR.
//
// Niveau 1 — visiteur normal : rien n'est demandé.
// Niveau 2 — action sensible du SITE (session par cookie, jamais un client à clé) : un défi Cap est exigé
//   - inscription (demande de code) et « mot de passe oublié » : à chaque demande (envoi d'un e-mail à un tiers) ;
//   - connexion par mot de passe : après ANTIBOT_LOGIN_FAILURES échecs, pour l'adresse visée OU pour le sujet ;
//   - travaux (Tools : aperçu, ouverture, import, export ; Music : import) : au-delà de ANTIBOT_TRAVAUX_SEUIL en
//     10 minutes, ou dès la première action si plusieurs signaux d'automatisation se cumulent (score ≥ 2).
//     Un défi réussi ouvre un laissez-passer SERVEUR (mémoire du processus, aucun cookie) de ANTIBOT_PASS_TTL_S.
// Niveau 3 — activité suspecte : 429 « temporarily_blocked » sur les actions sensibles pendant ANTIBOT_BLOCK_S après
//   ANTIBOT_ECHECS_BLOCAGE preuves refusées en 15 min, ou après 20 refus 429 en 10 min cumulés à un autre signal.
//
// Sujet : le compte connecté, sinon une empreinte HMAC(IP + agent HTTP) — jamais l'IP seule. Preuve : ticket émis
// ici (aléatoire, lié au sujet et à l'action, ANTIBOT_TICKET_TTL_S, usage unique) + jeton Cap vérifié par siteverify
// sur le réseau interne (Cap le supprime à la lecture : rejeu impossible) + liste locale des jetons déjà présentés.
// Une animation, un cookie posé par JavaScript ou un en-tête seul ne prouvent jamais rien.
// Supervision : compteurs par jour et événements récents (migration 016), sans e-mail, IP tronquée, sujet haché.
import { createHash, createHmac, randomBytes } from "node:crypto";
import type { Context } from "hono";
import type { Config } from "./config.ts";
import { writeTx, type DB } from "./db.ts";
import { err, type Vars } from "./http.ts";
import { log } from "./log.ts";

export type AntibotAction = "inscription" | "mot_de_passe" | "connexion" | "travaux";
export const TICKET_HEADER = "x-aethryon-challenge";
export const TOKEN_HEADER = "x-aethryon-verification";
/** Réponse d'une requête dont la preuve vient d'être ACCEPTÉE par le serveur (l'interface n'allume les yeux qu'alors). */
export const VERIFIED_HEADER = "X-Aethryon-Verification";

const MIN = 60_000;
const NB = "\u00a0";
const TICKET_RE = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_RE = /^[0-9a-f]{10}:[A-Za-z0-9_-]{1,200}:[A-Za-z0-9_-]{1,200}$/;
// Agents HTTP d'outils et de navigateurs pilotés (signal, jamais une condition suffisante de blocage).
const TOOL_UA = /(curl|wget|python|httpx|aiohttp|go-http|java\/|okhttp|libwww|node-fetch|undici|axios|postman|insomnia|scrapy|headless|phantomjs|selenium|puppeteer|playwright)/i;

export const TEXT = {
  required: "Vérification de sécurité nécessaire pour continuer.",
  failed: `La vérification n'a pas abouti${NB}: recommence.`,
  expired: `La vérification a expiré${NB}: recommence.`,
  unavailable: `La vérification de sécurité est momentanément indisponible${NB}: réessaie dans un instant.`,
  blocked: `Trop de tentatives refusées${NB}: cette action est suspendue quelques minutes.`,
} as const;

interface Subject {
  fails: number[];            // preuves refusées
  limited: number[];          // réponses 429 reçues
  loginFails: number[];       // connexions par mot de passe refusées
  travaux: number[];          // travaux demandés depuis le site
  passUntil: number;          // laissez-passer « travaux »
  blockedUntil: number;
  lastEvent: Map<string, number>;
  seen: number;
}
interface Ticket { subject: string; action: AntibotAction; expiresAt: number }
export interface GuardResult { deny: Response | null; verified: boolean }

const recent = (list: number[], now: number, windowMs: number) => {
  while (list.length && now - list[0]! >= windowMs) list.shift();
  return list.length;
};
const today = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

/** IP tronquée pour le journal : /24 (IPv4) ou /48 (IPv6) ; jamais l'adresse complète. */
export function ipPrefix(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const v = ip.trim().replace(/^::ffff:/i, "");
  const m4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(v);
  if (m4) return `${m4[1]}.${m4[2]}.${m4[3]}.0/24`;
  if (/^[0-9a-f:]+$/i.test(v) && v.includes(":")) {
    const head = v.split("::")[0]!.split(":").filter(Boolean);
    const groups = [...head, "0", "0", "0"].slice(0, 3);
    return `${groups.join(":")}::/48`;
  }
  return null;
}

export class Antibot {
  readonly cfg: Config["antibot"];
  private db: DB;
  private ipHeader: string;
  private fetchImpl: () => typeof fetch;
  private key: Buffer;
  private subjects = new Map<string, Subject>();
  private tickets = new Map<string, Ticket>();
  private usedTokens = new Map<string, number>();
  private emailFails = new Map<string, number[]>();
  private counters = new Map<string, number>();
  private events: { at: string; kind: string; action: string; subject: string; ip_prefix: string | null; detail: string | null }[] = [];
  /** Requêtes déjà comptées comme blocage (pas une seconde fois comme « requête limitée »). */
  private blockedRequests = new WeakSet<Request>();
  /** Requêtes dont la preuve a été acceptée : en-tête VERIFIED_HEADER ajouté à la réponse. */
  private verifiedRequests = new WeakSet<Request>();
  private timer: NodeJS.Timeout | null = null;

  constructor(cfg: Config, db: DB, fetchImpl?: typeof fetch) {
    this.cfg = cfg.antibot;
    this.db = db;
    this.ipHeader = cfg.ipHeader;
    this.fetchImpl = () => fetchImpl ?? globalThis.fetch;
    // Clé des empreintes de sujets : dérivée du secret du serveur (une copie de la base ne permet pas de les inverser).
    this.key = createHash("sha256").update(`ytc-antibot:${cfg.authSecret}`).digest();
    if (this.cfg.mode !== "off") {
      this.timer = setInterval(() => { void this.flush(); this.sweep(); }, 15_000);
      this.timer.unref();
    }
  }

  get enabled(): boolean { return this.cfg.mode !== "off"; }
  /** Point public du widget : relayé par le nginx du site vers Cap (challenge et redeem seulement). */
  get endpoint(): string | null { return this.cfg.siteKey ? `/cap/${this.cfg.siteKey}/` : null; }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  // ---- sujets et signaux ------------------------------------------------------------------------------------------

  private hmac(v: string): string { return createHmac("sha256", this.key).update(v).digest("hex"); }
  private ip(c: Context): string { return c.req.header(this.ipHeader) ?? "unknown"; }

  /** Compte connecté, sinon empreinte du couple (IP, agent HTTP) : jamais l'IP seule. */
  subjectOf(c: Context<{ Variables: Vars }>): string {
    const u = c.get("user");
    if (u) return `u:${u.id}`;
    return `a:${this.hmac(`${this.ip(c)}|${c.req.header("user-agent") ?? ""}`).slice(0, 32)}`;
  }
  private short(subject: string): string { return this.hmac(`sujet:${subject}`).slice(0, 12); }

  private state(subject: string): Subject {
    let s = this.subjects.get(subject);
    if (!s) {
      s = { fails: [], limited: [], loginFails: [], travaux: [], passUntil: 0, blockedUntil: 0, lastEvent: new Map(), seen: Date.now() };
      this.subjects.set(subject, s);
    }
    s.seen = Date.now();
    return s;
  }

  /** Signaux d'automatisation : agent d'outil (2), en-têtes Sec-Fetch absents (1), Accept-Language absent (1). */
  signals(c: Context): { score: number; list: string[] } {
    const list: string[] = [];
    let score = 0;
    const ua = c.req.header("user-agent") ?? "";
    if (!ua || TOOL_UA.test(ua)) { list.push("agent_outil"); score += 2; }
    if (!c.req.header("sec-fetch-site") || !c.req.header("sec-fetch-mode")) { list.push("sans_sec_fetch"); score += 1; }
    if (!c.req.header("accept-language")) { list.push("sans_langue"); score += 1; }
    return { score, list };
  }

  // ---- journal ----------------------------------------------------------------------------------------------------

  count(metric: string, action: string, n = 1): void {
    const k = `${today()}|${metric}|${action}`;
    this.counters.set(k, (this.counters.get(k) ?? 0) + n);
  }

  /** Événement suspect : au plus un par sujet, type et minute (un flot ne remplit pas la base). */
  private event(c: Context, subject: string, kind: string, action: string, detail: string | null = null): void {
    const s = this.state(subject);
    const now = Date.now();
    const key = `${kind}|${action}`;
    if (now - (s.lastEvent.get(key) ?? 0) < MIN) return;
    s.lastEvent.set(key, now);
    this.events.push({ at: new Date(now).toISOString(), kind, action, subject: this.short(subject), ip_prefix: ipPrefix(this.ip(c)), detail: detail?.slice(0, 200) ?? null });
    if (this.events.length > 2000) this.events.splice(0, this.events.length - 2000);
    log("warn", "antibot", { kind, action, subject: this.short(subject), detail });
  }

  /** Écrit les compteurs et événements en attente (une transaction, réessayée si la base est occupée). */
  async flush(): Promise<void> {
    if (!this.counters.size && !this.events.length) return;
    const counters = [...this.counters]; this.counters.clear();
    const events = this.events.splice(0);
    try {
      await writeTx(this.db, () => {
        const up = this.db.prepare("INSERT INTO ytc_security_counter (day, metric, action, n) VALUES (?, ?, ?, ?) ON CONFLICT(day, metric, action) DO UPDATE SET n = n + excluded.n");
        for (const [k, n] of counters) { const [d, m, a] = k.split("|"); up.run(d!, m!, a!, n); }
        const ins = this.db.prepare("INSERT INTO ytc_security_event (at, kind, action, subject, ip_prefix, detail) VALUES (?, ?, ?, ?, ?, ?)");
        for (const e of events) ins.run(e.at, e.kind, e.action, e.subject, e.ip_prefix, e.detail);
      });
    } catch (e) {
      // Rien de perdu : remis en attente pour la prochaine écriture.
      for (const [k, n] of counters) this.counters.set(k, (this.counters.get(k) ?? 0) + n);
      this.events.unshift(...events.slice(-1000));
      log("error", "antibot flush failed", { err: String((e as Error)?.message ?? e).slice(0, 120) });
    }
  }

  /** Purge quotidienne : événements au-delà de eventDays (et 5 000 lignes), compteurs au-delà de counterDays. */
  async purge(): Promise<{ events: number; counters: number }> {
    const evCut = new Date(Date.now() - this.cfg.eventDays * 86_400_000).toISOString();
    const ctCut = today(Date.now() - this.cfg.counterDays * 86_400_000);
    return writeTx(this.db, () => {
      const a = Number(this.db.prepare("DELETE FROM ytc_security_event WHERE at < ?").run(evCut).changes);
      const b = Number(this.db.prepare("DELETE FROM ytc_security_event WHERE id <= (SELECT id FROM ytc_security_event ORDER BY id DESC LIMIT 1 OFFSET 5000)").run().changes);
      const c = Number(this.db.prepare("DELETE FROM ytc_security_counter WHERE day < ?").run(ctCut).changes);
      return { events: a + b, counters: c };
    });
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, t] of this.tickets) if (t.expiresAt + 10 * MIN < now) this.tickets.delete(k);
    for (const [k, t] of this.usedTokens) if (t < now) this.usedTokens.delete(k);
    for (const [k, v] of this.emailFails) if (!recent(v, now, 15 * MIN)) this.emailFails.delete(k);
    for (const [k, s] of this.subjects) if (now - s.seen > 30 * MIN && s.blockedUntil < now && s.passUntil < now) this.subjects.delete(k);
  }

  // ---- niveau 3 : blocage ------------------------------------------------------------------------------------------

  private block(c: Context, subject: string, action: string, why: string): void {
    const s = this.state(subject);
    s.blockedUntil = Date.now() + this.cfg.blockS * 1000;
    this.count("block_started", action);
    this.event(c, subject, "blocage", action, why);
  }

  private blockedResponse(c: Context, until: number): Response {
    this.blockedRequests.add(c.req.raw);
    c.header("Retry-After", String(Math.max(1, Math.ceil((until - Date.now()) / 1000))));
    return err(c, 429, "temporarily_blocked", TEXT.blocked);
  }

  /** Toute réponse 429 de l'API (protections existantes comprises) : comptée, et peut mener à un blocage. */
  noteLimited(c: Context<{ Variables: Vars }>): void {
    if (this.blockedRequests.has(c.req.raw)) return;
    const group = (/^\/api\/([a-z0-9_-]{1,30})/i.exec(c.req.path)?.[1] ?? "autre").toLowerCase();
    this.count("rate_limited", group);
    if (!this.enabled) return;
    const subject = this.subjectOf(c);
    const s = this.state(subject);
    const now = Date.now();
    s.limited.push(now);
    this.event(c, subject, "limite", group);
    // 20 refus en 10 min ET un autre signal (automatisation, preuves refusées) : jamais le seul volume d'une IP.
    if (recent(s.limited, now, 10 * MIN) >= 20 && (this.signals(c).score >= 1 || recent(s.fails, now, 15 * MIN) >= 1) && s.blockedUntil < now && this.cfg.mode === "on") {
      this.block(c, subject, group, "rafale de refus 429 et signal d'automatisation");
    }
  }

  // ---- connexion ---------------------------------------------------------------------------------------------------

  private emailKey(email: string): string { return this.hmac(`email:${email.trim().toLowerCase()}`).slice(0, 32); }

  loginFailed(c: Context<{ Variables: Vars }>, email: string | null): void {
    if (!this.enabled) return;
    const now = Date.now();
    const subject = this.subjectOf(c);
    this.state(subject).loginFails.push(now);
    if (email) {
      const k = this.emailKey(email);
      const l = this.emailFails.get(k) ?? [];
      l.push(now);
      this.emailFails.set(k, l);
    }
    this.count("login_failed", "connexion");
  }

  loginSucceeded(c: Context<{ Variables: Vars }>, email: string | null): void {
    if (!this.enabled) return;
    this.state(this.subjectOf(c)).loginFails.length = 0;
    if (email) this.emailFails.delete(this.emailKey(email));
  }

  // ---- la porte ----------------------------------------------------------------------------------------------------

  private needs(c: Context<{ Variables: Vars }>, subject: string, action: AntibotAction, email: string | null): string | null {
    const s = this.state(subject);
    const now = Date.now();
    if (action === "inscription" || action === "mot_de_passe") return "action_sensible";
    if (action === "connexion") {
      const byEmail = email ? recent(this.emailFails.get(this.emailKey(email)) ?? [], now, 15 * MIN) : 0;
      const bySubject = recent(s.loginFails, now, 15 * MIN);
      return byEmail >= this.cfg.loginFailures || bySubject >= this.cfg.loginFailures ? "echecs_connexion" : null;
    }
    // travaux
    if (s.passUntil > now) return null;
    const sig = this.signals(c);
    if (sig.score >= 2) return `signaux:${sig.list.join(",")}`;
    if (recent(s.travaux, now, 10 * MIN) >= this.cfg.travauxSeuil) return "rythme";
    if (recent(s.fails, now, 15 * MIN) >= 1 || recent(s.limited, now, 10 * MIN) >= 3) return "antecedents";
    return null;
  }

  /**
   * Porte d'une action sensible : `deny` à renvoyer tel quel (défi exigé, preuve refusée ou expirée, blocage), sinon
   * `verified` vrai si une preuve vient d'être acceptée. Seules les routes du SITE (session par cookie) l'appellent :
   * les clients à clé (extension, raccourci, Desktop, Premiere, bot) passent par d'autres routes. Un en-tête
   * Authorization ajouté à une route du site ne dispense JAMAIS du défi.
   */
  async guard(c: Context<{ Variables: Vars }>, action: AntibotAction, opts: { email?: string | null } = {}): Promise<GuardResult> {
    if (this.cfg.mode === "off") return { deny: null, verified: false };
    const enforce = this.cfg.mode === "on";
    const subject = this.subjectOf(c);
    const s = this.state(subject);
    const now = Date.now();
    const email = opts.email ? opts.email.trim().toLowerCase() : null;

    if (s.blockedUntil > now) {
      this.count(enforce ? "blocked" : "observed_block", action);
      this.event(c, subject, "bloque", action);
      if (enforce) return { deny: this.blockedResponse(c, s.blockedUntil), verified: false };
    }

    const reason = this.needs(c, subject, action, email);
    const record = () => { if (action === "travaux") s.travaux.push(now); };
    if (!reason) { record(); return { deny: null, verified: false }; }
    if (!enforce) {
      this.count("challenge_observed", action);
      record();
      return { deny: null, verified: false };
    }

    const ticket = c.req.header(TICKET_HEADER);
    const token = c.req.header(TOKEN_HEADER);
    if (!ticket && !token) return { deny: this.challenge(c, subject, action, reason), verified: false };

    // Preuve présentée : ticket d'abord (usage unique, même sujet, même action, non expiré), puis jeton Cap.
    const fail = (kind: "challenge_failed" | "challenge_replay", why: string) => {
      this.count(kind, action);
      s.fails.push(now);
      this.event(c, subject, kind === "challenge_replay" ? "rejeu" : "preuve_refusee", action, why);
      if (recent(s.fails, now, 15 * MIN) >= this.cfg.echecsBlocage) {
        this.block(c, subject, action, `${this.cfg.echecsBlocage} preuves refusées en 15 min`);
        return { deny: this.blockedResponse(c, s.blockedUntil), verified: false };
      }
      return { deny: err(c, 403, "challenge_failed", TEXT.failed), verified: false };
    };
    if (!ticket || !TICKET_RE.test(ticket) || !token || token.length > 420 || !TOKEN_RE.test(token)) return fail("challenge_failed", "preuve mal formée");
    const tk = createHash("sha256").update(ticket).digest("hex");
    const t = this.tickets.get(tk);
    this.tickets.delete(tk);
    if (!t) return fail("challenge_failed", "ticket inconnu ou déjà utilisé");
    if (t.expiresAt <= now) {
      this.count("challenge_expired", action);
      return { deny: err(c, 403, "challenge_expired", TEXT.expired), verified: false };
    }
    if (t.subject !== subject || t.action !== action) return fail("challenge_failed", "ticket d'un autre sujet ou d'une autre action");
    if (!token.startsWith(`${this.cfg.siteKey}:`)) return fail("challenge_failed", "clé de site inattendue");
    const th = createHash("sha256").update(token).digest("hex");
    if (this.usedTokens.has(th)) return fail("challenge_replay", "jeton déjà présenté");
    this.usedTokens.set(th, now + 3 * 3_600_000);

    let ok: boolean;
    try {
      ok = await this.siteverify(token);
    } catch (e) {
      this.count("verify_unavailable", action);
      log("error", "antibot siteverify unavailable", { err: String((e as Error)?.message ?? e).slice(0, 120) });
      c.header("Retry-After", "10");
      return { deny: err(c, 503, "verification_unavailable", TEXT.unavailable), verified: false };
    }
    if (!ok) return fail("challenge_failed", "refusée par Cap (inconnue, expirée ou déjà utilisée)");

    this.count("challenge_passed", action);
    s.fails.length = 0;
    if (action === "travaux") { s.passUntil = now + this.cfg.passTtlS * 1000; s.travaux.length = 0; }
    record();
    this.verifiedRequests.add(c.req.raw);
    return { deny: null, verified: true };
  }

  private challenge(c: Context, subject: string, action: AntibotAction, reason: string): Response {
    const ticket = randomBytes(32).toString("base64url");
    this.tickets.set(createHash("sha256").update(ticket).digest("hex"), { subject, action, expiresAt: Date.now() + this.cfg.ticketTtlS * 1000 });
    if (this.tickets.size > 50_000) this.sweep();
    this.count("challenge_issued", action);
    log("info", "antibot challenge", { action, reason: reason.split(":")[0], subject: this.short(subject) });
    return c.json({ error: "challenge_required", message: TEXT.required, challenge: { ticket, endpoint: this.endpoint, action, expiresInSeconds: this.cfg.ticketTtlS } }, 403);
  }

  /** siteverify de Cap (réseau interne) : vrai seulement sur { success: true } ; Cap supprime le jeton à la lecture. */
  private async siteverify(token: string): Promise<boolean> {
    const res = await this.fetchImpl()(`${this.cfg.capUrl}/${this.cfg.siteKey}/siteverify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: this.cfg.secret, response: token }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.status >= 500) throw new Error(`siteverify ${res.status}`);
    const b = (await res.json().catch(() => null)) as { success?: unknown } | null;
    return res.status === 200 && b?.success === true;
  }

  /** Réponse finale : en-tête de vérification acceptée (le navigateur n'allume les yeux qu'avec lui). */
  decorate(c: Context): void {
    if (!this.verifiedRequests.has(c.req.raw)) return;
    try { c.res.headers.set(VERIFIED_HEADER, "ok"); } catch {
      c.res = new Response(c.res.body, c.res);
      c.res.headers.set(VERIFIED_HEADER, "ok");
    }
  }

  // ---- Control Center ----------------------------------------------------------------------------------------------

  /** Chiffres RÉELS (base + en attente d'écriture) pour la section « Sécurité ». */
  async report(): Promise<Record<string, unknown>> {
    await this.flush();
    const now = Date.now();
    const sum = (days: number) => {
      const rows = this.db.prepare("SELECT metric, action, sum(n) AS n FROM ytc_security_counter WHERE day >= ? GROUP BY metric, action").all(today(now - (days - 1) * 86_400_000)) as { metric: string; action: string; n: number }[];
      const out: Record<string, { total: number; parAction: Record<string, number> }> = {};
      for (const r of rows) {
        const m = (out[r.metric] ??= { total: 0, parAction: {} });
        m.total += Number(r.n);
        m.parAction[r.action] = Number(r.n);
      }
      return out;
    };
    const daily = this.db.prepare("SELECT day, metric, sum(n) AS n FROM ytc_security_counter WHERE day >= ? GROUP BY day, metric ORDER BY day").all(today(now - 13 * 86_400_000)) as { day: string; metric: string; n: number }[];
    const events = this.db.prepare("SELECT id, at, kind, action, subject, ip_prefix AS ipPrefix, detail FROM ytc_security_event ORDER BY id DESC LIMIT 50").all();
    let blocked = 0;
    for (const s of this.subjects.values()) if (s.blockedUntil > now) blocked++;
    return {
      mode: this.cfg.mode,
      capConfigured: Boolean(this.cfg.capUrl && this.cfg.siteKey && this.cfg.secret),
      reglages: { ticketTtlS: this.cfg.ticketTtlS, passTtlS: this.cfg.passTtlS, blockS: this.cfg.blockS, loginFailures: this.cfg.loginFailures, travauxSeuil: this.cfg.travauxSeuil, echecsBlocage: this.cfg.echecsBlocage, eventDays: this.cfg.eventDays, counterDays: this.cfg.counterDays },
      maintenant: { sujetsBloques: blocked, ticketsEnAttente: this.tickets.size, laissezPasser: [...this.subjects.values()].filter((s) => s.passUntil > now).length },
      jour: sum(1), semaine: sum(7), mois: sum(30),
      parJour: daily.map((r) => ({ day: r.day, metric: r.metric, n: Number(r.n) })),
      evenements: events,
    };
  }

  /** Santé de Cap (réseau interne) pour le Control Center : jamais bloquant. */
  async capHealth(): Promise<"ok" | "indisponible" | "coupe"> {
    if (!this.cfg.capUrl) return "coupe";
    try {
      const r = await this.fetchImpl()(`${this.cfg.capUrl}/health`, { signal: AbortSignal.timeout(2000) });
      await r.body?.cancel().catch(() => undefined);
      return r.status === 200 ? "ok" : "indisponible";
    } catch { return "indisponible"; }
  }
}

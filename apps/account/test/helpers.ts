// Outils de test : base temporaire, secrets factices (jamais réels), faux Google (aucun accès réseau).
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type Config } from "../src/config.ts";
import { buildServer, type Server } from "../src/server.ts";
import { setLogSink } from "../src/log.ts";
import type { Mail, Mailer } from "../src/mailer.ts";
import type { CloudStore } from "../src/cloud/stockage.ts";

export const ORIGIN = "https://app.example.test";
export const INTERNAL = "test-internal-token-" + "x".repeat(32);

// ---- faux Google : seul le point d'échange de jeton est simulé ; tout autre appel sortant échoue, SAUF vers
// 127.0.0.1 (faux serveurs locaux des tests, ex. le faux Discord de fake-discord.ts) : jamais vers Internet.
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
let nextProfile: Record<string, unknown> = {};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("http://127.0.0.1:")) return realFetch(input, init);
  if (url.startsWith("https://oauth2.googleapis.com/token")) {
    const now = Math.floor(Date.now() / 1000);
    const idToken = `${b64({ alg: "RS256", kid: "fake" })}.${b64({ iss: "https://accounts.google.com", aud: "test-client", iat: now, exp: now + 3600, ...nextProfile })}.sig`;
    return new Response(JSON.stringify({ access_token: "fake-access", refresh_token: "fake-refresh", id_token: idToken, expires_in: 3599, token_type: "Bearer", scope: "openid email profile" }), { headers: { "content-type": "application/json" } });
  }
  throw new Error("appel réseau bloqué pendant les tests : " + url);
}) as typeof fetch;

/** Faux ytapi (API interne comprise) : état, jobs actifs, annulations reçues, appels observés. */
export interface FakeYtapi {
  status: Record<string, unknown>;
  jobs: Record<string, unknown>[];
  cancelled: string[];
  cancelStatus: number;
  networkError: boolean;
  calls: { method: string; path: string; token: string | null; bearer?: boolean }[];
  /** Fichiers des jobs terminés (GET /jobs/{id}/file) : propriétaire, contenu ; `fileStatus` force une réponse. */
  files: Map<string, { userId: string; body: string; type: string; name: string }>;
  fileStatus: number | null;
  /** Gestionnaire supplémentaire (tests d'AETHRYON Tools) : une réponse, ou null pour le comportement par défaut. */
  handler?: (req: { method: string; url: URL; headers: Headers; body: unknown }) => Promise<Response | null>;
}

export const defaultYtapiStatus = (): Record<string, unknown> => ({
  status: "ok",
  queue: { pending: 1, running: 1, capacity: 6, jobs: { queued: 0, running: 1, done: 3, error: 0 } },
  platforms: {
    youtube: { state: "ok", since: null, last_success: null, last_error: null, last_error_at: null, cooldown_until: null },
    tiktok: { state: "ok", since: null, last_success: null, last_error: null, last_error_at: null, cooldown_until: null },
    twitter: { state: "unknown", since: null, last_success: null, last_error: null, last_error_at: null, cooldown_until: null },
  },
  disk: { free_bytes: 50 * 2 ** 30, reserved_bytes: 0, floor_bytes: 2 ** 30 },
  cache: { entries: 0 },
  versions: { yt_dlp: "2026.09.27", yt_dlp_ejs: "0.3.0", ffmpeg: "7.1.1", deno: "2.5.2" },
  tokens: { labels: ["ne-doit-pas-sortir"] },
});

export interface Harness { s: Server; cfg: Config; dir: string; env: Record<string, string>; logs: string[]; ytapiUp: { value: boolean }; ytapi: FakeYtapi; close(): void }

/** Faux relais d'e-mails : garde les messages (destinataire, sujet, texte) ; `fail` simule un relais en panne. */
export interface FakeMailer extends Mailer { sent: Mail[]; fail: boolean }
export function fakeMailer(): FakeMailer {
  const m: FakeMailer = { sent: [], fail: false, async send(x) { if (m.fail) throw new Error("relais en panne"); m.sent.push(x); } };
  return m;
}

export async function harness(env: Record<string, string> = {}, opts: { google?: boolean; discordTimeoutMs?: number; mailer?: Mailer; cloudStore?: CloudStore; cloudNow?: () => number } = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "ytc2-account-test-"));
  const w = (name: string, v: string) => { const p = join(dir, name); writeFileSync(p, v, { mode: 0o600 }); return p; };
  const base: Record<string, string> = {
    PUBLIC_URL: ORIGIN,
    BETTER_AUTH_SECRET_FILE: w("auth_secret", "test-only-secret-" + "s".repeat(40)),
    INTERNAL_TOKEN_FILE: w("internal", INTERNAL),
    DB_PATH: join(dir, "account.sqlite"),
    BACKUP_DIR: join(dir, "backups"),
    YTAPI_INTERNAL_URL: "http://ytapi.invalid:8000",
    DAILY_CONVERSIONS: "10",
    MAX_KEYS_PER_USER: "2",
    MAX_USERS: "50",
    ...env,
  };
  if (opts.google !== false) {
    base.GOOGLE_CLIENT_ID_FILE = w("gid", "test-client");
    base.GOOGLE_CLIENT_SECRET_FILE = w("gsecret", "test-secret-not-real");
  }
  const logs: string[] = [];
  setLogSink((l) => logs.push(l));
  const cfg = loadConfig(base as NodeJS.ProcessEnv);
  const ytapiUp = { value: true };
  const yt: FakeYtapi = { status: defaultYtapiStatus(), jobs: [], cancelled: [], cancelStatus: 200, networkError: false, calls: [], files: new Map(), fileStatus: null };
  let server: Server | null = null;
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
  const fakeYtapi = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    yt.calls.push({ method, path: url.pathname, token: headers.get("x-internal-token"), bearer: /^Bearer ytc_/.test(headers.get("authorization") ?? "") });
    if (yt.networkError) throw new TypeError("fetch failed");
    if (!ytapiUp.value) return new Response("down", { status: 503 });
    if (yt.handler) {
      const r = await yt.handler({ method, url, headers, body: init?.body });
      if (r) return r;
    }
    // Fichier d'un job (API publique de ytapi, clé utilisateur) : comme ytapi, la clé est validée par account
    // (action « access ») et le job doit appartenir au même compte.
    const file = /^\/jobs\/([^/]+)\/file$/.exec(url.pathname);
    if (file && method === "GET") {
      if (yt.fileStatus) return json({ error: "forced", detail: "réponse forcée" }, yt.fileStatus);
      const key = /^Bearer (ytc_\S+)$/.exec(headers.get("authorization") ?? "")?.[1];
      const d = key ? await server!.authorizer.authorize({ key, action: "access" }) : null;
      if (!d || "badRequest" in d || !d.allow) return json({ error: "unauthorized", detail: "Jeton absent ou invalide." }, 401);
      const f = yt.files.get(decodeURIComponent(file[1]!));
      if (!f || f.userId !== d.user_id) return json({ error: "job_not_found", detail: "Job inconnu." }, 404);
      return new Response(f.body, { status: 200, headers: { "content-type": f.type, "content-length": String(Buffer.byteLength(f.body)), "content-disposition": `attachment; filename="${f.name}"` } });
    }
    if (url.pathname === "/health") return json({ status: "ok" });
    if (url.pathname === "/internal/v1/status" && method === "GET") return json(yt.status);
    if (url.pathname === "/internal/v1/jobs" && method === "GET") return json({ jobs: yt.jobs });
    const m = /^\/internal\/v1\/jobs\/([^/]+)\/cancel$/.exec(url.pathname);
    if (m && method === "POST") {
      if (yt.cancelStatus !== 200) return json({ error: "not_found" }, yt.cancelStatus);
      yt.cancelled.push(decodeURIComponent(m[1]!));
      return json({ ok: true });
    }
    return json({ error: "not_found" }, 404);
  }) as unknown as typeof fetch;
  const s = await buildServer(cfg, { fetchImpl: fakeYtapi, ...(opts.discordTimeoutMs ? { discordTimeoutMs: opts.discordTimeoutMs } : {}), ...(opts.mailer ? { mailer: opts.mailer } : {}),
    ...(opts.cloudStore ? { cloudStore: opts.cloudStore } : {}), ...(opts.cloudNow ? { cloudNow: opts.cloudNow } : {}) });
  server = s;
  return { s, cfg, dir, env: base, logs, ytapiUp, ytapi: yt, close() { s.close(); rmSync(dir, { recursive: true, force: true }); } };
}

// ---- navigateur simulé -----------------------------------------------------------------------
let ipCounter = 1;
export class Browser {
  jar = new Map<string, string>();
  ip = `203.0.113.${ipCounter++ % 250}`;
  h: Harness;
  constructor(h: Harness) { this.h = h; }
  cookie() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "); }
  absorb(res: Response) {
    for (const sc of res.headers.getSetCookie()) {
      const [nv] = sc.split(";");
      const i = nv!.indexOf("=");
      const name = nv!.slice(0, i), val = nv!.slice(i + 1);
      if (/Max-Age=0/i.test(sc) || val === "") this.jar.delete(name); else this.jar.set(name, val);
    }
  }
  async req(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; origin?: string | null } = {}) {
    const method = init.method ?? "GET";
    const headers: Record<string, string> = { "x-real-ip": this.ip, ...(init.headers ?? {}) };
    if (this.jar.size) headers.cookie = this.cookie();
    if (method !== "GET" && init.origin !== null) headers.origin = init.origin ?? ORIGIN;
    let body: string | undefined;
    if (init.body !== undefined) { body = JSON.stringify(init.body); headers["content-type"] = "application/json"; }
    else if (method !== "GET") { body = "{}"; headers["content-type"] = "application/json"; }
    const res = await this.h.s.publicApp.request(path, { method, headers, body });
    this.absorb(res);
    return res;
  }
  async json<T = any>(path: string, init: Parameters<Browser["req"]>[1] = {}): Promise<{ status: number; body: T }> {
    const res = await this.req(path, init);
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  }
}

/** Retour de Google simulé (après sign-in/social) : le profil donné devient celui du jeton d'identité. */
export async function googleCallback(b: Browser, authUrl: string, profile: Record<string, unknown>) {
  nextProfile = profile;
  const state = new URL(authUrl).searchParams.get("state")!;
  return b.req(`/api/auth/callback/google?code=fakecode&state=${encodeURIComponent(state)}`);
}

/** Connexion Google simulée complète (PKCE + state) ; renvoie le statut et la redirection finale. */
export async function googleLogin(b: Browser, profile: Record<string, unknown>) {
  nextProfile = profile;
  const r1 = await b.req("/api/auth/sign-in/social", { method: "POST", body: { provider: "google", callbackURL: "/dashboard" } });
  if (r1.status !== 200) return { status: r1.status, location: null as string | null };
  const { url } = (await r1.json()) as { url: string };
  const r2 = await googleCallback(b, url, profile);
  return { status: r2.status, location: r2.headers.get("location"), authUrl: url };
}

let sub = 1000;
export async function newUser(h: Harness, email: string, extra: Record<string, unknown> = {}): Promise<Browser> {
  const b = new Browser(h);
  const r = await googleLogin(b, { sub: `g-${sub++}`, email, email_verified: true, name: email.split("@")[0], ...extra });
  if (r.status !== 302 || !String(r.location).endsWith("/dashboard")) throw new Error(`connexion échouée : ${r.status} ${r.location}`);
  return b;
}

export async function internalCall(h: Harness, path: string, body: unknown, token: string | null = INTERNAL) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers["x-internal-token"] = token;
  const res = await h.s.internalApp.request(path, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
}

// Faux serveurs pour les tests unitaires : ytapi (jobs, fichiers) et le compte AETHRYON (routes de
// l'extension, docs/EXTENSION.md §7), avec la vraie vérification PKCE S256.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash, randomUUID } from "node:crypto";
import { json, type FakeReply, type FakeRequest } from "./fetch.ts";

export const API = "https://api.test/media";
export const SITE = "https://site.test";
export const TOKEN = `ytc_${"Tq".repeat(32)}`;

export interface FakeJob {
  id: string;
  url: string;
  fmt: string;
  status: "queued" | "running" | "done" | "error";
  stage: string;
  progress: number;
  title: string;
  filename: string;
  error?: string;
  detail?: string;
  polls: number;
  /** 3.6.0 (contrat des extraits) : étape et progression mesurable (0..1), servies telles quelles si présentes. */
  etape?: string;
  progression?: number;
}

export class FakeBackend {
  token = TOKEN;
  valid = new Set<string>([TOKEN]);
  jobs = new Map<string, FakeJob>();
  n = 0;
  /** États servis par les GET /jobs/<id> successifs, avant « done ». */
  script: Partial<FakeJob>[] = [{ status: "running", stage: "downloading", progress: 40 }];
  onCreate: ((body: any) => FakeReply | undefined) | null = null;
  onPoll: ((job: FakeJob) => FakeReply | undefined) | null = null;
  fileStatus = 206;
  creates: any[] = [];
  deleted: string[] = [];
  /** V3 : GIF tirés d'un extrait (POST /jobs/<id>/derive) et liens « Ouvrir dans Tools ». */
  derives: { source: string; body: any }[] = [];
  onDerive: ((body: any) => FakeReply | undefined) | null = null;
  toolsOpen = true;
  /** 3.6.0 : serveur d'avant le contrat des extraits, qui refuse un GIF d'un passage (fmt « gif » + startMs) par un 400. */
  gifClipRefused = false;
  /** 3.6.0 : serveur d'avant le contrat, qui refuse startMs/endMs (paramètres inconnus : 400 invalid_parameter). */
  msRefused = false;
  /** 3.6.0 : GET /limites (corps, statut) et nombre de lectures. */
  limits: unknown = { extraitDureeMaxMs: 600_000, sortieTailleMaxOctets: 2_147_483_648, telechargementMaxOctets: 4_294_967_296, traitementMaxS: 900, simultanesMax: 2, quotaJour: 10 };
  limitsStatus: number | "network" = 200;
  limitsRequests = 0;
  toolsLinks: any[] = [];
  me: any = {
    user: { email: "alice@example.test", name: "Alice" },
    today: { used: 3, limit: 10, remaining: 7, resetAt: "2026-10-10T22:00:00Z" },
    activeJobs: 0,
    recent: [{ createdAt: "2026-10-10T18:00:00Z", platform: "tiktok", fmt: "mp4", state: "done", errorMessage: null }],
  };
  meStatus = 200;
  /** Clés refusées avec un motif (contrat de /api/extension/me) : révoquée (par qui), expirée ; compte suspendu. */
  revokedBy = new Map<string, "user" | "admin" | "replay" | null>();
  expired = new Set<string>();
  suspended = false;
  logouts = 0;
  codes = new Map<string, { challenge: string; redirectUri: string }>();
  tokenBodies: any[] = [];
  /** Réponse imposée à l'échange du code (refus du serveur : compte suspendu, trop d'extensions…). */
  onToken: ((body: any) => FakeReply | undefined) | null = null;
  /** Page /extension/autoriser interrogée après un échec de la fenêtre : statut HTTP, ou réseau coupé. */
  pageStatus: number | "network" = 200;
  pageProbes = 0;
  /** latest.json (avis de nouvelle version) : corps, statut, ou réseau coupé. */
  latest: unknown = null;
  latestStatus: number | "network" = 404;
  latestRequests = 0;

  /** Page /extension/autoriser simulée : accord → redirect_uri?code=…&state=… (ou refus). */
  authorize = (url: string, opts: { deny?: boolean; state?: string } = {}): string => {
    const q = new URL(url).searchParams;
    const redirect = q.get("redirect_uri")!;
    const state = opts.state ?? q.get("state")!;
    if (opts.deny) return `${redirect}?error=access_denied&state=${encodeURIComponent(state)}`;
    const code = `c_${randomUUID().replace(/-/g, "")}`;
    this.codes.set(code, { challenge: q.get("code_challenge")!, redirectUri: redirect });
    return `${redirect}?code=${code}&state=${encodeURIComponent(state)}`;
  };

  body(job: FakeJob): any {
    const out: any = {
      job_id: job.id, status: job.status, stage: job.stage, progress: job.progress, platform: "tiktok",
      status_url: `${API}/jobs/${job.id}`, file_url: null, params: { fmt: job.fmt },
    };
    if (job.etape !== undefined) out.etape = job.etape;
    if (job.progression !== undefined) out.progression = job.progression;
    if (job.status === "done") {
      Object.assign(out, {
        file_url: `${API}/jobs/${job.id}/file/${encodeURIComponent(job.filename)}`, title: job.title, filename: job.filename,
        media_type: job.fmt === "mp3" ? "audio/mpeg" : job.fmt === "gif" ? "image/gif" : "video/mp4", size_bytes: 1000,
      });
    }
    if (job.status === "error") Object.assign(out, { error: job.error, detail: job.detail });
    return out;
  }

  /** Hors ligne : toute requête échoue comme un réseau coupé. */
  offline = false;

  handle = (req: FakeRequest): FakeReply => {
    if (this.offline) return "network";
    const auth = req.headers.authorization;
    const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (req.url.startsWith(`${SITE}/`)) return this.site(req, bearer);
    if (!req.url.startsWith(`${API}/`)) return json(404, { error: "not_found", detail: "Route inconnue." });
    if (!bearer || !this.valid.has(bearer)) {
      return json(401, { error: "unauthorized", detail: bearer && this.expired.has(bearer) ? "Ce jeton a expiré. Génère une nouvelle clé depuis ton espace personnel." : "Jeton absent ou invalide." });
    }
    if (this.suspended) return json(403, { error: "account_suspended", detail: "Ce compte est suspendu." });
    const u = new URL(req.url);
    const parts = u.pathname.slice(new URL(API).pathname.length).split("/").filter(Boolean);
    if (req.method === "GET" && parts.length === 1 && parts[0] === "limites") {
      this.limitsRequests++;
      if (this.limitsStatus === "network") return "network";
      return json(this.limitsStatus, this.limitsStatus === 200 ? this.limits : { error: "not_found", detail: "Route inconnue." });
    }
    if (req.method === "POST" && parts.length === 1 && parts[0] === "jobs") {
      const body = JSON.parse(req.body ?? "{}");
      this.creates.push(body);
      if (this.msRefused && body.startMs !== undefined) {
        return json(400, { error: "invalid_parameter", detail: "Paramètre invalide — startMs : Extra inputs are not permitted" });
      }
      if (this.gifClipRefused && body.fmt === "gif" && body.startMs !== undefined) {
        return json(400, { error: "invalid_parameter", detail: "Paramètre invalide — fmt : un GIF d'un passage n'est pas pris en charge." });
      }
      const custom = this.onCreate?.(body);
      if (custom) return custom;
      const id = `job_${String(++this.n).padStart(4, "0")}`;
      const job: FakeJob = {
        id, url: body.url, fmt: body.fmt, status: "queued", stage: "queued", progress: 0,
        title: "Ma vidéo", filename: `Ma vidéo [${id}].${body.fmt}`, polls: 0,
      };
      this.jobs.set(id, job);
      return json(202, { ...this.body(job), merged: false });
    }
    const job = parts[1] ? this.jobs.get(parts[1]) : undefined;
    if (parts[0] !== "jobs" || !job) return json(404, { error: "job_not_found", detail: "Job inconnu ou expiré." });
    if (req.method === "POST" && parts[2] === "derive") {
      const body = JSON.parse(req.body ?? "{}");
      this.derives.push({ source: job.id, body });
      const custom = this.onDerive?.(body);
      if (custom) return custom;
      if (job.status !== "done") return json(409, { error: "job_not_ready", detail: "Le fichier source n'est pas prêt." });
      const id = `job_${String(++this.n).padStart(4, "0")}`;
      const d: FakeJob = { id, url: job.url, fmt: "gif", status: "queued", stage: "queued", progress: 0, title: job.title, filename: `${job.title} (GIF).gif`, polls: 0 };
      this.jobs.set(id, d);
      return json(202, this.body(d));
    }
    if (req.method === "DELETE" && parts.length === 2) {
      this.deleted.push(job.id);
      return json(200, { job_id: job.id, deleted: true });
    }
    if (req.method === "GET" && parts.length === 2) {
      const custom = this.onPoll?.(job);
      if (custom) return custom;
      const step = this.script[job.polls++];
      if (step) Object.assign(job, step);
      else Object.assign(job, { status: "done", stage: "done", progress: 100 });
      return json(200, this.body(job));
    }
    if (req.method === "GET" && parts[2] === "file") {
      if (this.fileStatus === 206) return new Response(new Uint8Array(1), { status: 206, headers: { "content-type": "video/mp4" } });
      if (this.fileStatus === 410) return json(410, { error: "file_gone", detail: "Le fichier a expiré ou a été supprimé : relancez le job." });
      return json(this.fileStatus, { error: this.fileStatus === 403 ? "account_suspended" : "error", detail: "Ce compte est suspendu." });
    }
    return json(404, { error: "not_found", detail: "Route inconnue." });
  };

  private site(req: FakeRequest, bearer: string | null): FakeReply {
    const path = new URL(req.url).pathname;
    if (req.method === "GET" && path === "/extension/autoriser") {
      this.pageProbes++;
      if (this.pageStatus === "network") return "network";
      return new Response("<!doctype html><title>AETHRYON</title>", { status: this.pageStatus, headers: { "content-type": "text/html" } });
    }
    if (req.method === "GET" && path === "/downloads/extension/latest.json") {
      this.latestRequests++;
      if (this.latestStatus === "network") return "network";
      return this.latestStatus === 200 ? json(200, this.latest) : json(this.latestStatus, { error: "not_found" });
    }
    if (req.method === "POST" && path === "/api/extension/token") {
      const body = JSON.parse(req.body ?? "{}");
      this.tokenBodies.push(body);
      const custom = this.onToken?.(body);
      if (custom) return custom;
      const entry = this.codes.get(body.code);
      this.codes.delete(body.code); // usage unique
      const challenge = createHash("sha256").update(String(body.code_verifier)).digest("base64url");
      if (!entry || entry.challenge !== challenge || entry.redirectUri !== body.redirect_uri) {
        return json(400, { error: "invalid_grant", message: "Code de connexion invalide ou expiré : recommence." });
      }
      return json(200, { token: this.token, expiresAt: "2027-01-08T12:00:00.000Z", user: { email: "alice@example.test", name: "Alice" } });
    }
    if (path === "/api/extension/me") {
      if (bearer && this.revokedBy.has(bearer)) {
        return json(401, { error: "token_revoked", message: "L'accès de cette extension à ton compte a été révoqué : reconnecte-la pour continuer.", revokedBy: this.revokedBy.get(bearer) });
      }
      if (bearer && this.expired.has(bearer)) return json(401, { error: "token_expired", message: "La connexion de cette extension a expiré : reconnecte-la pour continuer." });
      if (!bearer || !this.valid.has(bearer)) return json(401, { error: "invalid_token", message: "Jeton d'extension absent, invalide ou révoqué : reconnecte l'extension à ton compte." });
      if (this.suspended) return json(403, { error: "account_suspended", message: "Ce compte est suspendu." });
      if (this.meStatus === 0) return "network";
      if (this.meStatus !== 200) return json(this.meStatus, { error: "not_found", message: "Introuvable." });
      return json(200, this.me);
    }
    if (req.method === "POST" && path === "/api/extension/outils") {
      if (!bearer || !this.valid.has(bearer)) return json(401, { error: "invalid_token", message: "Jeton d'extension absent, invalide ou révoqué : reconnecte l'extension à ton compte." });
      if (!this.toolsOpen) return json(404, { error: "tools_unavailable", message: "AETHRYON Tools n'est pas ouvert sur ce serveur." });
      const body = JSON.parse(req.body ?? "{}");
      this.toolsLinks.push(body);
      return json(201, { url: `${SITE}/outils/studio#ref=${"R".repeat(43)}`, expiresAt: "2026-10-15T00:00:00.000Z" });
    }
    if (req.method === "POST" && path === "/api/extension/logout") {
      this.logouts++;
      if (bearer) this.valid.delete(bearer);
      return new Response(null, { status: 204 });
    }
    return json(404, { error: "not_found", message: "Introuvable." });
  }
}

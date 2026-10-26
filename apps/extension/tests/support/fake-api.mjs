// Serveur local de TEST (node:http) qui imite ytapi (sous /media, comme en production) et les routes du
// compte pour l'extension (docs/EXTENSION.md §7), pour exercer dans un vrai Chromium ce que la
// préproduction ne permet pas : connexion PKCE de bout en bout, fichier coupé en plein transfert,
// fichier expiré (410), quota dépassé (429), jeton refusé (401), conversion lente (reprise du worker).
// Scénario choisi par le nom d'utilisateur du lien TikTok : @cut, @gone, @quota, @slow, @same (nom de fichier
// fixe), @late (fichier qui tarde à répondre) ; sinon normal.
// 3.6.0 (contrat des extraits) : GET /media/limites (state.limits, state.limitsStatus) ; un POST /media/jobs avec
// startMs/endMs suit les étapes RÉELLES du contrat (analyse → recuperation → conversion → finalisation → done), une
// étape toutes les `clipStepMs` ; scénario dans state.clipScenario : « measured » (progression 0..1 envoyée),
// « unmeasured » (aucune progression), « partial » (erreur extrait_partiel_impossible), « slow » (récupération qui
// dure : annulation), « quota » (429), « network » (connexion coupée), « invalid » (422 du serveur).
// Aucun secret n'est journalisé : le jeton attendu est comparé ici, jamais renvoyé ni affiché.
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";

export const EXTENSION_ID = "dnllfjakdgmgfiompaheickmbjjlgjdc";
const REDIRECT_URI = `https://${EXTENSION_ID}.chromiumapp.org/aethryon`;

// Forme de GET /limites de ytapi (feat/extraits-backend, app/main.py) ; restantAujourdhui ajouté à la réponse.
export const DEFAULT_LIMITS = {
  extraitsActifs: true, formats: ["mp4", "mp3", "gif"], extraitDureeMaxMs: 600_000,
  dureeMaxParFormatMs: { mp4: 600_000, mp3: 600_000, gif: 600_000 }, gifDureeMaxMs: 600_000,
  sortieTailleMaxOctets: 2_147_483_648, telechargementMaxOctets: 4_294_967_296, traitementMaxS: 900, simultanesMax: 2, quotaJour: 10, actifsMaxParCompte: 2,
};
// Comme ytapi (feat/extraits-backend) : « attente » tant que le job est en file, puis les étapes du contrat.
const CLIP_STAGES = ["attente", "analyse", "recuperation", "conversion", "finalisation"];

export async function startFakeServer({ fileSize = 256 * 1024, slowMs = 25_000, clipStepMs = 1_200 } = {}) {
  const token = `ytc_${randomBytes(48).toString("base64").replace(/[^A-Za-z]/g, "").slice(0, 64).padEnd(64, "a")}`;
  const file = Buffer.alloc(fileSize);
  for (let i = 0; i < fileSize; i++) file[i] = (i * 31 + 7) & 0xff;
  const state = {
    valid: new Set([token]),
    jobs: new Map(),
    n: 0,
    codes: new Map(),
    authorizeQueries: [],
    tokenRequests: [], // {body, hadAuthorization, origin}
    meRequests: 0,
    logouts: 0,
    fileRequests: [], // {jobId, range, authOk, outcome}
    pollRequests: 0,
    deletes: [],
    urls: [], // chaque URL reçue (pour vérifier qu'aucune ne contient le jeton)
    creates: [], // corps des POST /jobs (paramètres de conversion demandés : fmt, quality, transcode…)
    // 3.6.0 : extraits
    limits: { ...DEFAULT_LIMITS },
    limitsStatus: 200,
    limitsRequests: 0,
    clipScenario: "measured",
  };
  let origin = "";

  const send = (res, status, body, headers = {}) => {
    const data = body === undefined ? "" : JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
    res.end(data);
  };
  const readBody = (req) => new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { resolve(null); }
    });
  });
  const bearer = (req) => {
    const h = req.headers.authorization ?? "";
    return h.startsWith("Bearer ") ? h.slice(7) : null;
  };
  /** Extrait (3.6.0) : étape du contrat selon le temps écoulé et le scénario. */
  const clipStep = (job) => {
    if (job.status === "error" || job.status === "done") return;
    const i = Math.floor((Date.now() - job.createdAt) / clipStepMs);
    if (job.scenario === "partial" && i >= 2) {
      Object.assign(job, { status: "error", etape: "erreur", error: "extrait_partiel_impossible",
        detail: "La source ne permet pas la récupération partielle et la vidéo entière dépasse 4 Go." });
      return;
    }
    if (job.scenario === "slow") {
      job.status = i === 0 ? "queued" : "running";
      job.etape = i === 0 ? "attente" : i === 1 ? "analyse" : "recuperation";
      return;
    }
    if (i >= CLIP_STAGES.length) {
      Object.assign(job, { status: "done", etape: "termine" });
      return;
    }
    job.status = i === 0 ? "queued" : "running";
    job.etape = CLIP_STAGES[i];
    if (i === 1 && job.scenario === "partial") job.etape = "analyse";
  };
  const clipBody = (job) => {
    clipStep(job);
    const done = job.status === "done";
    const legacy = { attente: "queued", analyse: "extracting", recuperation: "downloading", conversion: "converting", finalisation: "finalizing", termine: "done", erreur: "error" };
    const out = {
      job_id: job.id, status: job.status, etape: job.etape, stage: legacy[job.etape] ?? "running", progress: done ? 100 : 0, platform: "youtube",
      params: { fmt: job.fmt }, octetsTelecharges: job.etape === "analyse" ? 0 : 1_234_567,
      status_url: `${origin}/media/jobs/${job.id}`,
      file_url: done ? `${origin}/media/jobs/${job.id}/file/${encodeURIComponent(job.name)}` : null,
    };
    if (job.status === "running" && job.etape === "recuperation") out.octetsTelecharges = 1_234_567;
    // Progression seulement quand elle est mesurable (scénario « measured », récupération et conversion).
    if (job.scenario === "measured" && (job.etape === "recuperation" || job.etape === "conversion")) {
      const into = ((Date.now() - job.createdAt) % clipStepMs) / clipStepMs;
      out.progression = Math.round(Math.min(0.99, 0.2 + into * 0.7) * 100) / 100;
    }
    if (done) Object.assign(out, { title: "Vidéo de test", filename: job.name, media_type: job.fmt === "gif" ? "image/gif" : job.fmt === "mp3" ? "audio/mpeg" : "video/mp4", size_bytes: file.length });
    if (job.status === "error") Object.assign(out, { error: job.error, detail: job.detail });
    return out;
  };
  const jobBody = (job) => {
    if (job.clip) return clipBody(job);
    const done = job.status === "done";
    return {
      job_id: job.id, status: job.status, stage: done ? "done" : job.status === "running" ? "converting" : "queued",
      progress: done ? 100 : job.status === "running" ? 50 : 0, platform: "tiktok",
      status_url: `${origin}/media/jobs/${job.id}`,
      file_url: done ? `${origin}/media/jobs/${job.id}/file/${encodeURIComponent(job.name)}` : null,
      ...(done ? { title: "Vidéo de test", filename: job.name, media_type: "video/mp4", size_bytes: file.length } : {}),
    };
  };
  const refresh = (job) => {
    if (job.status !== "done" && Date.now() >= job.readyAt) job.status = "done";
    else if (job.status === "queued") job.status = "running";
  };

  const server = createServer(async (req, res) => {
    state.urls.push(req.url ?? "");
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname;
    try {
      // ---- site + compte ------------------------------------------------------------------------
      if (req.method === "GET" && path === "/extension/autoriser") {
        const q = url.searchParams;
        state.authorizeQueries.push(Object.fromEntries(q));
        if (q.get("redirect_uri") !== REDIRECT_URI || q.get("code_challenge_method") !== "S256" || !q.get("state") || !q.get("code_challenge")) {
          res.writeHead(400, { "content-type": "text/plain" });
          return res.end("requête d'autorisation invalide");
        }
        const code = randomBytes(32).toString("base64url");
        state.codes.set(code, { challenge: q.get("code_challenge"), redirectUri: q.get("redirect_uri"), at: Date.now() });
        res.writeHead(302, { location: `${REDIRECT_URI}?code=${code}&state=${encodeURIComponent(q.get("state"))}` });
        return res.end();
      }
      if (req.method === "POST" && path === "/api/extension/token") {
        const body = await readBody(req);
        state.tokenRequests.push({ keys: body ? Object.keys(body).sort() : null, hadAuthorization: Boolean(req.headers.authorization), origin: req.headers.origin ?? null, hadCookie: Boolean(req.headers.cookie) });
        const entry = body && state.codes.get(body.code);
        if (body) state.codes.delete(body.code);
        const ok = entry && typeof body.code_verifier === "string" && Date.now() - entry.at < 120_000 &&
          createHash("sha256").update(body.code_verifier).digest("base64url") === entry.challenge && body.redirect_uri === entry.redirectUri;
        if (!ok) return send(res, 400, { error: "invalid_grant", message: "Code de connexion invalide ou expiré : recommence." });
        state.valid.add(token);
        return send(res, 200, { token, expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(), user: { email: "test@fake.test", name: "Testeur" } });
      }
      if (req.method === "GET" && path === "/api/extension/me") {
        state.meRequests++;
        if (!state.valid.has(bearer(req))) return send(res, 401, { error: "invalid_token", message: "Jeton d'extension absent, invalide ou révoqué : reconnecte l'extension à ton compte." });
        return send(res, 200, { user: { email: "test@fake.test", name: "Testeur" }, today: { used: state.n, limit: 10, remaining: 10 - state.n, resetAt: new Date().toISOString() }, activeJobs: 0, recent: [] });
      }
      if (req.method === "POST" && path === "/api/extension/logout") {
        if (state.valid.delete(bearer(req))) state.logouts++;
        res.writeHead(204);
        return res.end();
      }
      // ---- ytapi (préfixe /media) ----------------------------------------------------------------
      if (!path.startsWith("/media/")) return send(res, 404, { error: "not_found", detail: "Route inconnue." });
      if (req.method === "GET" && path === "/media/limites") {
        state.limitsRequests++;
        // Comme ytapi : réservé à un jeton valable (light_auth) ; reste du jour du compte appelant.
        if (!state.valid.has(bearer(req))) return send(res, 401, { error: "unauthorized", detail: "Jeton absent ou invalide." });
        return send(res, state.limitsStatus, state.limitsStatus === 200 ? { ...state.limits, restantAujourdhui: Math.max(0, 10 - state.n) } : { error: "not_found", detail: "Route inconnue." });
      }
      const parts = path.slice("/media/".length).split("/").filter(Boolean);
      if (!state.valid.has(bearer(req))) {
        if (parts[2] === "file") state.fileRequests.push({ jobId: parts[1], range: req.headers.range ?? null, authOk: false, outcome: "401" });
        return send(res, 401, { error: "unauthorized", detail: "Jeton absent ou invalide. Génère une nouvelle clé depuis ton espace personnel." }, { "www-authenticate": "Bearer" });
      }
      if (req.method === "POST" && parts.length === 1 && parts[0] === "jobs") {
        const body = await readBody(req);
        state.creates.push(body);
        if (body && body.startMs !== undefined) {
          // Extrait (3.6.0) : validation indépendante, comme le serveur réel.
          const sc = state.clipScenario;
          if (sc === "network") { req.socket.destroy(); return undefined; }
          if (sc === "quota") return send(res, 429, { error: "quota_exceeded", detail: "Tu as atteint ta limite de conversions pour aujourd'hui. Elle se réinitialise à minuit (heure de Paris)." }, { "retry-after": "3600" });
          const okInts = Number.isInteger(body.startMs) && Number.isInteger(body.endMs) && body.startMs >= 0 && body.endMs > body.startMs;
          if (!okInts || sc === "invalid") return send(res, 422, { error: "extrait_trop_long", detail: "L'extrait dépasse la durée maximale autorisée (10 min)." });
          const id = `fake${String(++state.n).padStart(4, "0")}${randomBytes(4).toString("hex")}`;
          const fmt = body.fmt === "gif" ? "gif" : body.fmt === "mp3" ? "mp3" : "mp4";
          const job = { id, clip: true, fmt, scenario: sc, status: "queued", etape: "analyse", createdAt: Date.now(), name: `Extrait de test [${id.slice(0, 8)}].${fmt}`, mode: "ok" };
          state.jobs.set(id, job);
          return send(res, 202, jobBody(job), { location: `${origin}/media/jobs/${id}` });
        }
        const user = /tiktok\.com\/@([\w.-]+)\//.exec(body?.url ?? "")?.[1] ?? "";
        if (user === "quota") {
          return send(res, 429, { error: "quota_exceeded", detail: "Tu as atteint ta limite de conversions pour aujourd'hui. Elle se réinitialise à minuit (heure de Paris)." }, { "retry-after": "3600" });
        }
        const id = `fake${String(++state.n).padStart(4, "0")}${randomBytes(4).toString("hex")}`;
        const job = {
          id, status: "queued", mode: ["cut", "gone"].includes(user) ? user : "ok",
          // @same : toujours le même nom de fichier (deux téléchargements du même nom, « uniquify »).
          name: user === "same" ? "Vidéo de test [same].mp4" : `Vidéo de test [${id.slice(0, 8)}].mp4`,
          late: user === "late", // @late : en-têtes du fichier envoyés 1,5 s après la demande (nom connu plus tard)
          readyAt: Date.now() + (user === "slow" ? slowMs : 300),
        };
        state.jobs.set(id, job);
        return send(res, 202, jobBody(job), { location: `${origin}/media/jobs/${id}` });
      }
      const job = state.jobs.get(parts[1] ?? "");
      if (parts[0] !== "jobs" || !job) return send(res, 404, { error: "job_not_found", detail: "Job inconnu ou expiré (le serveur a peut-être redémarré)." });
      if (req.method === "DELETE" && parts.length === 2) {
        state.deletes.push(job.id);
        state.jobs.delete(job.id);
        return send(res, 200, { job_id: job.id, deleted: true });
      }
      if (req.method === "GET" && parts.length === 2) {
        state.pollRequests++;
        // attente longue comme ytapi (?wait=N) : réponse dès que c'est prêt, sinon au bout de N s
        const wait = Math.min(Number(url.searchParams.get("wait") ?? 0) || 0, 25) * 1000;
        const until = Date.now() + wait;
        if (job.clip) {
          // Attente longue : réponse dès que l'étape change.
          const seen = JSON.stringify([job.status, job.etape]);
          while (Date.now() < until && !req.socket.destroyed) {
            clipStep(job);
            if (JSON.stringify([job.status, job.etape]) !== seen || job.status === "done" || job.status === "error") break;
            if (job.scenario === "measured" && (job.etape === "recuperation" || job.etape === "conversion")) break;
            await new Promise((r) => setTimeout(r, 100));
          }
          if (req.socket.destroyed) return undefined;
          return send(res, 200, jobBody(job));
        }
        while (job.status !== "done" && Date.now() < until && Date.now() < job.readyAt && !req.socket.destroyed) {
          await new Promise((r) => setTimeout(r, 100));
        }
        if (req.socket.destroyed) return undefined;
        refresh(job);
        return send(res, 200, jobBody(job));
      }
      if (req.method === "GET" && parts[2] === "file") {
        const range = req.headers.range ?? null;
        const rec = { jobId: job.id, range, authOk: true, outcome: "" };
        state.fileRequests.push(rec);
        if (job.clip) clipStep(job);
        if (job.status !== "done") { rec.outcome = "409"; return send(res, 409, { error: "job_not_ready", detail: "Job encore en cours." }); }
        if (job.mode === "gone") { rec.outcome = "410"; return send(res, 410, { error: "file_gone", detail: "Le fichier a expiré ou a été supprimé : relancez le job." }); }
        const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(job.name)}`;
        if (range === "bytes=0-0") {
          rec.outcome = "206";
          res.writeHead(206, { "content-type": "video/mp4", "content-range": `bytes 0-0/${file.length}`, "content-length": "1", "content-disposition": disposition });
          return res.end(file.subarray(0, 1));
        }
        if (job.late) await new Promise((r) => setTimeout(r, 1500));
        if (req.socket.destroyed) return undefined;
        const type = job.fmt === "gif" ? "image/gif" : job.fmt === "mp3" ? "audio/mpeg" : "video/mp4";
        res.writeHead(200, { "content-type": type, "content-length": String(file.length), "content-disposition": disposition, "accept-ranges": "bytes" });
        if (job.mode === "cut") {
          rec.outcome = "cut";
          res.write(file.subarray(0, file.length >> 1));
          setTimeout(() => req.socket.destroy(), 50);
          return undefined;
        }
        rec.outcome = "200";
        return res.end(file);
      }
      return send(res, 404, { error: "not_found", detail: "Route inconnue." });
    } catch (e) {
      return send(res, 500, { error: "internal_error", detail: String(e?.message ?? e) });
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  origin = `http://127.0.0.1:${port}`;
  return {
    port,
    apiBase: `${origin}/media`,
    siteBase: `http://localhost:${port}`,
    fileSize: file.length,
    state,
    /** Le jeton délivré par l'échange de code (comparé dans le test, jamais affiché). */
    isToken: (t) => t === token,
    /** Une URL reçue contenait-elle le jeton (ou un fragment) ? */
    tokenSeenInUrl: () => state.urls.some((u) => u.includes(token) || u.includes(token.slice(4, 24)) || /token=/i.test(u)),
    tokenForTest: () => token,
    heal: (jobId) => { const j = state.jobs.get(jobId); if (j) j.mode = "ok"; },
    revokeAll: () => state.valid.clear(),
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

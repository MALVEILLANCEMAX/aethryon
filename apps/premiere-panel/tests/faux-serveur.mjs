// FAUX serveur AETHRYON (127.0.0.1 seulement) pour les essais : service de compte (connexion par page d'accord,
// /api/premiere/*, calqué sur le VRAI serveur account de feat/v2-compte : corps strict, codes et formes de réponse de la
// note d'API de V2-CONNEXION.md) et serveur de conversion (ytapi : /media/health, /preview, /jobs…). Il ne contacte
// personne.
// Il journalise chaque requête reçue (méthode, chemin, présence d'une clé) pour que les essais vérifient ce qui part.

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

export const CLE_ESSAI = "ytc_essai" + "A1b2C3d4E5f6G7h8";

// Une vraie petite image JPEG (1 × 1) pour la miniature.
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==", "base64");

export function demarrerFauxServeur(o = {}) {
  const tailleFichier = o.tailleFichier ?? 3 * 1024 * 1024 + 123;
  const journal = [];
  const appairages = new Map();
  const jobs = new Map();
  const clesRevoquees = new Set();
  /** Motif de révocation par clé (« user », « replay »), renvoyé par /moi dans revokedBy. */
  const revocations = new Map();
  let compteur = 0;

  const json = (res, statut, corps, entetes = {}) => {
    const b = corps === null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(corps));
    res.writeHead(statut, { "content-type": "application/json", "content-length": b.length, ...entetes });
    res.end(b);
  };
  const lireCorps = (req) => new Promise((ok) => {
    const m = [];
    req.on("data", (d) => m.push(d));
    req.on("end", () => {
      try { ok(m.length ? JSON.parse(Buffer.concat(m).toString("utf8")) : null); } catch { ok(null); }
    });
  });
  const cleDe = (req) => {
    const m = /^Bearer (ytc_[A-Za-z0-9]+)$/.exec(req.headers.authorization || "");
    return m && !clesRevoquees.has(m[1]) && m[1] === CLE_ESSAI ? m[1] : null;
  };

  const serveur = createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    const p = u.pathname;
    const corps = req.method === "POST" ? await lireCorps(req) : null;
    journal.push({ methode: req.method, chemin: p + u.search, cle: !!req.headers.authorization, origine: req.headers.origin || null, typeContenu: req.headers["content-type"] || null, cookie: !!req.headers.cookie, corps });
    const base = `http://127.0.0.1:${serveur.address().port}`;

    // ---- Compte -------------------------------------------------------------------------------------------------------
    if (p === "/") return json(res, 200, { site: "faux" });
    // Routes du panneau : origine absente, « null » ou « file:// » seulement (jamais une page web), comme account.
    if (p.startsWith("/api/premiere/") && /^https?:/i.test(req.headers.origin || "")) return json(res, 403, { error: "invalid_origin", message: "Requête refusée (origine inattendue)." });
    if (p.startsWith("/api/premiere/") && (o.ferme || o.sansRoutes) && (p.endsWith("/appairage") || p.endsWith("/jeton"))) {
      return o.sansRoutes ? json(res, 404, { error: "not_found", message: "Route inconnue." }) : json(res, 404, { error: "premiere_closed", message: "La connexion de Premiere Pro n'est pas encore ouverte sur ce serveur." });
    }
    if (p === "/api/premiere/appairage" && req.method === "POST") {
      // Corps STRICT : {hote?, versionPremiere?, versionExtension?}, chaînes de 60 / 32 / 32 caractères au plus.
      const admis = { hote: 60, versionPremiere: 32, versionExtension: 32 };
      if (!/^application\/json/.test(req.headers["content-type"] || "") || !corps || typeof corps !== "object" || Array.isArray(corps)
        || Object.entries(corps).some(([k, v]) => !(k in admis) || (v !== null && typeof v !== "string"))) {
        return json(res, 400, { error: "invalid_request", message: "Demande invalide : relance la connexion depuis le panneau AETHRYON de Premiere Pro." });
      }
      const codeAppareil = randomBytes(32).toString("base64url");
      const codeUtilisateur = "TEST-" + String(++compteur).padStart(4, "0");
      appairages.set(codeAppareil, { attente: o.attentesAvantAccord ?? 2, etat: "attente", code: codeUtilisateur, dernier: 0 });
      return json(res, 200, { codeAppareil, codeUtilisateur, urlVerification: (o.urlVerification || base + "/premiere/connecter"), expireDans: 600, intervalle: o.intervalle ?? 1 });
    }
    if (p === "/api/premiere/jeton" && req.method === "POST") {
      if (!corps || typeof corps.codeAppareil !== "string" || Object.keys(corps).length !== 1) return json(res, 400, { error: "invalid_request", message: "Demande invalide." });
      const a = appairages.get(corps.codeAppareil);
      if (!a) return json(res, 400, { error: "invalid_grant", etat: "invalide", message: "Code d'appareil inconnu : relance la connexion depuis le panneau AETHRYON." });
      // Cadence : o.cadenceMs entre deux interrogations d'un même code, sinon 429 trop-rapide + Retry-After.
      const t = Date.now();
      if (o.cadenceMs && a.dernier && t - a.dernier < o.cadenceMs) return json(res, 429, { error: "slow_down", etat: "trop-rapide", message: "Interrogation trop rapide.", intervalle: 3 }, { "retry-after": String(o.retryAfter ?? 3) });
      a.dernier = t;
      if (a.etat === "utilise") {
        clesRevoquees.add(CLE_ESSAI);
        revocations.set(CLE_ESSAI, "replay");
        return json(res, 410, { etat: "deja-utilise", message: "Ce code a déjà servi : par sécurité, l'accès qu'il a ouvert est révoqué." });
      }
      if (o.refus) return json(res, 403, { etat: "refuse", message: "Connexion refusée sur le site AETHRYON." });
      if (o.expire) return json(res, 410, { etat: "expire", message: "Ce code a expiré." });
      if (a.attente-- > 0) return json(res, 428, { etat: "en-attente", message: "En attente de ton accord sur le site AETHRYON.", intervalle: 3 });
      if (o.suspendu) return json(res, 403, { error: "account_suspended", etat: "refuse", message: "Ce compte est suspendu." });
      if (o.tropDOrdinateurs) return json(res, 409, { error: "too_many_premiere", etat: "refuse", message: "Trois ordinateurs sont déjà connectés." });
      a.etat = "utilise";
      return json(res, 200, { cle: CLE_ESSAI, expireLe: new Date(Date.now() + 30 * 86400000).toISOString(), compte: { email: "essai@preprod.test", nom: "Essai" } });
    }
    if (p === "/api/premiere/moi" && req.method === "GET") {
      const m = /^Bearer (ytc_[A-Za-z0-9]+)$/.exec(req.headers.authorization || "");
      if (m && revocations.has(m[1])) return json(res, 401, { error: "token_revoked", message: "L'accès de Premiere Pro à ton compte a été révoqué.", revokedBy: revocations.get(m[1]) }, { "www-authenticate": 'Bearer realm="aethryon"' });
      if (!cleDe(req)) return json(res, 401, { error: "invalid_token", message: "Clé absente, invalide ou révoquée." });
      return json(res, 200, {
        compte: { email: "essai@preprod.test", nom: "Essai" },
        quota: { utilise: 2, limite: 10, restant: 8, illimite: false, reinitialiseLe: new Date(Date.now() + 3600000).toISOString() },
        conversionsEnCours: 0,
        recentes: [{ creeLe: new Date().toISOString(), plateforme: "youtube", format: "mp4", etat: "done", erreur: null }],
        cle: { expireLe: new Date(Date.now() + 29 * 86400000).toISOString() },
      });
    }
    if (p === "/api/premiere/deconnexion" && req.method === "POST") {
      // Corps vide (ou JSON) : tout autre type de contenu est refusé (415), comme account.
      const ct = req.headers["content-type"] || "";
      if (ct && !/^application\/json/.test(ct)) return json(res, 415, { error: "unsupported_media_type", message: "Le corps de la requête doit être du JSON." });
      const m = /^Bearer (ytc_[A-Za-z0-9]+)$/.exec(req.headers.authorization || "");
      if (!m || m[1] !== CLE_ESSAI) return json(res, 401, { error: "invalid_token" });
      clesRevoquees.add(m[1]);
      if (!revocations.has(m[1])) revocations.set(m[1], "user");
      res.writeHead(204);
      return res.end();
    }

    // ---- Conversion (ytapi) -------------------------------------------------------------------------------------------
    if (p === "/media/health") return json(res, 200, { status: "ok" });
    if (!cleDe(req)) return json(res, 401, { error: "unauthorized", detail: "Jeton absent ou invalide." }, { "www-authenticate": "Bearer" });
    if (p === "/media/preview" && req.method === "POST") {
      if (!corps || typeof corps.url !== "string") return json(res, 422, { error: "invalid_parameter", detail: "url manquante" });
      return json(res, 200, { platform: "youtube", title: "Essai : coucher de soleil", uploader: "Banc", duration: 75, thumbnail: "https://i.ytimg.com/vi/x/mqdefault.jpg", thumbnail_id: "miniature-essai-0001", media_count: 1, audio: "yes",
        qualities: [{ quality: 1080, est_size_bytes: 21000000, h264: true }, { quality: 720, est_size_bytes: 9000000, h264: true }], limits: { too_long: false, transcode_allowed: true } });
    }
    if (p.startsWith("/media/preview/thumbnail/")) {
      res.writeHead(200, { "content-type": "image/jpeg", "content-length": JPEG.length });
      return res.end(JPEG);
    }
    if (p === "/media/jobs" && req.method === "POST") {
      if (o.refusJob) return json(res, 429, { error: "quota_exceeded", detail: "Quota du jour atteint." }, { "retry-after": "3600" });
      const id = "job" + randomBytes(5).toString("hex");
      jobs.set(id, { n: 0, corps });
      return json(res, 202, { job_id: id, status: "queued", stage: "queued", progress: 0, status_url: base + "/media/jobs/" + id, file_url: null });
    }
    const mj = /^\/media\/jobs\/([A-Za-z0-9]+)(\/file(\/.*)?)?$/.exec(p);
    if (mj) {
      const j = jobs.get(mj[1]);
      if (!j) return json(res, 404, { error: "job_not_found", detail: "Conversion inconnue." });
      if (req.method === "DELETE") {
        jobs.delete(mj[1]);
        return json(res, 200, { job_id: mj[1], deleted: true });
      }
      if (!mj[2]) {
        j.n++;
        const etapes = [["running", "downloading", 35], ["running", "transcoding", 80], ["done", "done", 100]];
        const [status, stage, progress] = etapes[Math.min(j.n - 1, 2)];
        await new Promise((r) => setTimeout(r, 60));
        const fini = status === "done";
        // file_url vers un AUTRE serveur : le panneau ne doit jamais le suivre (il reconstruit l'adresse).
        return json(res, 200, { job_id: mj[1], status, stage, progress, title: "Essai : coucher de soleil", filename: fini ? "Essai : coucher de soleil [x].mp4" : null,
          size_bytes: fini ? tailleFichier : null, media_type: "video/mp4", file_url: fini ? "https://exemple.invalid/vol" : null });
      }
      // Fichier : flux par morceaux, Content-Length exact (ou faux si demandé).
      const annonce = o.longueurFausse ? tailleFichier + 1000 : tailleFichier;
      res.writeHead(200, { "content-type": "video/mp4", "content-length": annonce, "content-disposition": "attachment" });
      let envoye = 0;
      const morceau = Buffer.alloc(64 * 1024, 7);
      const pousser = () => {
        if (envoye >= tailleFichier) {
          if (o.longueurFausse) res.destroy();
          else res.end();
          return;
        }
        const n = Math.min(morceau.length, tailleFichier - envoye);
        envoye += n;
        res.write(morceau.subarray(0, n));
        setTimeout(pousser, o.lent ? 20 : 0);
      };
      pousser();
      return;
    }
    return json(res, 404, { error: "not_found", detail: "Route inconnue du faux serveur." });
  });

  return new Promise((ok) => {
    serveur.listen(0, "127.0.0.1", () => {
      const base = `http://127.0.0.1:${serveur.address().port}`;
      ok({ serveur, base, config: { compte: base, api: base + "/media" }, journal, jobs, clesRevoquees, revocations, fermer: () => new Promise((r) => serveur.close(() => r())) });
    });
  });
}

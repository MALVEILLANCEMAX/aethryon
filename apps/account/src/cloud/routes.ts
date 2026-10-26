// AETHRYON Cloud : routes publiques (/api/cloud/*, administrateur seulement) et internes (/internal/v1/cloud/*, ytapi).
// Authentification publique : session du site (mutations soumises au contrôle d'origine + JSON d'app.ts), clé
// « desktop » d'AETHRYON Desktop relié (Bearer, sans aucune origine, desktop.ts), ou clé d'extension « Authorization:
// Bearer ytc_… » (origine absente ou chrome-extension://<id autorisé>) ; avec une clé, la session n'est JAMAIS lue. Le rôle est relu en base à chaque requête : 401 sans identité, 403 si le compte n'est pas
// administrateur, 404 « cloud_closed » pour tous tant que CLOUD ≠ on. Chaque objet est contrôlé contre son propriétaire
// (404 identique pour un objet d'autrui et un identifiant inconnu). Limites par compte en plus de la limite par IP.
import type { Context, Hono } from "hono";
import type { Services } from "../app.ts";
import { desktopOriginOk } from "../desktop.ts";
import { checkDeviceBearer, extensionOriginOk } from "../extension.ts";
import { err, HttpError, Limiter, type Vars } from "../http.ts";
import { log } from "../log.ts";
import type { CloudService } from "./service.ts";

/** Toutes les routes publiques du cloud (les essais vérifient qu'un non-administrateur est refusé sur chacune). */
export const CLOUD_ROUTES: readonly (readonly ["GET" | "POST" | "PUT", string])[] = [
  ["GET", "/api/cloud/etat"],
  ["GET", "/api/cloud/objets"],
  ["GET", "/api/cloud/objets/:id"],
  ["POST", "/api/cloud/objets/:id/lien"],
  ["POST", "/api/cloud/objets/:id/supprimer"],
  ["GET", "/api/cloud/envois"],
  ["POST", "/api/cloud/envois"],
  ["POST", "/api/cloud/envois/:id/url"],
  ["POST", "/api/cloud/envois/:id/confirmer"],
  ["POST", "/api/cloud/envois/:id/annuler"],
  ["PUT", "/api/cloud/reglages"],
];

/** Requête du cloud authentifiée par une clé d'appareil (Bearer) : app.ts n'y lit ni session ni contrôle d'origine du site. */
export const isCloudBearer = (path: string, authorization: string | undefined): boolean =>
  path.startsWith("/api/cloud/") && authorization !== undefined;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});

export function mountCloud(app: Hono<{ Variables: Vars }>, s: Services): void {
  const lecture = new Limiter(600, 3_600_000);
  const envois = new Limiter(60, 3_600_000);
  const liens = new Limiter(120, 3_600_000);
  const suppressions = new Limiter(120, 3_600_000);
  const reglages = new Limiter(30, 3_600_000);

  /**
   * Identité de l'appelant, administrateur relu en base ; sinon la réponse de refus. Clé en Bearer : d'abord une clé
   * « desktop » (cœur Rust d'AETHRYON Desktop, desktop.ts : AUCUNE origine admise), sinon une clé d'extension (origine
   * absente ou chrome-extension://<id autorisé>). Une clé d'un autre type reste « invalide ».
   */
  async function admin(c: Context<{ Variables: Vars }>, limiter: Limiter): Promise<{ id: string; via: "session" | "extension" | "desktop"; cloud: CloudService } | Response> {
    const cloud = s.cloud;
    if (!cloud) return err(c, 404, "cloud_closed", "AETHRYON Cloud n'est pas activé sur ce serveur.");
    const authz = c.req.header("authorization");
    let id: string, via: "session" | "extension" | "desktop";
    if (authz !== undefined) {
      const origin = c.req.header("origin");
      const d = desktopOriginOk(origin) ? await checkDeviceBearer(s, authz, "desktop") : null;
      if (d && !("status" in d)) {
        id = d.user.id; via = "desktop";
      } else if (d && "status" in d && d.error !== "invalid_token") {
        return err(c, d.status, d.error, d.status === 403 ? "Ce compte est suspendu." : "Liaison d'AETHRYON Desktop révoquée ou expirée : relie-le de nouveau (Paramètres › Compte).");
      } else {
        if (!extensionOriginOk(s.cfg, origin)) return err(c, 403, "invalid_origin", "Requête refusée (origine inattendue).");
        const b = await checkDeviceBearer(s, authz, "extension");
        if ("status" in b) return err(c, b.status, b.error, "Clé absente, invalide ou expirée : reconnecte l'appareil.");
        id = b.user.id; via = "extension";
      }
    } else {
      const u = c.get("user");
      if (!u) return err(c, 401, "unauthorized", "Connecte-toi pour continuer.");
      id = u.id; via = "session";
    }
    const row = s.db.prepare('SELECT role, status FROM "user" WHERE id = ?').get(id) as { role: string | null; status: string | null } | undefined;
    if (!row || row.status === "suspended") return err(c, 401, "unauthorized", "Connecte-toi pour continuer.");
    if (row.role !== "admin") {
      log("warn", "cloud refused (not admin)", { user: id, path: c.req.path });
      return err(c, 403, "forbidden", "AETHRYON Cloud est réservé à l'administrateur.");
    }
    if (!limiter.take(id)) return err(c, 429, "rate_limited", "Trop de requêtes vers le cloud : réessaie dans quelques minutes.");
    return { id, via, cloud };
  }

  const body = async (c: Context) => obj(await c.req.json().catch(() => null));

  app.get("/api/cloud/etat", async (c) => {
    const a = await admin(c, lecture);
    if (a instanceof Response) return a;
    const r = a.cloud.reglages(a.id);
    return c.json({
      actif: true, quota: a.cloud.quota(a.id), retentionJours: r.retentionJours, tailleMaxFichier: a.cloud.cfg.maxFileBytes,
      sauvegardeAuto: r.sauvegardeAuto, derniereMesure: a.cloud.mesure(),
    });
  });

  app.get("/api/cloud/objets", async (c) => {
    const a = await admin(c, lecture);
    if (a instanceof Response) return a;
    const q = c.req.query();
    const n = (v: string | undefined) => (v === undefined || v === "" ? undefined : Number(v));
    return c.json({ ...a.cloud.lister(a.id, { q: q.q, statut: q.statut, type: q.type, tri: q.tri, page: n(q.page), taillePage: n(q.taillePage), musique: q.musique }), quota: a.cloud.quota(a.id) });
  });

  app.get("/api/cloud/objets/:id", async (c) => {
    const a = await admin(c, lecture);
    if (a instanceof Response) return a;
    return c.json({ objet: a.cloud.vue(a.cloud.objetDe(a.id, c.req.param("id"))) });
  });

  app.post("/api/cloud/objets/:id/lien", async (c) => {
    const a = await admin(c, liens);
    if (a instanceof Response) return a;
    const usage = (await body(c)).usage ?? "telecharger";
    if (usage !== "telecharger" && usage !== "apercu") throw new HttpError(400, "invalid_request", "Requête invalide : usage « telecharger » ou « apercu ».");
    return c.json(await a.cloud.lien(a.id, c.req.param("id"), usage));
  });

  app.post("/api/cloud/objets/:id/supprimer", async (c) => {
    const a = await admin(c, suppressions);
    if (a instanceof Response) return a;
    const objet = await a.cloud.supprimer(a.id, c.req.param("id"));
    return c.json({ objet, quota: a.cloud.quota(a.id) });
  });

  app.get("/api/cloud/envois", async (c) => {
    const a = await admin(c, lecture);
    if (a instanceof Response) return a;
    return c.json(a.cloud.lister(a.id, { statut: "envois", tri: "recent", taillePage: 100 }));
  });

  // Réservation + URL d'envoi présignée (Desktop, extension, site) : le fichier part directement vers le fournisseur.
  app.post("/api/cloud/envois", async (c) => {
    const a = await admin(c, envois);
    if (a instanceof Response) return a;
    const b = await body(c);
    const origine = a.via === "desktop" || b.origine === "desktop" ? "desktop" : a.via === "extension" ? "extension" : "site";
    const out = await a.cloud.reserver(a.id, { nom: b.nom, type: b.type, taille: b.taille, sha256: b.sha256, md5: b.md5 }, { origine });
    return c.json(out, 201);
  });

  app.post("/api/cloud/envois/:id/url", async (c) => {
    const a = await admin(c, envois);
    if (a instanceof Response) return a;
    return c.json(await a.cloud.nouvelleUrl(a.id, c.req.param("id")));
  });

  app.post("/api/cloud/envois/:id/confirmer", async (c) => {
    const a = await admin(c, envois);
    if (a instanceof Response) return a;
    const r = a.cloud.objetDe(a.id, c.req.param("id"));
    await a.cloud.verifier(r.id, "confirmation");
    return c.json({ objet: a.cloud.vue(a.cloud.objetDe(a.id, r.id)), quota: a.cloud.quota(a.id) });
  });

  app.post("/api/cloud/envois/:id/annuler", async (c) => {
    const a = await admin(c, envois);
    if (a instanceof Response) return a;
    const r = a.cloud.objetDe(a.id, c.req.param("id"));
    await a.cloud.abandonner(r.id, "annule");
    return c.json({ objet: a.cloud.vue(a.cloud.objetDe(a.id, r.id)), quota: a.cloud.quota(a.id) });
  });

  app.put("/api/cloud/reglages", async (c) => {
    const a = await admin(c, reglages);
    if (a instanceof Response) return a;
    const b = await body(c);
    if (typeof b.sauvegardeAuto !== "boolean" || Object.keys(b).some((k) => k !== "sauvegardeAuto")) {
      throw new HttpError(400, "invalid_request", "Requête invalide : { \"sauvegardeAuto\": true | false } attendu.");
    }
    await a.cloud.changerReglages(a.id, b.sauvegardeAuto);
    log("info", "cloud settings", { user: a.id, sauvegardeAuto: b.sauvegardeAuto });
    return c.json({ sauvegardeAuto: b.sauvegardeAuto });
  });
}

/**
 * API interne pour ytapi (derrière X-Internal-Token et INTERNAL_ALLOW_FROM, internal.ts). ytapi n'a AUCUNE clé du
 * fournisseur : il reçoit une URL d'envoi signée pour un fichier précis, puis annonce la fin ; account vérifie (HEAD).
 */
export function mountCloudInternal(app: Hono, cloud: CloudService | null): void {
  const closed = (c: Context) => c.json({ sauvegarder: false, raison: "cloud_coupe" });
  const fail = (c: Context, e: unknown) => {
    if (e instanceof HttpError) return c.json({ error: e.code, message: e.message }, e.status as 400);
    throw e;
  };
  app.post("/internal/v1/cloud/offre", async (c) => {
    if (!cloud) return closed(c);
    try { return c.json(await cloud.offre(obj(await c.req.json().catch(() => null)))); } catch (e) { return fail(c, e); }
  });
  app.post("/internal/v1/cloud/objets/:id/url-envoi", async (c) => {
    if (!cloud) return c.json({ error: "cloud_closed", message: "Cloud coupé." }, 404);
    try {
      const b = obj(await c.req.json().catch(() => null));
      const r = cloud.objetYtapi(b.user_id, c.req.param("id"));
      return c.json(await cloud.nouvelleUrl(r.owner_id, r.id));
    } catch (e) { return fail(c, e); }
  });
  app.post("/internal/v1/cloud/objets/:id/termine", async (c) => {
    if (!cloud) return c.json({ error: "cloud_closed", message: "Cloud coupé." }, 404);
    try {
      const b = obj(await c.req.json().catch(() => null));
      const r = cloud.objetYtapi(b.user_id, c.req.param("id"));
      const code = typeof b.erreur === "string" && /^[a-z0-9_]{1,40}$/.test(b.erreur) ? b.erreur : "envoi_impossible";
      const statut = b.ok === true ? await cloud.verifier(r.id, "confirmation") : await cloud.abandonner(r.id, code);
      const v = cloud.vue(cloud.objetDe(r.owner_id, r.id));
      log("info", "cloud ytapi done", { objet: r.id, statut });
      return c.json({ statut, expireLe: v.expireLe, libelle: v.libelle });
    } catch (e) { return fail(c, e); }
  });
}

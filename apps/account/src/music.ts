// AETHRYON Music : relais /api/music/* entre l'espace connecté (session du site) ou AETHRYON Desktop relié (clé
// « desktop » en Bearer, AUCUNE origine admise, desktop.ts) et AETHRYON Music d'ytapi (cloud-music/MUSIC-API.md).
//
// - AUCUN filtre de rôle (décision du 2026-10-23) : tout compte connecté analyse, cherche et importe une source qui
//   l'autorise ; seul /api/cloud/* reste réservé à l'administrateur. La sauvegarde Cloud d'un import est décidée par
//   ytapi et account (administrateur seulement), jamais par ce relais.
// - Moindre privilège : la clé « desktop » ouvre ICI une liste FERMÉE de routes (MUSIC_ROUTES) ; elle reste refusée par
//   /internal/v1/authorize (pas de conversions) et par /api/outils/*. Aucune autre clé (extension, Premiere, raccourci)
//   n'est acceptée en Bearer ici.
// - ytapi reçoit la clé « outils » du compte (en mémoire, 15 min, outils.ts) : la clé « desktop » ne quitte jamais account.
// - Les adresses d'ytapi ne sortent pas : `fichier.url` et la requête de l'action `importer` sont réécrites vers /api/music.
// - Historique de l'espace (migration 015) : liens analysés et imports lancés, 200 au plus par compte.
// Coupé tant que MUSIC_RELAY ≠ 1 : 404 « music_closed » pour tous.
import type { Context, Hono } from "hono";
import type { Services } from "./app.ts";
import { desktopOriginOk } from "./desktop.ts";
import { checkDeviceBearer } from "./extension.ts";
import { writeTx } from "./db.ts";
import { err, HttpError, Limiter, type Vars } from "./http.ts";
import { log } from "./log.ts";

type Json = Record<string, unknown>;

/** Routes ouvertes (les essais vérifient le refus de chacune pour une clé d'un autre type). */
export const MUSIC_ROUTES: readonly (readonly ["GET" | "POST", string])[] = [
  ["GET", "/api/music/connecteurs"],
  ["POST", "/api/music/analyser"],
  ["GET", "/api/music/rechercher"],
  ["POST", "/api/music/correspondances"],
  ["POST", "/api/music/playlists/synchroniser"],
  ["GET", "/api/music/imports"],
  ["POST", "/api/music/imports"],
  ["GET", "/api/music/imports/:id"],
  ["POST", "/api/music/imports/:id/annuler"],
  ["GET", "/api/music/imports/:id/fichier"],
  ["GET", "/api/music/historique"],
];

/** Corps jusqu'à 2 Mio : correspondances et synchronisation (500 titres, 10 000 candidats). */
export const MUSIC_LARGE_BODY_PATHS: ReadonlySet<string> = new Set(["/api/music/correspondances", "/api/music/playlists/synchroniser"]);
export const MUSIC_LARGE_BODY_MAX = 2 * 1024 * 1024;

/** Requête Music authentifiée par une clé (Bearer) : app.ts n'y lit ni session ni contrôle d'origine du site. */
export const isMusicBearer = (path: string, authorization: string | undefined): boolean =>
  path.startsWith("/api/music/") && authorization !== undefined;

const IMPORT_RE = /^mus_[A-Za-z0-9_-]{1,44}$/;
const HISTORY_MAX = 200;
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length > 0 ? v.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max) : null);
const httpsOrNull = (v: unknown): string | null => { const s = str(v, 2048); return s && s.startsWith("https://") ? s : null; };

/** Réécrit les adresses d'ytapi d'une fiche ou d'un import vers le relais. */
export function rewrite(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(rewrite);
  if (!v || typeof v !== "object") return v;
  const o: Json = {};
  for (const [k, x] of Object.entries(v as Json)) {
    if (k === "url" && typeof x === "string" && /^\/(media\/)?music\/imports\/mus_[A-Za-z0-9_-]+\/fichier$/.test(x)) {
      o[k] = x.replace(/^\/(media\/)?music\//, "/api/music/");
    } else if (k === "chemin" && typeof x === "string" && /^\/(media\/)?music\//.test(x)) {
      o[k] = x.replace(/^\/(media\/)?music\//, "/api/music/");
    } else o[k] = rewrite(x);
  }
  return o;
}

export function mountMusic(app: Hono<{ Variables: Vars }>, s: Services): void {
  const { tools, db, cfg } = s;
  const perAccount = new Limiter(900, 3_600_000);

  /** Compte appelant : clé « desktop » (sans origine) ou session ; 404 tant que le relais est coupé. */
  async function who(c: Context<{ Variables: Vars }>): Promise<{ id: string; via: "site" | "desktop" } | Response> {
    if (!cfg.musicEnabled || !cfg.ytapiInternalUrl) return err(c, 404, "music_closed", "AETHRYON Music n'est pas ouvert sur ce serveur.");
    const authz = c.req.header("authorization");
    let id: string, via: "site" | "desktop";
    if (authz !== undefined) {
      if (!desktopOriginOk(c.req.header("origin"))) return err(c, 403, "invalid_origin", "Requête refusée (origine inattendue).");
      const d = await checkDeviceBearer(s, authz, "desktop");
      if ("status" in d) {
        return err(c, d.status, d.error, d.status === 403 ? "Ce compte est suspendu." : "Liaison d'AETHRYON Desktop absente, révoquée ou expirée : relie-le de nouveau (Paramètres › Compte).");
      }
      id = d.user.id; via = "desktop";
    } else {
      const u = c.get("user");
      if (!u) return err(c, 401, "unauthorized", "Connecte-toi pour utiliser AETHRYON Music.");
      id = u.id; via = "site";
    }
    if (!perAccount.take(id)) return err(c, 429, "rate_limited", "Trop de demandes à AETHRYON Music : réessaie dans quelques minutes.");
    return { id, via };
  }

  /** Réponse JSON d'ytapi → même statut, adresses réécrites ; erreurs : `error` et `detail` d'ytapi gardés. */
  async function relayJson(c: Context, res: Response): Promise<{ response: Response; body: Json | null }> {
    const text = await res.text();
    let body: Json | null = null;
    try { body = text ? JSON.parse(text) as Json : null; } catch { body = null; }
    const retry = res.headers.get("retry-after");
    if (retry && /^\d{1,6}$/.test(retry)) c.header("Retry-After", retry);
    if (res.status >= 400) {
      const b = body ?? {};
      if (res.status === 404 && !b.error) return { response: err(c, 404, "music_closed", "AETHRYON Music n'est pas ouvert sur ce serveur."), body: null };
      const detail = str(b.detail, 500) ?? "AETHRYON Music est momentanément indisponible.";
      return { response: c.json({ error: str(b.error, 60) ?? "music_error", detail, message: detail }, res.status as 400), body: null };
    }
    const out = rewrite(body ?? {}) as Json;
    return { response: c.json(out, res.status as 200), body: out };
  }

  const call = async (id: string, method: string, path: string, json?: unknown) => {
    try {
      return await tools.call(id, method, path, json === undefined ? {} : { json }, "music");
    } catch (e) {
      if (e instanceof HttpError) throw new HttpError(503, "music_unavailable", "AETHRYON Music est momentanément indisponible.");
      throw e;
    }
  };

  const body = async (c: Context): Promise<Json> => {
    const b = await c.req.json().catch(() => null);
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new HttpError(400, "requete_invalide", "Requête invalide.");
    return b as Json;
  };

  async function note(userId: string, via: "site" | "desktop", e: { action: "analyse" | "import"; url: unknown; connecteur: unknown; titre?: unknown; artistes?: unknown; pochette?: unknown; etat: unknown; importId?: string | null }) {
    const url = str(e.url, 2048);
    if (!url) return;
    const now = new Date().toISOString();
    const artistes = Array.isArray(e.artistes) ? JSON.stringify(e.artistes.filter((a) => typeof a === "string").slice(0, 12).map((a) => (a as string).slice(0, 150))) : null;
    try {
      await writeTx(db, () => {
        db.prepare(
          "INSERT INTO ytc_music_historique (user_id, action, url, connecteur, titre, artistes, pochette, etat, import_id, origine, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, import_id) WHERE import_id IS NOT NULL DO UPDATE SET etat = excluded.etat, " +
          "titre = COALESCE(excluded.titre, ytc_music_historique.titre), updated_at = excluded.updated_at",
        ).run(userId, e.action, url, str(e.connecteur, 20) ?? "inconnu", str(e.titre, 300), artistes, httpsOrNull(e.pochette), str(e.etat, 30) ?? "inconnu", e.importId ?? null, via, now, now);
        db.prepare("DELETE FROM ytc_music_historique WHERE user_id = ? AND id NOT IN (SELECT id FROM ytc_music_historique WHERE user_id = ? ORDER BY id DESC LIMIT ?)").run(userId, userId, HISTORY_MAX);
      });
    } catch (x) {
      log("warn", "music history not recorded", { err: String(x) });
    }
  }

  const importId = (c: Context) => {
    const id = c.req.param("id") ?? "";
    if (!IMPORT_RE.test(id)) throw new HttpError(404, "import_introuvable", "Import introuvable.");
    return id;
  };

  app.get("/api/music/connecteurs", async (c) => {
    const w = await who(c); if (w instanceof Response) return w;
    return (await relayJson(c, await call(w.id, "GET", "/music/connecteurs"))).response;
  });

  app.post("/api/music/analyser", async (c) => {
    const w = await who(c); if (w instanceof Response) return w;
    const b = await body(c);
    const r = await relayJson(c, await call(w.id, "POST", "/music/analyser", { url: b.url, ...(b.type !== undefined ? { type: b.type } : {}) }));
    const f = r.body?.fiche as Json | undefined;
    if (f) await note(w.id, w.via, { action: "analyse", url: f.url ?? b.url, connecteur: f.connecteur, titre: f.titre, artistes: f.artistes, pochette: f.pochette, etat: f.etat });
    return r.response;
  });

  app.get("/api/music/rechercher", async (c) => {
    const w = await who(c); if (w instanceof Response) return w;
    const q = c.req.query("q") ?? "", source = c.req.query("source") ?? "";
    return (await relayJson(c, await call(w.id, "GET", `/music/rechercher?q=${encodeURIComponent(q.slice(0, 200))}&source=${encodeURIComponent(source.slice(0, 20))}`))).response;
  });

  app.post("/api/music/correspondances", async (c) => {
    const w = await who(c); if (w instanceof Response) return w;
    const b = await body(c);
    return (await relayJson(c, await call(w.id, "POST", "/music/correspondances", { pistes: b.pistes, candidats: b.candidats }))).response;
  });

  app.post("/api/music/playlists/synchroniser", async (c) => {
    const w = await who(c); if (w instanceof Response) return w;
    const b = await body(c);
    return (await relayJson(c, await call(w.id, "POST", "/music/playlists/synchroniser", { url: b.url, candidats: b.candidats }))).response;
  });

  app.get("/api/music/imports", async (c) => {
    const w = await who(c); if (w instanceof Response) return w;
    return (await relayJson(c, await call(w.id, "GET", "/music/imports"))).response;
  });

  app.post("/api/music/imports", async (c) => {
    const w = await who(c); if (w instanceof Response) return w;
    // Anti-bot : imports demandés depuis le SITE seulement (le Desktop, par clé, n'est jamais défié).
    if (w.via === "site") { const g = await s.antibot.guard(c, "travaux"); if (g.deny) return g.deny; }
    const b = await body(c);
    // Champs fermés (le serveur relit la source ; rien d'autre ne passe).
    const fwd: Json = {};
    for (const k of ["url", "type", "fichier", "episode", "attestation"]) if (k in b) fwd[k] = b[k];
    const r = await relayJson(c, await call(w.id, "POST", "/music/imports", fwd));
    const imp = r.body?.import as Json | undefined;
    if (imp && typeof imp.id === "string" && IMPORT_RE.test(imp.id)) {
      await note(w.id, w.via, { action: "import", url: imp.sourceUrl ?? b.url, connecteur: imp.connecteur, titre: imp.titre, artistes: imp.artistes, etat: imp.etat, importId: imp.id });
    }
    return r.response;
  });

  app.get("/api/music/imports/:id", async (c) => {
    const w = await who(c); if (w instanceof Response) return w;
    const id = importId(c);
    const r = await relayJson(c, await call(w.id, "GET", `/music/imports/${id}`));
    const imp = r.body?.import as Json | undefined;
    if (imp && ["termine", "echec", "annule"].includes(String(imp.etat))) {
      await note(w.id, w.via, { action: "import", url: imp.sourceUrl, connecteur: imp.connecteur, titre: imp.titre, artistes: imp.artistes, etat: imp.etat, importId: id });
    }
    return r.response;
  });

  app.post("/api/music/imports/:id/annuler", async (c) => {
    const w = await who(c); if (w instanceof Response) return w;
    const id = importId(c);
    const r = await relayJson(c, await call(w.id, "DELETE", `/music/imports/${id}`));
    if (r.body) {
      await writeTx(db, () => {
        db.prepare("UPDATE ytc_music_historique SET etat = 'annule', updated_at = ? WHERE user_id = ? AND import_id = ? AND etat NOT IN ('termine', 'echec')").run(new Date().toISOString(), w.id, id);
      }).catch((x) => log("warn", "music history not recorded", { err: String(x) }));
    }
    return r.response;
  });

  app.get("/api/music/imports/:id/fichier", async (c) => {
    const w = await who(c); if (w instanceof Response) return w;
    const id = importId(c);
    const res = await call(w.id, "GET", `/music/imports/${id}/fichier`);
    if (res.status !== 200) return (await relayJson(c, res)).response;
    const headers = new Headers({ "cache-control": "no-store", "x-content-type-options": "nosniff" });
    for (const n of ["content-type", "content-length", "content-disposition"]) { const v = res.headers.get(n); if (v) headers.set(n, v); }
    if (!(headers.get("content-type") ?? "").startsWith("audio/")) {
      await res.body?.cancel().catch(() => undefined);
      return err(c, 502, "source_illisible", "Réponse inattendue d'AETHRYON Music.");
    }
    return new Response(res.body, { status: 200, headers });
  });

  app.get("/api/music/historique", async (c) => {
    const w = await who(c); if (w instanceof Response) return w;
    const rows = db.prepare(
      "SELECT action, url, connecteur, titre, artistes, pochette, etat, import_id, origine, created_at, updated_at FROM ytc_music_historique WHERE user_id = ? ORDER BY id DESC LIMIT 100",
    ).all(w.id) as { action: string; url: string; connecteur: string; titre: string | null; artistes: string | null; pochette: string | null; etat: string; import_id: string | null; origine: string; created_at: string; updated_at: string }[];
    return c.json({
      entrees: rows.map((r) => ({
        action: r.action, url: r.url, connecteur: r.connecteur, titre: r.titre, artistes: r.artistes ? JSON.parse(r.artistes) as string[] : [],
        pochette: r.pochette, etat: r.etat, importId: r.import_id, origine: r.origine, creeLe: r.created_at, majLe: r.updated_at,
      })),
    });
  });
}

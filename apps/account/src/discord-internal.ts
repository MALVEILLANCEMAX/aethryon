// API interne du bot Discord (docs/DISCORD-BOT.md §17) : port à part (DISCORD_INTERNAL_PORT, 3002), réseau
// Docker interne du bot seulement (DISCORD_INTERNAL_ALLOW_FROM) et secret propre au bot (en-tête X-Bot-Token,
// comparé à temps constant sur des empreintes SHA-256 de même longueur) : distinct du jeton de ytapi, qui
// n'ouvre pas cette API (et ce secret n'ouvre pas celle de ytapi, port 3001).
//   POST /internal/v1/discord/resolve   {discord_user_id, profile?} → qui est ce compte (lié, état, quota du jour)
//   POST /internal/v1/discord/session   {discord_user_id}          → clé ytc_ « discord » de 15 min (201)
//   POST /internal/v1/discord/release   {discord_user_id, key_id}  → rend la clé en fin de conversion (204)
//   POST /internal/v1/discord/download  {discord_user_id, job_id}  → lien de téléchargement à usage unique (201)
// Version 2 (docs/DISCORD-BOT.md §18, migration 006) :
//   POST /internal/v1/discord/unlink        {discord_user_id}                       → déliaison depuis Discord
//   POST /internal/v1/discord/history       {discord_user_id, limit?}               → historique récent (sans lien ni titre)
//   POST /internal/v1/discord/file          {discord_user_id, job_id, max_bytes}    → fichier pour une pièce jointe (413 si trop gros)
//   POST /internal/v1/discord/prefs[/set]   {discord_user_id, fmt?, quality?, visibility?, locale?}
//   POST /internal/v1/discord/saved/{list,get,add,remove}                           → médias enregistrés (références)
//   POST /internal/v1/discord/guild[/set|/forget] {guild_id, settings?}             → réglages d'un serveur
// Journaux : jamais d'identifiant Discord, de clé ni de lien.
import { Hono } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { createHash, timingSafeEqual } from "node:crypto";
import { ipInCidr, type Config } from "./config.ts";
import { DiscordError, JOB_ID_RE, type DiscordService } from "./discord.ts";
import { LibraryError, MAX_SAVED, type LibraryService, type Platform } from "./discord-library.ts";
import type { ToolsService } from "./outils.ts";
import { Limiter } from "./http.ts";
import { log } from "./log.ts";

const digest = (v: string) => createHash("sha256").update(v).digest();
const SNOWFLAKE = /^\d{17,20}$/;
const KEY_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Corps JSON exactement composé des champs attendus, tous des chaînes au bon format ; sinon null. */
function fields(body: unknown, spec: Record<string, RegExp>): Record<string, string> | null {
  const r = parse(body, Object.fromEntries(Object.entries(spec).map(([k, re]) => [k, { re }])));
  return r as Record<string, string> | null;
}

type FieldSpec = { re: RegExp; optional?: boolean } | { int: [number, number]; optional?: boolean } | { object: true; optional?: boolean };
/** Corps JSON : uniquement les champs déclarés, chacun du bon type (chaîne et motif, entier borné, objet) ; sinon null. */
function parse(body: unknown, spec: Record<string, FieldSpec>): Record<string, string | number | Record<string, unknown>> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some((k) => !(k in spec))) return null;
  const out: Record<string, string | number | Record<string, unknown>> = {};
  for (const [k, f] of Object.entries(spec)) {
    const v = b[k];
    if (v === undefined || v === null) {
      if (f.optional) continue;
      return null;
    }
    if ("re" in f) {
      if (typeof v !== "string" || !f.re.test(v)) return null;
      out[k] = v;
    } else if ("int" in f) {
      if (typeof v !== "number" || !Number.isInteger(v) || v < f.int[0] || v > f.int[1]) return null;
      out[k] = v;
    } else {
      if (typeof v !== "object" || Array.isArray(v)) return null;
      out[k] = v as Record<string, unknown>;
    }
  }
  return out;
}

export function createDiscordInternalApp(cfg: Config, discord: DiscordService, library?: LibraryService, tools?: ToolsService): Hono {
  if (!cfg.discordInternal) throw new Error("API interne du bot Discord non configurée");
  const { token, allowFrom } = cfg.discordInternal;
  const expected = digest(token);
  const app = new Hono();
  // Clés émises : 30 par heure et par compte Discord (le quota du compte reste la vraie limite) ; liens : 30 par heure.
  const sessionLimiter = new Limiter(30, 3_600_000);
  const downloadLimiter = new Limiter(30, 3_600_000);
  // Version 2 : lecture du compte (la page « Lier » interroge pendant l'autorisation), déliaison, bibliothèque,
  // fichiers pour les pièces jointes, réglages de serveur (par serveur).
  const resolveLimiter = new Limiter(600, 3_600_000);
  const unlinkLimiter = new Limiter(10, 600_000);
  const libraryLimiter = new Limiter(300, 3_600_000);
  const fileLimiter = new Limiter(60, 3_600_000);
  const guildLimiter = new Limiter(60, 3_600_000);

  app.use("*", async (c, next) => {
    if (allowFrom) {
      let remote = "";
      try { remote = getConnInfo(c).remote.address ?? ""; } catch { remote = ""; }
      if (!ipInCidr(remote, allowFrom)) return c.json({ error: "forbidden", message: "Origine réseau refusée." }, 403);
    }
    const got = c.req.header("x-bot-token") ?? "";
    if (!timingSafeEqual(digest(got), expected)) return c.json({ error: "unauthorized", message: "Secret du bot absent ou invalide." }, 401);
    await next();
  });

  const bad = () => new Response(JSON.stringify({ error: "bad_request", message: "Requête invalide." }), { status: 400, headers: { "content-type": "application/json" } });
  const refuse = (e: unknown) => {
    if (e instanceof DiscordError) return new Response(JSON.stringify({ error: e.code, message: e.message }), { status: e.status, headers: { "content-type": "application/json" } });
    throw e;
  };
  const read = async (c: { req: { json(): Promise<unknown> } }, spec: Record<string, RegExp>) => fields(await c.req.json().catch(() => null), spec);

  app.get("/internal/v1/discord/health", (c) => c.json({ status: "ok", linking: discord.enabled }));

  app.post("/internal/v1/discord/resolve", async (c) => {
    // `profile` (facultatif, 2026-10-13) : nom d'utilisateur, nom affiché et empreinte de l'image que Discord joint à
    // l'interaction ; account les vérifie et tient le profil du compte lié à jour (espace › Discord).
    const b = parse(await c.req.json().catch(() => null), { discord_user_id: { re: SNOWFLAKE }, profile: { object: true, optional: true } });
    if (!b) return bad();
    const id = b.discord_user_id as string;
    if (!resolveLimiter.take(id)) return c.json({ error: "rate_limited", message: "Trop de demandes : réessaie plus tard." }, 429);
    const t0 = Date.now();
    const pr = b.profile as Record<string, unknown> | undefined;
    const profile = pr && typeof pr.name === "string"
      ? { name: pr.name, display: typeof pr.display === "string" ? pr.display : null, avatar: typeof pr.avatar === "string" ? pr.avatar : null }
      : null;
    const r = await discord.resolve(id, profile);
    log("info", "discord resolve", { linked: r.linked, status: r.linked ? r.status : undefined, ms: Date.now() - t0 });
    return c.json(r);
  });

  app.post("/internal/v1/discord/session", async (c) => {
    const b = await read(c, { discord_user_id: SNOWFLAKE });
    if (!b) return bad();
    if (!sessionLimiter.take(b.discord_user_id!)) return c.json({ error: "rate_limited", message: "Trop de conversions demandées : réessaie plus tard." }, 429);
    try {
      return c.json(await discord.session(b.discord_user_id!), 201);
    } catch (e) { return refuse(e); }
  });

  app.post("/internal/v1/discord/release", async (c) => {
    const b = await read(c, { discord_user_id: SNOWFLAKE, key_id: KEY_ID_RE });
    if (!b) return bad();
    try {
      await discord.release(b.discord_user_id!, b.key_id!);
      return c.body(null, 204);
    } catch (e) { return refuse(e); }
  });

  app.post("/internal/v1/discord/download", async (c) => {
    const b = await read(c, { discord_user_id: SNOWFLAKE, job_id: JOB_ID_RE });
    if (!b) return bad();
    if (!downloadLimiter.take(b.discord_user_id!)) return c.json({ error: "rate_limited", message: "Trop de liens demandés : réessaie plus tard." }, 429);
    try {
      return c.json(await discord.createDownload(b.discord_user_id!, b.job_id!), 201);
    } catch (e) { return refuse(e); }
  });

  // Lien « Ouvrir dans AETHRYON Tools » (docs/OUTILS.md) : pour un job du compte lié, valable 55 min et seulement pour ce
  // compte une fois connecté au site (le lien posté dans un salon ne donne rien à quelqu'un d'autre).
  const toolsLimiter = new Limiter(60, 3_600_000);
  app.post("/internal/v1/discord/outils", async (c) => {
    const b = await read(c, { discord_user_id: SNOWFLAKE, job_id: JOB_ID_RE });
    if (!b) return bad();
    if (!tools?.enabled) return c.json({ error: "tools_unavailable", message: "AETHRYON Tools n'est pas ouvert." }, 503);
    if (!toolsLimiter.take(b.discord_user_id!)) return c.json({ error: "rate_limited", message: "Trop de liens demandés : réessaie plus tard." }, 429);
    try {
      const userId = discord.userOf(b.discord_user_id!);
      const { token, expiresAt } = await tools.createRef(userId, b.job_id!, "discord");
      return c.json({ url: `${cfg.publicUrl}/outils/studio#ref=${token}`, expires_at: expiresAt }, 201);
    } catch (e) { return refuse(e); }
  });

  // ---- version 2 ---------------------------------------------------------------------------------
  const body = async (c: { req: { json(): Promise<unknown> } }, spec: Record<string, FieldSpec>) => parse(await c.req.json().catch(() => null), spec);
  const refuseLib = (e: unknown) => {
    if (e instanceof LibraryError) return new Response(JSON.stringify({ error: e.code, message: e.message }), { status: e.status, headers: { "content-type": "application/json" } });
    return refuse(e);
  };
  const lib = () => {
    if (!library) throw new DiscordError(503, "library_unavailable", "Bibliothèque indisponible.");
    return library;
  };
  const PLATFORM_RE = /^(youtube|tiktok|x)$/;
  const SAVED_ID = /^[A-Za-z0-9_-]{8,32}$/;

  app.post("/internal/v1/discord/unlink", async (c) => {
    const b = await read(c, { discord_user_id: SNOWFLAKE });
    if (!b) return bad();
    if (!unlinkLimiter.take(b.discord_user_id!)) return c.json({ error: "rate_limited", message: "Trop de demandes : réessaie plus tard." }, 429);
    return c.json({ unlinked: await discord.unlinkFromDiscord(b.discord_user_id!) });
  });

  app.post("/internal/v1/discord/history", async (c) => {
    const b = await body(c, { discord_user_id: { re: SNOWFLAKE }, limit: { int: [1, 25], optional: true } });
    if (!b) return bad();
    if (!libraryLimiter.take(b.discord_user_id as string)) return c.json({ error: "rate_limited", message: "Trop de demandes : réessaie plus tard." }, 429);
    try { return c.json(discord.history(b.discord_user_id as string, (b.limit as number | undefined) ?? 10)); } catch (e) { return refuse(e); }
  });

  app.post("/internal/v1/discord/file", async (c) => {
    const b = await body(c, { discord_user_id: { re: SNOWFLAKE }, job_id: { re: JOB_ID_RE }, max_bytes: { int: [1, 500 * 1024 * 1024] } });
    if (!b) return bad();
    if (!fileLimiter.take(b.discord_user_id as string)) return c.json({ error: "rate_limited", message: "Trop de fichiers demandés : réessaie plus tard." }, 429);
    try {
      const r = await discord.fileFor(b.discord_user_id as string, b.job_id as string, b.max_bytes as number);
      if (r.ok) return r.res;
      return c.json({ error: r.error, ...(r.size !== undefined ? { size: r.size } : {}) }, r.status as 410 | 413 | 429 | 503);
    } catch (e) { return refuse(e); }
  });

  app.post("/internal/v1/discord/prefs", async (c) => {
    const b = await read(c, { discord_user_id: SNOWFLAKE });
    if (!b) return bad();
    try { return c.json(lib().prefs(discord.userOf(b.discord_user_id!))); } catch (e) { return refuseLib(e); }
  });

  app.post("/internal/v1/discord/prefs/set", async (c) => {
    const b = await body(c, {
      discord_user_id: { re: SNOWFLAKE }, fmt: { re: /^(mp4|mp3)$/, optional: true }, quality: { re: /^(auto|720|1080)$/, optional: true },
      visibility: { re: /^(private|share)$/, optional: true }, locale: { re: /^(auto|fr|en)$/, optional: true },
    });
    if (!b) return bad();
    if (!libraryLimiter.take(b.discord_user_id as string)) return c.json({ error: "rate_limited", message: "Trop de demandes : réessaie plus tard." }, 429);
    const { discord_user_id: id, ...patch } = b;
    try { return c.json(await lib().setPrefs(discord.userOf(id as string), patch)); } catch (e) { return refuseLib(e); }
  });

  app.post("/internal/v1/discord/saved/list", async (c) => {
    const b = await body(c, {
      discord_user_id: { re: SNOWFLAKE }, q: { re: /^[^\u0000-\u001f]{0,60}$/, optional: true }, platform: { re: PLATFORM_RE, optional: true },
      type: { re: /^(video|audio)$/, optional: true }, offset: { int: [0, MAX_SAVED], optional: true },
    });
    if (!b) return bad();
    if (!libraryLimiter.take(b.discord_user_id as string)) return c.json({ error: "rate_limited", message: "Trop de demandes : réessaie plus tard." }, 429);
    try {
      const r = lib().savedList(discord.userOf(b.discord_user_id as string), {
        q: (b.q as string | undefined) ?? null, platform: (b.platform as Platform | undefined) ?? null,
        type: (b.type as "video" | "audio" | undefined) ?? null, offset: (b.offset as number | undefined) ?? 0,
      });
      return c.json({ ...r, max: MAX_SAVED });
    } catch (e) { return refuseLib(e); }
  });

  app.post("/internal/v1/discord/saved/get", async (c) => {
    const b = await read(c, { discord_user_id: SNOWFLAKE, id: SAVED_ID });
    if (!b) return bad();
    try {
      const item = lib().savedGet(discord.userOf(b.discord_user_id!), b.id!);
      return item ? c.json(item) : c.json({ error: "not_found", message: "Ce média n'est plus enregistré." }, 404);
    } catch (e) { return refuseLib(e); }
  });

  app.post("/internal/v1/discord/saved/add", async (c) => {
    const b = await body(c, {
      discord_user_id: { re: SNOWFLAKE }, url: { re: /^https:\/\/[^\s]{4,2040}$/ }, media_type: { re: /^(video|audio)$/, optional: true },
      title: { re: /^[\s\S]{1,400}$/, optional: true }, creator: { re: /^[\s\S]{1,200}$/, optional: true }, duration_s: { int: [0, 86400], optional: true },
    });
    if (!b) return bad();
    if (!libraryLimiter.take(b.discord_user_id as string)) return c.json({ error: "rate_limited", message: "Trop de demandes : réessaie plus tard." }, 429);
    try {
      const r = await lib().savedAdd(discord.userOf(b.discord_user_id as string), {
        url: b.url as string, mediaType: b.media_type, title: b.title, creator: b.creator, durationS: b.duration_s, origin: "discord",
      });
      log("info", "discord media saved", { created: r.created });
      return c.json(r, r.created ? 201 : 200);
    } catch (e) { return refuseLib(e); }
  });

  app.post("/internal/v1/discord/saved/remove", async (c) => {
    const b = await read(c, { discord_user_id: SNOWFLAKE, id: SAVED_ID });
    if (!b) return bad();
    if (!libraryLimiter.take(b.discord_user_id!)) return c.json({ error: "rate_limited", message: "Trop de demandes : réessaie plus tard." }, 429);
    try { return c.json({ removed: await lib().savedRemove(discord.userOf(b.discord_user_id!), b.id!) }); } catch (e) { return refuseLib(e); }
  });

  // Tout effacer (bouton « Tout effacer » de /saved, après confirmation) : la bibliothèque du compte lié, d'un coup.
  app.post("/internal/v1/discord/saved/clear", async (c) => {
    const b = await read(c, { discord_user_id: SNOWFLAKE });
    if (!b) return bad();
    if (!libraryLimiter.take(b.discord_user_id!)) return c.json({ error: "rate_limited", message: "Trop de demandes : réessaie plus tard." }, 429);
    try {
      const removed = await lib().savedClear(discord.userOf(b.discord_user_id!));
      log("info", "discord saved media cleared", { removed });
      return c.json({ removed });
    } catch (e) { return refuseLib(e); }
  });

  app.post("/internal/v1/discord/guild", async (c) => {
    const b = await read(c, { guild_id: SNOWFLAKE });
    if (!b) return bad();
    try { return c.json(lib().guild(b.guild_id!)); } catch (e) { return refuseLib(e); }
  });

  app.post("/internal/v1/discord/guild/set", async (c) => {
    const b = await body(c, { guild_id: { re: SNOWFLAKE }, settings: { object: true } });
    if (!b) return bad();
    if (!guildLimiter.take(b.guild_id as string)) return c.json({ error: "rate_limited", message: "Trop de modifications : réessaie plus tard." }, 429);
    try {
      const settings = await lib().setGuild(b.guild_id as string, b.settings);
      log("info", "discord guild settings updated");
      return c.json({ settings, stored: true });
    } catch (e) { return refuseLib(e); }
  });

  app.post("/internal/v1/discord/guild/forget", async (c) => {
    const b = await read(c, { guild_id: SNOWFLAKE });
    if (!b) return bad();
    try { return c.json({ forgotten: await lib().forgetGuild(b.guild_id!) }); } catch (e) { return refuseLib(e); }
  });

  app.notFound((c) => c.json({ error: "not_found", message: "Route inconnue." }, 404));
  app.onError((e, c) => {
    log("error", "discord internal error", { err: String(e) });
    return c.json({ error: "internal_error", message: "Erreur interne." }, 500);
  });
  return app;
}

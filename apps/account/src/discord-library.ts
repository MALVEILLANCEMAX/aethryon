// Bot Discord, version 2 (docs/DISCORD-BOT.md §18), côté account : préférences personnelles, médias enregistrés
// (références, jamais de fichier) et réglages de serveur. Tout est validé ICI (le bot n'est pas cru sur parole) :
// lien canonique d'une plateforme prise en charge (la plateforme est déduite du lien, jamais fournie), textes
// nettoyés et bornés, réglages de serveur par liste blanche. Migration 006.
// Jamais journalisés : identifiant Discord, lien, titre.
import { randomBytes } from "node:crypto";
import { writeTx, type DB } from "./db.ts";
import { nowIso } from "./time.ts";
import { isYouTubeMusicUrl, YOUTUBE_MUSIC_CODE, YOUTUBE_MUSIC_TEXT } from "./youtube-music.ts";

export const MAX_SAVED = 200;
export const SAVED_PAGE = 25;
/** Réglages de serveur effacés après ce délai sans modification (le bot qui quitte un serveur les efface aussi). */
export const GUILD_RETENTION_DAYS = 400;

export type Platform = "youtube" | "tiktok" | "x";
export type Fmt = "mp4" | "mp3";
export type Quality = "auto" | "720" | "1080";
export type Visibility = "private" | "share";
export type Locale = "auto" | "fr" | "en";

export class LibraryError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

// ---- liens ------------------------------------------------------------------------------------------

const HOSTS: { re: RegExp; platform: Platform }[] = [
  { re: /^(?:www\.|m\.)?youtube\.com$/, platform: "youtube" },  // jamais music.youtube.com (fermé le 2026-10-23)
  { re: /^youtu\.be$/, platform: "youtube" },
  { re: /^(?:www\.|m\.|vm\.|vt\.)?tiktok\.com$/, platform: "tiktok" },
  { re: /^(?:www\.|mobile\.)?(?:x|twitter)\.com$/, platform: "x" },
];
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Lien canonique d'une vidéo d'une plateforme prise en charge, ou null. https seulement, sans identifiants, port
 * par défaut ; YouTube réduit à l'identifiant de la vidéo (watch?v=…, shorts) ; TikTok et X sans paramètres.
 * Ce n'est pas la validation de ytapi (qui reste la référence au moment d'une conversion) : seulement une forme
 * stable pour dédoublonner et afficher un lien sûr.
 */
export function canonicalMedia(raw: string): { url: string; platform: Platform } | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
  const host = u.hostname.toLowerCase();
  const hit = HOSTS.find((h) => h.re.test(host));
  if (!hit) return null;
  let url: string | null = null;
  if (hit.platform === "youtube") {
    const short = host === "youtu.be" ? u.pathname.slice(1) : null;
    const path = u.pathname.match(/^\/(?:shorts|live|embed|v)\/([A-Za-z0-9_-]{11})\/?$/);
    const id = short ?? (u.pathname === "/watch" ? u.searchParams.get("v") : path?.[1] ?? null);
    if (id && YT_ID.test(id)) url = path && u.pathname.startsWith("/shorts/") ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`;
  } else if (hit.platform === "tiktok") {
    const video = u.pathname.match(/^\/@([A-Za-z0-9._-]{1,40})\/video\/(\d{6,25})\/?$/);
    const shortLink = /^(vm|vt)\./.test(host) ? u.pathname.match(/^\/([A-Za-z0-9]{4,20})\/?$/) : u.pathname.match(/^\/t\/([A-Za-z0-9]{4,20})\/?$/);
    if (video) url = `https://www.tiktok.com/@${video[1]}/video/${video[2]}`;
    else if (shortLink) url = /^(vm|vt)\./.test(host) ? `https://${host}/${shortLink[1]}/` : `https://www.tiktok.com/t/${shortLink[1]}/`;
  } else {
    const status = u.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d{6,25})(\/(?:video|photo)\/[1-4])?\/?$/);
    if (status) url = `https://x.com/${status[1]}/status/${status[2]}${status[3] ?? ""}`;
  }
  return url && url.length <= 300 ? { url, platform: hit.platform } : null;
}

/** Texte affiché (titre, auteur) : NFC, sans caractères de contrôle ni de mise en forme bidirectionnelle, borné. */
export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.slice(0, max * 4).normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f­؜᠎​-‏‪-‮⁠-⁯﻿￹-￻]/g, "")
    .replace(/\s+/g, " ").trim();
  if (!s) return null;
  return Array.from(s).slice(0, max).join("");
}

// ---- préférences ------------------------------------------------------------------------------------

export interface Prefs { fmt: Fmt; quality: Quality; visibility: Visibility; locale: Locale }
export const DEFAULT_PREFS: Prefs = { fmt: "mp4", quality: "auto", visibility: "private", locale: "auto" };
export const PREF_VALUES = {
  fmt: ["mp4", "mp3"],
  quality: ["auto", "720", "1080"],
  visibility: ["private", "share"],
  locale: ["auto", "fr", "en"],
} as const satisfies Record<keyof Prefs, readonly string[]>;

// ---- réglages de serveur ----------------------------------------------------------------------------

export interface GuildSettings {
  /** Cartes automatiques sous les liens publiés (exige l'intent « Message Content » côté bot). Défaut : non. */
  autoEmbeds: boolean;
  /** Plateformes pour lesquelles une carte apparaît. */
  platforms: Platform[];
  /** Salons autorisés (vide : tous ceux que le bot peut voir). */
  channels: string[];
  /** Boutons de conversion sur les cartes automatiques. */
  buttons: boolean;
  /** Résultats partageables publiquement dans ce serveur (sinon toujours privés). */
  share: boolean;
  /** Qualité vidéo proposée par défaut. */
  quality: Quality;
  /** Cartes automatiques au plus par heure dans ce serveur. */
  perHour: number;
  /** Message d'origine : gardé tel quel, ou son aperçu natif masqué (permission « Gérer les messages » requise). */
  original: "keep" | "suppress";
  /** Réponse aux liens détectés : carte, ou simple réaction (les membres utilisent alors le menu « Applications »). */
  mode: "card" | "react";
}
export const DEFAULT_GUILD: GuildSettings = {
  autoEmbeds: false, platforms: ["youtube", "tiktok", "x"], channels: [], buttons: true, share: false,
  quality: "auto", perHour: 30, original: "keep", mode: "card",
};
const SNOWFLAKE = /^\d{17,20}$/;
const PLATFORMS: readonly Platform[] = ["youtube", "tiktok", "x"];

/** Réglages complets à partir d'un correctif partiel ; refus (400) d'un champ inconnu ou d'une valeur invalide. */
export function mergeGuild(base: GuildSettings, patch: unknown): GuildSettings {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new LibraryError(400, "bad_request", "Réglages invalides.");
  const p = patch as Record<string, unknown>;
  const out: GuildSettings = { ...base, platforms: [...base.platforms], channels: [...base.channels] };
  const bad = (k: string) => new LibraryError(400, "bad_request", `Réglage invalide : ${k}.`);
  for (const [k, v] of Object.entries(p)) {
    switch (k) {
      case "autoEmbeds": case "buttons": case "share":
        if (typeof v !== "boolean") throw bad(k);
        out[k] = v; break;
      case "platforms":
        if (!Array.isArray(v) || v.length > 3 || v.some((x) => !PLATFORMS.includes(x as Platform))) throw bad(k);
        out.platforms = PLATFORMS.filter((x) => (v as string[]).includes(x)); break;
      case "channels":
        if (!Array.isArray(v) || v.length > 25 || v.some((x) => typeof x !== "string" || !SNOWFLAKE.test(x))) throw bad(k);
        out.channels = [...new Set(v as string[])]; break;
      case "quality":
        if (!PREF_VALUES.quality.includes(v as Quality)) throw bad(k);
        out.quality = v as Quality; break;
      case "perHour":
        if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 120) throw bad(k);
        out.perHour = v; break;
      case "original":
        if (v !== "keep" && v !== "suppress") throw bad(k);
        out.original = v; break;
      case "mode":
        if (v !== "card" && v !== "react") throw bad(k);
        out.mode = v; break;
      default:
        throw bad(k);
    }
  }
  return out;
}

// ---- service ------------------------------------------------------------------------------------------

export interface SavedItem {
  id: string; platform: Platform; url: string; mediaType: "video" | "audio";
  title: string | null; creator: string | null; durationS: number | null; origin: "discord" | "site"; savedAt: string;
}
interface SavedRow {
  id: string; platform: Platform; source_url: string; media_type: "video" | "audio"; title: string | null;
  creator: string | null; duration_s: number | null; origin: "discord" | "site"; saved_at: string;
}
const toItem = (r: SavedRow): SavedItem => ({
  id: r.id, platform: r.platform, url: r.source_url, mediaType: r.media_type, title: r.title, creator: r.creator,
  durationS: r.duration_s, origin: r.origin, savedAt: r.saved_at,
});

export class LibraryService {
  private db: DB;
  constructor(db: DB) { this.db = db; }

  prefs(userId: string): Prefs {
    const r = this.db.prepare("SELECT fmt, quality, visibility, locale FROM ytc_user_pref WHERE user_id = ?").get(userId) as Prefs | undefined;
    return r ? { fmt: r.fmt, quality: r.quality, visibility: r.visibility, locale: r.locale } : { ...DEFAULT_PREFS };
  }

  async setPrefs(userId: string, patch: Partial<Record<keyof Prefs, unknown>>): Promise<Prefs> {
    const next = this.prefs(userId);
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in PREF_VALUES)) throw new LibraryError(400, "bad_request", `Préférence inconnue : ${k}.`);
      const allowed = PREF_VALUES[k as keyof Prefs] as readonly string[];
      if (typeof v !== "string" || !allowed.includes(v)) throw new LibraryError(400, "bad_request", `Préférence invalide : ${k}.`);
      (next as unknown as Record<string, string>)[k] = v;
    }
    await writeTx(this.db, () => {
      this.db.prepare(
        "INSERT INTO ytc_user_pref (user_id, fmt, quality, visibility, locale, updated_at) VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(user_id) DO UPDATE SET fmt = excluded.fmt, quality = excluded.quality, visibility = excluded.visibility, locale = excluded.locale, updated_at = excluded.updated_at",
      ).run(userId, next.fmt, next.quality, next.visibility, next.locale, nowIso());
    });
    return next;
  }

  /** Liste paginée (25), la plus récente d'abord ; filtre texte (titre, auteur), plateforme, type. */
  savedList(userId: string, f: { q?: string | null; platform?: Platform | null; type?: "video" | "audio" | null; offset?: number }): { items: SavedItem[]; total: number } {
    const where = ["user_id = ?"];
    const args: (string | number)[] = [userId];
    if (f.platform) { where.push("platform = ?"); args.push(f.platform); }
    if (f.type) { where.push("media_type = ?"); args.push(f.type); }
    const q = cleanText(f.q ?? null, 60);
    if (q) {
      // Recherche littérale (les jokers de LIKE sont neutralisés), insensible à la casse ASCII.
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push("(title LIKE ? ESCAPE '\\' OR creator LIKE ? ESCAPE '\\')");
      args.push(like, like);
    }
    const w = where.join(" AND ");
    const total = Number((this.db.prepare(`SELECT count(*) AS n FROM ytc_saved_media WHERE ${w}`).get(...args) as { n: number }).n);
    const offset = Math.max(0, Math.min(f.offset ?? 0, MAX_SAVED));
    const rows = this.db.prepare(`SELECT * FROM ytc_saved_media WHERE ${w} ORDER BY saved_at DESC, id LIMIT ? OFFSET ?`)
      .all(...args, SAVED_PAGE, offset) as unknown as SavedRow[];
    return { items: rows.map(toItem), total };
  }

  savedGet(userId: string, id: string): SavedItem | null {
    const r = this.db.prepare("SELECT * FROM ytc_saved_media WHERE user_id = ? AND id = ?").get(userId, id) as SavedRow | undefined;
    return r ? toItem(r) : null;
  }

  /** Enregistre une référence (lien canonique + métadonnées affichées) ; déjà enregistrée → la même, sans doublon. */
  async savedAdd(userId: string, input: { url: string; mediaType?: unknown; title?: unknown; creator?: unknown; durationS?: unknown; origin?: "discord" | "site" }): Promise<{ item: SavedItem; created: boolean }> {
    if (isYouTubeMusicUrl(input.url)) throw new LibraryError(400, YOUTUBE_MUSIC_CODE, YOUTUBE_MUSIC_TEXT);
    const media = canonicalMedia(input.url);
    if (!media) throw new LibraryError(400, "unsupported_link", "Ce lien ne peut pas être enregistré : vidéo YouTube, TikTok ou X seulement.");
    const mediaType = input.mediaType === "audio" ? "audio" : "video";
    const title = cleanText(input.title, 200);
    const creator = cleanText(input.creator, 100);
    const d = input.durationS;
    const durationS = typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 86400 ? d : null;
    return writeTx(this.db, () => {
      const existing = this.db.prepare("SELECT * FROM ytc_saved_media WHERE user_id = ? AND source_url = ?").get(userId, media.url) as SavedRow | undefined;
      if (existing) return { item: toItem(existing), created: false };
      const n = Number((this.db.prepare("SELECT count(*) AS n FROM ytc_saved_media WHERE user_id = ?").get(userId) as { n: number }).n);
      if (n >= MAX_SAVED) throw new LibraryError(429, "saved_limit", `Ta bibliothèque est pleine (${MAX_SAVED} médias) : retires-en d'abord.`);
      const row: SavedRow = {
        id: randomBytes(9).toString("base64url"), platform: media.platform, source_url: media.url, media_type: mediaType,
        title, creator, duration_s: durationS, origin: input.origin ?? "discord", saved_at: nowIso(),
      };
      this.db.prepare("INSERT INTO ytc_saved_media (id, user_id, platform, source_url, media_type, title, creator, duration_s, origin, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(row.id, userId, row.platform, row.source_url, row.media_type, row.title, row.creator, row.duration_s, row.origin, row.saved_at);
      return { item: toItem(row), created: true };
    });
  }

  async savedRemove(userId: string, id: string): Promise<boolean> {
    return writeTx(this.db, () => Number(this.db.prepare("DELETE FROM ytc_saved_media WHERE user_id = ? AND id = ?").run(userId, id).changes) === 1);
  }

  async savedClear(userId: string): Promise<number> {
    return writeTx(this.db, () => Number(this.db.prepare("DELETE FROM ytc_saved_media WHERE user_id = ?").run(userId).changes));
  }

  guild(guildId: string): { settings: GuildSettings; stored: boolean } {
    if (!SNOWFLAKE.test(guildId)) throw new LibraryError(400, "bad_request", "Serveur invalide.");
    const r = this.db.prepare("SELECT settings FROM ytc_discord_guild WHERE guild_id = ?").get(guildId) as { settings: string } | undefined;
    if (!r) return { settings: { ...DEFAULT_GUILD, platforms: [...DEFAULT_GUILD.platforms], channels: [] }, stored: false };
    let parsed: unknown;
    try { parsed = JSON.parse(r.settings); } catch { parsed = {}; }
    // Lecture tolérante : un champ devenu invalide (évolution du schéma) reprend sa valeur par défaut.
    const base: GuildSettings = { ...DEFAULT_GUILD, platforms: [...DEFAULT_GUILD.platforms], channels: [] };
    const out = { ...base };
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      try { Object.assign(out, mergeGuild(out, { [k]: v })); } catch { /* valeur ignorée */ }
    }
    return { settings: out, stored: true };
  }

  async setGuild(guildId: string, patch: unknown): Promise<GuildSettings> {
    const next = mergeGuild(this.guild(guildId).settings, patch);
    const now = nowIso();
    await writeTx(this.db, () => {
      this.db.prepare(
        "INSERT INTO ytc_discord_guild (guild_id, settings, created_at, updated_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(guild_id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at",
      ).run(guildId, JSON.stringify(next), now, now);
    });
    return next;
  }

  async forgetGuild(guildId: string): Promise<boolean> {
    if (!SNOWFLAKE.test(guildId)) return false;
    return writeTx(this.db, () => Number(this.db.prepare("DELETE FROM ytc_discord_guild WHERE guild_id = ?").run(guildId).changes) === 1);
  }

  /** Purge : réglages de serveur sans modification depuis GUILD_RETENTION_DAYS. */
  async purge(now = new Date()): Promise<{ guilds: number }> {
    const before = new Date(now.getTime() - GUILD_RETENTION_DAYS * 86_400_000).toISOString();
    return writeTx(this.db, () => ({ guilds: Number(this.db.prepare("DELETE FROM ytc_discord_guild WHERE updated_at < ?").run(before).changes) }));
  }

  /** Export du compte : préférences (si modifiées) et médias enregistrés. */
  exportFor(userId: string): { prefs: Prefs | null; saved: SavedItem[] } {
    const hasPrefs = !!this.db.prepare("SELECT 1 FROM ytc_user_pref WHERE user_id = ?").get(userId);
    const rows = this.db.prepare("SELECT * FROM ytc_saved_media WHERE user_id = ? ORDER BY saved_at DESC").all(userId) as unknown as SavedRow[];
    return { prefs: hasPrefs ? this.prefs(userId) : null, saved: rows.map(toItem) };
  }
}

// Faux account, faux ytapi et fausses interactions des tests du bot v2 (aucune requête vers Discord ni vers les services).
import { AccountError, type GuildSettings, type Prefs, type Resolved, type SavedItem } from "../src/account.ts";
import { createFlights } from "../src/live.ts";
import { createRateLimiter } from "../src/ratelimit.ts";
import type { AnyReply, V2Reply } from "../src/replies.ts";
import { createRouter, type Ix, type IxKind, type RouterDeps } from "../src/v2/router.ts";
import { FLAG_V2, type Features } from "../src/v2/ui.ts";
import { YtapiError, type DeriveParams, type Preview } from "../src/ytapi.ts";

export const SITE = "https://raccourci.example.test";
export const ME = "112233445566778899";
export const OTHER = "998877665544332211";
export const GUILD = "123123123123123123";
export const TIKTOK = "https://www.tiktok.com/@nasa/video/7391234567890123456";
export const ALL: Features = { link: true, convert: true, files: true, library: true, guildConfig: true, autoEmbeds: false, preview: false, compress: false, clip: false, gif: false };
export const MB = 1024 * 1024;

// ---- faux account ------------------------------------------------------------------------------------------
export function fakeAccount() {
  const today = { used: 2, limit: 10, remaining: 8, resetAt: "2026-10-13T00:00:00+02:00" };
  const state = {
    linked: new Set<string>([ME]), suspended: new Set<string>(), down: false,
    prefs: new Map<string, Prefs>(), saved: new Map<string, SavedItem[]>(), guilds: new Map<string, GuildSettings>(),
    files: new Map<string, { bytes: Buffer; name: string; type: string }>(),
    calls: [] as string[], released: 0, sessions: 0, profiles: [] as unknown[],
  };
  const defaults: GuildSettings = { autoEmbeds: false, platforms: ["youtube", "tiktok", "x"], channels: [], buttons: true, share: false, quality: "auto", perHour: 30, original: "keep", mode: "card" };
  const need = (id: string) => {
    if (state.down) throw new AccountError("link_unavailable", 0);
    if (!state.linked.has(id)) throw new AccountError("not_linked", 404);
    if (state.suspended.has(id)) throw new AccountError("account_suspended", 403);
  };
  const api = {
    async resolve(id: string, profile?: unknown) {
      if (profile) state.profiles.push(profile);
      return api.resolve0(id);
    },
    async resolve0(id: string): Promise<Resolved> {
      state.calls.push("resolve");
      if (state.down) throw new AccountError("link_unavailable", 0);
      if (!state.linked.has(id)) return { linked: false };
      if (state.suspended.has(id)) return { linked: true, status: "suspended" };
      return { linked: true, status: "active", user: { name: "Alice <@everyone>", email: "a•••@example.com" }, discord: { name: "alice_", linkedAt: "2026-10-12T07:30:00Z", lastUsedAt: null }, today, maxActive: 1 };
    },
    async session(id: string) { need(id); state.sessions++; return { key: "ytc_" + "k".repeat(40), keyId: "keyid-" + state.sessions, expiresAt: null }; },
    async release() { state.released++; return true; },
    async download(id: string, job: string) { need(id); return { url: `${SITE}/api/discord/telechargement?jeton=${"t".repeat(43)}`, expiresAt: "x", job }; },
    async toolsLink(id: string, job: string) { need(id); state.calls.push(`outils:${job}`); return { url: `${SITE}/outils/studio#ref=${"r".repeat(43)}`, expiresAt: "x" }; },
    async unlink(id: string) { state.calls.push("unlink"); const was = state.linked.delete(id); return was; },
    async history(id: string) { need(id); return { items: [{ id: "u1", createdAt: "2026-10-12T07:00:00Z", finishedAt: null, fmt: "mp4", platform: "tiktok", state: "done", errorCode: null, errorMessage: null }], today }; },
    async prefs(id: string) { need(id); return state.prefs.get(id) ?? { fmt: "mp4", quality: "auto", visibility: "private", locale: "auto" } as Prefs; },
    async setPrefs(id: string, p: Partial<Prefs>) { need(id); const n = { ...(await api.prefs(id)), ...p } as Prefs; state.prefs.set(id, n); return n; },
    async savedList(id: string, f: { q?: string | null } = {}) { need(id); const items = (state.saved.get(id) ?? []).filter((i) => !f.q || (i.title ?? "").includes(f.q)); return { items, total: items.length, max: 200 }; },
    async savedGet(id: string, sid: string) { need(id); return (state.saved.get(id) ?? []).find((i) => i.id === sid) ?? null; },
    async savedAdd(id: string, it: { url: string; title?: string | null }) {
      need(id);
      const list = state.saved.get(id) ?? [];
      const hit = list.find((i) => i.url === it.url);
      if (hit) return { item: hit, created: false };
      const item: SavedItem = { id: `s${list.length + 1}xxxxxxx`, platform: "tiktok", url: it.url, mediaType: "video", title: it.title ?? null, creator: null, durationS: null, origin: "discord", savedAt: "2026-10-12T08:00:00Z" };
      state.saved.set(id, [item, ...list]);
      return { item, created: true };
    },
    async savedClear(id: string) { need(id); const n = (state.saved.get(id) ?? []).length; state.saved.set(id, []); return n; },
    async savedRemove(id: string, sid: string) { need(id); const list = state.saved.get(id) ?? []; state.saved.set(id, list.filter((i) => i.id !== sid)); return list.length !== (state.saved.get(id) ?? []).length; },
    async guild(gid: string) { return { settings: state.guilds.get(gid) ?? { ...defaults, platforms: [...defaults.platforms] }, stored: state.guilds.has(gid) }; },
    async setGuild(gid: string, patch: Partial<GuildSettings>) { const n = { ...(await api.guild(gid)).settings, ...patch }; state.guilds.set(gid, n); state.calls.push("setGuild"); return n; },
    async file(id: string, job: string, max: number) {
      need(id);
      const f = state.files.get(job);
      if (!f) return { ok: false as const, error: "file_gone" };
      if (f.bytes.length > max) return { ok: false as const, error: "too_large", size: f.bytes.length };
      return { ok: true as const, ...f };
    },
  };
  return { api, state };
}

// ---- faux ytapi ---------------------------------------------------------------------------------------------
export const PREVIEW: Preview = {
  platform: "tiktok", title: "Lancement @everyone **Artemis**", uploader: "nasa", durationS: 24, thumbnail: "https://p16.tiktokcdn.example/t.jpg",
  isGif: false, live: false, bestH264: 1080, audioAvailable: true, mp3Bytes: { 192: 600_000 },
  qualities: [{ quality: 1080, estSizeBytes: 25 * MB, h264: true }, { quality: 720, estSizeBytes: 9 * MB, h264: true }],
  limits: { tooLong: false, gifAllowed: true, transcodeAllowed: true }, mediaCount: 1, entries: [],
};
export function fakeYtapi(opts: { size?: number; error?: string; deriveError?: string; deriveSize?: number; preview?: Preview | string } = {}) {
  const calls: { url: string; params: unknown }[] = [];
  const derives: { from: string; p: DeriveParams }[] = [];
  const previews: string[] = [];
  const polls = new Map<string, number>();
  const kinds = new Map<string, string>();
  let n = 0;
  const job = (id: string, status: "queued" | "running" | "done" | "error", extra: Record<string, unknown> = {}) =>
    ({ id, status, stage: status === "running" ? "downloading" : status, progress: status === "done" ? 100 : status === "queued" ? 0 : 40, platform: "tiktok", error: null, ...extra });
  return {
    calls, derives, previews,
    api: {
      async createJob(_k: string, url: string, p: unknown) { calls.push({ url, params: p }); const id = `job-${++n}`; kinds.set(id, "convert"); return job(id, "queued"); },
      async derive(_k: string, from: string, p: DeriveParams) { derives.push({ from, p }); const id = `job-${++n}`; kinds.set(id, p.op); return job(id, "queued"); },
      async job(_k: string, id: string) {
        const c = (polls.get(id) ?? 0) + 1;
        polls.set(id, c);
        if (c < 2) return job(id, "running");
        const kind = kinds.get(id) ?? "convert";
        const err = kind === "convert" ? opts.error : opts.deriveError;
        if (err) return { ...job(id, "error"), stage: "error", progress: 40, error: err };
        if (kind === "gif") return job(id, "done", { title: "Lancement", filename: "Lancement (GIF) [abc].gif", sizeBytes: opts.deriveSize ?? 2 * MB, mediaType: "image/gif", notes: [] });
        if (kind === "compress") return job(id, "done", { title: "Lancement", filename: "Lancement (compressé) [abc].mp4", sizeBytes: opts.deriveSize ?? 9 * MB, mediaType: "video/mp4", notes: ["Image réduite à 540p pour tenir dans 19 Mio."] });
        return job(id, "done", { title: "Lancement @everyone **Artemis**", filename: "Lancement [abc].mp4", sizeBytes: opts.size ?? 3 * MB, mediaType: "video/mp4" });
      },
      async preview(_k: string, url: string) {
        previews.push(url);
        if (typeof opts.preview === "string") throw new YtapiError(opts.preview, 503);
        return opts.preview ?? PREVIEW;
      },
    },
  };
}

// ---- fausses interactions ------------------------------------------------------------------------------------
export interface Call { m: string; r?: AnyReply | V2Reply; eph?: boolean; choices?: unknown }
export function ix(kind: IxKind, o: Partial<Ix> & { opts?: Record<string, string | number | boolean>; userId?: string; profile?: { username: string; globalName?: string | null; avatar?: string | null } } = {}): Ix & { calls: Call[] } {
  const calls: Call[] = [];
  const opts = o.opts ?? {};
  const self: Ix & { calls: Call[] } = {
    kind, calls,
    commandName: o.commandName, subcommand: o.subcommand ?? null, customId: o.customId, values: o.values,
    user: { id: o.userId ?? ME, username: "alice_", ...o.profile }, guildId: o.guildId === undefined ? GUILD : o.guildId, channelId: "555555555555555555",
    attachmentSizeLimit: o.attachmentSizeLimit ?? 20 * MB, canManageGuild: o.canManageGuild ?? false, createdTimestamp: Date.now(),
    option: (n) => (n in opts ? opts[n]! : null), focused: o.focused, messageComponents: o.messageComponents, messageEphemeral: o.messageEphemeral, target: o.target,
    fields: o.fields,
    async showModal(m) { calls.push({ m: "showModal", r: m as never }); },
    async reply(r, eph) { calls.push({ m: "reply", r, eph }); },
    async defer(eph) { calls.push({ m: "defer", eph }); },
    async deferUpdate() { calls.push({ m: "deferUpdate" }); },
    async update(r) { calls.push({ m: "update", r }); },
    async edit(r) { calls.push({ m: "edit", r }); },
    async followUp(r, eph) { calls.push({ m: "followUp", r, eph }); },
    async respond(choices) { calls.push({ m: "respond", choices }); },
  };
  return self;
}

export function bench(features: Features = ALL, y = fakeYtapi()) {
  const acc = fakeAccount();
  const logs: string[] = [];
  // Horloge simulée partant de l'heure réelle (les interactions sont datées par Date.now()) ; chaque attente laisse
  // aussi passer un vrai tour de boucle (la page « Lier » s'interroge en tâche de fond).
  let clock = Date.now();
  const deps: RouterDeps = {
    brand: { site: SITE, emoji: null }, features, account: acc.api as never, ytapi: y.api as never,
    readStatus: async () => ({ site: "ok", conversion: "ok", maintenance: null, platforms: { youtube: true, tiktok: true, x: true }, quotas: { daily: 10, maxActive: 1 }, checkedAt: clock }),
    flights: createFlights(), limiter: createRateLimiter(5, 30_000, () => clock), uiLimiter: createRateLimiter(30, 30_000, () => clock),
    log: (level, msg, data) => logs.push(JSON.stringify({ level, msg, ...data })),
    now: () => clock, sleep: async (ms) => { clock += ms; await new Promise((r) => setTimeout(r, 3)); },
    convert: { minEditMs: 0, pollWaitS: 1, windowMs: 14 * 60_000 },
    linkWatch: { fastMs: 1000, slowMs: 5000, fastForMs: 3000, maxMs: 20_000 },
  };
  const router = createRouter(deps);
  return { router, acc, y, logs, deps, tick: (ms: number) => { clock += ms; } };
}
export const settle = () => new Promise((r) => setTimeout(r, 30));
export const textOf = (r: unknown): string => JSON.stringify(r ?? "");
export const last = (x: { calls: Call[] }, m?: string) => [...x.calls].reverse().find((c) => !m || c.m === m)!;
export const isV2 = (r: unknown) => ((r as V2Reply).flags & FLAG_V2) === FLAG_V2;


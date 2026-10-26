// Bot v2 (docs/DISCORD-BOT.md §18) : TOUTES les interactions (commandes, menu « Applications », boutons, menus,
// autocomplétion) passent ici, sur une interface minimale (Ix) : testable avec de fausses interactions, branchée sur
// discord.js par bot.ts. Règles :
// - réponses PRIVÉES par défaut (éphémères) ; une carte publique seulement si l'utilisateur partage et que le serveur
//   le permet (ou dans une conversation privée) ;
// - un bouton porte son propriétaire (« ae:<action>:<id Discord|*>:… ») : seul lui peut s'en servir, sauf « * »
//   (cartes publiques : chacun agit avec SON compte, en privé) ; le lien de la vidéo est relu sur la carte (bouton
//   « Source ») : aucun état à garder, rien de perdu au redémarrage ;
// - toute action passe par account (compte lié, quota, bibliothèque) et ytapi (conversion) : aucun téléchargeur à part ;
// - journaux sans identifiant, lien ni titre (log.ts masque en plus clés et liens de téléchargement).
import type { AccountClient, GuildSettings, Resolved } from "../account.ts";
import { AccountError } from "../account.ts";
import { runConversion, type ConvertDeps, type Render } from "../convert.ts";
import { conversionErrorText } from "../errors.ts";
import { isSupportedLink, isYouTubeMusicHost, isYouTubeMusicLink } from "../handlers.ts";
import type { createFlights } from "../live.ts";
import type { createRateLimiter } from "../ratelimit.ts";
import type { AnyReply, V2Reply } from "../replies.ts";
import { failureText } from "../replies.ts";
import type { ServiceStatus } from "../status.ts";
import { YtapiError, type DeriveParams, type Job, type JobParams, type YtapiClient } from "../ytapi.ts";
import { installLabel, privateIsEphemeral, REFUSAL_TEXT, sharePolicy, whereOf, type Verdict, type Where } from "./context.ts";
import {
  accountCard, CLIP_MAX_S, clipModal, configCard, detectCard, errorCard, FLAG_EPHEMERAL, GIF_MAX_S, gifModal, helpCard, historyCard, linkedCard,
  linkPanel, linkWaitingExpired, notLinkedCard, prefsCard, previewCard, progressCard, quotaCard, quotaLine, resultCard, savedClearConfirm, savedItemCard,
  savedListCard, row, linkButton, platformName, sharedCard, sharedTooBigCard, simpleCard, sourceOf, suspendedCard, unlinkConfirm, unlinkedCard, type Brand, type Features, type HelpTopic,
  type MediaMeta, type OutFmt,
} from "./ui.ts";

// ---- interface minimale d'une interaction --------------------------------------------------------------

export type IxKind = "command" | "button" | "select" | "channelSelect" | "messageMenu" | "autocomplete" | "modal";
export interface Ix {
  kind: IxKind;
  commandName?: string;
  subcommand?: string | null;
  customId?: string;
  values?: string[];
  /** `globalName` et `avatar` : profil public joint par Discord à l'interaction (empreinte de l'image, pas l'image). */
  user: { id: string; username: string; globalName?: string | null; avatar?: string | null };
  guildId: string | null;
  channelId: string | null;
  /** Limite d'envoi de fichiers de CETTE conversation (octets), fournie par Discord. */
  attachmentSizeLimit: number;
  /** L'utilisateur peut gérer le serveur (réglages /config). */
  canManageGuild: boolean;
  /** Où l'on est (serveur, message privé avec le bot, conversation privée), modes d'installation et permissions
   *  utiles au partage (v2/context.ts). Absent (anciens appels, tests) : déduit de guildId. */
  where?: Where;
  createdTimestamp: number;
  option(name: string): string | number | boolean | null;
  focused?: { name: string; value: string };
  /** Composants (JSON) du message qui porte le bouton ou le menu. */
  messageComponents?: unknown[];
  /** Ce message est-il éphémère (le bouton peut alors le transformer sur place) ? */
  messageEphemeral?: boolean;
  /** Menu « Applications » : message visé (texte, liens et données des aperçus natifs de Discord, auteur). */
  target?: { content: string; urls: string[]; authorId: string; embeds?: NativeEmbed[] };
  /** Modale envoyée : valeurs des champs (texte saisi, ou choix d'un menu séparés par des virgules). */
  fields?: Record<string, string>;
  /** Ouvre une modale (seulement en première réponse à un bouton ou à une commande). */
  showModal?(modal: Record<string, unknown>): Promise<unknown>;
  reply(r: V2Reply, ephemeral: boolean): Promise<unknown>;
  /** Réponse différée ; peut rendre `{ ephemeral }` : ce que Discord a VRAIMENT fait (il impose l'éphémère quand une
   *  application du compte n'a pas le droit de publier ici). */
  defer(ephemeral: boolean): Promise<unknown>;
  deferUpdate(): Promise<unknown>;
  update(r: V2Reply): Promise<unknown>;
  edit(r: AnyReply): Promise<unknown>;
  followUp(r: V2Reply, ephemeral: boolean): Promise<unknown>;
  respond(choices: { name: string; value: string }[]): Promise<unknown>;
}

type AccountApi = Pick<AccountClient, "resolve" | "session" | "release" | "download" | "toolsLink" | "unlink" | "history" | "prefs" | "setPrefs" | "savedList" | "savedGet" | "savedAdd" | "savedRemove" | "savedClear" | "guild" | "setGuild" | "file">;

/** Aperçu natif d'un lien, calculé par Discord (titre, auteur, miniature) : données réelles, sans requête du bot. */
export interface NativeEmbed { url: string | null; title: string | null; author: string | null; thumbnail: string | null }

/** Temps saisi : secondes (75, 75.5) ou minutes:secondes (1:15), heures:minutes:secondes (1:02:03) ; null si illisible. */
export function parseTime(v: unknown): number | null {
  const t = String(v ?? "").trim().replace(",", ".");
  const day = (n: number) => (n <= 86_400 ? n : null);   // 24 h au plus, comme ytapi
  if (/^\d{1,5}(\.\d{1,3})?$/.test(t)) return day(Number(t));
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):([0-5]\d(?:\.\d{1,3})?)$/.exec(t);
  if (!m) return null;
  if (m[1] !== undefined && Number(m[2]) > 59) return null;
  return day(Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]));
}

/** Problème d'un extrait demandé (texte pour l'utilisateur), ou null s'il est valable. */
export function clipProblem(fmt: "mp3" | "mp4", start: number | null, end: number | null): string | null {
  if (start === null || end === null) return "Temps illisible : écris-le en secondes (75) ou en minutes:secondes (1:15).";
  if (end <= start) return "La fin de l'extrait doit venir après son début.";
  if (end - start > CLIP_MAX_S[fmt]) return `Un extrait ${fmt.toUpperCase()} dure au plus ${CLIP_MAX_S[fmt] / 60} minutes.`;
  return null;
}

/** Problème d'un GIF demandé, ou null. */
export function gifProblem(start: number | null, durationS: number): string | null {
  if (start === null) return "Début illisible : écris-le en secondes (75) ou en minutes:secondes (1:15).";
  if (!Number.isFinite(durationS) || durationS < 1 || durationS > GIF_MAX_S) return `La durée d'un GIF va de 1 à ${GIF_MAX_S} secondes.`;
  return null;
}

/** Marge sous la limite d'envoi de Discord (le message et ses composants comptent aussi) ; 1 Mio au moins pour ytapi. */
export const fitFor = (limit: number) => Math.floor(limit * 0.95);
const MIB = 1024 * 1024;
/** Plus gros fichier que le bot joint lui-même : il le tient en mémoire (conteneur de 192 Mo) et account n'en sert pas plus
 *  de 500 Mio. Au-delà : lien de téléchargement, ou compression pour Discord. */
export const MAX_ATTACHMENT = 25 * MIB;
/** Limite d'envoi EFFECTIVE d'une interaction : celle de Discord (10 Mio si absente), plafonnée à MAX_ATTACHMENT. */
export const attachLimit = (ix: { attachmentSizeLimit: number }) =>
  Math.min(Number.isFinite(ix.attachmentSizeLimit) && ix.attachmentSizeLimit > 0 ? ix.attachmentSizeLimit : 10 * MIB, MAX_ATTACHMENT);

/** Erreur de l'API Discord résumée pour le journal : code, statut HTTP, champs refusés (jamais de contenu). */
export function discordError(e: unknown): Record<string, string | number | null> {
  const x = (e ?? {}) as { code?: unknown; status?: unknown; rawError?: { errors?: unknown }; name?: unknown };
  const paths: string[] = [];
  const walk = (o: unknown, path: string) => {
    if (!o || typeof o !== "object" || paths.length >= 3) return;
    const r = o as Record<string, unknown>;
    if (Array.isArray(r._errors)) {
      const first = r._errors[0] as { code?: unknown } | undefined;
      paths.push(`${path}:${typeof first?.code === "string" ? first.code : "?"}`);
      return;
    }
    for (const [k, v] of Object.entries(r)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(x.rawError?.errors, "");
  return { code: typeof x.code === "number" || typeof x.code === "string" ? x.code : null, statut: typeof x.status === "number" ? x.status : null,
    champs: paths.join(" ").slice(0, 300) || null, erreur: typeof x.name === "string" ? x.name.slice(0, 40) : null };
}
const NB = "\u00a0";

export interface RouterDeps {
  brand: Brand;
  features: Features;
  account: AccountApi | null;
  ytapi: (Pick<YtapiClient, "createJob" | "job"> & Partial<Pick<YtapiClient, "derive" | "preview">>) | null;
  readStatus: () => Promise<ServiceStatus>;
  flights: ReturnType<typeof createFlights>;
  /** Actions (conversion, enregistrement, partage) : 5 par 30 s par personne. */
  limiter: ReturnType<typeof createRateLimiter>;
  /** Navigation (menus, pages, réglages) : plus large. */
  uiLimiter: ReturnType<typeof createRateLimiter>;
  /** Actions par SERVEUR (toutes personnes confondues) : un serveur ne peut pas monopoliser le bot. */
  guildLimiter?: ReturnType<typeof createRateLimiter>;
  log: (level: "info" | "warn" | "error", msg: string, data?: Record<string, string | number | boolean | null>) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  convert?: Pick<ConvertDeps, "windowMs" | "minEditMs" | "pollWaitS">;
  linkWatch?: { fastMs: number; slowMs: number; fastForMs: number; maxMs: number };
}

const SNOWFLAKE = /^\d{17,20}$/;
const PLATFORM_OF: [RegExp, string][] = [[/(^|\.)youtube\.com$|^youtu\.be$/, "youtube"], [/(^|\.)tiktok\.com$/, "tiktok"], [/(^|\.)(x|twitter)\.com$/, "x"]];
export function platformOf(url: string): string | null {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (isYouTubeMusicHost(h)) return null;  // fermé le 2026-10-23 : music.youtube.com n'est pas une plateforme du bot
    return PLATFORM_OF.find(([re]) => re.test(h))?.[1] ?? null;
  } catch { return null; }
}

/** Liens pris en charge d'un message (texte, puis aperçus), sans doublon, 5 au plus. */
export function linksIn(content: string, urls: string[] = []): string[] {
  const found = (content.match(/https:\/\/[^\s<>()"'`|]+/g) ?? []).map((u) => u.replace(/[.,;:!?)\]]+$/, ""));
  const out: string[] = [];
  for (const u of [...found, ...urls]) if (u.length <= 500 && isSupportedLink(u) && !out.includes(u)) out.push(u);
  return out.slice(0, 5);
}

/** Le message (texte ou aperçus) contient-il un lien YouTube Music ? (fermé le 2026-10-23 : jamais converti ni détecté) */
export function hasYouTubeMusicLink(content: string, urls: string[] = []): boolean {
  const found = (content.match(/https:\/\/[^\s<>()"'`|]+/g) ?? []).map((u) => u.replace(/[.,;:!?)\]]+$/, ""));
  return [...found, ...urls].some((u) => u.length <= 500 && isYouTubeMusicLink(u));
}

/** Petit cache borné à durée de vie (métadonnées affichées d'un job, au plus 60 min ; jamais écrit sur disque). */
class Ttl<V> {
  private m = new Map<string, { v: V; t: number }>();
  private ms: number;
  private max: number;
  private now: () => number;
  constructor(ms: number, max: number, now: () => number) { this.ms = ms; this.max = max; this.now = now; }
  get(k: string): V | undefined {
    const e = this.m.get(k);
    if (!e) return undefined;
    if (this.now() - e.t > this.ms) { this.m.delete(k); return undefined; }
    return e.v;
  }
  set(k: string, v: V) {
    this.m.delete(k);
    this.m.set(k, { v, t: this.now() });
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value!);
  }
}

interface JobInfo { meta: MediaMeta; fmt: OutFmt; quality: string | null; title: string | null; sizeBytes: number | null; owner: string; shared?: boolean }

export function createRouter(d: RouterDeps) {
  const now = d.now ?? Date.now;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const b = d.brand;
  const f = d.features;
  const jobs = new Ttl<JobInfo>(60 * 60_000, 2000, now);
  const metas = new Ttl<MediaMeta>(60 * 60_000, 2000, now);
  const guilds = new Ttl<GuildSettings>(5 * 60_000, 1000, now);
  const watchers = new Map<string, { stop(): void }>();
  const lw = d.linkWatch ?? { fastMs: 3000, slowMs: 10_000, fastForMs: 120_000, maxMs: 14 * 60_000 };

  const closed = (label: string, what: string) => simpleCard(b, label, "Pas encore ouvert", what);
  const metaFor = (url: string): MediaMeta => metas.get(url) ?? { url, platform: platformOf(url) };

  /** Réglages effectifs : serveur jamais réglé → partage public PERMIS (ses administrateurs ont installé AETHRYON ;
   *  /config le désactive). Un réglage enregistré l'emporte toujours. */
  const effective = (r: { settings: GuildSettings; stored: boolean }): GuildSettings => (r.stored ? r.settings : { ...r.settings, share: true });
  async function guildSettings(guildId: string | null): Promise<GuildSettings | null> {
    if (!guildId || !d.account || !f.guildConfig) return null;
    const hit = guilds.get(guildId);
    if (hit) return hit;
    try {
      const g = effective(await d.account.guild(guildId));
      guilds.set(guildId, g);
      return g;
    } catch { return null; }
  }
  /** Où l'on est : fourni par l'adaptateur Discord (bot.ts), sinon déduit (serveur installé, ou conversation privée). */
  const whereFor = (ix: Ix): Where => ix.where ?? whereOf({ context: ix.guildId ? 0 : 2, guildId: ix.guildId, userId: ix.user.id, owners: null, memberExternalApps: null, appAttach: null });
  /** Le résultat peut-il être publié ici (v2/context.ts) ? Serveur installé : /config ; installé sur le compte : la
   *  permission « Utiliser des applications externes » ; conversation privée : oui ; message privé avec le bot : sans objet. */
  async function verdict(ix: Ix): Promise<Verdict> {
    const w = whereFor(ix);
    const share = w.place === "guild" && w.guildInstall ? (await guildSettings(ix.guildId))?.share ?? true : null;
    return sharePolicy(w, share, f.files);
  }
  /** Défère la réponse et dit si Discord l'a rendue éphémère (null : inconnu). */
  async function deferAs(ix: Ix, ephemeral: boolean): Promise<boolean | null> {
    const r = (await ix.defer(ephemeral)) as { ephemeral?: boolean | null } | undefined;
    return typeof r?.ephemeral === "boolean" ? r.ephemeral : null;
  }

  async function resolved(userId: string): Promise<Resolved | null> {
    if (!d.account) return null;
    try { return await d.account.resolve(userId, profiles.get(userId)); } catch { return null; }
  }

  /** Compte lié et actif, ou une carte qui l'explique (déjà envoyée par `send`). */
  async function requireLinked(ix: Ix, send: (r: V2Reply) => Promise<unknown>): Promise<Extract<Resolved, { status: "active" }> | null> {
    const r = await resolved(ix.user.id);
    if (!r) { await send(simpleCard(b, "COMPTE", "Compte injoignable", "Connexion à ton compte impossible pour le moment. Réessaie dans quelques secondes.", true)); return null; }
    if (!r.linked) { await send(notLinkedCard(b)); return null; }
    if (r.status === "suspended") { await send(suspendedCard(b)); return null; }
    return r;
  }

  // ---- conversion ----------------------------------------------------------------------------------------

  const render = (meta: MediaMeta, owner: string, fmt: OutFmt): Partial<Render> => ({
    queued: (ff) => progressCard(b, ff, null, null, meta, true),
    running: (ff, p, stage) => progressCard(b, ff, p, stage, meta),
    notLinked: () => notLinkedCard(b),
    error: (code, retryAfterS) => errorCard(b, code, meta, owner, fmt, retryAfterS ?? null, now()),
    windowClosed: () => simpleCard(b, "CONVERSION", "La conversion continue…", "Discord ne permet plus de mettre ce message à jour. Retrouve-la dans ton espace AETHRYON.", false),
  });

  interface StartOpts {
    inPlace: boolean; share: boolean;
    /** Format livré (GIF : fichier dérivé du MP4). */
    out?: OutFmt;
    /** Fichier dérivé à produire par ytapi (compression, GIF) après la conversion, ou à partir de `deriveFrom`. */
    derive?: DeriveParams;
    /** Conversion MP4 terminée du même compte : le fichier dérivé en est tiré, sans unité de quota. */
    deriveFrom?: string;
  }

  async function startConvert(ix: Ix, url: string, params: JobParams, opts: StartOpts) {
    const user = ix.user.id;
    const out: OutFmt = opts.out ?? params.fmt;
    const w = whereFor(ix);
    const send = (card: V2Reply) => (opts.inPlace ? ix.update(card) : ix.reply(card, privateIsEphemeral(w)));
    if (!f.convert || !d.account || !d.ytapi) return send(closed("CONVERSION", "La conversion depuis Discord n'est pas encore ouverte."));
    if (isYouTubeMusicLink(url)) return send(simpleCard(b, "CONVERSION", "YouTube Music non accepté", conversionErrorText("youtube_music_not_accepted"), true));
    if (!isSupportedLink(url)) return send(simpleCard(b, "CONVERSION", "Lien non pris en charge", "Envoie le lien https d'une vidéo YouTube, TikTok ou X.", true));
    const slot = d.flights.start(user);
    if (slot !== "ok") {
      return send(simpleCard(b, "CONVERSION", "Conversion impossible", slot === "busy" ? "Le bot suit déjà beaucoup de conversions : réessaie dans une minute." : "Une conversion est déjà en cours pour ton compte : attends qu'elle se termine (`/status`).", true));
    }
    const meta = metaFor(url);
    // Public ou privé, décidé AVANT de répondre : l'état éphémère d'un message ne change plus ensuite (docs Discord).
    // Public : réponse différée PUBLIQUE, modifiée jusqu'au résultat. Privé : réponse éphémère (ou message normal en
    // message privé avec le bot). Un bouton sur une carte privée (inPlace) reste privé.
    let v: Verdict = { public: false, reason: "files_closed" };
    let publicMode = false;
    let forced = false;
    try {
      v = await verdict(ix);
      publicMode = opts.share && !opts.inPlace && v.public;
      if (opts.inPlace) await ix.deferUpdate();
      else {
        const eph = await deferAs(ix, publicMode ? false : privateIsEphemeral(w));
        // Discord a rendu privée une réponse demandée publique (application du compte sans droit de publier ici).
        if (publicMode && eph === true) { publicMode = false; forced = true; }
      }
    } catch (e) { d.flights.end(user); throw e; }
    const refusal = forced ? REFUSAL_TEXT.external_apps : opts.share && !v.public ? REFUSAL_TEXT[v.reason] : null;
    const limit = attachLimit(ix);
    const account = d.account;
    const clip = typeof params.start === "number" && typeof params.end === "number" ? { start: params.start, end: params.end } : null;
    const deliver = async (job: Job): Promise<AnyReply | null> => {
      const info: JobInfo = { meta, fmt: out, quality: params.quality ?? null, title: job.title ?? null, sizeBytes: job.sizeBytes ?? null, owner: user, shared: publicMode };
      jobs.set(job.id, info);
      if (job.title && !meta.title) metas.set(url, { ...meta, title: job.title });
      let attachment: { name: string; type: string; bytes: Buffer } | null = null;
      const fits = job.sizeBytes !== null && job.sizeBytes !== undefined && job.sizeBytes <= limit;
      let why: string | null = !f.files ? "fichiers_fermes" : job.sizeBytes === null || job.sizeBytes === undefined ? "taille_inconnue" : fits ? null : "trop_lourd";
      if (f.files && fits) {
        const r = await account.file(user, job.id, limit);
        if (r.ok) attachment = { name: safeName(r.name, out), type: r.type, bytes: r.bytes };
        else why = `fichier:${r.error}`;
      }
      let downloadUrl: string | null = null;
      if (!attachment) {
        try { downloadUrl = (await account.download(user, job.id)).url; } catch (e) {
          d.log("warn", "livraison impossible", { raison: why, lien: e instanceof AccountError ? e.code : "erreur" });
          return null;
        }
      }
      d.log("info", "livraison", { jointe: !!attachment, raison: why, taille_mo: job.sizeBytes ? Math.round(job.sizeBytes / MIB * 10) / 10 : null, limite_mo: Math.round(limit / MIB), format: out, public: publicMode });
      // « Ouvrir dans Tools » : seulement sur la carte PRIVÉE d'un MP4/MP3 d'origine (jamais sur un partage public).
      let toolsUrl: string | null = null;
      if (f.tools && !publicMode && !opts.derive && (out === "mp4" || out === "mp3")) {
        try { toolsUrl = (await account.toolsLink(user, job.id)).url; } catch { d.log("warn", "lien Tools indisponible"); }
      }
      const input = {
        meta: metas.get(url) ?? meta, fmt: out, quality: params.quality ?? null, jobId: job.id, owner: user, title: job.title ?? null,
        sizeBytes: job.sizeBytes ?? null, attachment: attachment ? { name: attachment.name, type: attachment.type } : null, downloadUrl,
        tooBigForDiscord: !fits && job.sizeBytes !== null, shareAllowed: v.public && !publicMode, refusal, clip, notes: job.notes ?? [], derived: !!opts.derive,
        toolsUrl,
      };
      const files = attachment ? [{ attachment: attachment.bytes, name: attachment.name }] : undefined;
      if (publicMode) {
        // Public : le fichier joint, l'attribution, le lien d'origine ; jamais de lien personnel ni de quota.
        if (attachment) return { ...sharedCard(b, input, user, f), files };
        // Trop lourd pour être joint ici : la carte publique le dit, et le lien PERSONNEL part en privé. La carte publique
        // est posée d'abord : un suivi envoyé avant toute modification remplacerait la réponse différée (docs Discord).
        const lite = sharedTooBigCard(b, input, user);
        await ix.edit(lite);
        await ix.followUp(resultCard(b, { ...input, shareAllowed: false }, f), true).catch(() => d.log("warn", "lien privé non envoyé"));
        return lite;
      }
      const card = resultCard(b, input, f);
      return files ? { ...card, files } : card;
    };
    const started = now();
    void runConversion(
      { account, ytapi: d.ytapi, siteUrl: b.site, edit: (r) => ix.edit(r), render: render(meta, user, out), deliver, now, sleep, ...d.convert,
        // Discord a refusé la carte finale : secours minimal (texte, bouton-lien), sans pièce jointe ni emoji. En public,
        // jamais de lien personnel : la carte de secours dit seulement que le partage n'a pas abouti.
        fallback: async (job) => {
          if (publicMode) return simpleCard(b, "PARTAGE", "Partage interrompu", "Discord n'a pas accepté le média ici. Relance `/convert` en privé.", true);
          const link = (await account.download(user, job.id)).url;
          return simpleCard(b, "MÉDIA PRÊT", "Ton fichier est prêt", `Télécharge-le par ton lien personnel, utilisable une seule fois pendant 10${NB}minutes.`, false, row(linkButton("Télécharger", link)));
        },
        onEditError: (e) => d.log("warn", "message non modifié", discordError(e)) },
      { discordUserId: user, url, fmt: out, params, startedAt: ix.createdTimestamp, derive: opts.derive, deriveFrom: opts.deriveFrom },
    ).then((o) => d.log("info", "conversion", { resultat: o.outcome, code: o.code ?? null, messages: o.edits, ms: now() - started, format: out,
      outil: opts.derive?.op ?? (clip ? "extrait" : null), plateforme: meta.platform ?? null, reprise_s: o.retryAfterS ?? null,
      visibilite: publicMode ? "public" : "privé", impose: forced || null, lieu: w.place, installation: installLabel(w) }))
      .catch(() => d.log("error", "conversion en échec"))
      .finally(() => d.flights.end(user));
  }

  // ---- aperçu ------------------------------------------------------------------------------------------------

  /** Aperçu privé (POST /preview de ytapi, avec une clé du compte lié rendue aussitôt) : aucune unité de quota.
   *  `soft` (menu « Applications ») : compte non lié ou aperçu impossible → carte de choix ordinaire, jamais un cul-de-sac. */
  async function preview(ix: Ix, url: string, opts: { inPlace: boolean; soft?: boolean; base?: MediaMeta }) {
    const user = ix.user.id;
    const send = (card: V2Reply) => (opts.inPlace ? ix.update(card) : ix.reply(card, true));
    const fallback = (note?: string) => detectCard(b, opts.base ?? metaFor(url), user, f, note ? { note } : {});
    if (!f.preview || !d.account || !d.ytapi?.preview) return send(opts.soft ? fallback() : closed("APERÇU", "L'aperçu n'est pas encore ouvert."));
    if (isYouTubeMusicLink(url)) return send(simpleCard(b, "APERÇU", "YouTube Music non accepté", conversionErrorText("youtube_music_not_accepted"), true));
    if (!isSupportedLink(url)) return send(simpleCard(b, "APERÇU", "Lien non pris en charge", "Envoie le lien https d'une vidéo YouTube, TikTok ou X.", true));
    if (opts.inPlace) await ix.deferUpdate(); else await ix.defer(privateIsEphemeral(whereFor(ix)));
    const r = await resolved(user);
    if (!r || !r.linked || r.status !== "active") {
      if (opts.soft) return ix.edit(fallback(r && !r.linked ? "Lie ton compte AETHRYON pour voir l'aperçu (titre, durée, tailles)." : undefined));
      return ix.edit(!r ? simpleCard(b, "APERÇU", "Compte injoignable", "Connexion à ton compte impossible pour le moment. Réessaie dans quelques secondes.", true) : !r.linked ? notLinkedCard(b) : suspendedCard(b));
    }
    let key: { key: string; keyId: string };
    try { key = await d.account.session(user); } catch (e) {
      const code = e instanceof AccountError ? e.code : "link_unavailable";
      return ix.edit(opts.soft ? fallback(failureText(code)) : simpleCard(b, "APERÇU", "Aperçu impossible", failureText(code), true));
    }
    const started = now();
    try {
      const p = await d.ytapi.preview(key.key, url);
      metas.set(url, { url, platform: p.platform, title: p.title, creator: p.uploader, durationS: p.durationS, thumbnail: p.thumbnail });
      const limit = attachLimit(ix);
      d.log("info", "aperçu", { ok: true, ms: now() - started });
      return await ix.edit(previewCard(b, url, p, user, f, limit));
    } catch (e) {
      const code = e instanceof YtapiError ? e.code : "api_unreachable";
      d.log("info", "aperçu", { ok: false, code, ms: now() - started });
      return ix.edit(fallback(`Aperçu indisponible${NB}: ${failureText(code)}`));
    } finally {
      await d.account.release(user, key.keyId).catch(() => undefined);
    }
  }

  // ---- extraits et GIF ------------------------------------------------------------------------------------------

  async function startClip(ix: Ix, url: string, fmt: "mp3" | "mp4", startRaw: unknown, endRaw: unknown) {
    if (!f.clip) return ix.reply(closed("EXTRAIT", "Les extraits ne sont pas encore ouverts."), true);
    const start = parseTime(startRaw), end = parseTime(endRaw);
    const bad = clipProblem(fmt, start, end);
    if (bad) return ix.reply(simpleCard(b, "EXTRAIT", "Extrait impossible", bad, true), true);
    const { params } = await paramsFor(ix, fmt, null);
    return startConvert(ix, url, { ...params, start, end }, { inPlace: false, share: false });
  }

  async function startGif(ix: Ix, url: string, startRaw: unknown, durationRaw: unknown, fromJob?: string) {
    if (!f.gif) return ix.reply(closed("GIF", "Les GIF ne sont pas encore ouverts."), true);
    const start = String(startRaw ?? "").trim() === "" ? 0 : parseTime(startRaw);
    const dur = durationRaw === null || durationRaw === undefined || String(durationRaw).trim() === "" ? 5 : Number(String(durationRaw).replace(",", "."));
    const bad = gifProblem(start, dur);
    if (bad) return ix.reply(simpleCard(b, "GIF", "GIF impossible", bad, true), true);
    const limit = attachLimit(ix);
    const derive: DeriveParams = { op: "gif", start: start!, duration: dur, maxBytes: Math.max(MIB, fitFor(limit)), width: 480, fps: 15 };
    // Depuis un MP4 déjà converti : fichier dérivé, sans unité de quota ; sinon conversion MP4 720p (une unité), puis GIF.
    return startConvert(ix, url, { fmt: "mp4", quality: "720" }, { inPlace: false, share: false, out: "gif", derive, ...(fromJob ? { deriveFrom: fromJob } : {}) });
  }

  async function paramsFor(ix: Ix, fmtOpt: string | null, qualityOpt: string | null): Promise<{ params: JobParams; share: boolean }> {
    let prefs: { fmt: "mp4" | "mp3"; quality: string; visibility: string } = { fmt: "mp4", quality: "auto", visibility: "private" };
    if (f.library && d.account) {
      try { prefs = await d.account.prefs(ix.user.id); } catch { /* préférences indisponibles : défauts */ }
    }
    const fmt = fmtOpt === "mp3" || fmtOpt === "mp4" ? fmtOpt : prefs.fmt;
    const q = qualityOpt === "720" || qualityOpt === "1080" ? qualityOpt : qualityOpt === "auto" ? null : prefs.quality === "720" || prefs.quality === "1080" ? prefs.quality : null;
    return { params: { fmt, quality: fmt === "mp4" ? (q as "720" | "1080" | null) : null }, share: prefs.visibility === "share" };
  }

  // ---- compte -----------------------------------------------------------------------------------------------

  async function accountLink(ix: Ix, inPlace: boolean) {
    if (!f.link || !d.account) return inPlace ? ix.update(closed("COMPTE", "La liaison de ton compte n'est pas encore ouverte.")) : ix.reply(closed("COMPTE", "La liaison de ton compte n'est pas encore ouverte."), true);
    const r = await resolved(ix.user.id);
    if (r?.linked && r.status === "active") return inPlace ? ix.update(linkedCard(b, r, f)) : ix.reply(linkedCard(b, r, f), true);
    if (inPlace) await ix.update(linkPanel(b)); else await ix.reply(linkPanel(b), true);
    // La page se met à jour seule dès que la liaison est faite sur le site (lecture du compte, bornée dans le temps).
    watchers.get(ix.user.id)?.stop();
    let stopped = false;
    const stop = () => { stopped = true; };
    watchers.set(ix.user.id, { stop });
    const t0 = now();
    void (async () => {
      try {
        while (!stopped) {
          const waited = now() - t0;
          if (waited >= lw.maxMs) { await ix.edit(linkWaitingExpired(b)).catch(() => undefined); return; }
          await sleep(waited < lw.fastForMs ? lw.fastMs : lw.slowMs);
          if (stopped) return;
          const x = await resolved(ix.user.id);
          if (x?.linked && x.status === "active") {
            await ix.edit(linkedCard(b, x, f)).catch(() => undefined);
            d.log("info", "liaison confirmée dans Discord");
            return;
          }
        }
      } finally {
        if (watchers.get(ix.user.id)?.stop === stop) watchers.delete(ix.user.id);
      }
    })();
  }

  async function accountStatus(ix: Ix, inPlace: boolean) {
    if (!f.link || !d.account) return ix.reply(closed("COMPTE", "La liaison de ton compte n'est pas encore ouverte."), true);
    if (!inPlace) await ix.defer(true);
    const send = (r: V2Reply) => (inPlace ? ix.update(r) : ix.edit(r));
    const r = await requireLinked(ix, send);
    if (r) await send(accountCard(b, r, f));
  }

  async function quota(ix: Ix, inPlace: boolean) {
    if (!f.link || !d.account) return ix.reply(closed("QUOTA", "La liaison de ton compte n'est pas encore ouverte."), true);
    if (!inPlace) await ix.defer(true);
    const send = (r: V2Reply) => (inPlace ? ix.update(r) : ix.edit(r));
    const r = await requireLinked(ix, send);
    if (r) await send(quotaCard(b, r.today, r.maxActive));
  }

  async function history(ix: Ix, inPlace: boolean, count: number) {
    if (!f.link || !d.account) return ix.reply(closed("HISTORIQUE", "La liaison de ton compte n'est pas encore ouverte."), true);
    if (!inPlace) await ix.defer(true);
    const send = (r: V2Reply) => (inPlace ? ix.update(r) : ix.edit(r));
    try {
      const h = await d.account.history(ix.user.id, count);
      await send(historyCard(b, h.items, h.today));
    } catch (e) {
      const code = e instanceof AccountError ? e.code : "link_unavailable";
      await send(code === "not_linked" ? notLinkedCard(b) : code === "account_suspended" ? suspendedCard(b) : simpleCard(b, "HISTORIQUE", "Historique indisponible", failureText(code), true));
    }
  }

  // ---- bibliothèque ----------------------------------------------------------------------------------------

  async function saveFromCard(ix: Ix) {
    const url = sourceOf(ix.messageComponents ?? []);
    if (!f.library || !d.account || !url) return ix.reply(simpleCard(b, "BIBLIOTHÈQUE", "Impossible d'enregistrer", url ? "La bibliothèque n'est pas encore ouverte." : "Lien d'origine introuvable sur cette carte.", true), true);
    await ix.defer(true);
    const m = metaFor(url);
    try {
      const r = await d.account.savedAdd(ix.user.id, { url, mediaType: "video", title: m.title ?? null, creator: m.creator ?? null, durationS: m.durationS ?? null });
      await ix.edit(simpleCard(b, "BIBLIOTHÈQUE", r.created ? "☆ Enregistré" : "Déjà enregistré", `${r.created ? "Ajouté à" : "Déjà dans"} ta bibliothèque${r.item.title ? ` : ${r.item.title.slice(0, 80)}` : ""}. Retrouve-le avec \`/saved\`.`, false));
      d.log("info", "enregistrement", { nouveau: r.created });
    } catch (e) {
      const code = e instanceof AccountError ? e.code : "link_unavailable";
      await ix.edit(code === "not_linked" ? notLinkedCard(b) : simpleCard(b, "BIBLIOTHÈQUE", "Non enregistré", code === "saved_limit" ? "Ta bibliothèque est pleine (200 médias) : retires-en d'abord avec `/saved`." : code === "unsupported_link" ? "Ce lien ne peut pas être enregistré." : code === "youtube_music_not_accepted" ? conversionErrorText(code) : "Réessaie dans un instant.", true));
    }
  }

  async function savedList(ix: Ix, offset: number, inPlace: boolean) {
    if (!f.library || !d.account) return ix.reply(closed("BIBLIOTHÈQUE", "La bibliothèque n'est pas encore ouverte."), true);
    if (!inPlace) await ix.defer(true);
    const send = (r: V2Reply) => (inPlace ? ix.update(r) : ix.edit(r));
    const q = inPlace ? null : (ix.option("search") as string | null);
    const platform = inPlace ? null : (ix.option("platform") as string | null);
    const type = inPlace ? null : (ix.option("type") as string | null);
    try {
      const page = await d.account.savedList(ix.user.id, { q, platform, type, offset });
      await send(savedListCard(b, page, offset, ix.user.id, [q, platform, type].filter(Boolean).join(" · ")));
    } catch (e) {
      const code = e instanceof AccountError ? e.code : "link_unavailable";
      await send(code === "not_linked" ? notLinkedCard(b) : simpleCard(b, "BIBLIOTHÈQUE", "Bibliothèque indisponible", "Réessaie dans un instant.", true));
    }
  }

  // ---- réglages de serveur ------------------------------------------------------------------------------------

  async function configOpen(ix: Ix) {
    if (!f.guildConfig || !d.account) return ix.reply(closed("SERVEUR", "Les réglages de serveur ne sont pas encore ouverts."), true);
    if (!ix.guildId) return ix.reply(simpleCard(b, "SERVEUR", "Sur un serveur seulement", "`/config` règle le bot pour un serveur : lance-la depuis un salon du serveur.", true), true);
    if (!ix.canManageGuild) return ix.reply(simpleCard(b, "SERVEUR", "Permission requise", "Il faut la permission « Gérer le serveur » pour modifier ces réglages.", true), true);
    await ix.defer(true);
    try {
      const g = effective(await d.account.guild(ix.guildId));
      guilds.set(ix.guildId, g);
      await ix.edit(configCard(b, g, f));
    } catch {
      await ix.edit(simpleCard(b, "SERVEUR", "Réglages indisponibles", "Réessaie dans un instant.", true));
    }
  }

  async function configChange(ix: Ix, field: string) {
    if (!f.guildConfig || !d.account || !ix.guildId) return ix.update(simpleCard(b, "SERVEUR", "Réglages indisponibles", "Réessaie avec `/config`.", true));
    if (!ix.canManageGuild) return ix.reply(simpleCard(b, "SERVEUR", "Permission requise", "Il faut la permission « Gérer le serveur ».", true), true);
    const cur = guilds.get(ix.guildId) ?? effective(await d.account.guild(ix.guildId));
    const v = ix.values ?? [];
    let patch: Partial<GuildSettings>;
    switch (field) {
      case "auto": patch = { autoEmbeds: !cur.autoEmbeds && f.autoEmbeds }; break;
      case "share": patch = { share: !cur.share }; break;
      case "buttons": patch = { buttons: !cur.buttons }; break;
      case "platforms": patch = { platforms: v.filter((x) => ["youtube", "tiktok", "x"].includes(x)) as GuildSettings["platforms"] }; break;
      case "channels": patch = { channels: v.filter((x) => SNOWFLAKE.test(x)).slice(0, 25) }; break;
      case "quality": patch = { quality: (["auto", "720", "1080"].includes(v[0] ?? "") ? v[0] : "auto") as GuildSettings["quality"] }; break;
      case "perhour": patch = { perHour: Math.min(120, Math.max(1, Number(v[0]) || 30)) }; break;
      case "original": patch = { original: v[0] === "suppress" ? "suppress" : "keep" }; break;
      case "mode": patch = { mode: v[0] === "react" ? "react" : "card" }; break;
      // Valeurs par défaut EFFECTIVES (partage permis : voir guildSettings).
      case "reset": patch = { autoEmbeds: false, platforms: ["youtube", "tiktok", "x"], channels: [], buttons: true, share: true, quality: "auto", perHour: 30, original: "keep", mode: "card" }; break;
      default: return ix.update(configCard(b, cur, f));
    }
    if (field === "platforms" && !patch.platforms?.length) patch = { platforms: cur.platforms };
    try {
      const g = await d.account.setGuild(ix.guildId, patch);
      guilds.set(ix.guildId, g);
      d.log("info", "réglages du serveur modifiés", { champ: field });
      await ix.update(configCard(b, g, f, true));
    } catch {
      await ix.update(simpleCard(b, "SERVEUR", "Non enregistré", "Réessaie dans un instant.", true));
    }
  }

  // ---- répartition ------------------------------------------------------------------------------------------

  async function onCommand(ix: Ix) {
    switch (ix.commandName) {
      case "convert": {
        const url = String(ix.option("url") ?? "").trim();
        const { params, share } = await paramsFor(ix, ix.option("format") as string | null, ix.option("quality") as string | null);
        const vis = ix.option("visibility") as string | null;
        return startConvert(ix, url, params, { inPlace: false, share: vis ? vis === "share" : share });
      }
      case "audio": {
        const url = String(ix.option("url") ?? "").trim();
        const br = Number(ix.option("bitrate"));
        const vis = ix.option("visibility") as string | null;
        const share = vis ? vis === "share" : (await paramsFor(ix, "mp3", null)).share;
        return startConvert(ix, url, { fmt: "mp3", bitrate: br === 128 || br === 320 ? br : 192 }, { inPlace: false, share });
      }
      case "preview": return preview(ix, String(ix.option("url") ?? "").trim(), { inPlace: false });
      case "clip": {
        const fmt = ix.option("format") === "mp3" ? "mp3" : "mp4";
        return startClip(ix, String(ix.option("url") ?? "").trim(), fmt, ix.option("start"), ix.option("end"));
      }
      case "gif": return startGif(ix, String(ix.option("url") ?? "").trim(), ix.option("start"), ix.option("duration"));
      case "account":
        if (ix.subcommand === "link") return accountLink(ix, false);
        if (ix.subcommand === "unlink") {
          if (!f.link || !d.account) return ix.reply(closed("COMPTE", "La liaison de ton compte n'est pas encore ouverte."), true);
          return ix.reply(unlinkConfirm(b), true);
        }
        return accountStatus(ix, false);
      case "quota": return quota(ix, false);
      case "history": return history(ix, false, Math.min(10, Math.max(1, Number(ix.option("count")) || 10)));
      case "status": {
        await ix.defer(true);
        const s = await d.readStatus();
        const ok = (v: "ok" | "down") => (v === "ok" ? "opérationnel" : "indisponible pour le moment");
        const mine = d.flights.has(ix.user.id) ? "Une conversion est en cours pour toi : son message se met à jour tout seul." : "Aucune conversion en cours pour toi.";
        // Pause de plateforme (YouTube qui bloque le serveur) : annoncée avec sa cause et l'heure de reprise.
        const pauses = (s.pauses ?? []).map((p) => {
          const name = platformName(p.platform) ?? p.platform;
          const why = p.reason === "bot_check" ? "la plateforme impose au serveur une vérification anti-robot" : "la plateforme limite le serveur";
          const at = Math.ceil(p.until / 1000);
          return `**${name} : en pause** (${why}) · nouvel essai possible à partir de <t:${at}:t> (<t:${at}:R>)`;
        });
        return ix.edit(simpleCard(b, "ÉTAT", "État d'AETHRYON", `${mine}\nSite et comptes : ${ok(s.site)} · Conversions : ${ok(s.conversion)}${pauses.length ? `\n${pauses.join("\n")}` : ""}${s.maintenance ? `\n> ${s.maintenance.slice(0, 280)}` : ""}${s.quotas ? `\n-# Pendant la bêta : ${s.quotas.daily} conversions par jour et par compte, ${s.quotas.maxActive === 1 ? "une" : s.quotas.maxActive} à la fois.` : ""}`));
      }
      case "help": return ix.reply(helpCard(b, "accueil", f), true);
      case "settings": {
        if (!f.library || !d.account) return ix.reply(closed("RÉGLAGES", "Les préférences ne sont pas encore ouvertes."), true);
        await ix.defer(true);
        try { return await ix.edit(prefsCard(b, await d.account.prefs(ix.user.id))); }
        catch (e) { return ix.edit(e instanceof AccountError && e.code === "not_linked" ? notLinkedCard(b) : simpleCard(b, "RÉGLAGES", "Préférences indisponibles", "Réessaie dans un instant.", true)); }
      }
      case "saved": return savedList(ix, 0, false);
      case "config": return configOpen(ix);
      default:
        return ix.reply(simpleCard(b, "AIDE", "Commande inconnue", "Tape `/help` pour voir ce que le bot sait faire.", true), true);
    }
  }

  async function onMessageMenu(ix: Ix) {
    const t = ix.target ?? { content: "", urls: [], authorId: "" };
    const links = linksIn(t.content, t.urls);
    if (!links.length && hasYouTubeMusicLink(t.content, t.urls)) return ix.reply(simpleCard(b, "MÉDIA", "YouTube Music non accepté", conversionErrorText("youtube_music_not_accepted"), true), true);
    if (!links.length) return ix.reply(simpleCard(b, "MÉDIA", "Aucun lien pris en charge", "Ce message ne contient pas de lien de vidéo YouTube, TikTok ou X.", false), true);
    if (links.length === 1) {
      const url = links[0]!;
      const native = nativeMeta(url, t.embeds ?? []);
      if (native) metas.set(url, { ...metaFor(url), ...native });
      // Aperçu réel (titre, durée, tailles) pour un compte lié ; sinon la carte de choix, avec l'aperçu natif de Discord.
      if (f.preview && d.account && d.ytapi?.preview) return preview(ix, url, { inPlace: false, soft: true });
      return ix.reply(detectCard(b, metaFor(url), ix.user.id, f), true);
    }
    // Plusieurs liens : chacun a son bouton « Source n » ; le menu choisit par numéro (aucun état côté bot).
    const card = simpleCard(b, "MÉDIA", `${links.length} liens trouvés`, links.map((u, i) => `**${i + 1}.** ${platformOf(u) === "x" ? "X" : platformOf(u) === "tiktok" ? "TikTok" : "YouTube"}`).join("\n"), false, {
      type: 1, components: [{ type: 3, custom_id: `ae:pick:${ix.user.id}`, placeholder: "Choisir le lien", min_values: 1, max_values: 1, options: links.map((u, i) => ({ label: `Lien ${i + 1}`, value: String(i), description: u.slice(8, 100) })) }],
    });
    (card.components[0] as { components: unknown[] }).components.push({ type: 1, components: links.map((u, i) => ({ type: 2, style: 5, label: `Source ${i + 1}`, url: u })) });
    return ix.reply(card, true);
  }

  async function onComponent(ix: Ix) {
    const id = ix.customId ?? "";
    const [, action, a1, a2, a3] = id.split(":");
    const ownerOk = (owner: string | undefined) => owner === "*" || owner === ix.user.id;
    const notYours = () => ix.reply(simpleCard(b, "MÉDIA", "Ce bouton n'est pas pour toi", "Utilise `/convert`, ou le menu **Applications › Convertir avec AETHRYON** sur le message.", true), true);
    switch (action) {
      case "help": return ix.update(helpCard(b, ((ix.values?.[0] ?? "accueil") as HelpTopic), f));
      case "acct":
        if (a1 === "link") return accountLink(ix, true);
        if (a1 === "status") return accountStatus(ix, true);
        if (a1 === "quota") return quota(ix, true);
        if (a1 === "unlink") return ix.update(unlinkConfirm(b));
        if (a1 === "unlink-no") return accountStatus(ix, true);
        if (a1 === "unlink-yes") {
          if (!d.account) return ix.update(closed("COMPTE", "La liaison n'est pas ouverte."));
          await ix.deferUpdate();
          try {
            const was = await d.account.unlink(ix.user.id);
            d.log("info", "déliaison depuis Discord", { ok: was });
            return ix.edit(unlinkedCard(b, was));
          } catch { return ix.edit(simpleCard(b, "COMPTE", "Déliaison impossible", "Réessaie dans un instant, ou délie depuis ton espace sur le site.", true)); }
        }
        return;
      case "hist": return history(ix, true, 10);
      case "prefs": {
        if (!f.library || !d.account) return ix.update(closed("RÉGLAGES", "Les préférences ne sont pas encore ouvertes."));
        if (a1 === "open") {
          try { return await ix.update(prefsCard(b, await d.account.prefs(ix.user.id))); }
          catch (e) { return ix.update(e instanceof AccountError && e.code === "not_linked" ? notLinkedCard(b) : simpleCard(b, "RÉGLAGES", "Préférences indisponibles", "Réessaie dans un instant.", true)); }
        }
        const field = a1 as "fmt" | "quality" | "visibility" | "locale";
        if (!["fmt", "quality", "visibility", "locale"].includes(field)) return;
        try { return await ix.update(prefsCard(b, await d.account.setPrefs(ix.user.id, { [field]: ix.values?.[0] } as never), true)); }
        catch { return ix.update(simpleCard(b, "RÉGLAGES", "Non enregistré", "Réessaie dans un instant.", true)); }
      }
      case "cfg": return configChange(ix, a1 ?? "");
      case "conv": {
        if (!ownerOk(a1)) return notYours();
        const url = sourceOf(ix.messageComponents ?? []);
        if (!url) return ix.reply(simpleCard(b, "MÉDIA", "Lien introuvable", "Cette carte ne porte plus son lien d'origine.", true), true);
        const { params } = await paramsFor(ix, a2 ?? null, null);
        // Sur sa propre carte privée, le bouton la transforme sur place ; sur une carte publique, réponse privée à part.
        return startConvert(ix, url, params, { inPlace: a1 === ix.user.id && !!ix.messageEphemeral, share: false });
      }
      case "pick": {
        if (!ownerOk(a1)) return notYours();
        const n = Number(ix.values?.[0]);
        const url = Number.isInteger(n) && n >= 0 && n < 5 ? sourceOf(ix.messageComponents ?? [], `Source ${n + 1}`) : null;
        if (!url) return ix.update(simpleCard(b, "MÉDIA", "Lien introuvable", "Relance le menu sur le message.", true));
        return ix.update(detectCard(b, metaFor(url), ix.user.id, f));
      }
      case "save":
        if (!ownerOk(a1)) return notYours();
        return saveFromCard(ix);
      case "prev": {
        if (!ownerOk(a1)) return notYours();
        const url = sourceOf(ix.messageComponents ?? []);
        if (!url) return ix.reply(simpleCard(b, "APERÇU", "Lien introuvable", "Cette carte ne porte plus son lien d'origine.", true), true);
        return preview(ix, url, { inPlace: a1 === ix.user.id && !!ix.messageEphemeral });
      }
      case "cmp": {
        if (!ownerOk(a1) || a1 === "*") return notYours();
        if (!f.compress) return ix.reply(closed("COMPRESSION", "La compression n'est pas encore ouverte."), true);
        const url = sourceOf(ix.messageComponents ?? []);
        if (!url || !a2) return ix.reply(simpleCard(b, "COMPRESSION", "Lien introuvable", "Cette carte ne porte plus son lien d'origine.", true), true);
        const limit = attachLimit(ix);
        if (fitFor(limit) < MIB) return ix.reply(simpleCard(b, "COMPRESSION", "Limite trop basse", "La limite d'envoi de Discord ici est trop basse pour une vidéo : utilise le lien de téléchargement.", true), true);
        // Nouveau message privé : la carte du résultat (et son lien « Télécharger ») reste là si la compression échoue.
        return startConvert(ix, url, { fmt: "mp4" }, { inPlace: false, share: false, out: "mp4", deriveFrom: a2, derive: { op: "compress", maxBytes: fitFor(limit) } });
      }
      case "clipm":
        if (!ownerOk(a1)) return notYours();
        if (!f.clip || !ix.showModal) return ix.reply(closed("EXTRAIT", "Les extraits ne sont pas encore ouverts."), true);
        return ix.showModal(clipModal(ix.user.id));
      case "gifm":
        if (!ownerOk(a1)) return notYours();
        if (!f.gif || !ix.showModal) return ix.reply(closed("GIF", "Les GIF ne sont pas encore ouverts."), true);
        return ix.showModal(gifModal(ix.user.id, a1 === ix.user.id && a2 ? a2 : undefined));
      case "share": {
        // Partager un résultat privé : une NOUVELLE réponse publique à ce clic (réponse différée publique, puis modifiée
        // avec le fichier). Jamais un suivi juste après une réponse différée : Discord le transforme en modification de
        // la réponse d'origine, qui garde son état éphémère (c'était la panne : le partage restait privé).
        if (!ownerOk(a1) || a1 === "*") return notYours();
        const w = whereFor(ix);
        const info = jobs.get(a2 ?? "");
        if (!info || !d.account) return ix.reply(simpleCard(b, "PARTAGE", "Partage impossible", "Ce résultat a expiré (1 heure) : relance la conversion.", true), true);
        if (info.shared) return ix.reply(simpleCard(b, "PARTAGE", "Déjà partagé", "Ce média est déjà dans la conversation.", false), true);
        const v = await verdict(ix);
        if (!v.public) return ix.reply(simpleCard(b, "PARTAGE", "Partage impossible ici", REFUSAL_TEXT[v.reason], true), true);
        const eph = await deferAs(ix, false);
        if (eph === true) {
          // Discord a imposé une réponse privée : on le dit, sans republier le fichier en privé.
          d.log("info", "partage", { ok: false, impose: true, lieu: w.place, installation: installLabel(w) });
          return ix.edit(simpleCard(b, "PARTAGE", "Partage impossible ici", REFUSAL_TEXT.external_apps, true));
        }
        const limit = attachLimit(ix);
        const r = await d.account.file(ix.user.id, a2!, limit);
        if (!r.ok) {
          d.log("info", "partage", { ok: false, raison: r.error, lieu: w.place, installation: installLabel(w) });
          return ix.edit(simpleCard(b, "PARTAGE", "Partage indisponible", r.error === "too_large" ? "Le fichier dépasse la limite d'envoi de Discord ici." : "Le fichier n'est plus disponible : relance la conversion.", true));
        }
        const name = safeName(r.name, info.fmt);
        const input = { meta: info.meta, fmt: info.fmt, quality: info.quality, jobId: a2!, owner: ix.user.id, title: info.title, sizeBytes: info.sizeBytes, attachment: { name, type: r.type }, shareAllowed: false };
        try {
          const res = (await ix.edit({ ...sharedCard(b, input, ix.user.id, f), files: [{ attachment: r.bytes, name }] })) as { ephemeral?: boolean } | undefined;
          info.shared = true;
          d.log("info", "partage", { ok: true, visible: res?.ephemeral === true ? "privé" : res?.ephemeral === false ? "public" : "inconnu", lieu: w.place, installation: installLabel(w) });
          return;
        } catch (e) {
          d.log("warn", "partage refusé par Discord", discordError(e));
          return ix.edit(simpleCard(b, "PARTAGE", "Partage refusé", "Discord n'a pas accepté le message dans ce salon.", true)).catch(() => undefined);
        }
      }
      case "saved": {
        if (!f.library || !d.account) return ix.update(closed("BIBLIOTHÈQUE", "La bibliothèque n'est pas encore ouverte."));
        if (a1 === "list") return savedList(ix, Math.max(0, Number(a2) || 0), true);
        if (a1 === "open") {
          if (!ownerOk(a2)) return notYours();
          const item = await d.account.savedGet(ix.user.id, ix.values?.[0] ?? "").catch(() => null);
          if (!item) return ix.update(simpleCard(b, "BIBLIOTHÈQUE", "Introuvable", "Ce média n'est plus dans ta bibliothèque.", true));
          metas.set(item.url, { url: item.url, platform: item.platform, title: item.title, creator: item.creator, durationS: item.durationS });
          return ix.update(savedItemCard(b, item, ix.user.id, f));
        }
        if (a1 === "clear") {
          if (!ownerOk(a2) || a2 === "*") return notYours();
          const page = await d.account.savedList(ix.user.id, {}).catch(() => null);
          if (!page) return ix.update(simpleCard(b, "BIBLIOTHÈQUE", "Bibliothèque indisponible", "Réessaie dans un instant.", true));
          return ix.update(page.total ? savedClearConfirm(b, ix.user.id, page.total) : simpleCard(b, "BIBLIOTHÈQUE", "Déjà vide", "Ta bibliothèque ne contient rien.", false));
        }
        if (a1 === "clear-yes") {
          if (!ownerOk(a2) || a2 === "*") return notYours();
          const removed = await d.account.savedClear(ix.user.id).catch(() => null);
          if (removed === null) return ix.update(simpleCard(b, "BIBLIOTHÈQUE", "Rien n'a été effacé", "Réessaie dans un instant.", true));
          d.log("info", "bibliothèque effacée", { nombre: removed });
          return ix.update(simpleCard(b, "BIBLIOTHÈQUE", "Bibliothèque effacée", `${removed} référence${removed > 1 ? "s" : ""} effacée${removed > 1 ? "s" : ""} définitivement.`, false));
        }
        if (a1 === "rm") {
          if (!ownerOk(a2)) return notYours();
          const removed = await d.account.savedRemove(ix.user.id, a3 ?? "").catch(() => false);
          return ix.update(simpleCard(b, "BIBLIOTHÈQUE", removed ? "Retiré" : "Déjà retiré", "Ta bibliothèque est à jour.", false, { type: 1, components: [{ type: 2, style: 2, label: "◀ Bibliothèque", custom_id: "ae:saved:list:0" }] }));
        }
        return;
      }
      default:
        return ix.reply(simpleCard(b, "AETHRYON", "Bouton expiré", "Relance la commande.", true), true);
    }
  }

  /** Modales envoyées (Extrait…, GIF…) : le lien est relu sur la carte qui portait le bouton. */
  async function onModal(ix: Ix) {
    const [, action, owner, jobId] = (ix.customId ?? "").split(":");
    if (owner !== ix.user.id) return ix.reply(simpleCard(b, "MÉDIA", "Ce formulaire n'est pas pour toi", "Relance l'action depuis ta propre carte.", true), true);
    const url = sourceOf(ix.messageComponents ?? []) ?? (jobId ? jobs.get(jobId)?.meta.url ?? null : null);
    if (!url) return ix.reply(simpleCard(b, "MÉDIA", "Lien introuvable", "Cette carte ne porte plus son lien d'origine : relance le menu sur le message.", true), true);
    const v = ix.fields ?? {};
    if (action === "clip") return startClip(ix, url, v.fmt === "mp3" ? "mp3" : "mp4", v.start, v.end);
    if (action === "gif") return startGif(ix, url, v.start, v.duration, jobId && /^[A-Za-z0-9_-]{1,40}$/.test(jobId) ? jobId : undefined);
    return ix.reply(simpleCard(b, "AETHRYON", "Formulaire expiré", "Relance l'action.", true), true);
  }

  /** Données de l'aperçu natif de Discord pour ce lien (titre, auteur, miniature), si Discord l'a déjà calculé. */
  function nativeMeta(url: string, embeds: NativeEmbed[]): Partial<MediaMeta> | null {
    const e = embeds.find((x) => x.url === url) ?? (embeds.length === 1 ? embeds[0] : undefined);
    if (!e || (!e.title && !e.author && !e.thumbnail)) return null;
    return { ...(e.title ? { title: e.title.slice(0, 300) } : {}), ...(e.author ? { creator: e.author.slice(0, 100) } : {}), ...(e.thumbnail?.startsWith("https://") ? { thumbnail: e.thumbnail } : {}) };
  }

  async function onAutocomplete(ix: Ix) {
    if (ix.commandName !== "saved" || !f.library || !d.account || ix.focused?.name !== "search") return ix.respond([]);
    try {
      const page = await d.account.savedList(ix.user.id, { q: ix.focused.value || null });
      return ix.respond(page.items.filter((i) => i.title).slice(0, 25).map((i) => ({ name: i.title!.slice(0, 100), value: i.title!.slice(0, 60) })));
    } catch { return ix.respond([]); }
  }

  /** Point d'entrée : limites, répartition, erreurs (message clair, jamais de détail technique). */
  /** Profil public vu dans la dernière interaction de chaque utilisateur : transmis à account quand le bot le reconnaît
   *  (nom affiché et image dans l'espace › Discord). En mémoire, 1 h. */
  const profiles = new Ttl<{ name: string; display: string | null; avatar: string | null }>(60 * 60_000, 5000, now);
  async function handle(ix: Ix): Promise<void> {
    if (ix.user.username) profiles.set(ix.user.id, { name: ix.user.username, display: ix.user.globalName ?? null, avatar: ix.user.avatar ?? null });
    const started = now();
    try {
      if (ix.kind === "autocomplete") { await onAutocomplete(ix); return; }
      const action = ix.kind === "command" ? ["convert", "audio", "clip", "gif", "preview"].includes(ix.commandName ?? "")
        : ix.kind === "messageMenu" || ix.kind === "modal" || /^ae:(conv|save|share|cmp|prev):/.test(ix.customId ?? "");
      const lim = action ? d.limiter : d.uiLimiter;
      if (!lim.allow(ix.user.id)) {
        await ix.reply(simpleCard(b, "AETHRYON", "Doucement", "Réessaie dans quelques secondes.", true), true);
        d.log("warn", "limite atteinte", { type: ix.kind });
        return;
      }
      if (action && ix.guildId && d.guildLimiter && !d.guildLimiter.allow(ix.guildId)) {
        await ix.reply(simpleCard(b, "AETHRYON", "Serveur très sollicité", "Beaucoup de demandes viennent de ce serveur en ce moment : réessaie dans une minute.", true), true);
        d.log("warn", "limite du serveur atteinte", { type: ix.kind });
        return;
      }
      if (ix.kind === "command") await onCommand(ix);
      else if (ix.kind === "messageMenu") await onMessageMenu(ix);
      else if (ix.kind === "modal") await onModal(ix);
      else await onComponent(ix);
      d.log("info", "interaction", { type: ix.kind, nom: ix.kind === "command" ? ix.commandName ?? null : (ix.customId ?? "").split(":").slice(0, 2).join(":"), ms: now() - started });
    } catch (e) {
      d.log("error", "interaction en échec", { type: ix.kind, erreur: e instanceof Error ? e.name : "inconnue" });
      const card = simpleCard(b, "AETHRYON", "Une erreur est survenue", "Réessaie dans un instant ; si elle se répète, tape `/status`.", true);
      try {
        if (ix.kind === "autocomplete") await ix.respond([]);
        else await ix.edit(card).catch(() => ix.reply(card, true));
      } catch { /* interaction expirée */ }
    }
  }

  return { handle, guildSettings, metas, jobs, watchers };
}

/** Nom de fichier sûr pour Discord (extension attendue, caractères simples, 80 au plus). */
export function safeName(name: string, fmt: OutFmt): string {
  const base = name.replace(/\.[A-Za-z0-9]{2,4}$/, "").normalize("NFKD").replace(/[^\w\s.-]/g, "").replace(/\s+/g, "_").replace(/_+/g, "_").slice(0, 70).replace(/^[._-]+|[._-]+$/g, "");
  return `${base || "aethryon"}.${fmt}`;
}

export { FLAG_EPHEMERAL };

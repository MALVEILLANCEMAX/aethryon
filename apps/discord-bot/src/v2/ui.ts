// Bot v2 (docs/DISCORD-BOT.md §18) : cartes « Components V2 » (JSON de l'API Discord, sans discord.js : testables).
// Identité AETHRYON : liseré champagne (erreurs : rouge du design system), en-tête discret « AETHRYON · … », chouette
// officielle en emoji d'application si elle est configurée (AETHRYON_EMOJI), sinon rien (jamais d'image inventée).
// Règles : seulement des données réelles (ytapi, account) ; textes venus des plateformes (titre, auteur) neutralisés
// (Markdown, mentions) ; aucune mention ne notifie personne (allowed_mentions vide, posé par le routeur) ; tutoiement ;
// espaces insécables avant « : ; ? ! » ; jamais de lien de vidéo, de clé ni de lien de téléchargement journalisé.
import type { GuildSettings, HistoryItem, Prefs, Resolved, SavedItem, SavedPage, Today } from "../account.ts";
import { escapeMarkdown, failureText, type V2Reply } from "../replies.ts";
import type { Preview } from "../ytapi.ts";

/** Format livré : MP4, MP3, ou GIF (fichier dérivé d'un MP4, docs/DISCORD-BOT.md §18). */
export type OutFmt = "mp3" | "mp4" | "gif";
/** Limites de l'outil (identiques à ytapi/app/params.py et GIF_MAX_DURATION_S). */
export const CLIP_MAX_S = { mp4: 180, mp3: 600 } as const;
export const GIF_MAX_S = 30;
export const GIF_DEFAULT_S = 5;

export const FLAG_EPHEMERAL = 64;
export const FLAG_V2 = 1 << 15;
export const ACCENT = 0xd4af7c;       // champagne AETHRYON
export const ACCENT_ERROR = 0xa3372b; // rouge « erreur » du design system
const NB = " ";

/** Fonctions ouvertes (bot.env) : une commande ou un bouton n'apparaît que si la fonction marche vraiment. */
export interface Features {
  link: boolean; convert: boolean; files: boolean; library: boolean; guildConfig: boolean; autoEmbeds: boolean;
  preview: boolean; compress: boolean; clip: boolean; gif: boolean;
  /** Bouton « Ouvrir dans Tools » sur un résultat MP4/MP3 privé (AETHRYON Tools, docs/OUTILS.md). */
  tools?: boolean;
}
export const NO_FEATURES: Features = { link: false, convert: false, files: false, library: false, guildConfig: false, autoEmbeds: false, preview: false, compress: false, clip: false, gif: false, tools: false };

export interface Brand { site: string; emoji: string | null }

// ---- briques ------------------------------------------------------------------------------------------

export const text = (content: string) => ({ type: 10, content: content.slice(0, 3800) });
export const sep = (divider = true, spacing: 1 | 2 = 1) => ({ type: 14, divider, spacing });
export const thumb = (url: string, description?: string) => ({ type: 11, media: { url }, ...(description ? { description: description.slice(0, 1024) } : {}) });
export const section = (texts: string[], accessory: unknown) => ({ type: 9, components: texts.slice(0, 3).map(text), accessory });
export const row = (...components: unknown[]) => ({ type: 1, components: components.filter(Boolean).slice(0, 5) });
/** Emojis de boutons ACCEPTÉS par Discord (vérifiés contre l'API le 2026-10-12 : « ☆ » y est refusé, « Invalid emoji »,
 *  et un seul emoji refusé fait rejeter TOUTE la carte). Un emoji hors de cette liste n'est jamais envoyé. */
export const BUTTON_EMOJIS: ReadonlySet<string> = new Set(["⭐", "✂️"]);
export const button = (style: 1 | 2 | 3 | 4, label: string, customId: string, opts: { emoji?: string; disabled?: boolean } = {}) =>
  ({ type: 2, style, label: label.slice(0, 80), custom_id: customId.slice(0, 100), ...(opts.emoji && BUTTON_EMOJIS.has(opts.emoji) ? { emoji: { name: opts.emoji } } : {}), ...(opts.disabled ? { disabled: true } : {}) });
export const linkButton = (label: string, url: string) => (url.length <= 512 ? { type: 2, style: 5, label: label.slice(0, 80), url } : null);
export const gallery = (items: { url: string; description?: string }[]) =>
  ({ type: 12, items: items.slice(0, 10).map((i) => ({ media: { url: i.url }, ...(i.description ? { description: i.description.slice(0, 1024) } : {}) })) });
export const fileComponent = (name: string) => ({ type: 13, file: { url: `attachment://${name}` } });
export const container = (accent: number, components: unknown[]) => ({ type: 17, accent_color: accent, components: components.filter(Boolean) });
export const select = (customId: string, placeholder: string, options: { label: string; value: string; description?: string; default?: boolean }[], min = 1, max = 1) => ({
  type: 3, custom_id: customId, placeholder: placeholder.slice(0, 150), min_values: min, max_values: Math.min(max, options.length),
  options: options.slice(0, 25).map((o) => ({ label: o.label.slice(0, 100), value: o.value.slice(0, 100), ...(o.description ? { description: o.description.slice(0, 100) } : {}), ...(o.default ? { default: true } : {}) })),
});
export const channelSelect = (customId: string, placeholder: string, defaults: string[]) => ({
  type: 8, custom_id: customId, placeholder, channel_types: [0, 5, 15], min_values: 0, max_values: 25,
  default_values: defaults.slice(0, 25).map((id) => ({ id, type: "channel" })),
});

/** Message V2 (les drapeaux éphémères sont posés par le routeur à la première réponse). */
export const v2 = (components: unknown[], files?: V2Reply["files"]): V2Reply => ({ components, flags: FLAG_V2, ...(files?.length ? { files } : {}), allowedMentions: { parse: [] } });

// ---- textes partagés ------------------------------------------------------------------------------------

const PLATFORM: Record<string, string> = { youtube: "YouTube", tiktok: "TikTok", twitter: "X", x: "X" };
export const platformName = (p: string | null | undefined) => (p ? PLATFORM[p] ?? null : null);
const FMT = { mp3: "MP3", mp4: "MP4", gif: "GIF" } as const;
const head = (b: Brand, label: string) => `-# ${b.emoji ? `${b.emoji} ` : ""}AETHRYON · ${label}`;
/** Texte d'une plateforme (titre, auteur) : une ligne, sans Markdown ni mention, borné. */
export const plain = (v: string | null | undefined, max = 200) => (v ? escapeMarkdown(Array.from(v.replace(/\s+/g, " ").trim()).slice(0, max).join("")) : "");
/** Auteur : « @identifiant » pour un nom d'utilisateur (sans espace), sinon le nom affiché tel quel (« NASA Marshall »). */
export const who = (creator: string | null | undefined, max = 60): string => {
  const name = plain(creator, max);
  return /^[\w.]{1,40}$/.test((creator ?? "").trim()) ? `@${name}` : name;
};
export function duration(s: number | null | undefined): string | null {
  if (typeof s !== "number" || !Number.isFinite(s) || s < 0) return null;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
export function size(bytes: number | null | undefined): string | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}${NB}Ko`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0).replace(".", ",")}${NB}Mo`;
}
/** Barre de progression RÉELLE (10 segments) ; rien si ytapi ne donne pas de chiffre. */
export const bar = (p: number | null) => (p === null ? "" : `${"▰".repeat(Math.round(p / 10))}${"▱".repeat(10 - Math.round(p / 10))} ${Math.round(p)}${NB}%`);
const STAGE: Record<string, string> = {
  starting: "Démarrage", extracting: "Lecture du lien", downloading: "Téléchargement", merging: "Assemblage", converting: "Conversion",
  tagging: "Métadonnées", postprocessing: "Finitions", transcoding: "Encodage H.264", remuxing: "Mise en forme", finalizing: "Finalisation",
  "gif:palette": "Palette du GIF", "gif:encode": "Encodage du GIF", clipping: "Découpe", compressing: "Compression",
};
const parisDateTime = (iso: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const parisDate = (iso: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));

export function quotaLine(t: Today): string {
  if (t.unlimited || t.limit === null) return `${t.used} conversion${t.used > 1 ? "s" : ""} aujourd'hui, sans limite`;
  const left = t.remaining ?? Math.max(0, t.limit - t.used);
  return `${left} conversion${left > 1 ? "s" : ""} restante${left > 1 ? "s" : ""} aujourd'hui (${t.used}/${t.limit})`;
}

// ---- compte ---------------------------------------------------------------------------------------------

export function linkPanel(b: Brand): V2Reply {
  return v2([container(ACCENT, [
    text(head(b, "COMPTE")),
    text(`### Connecte ton compte\nTon quota, ton historique et tes médias enregistrés, sur Discord, l'iPhone et l'extension.`),
    sep(),
    text(`1. Ouvre AETHRYON et connecte-toi (Google).\n2. Choisis **Lier mon compte Discord**, puis autorise sur Discord.\n3. Reviens ici${NB}: ce message se met à jour tout seul.`),
    row(linkButton("Connecter AETHRYON", `${b.site}/dashboard/discord?depuis=discord`)),
    text(`-# AETHRYON ne te demandera jamais de mot de passe ni de jeton dans Discord.`),
  ])]);
}

export function linkedCard(b: Brand, r: Extract<Resolved, { status: "active" }>, f: Features): V2Reply {
  return v2([container(ACCENT, [
    text(head(b, "COMPTE")),
    text(`### ✓ Compte connecté\nTon compte AETHRYON est prêt${NB}: @${escapeMarkdown(r.discord.name)} est relié à ${escapeMarkdown(r.user.email)}.`),
    text(`-# ${quotaLine(r.today)}`),
    row(button(2, "Mon compte", "ae:acct:status"), button(2, "Mon quota", "ae:acct:quota"), f.library ? button(2, "Réglages", "ae:prefs:open") : null),
  ])]);
}

export function linkWaitingExpired(b: Brand): V2Reply {
  return v2([container(ACCENT, [
    text(head(b, "COMPTE")),
    text(`### Liaison non terminée\nCe message ne se met plus à jour. Si tu as terminé sur le site, tape \`/account status\`${NB}; sinon, recommence avec \`/account link\`.`),
  ])]);
}

export function notLinkedCard(b: Brand): V2Reply {
  return v2([container(ACCENT, [
    text(head(b, "COMPTE")),
    text(`### Compte non lié\nRelie ton compte Discord à AETHRYON pour convertir avec ton quota et retrouver ton historique.`),
    row(button(1, "Lier mon compte", "ae:acct:link"), linkButton("Ouvrir AETHRYON", `${b.site}/dashboard/discord?depuis=discord`)),
  ])]);
}

export function accountCard(b: Brand, r: Extract<Resolved, { status: "active" }>, f: Features): V2Reply {
  const who = r.user.name ? `${escapeMarkdown(r.user.name)} · ${escapeMarkdown(r.user.email)}` : escapeMarkdown(r.user.email);
  return v2([container(ACCENT, [
    text(head(b, "COMPTE")),
    section([`### Ton compte AETHRYON`, `${who}\nDiscord${NB}: @${escapeMarkdown(r.discord.name)}, lié le ${parisDate(r.discord.linkedAt)}`], thumb(`${b.site}/brand/aethryon/icons/app-icon-192.png`, "AETHRYON")),
    sep(),
    text(`**Aujourd'hui**${NB}: ${quotaLine(r.today)}.\n${r.maxActive === 1 ? "Une conversion à la fois." : `Jusqu'à ${r.maxActive} conversions à la fois.`} Réinitialisation à minuit (heure de Paris).`),
    row(button(2, "Historique", "ae:hist:open"), f.library ? button(2, "Réglages", "ae:prefs:open") : null, f.library ? button(2, "Bibliothèque", "ae:saved:list:0") : null,
      linkButton("Gérer sur le site", `${b.site}/dashboard/discord`)),
    row(button(4, "Délier ce compte", "ae:acct:unlink")),
    text(`-# Même compte et même quota que le raccourci iPhone et l'extension.`),
  ])]);
}

export function suspendedCard(b: Brand): V2Reply {
  return v2([container(ACCENT_ERROR, [text(head(b, "COMPTE")), text(`### Compte suspendu\nCe compte AETHRYON est suspendu${NB}: le bot ne peut rien faire pour lui.`)])]);
}

export function unlinkConfirm(b: Brand): V2Reply {
  return v2([container(ACCENT_ERROR, [
    text(head(b, "COMPTE")),
    text(`### Délier ton compte Discord${NB}?\nLe bot ne pourra plus convertir pour toi. Ton compte AETHRYON et ton historique restent sur le site. Tes médias enregistrés et tes préférences restent attachés à ton compte (ils figurent dans l'export de tes données)${NB}: pour les effacer, utilise d'abord \`/saved\` › **Tout effacer**.`),
    row(button(4, "Délier", "ae:acct:unlink-yes"), button(2, "Annuler", "ae:acct:unlink-no")),
  ])]);
}

export function unlinkedCard(b: Brand, was: boolean): V2Reply {
  return v2([container(ACCENT, [
    text(head(b, "COMPTE")),
    text(was ? `### Compte délié\nTon compte Discord n'est plus relié à AETHRYON. Tu peux le relier à nouveau à tout moment avec \`/account link\`.` : `### Déjà délié\nCe compte Discord n'était relié à aucun compte AETHRYON.`),
  ])]);
}

export function quotaCard(b: Brand, t: Today, maxActive: number): V2Reply {
  const limited = !t.unlimited && t.limit !== null;
  const left = limited ? t.remaining ?? Math.max(0, t.limit! - t.used) : null;
  return v2([container(ACCENT, [
    text(head(b, "QUOTA")),
    text(limited ? `### ${left} conversion${left! > 1 ? "s" : ""} restante${left! > 1 ? "s" : ""}\n${bar(Math.min(100, (t.used / Math.max(1, t.limit!)) * 100)).replace(/ \d+ %$/, "")} ${t.used}/${t.limit} aujourd'hui${t.bonus ? ` (dont ${t.bonus} en bonus)` : ""}` : `### Sans limite\n${t.used} conversion${t.used > 1 ? "s" : ""} aujourd'hui.`),
    text(`-# Réinitialisation à minuit, heure de Paris · ${maxActive === 1 ? "une conversion à la fois" : `${maxActive} à la fois`} · un échec n'est pas décompté · quota partagé avec l'iPhone et l'extension`),
  ])]);
}

const STATE: Record<string, string> = { done: "✓ Terminée", error: "✗ Échec (non comptée)", running: "… En cours", reserved: "… En attente", refunded: "↺ Annulée (non comptée)" };
export function historyCard(b: Brand, items: HistoryItem[], t: Today): V2Reply {
  const lines = items.slice(0, 10).map((i) => {
    const pf = platformName(i.platform) ?? "Lien";
    const st = STATE[i.state] ?? i.state;
    const err = i.state === "error" && i.errorMessage ? ` — ${plain(i.errorMessage, 90)}` : "";
    return `\`${parisDateTime(i.createdAt)}\` ${pf} · ${(FMT as Record<string, string>)[i.fmt] ?? i.fmt.toUpperCase()} · ${st}${err}`;
  });
  return v2([container(ACCENT, [
    text(head(b, "HISTORIQUE")),
    text(`### Tes dernières conversions\n${lines.length ? lines.join("\n") : "Aucune conversion pour l'instant."}`),
    text(`-# ${quotaLine(t)} · ni le lien ni le titre ne sont conservés`),
    row(linkButton("Tout l'historique", `${b.site}/dashboard/activite`)),
  ])]);
}

// ---- médias ---------------------------------------------------------------------------------------------

export interface MediaMeta { url: string; platform: string | null; title?: string | null; creator?: string | null; durationS?: number | null; thumbnail?: string | null }

/** Lien reconnu (menu « Applications », carte automatique) : choix du format. `owner` = « * » sur une carte publique. */
export function detectCard(b: Brand, m: MediaMeta, owner: string, f: Features, opts: { sharedBy?: string | null; auto?: boolean; buttons?: boolean; note?: string } = {}): V2Reply {
  const pf = platformName(m.platform) ?? "Vidéo";
  const lines = [`### ${m.title ? plain(m.title, 120) : `Vidéo ${pf}`}`];
  const sub = [pf, m.creator ? who(m.creator, 60) : null, duration(m.durationS)].filter(Boolean).join(" · ");
  lines.push(opts.sharedBy ? `${sub}\n-# Lien partagé par <@${opts.sharedBy}>` : sub);
  const body = m.thumbnail ? section(lines, thumb(m.thumbnail, `Miniature ${pf}`)) : text(lines.join("\n"));
  const withButtons = opts.buttons !== false && f.convert;
  const actions = !withButtons ? null : row(
    button(1, "MP4", `ae:conv:${owner}:mp4`), button(2, "MP3", `ae:conv:${owner}:mp3`),
    f.preview ? button(2, "Aperçu", `ae:prev:${owner}`) : null,
    f.library ? button(2, "Enregistrer", `ae:save:${owner}`, { emoji: "⭐" }) : null,
    linkButton("Source", m.url),
  );
  const tools = withButtons && (f.clip || f.gif) ? row(
    f.clip ? button(2, "Extrait…", `ae:clipm:${owner}`, { emoji: "✂️" }) : null,
    f.gif ? button(2, "GIF…", `ae:gifm:${owner}`) : null,
  ) : null;
  return v2([container(ACCENT, [
    text(head(b, opts.auto ? `LIEN ${pf.toUpperCase()}` : "MÉDIA")),
    body,
    actions ?? row(linkButton("Source", m.url)),
    tools,
    opts.note ? text(`-# ${opts.note}`) : null,
    opts.auto ? text(`-# Chaque bouton agit avec le compte de la personne qui clique, en privé.`) : null,
  ])]);
}

/** Aperçu PRIVÉ (POST /preview de ytapi) : seulement ce que la plateforme a fourni, tailles marquées « ≈ » (estimations
 *  de la plateforme, la taille réelle s'affiche à la fin) ; seuls les formats possibles pour CE média ont un bouton. */
export function previewCard(b: Brand, url: string, p: Preview, owner: string, f: Features, limitBytes: number): V2Reply {
  const pf = platformName(p.platform) ?? "Vidéo";
  const title = plain(p.title, 120) || `Vidéo ${pf}`;
  const sub = [pf, p.uploader ? who(p.uploader, 60) : null, duration(p.durationS), p.isGif ? "GIF animé" : null].filter(Boolean).join(" · ");
  const blocked = p.live ? "Direct ou première : pas de conversion possible." : p.limits.tooLong ? "Trop long pour le service (une heure au plus)." : null;
  // Une ligne de tailles (estimées par la plateforme), au lieu d'un paragraphe.
  const sizes: string[] = [];
  if (!blocked) {
    const q = p.qualities.find((x) => x.quality !== null && x.quality <= 1080 && x.h264) ?? p.qualities.find((x) => x.quality !== null && x.quality <= 1080) ?? p.qualities[0];
    if (q?.estSizeBytes) sizes.push(`MP4${NB}≈${NB}${size(q.estSizeBytes)}${q.estSizeBytes > limitBytes ? ` (au-delà de la limite d'envoi ici${NB}: lien${f.compress ? " ou compression" : ""})` : ""}`);
    if (p.audioAvailable === false) sizes.push(p.isGif ? "MP3 impossible (vidéo muette)" : "MP3 impossible (pas de son)");
    else if (p.mp3Bytes[192]) sizes.push(`MP3${NB}≈${NB}${size(p.mp3Bytes[192])}`);
    if (p.mediaCount > 1) sizes.push(`${p.mediaCount} médias${NB}: le premier`);
  }
  const canConvert = f.convert && !blocked;
  return v2([container(blocked ? ACCENT_ERROR : ACCENT, [
    text(head(b, "APERÇU")),
    p.thumbnail ? gallery([{ url: p.thumbnail, description: `Miniature ${pf}` }]) : null,
    text(`### ${title}\n-# ${sub}`),
    blocked ? text(blocked) : sizes.length ? text(`-# ${sizes.join(" · ")}`) : null,
    canConvert ? row(
      button(1, "MP4", `ae:conv:${owner}:mp4`), p.audioAvailable !== false ? button(2, "MP3", `ae:conv:${owner}:mp3`) : null,
      f.clip ? button(2, "Extrait…", `ae:clipm:${owner}`, { emoji: "✂️" }) : null, f.gif ? button(2, "GIF…", `ae:gifm:${owner}`) : null,
    ) : null,
    row(f.library ? button(2, "Enregistrer", `ae:save:${owner}`, { emoji: "⭐" }) : null, linkButton("Source", url)),
  ])]);
}

/** Modale « Extrait » : début, fin, format (composants Label des modales Discord). */
export function clipModal(owner: string, fmt: "mp4" | "mp3" = "mp4"): Record<string, unknown> {
  return {
    custom_id: `ae:clip:${owner}`, title: "Extrait",
    components: [
      { type: 18, label: "Début", description: "En secondes (75) ou minutes:secondes (1:15)", component: { type: 4, custom_id: "start", style: 1, min_length: 1, max_length: 12, placeholder: "0:15", required: true } },
      { type: 18, label: "Fin", description: `${CLIP_MAX_S.mp4 / 60} min au plus en MP4, ${CLIP_MAX_S.mp3 / 60} min en MP3`, component: { type: 4, custom_id: "end", style: 1, min_length: 1, max_length: 12, placeholder: "0:45", required: true } },
      { type: 18, label: "Format", component: { type: 3, custom_id: "fmt", min_values: 1, max_values: 1, required: true, options: [
        { label: "MP4 (vidéo H.264)", value: "mp4", default: fmt === "mp4" }, { label: "MP3 (son)", value: "mp3", default: fmt === "mp3" }] } },
    ],
  };
}

/** Modale « GIF » : début et durée ; `jobId` : GIF tiré d'un MP4 déjà converti (aucune unité de quota en plus). */
export function gifModal(owner: string, jobId?: string): Record<string, unknown> {
  return {
    custom_id: `ae:gif:${owner}${jobId ? `:${jobId}` : ""}`, title: "GIF animé",
    components: [
      { type: 18, label: "Début", description: "En secondes (75) ou minutes:secondes (1:15)", component: { type: 4, custom_id: "start", style: 1, min_length: 1, max_length: 12, value: "0:00", required: true } },
      { type: 18, label: "Durée (secondes)", description: `De 1 à ${GIF_MAX_S}${NB}s ; un GIF court reste net et léger`, component: { type: 4, custom_id: "duration", style: 1, min_length: 1, max_length: 5, value: String(GIF_DEFAULT_S), required: true } },
    ],
  };
}

export function progressCard(b: Brand, fmt: OutFmt, p: number | null, stage: string | null, m: MediaMeta | null, queued = false): V2Reply {
  const pf = platformName(m?.platform ?? null);
  return v2([container(ACCENT, [
    text(head(b, "CONVERSION")),
    text(`### ${queued ? "En file d'attente" : `${STAGE[stage ?? ""] ?? "Conversion"}…`}\n${[pf, FMT[fmt]].filter(Boolean).join(" · ")}${p !== null ? `\n${bar(p)}` : ""}`),
    text(`-# Ce message se met à jour tout seul. Il n'est visible que par toi.`),
  ])]);
}

export interface ResultInput {
  meta: MediaMeta; fmt: OutFmt; quality?: string | null; jobId: string; owner: string; clip?: { start: number; end: number } | null;
  /** Fichier compressé pour Discord (note de ytapi, ex. « Image réduite à 540p… ») : la perte de qualité est dite. */
  notes?: string[];
  /** Fichier dérivé (compression, GIF) : on n'en tire pas d'autre fichier (ytapi le refuserait). */
  derived?: boolean;
  title: string | null; sizeBytes: number | null; attachment?: { name: string; type: string } | null;
  downloadUrl?: string | null; tooBigForDiscord?: boolean; shareAllowed: boolean;
  /** Partage public demandé mais impossible ici : pourquoi, et quoi faire à la place (v2/context.ts). */
  refusal?: string | null;
  /** Lien « Ouvrir dans AETHRYON Tools » (55 min, valable seulement pour le compte lié une fois connecté au site). */
  toolsUrl?: string | null;
}

/** Média joint, en premier sur la carte : la vidéo (galerie) ou le fichier (MP3, ou vidéo d'un autre type). */
function mediaOf(r: ResultInput, title: string): unknown {
  const a = r.attachment!;
  const playable = (r.fmt === "mp4" && /^video\//.test(a.type)) || (r.fmt === "gif" && a.type === "image/gif");
  return playable ? gallery([{ url: `attachment://${a.name}`, description: title.slice(0, 200) }]) : fileComponent(a.name);
}

/** Résultat PRIVÉ : le média d'abord, un titre, une ligne, puis deux ou trois actions (Partager ici quand c'est permis).
 *  Fichier joint s'il tient dans la limite de la conversation, sinon lien personnel (10 min, usage unique). */
export function resultCard(b: Brand, r: ResultInput, f: Features): V2Reply {
  const pf = platformName(r.meta.platform);
  const title = plain(r.title ?? r.meta.title ?? null, 120) || `Fichier ${FMT[r.fmt]}`;
  const span = r.clip ? `extrait ${duration(r.clip.start)}–${duration(r.clip.end)}` : duration(r.meta.durationS);
  const facts = [pf, span, FMT[r.fmt], r.fmt === "mp4" && r.quality ? `≤${NB}${r.quality}p` : null, size(r.sizeBytes)].filter(Boolean).join(" · ");
  const comps: unknown[] = [text(head(b, "MÉDIA PRÊT"))];
  if (r.attachment) comps.push(mediaOf(r, title));
  comps.push(r.meta.thumbnail && !r.attachment ? section([`### ${title}`, `-# ${facts}`], thumb(r.meta.thumbnail, "Miniature")) : text(`### ${title}\n-# ${facts}`));
  if (r.notes?.length) comps.push(text(r.notes.slice(0, 2).map((n) => `-# ${plain(n, 160)}`).join("\n")));
  if (!r.attachment) comps.push(text(r.tooBigForDiscord
    ? `Trop lourd pour Discord ici${r.sizeBytes ? ` (${size(r.sizeBytes)})` : ""}${NB}: ton lien personnel, valable 10${NB}minutes, une fois.`
    : `Ton lien personnel, valable 10${NB}minutes, une fois${NB}: ne le partage pas.`));
  if (r.refusal) comps.push(text(`-# ${r.refusal}`));
  const gifHere = f.gif && r.fmt === "mp4" && !r.derived && !!r.attachment;
  comps.push(row(
    r.attachment && r.shareAllowed ? button(1, "Partager ici", `ae:share:${r.owner}:${r.jobId}`) : null,
    r.downloadUrl ? linkButton("Télécharger", r.downloadUrl) : null,
    f.compress && r.tooBigForDiscord && r.fmt === "mp4" && !r.derived ? button(2, "Compresser pour Discord", `ae:cmp:${r.owner}:${r.jobId}`) : null,
    f.library ? button(2, "Enregistrer", `ae:save:${r.owner}`, { emoji: "⭐" }) : null,
    gifHere ? button(2, "Faire un GIF…", `ae:gifm:${r.owner}:${r.jobId}`) : null,
    f.tools && r.toolsUrl ? linkButton("Ouvrir dans Tools", r.toolsUrl) : null,
    linkButton("Source", r.meta.url),
  ));
  return v2([container(ACCENT, comps)]);
}

/** Version PUBLIQUE : le média, son titre, une ligne (plateforme, format, qui l'a partagé), et de quoi le récupérer pour
 *  soi. Aucune donnée de compte, aucun quota, aucun lien personnel. */
export function sharedCard(b: Brand, r: ResultInput, by: string, f: Features): V2Reply {
  const pf = platformName(r.meta.platform);
  const title = plain(r.title ?? r.meta.title ?? null, 120) || `Vidéo ${pf ?? ""}`.trim();
  const line = [`${b.emoji ? `${b.emoji} ` : ""}AETHRYON`, pf, duration(r.meta.durationS), FMT[r.fmt], `partagé par <@${by}>`].filter(Boolean).join(" · ");
  const comps: unknown[] = [];
  if (r.attachment) comps.push(mediaOf(r, title));
  comps.push(text(`### ${title}\n-# ${line}`));
  comps.push(row(f.convert ? button(2, "MP4 pour moi", `ae:conv:*:mp4`) : null, f.convert ? button(2, "MP3 pour moi", `ae:conv:*:mp3`) : null, linkButton("Source", r.meta.url)));
  return v2([container(ACCENT, comps)]);
}

/** Version PUBLIQUE quand le fichier est trop lourd pour être joint ici : le dire, sans aucun lien personnel (il part
 *  en privé à la personne qui a lancé la conversion). */
export function sharedTooBigCard(b: Brand, r: ResultInput, by: string): V2Reply {
  const title = plain(r.title ?? r.meta.title ?? null, 120) || `Fichier ${FMT[r.fmt]}`;
  return v2([container(ACCENT, [
    text(`### ${title}\n-# ${b.emoji ? `${b.emoji} ` : ""}AETHRYON · ${FMT[r.fmt]} · trop lourd pour être joint ici${r.sizeBytes ? ` (${size(r.sizeBytes)})` : ""}${NB}: <@${by}> l'a reçu en privé`),
    row(linkButton("Source", r.meta.url)),
  ])]);
}

const RETRYABLE: ReadonlySet<string> = new Set(["api_unreachable", "upstream_timeout_api", "rate_limited", "server_busy", "auth_unavailable", "upstream_error", "network_error", "download_failed", "conversion_failed", "upstream_timeout", "platform_rate_limited", "link_not_created", "download_unavailable", "bot_check", "upstream_rate_limited"]);
/** Pauses imposées par la plateforme (docs/ERREURS.md) : ytapi ne la contacte plus pendant la pause et refuse aussitôt
 *  une nouvelle demande (sans quota) ; la première demande après la pause est acceptée. */
const PLATFORM_PAUSE: ReadonlySet<string> = new Set(["bot_check", "upstream_rate_limited"]);

/** Cause constatée, en clair : quelle plateforme, ce qui n'est PAS en cause, quand réessayer (heure locale de Discord). */
function pauseText(code: string, platform: string | null, retryAfterS: number | null, nowMs: number): string {
  const pf = platformName(platform) ?? "La plateforme";
  const lines = [code === "bot_check"
    ? `${pf} impose au serveur AETHRYON une vérification anti-robot et bloque ses demandes pour le moment.`
    : `${pf} limite pour le moment le nombre de demandes du serveur AETHRYON.`];
  lines.push("Ni ta vidéo ni ton compte ne sont en cause, et cet échec n'est pas décompté de ton quota.");
  if (platform === "youtube") lines.push("Les liens TikTok et X ne sont pas concernés par cette pause.");
  if (retryAfterS && retryAfterS > 0) {
    const at = Math.ceil((nowMs + retryAfterS * 1000) / 1000);
    lines.push(`**Nouvel essai possible à partir de <t:${at}:t>** (<t:${at}:R>).`);
  } else lines.push("Réessaie un peu plus tard.");
  return lines.join("\n");
}

export function errorCard(b: Brand, code: string, m: MediaMeta | null, owner: string, fmt: OutFmt | null,
  retryAfterS: number | null = null, nowMs = Date.now()): V2Reply {
  const retry = m && fmt && fmt !== "gif" && RETRYABLE.has(code);
  const pause = PLATFORM_PAUSE.has(code);
  const title = pause ? `${platformName(m?.platform) ?? "Plateforme"} indisponible pour le moment` : "Conversion impossible";
  return v2([container(ACCENT_ERROR, [
    text(head(b, "ÉCHEC")),
    text(`### ${title}\n${pause ? pauseText(code, m?.platform ?? null, retryAfterS, nowMs) : failureText(code)}`),
    row(retry ? button(2, "Réessayer", `ae:conv:${owner}:${fmt}`) : null, linkButton("Aide", `${b.site}/aide`), m ? linkButton("Source", m.url) : null),
    text(`-# Code${NB}: ${code}${retry ? " · une nouvelle tentative n'est décomptée de ton quota que si elle réussit" : ""}`),
  ])]);
}

export function simpleCard(b: Brand, label: string, title: string, body: string, error = false, extra?: unknown): V2Reply {
  return v2([container(error ? ACCENT_ERROR : ACCENT, [text(head(b, label)), text(`### ${title}\n${body}`), extra ?? null])]);
}

// ---- aide ---------------------------------------------------------------------------------------------------

export type HelpTopic = "accueil" | "convertir" | "menu" | "compte" | "bibliotheque" | "serveur" | "confidentialite";
export function helpCard(b: Brand, topic: HelpTopic, f: Features): V2Reply {
  const pages: Record<HelpTopic, string> = {
    accueil: `### AETHRYON sur Discord\nConvertis une vidéo YouTube, TikTok ou X en MP4 ou en MP3, avec ton compte AETHRYON${NB}: même quota et même historique que l'iPhone et l'extension. Les réponses sont privées, sauf si tu choisis de partager.\n\n${f.convert ? "• `/convert` un lien, un format\n• Clic droit sur un message › **Applications › Convertir avec AETHRYON**\n" : ""}${f.preview ? "• `/preview` voir titre, durée et tailles avant de convertir\n" : ""}${f.clip || f.gif ? `• ${[f.clip ? "`/clip` un extrait" : null, f.gif ? "`/gif` un GIF animé" : null].filter(Boolean).join(", ")}\n` : ""}${f.link ? "• `/account link` pour relier ton compte\n• `/quota`, `/history`\n" : ""}${f.library ? "• `/saved` ta bibliothèque, `/settings` tes préférences\n" : ""}${f.guildConfig ? "• `/config` pour les administrateurs du serveur\n" : ""}• \`/status\` l'état du service`,
    convertir: `### Convertir\n\`/convert\` avec le lien d'une vidéo (YouTube, TikTok ou X) et un format${NB}: **MP4** (vidéo, qualité automatique, 1080p ou 720p au plus) ou **MP3** (son). \`/audio\` va droit au MP3.\n\nUn seul message, visible de toi seul, suit la conversion jusqu'au fichier${NB}: ${f.files ? "joint directement s'il tient dans la limite de Discord, sinon par un lien personnel (10 minutes, usage unique)." : "par un lien personnel (10 minutes, usage unique)."}${f.compress ? " Trop lourd pour Discord${NB}? **Compresser pour Discord** refait la vidéo plus légère (image plus petite, toujours signalée), sans compter dans ton quota." : ""}${f.clip ? `\n\n\`/clip\`${NB}: un extrait, du début à la fin choisis (MP4${NB}: 3${NB}min au plus, MP3${NB}: 10${NB}min) ; une conversion.` : ""}${f.gif ? `\n\`/gif\`${NB}: un GIF animé de 1 à ${GIF_MAX_S}${NB}s ; une conversion, ou aucune s'il vient d'un MP4 déjà converti (bouton **Faire un GIF…**).` : ""}`,
    menu: `### Depuis un message\nFais un clic droit sur un message (appui long sur mobile) › **Applications › Convertir avec AETHRYON**. Le bot trouve le lien dans le message et te propose MP4 ou MP3, sans copier-coller.`,
    compte: `### Ton compte\n\`/account link\` ouvre AETHRYON pour relier ton compte Discord (connexion Google, puis autorisation sur Discord). \`/account status\` affiche ton compte et ton quota, \`/account unlink\` le délie. Jamais de mot de passe ni de jeton dans Discord.`,
    bibliotheque: f.library ? `### Bibliothèque\n**Enregistrer** garde une référence (lien, titre, auteur), jamais le fichier. Retrouve-la avec \`/saved\` (recherche, plateforme, type), reconvertis-la ou retire-la. \`/settings\`${NB}: format, qualité et visibilité par défaut.` : `### Bibliothèque\nBientôt.`,
    serveur: f.guildConfig ? `### Sur un serveur\n\`/config\` (permission « Gérer le serveur »)${NB}: cartes automatiques sous les liens publiés${f.autoEmbeds ? "" : " (pas encore activées pour ce bot)"}, plateformes, salons, partage public, qualité, limite par heure, aperçu natif du message d'origine. Le message d'origine n'est jamais supprimé.` : `### Sur un serveur\nLes réglages de serveur arrivent bientôt.`,
    confidentialite: `### Confidentialité\nLe bot ne lit pas les salons${f.autoEmbeds ? " (sauf si un administrateur active les cartes automatiques : il cherche alors seulement les liens pris en charge)" : ""}. Il ne conserve ni le lien ni le titre d'une conversion${f.library ? ", sauf ce que tu enregistres toi-même" : ""}. Détails${NB}: ${b.site}/confidentialite`,
  };
  const opts: { label: string; value: HelpTopic; description: string }[] = [
    { label: "Accueil", value: "accueil", description: "Ce que fait le bot" },
    { label: "Convertir", value: "convertir", description: f.clip || f.gif ? "/convert, /audio, extraits, GIF, fichiers" : "/convert, /audio, formats, fichiers" },
    { label: "Depuis un message", value: "menu", description: "Applications › Convertir avec AETHRYON" },
    { label: "Compte", value: "compte", description: "Lier, voir, délier" },
    { label: "Bibliothèque", value: "bibliotheque", description: "Enregistrer, /saved, /settings" },
    { label: "Serveur", value: "serveur", description: "/config pour les administrateurs" },
    { label: "Confidentialité", value: "confidentialite", description: "Ce qui est lu et conservé" },
  ];
  return v2([container(ACCENT, [
    text(head(b, "AIDE")),
    text(pages[topic]),
    row(select("ae:help", "Choisir un sujet", opts.map((o) => ({ ...o, default: o.value === topic })))),
    row(linkButton("Site", b.site), linkButton("Aide", `${b.site}/aide`), linkButton("Confidentialité", `${b.site}/confidentialite`)),
  ])]);
}

// ---- préférences ---------------------------------------------------------------------------------------------

export function prefsCard(b: Brand, p: Prefs, saved = false): V2Reply {
  return v2([container(ACCENT, [
    text(head(b, "RÉGLAGES")),
    text(`### Tes préférences\nUtilisées quand tu ne précises rien${NB}: \`/convert\`, menu « Applications », cartes.${saved ? "\n-# ✓ Enregistré" : ""}`),
    row(select("ae:prefs:fmt", "Format par défaut", [{ label: "MP4 (vidéo)", value: "mp4", default: p.fmt === "mp4" }, { label: "MP3 (son)", value: "mp3", default: p.fmt === "mp3" }])),
    row(select("ae:prefs:quality", "Qualité vidéo", [{ label: "Automatique (la meilleure)", value: "auto", default: p.quality === "auto" }, { label: "1080p au plus", value: "1080", default: p.quality === "1080" }, { label: "720p au plus (plus léger)", value: "720", default: p.quality === "720" }])),
    row(select("ae:prefs:visibility", "Visibilité du résultat", [{ label: "Privé (visible de moi seul)", value: "private", default: p.visibility === "private" }, { label: "Proposer le partage dans le salon", value: "share", default: p.visibility === "share" }])),
    row(select("ae:prefs:locale", "Langue", [{ label: "Automatique (français)", value: "auto", default: p.locale === "auto" }, { label: "Français", value: "fr", default: p.locale === "fr" }, { label: "English (bientôt, en français pour l'instant)", value: "en", default: p.locale === "en" }])),
    text(`-# Préférences de ton compte AETHRYON, effaçables avec le compte.`),
  ])]);
}

// ---- réglages de serveur ---------------------------------------------------------------------------------------

export function configCard(b: Brand, g: GuildSettings, f: Features, saved = false): V2Reply {
  const onOff = (v: boolean) => (v ? "Activé" : "Désactivé");
  return v2([container(ACCENT, [
    text(head(b, "SERVEUR")),
    text(`### Réglages du serveur\nCartes automatiques${NB}: **${onOff(g.autoEmbeds)}**${f.autoEmbeds ? "" : " · *non disponibles pour ce bot (accès au contenu des messages non activé)*"} · Partage public des résultats${NB}: **${onOff(g.share)}** · Boutons de conversion${NB}: **${onOff(g.buttons)}**${saved ? "\n-# ✓ Enregistré" : ""}`),
    row(button(g.autoEmbeds ? 1 : 2, `Cartes automatiques : ${g.autoEmbeds ? "oui" : "non"}`, "ae:cfg:auto", { disabled: !f.autoEmbeds && !g.autoEmbeds }),
      button(g.share ? 1 : 2, `Partage public : ${g.share ? "oui" : "non"}`, "ae:cfg:share"), button(g.buttons ? 1 : 2, `Boutons : ${g.buttons ? "oui" : "non"}`, "ae:cfg:buttons")),
    row(select("ae:cfg:platforms", "Plateformes des cartes", [{ label: "YouTube", value: "youtube", default: g.platforms.includes("youtube") }, { label: "TikTok", value: "tiktok", default: g.platforms.includes("tiktok") }, { label: "X", value: "x", default: g.platforms.includes("x") }], 1, 3)),
    row(channelSelect("ae:cfg:channels", g.channels.length ? "Salons autorisés" : "Tous les salons (choisir pour restreindre)", g.channels)),
    row(select("ae:cfg:quality", "Qualité proposée", [{ label: "Automatique", value: "auto", default: g.quality === "auto" }, { label: "1080p au plus", value: "1080", default: g.quality === "1080" }, { label: "720p au plus", value: "720", default: g.quality === "720" }])),
    row(select("ae:cfg:perhour", "Cartes automatiques par heure", [5, 10, 30, 60, 120].map((n) => ({ label: `${n} par heure au plus`, value: String(n), default: g.perHour === n })))),
    row(select("ae:cfg:original", "Message d'origine", [{ label: "Le laisser tel quel", value: "keep", default: g.original === "keep" }, { label: "Masquer son aperçu natif (« Gérer les messages » requis)", value: "suppress", default: g.original === "suppress" }]),
    ),
    row(select("ae:cfg:mode", "Réponse à un lien", [{ label: "Carte avec boutons", value: "card", default: g.mode === "card" }, { label: "Réaction 🦉 seulement (menu Applications)", value: "react", default: g.mode === "react" }])),
    row(button(2, "Réglages par défaut", "ae:cfg:reset")),
    text(`-# Visible seulement par toi · le message d'origine n'est jamais supprimé · aucune donnée personnelle n'est enregistrée avec ces réglages`),
  ])]);
}

// ---- bibliothèque ---------------------------------------------------------------------------------------------

export function savedListCard(b: Brand, page: SavedPage, offset: number, owner: string, filter: string): V2Reply {
  const items = page.items.slice(0, 10);
  const lines = items.map((i, n) => `**${offset + n + 1}.** ${plain(i.title, 70) || `Vidéo ${platformName(i.platform)}`} — ${[platformName(i.platform), i.creator ? who(i.creator, 30) : null, duration(i.durationS), i.mediaType === "audio" ? "son" : null].filter(Boolean).join(" · ")}`);
  const prev = offset > 0, next = offset + items.length < page.total;
  return v2([container(ACCENT, [
    text(head(b, "BIBLIOTHÈQUE")),
    text(`### Tes médias enregistrés${filter ? ` · ${plain(filter, 40)}` : ""}\n${lines.length ? lines.join("\n") : "Rien pour l'instant. Utilise le bouton **Enregistrer** d'une carte."}`),
    items.length ? row(select(`ae:saved:open:${owner}`, "Ouvrir un média", items.map((i, n) => ({ label: `${offset + n + 1}. ${(i.title ?? `Vidéo ${platformName(i.platform)}`).slice(0, 90)}`, value: i.id, description: [platformName(i.platform), i.creator].filter(Boolean).join(" · ").slice(0, 100) || undefined })))) : null,
    prev || next ? row(button(2, "◀ Précédents", `ae:saved:list:${Math.max(0, offset - 10)}`, { disabled: !prev }), button(2, "Suivants ▶", `ae:saved:list:${offset + 10}`, { disabled: !next })) : null,
    page.total ? row(button(4, "Tout effacer…", `ae:saved:clear:${owner}`)) : null,
    text(`-# ${page.total}/${page.max} · des références (lien, titre, auteur), jamais de fichier · visible de toi seul · gardées avec ton compte jusqu'à ce que tu les retires`),
  ])]);
}

export function savedClearConfirm(b: Brand, owner: string, total: number): V2Reply {
  return v2([container(ACCENT_ERROR, [
    text(head(b, "BIBLIOTHÈQUE")),
    text(`### Tout effacer${NB}?\nLes ${total} référence${total > 1 ? "s" : ""} de ta bibliothèque ser${total > 1 ? "ont" : "a"} effacée${total > 1 ? "s" : ""} définitivement. Tes conversions et ton historique ne changent pas.`),
    row(button(4, "Tout effacer", `ae:saved:clear-yes:${owner}`), button(2, "Annuler", "ae:saved:list:0")),
  ])]);
}

export function savedItemCard(b: Brand, i: SavedItem, owner: string, f: Features): V2Reply {
  const pf = platformName(i.platform) ?? "Vidéo";
  return v2([container(ACCENT, [
    text(head(b, "BIBLIOTHÈQUE")),
    text(`### ${plain(i.title, 120) || `Vidéo ${pf}`}\n${[pf, i.creator ? who(i.creator, 60) : null, duration(i.durationS), i.mediaType === "audio" ? "son" : "vidéo"].filter(Boolean).join(" · ")}\n-# Enregistré le ${parisDate(i.savedAt)}`),
    row(f.convert ? button(1, "MP4", `ae:conv:${owner}:mp4`) : null, f.convert ? button(2, "MP3", `ae:conv:${owner}:mp3`) : null, linkButton("Source", i.url), button(4, "Retirer", `ae:saved:rm:${owner}:${i.id}`)),
    row(button(2, "◀ Bibliothèque", "ae:saved:list:0")),
  ])]);
}

/** Lien d'origine d'une carte : le bouton-lien « Source » (aucun état à garder côté bot, survit à un redémarrage). */
export function sourceOf(components: unknown, label = "Source"): string | null {
  const stack: unknown[] = Array.isArray(components) ? [...components] : [components];
  while (stack.length) {
    const c = stack.shift() as { type?: number; style?: number; label?: string; url?: string; components?: unknown[]; accessory?: unknown } | null;
    if (!c || typeof c !== "object") continue;
    if (c.type === 2 && c.style === 5 && c.label === label && typeof c.url === "string") return c.url;
    if (Array.isArray(c.components)) stack.push(...c.components);
    if (c.accessory) stack.push(c.accessory);
  }
  return null;
}

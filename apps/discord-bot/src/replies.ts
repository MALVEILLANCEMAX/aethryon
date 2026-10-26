// Messages du bot (embeds et boutons-liens, JSON de l'API Discord), indépendants de discord.js (testables).
// Apparence (docs/DISCORD-BOT.md §5.2) : barre champagne pour les états normaux, rouge « erreur » du design
// system pour les échecs ; pied « ni le lien ni le titre ne sont conservés ». Boutons de style 5 (lien) : un
// lien n'a pas de custom_id ; URL ≤ 512 caractères. Toujours éphémères (fixé par la réponse initiale).
import { BOT_TEXT, conversionErrorText, ERROR_TEXT, SERVICE_TEXT } from "./errors.ts";
import type { Resolved } from "./account.ts";

export const COLOR = 0xd4af7c;       // champagne AETHRYON (13938556)
export const COLOR_ERROR = 0xa3372b; // rouge « erreur » du design system (10696491)
export const FOOTER = "AETHRYON · ni le lien ni le titre ne sont conservés";

export interface Embed {
  title?: string; description?: string; color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string }; thumbnail?: { url: string };
}
export interface LinkButton { type: 2; style: 5; label: string; url: string }
export interface ActionRow { type: 1; components: LinkButton[] }
export interface Reply { content?: string; embeds?: Embed[]; components?: ActionRow[] }
/** Message « Components V2 » (version 2 : cartes, galeries, pièces jointes), construit par v2/ui.ts. */
export interface V2Reply { components: unknown[]; flags: number; files?: { attachment: Buffer; name: string; description?: string }[]; allowedMentions?: { parse: string[]; repliedUser?: boolean } }
/** Toute réponse que le bot envoie ou modifie. */
export type AnyReply = Reply | V2Reply;

/** Discord interprète le Markdown des embeds : les noms fournis par l'utilisateur (Google, Discord) sont échappés. */
export const escapeMarkdown = (text: string) => text.replace(/[\\`*_~|>\[\]()#-]/g, (c) => `\\${c}`).replace(/@(everyone|here)/g, "@\u200b$1");

export const linkRow = (...buttons: { label: string; url: string }[]): ActionRow =>
  ({ type: 1, components: buttons.filter((b) => b.url.length <= 512).map((b) => ({ type: 2 as const, style: 5 as const, label: b.label.slice(0, 80), url: b.url })) });

const PLATFORM: Record<string, string> = { youtube: "YouTube", tiktok: "TikTok", twitter: "X", x: "X" };
export const platformName = (p: string | null) => (p ? PLATFORM[p] ?? null : null);
const FMT = { mp3: "MP3", mp4: "MP4" } as const;

/** Texte d'un code d'échec, quelle qu'en soit la source (ytapi, account, bot). */
export function failureText(code: string): string {
  if (Object.hasOwn(SERVICE_TEXT, code)) return SERVICE_TEXT[code]!;
  if (Object.hasOwn(BOT_TEXT, code)) return BOT_TEXT[code as keyof typeof BOT_TEXT];
  if (Object.hasOwn(ERROR_TEXT, code)) return ERROR_TEXT[code]!;
  if (code === "api_unreachable" || code === "upstream_timeout_api") return "Le service de conversion ne répond pas. Réessaie un peu plus tard.";
  if (code === "link_not_created") return BOT_TEXT.download_unavailable;
  return conversionErrorText(code);
}

const espace = (site: string) => `${site}/dashboard/discord`;

/** Compte non lié : invitation à lier depuis le site (aucun secret dans le lien). */
export function notLinkedReply(site: string): Reply {
  return {
    embeds: [{ title: "Compte non lié", description: BOT_TEXT.not_linked, color: COLOR, footer: { text: FOOTER } }],
    components: [linkRow({ label: "Lier mon compte", url: espace(site) })],
  };
}

export function queuedReply(fmt: "mp3" | "mp4"): Reply {
  return { embeds: [{ title: "Demande reçue", description: `Ta conversion ${FMT[fmt]} est en file d'attente.`, color: COLOR, footer: { text: FOOTER } }] };
}

/** En cours : progression RÉELLE de ytapi (arrondie), jamais simulée ; sans progression connue, pas de chiffre. */
export function runningReply(fmt: "mp3" | "mp4", progress: number | null): Reply {
  const pct = progress === null ? "" : ` ${Math.round(progress)} %`;
  return { embeds: [{ title: "Conversion en cours", description: `Récupération et conversion du média (${FMT[fmt]})…${pct}`, color: COLOR, footer: { text: FOOTER } }] };
}

export function doneReply(site: string, fmt: "mp3" | "mp4", platform: string | null, url: string): Reply {
  const fields: { name: string; value: string; inline?: boolean }[] = [{ name: "Format", value: FMT[fmt], inline: true }];
  const pf = platformName(platform);
  if (pf) fields.push({ name: "Plateforme", value: pf, inline: true });
  return {
    embeds: [{
      title: "Conversion terminée",
      description: `Ton fichier ${FMT[fmt]} est prêt. Le bouton « Télécharger » ouvre un lien personnel, utilisable une seule fois pendant 10 minutes : ne le partage pas.`,
      color: COLOR, fields, footer: { text: FOOTER },
      thumbnail: { url: `${site}/brand/aethryon/icons/app-icon-192.png` },
    }],
    components: [linkRow({ label: "Télécharger", url })],
  };
}

export function errorReply(code: string, site: string): Reply {
  const reply: Reply = {
    embeds: [{ title: "Conversion impossible", description: failureText(code), color: COLOR_ERROR, footer: { text: `Code : ${code} · ${FOOTER}` } }],
  };
  if (code === "not_linked" || code === "unauthorized") reply.components = [linkRow({ label: "Mon espace AETHRYON", url: espace(site) })];
  return reply;
}

/** Fenêtre de 15 min de Discord presque écoulée : dernier message, la conversion continue côté serveur. */
export function windowClosedReply(site: string): Reply {
  return {
    embeds: [{ title: "La conversion continue…", description: BOT_TEXT.discord_window_closed, color: COLOR, footer: { text: FOOTER } }],
    components: [linkRow({ label: "Mon espace", url: `${site}/dashboard/activite` })],
  };
}

const parisDate = (iso: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));

/** /account : compte lié (quota du jour, concurrence), suspendu, ou non lié. */
export function accountReply(r: Resolved, site: string): Reply {
  if (!r.linked) return notLinkedReply(site);
  if (r.status === "suspended") {
    return { embeds: [{ title: "Compte suspendu", description: SERVICE_TEXT.account_suspended, color: COLOR_ERROR, footer: { text: FOOTER } }] };
  }
  const t = r.today;
  const left = t.limit === null ? null : t.remaining ?? Math.max(0, t.limit - t.used);
  const today = t.unlimited || t.limit === null || left === null
    ? `${t.used} conversion${t.used > 1 ? "s" : ""} aujourd'hui, sans limite`
    : `${t.used} sur ${t.limit} aujourd'hui (${left} restante${left > 1 ? "s" : ""})`;
  return {
    embeds: [{
      title: "Ton compte AETHRYON",
      color: COLOR,
      fields: [
        { name: "Compte", value: r.user.name ? `${escapeMarkdown(r.user.name)} (${escapeMarkdown(r.user.email)})` : escapeMarkdown(r.user.email) },
        { name: "Discord", value: `@${escapeMarkdown(r.discord.name)}, lié le ${parisDate(r.discord.linkedAt)}` },
        { name: "Conversions", value: `${today}. Réinitialisation à minuit (heure de Paris).` },
        { name: "En même temps", value: r.maxActive === 1 ? "Une conversion à la fois." : `Jusqu'à ${r.maxActive} conversions à la fois.` },
      ],
      footer: { text: "Même compte et même quota que le raccourci et l'extension." },
      thumbnail: { url: `${site}/brand/aethryon/icons/app-icon-192.png` },
    }],
    components: [linkRow({ label: "Gérer sur le site", url: espace(site) })],
  };
}

export function linkUnavailableReply(): Reply {
  return { embeds: [{ title: "Compte injoignable", description: BOT_TEXT.link_unavailable, color: COLOR_ERROR, footer: { text: FOOTER } }] };
}

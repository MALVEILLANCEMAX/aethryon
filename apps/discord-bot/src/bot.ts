// Bot Discord AETHRYON : connexion Gateway SORTANTE (aucune route publique, aucun label Traefik). Version 2
// (docs/DISCORD-BOT.md §18) : commandes, menu « Applications › Convertir avec AETHRYON », cartes Components V2, compte
// lié, bibliothèque, réglages de serveur, cartes automatiques (optionnelles). Intent « Guilds » seulement, plus
// « Guild Messages » + « Message Content » (privilégié) UNIQUEMENT si les cartes automatiques sont ouvertes.
// Chaque fonction a son drapeau dans bot.env (fermée par défaut) ; journaux sans identifiant, lien ni titre.
//   node dist/bot.js                 démarre le bot
//   node dist/bot.js --check-config  vérifie la configuration locale (sans contacter Discord ni account)
import { writeFileSync } from "node:fs";
import {
  ActivityType, Client, Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits, Status,
  type Interaction, type Message, type MessageContextMenuCommandInteraction,
} from "discord.js";
import { ConfigError, loadConfig, readInternalToken, readToken, tokenAppId, type Config } from "./config.ts";
import { addSecret, log } from "./log.ts";
import { AccountClient } from "./account.ts";
import { YtapiClient } from "./ytapi.ts";
import { createFlights } from "./live.ts";
import { createStatusReader } from "./status.ts";
import { createRateLimiter } from "./ratelimit.ts";
import { HEARTBEAT_FILE } from "./health.ts";
import { createRouter, type Ix } from "./v2/router.ts";
import { createAuto, type AutoMessage } from "./v2/auto.ts";
import { whereOf } from "./v2/context.ts";
import type { V2Reply } from "./replies.ts";

let cfg: Config;
let token: string;
let account: AccountClient | null = null;
try {
  cfg = loadConfig();
  token = readToken();
  addSecret(token);
  const appId = tokenAppId(token);
  if (appId !== null && appId !== cfg.clientId) throw new ConfigError("le token appartient à une autre application que DISCORD_CLIENT_ID");
  if (cfg.linkEnabled) {
    const internal = readInternalToken();
    addSecret(internal);
    account = new AccountClient(cfg.accountUrl, internal);
  }
} catch (e) {
  log("error", e instanceof ConfigError ? e.message : "configuration illisible");
  process.exit(1);
}
const f = cfg.features;
if (process.argv.includes("--check-config")) {
  log("info", "configuration valide (Discord non contacté)", { clientId: cfg.clientId, guildId: cfg.guildId, ...Object.fromEntries(Object.entries(f)) });
  process.exit(0);
}

// Limites en mémoire : 5 actions et 30 clics de navigation par 30 s par personne, 60 actions par minute par serveur.
const limiter = createRateLimiter();
const uiLimiter = createRateLimiter(30, 30_000);
const guildLimiter = createRateLimiter(60, 60_000);
const router = createRouter({
  brand: { site: cfg.siteUrl, emoji: cfg.emoji },
  features: f,
  account,
  ytapi: f.convert ? new YtapiClient(cfg.ytapiUrl) : null,
  readStatus: createStatusReader(cfg.siteUrl, cfg.apiHealthUrl),
  flights: createFlights(),
  limiter,
  uiLimiter,
  guildLimiter,
  log,
});
const auto = createAuto({ brand: { site: cfg.siteUrl, emoji: cfg.emoji }, features: f, guildSettings: (g) => router.guildSettings(g), log });

const intents = [GatewayIntentBits.Guilds];
if (f.autoEmbeds) intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
// Statut affiché sous le nom du bot : « Joue à … » (demande du propriétaire). Posé dès l'identification à la Gateway,
// donc rétabli à chaque reconnexion ; DISCORD_ACTIVITY (bot.env) le remplace, vide = aucun statut.
const activity = (process.env.DISCORD_ACTIVITY ?? "Pas malvoyant tqt").trim().slice(0, 128);
const client = new Client({
  intents, allowedMentions: { parse: [] },
  presence: { status: "online", activities: activity ? [{ name: activity, type: ActivityType.Playing }] : [] },
});

client.once(Events.ClientReady, (c) => {
  log("info", "connecté à Discord", { bot: c.user.username, serveurs: c.guilds.cache.size, serveurDeTest: c.guilds.cache.has(cfg.guildId), cartesAuto: f.autoEmbeds });
  const beat = () => { if (c.ws.status === Status.Ready) writeFileSync(HEARTBEAT_FILE, String(Date.now())); };
  beat();
  setInterval(beat, 15_000).unref();
  setInterval(() => { auto.sweep(); limiter.sweep(); uiLimiter.sweep(); guildLimiter.sweep(); }, 10 * 60_000).unref();
});

/** Adaptateur discord.js → interface du routeur (v2/router.ts). Les messages sont des JSON de l'API (cartes V2). */
function toIx(i: Interaction): Ix | null {
  const base = {
    user: { id: i.user.id, username: i.user.username, globalName: i.user.globalName ?? null, avatar: i.user.avatar ?? null },
    guildId: i.guildId, channelId: i.channelId,
    attachmentSizeLimit: Number.isFinite(i.attachmentSizeLimit) && i.attachmentSizeLimit > 0 ? i.attachmentSizeLimit : 10 * 1024 * 1024,
    canManageGuild: !!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild),
    createdTimestamp: i.createdTimestamp,
    // Où l'on est et ce que Discord permet ici (v2/context.ts) : contexte, modes d'installation, permissions.
    where: whereOf({
      context: i.context ?? null, guildId: i.guildId, userId: i.user.id,
      owners: (i.authorizingIntegrationOwners ?? null) as unknown as Record<string, string | undefined> | null,
      memberExternalApps: i.inGuild() ? (i.memberPermissions?.has(PermissionFlagsBits.UseExternalApps) ?? null) : null,
      appAttach: i.appPermissions ? i.appPermissions.has(PermissionFlagsBits.AttachFiles) : null,
    }),
  };
  const out = (r: V2Reply, eph: boolean) => ({ ...r, flags: r.flags | (eph ? MessageFlags.Ephemeral : 0) }) as never;
  if (i.isAutocomplete()) {
    const fo = i.options.getFocused(true);
    return {
      ...base, kind: "autocomplete", commandName: i.commandName, focused: { name: fo.name, value: String(fo.value) },
      option: () => null, reply: async () => undefined, defer: async () => undefined, deferUpdate: async () => undefined,
      update: async () => undefined, edit: async () => undefined, followUp: async () => undefined,
      respond: (c) => i.respond(c),
    };
  }
  if (!i.isRepliable()) return null;
  const common = {
    ...base,
    reply: (r: V2Reply, eph: boolean) => i.reply(out(r, eph)),
    // Réponse différée : Discord dit s'il l'a rendue éphémère (imposé quand une application du compte n'a pas le droit
    // de publier ici), au lieu de le supposer.
    defer: async (eph: boolean) => {
      const res = await i.deferReply({ ...(eph ? { flags: MessageFlags.Ephemeral } : {}), withResponse: true });
      return { ephemeral: res.interaction.responseMessageEphemeral ?? null };
    },
    edit: async (r: unknown) => {
      const m = await i.editReply(r as never);
      return { ephemeral: m.flags.has(MessageFlags.Ephemeral) };
    },
    followUp: (r: V2Reply, eph: boolean) => i.followUp(out(r, eph)),
    respond: async () => undefined,
  };
  if (i.isChatInputCommand()) {
    return {
      ...common, kind: "command", commandName: i.commandName, subcommand: i.options.getSubcommand(false),
      option: (n) => i.options.get(n)?.value ?? null,
      deferUpdate: async () => undefined, update: async () => undefined,
      showModal: (m) => i.showModal(m as never),
    };
  }
  if (i.isMessageContextMenuCommand()) {
    const m = (i as MessageContextMenuCommandInteraction).targetMessage;
    const urls = m.embeds.map((e) => e.url).filter((u): u is string => typeof u === "string");
    // Aperçus natifs calculés par Discord (titre, auteur, miniature) : affichés tels quels, jamais journalisés.
    const embeds = m.embeds.slice(0, 5).map((e) => ({ url: e.url ?? null, title: e.title ?? null, author: e.author?.name ?? null, thumbnail: e.thumbnail?.url ?? null }));
    return {
      ...common, kind: "messageMenu", commandName: i.commandName, option: () => null,
      target: { content: m.content ?? "", urls, authorId: m.author?.id ?? "", embeds },
      deferUpdate: async () => undefined, update: async () => undefined,
    };
  }
  if (i.isButton() || i.isStringSelectMenu() || i.isChannelSelectMenu()) {
    return {
      ...common,
      kind: i.isButton() ? "button" : i.isStringSelectMenu() ? "select" : "channelSelect",
      customId: i.customId,
      values: i.isButton() ? undefined : [...i.values],
      option: () => null,
      messageComponents: i.message.components.map((c) => c.toJSON()),
      messageEphemeral: i.message.flags.has(MessageFlags.Ephemeral),
      deferUpdate: () => i.deferUpdate(),
      update: (r) => i.update(r as never),
      showModal: (m) => i.showModal(m as never),
    };
  }
  if (i.isModalSubmit()) {
    const fields: Record<string, string> = {};
    for (const [id, field] of i.fields.fields) {
      const v = field as { value?: unknown; values?: unknown };
      fields[id] = typeof v.value === "string" ? v.value.slice(0, 100) : Array.isArray(v.values) ? v.values.map(String).join(",").slice(0, 100) : "";
    }
    const fromMessage = i.isFromMessage();
    return {
      ...common, kind: "modal", customId: i.customId, fields, option: () => null,
      messageComponents: fromMessage ? i.message.components.map((c) => c.toJSON()) : [],
      messageEphemeral: fromMessage ? i.message.flags.has(MessageFlags.Ephemeral) : false,
      deferUpdate: () => (fromMessage ? i.deferUpdate() : i.deferReply({ flags: MessageFlags.Ephemeral })),
      update: (r) => (fromMessage ? i.update(r as never) : i.reply(out(r, true))),
    };
  }
  return null;
}

client.on(Events.InteractionCreate, (interaction) => {
  const x = toIx(interaction);
  if (x) void router.handle(x);
});

if (f.autoEmbeds) {
  client.on(Events.MessageCreate, (m: Message) => {
    if (!m.inGuild()) return;
    const me = m.guild.members.me;
    const msg: AutoMessage = {
      id: m.id, guildId: m.guildId, channelId: m.channelId, content: m.content, authorId: m.author.id,
      authorIsBot: m.author.bot, webhook: !!m.webhookId, system: m.system,
      embeds: m.embeds.slice(0, 5).map((e) => ({ url: e.url ?? null, title: e.title ?? null, author: e.author?.name ?? null, thumbnail: e.thumbnail?.url ?? null })),
      canManageMessages: !!(me && m.channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageMessages)),
      reply: (r) => m.reply({ ...r, allowedMentions: { parse: [], repliedUser: false } } as never),
      react: (e) => m.react(e),
      suppressEmbeds: () => m.suppressEmbeds(true),
    };
    void auto.onMessage(msg).catch(() => log("warn", "carte automatique en échec"));
  });
}

// Le bot quitte un serveur : ses réglages (/config) sont effacés.
client.on(Events.GuildDelete, (g) => { if (account && f.guildConfig) void account.forgetGuild(g.id); });

client.on(Events.Error, (e) => log("error", "erreur du client Discord", { erreur: e.name }));
client.on(Events.ShardDisconnect, (_ev, id) => log("warn", "connexion Gateway fermée", { shard: id }));
client.on(Events.ShardResume, (id) => log("info", "connexion Gateway reprise", { shard: id }));

const stop = (sig: string) => { log("info", "arrêt", { signal: sig }); void client.destroy().finally(() => process.exit(0)); };
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

client.login(token).catch((e: unknown) => {
  const code = (e as { code?: unknown })?.code;
  log("error", "connexion à Discord refusée", { raison: typeof code === "string" ? code : e instanceof Error ? e.name : "inconnue" });
  if (code === "DisallowedIntents") log("error", "intent « Message Content » non activé dans le Developer Portal : l'activer, ou fermer AUTO_EMBEDS_ENABLED");
  if (code !== "TokenInvalid") process.exit(1);
  // Token refusé : pas de nouvel essai immédiat (Docker relancerait en boucle) ; le remplacer avec discord-secret.sh.
  log("error", "token refusé par Discord : le régénérer puis lancer deploy/discord-secret.sh ; nouvel essai dans 5 min");
  setTimeout(() => process.exit(1), 300_000);
});

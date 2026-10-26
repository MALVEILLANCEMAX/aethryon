// Commandes (version 2, v2/commands.ts) : enregistrement sur le SERVEUR DE TEST par défaut (commandes de serveur,
// visibles immédiatement). En global (installation serveur ET utilisateur), seulement avec --global ET
// DISCORD_GLOBAL_OK=1 : décision du propriétaire (docs/DISCORD-BOT.md §18.8), jamais par défaut.
//   node dist/register.js --dry-run [--global]   affiche le JSON (sans token, sans contacter Discord)
//   node dist/register.js                        remplace les commandes du serveur de test
//   node dist/register.js --list | --clear       liste / retire les commandes du serveur de test
//   DISCORD_GLOBAL_OK=1 node dist/register.js --global [--clear]   commandes globales (accord du propriétaire)
//   node dist/register.js --emoji /chemin/chouette-128.png         téléverse la chouette en emoji d'application
//                                                                   et affiche la valeur de AETHRYON_EMOJI
import { readFileSync } from "node:fs";
import { REST, Routes } from "discord.js";
import { commandsV2 } from "./v2/commands.ts";
import { ConfigError, featuresOf, loadConfig, readToken } from "./config.ts";
import { addSecret, log } from "./log.ts";

const args = process.argv.slice(2);
const global = args.includes("--global");
if (args.includes("--dry-run")) {
  process.stdout.write(JSON.stringify(commandsV2(featuresOf(), global ? "global" : "guild"), null, 2) + "\n");
  process.exit(0);
}
try {
  const cfg = loadConfig();
  const token = readToken();
  addSecret(token);
  const rest = new REST({ version: "10" }).setToken(token);
  const emojiAt = args.indexOf("--emoji");
  if (emojiAt >= 0) {
    const file = args[emojiAt + 1] ?? "";
    const png = readFileSync(file);
    if (png.length > 256 * 1024 || png.subarray(1, 4).toString() !== "PNG") throw new ConfigError("image PNG de 256 Kio au plus attendue (128 × 128 recommandé)");
    const res = (await rest.post(Routes.applicationEmojis(cfg.clientId), { body: { name: "aethryon", image: `data:image/png;base64,${png.toString("base64")}` } })) as { id: string; name: string };
    log("info", "emoji d'application créé : ajouter à bot.env", { AETHRYON_EMOJI: `<:${res.name}:${res.id}>` });
    process.exit(0);
  }
  if (global && process.env.DISCORD_GLOBAL_OK !== "1") throw new ConfigError("--global exige DISCORD_GLOBAL_OK=1 (accord du propriétaire : commandes visibles partout où l'application est installée)");
  const route = global ? Routes.applicationCommands(cfg.clientId) : Routes.applicationGuildCommands(cfg.clientId, cfg.guildId);
  const where = global ? "globales" : "du serveur de test";
  if (args.includes("--list")) {
    const list = (await rest.get(route)) as { name: string }[];
    log("info", `commandes ${where}`, { nombre: list.length, noms: list.map((c) => c.name).join(", ") });
  } else {
    const body = args.includes("--clear") ? [] : commandsV2(cfg.features, global ? "global" : "guild");
    const res = (await rest.put(route, { body })) as { name: string }[];
    log("info", `commandes ${where} enregistrées`, { nombre: res.length, noms: res.map((c) => c.name).join(", ") });
  }
} catch (e) {
  const status = (e as { status?: unknown })?.status;
  log("error", e instanceof ConfigError ? e.message : "enregistrement refusé par Discord", { statut: typeof status === "number" ? status : null });
  if (status === 403 || status === 50001) log("error", "le bot n'est pas autorisé sur ce serveur : l'inviter avec la portée applications.commands (lien dans docs/DISCORD-BOT.md)");
  process.exit(1);
}

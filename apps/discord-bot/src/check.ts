// Vérification du token AUPRÈS DE DISCORD, sans démarrer le bot (lecture seule) : identité du bot (doit être
// l'application configurée) et présence sur le serveur de test ; sinon, lien d'invitation aux permissions
// minimales. N'affiche jamais le token.
import { REST, Routes } from "discord.js";
import { ConfigError, inviteUrl, loadConfig, readToken } from "./config.ts";
import { addSecret, log } from "./log.ts";


try {
  const cfg = loadConfig();
  const token = readToken();
  addSecret(token);
  const rest = new REST({ version: "10" }).setToken(token);
  const me = (await rest.get(Routes.user("@me"))) as { id: string; username: string; bot?: boolean };
  const guilds = (await rest.get(Routes.userGuilds())) as { id: string }[];
  const sameApp = me.id === cfg.clientId;
  const inGuild = guilds.some((g) => g.id === cfg.guildId);
  log(sameApp ? "info" : "error", "token valide", { bot: me.username, estUnBot: me.bot === true, applicationAttendue: sameApp, serveurDeTest: inGuild, serveurs: guilds.length });
  if (!inGuild) log("warn", "bot absent du serveur de test : l'inviter avec ce lien (aucune permission demandée)", { lien: inviteUrl(cfg.clientId) });
  process.exit(sameApp ? 0 : 1);
} catch (e) {
  const status = (e as { status?: unknown })?.status;
  log("error", e instanceof ConfigError ? e.message : "token refusé par Discord", { statut: typeof status === "number" ? status : null });
  process.exit(1);
}

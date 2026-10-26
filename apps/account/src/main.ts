// Point d'entrée : API publique (:3000) et API interne (:3001), purge quotidienne, arrêt propre.
import { serve } from "@hono/node-server";
import { ConfigError, loadConfig } from "./config.ts";
import { log } from "./log.ts";
import { buildServer } from "./server.ts";

let cfg;
try {
  cfg = loadConfig();
} catch (e) {
  log("error", e instanceof ConfigError ? `configuration invalide : ${e.message}` : "configuration invalide");
  process.exit(2);
}

const server = await buildServer(cfg);
const pub = serve({ fetch: server.publicApp.fetch, port: cfg.publicPort, hostname: "0.0.0.0" });
const internal = serve({ fetch: server.internalApp.fetch, port: cfg.internalPort, hostname: "0.0.0.0" });
// API interne du bot Discord : seulement si son secret est présent (sinon le port n'est pas ouvert du tout).
const discordInternal = server.discordInternalApp && cfg.discordInternal
  ? serve({ fetch: server.discordInternalApp.fetch, port: cfg.discordInternal.port, hostname: "0.0.0.0" })
  : null;
log("info", "startup", {
  publicPort: cfg.publicPort, internalPort: cfg.internalPort, google: cfg.google !== null,
  icloudLink: cfg.icloudShortcutUrl !== null, dailyConversions: cfg.dailyConversions, maxKeysPerUser: cfg.maxKeysPerUser,
  discordLinking: cfg.discord !== null, discordBotApi: cfg.discordInternal ? cfg.discordInternal.port : null,
  // Interrupteurs de la 3.5, relus par deploy/deploy-v35.sh après la bascule (jamais de clé, seulement l'état).
  billing: cfg.billing ? cfg.billing.mode : "off", plansActive: cfg.plansActive, toolsExportLimit: cfg.toolsExportLimit,
  discordLogin: cfg.discord?.login === true,
  // Interrupteurs de la 3.8, relus par deploy/deploy-38.sh après la bascule (état seulement, jamais une clé).
  cloud: cfg.cloud ? "on" : "off", desktopLink: cfg.desktopLink, musicRelay: cfg.musicEnabled,
  // Protection anti-bot (antibot.ts), relue par deploy/deploy-anti-bot.sh : mode seulement, jamais le secret.
  antibot: cfg.antibot.mode, capSiteKey: cfg.antibot.siteKey,
});
if (cfg.discordInternal && !cfg.discordInternal.allowFrom) log("warn", "DISCORD_INTERNAL_ALLOW_FROM absent : API du bot ouverte à tout réseau qui joint ce port (secret seul)");
// Vente ouverte sans offres appliquées : un abonné paierait sans recevoir les limites de son offre (FACTURATION.md §10).
if (cfg.billing && !cfg.plansActive) log("warn", "BILLING actif sans PLANS_ACTIVE=1 : les droits payants ne changent aucune limite");

const purge = async () => {
  try {
    const r = await server.usage.purge();
    const l = await server.library.purge();
    const a = await server.antibot.purge();
    log("info", "retention purge", { ...r, discordGuilds: l.guilds, securityEvents: a.events, securityCounters: a.counters });
  } catch (e) {
    log("error", "retention purge failed", { err: String(e) });
  }
};
setTimeout(purge, 60_000).unref();
setInterval(purge, 24 * 3_600_000).unref();

// Facturation ouverte : rapprochement toutes les 6 h (abonnements relus chez Stripe, événements manqués rattrapés).
if (server.billing.enabled) {
  const reconcile = async () => {
    try { await server.billing.reconcile(); } catch (e) { log("error", "billing reconcile failed", { err: String((e as Error)?.message ?? e).slice(0, 200) }); }
  };
  setTimeout(reconcile, 120_000).unref();
  setInterval(reconcile, 6 * 3_600_000).unref();
}

// AETHRYON Cloud (CLOUD=on) : expiration à 30 jours, reprises, envois abandonnés ; réconciliation base ⇄ seau.
if (server.cloud) {
  const cloud = server.cloud;
  const tache = async () => {
    try { await cloud.tache(); } catch (e) { log("error", "cloud task failed", { err: String((e as Error)?.name ?? e).slice(0, 120) }); }
  };
  const reconcilier = async () => {
    try { await cloud.reconcilier(); } catch (e) { log("error", "cloud reconcile failed", { err: String((e as Error)?.name ?? e).slice(0, 120) }); }
  };
  const journal = async () => {
    try { await cloud.purgerJournal(); } catch (e) { log("error", "cloud journal purge failed", { err: String(e).slice(0, 120) }); }
  };
  setTimeout(tache, 90_000).unref();
  setInterval(tache, cloud.cfg.taskIntervalS * 1000).unref();
  setTimeout(reconcilier, 300_000).unref();
  setInterval(reconcilier, cloud.cfg.reconcileIntervalS * 1000).unref();
  setInterval(journal, 24 * 3_600_000).unref();
  log("info", "cloud enabled", { bucketHost: new URL(cloud.cfg.endpoint).host, quota: cloud.cfg.quotaBytes, retentionDays: cloud.cfg.retentionDays });
}

let stopping = false;
const stop = (sig: string) => {
  if (stopping) return;
  stopping = true;
  log("info", "shutdown", { signal: sig });
  pub.close();
  internal.close();
  discordInternal?.close();
  // Compteurs anti-bot en attente écrits avant la fermeture de la base.
  void server.antibot.flush().finally(() => setTimeout(() => { server.close(); process.exit(0); }, 300).unref());
};
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

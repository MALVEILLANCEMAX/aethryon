// Assemblage des services (utilisé par main.ts, les outils et les tests).
import { getMigrations } from "better-auth/db/migration";
import { createAuth } from "./auth.ts";
import type { Config } from "./config.ts";
import { migrateUp, openDatabases, type Databases } from "./db.ts";
import { createInternalApp, Authorizer } from "./internal.ts";
import { createDiscordInternalApp } from "./discord-internal.ts";
import { DiscordService } from "./discord.ts";
import { LibraryService } from "./discord-library.ts";
import { KeyService } from "./keys.ts";
import { createPublicApp, type Services } from "./app.ts";
import { StatusService } from "./status.ts";
import { UsageService } from "./usage.ts";
import { YtapiClient } from "./ytapi.ts";
import { AccountMails } from "./mails.ts";
import { ToolsService } from "./outils.ts";
import { SmtpMailer, type Mailer } from "./mailer.ts";
import { BillingService } from "./facturation.ts";
import { createStripe } from "./stripe-client.ts";
import { CloudService } from "./cloud/service.ts";
import { S3CloudStore, type CloudStore } from "./cloud/stockage.ts";

export interface Server extends Services {
  dbs: Databases;
  publicApp: ReturnType<typeof createPublicApp>;
  internalApp: ReturnType<typeof createInternalApp>;
  /** API interne du bot Discord (port DISCORD_INTERNAL_PORT), null si son secret est absent. */
  discordInternalApp: ReturnType<typeof createDiscordInternalApp> | null;
  close(): void;
}

/** Ouvre la base, applique les migrations (Better Auth puis les nôtres) et construit les apps. */
export async function buildServer(cfg: Config, opts: { fetchImpl?: typeof fetch; discordFetch?: typeof fetch; discordTimeoutMs?: number; mailer?: Mailer; cloudStore?: CloudStore; cloudNow?: () => number } = {}): Promise<Server> {
  const dbs = openDatabases(cfg.dbPath);
  // E-mails (inscription par e-mail, mot de passe oublié) : relais SMTP configuré, ou un faux pour les tests.
  const mails = new AccountMails(cfg, opts.mailer ?? (cfg.mail ? new SmtpMailer(cfg.mail) : null));
  // Suppression d'un compte : ses abonnements sont d'abord résiliés chez Stripe (facturation.ts).
  let billingRef: BillingService | null = null;
  // Connexion par Discord : le service Discord (construit plus bas) remet les tickets à Better Auth.
  let discordRef: DiscordService | null = null;
  const auth = createAuth(cfg, dbs.auth, mails, {
    beforeDeleteUser: async (id) => { await billingRef?.beforeAccountDeletion(id); },
    discordTicket: (ticket, nonce) => discordRef?.consumeTicket(ticket, nonce) ?? null,
  });
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);
  if (toBeCreated.length || toBeAdded.length) await runMigrations();
  migrateUp(dbs.app);

  const db = dbs.app;
  const usage = new UsageService(db, cfg);
  const keys = new KeyService(db, auth, cfg.maxKeysPerUser);
  const ytapi = new YtapiClient(cfg, opts.fetchImpl ?? fetch);
  const status = new StatusService(cfg, db, usage, opts.fetchImpl ?? fetch, ytapi);
  const authorizer = new Authorizer(cfg, db, auth, usage);
  const discord = new DiscordService({ cfg, db, keys, usage, discordFetch: opts.discordFetch, ytapiFetch: opts.fetchImpl, discordTimeoutMs: opts.discordTimeoutMs });
  discordRef = discord;
  const library = new LibraryService(db);
  const tools = new ToolsService({ cfg, db, keys, fetch: opts.fetchImpl });
  const billing = new BillingService(db, cfg, usage, cfg.billing ? createStripe(cfg.billing) : null, mails);
  billingRef = billing;
  // AETHRYON Cloud : seulement si CLOUD=on (identifiants du fournisseur lus dans des fichiers, jamais ailleurs).
  const cloud = cfg.cloud ? new CloudService(db, cfg.cloud, opts.cloudStore ?? new S3CloudStore(cfg.cloud), opts.cloudNow) : null;
  const services: Services = { cfg, db, auth, keys, usage, status, authorizer, ytapi, discord, library, mails, tools, billing, cloud };
  const publicApp = createPublicApp(services);
  const internalApp = createInternalApp(cfg, authorizer, usage, cloud);
  const discordInternalApp = cfg.discordInternal ? createDiscordInternalApp(cfg, discord, library, tools) : null;
  return {
    ...services, dbs, publicApp, internalApp, discordInternalApp, authorizer,
    close() { dbs.app.close(); dbs.auth.close(); },
  };
}

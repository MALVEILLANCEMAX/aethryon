// Configuration du service account : variables d'environnement + secrets lus dans des fichiers.
// Aucune valeur secrète n'est jamais journalisée ni renvoyée par l'API.
import { readFileSync } from "node:fs";
import type { MailConfig } from "./mailer.ts";

export interface Config {
  publicUrl: string;            // origine publique, ex. https://raccourci.malvu.fr
  publicOrigin: string;
  authSecret: string;
  google: { clientId: string; clientSecret: string } | null;
  internalToken: string;
  dbPath: string;
  backupDir: string;
  ytapiInternalUrl: string | null;
  icloudShortcutUrl: string | null;
  shortcutVersion: string;
  fallbackDownload: string;
  apiPublicUrl: string;
  dailyConversions: number;
  maxActiveJobs: number;        // concurrence commerciale par défaut (réglage « max_active » sinon)
  techMaxActive: number;        // plafond technique par utilisateur, jamais levé par un rôle
  maxKeysPerUser: number;
  maxUsers: number;
  adminEmails: Set<string>;
  allowedEmails: Set<string>;
  retentionUsageDays: number;
  retentionAdminEventDays: number;
  sessionDays: number;
  publicPort: number;
  internalPort: number;
  ipHeader: string;
  allowTestSessions: boolean;
  internalAllowFrom: { net: number; mask: number } | null; // sous-réseau autorisé sur l'API interne
  keysActive: boolean; // vrai seulement quand ytapi accepte réellement les jetons utilisateur
  extensionIds: string[]; // identifiants d'extension Chrome autorisés (connexion PKCE, docs/EXTENSION.md §7)
  /** Liaison Discord (OAuth2, docs/DISCORD-BOT.md §17) ; null = fonction fermée (identifiant ou secret absent). */
  discord: DiscordConfig | null;
  /** API interne du bot Discord (secret partagé bot ↔ account) ; null = API fermée (secret absent). */
  discordInternal: { token: string; port: number; allowFrom: { net: number; mask: number } | null } | null;
  /** Envoi d'e-mails (relais SMTP) : inscription par e-mail et mot de passe oublié ; null = fonction fermée
   *  (mot de passe SMTP absent), seule la connexion Google reste proposée. */
  mail: MailConfig | null;
  /** Délai minimal entre deux envois d'un code d'inscription à la même adresse (s) ; 60 en production. */
  signupResendS: number;
  /** AETHRYON Tools (docs/OUTILS.md) : relais /api/outils/* vers ytapi (TOOLS_ENABLED de ytapi requis). */
  toolsEnabled: boolean;
  /** AETHRYON Music : relais /api/music/* vers ytapi (music.ts) ; coupé tant que MUSIC_RELAY ≠ 1 (MUSIC_ENABLED d'ytapi requis). */
  musicEnabled: boolean;
  /** Facturation sur le site (docs/FACTURATION.md) ; null = coupée (BILLING=off, défaut) : aucun appel à Stripe. */
  billing: BillingConfig | null;
  /** Offres appliquées aux quotas (plans.ts) ; faux tant que PLANS_ACTIVE ≠ 1 : limites globales pour tous. */
  plansActive: boolean;
  /** Limite d'export de Tools de Gratuit appliquée même sans offres actives (TOOLS_EXPORT_LIMIT=1). Coupée par défaut :
   *  aucun quota nouveau pour les comptes existants sans l'accord du propriétaire. Avec PLANS_ACTIVE=1, la limite de
   *  l'offre du compte s'applique toujours. */
  toolsExportLimit: boolean;
  /** Avantages payants aussi dans le bot Discord ; faux par défaut : Discord exige alors la même offre en Premium
   *  Apps, au même prix (Developer Policy, docs/FACTURATION.md §6). Faux = le bot applique les limites de Free. */
  discordPaidBenefits: boolean;
  /** Connexion du panneau AETHRYON pour Premiere Pro (premiere.ts, page d'accord /premiere/connecter). Fermée par
   *  défaut (PREMIERE_CONNEXION ≠ 1) : routes /api/premiere/* en 404 « premiere_closed », aucune demande créée. */
  premiereLink: boolean;
  /** Liaison d'AETHRYON Desktop au compte (desktop.ts, migration 014) ; coupée par défaut (DESKTOP_CONNEXION ≠ 1) :
   *  appairage, jeton et page d'accord en 404 « desktop_closed », aucune demande créée (moi et déconnexion restent
   *  ouvertes : elles ne servent qu'à une clé déjà remise). */
  desktopLink: boolean;
  /** AETHRYON Cloud V1 (stockage S3 temporaire de l'administrateur, src/cloud/) ; null = coupé (CLOUD ≠ on, défaut) :
   *  routes /api/cloud/* en 404 « cloud_closed », offres internes refusées, aucune requête vers le fournisseur. */
  cloud: CloudConfig | null;
  /** Protection anti-bot (src/antibot.ts, docs/SECURITE-ANTIBOT.md) ; mode « off » par défaut : aucun défi. */
  antibot: AntibotConfig;
}

/** ANTIBOT=off (défaut, aucun défi demandé), observe (décisions comptées, rien n'est demandé), on (défis exigés). */
export type AntibotMode = "off" | "observe" | "on";
export interface AntibotConfig {
  mode: AntibotMode;
  /** Cap standalone sur le réseau interne ytc-cap (siteverify), ex. http://ytc-cap:3000 ; null si coupé. */
  capUrl: string | null;
  /** Clé de site Cap (10 caractères hexadécimaux, publique : le navigateur la voit dans /cap/<clé>/). */
  siteKey: string | null;
  /** Secret de la clé de site (CAP_SECRET_FILE), jamais journalisé ni renvoyé. */
  secret: string | null;
  /** Durée d'un ticket de défi (s) : au-delà, « challenge_expired ». */
  ticketTtlS: number;
  /** Laissez-passer après un défi réussi pour les travaux du site (s). */
  passTtlS: number;
  /** Blocage temporaire d'un sujet (s). */
  blockS: number;
  /** Échecs de connexion (adresse visée ou sujet) à partir desquels chaque tentative exige un défi. */
  loginFailures: number;
  /** Travaux (Tools, Music) en 10 minutes à partir desquels un défi est demandé. */
  travauxSeuil: number;
  /** Preuves refusées en 15 minutes avant un blocage temporaire. */
  echecsBlocage: number;
  /** Conservation des événements suspects (jours) et des compteurs (jours). */
  eventDays: number;
  counterDays: number;
}

/** AETHRYON Cloud : fournisseur S3 générique (Backblaze B2, Cloudflare R2, MinIO…) choisi par la seule configuration. */
export interface CloudConfig {
  endpoint: string;          // CLOUD_S3_ENDPOINT, ex. https://s3.eu-central-003.backblazeb2.com (sans le seau)
  region: string;            // CLOUD_S3_REGION, ex. eu-central-003 (B2), auto (R2)
  bucket: string;            // CLOUD_S3_BUCKET : seau PRIVÉ
  forcePathStyle: boolean;   // CLOUD_S3_PATH_STYLE=1 : https://hôte/<seau>/<clé> (MinIO) ; sinon https://<seau>.hôte/<clé>
  versions: boolean;         // CLOUD_S3_VERSIONS (1 par défaut) : seau versionné (B2) → suppression version par version
  accessKeyId: string;       // CLOUD_S3_ACCESS_KEY_ID_FILE (keyID de la clé d'application B2), jamais journalisé
  secretAccessKey: string;   // CLOUD_S3_SECRET_ACCESS_KEY_FILE (applicationKey), jamais journalisé
  prefix: string;            // CLOUD_S3_PREFIX : préfixe de toutes les clés (« aethryon-cloud/ »)
  quotaBytes: number;        // CLOUD_QUOTA_BYTES : quota par compte (9 Go = 9 000 000 000 octets)
  globalQuotaBytes: number;  // CLOUD_GLOBAL_QUOTA_BYTES : plafond du seau entier (offre gratuite B2 : 10 Go)
  maxFileBytes: number;      // CLOUD_MAX_FILE_BYTES : taille maximale d'un fichier
  retentionDays: number;     // CLOUD_RETENTION_DAYS : 30
  putTtlS: number;           // CLOUD_PUT_URL_TTL_S : durée d'une URL d'envoi
  getTtlS: number;           // CLOUD_GET_URL_TTL_S : durée d'un lien de téléchargement ou d'aperçu
  taskIntervalS: number;     // CLOUD_TASK_INTERVAL_S : expiration, vérifications, envois abandonnés
  reconcileIntervalS: number; // CLOUD_RECONCILE_INTERVAL_S : réconciliation base ⇄ stockage réel
  orphanGraceS: number;      // CLOUD_ORPHAN_GRACE_S : âge minimal d'un objet inconnu de la base avant sa suppression
  maxPending: number;        // CLOUD_MAX_PENDING : envois simultanés par compte
  allowHttp: boolean;        // CLOUD_S3_ALLOW_HTTP=1 : point d'accès http (essais locaux seulement)
}

export interface BillingConfig {
  /** test : clés de test Stripe seulement (aucun paiement réel) ; live : paiements réels, sur décision du propriétaire. */
  mode: "test" | "live";
  secretKey: string;      // clé secrète (fichier), jamais journalisée ni renvoyée
  webhookSecret: string;  // secret de signature des webhooks (whsec_…), fichier
  /** Identifiants de prix Stripe : Annuel (récurrent, un an) et À vie (paiement unique). Leur type est revérifié chez
   *  Stripe avant toute vente (un prix qui ne correspond pas ferme la vente de l'offre). */
  prices: { annuel: string; vie: string };
  /** Configuration du portail client (bpc_…), sinon celle par défaut du compte Stripe. */
  portalConfiguration: string | null;
  /** Simulateur local de l'API Stripe (essais seulement) ; null = api.stripe.com. Interdit en mode réel. */
  apiHost: { host: string; port: number; protocol: "http" | "https" } | null;
  /** Délai de grâce après un paiement de renouvellement refusé (jours), pendant les relances de Stripe. */
  graceDays: number;
  /** Case « Conditions » obligatoire dans Checkout (URL des conditions déclarée dans Stripe). */
  requireTerms: boolean;
  /** TVA calculée par Stripe Tax (à n'activer qu'avec un régime de TVA décidé). */
  automaticTax: boolean;
  /** Facture Stripe pour le paiement unique d'À vie (invoice_creation, 0,4 % du montant) ; sinon reçu seulement. */
  invoiceOnce: boolean;
  /** Vendeur (confirmation du contrat sur support durable et formulaire de rétractation, L221-5 et L221-13 :
   *  identité, adresse, e-mail, téléphone, médiateur de la consommation) : exigé en mode réel, jamais inventé. */
  seller: { name: string; address: string; email: string; phone: string; mediator: string } | null;
  /** Mention de TVA écrite à côté de chaque prix des e-mails (franchise : « TVA non applicable, art. 293 B du CGI ») ;
   *  en mode réel, elle doit être donnée explicitement (BILLING_VAT_MENTION) : le régime est celui du propriétaire. */
  vatMention: string;
  /** Texte des CGV joint à la confirmation (support durable) : version texte publiée par le site (dist/legal/cgv.txt,
   *  scripts/prerender.mjs). BILLING_TERMS_URL, sinon `${PUBLIC_URL}/legal/cgv.txt`. */
  termsUrl: string | null;
  /** Ventes nouvelles ouvertes (BILLING_SALES=ouvertes, défaut) ; « fermees » : aucun nouvel achat, mais les clients
   *  existants gardent tout (portail, résiliation, rétractation, factures, webhooks, renouvellements). */
  salesOpen: boolean;
  /** Codes promo saisis sur la page de paiement (allow_promotion_codes) : BILLING_PROMO_CODES, actif par défaut, « 0 »
   *  pour couper. Le montant PAYÉ (remise comprise) est celui des e-mails, de l'historique et des remboursements. */
  promoCodes: boolean;
  /** Vente de Premium à vie ouverte (BILLING_OFFRE_VIE, défaut) ; « 0 » : fermée (offer_unavailable), les achats faits
   *  restent valables. Décision du propriétaire en attente (docs/FACTURATION.md §16). */
  lifetimeOpen: boolean;
}

export interface DiscordConfig {
  clientId: string;      // identifiant PUBLIC de l'application Discord (DISCORD_CLIENT_ID)
  clientSecret: string;  // secret client OAuth2 (DISCORD_CLIENT_SECRET_FILE), jamais journalisé
  redirectUri: string;   // `${PUBLIC_URL}/api/discord/callback`, déclaré tel quel dans le Developer Portal
  oauthBase: string;     // page d'autorisation (navigateur) : DISCORD_OAUTH_BASE, défaut https://discord.com
  apiBase: string;       // échange du code et /users/@me (serveur) : DISCORD_API_BASE, défaut `${oauthBase}/api`
  cdnBase: string;       // images de profil relayées (serveur) : DISCORD_CDN_BASE, défaut https://cdn.discordapp.com
  /** V3.5 : « Continuer avec Discord », connexion d'un compte AETHRYON DÉJÀ lié (DISCORD_LOGIN=1 ; même adresse de
   *  retour que la liaison : rien à déclarer de plus dans le Developer Portal). Jamais de création de compte. */
  login: boolean;
}

export class ConfigError extends Error {}

function readSecretFile(path: string | undefined, name: string, required: boolean): string | null {
  if (!path) {
    if (required) throw new ConfigError(`${name} manquant (variable ${name} non définie)`);
    return null;
  }
  let value: string;
  try {
    value = readFileSync(path, "utf8").trim();
  } catch {
    if (required) throw new ConfigError(`${name} : fichier illisible`);
    return null;
  }
  if (!value) {
    if (required) throw new ConfigError(`${name} : fichier vide`);
    return null;
  }
  return value;
}

function int(env: NodeJS.ProcessEnv, name: string, def: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new ConfigError(`${name} doit être un entier entre ${min} et ${max}`);
  return n;
}

function emailSet(raw: string | undefined): Set<string> {
  return new Set((raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}

/** Identifiants d'extension Chrome (32 lettres a–p), séparés par des virgules ; entrées vides ignorées. */
export function parseExtensionIds(raw: string | undefined): string[] {
  const out: string[] = [];
  for (const part of (raw ?? "").split(",")) {
    const id = part.trim();
    if (!id) continue;
    if (!/^[a-p]{32}$/.test(id)) throw new ConfigError("EXTENSION_IDS : chaque identifiant doit faire 32 lettres de a à p");
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function optionalUrl(raw: string | undefined, name: string): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  let u: URL;
  try { u = new URL(v); } catch { throw new ConfigError(`${name} n'est pas une URL valide`); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new ConfigError(`${name} doit être en http(s)`);
  return v.replace(/\/+$/, "");
}

/** « 10.251.10.0/24 » → entier réseau + masque (IPv4). */
export function parseCidr(raw: string): { net: number; mask: number } {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(raw.trim());
  if (!m) throw new ConfigError(`sous-réseau invalide : ${raw}`);
  const bits = Number(m[5]);
  const parts = m.slice(1, 5).map(Number);
  if (bits > 32 || parts.some((p) => p > 255)) throw new ConfigError(`sous-réseau invalide : ${raw}`);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  const ip = parts.reduce((acc, p) => ((acc << 8) | p) >>> 0, 0);
  return { net: (ip & mask) >>> 0, mask };
}

/**
 * Adresse de base de Discord (OAuth2 ou API). En https, sauf pour un faux serveur de test : hôte local
 * (localhost, 127.0.0.1) ou nom de service Docker sans point (réseau interne). Le secret client n'est donc
 * jamais envoyé en clair vers un hôte public.
 */
export function discordBase(raw: string | undefined, name: string, def: string): string {
  const v = (raw ?? "").trim() || def;
  let u: URL;
  try { u = new URL(v); } catch { throw new ConfigError(`${name} n'est pas une URL valide`); }
  if (u.search || u.hash || u.username || u.password) throw new ConfigError(`${name} : adresse de base attendue (sans paramètres)`);
  const localTest = u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || !u.hostname.includes("."));
  if (u.protocol !== "https:" && !localTest) throw new ConfigError(`${name} doit être en https (http seulement pour un faux serveur local de test)`);
  return v.replace(/\/+$/, "");
}

const SNOWFLAKE = /^\d{17,20}$/;

/**
 * Liaison Discord : ouverte seulement si l'identifiant public ET le secret client sont présents. Un secret
 * absent ou vide ferme proprement la fonction (aucune erreur au démarrage) ; une valeur présente mais
 * invalide est une erreur de configuration (le service refuse de démarrer, comme pour les autres réglages).
 */
function loadDiscord(env: NodeJS.ProcessEnv, publicUrl: string): DiscordConfig | null {
  const clientId = (env.DISCORD_CLIENT_ID ?? "").trim();
  const clientSecret = readSecretFile(env.DISCORD_CLIENT_SECRET_FILE, "DISCORD_CLIENT_SECRET_FILE", false);
  if (!clientId || !clientSecret) return null;
  if (!SNOWFLAKE.test(clientId)) throw new ConfigError("DISCORD_CLIENT_ID doit être l'identifiant numérique de l'application Discord");
  if (clientSecret.length < 16 || clientSecret.length > 200 || /\s/.test(clientSecret)) throw new ConfigError("DISCORD_CLIENT_SECRET_FILE : secret client invalide");
  const oauthBase = discordBase(env.DISCORD_OAUTH_BASE, "DISCORD_OAUTH_BASE", "https://discord.com");
  const apiBase = discordBase(env.DISCORD_API_BASE, "DISCORD_API_BASE", `${oauthBase}/api`);
  const cdnBase = discordBase(env.DISCORD_CDN_BASE, "DISCORD_CDN_BASE", "https://cdn.discordapp.com");
  const login = (env.DISCORD_LOGIN ?? "").trim() === "1";
  return { clientId, clientSecret, redirectUri: `${publicUrl}/api/discord/callback`, oauthBase, apiBase, cdnBase, login };
}

/**
 * Relais SMTP : ouvert seulement si l'utilisateur ET le mot de passe sont présents (mot de passe dans un fichier,
 * jamais en variable). STARTTLS est exigé, sauf pour un faux serveur local de test (SMTP_INSECURE_LOCAL=1 sur un hôte
 * localhost, 127.0.0.1 ou sans point).
 */
function loadMail(env: NodeJS.ProcessEnv): MailConfig | null {
  const user = (env.SMTP_USER ?? "").trim();
  const password = readSecretFile(env.SMTP_PASSWORD_FILE, "SMTP_PASSWORD_FILE", false);
  if (!user || !password) return null;
  const host = (env.SMTP_HOST ?? "").trim();
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(host)) throw new ConfigError("SMTP_HOST invalide ou absent");
  const from = (env.MAIL_FROM ?? "").trim();
  if (!/^[^<>\r\n]{1,60} <[^\s<>@]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}>$/.test(from)) {
    throw new ConfigError("MAIL_FROM doit être de la forme « Nom <adresse@domaine> »");
  }
  const insecureLocal = env.SMTP_INSECURE_LOCAL === "1";
  if (insecureLocal && !(host === "localhost" || host === "127.0.0.1" || !host.includes("."))) {
    throw new ConfigError("SMTP_INSECURE_LOCAL seulement pour un faux serveur local de test");
  }
  return { host, port: int(env, "SMTP_PORT", 587, 1, 65535), user, password, from, insecureLocal, dailyMax: int(env, "MAIL_DAILY_MAX", 150, 1, 100_000) };
}

/** Facturation : fermée par défaut ; mode test avec des clés de TEST seulement ; mode réel refusé sans clé réelle ET
 *  sans la confirmation explicite du propriétaire (BILLING_LIVE_CONFIRMED=oui). */
export function loadBilling(env: NodeJS.ProcessEnv): BillingConfig | null {
  const mode = (env.BILLING || "off").trim();
  if (mode === "off") return null;
  if (mode !== "test" && mode !== "live") throw new ConfigError("BILLING doit valoir off, test ou live");
  const secretKey = readSecretFile(env.STRIPE_SECRET_KEY_FILE, "STRIPE_SECRET_KEY_FILE", true)!;
  const webhookSecret = readSecretFile(env.STRIPE_WEBHOOK_SECRET_FILE, "STRIPE_WEBHOOK_SECRET_FILE", true)!;
  if (mode === "test" && !/^(sk|rk)_test_[A-Za-z0-9]{8,}$/.test(secretKey)) {
    throw new ConfigError("BILLING=test exige une clé secrète de TEST Stripe (sk_test_… ou rk_test_…)");
  }
  if (mode === "live") {
    if (!/^(sk|rk)_live_[A-Za-z0-9]{8,}$/.test(secretKey)) throw new ConfigError("BILLING=live exige une clé secrète réelle (sk_live_… ou rk_live_…)");
    if (env.BILLING_LIVE_CONFIRMED !== "oui") {
      throw new ConfigError("BILLING=live refusé : les paiements réels attendent la décision du propriétaire (BILLING_LIVE_CONFIRMED=oui)");
    }
  }
  if (!/^whsec_[A-Za-z0-9]{16,}$/.test(webhookSecret)) throw new ConfigError("STRIPE_WEBHOOK_SECRET_FILE : secret de signature attendu (whsec_…)");
  const SELLER_KEYS = ["BILLING_SELLER_NAME", "BILLING_SELLER_ADDRESS", "BILLING_SELLER_EMAIL", "BILLING_SELLER_PHONE", "BILLING_MEDIATOR"] as const;
  const sellerVals = SELLER_KEYS.map((k) => (env[k] ?? "").trim());
  if (sellerVals.some((v) => v.length > 300 || /[\r\n]/.test(v))) throw new ConfigError("BILLING_SELLER_* et BILLING_MEDIATOR : une ligne, 300 caractères au plus");
  const seller = sellerVals.every(Boolean)
    ? { name: sellerVals[0]!, address: sellerVals[1]!, email: sellerVals[2]!, phone: sellerVals[3]!, mediator: sellerVals[4]! }
    : null;
  if (mode === "live" && !seller) {
    throw new ConfigError(`BILLING=live exige l'identité du vendeur et son médiateur (${SELLER_KEYS.join(", ")}) : confirmation du contrat et formulaire de rétractation`);
  }
  const vat = (env.BILLING_VAT_MENTION ?? "").trim();
  if (vat.length > 120 || /[\r\n]/.test(vat)) throw new ConfigError("BILLING_VAT_MENTION : une ligne, 120 caractères au plus");
  if (mode === "live" && !vat) throw new ConfigError("BILLING=live exige la mention de TVA confirmée par le propriétaire (BILLING_VAT_MENTION)");
  const termsUrl = (env.BILLING_TERMS_URL ?? "").trim();
  if (termsUrl && !/^https?:\/\/[^\s]+$/.test(termsUrl)) throw new ConfigError("BILLING_TERMS_URL : URL http(s) attendue");
  const price = (name: string) => {
    const v = (env[name] ?? "").trim();
    if (!/^price_[A-Za-z0-9]{6,64}$/.test(v)) throw new ConfigError(`${name} : identifiant de prix Stripe attendu (price_…)`);
    return v;
  };
  const prices = { annuel: price("STRIPE_PRICE_ANNUEL"), vie: price("STRIPE_PRICE_VIE") };
  if (prices.annuel === prices.vie) throw new ConfigError("STRIPE_PRICE_ANNUEL et STRIPE_PRICE_VIE doivent différer");
  const portal = (env.STRIPE_PORTAL_CONFIGURATION ?? "").trim();
  if (portal && !/^bpc_[A-Za-z0-9]{6,64}$/.test(portal)) throw new ConfigError("STRIPE_PORTAL_CONFIGURATION : identifiant bpc_… attendu");
  let apiHost: BillingConfig["apiHost"] = null;
  if (env.STRIPE_API_BASE) {
    if (mode !== "test") throw new ConfigError("STRIPE_API_BASE (simulateur local) est interdit en mode réel");
    let u: URL;
    try { u = new URL(env.STRIPE_API_BASE); } catch { throw new ConfigError("STRIPE_API_BASE : URL invalide"); }
    apiHost = { host: u.hostname, port: Number(u.port || (u.protocol === "http:" ? 80 : 443)), protocol: u.protocol === "http:" ? "http" : "https" };
  }
  return {
    mode, secretKey, webhookSecret, prices, portalConfiguration: portal || null, apiHost,
    graceDays: int(env, "BILLING_GRACE_DAYS", 7, 0, 30),
    requireTerms: env.BILLING_REQUIRE_TERMS === "1",
    automaticTax: env.BILLING_AUTOMATIC_TAX === "1",
    invoiceOnce: env.BILLING_INVOICE_ONCE === "1",
    salesOpen: (env.BILLING_SALES ?? "ouvertes").trim() !== "fermees",
    promoCodes: (env.BILLING_PROMO_CODES ?? "1").trim() !== "0",
    lifetimeOpen: (env.BILLING_OFFRE_VIE ?? "1").trim() !== "0",
    seller,
    vatMention: vat || "TVA non applicable, art. 293 B du CGI",
    termsUrl: termsUrl || null,
  };
}

function loadDiscordInternal(env: NodeJS.ProcessEnv, internalToken: string): Config["discordInternal"] {
  const token = readSecretFile(env.DISCORD_INTERNAL_TOKEN_FILE, "DISCORD_INTERNAL_TOKEN_FILE", false);
  if (!token) return null;
  if (token.length < 32) throw new ConfigError("le secret interne du bot Discord doit faire au moins 32 caractères");
  // Le bot ne doit jamais pouvoir se faire passer pour ytapi (ni l'inverse) : deux secrets distincts.
  if (token === internalToken) throw new ConfigError("DISCORD_INTERNAL_TOKEN_FILE doit différer du jeton interne de ytapi");
  return {
    token,
    port: int(env, "DISCORD_INTERNAL_PORT", 3002, 1, 65535),
    allowFrom: env.DISCORD_INTERNAL_ALLOW_FROM ? parseCidr(env.DISCORD_INTERNAL_ALLOW_FROM) : null,
  };
}

export function ipInCidr(ip: string, cidr: { net: number; mask: number }): boolean {
  const v4 = ip.replace(/^::ffff:/, "");
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v4);
  if (!m) return false;
  const n = m.slice(1, 5).map(Number).reduce((acc, p) => ((acc << 8) | p) >>> 0, 0);
  return ((n & cidr.mask) >>> 0) === cidr.net;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const publicUrl = optionalUrl(env.PUBLIC_URL, "PUBLIC_URL");
  if (!publicUrl) throw new ConfigError("PUBLIC_URL manquant");
  const publicOrigin = new URL(publicUrl).origin;

  const authSecret = readSecretFile(env.BETTER_AUTH_SECRET_FILE, "BETTER_AUTH_SECRET_FILE", true)!;
  if (authSecret.length < 32) throw new ConfigError("le secret Better Auth doit faire au moins 32 caractères");
  const internalToken = readSecretFile(env.INTERNAL_TOKEN_FILE, "INTERNAL_TOKEN_FILE", true)!;
  if (internalToken.length < 32) throw new ConfigError("le jeton interne doit faire au moins 32 caractères");

  // Google n'est activé que si les deux fichiers existent et ne sont pas vides.
  const clientId = readSecretFile(env.GOOGLE_CLIENT_ID_FILE, "GOOGLE_CLIENT_ID_FILE", false);
  const clientSecret = readSecretFile(env.GOOGLE_CLIENT_SECRET_FILE, "GOOGLE_CLIENT_SECRET_FILE", false);
  const google = clientId && clientSecret ? { clientId, clientSecret } : null;

  const icloud = optionalUrl(env.ICLOUD_SHORTCUT_URL, "ICLOUD_SHORTCUT_URL");
  if (icloud && !/^https:\/\/www\.icloud\.com\/shortcuts\/[0-9a-f]{32}$/.test(icloud)) {
    throw new ConfigError("ICLOUD_SHORTCUT_URL doit être de la forme https://www.icloud.com/shortcuts/<32 caractères hexadécimaux>");
  }

  return {
    publicUrl,
    publicOrigin,
    authSecret,
    google,
    internalToken,
    dbPath: env.DB_PATH || "/data/account.sqlite",
    backupDir: env.BACKUP_DIR || "/data/backups",
    ytapiInternalUrl: optionalUrl(env.YTAPI_INTERNAL_URL, "YTAPI_INTERNAL_URL"),
    icloudShortcutUrl: icloud,
    shortcutVersion: (env.SHORTCUT_VERSION || "1.1").slice(0, 20),
    fallbackDownload: env.FALLBACK_DOWNLOAD || "/downloads/AETHRYON.shortcut",
    apiPublicUrl: optionalUrl(env.API_PUBLIC_URL, "API_PUBLIC_URL") ?? "https://api.malvu.fr/media",
    dailyConversions: int(env, "DAILY_CONVERSIONS", 10, 0, 10_000),
    maxActiveJobs: int(env, "MAX_ACTIVE_JOBS", 1, 1, 10),
    techMaxActive: int(env, "TECH_MAX_ACTIVE_PER_USER", 5, 1, 20),
    maxKeysPerUser: int(env, "MAX_KEYS_PER_USER", 2, 1, 20),
    maxUsers: int(env, "MAX_USERS", 50, 1, 100_000),
    adminEmails: emailSet(env.ADMIN_EMAILS),
    allowedEmails: emailSet(env.ALLOWED_EMAILS),
    retentionUsageDays: int(env, "RETENTION_USAGE_DAYS", 90, 1, 3650),
    retentionAdminEventDays: int(env, "RETENTION_ADMIN_EVENT_DAYS", 365, 1, 3650),
    sessionDays: int(env, "SESSION_DAYS", 30, 1, 365),
    publicPort: int(env, "PUBLIC_PORT", 3000, 1, 65535),
    internalPort: int(env, "INTERNAL_PORT", 3001, 1, 65535),
    ipHeader: (env.TRUST_PROXY_IP_HEADER || "x-real-ip").toLowerCase(),
    allowTestSessions: env.YTC_ALLOW_TEST_SESSIONS === "1",
    internalAllowFrom: env.INTERNAL_ALLOW_FROM ? parseCidr(env.INTERNAL_ALLOW_FROM) : null,
    keysActive: env.USER_KEYS_ACTIVE === "1",
    extensionIds: parseExtensionIds(env.EXTENSION_IDS),
    discord: loadDiscord(env, publicUrl),
    discordInternal: loadDiscordInternal(env, internalToken),
    mail: loadMail(env),
    signupResendS: int(env, "SIGNUP_RESEND_S", 60, 0, 3600),
    toolsEnabled: env.TOOLS_ENABLED === "1",
    musicEnabled: env.MUSIC_RELAY === "1",
    billing: loadBilling(env),
    plansActive: env.PLANS_ACTIVE === "1",
    toolsExportLimit: env.TOOLS_EXPORT_LIMIT === "1",
    discordPaidBenefits: env.DISCORD_PAID_BENEFITS === "1",
    premiereLink: env.PREMIERE_CONNEXION === "1",
    desktopLink: env.DESKTOP_CONNEXION === "1",
    cloud: loadCloud(env),
    antibot: loadAntibot(env),
  };
}

/** Protection anti-bot : « off » sans rien lire ; « observe » ou « on » exigent Cap (URL interne, clé, secret). */
export function loadAntibot(env: NodeJS.ProcessEnv): AntibotConfig {
  const raw = (env.ANTIBOT || "off").trim().toLowerCase();
  if (raw !== "off" && raw !== "observe" && raw !== "on") throw new ConfigError("ANTIBOT doit valoir off, observe ou on");
  const mode = raw as AntibotMode;
  const base = {
    ticketTtlS: int(env, "ANTIBOT_TICKET_TTL_S", 300, 1, 1800),
    passTtlS: int(env, "ANTIBOT_PASS_TTL_S", 1800, 60, 86_400),
    blockS: int(env, "ANTIBOT_BLOCK_S", 900, 30, 86_400),
    loginFailures: int(env, "ANTIBOT_LOGIN_FAILURES", 3, 1, 50),
    travauxSeuil: int(env, "ANTIBOT_TRAVAUX_SEUIL", 12, 1, 1000),
    echecsBlocage: int(env, "ANTIBOT_ECHECS_BLOCAGE", 5, 2, 100),
    eventDays: int(env, "ANTIBOT_EVENT_DAYS", 14, 1, 90),
    counterDays: int(env, "ANTIBOT_COUNTER_DAYS", 90, 7, 400),
  };
  if (mode === "off") return { mode, capUrl: null, siteKey: null, secret: null, ...base };
  const capUrl = optionalUrl(env.CAP_INTERNAL_URL, "CAP_INTERNAL_URL");
  if (!capUrl || !capUrl.startsWith("http://")) throw new ConfigError("CAP_INTERNAL_URL manquant (http://<conteneur Cap>:3000, réseau interne)");
  // Clé de site : publique (le navigateur la voit), lue dans CAP_SITE_KEY ou dans un fichier (créé par deploy/cap-secrets.sh).
  const siteKey = (env.CAP_SITE_KEY || readSecretFile(env.CAP_SITE_KEY_FILE, "CAP_SITE_KEY_FILE", false) || "").trim();
  if (!/^[0-9a-f]{10}$/.test(siteKey)) throw new ConfigError("CAP_SITE_KEY : clé de site Cap attendue (10 caractères hexadécimaux)");
  const secret = readSecretFile(env.CAP_SECRET_FILE, "CAP_SECRET_FILE", true)!;
  if (!/^sk-[A-Za-z0-9]{20,100}$/.test(secret)) throw new ConfigError("CAP_SECRET_FILE : secret de clé de site Cap attendu (sk-…)");
  return { mode, capUrl: capUrl.replace(/\/+$/, ""), siteKey, secret, ...base };
}

const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const REGION_RE = /^[a-z0-9-]{1,40}$/;
const PREFIX_RE = /^(?:[A-Za-z0-9._-]+\/){1,4}$/;

/** AETHRYON Cloud : null tant que CLOUD ≠ on. Activé, toute erreur de configuration empêche le démarrage. */
export function loadCloud(env: NodeJS.ProcessEnv): CloudConfig | null {
  const mode = (env.CLOUD ?? "off").trim().toLowerCase();
  if (mode === "off" || mode === "") return null;
  if (mode !== "on") throw new ConfigError("CLOUD doit valoir on ou off");
  const allowHttp = env.CLOUD_S3_ALLOW_HTTP === "1";
  const endpoint = optionalUrl(env.CLOUD_S3_ENDPOINT, "CLOUD_S3_ENDPOINT");
  if (!endpoint) throw new ConfigError("CLOUD_S3_ENDPOINT manquant");
  const u = new URL(endpoint);
  if (u.protocol !== "https:" && !allowHttp) throw new ConfigError("CLOUD_S3_ENDPOINT doit être en https");
  if (u.username || u.password || (u.pathname !== "/" && u.pathname !== "") || u.search) throw new ConfigError("CLOUD_S3_ENDPOINT : origine seule attendue (sans seau, chemin ni identifiants)");
  const region = (env.CLOUD_S3_REGION ?? "").trim();
  if (!REGION_RE.test(region)) throw new ConfigError("CLOUD_S3_REGION invalide (ex. eu-central-003, auto)");
  const bucket = (env.CLOUD_S3_BUCKET ?? "").trim();
  if (!BUCKET_RE.test(bucket)) throw new ConfigError("CLOUD_S3_BUCKET invalide");
  const accessKeyId = readSecretFile(env.CLOUD_S3_ACCESS_KEY_ID_FILE, "CLOUD_S3_ACCESS_KEY_ID_FILE", true)!;
  const secretAccessKey = readSecretFile(env.CLOUD_S3_SECRET_ACCESS_KEY_FILE, "CLOUD_S3_SECRET_ACCESS_KEY_FILE", true)!;
  if (!/^[A-Za-z0-9]{8,128}$/.test(accessKeyId)) throw new ConfigError("CLOUD_S3_ACCESS_KEY_ID_FILE : identifiant de clé invalide");
  if (secretAccessKey.length < 16 || secretAccessKey.length > 256 || /\s/.test(secretAccessKey)) throw new ConfigError("CLOUD_S3_SECRET_ACCESS_KEY_FILE : secret invalide");
  const prefix = env.CLOUD_S3_PREFIX?.trim() || "aethryon-cloud/";
  if (!PREFIX_RE.test(prefix)) throw new ConfigError("CLOUD_S3_PREFIX : segments [A-Za-z0-9._-] terminés par « / »");
  const GB = 1_000_000_000;
  const quotaBytes = int(env, "CLOUD_QUOTA_BYTES", 9 * GB, 1, 1_000 * GB);
  const globalQuotaBytes = int(env, "CLOUD_GLOBAL_QUOTA_BYTES", 9 * GB, 1, 10_000 * GB);
  const maxFileBytes = int(env, "CLOUD_MAX_FILE_BYTES", 2 * GB, 1, 5 * GB); // PutObject seul : 5 Go au plus (S3)
  if (maxFileBytes > quotaBytes) throw new ConfigError("CLOUD_MAX_FILE_BYTES dépasse CLOUD_QUOTA_BYTES");
  return {
    endpoint, region, bucket, accessKeyId, secretAccessKey, prefix, quotaBytes, globalQuotaBytes, maxFileBytes, allowHttp,
    forcePathStyle: env.CLOUD_S3_PATH_STYLE === "1",
    versions: (env.CLOUD_S3_VERSIONS ?? "1") !== "0",
    retentionDays: int(env, "CLOUD_RETENTION_DAYS", 30, 1, 3650),
    putTtlS: int(env, "CLOUD_PUT_URL_TTL_S", 900, 1, 7 * 86_400),
    getTtlS: int(env, "CLOUD_GET_URL_TTL_S", 300, 1, 86_400),
    taskIntervalS: int(env, "CLOUD_TASK_INTERVAL_S", 600, 5, 86_400),
    reconcileIntervalS: int(env, "CLOUD_RECONCILE_INTERVAL_S", 6 * 3600, 60, 7 * 86_400),
    orphanGraceS: int(env, "CLOUD_ORPHAN_GRACE_S", 24 * 3600, 0, 30 * 86_400),
    maxPending: int(env, "CLOUD_MAX_PENDING", 10, 1, 100),
  };
}

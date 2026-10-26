// Configuration du bot. Le token n'est JAMAIS lu dans une variable d'environnement en clair ni écrit dans un
// journal : il vient d'un fichier secret monté en lecture seule (DISCORD_BOT_TOKEN_FILE, par défaut
// /run/secrets/discord_bot_token), écrit sur le VPS par deploy/discord-secret.sh (saisie masquée).
// Les identifiants d'application et de serveur ne sont pas secrets (ils viennent du fichier bot.env, hors git).
// Liaison et conversion (docs/DISCORD-BOT.md §17) : FERMÉES par défaut ; LINK_ENABLED=1 ouvre /account (compte
// lié, quota), CONVERT_ENABLED=1 (avec LINK_ENABLED=1) ouvre /convert. Elles exigent le secret partagé avec
// account (DISCORD_INTERNAL_TOKEN_FILE, par défaut /run/secrets/discord_internal_token), écrit par
// deploy/discord-liaison-secrets.sh, et l'API interne d'account (ACCOUNT_INTERNAL_URL, réseau Docker interne).
import { readFileSync } from "node:fs";

export const SNOWFLAKE = /^\d{17,20}$/;
/** Forme d'un token de bot Discord : trois segments base64url séparés par des points. */
export const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{20,}$/;

export interface Config {
  clientId: string;
  guildId: string;
  siteUrl: string;
  apiHealthUrl: string;
  /** Page des conditions d'utilisation, citée par /help SEULEMENT si elle est publiée (AETHRYON_TERMS_PUBLISHED=1). */
  termsPublished: boolean;
  /** /account lit le compte AETHRYON lié (API interne d'account). Défaut : fermé (message honnête). */
  linkEnabled: boolean;
  /** /convert lance une vraie conversion (exige linkEnabled). Défaut : fermé (message honnête). */
  convertEnabled: boolean;
  /** Toutes les fonctions (version 2). */
  features: Features;
  /** Emoji d'application de la chouette (null : aucun). */
  emoji: string | null;
  /** API interne d'account réservée au bot (http, réseau Docker interne seulement). */
  accountUrl: string;
  /** API publique de conversion (ytapi), comme le raccourci et l'extension. */
  ytapiUrl: string;
}

/** Secret partagé bot ↔ account (fichier monté), exigé seulement si la liaison est ouverte. */
export function readInternalToken(env: NodeJS.ProcessEnv = process.env, read: (p: string) => string = (p) => readFileSync(p, "utf8")): string {
  const file = env.DISCORD_INTERNAL_TOKEN_FILE ?? "/run/secrets/discord_internal_token";
  let raw: string;
  try {
    raw = read(file);
  } catch {
    throw new ConfigError(`secret interne introuvable (${file}) : lancer deploy/discord-liaison-secrets.sh sur le VPS`);
  }
  const token = raw.trim();
  if (token.length < 32 || /\s/.test(token)) throw new ConfigError(`le fichier ${file} ne contient pas un secret interne valide (32 caractères au moins)`);
  return token;
}

/** Fonctions ouvertes (sans exiger les identifiants : sert aussi à afficher les commandes hors ligne). Version 2
 *  (docs/DISCORD-BOT.md §18) : chaque fonction a son drapeau ; une commande ou un bouton n'apparaît que si elle marche
 *  vraiment (les dépendances sont vérifiées ici). */
export type { Features } from "./v2/ui.ts";
import type { Features } from "./v2/ui.ts";
const NEEDS: [keyof Features, string, (keyof Features)[]][] = [
  ["convert", "CONVERT_ENABLED", ["link"]],
  ["files", "FILES_ENABLED", ["convert"]],
  ["library", "LIBRARY_ENABLED", ["link"]],
  ["guildConfig", "GUILD_CONFIG_ENABLED", ["link"]],
  ["autoEmbeds", "AUTO_EMBEDS_ENABLED", ["guildConfig", "convert"]],
  ["preview", "PREVIEW_ENABLED", ["convert"]],
  ["compress", "COMPRESS_ENABLED", ["files"]],
  ["clip", "CLIP_ENABLED", ["convert"]],
  ["gif", "GIF_ENABLED", ["convert"]],
  ["tools", "TOOLS_ENABLED", ["convert"]],
];
export function featuresOf(env: NodeJS.ProcessEnv = process.env): Features {
  const f = { link: flag(env, "LINK_ENABLED") } as Features;
  for (const [k, name, needs] of NEEDS) {
    f[k] = flag(env, name);
    for (const n of needs) if (f[k] && !f[n]) throw new ConfigError(`${name}=1 exige ${NEEDS.find(([x]) => x === n)?.[1] ?? "LINK_ENABLED"}=1`);
  }
  return f;
}

/** Chouette officielle en emoji d'application (« <:aethryon:ID> », téléversée dans le Developer Portal), ou null. */
export function brandEmoji(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = (env.AETHRYON_EMOJI ?? "").trim();
  if (!v) return null;
  if (!/^<a?:[A-Za-z0-9_]{2,32}:\d{17,20}>$/.test(v)) throw new ConfigError("AETHRYON_EMOJI doit avoir la forme <:nom:identifiant> (emoji d'application)");
  return v;
}

function flag(env: NodeJS.ProcessEnv, name: string): boolean {
  const v = env[name];
  if (v === undefined || v === "" || v === "0") return false;
  if (v === "1") return true;
  throw new ConfigError(`${name} doit valoir 0 ou 1`);
}

/** Adresse de l'API interne d'account : http seulement (réseau Docker interne, jamais une adresse publique). */
function internalUrl(raw: string | undefined): string {
  const v = (raw ?? "http://account-discord:3002").trim().replace(/\/+$/, "");
  let u: URL;
  try { u = new URL(v); } catch { throw new ConfigError("ACCOUNT_INTERNAL_URL n'est pas une URL valide"); }
  if (u.protocol !== "http:" || u.search || u.hash) throw new ConfigError("ACCOUNT_INTERNAL_URL doit être une adresse http:// du réseau interne (sans paramètres)");
  return v;
}

function publicUrl(raw: string | undefined, def: string, name: string): string {
  const v = (raw ?? def).trim().replace(/\/+$/, "");
  let u: URL;
  try { u = new URL(v); } catch { throw new ConfigError(`${name} n'est pas une URL valide`); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new ConfigError(`${name} doit être en http(s)`);
  return v;
}

export class ConfigError extends Error {}

/** Lien d'invitation au serveur : portées bot + commandes slash, AUCUNE permission (permissions=0). */
export const inviteUrl = (clientId: string) => `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot+applications.commands&permissions=0&integration_type=0`;

function snowflake(name: string, value: string | undefined): string {
  if (!value || !SNOWFLAKE.test(value)) throw new ConfigError(`${name} manquant ou invalide (identifiant Discord numérique attendu)`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const features = featuresOf(env);
  const { link: linkEnabled, convert: convertEnabled } = features;
  return {
    clientId: snowflake("DISCORD_CLIENT_ID", env.DISCORD_CLIENT_ID),
    guildId: snowflake("DISCORD_GUILD_ID", env.DISCORD_GUILD_ID),
    siteUrl: publicUrl(env.AETHRYON_SITE_URL, "https://raccourci.malvu.fr", "AETHRYON_SITE_URL"),
    apiHealthUrl: env.AETHRYON_API_HEALTH_URL ?? "https://api.malvu.fr/media/health",
    termsPublished: env.AETHRYON_TERMS_PUBLISHED === "1",
    linkEnabled,
    convertEnabled,
    features,
    emoji: brandEmoji(env),
    accountUrl: internalUrl(env.ACCOUNT_INTERNAL_URL),
    ytapiUrl: publicUrl(env.YTAPI_URL, "https://api.malvu.fr/media", "YTAPI_URL"),
  };
}

/** Identifiant de l'application encodé dans le 1er segment du token (public : c'est l'ID du bot), ou null.
 *  Permet de vérifier HORS LIGNE que le token appartient bien à DISCORD_CLIENT_ID. */
export function tokenAppId(token: string): string | null {
  const first = token.split(".")[0] ?? "";
  try {
    const id = Buffer.from(first, "base64url").toString("utf8");
    return SNOWFLAKE.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Lit le token depuis son fichier secret ; erreur explicite (sans jamais citer la valeur) s'il manque. */
export function readToken(env: NodeJS.ProcessEnv = process.env, read: (p: string) => string = (p) => readFileSync(p, "utf8")): string {
  const file = env.DISCORD_BOT_TOKEN_FILE ?? "/run/secrets/discord_bot_token";
  let raw: string;
  try {
    raw = read(file);
  } catch {
    throw new ConfigError(`token introuvable (${file}) : lancer deploy/discord-secret.sh sur le VPS`);
  }
  const token = raw.trim();
  if (!TOKEN_SHAPE.test(token)) throw new ConfigError(`le fichier ${file} ne contient pas un token de bot valide (forme attendue : trois segments)`);
  return token;
}

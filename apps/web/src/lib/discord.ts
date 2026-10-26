// Bot Discord AETHRYON : UNE source pour ce que le site en dit (héros, solutions, schéma « Un compte », feuille de
// route, questions, guide de l'espace, annonce). Statut lu sur la phase de production (DISCORD_PHASE ci-dessous) :
// bot v2 en service (« media », « media-auto ») = « Disponible » (public, plus en bêta depuis le 2026-10-18), avec les liens d'ajout RÉELS de Discord
// (DISCORD_INSTALL) ; avant, « En développement », sans aucun lien (du code existe et se teste, pas encore publié).

/** Commande de conversion du bot, sous son nom RÉEL (discord/src/commands.ts) : jamais « /convertir ». */
export const DISCORD_CONVERT = "/convert";

/** Ce que le bot fait RÉELLEMENT en production, fixé à la construction (DISCORD_PHASE, web/Dockerfile) pour que les
 *  Conditions d'utilisation et la page Confidentialité disent toujours vrai ; la valeur change à chaque étape du
 *  plan de mise en production (docs/DISCORD-BOT.md §17) :
 *  - « inactif » (défaut) : aucune commande enregistrée auprès de Discord, aucun programme du bot en service ;
 *  - « informations » : le bot répond à /ping, /help et /status ; /convert et /account disent seulement que la
 *    liaison au compte AETHRYON n'est pas ouverte ;
 *  - « conversion » : liaison du compte Discord (depuis l'espace) et conversion par /convert ouvertes ;
 *  - « media » : bot v2 (docs/DISCORD-BOT.md §18) avec TOUTES ses fonctions de compte ouvertes (fichiers joints, aperçu,
 *    extraits, GIF, compression, bibliothèque, préférences, réglages de serveur), cartes automatiques FERMÉES ;
 *  - « media-auto » : comme « media », et cartes automatiques possibles sur les serveurs dont un administrateur les
 *    active (le bot lit alors les messages de ces salons pour y repérer les liens). */
export type DiscordPhase = "inactif" | "informations" | "conversion" | "media" | "media-auto";
const PHASES: readonly DiscordPhase[] = ["inactif", "informations", "conversion", "media", "media-auto"];
const rawPhase = import.meta.env.VITE_DISCORD_PHASE as string | undefined;
export const DISCORD_PHASE: DiscordPhase = PHASES.includes(rawPhase as DiscordPhase) ? (rawPhase as DiscordPhase) : "inactif";
/** Le bot convertit pour un compte relié (phases « conversion », « media », « media-auto »). */
export const DISCORD_CONVERTS = DISCORD_PHASE === "conversion" || DISCORD_PHASE === "media" || DISCORD_PHASE === "media-auto";
/** Bot v2 en service (fichiers joints, aperçu, extraits, GIF, bibliothèque, préférences, réglages de serveur). */
export const DISCORD_MEDIA = DISCORD_PHASE === "media" || DISCORD_PHASE === "media-auto";
/** Cartes automatiques possibles (activées serveur par serveur par un administrateur). */
export const DISCORD_AUTO = DISCORD_PHASE === "media-auto";

/** Le bot est ouvert à tous : bot v2 en service. */
export const DISCORD_PUBLIC = DISCORD_MEDIA;
export const DISCORD_STATUS = DISCORD_PUBLIC
  ? { label: "Disponible", lower: "disponible", state: "ready" as const, tone: "ok" as const }
  : { label: "En développement", lower: "en développement", state: "dev" as const, tone: "warn" as const };

/** Identifiant PUBLIC de l'application Discord AETHRYON (il figure dans toute invitation ; aucun secret). */
const DISCORD_APP_ID = "1558821698734923796";
/** Liens d'ajout RÉELS (pages d'autorisation de Discord), réglés côté Discord (docs/DEPLOIEMENT.md §21) :
 *  - user : « Ajouter à mes applications », le bot suit la personne partout (commandes seulement, aucune permission) ;
 *  - guild : « Ajouter à un serveur » (administrateur du serveur), avec les permissions du bot, sans rôle
 *    d'administration : voir les salons, lire l'historique, envoyer des messages (et dans les fils), intégrer des
 *    liens, joindre des fichiers, ajouter des réactions, émojis externes (274878286912). */
export const DISCORD_INSTALL = {
  user: `https://discord.com/oauth2/authorize?client_id=${DISCORD_APP_ID}&integration_type=1&scope=applications.commands`,
  guild: `https://discord.com/oauth2/authorize?client_id=${DISCORD_APP_ID}&integration_type=0&scope=applications.commands+bot&permissions=274878286912`,
} as const;

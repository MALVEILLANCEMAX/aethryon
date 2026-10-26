// Types alignés sur docs/CONTRAT.md §4 (API publique du service account).
export interface Changelog { version: string; date: string; notes: string[] }
export interface PublicConfig {
  googleEnabled: boolean;
  /** V3.5 : « Continuer avec Discord » ouvert (compte déjà lié seulement). */
  discordLogin?: boolean;
  /** Inscription et connexion par e-mail et mot de passe (account : relais SMTP configuré). Absent : serveur plus ancien. */
  emailEnabled?: boolean;
  keysActive: boolean; // les jetons sont-ils déjà acceptés par le service de conversion ?
  signupsOpen: boolean;
  icloudUrl: string | null;
  shortcutVersion: string;
  fallbackDownload: string;
  apiPublicUrl: string;
  /** exportMinutes : minutes d'export de Tools de Gratuit quand une limite s'applique, null sinon (absent : ancien serveur). */
  quotas: { daily: number; maxActive: number; maxKeys: number; exportMinutes?: number | null };
  changelog: Changelog[];
  /** Bandeau de l'administrateur (≤ 280 caractères), ou null. */
  maintenanceMessage?: string | null;
  /** Plateformes acceptées en ce moment (réglage du Control Center ; X y est nommé « twitter »). */
  platforms?: Partial<Record<"youtube" | "tiktok" | "twitter", boolean>>;
}
export type ServiceState = "ok" | "degraded" | "down" | "paused";
export interface ServiceStatus { state: ServiceState; message: string; checkedAt: string }
/** Quota du jour (account, usage.ts) : remis à zéro au prochain minuit de Paris (`resetAt`). `limit` et
 *  `remaining` valent null quand le compte est illimité (rôle admin ou réglage du Control Center) ;
 *  `bonus` : conversions offertes pour aujourd'hui, déjà comprises dans `limit`. */
export interface Today { used: number; limit: number | null; remaining: number | null; unlimited?: boolean; bonus?: number; resetAt: string }
export interface User {
  id: string; email: string; name: string; role: "user" | "admin" | string; status: string;
  createdAt: string; lastLoginAt: string | null;
}
/** Espace › Abonnement (GET /api/abonnement) : l'offre réelle du compte et ses demandes « Me prévenir ». */
/** Offre effective du compte ; `checkout` : paiement ouvert sur ce serveur (account, BILLING). */
export interface Abonnement { plan: { id: "free" | "annuel" | "vie"; name: string; beta: boolean }; checkout: boolean; prevenir: boolean }
export interface Me {
  user: User; today: Today; keys: { active: number; max: number }; maxActive: number;
  /** Façons de se connecter à ce compte (account ; absent : serveur plus ancien). */
  login?: { google: boolean; password: boolean };
  /** Tools : minutes d'export du jour (account V2 ; absent : serveur plus ancien ; limit null : aucune limite). */
  exportMinutes?: { used: number; limit: number | null };
}
export type KeyStatus = "active" | "revoked" | "expired";
/** « shortcut » : jeton du raccourci (créé dans « Mes jetons ») ; « extension » : extension navigateur liée ;
 *  « premiere » : panneau AETHRYON pour Premiere Pro connecté par la page d'accord /premiere/connecter ;
 *  « discord » : clé de 15 min émise pour le bot Discord (jamais listée dans « Mes jetons », seulement dans l'export). */
export type KeyKind = "shortcut" | "extension" | "discord" | "premiere" | "desktop";
export interface ApiKey {
  id: string; name: string; start: string; createdAt: string; lastUsedAt: string | null;
  expiresAt: string | null; revokedAt: string | null; status: KeyStatus;
  kind: KeyKind; deviceLabel: string | null;
}
export interface CreatedKey { key: ApiKey; secret: string; revokedKeyId?: string }
export type UsageState = "reserved" | "running" | "done" | "error" | "cancelled" | "refunded";
export interface ActivityItem {
  id: string; createdAt: string; finishedAt: string | null; fmt: "mp3" | "mp4" | string; platform: string | null;
  state: UsageState; errorCode: string | null; errorMessage: string | null;
  /** Accès d'où vient la conversion (type de la clé) : shortcut, extension, discord, outils ; null si la clé n'existe plus. */
  source?: string | null;
}
/** Liaison Discord (GET /api/discord, docs/DISCORD-BOT.md §17). `enabled` : liaison ouverte sur ce serveur ;
 *  un compte déjà lié reste visible et déliable même quand elle est fermée. */
export interface DiscordLink {
  name: string; linkedAt: string; lastUsedAt: string | null;
  /** Nom d'affichage Discord (absent s'il est identique au nom d'utilisateur, ou pour un compte account plus ancien). */
  displayName?: string | null;
  /** Version de l'image de profil (fin de son empreinte) : sert à rafraîchir /api/discord/avatar ; null = image par défaut. */
  avatarVersion?: string | null;
}
/** Ce qui est relié à Discord pour ce compte (account, discord.activity) : conversions lancées depuis Discord sur
 *  30 jours, médias enregistrés, préférences du bot. */
export interface DiscordActivity { conversions30d: number; saved: number; prefs: { fmt: string; quality: string; visibility: string } }
export interface DiscordStatus { enabled: boolean; linked: boolean; discord: DiscordLink | null; activity?: DiscordActivity }

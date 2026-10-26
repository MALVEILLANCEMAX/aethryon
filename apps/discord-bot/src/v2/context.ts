// Où le bot répond, et s'il peut répondre en PUBLIC (docs/DISCORD-BOT.md §19). Tiré de l'interaction elle-même :
// - `context` : 0 serveur, 1 message privé avec le bot, 2 conversation privée ou de groupe entre utilisateurs ;
// - `authorizing_integration_owners` : « 0 » = AETHRYON est installé sur CE serveur, « 1 » = sur le compte de
//   l'utilisateur (le bot peut alors être absent du serveur) ;
// - permission USE_EXTERNAL_APPS (1 << 50) du membre : « Allows user-installed apps to send public responses. When
//   disabled, users will still be allowed to use their apps but the responses will be ephemeral. This only applies to
//   apps not also installed to the server. » (docs Discord, Permissions) ;
// - `app_permissions` : ATTACH_FILES pour joindre le fichier à une réponse publique (en conversation privée, Discord
//   les accorde toujours : « includes ATTACH_FILES | EMBED_LINKS | MENTION_EVERYONE permissions for (G)DMs »).
// Fonctions pures, testées : la même règle sert à /convert, au bouton « Partager » et aux cartes.

export type Place = "guild" | "bot_dm" | "private";

export interface Where {
  place: Place;
  /** AETHRYON installé sur ce serveur (le bot y est, /config s'y applique). */
  guildInstall: boolean;
  /** AETHRYON installé sur le compte de l'utilisateur. */
  userInstall: boolean;
  /** Le membre a « Utiliser des applications externes » (null : inconnu, hors serveur). */
  externalApps: boolean | null;
  /** L'application peut joindre des fichiers ici (null : inconnu). */
  appAttach: boolean | null;
}

export type Refusal = "files_closed" | "bot_dm" | "server_off" | "external_apps" | "no_attach";
export type Verdict = { public: true } | { public: false; reason: Refusal };

/** Déduit `Where` des champs bruts de l'interaction (aucune requête). */
export function whereOf(raw: {
  context: number | null | undefined; guildId: string | null; userId: string;
  owners: Record<string, string | undefined> | null | undefined;
  memberExternalApps: boolean | null; appAttach: boolean | null;
}): Where {
  const place: Place = raw.context === 1 ? "bot_dm" : raw.context === 2 ? "private" : raw.guildId ? "guild" : "private";
  const owners = raw.owners ?? {};
  // Sans `authorizing_integration_owners` (ancienne forme) : dans un serveur, on suppose l'installation de serveur.
  const known = Object.keys(owners).length > 0;
  const guildInstall = place === "guild" && (known ? owners["0"] === raw.guildId : true);
  const userInstall = known ? owners["1"] === raw.userId : !raw.guildId;
  return { place, guildInstall, userInstall, externalApps: place === "guild" ? raw.memberExternalApps : null, appAttach: raw.appAttach };
}

/** Un résultat peut-il être publié ici ? `guildShare` : réglage EFFECTIF du serveur (null s'il n'est pas installé). */
export function sharePolicy(w: Where, guildShare: boolean | null, filesOpen: boolean): Verdict {
  if (!filesOpen) return { public: false, reason: "files_closed" };
  if (w.place === "bot_dm") return { public: false, reason: "bot_dm" };
  if (w.place === "private") return { public: true };
  if (w.guildInstall) {
    if (guildShare === false) return { public: false, reason: "server_off" };
    if (w.appAttach === false) return { public: false, reason: "no_attach" };
    return { public: true };
  }
  // Installé seulement sur le compte : Discord rend la réponse privée sans « Utiliser des applications externes ».
  if (w.externalApps === false) return { public: false, reason: "external_apps" };
  if (w.appAttach === false) return { public: false, reason: "no_attach" };
  return { public: true };
}

/** Réponse privée : éphémère partout, sauf en message privé avec le bot, où un message normal reste dans l'historique
 *  (personne d'autre ne le voit) au lieu de disparaître au rechargement. */
export function privateIsEphemeral(w: Where): boolean {
  return w.place !== "bot_dm";
}

/** Pourquoi le partage public est impossible ici, en une phrase, et quoi faire à la place. */
export const REFUSAL_TEXT: Record<Refusal, string> = {
  files_closed: "Le partage de fichiers n'est pas encore ouvert.",
  bot_dm: "Ici, seul toi vois le bot : enregistre le fichier, puis envoie-le où tu veux.",
  server_off: "Les administrateurs de ce serveur ont désactivé le partage public (`/config`). Enregistre le fichier pour l'envoyer toi-même.",
  external_apps: "Ce serveur ne permet pas aux applications de ton compte de publier (permission « Utiliser des applications externes »). Enregistre le fichier pour l'envoyer toi-même.",
  no_attach: "AETHRYON n'a pas le droit de joindre des fichiers dans ce salon. Enregistre le fichier pour l'envoyer toi-même.",
};

/** Libellé court du mode d'installation, pour les journaux (jamais d'identifiant). */
export function installLabel(w: Where): string {
  return w.guildInstall && w.userInstall ? "serveur+compte" : w.guildInstall ? "serveur" : w.userInstall ? "compte" : "inconnu";
}

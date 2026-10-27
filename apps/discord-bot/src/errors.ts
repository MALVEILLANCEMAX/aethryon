// Textes affichés par le bot Discord (docs/DISCORD-BOT.md §6) :
// - ERROR_TEXT : erreurs de conversion de ytapi, copie EXACTE de la table de docs/ERREURS.md (mêmes codes, mêmes
//   textes que l'historique du site et que le `detail` renvoyé à l'iPhone) ; vérifiée par
//   scripts/check-error-codes.py et par les tests. Un code absent s'affiche avec le repli générique ;
// - SERVICE_TEXT : refus de compte, de quota et d'accès (account et ytapi, §6.2) ;
// - BOT_TEXT : cas propres au bot (§6.3).
// Tutoiement, comme le site ; jamais le lien ni le titre de la vidéo.

export const ERROR_TEXT: Readonly<Record<string, string>> = {
  not_found: "Vidéo supprimée ou inaccessible : la plateforme ne la trouve pas (lien erroné ou vidéo retirée).",
  unavailable: "Vidéo supprimée ou inaccessible depuis le serveur : la plateforme ne la fournit pas (retirée, masquée ou bloquée dans le pays du serveur).",
  no_video: "Ce post ne contient pas de vidéo.",
  media_index_not_found: "Ce post ne contient pas la vidéo demandée.",
  private: "La vidéo est privée.",
  age_restricted: "Vidéo soumise à une limite d'âge : la plateforme exige un compte connecté.",
  members_only: "Vidéo réservée aux membres de la chaîne.",
  geo_restricted: "Vidéo bloquée dans le pays du serveur.",
  login_required: "La plateforme exige un compte connecté pour cette vidéo.",
  unsupported_url: "Ce lien n'est pas pris en charge : partage une vidéo YouTube, TikTok ou X.",
  unsupported_content: "Ce contenu n'est pas pris en charge (diaporama photo ou contenu protégé).",
  playlist_not_supported: "Les playlists, chaînes et profils ne sont pas pris en charge : partage une vidéo.",
  youtube_music_not_accepted: "Les liens YouTube Music ne sont pas acceptés : AETHRYON ne télécharge pas le catalogue musical commercial.",
  platform_not_accepted: "Cette plateforme n'est pas acceptée : AETHRYON ne télécharge ni le streaming payant, ni les catalogues musicaux, ni les contenus protégés.",
  license_not_free: "Ce média n'a pas de licence libre connue : AETHRYON ne le convertit pas.",
  live_not_supported: "Les directs et les premières ne sont pas pris en charge.",
  short_link_unresolved: "Le lien court n'a pas pu être ouvert : ouvre la vidéo dans l'app puis partage-la à nouveau.",
  no_audio: "Cette vidéo n'a pas de son : MP3 impossible.",
  too_long: "Vidéo trop longue pour le service.",
  too_large: "Fichier trop volumineux pour le service.",
  transcode_too_long: "Vidéo trop longue pour être réencodée.",
  gif_too_long: "Vidéo trop longue pour un GIF.",
  clip_out_of_range: "L'extrait demandé commence après la fin de la vidéo.",
  cannot_fit: "Impossible de faire tenir ce média dans la taille demandée : il est trop long pour cette taille.",
  unsupported_file: "Ce fichier n'est pas une vidéo ou un son pris en charge.",
  resolution_too_high: "Image trop grande : le service accepte jusqu'à la 4K.",
  invalid_crop: "Le recadrage demandé sort de l'image.",
  bot_check: "Plateforme temporairement indisponible : elle impose au serveur une vérification anti-robot et bloque ses demandes ; ni ta vidéo ni ton compte ne sont en cause. Réessaie plus tard.",
  upstream_rate_limited: "Plateforme temporairement indisponible : elle limite le nombre de demandes du serveur ; ni ta vidéo ni ton compte ne sont en cause. Réessaie plus tard.",
  upstream_unavailable: "Plateforme temporairement indisponible : elle a renvoyé une erreur. Réessaie plus tard.",
  upstream_timeout: "Plateforme temporairement indisponible : elle n'a pas répondu à temps.",
  extractor_broken: "Plateforme temporairement indisponible : elle a changé son fonctionnement, le serveur doit être mis à jour.",
  platform_unavailable: "Plateforme temporairement indisponible : trop d'échecs récents, elle est mise en pause automatiquement ; ni ta vidéo ni ton compte ne sont en cause. Réessaie plus tard.",
  upstream_forbidden: "Échec de récupération du média : la plateforme a refusé l'accès au fichier (HTTP 403).",
  download_failed: "Échec de récupération du média : le téléchargement depuis la plateforme a été interrompu.",
  format_unavailable: "Échec de récupération du média : aucun format compatible n'est proposé.",
  upstream_error: "Échec de récupération du média (cause non identifiée).",
  conversion_failed: "Échec du traitement vidéo.",
  timeout: "Délai de conversion dépassé.",
  insufficient_storage: "Serveur saturé (espace disque) : réessaie plus tard.",
  server_busy: "Serveur occupé : réessaie dans un instant.",
  internal_error: "Erreur interne.",
  worker_crashed: "Erreur interne : le traitement s'est arrêté.",
  cookies_invalid: "Erreur interne : configuration du serveur à corriger.",
  proxy_unreachable: "Erreur interne : configuration du serveur à corriger.",
  proxy_bypass: "Erreur interne : configuration du serveur à corriger.",
  cancelled: "La conversion a été annulée.",
};
export const ERROR_FALLBACK_TEXT = "La conversion a échoué.";

/** Texte d'une erreur de conversion (code stable de ytapi) : table de docs/ERREURS.md, sinon le repli. */
export function conversionErrorText(code: string): string {
  return Object.hasOwn(ERROR_TEXT, code) ? ERROR_TEXT[code]! : ERROR_FALLBACK_TEXT;
}

/** Refus de compte, de quota et d'accès (textes actuels d'account et de ytapi, docs/DISCORD-BOT.md §6.2). */
export const SERVICE_TEXT: Readonly<Record<string, string>> = {
  quota_exceeded: "Tu as atteint ta limite de conversions pour aujourd'hui. Elle se réinitialise à minuit (heure de Paris).",
  active_job_limit: "Une conversion est déjà en cours pour ton compte : attends qu'elle se termine.",
  service_paused: "Les conversions sont temporairement suspendues.",
  platform_disabled: "Cette plateforme est temporairement désactivée.",
  account_suspended: "Ce compte est suspendu.",
  invalid_parameter: "Format non disponible : choisis MP3 ou MP4.",
  auth_unavailable: "Vérification de ton compte momentanément impossible. Réessaie dans quelques secondes.",
  unauthorized: "La liaison avec ton compte n'est plus valide : relie ton compte Discord depuis ton espace AETHRYON.",
  rate_limited: "Le service reçoit beaucoup de demandes : réessaie dans une minute.",
  too_many_sessions: "Trop de conversions en cours depuis Discord : attends qu'elles se terminent.",
  derive_limit: "Tu as déjà tiré plusieurs fichiers de cette conversion : relance une conversion pour continuer.",
  job_not_found: "Ce résultat a expiré (il est gardé une heure) : relance la conversion.",
  file_gone: "Ce résultat a expiré (il est gardé une heure) : relance la conversion.",
};

/** Cas propres au bot (docs/DISCORD-BOT.md §6.3). */
export const BOT_TEXT = {
  not_linked: "Ton compte Discord n'est pas lié à AETHRYON. Lie-le depuis ton espace, en un clic : le bot te reconnaîtra ensuite.",
  cooldown: "Attends quelques secondes avant une nouvelle demande.",
  link_unavailable: "Connexion à ton compte impossible pour le moment. Réessaie dans quelques secondes.",
  discord_window_closed: "La conversion continue, mais Discord ne permet plus de mettre ce message à jour. Retrouve-la dans ton espace AETHRYON.",
  busy: "Le bot suit déjà beaucoup de conversions : réessaie dans une minute.",
  in_progress: "Une conversion est déjà en cours pour ton compte : attends qu'elle se termine.",
  unsupported_link: "Ce lien n'est pas pris en charge : envoie le lien https d'une vidéo YouTube, TikTok ou X.",
  download_unavailable: "Ton fichier est prêt, mais le lien de téléchargement n'a pas pu être créé. Réessaie la conversion dans quelques minutes.",
  tools_unavailable: "Cette fonction n'est pas encore ouverte sur le service de conversion.",
  bad_time: "Temps illisible : écris-le en secondes (75) ou en minutes:secondes (1:15).",
} as const;

# Erreurs de conversion : codes, textes et causes (2026-10-10)

Une seule table fait foi pour ce que voit l'utilisateur, **à l'identique** sur l'iPhone (champ `detail`
renvoyé par ytapi aux jetons personnels `ytc_`) et dans l'historique de l'espace personnel
(`account/src/usage.ts`, `ERROR_TEXT`). Les jetons d'administration (jetons hérités de ytapi) gardent le
`detail` technique d'origine. Les codes sont stables (le raccourci ne teste que `unauthorized`) ; la
cause technique précise (message yt-dlp, sortie ffmpeg) reste dans les journaux du serveur, avec le
`job_id` et l'identifiant d'usage, jamais avec un jeton, un cookie ou une URL complète.

Contrôle automatique : `python3 scripts/check-error-codes.py` (lancé par `make test`) vérifie que les
deux tables ont les mêmes codes et les mêmes textes.

**Quota** : une conversion en échec (tous les codes de cette table) n'est jamais décomptée du quota du
jour (docs/ADMIN.md §3). **Pauses de plateforme** (`bot_check`, `upstream_rate_limited`) : ytapi ne
contacte plus YouTube pendant la pause (15 min, doublée à chaque blocage consécutif jusqu'à 60 min) et
renvoie `Retry-After` / `retry_after_s` ; le bot Discord en tire une carte précise (plateforme, cause,
heure de reprise, bouton « Réessayer ») — la table ci-dessous reste le texte de base.

| Code | HTTP | Catégorie | Texte affiché (iPhone et historique) | Causes typiques |
|---|---|---|---|---|
| `not_found` | 404 | Vidéo supprimée ou inaccessible | Vidéo supprimée ou inaccessible : la plateforme ne la trouve pas (lien erroné ou vidéo retirée). | page ou post inexistant, compte supprimé |
| `unavailable` | 404 | Vidéo supprimée ou inaccessible | Vidéo supprimée ou inaccessible depuis le serveur : la plateforme ne la fournit pas (retirée, masquée ou bloquée dans le pays du serveur). | TikTok statut 10204 (`status_deleted`), « Video not available, status code N » |
| `no_video` | 404 | Vidéo supprimée ou inaccessible | Ce post ne contient pas de vidéo. | post X sans vidéo, photo seule |
| `media_index_not_found` | 404 | Vidéo supprimée ou inaccessible | Ce post ne contient pas la vidéo demandée. | index de média hors limites (X) |
| `private` | 403 | Vidéo privée | La vidéo est privée. | contenu privé, compte privé |
| `age_restricted` | 403 | Accès restreint | Vidéo soumise à une limite d'âge : la plateforme exige un compte connecté. | limite d'âge |
| `members_only` | 403 | Accès restreint | Vidéo réservée aux membres de la chaîne. | contenu « membres » |
| `geo_restricted` | 403 | Accès restreint | Vidéo bloquée dans le pays du serveur. | restriction géographique explicite |
| `login_required` | 403 | Accès restreint | La plateforme exige un compte connecté pour cette vidéo. | contenu sensible, connexion exigée |
| `unsupported_url` | 400 | Lien non pris en charge | Ce lien n'est pas pris en charge : partage une vidéo YouTube, TikTok ou X. | autre site, page de profil |
| `unsupported_content` | 400 | Lien non pris en charge | Ce contenu n'est pas pris en charge (diaporama photo ou contenu protégé). | diaporama TikTok, DRM |
| `playlist_not_supported` | 400 | Lien non pris en charge | Les playlists, chaînes et profils ne sont pas pris en charge : partage une vidéo. | playlist, chaîne, profil |
| `youtube_music_not_accepted` | 400 | Lien non pris en charge | Les liens YouTube Music ne sont pas acceptés : AETHRYON ne télécharge pas le catalogue musical commercial. | lien `music.youtube.com` (et ses sous-domaines), y compris derrière une redirection `youtube.com/redirect` ; fermé le 2026-10-23, refus avant tout travail |
| `platform_not_accepted` | 400 | Lien non pris en charge | Cette plateforme n'est pas acceptée : AETHRYON ne télécharge ni le streaming payant, ni les catalogues musicaux, ni les contenus protégés. | plateforme refusée du registre `ytapi/app/plateformes.json` (SoundCloud, Spotify, Deezer, Apple Music, Bandcamp, Mixcloud, Netflix, Disney+…) ; refus avant tout travail, aucune requête |
| `license_not_free` | 400 | Lien non pris en charge | Ce média n'a pas de licence libre connue : AETHRYON ne le convertit pas. | Wikimedia Commons : licence absente, inconnue ou non libre (NC, ND, NonFree) dans l'API de Commons, ou attribution exigée sans auteur connu (`ytapi/app/licences.py`) ; refus avant tout téléchargement |
| `live_not_supported` | 400 | Lien non pris en charge | Les directs et les premières ne sont pas pris en charge. | direct, première |
| `short_link_unresolved` | 502 | Lien non pris en charge | Le lien court n'a pas pu être ouvert : ouvre la vidéo dans l'app puis partage-la à nouveau. | lien court TikTok non résolu (redirection vers l'accueil ou la connexion) |
| `no_audio` | 400 | Lien non pris en charge | Cette vidéo n'a pas de son : MP3 impossible. | vidéo muette, GIF |
| `too_long` | 413 | Limite du service | Vidéo trop longue pour le service. | durée > `MAX_DURATION_S` |
| `too_large` | 413 | Limite du service | Fichier trop volumineux pour le service. | taille > `MAX_FILESIZE_MB` |
| `transcode_too_long` | 413 | Limite du service | Vidéo trop longue pour être réencodée. | réencodage demandé, durée > limite |
| `gif_too_long` | 413 | Limite du service | Vidéo trop longue pour un GIF. | GIF, durée > limite |
| `clip_out_of_range` | 400 | Limite du service | L'extrait demandé commence après la fin de la vidéo. | extrait (`start_s`) au-delà de la durée du média |
| `cannot_fit` | 413 | Limite du service | Impossible de faire tenir ce média dans la taille demandée : il est trop long pour cette taille. | compression ou GIF (bot Discord) : taille visée inatteignable pour cette durée |
| `unsupported_file` | 415 | Fichier non pris en charge | Ce fichier n'est pas une vidéo ou un son pris en charge. | fichier importé (Tools) : ni MP4/MOV/WebM/MKV ni MP3/M4A/WAV/OGG/FLAC, liste de lecture déguisée, image, rien de décodable |
| `resolution_too_high` | 413 | Limite du service | Image trop grande : le service accepte jusqu'à la 4K. | fichier importé (Tools) au-delà de 4096×2304 pixels |
| `invalid_crop` | 400 | Limite du service | Le recadrage demandé sort de l'image. | export (Tools) dont le rectangle dépasse l'image ou fait moins de 16 pixels |
| `bot_check` | 503 | Plateforme temporairement indisponible | Plateforme temporairement indisponible : elle impose au serveur une vérification anti-robot et bloque ses demandes ; ni ta vidéo ni ton compte ne sont en cause. Réessaie plus tard. | contrôle anti-robot YouTube, pause automatique |
| `upstream_rate_limited` | 503 | Plateforme temporairement indisponible | Plateforme temporairement indisponible : elle limite le nombre de demandes du serveur ; ni ta vidéo ni ton compte ne sont en cause. Réessaie plus tard. | HTTP 429, limitation |
| `upstream_unavailable` | 503 | Plateforme temporairement indisponible | Plateforme temporairement indisponible : elle a renvoyé une erreur. Réessaie plus tard. | HTTP 5xx de la plateforme |
| `upstream_timeout` | 504 | Plateforme temporairement indisponible | Plateforme temporairement indisponible : elle n'a pas répondu à temps. | délai réseau dépassé |
| `extractor_broken` | 502 | Plateforme temporairement indisponible | Plateforme temporairement indisponible : elle a changé son fonctionnement, le serveur doit être mis à jour. | extracteur yt-dlp dépassé |
| `platform_unavailable` | 503 | Plateforme temporairement indisponible | Plateforme temporairement indisponible : trop d'échecs récents, elle est mise en pause automatiquement ; ni ta vidéo ni ton compte ne sont en cause. Réessaie plus tard. | disjoncteur des plateformes autres que YouTube (échecs consécutifs de la plateforme elle-même, `PLATFORM_BREAKER_*`) ou plateforme marquée « indisponible » dans le registre ; `Retry-After` |
| `upstream_forbidden` | 502 | Échec de récupération du média | Échec de récupération du média : la plateforme a refusé l'accès au fichier (HTTP 403). | HTTP 403 sur le flux ou la page, après épuisement des replis |
| `download_failed` | 502 | Échec de récupération du média | Échec de récupération du média : le téléchargement depuis la plateforme a été interrompu. | fragment manquant, 404/410 sur le flux, coupure |
| `format_unavailable` | 422 | Échec de récupération du média | Échec de récupération du média : aucun format compatible n'est proposé. | aucun format sélectionnable, ou fichier « vidéo » sans piste vidéo (son seul) |
| `upstream_error` | 502 | Échec de récupération du média | Échec de récupération du média (cause non identifiée). | erreur yt-dlp non classée |
| `conversion_failed` | 500 | Échec du traitement vidéo | Échec du traitement vidéo. | ffmpeg / ffprobe en échec, piste vidéo illisible ou non H.264 là où il est exigé |
| `timeout` | 504 | Délai de conversion dépassé | Délai de conversion dépassé. | `DOWNLOAD_TIMEOUT_S` atteint |
| `insufficient_storage` | 503 | Serveur saturé | Serveur saturé (espace disque) : réessaie plus tard. | disque presque plein, ENOSPC |
| `server_busy` | 503 | Serveur saturé | Serveur occupé : réessaie dans un instant. | file d'attente pleine |
| `internal_error` | 500 | Erreur interne | Erreur interne. | exception inattendue |
| `worker_crashed` | 500 | Erreur interne | Erreur interne : le traitement s'est arrêté. | processus tué (mémoire) |
| `cookies_invalid` | 500 | Erreur interne | Erreur interne : configuration du serveur à corriger. | fichier de cookies illisible |
| `proxy_unreachable` | 502 | Erreur interne | Erreur interne : configuration du serveur à corriger. | proxy YouTube injoignable |
| `proxy_bypass` | 502 | Erreur interne | Erreur interne : configuration du serveur à corriger. | proxy SOCKS contourné par ffmpeg |
| `cancelled` | 499 | — | La conversion a été annulée. | client parti, job supprimé |

Repli : tout code absent de la table s'affiche « La conversion a échoué. » (et doit être ajouté ici).

## Règles de classement (ytapi `app/errors.py`)

- Un **HTTP 403** n'est jamais classé « introuvable » ; un 404/410 sur le **flux** (après une extraction
  réussie) est un `download_failed`, pas un `not_found`.
- Les erreurs du serveur (disque plein, ffmpeg absent, écriture impossible) ne sont jamais imputées à la
  plateforme.
- TikTok 10204 : la plateforme répond `status_deleted` au serveur, mais le même code sert aux blocages
  régionaux (le serveur est en Espagne) : `unavailable`, jamais « introuvable ».

## Repli YouTube en cas de HTTP 403 sur un flux

Sans cookies, ytapi demande les formats à deux clients YouTube qui n'exigent pas de jeton PO
(`YT_CLIENTS`, défaut `visionos,web_embedded`, `formats=duplicate`) en **une seule** extraction. Si le
téléchargement d'un flux reçoit un 403, les formats de ce client sont écartés et la meilleure combinaison
restante (même règle de tri) est téléchargée, sans nouvelle requête d'extraction (le limiteur YouTube
n'est pas contourné). `upstream_forbidden` n'est renvoyé qu'une fois tous les clients épuisés. Chaque
tentative est journalisée (formats, client, présence d'un jeton PO, jamais l'URL).

## Security verification (anti-bot, not conversions)

Answers from account on sensitive website actions only (never the media API, never key-based routes), see
[`docs/security/anti-bot.md`](../security/anti-bot.md): `challenge_required` (403), `challenge_failed` (403),
`challenge_expired` (403), `verification_unavailable` (503), `temporarily_blocked` (429). They are not part of the
conversion error table above (`scripts/check-error-codes.py`).

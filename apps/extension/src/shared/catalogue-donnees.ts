// FICHIER GÉNÉRÉ par scripts/catalogue.mjs depuis docs/api/CATALOGUE-PLATEFORMES.json (registre unique des plateformes) :
// ne pas modifier à la main. Vérifié par la construction et par tests/unit/apparence.test.ts (--check).
export const CATALOGUE_DONNEES = {
 "version": "2026-10-26",
 "categories": [
  {
   "id": "populaires",
   "nom": "Populaires"
  },
  {
   "id": "musique",
   "nom": "Musique"
  },
  {
   "id": "streaming",
   "nom": "Streaming"
  },
  {
   "id": "autres",
   "nom": "Autres"
  }
 ],
 "plateformes": [
  {
   "id": "youtube",
   "nom": "YouTube",
   "categorie": "populaires",
   "icone": "video",
   "statut": "disponible",
   "domaines": [
    "youtube.com",
    "youtu.be",
    "youtube-nocookie.com"
   ],
   "formats": [
    "mp4",
    "mp3",
    "gif",
    "extrait"
   ],
   "indisponibles": {},
   "attribution": false
  },
  {
   "id": "tiktok",
   "nom": "TikTok",
   "categorie": "populaires",
   "icone": "vertical",
   "statut": "disponible",
   "domaines": [
    "tiktok.com"
   ],
   "formats": [
    "mp4",
    "mp3",
    "gif",
    "extrait"
   ],
   "indisponibles": {},
   "attribution": false
  },
  {
   "id": "twitter",
   "nom": "X",
   "categorie": "populaires",
   "icone": "post",
   "statut": "disponible",
   "domaines": [
    "twitter.com",
    "x.com"
   ],
   "formats": [
    "mp4",
    "mp3",
    "gif",
    "extrait"
   ],
   "indisponibles": {},
   "attribution": false
  },
  {
   "id": "instagram",
   "nom": "Instagram",
   "categorie": "populaires",
   "icone": "vertical",
   "statut": "preparation",
   "domaines": [
    "instagram.com",
    "instagr.am"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Instagram : plateforme en essai, pas encore ouverte.",
    "mp3": "Instagram : plateforme en essai, pas encore ouverte.",
    "gif": "Instagram : plateforme en essai, pas encore ouverte.",
    "extrait": "Instagram : plateforme en essai, pas encore ouverte."
   },
   "attribution": false
  },
  {
   "id": "facebook",
   "nom": "Facebook",
   "categorie": "populaires",
   "icone": "video",
   "statut": "indisponible",
   "domaines": [
    "facebook.com",
    "fb.watch"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Facebook est temporairement indisponible.",
    "mp3": "Facebook est temporairement indisponible.",
    "gif": "Facebook est temporairement indisponible.",
    "extrait": "Facebook est temporairement indisponible."
   },
   "attribution": false
  },
  {
   "id": "reddit",
   "nom": "Reddit",
   "categorie": "populaires",
   "icone": "post",
   "statut": "indisponible",
   "domaines": [
    "reddit.com",
    "redd.it"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Reddit est temporairement indisponible.",
    "mp3": "Reddit est temporairement indisponible.",
    "gif": "Reddit est temporairement indisponible.",
    "extrait": "Reddit est temporairement indisponible."
   },
   "attribution": false
  },
  {
   "id": "vimeo",
   "nom": "Vimeo",
   "categorie": "populaires",
   "icone": "video",
   "statut": "indisponible",
   "domaines": [
    "vimeo.com"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Vimeo est temporairement indisponible.",
    "mp3": "Vimeo est temporairement indisponible.",
    "gif": "Vimeo est temporairement indisponible.",
    "extrait": "Vimeo est temporairement indisponible."
   },
   "attribution": false
  },
  {
   "id": "dailymotion",
   "nom": "Dailymotion",
   "categorie": "populaires",
   "icone": "video",
   "statut": "preparation",
   "domaines": [
    "dailymotion.com",
    "dai.ly"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Dailymotion : plateforme en essai, pas encore ouverte.",
    "mp3": "Dailymotion : plateforme en essai, pas encore ouverte.",
    "gif": "Dailymotion : plateforme en essai, pas encore ouverte.",
    "extrait": "Dailymotion : plateforme en essai, pas encore ouverte."
   },
   "attribution": false
  },
  {
   "id": "bluesky",
   "nom": "Bluesky",
   "categorie": "populaires",
   "icone": "post",
   "statut": "prete",
   "domaines": [
    "bsky.app"
   ],
   "formats": [
    "mp4",
    "mp3",
    "gif"
   ],
   "indisponibles": {
    "extrait": "Bluesky ne permet pas de récupérer seulement un passage : extraits désactivés."
   },
   "attribution": false
  },
  {
   "id": "pinterest",
   "nom": "Pinterest",
   "categorie": "populaires",
   "icone": "image",
   "statut": "preparation",
   "domaines": [
    "pinterest.com",
    "pinterest.fr",
    "pinterest.co.uk",
    "pinterest.de",
    "pinterest.ca"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Pinterest : plateforme en essai, pas encore ouverte.",
    "mp3": "Pinterest : plateforme en essai, pas encore ouverte.",
    "gif": "Pinterest : plateforme en essai, pas encore ouverte.",
    "extrait": "Pinterest : plateforme en essai, pas encore ouverte."
   },
   "attribution": false
  },
  {
   "id": "snapchat",
   "nom": "Snapchat Spotlight",
   "categorie": "populaires",
   "icone": "vertical",
   "statut": "preparation",
   "domaines": [
    "snapchat.com"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Snapchat Spotlight : plateforme en essai, pas encore ouverte.",
    "mp3": "Snapchat Spotlight : plateforme en essai, pas encore ouverte.",
    "gif": "Snapchat Spotlight : plateforme en essai, pas encore ouverte.",
    "extrait": "Snapchat Spotlight : plateforme en essai, pas encore ouverte."
   },
   "attribution": false
  },
  {
   "id": "linkedin",
   "nom": "LinkedIn",
   "categorie": "populaires",
   "icone": "post",
   "statut": "preparation",
   "domaines": [
    "linkedin.com"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "LinkedIn : plateforme en essai, pas encore ouverte.",
    "mp3": "LinkedIn : plateforme en essai, pas encore ouverte.",
    "gif": "LinkedIn : plateforme en essai, pas encore ouverte.",
    "extrait": "LinkedIn : plateforme en essai, pas encore ouverte."
   },
   "attribution": false
  },
  {
   "id": "tumblr",
   "nom": "Tumblr",
   "categorie": "populaires",
   "icone": "post",
   "statut": "indisponible",
   "domaines": [
    "tumblr.com"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Tumblr est temporairement indisponible.",
    "mp3": "Tumblr est temporairement indisponible.",
    "gif": "Tumblr est temporairement indisponible.",
    "extrait": "Tumblr est temporairement indisponible."
   },
   "attribution": false
  },
  {
   "id": "threads",
   "nom": "Threads",
   "categorie": "populaires",
   "icone": "post",
   "statut": "indisponible",
   "domaines": [
    "threads.net",
    "threads.com"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Threads est temporairement indisponible.",
    "mp3": "Threads est temporairement indisponible.",
    "gif": "Threads est temporairement indisponible.",
    "extrait": "Threads est temporairement indisponible."
   },
   "attribution": false
  },
  {
   "id": "twitch",
   "nom": "Twitch (clips et rediffusions)",
   "categorie": "streaming",
   "icone": "direct",
   "statut": "preparation",
   "domaines": [
    "twitch.tv"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Twitch (clips et rediffusions) : plateforme en essai, pas encore ouverte.",
    "mp3": "Twitch (clips et rediffusions) : plateforme en essai, pas encore ouverte.",
    "gif": "Twitch (clips et rediffusions) : plateforme en essai, pas encore ouverte.",
    "extrait": "Twitch (clips et rediffusions) : plateforme en essai, pas encore ouverte."
   },
   "attribution": false
  },
  {
   "id": "kick",
   "nom": "Kick (clips et rediffusions)",
   "categorie": "streaming",
   "icone": "direct",
   "statut": "preparation",
   "domaines": [
    "kick.com"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Kick (clips et rediffusions) : plateforme en essai, pas encore ouverte.",
    "mp3": "Kick (clips et rediffusions) : plateforme en essai, pas encore ouverte.",
    "gif": "Kick (clips et rediffusions) : plateforme en essai, pas encore ouverte.",
    "extrait": "Kick (clips et rediffusions) : plateforme en essai, pas encore ouverte."
   },
   "attribution": false
  },
  {
   "id": "streamable",
   "nom": "Streamable",
   "categorie": "autres",
   "icone": "video",
   "statut": "preparation",
   "domaines": [
    "streamable.com"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Streamable : plateforme en essai, pas encore ouverte.",
    "mp3": "Streamable : plateforme en essai, pas encore ouverte.",
    "gif": "Streamable : plateforme en essai, pas encore ouverte.",
    "extrait": "Streamable : plateforme en essai, pas encore ouverte."
   },
   "attribution": false
  },
  {
   "id": "imgur",
   "nom": "Imgur",
   "categorie": "autres",
   "icone": "image",
   "statut": "preparation",
   "domaines": [
    "imgur.com"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Imgur : plateforme en essai, pas encore ouverte.",
    "mp3": "Imgur : plateforme en essai, pas encore ouverte.",
    "gif": "Imgur : plateforme en essai, pas encore ouverte.",
    "extrait": "Imgur : plateforme en essai, pas encore ouverte."
   },
   "attribution": false
  },
  {
   "id": "bilibili",
   "nom": "Bilibili",
   "categorie": "autres",
   "icone": "video",
   "statut": "indisponible",
   "domaines": [
    "bilibili.com"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Bilibili est temporairement indisponible.",
    "mp3": "Bilibili est temporairement indisponible.",
    "gif": "Bilibili est temporairement indisponible.",
    "extrait": "Bilibili est temporairement indisponible."
   },
   "attribution": false
  },
  {
   "id": "rumble",
   "nom": "Rumble",
   "categorie": "autres",
   "icone": "video",
   "statut": "indisponible",
   "domaines": [
    "rumble.com"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Rumble est temporairement indisponible.",
    "mp3": "Rumble est temporairement indisponible.",
    "gif": "Rumble est temporairement indisponible.",
    "extrait": "Rumble est temporairement indisponible."
   },
   "attribution": false
  },
  {
   "id": "vk",
   "nom": "VK Vidéo",
   "categorie": "autres",
   "icone": "video",
   "statut": "preparation",
   "domaines": [
    "vk.com",
    "vkvideo.ru"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "VK Vidéo : plateforme en essai, pas encore ouverte.",
    "mp3": "VK Vidéo : plateforme en essai, pas encore ouverte.",
    "gif": "VK Vidéo : plateforme en essai, pas encore ouverte.",
    "extrait": "VK Vidéo : plateforme en essai, pas encore ouverte."
   },
   "attribution": false
  },
  {
   "id": "archive",
   "nom": "Internet Archive",
   "categorie": "autres",
   "icone": "archive",
   "statut": "preparation",
   "domaines": [
    "archive.org"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Internet Archive : plateforme en essai, pas encore ouverte.",
    "mp3": "Internet Archive : plateforme en essai, pas encore ouverte.",
    "gif": "Internet Archive : plateforme en essai, pas encore ouverte.",
    "extrait": "Internet Archive : plateforme en essai, pas encore ouverte."
   },
   "attribution": false
  },
  {
   "id": "wikimedia",
   "nom": "Wikimedia Commons",
   "categorie": "autres",
   "icone": "archive",
   "statut": "prete",
   "domaines": [
    "commons.wikimedia.org"
   ],
   "formats": [
    "mp4",
    "mp3",
    "gif"
   ],
   "indisponibles": {
    "extrait": "Wikimedia Commons limite les requêtes partielles (HTTP 429) : extraits désactivés."
   },
   "attribution": true
  },
  {
   "id": "youtube_music",
   "nom": "YouTube Music",
   "categorie": "musique",
   "icone": "onde",
   "statut": "refusee",
   "domaines": [
    "music.youtube.com",
    "music.youtu.be",
    "music.youtube-nocookie.com",
    "youtubemusic.com"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Catalogue musical commercial : fermé par décision du propriétaire (2026-10-23).",
    "mp3": "Catalogue musical commercial : fermé par décision du propriétaire (2026-10-23).",
    "gif": "Catalogue musical commercial : fermé par décision du propriétaire (2026-10-23).",
    "extrait": "Catalogue musical commercial : fermé par décision du propriétaire (2026-10-23)."
   },
   "attribution": false
  },
  {
   "id": "soundcloud",
   "nom": "SoundCloud",
   "categorie": "musique",
   "icone": "onde",
   "statut": "refusee",
   "domaines": [
    "soundcloud.com",
    "snd.sc"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Conditions de l'API : le téléchargement des sons y est interdit (cloud-music/MUSIC-RAPPORT.md).",
    "mp3": "Conditions de l'API : le téléchargement des sons y est interdit (cloud-music/MUSIC-RAPPORT.md).",
    "gif": "Conditions de l'API : le téléchargement des sons y est interdit (cloud-music/MUSIC-RAPPORT.md).",
    "extrait": "Conditions de l'API : le téléchargement des sons y est interdit (cloud-music/MUSIC-RAPPORT.md)."
   },
   "attribution": false
  },
  {
   "id": "spotify",
   "nom": "Spotify",
   "categorie": "musique",
   "icone": "onde",
   "statut": "refusee",
   "domaines": [
    "spotify.com",
    "spotify.link"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Streaming payant protégé par DRM : jamais téléchargé.",
    "mp3": "Streaming payant protégé par DRM : jamais téléchargé.",
    "gif": "Streaming payant protégé par DRM : jamais téléchargé.",
    "extrait": "Streaming payant protégé par DRM : jamais téléchargé."
   },
   "attribution": false
  },
  {
   "id": "deezer",
   "nom": "Deezer",
   "categorie": "musique",
   "icone": "onde",
   "statut": "refusee",
   "domaines": [
    "deezer.com",
    "deezer.page.link",
    "dzr.page.link"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Streaming payant protégé par DRM : jamais téléchargé.",
    "mp3": "Streaming payant protégé par DRM : jamais téléchargé.",
    "gif": "Streaming payant protégé par DRM : jamais téléchargé.",
    "extrait": "Streaming payant protégé par DRM : jamais téléchargé."
   },
   "attribution": false
  },
  {
   "id": "apple_music",
   "nom": "Apple Music",
   "categorie": "musique",
   "icone": "onde",
   "statut": "refusee",
   "domaines": [
    "music.apple.com"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Streaming payant protégé par DRM : jamais téléchargé.",
    "mp3": "Streaming payant protégé par DRM : jamais téléchargé.",
    "gif": "Streaming payant protégé par DRM : jamais téléchargé.",
    "extrait": "Streaming payant protégé par DRM : jamais téléchargé."
   },
   "attribution": false
  },
  {
   "id": "amazon_music",
   "nom": "Amazon Music",
   "categorie": "musique",
   "icone": "onde",
   "statut": "refusee",
   "domaines": [
    "music.amazon.com",
    "music.amazon.fr"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Streaming payant protégé par DRM : jamais téléchargé.",
    "mp3": "Streaming payant protégé par DRM : jamais téléchargé.",
    "gif": "Streaming payant protégé par DRM : jamais téléchargé.",
    "extrait": "Streaming payant protégé par DRM : jamais téléchargé."
   },
   "attribution": false
  },
  {
   "id": "tidal",
   "nom": "Tidal",
   "categorie": "musique",
   "icone": "onde",
   "statut": "refusee",
   "domaines": [
    "tidal.com"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Streaming payant protégé par DRM : jamais téléchargé.",
    "mp3": "Streaming payant protégé par DRM : jamais téléchargé.",
    "gif": "Streaming payant protégé par DRM : jamais téléchargé.",
    "extrait": "Streaming payant protégé par DRM : jamais téléchargé."
   },
   "attribution": false
  },
  {
   "id": "bandcamp",
   "nom": "Bandcamp",
   "categorie": "musique",
   "icone": "onde",
   "statut": "refusee",
   "domaines": [
    "bandcamp.com"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Seuls les titres offerts en téléchargement gratuit par l'artiste seraient acceptables ; le tri fiable n'est pas encore démontré : refus (piste P2).",
    "mp3": "Seuls les titres offerts en téléchargement gratuit par l'artiste seraient acceptables ; le tri fiable n'est pas encore démontré : refus (piste P2).",
    "gif": "Seuls les titres offerts en téléchargement gratuit par l'artiste seraient acceptables ; le tri fiable n'est pas encore démontré : refus (piste P2).",
    "extrait": "Seuls les titres offerts en téléchargement gratuit par l'artiste seraient acceptables ; le tri fiable n'est pas encore démontré : refus (piste P2)."
   },
   "attribution": false
  },
  {
   "id": "mixcloud",
   "nom": "Mixcloud",
   "categorie": "musique",
   "icone": "onde",
   "statut": "refusee",
   "domaines": [
    "mixcloud.com"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Conditions : écoute en ligne seulement, enregistrement et téléchargement interdits (licences des mixes).",
    "mp3": "Conditions : écoute en ligne seulement, enregistrement et téléchargement interdits (licences des mixes).",
    "gif": "Conditions : écoute en ligne seulement, enregistrement et téléchargement interdits (licences des mixes).",
    "extrait": "Conditions : écoute en ligne seulement, enregistrement et téléchargement interdits (licences des mixes)."
   },
   "attribution": false
  },
  {
   "id": "audiomack",
   "nom": "Audiomack",
   "categorie": "musique",
   "icone": "onde",
   "statut": "refusee",
   "domaines": [
    "audiomack.com"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Catalogue musical commercial : écoute hors ligne réservée à l'application.",
    "mp3": "Catalogue musical commercial : écoute hors ligne réservée à l'application.",
    "gif": "Catalogue musical commercial : écoute hors ligne réservée à l'application.",
    "extrait": "Catalogue musical commercial : écoute hors ligne réservée à l'application."
   },
   "attribution": false
  },
  {
   "id": "netflix",
   "nom": "Netflix",
   "categorie": "streaming",
   "icone": "video",
   "statut": "refusee",
   "domaines": [
    "netflix.com"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Streaming payant protégé par DRM : jamais téléchargé.",
    "mp3": "Streaming payant protégé par DRM : jamais téléchargé.",
    "gif": "Streaming payant protégé par DRM : jamais téléchargé.",
    "extrait": "Streaming payant protégé par DRM : jamais téléchargé."
   },
   "attribution": false
  },
  {
   "id": "disney_plus",
   "nom": "Disney+",
   "categorie": "streaming",
   "icone": "video",
   "statut": "refusee",
   "domaines": [
    "disneyplus.com"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Streaming payant protégé par DRM : jamais téléchargé.",
    "mp3": "Streaming payant protégé par DRM : jamais téléchargé.",
    "gif": "Streaming payant protégé par DRM : jamais téléchargé.",
    "extrait": "Streaming payant protégé par DRM : jamais téléchargé."
   },
   "attribution": false
  },
  {
   "id": "prime_video",
   "nom": "Prime Video",
   "categorie": "streaming",
   "icone": "video",
   "statut": "refusee",
   "domaines": [
    "primevideo.com"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Streaming payant protégé par DRM : jamais téléchargé.",
    "mp3": "Streaming payant protégé par DRM : jamais téléchargé.",
    "gif": "Streaming payant protégé par DRM : jamais téléchargé.",
    "extrait": "Streaming payant protégé par DRM : jamais téléchargé."
   },
   "attribution": false
  },
  {
   "id": "canal_plus",
   "nom": "Canal+",
   "categorie": "streaming",
   "icone": "video",
   "statut": "refusee",
   "domaines": [
    "canalplus.com"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Streaming payant protégé par DRM : jamais téléchargé.",
    "mp3": "Streaming payant protégé par DRM : jamais téléchargé.",
    "gif": "Streaming payant protégé par DRM : jamais téléchargé.",
    "extrait": "Streaming payant protégé par DRM : jamais téléchargé."
   },
   "attribution": false
  },
  {
   "id": "crunchyroll",
   "nom": "Crunchyroll",
   "categorie": "streaming",
   "icone": "video",
   "statut": "refusee",
   "domaines": [
    "crunchyroll.com"
   ],
   "formats": [],
   "indisponibles": {
    "mp4": "Streaming payant protégé par DRM : jamais téléchargé.",
    "mp3": "Streaming payant protégé par DRM : jamais téléchargé.",
    "gif": "Streaming payant protégé par DRM : jamais téléchargé.",
    "extrait": "Streaming payant protégé par DRM : jamais téléchargé."
   },
   "attribution": false
  }
 ]
} as const;

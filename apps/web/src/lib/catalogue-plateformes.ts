// FICHIER GÉNÉRÉ par web/scripts/catalogue-plateformes.mjs depuis docs/api/CATALOGUE-PLATEFORMES.json (registre unique :
// ytapi/app/plateformes.json) : ne pas modifier à la main. Vérifié par tests/catalogue.test.ts.
export type StatutCatalogue = "disponible" | "prete_a_ouvrir" | "preproduction" | "indisponible" | "refusee";
export type FormatCatalogue = "mp4" | "mp3" | "gif" | "extrait";
export interface PlateformeCatalogue {
  id: string; nom: string; categorie: "populaires" | "musique" | "streaming" | "autres"; icone: string; etat: string;
  statut: StatutCatalogue; domaines: readonly string[]; formats_compatibles: readonly FormatCatalogue[];
  fonctions_indisponibles: readonly { fonction: FormatCatalogue; raison: string }[]; attribution_obligatoire: boolean; valide?: string;
}

export const CATALOGUE_PLATEFORMES: { version: string; ytdlp: string; formats: Record<FormatCatalogue, string>; categories: readonly { id: PlateformeCatalogue["categorie"]; nom: string }[]; plateformes: readonly PlateformeCatalogue[] } = {
  "version": "2026-10-26",
  "ytdlp": "2026.08.19",
  "formats": {
    "mp4": "MP4",
    "mp3": "MP3",
    "gif": "GIF",
    "extrait": "Extrait"
  },
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
      "etat": "officielle",
      "statut": "disponible",
      "domaines": [
        "youtube.com",
        "youtu.be",
        "youtube-nocookie.com"
      ],
      "formats_compatibles": [
        "mp4",
        "mp3",
        "gif",
        "extrait"
      ],
      "fonctions_indisponibles": [],
      "attribution_obligatoire": false
    },
    {
      "id": "tiktok",
      "nom": "TikTok",
      "categorie": "populaires",
      "icone": "vertical",
      "etat": "officielle",
      "statut": "disponible",
      "domaines": [
        "tiktok.com"
      ],
      "formats_compatibles": [
        "mp4",
        "mp3",
        "gif",
        "extrait"
      ],
      "fonctions_indisponibles": [],
      "attribution_obligatoire": false
    },
    {
      "id": "twitter",
      "nom": "X",
      "categorie": "populaires",
      "icone": "post",
      "etat": "officielle",
      "statut": "disponible",
      "domaines": [
        "twitter.com",
        "x.com"
      ],
      "formats_compatibles": [
        "mp4",
        "mp3",
        "gif",
        "extrait"
      ],
      "fonctions_indisponibles": [],
      "attribution_obligatoire": false
    },
    {
      "id": "instagram",
      "nom": "Instagram",
      "categorie": "populaires",
      "icone": "vertical",
      "etat": "beta",
      "statut": "preproduction",
      "domaines": [
        "instagram.com",
        "instagr.am"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Instagram : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "mp3",
          "raison": "Instagram : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "gif",
          "raison": "Instagram : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "extrait",
          "raison": "Instagram : plateforme en essai, pas encore ouverte."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "facebook",
      "nom": "Facebook",
      "categorie": "populaires",
      "icone": "video",
      "etat": "indisponible",
      "statut": "indisponible",
      "domaines": [
        "facebook.com",
        "fb.watch"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Facebook est temporairement indisponible."
        },
        {
          "fonction": "mp3",
          "raison": "Facebook est temporairement indisponible."
        },
        {
          "fonction": "gif",
          "raison": "Facebook est temporairement indisponible."
        },
        {
          "fonction": "extrait",
          "raison": "Facebook est temporairement indisponible."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "reddit",
      "nom": "Reddit",
      "categorie": "populaires",
      "icone": "post",
      "etat": "indisponible",
      "statut": "indisponible",
      "domaines": [
        "reddit.com",
        "redd.it"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Reddit est temporairement indisponible."
        },
        {
          "fonction": "mp3",
          "raison": "Reddit est temporairement indisponible."
        },
        {
          "fonction": "gif",
          "raison": "Reddit est temporairement indisponible."
        },
        {
          "fonction": "extrait",
          "raison": "Reddit est temporairement indisponible."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "vimeo",
      "nom": "Vimeo",
      "categorie": "populaires",
      "icone": "video",
      "etat": "indisponible",
      "statut": "indisponible",
      "domaines": [
        "vimeo.com"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Vimeo est temporairement indisponible."
        },
        {
          "fonction": "mp3",
          "raison": "Vimeo est temporairement indisponible."
        },
        {
          "fonction": "gif",
          "raison": "Vimeo est temporairement indisponible."
        },
        {
          "fonction": "extrait",
          "raison": "Vimeo est temporairement indisponible."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "dailymotion",
      "nom": "Dailymotion",
      "categorie": "populaires",
      "icone": "video",
      "etat": "beta",
      "statut": "preproduction",
      "domaines": [
        "dailymotion.com",
        "dai.ly"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Dailymotion : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "mp3",
          "raison": "Dailymotion : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "gif",
          "raison": "Dailymotion : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "extrait",
          "raison": "Dailymotion : plateforme en essai, pas encore ouverte."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "bluesky",
      "nom": "Bluesky",
      "categorie": "populaires",
      "icone": "post",
      "etat": "beta",
      "statut": "prete_a_ouvrir",
      "domaines": [
        "bsky.app"
      ],
      "formats_compatibles": [
        "mp4",
        "mp3",
        "gif"
      ],
      "fonctions_indisponibles": [
        {
          "fonction": "extrait",
          "raison": "Bluesky ne permet pas de récupérer seulement un passage : extraits désactivés."
        }
      ],
      "attribution_obligatoire": false,
      "valide": "2026-10-26"
    },
    {
      "id": "pinterest",
      "nom": "Pinterest",
      "categorie": "populaires",
      "icone": "image",
      "etat": "beta",
      "statut": "preproduction",
      "domaines": [
        "pinterest.com",
        "pinterest.fr",
        "pinterest.co.uk",
        "pinterest.de",
        "pinterest.ca"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Pinterest : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "mp3",
          "raison": "Pinterest : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "gif",
          "raison": "Pinterest : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "extrait",
          "raison": "Pinterest : plateforme en essai, pas encore ouverte."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "snapchat",
      "nom": "Snapchat Spotlight",
      "categorie": "populaires",
      "icone": "vertical",
      "etat": "beta",
      "statut": "preproduction",
      "domaines": [
        "snapchat.com"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Snapchat Spotlight : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "mp3",
          "raison": "Snapchat Spotlight : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "gif",
          "raison": "Snapchat Spotlight : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "extrait",
          "raison": "Snapchat Spotlight : plateforme en essai, pas encore ouverte."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "linkedin",
      "nom": "LinkedIn",
      "categorie": "populaires",
      "icone": "post",
      "etat": "beta",
      "statut": "preproduction",
      "domaines": [
        "linkedin.com"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "LinkedIn : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "mp3",
          "raison": "LinkedIn : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "gif",
          "raison": "LinkedIn : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "extrait",
          "raison": "LinkedIn : plateforme en essai, pas encore ouverte."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "tumblr",
      "nom": "Tumblr",
      "categorie": "populaires",
      "icone": "post",
      "etat": "indisponible",
      "statut": "indisponible",
      "domaines": [
        "tumblr.com"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Tumblr est temporairement indisponible."
        },
        {
          "fonction": "mp3",
          "raison": "Tumblr est temporairement indisponible."
        },
        {
          "fonction": "gif",
          "raison": "Tumblr est temporairement indisponible."
        },
        {
          "fonction": "extrait",
          "raison": "Tumblr est temporairement indisponible."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "threads",
      "nom": "Threads",
      "categorie": "populaires",
      "icone": "post",
      "etat": "indisponible",
      "statut": "indisponible",
      "domaines": [
        "threads.net",
        "threads.com"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Threads est temporairement indisponible."
        },
        {
          "fonction": "mp3",
          "raison": "Threads est temporairement indisponible."
        },
        {
          "fonction": "gif",
          "raison": "Threads est temporairement indisponible."
        },
        {
          "fonction": "extrait",
          "raison": "Threads est temporairement indisponible."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "twitch",
      "nom": "Twitch (clips et rediffusions)",
      "categorie": "streaming",
      "icone": "direct",
      "etat": "beta",
      "statut": "preproduction",
      "domaines": [
        "twitch.tv"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Twitch (clips et rediffusions) : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "mp3",
          "raison": "Twitch (clips et rediffusions) : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "gif",
          "raison": "Twitch (clips et rediffusions) : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "extrait",
          "raison": "Twitch (clips et rediffusions) : plateforme en essai, pas encore ouverte."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "kick",
      "nom": "Kick (clips et rediffusions)",
      "categorie": "streaming",
      "icone": "direct",
      "etat": "beta",
      "statut": "preproduction",
      "domaines": [
        "kick.com"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Kick (clips et rediffusions) : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "mp3",
          "raison": "Kick (clips et rediffusions) : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "gif",
          "raison": "Kick (clips et rediffusions) : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "extrait",
          "raison": "Kick (clips et rediffusions) : plateforme en essai, pas encore ouverte."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "streamable",
      "nom": "Streamable",
      "categorie": "autres",
      "icone": "video",
      "etat": "beta",
      "statut": "preproduction",
      "domaines": [
        "streamable.com"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Streamable : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "mp3",
          "raison": "Streamable : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "gif",
          "raison": "Streamable : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "extrait",
          "raison": "Streamable : plateforme en essai, pas encore ouverte."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "imgur",
      "nom": "Imgur",
      "categorie": "autres",
      "icone": "image",
      "etat": "beta",
      "statut": "preproduction",
      "domaines": [
        "imgur.com"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Imgur : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "mp3",
          "raison": "Imgur : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "gif",
          "raison": "Imgur : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "extrait",
          "raison": "Imgur : plateforme en essai, pas encore ouverte."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "bilibili",
      "nom": "Bilibili",
      "categorie": "autres",
      "icone": "video",
      "etat": "indisponible",
      "statut": "indisponible",
      "domaines": [
        "bilibili.com"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Bilibili est temporairement indisponible."
        },
        {
          "fonction": "mp3",
          "raison": "Bilibili est temporairement indisponible."
        },
        {
          "fonction": "gif",
          "raison": "Bilibili est temporairement indisponible."
        },
        {
          "fonction": "extrait",
          "raison": "Bilibili est temporairement indisponible."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "rumble",
      "nom": "Rumble",
      "categorie": "autres",
      "icone": "video",
      "etat": "indisponible",
      "statut": "indisponible",
      "domaines": [
        "rumble.com"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Rumble est temporairement indisponible."
        },
        {
          "fonction": "mp3",
          "raison": "Rumble est temporairement indisponible."
        },
        {
          "fonction": "gif",
          "raison": "Rumble est temporairement indisponible."
        },
        {
          "fonction": "extrait",
          "raison": "Rumble est temporairement indisponible."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "vk",
      "nom": "VK Vidéo",
      "categorie": "autres",
      "icone": "video",
      "etat": "beta",
      "statut": "preproduction",
      "domaines": [
        "vk.com",
        "vkvideo.ru"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "VK Vidéo : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "mp3",
          "raison": "VK Vidéo : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "gif",
          "raison": "VK Vidéo : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "extrait",
          "raison": "VK Vidéo : plateforme en essai, pas encore ouverte."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "archive",
      "nom": "Internet Archive",
      "categorie": "autres",
      "icone": "archive",
      "etat": "beta",
      "statut": "preproduction",
      "domaines": [
        "archive.org"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Internet Archive : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "mp3",
          "raison": "Internet Archive : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "gif",
          "raison": "Internet Archive : plateforme en essai, pas encore ouverte."
        },
        {
          "fonction": "extrait",
          "raison": "Internet Archive : plateforme en essai, pas encore ouverte."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "wikimedia",
      "nom": "Wikimedia Commons",
      "categorie": "autres",
      "icone": "archive",
      "etat": "beta",
      "statut": "prete_a_ouvrir",
      "domaines": [
        "commons.wikimedia.org"
      ],
      "formats_compatibles": [
        "mp4",
        "mp3",
        "gif"
      ],
      "fonctions_indisponibles": [
        {
          "fonction": "extrait",
          "raison": "Wikimedia Commons limite les requêtes partielles (HTTP 429) : extraits désactivés."
        }
      ],
      "attribution_obligatoire": true,
      "valide": "2026-10-26"
    },
    {
      "id": "youtube_music",
      "nom": "YouTube Music",
      "categorie": "musique",
      "icone": "onde",
      "etat": "refusee",
      "statut": "refusee",
      "domaines": [
        "music.youtube.com",
        "music.youtu.be",
        "music.youtube-nocookie.com",
        "youtubemusic.com"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Catalogue musical commercial : fermé par décision du propriétaire (2026-10-23)."
        },
        {
          "fonction": "mp3",
          "raison": "Catalogue musical commercial : fermé par décision du propriétaire (2026-10-23)."
        },
        {
          "fonction": "gif",
          "raison": "Catalogue musical commercial : fermé par décision du propriétaire (2026-10-23)."
        },
        {
          "fonction": "extrait",
          "raison": "Catalogue musical commercial : fermé par décision du propriétaire (2026-10-23)."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "soundcloud",
      "nom": "SoundCloud",
      "categorie": "musique",
      "icone": "onde",
      "etat": "refusee",
      "statut": "refusee",
      "domaines": [
        "soundcloud.com",
        "snd.sc"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Conditions de l'API : le téléchargement des sons y est interdit (cloud-music/MUSIC-RAPPORT.md)."
        },
        {
          "fonction": "mp3",
          "raison": "Conditions de l'API : le téléchargement des sons y est interdit (cloud-music/MUSIC-RAPPORT.md)."
        },
        {
          "fonction": "gif",
          "raison": "Conditions de l'API : le téléchargement des sons y est interdit (cloud-music/MUSIC-RAPPORT.md)."
        },
        {
          "fonction": "extrait",
          "raison": "Conditions de l'API : le téléchargement des sons y est interdit (cloud-music/MUSIC-RAPPORT.md)."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "spotify",
      "nom": "Spotify",
      "categorie": "musique",
      "icone": "onde",
      "etat": "refusee",
      "statut": "refusee",
      "domaines": [
        "spotify.com",
        "spotify.link"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "mp3",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "gif",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "extrait",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "deezer",
      "nom": "Deezer",
      "categorie": "musique",
      "icone": "onde",
      "etat": "refusee",
      "statut": "refusee",
      "domaines": [
        "deezer.com",
        "deezer.page.link",
        "dzr.page.link"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "mp3",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "gif",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "extrait",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "apple_music",
      "nom": "Apple Music",
      "categorie": "musique",
      "icone": "onde",
      "etat": "refusee",
      "statut": "refusee",
      "domaines": [
        "music.apple.com"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "mp3",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "gif",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "extrait",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "amazon_music",
      "nom": "Amazon Music",
      "categorie": "musique",
      "icone": "onde",
      "etat": "refusee",
      "statut": "refusee",
      "domaines": [
        "music.amazon.com",
        "music.amazon.fr"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "mp3",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "gif",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "extrait",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "tidal",
      "nom": "Tidal",
      "categorie": "musique",
      "icone": "onde",
      "etat": "refusee",
      "statut": "refusee",
      "domaines": [
        "tidal.com"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "mp3",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "gif",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "extrait",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "bandcamp",
      "nom": "Bandcamp",
      "categorie": "musique",
      "icone": "onde",
      "etat": "refusee",
      "statut": "refusee",
      "domaines": [
        "bandcamp.com"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Seuls les titres offerts en téléchargement gratuit par l'artiste seraient acceptables ; le tri fiable n'est pas encore démontré : refus (piste P2)."
        },
        {
          "fonction": "mp3",
          "raison": "Seuls les titres offerts en téléchargement gratuit par l'artiste seraient acceptables ; le tri fiable n'est pas encore démontré : refus (piste P2)."
        },
        {
          "fonction": "gif",
          "raison": "Seuls les titres offerts en téléchargement gratuit par l'artiste seraient acceptables ; le tri fiable n'est pas encore démontré : refus (piste P2)."
        },
        {
          "fonction": "extrait",
          "raison": "Seuls les titres offerts en téléchargement gratuit par l'artiste seraient acceptables ; le tri fiable n'est pas encore démontré : refus (piste P2)."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "mixcloud",
      "nom": "Mixcloud",
      "categorie": "musique",
      "icone": "onde",
      "etat": "refusee",
      "statut": "refusee",
      "domaines": [
        "mixcloud.com"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Conditions : écoute en ligne seulement, enregistrement et téléchargement interdits (licences des mixes)."
        },
        {
          "fonction": "mp3",
          "raison": "Conditions : écoute en ligne seulement, enregistrement et téléchargement interdits (licences des mixes)."
        },
        {
          "fonction": "gif",
          "raison": "Conditions : écoute en ligne seulement, enregistrement et téléchargement interdits (licences des mixes)."
        },
        {
          "fonction": "extrait",
          "raison": "Conditions : écoute en ligne seulement, enregistrement et téléchargement interdits (licences des mixes)."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "audiomack",
      "nom": "Audiomack",
      "categorie": "musique",
      "icone": "onde",
      "etat": "refusee",
      "statut": "refusee",
      "domaines": [
        "audiomack.com"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Catalogue musical commercial : écoute hors ligne réservée à l'application."
        },
        {
          "fonction": "mp3",
          "raison": "Catalogue musical commercial : écoute hors ligne réservée à l'application."
        },
        {
          "fonction": "gif",
          "raison": "Catalogue musical commercial : écoute hors ligne réservée à l'application."
        },
        {
          "fonction": "extrait",
          "raison": "Catalogue musical commercial : écoute hors ligne réservée à l'application."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "netflix",
      "nom": "Netflix",
      "categorie": "streaming",
      "icone": "video",
      "etat": "refusee",
      "statut": "refusee",
      "domaines": [
        "netflix.com"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "mp3",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "gif",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "extrait",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "disney_plus",
      "nom": "Disney+",
      "categorie": "streaming",
      "icone": "video",
      "etat": "refusee",
      "statut": "refusee",
      "domaines": [
        "disneyplus.com"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "mp3",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "gif",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "extrait",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "prime_video",
      "nom": "Prime Video",
      "categorie": "streaming",
      "icone": "video",
      "etat": "refusee",
      "statut": "refusee",
      "domaines": [
        "primevideo.com"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "mp3",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "gif",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "extrait",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "canal_plus",
      "nom": "Canal+",
      "categorie": "streaming",
      "icone": "video",
      "etat": "refusee",
      "statut": "refusee",
      "domaines": [
        "canalplus.com"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "mp3",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "gif",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "extrait",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        }
      ],
      "attribution_obligatoire": false
    },
    {
      "id": "crunchyroll",
      "nom": "Crunchyroll",
      "categorie": "streaming",
      "icone": "video",
      "etat": "refusee",
      "statut": "refusee",
      "domaines": [
        "crunchyroll.com"
      ],
      "formats_compatibles": [],
      "fonctions_indisponibles": [
        {
          "fonction": "mp4",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "mp3",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "gif",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        },
        {
          "fonction": "extrait",
          "raison": "Streaming payant protégé par DRM : jamais téléchargé."
        }
      ],
      "attribution_obligatoire": false
    }
  ]
};

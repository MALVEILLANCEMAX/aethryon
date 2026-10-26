// FICHIER GÉNÉRÉ par scripts/sync-plateformes.py depuis apps/media-api/app/plateformes.json (registre UNIQUE des
// plateformes) : ne pas modifier à la main. Données pour l'interface (catégories, icônes neutres, états) ;
// les extracteurs yt-dlp restent côté serveur. Vérifié par `make test` (--check).
export type EtatPlateforme = "officielle" | "beta" | "indisponible" | "refusee";
export type CategoriePlateforme = "populaires" | "musique" | "streaming" | "autres";
export interface PlateformeRegistre {
  id: string; nom: string; categorie: CategoriePlateforme; etat: EtatPlateforme; icone: string;
  domaines: readonly string[]; formats?: readonly string[]; priorite?: string; motif?: string; code?: string;
}
export interface RegistrePlateformes {
  version: string; ytdlp: string; categories: readonly { id: CategoriePlateforme; nom: string }[];
  icones: Readonly<Record<string, string>>; plateformes: readonly PlateformeRegistre[];
}

export const REGISTRE_PLATEFORMES: RegistrePlateformes = {
  "version": "2026-10-26",
  "ytdlp": "2026.08.19",
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
  "icones": {
    "video": "Vidéo (format paysage)",
    "vertical": "Vidéo verticale",
    "post": "Publication",
    "image": "Image animée",
    "direct": "Rediffusion ou clip de direct",
    "archive": "Archive, contenu libre",
    "onde": "Son"
  },
  "plateformes": [
    {
      "id": "youtube",
      "nom": "YouTube",
      "categorie": "populaires",
      "etat": "officielle",
      "icone": "video",
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
      "priorite": "P0"
    },
    {
      "id": "tiktok",
      "nom": "TikTok",
      "categorie": "populaires",
      "etat": "officielle",
      "icone": "vertical",
      "domaines": [
        "tiktok.com"
      ],
      "formats": [
        "mp4",
        "mp3",
        "gif",
        "extrait"
      ],
      "priorite": "P0"
    },
    {
      "id": "twitter",
      "nom": "X",
      "categorie": "populaires",
      "etat": "officielle",
      "icone": "post",
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
      "priorite": "P0"
    },
    {
      "id": "instagram",
      "nom": "Instagram",
      "categorie": "populaires",
      "etat": "beta",
      "icone": "vertical",
      "domaines": [
        "instagram.com",
        "instagr.am"
      ],
      "formats": [
        "mp4",
        "mp3",
        "gif",
        "extrait"
      ],
      "priorite": "P1"
    },
    {
      "id": "facebook",
      "nom": "Facebook",
      "categorie": "populaires",
      "etat": "indisponible",
      "icone": "video",
      "domaines": [
        "facebook.com",
        "fb.watch"
      ],
      "formats": [
        "mp4",
        "mp3",
        "gif",
        "extrait"
      ],
      "priorite": "P1"
    },
    {
      "id": "reddit",
      "nom": "Reddit",
      "categorie": "populaires",
      "etat": "indisponible",
      "icone": "post",
      "domaines": [
        "reddit.com",
        "redd.it"
      ],
      "formats": [
        "mp4",
        "mp3",
        "gif",
        "extrait"
      ],
      "priorite": "P1"
    },
    {
      "id": "vimeo",
      "nom": "Vimeo",
      "categorie": "populaires",
      "etat": "indisponible",
      "icone": "video",
      "domaines": [
        "vimeo.com"
      ],
      "formats": [
        "mp4",
        "mp3",
        "gif",
        "extrait"
      ],
      "priorite": "P0"
    },
    {
      "id": "dailymotion",
      "nom": "Dailymotion",
      "categorie": "populaires",
      "etat": "beta",
      "icone": "video",
      "domaines": [
        "dailymotion.com",
        "dai.ly"
      ],
      "formats": [
        "mp4",
        "mp3",
        "gif",
        "extrait"
      ],
      "priorite": "P0"
    },
    {
      "id": "bluesky",
      "nom": "Bluesky",
      "categorie": "populaires",
      "etat": "beta",
      "icone": "post",
      "domaines": [
        "bsky.app"
      ],
      "formats": [
        "mp4",
        "mp3",
        "gif"
      ],
      "priorite": "P1"
    },
    {
      "id": "pinterest",
      "nom": "Pinterest",
      "categorie": "populaires",
      "etat": "beta",
      "icone": "image",
      "domaines": [
        "pinterest.com",
        "pinterest.fr",
        "pinterest.co.uk",
        "pinterest.de",
        "pinterest.ca"
      ],
      "formats": [
        "mp4",
        "mp3",
        "gif",
        "extrait"
      ],
      "priorite": "P2"
    },
    {
      "id": "snapchat",
      "nom": "Snapchat Spotlight",
      "categorie": "populaires",
      "etat": "beta",
      "icone": "vertical",
      "domaines": [
        "snapchat.com"
      ],
      "formats": [
        "mp4",
        "mp3",
        "gif",
        "extrait"
      ],
      "priorite": "P2"
    },
    {
      "id": "linkedin",
      "nom": "LinkedIn",
      "categorie": "populaires",
      "etat": "beta",
      "icone": "post",
      "domaines": [
        "linkedin.com"
      ],
      "formats": [
        "mp4",
        "mp3",
        "gif",
        "extrait"
      ],
      "priorite": "P2"
    },
    {
      "id": "tumblr",
      "nom": "Tumblr",
      "categorie": "populaires",
      "etat": "indisponible",
      "icone": "post",
      "domaines": [
        "tumblr.com"
      ],
      "formats": [
        "mp4",
        "mp3",
        "gif",
        "extrait"
      ],
      "priorite": "P2"
    },
    {
      "id": "threads",
      "nom": "Threads",
      "categorie": "populaires",
      "etat": "indisponible",
      "icone": "post",
      "domaines": [
        "threads.net",
        "threads.com"
      ],
      "priorite": "P2"
    },
    {
      "id": "twitch",
      "nom": "Twitch (clips et rediffusions)",
      "categorie": "streaming",
      "etat": "beta",
      "icone": "direct",
      "domaines": [
        "twitch.tv"
      ],
      "formats": [
        "mp4",
        "mp3",
        "gif",
        "extrait"
      ],
      "priorite": "P1"
    },
    {
      "id": "kick",
      "nom": "Kick (clips et rediffusions)",
      "categorie": "streaming",
      "etat": "beta",
      "icone": "direct",
      "domaines": [
        "kick.com"
      ],
      "formats": [
        "mp4",
        "mp3",
        "gif",
        "extrait"
      ],
      "priorite": "P2"
    },
    {
      "id": "streamable",
      "nom": "Streamable",
      "categorie": "autres",
      "etat": "beta",
      "icone": "video",
      "domaines": [
        "streamable.com"
      ],
      "formats": [
        "mp4",
        "mp3",
        "gif",
        "extrait"
      ],
      "priorite": "P1"
    },
    {
      "id": "imgur",
      "nom": "Imgur",
      "categorie": "autres",
      "etat": "beta",
      "icone": "image",
      "domaines": [
        "imgur.com"
      ],
      "formats": [
        "mp4",
        "gif",
        "extrait"
      ],
      "priorite": "P2"
    },
    {
      "id": "bilibili",
      "nom": "Bilibili",
      "categorie": "autres",
      "etat": "indisponible",
      "icone": "video",
      "domaines": [
        "bilibili.com"
      ],
      "formats": [
        "mp4",
        "mp3",
        "gif",
        "extrait"
      ],
      "priorite": "P2"
    },
    {
      "id": "rumble",
      "nom": "Rumble",
      "categorie": "autres",
      "etat": "indisponible",
      "icone": "video",
      "domaines": [
        "rumble.com"
      ],
      "formats": [
        "mp4",
        "mp3",
        "gif",
        "extrait"
      ],
      "priorite": "P2"
    },
    {
      "id": "vk",
      "nom": "VK Vidéo",
      "categorie": "autres",
      "etat": "beta",
      "icone": "video",
      "domaines": [
        "vk.com",
        "vkvideo.ru"
      ],
      "formats": [
        "mp4",
        "mp3",
        "gif",
        "extrait"
      ],
      "priorite": "P2"
    },
    {
      "id": "archive",
      "nom": "Internet Archive",
      "categorie": "autres",
      "etat": "beta",
      "icone": "archive",
      "domaines": [
        "archive.org"
      ],
      "formats": [
        "mp4",
        "mp3",
        "gif",
        "extrait"
      ],
      "priorite": "P1"
    },
    {
      "id": "wikimedia",
      "nom": "Wikimedia Commons",
      "categorie": "autres",
      "etat": "beta",
      "icone": "archive",
      "domaines": [
        "commons.wikimedia.org"
      ],
      "formats": [
        "mp4",
        "mp3",
        "gif"
      ],
      "priorite": "P1"
    },
    {
      "id": "youtube_music",
      "nom": "YouTube Music",
      "categorie": "musique",
      "etat": "refusee",
      "icone": "onde",
      "domaines": [
        "music.youtube.com",
        "music.youtu.be",
        "music.youtube-nocookie.com",
        "youtubemusic.com"
      ],
      "motif": "Catalogue musical commercial : fermé par décision du propriétaire (2026-10-23).",
      "code": "youtube_music_not_accepted"
    },
    {
      "id": "soundcloud",
      "nom": "SoundCloud",
      "categorie": "musique",
      "etat": "refusee",
      "icone": "onde",
      "domaines": [
        "soundcloud.com",
        "snd.sc"
      ],
      "motif": "Conditions de l'API : le téléchargement des sons y est interdit (cloud-music/MUSIC-RAPPORT.md)."
    },
    {
      "id": "spotify",
      "nom": "Spotify",
      "categorie": "musique",
      "etat": "refusee",
      "icone": "onde",
      "domaines": [
        "spotify.com",
        "spotify.link"
      ],
      "motif": "Streaming payant protégé par DRM : jamais téléchargé."
    },
    {
      "id": "deezer",
      "nom": "Deezer",
      "categorie": "musique",
      "etat": "refusee",
      "icone": "onde",
      "domaines": [
        "deezer.com",
        "deezer.page.link",
        "dzr.page.link"
      ],
      "motif": "Streaming payant protégé par DRM : jamais téléchargé."
    },
    {
      "id": "apple_music",
      "nom": "Apple Music",
      "categorie": "musique",
      "etat": "refusee",
      "icone": "onde",
      "domaines": [
        "music.apple.com"
      ],
      "motif": "Streaming payant protégé par DRM : jamais téléchargé."
    },
    {
      "id": "amazon_music",
      "nom": "Amazon Music",
      "categorie": "musique",
      "etat": "refusee",
      "icone": "onde",
      "domaines": [
        "music.amazon.com",
        "music.amazon.fr"
      ],
      "motif": "Streaming payant protégé par DRM : jamais téléchargé."
    },
    {
      "id": "tidal",
      "nom": "Tidal",
      "categorie": "musique",
      "etat": "refusee",
      "icone": "onde",
      "domaines": [
        "tidal.com"
      ],
      "motif": "Streaming payant protégé par DRM : jamais téléchargé."
    },
    {
      "id": "bandcamp",
      "nom": "Bandcamp",
      "categorie": "musique",
      "etat": "refusee",
      "icone": "onde",
      "domaines": [
        "bandcamp.com"
      ],
      "motif": "Seuls les titres offerts en téléchargement gratuit par l'artiste seraient acceptables ; le tri fiable n'est pas encore démontré : refus (piste P2)."
    },
    {
      "id": "mixcloud",
      "nom": "Mixcloud",
      "categorie": "musique",
      "etat": "refusee",
      "icone": "onde",
      "domaines": [
        "mixcloud.com"
      ],
      "motif": "Conditions : écoute en ligne seulement, enregistrement et téléchargement interdits (licences des mixes)."
    },
    {
      "id": "audiomack",
      "nom": "Audiomack",
      "categorie": "musique",
      "etat": "refusee",
      "icone": "onde",
      "domaines": [
        "audiomack.com"
      ],
      "motif": "Catalogue musical commercial : écoute hors ligne réservée à l'application."
    },
    {
      "id": "netflix",
      "nom": "Netflix",
      "categorie": "streaming",
      "etat": "refusee",
      "icone": "video",
      "domaines": [
        "netflix.com"
      ],
      "motif": "Streaming payant protégé par DRM : jamais téléchargé."
    },
    {
      "id": "disney_plus",
      "nom": "Disney+",
      "categorie": "streaming",
      "etat": "refusee",
      "icone": "video",
      "domaines": [
        "disneyplus.com"
      ],
      "motif": "Streaming payant protégé par DRM : jamais téléchargé."
    },
    {
      "id": "prime_video",
      "nom": "Prime Video",
      "categorie": "streaming",
      "etat": "refusee",
      "icone": "video",
      "domaines": [
        "primevideo.com"
      ],
      "motif": "Streaming payant protégé par DRM : jamais téléchargé."
    },
    {
      "id": "canal_plus",
      "nom": "Canal+",
      "categorie": "streaming",
      "etat": "refusee",
      "icone": "video",
      "domaines": [
        "canalplus.com"
      ],
      "motif": "Streaming payant protégé par DRM : jamais téléchargé."
    },
    {
      "id": "crunchyroll",
      "nom": "Crunchyroll",
      "categorie": "streaming",
      "etat": "refusee",
      "icone": "video",
      "domaines": [
        "crunchyroll.com"
      ],
      "motif": "Streaming payant protégé par DRM : jamais téléchargé."
    }
  ]
};

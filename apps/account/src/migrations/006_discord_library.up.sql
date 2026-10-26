-- Bot Discord, version 2 (docs/DISCORD-BOT.md §18) : préférences personnelles, médias enregistrés, réglages de serveur.
-- Trois tables NOUVELLES : aucune table existante n'est modifiée (retour arrière = suppression de ces tables).

-- 1. Préférences personnelles (Discord aujourd'hui, le site ensuite) : format et qualité par défaut, visibilité par
--    défaut d'un résultat, langue. Une ligne par compte, créée à la première modification ; supprimée avec le compte.
CREATE TABLE ytc_user_pref (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  fmt TEXT NOT NULL DEFAULT 'mp4' CHECK (fmt IN ('mp4', 'mp3')),
  quality TEXT NOT NULL DEFAULT 'auto' CHECK (quality IN ('auto', '720', '1080')),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'share')),
  locale TEXT NOT NULL DEFAULT 'auto' CHECK (locale IN ('auto', 'fr', 'en')),
  updated_at TEXT NOT NULL
);

-- 2. Médias enregistrés (bouton « Enregistrer », /saved) : une RÉFÉRENCE, jamais le fichier. Seul cas où AETHRYON
--    garde un lien et un titre : l'utilisateur l'a demandé explicitement, item par item ; il peut tout effacer ;
--    supprimé avec le compte, inclus dans l'export. Lien canonique (https, plateforme prise en charge, ≤ 300).
CREATE TABLE ytc_saved_media (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 32),
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'tiktok', 'x')),
  source_url TEXT NOT NULL CHECK (length(source_url) BETWEEN 12 AND 300 AND source_url GLOB 'https://*'),
  media_type TEXT NOT NULL DEFAULT 'video' CHECK (media_type IN ('video', 'audio')),
  title TEXT CHECK (title IS NULL OR length(title) BETWEEN 1 AND 200),
  creator TEXT CHECK (creator IS NULL OR length(creator) BETWEEN 1 AND 100),
  duration_s INTEGER CHECK (duration_s IS NULL OR duration_s BETWEEN 0 AND 86400),
  origin TEXT NOT NULL DEFAULT 'discord' CHECK (origin IN ('discord', 'site')),
  saved_at TEXT NOT NULL,
  UNIQUE (user_id, source_url)
);
CREATE INDEX ytc_saved_media_user ON ytc_saved_media(user_id, saved_at DESC);

-- 3. Réglages d'un serveur Discord (/config) : JSON validé par account (discord-library.ts). Aucune donnée personnelle
--    (ni identifiant de l'administrateur qui a modifié, ni nom du serveur) ; effacé quand le bot quitte le serveur ou
--    après 400 jours sans modification.
CREATE TABLE ytc_discord_guild (
  guild_id TEXT PRIMARY KEY CHECK (length(guild_id) BETWEEN 17 AND 20 AND guild_id NOT GLOB '*[^0-9]*'),
  settings TEXT NOT NULL CHECK (length(settings) BETWEEN 2 AND 4000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ytc_discord_guild_updated ON ytc_discord_guild(updated_at);

-- Liaison d'un compte Discord au compte AETHRYON (docs/DISCORD-BOT.md §3.1 et §17).
-- 1. Liaison : un compte AETHRYON ↔ un compte Discord. Seuls l'identifiant Discord (snowflake) et le nom
--    d'utilisateur Discord sont conservés ; jamais le jeton d'accès Discord. Supprimée avec le compte.
CREATE TABLE ytc_discord_link (
  discord_user_id TEXT PRIMARY KEY CHECK (length(discord_user_id) BETWEEN 17 AND 20 AND discord_user_id NOT GLOB '*[^0-9]*'),
  user_id TEXT NOT NULL UNIQUE REFERENCES "user"(id) ON DELETE CASCADE,
  discord_name TEXT NOT NULL CHECK (length(discord_name) BETWEEN 1 AND 64),
  linked_at TEXT NOT NULL,
  last_used_at TEXT
);

-- 2. États OAuth à usage unique (10 min) : seule l'empreinte SHA-256 du `state` est stockée, avec le compte
--    et l'empreinte de la session qui ont démarré la liaison (le retour doit venir de la même session).
CREATE TABLE ytc_discord_state (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX ytc_discord_state_user ON ytc_discord_state(user_id);
CREATE INDEX ytc_discord_state_expires ON ytc_discord_state(expires_at);

-- 3. Liens de téléchargement à usage unique (10 min) remis par le bot : empreinte du lien, compte, job ytapi
--    (identifiant opaque). Ni lien de la vidéo, ni titre, ni nom de fichier.
CREATE TABLE ytc_discord_download (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX ytc_discord_download_user ON ytc_discord_download(user_id);
CREATE INDEX ytc_discord_download_expires ON ytc_discord_download(expires_at);

-- 4. ytc_key_meta : type « discord » (clés ytc_ de 15 min émises pour le bot) et deux motifs de révocation :
--    « unlink » (liaison Discord retirée) et « released » (clé rendue par le bot en fin de conversion).
--    SQLite ne sait pas modifier une contrainte CHECK : reconstruction à l'identique, comme en 004 (mêmes
--    colonnes et index ; aucune table ne référence ytc_key_meta). La migration entière est une transaction.
CREATE TABLE ytc_key_meta_005 (
  key_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  revoked_at TEXT,
  revoked_reason TEXT CHECK (revoked_reason IN ('user', 'rotation', 'admin', 'account_deleted', 'replay', 'unlink', 'released')),
  replaced_by TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  kind TEXT NOT NULL DEFAULT 'shortcut' CHECK (kind IN ('shortcut', 'extension', 'discord')),
  device_label TEXT
);
INSERT INTO ytc_key_meta_005 (key_id, user_id, revoked_at, revoked_reason, replaced_by, created_at, last_used_at, kind, device_label)
  SELECT key_id, user_id, revoked_at, revoked_reason, replaced_by, created_at, last_used_at, kind, device_label FROM ytc_key_meta;
DROP TABLE ytc_key_meta;
ALTER TABLE ytc_key_meta_005 RENAME TO ytc_key_meta;
CREATE INDEX ytc_key_meta_user ON ytc_key_meta(user_id);

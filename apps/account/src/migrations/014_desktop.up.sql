-- AETHRYON Desktop relié au compte (cloud-music/CLOUD-UI.md ; même flux que le panneau Premiere, 012, inspiré de la
-- RFC 8628 « Device Authorization Grant ») : le cœur Rust du Desktop demande un appairage, l'utilisateur l'autorise sur
-- la page d'accord du site (/desktop/connecter), le cœur reçoit une clé « desktop » qu'il garde dans le stockage protégé
-- de Windows (DPAPI), jamais dans la WebView. Cette clé ouvre AETHRYON Cloud (administrateur seulement) et servira à la
-- future section MUSIQUE.
-- 1. ytc_key_meta : type « desktop ». SQLite ne sait pas modifier une contrainte CHECK : reconstruction à l'identique,
--    comme en 004, 005, 010 et 012 (mêmes colonnes et index ; aucune table ne référence ytc_key_meta). La migration
--    entière est une transaction.
CREATE TABLE ytc_key_meta_014 (
  key_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  revoked_at TEXT,
  revoked_reason TEXT CHECK (revoked_reason IN ('user', 'rotation', 'admin', 'account_deleted', 'replay', 'unlink', 'released')),
  replaced_by TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  kind TEXT NOT NULL DEFAULT 'shortcut' CHECK (kind IN ('shortcut', 'extension', 'discord', 'outils', 'premiere', 'desktop')),
  device_label TEXT
);
INSERT INTO ytc_key_meta_014 (key_id, user_id, revoked_at, revoked_reason, replaced_by, created_at, last_used_at, kind, device_label)
  SELECT key_id, user_id, revoked_at, revoked_reason, replaced_by, created_at, last_used_at, kind, device_label FROM ytc_key_meta;
DROP TABLE ytc_key_meta;
ALTER TABLE ytc_key_meta_014 RENAME TO ytc_key_meta;
CREATE INDEX ytc_key_meta_user ON ytc_key_meta(user_id);

-- 2. Demandes d'appairage du Desktop (10 min), même forme que ytc_premiere_code :
--    - device_hash : empreinte SHA-256 (base64url) du code d'appareil (32 octets que seul le cœur du Desktop connaît) ;
--    - user_code : 8 lettres sans voyelle, affichées dans le Desktop et sur la page d'accord, à usage unique ;
--    - status : pending → approved (user_id) → issued (key_id) ; ou denied ; l'expiration se lit dans expires_at ;
--    - host, desktop_version : indicatifs (le nom d'hôte devient le nom de l'appareil de la clé) ;
--    - gardées 24 h après expiration (reconnaître un code rejoué), puis effacées par la purge quotidienne.
--    Aucune adresse IP, aucun jeton, aucun e-mail.
CREATE TABLE ytc_desktop_code (
  device_hash TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE CHECK (length(user_code) = 8),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'issued')),
  user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE,
  host TEXT,
  desktop_version TEXT,
  key_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_at TEXT,
  issued_at TEXT
);
CREATE INDEX ytc_desktop_code_user ON ytc_desktop_code(user_id);
CREATE INDEX ytc_desktop_code_expires ON ytc_desktop_code(expires_at);

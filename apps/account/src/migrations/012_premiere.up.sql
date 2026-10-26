-- AETHRYON pour Premiere Pro v2 : connexion du panneau au compte par une page d'accord
-- (<notes internes non publiées> ; flux inspiré de la RFC 8628, « Device Authorization Grant »).
-- 1. ytc_key_meta : type « premiere » (clé ytc_ du panneau Premiere, 30 jours, mêmes droits et même quota qu'une clé
--    d'extension). SQLite ne sait pas modifier une contrainte CHECK : reconstruction à l'identique, comme en 004, 005 et
--    010 (mêmes colonnes et index ; aucune table ne référence ytc_key_meta). La migration entière est une transaction.
CREATE TABLE ytc_key_meta_012 (
  key_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  revoked_at TEXT,
  revoked_reason TEXT CHECK (revoked_reason IN ('user', 'rotation', 'admin', 'account_deleted', 'replay', 'unlink', 'released')),
  replaced_by TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  kind TEXT NOT NULL DEFAULT 'shortcut' CHECK (kind IN ('shortcut', 'extension', 'discord', 'outils', 'premiere')),
  device_label TEXT
);
INSERT INTO ytc_key_meta_012 (key_id, user_id, revoked_at, revoked_reason, replaced_by, created_at, last_used_at, kind, device_label)
  SELECT key_id, user_id, revoked_at, revoked_reason, replaced_by, created_at, last_used_at, kind, device_label FROM ytc_key_meta;
DROP TABLE ytc_key_meta;
ALTER TABLE ytc_key_meta_012 RENAME TO ytc_key_meta;
CREATE INDEX ytc_key_meta_user ON ytc_key_meta(user_id);

-- 2. Demandes d'appairage du panneau Premiere (10 min) :
--    - device_hash : empreinte SHA-256 (base64url) du code d'appareil, secret de 32 octets que seul le panneau connaît ;
--      le code lui-même n'est jamais stocké ;
--    - user_code : code court affiché dans Premiere et sur la page d'accord (8 lettres sans voyelle, sans tiret) ;
--      inutile sans une session du site, valable 10 min, à usage unique ;
--    - status : pending (en attente) → approved (autorisée par user_id) → issued (clé remise, key_id) ; ou denied
--      (refusée, définitif). L'expiration se lit dans expires_at (définitive, elle aussi) ;
--    - host, premiere_version, extension_version : informations données par le panneau, purement indicatives
--      (affichées sur la page d'accord ; le nom d'hôte devient le nom de l'appareil de la clé) ;
--    - gardées 24 h après expiration (reconnaître un code rejoué), puis effacées par la purge quotidienne.
--    Aucune adresse IP, aucun jeton, aucun e-mail.
CREATE TABLE ytc_premiere_code (
  device_hash TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE CHECK (length(user_code) = 8),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'issued')),
  user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE,
  host TEXT,
  premiere_version TEXT,
  extension_version TEXT,
  key_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_at TEXT,
  issued_at TEXT
);
CREATE INDEX ytc_premiere_code_user ON ytc_premiere_code(user_id);
CREATE INDEX ytc_premiere_code_expires ON ytc_premiere_code(expires_at);

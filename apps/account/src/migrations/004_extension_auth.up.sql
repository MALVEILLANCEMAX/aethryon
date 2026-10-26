-- Connexion de l'extension navigateur (docs/EXTENSION.md §7).
-- 1. Codes d'autorisation à usage unique (PKCE S256, 120 s) : seule l'empreinte SHA-256 du code est
--    stockée ; key_id = clé émise en échange (révoquée si le code est présenté une seconde fois).
CREATE TABLE ytc_ext_code (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  device_label TEXT,
  key_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX ytc_ext_code_user ON ytc_ext_code(user_id);
CREATE INDEX ytc_ext_code_expires ON ytc_ext_code(expires_at);

-- 2. ytc_key_meta : type de clé (raccourci | extension), appareil lié, et motif de révocation
--    « replay » (code d'autorisation rejoué). SQLite ne sait pas modifier une contrainte CHECK : la
--    table est reconstruite à l'identique (mêmes colonnes et index ; aucune table ne la référence).
CREATE TABLE ytc_key_meta_004 (
  key_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  revoked_at TEXT,
  revoked_reason TEXT CHECK (revoked_reason IN ('user', 'rotation', 'admin', 'account_deleted', 'replay')),
  replaced_by TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  kind TEXT NOT NULL DEFAULT 'shortcut' CHECK (kind IN ('shortcut', 'extension')),
  device_label TEXT
);
INSERT INTO ytc_key_meta_004 (key_id, user_id, revoked_at, revoked_reason, replaced_by, created_at, last_used_at)
  SELECT key_id, user_id, revoked_at, revoked_reason, replaced_by, created_at, last_used_at FROM ytc_key_meta;
DROP TABLE ytc_key_meta;
ALTER TABLE ytc_key_meta_004 RENAME TO ytc_key_meta;
CREATE INDEX ytc_key_meta_user ON ytc_key_meta(user_id);

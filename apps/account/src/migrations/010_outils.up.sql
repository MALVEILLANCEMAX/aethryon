-- AETHRYON Tools (docs/OUTILS.md).
-- 1. ytc_key_meta : type « outils » (clés ytc_ de 15 min émises par account pour un compte connecté au site : account
--    les garde en mémoire et relaie à ytapi les demandes de l'éditeur ; jamais remises au navigateur, jamais listées dans
--    « Mes jetons »). SQLite ne sait pas modifier une contrainte CHECK : reconstruction à l'identique, comme en 004 et 005
--    (mêmes colonnes et index ; aucune table ne référence ytc_key_meta). La migration entière est une transaction.
CREATE TABLE ytc_key_meta_010 (
  key_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  revoked_at TEXT,
  revoked_reason TEXT CHECK (revoked_reason IN ('user', 'rotation', 'admin', 'account_deleted', 'replay', 'unlink', 'released')),
  replaced_by TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  kind TEXT NOT NULL DEFAULT 'shortcut' CHECK (kind IN ('shortcut', 'extension', 'discord', 'outils')),
  device_label TEXT
);
INSERT INTO ytc_key_meta_010 (key_id, user_id, revoked_at, revoked_reason, replaced_by, created_at, last_used_at, kind, device_label)
  SELECT key_id, user_id, revoked_at, revoked_reason, replaced_by, created_at, last_used_at, kind, device_label FROM ytc_key_meta;
DROP TABLE ytc_key_meta;
ALTER TABLE ytc_key_meta_010 RENAME TO ytc_key_meta;
CREATE INDEX ytc_key_meta_user ON ytc_key_meta(user_id);

-- 2. Liens « Ouvrir dans AETHRYON Tools » (bot Discord, extension) : empreinte SHA-256 du lien, compte, job ytapi
--    (identifiant opaque), origine. Valables 55 min au plus (la durée de vie d'un fichier de ytapi), seulement pour le
--    compte connecté qui en est le propriétaire. Ni lien de la vidéo, ni titre, ni nom de fichier.
CREATE TABLE ytc_outils_ref (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL CHECK (length(job_id) BETWEEN 1 AND 40),
  origin TEXT NOT NULL CHECK (origin IN ('discord', 'extension')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ytc_outils_ref_user ON ytc_outils_ref(user_id);
CREATE INDEX ytc_outils_ref_expires ON ytc_outils_ref(expires_at);

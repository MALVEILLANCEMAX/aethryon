-- Retour arrière de 010 : liens « Ouvrir dans AETHRYON Tools » supprimés ; les clés « outils » (15 min au plus) sont
-- EFFACÉES (apikey et métadonnées) : l'ancien code les accepterait sinon comme des jetons du raccourci jusqu'à leur
-- expiration. ytc_key_meta reprend la forme de 005. Le reste est conservé à l'identique.
DROP TABLE IF EXISTS ytc_outils_ref;
DELETE FROM apikey WHERE id IN (SELECT key_id FROM ytc_key_meta WHERE kind = 'outils');
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
  SELECT key_id, user_id, revoked_at, revoked_reason, replaced_by, created_at, last_used_at, kind, device_label
  FROM ytc_key_meta WHERE kind <> 'outils';
DROP TABLE ytc_key_meta;
ALTER TABLE ytc_key_meta_005 RENAME TO ytc_key_meta;
CREATE INDEX ytc_key_meta_user ON ytc_key_meta(user_id);

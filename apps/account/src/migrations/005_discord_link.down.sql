-- Retour arrière de 005 : liaisons, états OAuth et liens de téléchargement supprimés ; les clés « discord »
-- (15 min au plus) sont EFFACÉES (apikey et métadonnées) : l'ancien code les accepterait sinon comme des jetons
-- du raccourci jusqu'à leur expiration. ytc_key_meta reprend la forme de 004 ; les motifs « unlink » et
-- « released » (clés discord seulement, donc effacées) n'y figurent plus. Le reste est conservé à l'identique.
DROP TABLE IF EXISTS ytc_discord_download;
DROP TABLE IF EXISTS ytc_discord_state;
DROP TABLE IF EXISTS ytc_discord_link;
DELETE FROM apikey WHERE id IN (SELECT key_id FROM ytc_key_meta WHERE kind = 'discord');
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
INSERT INTO ytc_key_meta_004 (key_id, user_id, revoked_at, revoked_reason, replaced_by, created_at, last_used_at, kind, device_label)
  SELECT key_id, user_id, revoked_at, CASE WHEN revoked_reason IN ('unlink', 'released') THEN 'user' ELSE revoked_reason END,
         replaced_by, created_at, last_used_at, kind, device_label
  FROM ytc_key_meta WHERE kind <> 'discord';
DROP TABLE ytc_key_meta;
ALTER TABLE ytc_key_meta_004 RENAME TO ytc_key_meta;
CREATE INDEX ytc_key_meta_user ON ytc_key_meta(user_id);

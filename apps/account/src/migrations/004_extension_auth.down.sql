-- Retour arrière de 004 : codes d'autorisation supprimés ; ytc_key_meta reprend la forme de 003
-- (sans kind ni device_label, motif « replay » ramené à NULL : la clé reste révoquée). Les clés
-- d'extension restent des clés ytc_ ordinaires (l'ancien code les compte comme jetons du raccourci).
DROP TABLE IF EXISTS ytc_ext_code;
CREATE TABLE ytc_key_meta_003 (
  key_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  revoked_at TEXT,
  revoked_reason TEXT CHECK (revoked_reason IN ('user', 'rotation', 'admin', 'account_deleted')),
  replaced_by TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
INSERT INTO ytc_key_meta_003 (key_id, user_id, revoked_at, revoked_reason, replaced_by, created_at, last_used_at)
  SELECT key_id, user_id, revoked_at, CASE WHEN revoked_reason = 'replay' THEN NULL ELSE revoked_reason END, replaced_by, created_at, last_used_at
  FROM ytc_key_meta;
DROP TABLE ytc_key_meta;
ALTER TABLE ytc_key_meta_003 RENAME TO ytc_key_meta;
CREATE INDEX ytc_key_meta_user ON ytc_key_meta(user_id);

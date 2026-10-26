-- Retour arrière de 014 : demandes d'appairage du Desktop supprimées ; les clés « desktop » sont EFFACÉES (apikey et
-- métadonnées) : l'ancien code les prendrait sinon pour des jetons du raccourci jusqu'à leur expiration. Les Desktop
-- reliés se retrouvent déconnectés (leur cœur efface la clé refusée et propose de se relier). ytc_key_meta reprend la
-- forme de 012. Le reste est conservé à l'identique.
DROP TABLE IF EXISTS ytc_desktop_code;
DELETE FROM apikey WHERE id IN (SELECT key_id FROM ytc_key_meta WHERE kind = 'desktop');
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
  SELECT key_id, user_id, revoked_at, revoked_reason, replaced_by, created_at, last_used_at, kind, device_label
  FROM ytc_key_meta WHERE kind <> 'desktop';
DROP TABLE ytc_key_meta;
ALTER TABLE ytc_key_meta_012 RENAME TO ytc_key_meta;
CREATE INDEX ytc_key_meta_user ON ytc_key_meta(user_id);

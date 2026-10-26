-- Tables propres à YouTube Converter (les tables Better Auth sont créées avant par getMigrations).
CREATE TABLE ytc_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  key_id TEXT,
  day TEXT NOT NULL,
  fmt TEXT NOT NULL CHECK (fmt IN ('mp3', 'mp4')),
  platform TEXT,
  state TEXT NOT NULL CHECK (state IN ('reserved', 'running', 'done', 'error', 'cancelled', 'refunded')),
  error_code TEXT,
  size_bytes INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX ytc_usage_user_day ON ytc_usage(user_id, day);
CREATE INDEX ytc_usage_created ON ytc_usage(created_at);

CREATE TABLE ytc_key_meta (
  key_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  revoked_at TEXT,
  revoked_reason TEXT CHECK (revoked_reason IN ('user', 'rotation', 'admin', 'account_deleted')),
  replaced_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX ytc_key_meta_user ON ytc_key_meta(user_id);

CREATE TABLE ytc_setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE ytc_admin_event (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  details TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX ytc_admin_event_created ON ytc_admin_event(created_at);

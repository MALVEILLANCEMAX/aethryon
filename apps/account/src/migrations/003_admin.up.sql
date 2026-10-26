-- Control Center (docs/ADMIN.md §4) : quotas par utilisateur, bonus du jour, refus agrégés,
-- détails des conversions (job ytapi, début du traitement, cause nettoyée), dernière utilisation des
-- jetons et journal d'administration enrichi.
CREATE TABLE ytc_user_policy (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  daily_limit INTEGER,
  unlimited INTEGER NOT NULL DEFAULT 0,
  max_active INTEGER,
  reset_day TEXT,
  reset_at TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
-- Reprise des quotas personnalisés existants (colonne Better Auth "dailyLimitOverride", plus lue ensuite).
INSERT INTO ytc_user_policy (user_id, daily_limit, unlimited, updated_at, updated_by)
  SELECT id, "dailyLimitOverride", 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'migration 003'
  FROM "user" WHERE "dailyLimitOverride" IS NOT NULL;

CREATE TABLE ytc_quota_grant (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount BETWEEN 1 AND 1000),
  reason TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX ytc_quota_grant_user_day ON ytc_quota_grant(user_id, day);

CREATE TABLE ytc_auth_failure (
  day TEXT NOT NULL,
  reason TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  last_at TEXT NOT NULL,
  PRIMARY KEY (day, reason)
);

ALTER TABLE ytc_usage ADD COLUMN job_id TEXT;      -- identifiant du job ytapi
ALTER TABLE ytc_usage ADD COLUMN started_at TEXT;  -- passage à « running »
ALTER TABLE ytc_usage ADD COLUMN cause TEXT;       -- cause technique nettoyée (≤ 300, sans URL ni jeton)
CREATE INDEX ytc_usage_job ON ytc_usage(job_id);
CREATE INDEX ytc_usage_state ON ytc_usage(state);
ALTER TABLE ytc_key_meta ADD COLUMN last_used_at TEXT;
ALTER TABLE ytc_admin_event ADD COLUMN actor_label TEXT;            -- e-mail de l'admin au moment de l'action
ALTER TABLE ytc_admin_event ADD COLUMN target_type TEXT;            -- user, key, job, setting, quota
ALTER TABLE ytc_admin_event ADD COLUMN result TEXT NOT NULL DEFAULT 'ok';  -- ok | refused | error
CREATE INDEX ytc_admin_event_action ON ytc_admin_event(action);

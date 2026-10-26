-- Retour arrière de 003 : les quotas personnalisés reviennent dans "dailyLimitOverride" (lu par le code
-- d'avant 003), puis les tables et colonnes ajoutées sont supprimées (SQLite ≥ 3.35).
UPDATE "user" SET "dailyLimitOverride" = (SELECT p.daily_limit FROM ytc_user_policy p WHERE p.user_id = "user".id);
DROP INDEX IF EXISTS ytc_admin_event_action;
ALTER TABLE ytc_admin_event DROP COLUMN result;
ALTER TABLE ytc_admin_event DROP COLUMN target_type;
ALTER TABLE ytc_admin_event DROP COLUMN actor_label;
ALTER TABLE ytc_key_meta DROP COLUMN last_used_at;
DROP INDEX IF EXISTS ytc_usage_state;
DROP INDEX IF EXISTS ytc_usage_job;
ALTER TABLE ytc_usage DROP COLUMN cause;
ALTER TABLE ytc_usage DROP COLUMN started_at;
ALTER TABLE ytc_usage DROP COLUMN job_id;
DROP TABLE IF EXISTS ytc_auth_failure;
DROP TABLE IF EXISTS ytc_quota_grant;
DROP TABLE IF EXISTS ytc_user_policy;

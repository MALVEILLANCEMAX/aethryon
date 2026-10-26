DROP TABLE IF EXISTS ytc_plan_waitlist;
ALTER TABLE ytc_signup_token DROP COLUMN code_attempts;
ALTER TABLE ytc_signup_token DROP COLUMN code_expires_at;
ALTER TABLE ytc_signup_token DROP COLUMN code_hash;

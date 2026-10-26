-- AETHRYON V3 (docs/DEPLOIEMENT.md §26).
-- 1. Inscription par CODE à 6 chiffres, en plus du lien (signup.ts) : empreinte HMAC du code (jamais le code), échéance
--    courte et essais comptés. Colonnes nouvelles d'une table existante, vides pour les anciennes demandes (leur lien
--    reste valable, sans code).
ALTER TABLE ytc_signup_token ADD COLUMN code_hash TEXT CHECK (code_hash IS NULL OR length(code_hash) = 64);
ALTER TABLE ytc_signup_token ADD COLUMN code_expires_at TEXT;
ALTER TABLE ytc_signup_token ADD COLUMN code_attempts INTEGER NOT NULL DEFAULT 0 CHECK (code_attempts BETWEEN 0 AND 10);

-- 2. « Me prévenir » quand Plus ou Pro ouvrira (abonnement.ts) : demande explicite d'un compte, retirable à tout moment,
--    effacée avec le compte, incluse dans l'export. Aucune autre donnée.
CREATE TABLE ytc_plan_waitlist (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('plus', 'pro')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, plan)
);

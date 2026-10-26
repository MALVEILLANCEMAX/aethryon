-- Registre anti-abus du quota quotidien : survit à la suppression du compte (pas de clé étrangère).
-- identity = HMAC-SHA256(secret du serveur, e-mail en minuscules) : l'e-mail n'y figure pas en clair.
-- Purgé après 2 jours.
CREATE TABLE ytc_quota_ledger (
  identity TEXT NOT NULL,
  day TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (identity, day)
);

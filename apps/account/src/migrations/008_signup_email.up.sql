-- Inscription par e-mail (docs/CONTRAT.md, « Inscription par e-mail ») : l'adresse est VÉRIFIÉE AVANT que le compte
-- n'existe. Une demande envoie un lien à usage unique (30 min) ; seule son EMPREINTE (SHA-256) est gardée, avec
-- l'adresse visée. Aucun compte non vérifié n'existe donc jamais : personne ne peut réserver l'adresse d'un autre.
-- Table NOUVELLE : aucune table existante n'est modifiée (retour arrière = suppression de cette table).
CREATE TABLE ytc_signup_token (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  email TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX ytc_signup_token_email ON ytc_signup_token (email, created_at);

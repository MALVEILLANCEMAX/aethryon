-- 016 : protection anti-bot (src/antibot.ts, docs/SECURITE-ANTIBOT.md) — section « Sécurité » du Control Center.
-- Aucune donnée personnelle inutile : ni adresse e-mail, ni IP complète, ni identifiant de compte, ni agent HTTP.
-- - ytc_security_counter : compteurs RÉELS par jour UTC (défis émis, réussis, échoués, expirés, rejoués, requêtes
--   limitées, blocages) ; 90 jours au plus (purge quotidienne de main.ts).
-- - ytc_security_event : événements suspects récents ; sujet = empreinte HMAC tronquée (12 caractères, clé dérivée du
--   secret du serveur, non réversible), IP TRONQUÉE (/24 ou /48) ; 14 jours et 5 000 lignes au plus.
CREATE TABLE ytc_security_counter (
  day TEXT NOT NULL CHECK (length(day) = 10),
  metric TEXT NOT NULL CHECK (length(metric) <= 40),
  action TEXT NOT NULL CHECK (length(action) <= 40),
  n INTEGER NOT NULL DEFAULT 0 CHECK (n >= 0),
  PRIMARY KEY (day, metric, action)
);
CREATE TABLE ytc_security_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (length(kind) <= 40),
  action TEXT NOT NULL CHECK (length(action) <= 40),
  subject TEXT NOT NULL CHECK (length(subject) <= 16),
  ip_prefix TEXT CHECK (ip_prefix IS NULL OR length(ip_prefix) <= 50),
  detail TEXT CHECK (detail IS NULL OR length(detail) <= 200)
);
CREATE INDEX ytc_security_event_at ON ytc_security_event(at);

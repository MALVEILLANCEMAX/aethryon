-- Retour arrière de 016 : compteurs et événements de la protection anti-bot supprimés ; rien d'autre n'est touché.
DROP INDEX IF EXISTS ytc_security_event_at;
DROP TABLE IF EXISTS ytc_security_event;
DROP TABLE IF EXISTS ytc_security_counter;

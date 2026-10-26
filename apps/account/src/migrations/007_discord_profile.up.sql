-- Profil Discord visible dans l'espace (2026-10-13, demande du propriétaire) : le nom affiché (global_name) et la
-- RÉFÉRENCE de l'image de profil (son empreinte publique chez Discord, jamais l'image elle-même), à côté du nom
-- d'utilisateur déjà conservé. Deux colonnes AJOUTÉES, vides par défaut : rien d'existant n'est modifié. Remplies à la
-- liaison (OAuth « identify ») et quand le bot reconnaît le compte (données que Discord joint à chaque interaction).
ALTER TABLE ytc_discord_link ADD COLUMN discord_display TEXT;
ALTER TABLE ytc_discord_link ADD COLUMN discord_avatar TEXT;

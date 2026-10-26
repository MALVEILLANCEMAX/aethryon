-- Retour arrière de 007 : les deux colonnes du profil sont retirées (le nom affiché et la référence de l'image ;
-- la liaison elle-même et le nom d'utilisateur restent).
ALTER TABLE ytc_discord_link DROP COLUMN discord_avatar;
ALTER TABLE ytc_discord_link DROP COLUMN discord_display;

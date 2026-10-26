-- Retour arrière de 006 : préférences, médias enregistrés et réglages de serveur SUPPRIMÉS (aucune autre table
-- n'est touchée). À faire seulement après une sauvegarde et avec l'accord du propriétaire : les médias enregistrés
-- par les utilisateurs sont effacés.
DROP TABLE IF EXISTS ytc_discord_guild;
DROP TABLE IF EXISTS ytc_saved_media;
DROP TABLE IF EXISTS ytc_user_pref;

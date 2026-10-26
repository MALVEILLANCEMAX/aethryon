-- Retour arrière de 015 : l'historique AETHRYON Music de l'espace est supprimé ; rien d'autre n'est touché.
DROP INDEX IF EXISTS ytc_music_historique_import;
DROP INDEX IF EXISTS ytc_music_historique_user;
DROP TABLE IF EXISTS ytc_music_historique;

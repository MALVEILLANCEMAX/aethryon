-- Retour arrière de 013 : tables d'AETHRYON Cloud supprimées (l'ancien code ne les lit pas ; aucune autre table n'a été
-- touchée). ATTENTION : les objets déjà envoyés restent dans le seau. Avant tout retour arrière avec CLOUD=on, vider le
-- préfixe du seau (toutes versions) ou laisser la règle de cycle de vie les effacer (INSTALLATION-CLOUD.md §5).
DROP TABLE IF EXISTS ytc_cloud_mesure;
DROP TABLE IF EXISTS ytc_cloud_journal;
DROP TABLE IF EXISTS ytc_cloud_compte;
DROP TABLE IF EXISTS ytc_cloud_objet;

-- AETHRYON Cloud V1 (<notes internes non publiées>) : stockage temporaire des médias
-- de l'administrateur dans un seau S3 PRIVÉ (Backblaze B2 d'abord ; Cloudflare R2 ou autre par la seule configuration).
-- Fonction coupée tant que CLOUD ≠ on. Uniquement des tables nouvelles : aucune table existante n'est touchée.
--
-- 1. ytc_cloud_objet : un fichier confié au cloud (une ligne par envoi, jamais réutilisée).
--    - cle : clé S3 GÉNÉRÉE PAR LE SERVEUR (<préfixe>v1/<empreinte du compte>/<id>) ; le nom d'origine n'y entre jamais ;
--    - statut : en_attente (réservé ; envoi à reprendre ou vérification impossible, fournisseur indisponible)
--      → envoi_en_cours (URL d'envoi délivrée) → sauvegarde (objet vérifié par HEAD : taille, empreinte)
--      → suppression_en_attente (accès révoqué, versions en cours de suppression) → expire | supprime ;
--      ou echec (rien n'est gardé : réservation rendue). « Téléchargé » est l'état du téléchargement lui-même (job de
--      ytapi, fichier du Desktop) : il ne vit pas ici ;
--    - taille : octets réservés puis vérifiés ; comptés dans le quota tant que le statut est en_attente, envoi_en_cours,
--      sauvegarde ou suppression_en_attente ;
--    - envoye_le : instant de la vérification (uploaded_at) ; expire_le = envoye_le + rétention (30 jours) ;
--    - tentatives, prochaine_tentative, derniere_erreur : reprise des vérifications et suppressions en échec ;
--    - version_id : version vue au HEAD (les autres versions d'une même clé sont supprimées par la réconciliation).
--    Aucune URL, aucun secret ; le nom d'origine ne quitte pas cette table (ni journal ni clé d'objet).
CREATE TABLE ytc_cloud_objet (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  cle TEXT NOT NULL UNIQUE,
  nom_original TEXT NOT NULL,
  type_mime TEXT NOT NULL,
  taille INTEGER NOT NULL CHECK (taille > 0),
  sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
  md5 TEXT CHECK (md5 IS NULL OR length(md5) = 24),
  origine TEXT NOT NULL CHECK (origine IN ('ytapi', 'desktop', 'extension', 'site')),
  source_job TEXT,
  plateforme TEXT,
  statut TEXT NOT NULL CHECK (statut IN ('en_attente', 'envoi_en_cours', 'sauvegarde', 'echec', 'suppression_en_attente', 'expire', 'supprime')),
  motif_suppression TEXT CHECK (motif_suppression IS NULL OR motif_suppression IN ('expiration', 'manuelle', 'invalide', 'abandon')),
  derniere_erreur TEXT,
  tentatives INTEGER NOT NULL DEFAULT 0,
  prochaine_tentative TEXT,
  cree_le TEXT NOT NULL,
  reserve_jusqu_a TEXT,
  envoye_le TEXT,
  expire_le TEXT,
  supprime_le TEXT,
  version_id TEXT,
  meta TEXT
);
CREATE INDEX ytc_cloud_objet_owner ON ytc_cloud_objet(owner_id, statut);
CREATE INDEX ytc_cloud_objet_statut ON ytc_cloud_objet(statut, expire_le);

-- 2. ytc_cloud_compte : réglages par compte. V1 : sauvegarde automatique oui/non. Colonnes prêtes pour la suite
--    (quota et rétention par compte, offre de stockage) : NULL = valeurs de la configuration (CLOUD_QUOTA_BYTES,
--    CLOUD_RETENTION_DAYS) ; aucune offre payante n'est lue ni activée en V1.
CREATE TABLE ytc_cloud_compte (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  sauvegarde_auto INTEGER NOT NULL DEFAULT 1 CHECK (sauvegarde_auto IN (0, 1)),
  quota_octets INTEGER CHECK (quota_octets IS NULL OR quota_octets >= 0),
  retention_jours INTEGER CHECK (retention_jours IS NULL OR retention_jours BETWEEN 1 AND 3650),
  offre TEXT,
  maj_le TEXT NOT NULL
);

-- 3. ytc_cloud_journal : opérations de fond et incidents (expiration, suppression, vérification, orphelin, réconciliation),
--    pour la reprise et le diagnostic. Identifiants internes et codes seulement ; gardé 90 jours.
CREATE TABLE ytc_cloud_journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  objet_id TEXT,
  action TEXT NOT NULL,
  resultat TEXT NOT NULL CHECK (resultat IN ('ok', 'echec')),
  detail TEXT,
  cree_le TEXT NOT NULL
);
CREATE INDEX ytc_cloud_journal_date ON ytc_cloud_journal(cree_le);

-- 4. ytc_cloud_mesure : dernière réconciliation base ⇄ stockage réel (toutes versions et marqueurs compris). L'écart
--    positif (octets présents dans le seau mais inconnus de la base) est ajouté au plafond global avant toute réservation.
CREATE TABLE ytc_cloud_mesure (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mesure_le TEXT NOT NULL,
  octets_reels INTEGER NOT NULL,
  octets_base INTEGER NOT NULL,
  ecart INTEGER NOT NULL,
  versions INTEGER NOT NULL,
  orphelins INTEGER NOT NULL,
  detail TEXT
);

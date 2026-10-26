-- 015 : historique AETHRYON Music de l'espace connecté (page « Musique » du site, relais /api/music/* de music.ts).
-- Seulement ce que le compte a fait : liens analysés (fiche résumée) et imports lancés (état final). Aucun fichier,
-- aucune métadonnée de service gardée au-delà de l'entrée (titre, artistes, pochette au moment de l'analyse).
-- 200 entrées au plus par compte (purge à l'écriture) ; effacées avec le compte (ON DELETE CASCADE).
CREATE TABLE ytc_music_historique (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('analyse', 'import')),
  url TEXT NOT NULL CHECK (length(url) <= 2048),
  connecteur TEXT NOT NULL CHECK (length(connecteur) <= 20),
  titre TEXT CHECK (titre IS NULL OR length(titre) <= 300),
  artistes TEXT CHECK (artistes IS NULL OR length(artistes) <= 2000),
  pochette TEXT CHECK (pochette IS NULL OR length(pochette) <= 2048),
  etat TEXT NOT NULL CHECK (length(etat) <= 30),
  import_id TEXT CHECK (import_id IS NULL OR length(import_id) <= 48),
  origine TEXT NOT NULL DEFAULT 'site' CHECK (origine IN ('site', 'desktop')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ytc_music_historique_user ON ytc_music_historique(user_id, id);
CREATE UNIQUE INDEX ytc_music_historique_import ON ytc_music_historique(user_id, import_id) WHERE import_id IS NOT NULL;

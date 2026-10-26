//! Index persistant d'AETHRYON Index : SQLite EMBARQUÉ (`index.sqlite` dans le dossier de l'index), journal WAL,
//! écritures par transactions courtes (un lot de dossiers à la fois) : une coupure de courant laisse la base dans son
//! dernier état validé, jamais à moitié écrite ; un scan interrompu est marqué « interrompu » à l'ouverture suivante et
//! se reprend par un scan incrémental.
//!
//! Tables : `volumes` (identité stable d'un disque), `dossiers` (chemin, clé normalisée), `fichiers` (un média par
//! chemin : identifiant `idm` = SHA-1 du chemin normalisé, MÊME RÈGLE que `index.json` (contrat §3), taille, dates,
//! type, identifiant de fichier, état présent / absent / indisponible, sources, métadonnées différées, miniature),
//! `scans` (historique et résumés), `racines`, et `recherche` (FTS5 sans contenu, mots et préfixes, accents ignorés),
//! tenue à jour par déclencheurs.
//!
//! Sources (`sources`, champ de bits) : 1 scan natif, 2 Everything, 4 dossiers surveillés de la bibliothèque (copie de
//! `index.json`, que l'index ne modifie jamais).

use super::parcours::{FichierVu, ListeDossier, Options};
use super::reglages::cle_dossier;
use super::volumes::{IdentVolume, Volume};
use crate::bibliotheque::{EtatMedia, Media, TypeMedia};
use crate::{horloge, noms};
use rusqlite::{params, params_from_iter, Connection, ErrorCode, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const NOM_BASE: &str = "index.sqlite";
pub const SCHEMA: i64 = 1;

pub const SRC_NATIF: i64 = 1;
pub const SRC_EVERYTHING: i64 = 2;
pub const SRC_BIBLIOTHEQUE: i64 = 4;
const SRC_SCAN: i64 = SRC_NATIF | SRC_EVERYTHING;

pub const PRESENT: i64 = 0;
pub const ABSENT: i64 = 1;
pub const INDISPONIBLE: i64 = 2;

pub const META_A_FAIRE: i64 = 0;
pub const META_FAITE: i64 = 1;
pub const META_ECHEC: i64 = 2;
/// Non lue : fichier « en ligne seulement » (jamais ouvert).
pub const META_NON_LUE: i64 = 3;

pub const MINI_A_FAIRE: i64 = 0;
pub const MINI_FAITE: i64 = 1;
pub const MINI_ECHEC: i64 = 2;
/// Format sans décodeur (HEIC, AVI…) ou audio sans pochette.
pub const MINI_IMPOSSIBLE: i64 = 3;
/// Vidéo : attend l'analyse du WebView2 (élément vidéo + canvas), à la demande des cartes visibles.
pub const MINI_WEBVIEW: i64 = 4;

/// Fichiers supprimés gardés 7 jours (« absent ») puis retirés de l'index (même garde que le contrat §3).
pub const GARDE_ABSENTS_MS: i64 = 7 * 24 * 3600 * 1000;

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS meta (cle TEXT PRIMARY KEY, valeur TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS volumes (
  id INTEGER PRIMARY KEY,
  cle TEXT NOT NULL UNIQUE,
  racine TEXT,
  nom TEXT,
  genre TEXT,
  systeme_fichiers TEXT,
  guid TEXT,
  ids_fiables INTEGER NOT NULL DEFAULT 0,
  disponible INTEGER NOT NULL DEFAULT 1,
  vu_le INTEGER
);
CREATE TABLE IF NOT EXISTS dossiers (
  id INTEGER PRIMARY KEY,
  cle TEXT NOT NULL UNIQUE,
  chemin TEXT NOT NULL,
  volume_id INTEGER,
  scan INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS fichiers (
  id INTEGER PRIMARY KEY,
  idm TEXT NOT NULL UNIQUE,
  dossier_id INTEGER NOT NULL,
  nom TEXT NOT NULL,
  ext TEXT NOT NULL,
  type INTEGER NOT NULL,
  taille INTEGER NOT NULL,
  modifie INTEGER NOT NULL,
  cree INTEGER,
  volume_id INTEGER,
  fid INTEGER,
  etat INTEGER NOT NULL DEFAULT 0,
  sources INTEGER NOT NULL DEFAULT 0,
  en_ligne INTEGER NOT NULL DEFAULT 0,
  ajoute_le INTEGER NOT NULL,
  vu_le INTEGER NOT NULL,
  absent_depuis INTEGER,
  doublon_de INTEGER,
  meta INTEGER NOT NULL DEFAULT 0,
  duree REAL, largeur INTEGER, hauteur INTEGER, ips REAL, codec_video TEXT, codec_audio TEXT,
  titre TEXT, artistes TEXT, album TEXT, annee INTEGER,
  mini INTEGER NOT NULL DEFAULT 0,
  bib_etat TEXT,
  bib_miniature INTEGER NOT NULL DEFAULT 0,
  premiere INTEGER
);
CREATE INDEX IF NOT EXISTS fichiers_dossier ON fichiers(dossier_id);
CREATE INDEX IF NOT EXISTS fichiers_fid ON fichiers(volume_id, fid) WHERE fid IS NOT NULL;
CREATE INDEX IF NOT EXISTS fichiers_ajoute ON fichiers(ajoute_le);
CREATE INDEX IF NOT EXISTS fichiers_modifie ON fichiers(modifie);
CREATE INDEX IF NOT EXISTS fichiers_taille ON fichiers(taille);
CREATE INDEX IF NOT EXISTS fichiers_nom ON fichiers(nom COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS fichiers_type ON fichiers(type, etat);
CREATE INDEX IF NOT EXISTS fichiers_volume ON fichiers(volume_id, etat);
CREATE INDEX IF NOT EXISTS fichiers_meta ON fichiers(id) WHERE meta = 0;
CREATE INDEX IF NOT EXISTS fichiers_mini ON fichiers(id) WHERE mini = 0;
CREATE INDEX IF NOT EXISTS fichiers_doublon ON fichiers(doublon_de) WHERE doublon_de IS NOT NULL;
CREATE INDEX IF NOT EXISTS fichiers_bib ON fichiers(id) WHERE (sources & 4) != 0;
CREATE TABLE IF NOT EXISTS racines (
  id INTEGER PRIMARY KEY,
  cle TEXT NOT NULL UNIQUE,
  chemin TEXT NOT NULL,
  volume_id INTEGER,
  dernier_scan INTEGER,
  termine_le INTEGER
);
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY,
  debut INTEGER NOT NULL,
  fin INTEGER,
  etat TEXT NOT NULL,
  mode TEXT NOT NULL,
  cibles TEXT NOT NULL,
  resume TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS recherche USING fts5(
  nom, chemin, etiquettes, content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2', prefix='2 3'
);
CREATE TRIGGER IF NOT EXISTS fichiers_ai AFTER INSERT ON fichiers BEGIN
  INSERT INTO recherche(rowid, nom, chemin, etiquettes) VALUES (new.id, new.nom,
    (SELECT chemin FROM dossiers WHERE id = new.dossier_id),
    coalesce(new.titre, '') || ' ' || coalesce(new.artistes, '') || ' ' || coalesce(new.album, ''));
END;
CREATE TRIGGER IF NOT EXISTS fichiers_ad AFTER DELETE ON fichiers BEGIN
  DELETE FROM recherche WHERE rowid = old.id;
END;
CREATE TRIGGER IF NOT EXISTS fichiers_au AFTER UPDATE OF nom, dossier_id, titre, artistes, album ON fichiers BEGIN
  DELETE FROM recherche WHERE rowid = old.id;
  INSERT INTO recherche(rowid, nom, chemin, etiquettes) VALUES (new.id, new.nom,
    (SELECT chemin FROM dossiers WHERE id = new.dossier_id),
    coalesce(new.titre, '') || ' ' || coalesce(new.artistes, '') || ' ' || coalesce(new.album, ''));
END;
"#;

pub fn type_code(t: TypeMedia) -> i64 {
    match t {
        TypeMedia::Video => 0,
        TypeMedia::Audio => 1,
        TypeMedia::Image => 2,
    }
}

pub fn type_de_code(c: i64) -> TypeMedia {
    match c {
        0 => TypeMedia::Video,
        1 => TypeMedia::Audio,
        _ => TypeMedia::Image,
    }
}

pub fn err(e: rusqlite::Error) -> String {
    format!("Index local : {e}")
}

fn conflit(e: &rusqlite::Error) -> bool {
    matches!(e, rusqlite::Error::SqliteFailure(f, _) if f.code == ErrorCode::ConstraintViolation)
}

/// Dossier des miniatures : `<emplacement>\miniatures\<2 chiffres hex>\<id>.jpg` (256 sous-dossiers).
pub fn chemin_miniature(emplacement: &Path, id: i64) -> PathBuf {
    emplacement.join("miniatures").join(format!("{:02x}", id.rem_euclid(256))).join(format!("{id}.jpg"))
}

/// Bornes de la clé d'un dossier et de tout ce qu'il contient : `cle`, puis `cle\` ≤ x < `cle]` (`]` suit `\`).
fn bornes(cle: &str) -> (String, String, String) {
    (cle.to_string(), format!("{cle}\\"), format!("{cle}]"))
}

#[derive(Default, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Bilan {
    pub nouveaux: u64,
    pub modifies: u64,
    pub renommes: u64,
    pub deplaces: u64,
    pub supprimes: u64,
    pub doublons: u64,
    pub inchanges: u64,
    pub retrouves: u64,
    pub indisponibles: u64,
    /// Sortis du périmètre (type désactivé, exclusion, caché) : retirés de l'index, fichiers intacts.
    pub retires: u64,
}

/// Contexte d'écriture d'un scan (ou d'une mise à jour de la surveillance en direct).
pub struct Ecriture {
    pub scan: i64,
    pub maintenant: i64,
    pub source: i64,
    pub opts: std::sync::Arc<Options>,
    pub bilan: Bilan,
    absents: HashSet<i64>,
    volumes: HashMap<String, i64>,
}

impl Ecriture {
    pub fn nouvelle(scan: i64, source: i64, opts: std::sync::Arc<Options>) -> Self {
        Ecriture { scan, maintenant: horloge::maintenant().timestamp_millis(), source, opts, bilan: Bilan::default(), absents: HashSet::new(), volumes: HashMap::new() }
    }
    /// Fichiers marqués absents pendant ce passage et jamais retrouvés ailleurs : les vrais « supprimés ».
    pub fn clore(&mut self) {
        self.bilan.supprimes += self.absents.len() as u64;
        self.absents.clear();
    }
}

struct Existant {
    id: i64,
    nom: String,
    taille: i64,
    modifie: i64,
    fid: Option<i64>,
    etat: i64,
    sources: i64,
}

enum Rapprochement {
    Aucun,
    Doublon,
    /// Entrée existante reprise sous le nouveau chemin (renommage, déplacement).
    Repris(i64),
}

struct Candidat {
    id: i64,
    dossier_id: i64,
    nom: String,
    etat: i64,
    doublon_de: Option<i64>,
    taille: i64,
    modifie: i64,
    chemin: String,
}

// ---- Requêtes ------------------------------------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum EtatFichier {
    Present,
    Absent,
    Indisponible,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    /// Scan natif.
    Index,
    Everything,
    /// Dossiers surveillés (copie d'`index.json`).
    Bibliotheque,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Tri {
    #[default]
    Ajout,
    Nom,
    Taille,
    Date,
    Duree,
    Chemin,
    Type,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Ordre {
    Asc,
    Desc,
}

pub const TAILLE_PAGE_MAX: u32 = 500;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Requete {
    /// Mots cherchés (préfixes, sans casse ni accents) dans le nom et les étiquettes.
    pub texte: String,
    /// Chercher aussi dans le chemin des dossiers.
    pub dans_chemin: bool,
    pub types: Vec<TypeMedia>,
    /// Racines de volumes (`E:\`).
    pub volumes: Vec<String>,
    /// Dossier (récursif).
    pub dossier: Option<String>,
    pub taille_min: Option<u64>,
    pub taille_max: Option<u64>,
    /// Dates ISO 8601 (date de modification du fichier).
    pub modifie_apres: Option<String>,
    pub modifie_avant: Option<String>,
    /// Vide : présents et indisponibles.
    pub etats: Vec<EtatFichier>,
    /// Vide : toutes.
    pub sources: Vec<Source>,
    /// Montrer aussi les autres chemins d'un même fichier.
    pub doublons: bool,
    pub tri: Tri,
    pub ordre: Option<Ordre>,
    /// Numéro de page, à partir de 1.
    pub page: u32,
    pub taille_page: u32,
}

impl Default for Requete {
    fn default() -> Self {
        Requete {
            texte: String::new(),
            dans_chemin: false,
            types: Vec::new(),
            volumes: Vec::new(),
            dossier: None,
            taille_min: None,
            taille_max: None,
            modifie_apres: None,
            modifie_avant: None,
            etats: Vec::new(),
            sources: Vec::new(),
            doublons: false,
            tri: Tri::Ajout,
            ordre: None,
            page: 1,
            taille_page: 100,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Element {
    /// SHA-1 du chemin normalisé : même règle que les identifiants d'`index.json`.
    pub id: String,
    pub chemin: String,
    pub dossier: String,
    /// Nom sans l'extension.
    pub nom: String,
    pub ext: String,
    #[serde(rename = "type")]
    pub type_media: TypeMedia,
    pub taille: u64,
    pub modifie_le: String,
    pub ajoute_le: String,
    pub duree: Option<f64>,
    pub largeur: Option<u32>,
    pub hauteur: Option<u32>,
    pub ips: Option<f64>,
    pub codec_video: Option<String>,
    pub codec_audio: Option<String>,
    pub titre: Option<String>,
    pub artistes: Vec<String>,
    pub album: Option<String>,
    pub annee: Option<u32>,
    /// Chemin ABSOLU de la miniature (cache de l'index ou `R\bibliotheque\miniatures`), ou `null`.
    pub miniature: Option<String>,
    /// `a-faire`, `faite`, `echec`, `impossible`, `webview` (vidéo : analyse du WebView2 à demander).
    pub etat_miniature: String,
    pub etat: EtatFichier,
    /// État dans `index.json` quand le fichier est dans un dossier surveillé (`disponible`, `en-cours`…).
    pub etat_bibliotheque: Option<EtatMedia>,
    pub sources: Vec<Source>,
    /// Racine du volume (`E:\`), si connue.
    pub volume: Option<String>,
    /// Nombre d'autres chemins du même fichier (liens physiques, lecteurs `subst`…).
    pub doublons: u32,
    pub doublon_de: Option<String>,
    pub en_ligne: bool,
    pub premiere_compatible: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub elements: Vec<Element>,
    pub total: u64,
    pub page: u32,
    pub taille_page: u32,
    pub pages: u32,
    /// Durée de la requête dans l'index (ms).
    pub duree_ms: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Totaux {
    pub video: u64,
    pub audio: u64,
    pub image: u64,
    pub total: u64,
    pub indisponibles: u64,
    pub absents: u64,
    pub doublons: u64,
    pub metadonnees_a_faire: u64,
    pub miniatures_a_faire: u64,
    pub dossiers: u64,
}

/// Média à faire analyser par le WebView2 (vidéo visible sans miniature).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AAnalyserIndex {
    pub id: String,
    pub chemin: String,
    #[serde(rename = "type")]
    pub type_media: TypeMedia,
    pub ext: String,
}

/// Fichier à enrichir (métadonnées, miniature).
#[derive(Clone, Debug)]
pub struct AEnrichir {
    pub id: i64,
    pub chemin: PathBuf,
    pub ext: String,
    pub type_media: TypeMedia,
    pub taille: u64,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct MetaExtraite {
    pub etat: i64,
    pub duree: Option<f64>,
    pub largeur: Option<u32>,
    pub hauteur: Option<u32>,
    pub ips: Option<f64>,
    pub codec_video: Option<String>,
    pub codec_audio: Option<String>,
    pub titre: Option<String>,
    pub artistes: Option<String>,
    pub album: Option<String>,
    pub annee: Option<u32>,
    /// État de miniature à poser en même temps (pochette audio écrite, vidéo à confier au WebView2…).
    pub mini: Option<i64>,
}

/// Statistiques d'un volume dans l'index.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct StatVolume {
    pub fichiers: u64,
    pub video: u64,
    pub audio: u64,
    pub image: u64,
    pub indisponibles: u64,
    pub dernier_scan: Option<String>,
}

fn iso(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms).map(horloge::iso).unwrap_or_default()
}

fn ms_iso(s: &str) -> Option<i64> {
    horloge::lire(s).map(|d| d.timestamp_millis())
}

pub struct Base {
    pub c: Connection,
}

impl Base {
    /// Ouvre (ou crée) l'index dans `dossier`. `cache_ko` : cache de pages de cette connexion.
    pub fn ouvrir(dossier: &Path, cache_ko: i64) -> Result<Base, String> {
        std::fs::create_dir_all(dossier).map_err(|e| format!("Dossier de l'index indisponible : {} ({}).", dossier.display(), e.kind()))?;
        let c = Connection::open(dossier.join(NOM_BASE)).map_err(err)?;
        c.busy_timeout(Duration::from_secs(15)).map_err(err)?;
        let mode: String = c.query_row("PRAGMA journal_mode=WAL", [], |r| r.get(0)).map_err(err)?;
        if !mode.eq_ignore_ascii_case("wal") {
            return Err(format!("Index local : journal WAL refusé ({mode})."));
        }
        c.execute_batch(&format!("PRAGMA synchronous=NORMAL; PRAGMA temp_store=MEMORY; PRAGMA cache_size=-{cache_ko};")).map_err(err)?;
        c.execute_batch(SCHEMA_SQL).map_err(err)?;
        let v: Option<String> = c.query_row("SELECT valeur FROM meta WHERE cle = 'schema'", [], |r| r.get(0)).optional().map_err(err)?;
        match v.and_then(|v| v.parse::<i64>().ok()) {
            None => {
                c.execute("INSERT OR REPLACE INTO meta(cle, valeur) VALUES ('schema', ?1)", [SCHEMA.to_string()]).map_err(err)?;
            }
            Some(n) if n > SCHEMA => return Err("Cet index a été créé par une version plus récente d'AETHRYON Desktop.".into()),
            Some(_) => {}
        }
        Ok(Base { c })
    }

    pub fn commencer(&self) -> rusqlite::Result<()> {
        self.c.execute_batch("BEGIN IMMEDIATE")
    }

    pub fn valider(&self) -> rusqlite::Result<()> {
        self.c.execute_batch("COMMIT")
    }

    pub fn annuler_transaction(&self) {
        let _ = self.c.execute_batch("ROLLBACK");
    }

    pub fn integrite(&self) -> String {
        self.c.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)).unwrap_or_else(|e| e.to_string())
    }

    /// Réduit le journal WAL après un gros scan (au mieux).
    pub fn compacter_journal(&self) {
        let _ = self.c.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()));
    }

    // ---- Scans ----

    pub fn debuter_scan(&self, mode: &str, cibles: &str) -> rusqlite::Result<i64> {
        self.c.execute("INSERT INTO scans(debut, etat, mode, cibles) VALUES (?1, 'en-cours', ?2, ?3)", params![horloge::maintenant().timestamp_millis(), mode, cibles])?;
        Ok(self.c.last_insert_rowid())
    }

    pub fn finir_scan(&self, id: i64, etat: &str, resume: &str) -> rusqlite::Result<()> {
        self.c.execute("UPDATE scans SET fin = ?2, etat = ?3, resume = ?4 WHERE id = ?1", params![id, horloge::maintenant().timestamp_millis(), etat, resume])?;
        Ok(())
    }

    /// Scans restés « en cours » (coupure, fermeture brutale) : marqués « interrompu ».
    pub fn marquer_interrompus(&self) -> rusqlite::Result<usize> {
        self.c.execute("UPDATE scans SET etat = 'interrompu', fin = ?1 WHERE etat = 'en-cours'", [horloge::maintenant().timestamp_millis()])
    }

    pub fn etat_scan(&self, id: i64) -> Option<String> {
        self.c.query_row("SELECT etat FROM scans WHERE id = ?1", [id], |r| r.get(0)).optional().ok().flatten()
    }

    pub fn resume(&self, id: Option<i64>) -> Option<String> {
        let r = match id {
            Some(i) => self.c.query_row("SELECT resume FROM scans WHERE id = ?1", [i], |r| r.get::<_, Option<String>>(0)),
            None => self.c.query_row("SELECT resume FROM scans WHERE resume IS NOT NULL ORDER BY id DESC LIMIT 1", [], |r| r.get::<_, Option<String>>(0)),
        };
        r.optional().ok().flatten().flatten()
    }

    /// Dernier scan interrompu (cibles en JSON), pour proposer la reprise.
    pub fn dernier_interrompu(&self) -> Option<(i64, String)> {
        self.c
            .query_row("SELECT id, cibles FROM scans WHERE etat = 'interrompu' AND id = (SELECT max(id) FROM scans)", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()
            .ok()
            .flatten()
    }

    // ---- Volumes et dossiers ----

    pub fn id_volume(&self, e: &mut Ecriture, iv: &IdentVolume) -> rusqlite::Result<i64> {
        if let Some(id) = e.volumes.get(&iv.cle) {
            return Ok(*id);
        }
        let v = iv.volume.as_ref();
        self.c.prepare_cached(
            "INSERT INTO volumes(cle, racine, nom, genre, systeme_fichiers, guid, ids_fiables, disponible, vu_le) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8)
             ON CONFLICT(cle) DO UPDATE SET ids_fiables = excluded.ids_fiables, vu_le = excluded.vu_le, disponible = 1,
               racine = coalesce(excluded.racine, volumes.racine), nom = coalesce(excluded.nom, volumes.nom),
               genre = coalesce(excluded.genre, volumes.genre), systeme_fichiers = coalesce(excluded.systeme_fichiers, volumes.systeme_fichiers),
               guid = coalesce(excluded.guid, volumes.guid)",
        )?
        .execute(params![
            iv.cle,
            v.map(|v| v.racine.clone()),
            v.and_then(|v| v.nom.clone()),
            v.map(|v| serde_json::to_value(v.genre).ok().and_then(|x| x.as_str().map(String::from)).unwrap_or_default()),
            v.and_then(|v| v.systeme_fichiers.clone()),
            v.and_then(|v| v.guid.clone()),
            iv.ids_fiables as i64,
            e.maintenant
        ])?;
        let id: i64 = self.c.prepare_cached("SELECT id FROM volumes WHERE cle = ?1")?.query_row([&iv.cle], |r| r.get(0))?;
        e.volumes.insert(iv.cle.clone(), id);
        Ok(id)
    }

    fn id_dossier(&self, chemin: &str, cle: &str, volume_id: Option<i64>, scan: i64) -> rusqlite::Result<i64> {
        self.c
            .prepare_cached(
                "INSERT INTO dossiers(cle, chemin, volume_id, scan) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(cle) DO UPDATE SET chemin = excluded.chemin, volume_id = coalesce(excluded.volume_id, dossiers.volume_id),
                   scan = max(dossiers.scan, excluded.scan)",
            )?
            .execute(params![cle, chemin, volume_id, scan])?;
        self.c.prepare_cached("SELECT id FROM dossiers WHERE cle = ?1")?.query_row([cle], |r| r.get(0))
    }

    // ---- Écriture d'un dossier parcouru ----

    /// Rapproche le contenu média d'un dossier de l'index : nouveaux, modifiés, renommés et déplacés (même
    /// identifiant de fichier, même taille et même date), doublons (même fichier encore joignable par un autre chemin),
    /// disparus (absents ; retirés s'ils existent encore mais sortent du périmètre).
    pub fn appliquer(&self, e: &mut Ecriture, l: &ListeDossier) -> rusqlite::Result<()> {
        let chemin = l.chemin.to_string_lossy().into_owned();
        let cle = cle_dossier(&chemin);
        let volume_id = self.id_volume(e, &l.volume)?;
        self.autre_disque(e, &cle, volume_id)?;
        let dossier_id = if l.fichiers.is_empty() {
            let id: Option<i64> = self.c.prepare_cached("SELECT id FROM dossiers WHERE cle = ?1")?.query_row([&cle], |r| r.get(0)).optional()?;
            match id {
                Some(id) => {
                    self.c.prepare_cached("UPDATE dossiers SET scan = ?2 WHERE id = ?1")?.execute(params![id, e.scan])?;
                    id
                }
                None => return Ok(()),
            }
        } else {
            self.id_dossier(&chemin, &cle, Some(volume_id), e.scan)?
        };
        let mut existants: HashMap<String, Existant> = HashMap::new();
        {
            let mut st = self.c.prepare_cached("SELECT id, nom, taille, modifie, fid, etat, sources FROM fichiers WHERE dossier_id = ?1")?;
            let lignes = st.query_map([dossier_id], |r| {
                Ok(Existant { id: r.get(0)?, nom: r.get(1)?, taille: r.get(2)?, modifie: r.get(3)?, fid: r.get(4)?, etat: r.get(5)?, sources: r.get(6)? })
            })?;
            for x in lignes {
                let x = x?;
                existants.insert(x.nom.to_lowercase(), x);
            }
        }
        let mut repris: HashSet<i64> = HashSet::new();
        for f in &l.fichiers {
            if let Some(x) = existants.remove(&f.nom.to_lowercase()) {
                let meme = x.taille == f.taille as i64 && x.modifie == f.modifie_ms;
                if meme && x.nom == f.nom && x.etat == PRESENT && x.fid == f.fid && x.sources & e.source != 0 {
                    e.bilan.inchanges += 1;
                    continue;
                }
                self.c
                    .prepare_cached(
                        "UPDATE fichiers SET nom = ?2, taille = ?3, modifie = ?4, cree = ?5, fid = ?6, volume_id = ?7, etat = 0, absent_depuis = NULL,
                           vu_le = ?8, sources = sources | ?9, en_ligne = ?10, ext = ?11, type = ?12,
                           meta = CASE WHEN taille != ?3 OR modifie != ?4 THEN (CASE WHEN ?10 = 1 THEN 3 ELSE 0 END) ELSE meta END,
                           mini = CASE WHEN (taille != ?3 OR modifie != ?4) AND mini != 3 THEN 0 ELSE mini END
                         WHERE id = ?1",
                    )?
                    .execute(params![
                        x.id,
                        f.nom,
                        f.taille as i64,
                        f.modifie_ms,
                        f.cree_ms,
                        f.fid,
                        volume_id,
                        e.maintenant,
                        e.source,
                        f.en_ligne as i64,
                        f.ext,
                        type_code(f.type_media)
                    ])?;
                e.absents.remove(&x.id);
                if !meme {
                    e.bilan.modifies += 1;
                } else if x.etat != PRESENT {
                    e.bilan.retrouves += 1;
                } else if x.nom != f.nom {
                    e.bilan.renommes += 1;
                } else {
                    e.bilan.inchanges += 1;
                }
                continue;
            }
            if let Some(fid) = f.fid {
                match self.rapprocher(e, f, fid, dossier_id, &chemin, volume_id)? {
                    Rapprochement::Aucun => {}
                    Rapprochement::Doublon => continue,
                    Rapprochement::Repris(id) => {
                        // Renommé dans ce même dossier : l'ancienne entrée n'est pas « disparue ».
                        repris.insert(id);
                        continue;
                    }
                }
            }
            if self.inserer(e, f, dossier_id, &chemin, volume_id, None)? {
                e.bilan.nouveaux += 1;
            }
        }
        if !l.partiel {
            for (_, x) in existants {
                if repris.contains(&x.id) || (x.etat != PRESENT && x.sources & SRC_BIBLIOTHEQUE == 0) {
                    continue;
                }
                self.disparu(e, x.id, x.sources, &Path::new(&chemin).join(&x.nom), false)?;
            }
        }
        Ok(())
    }

    /// Même chemin, autre disque (deux clés USB qui prennent tour à tour la lettre E:) : les entrées de l'ancien
    /// disque, débranché, sont retirées de CE dossier plutôt que confondues avec celles du disque branché (il sera
    /// réindexé à son retour). Les fichiers ne sont jamais touchés.
    fn autre_disque(&self, e: &mut Ecriture, cle: &str, volume_id: i64) -> rusqlite::Result<()> {
        let ancien: Option<(i64, Option<i64>)> = self.c.prepare_cached("SELECT id, volume_id FROM dossiers WHERE cle = ?1")?.query_row([cle], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
        let Some((dossier, Some(vieux))) = ancien else { return Ok(()) };
        if vieux == volume_id {
            return Ok(());
        }
        let dispo: Option<i64> = self.c.prepare_cached("SELECT disponible FROM volumes WHERE id = ?1")?.query_row([vieux], |r| r.get(0)).optional()?;
        if dispo != Some(0) {
            return Ok(());
        }
        let ids: Vec<i64> = self.c.prepare_cached("SELECT id FROM fichiers WHERE dossier_id = ?1 AND (sources & 4) = 0")?.query_map([dossier], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
        for id in ids {
            self.retirer(id)?;
            e.bilan.retires += 1;
        }
        Ok(())
    }

    /// Fichier qui n'est plus dans la liste de son dossier.
    fn disparu(&self, e: &mut Ecriture, id: i64, sources: i64, chemin: &Path, hors_perimetre: bool) -> rusqlite::Result<()> {
        if sources & SRC_BIBLIOTHEQUE != 0 {
            // Fichier d'un dossier surveillé : sa présence est tenue par index.json ; le scan retire seulement sa marque.
            if sources & e.source != 0 {
                self.c.prepare_cached("UPDATE fichiers SET sources = sources & ~?2 WHERE id = ?1")?.execute(params![id, e.source])?;
            }
            return Ok(());
        }
        let existe = std::fs::symlink_metadata(chemin).is_ok();
        if existe || hors_perimetre {
            self.retirer(id)?;
            e.bilan.retires += 1;
        } else {
            self.marquer_absent(id, e.maintenant)?;
            e.absents.insert(id);
        }
        Ok(())
    }

    fn rapprocher(&self, e: &mut Ecriture, f: &FichierVu, fid: i64, dossier_id: i64, chemin_dossier: &str, volume_id: i64) -> rusqlite::Result<Rapprochement> {
        let candidats: Vec<Candidat> = {
            let mut st = self.c.prepare_cached(
                "SELECT f.id, f.dossier_id, f.nom, f.etat, f.doublon_de, f.taille, f.modifie, d.chemin FROM fichiers f JOIN dossiers d ON d.id = f.dossier_id
                 WHERE f.volume_id = ?1 AND f.fid = ?2 ORDER BY f.id LIMIT 16",
            )?;
            let v = st
                .query_map(params![volume_id, fid], |r| {
                    Ok(Candidat {
                        id: r.get(0)?,
                        dossier_id: r.get(1)?,
                        nom: r.get(2)?,
                        etat: r.get(3)?,
                        doublon_de: r.get(4)?,
                        taille: r.get(5)?,
                        modifie: r.get(6)?,
                        chemin: r.get(7)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            v
        };
        if candidats.is_empty() {
            return Ok(Rapprochement::Aucun);
        }
        let meme_contenu = |c: &Candidat| c.taille == f.taille as i64 && c.modifie == f.modifie_ms;
        // Le même fichier est encore joignable par un autre chemin : doublon d'index.
        if let Some(v) = candidats.iter().find(|c| c.etat == PRESENT && meme_contenu(c) && Path::new(&c.chemin).join(&c.nom).exists()) {
            let canon = v.doublon_de.unwrap_or(v.id);
            if self.inserer(e, f, dossier_id, chemin_dossier, volume_id, Some(canon))? {
                e.bilan.doublons += 1;
            }
            return Ok(Rapprochement::Doublon);
        }
        // Sinon : renommé ou déplacé (l'ancien chemin n'existe plus).
        let Some(c) = candidats.iter().find(|c| meme_contenu(c) && !Path::new(&c.chemin).join(&c.nom).exists()) else {
            return Ok(Rapprochement::Aucun);
        };
        let idm = noms::id_media(&Path::new(chemin_dossier).join(&f.nom).to_string_lossy());
        let r = self
            .c
            .prepare_cached(
                "UPDATE fichiers SET dossier_id = ?2, nom = ?3, ext = ?4, type = ?5, idm = ?6, cree = ?7, etat = 0, absent_depuis = NULL, vu_le = ?8,
                   sources = sources | ?9, en_ligne = ?10, doublon_de = NULL WHERE id = ?1",
            )?
            .execute(params![c.id, dossier_id, f.nom, f.ext, type_code(f.type_media), idm, f.cree_ms, e.maintenant, e.source, f.en_ligne as i64]);
        match r {
            Ok(_) => {}
            Err(x) if conflit(&x) => return Ok(Rapprochement::Aucun),
            Err(x) => return Err(x),
        }
        e.absents.remove(&c.id);
        if c.dossier_id == dossier_id {
            e.bilan.renommes += 1;
        } else {
            e.bilan.deplaces += 1;
        }
        Ok(Rapprochement::Repris(c.id))
    }

    fn inserer(&self, e: &Ecriture, f: &FichierVu, dossier_id: i64, chemin_dossier: &str, volume_id: i64, doublon_de: Option<i64>) -> rusqlite::Result<bool> {
        let idm = noms::id_media(&Path::new(chemin_dossier).join(&f.nom).to_string_lossy());
        let n = self
            .c
            .prepare_cached(
                "INSERT INTO fichiers(idm, dossier_id, nom, ext, type, taille, modifie, cree, volume_id, fid, etat, sources, en_ligne, ajoute_le, vu_le, doublon_de, meta)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, ?11, ?12, ?13, ?13, ?14, ?15) ON CONFLICT(idm) DO NOTHING",
            )?
            .execute(params![
                idm,
                dossier_id,
                f.nom,
                f.ext,
                type_code(f.type_media),
                f.taille as i64,
                f.modifie_ms,
                f.cree_ms,
                volume_id,
                f.fid,
                e.source,
                f.en_ligne as i64,
                e.maintenant,
                doublon_de,
                if f.en_ligne { META_NON_LUE } else { META_A_FAIRE }
            ])?;
        Ok(n > 0)
    }

    pub fn marquer_absent(&self, id: i64, t: i64) -> rusqlite::Result<()> {
        self.c.prepare_cached("UPDATE fichiers SET etat = 1, absent_depuis = ?2 WHERE id = ?1 AND etat != 1")?.execute(params![id, t])?;
        self.promouvoir(id)
    }

    pub fn retirer(&self, id: i64) -> rusqlite::Result<()> {
        self.promouvoir(id)?;
        self.c.prepare_cached("DELETE FROM fichiers WHERE id = ?1")?.execute([id])?;
        Ok(())
    }

    /// Le fichier de référence d'un groupe de doublons disparaît : le premier chemin restant le remplace.
    fn promouvoir(&self, id: i64) -> rusqlite::Result<()> {
        let m: Option<i64> = self.c.prepare_cached("SELECT min(id) FROM fichiers WHERE doublon_de = ?1 AND etat = 0")?.query_row([id], |r| r.get(0))?;
        if let Some(m) = m {
            self.c
                .prepare_cached("UPDATE fichiers SET doublon_de = CASE WHEN id = ?2 THEN NULL ELSE ?2 END WHERE doublon_de = ?1")?
                .execute(params![id, m])?;
        }
        Ok(())
    }

    /// Fin du parcours complet d'une racine : dossiers connus mais non parcourus (supprimés, exclus, inaccessibles).
    pub fn finir_racine(&self, e: &mut Ecriture, racine: &Path, volume_id: Option<i64>) -> rusqlite::Result<()> {
        let (cle, bas, haut) = bornes(&cle_dossier(&racine.to_string_lossy()));
        let dossiers: Vec<(i64, String)> = self
            .c
            .prepare_cached("SELECT id, chemin FROM dossiers WHERE (cle = ?1 OR (cle >= ?2 AND cle < ?3)) AND scan != ?4")?
            .query_map(params![cle, bas, haut, e.scan], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        for (id, chemin) in dossiers {
            let p = PathBuf::from(&chemin);
            let lignes: Vec<(i64, String, i64)> = self
                .c
                .prepare_cached("SELECT id, nom, sources FROM fichiers WHERE dossier_id = ?1 AND (etat = 0 OR (sources & 4) != 0)")?
                .query_map([id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
                .collect::<rusqlite::Result<_>>()?;
            match std::fs::metadata(&p) {
                Err(x) if x.kind() == std::io::ErrorKind::NotFound => {
                    for (fid, nom, sources) in lignes {
                        self.disparu(e, fid, sources, &p.join(nom), false)?;
                    }
                }
                Err(_) => continue,
                Ok(_) => {
                    let exclu = e.opts.exclusions.exclut_sous(racine, &p);
                    for (fid, nom, sources) in lignes {
                        let f = p.join(&nom);
                        match std::fs::symlink_metadata(&f) {
                            Err(x) if x.kind() == std::io::ErrorKind::NotFound => self.disparu(e, fid, sources, &f, false)?,
                            Err(_) => {}
                            Ok(m) => {
                                if exclu || self.hors_perimetre(e, &nom, &m) {
                                    self.disparu(e, fid, sources, &f, true)?;
                                }
                            }
                        }
                    }
                }
            }
            self.c.prepare_cached("DELETE FROM dossiers WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM fichiers WHERE dossier_id = ?1)")?.execute([id])?;
        }
        self.c
            .prepare_cached(
                "INSERT INTO racines(cle, chemin, volume_id, dernier_scan, termine_le) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(cle) DO UPDATE SET chemin = excluded.chemin, volume_id = coalesce(excluded.volume_id, racines.volume_id),
                   dernier_scan = excluded.dernier_scan, termine_le = excluded.termine_le",
            )?
            .execute(params![cle, racine.to_string_lossy(), volume_id, e.scan, e.maintenant])?;
        Ok(())
    }

    fn hors_perimetre(&self, e: &Ecriture, nom: &str, m: &std::fs::Metadata) -> bool {
        let o = &e.opts;
        if o.type_de(nom).is_none() || m.len() == 0 || m.len() < o.taille_min {
            return true;
        }
        if !o.exclure_caches {
            return false;
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if m.file_attributes() & 0x6 != 0 {
                return true;
            }
        }
        nom.starts_with('.')
    }

    /// Racine introuvable ou volume débranché : tous ses fichiers présents passent à `etat` (absent ou indisponible).
    pub fn marquer_racine(&self, racine: &Path, etat: i64, t: i64) -> rusqlite::Result<u64> {
        let (cle, bas, haut) = bornes(&cle_dossier(&racine.to_string_lossy()));
        let n = self.c.execute(
            "UPDATE fichiers SET etat = ?4, absent_depuis = CASE WHEN ?4 = 1 THEN ?5 ELSE absent_depuis END
             WHERE etat = 0 AND (sources & 4) = 0 AND dossier_id IN (SELECT id FROM dossiers WHERE cle = ?1 OR (cle >= ?2 AND cle < ?3))",
            params![cle, bas, haut, etat, t],
        )?;
        Ok(n as u64)
    }

    /// Retire de l'index tout ce qui est sous `racine` (fichiers d'origine intacts). Renvoie le nombre de fichiers retirés.
    pub fn retirer_racine(&self, racine: &Path) -> rusqlite::Result<u64> {
        let (cle, bas, haut) = bornes(&cle_dossier(&racine.to_string_lossy()));
        self.commencer()?;
        let ids: Vec<(i64, i64)> = self
            .c
            .prepare("SELECT f.id, f.sources FROM fichiers f JOIN dossiers d ON d.id = f.dossier_id WHERE d.cle = ?1 OR (d.cle >= ?2 AND d.cle < ?3)")?
            .query_map(params![cle, bas, haut], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        let mut n = 0;
        for (id, sources) in ids {
            if sources & SRC_BIBLIOTHEQUE != 0 {
                self.c.execute("UPDATE fichiers SET sources = sources & ~3 WHERE id = ?1", [id])?;
            } else {
                self.retirer(id)?;
                n += 1;
            }
        }
        self.c.execute(
            "DELETE FROM dossiers WHERE (cle = ?1 OR (cle >= ?2 AND cle < ?3)) AND NOT EXISTS (SELECT 1 FROM fichiers WHERE dossier_id = dossiers.id)",
            params![cle, bas, haut],
        )?;
        self.c.execute("DELETE FROM racines WHERE cle = ?1 OR (cle >= ?2 AND cle < ?3)", params![cle, bas, haut])?;
        self.valider()?;
        Ok(n)
    }

    /// Absents depuis plus de 7 jours : retirés.
    pub fn purger_absents(&self, t: i64) -> rusqlite::Result<u64> {
        let ids: Vec<i64> = self
            .c
            .prepare("SELECT id FROM fichiers WHERE etat = 1 AND absent_depuis < ?1 AND (sources & 4) = 0")?
            .query_map([t - GARDE_ABSENTS_MS], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        for id in &ids {
            self.retirer(*id)?;
        }
        self.c.execute("DELETE FROM dossiers WHERE NOT EXISTS (SELECT 1 FROM fichiers WHERE dossier_id = dossiers.id) AND scan = 0", [])?;
        Ok(ids.len() as u64)
    }

    // ---- Volumes énumérés : indisponibles, retrouvés, lettre changée ----

    /// Applique l'énumération des volumes. Renvoie (fichiers devenus indisponibles, fichiers retrouvés).
    pub fn appliquer_volumes(&self, vus: &[Volume]) -> rusqlite::Result<(u64, u64)> {
        let t = horloge::maintenant().timestamp_millis();
        self.commencer()?;
        let r: rusqlite::Result<(u64, u64)> = (|| {
            let connus: Vec<(i64, String, Option<String>)> =
                self.c.prepare("SELECT id, cle, racine FROM volumes WHERE racine IS NOT NULL")?.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<rusqlite::Result<_>>()?;
            let (mut indispo, mut retrouves) = (0u64, 0u64);
            let mut presents = HashSet::new();
            for v in vus {
                let Some(cle) = &v.cle else { continue };
                if !v.disponible {
                    continue;
                }
                presents.insert(cle.clone());
                let ancienne = connus.iter().find(|c| &c.1 == cle).and_then(|c| c.2.clone());
                self.c.execute(
                    "INSERT INTO volumes(cle, racine, nom, genre, systeme_fichiers, guid, ids_fiables, disponible, vu_le) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8)
                     ON CONFLICT(cle) DO UPDATE SET racine = excluded.racine, nom = excluded.nom, genre = excluded.genre,
                       systeme_fichiers = excluded.systeme_fichiers, guid = coalesce(excluded.guid, volumes.guid), ids_fiables = excluded.ids_fiables,
                       disponible = 1, vu_le = excluded.vu_le",
                    params![
                        cle,
                        v.racine,
                        v.nom,
                        serde_json::to_value(v.genre).ok().and_then(|x| x.as_str().map(String::from)),
                        v.systeme_fichiers,
                        v.guid,
                        v.ids_fiables as i64,
                        t
                    ],
                )?;
                let id: i64 = self.c.query_row("SELECT id FROM volumes WHERE cle = ?1", [cle], |r| r.get(0))?;
                if let Some(a) = ancienne {
                    if !a.eq_ignore_ascii_case(&v.racine) {
                        self.reattribuer(id, &a, &v.racine)?;
                    }
                }
                retrouves += self.c.execute("UPDATE fichiers SET etat = 0 WHERE volume_id = ?1 AND etat = 2", [id])? as u64;
            }
            for (id, cle, _) in &connus {
                if presents.contains(cle) {
                    continue;
                }
                self.c.execute("UPDATE volumes SET disponible = 0 WHERE id = ?1", [id])?;
                indispo += self.c.execute("UPDATE fichiers SET etat = 2 WHERE volume_id = ?1 AND etat = 0 AND (sources & 4) = 0", [id])? as u64;
            }
            Ok((indispo, retrouves))
        })();
        match r {
            Ok(x) => {
                self.valider()?;
                Ok(x)
            }
            Err(e) => {
                self.annuler_transaction();
                Err(e)
            }
        }
    }

    /// La lettre d'un volume a changé (clé USB rebranchée en F: au lieu de E:) : chemins et identifiants réécrits.
    fn reattribuer(&self, volume_id: i64, ancienne: &str, nouvelle: &str) -> rusqlite::Result<()> {
        let (a, n) = (ancienne.trim_end_matches(['\\', '/']).to_string(), nouvelle.trim_end_matches(['\\', '/']).to_string());
        let dossiers: Vec<(i64, String)> =
            self.c.prepare("SELECT id, chemin FROM dossiers WHERE volume_id = ?1")?.query_map([volume_id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
        for (id, chemin) in dossiers {
            if chemin.len() < a.len() || !chemin[..a.len()].eq_ignore_ascii_case(&a) {
                continue;
            }
            let nouveau = format!("{n}{}", &chemin[a.len()..]);
            if self.c.execute("UPDATE OR IGNORE dossiers SET chemin = ?2, cle = ?3 WHERE id = ?1", params![id, nouveau, cle_dossier(&nouveau)])? == 0 {
                continue;
            }
            let fichiers: Vec<(i64, String)> =
                self.c.prepare_cached("SELECT id, nom FROM fichiers WHERE dossier_id = ?1")?.query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
            for (fid, nom) in fichiers {
                let idm = noms::id_media(&Path::new(&nouveau).join(&nom).to_string_lossy());
                self.c.prepare_cached("UPDATE OR IGNORE fichiers SET idm = ?2 WHERE id = ?1")?.execute(params![fid, idm])?;
            }
        }
        let racines: Vec<(i64, String)> =
            self.c.prepare("SELECT id, chemin FROM racines WHERE volume_id = ?1")?.query_map([volume_id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
        for (id, chemin) in racines {
            if chemin.len() >= a.len() && chemin[..a.len()].eq_ignore_ascii_case(&a) {
                let nouveau = format!("{n}{}", &chemin[a.len()..]);
                self.c.execute("UPDATE OR IGNORE racines SET chemin = ?2, cle = ?3 WHERE id = ?1", params![id, nouveau, cle_dossier(&nouveau)])?;
            }
        }
        Ok(())
    }

    pub fn stats_volumes(&self) -> rusqlite::Result<HashMap<String, StatVolume>> {
        let mut m: HashMap<String, StatVolume> = HashMap::new();
        let mut st = self.c.prepare(
            "SELECT v.cle, count(*), sum(f.type = 0), sum(f.type = 1), sum(f.type = 2), sum(f.etat = 2) FROM fichiers f JOIN volumes v ON v.id = f.volume_id
             WHERE f.doublon_de IS NULL AND f.etat != 1 GROUP BY v.cle",
        )?;
        let l = st.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                StatVolume {
                    fichiers: r.get::<_, i64>(1)? as u64,
                    video: r.get::<_, i64>(2)? as u64,
                    audio: r.get::<_, i64>(3)? as u64,
                    image: r.get::<_, i64>(4)? as u64,
                    indisponibles: r.get::<_, i64>(5)? as u64,
                    dernier_scan: None,
                },
            ))
        })?;
        for x in l {
            let (k, v) = x?;
            m.insert(k, v);
        }
        let mut st = self.c.prepare("SELECT v.cle, max(r.termine_le) FROM racines r JOIN volumes v ON v.id = r.volume_id GROUP BY v.cle")?;
        let l = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<i64>>(1)?)))?;
        for x in l {
            let (k, t) = x?;
            m.entry(k).or_default().dernier_scan = t.map(iso);
        }
        Ok(m)
    }

    // ---- Copie de la bibliothèque (dossiers surveillés, index.json) ----

    /// Reporte les médias d'`index.json` dans l'index (source « bibliothèque ») ; ceux qui en sont sortis perdent cette
    /// source (et sont retirés s'ils n'en ont pas d'autre). Renvoie le nombre de lignes changées.
    pub fn synchroniser_bibliotheque(&self, medias: &[Media]) -> rusqlite::Result<u64> {
        let t = horloge::maintenant().timestamp_millis();
        self.commencer()?;
        let r: rusqlite::Result<u64> = (|| {
            let mut n = 0u64;
            let mut vus = HashSet::new();
            for m in medias {
                if !noms::est_id_valide(&m.id) {
                    continue;
                }
                vus.insert(m.id.clone());
                let p = Path::new(&m.chemin);
                let (Some(dossier), Some(nom)) = (p.parent(), p.file_name()) else { continue };
                let (dossier, nom) = (dossier.to_string_lossy().into_owned(), nom.to_string_lossy().into_owned());
                let etat_bib = serde_json::to_value(m.etat).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default();
                let etat = if m.etat == EtatMedia::Introuvable { ABSENT } else { PRESENT };
                let mini = m.miniature.is_some() as i64;
                let premiere = m.premiere_compatible.map(|b| b as i64);
                let modifie = ms_iso(&m.modifie_le).unwrap_or(t);
                let ligne: Option<(i64, i64, Option<String>, i64, i64, i64, Option<i64>)> = self
                    .c
                    .prepare_cached("SELECT id, sources, bib_etat, bib_miniature, taille, modifie, premiere FROM fichiers WHERE idm = ?1")?
                    .query_row([&m.id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)))
                    .optional()?;
                match ligne {
                    Some((id, sources, be, bm, taille, md, pr)) => {
                        let pareil = sources & SRC_BIBLIOTHEQUE != 0
                            && be.as_deref() == Some(etat_bib.as_str())
                            && bm == mini
                            && pr == premiere
                            && (sources & SRC_SCAN != 0 || (taille == m.taille as i64 && md == modifie));
                        if pareil {
                            continue;
                        }
                        self.c
                            .prepare_cached(
                                "UPDATE fichiers SET sources = sources | 4, bib_etat = ?2, bib_miniature = ?3, premiere = ?4,
                                   etat = CASE WHEN (sources & 3) = 0 THEN ?5 ELSE etat END,
                                   taille = CASE WHEN (sources & 3) = 0 THEN ?6 ELSE taille END,
                                   modifie = CASE WHEN (sources & 3) = 0 THEN ?7 ELSE modifie END,
                                   duree = coalesce(duree, ?8), largeur = coalesce(largeur, ?9), hauteur = coalesce(hauteur, ?10), ips = coalesce(ips, ?11),
                                   codec_video = coalesce(codec_video, ?12), codec_audio = coalesce(codec_audio, ?13),
                                   mini = CASE WHEN ?3 = 1 THEN 1 ELSE mini END, vu_le = ?14
                                 WHERE id = ?1",
                            )?
                            .execute(params![id, etat_bib, mini, premiere, etat, m.taille as i64, modifie, m.duree, m.largeur, m.hauteur, m.ips, m.codec_video, m.codec_audio, t])?;
                        n += 1;
                    }
                    None => {
                        let dossier_id = self.id_dossier(&dossier, &cle_dossier(&dossier), None, 0)?;
                        let ajoute = ms_iso(&m.ajoute_le).unwrap_or(t);
                        self.c
                            .prepare_cached(
                                "INSERT INTO fichiers(idm, dossier_id, nom, ext, type, taille, modifie, etat, sources, ajoute_le, vu_le, absent_depuis, meta, mini,
                                   bib_etat, bib_miniature, premiere, duree, largeur, hauteur, ips, codec_video, codec_audio)
                                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 4, ?9, ?10, ?11, 0, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)
                                 ON CONFLICT(idm) DO NOTHING",
                            )?
                            .execute(params![
                                m.id,
                                dossier_id,
                                nom,
                                m.ext,
                                type_code(m.type_media),
                                m.taille as i64,
                                modifie,
                                etat,
                                ajoute,
                                t,
                                (etat == ABSENT).then_some(t),
                                mini,
                                etat_bib,
                                mini,
                                premiere,
                                m.duree,
                                m.largeur,
                                m.hauteur,
                                m.ips,
                                m.codec_video,
                                m.codec_audio
                            ])?;
                        n += 1;
                    }
                }
            }
            let sortis: Vec<(i64, String, i64)> = self
                .c
                .prepare("SELECT id, idm, sources FROM fichiers WHERE (sources & 4) != 0")?
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
                .collect::<rusqlite::Result<_>>()?;
            for (id, idm, sources) in sortis {
                if vus.contains(&idm) {
                    continue;
                }
                if sources & SRC_SCAN == 0 {
                    self.retirer(id)?;
                } else {
                    self.c.execute("UPDATE fichiers SET sources = sources & ~4, bib_etat = NULL, bib_miniature = 0 WHERE id = ?1", [id])?;
                }
                n += 1;
            }
            Ok(n)
        })();
        match r {
            Ok(n) => {
                self.valider()?;
                Ok(n)
            }
            Err(e) => {
                self.annuler_transaction();
                Err(e)
            }
        }
    }

    // ---- Recherche ----

    pub fn rechercher(&self, r: &Requete, emplacement: &Path, miniatures_bib: &Path) -> Result<Page, String> {
        let debut = std::time::Instant::now();
        let mut ou = String::from(" FROM fichiers f JOIN dossiers d ON d.id = f.dossier_id WHERE 1 = 1");
        let mut p: Vec<rusqlite::types::Value> = Vec::new();
        use rusqlite::types::Value as V;
        if let Some(expr) = expression_fts(&r.texte, r.dans_chemin) {
            ou.push_str(" AND f.id IN (SELECT rowid FROM recherche WHERE recherche MATCH ?)");
            p.push(V::Text(expr));
        }
        if !r.types.is_empty() {
            ou.push_str(&format!(" AND f.type IN ({})", vec!["?"; r.types.len()].join(", ")));
            p.extend(r.types.iter().map(|t| V::Integer(type_code(*t))));
        }
        if !r.volumes.is_empty() {
            ou.push_str(&format!(" AND f.volume_id IN (SELECT id FROM volumes WHERE lower(racine) IN ({}))", vec!["?"; r.volumes.len()].join(", ")));
            p.extend(r.volumes.iter().map(|v| V::Text(v.to_lowercase())));
        }
        if let Some(d) = r.dossier.as_deref().filter(|d| !d.trim().is_empty()) {
            let (cle, bas, haut) = bornes(&cle_dossier(d));
            ou.push_str(" AND (d.cle = ? OR (d.cle >= ? AND d.cle < ?))");
            p.extend([V::Text(cle), V::Text(bas), V::Text(haut)]);
        }
        if let Some(x) = r.taille_min {
            ou.push_str(" AND f.taille >= ?");
            p.push(V::Integer(x.min(i64::MAX as u64) as i64));
        }
        if let Some(x) = r.taille_max {
            ou.push_str(" AND f.taille <= ?");
            p.push(V::Integer(x.min(i64::MAX as u64) as i64));
        }
        if let Some(x) = r.modifie_apres.as_deref() {
            let m = ms_iso(x).ok_or("modifieApres : date ISO 8601 attendue.")?;
            ou.push_str(" AND f.modifie >= ?");
            p.push(V::Integer(m));
        }
        if let Some(x) = r.modifie_avant.as_deref() {
            let m = ms_iso(x).ok_or("modifieAvant : date ISO 8601 attendue.")?;
            ou.push_str(" AND f.modifie <= ?");
            p.push(V::Integer(m));
        }
        let etats: Vec<i64> = if r.etats.is_empty() {
            vec![PRESENT, INDISPONIBLE]
        } else {
            r.etats.iter().map(|e| match e {
                EtatFichier::Present => PRESENT,
                EtatFichier::Absent => ABSENT,
                EtatFichier::Indisponible => INDISPONIBLE,
            }).collect()
        };
        ou.push_str(&format!(" AND f.etat IN ({})", etats.iter().map(|e| e.to_string()).collect::<Vec<_>>().join(", ")));
        if !r.sources.is_empty() {
            let masque = r.sources.iter().fold(0i64, |m, s| {
                m | match s {
                    Source::Index => SRC_NATIF,
                    Source::Everything => SRC_EVERYTHING,
                    Source::Bibliotheque => SRC_BIBLIOTHEQUE,
                }
            });
            ou.push_str(&format!(" AND (f.sources & {masque}) != 0"));
        }
        if !r.doublons {
            ou.push_str(" AND f.doublon_de IS NULL");
        }
        let total: i64 = self.c.query_row(&format!("SELECT count(*){ou}"), params_from_iter(p.iter()), |x| x.get(0)).map_err(err)?;
        let (col, defaut) = match r.tri {
            Tri::Ajout => ("f.ajoute_le", Ordre::Desc),
            Tri::Nom => ("f.nom COLLATE NOCASE", Ordre::Asc),
            Tri::Taille => ("f.taille", Ordre::Desc),
            Tri::Date => ("f.modifie", Ordre::Desc),
            Tri::Duree => ("coalesce(f.duree, -1)", Ordre::Desc),
            Tri::Chemin => ("d.cle, f.nom COLLATE NOCASE", Ordre::Asc),
            Tri::Type => ("f.type, f.nom COLLATE NOCASE", Ordre::Asc),
        };
        let sens = if r.ordre.unwrap_or(defaut) == Ordre::Asc { "ASC" } else { "DESC" };
        let ordre = col.split(", ").map(|c| format!("{c} {sens}")).collect::<Vec<_>>().join(", ");
        let taille_page = r.taille_page.clamp(1, TAILLE_PAGE_MAX);
        let page = r.page.max(1);
        let decalage = (page as i64 - 1) * taille_page as i64;
        let sql = format!(
            "SELECT f.id, f.idm, d.chemin, f.nom, f.ext, f.type, f.taille, f.modifie, f.ajoute_le, f.duree, f.largeur, f.hauteur, f.ips, f.codec_video,
               f.codec_audio, f.titre, f.artistes, f.album, f.annee, f.mini, f.etat, f.sources, f.en_ligne, f.bib_etat, f.bib_miniature, f.premiere,
               (SELECT racine FROM volumes WHERE id = f.volume_id),
               (SELECT count(*) FROM fichiers x WHERE x.doublon_de = f.id AND x.etat = 0),
               (SELECT idm FROM fichiers y WHERE y.id = f.doublon_de)
             {ou} ORDER BY {ordre}, f.id {sens} LIMIT {taille_page} OFFSET {decalage}"
        );
        let mut st = self.c.prepare(&sql).map_err(err)?;
        let elements = st
            .query_map(params_from_iter(p.iter()), |x| {
                let id: i64 = x.get(0)?;
                let idm: String = x.get(1)?;
                let dossier: String = x.get(2)?;
                let nom_complet: String = x.get(3)?;
                let ext: String = x.get(4)?;
                let mini: i64 = x.get(19)?;
                let bib_mini: i64 = x.get(24)?;
                let sources: i64 = x.get(21)?;
                let miniature = if bib_mini == 1 {
                    Some(miniatures_bib.join(format!("{idm}.jpg")).to_string_lossy().into_owned())
                } else if mini == MINI_FAITE {
                    Some(chemin_miniature(emplacement, id).to_string_lossy().into_owned())
                } else {
                    None
                };
                let nom = if !ext.is_empty() && nom_complet.len() > ext.len() + 1 && nom_complet.to_lowercase().ends_with(&format!(".{ext}")) {
                    nom_complet[..nom_complet.len() - ext.len() - 1].to_string()
                } else {
                    nom_complet.clone()
                };
                let mut src = Vec::new();
                if sources & SRC_NATIF != 0 {
                    src.push(Source::Index);
                }
                if sources & SRC_EVERYTHING != 0 {
                    src.push(Source::Everything);
                }
                if sources & SRC_BIBLIOTHEQUE != 0 {
                    src.push(Source::Bibliotheque);
                }
                let bib_etat: Option<String> = x.get(23)?;
                let premiere: Option<i64> = x.get(25)?;
                let artistes: Option<String> = x.get(16)?;
                Ok(Element {
                    id: idm,
                    chemin: Path::new(&dossier).join(&nom_complet).to_string_lossy().into_owned(),
                    dossier,
                    nom,
                    ext,
                    type_media: type_de_code(x.get(5)?),
                    taille: x.get::<_, i64>(6)?.max(0) as u64,
                    modifie_le: iso(x.get(7)?),
                    ajoute_le: iso(x.get(8)?),
                    duree: x.get(9)?,
                    largeur: x.get::<_, Option<i64>>(10)?.map(|v| v as u32),
                    hauteur: x.get::<_, Option<i64>>(11)?.map(|v| v as u32),
                    ips: x.get(12)?,
                    codec_video: x.get(13)?,
                    codec_audio: x.get(14)?,
                    titre: x.get(15)?,
                    artistes: artistes.map(|a| a.split(" ; ").map(String::from).filter(|s| !s.is_empty()).collect()).unwrap_or_default(),
                    album: x.get(17)?,
                    annee: x.get::<_, Option<i64>>(18)?.map(|v| v as u32),
                    miniature,
                    etat_miniature: match mini {
                        MINI_FAITE => "faite",
                        MINI_ECHEC => "echec",
                        MINI_IMPOSSIBLE => "impossible",
                        MINI_WEBVIEW => "webview",
                        _ => "a-faire",
                    }
                    .into(),
                    etat: match x.get::<_, i64>(20)? {
                        ABSENT => EtatFichier::Absent,
                        INDISPONIBLE => EtatFichier::Indisponible,
                        _ => EtatFichier::Present,
                    },
                    etat_bibliotheque: bib_etat.and_then(|b| serde_json::from_value(serde_json::Value::String(b)).ok()),
                    sources: src,
                    en_ligne: x.get::<_, i64>(22)? == 1,
                    premiere_compatible: premiere.map(|v| v == 1),
                    volume: x.get(26)?,
                    doublons: x.get::<_, i64>(27)? as u32,
                    doublon_de: x.get(28)?,
                })
            })
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        let total = total.max(0) as u64;
        Ok(Page {
            elements,
            total,
            page,
            taille_page,
            pages: total.div_ceil(taille_page as u64).max(1) as u32,
            duree_ms: (debut.elapsed().as_secs_f64() * 1000.0 * 100.0).round() / 100.0,
        })
    }

    pub fn totaux(&self) -> rusqlite::Result<Totaux> {
        let mut t = Totaux::default();
        let mut st = self.c.prepare("SELECT type, etat, count(*) FROM fichiers WHERE doublon_de IS NULL GROUP BY type, etat")?;
        let l = st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)? as u64)))?;
        for x in l {
            let (ty, etat, n) = x?;
            match etat {
                ABSENT => t.absents += n,
                _ => {
                    if etat == INDISPONIBLE {
                        t.indisponibles += n;
                    }
                    t.total += n;
                    match ty {
                        0 => t.video += n,
                        1 => t.audio += n,
                        _ => t.image += n,
                    }
                }
            }
        }
        t.doublons = self.c.query_row("SELECT count(*) FROM fichiers WHERE doublon_de IS NOT NULL AND etat != 1", [], |r| r.get::<_, i64>(0))? as u64;
        t.metadonnees_a_faire = self.c.query_row("SELECT count(*) FROM fichiers WHERE meta = 0 AND etat = 0 AND en_ligne = 0", [], |r| r.get::<_, i64>(0))? as u64;
        t.miniatures_a_faire = self.c.query_row("SELECT count(*) FROM fichiers WHERE mini = 0 AND etat = 0 AND en_ligne = 0 AND type != 0", [], |r| r.get::<_, i64>(0))? as u64;
        t.dossiers = self.c.query_row("SELECT count(*) FROM dossiers", [], |r| r.get::<_, i64>(0))? as u64;
        Ok(t)
    }

    // ---- Enrichissement (métadonnées, miniatures) ----

    fn a_traiter(&self, condition: &str, n: usize) -> rusqlite::Result<Vec<AEnrichir>> {
        let sql = format!(
            "SELECT f.id, d.chemin, f.nom, f.ext, f.type, f.taille FROM fichiers f JOIN dossiers d ON d.id = f.dossier_id
             WHERE {condition} AND f.etat = 0 AND f.en_ligne = 0 ORDER BY f.id DESC LIMIT {n}"
        );
        let mut st = self.c.prepare_cached(&sql)?;
        let v = st
            .query_map([], |r| {
                let d: String = r.get(1)?;
                let nom: String = r.get(2)?;
                Ok(AEnrichir { id: r.get(0)?, chemin: Path::new(&d).join(nom), ext: r.get(3)?, type_media: type_de_code(r.get(4)?), taille: r.get::<_, i64>(5)?.max(0) as u64 })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(v)
    }

    pub fn a_enrichir(&self, n: usize) -> rusqlite::Result<Vec<AEnrichir>> {
        self.a_traiter("f.meta = 0", n)
    }

    pub fn a_miniaturer(&self, n: usize) -> rusqlite::Result<Vec<AEnrichir>> {
        self.a_traiter("f.mini = 0 AND f.meta != 0 AND f.type != 0", n)
    }

    pub fn par_ids(&self, ids: &[i64]) -> rusqlite::Result<Vec<AEnrichir>> {
        let mut st = self.c.prepare_cached(
            "SELECT f.id, d.chemin, f.nom, f.ext, f.type, f.taille FROM fichiers f JOIN dossiers d ON d.id = f.dossier_id
             WHERE f.id = ?1 AND f.etat = 0 AND f.en_ligne = 0",
        )?;
        let mut v = Vec::new();
        for id in ids {
            let x = st
                .query_row([id], |r| {
                    let d: String = r.get(1)?;
                    let nom: String = r.get(2)?;
                    Ok(AEnrichir { id: r.get(0)?, chemin: Path::new(&d).join(nom), ext: r.get(3)?, type_media: type_de_code(r.get(4)?), taille: r.get::<_, i64>(5)?.max(0) as u64 })
                })
                .optional()?;
            v.extend(x);
        }
        Ok(v)
    }

    pub fn enregistrer_meta(&self, id: i64, m: &MetaExtraite) -> rusqlite::Result<()> {
        self.c
            .prepare_cached(
                "UPDATE fichiers SET meta = ?2, duree = coalesce(?3, duree), largeur = coalesce(?4, largeur), hauteur = coalesce(?5, hauteur),
                   ips = coalesce(?6, ips), codec_video = coalesce(?7, codec_video), codec_audio = coalesce(?8, codec_audio),
                   titre = coalesce(?9, titre), artistes = coalesce(?10, artistes), album = coalesce(?11, album), annee = coalesce(?12, annee),
                   mini = coalesce(?13, mini)
                 WHERE id = ?1",
            )?
            .execute(params![
                id,
                m.etat,
                m.duree,
                m.largeur.map(|v| v as i64),
                m.hauteur.map(|v| v as i64),
                m.ips,
                m.codec_video,
                m.codec_audio,
                m.titre,
                m.artistes,
                m.album,
                m.annee.map(|v| v as i64),
                m.mini
            ])?;
        Ok(())
    }

    pub fn poser_mini(&self, id: i64, etat: i64) -> rusqlite::Result<()> {
        self.c.prepare_cached("UPDATE fichiers SET mini = ?2 WHERE id = ?1")?.execute(params![id, etat])?;
        Ok(())
    }

    /// Ligne d'un média par son identifiant : (id interne, chemin, type, extension, état, miniature, en ligne).
    pub fn par_idm(&self, idm: &str) -> rusqlite::Result<Option<(i64, PathBuf, TypeMedia, String, i64, i64, bool)>> {
        self.c
            .prepare_cached("SELECT f.id, d.chemin, f.nom, f.type, f.ext, f.etat, f.mini, f.en_ligne FROM fichiers f JOIN dossiers d ON d.id = f.dossier_id WHERE f.idm = ?1")?
            .query_row([idm], |r| {
                let d: String = r.get(1)?;
                let n: String = r.get(2)?;
                Ok((r.get(0)?, Path::new(&d).join(n), type_de_code(r.get(3)?), r.get(4)?, r.get(5)?, r.get(6)?, r.get::<_, i64>(7)? == 1))
            })
            .optional()
    }

    /// Analyse du WebView2 (vidéo) : durée et définition complétées si absentes ; miniature faite ou échec.
    pub fn enregistrer_analyse(&self, id: i64, duree: Option<f64>, largeur: Option<u32>, hauteur: Option<u32>, mini: i64) -> rusqlite::Result<()> {
        self.c
            .prepare_cached("UPDATE fichiers SET duree = coalesce(duree, ?2), largeur = coalesce(largeur, ?3), hauteur = coalesce(hauteur, ?4), mini = ?5 WHERE id = ?1")?
            .execute(params![id, duree, largeur.map(|v| v as i64), hauteur.map(|v| v as i64), mini])?;
        Ok(())
    }

    pub fn nombre_fichiers(&self) -> u64 {
        self.c.query_row("SELECT count(*) FROM fichiers", [], |r| r.get::<_, i64>(0)).unwrap_or(0) as u64
    }
}

/// Expression FTS5 sûre : chaque mot devient un préfixe entre guillemets (`"coucher"*`), tous exigés (ET). Les
/// guillemets de l'utilisateur sont doublés ; un mot sans lettre ni chiffre est ignoré.
pub fn expression_fts(texte: &str, dans_chemin: bool) -> Option<String> {
    let mots: Vec<String> = texte
        .split_whitespace()
        .filter(|m| m.chars().any(|c| c.is_alphanumeric()))
        .take(16)
        .map(|m| {
            let propre: String = m.chars().filter(|c| !c.is_control() && *c != '*').collect::<String>().replace('"', "\"\"");
            format!("\"{propre}\"*")
        })
        .collect();
    if mots.is_empty() {
        return None;
    }
    let corps = mots.join(" AND ");
    Some(if dans_chemin { corps } else { format!("{{nom etiquettes}} : ({corps})") })
}

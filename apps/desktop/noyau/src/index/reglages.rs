//! Réglages d'AETHRYON Index : `%APPDATA%\AETHRYON\index-medias.json`, privé au Desktop (hors contrat : le panneau
//! Premiere ne le lit jamais). Cibles du scan, types et extensions retenus, exclusions, liens, emplacement de l'index,
//! mode Everything. Un fichier illisible est mis de côté (`index-medias.json.illisible`), jamais écrasé en silence.
//!
//! Exclusions : trois formes, toutes sans casse.
//! - `nom` (jokers `*` et `?` permis) : tout dossier qui porte ce nom, à n'importe quelle profondeur (`node_modules`,
//!   `.git`, `AppData`, `$*`) ;
//! - `\chemin` : relatif à la racine du volume (`\Windows`, `\Program Files`) : `D:\Photos\Windows` n'est pas exclu ;
//! - `C:\chemin\absolu` (ou `\\serveur\partage\…`) : ce dossier précis.
//!
//! Une cible choisie explicitement n'est jamais exclue (on peut indexer `C:\Windows\Media` si on le demande).

use crate::atomique::{self, Lecture};
use crate::bibliotheque::TypeMedia;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

pub const VIDEO: &[&str] = &[
    "mp4", "m4v", "mov", "mkv", "webm", "avi", "wmv", "mpg", "mpeg", "mpe", "m2v", "ts", "mts", "m2ts", "flv", "f4v", "3gp",
    "3g2", "ogv", "vob", "mxf", "asf", "divx", "rm", "rmvb", "dv",
];
pub const AUDIO: &[&str] = &[
    "mp3", "wav", "flac", "m4a", "aac", "ogg", "oga", "opus", "aiff", "aif", "aifc", "wma", "alac", "ape", "wv", "mka", "mpc",
    "ac3", "caf", "amr",
];
pub const IMAGE: &[&str] = &["png", "jpg", "jpeg", "jpe", "jfif", "webp", "gif", "tif", "tiff", "bmp", "dib", "heic", "heif", "avif"];

/// Exclusions par défaut (le brief : dossiers système ou inutiles).
pub const EXCLUSIONS: &[&str] = &[
    "\\Windows",
    "\\Program Files",
    "\\Program Files (x86)",
    "\\ProgramData",
    "\\Windows.old",
    "\\$WinREAgent",
    "\\$SysReset",
    "\\$Windows.~BT",
    "\\$Windows.~WS",
    "\\Recovery",
    "\\PerfLogs",
    "\\Config.Msi",
    "AppData",
    "$Recycle.Bin",
    "System Volume Information",
    "node_modules",
    ".git",
];

pub const CIBLES_MAX: usize = 64;
pub const EXCLUSIONS_MAX: usize = 200;
pub const EXTENSIONS_MAX: usize = 64;
pub const FILS_MAX: u8 = 4;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum GenreCible {
    /// Un dossier (récursif).
    Dossier,
    /// Un disque entier (`E:\`).
    Volume,
    /// Tous les disques disponibles (fixes et amovibles ; ni réseau, ni optique).
    Tous,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct Cible {
    pub genre: GenreCible,
    #[serde(default)]
    pub chemin: String,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ModeEverything {
    /// Scanner natif seulement (défaut).
    Desactive,
    /// Index d'Everything employé s'il est lancé et prêt, repli automatique sur le scanner natif sinon.
    Auto,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Types {
    pub video: bool,
    pub audio: bool,
    pub image: bool,
}

impl Default for Types {
    fn default() -> Self {
        Self { video: true, audio: true, image: true }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Extensions {
    pub video: Vec<String>,
    pub audio: Vec<String>,
    pub image: Vec<String>,
}

fn liste(l: &[&str]) -> Vec<String> {
    l.iter().map(|s| s.to_string()).collect()
}

impl Default for Extensions {
    fn default() -> Self {
        Self { video: liste(VIDEO), audio: liste(AUDIO), image: liste(IMAGE) }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Reglages {
    pub schema: u32,
    pub cibles: Vec<Cible>,
    pub types: Types,
    pub extensions: Extensions,
    pub exclusions: Vec<String>,
    /// Dossiers et fichiers cachés ou système (attributs Windows, noms commençant par « . ») ignorés.
    pub exclure_caches: bool,
    /// Liens symboliques, jonctions et points de montage suivis (faux par défaut ; jamais de boucle dans les deux cas).
    pub suivre_liens: bool,
    /// Taille minimale d'un fichier retenu, en octets (0 : tout fichier non vide).
    pub taille_min: u64,
    /// Fils de parcours (1 à 4).
    pub fils: u8,
    /// Dossier de l'index, du cache et des miniatures (`None` : `R\index`). Changé par `deplacer_emplacement`.
    pub emplacement: Option<String>,
    pub everything: ModeEverything,
    /// Surveillance en direct des DOSSIERS ciblés après un scan (jamais d'un disque entier).
    pub surveiller: bool,
    /// Extraction différée des métadonnées (durée, définition, codecs, étiquettes audio).
    pub metadonnees: bool,
    /// Miniatures produites en arrière-plan (les cartes visibles en demandent toujours).
    pub miniatures: bool,
}

impl Default for Reglages {
    fn default() -> Self {
        Self {
            schema: 1,
            cibles: Vec::new(),
            types: Types::default(),
            extensions: Extensions::default(),
            exclusions: liste(EXCLUSIONS),
            exclure_caches: true,
            suivre_liens: false,
            taille_min: 0,
            fils: 2,
            emplacement: None,
            everything: ModeEverything::Desactive,
            surveiller: true,
            metadonnees: true,
            miniatures: true,
        }
    }
}

/// Chemin absolu propre : séparateurs du système, sans `.` ni `..`, sans séparateur final (sauf racine de volume).
pub fn chemin_propre(s: &str) -> Option<PathBuf> {
    let t = s.trim();
    if t.is_empty() || t.contains('\0') {
        return None;
    }
    #[cfg(windows)]
    let t = t.replace('/', "\\");
    let p = Path::new(&t);
    if !p.is_absolute() {
        return None;
    }
    let mut sortie = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => return None,
            autre => sortie.push(autre.as_os_str()),
        }
    }
    Some(sortie)
}

fn ext_valide(e: &str) -> bool {
    !e.is_empty() && e.len() <= 8 && e.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

fn exclusion_valide(e: &str) -> bool {
    let t = e.trim();
    !t.is_empty() && t.chars().count() <= 260 && !t.contains('\0') && !t.contains("..")
}

impl Reglages {
    /// Remet d'aplomb un fichier modifié à la main : renvoie les corrections faites (journal).
    pub fn normaliser(&mut self) -> Vec<String> {
        let mut corr = Vec::new();
        self.schema = 1;
        if self.fils == 0 || self.fils > FILS_MAX {
            corr.push(format!("fils hors limites ({}) : 2", self.fils));
            self.fils = 2;
        }
        let avant = self.cibles.len();
        let mut vues = Vec::new();
        self.cibles.retain(|c| {
            let ok = match c.genre {
                GenreCible::Tous => true,
                _ => chemin_propre(&c.chemin).is_some(),
            };
            let cle = (c.genre, crate::noms::normaliser_pour_id(c.chemin.trim_end_matches(['\\', '/'])));
            if !ok || vues.contains(&cle) {
                return false;
            }
            vues.push(cle);
            true
        });
        self.cibles.truncate(CIBLES_MAX);
        if self.cibles.len() != avant {
            corr.push(format!("{} cible(s) invalide(s) ou en double retirée(s)", avant - self.cibles.len()));
        }
        for l in [&mut self.extensions.video, &mut self.extensions.audio, &mut self.extensions.image] {
            let mut propres: Vec<String> = Vec::new();
            for e in l.iter() {
                let e = e.trim().trim_start_matches('.').to_ascii_lowercase();
                if ext_valide(&e) && !propres.contains(&e) {
                    propres.push(e);
                }
            }
            propres.truncate(EXTENSIONS_MAX);
            *l = propres;
        }
        self.exclusions.retain(|e| exclusion_valide(e));
        self.exclusions.truncate(EXCLUSIONS_MAX);
        if let Some(e) = &self.emplacement {
            if chemin_propre(e).is_none() {
                corr.push("emplacement relatif ou invalide : emplacement par défaut".into());
                self.emplacement = None;
            }
        }
        corr
    }

    /// Modification partielle venue de l'interface : seules les clés connues, avec leur type. L'emplacement ne se
    /// change pas ici (migration sûre : `IndexMedias::deplacer_emplacement`).
    pub fn appliquer(&mut self, patch: &Value) -> Result<(), String> {
        let obj = patch.as_object().ok_or("modification attendue sous forme d'objet")?;
        let mut c = self.clone();
        for (cle, v) in obj {
            match cle.as_str() {
                "cibles" => {
                    let l: Vec<Cible> = serde_json::from_value(v.clone()).map_err(|_| "cibles : liste de { genre, chemin } attendue")?;
                    if l.len() > CIBLES_MAX {
                        return Err(format!("{CIBLES_MAX} cibles au plus."));
                    }
                    for x in &l {
                        if x.genre != GenreCible::Tous && chemin_propre(&x.chemin).is_none() {
                            return Err(format!("Chemin refusé : « {} » (chemin complet attendu).", x.chemin));
                        }
                    }
                    c.cibles = l;
                }
                "types" => {
                    let o = v.as_object().ok_or("types : objet attendu")?;
                    for (k, b) in o {
                        let b = b.as_bool().ok_or("types : booléens attendus")?;
                        match k.as_str() {
                            "video" => c.types.video = b,
                            "audio" => c.types.audio = b,
                            "image" => c.types.image = b,
                            _ => return Err(format!("types : clé inconnue « {k} »")),
                        }
                    }
                }
                "extensions" => {
                    let o = v.as_object().ok_or("extensions : objet attendu")?;
                    for (k, l) in o {
                        let l: Vec<String> = serde_json::from_value(l.clone()).map_err(|_| "extensions : listes de textes attendues")?;
                        if l.len() > EXTENSIONS_MAX {
                            return Err(format!("{EXTENSIONS_MAX} extensions au plus par type."));
                        }
                        for e in &l {
                            if !ext_valide(&e.trim().trim_start_matches('.').to_ascii_lowercase()) {
                                return Err(format!("Extension refusée : « {e} »."));
                            }
                        }
                        match k.as_str() {
                            "video" => c.extensions.video = l,
                            "audio" => c.extensions.audio = l,
                            "image" => c.extensions.image = l,
                            _ => return Err(format!("extensions : clé inconnue « {k} »")),
                        }
                    }
                }
                "exclusions" => {
                    let l: Vec<String> = serde_json::from_value(v.clone()).map_err(|_| "exclusions : liste de textes attendue")?;
                    if l.len() > EXCLUSIONS_MAX {
                        return Err(format!("{EXCLUSIONS_MAX} exclusions au plus."));
                    }
                    if let Some(e) = l.iter().find(|e| !exclusion_valide(e)) {
                        return Err(format!("Exclusion refusée : « {e} »."));
                    }
                    c.exclusions = l;
                }
                "exclureCaches" => c.exclure_caches = v.as_bool().ok_or("exclureCaches : booléen attendu")?,
                "suivreLiens" => c.suivre_liens = v.as_bool().ok_or("suivreLiens : booléen attendu")?,
                "surveiller" => c.surveiller = v.as_bool().ok_or("surveiller : booléen attendu")?,
                "metadonnees" => c.metadonnees = v.as_bool().ok_or("metadonnees : booléen attendu")?,
                "miniatures" => c.miniatures = v.as_bool().ok_or("miniatures : booléen attendu")?,
                "tailleMin" => c.taille_min = v.as_u64().ok_or("tailleMin : entier positif attendu")?,
                "fils" => {
                    let f = v.as_u64().ok_or("fils : entier attendu")?;
                    if f == 0 || f > FILS_MAX as u64 {
                        return Err(format!("fils : de 1 à {FILS_MAX}."));
                    }
                    c.fils = f as u8;
                }
                "everything" => {
                    c.everything = serde_json::from_value(v.clone()).map_err(|_| "everything : « desactive » ou « auto » attendu")?;
                }
                "emplacement" => return Err("L'emplacement de l'index se change par « Déplacer l'index » (migration sûre).".into()),
                autre => return Err(format!("Réglage inconnu : « {autre} »")),
            }
        }
        c.normaliser();
        *self = c;
        Ok(())
    }

    /// Table extension → type, pour les types actifs seulement.
    pub fn table_extensions(&self) -> HashMap<String, TypeMedia> {
        let mut t = HashMap::new();
        let paires = [
            (self.types.video, &self.extensions.video, TypeMedia::Video),
            (self.types.audio, &self.extensions.audio, TypeMedia::Audio),
            (self.types.image, &self.extensions.image, TypeMedia::Image),
        ];
        for (actif, l, ty) in paires {
            if actif {
                for e in l {
                    t.entry(e.to_ascii_lowercase()).or_insert(ty);
                }
            }
        }
        t
    }
}

pub struct Chargement {
    pub reglages: Reglages,
    pub remarques: Vec<String>,
}

pub fn chemin_fichier(dossier_config: &Path) -> PathBuf {
    dossier_config.join("index-medias.json")
}

pub fn charger(dossier_config: &Path) -> Chargement {
    let f = chemin_fichier(dossier_config);
    let mut remarques = Vec::new();
    let mut r = match atomique::lire_json::<Reglages>(&f) {
        Lecture::Lu(r) => r,
        Lecture::Absent => Reglages::default(),
        Lecture::Illisible(m) => {
            let _ = std::fs::rename(&f, f.with_file_name("index-medias.json.illisible"));
            remarques.push(format!("index-medias.json {m} : mis de côté, réglages par défaut"));
            Reglages::default()
        }
    };
    remarques.extend(r.normaliser());
    Chargement { reglages: r, remarques }
}

pub fn enregistrer(dossier_config: &Path, r: &Reglages) -> std::io::Result<()> {
    atomique::ecrire_json(&chemin_fichier(dossier_config), r, true)
}

// ---- Exclusions ---------------------------------------------------------------------------------------------------

/// Joker simple (`*` : toute suite, `?` : un caractère), sur des textes déjà en minuscules.
pub fn joker(motif: &[char], texte: &[char]) -> bool {
    let (mut m, mut t) = (0usize, 0usize);
    let (mut etoile, mut reprise) = (None::<usize>, 0usize);
    while t < texte.len() {
        if m < motif.len() && (motif[m] == '?' || motif[m] == texte[t]) {
            m += 1;
            t += 1;
        } else if m < motif.len() && motif[m] == '*' {
            etoile = Some(m);
            m += 1;
            reprise = t;
        } else if let Some(e) = etoile {
            m = e + 1;
            reprise += 1;
            t = reprise;
        } else {
            return false;
        }
    }
    while m < motif.len() && motif[m] == '*' {
        m += 1;
    }
    m == motif.len()
}

/// Racine du volume d'un chemin, en clé normalisée (`c:`, `\\serveur\partage`, `` sous Unix) et le reste.
pub fn decouper_volume(cle: &str) -> (&str, &str) {
    if cle.len() >= 2 && cle.as_bytes()[1] == b':' {
        return (&cle[..2], &cle[2..]);
    }
    if let Some(r) = cle.strip_prefix("\\\\") {
        // \\serveur\partage\reste
        let mut n = 0;
        for (i, ch) in r.char_indices() {
            if ch == '\\' {
                n += 1;
                if n == 2 {
                    return (&cle[..i + 2], &cle[i + 2..]);
                }
            }
        }
        return (cle, "");
    }
    ("", cle)
}

/// Clé d'un dossier : chemin normalisé (minuscules, `\`), sans séparateur final.
pub fn cle_dossier(chemin: &str) -> String {
    crate::noms::normaliser_pour_id(chemin).trim_end_matches('\\').to_string()
}

#[derive(Clone, Debug, Default)]
pub struct Exclusions {
    noms: Vec<Vec<char>>,
    relatifs: Vec<String>,
    absolus: Vec<String>,
}

impl Exclusions {
    pub fn depuis(l: &[String]) -> Self {
        let mut x = Exclusions::default();
        for e in l {
            let e = e.trim();
            let n = crate::noms::normaliser_pour_id(e);
            let n = n.trim_end_matches('\\').to_string();
            if n.is_empty() {
                continue;
            }
            let absolu = (n.len() >= 2 && n.as_bytes()[1] == b':') || n.starts_with("\\\\");
            if absolu {
                x.absolus.push(n);
            } else if n.starts_with('\\') {
                x.relatifs.push(n);
            } else {
                x.noms.push(n.chars().collect());
            }
        }
        x
    }

    /// Vrai si ce dossier (nom et chemin complet) est exclu. Les ancêtres ont été vérifiés en descendant.
    pub fn exclut(&self, chemin: &Path, nom: &str) -> bool {
        if !self.noms.is_empty() {
            let n: Vec<char> = nom.to_lowercase().chars().collect();
            if self.noms.iter().any(|m| joker(m, &n)) {
                return true;
            }
        }
        if self.relatifs.is_empty() && self.absolus.is_empty() {
            return false;
        }
        let cle = cle_dossier(&chemin.to_string_lossy());
        if self.absolus.iter().any(|a| *a == cle) {
            return true;
        }
        let (_, reste) = decouper_volume(&cle);
        self.relatifs.iter().any(|r| r == reste)
    }

    /// Vrai si un dossier situé SOUS `racine` (exclue d'office jamais) est exclu, lui ou un de ses ancêtres.
    pub fn exclut_sous(&self, racine: &Path, chemin: &Path) -> bool {
        let Ok(rel) = chemin.strip_prefix(racine) else { return false };
        let mut courant = racine.to_path_buf();
        for c in rel.components() {
            courant.push(c.as_os_str());
            if self.exclut(&courant, &c.as_os_str().to_string_lossy()) {
                return true;
            }
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn defauts_et_modification_partielle() {
        let mut r = Reglages::default();
        assert!(r.cibles.is_empty() && r.exclure_caches && !r.suivre_liens && r.everything == ModeEverything::Desactive);
        assert!(r.table_extensions().get("mkv") == Some(&TypeMedia::Video));
        assert!(r.table_extensions().get("flac") == Some(&TypeMedia::Audio));
        r.appliquer(&json!({"types": {"image": false}, "fils": 3, "everything": "auto", "extensions": {"audio": ["MP3", ".flac"]}})).unwrap();
        assert!(r.table_extensions().get("png").is_none(), "images désactivées");
        assert_eq!(r.extensions.audio, vec!["mp3", "flac"]);
        assert_eq!((r.fils, r.everything), (3, ModeEverything::Auto));
        assert!(r.appliquer(&json!({"fils": 9})).is_err());
        assert!(r.appliquer(&json!({"inconnu": true})).is_err());
        assert!(r.appliquer(&json!({"emplacement": "D:\\AETHRYON\\Index"})).is_err(), "migration seulement");
        assert!(r.appliquer(&json!({"cibles": [{"genre": "dossier", "chemin": "relatif"}]})).is_err());
        assert!(r.appliquer(&json!({"extensions": {"video": ["m p4"]}})).is_err());
        assert_eq!(r.fils, 3, "une modification refusée ne laisse aucune trace");
    }

    #[test]
    fn jokers_et_exclusions() {
        let c = |s: &str| s.chars().collect::<Vec<_>>();
        assert!(joker(&c("$*"), &c("$recycle.bin")));
        assert!(joker(&c("*.tmp"), &c("a.b.tmp")));
        assert!(joker(&c("img_????"), &c("img_2024")));
        assert!(!joker(&c("img_????"), &c("img_20245")));
        assert!(joker(&c("*"), &c("")));
        let x = Exclusions::depuis(&liste(EXCLUSIONS));
        #[cfg(windows)]
        {
            assert!(x.exclut(Path::new("C:\\Windows"), "Windows"));
            assert!(!x.exclut(Path::new("D:\\Photos\\Windows"), "Windows"), "relatif à la racine du volume seulement");
            assert!(x.exclut(Path::new("C:\\Users\\Élodie\\AppData"), "AppData"));
            assert!(x.exclut(Path::new("E:\\$RECYCLE.BIN"), "$RECYCLE.BIN"));
        }
        assert!(x.exclut(Path::new("/srv/projet/node_modules"), "node_modules"));
        assert!(x.exclut(Path::new("/srv/projet/.git"), ".git"));
        assert!(!x.exclut(Path::new("/srv/projet/src"), "src"));
        assert_eq!(decouper_volume("c:\\windows"), ("c:", "\\windows"));
        assert_eq!(decouper_volume("\\\\nas\\photos\\2024"), ("\\\\nas\\photos", "\\2024"));
        assert_eq!(decouper_volume("\\tmp\\x"), ("", "\\tmp\\x"));
        let y = Exclusions::depuis(&["\\tmp\\aethryon-exclu".to_string(), "Cache*".to_string()]);
        assert!(y.exclut(Path::new("/tmp/aethryon-exclu"), "aethryon-exclu"));
        assert!(y.exclut(Path::new("/x/CacheVideo"), "CacheVideo"));
        assert!(y.exclut_sous(Path::new("/x"), Path::new("/x/Cache2/sous")));
        assert!(!y.exclut_sous(Path::new("/x/Cache2"), Path::new("/x/Cache2/sous")), "la racine choisie n'est jamais exclue");
    }

    #[test]
    fn chemins_propres_et_fichier_tolerant() {
        #[cfg(unix)]
        {
            assert_eq!(chemin_propre("/tmp/./a/"), Some(PathBuf::from("/tmp/a")));
            assert_eq!(chemin_propre("/tmp/../etc"), None);
        }
        assert_eq!(chemin_propre("relatif"), None);
        let d = tempfile::tempdir().unwrap();
        let ch = charger(d.path());
        assert_eq!(ch.reglages, Reglages::default());
        std::fs::write(chemin_fichier(d.path()), b"{\"schema\":1,\"fils\":").unwrap();
        let ch = charger(d.path());
        assert!(ch.remarques.iter().any(|r| r.contains("mis de côté")));
        assert!(d.path().join("index-medias.json.illisible").exists());
        let mut r = Reglages::default();
        r.cibles.push(Cible { genre: GenreCible::Tous, chemin: String::new() });
        enregistrer(d.path(), &r).unwrap();
        assert_eq!(charger(d.path()).reglages.cibles.len(), 1);
    }
}

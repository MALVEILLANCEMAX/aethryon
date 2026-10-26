//! Index de la bibliothèque (`R\bibliotheque\index.json`, contrat §3) et passage de surveillance.
//!
//! Un « passage » liste les fichiers des dossiers surveillés et reconstruit l'index à partir de l'ancien :
//! - fichiers partiels (`.crdownload`, `.part`) : entrée `en-cours` sous le chemin FINAL attendu (même `id` que le
//!   fichier terminé, qui prend sa place sans saut) ; `.tmp` : ignorés ;
//! - fichier dont la taille ou la date change encore, ou que Windows refuse d'ouvrir (copie en cours) : `en-cours` ;
//!   il devient `disponible` quand il n'a pas bougé depuis 1,5 s au moins ;
//! - fichier disparu : `introuvable`, gardé 7 jours puis retiré ; dossier qui n'est plus surveillé : entrées retirées ;
//! - accès refusé : `erreur` avec un message clair.
//!
//! Le suivi interne (tailles vues, date de disparition, mesures faites) vit dans `suivi-desktop.json`, pour que
//! `index.json` reste exactement au format du contrat.

use crate::horloge::{self, Instant};
use crate::{mesure, noms};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum TypeMedia {
    Video,
    Audio,
    Image,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum EtatMedia {
    #[serde(rename = "disponible")]
    Disponible,
    #[serde(rename = "en-cours")]
    EnCours,
    #[serde(rename = "introuvable")]
    Introuvable,
    #[serde(rename = "erreur")]
    Erreur,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Origine {
    pub plateforme: String,
    pub titre: Option<String>,
}

impl Default for Origine {
    fn default() -> Self {
        Self { plateforme: "local".into(), titre: None }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Media {
    pub id: String,
    pub chemin: String,
    pub nom: String,
    pub ext: String,
    #[serde(rename = "type")]
    pub type_media: TypeMedia,
    pub taille: u64,
    pub ajoute_le: String,
    pub modifie_le: String,
    pub duree: Option<f64>,
    pub largeur: Option<u32>,
    pub hauteur: Option<u32>,
    pub ips: Option<f64>,
    pub codec_video: Option<String>,
    pub codec_audio: Option<String>,
    pub miniature: Option<String>,
    pub etat: EtatMedia,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub erreur: Option<String>,
    pub premiere_compatible: Option<bool>,
    #[serde(default)]
    pub origine: Origine,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct DossierIndex {
    pub chemin: String,
    pub principal: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Index {
    pub schema: u32,
    pub mis_a_jour: String,
    pub dossiers: Vec<DossierIndex>,
    pub medias: Vec<Media>,
}

impl Default for Index {
    fn default() -> Self {
        Self { schema: 1, mis_a_jour: horloge::iso(horloge::maintenant()), dossiers: Vec::new(), medias: Vec::new() }
    }
}

impl Index {
    pub fn media(&self, id: &str) -> Option<&Media> {
        self.medias.iter().find(|m| m.id == id)
    }
}

/// Suivi propre au Desktop, par identifiant.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SuiviMedia {
    pub taille: u64,
    /// Date de modification vue (ms depuis 1970).
    pub modifie: i64,
    /// Moment où taille ou date ont changé pour la dernière fois (ms).
    pub change_le: i64,
    pub introuvable_depuis: Option<String>,
    pub mesure_faite: bool,
    /// Analyse par le WebView2 (miniature, durée) : `ok`, `echec`, ou absente si pas encore tentée.
    pub analyse_web: Option<String>,
    /// Entrée née d'un fichier partiel (`.crdownload`, `.part`).
    pub partiel: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Suivi {
    pub medias: BTreeMap<String, SuiviMedia>,
}

pub fn type_par_extension(ext: &str) -> Option<TypeMedia> {
    match ext {
        "mp4" | "mov" | "m4v" | "webm" | "mkv" | "avi" | "mxf" | "mts" | "m2ts" | "3gp" | "wmv" => Some(TypeMedia::Video),
        "mp3" | "wav" | "m4a" | "aac" | "ogg" | "opus" | "flac" | "aif" | "aiff" | "wma" => Some(TypeMedia::Audio),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "tif" | "tiff" | "heic" => Some(TypeMedia::Image),
        _ => None,
    }
}

/// Extensions de fichiers partiels des navigateurs (Chrome, Edge, Brave : `.crdownload` ; Firefox : `.part`).
pub const PARTIELS: [&str; 2] = ["crdownload", "part"];

/// Garde des fichiers introuvables (contrat §3).
pub const GARDE_INTROUVABLE_JOURS: i64 = 7;
/// Délai sans changement avant qu'un fichier soit jugé stable.
pub const STABLE_MS: i64 = 1500;
/// Un fichier dont la date de modification a plus de 10 s est stable d'emblée (bibliothèque existante).
pub const ANCIEN_MS: i64 = 10_000;
/// Profondeur et nombre maximal de fichiers parcourus (protection contre un dossier immense).
pub const PROFONDEUR_MAX: usize = 4;
pub const FICHIERS_MAX: usize = 20_000;

/// Fichier vu sur le disque.
#[derive(Clone, Debug)]
pub struct Fichier {
    pub chemin: PathBuf,
    /// Chemin final (sans l'extension partielle).
    pub final_txt: String,
    pub taille: u64,
    pub modifie_ms: i64,
    pub partiel: bool,
}

fn ms(t: SystemTime) -> i64 {
    t.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn iso_ms_epoch(m: i64) -> String {
    chrono::DateTime::from_timestamp_millis(m).map(horloge::iso).unwrap_or_default()
}

fn extension(nom: &str) -> String {
    nom.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_default()
}

/// Liste les fichiers médias et partiels des dossiers (profondeur limitée, dossiers cachés et système ignorés).
/// Renvoie aussi les dossiers illisibles (absents, renommés, accès refusé) avec un message.
pub fn lister_fichiers(dossiers: &[String], exclus: &[PathBuf]) -> (Vec<Fichier>, Vec<(String, String)>) {
    let mut sortie = Vec::new();
    let mut erreurs = Vec::new();
    for d in dossiers {
        let racine = PathBuf::from(d);
        if !racine.is_dir() {
            erreurs.push((d.clone(), "Dossier introuvable : renommé, déplacé ou sur un disque débranché.".into()));
            continue;
        }
        let mut pile = vec![(racine, 0usize)];
        while let Some((dossier, prof)) = pile.pop() {
            if exclus.iter().any(|x| noms::est_dans(&dossier.to_string_lossy(), &x.to_string_lossy())) {
                continue;
            }
            let lecture = match std::fs::read_dir(&dossier) {
                Ok(l) => l,
                Err(e) => {
                    erreurs.push((dossier.to_string_lossy().into_owned(), format!("Lecture du dossier impossible ({}).", e.kind())));
                    continue;
                }
            };
            for entree in lecture.flatten() {
                if sortie.len() >= FICHIERS_MAX {
                    break;
                }
                let nom = entree.file_name();
                // Nom non représentable en UTF-8 (rare sous Windows) : ignoré plutôt qu'écrit faux dans le JSON.
                let Some(nom) = nom.to_str() else { continue };
                if nom.starts_with('.') || nom.starts_with('$') || nom.starts_with("~$") || nom.eq_ignore_ascii_case("desktop.ini") {
                    continue;
                }
                let Ok(meta) = entree.metadata() else { continue };
                let chemin = entree.path();
                if meta.is_dir() {
                    if prof + 1 < PROFONDEUR_MAX {
                        pile.push((chemin, prof + 1));
                    }
                    continue;
                }
                let ext = extension(nom);
                let (partiel, final_txt) = if PARTIELS.contains(&ext.as_str()) {
                    let sans = &nom[..nom.len() - ext.len() - 1];
                    if type_par_extension(&extension(sans)).is_none() {
                        continue;
                    }
                    (true, chemin.with_file_name(sans).to_string_lossy().into_owned())
                } else if type_par_extension(&ext).is_some() {
                    (false, chemin.to_string_lossy().into_owned())
                } else {
                    continue;
                };
                sortie.push(Fichier {
                    taille: meta.len(),
                    modifie_ms: meta.modified().map(ms).unwrap_or(0),
                    chemin,
                    final_txt,
                    partiel,
                });
            }
        }
    }
    (sortie, erreurs)
}

/// Résultat d'un passage.
#[derive(Debug)]
pub struct Passage {
    pub index: Index,
    /// Identifiants apparus pendant ce passage (hors premier passage).
    pub nouveaux: Vec<String>,
    /// Identifiants devenus `disponible` pendant ce passage (hors premier passage) : « média prêt ».
    pub prets: Vec<String>,
    /// Au moins un fichier bouge encore : repasser dans 2 s.
    pub instable: bool,
    /// Les médias ont changé (l'index doit être réécrit).
    pub change: bool,
}

/// Essai d'ouverture en lecture : `Ok` si lisible, `Err(true)` si accès refusé, `Err(false)` si occupé (copie en cours).
fn ouvrable(chemin: &Path) -> Result<(), bool> {
    match std::fs::File::open(chemin) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => Err(true),
        Err(_) => Err(false),
    }
}

fn nom_et_ext(chemin: &str) -> (String, String) {
    let base = chemin.rsplit(['\\', '/']).next().unwrap_or(chemin);
    match base.rsplit_once('.') {
        Some((n, e)) if !n.is_empty() => (n.to_string(), e.to_lowercase()),
        _ => (base.to_string(), String::new()),
    }
}

/// Reconstruit l'index. `premier` : premier passage depuis le démarrage (aucune notification « nouveau »).
pub fn passer(ancien: &Index, suivi: &mut Suivi, dossiers: &[DossierIndex], fichiers: Vec<Fichier>, maintenant: Instant, premier: bool) -> Passage {
    let t = maintenant.timestamp_millis();
    let par_id: HashMap<&str, &Media> = ancien.medias.iter().map(|m| (m.id.as_str(), m)).collect();
    let mut vus: HashMap<String, Media> = HashMap::new();
    let mut instable = false;
    let mut nouveaux = Vec::new();
    let mut prets = Vec::new();

    // Un fichier final l'emporte sur son partiel homonyme (fin de téléchargement en cours de passage).
    let mut fichiers = fichiers;
    fichiers.sort_by_key(|f| f.partiel);

    for f in fichiers {
        let id = noms::id_media(&f.final_txt);
        if vus.contains_key(&id) {
            continue;
        }
        let (nom, ext) = nom_et_ext(&f.final_txt);
        let Some(type_media) = type_par_extension(&ext) else { continue };
        let a = par_id.get(id.as_str()).copied();
        let s = suivi.medias.entry(id.clone()).or_default();
        let change = s.taille != f.taille || s.modifie != f.modifie_ms || s.change_le == 0;
        if change {
            if s.taille != f.taille || s.modifie != f.modifie_ms {
                s.mesure_faite = false;
                s.analyse_web = None;
            }
            s.taille = f.taille;
            s.modifie = f.modifie_ms;
            s.change_le = t;
        }
        s.introuvable_depuis = None;
        s.partiel = f.partiel;

        let modifie_le = iso_ms_epoch(f.modifie_ms);
        let meme_fichier = a.map(|a| a.taille == f.taille && a.modifie_le == modifie_le).unwrap_or(false);
        let mut m = Media {
            id: id.clone(),
            chemin: f.final_txt.clone(),
            nom,
            ext: ext.clone(),
            type_media,
            taille: f.taille,
            ajoute_le: a.map(|a| a.ajoute_le.clone()).unwrap_or_else(|| if premier { modifie_le.clone() } else { horloge::iso(maintenant) }),
            modifie_le,
            duree: None,
            largeur: None,
            hauteur: None,
            ips: None,
            codec_video: None,
            codec_audio: None,
            miniature: None,
            etat: EtatMedia::EnCours,
            erreur: None,
            premiere_compatible: None,
            origine: a.map(|a| a.origine.clone()).unwrap_or_default(),
        };
        if let (Some(a), true) = (a, meme_fichier) {
            m.duree = a.duree;
            m.largeur = a.largeur;
            m.hauteur = a.hauteur;
            m.ips = a.ips;
            m.codec_video = a.codec_video.clone();
            m.codec_audio = a.codec_audio.clone();
            m.miniature = a.miniature.clone();
            m.premiere_compatible = a.premiere_compatible;
        }

        let stable = !f.partiel && ((!change && t - s.change_le >= STABLE_MS) || t - f.modifie_ms >= ANCIEN_MS);
        if stable {
            match ouvrable(&f.chemin) {
                Ok(()) => {
                    m.etat = EtatMedia::Disponible;
                    if !s.mesure_faite {
                        if let Some(x) = mesure::mesurer(&f.chemin, &ext) {
                            m.duree = x.duree.or(m.duree);
                            m.largeur = x.largeur.or(m.largeur);
                            m.hauteur = x.hauteur.or(m.hauteur);
                            m.ips = x.ips.or(m.ips);
                            m.codec_video = x.codec_video.or(m.codec_video);
                            m.codec_audio = x.codec_audio.or(m.codec_audio);
                        }
                        s.mesure_faite = true;
                    }
                    m.premiere_compatible = mesure::premiere_compatible(&ext, m.codec_video.as_deref(), m.codec_audio.as_deref());
                }
                Err(true) => {
                    m.etat = EtatMedia::Erreur;
                    m.erreur = Some("Windows refuse la lecture de ce fichier (droits d'accès).".into());
                }
                Err(false) => {
                    instable = true;
                }
            }
        } else {
            instable = true;
        }
        if !premier {
            if a.is_none() {
                nouveaux.push(id.clone());
            }
            if m.etat == EtatMedia::Disponible && a.map(|a| a.etat != EtatMedia::Disponible).unwrap_or(true) {
                prets.push(id.clone());
            }
        }
        vus.insert(id, m);
    }

    // Disparus.
    let limite = maintenant - chrono::Duration::days(GARDE_INTROUVABLE_JOURS);
    for a in &ancien.medias {
        if vus.contains_key(&a.id) {
            continue;
        }
        let surveille = dossiers.iter().any(|d| noms::est_dans(&a.chemin, &d.chemin));
        let s = suivi.medias.entry(a.id.clone()).or_default();
        if !surveille || s.partiel {
            suivi.medias.remove(&a.id);
            continue;
        }
        let depuis = s.introuvable_depuis.get_or_insert_with(|| horloge::iso(maintenant)).clone();
        if horloge::lire(&depuis).map(|d| d < limite).unwrap_or(false) {
            suivi.medias.remove(&a.id);
            continue;
        }
        let mut m = a.clone();
        m.etat = EtatMedia::Introuvable;
        m.erreur = None;
        vus.insert(a.id.clone(), m);
    }
    suivi.medias.retain(|id, _| vus.contains_key(id));

    let mut medias: Vec<Media> = vus.into_values().collect();
    medias.sort_by(|a, b| b.ajoute_le.cmp(&a.ajoute_le).then_with(|| a.nom.to_lowercase().cmp(&b.nom.to_lowercase())));
    let change = medias != ancien.medias || dossiers != ancien.dossiers.as_slice();
    Passage {
        index: Index {
            schema: 1,
            mis_a_jour: if change { horloge::iso(maintenant) } else { ancien.mis_a_jour.clone() },
            dossiers: dossiers.to_vec(),
            medias,
        },
        nouveaux,
        prets,
        instable,
        change,
    }
}

/// Média à faire analyser par le WebView2 : miniature (image à 10 % de la durée, ou forme d'onde pour l'audio),
/// durée et définition quand les en-têtes ne les donnent pas.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AAnalyser {
    pub id: String,
    pub chemin: String,
    #[serde(rename = "type")]
    pub type_media: TypeMedia,
    pub ext: String,
}

pub fn a_analyser(index: &Index, suivi: &Suivi, max: usize) -> Vec<AAnalyser> {
    index
        .medias
        .iter()
        .filter(|m| m.etat == EtatMedia::Disponible)
        .filter(|m| suivi.medias.get(&m.id).map(|s| s.analyse_web.is_none()).unwrap_or(false))
        .filter(|m| m.miniature.is_none() || (m.duree.is_none() && m.type_media != TypeMedia::Image))
        .take(max)
        .map(|m| AAnalyser { id: m.id.clone(), chemin: m.chemin.clone(), type_media: m.type_media, ext: m.ext.clone() })
        .collect()
}

/// Résultat d'analyse renvoyé par l'interface.
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AnalyseWeb {
    pub duree: Option<f64>,
    pub largeur: Option<u32>,
    pub hauteur: Option<u32>,
    /// Vrai si une miniature a été écrite dans `miniatures/<id>.jpg`.
    pub miniature: bool,
    /// Vrai si le WebView2 n'a pas su lire le fichier (codec ou conteneur non pris en charge).
    pub echec: bool,
}

/// Applique une analyse : complète seulement les champs encore vides (les mesures d'en-têtes priment).
pub fn appliquer_analyse(index: &mut Index, suivi: &mut Suivi, id: &str, a: &AnalyseWeb) -> bool {
    let Some(m) = index.medias.iter_mut().find(|m| m.id == id) else { return false };
    let s = suivi.medias.entry(id.to_string()).or_default();
    s.analyse_web = Some(if a.echec { "echec".into() } else { "ok".into() });
    let valide = |v: f64| v.is_finite() && v > 0.0 && v < 1.0e7;
    if m.duree.is_none() {
        m.duree = a.duree.filter(|d| valide(*d)).map(|d| (d * 1000.0).round() / 1000.0);
    }
    if m.largeur.is_none() && m.hauteur.is_none() {
        if let (Some(l), Some(h)) = (a.largeur, a.hauteur) {
            if l > 0 && h > 0 && l < 100_000 && h < 100_000 {
                m.largeur = Some(l);
                m.hauteur = Some(h);
            }
        }
    }
    if a.miniature {
        m.miniature = Some(format!("miniatures/{id}.jpg"));
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mesure::essais;
    use std::fs;

    fn dossiers(d: &Path) -> Vec<DossierIndex> {
        vec![DossierIndex { chemin: d.to_string_lossy().into_owned(), principal: true }]
    }

    fn passage(ancien: &Index, suivi: &mut Suivi, d: &Path, t: Instant, premier: bool) -> Passage {
        let ds = dossiers(d);
        let (f, e) = lister_fichiers(&ds.iter().map(|x| x.chemin.clone()).collect::<Vec<_>>(), &[]);
        assert!(e.is_empty(), "{e:?}");
        passer(ancien, suivi, &ds, f, t, premier)
    }

    fn vieillir(f: &Path) {
        let t = SystemTime::now() - std::time::Duration::from_secs(3600);
        fs::File::options().write(true).open(f).unwrap().set_modified(t).unwrap();
    }

    #[test]
    fn bibliotheque_existante_puis_nouveau_fichier() {
        let d = tempfile::tempdir().unwrap();
        let v = d.path().join("Coucher de soleil sur la côte.mp4");
        fs::write(&v, essais::mp4(12, 1280, 720, 30, false)).unwrap();
        vieillir(&v);
        fs::write(d.path().join("notes.txt"), b"ignore").unwrap();
        fs::write(d.path().join("x.mp4.tmp"), b"ignore").unwrap();
        let mut suivi = Suivi::default();
        let t0 = chrono::Utc::now();
        let p = passage(&Index::default(), &mut suivi, d.path(), t0, true);
        assert_eq!(p.index.medias.len(), 1);
        let m = &p.index.medias[0];
        assert_eq!(m.etat, EtatMedia::Disponible);
        assert_eq!((m.nom.as_str(), m.ext.as_str(), m.type_media), ("Coucher de soleil sur la côte", "mp4", TypeMedia::Video));
        assert_eq!(m.id, noms::id_media(&v.to_string_lossy()));
        assert_eq!(m.duree, Some(12.0));
        assert_eq!(m.premiere_compatible, Some(true));
        assert!(p.nouveaux.is_empty() && p.prets.is_empty(), "premier passage : aucune notification");
        assert!(!p.instable);

        // Nouveau fichier qui arrive : en-cours, puis disponible quand il n'a plus bougé.
        let n = d.path().join("Nappe sonore — côte.wav");
        fs::write(&n, b"RIFF").unwrap();
        let p2 = passage(&p.index, &mut suivi, d.path(), t0 + chrono::Duration::seconds(1), false);
        let m2 = p2.index.medias.iter().find(|m| m.ext == "wav").unwrap();
        assert_eq!(m2.etat, EtatMedia::EnCours);
        assert!(p2.instable && p2.nouveaux.len() == 1 && p2.prets.is_empty());
        let p3 = passage(&p2.index, &mut suivi, d.path(), chrono::Utc::now() + chrono::Duration::seconds(3), false);
        let m3 = p3.index.medias.iter().find(|m| m.ext == "wav").unwrap();
        assert_eq!(m3.etat, EtatMedia::Disponible);
        assert_eq!(p3.prets, vec![m3.id.clone()]);
        assert_eq!(p3.index.medias[0].ext, "wav", "le plus récent en premier");
    }

    #[test]
    fn telechargement_partiel_puis_termine() {
        let d = tempfile::tempdir().unwrap();
        let partiel = d.path().join("AETHRYON — Le Passage (V3.5).mp4.crdownload");
        fs::write(&partiel, vec![0u8; 1000]).unwrap();
        let mut suivi = Suivi::default();
        let t0 = chrono::Utc::now();
        let p = passage(&Index::default(), &mut suivi, d.path(), t0, false);
        assert_eq!(p.index.medias.len(), 1);
        let m = &p.index.medias[0];
        assert_eq!(m.etat, EtatMedia::EnCours);
        assert!(m.chemin.ends_with("AETHRYON — Le Passage (V3.5).mp4"));
        let id = m.id.clone();
        // Fin du téléchargement : renommage par le navigateur, même identifiant.
        let fin = d.path().join("AETHRYON — Le Passage (V3.5).mp4");
        fs::rename(&partiel, &fin).unwrap();
        vieillir(&fin);
        let p2 = passage(&p.index, &mut suivi, d.path(), t0 + chrono::Duration::seconds(2), false);
        assert_eq!(p2.index.medias.len(), 1);
        assert_eq!(p2.index.medias[0].id, id);
        assert_eq!(p2.index.medias[0].etat, EtatMedia::Disponible);
        assert_eq!(p2.prets, vec![id]);
        // Téléchargement annulé : le partiel disparaît sans laisser d'« introuvable ».
        let autre = d.path().join("annule.mp4.part");
        fs::write(&autre, b"x").unwrap();
        let p3 = passage(&p2.index, &mut suivi, d.path(), t0 + chrono::Duration::seconds(3), false);
        assert_eq!(p3.index.medias.len(), 2);
        fs::remove_file(&autre).unwrap();
        let p4 = passage(&p3.index, &mut suivi, d.path(), t0 + chrono::Duration::seconds(4), false);
        assert_eq!(p4.index.medias.len(), 1);
    }

    #[test]
    fn introuvable_garde_sept_jours_et_dossier_renomme() {
        let d = tempfile::tempdir().unwrap();
        let base = d.path().join("Vidéos AETHRYON");
        fs::create_dir_all(&base).unwrap();
        let f = base.join("a.mp3");
        fs::write(&f, b"ID3").unwrap();
        vieillir(&f);
        let mut suivi = Suivi::default();
        let t0 = chrono::Utc::now();
        let p = passage(&Index::default(), &mut suivi, &base, t0, true);
        assert_eq!(p.index.medias[0].etat, EtatMedia::Disponible);
        fs::remove_file(&f).unwrap();
        let p2 = passage(&p.index, &mut suivi, &base, t0 + chrono::Duration::hours(1), false);
        assert_eq!(p2.index.medias[0].etat, EtatMedia::Introuvable);
        let p3 = passage(&p2.index, &mut suivi, &base, t0 + chrono::Duration::days(6), false);
        assert_eq!(p3.index.medias.len(), 1, "gardé moins de 7 jours");
        let p4 = passage(&p3.index, &mut suivi, &base, t0 + chrono::Duration::days(8), false);
        assert!(p4.index.medias.is_empty(), "retiré après 7 jours");
        // Dossier renommé : tout devient introuvable (le passage le signale comme erreur de dossier).
        fs::write(&f, b"ID3").unwrap();
        vieillir(&f);
        let p5 = passage(&Index::default(), &mut suivi, &base, t0, true);
        let renomme = d.path().join("Vidéos AETHRYON (ancien)");
        fs::rename(&base, &renomme).unwrap();
        let ds = dossiers(&base);
        let (fichiers, erreurs) = lister_fichiers(&[ds[0].chemin.clone()], &[]);
        assert_eq!(erreurs.len(), 1);
        let p6 = passer(&p5.index, &mut suivi, &ds, fichiers, t0 + chrono::Duration::minutes(1), false);
        assert_eq!(p6.index.medias[0].etat, EtatMedia::Introuvable);
        // Dossier qui n'est plus surveillé : entrées retirées tout de suite.
        let p7 = passer(&p6.index, &mut suivi, &[], vec![], t0 + chrono::Duration::minutes(2), false);
        assert!(p7.index.medias.is_empty());
    }

    #[test]
    fn analyse_web_et_noms_unicode() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("Soirée 🎬 — « été ».webm");
        fs::write(&f, b"\x1aE\xdf\xa3").unwrap();
        vieillir(&f);
        let mut suivi = Suivi::default();
        let p = passage(&Index::default(), &mut suivi, d.path(), chrono::Utc::now(), true);
        let mut index = p.index;
        let m = &index.medias[0];
        assert_eq!(m.nom, "Soirée 🎬 — « été »");
        assert_eq!(m.premiere_compatible, Some(false));
        let a = a_analyser(&index, &suivi, 8);
        assert_eq!(a.len(), 1);
        let id = a[0].id.clone();
        assert!(appliquer_analyse(&mut index, &mut suivi, &id, &AnalyseWeb { duree: Some(12.0), largeur: Some(1280), hauteur: Some(720), miniature: true, echec: false }));
        let m = index.media(&id).unwrap();
        assert_eq!(m.miniature.as_deref(), Some(format!("miniatures/{id}.jpg").as_str()));
        assert_eq!((m.duree, m.largeur), (Some(12.0), Some(1280)));
        assert!(a_analyser(&index, &suivi, 8).is_empty(), "jamais deux fois");
        // Valeurs absurdes refusées.
        let mut idx2 = index.clone();
        idx2.medias[0].duree = None;
        appliquer_analyse(&mut idx2, &mut suivi, &id, &AnalyseWeb { duree: Some(f64::INFINITY), ..Default::default() });
        assert_eq!(idx2.medias[0].duree, None);
        // Forme JSON du contrat.
        let v = serde_json::to_value(&index).unwrap();
        assert_eq!(v["schema"], 1);
        let m = &v["medias"][0];
        for k in ["id", "chemin", "nom", "ext", "type", "taille", "ajouteLe", "modifieLe", "duree", "largeur", "hauteur", "ips",
                  "codecVideo", "codecAudio", "miniature", "etat", "premiereCompatible", "origine"] {
            assert!(m.get(k).is_some(), "clé {k} manquante");
        }
        assert!(m.get("erreur").is_none(), "erreur absente quand il n'y en a pas");
        assert_eq!(m["type"], "video");
        assert_eq!(m["etat"], "disponible");
        assert_eq!(m["origine"]["plateforme"], "local");
    }

    #[test]
    fn rien_ne_change_rien_n_est_reecrit() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("a.png");
        fs::write(&f, b"x").unwrap();
        vieillir(&f);
        let mut suivi = Suivi::default();
        let t = chrono::Utc::now();
        let p = passage(&Index::default(), &mut suivi, d.path(), t, true);
        assert!(p.change);
        let p2 = passage(&p.index, &mut suivi, d.path(), t + chrono::Duration::seconds(30), false);
        assert!(!p2.change);
        assert_eq!(p2.index.mis_a_jour, p.index.mis_a_jour);
    }
}

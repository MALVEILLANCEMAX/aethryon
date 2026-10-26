//! Flux (« Flow ») : le socle du glisser-déposer, sans rien de propre à Windows.
//!
//! - **Chemins accordés** ([`Accordes`]) : la règle du projet veut que l'interface ne transmette jamais un chemin libre
//!   pour lire un fichier. Exception cadrée : les fichiers EXTERNES déposés sur la fenêtre. Le cœur note lui-même les
//!   chemins que le SYSTÈME lui remet (événement de dépôt de la fenêtre, sélecteur de fichiers) ; l'interface ne peut
//!   que les renvoyer. Un chemin qui n'a pas été remis ainsi est refusé (« hors périmètre »).
//! - **Classement** ([`classer`]) de ce qui survole la fenêtre : médias de l'index (désignés par identifiant),
//!   fichiers externes importables, dossiers (l'interface propose « Surveiller ce dossier », sans copie), refus motivés.
//! - **Import** ([`importer`]) : COPIE (jamais de déplacement) dans le dossier des médias, nom propre et unique
//!   ([`noms::nettoyer_nom_fichier`]), écriture atomique (`<nom final>.part`, puis renommage SANS écrasement),
//!   progression, annulation, refus clairs (type, taille, place, droits), aucun doublon (« déjà là »). Pendant la copie,
//!   la bibliothèque montre le média « en cours » (un `.part` est un fichier partiel pour l'index, sous le chemin final) ;
//!   il devient « disponible » après le renommage, comme tout fichier arrivé dans le dossier.
//!
//! Le glisser natif vers l'extérieur (Premiere Pro, Explorateur) part d'identifiants d'index que le service résout et
//! valide (`Service::chemins_pour_glisser`) ; le code OLE vit dans `src-tauri/src/glisser.rs` (Windows seulement).

use crate::bibliotheque::{self, EtatMedia, Index, TypeMedia};
use crate::noms;
use serde::Serialize;
use std::collections::{HashSet, VecDeque};
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

pub const GIO: u64 = 1024 * 1024 * 1024;
/// Plafond d'UN fichier copié (16 Go). Au-delà, une copie occupe le disque pour rien : AETHRYON conseille de
/// surveiller le dossier du fichier (aucune copie). Les médias visés (téléchargements, extraits, rushes courts) restent
/// très en dessous : 10 min de 4K H.264 à 100 Mbit/s ≈ 7,5 Go.
pub const PLAFOND_FICHIER: u64 = 16 * GIO;
/// Plafond d'un dépôt entier (64 Go) : les fichiers suivants sont refusés, sans rien copier à moitié.
pub const PLAFOND_LOT: u64 = 64 * GIO;
/// Place laissée libre sur le disque du dossier des médias APRÈS la copie (2 Go) : Windows et les téléchargements
/// en cours en ont besoin.
pub const MARGE_DISQUE: u64 = 2 * GIO;
/// Fichiers par dépôt (même limite que l'import vers Premiere Pro).
pub const FICHIERS_PAR_LOT: usize = 200;
/// Éléments examinés par dépôt ou survol (au-delà : refus global, rien n'est lu).
pub const CHEMINS_MAX: usize = 1000;
/// Médias glissés en une fois vers une autre application.
pub const GLISSER_MAX: usize = 200;
/// Validité d'un accord (dépôt, sélecteur, survol).
pub const DUREE_ACCORD: Duration = Duration::from_secs(600);
/// Accords gardés en mémoire (les plus anciens tombent).
pub const ACCORDS_MAX: usize = 16;
/// Médias de même taille comparés octet par octet pour reconnaître un doublon.
pub const CANDIDATS_MAX: usize = 4;
const TAMPON: usize = 1024 * 1024;
/// Intervalle minimal entre deux avis de progression.
pub const PAS_PROGRESSION: Duration = Duration::from_millis(100);

// ---- Chemins accordés par le système ----------------------------------------------------------------------------------

/// D'où vient un chemin remis par le système.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Origine {
    /// Survol de la fenêtre (événement « enter ») : permet le classement, PAS l'import.
    Survol,
    /// Dépôt sur la fenêtre (événement « drop ») : permet le classement et l'import.
    Depot,
    /// Sélecteur de fichiers du système (« Ajouter des fichiers… ») : permet le classement et l'import.
    Selecteur,
}

struct Accord {
    origine: Origine,
    le: Instant,
    chemins: HashSet<String>,
}

/// Registre des chemins remis par le système (en mémoire, jamais écrit sur le disque).
#[derive(Default)]
pub struct Accordes {
    accords: VecDeque<Accord>,
}

impl Accordes {
    /// Note les chemins d'un événement du système. Un survol remplace le survol précédent.
    pub fn accorder<S: AsRef<str>>(&mut self, origine: Origine, chemins: &[S], maintenant: Instant) {
        self.accords.retain(|a| maintenant.saturating_duration_since(a.le) < DUREE_ACCORD && !(origine == Origine::Survol && a.origine == Origine::Survol));
        let chemins: HashSet<String> = chemins.iter().take(CHEMINS_MAX).map(|c| noms::normaliser_pour_id(c.as_ref())).collect();
        if chemins.is_empty() {
            return;
        }
        self.accords.push_back(Accord { origine, le: maintenant, chemins });
        while self.accords.len() > ACCORDS_MAX {
            self.accords.pop_front();
        }
    }

    /// Vrai si `chemin` a été remis par le système depuis moins de [`DUREE_ACCORD`]. Pour un import, seul un dépôt ou le
    /// sélecteur compte ; pour un classement, un survol suffit.
    pub fn accorde(&self, chemin: &str, pour_import: bool, maintenant: Instant) -> bool {
        let n = noms::normaliser_pour_id(chemin);
        self.accords.iter().any(|a| {
            maintenant.saturating_duration_since(a.le) < DUREE_ACCORD && (!pour_import || a.origine != Origine::Survol) && a.chemins.contains(&n)
        })
    }
}

// ---- Classement --------------------------------------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FichierExterne {
    pub chemin: String,
    pub nom: String,
    pub taille: u64,
    #[serde(rename = "type")]
    pub type_media: TypeMedia,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DossierExterne {
    pub chemin: String,
    pub nom: String,
    /// Déjà surveillé (lui-même ou un dossier parent).
    pub surveille: bool,
    /// « Surveiller ce dossier » est possible (ni racine d'un disque, ni dossier système, ni déjà surveillé).
    pub surveillable: bool,
    pub raison: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Refus {
    pub chemin: String,
    pub nom: String,
    pub raison: String,
}

/// Ce que contient un survol ou un dépôt.
#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Classement {
    /// Identifiants de médias de l'index (les nôtres).
    pub medias: Vec<String>,
    pub fichiers: Vec<FichierExterne>,
    pub dossiers: Vec<DossierExterne>,
    pub refuses: Vec<Refus>,
}

/// Ce que le cœur connaît pour juger un chemin : l'index, les dossiers surveillés, la racine des échanges, et le
/// registre des chemins accordés (`autorise`).
pub struct Perimetre<'a> {
    pub index: &'a Index,
    pub surveilles: &'a [String],
    pub racine: &'a Path,
    pub autorise: &'a dyn Fn(&str) -> bool,
}

pub const RAISON_HORS_PERIMETRE: &str = "Chemin hors périmètre : seuls les fichiers déposés sur la fenêtre ou choisis dans le sélecteur de Windows sont acceptés.";
pub const RAISON_DANS_SURVEILLE: &str = "Déjà dans un dossier surveillé : il apparaît dans la bibliothèque sans copie.";

enum Nature {
    Media(String),
    Fichier(FichierExterne),
    Dossier(DossierExterne),
    DansSurveille,
    Refus(String),
}

/// Dernier élément d'un chemin (pour l'affichage), sans jamais dépasser 240 caractères.
pub fn nom_affiche(chemin: &str) -> String {
    chemin.rsplit(['\\', '/']).find(|s| !s.is_empty()).unwrap_or(chemin).chars().take(240).collect()
}

fn extension(chemin: &str) -> String {
    let nom = nom_affiche(chemin);
    match nom.rsplit_once('.') {
        Some((n, e)) if !n.is_empty() => e.to_lowercase(),
        _ => String::new(),
    }
}

/// Chemin complet, sans `..`, sans caractère nul, de longueur raisonnable.
pub fn chemin_acceptable(chemin: &str) -> bool {
    noms::est_absolu(chemin) && !chemin.split(['\\', '/']).any(|p| p == "..") && !chemin.contains('\0') && chemin.chars().count() <= 4096
}

/// Taille lisible en français (« 16 Go », « 1,5 Go », « 820 Mo »).
pub fn taille_lisible(octets: u64) -> String {
    const MO: f64 = 1024.0 * 1024.0;
    let o = octets as f64;
    if o >= GIO as f64 {
        let g = o / GIO as f64;
        if (g - g.round()).abs() < 0.05 {
            format!("{} Go", g.round() as u64)
        } else {
            format!("{:.1} Go", g).replace('.', ",")
        }
    } else if o >= MO {
        format!("{} Mo", (o / MO).round() as u64)
    } else {
        format!("{} Ko", (o / 1024.0).ceil() as u64)
    }
}

pub(crate) fn raison_io(e: &io::Error) -> &'static str {
    match e.kind() {
        io::ErrorKind::NotFound => "introuvable",
        io::ErrorKind::PermissionDenied => "accès refusé par Windows",
        io::ErrorKind::StorageFull => "disque plein",
        io::ErrorKind::AlreadyExists => "un fichier du même nom existe déjà",
        io::ErrorKind::InvalidInput | io::ErrorKind::InvalidFilename => "nom ou chemin refusé par le système",
        _ => "erreur du système de fichiers",
    }
}

fn examiner(chemin: &str, p: &Perimetre) -> Nature {
    if !chemin_acceptable(chemin) {
        return Nature::Refus("Chemin refusé : chemin complet attendu, sans « .. ».".into());
    }
    if !(p.autorise)(chemin) {
        return Nature::Refus(RAISON_HORS_PERIMETRE.into());
    }
    if noms::est_dans(chemin, &p.racine.to_string_lossy()) {
        return Nature::Refus("Fichier interne d'AETHRYON : rien à importer.".into());
    }
    let id = noms::id_media(chemin);
    if p.index.media(&id).is_some() {
        return Nature::Media(id);
    }
    let meta = match fs::symlink_metadata(chemin) {
        Ok(m) => m,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Nature::Refus("Introuvable : déplacé, renommé ou supprimé.".into()),
        Err(e) => return Nature::Refus(format!("Illisible ({}).", raison_io(&e))),
    };
    let nature = meta.file_type();
    if nature.is_symlink() {
        return Nature::Refus("Lien symbolique : déposez le fichier ou le dossier lui-même.".into());
    }
    let nom = nom_affiche(chemin);
    if nature.is_dir() {
        let surveille = p.surveilles.iter().any(|d| noms::est_dans(chemin, d));
        let (surveillable, raison) = if surveille {
            (false, Some("Déjà surveillé par AETHRYON.".to_string()))
        } else if noms::est_racine_volume(chemin) || noms::est_dossier_systeme(chemin) {
            (false, Some("Racine d'un disque ou dossier système : AETHRYON ne le surveille pas.".to_string()))
        } else {
            (true, None)
        };
        return Nature::Dossier(DossierExterne { chemin: chemin.to_string(), nom, surveille, surveillable, raison });
    }
    if !nature.is_file() {
        return Nature::Refus("Pas un fichier ordinaire.".into());
    }
    let Some(type_media) = bibliotheque::type_par_extension(&extension(chemin)) else {
        return Nature::Refus("Type non pris en charge : vidéo, audio ou image attendus.".into());
    };
    if p.surveilles.iter().any(|d| noms::est_dans(chemin, d)) {
        return Nature::DansSurveille;
    }
    if meta.len() == 0 {
        return Nature::Refus("Fichier vide.".into());
    }
    if meta.len() > PLAFOND_FICHIER {
        return Nature::Refus(format!("Trop volumineux pour une copie ({} au plus par fichier) : surveillez plutôt son dossier, sans rien copier.", taille_lisible(PLAFOND_FICHIER)));
    }
    Nature::Fichier(FichierExterne { chemin: chemin.to_string(), nom, taille: meta.len(), type_media })
}

/// Classe les chemins d'un survol ou d'un dépôt (doublons retirés, [`CHEMINS_MAX`] au plus). Ne lit que les
/// métadonnées des fichiers, jamais leur contenu.
pub fn classer<S: AsRef<str>>(chemins: &[S], p: &Perimetre) -> Classement {
    let mut c = Classement::default();
    if chemins.len() > CHEMINS_MAX {
        c.refuses.push(Refus { chemin: String::new(), nom: format!("{} éléments", chemins.len()), raison: format!("Trop d'éléments en un seul dépôt ({CHEMINS_MAX} au plus).") });
        return c;
    }
    let mut vus = HashSet::new();
    for ch in chemins {
        let ch = ch.as_ref();
        if !vus.insert(noms::normaliser_pour_id(ch)) {
            continue;
        }
        match examiner(ch, p) {
            Nature::Media(id) => c.medias.push(id),
            Nature::Fichier(f) => c.fichiers.push(f),
            Nature::Dossier(d) => c.dossiers.push(d),
            Nature::DansSurveille => c.refuses.push(Refus { chemin: ch.into(), nom: nom_affiche(ch), raison: RAISON_DANS_SURVEILLE.into() }),
            Nature::Refus(raison) => c.refuses.push(Refus { chemin: ch.into(), nom: nom_affiche(ch), raison }),
        }
    }
    c
}

// ---- Import de fichiers externes ---------------------------------------------------------------------------------------

/// Issue de l'import d'un fichier.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "etat", rename_all = "kebab-case")]
pub enum Issue {
    /// Copié dans le dossier des médias : `chemin` final, `id` d'index qu'il aura, nom du fichier créé.
    Importe { chemin: String, id: String, fichier: String },
    /// Rien copié : le même fichier (ou le même contenu) est déjà dans la bibliothèque.
    DejaLa { id: Option<String>, raison: String },
    Refuse { raison: String },
    Echec { raison: String },
    Annule,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ResultatFichier {
    /// Chemin tel que remis par le système.
    pub source: String,
    pub nom: String,
    #[serde(flatten)]
    pub issue: Issue,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progression {
    pub lot: String,
    /// Rang du fichier en cours (0…) parmi `fichiers` à copier.
    pub index: usize,
    pub fichiers: usize,
    pub nom: String,
    /// `verification` (recherche de doublon), `copie`, `termine`.
    pub etape: &'static str,
    pub fait: u64,
    pub taille: u64,
    pub fait_lot: u64,
    pub taille_lot: u64,
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Bilan {
    pub lot: String,
    pub fichiers: Vec<ResultatFichier>,
    pub importes: usize,
    pub deja_la: usize,
    pub refuses: usize,
    pub echecs: usize,
    pub annules: usize,
    /// Octets réellement copiés.
    pub octets: u64,
}

/// Où copier, et avec quelle place libre (`None` : inconnue, aucun contrôle préalable ; la copie s'arrête proprement
/// si le disque se remplit).
pub struct Cible<'a> {
    pub dossier: &'a Path,
    pub espace_libre: Option<u64>,
    pub perimetre: Perimetre<'a>,
    /// Intervalle minimal entre deux avis de progression ([`PAS_PROGRESSION`] ; zéro dans les essais).
    pub pas_progression: Duration,
}

/// Identifiant de lot fourni par l'interface (corrélation des avis de progression) : 1 à 64 caractères simples.
pub fn lot_valide(lot: &str) -> bool {
    !lot.is_empty() && lot.len() <= 64 && lot.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

struct ACopier {
    rang: usize,
    source: PathBuf,
    nom: String,
    taille: u64,
}

pub(crate) enum ErreurCopie {
    Annule,
    Echec(String),
}

/// Importe des fichiers externes dans `cible.dossier`. Chaque fichier reçoit une issue ; rien n'est déplacé ni écrasé.
pub fn importer<S: AsRef<str>>(lot: &str, chemins: &[S], cible: &Cible, annule: &AtomicBool, progression: &mut dyn FnMut(&Progression)) -> Bilan {
    let mut resultats: Vec<ResultatFichier> = Vec::with_capacity(chemins.len().min(FICHIERS_PAR_LOT + 1));
    let mut a_copier: Vec<ACopier> = Vec::new();
    if chemins.len() > FICHIERS_PAR_LOT {
        resultats.push(ResultatFichier {
            source: String::new(),
            nom: format!("{} fichiers", chemins.len()),
            issue: Issue::Refuse { raison: format!("Trop de fichiers en un seul dépôt ({FICHIERS_PAR_LOT} au plus) : rien n'a été copié.") },
        });
        return bilan(lot, resultats, 0);
    }

    // 1. Examen (métadonnées seulement) et doublons évidents.
    let mut vus = HashSet::new();
    for ch in chemins {
        let ch = ch.as_ref();
        let nom = nom_affiche(ch);
        let issue = if !vus.insert(noms::normaliser_pour_id(ch)) {
            Some(Issue::DejaLa { id: None, raison: "Déposé deux fois : copié une seule fois.".into() })
        } else {
            match examiner(ch, &cible.perimetre) {
                Nature::Media(id) => Some(Issue::DejaLa { id: Some(id), raison: "Déjà dans la bibliothèque.".into() }),
                Nature::DansSurveille => Some(Issue::DejaLa { id: None, raison: RAISON_DANS_SURVEILLE.into() }),
                Nature::Dossier(d) => Some(Issue::Refuse {
                    raison: if d.surveillable {
                        "Dossier : AETHRYON propose de le surveiller plutôt que de le copier.".into()
                    } else {
                        d.raison.unwrap_or_else(|| "Dossier : rien à copier.".into())
                    },
                }),
                Nature::Refus(raison) => Some(Issue::Refuse { raison }),
                Nature::Fichier(f) => {
                    a_copier.push(ACopier { rang: resultats.len(), source: PathBuf::from(&f.chemin), nom: f.nom.clone(), taille: f.taille });
                    None
                }
            }
        };
        // Les fichiers à copier reçoivent leur issue plus loin ; « Annulé » d'ici là.
        resultats.push(ResultatFichier { source: ch.to_string(), nom, issue: issue.unwrap_or(Issue::Annule) });
    }

    // 2. Plafond du lot, puis place disponible (dans l'ordre du dépôt ; rien n'est copié à moitié).
    let mut cumul = 0u64;
    a_copier.retain(|f| {
        if cumul + f.taille > PLAFOND_LOT {
            resultats[f.rang].issue = Issue::Refuse {
                raison: format!("Dépôt trop volumineux ({} au plus en une fois) : déposez la suite séparément, ou surveillez son dossier.", taille_lisible(PLAFOND_LOT)),
            };
            false
        } else {
            cumul += f.taille;
            true
        }
    });
    if let Some(libre) = cible.espace_libre {
        let mut cumul = 0u64;
        a_copier.retain(|f| {
            if cumul + f.taille + MARGE_DISQUE > libre {
                resultats[f.rang].issue = Issue::Refuse {
                    raison: format!(
                        "Place insuffisante sur le disque du dossier des médias : {} libres, {} nécessaires (marge de {} comprise).",
                        taille_lisible(libre),
                        taille_lisible(cumul + f.taille + MARGE_DISQUE),
                        taille_lisible(MARGE_DISQUE)
                    ),
                };
                false
            } else {
                cumul += f.taille;
                true
            }
        });
    }

    // 3. Dossier des médias.
    if !a_copier.is_empty() {
        if let Err(e) = fs::create_dir_all(cible.dossier) {
            for f in &a_copier {
                resultats[f.rang].issue = Issue::Echec { raison: format!("Dossier des médias indisponible ({}).", raison_io(&e)) };
            }
            return bilan(lot, resultats, 0);
        }
    }

    // 4. Copies, une à une.
    let taille_lot: u64 = a_copier.iter().map(|f| f.taille).sum();
    let total = a_copier.len();
    let mut fait_lot = 0u64;
    let mut octets = 0u64;
    let mut copies: Vec<(PathBuf, u64, String, String)> = Vec::new();
    let pas = cible.pas_progression;
    let mut dernier = Instant::now().checked_sub(pas).unwrap_or_else(Instant::now);
    for (k, f) in a_copier.iter().enumerate() {
        if annule.load(Ordering::SeqCst) {
            resultats[f.rang].issue = Issue::Annule;
            continue;
        }
        let mut avis = |etape: &'static str, fait: u64, fait_lot: u64, force: bool| {
            if force || dernier.elapsed() >= pas {
                dernier = Instant::now();
                progression(&Progression { lot: lot.into(), index: k, fichiers: total, nom: f.nom.clone(), etape, fait, taille: f.taille, fait_lot, taille_lot });
            }
        };
        avis("verification", 0, fait_lot, true);
        if let Some((id, raison)) = doublon(&f.source, f.taille, cible.perimetre.index, &copies, annule) {
            resultats[f.rang].issue = Issue::DejaLa { id, raison };
            fait_lot += f.taille;
            continue;
        }
        let base = fait_lot;
        match copier_un(&f.source, &f.nom, f.taille, cible.dossier, annule, &mut |fait| avis("copie", fait, base + fait, false)) {
            Ok(final_) => {
                let chemin = final_.to_string_lossy().into_owned();
                let fichier = nom_affiche(&chemin);
                let id = noms::id_media(&chemin);
                copies.push((final_, f.taille, id.clone(), fichier.clone()));
                octets += f.taille;
                resultats[f.rang].issue = Issue::Importe { chemin, id, fichier };
            }
            Err(ErreurCopie::Annule) => resultats[f.rang].issue = Issue::Annule,
            Err(ErreurCopie::Echec(raison)) => resultats[f.rang].issue = Issue::Echec { raison },
        }
        fait_lot += f.taille;
        avis("copie", f.taille, fait_lot, true);
    }
    if total > 0 {
        progression(&Progression { lot: lot.into(), index: total, fichiers: total, nom: String::new(), etape: "termine", fait: 0, taille: 0, fait_lot, taille_lot });
    }
    bilan(lot, resultats, octets)
}

fn bilan(lot: &str, fichiers: Vec<ResultatFichier>, octets: u64) -> Bilan {
    let mut b = Bilan { lot: lot.into(), octets, ..Default::default() };
    for r in &fichiers {
        match r.issue {
            Issue::Importe { .. } => b.importes += 1,
            Issue::DejaLa { .. } => b.deja_la += 1,
            Issue::Refuse { .. } => b.refuses += 1,
            Issue::Echec { .. } => b.echecs += 1,
            Issue::Annule => b.annules += 1,
        }
    }
    b.fichiers = fichiers;
    b
}

/// Doublon par contenu : un média disponible de l'index, ou un fichier copié plus tôt dans ce lot, de même taille et
/// aux octets identiques (comparaison complète : aucune empreinte, donc aucun faux positif).
fn doublon(source: &Path, taille: u64, index: &Index, copies: &[(PathBuf, u64, String, String)], annule: &AtomicBool) -> Option<(Option<String>, String)> {
    for m in index.medias.iter().filter(|m| m.taille == taille && m.etat == EtatMedia::Disponible).take(CANDIDATS_MAX) {
        if memes_octets(source, Path::new(&m.chemin), annule).unwrap_or(false) {
            return Some((Some(m.id.clone()), format!("Déjà dans la bibliothèque : « {}.{} » a exactement le même contenu.", m.nom, m.ext)));
        }
    }
    for (p, t, id, fichier) in copies.iter().filter(|c| c.1 == taille).take(CANDIDATS_MAX) {
        if *t == taille && memes_octets(source, p, annule).unwrap_or(false) {
            return Some((Some(id.clone()), format!("Même contenu que « {fichier} », copié juste avant.")));
        }
    }
    None
}

/// Vrai si les deux fichiers ont exactement les mêmes octets (s'arrête à la première différence).
pub fn memes_octets(a: &Path, b: &Path, annule: &AtomicBool) -> io::Result<bool> {
    let mut fa = fs::File::open(a)?;
    let mut fb = fs::File::open(b)?;
    if fa.metadata()?.len() != fb.metadata()?.len() {
        return Ok(false);
    }
    let mut ta = vec![0u8; TAMPON];
    let mut tb = vec![0u8; TAMPON];
    loop {
        if annule.load(Ordering::SeqCst) {
            return Ok(false);
        }
        let na = lire_plein(&mut fa, &mut ta)?;
        let nb = lire_plein(&mut fb, &mut tb)?;
        if na != nb || ta[..na] != tb[..nb] {
            return Ok(false);
        }
        if na == 0 {
            return Ok(true);
        }
    }
}

fn lire_plein(f: &mut fs::File, tampon: &mut [u8]) -> io::Result<usize> {
    let mut n = 0;
    while n < tampon.len() {
        match f.read(&mut tampon[n..]) {
            Ok(0) => break,
            Ok(k) => n += k,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
            Err(e) => return Err(e),
        }
    }
    Ok(n)
}

/// `<final>.part` : le fichier partiel que l'index montre « en cours » sous le chemin final.
pub fn chemin_partiel(final_: &Path) -> PathBuf {
    let mut s = final_.as_os_str().to_os_string();
    s.push(".part");
    PathBuf::from(s)
}

pub(crate) fn libre(final_: &Path) -> bool {
    let mut cr = final_.as_os_str().to_os_string();
    cr.push(".crdownload");
    !final_.exists() && !chemin_partiel(final_).exists() && !Path::new(&cr).exists()
}

/// Noms candidats : « Clip.mp4 », « Clip (2).mp4 », « Clip (3).mp4 »…
pub(crate) fn candidat(propre: &str, n: u32) -> String {
    if n <= 1 {
        return propre.to_string();
    }
    match propre.rsplit_once('.') {
        Some((souche, ext)) if !souche.is_empty() => format!("{souche} ({n}).{ext}"),
        _ => format!("{propre} ({n})"),
    }
}

/// Réserve un nom libre : crée `<final>.part` en exclusivité (aucune course avec un autre écrivain).
pub(crate) fn reserver(dossier: &Path, propre: &str, depuis: u32) -> Result<(PathBuf, PathBuf, fs::File, u32), ErreurCopie> {
    for n in depuis..depuis + 1000 {
        let final_ = dossier.join(candidat(propre, n));
        if final_.to_string_lossy().chars().count() + 5 > noms::CHEMIN_MAX {
            return Err(ErreurCopie::Echec("Chemin trop long pour Windows : renommez le fichier ou choisissez un dossier des médias plus court.".into()));
        }
        if !libre(&final_) {
            continue;
        }
        let part = chemin_partiel(&final_);
        match fs::OpenOptions::new().write(true).create_new(true).open(&part) {
            Ok(f) => return Ok((final_, part, f, n)),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(ErreurCopie::Echec(format!("Écriture impossible dans le dossier des médias ({}).", raison_io(&e)))),
        }
    }
    Err(ErreurCopie::Echec("Aucun nom libre dans le dossier des médias.".into()))
}

/// Copie un fichier : `<final>.part` écrit et vidé sur le disque, date de modification d'origine gardée, puis renommé
/// sans écraser. En cas d'échec ou d'annulation, le `.part` est retiré.
fn copier_un(source: &Path, nom: &str, taille: u64, dossier: &Path, annule: &AtomicBool, avance: &mut dyn FnMut(u64)) -> Result<PathBuf, ErreurCopie> {
    let propre = noms::nettoyer_nom_fichier(nom);
    let mut entree = fs::File::open(source).map_err(|e| ErreurCopie::Echec(format!("Lecture impossible ({}).", raison_io(&e))))?;
    let date = entree.metadata().and_then(|m| m.modified()).ok();
    let (mut final_, part, mut sortie, n) = reserver(dossier, &propre, 1)?;
    let resultat = (|| -> Result<(), ErreurCopie> {
        let mut tampon = vec![0u8; TAMPON];
        let mut fait = 0u64;
        loop {
            if annule.load(Ordering::SeqCst) {
                return Err(ErreurCopie::Annule);
            }
            let k = match entree.read(&mut tampon) {
                Ok(0) => break,
                Ok(k) => k,
                Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                Err(e) => return Err(ErreurCopie::Echec(format!("Lecture interrompue ({}).", raison_io(&e)))),
            };
            sortie.write_all(&tampon[..k]).map_err(|e| ErreurCopie::Echec(format!("Écriture interrompue ({}).", raison_io(&e))))?;
            fait += k as u64;
            if fait > taille {
                return Err(ErreurCopie::Echec("Le fichier a changé pendant la copie (il grandit encore) : réessayez quand il sera terminé.".into()));
            }
            avance(fait);
        }
        if fait != taille {
            return Err(ErreurCopie::Echec("Le fichier a changé pendant la copie : réessayez quand il sera terminé.".into()));
        }
        sortie.sync_all().map_err(|e| ErreurCopie::Echec(format!("Écriture non confirmée par le disque ({}).", raison_io(&e))))?;
        if let Some(d) = date {
            let _ = sortie.set_modified(d);
        }
        Ok(())
    })();
    drop(sortie);
    if let Err(e) = resultat {
        let _ = fs::remove_file(&part);
        return Err(e);
    }
    // Renommage sans écrasement ; si le nom vient d'être pris (autre écrivain), nom suivant.
    let mut essai_nom = n;
    for _ in 0..8 {
        match renommer_avec_reessais(&part, &final_) {
            Ok(()) => return Ok(final_),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                essai_nom += 1;
                final_ = loop {
                    let f = dossier.join(candidat(&propre, essai_nom));
                    if libre(&f) || essai_nom > n + 1000 {
                        break f;
                    }
                    essai_nom += 1;
                };
            }
            Err(e) => {
                let _ = fs::remove_file(&part);
                return Err(ErreurCopie::Echec(format!("Renommage final impossible ({}).", raison_io(&e))));
            }
        }
    }
    let _ = fs::remove_file(&part);
    Err(ErreurCopie::Echec("Renommage final impossible : noms occupés.".into()))
}

/// Sous Windows, un antivirus ou l'indexation peuvent tenir le fichier un instant : quelques essais espacés.
pub(crate) fn renommer_avec_reessais(de: &Path, vers: &Path) -> io::Result<()> {
    let mut derniere = None;
    for essai in 0..8u64 {
        match renommer_sans_ecraser(de, vers) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists || e.kind() == io::ErrorKind::NotFound => return Err(e),
            Err(e) => {
                derniere = Some(e);
                std::thread::sleep(Duration::from_millis(20 * (essai + 1)));
            }
        }
    }
    Err(derniere.unwrap_or_else(|| io::Error::other("renommage impossible")))
}

/// Renomme `de` en `vers` SANS JAMAIS écraser `vers` (erreur `AlreadyExists` s'il existe).
/// Windows : `MoveFileExW` sans `MOVEFILE_REPLACE_EXISTING` ; ailleurs : lien dur (échoue si la cible existe) puis
/// retrait de l'ancien nom.
#[cfg(windows)]
pub fn renommer_sans_ecraser(de: &Path, vers: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};
    let a: Vec<u16> = de.as_os_str().encode_wide().chain(Some(0)).collect();
    let b: Vec<u16> = vers.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY : deux chaînes UTF-16 terminées par zéro, vivantes pendant l'appel.
    let ok = unsafe { MoveFileExW(a.as_ptr(), b.as_ptr(), MOVEFILE_WRITE_THROUGH) };
    if ok != 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(windows))]
pub fn renommer_sans_ecraser(de: &Path, vers: &Path) -> io::Result<()> {
    match fs::hard_link(de, vers) {
        Ok(()) => fs::remove_file(de),
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => Err(e),
        Err(_) => {
            if vers.exists() {
                return Err(io::Error::from(io::ErrorKind::AlreadyExists));
            }
            fs::rename(de, vers)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bibliotheque::{DossierIndex, Media, Origine as OrigineMedia};

    fn tout_autorise(_: &str) -> bool {
        true
    }

    fn media(chemin: &Path, taille: u64) -> Media {
        let c = chemin.to_string_lossy().into_owned();
        let nom = chemin.file_stem().unwrap().to_string_lossy().into_owned();
        Media {
            id: noms::id_media(&c),
            chemin: c,
            nom,
            ext: "mp4".into(),
            type_media: TypeMedia::Video,
            taille,
            ajoute_le: "2026-10-23T10:00:00Z".into(),
            modifie_le: "2026-10-23T10:00:00Z".into(),
            duree: None,
            largeur: None,
            hauteur: None,
            ips: None,
            codec_video: None,
            codec_audio: None,
            miniature: None,
            etat: EtatMedia::Disponible,
            erreur: None,
            premiere_compatible: None,
            origine: OrigineMedia::default(),
        }
    }

    struct Banc {
        _d: tempfile::TempDir,
        racine: PathBuf,
        medias: PathBuf,
        externe: PathBuf,
        index: Index,
        surveilles: Vec<String>,
    }

    fn banc() -> Banc {
        let d = tempfile::tempdir().unwrap();
        let racine = d.path().join("Local").join("AETHRYON");
        let medias = d.path().join("Téléchargements").join("AETHRYON");
        let externe = d.path().join("Bureau — rushes");
        for x in [&racine, &medias, &externe] {
            fs::create_dir_all(x).unwrap();
        }
        let surveilles = vec![medias.to_string_lossy().into_owned()];
        let index = Index { dossiers: vec![DossierIndex { chemin: surveilles[0].clone(), principal: true }], ..Index::default() };
        Banc { racine, medias, externe, index, surveilles, _d: d }
    }

    fn importer_tout(b: &Banc, chemins: &[String], libre: Option<u64>) -> (Bilan, Vec<Progression>) {
        let mut avis = Vec::new();
        let cible = Cible {
            dossier: &b.medias,
            espace_libre: libre,
            perimetre: Perimetre { index: &b.index, surveilles: &b.surveilles, racine: &b.racine, autorise: &tout_autorise },
            pas_progression: Duration::ZERO,
        };
        let r = importer("lot-1", chemins, &cible, &AtomicBool::new(false), &mut |p| avis.push(p.clone()));
        (r, avis)
    }

    fn ecrire(p: &Path, octets: &[u8]) -> String {
        fs::write(p, octets).unwrap();
        p.to_string_lossy().into_owned()
    }

    fn noms_du_dossier(d: &Path) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(d).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        v.sort();
        v
    }

    #[test]
    fn accords_du_systeme() {
        let t = Instant::now();
        let mut a = Accordes::default();
        a.accorder(Origine::Survol, &["C:\\Rushes\\Plage.mp4"], t);
        assert!(a.accorde("c:/rushes/plage.MP4", false, t), "casse et séparateurs comme l'index");
        assert!(!a.accorde("C:\\Rushes\\Plage.mp4", true, t), "un survol ne permet pas l'import");
        a.accorder(Origine::Depot, &["C:\\Rushes\\Plage.mp4"], t);
        assert!(a.accorde("C:\\Rushes\\Plage.mp4", true, t));
        assert!(!a.accorde("C:\\Rushes\\Autre.mp4", true, t), "jamais un chemin inventé par l'interface");
        assert!(!a.accorde("C:\\Rushes\\Plage.mp4", true, t + DUREE_ACCORD + Duration::from_secs(1)), "accord expiré");
        // Un nouveau survol remplace le précédent ; les dépôts restent (16 au plus).
        a.accorder(Origine::Survol, &["D:\\x.mov"], t);
        a.accorder(Origine::Survol, &["D:\\y.mov"], t);
        assert!(!a.accorde("D:\\x.mov", false, t), "survol remplacé");
        assert!(a.accorde("D:\\y.mov", false, t) && !a.accorde("D:\\y.mov", true, t));
        assert!(a.accorde("c:\\rushes\\plage.mp4", true, t), "le dépôt reste accordé");
        for i in 0..ACCORDS_MAX + 2 {
            a.accorder(Origine::Selecteur, &[format!("E:\\{i}.wav")], t);
        }
        assert!(!a.accorde("E:\\0.wav", true, t) && a.accorde(&format!("E:\\{}.wav", ACCORDS_MAX + 1), true, t));
    }

    #[test]
    fn classement_d_un_survol() {
        let mut b = banc();
        let deja = b.medias.join("Coucher de soleil.mp4");
        ecrire(&deja, b"abc");
        b.index.medias.push(media(&deja, 3));
        let clip = ecrire(&b.externe.join("Clip nuit.MOV"), b"0123456789");
        let texte = ecrire(&b.externe.join("notes.txt"), b"x");
        let vide = ecrire(&b.externe.join("vide.mp3"), b"");
        let dossier = b.externe.join("Sous-dossier");
        fs::create_dir_all(&dossier).unwrap();
        let interne = ecrire(&b.racine.join("x.png"), b"png");
        let dans_surveille = ecrire(&b.medias.join("pas encore vu.wav"), b"wav");
        let chemins = vec![
            deja.to_string_lossy().into_owned(),
            clip.clone(),
            clip.to_uppercase(), // même fichier, autre casse : compté une fois
            texte,
            vide,
            dossier.to_string_lossy().into_owned(),
            b.medias.to_string_lossy().into_owned(),
            interne,
            dans_surveille,
            b.externe.join("absent.mp4").to_string_lossy().into_owned(),
            "relatif\\a.mp4".into(),
            format!("{}\\..\\x.mp4", b.externe.to_string_lossy()),
        ];
        let p = Perimetre { index: &b.index, surveilles: &b.surveilles, racine: &b.racine, autorise: &tout_autorise };
        let c = classer(&chemins, &p);
        assert_eq!(c.medias, vec![noms::id_media(&deja.to_string_lossy())]);
        assert_eq!(c.fichiers.len(), 1);
        assert_eq!((c.fichiers[0].nom.as_str(), c.fichiers[0].taille, c.fichiers[0].type_media), ("Clip nuit.MOV", 10, TypeMedia::Video));
        assert_eq!(c.dossiers.len(), 2);
        assert!(c.dossiers[0].surveillable && !c.dossiers[0].surveille);
        assert!(c.dossiers[1].surveille && !c.dossiers[1].surveillable, "le dossier des médias est déjà surveillé");
        let raisons: Vec<&str> = c.refuses.iter().map(|r| r.raison.as_str()).collect();
        assert_eq!(c.refuses.len(), 7, "{raisons:?}");
        assert!(raisons[0].starts_with("Type non pris en charge"));
        assert_eq!(raisons[1], "Fichier vide.");
        assert!(raisons[2].starts_with("Fichier interne d'AETHRYON"));
        assert_eq!(raisons[3], RAISON_DANS_SURVEILLE);
        assert!(raisons[4].starts_with("Introuvable"));
        assert!(raisons[5].starts_with("Chemin refusé") && raisons[6].starts_with("Chemin refusé"));
        // Hors périmètre : un chemin que le système n'a pas remis n'est même pas examiné.
        let rien = |_: &str| false;
        let p = Perimetre { index: &b.index, surveilles: &b.surveilles, racine: &b.racine, autorise: &rien };
        let c = classer(&[clip], &p);
        assert_eq!(c.refuses[0].raison, RAISON_HORS_PERIMETRE);
        assert!(c.fichiers.is_empty());
        let trop: Vec<String> = (0..CHEMINS_MAX + 1).map(|i| format!("C:\\{i}.mp4")).collect();
        assert!(classer(&trop, &Perimetre { index: &b.index, surveilles: &b.surveilles, racine: &b.racine, autorise: &tout_autorise }).refuses[0].raison.starts_with("Trop d'éléments"));
    }

    #[test]
    fn import_copie_atomique_nom_unique_et_progression() {
        let b = banc();
        let contenu: Vec<u8> = (0..(3 * TAMPON + 17)).map(|i| (i % 251) as u8).collect();
        // Windows interdit « : » et « ? » dans un nom : la source y porte des espaces superflus à nettoyer.
        let src = ecrire(&b.externe.join(if cfg!(windows) { "Clip  «Paris»   nuit .mp4" } else { "Clip: «Paris» nuit?.mp4" }), &contenu);
        // Un fichier du même nom propre existe déjà, et un téléchargement Firefox « .part » occupe le nom suivant.
        let propre = noms::nettoyer_nom_fichier(&nom_affiche(&src));
        let (souche, ext) = propre.rsplit_once('.').unwrap();
        ecrire(&b.medias.join(&propre), b"autre contenu");
        ecrire(&b.medias.join(format!("{souche} (2).{ext}.part")), b"telechargement");
        let date = std::time::SystemTime::now() - Duration::from_secs(86_400);
        fs::File::options().write(true).open(&src).unwrap().set_modified(date).unwrap();

        let (r, avis) = importer_tout(&b, &[src.clone()], Some(500 * GIO));
        assert_eq!((r.importes, r.echecs, r.refuses), (1, 0, 0), "{r:?}");
        let Issue::Importe { chemin, id, fichier } = &r.fichiers[0].issue else { panic!("{r:?}") };
        assert_eq!(fichier, &format!("{souche} (3).{ext}"), "ni écrasement, ni collision avec un .part");
        assert_eq!(id, &noms::id_media(chemin));
        assert_eq!(fs::read(chemin).unwrap(), contenu, "copie fidèle");
        assert_eq!(fs::read(&src).unwrap(), contenu, "la source reste en place (copie, jamais déplacement)");
        assert_eq!(fs::metadata(chemin).unwrap().modified().unwrap(), fs::metadata(&src).unwrap().modified().unwrap(), "date d'origine gardée");
        assert!(!noms_du_dossier(&b.medias).iter().any(|n| n == &format!("{fichier}.part")), "aucun .part laissé");
        assert_eq!(fs::read(b.medias.join(&propre)).unwrap(), b"autre contenu", "rien d'écrasé");
        assert_eq!(r.octets, contenu.len() as u64);
        // Progression : vérification, copie (bornée), fin.
        assert_eq!(avis.first().unwrap().etape, "verification");
        assert_eq!(avis.last().unwrap().etape, "termine");
        let copie: Vec<&Progression> = avis.iter().filter(|p| p.etape == "copie").collect();
        assert!(!copie.is_empty() && copie.last().unwrap().fait == contenu.len() as u64 && copie.last().unwrap().fait_lot == contenu.len() as u64);
        assert!(copie.windows(2).all(|w| w[0].fait <= w[1].fait));
    }

    #[test]
    fn import_sans_doublon() {
        let mut b = banc();
        let deja = b.medias.join("Coucher de soleil.mp4");
        ecrire(&deja, b"contenu identique");
        b.index.medias.push(media(&deja, 17));
        let meme_contenu = ecrire(&b.externe.join("copie du coucher.mp4"), b"contenu identique");
        let meme_taille = ecrire(&b.externe.join("autre.mp4"), b"contenu DIFFERENT");
        let jumeau_a = ecrire(&b.externe.join("jumeau A.wav"), b"RIFFjumeau");
        let jumeau_b = ecrire(&b.externe.join("jumeau B.wav"), b"RIFFjumeau");
        let dans_bibliotheque = deja.to_string_lossy().into_owned();
        let (r, _) = importer_tout(&b, &[meme_contenu.clone(), meme_taille.clone(), meme_contenu, jumeau_a, jumeau_b, dans_bibliotheque], None);
        let etats: Vec<&str> = r.fichiers.iter().map(|f| match f.issue { Issue::Importe { .. } => "importe", Issue::DejaLa { .. } => "deja", _ => "autre" }).collect();
        assert_eq!(etats, ["deja", "importe", "deja", "importe", "deja", "deja"], "{r:?}");
        assert!(matches!(&r.fichiers[0].issue, Issue::DejaLa { id: Some(i), raison } if *i == b.index.medias[0].id && raison.contains("même contenu")));
        assert!(matches!(&r.fichiers[2].issue, Issue::DejaLa { raison, .. } if raison.starts_with("Déposé deux fois")));
        assert!(matches!(&r.fichiers[4].issue, Issue::DejaLa { raison, .. } if raison.contains("jumeau A.wav")));
        assert!(matches!(&r.fichiers[5].issue, Issue::DejaLa { id: Some(_), .. }));
        assert_eq!((r.importes, r.deja_la), (2, 4));
        assert_eq!(noms_du_dossier(&b.medias), ["Coucher de soleil.mp4", "autre.mp4", "jumeau A.wav"]);
    }

    #[test]
    fn import_refus_clairs() {
        let b = banc();
        let texte = ecrire(&b.externe.join("lisez-moi.txt"), b"x");
        let dossier = b.externe.join("Rushes");
        fs::create_dir_all(&dossier).unwrap();
        let gros = b.externe.join("gros.mov");
        fs::File::create(&gros).unwrap().set_len(PLAFOND_FICHIER + 1).unwrap(); // fichier creux : aucune place prise
        let petit = ecrire(&b.externe.join("petit.mp3"), &[7u8; 4096]);
        let chemins = vec![texte, dossier.to_string_lossy().into_owned(), gros.to_string_lossy().into_owned(), petit.clone()];
        // Place : 4 Kio de fichier + 2 Go de marge ne tiennent pas dans 1 Go.
        let (r, _) = importer_tout(&b, &chemins, Some(GIO));
        let raisons: Vec<String> = r.fichiers.iter().map(|f| match &f.issue { Issue::Refuse { raison } => raison.clone(), x => format!("{x:?}") }).collect();
        assert!(raisons[0].starts_with("Type non pris en charge"), "{raisons:?}");
        assert!(raisons[1].contains("surveiller plutôt"));
        assert!(raisons[2].starts_with("Trop volumineux") && raisons[2].contains("16 Go"));
        assert!(raisons[3].starts_with("Place insuffisante") && raisons[3].contains("1 Go libres"));
        assert_eq!(r.refuses, 4);
        assert!(noms_du_dossier(&b.medias).is_empty(), "rien n'est copié");
        // Trop de fichiers : refus global, rien d'examiné.
        let trop: Vec<String> = (0..FICHIERS_PAR_LOT + 1).map(|_| petit.clone()).collect();
        let (r, _) = importer_tout(&b, &trop, None);
        assert_eq!((r.fichiers.len(), r.refuses), (1, 1));
        // Hors périmètre : refusé sans être lu.
        let rien = |_: &str| false;
        let cible = Cible { dossier: &b.medias, espace_libre: None, perimetre: Perimetre { index: &b.index, surveilles: &b.surveilles, racine: &b.racine, autorise: &rien }, pas_progression: Duration::ZERO };
        let r = importer("lot-2", &[petit], &cible, &AtomicBool::new(false), &mut |_| {});
        assert!(matches!(&r.fichiers[0].issue, Issue::Refuse { raison } if raison == RAISON_HORS_PERIMETRE));
        assert!(noms_du_dossier(&b.medias).is_empty());
    }

    #[test]
    fn dossier_des_medias_refuse() {
        let b = banc();
        let src = ecrire(&b.externe.join("a.mp4"), b"video");
        // Le « dossier des médias » est un fichier : impossible d'y écrire.
        let faux = b.externe.join("pas-un-dossier");
        fs::write(&faux, b"x").unwrap();
        let cible = Cible { dossier: &faux, espace_libre: None, perimetre: Perimetre { index: &b.index, surveilles: &b.surveilles, racine: &b.racine, autorise: &tout_autorise }, pas_progression: Duration::ZERO };
        let r = importer("lot-3", &[src], &cible, &AtomicBool::new(false), &mut |_| {});
        assert!(matches!(&r.fichiers[0].issue, Issue::Echec { raison } if raison.starts_with("Dossier des médias indisponible")), "{r:?}");
        assert_eq!(r.echecs, 1);
    }

    #[test]
    fn annulation_retire_le_partiel() {
        let b = banc();
        let a = ecrire(&b.externe.join("long.mp4"), &vec![1u8; 3 * TAMPON]);
        let c = ecrire(&b.externe.join("suivant.mp4"), b"x");
        let annule = AtomicBool::new(false);
        let cible = Cible { dossier: &b.medias, espace_libre: None, perimetre: Perimetre { index: &b.index, surveilles: &b.surveilles, racine: &b.racine, autorise: &tout_autorise }, pas_progression: Duration::ZERO };
        let r = importer("lot-4", &[a, c], &cible, &annule, &mut |p| {
            if p.etape == "copie" && p.fait >= TAMPON as u64 {
                annule.store(true, Ordering::SeqCst);
            }
        });
        assert_eq!((r.annules, r.importes), (2, 0), "{r:?}");
        assert!(noms_du_dossier(&b.medias).is_empty(), "le .part est retiré : {:?}", noms_du_dossier(&b.medias));
    }

    #[test]
    fn le_partiel_apparait_en_cours_sous_le_nom_final() {
        // Pendant la copie, l'index voit « <final>.part » : entrée « en cours » sous l'identifiant du fichier final.
        let b = banc();
        let final_ = b.medias.join("Clip.mp4");
        fs::write(chemin_partiel(&final_), b"debut").unwrap();
        let (f, e) = bibliotheque::lister_fichiers(&b.surveilles, &[]);
        assert!(e.is_empty());
        assert_eq!(f.len(), 1);
        assert!(f[0].partiel);
        assert_eq!(noms::id_media(&f[0].final_txt), noms::id_media(&final_.to_string_lossy()));
    }

    #[test]
    fn renommage_sans_ecrasement() {
        let d = tempfile::tempdir().unwrap();
        let a = d.path().join("a.part");
        let b = d.path().join("b.mp4");
        fs::write(&a, b"nouveau").unwrap();
        fs::write(&b, b"ancien").unwrap();
        assert_eq!(renommer_sans_ecraser(&a, &b).unwrap_err().kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(&b).unwrap(), b"ancien");
        let c = d.path().join("c.mp4");
        renommer_sans_ecraser(&a, &c).unwrap();
        assert!(!a.exists() && fs::read(&c).unwrap() == b"nouveau");
    }

    #[test]
    fn utilitaires() {
        assert_eq!(taille_lisible(16 * GIO), "16 Go");
        assert_eq!(taille_lisible(3 * GIO / 2), "1,5 Go");
        assert_eq!(taille_lisible(5 * 1024 * 1024), "5 Mo");
        assert!(lot_valide("import-1729-3") && !lot_valide("../x") && !lot_valide("") && !lot_valide(&"a".repeat(65)));
        assert_eq!(candidat("Clip.mp4", 3), "Clip (3).mp4");
        assert_eq!(candidat("Clip", 2), "Clip (2)");
        assert_eq!(nom_affiche("C:\\a\\b\\Clip.mp4"), "Clip.mp4");
        assert_eq!(nom_affiche("D:\\Rushes\\"), "Rushes");
        assert!(chemin_acceptable("C:\\a.mp4") && !chemin_acceptable("a.mp4") && !chemin_acceptable("C:\\a\\..\\b.mp4"));
    }
}

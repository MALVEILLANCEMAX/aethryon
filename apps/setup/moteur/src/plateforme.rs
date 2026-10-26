//! Ce que le moteur demande au système, derrière trois traits :
//! - `Fs` : fichiers et dossiers (implémentation réelle `FsReel` sur `std::fs`, factice en mémoire pour les essais) ;
//! - `Registre` : écriture **seulement dans HKCU** (aucun droit d'administrateur), lecture HKCU et HKLM ;
//! - `Systeme` : version d'un exe, processus, raccourcis, lancement, espace libre.
//!
//! `Emplacements` réunit les dossiers de l'utilisateur ; tout le reste en découle.

use serde::Serialize;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TypeEntree {
    Fichier,
    Dossier,
    /// Lien symbolique ou point d'analyse : jamais suivi, jamais écrit (problème connu de novembre 2024).
    Lien,
}

pub trait Fs: Send + Sync {
    fn lire(&self, p: &Path) -> io::Result<Vec<u8>>;
    /// Écrit le fichier par blocs et appelle `avance(octets)` après chaque bloc (progression réelle).
    fn ecrire(&self, p: &Path, donnees: &[u8], avance: &mut dyn FnMut(u64)) -> io::Result<()>;
    fn creer_dossiers(&self, p: &Path) -> io::Result<()>;
    fn type_de(&self, p: &Path) -> Option<TypeEntree>;
    fn supprimer_fichier(&self, p: &Path) -> io::Result<()>;
    /// Supprime un dossier et son contenu, sans jamais suivre un lien (un lien est retiré, pas sa cible).
    fn supprimer_arbre(&self, p: &Path) -> io::Result<()>;
    fn renommer(&self, de: &Path, vers: &Path) -> io::Result<()>;
    /// Noms des entrées directes, triés.
    fn lister(&self, p: &Path) -> io::Result<Vec<String>>;
    fn taille(&self, p: &Path) -> io::Result<u64>;

    fn existe(&self, p: &Path) -> bool {
        self.type_de(p).is_some()
    }
    fn est_fichier(&self, p: &Path) -> bool {
        self.type_de(p) == Some(TypeEntree::Fichier)
    }
    fn est_dossier(&self, p: &Path) -> bool {
        self.type_de(p) == Some(TypeEntree::Dossier)
    }
    fn ecrire_tout(&self, p: &Path, donnees: &[u8]) -> io::Result<()> {
        self.ecrire(p, donnees, &mut |_| {})
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Racine {
    Hkcu,
    Hklm,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum Valeur {
    Chaine(String),
    Dword(u32),
}

impl Valeur {
    pub fn chaine(&self) -> Option<&str> {
        match self {
            Valeur::Chaine(s) => Some(s),
            Valeur::Dword(_) => None,
        }
    }
    pub fn dword(&self) -> Option<u32> {
        match self {
            Valeur::Dword(d) => Some(*d),
            Valeur::Chaine(_) => None,
        }
    }
}

pub trait Registre: Send + Sync {
    fn lire(&self, racine: Racine, cle: &str, nom: &str) -> Option<Valeur>;
    fn sous_cles(&self, racine: Racine, cle: &str) -> Vec<String>;
    /// Toutes les valeurs d'une clé de HKCU (`None` si la clé n'existe pas).
    fn valeurs(&self, cle: &str) -> Option<Vec<(String, Valeur)>>;
    /// Écrit dans HKCU (crée la clé au besoin).
    fn ecrire(&self, cle: &str, nom: &str, v: &Valeur) -> io::Result<()>;
    fn supprimer_valeur(&self, cle: &str, nom: &str) -> io::Result<()>;
    /// Supprime une clé de HKCU et ses sous-clés (sans erreur si elle n'existe pas).
    fn supprimer_cle(&self, cle: &str) -> io::Result<()>;

    fn chaine(&self, racine: Racine, cle: &str, nom: &str) -> Option<String> {
        self.lire(racine, cle, nom).and_then(|v| v.chaine().map(str::to_string))
    }
    fn cle_existe(&self, cle: &str) -> bool {
        self.valeurs(cle).is_some()
    }
}

pub trait Systeme: Send + Sync {
    /// Version de fichier (VS_FIXEDFILEINFO), par exemple `26.5.2.13` ; `None` si illisible (jamais supposée).
    fn version_fichier(&self, exe: &Path) -> Option<String>;
    fn processus_present(&self, nom_exe: &str) -> bool;
    /// Termine les processus de ce nom appartenant à l'utilisateur ; renvoie leur nombre.
    fn fermer_processus(&self, nom_exe: &str) -> usize;
    fn creer_raccourci(&self, lnk: &Path, cible: &Path, arguments: &str, description: &str) -> Result<(), String>;
    fn lancer(&self, exe: &Path, arguments: &[String]) -> Result<(), String>;
    fn espace_libre(&self, p: &Path) -> Option<u64>;
}

/// Dossiers de l'utilisateur courant et de Windows.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Emplacements {
    /// `%LOCALAPPDATA%`
    pub local: PathBuf,
    /// `%APPDATA%` (itinérant)
    pub itinerant: PathBuf,
    /// Dossier « Vidéos » de l'utilisateur
    pub videos: PathBuf,
    /// `%APPDATA%\Microsoft\Windows\Start Menu\Programs`
    pub menu_demarrer: PathBuf,
    /// `%ProgramFiles%` (et `ProgramW6432`) : lecture seule, détection de Premiere et de Creative Cloud.
    pub programmes: Vec<PathBuf>,
    /// `%CommonProgramFiles%`
    pub programmes_communs: Vec<PathBuf>,
}

impl Emplacements {
    /// `%LOCALAPPDATA%\Programs\AETHRYON`
    pub fn dossier_installation(&self) -> PathBuf {
        self.local.join("Programs").join("AETHRYON")
    }
    /// `%APPDATA%\Adobe\CEP\extensions` (dossier par utilisateur documenté par le Cookbook CEP).
    pub fn dossier_extensions_cep(&self) -> PathBuf {
        self.itinerant.join("Adobe").join("CEP").join("extensions")
    }
    pub fn dossier_extension(&self) -> PathBuf {
        self.dossier_extensions_cep().join(crate::ID_EXTENSION)
    }
    /// `%LOCALAPPDATA%\AETHRYON\journaux`
    pub fn journaux(&self) -> PathBuf {
        self.local.join("AETHRYON").join("journaux")
    }
    /// `%APPDATA%\AETHRYON` : `config.json` (contrat du Desktop et de l'extension), `desktop.json`.
    pub fn donnees_itinerantes(&self) -> PathBuf {
        self.itinerant.join("AETHRYON")
    }
    /// `%LOCALAPPDATA%\AETHRYON` : bibliothèque, échanges, journaux.
    pub fn donnees_locales(&self) -> PathBuf {
        self.local.join("AETHRYON")
    }
    pub fn raccourci(&self) -> PathBuf {
        self.menu_demarrer.join("AETHRYON.lnk")
    }
    pub fn dossier_medias_par_defaut(&self) -> PathBuf {
        self.videos.join("AETHRYON")
    }
}

/// Dossier parent, que le chemin utilise `\\` ou `/` (les chemins venant de l'utilisateur sont au format Windows, y
/// compris dans les essais sous Linux, où `Path::parent` ne reconnaît pas `\\`).
pub fn parent_de(p: &Path) -> Option<PathBuf> {
    let s = p.to_string_lossy();
    let s = s.trim_end_matches(['\\', '/']);
    let i = s.rfind(['\\', '/'])?;
    let tete = &s[..i];
    if tete.is_empty() || tete.ends_with(':') {
        // « C: » seul n'est pas un dossier que l'on crée ou retire.
        return None;
    }
    Some(PathBuf::from(tete))
}

/// Tout ce dont une opération a besoin.
#[derive(Clone)]
pub struct Environnement {
    pub fs: Arc<dyn Fs>,
    pub registre: Arc<dyn Registre>,
    pub systeme: Arc<dyn Systeme>,
    pub emplacements: Emplacements,
}

/// Fichiers réels (`std::fs`), communs à Windows et à Linux.
pub struct FsReel;

impl Fs for FsReel {
    fn lire(&self, p: &Path) -> io::Result<Vec<u8>> {
        std::fs::read(p)
    }
    fn ecrire(&self, p: &Path, donnees: &[u8], avance: &mut dyn FnMut(u64)) -> io::Result<()> {
        use std::io::Write;
        let mut f = std::fs::File::create(p)?;
        for bloc in donnees.chunks(256 * 1024) {
            f.write_all(bloc)?;
            avance(bloc.len() as u64);
        }
        f.sync_all()
    }
    fn creer_dossiers(&self, p: &Path) -> io::Result<()> {
        std::fs::create_dir_all(p)
    }
    fn type_de(&self, p: &Path) -> Option<TypeEntree> {
        let m = std::fs::symlink_metadata(p).ok()?;
        // Sous Windows, `is_symlink` vaut pour les liens ET les jonctions (« name surrogates »), pas pour les fichiers
        // OneDrive à la demande : un dossier Vidéos synchronisé reste un dossier ordinaire.
        if m.file_type().is_symlink() {
            Some(TypeEntree::Lien)
        } else if m.is_dir() {
            Some(TypeEntree::Dossier)
        } else {
            Some(TypeEntree::Fichier)
        }
    }
    fn supprimer_fichier(&self, p: &Path) -> io::Result<()> {
        match std::fs::remove_file(p) {
            Err(e) if e.kind() == io::ErrorKind::PermissionDenied => {
                // Fichier en lecture seule : on retire l'attribut puis on recommence.
                let mut perm = std::fs::metadata(p)?.permissions();
                #[allow(clippy::permissions_set_readonly_false)]
                perm.set_readonly(false);
                std::fs::set_permissions(p, perm)?;
                std::fs::remove_file(p)
            }
            r => r,
        }
    }
    fn supprimer_arbre(&self, p: &Path) -> io::Result<()> {
        // `remove_dir_all` de Rust ne suit pas les liens (CVE-2022-21658 corrigée) et retire un lien sans sa cible.
        match self.type_de(p) {
            None => Ok(()),
            Some(TypeEntree::Dossier) => std::fs::remove_dir_all(p),
            Some(TypeEntree::Lien) => std::fs::remove_dir(p).or_else(|_| std::fs::remove_file(p)),
            Some(TypeEntree::Fichier) => self.supprimer_fichier(p),
        }
    }
    fn renommer(&self, de: &Path, vers: &Path) -> io::Result<()> {
        std::fs::rename(de, vers)
    }
    fn lister(&self, p: &Path) -> io::Result<Vec<String>> {
        let mut v: Vec<String> = std::fs::read_dir(p)?.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        v.sort();
        Ok(v)
    }
    fn taille(&self, p: &Path) -> io::Result<u64> {
        Ok(std::fs::symlink_metadata(p)?.len())
    }
}

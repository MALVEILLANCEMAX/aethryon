//! Cœur portable d'AETHRYON Desktop.
//!
//! Tout ce qui peut se vérifier sans Windows vit ici et se teste par `cargo test -p aethryon-noyau` sous Linux :
//! écriture atomique, configuration, index de la bibliothèque (contrat §3), surveillance des dossiers, battements (§4),
//! file de commandes (§5), transferts (§6), hôte Native Messaging, journaux, nettoyage, assistant d'installation,
//! mises à jour en un clic (extension navigateur dans son dossier géré, setup d'AETHRYON Desktop) par HTTPS seulement,
//! socle du glisser-déposer « Flow » (chemins accordés par le système, classement, import atomique de fichiers externes),
//! liaison au compte par appairage (coffre DPAPI) et AETHRYON Cloud (envoi direct par URL présignée, téléchargement),
//! conversion d'un lien par ytapi avec la clé du compte relié (3.8.1 : « Coller un lien », relais de l'extension),
//! AETHRYON Index (scanner de médias locaux : volumes, scan natif ou par Everything, index SQLite, recherche, `index/`).
//!
//! L'intégration Windows (registre HKCU, Premiere Pro, UPIA, Explorateur, processus) passe par le trait
//! [`plateforme::Plateforme`] : l'implémentation réelle est derrière `cfg(windows)` ; ailleurs, un remplaçant portable
//! répond « non pris en charge », et les tests emploient une plateforme factice qui enregistre les opérations.
//! Contrat d'échange : `premiere-pro/C-CONTRAT-ECHANGES.md` (v1), qui fait foi.

pub mod assistant;
pub mod atomique;
pub mod battements;
pub mod bibliotheque;
pub mod chemins;
pub mod cloud;
pub mod coffre;
pub mod commandes;
pub mod compte;
pub mod config;
pub mod conversion;
pub mod desinstallation;
#[cfg(test)]
pub(crate) mod essais_http;
pub mod flux;
pub mod horloge;
pub mod index;
pub mod journal;
pub mod maj_desktop;
pub mod maj_extension;
pub mod mesure;
pub mod musique;
pub mod nettoyage;
pub mod nm;
pub mod noms;
pub mod plateforme;
pub mod reseau;
pub mod service;
pub mod surveillance;
pub mod transferts;

/// Version d'AETHRYON Desktop, écrite dans le battement (`etat/desktop.json`).
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
/// Identifiant du panneau : ExtensionBundleId de l'extension CEP v2 (et id de l'ancien panneau UXP de la bêta 1).
pub const ID_PANNEAU: &str = "fr.aethryon.premiere";
/// Nom affiché du panneau, employé par `UPIA /remove` (l'exemple d'Adobe passe un nom).
pub const NOM_PANNEAU: &str = "AETHRYON";
/// Nom de l'hôte Native Messaging (minuscules, chiffres, points).
pub const NOM_HOTE_NM: &str = "fr.aethryon.desktop";
/// Extensions autorisées (contrat §6) : production puis développement.
pub const EXTENSIONS_AUTORISEES: [&str; 2] = ["necpohicddjeaeaaomaakehcbccapabg", "dnllfjakdgmgfiompaheickmbjjlgjdc"];
/// Version minimale de Premiere Pro qui accepte un panneau UXP.
pub const PREMIERE_MIN: [u32; 3] = [25, 6, 0];
/// Version à partir de laquelle le glisser-déposer est prévu (activé seulement si la version le permet).
pub const PREMIERE_GLISSER: [u32; 3] = [27, 0, 0];

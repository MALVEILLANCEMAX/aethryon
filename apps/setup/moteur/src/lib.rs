//! Moteur d'AETHRYON Setup : installation par utilisateur (aucun droit d'administrateur), réparation, mise à jour et
//! désinstallation, avec retour arrière en cas d'échec. Toute la logique passe par les traits de `plateforme`, ce
//! qui permet de l'essayer sous Linux avec un système factice (`factice`).

pub mod charge;
pub mod config_desktop;
pub mod desinstallation;
pub mod detection;
pub mod factice;
pub mod journal;
pub mod navigateur;
pub mod operations;
pub mod plateforme;
pub mod session;
pub mod version;
#[cfg(windows)]
pub mod windows;
pub mod zxp;

use plateforme::{Environnement, Racine, Valeur};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const PRODUIT: &str = "AETHRYON";
pub const EDITEUR: &str = "AETHRYON";
pub const ID_EXTENSION: &str = "fr.aethryon.premiere";
/// Entrée « Applications installées » (HKCU) de ce setup.
pub const CLE_DESINSTALLATION: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AETHRYON";
/// Entrée de la bêta 1.0.0 (installateur NSIS), remplacée par ce setup.
pub const CLE_ANCIENNE_BETA: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AETHRYON-Desktop";
pub const CLE_RUN: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
/// Même nom de valeur que celui qu'écrit AETHRYON Desktop (Paramètres › Démarrage avec Windows).
pub const VALEUR_RUN: &str = "AETHRYON Desktop";
/// Copie du setup gardée dans le dossier d'installation : « Modifier » et « Désinstaller » de Windows la lancent.
pub const NOM_SETUP: &str = "AETHRYON-Setup.exe";
pub const NOM_INVENTAIRE: &str = "installation.json";
/// Clés Native Messaging qu'AETHRYON Desktop enregistre à son premier lancement (retirées à la désinstallation).
pub const CLES_NM: [&str; 3] = [
    "Software\\Google\\Chrome\\NativeMessagingHosts\\fr.aethryon.desktop",
    "Software\\Microsoft\\Edge\\NativeMessagingHosts\\fr.aethryon.desktop",
    "Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\fr.aethryon.desktop",
];

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum Notifications {
    Toutes,
    #[default]
    Importantes,
    Aucune,
}

/// Choix de l'écran « Configuration ».
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub extension: bool,
    pub desktop: bool,
    pub dossier_medias: String,
    pub surveillance: bool,
    pub demarrage_auto: bool,
    pub notifications: Notifications,
}

impl Options {
    pub fn par_defaut(env: &Environnement) -> Options {
        // Dossier déjà choisi dans AETHRYON Desktop (config.json) s'il existe, sinon Vidéos\AETHRYON.
        let dossier = config_desktop::dossier_medias_actuel(env).unwrap_or_else(|| env.emplacements.dossier_medias_par_defaut().to_string_lossy().into_owned());
        Options { extension: true, desktop: true, dossier_medias: dossier, surveillance: true, demarrage_auto: true, notifications: Notifications::Importantes }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FichierInstalle {
    pub chemin: String,
    pub sha256: String,
    pub taille: u64,
}

/// `installation.json`, dans le dossier d'installation : ce que ce setup a posé, pour réparer et désinstaller
/// exactement cela.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Inventaire {
    pub schema: u32,
    pub produit: String,
    pub version: String,
    pub installe_le: String,
    pub mis_a_jour_le: String,
    pub options: Options,
    pub fichiers: Vec<FichierInstalle>,
    pub version_desktop: Option<String>,
    pub version_extension: Option<String>,
    pub dossier_extension: Option<String>,
    pub raccourci: Option<String>,
    /// Extension navigateur posée dans le dossier géré (absent des inventaires 2.0.0-beta.2 et plus anciens).
    #[serde(default)]
    pub version_navigateur: Option<String>,
    #[serde(default)]
    pub dossier_navigateur: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstallationExistante {
    pub version: String,
    pub dossier: String,
    pub inventaire: Option<Inventaire>,
}

pub fn dossier_installation(env: &Environnement) -> PathBuf {
    env.registre
        .chaine(Racine::Hkcu, CLE_DESINSTALLATION, "InstallLocation")
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| env.emplacements.dossier_installation())
}

pub fn lire_inventaire(env: &Environnement, dossier: &std::path::Path) -> Option<Inventaire> {
    let d = env.fs.lire(&dossier.join(NOM_INVENTAIRE)).ok()?;
    serde_json::from_slice(&d).ok()
}

/// Installation de CE setup (clé HKCU `Uninstall\AETHRYON`), si elle existe.
pub fn installation_existante(env: &Environnement) -> Option<InstallationExistante> {
    let version = env.registre.chaine(Racine::Hkcu, CLE_DESINSTALLATION, "DisplayVersion")?;
    let dossier = dossier_installation(env);
    let inventaire = lire_inventaire(env, &dossier);
    Some(InstallationExistante { version, dossier: dossier.to_string_lossy().into_owned(), inventaire })
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Reparer,
    MettreAJour,
    Desinstaller,
}

/// Mode « maintenance » : ce que l'on peut proposer face à la version installée.
pub fn actions_possibles(installee: &str, charge: &str) -> Vec<Action> {
    use std::cmp::Ordering::*;
    match version::comparer(charge, installee) {
        Some(Greater) => vec![Action::MettreAJour, Action::Desinstaller],
        Some(Equal) => vec![Action::Reparer, Action::Desinstaller],
        // Version installée plus récente que ce setup, ou illisible : on ne remplace rien.
        _ => vec![Action::Desinstaller],
    }
}

/// Lecture d'une valeur de chaîne HKCU (raccourci).
pub fn hkcu(env: &Environnement, cle: &str, nom: &str) -> Option<String> {
    env.registre.lire(Racine::Hkcu, cle, nom).and_then(|v| match v {
        Valeur::Chaine(s) => Some(s),
        Valeur::Dword(d) => Some(d.to_string()),
    })
}

#[cfg(test)]
mod essais {
    use super::*;

    #[test]
    fn actions_selon_versions() {
        assert_eq!(actions_possibles("2.0.0-beta.1", "2.0.0-beta.1"), vec![Action::Reparer, Action::Desinstaller]);
        assert_eq!(actions_possibles("2.0.0-beta.1", "2.0.0"), vec![Action::MettreAJour, Action::Desinstaller]);
        assert_eq!(actions_possibles("2.1.0", "2.0.0-beta.1"), vec![Action::Desinstaller]);
        assert_eq!(actions_possibles("illisible", "2.0.0"), vec![Action::Desinstaller]);
    }
}

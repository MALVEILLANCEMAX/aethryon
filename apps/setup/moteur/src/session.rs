//! Ce que l'interface reçoit à l'ouverture : mode (installation ou maintenance), actions possibles, contenu de la
//! charge, choix par défaut et détection réelle du PC.

use crate::charge::Charge;
use crate::detection::{self, Detection};
use crate::plateforme::Environnement;
use crate::{actions_possibles, Action, Options};
use serde::Serialize;
use std::path::Path;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InfoCharge {
    pub version: String,
    pub version_desktop: Option<String>,
    pub version_extension: String,
    pub extension_remplacant: bool,
    pub taille_desktop: u64,
    pub taille_extension: u64,
    pub intervalle_premiere: String,
    pub signature: std::collections::BTreeMap<String, String>,
    /// Extension navigateur embarquée (dossier géré), si la charge en contient une.
    pub version_navigateur: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EtatInitial {
    /// `installation` ou `maintenance` (clé HKCU `Uninstall\AETHRYON` présente).
    pub mode: String,
    /// Ce que la ligne de commande demandait : `normal`, `maintenance` (« Modifier »), `desinstaller`, ou
    /// `mettreAJour` (`--mettre-a-jour`, lancé par AETHRYON Desktop : l'interface part directement sur « Mettre à jour »).
    pub demande: String,
    pub actions: Vec<Action>,
    pub charge: InfoCharge,
    pub options: Options,
    pub detection: Detection,
    pub journal: Option<String>,
}

pub fn info_charge(c: &Charge) -> InfoCharge {
    let m = &c.manifeste;
    InfoCharge {
        version: m.version.clone(),
        version_desktop: m.desktop.as_ref().map(|d| d.version.clone()),
        version_extension: m.extension.version.clone(),
        extension_remplacant: m.extension.remplacant,
        taille_desktop: m.desktop.as_ref().map(|d| d.fichiers.iter().map(|f| f.taille).sum()).unwrap_or(0),
        taille_extension: m.extension.fichier.taille,
        intervalle_premiere: m.extension.hote_ppro.clone(),
        signature: m.extension.signature.clone(),
        version_navigateur: m.navigateur.as_ref().map(|n| n.version.clone()),
    }
}

pub fn etat_initial(env: &Environnement, c: &Charge, demande: &str, exe_manuel: Option<&Path>, journal: Option<String>) -> EtatInitial {
    let detection = detection::detecter(env, &c.manifeste.extension.hote_ppro, exe_manuel);
    let (mode, actions) = match &detection.installation {
        Some(i) => ("maintenance", actions_possibles(&i.version, &c.manifeste.version)),
        None => ("installation", vec![]),
    };
    let mut options = detection.installation.as_ref().and_then(|i| i.inventaire.as_ref()).map(|i| i.options.clone()).unwrap_or_else(|| Options::par_defaut(env));
    if detection.installation.is_some() {
        // Maintenance : les réglages changés depuis dans AETHRYON Desktop (config.json) priment sur l'inventaire.
        crate::config_desktop::appliquer_preferences(env, &mut options);
    }
    options.extension = true;
    if c.manifeste.desktop.is_none() {
        options.desktop = false;
    }
    EtatInitial { mode: mode.into(), demande: demande.into(), actions, charge: info_charge(c), options, detection, journal }
}

//! Extension NAVIGATEUR (Chrome, Edge, Brave) dans le DOSSIER GÉRÉ `%LOCALAPPDATA%\AETHRYON\extension`, le même
//! qu'AETHRYON Desktop met à jour en un clic (desktop/noyau/src/maj_extension.rs). Le setup y pose l'archive de
//! production embarquée dans sa charge (`charge.json` › `navigateur`), vérifiée par la crate partagée
//! `aethryon-archive-extension` : ni chemin absolu, ni `..`, ni lien symbolique, identifiant de production exigé.
//! Chrome ne peut pas être piloté : l'utilisateur charge ce dossier UNE fois (« Charger l'extension non empaquetée ») ;
//! ensuite, chaque mise à jour remplace son contenu et l'extension se recharge d'elle-même.

use crate::plateforme::{Environnement, Fs, TypeEntree};
use aethryon_archive_extension::{self as archive, Archive};
use std::path::{Path, PathBuf};

pub use aethryon_archive_extension::ID_PRODUCTION;

/// `%LOCALAPPDATA%\AETHRYON\extension`
pub fn dossier(env: &Environnement) -> PathBuf {
    env.emplacements.donnees_locales().join("extension")
}
/// `%LOCALAPPDATA%\AETHRYON\extension-precedente` (version gardée pour le retour arrière).
pub fn precedente(env: &Environnement) -> PathBuf {
    env.emplacements.donnees_locales().join("extension-precedente")
}
/// Noms des dossiers que l'extension navigateur occupe dans `%LOCALAPPDATA%\AETHRYON` (désinstallation).
pub fn est_dossier_navigateur(nom: &str) -> bool {
    let n = nom.to_ascii_lowercase();
    n == "extension" || n == "extension-precedente"
}
/// Dossiers de travail (préparation, abandon, sauvegarde d'un setup ou du Desktop interrompu).
pub fn est_dossier_de_travail(nom: &str) -> bool {
    let n = nom.to_ascii_lowercase();
    ["extension-preparation-", "extension-abandon-", "extension-retour-arriere-"].iter().any(|p| n.starts_with(p))
}

/// Version lue dans `manifest.json` du dossier (nom AETHRYON exigé).
pub fn version_en_place(fs: &dyn Fs, d: &Path) -> Option<String> {
    let m: serde_json::Value = serde_json::from_slice(&fs.lire(&d.join("manifest.json")).ok()?).ok()?;
    if m.get("name").and_then(|n| n.as_str()) != Some("AETHRYON") {
        return None;
    }
    m.get("version").and_then(|v| v.as_str()).filter(|v| archive::version_valide(v)).map(str::to_string)
}

/// Archive de la charge → archive vérifiée (contenu sûr, identifiant de production, version annoncée).
pub fn verifier(octets: &[u8], version_annoncee: &str) -> Result<Archive, String> {
    let a = archive::ouvrir_archive(octets, ID_PRODUCTION)?;
    if a.version != version_annoncee {
        return Err(format!("Extension navigateur : l'archive contient la version {}, {version_annoncee} annoncée par charge.json.", a.version));
    }
    Ok(a)
}

fn chemin(base: &Path, relatif: &str) -> PathBuf {
    relatif.split('/').fold(base.to_path_buf(), |b, x| b.join(x))
}

/// Écrit chaque fichier de l'archive sous `cible` (dossier neuf), avec la progression réelle.
pub fn extraire(fs: &dyn Fs, a: &Archive, cible: &Path, avance: &mut dyn FnMut(u64)) -> Result<(), String> {
    fs.creer_dossiers(cible).map_err(|e| format!("Préparation de l'extension navigateur impossible ({e})."))?;
    for (c, d) in &a.fichiers {
        let p = chemin(cible, c);
        if let Some(parent) = crate::plateforme::parent_de(&p) {
            fs.creer_dossiers(&parent).map_err(|e| format!("Création de {} impossible ({e}).", parent.display()))?;
        }
        fs.ecrire(&p, d, avance).map_err(|e| format!("Écriture de {c} impossible ({e})."))?;
    }
    Ok(())
}

/// Relit chaque fichier du dossier et le compare à l'archive ; aucun lien symbolique. Rend le nombre de fichiers.
pub fn verifier_dossier(fs: &dyn Fs, d: &Path, a: &Archive) -> Result<usize, String> {
    for (c, contenu) in &a.fichiers {
        let p = chemin(d, c);
        if fs.type_de(&p) != Some(TypeEntree::Fichier) || fs.lire(&p).map_err(|e| e.to_string())? != *contenu {
            return Err(format!("Extension navigateur : {c} absent ou différent de l'archive."));
        }
    }
    if version_en_place(fs, d).as_deref() != Some(a.version.as_str()) {
        return Err("Extension navigateur : manifest.json illisible après la copie.".into());
    }
    Ok(a.fichiers.len())
}

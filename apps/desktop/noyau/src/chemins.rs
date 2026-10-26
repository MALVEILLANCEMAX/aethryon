//! Emplacements du contrat §1. Sous Windows : configuration dans `%APPDATA%\AETHRYON`, racine des échanges `R` dans
//! `%LOCALAPPDATA%\AETHRYON`. Ailleurs (essais Linux) : `~/.config/aethryon` et `~/.local/share/aethryon`.

use std::io;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct Emplacements {
    /// `%APPDATA%\AETHRYON` : `config.json` (contrat) et `desktop.json` (réglages propres au Desktop).
    pub config: PathBuf,
    /// `%LOCALAPPDATA%\AETHRYON`, appelée `R` dans le contrat.
    pub racine: PathBuf,
}

impl Emplacements {
    pub fn depuis_environnement() -> Option<Self> {
        #[cfg(windows)]
        {
            let appdata = std::env::var_os("APPDATA")?;
            let local = std::env::var_os("LOCALAPPDATA")?;
            Some(Self { config: PathBuf::from(appdata).join("AETHRYON"), racine: PathBuf::from(local).join("AETHRYON") })
        }
        #[cfg(not(windows))]
        {
            if let Some(base) = std::env::var_os("AETHRYON_BASE") {
                return Some(Self::sous(Path::new(&base)));
            }
            let home = PathBuf::from(std::env::var_os("HOME")?);
            Some(Self { config: home.join(".config/aethryon"), racine: home.join(".local/share/aethryon") })
        }
    }

    /// Arborescence complète sous un dossier donné (essais).
    pub fn sous(base: &Path) -> Self {
        Self { config: base.join("Roaming").join("AETHRYON"), racine: base.join("Local").join("AETHRYON") }
    }

    pub fn config_json(&self) -> PathBuf {
        self.config.join("config.json")
    }
    /// Réglages propres au Desktop (assistant terminé, chemin manuel de Premiere) : hors contrat, jamais lu par le panneau.
    pub fn prive_json(&self) -> PathBuf {
        self.config.join("desktop.json")
    }
    pub fn bibliotheque(&self) -> PathBuf {
        self.racine.join("bibliotheque")
    }
    pub fn index_json(&self) -> PathBuf {
        self.bibliotheque().join("index.json")
    }
    /// Suivi interne du Desktop (stabilité des tailles, date de disparition) : garde `index.json` conforme au contrat.
    pub fn suivi_json(&self) -> PathBuf {
        self.bibliotheque().join("suivi-desktop.json")
    }
    pub fn miniatures(&self) -> PathBuf {
        self.bibliotheque().join("miniatures")
    }
    pub fn miniature(&self, id: &str) -> PathBuf {
        self.miniatures().join(format!("{id}.jpg"))
    }
    pub fn etat(&self) -> PathBuf {
        self.racine.join("etat")
    }
    pub fn battement_desktop(&self) -> PathBuf {
        self.etat().join("desktop.json")
    }
    pub fn battement_panneau(&self) -> PathBuf {
        self.etat().join("panneau.json")
    }
    pub fn imports_json(&self) -> PathBuf {
        self.etat().join("imports.json")
    }
    pub fn a_traiter(&self) -> PathBuf {
        self.racine.join("commandes").join("a-traiter")
    }
    pub fn traitees(&self) -> PathBuf {
        self.racine.join("commandes").join("traitees")
    }
    pub fn transferts(&self) -> PathBuf {
        self.racine.join("transferts")
    }
    pub fn journaux(&self) -> PathBuf {
        self.racine.join("journaux")
    }
    /// Copie du `.ccx` installé (UPIA garde besoin du fichier pour `/remove` par chemin).
    pub fn premiere(&self) -> PathBuf {
        self.racine.join("premiere")
    }
    /// Panneau AETHRYON v2 (extension CEP) tel qu'AETHRYON Setup l'installe :
    /// `%APPDATA%\Adobe\CEP\extensions\fr.aethryon.premiere` (dossier par utilisateur du Cookbook CEP, voisin de
    /// `config` sous `%APPDATA%`). Lu seulement : le Desktop ne l'écrit jamais.
    pub fn extension_cep(&self) -> PathBuf {
        self.config.parent().unwrap_or(&self.config).join("Adobe").join("CEP").join("extensions").join(crate::ID_PANNEAU)
    }
    /// Manifeste Native Messaging (`fr.aethryon.desktop.json`).
    pub fn nm(&self) -> PathBuf {
        self.racine.join("nm")
    }
    pub fn manifeste_nm(&self) -> PathBuf {
        self.nm().join(format!("{}.json", crate::NOM_HOTE_NM))
    }
    /// DOSSIER GÉRÉ de l'extension navigateur (`R\extension`) : chargé une seule fois dans Chrome (« Charger
    /// l'extension non empaquetée »), puis remplacé d'un bloc à chaque mise à jour (maj_extension).
    pub fn extension_geree(&self) -> PathBuf {
        self.racine.join("extension")
    }
    /// Version précédente, gardée pour le retour arrière (`R\extension-precedente`).
    pub fn extension_precedente(&self) -> PathBuf {
        self.racine.join("extension-precedente")
    }
    /// Dossier frère où la nouvelle version est préparée avant la bascule (`R\extension-preparation-<pid>`).
    pub fn extension_preparation(&self, pid: u32) -> PathBuf {
        self.racine.join(format!("extension-preparation-{pid}"))
    }

    pub fn creer_arborescence(&self) -> io::Result<()> {
        for d in [
            self.config.clone(),
            self.miniatures(),
            self.etat(),
            self.a_traiter(),
            self.traitees(),
            self.transferts(),
            self.journaux(),
        ] {
            std::fs::create_dir_all(d)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arborescence_du_contrat() {
        let d = tempfile::tempdir().unwrap();
        let e = Emplacements::sous(d.path());
        e.creer_arborescence().unwrap();
        let r = &e.racine;
        assert!(r.ends_with("AETHRYON"));
        assert_eq!(e.index_json(), r.join("bibliotheque").join("index.json"));
        assert_eq!(e.miniature("abc"), r.join("bibliotheque").join("miniatures").join("abc.jpg"));
        assert_eq!(e.battement_desktop(), r.join("etat").join("desktop.json"));
        assert_eq!(e.battement_panneau(), r.join("etat").join("panneau.json"));
        assert_eq!(e.imports_json(), r.join("etat").join("imports.json"));
        assert!(e.a_traiter().ends_with("commandes/a-traiter") || e.a_traiter().ends_with("commandes\\a-traiter"));
        assert!(e.traitees().is_dir() && e.transferts().is_dir() && e.journaux().is_dir());
        assert!(e.config_json().ends_with("config.json"));
        assert!(e.manifeste_nm().ends_with("fr.aethryon.desktop.json"));
        assert_eq!(e.extension_geree(), r.join("extension"));
        assert_eq!(e.extension_precedente(), r.join("extension-precedente"));
        assert_eq!(e.extension_preparation(7), r.join("extension-preparation-7"));
    }
}

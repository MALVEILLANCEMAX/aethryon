//! Remplaçant portable (Linux, essais) : aucune intégration Windows, chaque opération répond honnêtement qu'elle
//! n'est pas prise en charge. Permet de compiler et de tester la logique hors de Windows.

use super::*;

pub struct Autre;

const NON: &str = "Non pris en charge hors de Windows.";

impl Plateforme for Autre {
    fn nom(&self) -> &'static str {
        "autre"
    }
    fn candidats_premiere(&self) -> (Vec<(PathBuf, String)>, Vec<String>) {
        (Vec::new(), vec!["(hors Windows : aucune recherche)".into()])
    }
    fn version_fichier(&self, _exe: &Path) -> Option<String> {
        None
    }
    fn creative_cloud(&self) -> CreativeCloud {
        CreativeCloud::default()
    }
    fn processus_present(&self, _nom_exe: &str) -> Option<bool> {
        None
    }
    fn executer(&self, _exe: &Path, _args: &[String], _delai: Duration) -> Result<SortieProcessus, String> {
        Err(NON.into())
    }
    fn ouvrir(&self, chemin: &Path) -> Result<(), String> {
        std::process::Command::new("xdg-open").arg(chemin).spawn().map(|_| ()).map_err(|_| NON.into())
    }
    fn afficher_dans_explorateur(&self, chemin: &Path) -> Result<(), String> {
        self.ouvrir(chemin.parent().unwrap_or(chemin))
    }
    fn lancer(&self, exe: &Path, args: &[String]) -> Result<(), String> {
        std::process::Command::new(exe).args(args).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
    fn reg_lire(&self, _c: &str, _v: Option<&str>) -> Option<String> {
        None
    }
    fn reg_ecrire(&self, _c: &str, _v: Option<&str>, _d: &str) -> Result<(), String> {
        Err(NON.into())
    }
    fn reg_supprimer_valeur(&self, _c: &str, _v: &str) -> Result<(), String> {
        Ok(())
    }
    fn reg_supprimer_cle(&self, _c: &str) -> Result<(), String> {
        Ok(())
    }
    fn espace_libre(&self, _chemin: &Path) -> Option<u64> {
        None
    }
    fn dossier_telechargements(&self) -> Option<PathBuf> {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Downloads"))
    }
    fn terminer_autres_instances(&self) -> usize {
        0
    }
}

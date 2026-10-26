//! Plateforme factice pour les essais : registre en mémoire, fichiers déclarés, réponses d'UPIA programmées, journal
//! de chaque appel (pour vérifier les commandes exactes).

use super::*;
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Default)]
pub struct Factice {
    registre: Mutex<HashMap<(String, String), String>>,
    fichiers: Mutex<HashMap<String, Option<String>>>,
    premieres: Mutex<Vec<String>>,
    upia: Mutex<bool>,
    reponses: Mutex<HashMap<String, (i32, String)>>,
    appels: Mutex<Vec<String>>,
    pub processus: Mutex<Vec<String>>,
    pub refuser_registre: Mutex<bool>,
}

pub const UPIA_FACTICE: &str = "C:\\Program Files\\Common Files\\Adobe\\Adobe Desktop Common\\RemoteComponents\\UPI\\UnifiedPluginInstallerAgent\\UnifiedPluginInstallerAgent.exe";

impl Factice {
    pub fn ajouter_premiere(&self, exe: &str, version: Option<&str>) {
        self.premieres.lock().unwrap().push(exe.to_string());
        self.fichiers.lock().unwrap().insert(exe.to_lowercase(), version.map(String::from));
    }
    pub fn upia_present(&self) {
        *self.upia.lock().unwrap() = true;
    }
    pub fn repondre_upia(&self, commande: &str, code: i32, sortie: &str) {
        self.reponses.lock().unwrap().insert(commande.to_string(), (code, sortie.to_string()));
    }
    pub fn appels(&self) -> Vec<String> {
        self.appels.lock().unwrap().clone()
    }
    fn noter(&self, s: String) {
        self.appels.lock().unwrap().push(s);
    }
}

fn cle(c: &str, v: Option<&str>) -> (String, String) {
    (c.to_lowercase(), v.unwrap_or("").to_lowercase())
}

impl Plateforme for Factice {
    fn nom(&self) -> &'static str {
        "factice"
    }
    fn candidats_premiere(&self) -> (Vec<(PathBuf, String)>, Vec<String>) {
        (
            self.premieres.lock().unwrap().iter().map(|p| (PathBuf::from(p), "dossier".to_string())).collect(),
            vec!["C:\\Program Files\\Adobe\\Adobe Premiere Pro *".into()],
        )
    }
    fn version_fichier(&self, exe: &Path) -> Option<String> {
        self.fichiers.lock().unwrap().get(&exe.to_string_lossy().to_lowercase()).cloned().flatten()
    }
    fn existe(&self, chemin: &Path) -> bool {
        self.fichiers.lock().unwrap().contains_key(&chemin.to_string_lossy().to_lowercase()) || chemin.exists()
    }
    fn creative_cloud(&self) -> CreativeCloud {
        CreativeCloud { upia: self.upia.lock().unwrap().then(|| UPIA_FACTICE.to_string()), application: None }
    }
    fn processus_present(&self, nom_exe: &str) -> Option<bool> {
        Some(self.processus.lock().unwrap().iter().any(|p| p.eq_ignore_ascii_case(nom_exe)))
    }
    fn executer(&self, exe: &Path, args: &[String], _delai: Duration) -> Result<SortieProcessus, String> {
        self.noter(format!("EXEC {} {}", exe.display(), args.join(" ")));
        let (code, sortie) = self.reponses.lock().unwrap().get(args.first().map(String::as_str).unwrap_or("")).cloned().unwrap_or((0, String::new()));
        Ok(SortieProcessus { code: Some(code), sortie, duree_ms: 3 })
    }
    fn ouvrir(&self, chemin: &Path) -> Result<(), String> {
        self.noter(format!("OUVRIR {}", chemin.display()));
        Ok(())
    }
    fn afficher_dans_explorateur(&self, chemin: &Path) -> Result<(), String> {
        self.noter(format!("EXPLORATEUR {}", argument_explorateur(chemin)));
        Ok(())
    }
    fn lancer(&self, exe: &Path, args: &[String]) -> Result<(), String> {
        self.noter(format!("LANCER {} {}", exe.display(), args.join(" ")));
        Ok(())
    }
    fn reg_lire(&self, c: &str, v: Option<&str>) -> Option<String> {
        self.registre.lock().unwrap().get(&cle(c, v)).cloned()
    }
    fn reg_ecrire(&self, c: &str, v: Option<&str>, d: &str) -> Result<(), String> {
        if *self.refuser_registre.lock().unwrap() {
            return Err("Accès refusé (essai).".into());
        }
        self.noter(format!("REG+ HKCU\\{c} [{}] = {d}", v.unwrap_or("(défaut)")));
        self.registre.lock().unwrap().insert(cle(c, v), d.to_string());
        Ok(())
    }
    fn reg_supprimer_valeur(&self, c: &str, v: &str) -> Result<(), String> {
        self.noter(format!("REG- HKCU\\{c} [{v}]"));
        self.registre.lock().unwrap().remove(&cle(c, Some(v)));
        Ok(())
    }
    fn reg_supprimer_cle(&self, c: &str) -> Result<(), String> {
        self.noter(format!("REG- HKCU\\{c}"));
        let p = c.to_lowercase();
        self.registre.lock().unwrap().retain(|(k, _), _| *k != p);
        Ok(())
    }
    fn espace_libre(&self, _chemin: &Path) -> Option<u64> {
        Some(182_000_000_000)
    }
    fn dossier_telechargements(&self) -> Option<PathBuf> {
        None
    }
    fn terminer_autres_instances(&self) -> usize {
        self.noter("TERMINER autres instances".into());
        0
    }
}

//! Journal du setup : `%LOCALAPPDATA%\AETHRYON\journaux\setup-AAAAMMJJ.log`, une ligne horodatée (UTC) par
//! événement. Jamais de secret : on n'y écrit que des chemins, des versions et des résultats.

use crate::plateforme::Fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

/// (année, mois, jour, heure, minute, seconde) UTC depuis l'horloge du système.
pub fn maintenant() -> (i64, u32, u32, u32, u32, u32) {
    let s = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let jours = s.div_euclid(86_400);
    let r = s.rem_euclid(86_400);
    // Algorithme « civil_from_days » (H. Hinnant).
    let z = jours + 719_468;
    let ere = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let j = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let a = yoe + ere * 400 + if m <= 2 { 1 } else { 0 };
    (a, m, j, (r / 3600) as u32, ((r % 3600) / 60) as u32, (r % 60) as u32)
}

pub fn date_iso() -> String {
    let (a, m, j, h, mi, s) = maintenant();
    format!("{a:04}-{m:02}-{j:02}T{h:02}:{mi:02}:{s:02}Z")
}

pub fn date_compacte() -> String {
    let (a, m, j, ..) = maintenant();
    format!("{a:04}{m:02}{j:02}")
}

#[derive(Clone)]
pub struct Journal {
    fs: Option<Arc<dyn Fs>>,
    chemin: Option<PathBuf>,
    lignes: Arc<Mutex<Vec<String>>>,
}

impl Journal {
    /// Journal en mémoire seulement (essais).
    pub fn memoire() -> Self {
        Journal { fs: None, chemin: None, lignes: Arc::new(Mutex::new(Vec::new())) }
    }

    /// Journal écrit dans `dossier\setup-AAAAMMJJ.log` (ajouté à la suite du fichier du jour).
    pub fn fichier(fs: Arc<dyn Fs>, dossier: PathBuf) -> Self {
        let chemin = dossier.join(format!("setup-{}.log", date_compacte()));
        let mut lignes = Vec::new();
        if let Ok(d) = fs.lire(&chemin) {
            lignes.push(String::from_utf8_lossy(&d).trim_end().to_string());
        }
        let _ = fs.creer_dossiers(&dossier);
        Journal { fs: Some(fs), chemin: Some(chemin), lignes: Arc::new(Mutex::new(lignes)) }
    }

    pub fn chemin(&self) -> Option<&PathBuf> {
        self.chemin.as_ref()
    }

    fn ecrire(&self, niveau: &str, msg: &str) {
        let ligne = format!("{} {niveau:<5} {msg}", date_iso());
        let texte = {
            let mut l = self.lignes.lock().unwrap_or_else(|e| e.into_inner());
            l.push(ligne);
            // Le fichier du jour reste petit : on le réécrit en entier (pas de dépendance à un mode « ajout »).
            if l.len() > 5000 {
                let n = l.len() - 5000;
                l.drain(..n);
            }
            l.join("\r\n") + "\r\n"
        };
        if let (Some(fs), Some(c)) = (&self.fs, &self.chemin) {
            let _ = fs.ecrire_tout(c, texte.as_bytes());
        }
    }

    pub fn info(&self, msg: &str) {
        self.ecrire("INFO", msg)
    }
    pub fn avert(&self, msg: &str) {
        self.ecrire("AVERT", msg)
    }
    pub fn erreur(&self, msg: &str) {
        self.ecrire("ERR", msg)
    }

    pub fn texte(&self) -> String {
        self.lignes.lock().unwrap_or_else(|e| e.into_inner()).join("\n")
    }
}

#[cfg(test)]
mod essais {
    use super::*;

    #[test]
    fn dates() {
        let d = date_iso();
        assert_eq!(d.len(), 20);
        assert!(d.starts_with("20"));
        assert_eq!(date_compacte().len(), 8);
    }

    #[test]
    fn journal_fichier() {
        let b = crate::factice::Banc::nouveau();
        let j = Journal::fichier(b.fs.clone(), b.env.emplacements.journaux());
        j.info("Démarrage");
        j.erreur("Échec simulé");
        let t = String::from_utf8(b.fs.lire(j.chemin().unwrap()).unwrap()).unwrap();
        assert!(t.contains("INFO  Démarrage") && t.contains("ERR   Échec simulé"));
        // Un second journal du même jour reprend le fichier.
        let j2 = Journal::fichier(b.fs.clone(), b.env.emplacements.journaux());
        j2.info("Suite");
        let t = String::from_utf8(b.fs.lire(j2.chemin().unwrap()).unwrap()).unwrap();
        assert!(t.contains("Démarrage") && t.contains("Suite"));
    }
}

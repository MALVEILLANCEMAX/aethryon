//! Nettoyage au démarrage (contrat §7) : fichiers `.tmp` orphelins de plus d'une minute dans `R`, commandes traitées
//! de plus de 7 jours, miniatures sans média, journaux de plus de 14 jours. Ne touche JAMAIS aux dossiers de médias.

use crate::atomique;
use crate::bibliotheque::Index;
use crate::chemins::Emplacements;
use crate::horloge::Instant;
use crate::journal;
use std::path::Path;
use std::time::{Duration, SystemTime};

#[derive(Debug, Default, PartialEq)]
pub struct Bilan {
    pub temporaires: usize,
    pub traitees: usize,
    pub miniatures: usize,
    pub journaux: usize,
}

fn plus_vieux_que(p: &Path, limite: SystemTime) -> bool {
    std::fs::metadata(p).and_then(|m| m.modified()).map(|m| m < limite).unwrap_or(false)
}

fn temporaires(dossier: &Path, limite: SystemTime, profondeur: usize) -> usize {
    let Ok(l) = std::fs::read_dir(dossier) else { return 0 };
    let mut n = 0;
    for e in l.flatten() {
        let p = e.path();
        if p.is_dir() {
            if profondeur > 0 {
                n += temporaires(&p, limite, profondeur - 1);
            }
        } else if atomique::est_temporaire(&e.file_name().to_string_lossy()) && plus_vieux_que(&p, limite) && std::fs::remove_file(&p).is_ok() {
            n += 1;
        }
    }
    n
}

pub fn nettoyer(emp: &Emplacements, index: &Index, t: Instant) -> Bilan {
    let maintenant = SystemTime::from(t);
    let mut b = Bilan { temporaires: temporaires(&emp.racine, maintenant - Duration::from_secs(60), 3), ..Default::default() };
    b.temporaires += temporaires(&emp.config, maintenant - Duration::from_secs(60), 0);
    b.traitees = crate::commandes::nettoyer_traitees(&emp.traitees(), t);
    if let Ok(l) = std::fs::read_dir(emp.miniatures()) {
        for e in l.flatten() {
            let nom = e.file_name().to_string_lossy().into_owned();
            let Some(id) = nom.strip_suffix(".jpg") else { continue };
            if index.media(id).is_none() && std::fs::remove_file(e.path()).is_ok() {
                b.miniatures += 1;
            }
        }
    }
    if let Ok(l) = std::fs::read_dir(emp.journaux()) {
        let limite = maintenant - Duration::from_secs(journal::GARDE_JOURS as u64 * 86_400);
        for e in l.flatten() {
            if e.file_name().to_string_lossy().ends_with(".log") && plus_vieux_que(&e.path(), limite) && std::fs::remove_file(e.path()).is_ok() {
                b.journaux += 1;
            }
        }
    }
    b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nettoyage_borne_a_r() {
        let d = tempfile::tempdir().unwrap();
        let emp = Emplacements::sous(d.path());
        emp.creer_arborescence().unwrap();
        let vieux = SystemTime::now() - Duration::from_secs(30 * 86_400);
        let vieillir = |p: &Path| std::fs::File::options().write(true).open(p).unwrap().set_modified(vieux).unwrap();
        let t1 = emp.bibliotheque().join("index.json.12-1.tmp");
        std::fs::write(&t1, b"{").unwrap();
        vieillir(&t1);
        let recent = emp.etat().join("desktop.json.13-1.tmp");
        std::fs::write(&recent, b"{").unwrap();
        let orpheline = emp.miniature(&"c".repeat(40));
        std::fs::write(&orpheline, b"jpg").unwrap();
        let traitee = emp.traitees().join("20260901T000000000Z-x.json");
        std::fs::write(&traitee, b"{}").unwrap();
        vieillir(&traitee);
        let log = emp.journaux().join("desktop-2026-09-01.log");
        std::fs::write(&log, b"x").unwrap();
        vieillir(&log);
        // Un média hors de R n'est jamais touché, même nommé .tmp.
        let medias = d.path().join("Médias");
        std::fs::create_dir_all(&medias).unwrap();
        let m = medias.join("rush.tmp");
        std::fs::write(&m, b"x").unwrap();
        vieillir(&m);
        let b = nettoyer(&emp, &Index::default(), chrono::Utc::now());
        assert_eq!(b, Bilan { temporaires: 1, traitees: 1, miniatures: 1, journaux: 1 });
        assert!(recent.exists() && m.exists());
    }
}

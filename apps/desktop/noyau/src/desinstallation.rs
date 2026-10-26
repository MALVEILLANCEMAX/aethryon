//! Désinstallation des composants (`aethryon-desktop.exe --desinstaller`, appelé par le désinstalleur NSIS) :
//! autres instances arrêtées, panneau retiré par UPIA, clés Native Messaging et démarrage automatique retirés,
//! données d'AETHRYON (`R` et `%APPDATA%\AETHRYON`) supprimées. Les médias sont GARDÉS par défaut ; s'ils ne le sont
//! pas, seuls les fichiers que l'index rattache au dossier des médias principal sont supprimés (jamais ceux des autres
//! dossiers surveillés, jamais un fichier inconnu), puis le dossier s'il est vide.

use crate::atomique;
use crate::bibliotheque::{EtatMedia, Index};
use crate::chemins::Emplacements;
use crate::config;
use crate::noms;
use crate::plateforme::{self, Plateforme};
use std::path::Path;

pub fn desinstaller(p: &dyn Plateforme, emp: &Emplacements, exe: &Path, supprimer_medias: bool) -> Vec<String> {
    let mut bilan = Vec::new();
    let n = p.terminer_autres_instances();
    bilan.push(format!("Autres instances arrêtées : {n}."));

    let cc = p.creative_cloud();
    if cc.upia.is_some() {
        let ccx = emp.premiere().join("aethryon-premiere.ccx");
        let r = plateforme::upia_retirer(p, &cc, Some(&ccx));
        bilan.push(format!("Panneau Premiere Pro : {}", r.message));
    } else {
        bilan.push("Panneau Premiere Pro : Creative Cloud absent, rien à retirer par son outil.".into());
    }

    let erreurs = plateforme::retirer_nm(p, &emp.manifeste_nm());
    bilan.push(if erreurs.is_empty() { "Native Messaging : clés retirées (Chrome, Edge, Brave).".into() } else { format!("Native Messaging : {}", erreurs.join(" ; ")) });
    bilan.push(match plateforme::demarrage_auto(p, exe, false) {
        Ok(()) => "Démarrage automatique : retiré.".into(),
        Err(e) => format!("Démarrage automatique : {e}"),
    });

    let conf = config::charger(emp, "").config;
    if supprimer_medias {
        let index = atomique::lire_json::<Index>(&emp.index_json()).ok().unwrap_or_default();
        let principal = conf.dossier_medias.clone();
        let mut n = 0;
        if !principal.is_empty() && !noms::est_racine_volume(&principal) && !noms::est_dossier_systeme(&principal) {
            for m in index.medias.iter().filter(|m| m.etat != EtatMedia::Introuvable && noms::est_dans(&m.chemin, &principal)) {
                if std::fs::remove_file(&m.chemin).is_ok() {
                    n += 1;
                }
            }
            let vide = std::fs::remove_dir(&principal).is_ok();
            bilan.push(format!("Médias : {n} fichier(s) indexé(s) supprimé(s){}.", if vide { ", dossier vide retiré" } else { " ; les autres fichiers du dossier sont gardés" }));
        }
    } else if !conf.dossier_medias.is_empty() {
        bilan.push(format!("Médias : gardés dans {}.", conf.dossier_medias));
    }

    for (nom, d) in [("Données d'échange", emp.racine.clone()), ("Configuration", emp.config.clone())] {
        bilan.push(match std::fs::remove_dir_all(&d) {
            Ok(()) => format!("{nom} : supprimées ({}).", d.display()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => format!("{nom} : déjà absentes."),
            Err(e) => format!("{nom} : suppression incomplète ({}).", e.kind()),
        });
    }
    bilan
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bibliotheque::{self, DossierIndex, Suivi};
    use crate::plateforme::factice::Factice;

    fn preparer(d: &Path) -> (Emplacements, Factice, std::path::PathBuf, std::path::PathBuf) {
        let emp = Emplacements::sous(d);
        emp.creer_arborescence().unwrap();
        let medias = d.join("Téléchargements").join("AETHRYON");
        std::fs::create_dir_all(&medias).unwrap();
        let fichier = medias.join("Coucher de soleil.mp4");
        std::fs::write(&fichier, b"x").unwrap();
        let mut c = config::Config::defaut(&medias.to_string_lossy());
        c.demarrage_auto = true;
        config::enregistrer(&emp, &c).unwrap();
        let ds = vec![DossierIndex { chemin: medias.to_string_lossy().into_owned(), principal: true }];
        let (f, _) = bibliotheque::lister_fichiers(&[ds[0].chemin.clone()], &[]);
        let p = bibliotheque::passer(&Index::default(), &mut Suivi::default(), &ds, f, chrono::Utc::now(), true);
        atomique::ecrire_json(&emp.index_json(), &p.index, false).unwrap();
        let fac = Factice::default();
        fac.upia_present();
        let exe = d.join("aethryon-desktop.exe");
        plateforme::enregistrer_nm(&fac, &exe, &emp.manifeste_nm());
        plateforme::demarrage_auto(&fac, &exe, true).unwrap();
        (emp, fac, medias, fichier)
    }

    #[test]
    fn medias_gardes_par_defaut() {
        let d = tempfile::tempdir().unwrap();
        let (emp, fac, medias, fichier) = preparer(d.path());
        let bilan = desinstaller(&fac, &emp, &d.path().join("aethryon-desktop.exe"), false);
        assert!(fichier.exists() && medias.exists());
        assert!(!emp.racine.exists() && !emp.config.exists());
        assert!(plateforme::etat_nm(&fac, &emp.manifeste_nm()).iter().all(|e| !e.enregistre));
        assert!(fac.reg_lire(plateforme::CLE_RUN, Some(plateforme::VALEUR_RUN)).is_none());
        assert!(fac.appels().iter().any(|a| a.ends_with("/remove AETHRYON")));
        assert!(bilan.iter().any(|l| l.starts_with("Médias : gardés")));
    }

    #[test]
    fn medias_supprimes_seulement_s_ils_sont_indexes() {
        let d = tempfile::tempdir().unwrap();
        let (emp, fac, medias, fichier) = preparer(d.path());
        let inconnu = medias.join("notes personnelles.txt");
        std::fs::write(&inconnu, b"garder").unwrap();
        desinstaller(&fac, &emp, &d.path().join("aethryon-desktop.exe"), true);
        assert!(!fichier.exists());
        assert!(inconnu.exists(), "un fichier que l'index ne connaît pas n'est jamais supprimé");
        assert!(medias.exists());
    }
}

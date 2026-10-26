//! Essai d'AETHRYON Index sans fenêtre, pour les essais Wine du setup (`setup/essais-wine/essai-setup.sh`) : le VRAI
//! moteur (`IndexMedias::demarrer`, comme `appli.rs`), à son emplacement normal (`%APPDATA%\AETHRYON\index-medias.json`,
//! `%LOCALAPPDATA%\AETHRYON\index\`). Jamais livré : construit pour l'essai, à côté du Desktop.
//!   index-essai scanner <dossier>   règle « fils » à 3, ajoute l'exclusion « exclu-essai », scanne le dossier ;
//!   index-essai lire                ouvre l'index existant sans rien scanner ni régler.
//! Sortie : une ligne JSON {emplacement, total, video, audio, image, noms, fils, exclusions}.
use aethryon_noyau::chemins::Emplacements;
use aethryon_noyau::index::base::Requete;
use aethryon_noyau::index::reglages::{Cible, GenreCible};
use aethryon_noyau::index::volumes::VolumesSysteme;
use aethryon_noyau::index::{AvisMuet, IndexMedias};
use std::time::Duration;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let emp = Emplacements::depuis_environnement().expect("APPDATA et LOCALAPPDATA");
    let ix = IndexMedias::demarrer(&emp.config, &emp.racine, Box::new(VolumesSysteme), Box::new(AvisMuet));
    if a.get(1).map(String::as_str) == Some("scanner") {
        let d = a.get(2).expect("usage : index-essai scanner <dossier>");
        let mut exclusions = ix.reglages().exclusions;
        exclusions.push("exclu-essai".into());
        ix.modifier_reglages(&serde_json::json!({ "fils": 3, "exclusions": exclusions })).expect("réglages de l'index");
        ix.lancer_scan(Some(vec![Cible { genre: GenreCible::Dossier, chemin: d.clone() }])).expect("scan");
        assert!(ix.attendre_scan(Duration::from_secs(120)), "scan non terminé en 120 s");
    }
    let e = ix.etat();
    let p = ix.rechercher(&Requete { taille_page: 200, ..Requete::default() }).expect("recherche dans l'index");
    let mut noms: Vec<String> = p.elements.iter().map(|x| x.chemin.rsplit(['\\', '/']).next().unwrap_or_default().to_string()).collect();
    noms.sort();
    let r = ix.reglages();
    let t = &e.totaux;
    println!(
        "{}",
        serde_json::json!({ "emplacement": e.emplacement, "total": t.total, "video": t.video, "audio": t.audio, "image": t.image, "noms": noms, "fils": r.fils, "exclusions": r.exclusions })
    );
    ix.arreter();
}

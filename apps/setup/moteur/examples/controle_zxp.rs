//! Contrôle d'un ZXP signé comme le fait l'étape « Vérification » du setup (structure, Manifest signé, SHA-256 de
//! chaque fichier, aucun fichier en trop, aucun lien), ou d'un CSXS/manifest.xml seul.
//!   cargo run -p aethryon-setup-moteur --example controle_zxp -- <fichier.zxp | manifest.xml>
use aethryon_setup_moteur::zxp::{lire_manifeste_cep, PaquetZxp};

fn main() {
    let f = std::env::args().nth(1).expect("fichier");
    let d = std::fs::read(&f).expect("lecture");
    if f.ends_with(".xml") {
        match lire_manifeste_cep(&String::from_utf8_lossy(&d)) {
            Ok((id, v, h)) => println!("manifeste lisible : {id} {v}, Premiere {h:?}"),
            Err(e) => {
                println!("manifeste REFUSÉ : {e}");
                std::process::exit(1);
            }
        }
        return;
    }
    match PaquetZxp::ouvrir(&d) {
        Ok(p) => println!("ZXP accepté : {} {}, Premiere {:?}, {} références signées, horodaté : {}", p.id, p.version, p.hote_ppro, p.references.len(), p.horodate),
        Err(e) => {
            println!("ZXP REFUSÉ : {e}");
            std::process::exit(1);
        }
    }
}

// AETHRYON Desktop — point d'entrée. Un seul exécutable, trois modes :
//  - hôte Native Messaging (`--nm`, ou lancé par Chrome / Edge / Brave avec l'origine de l'extension en argument) :
//    court, sans fenêtre, n'écrit que dans `R\transferts\` (contrat §6) ;
//  - désinstallation des composants (`--desinstaller [--supprimer-medias]`), appelée par le désinstalleur NSIS ;
//  - application (fenêtre Tauri) : `--assistant` (premier lancement), `--reparer`, `--arriere-plan` (démarrage de
//    Windows, réduit dans la zone de notification).
// NON TESTÉ SOUS WINDOWS : compilé pour x86_64-pc-windows-gnu depuis Linux.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod appli;
mod commandes;
mod commandes_cloud;
mod commandes_index;
mod commandes_musique;
mod dwm;
mod glisser;
mod zone;

use aethryon_noyau::{chemins::Emplacements, desinstallation, nm, plateforme};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if nm::est_mode_nm(&args) {
        std::process::exit(mode_nm(&args));
    }
    if args.iter().any(|a| a == "--desinstaller") {
        std::process::exit(mode_desinstaller(&args));
    }
    if args.iter().any(|a| a == "--diagnostic") {
        std::process::exit(mode_diagnostic());
    }
    appli::lancer(args);
}

/// Hôte Native Messaging : messages préfixés de leur longueur sur l'entrée et la sortie standard (code dans le noyau,
/// partagé avec le banc d'intégration).
fn mode_nm(args: &[String]) -> i32 {
    nm::principal(args)
}

/// Diagnostic sans fenêtre (`aethryon-desktop.exe --diagnostic > diagnostic.json`) : détection de Premiere Pro (version
/// lue dans l'exe), Creative Cloud, Native Messaging, démarrage automatique, panneau AETHRYON (extension CEP posée par
/// AETHRYON Setup, version lue dans CSXS/manifest.xml). Ne modifie rien.
fn mode_diagnostic() -> i32 {
    let p = plateforme::systeme();
    let exe = std::env::current_exe().unwrap_or_default();
    let emp = Emplacements::depuis_environnement();
    let v = serde_json::json!({
        "version": aethryon_noyau::VERSION,
        "plateforme": p.nom(),
        "premiere": plateforme::detecter_premiere(p.as_ref(), None),
        "creativeCloud": p.creative_cloud(),
        "panneau": emp.as_ref().and_then(aethryon_noyau::assistant::detecter_panneau_cep),
        "nativeMessaging": emp.as_ref().map(|e| plateforme::etat_nm(p.as_ref(), &e.manifeste_nm())),
        "demarrageAuto": plateforme::demarrage_auto_actif(p.as_ref(), &exe),
        "desinstallation": p.reg_lire(plateforme::CLE_DESINSTALLATION, Some("DisplayVersion")),
        "telechargements": p.dossier_telechargements(),
    });
    println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default());
    0
}

/// Désinstallation des composants. Le bilan (sans secret) est écrit dans `%TEMP%\AETHRYON-desinstallation.txt`.
fn mode_desinstaller(args: &[String]) -> i32 {
    let Some(emp) = Emplacements::depuis_environnement() else { return 3 };
    let exe = std::env::current_exe().unwrap_or_default();
    let supprimer = args.iter().any(|a| a == "--supprimer-medias");
    let p = plateforme::systeme();
    let bilan = desinstallation::desinstaller(p.as_ref(), &emp, &exe, supprimer);
    let _ = std::fs::write(std::env::temp_dir().join("AETHRYON-desinstallation.txt"), bilan.join("\r\n"));
    0
}

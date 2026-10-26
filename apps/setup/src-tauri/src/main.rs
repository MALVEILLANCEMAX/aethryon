// AETHRYON Setup — interface et modes silencieux. Lancé par l'amorce (AETHRYON-Setup.exe), qui l'a extrait dans
// %TEMP% avec WebView2Loader.dll et la charge (charge.zip).
//
//   --charge <charge.zip>      charge embarquée (défaut : à côté de l'exe)
//   --amorce <setup.exe>       AETHRYON-Setup.exe d'origine (sa copie est gardée pour Modifier et Désinstaller)
//   --maintenance              ouvert par « Modifier » de Paramètres Windows
//   --mettre-a-jour            lancé par AETHRYON Desktop (« Mettre à jour ») : part directement sur la mise à jour du
//                              mode maintenance (si cette version est plus récente que celle installée)
//   --desinstaller             ouvert par « Désinstaller »
//   --animations-reduites      force le mode « mouvement réduit »
// Sans fenêtre (essais, mises à jour, QuietUninstallString) :
//   --silencieux (--installer | --reparer | --mettre-a-jour | --desinstaller) [--sans-desktop] [--sans-demarrage]
//                [--dossier-medias <dossier>] [--supprimer-medias] [--supprimer-extension-navigateur]
//                [--rapport <fichier.json>]
//   --etat <fichier.json>      écrit l'état d'ouverture (détection réelle, demande comprise) et s'arrête
// Codes de sortie : 0 succès, 1 échec (retour arrière fait), 2 usage, 3 charge illisible.
// NON TESTÉ SOUS WINDOWS : compilé pour x86_64-pc-windows-gnu depuis Linux, modes silencieux essayés sous Wine.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod appli;
mod dwm;

use aethryon_setup_moteur::charge::Charge;
use aethryon_setup_moteur::journal::Journal;
use aethryon_setup_moteur::operations::{executer, Demande, Operation};
use aethryon_setup_moteur::plateforme::Environnement;
use aethryon_setup_moteur::{desinstallation, session, Options};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

pub struct Arguments {
    pub brut: Vec<String>,
}

impl Arguments {
    /// Ce que la ligne de commande demande à l'interface : `desinstaller`, `maintenance`, `mettreAJour` ou `normal`.
    pub fn demande(&self) -> &'static str {
        if self.a("--desinstaller") {
            "desinstaller"
        } else if self.a("--mettre-a-jour") {
            "mettreAJour"
        } else if self.a("--maintenance") {
            "maintenance"
        } else {
            "normal"
        }
    }
    pub fn a(&self, n: &str) -> bool {
        self.brut.iter().any(|x| x == n)
    }
    pub fn valeur(&self, n: &str) -> Option<String> {
        self.brut.iter().position(|x| x == n).and_then(|i| self.brut.get(i + 1)).cloned()
    }
}

pub fn environnement() -> Environnement {
    #[cfg(windows)]
    {
        aethryon_setup_moteur::windows::environnement()
    }
    #[cfg(not(windows))]
    {
        panic!("AETHRYON Setup ne fonctionne que sous Windows.")
    }
}

pub fn charger(args: &Arguments) -> Result<(Charge, PathBuf), String> {
    let chemin = args.valeur("--charge").map(PathBuf::from).unwrap_or_else(|| {
        std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join("charge.zip"))).unwrap_or_else(|| PathBuf::from("charge.zip"))
    });
    let octets = std::fs::read(&chemin).map_err(|e| format!("Charge introuvable ({} : {e}).", chemin.display()))?;
    Ok((Charge::ouvrir(octets)?, chemin))
}

fn main() {
    let args = Arguments { brut: std::env::args().collect() };
    if let Some(sortie) = args.valeur("--etat") {
        std::process::exit(mode_etat(&args, &sortie));
    }
    if args.a("--silencieux") {
        std::process::exit(mode_silencieux(&args));
    }
    appli::demarrer(args);
}

fn mode_etat(args: &Arguments, sortie: &str) -> i32 {
    let env = environnement();
    let (c, _) = match charger(args) {
        Ok(x) => x,
        Err(e) => {
            eprintln!("{e}");
            return 3;
        }
    };
    let e = session::etat_initial(&env, &c, args.demande(), None, None);
    match std::fs::write(sortie, serde_json::to_vec_pretty(&e).unwrap_or_default()) {
        Ok(()) => 0,
        Err(_) => 2,
    }
}

fn mode_silencieux(args: &Arguments) -> i32 {
    let env = environnement();
    let journal = Journal::fichier(env.fs.clone(), env.emplacements.journaux());
    journal.info(&format!("Mode silencieux : {}", args.brut.iter().skip(1).cloned().collect::<Vec<_>>().join(" ")));
    let rapport = args.valeur("--rapport");
    let ecrire = |v: &serde_json::Value| {
        if let Some(r) = &rapport {
            let _ = std::fs::write(r, serde_json::to_vec_pretty(v).unwrap_or_default());
        }
    };
    if args.a("--desinstaller") {
        let av = desinstallation::desinstaller(&env, !args.a("--supprimer-medias"), !args.a("--supprimer-extension-navigateur"), &journal, &mut |_| {});
        ecrire(&serde_json::to_value(&av).unwrap_or_default());
        return if av.succes { 0 } else { 1 };
    }
    let operation = if args.a("--reparer") {
        Operation::Reparer
    } else if args.a("--mettre-a-jour") {
        Operation::MettreAJour
    } else if args.a("--installer") {
        Operation::Installer
    } else {
        journal.erreur("Mode silencieux sans opération (--installer, --reparer, --mettre-a-jour ou --desinstaller).");
        return 2;
    };
    let (c, _) = match charger(args) {
        Ok(x) => x,
        Err(e) => {
            journal.erreur(&e);
            ecrire(&serde_json::json!({ "erreur": e }));
            return 3;
        }
    };
    let etat = session::etat_initial(&env, &c, "normal", None, None);
    let mut options: Options = etat.options;
    if args.a("--sans-desktop") {
        options.desktop = false;
    }
    if args.a("--sans-demarrage") {
        options.demarrage_auto = false;
    }
    if let Some(d) = args.valeur("--dossier-medias") {
        options.dossier_medias = d;
    }
    let demande = Demande { operation, options, amorce: args.valeur("--amorce").map(PathBuf::from), annuler: Arc::new(AtomicBool::new(false)) };
    let av = executer(&env, &c, &demande, &journal, &mut |_| {});
    ecrire(&serde_json::to_value(&av).unwrap_or_default());
    if av.succes {
        0
    } else {
        1
    }
}

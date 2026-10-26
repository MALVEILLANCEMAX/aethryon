// AETHRYON-Setup.exe : UN seul fichier à télécharger. Il embarque la charge (charge.zip : interface du setup,
// AETHRYON Desktop, extension CEP signée) et :
//  1. si on le lance depuis le dossier d'installation (copie de maintenance : « Modifier », « Désinstaller »), il se
//     recopie dans %TEMP% et se relance depuis cette copie, pour que la désinstallation puisse tout retirer ;
//  2. refuse une seconde instance (mutex) et ramène la fenêtre déjà ouverte ;
//  3. vérifie la présence de WebView2 (sauf en mode silencieux) ;
//  4. extrait l'interface (vérifiée par SHA-256 contre charge.json) dans %TEMP%\AETHRYON-Setup-<pid>, la lance avec
//     la charge et attend sa fin, puis nettoie (une copie relancée s'efface après sa sortie).
// NON TESTÉ SOUS WINDOWS : essayé sous Wine (modes silencieux).
#![cfg_attr(windows, windows_subsystem = "windows")]

static CHARGE: &[u8] = include_bytes!(env!("AETHRYON_CHARGE"));

#[cfg(not(windows))]
fn main() {
    eprintln!("AETHRYON Setup ne fonctionne que sous Windows ({} octets de charge embarqués).", CHARGE.len());
    std::process::exit(2);
}

#[cfg(windows)]
fn main() {
    std::process::exit(windows_amorce::principal());
}

#[cfg(windows)]
mod windows_amorce {
    use super::CHARGE;
    use aethryon_setup_moteur::charge::Charge;
    use std::os::windows::process::CommandExt;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use windows::core::HSTRING;
    use windows::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
    use windows::Win32::System::Threading::CreateMutexW;
    use windows::Win32::UI::WindowsAndMessaging::{FindWindowW, MessageBoxW, SetForegroundWindow, ShowWindow, MB_ICONERROR, MB_ICONINFORMATION, MB_OK, SW_RESTORE};

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const TITRE: &str = "AETHRYON Setup";
    /// Titres possibles de la fenêtre de l'interface (titre natif fixé par tauri.conf.json).
    const FENETRE: &str = "Installation d'AETHRYON";
    const WEBVIEW2: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

    fn message(texte: &str, erreur: bool) {
        // SAFETY : chaînes HSTRING valides pendant l'appel.
        unsafe {
            MessageBoxW(None, &HSTRING::from(texte), &HSTRING::from(TITRE), MB_OK | if erreur { MB_ICONERROR } else { MB_ICONINFORMATION });
        }
    }

    fn webview2_present() -> bool {
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY};
        use winreg::RegKey;
        let cle = format!("SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{WEBVIEW2}");
        let lire = |k: Result<RegKey, std::io::Error>| k.ok().and_then(|k| k.get_value::<String, _>("pv").ok()).filter(|v| !v.is_empty() && v != "0.0.0.0");
        lire(RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey_with_flags(&cle, KEY_READ | KEY_WOW64_32KEY)).is_some()
            || lire(RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(&cle, KEY_READ)).is_some()
    }

    fn dans_dossier_installation(exe: &Path) -> bool {
        let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_default();
        let dossier = local.join("Programs").join("AETHRYON").to_string_lossy().to_lowercase();
        exe.parent().map(|p| p.to_string_lossy().to_lowercase() == dossier).unwrap_or(false)
    }

    /// Une copie relancée depuis %TEMP% s'efface une fois sortie (cmd attend quelques secondes, puis retire le dossier).
    fn effacement_differe(dossier: &Path) {
        let _ = Command::new("cmd.exe")
            .args(["/d", "/c", &format!("ping 127.0.0.1 -n 4 >nul & rmdir /s /q \"{}\"", dossier.display())])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }

    pub fn principal() -> i32 {
        let args: Vec<String> = std::env::args().skip(1).collect();
        let silencieux = args.iter().any(|a| a == "--silencieux" || a == "--etat");
        let exe = std::env::current_exe().unwrap_or_default();

        // 1. Copie de maintenance : se relancer depuis %TEMP%.
        if !args.iter().any(|a| a == "--relance") && dans_dossier_installation(&exe) {
            let dossier = std::env::temp_dir().join(format!("AETHRYON-Setup-relance-{}", std::process::id()));
            let copie = dossier.join("AETHRYON-Setup.exe");
            if std::fs::create_dir_all(&dossier).is_ok() && std::fs::copy(&exe, &copie).is_ok() {
                let mut a = args.clone();
                a.push("--relance".into());
                a.push("--amorce-origine".into());
                a.push(exe.display().to_string());
                if Command::new(&copie).args(&a).spawn().is_ok() {
                    return 0;
                }
            }
            if !silencieux {
                message("AETHRYON Setup n'a pas pu se préparer dans le dossier temporaire de Windows.", true);
            }
            return 6;
        }
        let relance = args.iter().any(|a| a == "--relance");
        let origine = args.iter().position(|a| a == "--amorce-origine").and_then(|i| args.get(i + 1)).map(PathBuf::from);
        let amorce = origine.clone().unwrap_or_else(|| exe.clone());

        // 2. Instance unique.
        // SAFETY : mutex nommé de session ; la poignée vit jusqu'à la fin du processus.
        let _mutex = unsafe { CreateMutexW(None, true, &HSTRING::from("Local\\AETHRYON-Setup")) };
        if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
            if !silencieux {
                // SAFETY : recherche d'une fenêtre par son titre, puis premier plan.
                unsafe {
                    if let Ok(h) = FindWindowW(None, &HSTRING::from(FENETRE)) {
                        let _ = ShowWindow(h, SW_RESTORE);
                        let _ = SetForegroundWindow(h);
                    }
                }
            }
            return 7;
        }

        // 3. Charge et WebView2.
        let charge = match Charge::ouvrir(CHARGE.to_vec()) {
            Ok(c) => c,
            Err(e) => {
                if !silencieux {
                    message(&format!("Ce fichier AETHRYON Setup est incomplet ou altéré : {e}\n\nTéléchargez-le de nouveau."), true);
                }
                return 3;
            }
        };
        if !silencieux && !webview2_present() {
            message(
                "AETHRYON a besoin de Microsoft Edge WebView2, présent d'origine sur Windows 11.\n\nIl semble absent de ce PC : installez « Microsoft Edge WebView2 Runtime » depuis le site de Microsoft, puis relancez AETHRYON Setup.\n\nRien n'a été installé ni modifié.",
                true,
            );
            return 5;
        }

        // 4. Extraction de l'interface, vérifiée.
        let travail = std::env::temp_dir().join(format!("AETHRYON-Setup-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&travail);
        if let Err(e) = std::fs::create_dir_all(&travail) {
            if !silencieux {
                message(&format!("Dossier temporaire inaccessible ({e})."), true);
            }
            return 6;
        }
        let mut ui = None;
        for f in &charge.manifeste.interface {
            let d = match charge.lire_verifie(f) {
                Ok(d) => d,
                Err(e) => {
                    if !silencieux {
                        message(&format!("Ce fichier AETHRYON Setup est altéré : {e}\n\nTéléchargez-le de nouveau."), true);
                    }
                    let _ = std::fs::remove_dir_all(&travail);
                    return 3;
                }
            };
            let cible = travail.join(&f.nom);
            if std::fs::write(&cible, &d).is_err() {
                return 6;
            }
            if f.nom.ends_with(".exe") {
                ui = Some(cible);
            }
        }
        let charge_zip = travail.join("charge.zip");
        if std::fs::write(&charge_zip, CHARGE).is_err() {
            return 6;
        }
        let Some(ui) = ui else {
            if !silencieux {
                message("Interface absente de la charge.", true);
            }
            return 3;
        };
        let mut a: Vec<String> = Vec::new();
        let mut i = 0;
        while i < args.len() {
            match args[i].as_str() {
                "--relance" => {}
                "--amorce-origine" => i += 1,
                x => a.push(x.to_string()),
            }
            i += 1;
        }
        a.extend(["--charge".into(), charge_zip.display().to_string(), "--amorce".into(), amorce.display().to_string()]);
        let code = match Command::new(&ui).args(&a).current_dir(&travail).status() {
            Ok(s) => s.code().unwrap_or(1),
            Err(e) => {
                if !silencieux {
                    message(&format!("L'interface d'AETHRYON Setup ne démarre pas ({e})."), true);
                }
                4
            }
        };
        // Nettoyage : l'interface est fermée, ses fichiers sont libres.
        for _ in 0..10 {
            if std::fs::remove_dir_all(&travail).is_ok() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
        if relance {
            if let Some(d) = exe.parent() {
                effacement_differe(d);
            }
        }
        code
    }
}

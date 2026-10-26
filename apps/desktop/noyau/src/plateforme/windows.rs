//! Implémentation Windows du trait `Plateforme`. **NON TESTÉE SOUS WINDOWS** : compilée seulement (cible
//! x86_64-pc-windows-gnu depuis Linux). Chaque appel se limite à l'utilisateur courant (HKCU, profil) ; rien ne
//! demande les droits d'administrateur.
//!
//! - Version d'un exe : `GetFileVersionInfoSizeW` / `GetFileVersionInfoW` / `VerQueryValueW("\\")` (VS_FIXEDFILEINFO) ;
//! - Premiere : dossiers `%ProgramFiles%\Adobe\Adobe Premiere Pro*` puis indices du registre (HKLM, lecture seule ;
//!   valeurs non documentées par Adobe, simple repli) ;
//! - Téléchargements : `SHGetKnownFolderPath(FOLDERID_Downloads)` ;
//! - ouvrir un fichier : `ShellExecuteW("open")` ; Explorateur : `explorer.exe /select,"<chemin>"` ;
//! - processus : instantané ToolHelp ; fin d'une autre instance : `OpenProcess` + `TerminateProcess`.

use super::*;
use std::ffi::{c_void, OsStr, OsString};
use std::io::Read;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};
use std::time::Instant;
use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Storage::FileSystem::{GetDiskFreeSpaceExW, GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW, VS_FIXEDFILEINFO};
use windows_sys::Win32::System::Com::CoTaskMemFree;
use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, TerminateProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE};
use windows_sys::Win32::UI::Shell::{FOLDERID_Downloads, SHGetKnownFolderPath, ShellExecuteW};
use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_64KEY};
use winreg::RegKey;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub struct Windows;

fn large(s: &OsStr) -> Vec<u16> {
    s.encode_wide().chain(std::iter::once(0)).collect()
}

fn depuis_large(p: *const u16) -> Option<OsString> {
    if p.is_null() {
        return None;
    }
    // SAFETY : chaîne terminée par un zéro, fournie par Windows.
    unsafe {
        let mut n = 0usize;
        while *p.add(n) != 0 {
            n += 1;
        }
        Some(OsString::from_wide(std::slice::from_raw_parts(p, n)))
    }
}

fn env(nom: &str) -> Option<PathBuf> {
    std::env::var_os(nom).map(PathBuf::from).filter(|p| !p.as_os_str().is_empty())
}

fn sans_doublons(v: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut vus: Vec<String> = Vec::new();
    v.into_iter()
        .filter(|p| {
            let k = p.to_string_lossy().to_lowercase();
            if vus.contains(&k) {
                false
            } else {
                vus.push(k);
                true
            }
        })
        .collect()
}

fn hklm_lire(cle: &str, valeur: &str) -> Option<String> {
    RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey_with_flags(cle, KEY_READ | KEY_WOW64_64KEY).ok()?.get_value::<String, _>(valeur).ok()
}

impl Plateforme for Windows {
    fn nom(&self) -> &'static str {
        "windows"
    }

    fn candidats_premiere(&self) -> (Vec<(PathBuf, String)>, Vec<String>) {
        let mut candidats = Vec::new();
        let mut cherche = Vec::new();
        let bases = sans_doublons([env("ProgramW6432"), env("ProgramFiles"), Some(PathBuf::from("C:\\Program Files"))].into_iter().flatten().collect());
        for base in bases {
            let adobe = base.join("Adobe");
            cherche.push(format!("{}\\Adobe Premiere Pro*", adobe.display()));
            let Ok(l) = std::fs::read_dir(&adobe) else { continue };
            for e in l.flatten() {
                if e.file_type().map(|t| t.is_dir()).unwrap_or(false) && est_dossier_premiere(&e.file_name().to_string_lossy()) {
                    candidats.push((e.path().join(PREMIERE_EXE), "dossier".to_string()));
                }
            }
        }
        // Indices du registre (non documentés pour 25.x et 26.x : simple repli, la version vient toujours de l'exe).
        let app_paths = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Adobe Premiere Pro.exe";
        cherche.push(format!("HKLM\\{app_paths}"));
        if let Some(v) = hklm_lire(app_paths, "") {
            candidats.push((PathBuf::from(v.trim_matches('"')), "registre".into()));
        }
        cherche.push("HKLM\\SOFTWARE\\Adobe\\Premiere Pro\\<version>".into());
        if let Ok(k) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey_with_flags("SOFTWARE\\Adobe\\Premiere Pro", KEY_READ | KEY_WOW64_64KEY) {
            for sous in k.enum_keys().flatten() {
                if let Ok(s) = k.open_subkey(&sous) {
                    for nom in ["InstallPath", "Install Path", "Path"] {
                        if let Ok(v) = s.get_value::<String, _>(nom) {
                            let p = PathBuf::from(v.trim_matches('"'));
                            let exe = if p.extension().map(|e| e.eq_ignore_ascii_case("exe")).unwrap_or(false) { p } else { p.join(PREMIERE_EXE) };
                            candidats.push((exe, "registre".into()));
                        }
                    }
                }
            }
        }
        (candidats, cherche)
    }

    fn version_fichier(&self, exe: &Path) -> Option<String> {
        let w = large(exe.as_os_str());
        // SAFETY : tampons dimensionnés selon GetFileVersionInfoSizeW ; pointeurs lus seulement si l'appel réussit.
        unsafe {
            let mut poignee = 0u32;
            let n = GetFileVersionInfoSizeW(w.as_ptr(), &mut poignee);
            if n == 0 {
                return None;
            }
            let mut tampon = vec![0u8; n as usize];
            if GetFileVersionInfoW(w.as_ptr(), 0, n, tampon.as_mut_ptr() as *mut c_void) == 0 {
                return None;
            }
            let racine = large(OsStr::new("\\"));
            let mut p: *mut c_void = std::ptr::null_mut();
            let mut l = 0u32;
            if VerQueryValueW(tampon.as_ptr() as *const c_void, racine.as_ptr(), &mut p, &mut l) == 0 || p.is_null() || (l as usize) < std::mem::size_of::<VS_FIXEDFILEINFO>() {
                return None;
            }
            let info = &*(p as *const VS_FIXEDFILEINFO);
            if info.dwSignature != 0xFEEF04BD {
                return None;
            }
            Some(format!(
                "{}.{}.{}.{}",
                info.dwFileVersionMS >> 16,
                info.dwFileVersionMS & 0xFFFF,
                info.dwFileVersionLS >> 16,
                info.dwFileVersionLS & 0xFFFF
            ))
        }
    }

    fn creative_cloud(&self) -> CreativeCloud {
        let communs = sans_doublons([env("CommonProgramW6432"), env("CommonProgramFiles"), env("CommonProgramFiles(x86)")].into_iter().flatten().collect());
        let upia = communs.iter().map(|b| b.join(UPIA_REL)).find(|p| p.is_file()).map(|p| p.to_string_lossy().into_owned());
        let progs = sans_doublons([env("ProgramFiles"), env("ProgramFiles(x86)")].into_iter().flatten().collect());
        let application = progs
            .iter()
            .map(|b| b.join("Adobe\\Adobe Creative Cloud\\ACC\\Creative Cloud.exe"))
            .find(|p| p.is_file())
            .map(|p| p.to_string_lossy().into_owned());
        CreativeCloud { upia, application }
    }

    fn processus_present(&self, nom_exe: &str) -> Option<bool> {
        Some(!processus(nom_exe).is_empty())
    }

    fn executer(&self, exe: &Path, args: &[String], delai: Duration) -> Result<SortieProcessus, String> {
        let debut = Instant::now();
        let mut enfant = Command::new(exe)
            .args(args)
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Lancement impossible de {} ({e}).", exe.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()))?;
        let lire = |r: Option<Box<dyn Read + Send>>| {
            std::thread::spawn(move || {
                let mut v = Vec::new();
                if let Some(mut r) = r {
                    let _ = r.read_to_end(&mut v);
                }
                v
            })
        };
        let so = lire(enfant.stdout.take().map(|x| Box::new(x) as Box<dyn Read + Send>));
        let se = lire(enfant.stderr.take().map(|x| Box::new(x) as Box<dyn Read + Send>));
        let code = loop {
            match enfant.try_wait() {
                Ok(Some(s)) => break s.code(),
                Ok(None) if debut.elapsed() > delai => {
                    let _ = enfant.kill();
                    break None;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                Err(e) => return Err(format!("Attente impossible ({e}).")),
            }
        };
        let mut sortie = decoder_sortie(&so.join().unwrap_or_default());
        let erreur = decoder_sortie(&se.join().unwrap_or_default());
        if !erreur.trim().is_empty() {
            sortie.push('\n');
            sortie.push_str(&erreur);
        }
        Ok(SortieProcessus { code, sortie, duree_ms: debut.elapsed().as_millis() as u64 })
    }

    fn ouvrir(&self, chemin: &Path) -> Result<(), String> {
        let f = large(chemin.as_os_str());
        let verbe = large(OsStr::new("open"));
        // SAFETY : chaînes terminées par un zéro ; ShellExecuteW renvoie une valeur > 32 en cas de succès.
        let r = unsafe { ShellExecuteW(std::ptr::null_mut(), verbe.as_ptr(), f.as_ptr(), std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL) };
        if (r as isize) > 32 {
            Ok(())
        } else {
            Err(format!("Windows n'a pas pu ouvrir ce fichier (code {}). Aucune application n'y est peut-être associée.", r as isize))
        }
    }

    fn afficher_dans_explorateur(&self, chemin: &Path) -> Result<(), String> {
        Command::new("explorer.exe").raw_arg(argument_explorateur(chemin)).spawn().map(|_| ()).map_err(|e| format!("Explorateur indisponible ({e})."))
    }

    fn lancer(&self, exe: &Path, args: &[String]) -> Result<(), String> {
        Command::new(exe).args(args).spawn().map(|_| ()).map_err(|e| format!("Lancement impossible ({e})."))
    }

    fn reg_lire(&self, cle: &str, valeur: Option<&str>) -> Option<String> {
        RegKey::predef(HKEY_CURRENT_USER).open_subkey(cle).ok()?.get_value::<String, _>(valeur.unwrap_or("")).ok()
    }

    fn reg_ecrire(&self, cle: &str, valeur: Option<&str>, donnee: &str) -> Result<(), String> {
        let (k, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(cle).map_err(|e| format!("Clé HKCU\\{cle} : {e}"))?;
        k.set_value(valeur.unwrap_or(""), &donnee).map_err(|e| format!("Valeur de HKCU\\{cle} : {e}"))
    }

    fn reg_supprimer_valeur(&self, cle: &str, valeur: &str) -> Result<(), String> {
        match RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(cle, winreg::enums::KEY_SET_VALUE) {
            Ok(k) => match k.delete_value(valeur) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("HKCU\\{cle} [{valeur}] : {e}")),
                _ => Ok(()),
            },
            Err(_) => Ok(()),
        }
    }

    fn reg_supprimer_cle(&self, cle: &str) -> Result<(), String> {
        match RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(cle) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("HKCU\\{cle} : {e}")),
            _ => Ok(()),
        }
    }

    fn espace_libre(&self, chemin: &Path) -> Option<u64> {
        // Le dossier n'existe peut-être pas encore : on remonte au premier parent existant.
        let mut p = chemin.to_path_buf();
        while !p.exists() {
            p = p.parent()?.to_path_buf();
        }
        let w = large(p.as_os_str());
        let mut libre = 0u64;
        // SAFETY : pointeurs vers des u64 locaux.
        let ok = unsafe { GetDiskFreeSpaceExW(w.as_ptr(), &mut libre, std::ptr::null_mut(), std::ptr::null_mut()) };
        (ok != 0).then_some(libre)
    }

    fn dossier_telechargements(&self) -> Option<PathBuf> {
        let mut p: *mut u16 = std::ptr::null_mut();
        // SAFETY : la chaîne renvoyée est libérée par CoTaskMemFree, même en cas d'échec.
        unsafe {
            let hr = SHGetKnownFolderPath(&FOLDERID_Downloads, 0, std::ptr::null_mut(), &mut p);
            let r = if hr >= 0 { depuis_large(p).map(PathBuf::from) } else { None };
            CoTaskMemFree(p as *const c_void);
            r.or_else(|| env("USERPROFILE").map(|u| u.join("Downloads")))
        }
    }

    fn terminer_autres_instances(&self) -> usize {
        let Ok(moi) = std::env::current_exe() else { return 0 };
        let nom = moi.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let moi_txt = moi.to_string_lossy().to_lowercase();
        let mon_pid = std::process::id();
        let mut n = 0;
        for pid in processus(&nom) {
            if pid == mon_pid {
                continue;
            }
            // SAFETY : poignée fermée dans tous les cas ; on ne termine que le même exécutable (chemin complet comparé).
            unsafe {
                let h = OpenProcess(PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
                if h.is_null() {
                    continue;
                }
                let mut tampon = vec![0u16; 1024];
                let mut l = tampon.len() as u32;
                let meme = QueryFullProcessImageNameW(h, 0, tampon.as_mut_ptr(), &mut l) != 0
                    && OsString::from_wide(&tampon[..l as usize]).to_string_lossy().to_lowercase() == moi_txt;
                if meme && TerminateProcess(h, 0) != 0 {
                    n += 1;
                }
                CloseHandle(h);
            }
        }
        n
    }
}

/// Identifiants des processus dont l'exe porte ce nom (casse ignorée).
fn processus(nom_exe: &str) -> Vec<u32> {
    let mut pids = Vec::new();
    // SAFETY : instantané ToolHelp parcouru puis fermé ; dwSize initialisé comme l'exige l'API.
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE || snap.is_null() {
            return pids;
        }
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut ok = Process32FirstW(snap, &mut e) != 0;
        while ok {
            let fin = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
            if OsString::from_wide(&e.szExeFile[..fin]).to_string_lossy().eq_ignore_ascii_case(nom_exe) {
                pids.push(e.th32ProcessID);
            }
            ok = Process32NextW(snap, &mut e) != 0;
        }
        CloseHandle(snap);
    }
    pids
}

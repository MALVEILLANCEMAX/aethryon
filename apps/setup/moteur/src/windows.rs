//! Implémentation Windows des traits `Registre` et `Systeme`, et des emplacements de l'utilisateur. Tout est limité à
//! l'utilisateur courant : écriture dans HKCU seulement, aucun droit d'administrateur. Compilée depuis Linux
//! (x86_64-pc-windows-gnu) et essayée sous Wine ; NON TESTÉE SOUS WINDOWS.

use crate::plateforme::*;
use std::ffi::{c_void, OsString};
use std::io;
use std::os::windows::ffi::OsStringExt;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use windows::core::{Interface, HSTRING};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Storage::FileSystem::{GetDiskFreeSpaceExW, GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW, VS_FIXEDFILEINFO};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
use windows::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};
use windows::Win32::UI::Shell::{IShellLinkW, SHGetKnownFolderPath, ShellLink, FOLDERID_Programs, FOLDERID_Videos, KF_FLAG_DEFAULT};
use winreg::enums::{RegType, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_64KEY};
use winreg::{RegKey, RegValue};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const DETACHED_PROCESS: u32 = 0x0000_0008;

pub struct RegistreWindows;

fn ouvrir(racine: Racine, cle: &str) -> Option<RegKey> {
    match racine {
        Racine::Hkcu => RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(cle, KEY_READ).ok(),
        Racine::Hklm => RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey_with_flags(cle, KEY_READ | KEY_WOW64_64KEY).ok(),
    }
}

fn valeur(v: &RegValue) -> Option<Valeur> {
    match v.vtype {
        RegType::REG_SZ | RegType::REG_EXPAND_SZ => {
            let u: Vec<u16> = v.bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
            let s = String::from_utf16_lossy(&u);
            Some(Valeur::Chaine(s.trim_end_matches('\0').to_string()))
        }
        RegType::REG_DWORD if v.bytes.len() >= 4 => Some(Valeur::Dword(u32::from_le_bytes([v.bytes[0], v.bytes[1], v.bytes[2], v.bytes[3]]))),
        _ => None,
    }
}

impl Registre for RegistreWindows {
    fn lire(&self, racine: Racine, cle: &str, nom: &str) -> Option<Valeur> {
        valeur(&ouvrir(racine, cle)?.get_raw_value(nom).ok()?)
    }
    fn sous_cles(&self, racine: Racine, cle: &str) -> Vec<String> {
        ouvrir(racine, cle).map(|k| k.enum_keys().flatten().collect()).unwrap_or_default()
    }
    fn valeurs(&self, cle: &str) -> Option<Vec<(String, Valeur)>> {
        let k = ouvrir(Racine::Hkcu, cle)?;
        Some(k.enum_values().flatten().filter_map(|(n, v)| valeur(&v).map(|x| (n, x))).collect())
    }
    fn ecrire(&self, cle: &str, nom: &str, v: &Valeur) -> io::Result<()> {
        let (k, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(cle)?;
        match v {
            Valeur::Chaine(s) => k.set_value(nom, s),
            Valeur::Dword(d) => k.set_value(nom, d),
        }
    }
    fn supprimer_valeur(&self, cle: &str, nom: &str) -> io::Result<()> {
        let Ok(k) = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(cle, winreg::enums::KEY_SET_VALUE) else { return Ok(()) };
        match k.delete_value(nom) {
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            r => r,
        }
    }
    fn supprimer_cle(&self, cle: &str) -> io::Result<()> {
        match RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(cle) {
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            r => r,
        }
    }
}

pub struct SystemeWindows;

fn processus(nom_exe: &str) -> Vec<u32> {
    let mut v = Vec::new();
    // SAFETY : instantané ToolHelp lu entrée par entrée, poignée fermée à la fin.
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return v };
        let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut ok = Process32FirstW(snap, &mut e).is_ok();
        while ok {
            let n = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
            if String::from_utf16_lossy(&e.szExeFile[..n]).eq_ignore_ascii_case(nom_exe) && e.th32ProcessID != std::process::id() {
                v.push(e.th32ProcessID);
            }
            ok = Process32NextW(snap, &mut e).is_ok();
        }
        let _ = CloseHandle(snap);
    }
    v
}

impl Systeme for SystemeWindows {
    fn version_fichier(&self, exe: &Path) -> Option<String> {
        let w = HSTRING::from(exe.as_os_str());
        // SAFETY : tampon dimensionné par GetFileVersionInfoSizeW ; pointeur lu seulement si l'appel réussit.
        unsafe {
            let n = GetFileVersionInfoSizeW(&w, None);
            if n == 0 {
                return None;
            }
            let mut tampon = vec![0u8; n as usize];
            GetFileVersionInfoW(&w, None, n, tampon.as_mut_ptr() as *mut c_void).ok()?;
            let mut p: *mut c_void = std::ptr::null_mut();
            let mut l = 0u32;
            if !VerQueryValueW(tampon.as_ptr() as *const c_void, &HSTRING::from("\\"), &mut p, &mut l).as_bool() || p.is_null() || (l as usize) < std::mem::size_of::<VS_FIXEDFILEINFO>() {
                return None;
            }
            let i = &*(p as *const VS_FIXEDFILEINFO);
            if i.dwSignature != 0xFEEF04BD {
                return None;
            }
            Some(format!("{}.{}.{}.{}", i.dwFileVersionMS >> 16, i.dwFileVersionMS & 0xFFFF, i.dwFileVersionLS >> 16, i.dwFileVersionLS & 0xFFFF))
        }
    }
    fn processus_present(&self, nom_exe: &str) -> bool {
        !processus(nom_exe).is_empty()
    }
    fn fermer_processus(&self, nom_exe: &str) -> usize {
        let mut n = 0;
        for pid in processus(nom_exe) {
            // SAFETY : poignée ouverte avec le seul droit de terminer, fermée aussitôt.
            unsafe {
                if let Ok(h) = OpenProcess(PROCESS_TERMINATE, false, pid) {
                    if TerminateProcess(h, 0).is_ok() {
                        n += 1;
                    }
                    let _ = CloseHandle(h);
                }
            }
        }
        if n > 0 {
            // Laisse à Windows le temps de libérer les fichiers de l'exe.
            std::thread::sleep(std::time::Duration::from_millis(600));
        }
        n
    }
    fn creer_raccourci(&self, lnk: &Path, cible: &Path, arguments: &str, description: &str) -> Result<(), String> {
        // SAFETY : COM initialisé sur ce fil (appartement), objets libérés à la sortie de portée.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let l: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).map_err(|e| e.to_string())?;
            l.SetPath(&HSTRING::from(cible.as_os_str())).map_err(|e| e.to_string())?;
            l.SetArguments(&HSTRING::from(arguments)).map_err(|e| e.to_string())?;
            l.SetDescription(&HSTRING::from(description)).map_err(|e| e.to_string())?;
            l.SetIconLocation(&HSTRING::from(cible.as_os_str()), 0).map_err(|e| e.to_string())?;
            if let Some(d) = cible.parent() {
                l.SetWorkingDirectory(&HSTRING::from(d.as_os_str())).map_err(|e| e.to_string())?;
            }
            let f: IPersistFile = l.cast().map_err(|e| e.to_string())?;
            f.Save(&HSTRING::from(lnk.as_os_str()), true).map_err(|e| e.to_string())
        }
    }
    fn lancer(&self, exe: &Path, arguments: &[String]) -> Result<(), String> {
        std::process::Command::new(exe)
            .args(arguments)
            .current_dir(exe.parent().unwrap_or(Path::new("C:\\")))
            .creation_flags(DETACHED_PROCESS | CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Lancement de {} impossible ({e}).", exe.display()))
    }
    fn espace_libre(&self, p: &Path) -> Option<u64> {
        let mut libre = 0u64;
        // SAFETY : sorties écrites par l'appel.
        unsafe { GetDiskFreeSpaceExW(&HSTRING::from(p.as_os_str()), Some(&mut libre), None, None).ok()? };
        Some(libre)
    }
}

fn dossier_connu(id: &windows::core::GUID) -> Option<PathBuf> {
    // SAFETY : chaîne allouée par le shell, copiée puis libérée par CoTaskMemFree.
    unsafe {
        let p = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).ok()?;
        let n = (0..).take_while(|&i| *p.0.add(i) != 0).count();
        let s = OsString::from_wide(std::slice::from_raw_parts(p.0, n));
        CoTaskMemFree(Some(p.0 as *const c_void));
        Some(PathBuf::from(s))
    }
}

fn env(n: &str) -> Option<PathBuf> {
    std::env::var_os(n).map(PathBuf::from).filter(|p| !p.as_os_str().is_empty())
}

fn sans_doublons(v: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut vus: Vec<String> = vec![];
    v.into_iter().filter(|p| {
        let k = p.to_string_lossy().to_lowercase();
        let nouveau = !vus.contains(&k);
        vus.push(k);
        nouveau
    }).collect()
}

pub fn emplacements() -> Emplacements {
    let profil = env("USERPROFILE").unwrap_or_else(|| PathBuf::from("C:\\Users\\Public"));
    let local = env("LOCALAPPDATA").unwrap_or_else(|| profil.join("AppData\\Local"));
    let itinerant = env("APPDATA").unwrap_or_else(|| profil.join("AppData\\Roaming"));
    Emplacements {
        videos: dossier_connu(&FOLDERID_Videos).unwrap_or_else(|| profil.join("Videos")),
        menu_demarrer: dossier_connu(&FOLDERID_Programs).unwrap_or_else(|| itinerant.join("Microsoft\\Windows\\Start Menu\\Programs")),
        programmes: sans_doublons([env("ProgramW6432"), env("ProgramFiles"), Some(PathBuf::from("C:\\Program Files"))].into_iter().flatten().collect()),
        programmes_communs: sans_doublons([env("CommonProgramW6432"), env("CommonProgramFiles"), env("CommonProgramFiles(x86)")].into_iter().flatten().collect()),
        local,
        itinerant,
    }
}

pub fn environnement() -> Environnement {
    Environnement {
        fs: std::sync::Arc::new(FsReel),
        registre: std::sync::Arc::new(RegistreWindows),
        systeme: std::sync::Arc::new(SystemeWindows),
        emplacements: emplacements(),
    }
}

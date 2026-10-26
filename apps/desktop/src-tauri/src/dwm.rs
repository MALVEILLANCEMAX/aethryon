//! AETHRYON Desktop : fenêtre sans cadre de Windows 11 SANS bordure blanche (retour du propriétaire, 2026-10-18 ;
//! recherche E §5). Même procédé que la fenêtre d'AETHRYON Setup (setup/src-tauri/src/dwm.rs).
//!
//! Constat sur sa capture : une bande blanche de ≈ 5 px à gauche, à droite et en bas, rien en haut. C'est la zone
//! non cliente que tao 0.37.1 garde autour d'une fenêtre sans cadre AVEC ombre (`shadow: true`) : son
//! WM_NCCALCSIZE retire `SM_CXSIZEFRAME + SM_CXPADDEDBORDER` à gauche, à droite et en bas, 1 px en haut
//! (`calculate_insets_for_dpi`), et cette zone est peinte en clair. La version 0.37.1 est la dernière publiée
//! (crates.io, 2026-10-18) : le correctif tao#1361 du bug voisin tao#1359 n'y est pas.
//!
//! Correction : `shadow: false` dans la configuration (la zone cliente couvre alors TOUTE la fenêtre : plus aucune
//! zone non cliente à peindre), puis on rend à Windows 11 ce que l'ombre de tao apportait, par DWM :
//! - `DwmExtendFrameIntoClientArea(1, 1, 1, 1)` : l'ombre portée (procédé du crate `window-shadows` de Tauri 1) ;
//! - `DWMWA_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND` : les coins arrondis ;
//! - `DWMWA_BORDER_COLOR` = `DWMWA_COLOR_NONE` : DWM ne trace plus son liseré de 1 px (« will suppress the drawing
//!   of the window border »), quel que soit le focus ; ici plutôt que la couleur du fond, car le Desktop a aussi un
//!   thème clair (le liseré intérieur de l'interface reste dessiné en CSS) ;
//! - `DWMWA_USE_IMMERSIVE_DARK_MODE = 1` : cadre système en mode sombre (Alt+Tab, aperçu de la barre des tâches).
//!
//! Sous Windows 10, les attributs 33 et 34 n'existent pas : l'appel échoue sans conséquence.
//! NON TESTÉ SOUS WINDOWS (ni Wine ni Linux n'ont DWM).

/// `DWMWA_COLOR_NONE` (0xFFFFFFFE) : aucun liseré DWM, en thème sombre comme en thème clair.
pub const SANS_BORDURE: u32 = 0xFFFF_FFFE;

#[cfg(windows)]
pub fn appliquer(hwnd: isize, couleur: u32) -> Vec<String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DwmExtendFrameIntoClientArea, DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_USE_IMMERSIVE_DARK_MODE, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
    };
    use windows::Win32::UI::Controls::MARGINS;
    let h = HWND(hwnd as *mut core::ffi::c_void);
    let mut journal = Vec::new();
    // SAFETY : HWND valide fourni par Tauri ; chaque attribut est passé par adresse avec sa taille exacte.
    unsafe {
        let sombre: i32 = 1;
        let r = DwmSetWindowAttribute(h, DWMWA_USE_IMMERSIVE_DARK_MODE, &sombre as *const i32 as *const _, 4);
        journal.push(format!("DWMWA_USE_IMMERSIVE_DARK_MODE : {}", if r.is_ok() { "ok" } else { "refusé" }));
        let coin = DWMWCP_ROUND;
        let r = DwmSetWindowAttribute(h, DWMWA_WINDOW_CORNER_PREFERENCE, &coin as *const _ as *const _, 4);
        journal.push(format!("DWMWA_WINDOW_CORNER_PREFERENCE : {}", if r.is_ok() { "ok" } else { "refusé (Windows 10 ?)" }));
        let r = DwmSetWindowAttribute(h, DWMWA_BORDER_COLOR, &couleur as *const u32 as *const _, 4);
        journal.push(format!("DWMWA_BORDER_COLOR = 0x{couleur:08X} : {}", if r.is_ok() { "ok" } else { "refusé (Windows 10 ?)" }));
        let marges = MARGINS { cxLeftWidth: 1, cxRightWidth: 1, cyTopHeight: 1, cyBottomHeight: 1 };
        let r = DwmExtendFrameIntoClientArea(h, &marges);
        journal.push(format!("DwmExtendFrameIntoClientArea(1) : {}", if r.is_ok() { "ok" } else { "refusé" }));
    }
    journal
}

#[cfg(not(windows))]
pub fn appliquer(_hwnd: isize, _couleur: u32) -> Vec<String> {
    vec!["DWM : sans objet hors de Windows".into()]
}

/// Liseré DWM du menu de la zone de notification : filet chaud et discret (#3A352E ; COLORREF = 0x00BBGGRR).
pub const LISERE_MENU: u32 = 0x002E_353A;

/// Menu de la zone de notification (zone.rs) : mêmes attributs que la fenêtre principale (mode sombre, coins arrondis,
/// ombre), un liseré chaud, puis l'acrylique « transitoire » de Windows 11 (`DWMWA_SYSTEMBACKDROP_TYPE =
/// DWMSBT_TRANSIENTWINDOW`, la matière des menus de Windows 11 ; c'est exactement ce que fait l'effet `Acrylic` de
/// Tauri 2 (window-vibrancy 0.8.1) à partir de Windows 11 22H2, mais ici le résultat est connu). Renvoie vrai si DWM
/// accepte l'acrylique ; sinon (Windows 10, Windows 11 21H2) le menu peint un fond obsidienne plein.
#[cfg(windows)]
pub fn appliquer_menu(hwnd: isize) -> (bool, Vec<String>) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMSBT_TRANSIENTWINDOW, DWMWA_SYSTEMBACKDROP_TYPE};
    let h = HWND(hwnd as *mut core::ffi::c_void);
    let mut journal = appliquer(hwnd, LISERE_MENU);
    let fond = DWMSBT_TRANSIENTWINDOW;
    // SAFETY : HWND valide fourni par Tauri ; attribut passé par adresse avec sa taille exacte (DWM_SYSTEMBACKDROP_TYPE = i32).
    let verre = unsafe { DwmSetWindowAttribute(h, DWMWA_SYSTEMBACKDROP_TYPE, &fond as *const _ as *const _, 4) }.is_ok();
    journal.push(format!("DWMWA_SYSTEMBACKDROP_TYPE = DWMSBT_TRANSIENTWINDOW : {}", if verre { "ok" } else { "refusé (fond plein)" }));
    (verre, journal)
}

#[cfg(not(windows))]
pub fn appliquer_menu(_hwnd: isize) -> (bool, Vec<String>) {
    (false, vec!["DWM : sans objet hors de Windows".into()])
}

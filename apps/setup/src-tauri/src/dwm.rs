//! Fenêtre sans cadre de Windows 11 SANS bordure blanche (retour du propriétaire, 2026-10-18 ; recherche E §5).
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
//! - `DWMWA_BORDER_COLOR` = couleur du fond (#0F0F10) : le liseré de 1 px de DWM se confond avec la fenêtre, quel
//!   que soit le focus (« the app is responsible for changing the border color ») ;
//! - `DWMWA_USE_IMMERSIVE_DARK_MODE = 1` : cadre système en mode sombre (Alt+Tab, aperçu de la barre des tâches).
//!
//! Sous Windows 10, les attributs 33 et 34 n'existent pas : l'appel échoue sans conséquence.
//! NON TESTÉ SOUS WINDOWS (ni Wine ni Linux n'ont DWM).

/// COLORREF (0x00BBGGRR) du fond #0F0F10.
pub const FOND: u32 = 0x0010_0F0F;

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
        journal.push(format!("DWMWA_BORDER_COLOR = 0x{couleur:06X} : {}", if r.is_ok() { "ok" } else { "refusé (Windows 10 ?)" }));
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

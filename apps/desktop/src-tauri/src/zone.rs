//! Menu de la zone de notification dessiné par AETHRYON (demande du propriétaire, 2026-10-24) : le menu natif de
//! Windows ne se stylise pas. Petite fenêtre Tauri « zone-menu » (zone-menu.html, src/zone/menu-zone.ts) sans
//! bordure, transparente, toujours au premier plan, hors barre des tâches ; acrylique de Windows 11 si DWM l'accepte
//! (dwm.rs), sinon fond obsidienne plein. Mêmes actions que le menu natif (appli::action_zone). Clic gauche inchangé.
//!
//! Repli : le menu natif reste attaché à l'icône tant que la page du menu ne s'est pas signalée (`zone_menu_pret`) ;
//! il n'est retiré qu'à ce moment-là. Fenêtre impossible à créer, ou page muette pendant 10 s : le menu natif reste.
//! La fenêtre est créée une seule fois, 3 s après le premier `fenetre_prete` (fenêtre principale montrée), sur un
//! fil à part : sous Windows, créer une fenêtre WebView2 depuis le fil principal (commande synchrone, gestionnaire
//! d'événement) bloque (documentation de `WebviewWindowBuilder::new`). Windows seulement : ailleurs, menu natif.
//! NON TESTÉ SOUS WINDOWS (ni Wine ni Linux n'ont la zone de notification de Windows 11, DWM et WebView2).

use crate::appli::{self, EtatApp};
use aethryon_noyau::journal;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::menu::Menu;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Rect, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent, Wry};

pub const ETIQUETTE: &str = "zone-menu";
/// Taille logique (px CSS) tant que la page n'a pas mesuré la sienne.
const TAILLE_DEFAUT: (f64, f64) = (240.0, 113.0);
/// Écart avec la barre des tâches et les bords de l'écran (px logiques), comme les volets de Windows 11.
const ECART: f64 = 8.0;
/// Clic droit sur l'icône juste après une fermeture (ce clic-là a fait perdre le focus au menu) : le menu reste
/// fermé, comme le menu natif, au lieu de se rouvrir aussitôt.
const BASCULE: Duration = Duration::from_millis(300);

const ABSENTE: u8 = 0;
const EN_CREATION: u8 = 1;
const CREEE: u8 = 2;
const PRETE: u8 = 3;
const ECHEC: u8 = 4;

static ETAT: AtomicU8 = AtomicU8::new(ABSENTE);
static VERRE: AtomicBool = AtomicBool::new(false);
static TAILLE: Mutex<(f64, f64)> = Mutex::new(TAILLE_DEFAUT);
static FERMEE_LE: Mutex<Option<Instant>> = Mutex::new(None);

fn verrou<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Annonce d'ouverture envoyée à la page avant de montrer la fenêtre.
#[derive(Clone, Serialize)]
struct Ouverture {
    /// Côté du menu tourné vers l'icône : l'entrée part de là.
    cote: &'static str,
    /// Acrylique de DWM en place (sinon fond plein).
    verre: bool,
    /// Réglage « Réduire les animations » : systeme, oui, non.
    animations: String,
}

/// Crée la fenêtre du menu (cachée), une seule fois, 3 s après le premier `fenetre_prete` (l'interface principale a fini
/// de se monter : pas de seconde WebView2 pendant le démarrage), sur un fil à part.
pub fn prechauffer(app: &AppHandle) {
    if !cfg!(windows) || ETAT.compare_exchange(ABSENTE, EN_CREATION, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(3));
        if let Err(e) = creer(&app) {
            ETAT.store(ECHEC, Ordering::SeqCst);
            journal::avert("zone", &format!("Menu dessiné non créé ({e}) : le menu natif reste."));
            return;
        }
        // La page a pu se signaler pendant la création (PRETE) : on ne revient pas en arrière.
        let _ = ETAT.compare_exchange(EN_CREATION, CREEE, Ordering::SeqCst, Ordering::SeqCst);
        std::thread::sleep(Duration::from_secs(10));
        if ETAT.compare_exchange(CREEE, ECHEC, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
            journal::avert("zone", "Page du menu dessiné muette après 10 s : fenêtre retirée, le menu natif reste.");
            if let Some(w) = app.get_webview_window(ETIQUETTE) {
                let _ = w.destroy();
            }
        }
    });
}

fn creer(app: &AppHandle) -> tauri::Result<()> {
    let (l, h) = TAILLE_DEFAUT;
    let w = WebviewWindowBuilder::new(app, ETIQUETTE, WebviewUrl::App("zone-menu.html".into()))
        .title("AETHRYON")
        .inner_size(l, h)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible(false)
        .focused(false)
        .disable_drag_drop_handler()
        .build()?;
    // Attributs DWM posés sur le fil principal, comme ceux de la fenêtre principale (appli.rs).
    #[cfg(windows)]
    if let Ok(hw) = w.hwnd() {
        let h = hw.0 as isize;
        app.run_on_main_thread(move || {
            let (verre, lignes) = crate::dwm::appliquer_menu(h);
            VERRE.store(verre, Ordering::SeqCst);
            for l in lignes {
                journal::info("zone", &l);
            }
        })?;
    }
    #[cfg(not(windows))]
    let _ = w;
    Ok(())
}

/// Rectangle physique (zone de travail d'un écran).
#[derive(Clone, Copy)]
struct Zone {
    x: f64,
    y: f64,
    l: f64,
    h: f64,
}

/// Place un menu `l` × `h` près de l'icône (centre `ax`, `ay`, demi-hauteur `dh`) dans la zone de travail `z` (écran
/// moins la barre des tâches), à `e` des bords. Renvoie (x, y, côté du menu tourné vers l'icône). Barre des tâches en
/// bas (cas courant), en haut, à droite ou à gauche : contre elle, centré sur l'icône puis borné à l'écran. Icône DANS
/// la zone de travail (icônes cachées « ^ », barre masquée automatiquement) : au-dessus de l'icône, dessous sinon.
fn placer(ax: f64, ay: f64, dh: f64, z: Zone, l: f64, h: f64, e: f64) -> (f64, f64, &'static str) {
    let (gauche, haut, droite, bas) = (z.x, z.y, z.x + z.l, z.y + z.h);
    let borne = |v: f64, min: f64, max: f64| if max < min { min } else { v.max(min).min(max) };
    let x = borne(ax - l / 2.0, gauche + e, droite - l - e);
    let y = borne(ay - h / 2.0, haut + e, bas - h - e);
    if ay >= bas {
        (x, bas - h - e, "bas")
    } else if ay < haut {
        (x, haut + e, "haut")
    } else if ax >= droite {
        (droite - l - e, y, "droite")
    } else if ax < gauche {
        (gauche + e, y, "gauche")
    } else if ay - dh - h - e >= haut + e {
        (x, ay - dh - h - e, "bas")
    } else {
        (x, borne(ay + dh + e, haut + e, bas - h - e), "haut")
    }
}

/// Clic droit sur l'icône (fil principal) : place le menu près d'elle, dans la zone de travail de son écran (facteur
/// d'échelle de cet écran), prévient la page, puis montre la fenêtre avec le focus. Sans menu dessiné prêt : rien,
/// le menu natif, encore attaché à l'icône, s'ouvre de lui-même.
pub fn ouvrir(app: &AppHandle, curseur: PhysicalPosition<f64>, icone: Rect) {
    if ETAT.load(Ordering::SeqCst) != PRETE || matches!(*verrou(&FERMEE_LE), Some(t) if t.elapsed() < BASCULE) {
        return;
    }
    let Some(w) = app.get_webview_window(ETIQUETTE) else { return };
    let p = icone.position.to_physical::<f64>(1.0);
    let s = icone.size.to_physical::<f64>(1.0);
    let (ax, ay, dh) = if s.width > 0.0 && s.height > 0.0 {
        (p.x + s.width / 2.0, p.y + s.height / 2.0, s.height / 2.0)
    } else {
        (curseur.x, curseur.y, 0.0)
    };
    let ecran = app.monitor_from_point(curseur.x, curseur.y).ok().flatten().or_else(|| app.primary_monitor().ok().flatten());
    let (zone, f) = match &ecran {
        Some(m) => {
            let z = m.work_area();
            (Zone { x: z.position.x as f64, y: z.position.y as f64, l: z.size.width as f64, h: z.size.height as f64 }, m.scale_factor())
        }
        // Écran inconnu : au-dessus de l'icône, sans bornes.
        None => (Zone { x: ax - 1e5, y: ay - 1e5, l: 2e5, h: 2e5 }, 1.0),
    };
    let (l, h) = *verrou(&TAILLE);
    let (lp, hp) = ((l * f).ceil(), (h * f).ceil());
    let (x, y, cote) = placer(ax, ay, dh, zone, lp, hp, (ECART * f).round());
    let pos = PhysicalPosition::new(x.round() as i32, y.round() as i32);
    // Position, taille, puis position encore : passer sur un écran d'un autre facteur d'échelle redimensionne la fenêtre.
    let _ = w.set_position(pos);
    let _ = w.set_size(PhysicalSize::new(lp as u32, hp as u32));
    let _ = w.set_position(pos);
    let animations = app.state::<EtatApp>().service.get().map(|s| s.config().reduire_animations).unwrap_or_else(|| "systeme".into());
    let _ = app.emit_to(ETIQUETTE, "zone-menu-ouvrir", Ouverture { cote, verre: VERRE.load(Ordering::SeqCst), animations });
    let _ = w.show();
    let _ = w.set_focus();
}

/// Clic gauche sur l'icône : un menu resté ouvert (focus refusé par Windows, donc jamais perdu) se cache aussi.
pub fn cacher(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(ETIQUETTE) {
        if w.is_visible().unwrap_or(false) {
            masquer(app);
        }
    }
}

fn masquer(app: &AppHandle) {
    *verrou(&FERMEE_LE) = Some(Instant::now());
    if let Some(w) = app.get_webview_window(ETIQUETTE) {
        let _ = w.hide();
    }
}

/// Page chargée et mesurée (px CSS) : le menu dessiné remplace le menu natif de l'icône.
#[tauri::command]
pub fn zone_menu_pret(app: AppHandle, largeur: f64, hauteur: f64) {
    if (160.0..=480.0).contains(&largeur) && (60.0..=480.0).contains(&hauteur) {
        *verrou(&TAILLE) = (largeur, hauteur);
    }
    let passe = [EN_CREATION, CREEE].into_iter().any(|e| ETAT.compare_exchange(e, PRETE, Ordering::SeqCst, Ordering::SeqCst).is_ok());
    if passe {
        if let Some(icone) = app.tray_by_id("principal") {
            let _ = icone.set_menu(None::<Menu<Wry>>);
        }
        journal::info("zone", &format!("Menu dessiné prêt ({largeur:.0} × {hauteur:.0} px) : il remplace le menu natif."));
    }
}

/// Échap ou perte du focus : la page est revenue à son état fermé (une image peinte), la fenêtre se cache.
#[tauri::command]
pub fn zone_menu_fermer(app: AppHandle) {
    masquer(&app);
}

/// Élément choisi : la fenêtre se cache, puis la même action que le menu natif.
#[tauri::command]
pub fn zone_menu_choisir(app: AppHandle, action: String) {
    masquer(&app);
    appli::action_zone(&app, &action);
}

/// Événements de la fenêtre du menu (jamais ceux de la fenêtre principale) : une demande de fermeture la cache.
pub fn evenement(fenetre: &Window, ev: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = ev {
        api.prevent_close();
        masquer(fenetre.app_handle());
    }
}

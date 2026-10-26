//! Glisser natif d'AETHRYON vers une autre application (Premiere Pro : panneau Projet ou timeline ; Explorateur…) :
//! un VRAI glisser de fichiers du système, OLE `DoDragDrop`, avec l'objet de données du Shell (le même que celui de
//! l'Explorateur : `CF_HDROP`, liste d'IDList du Shell…). NON DÉMONTRÉ SOUS WINDOWS (voir TESTS-MANUELS.md, section F).
//!
//! Choix (rapport FLUX-SOCLE.md §2) : implémentation directe avec le crate `windows` 0.62.2, celui que Tauri 2.12.4,
//! wry 0.57 et tao 0.37 compilent déjà, plutôt que le crate `drag` 2.1.1 (CrabNebula) : même technique (tableau
//! d'éléments du Shell → `IDataObject`, `IDragSourceHelper`, `DoDragDrop`), mais `drag` tire `windows` 0.52 et
//! `windows-core` 0.58 en plus, s'arrête par `unwrap()` sur le fil principal, ne libère pas ses IDList, rend
//! transparents les pixels noirs de l'image (`crColorKey` = 0 : nos miniatures ont des bandes noires) et ne dit pas
//! où le dépôt a eu lieu ; `tauri-plugin-drag` accepte en plus des chemins LIBRES venus de l'interface (interdit ici).
//!
//! Déroulé :
//! 1. la commande `glisser_medias` (fil de travail) résout les identifiants dans l'index (`Service::chemins_pour_glisser`)
//!    et dépose la demande ici, puis poste un message à une fenêtre de messages créée sur le FIL PRINCIPAL ;
//! 2. la procédure de cette fenêtre lance `DoDragDrop` HORS du gestionnaire d'événements de tao : pendant la boucle
//!    modale d'OLE, tao continue de traiter ses événements, donc les événements de dépôt de wry (« enter », « over »,
//!    « drop », « leave ») arrivent EN DIRECT à l'interface quand le curseur survole la fenêtre d'AETHRYON (zones
//!    internes). Lancé depuis `run_on_main_thread`, ils seraient mis en attente par tao jusqu'à la fin du glisser ;
//! 3. effets permis : copie et lien seulement — jamais de déplacement : l'Explorateur ne peut pas sortir un média du
//!    dossier surveillé ; Premiere Pro référence le fichier sans le déplacer ;
//! 4. fin : événement `flux-glisser-fin` (déposé / annulé / erreur, effet, cible interne ou externe, nom de l'exécutable
//!    sous le curseur, ex. « Adobe Premiere Pro.exe »). « Déposé » veut dire qu'une cible a ACCEPTÉ le dépôt ; ce
//!    n'est PAS une confirmation d'import par Premiere Pro.

use aethryon_noyau::journal;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

/// Événement de fin de glisser envoyé à l'interface.
pub const EVENEMENT_FIN: &str = "flux-glisser-fin";
/// Image de glisser : 200 × 200 px au plus (miniature 480 × 270 → 200 × 113).
#[allow(dead_code)]
const IMAGE_MAX: u32 = 200;

pub struct Demande {
    pub jeton: String,
    pub chemins: Vec<PathBuf>,
    /// `R\bibliotheque\miniatures\<id>.jpg` du premier média, s'il existe (sinon : icône d'AETHRYON).
    pub miniature: Option<PathBuf>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Fin {
    pub jeton: String,
    /// `depose` (une cible a accepté), `annule` (Échap, bouton relâché hors d'une cible, cible qui refuse, annulation
    /// demandée), `erreur` (le glisser n'a pas pu se faire).
    pub resultat: &'static str,
    /// `copie`, `lien` ou `aucun` : ce que la cible a accepté.
    pub effet: &'static str,
    /// `interne` (fenêtre d'AETHRYON), `externe`, `inconnue`.
    pub cible: &'static str,
    /// Exécutable sous le curseur au dépôt, sans son chemin (« Adobe Premiere Pro.exe », « explorer.exe »).
    pub application: Option<String>,
    pub fichiers: usize,
    pub message: Option<String>,
}

static EN_COURS: AtomicBool = AtomicBool::new(false);
static ANNULE: AtomicBool = AtomicBool::new(false);
#[allow(dead_code)]
static FENETRE_MESSAGES: AtomicIsize = AtomicIsize::new(0);
#[allow(dead_code)]
static FENETRE_PRINCIPALE: AtomicIsize = AtomicIsize::new(0);
type Attente = (Demande, mpsc::Sender<Result<(), String>>);
static ATTENTE: Mutex<Option<Attente>> = Mutex::new(None);
static APP: OnceLock<AppHandle> = OnceLock::new();

fn attente() -> std::sync::MutexGuard<'static, Option<Attente>> {
    ATTENTE.lock().unwrap_or_else(|e| e.into_inner())
}

/// Dépose une demande de glisser ; le récepteur dit si `DoDragDrop` a démarré (ou pourquoi non).
pub fn demarrer(d: Demande) -> Result<mpsc::Receiver<Result<(), String>>, String> {
    if EN_COURS.swap(true, Ordering::SeqCst) {
        return Err("Un glisser est déjà en cours.".into());
    }
    let (tx, rx) = mpsc::channel();
    *attente() = Some((d, tx));
    if let Err(m) = poster() {
        attente().take();
        EN_COURS.store(false, Ordering::SeqCst);
        return Err(m);
    }
    Ok(rx)
}

/// La demande n'a pas été prise à temps par le fil principal : elle est retirée (si elle attend encore).
pub fn abandonner() {
    if attente().take().is_some() {
        EN_COURS.store(false, Ordering::SeqCst);
    }
}

/// Demande l'arrêt du glisser en cours (pris en compte au prochain appel de `QueryContinueDrag`, quelques ms).
pub fn annuler() -> bool {
    if EN_COURS.load(Ordering::SeqCst) {
        ANNULE.store(true, Ordering::SeqCst);
        true
    } else {
        false
    }
}

fn emettre_fin(fin: &Fin) {
    journal::info(
        "flux",
        &format!(
            "Glisser {} : {} ({} fichier(s), effet {}, cible {}{}){}",
            fin.jeton,
            fin.resultat,
            fin.fichiers,
            fin.effet,
            fin.cible,
            fin.application.as_deref().map(|a| format!(" « {a} »")).unwrap_or_default(),
            fin.message.as_deref().map(|m| format!(" : {m}")).unwrap_or_default()
        ),
    );
    if let Some(app) = APP.get() {
        let _ = app.emit(EVENEMENT_FIN, fin);
    }
}

#[cfg(not(windows))]
fn poster() -> Result<(), String> {
    Err("Glisser vers une autre application : disponible sous Windows seulement.".into())
}

/// Hors de Windows : rien à installer (la commande répond « Windows seulement »).
#[cfg(not(windows))]
pub fn installer(app: &AppHandle, _principale: isize) -> Result<(), String> {
    let _ = APP.set(app.clone());
    let _ = emettre_fin; // employé par la version Windows
    Ok(())
}

#[cfg(windows)]
pub use windows_impl::installer;

#[cfg(windows)]
use windows_impl::poster;

#[cfg(windows)]
mod windows_impl {
    use super::*;
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use windows::core::{implement, w, BOOL, HRESULT, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{
        CloseHandle, COLORREF, DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, DRAGDROP_S_USEDEFAULTCURSORS, GENERIC_READ, HWND, LPARAM, LRESULT, POINT, SIZE, S_OK, WPARAM,
    };
    use windows::Win32::Graphics::Gdi::{CreateDIBSection, DeleteObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS};
    use windows::Win32::Graphics::Imaging::{
        CLSID_WICImagingFactory, GUID_WICPixelFormat32bppPBGRA, IWICBitmapDecoder, IWICImagingFactory, WICBitmapInterpolationModeFant, WICConvertBitmapSource,
        WICDecodeMetadataCacheOnDemand,
    };
    use windows::Win32::System::Com::{CoCreateInstance, IDataObject, CLSCTX_INPROC_SERVER};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Ole::{DoDragDrop, IDropSource, IDropSource_Impl, OleInitialize, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_LINK, DROPEFFECT_NONE};
    use windows::Win32::System::SystemServices::{MK_LBUTTON, MK_RBUTTON, MODIFIERKEYS_FLAGS};
    use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::UI::Controls::CLR_NONE;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
    use windows::Win32::UI::Shell::Common::ITEMIDLIST;
    use windows::Win32::UI::Shell::{
        ILCreateFromPathW, ILFree, IDragSourceHelper, IDragSourceHelper2, IShellItemArray, SHCreateDataObject, SHCreateShellItemArrayFromIDLists, BHID_DataObject, CLSID_DragDropHelper,
        DSH_ALLOWDROPDESCRIPTIONTEXT, SHDRAGIMAGE,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, GetAncestor, GetCursorPos, GetSystemMetrics, GetWindowThreadProcessId, PostMessageW, RegisterClassExW, WindowFromPoint, GA_ROOT,
        HWND_MESSAGE, SM_SWAPBUTTON, WINDOW_EX_STYLE, WINDOW_STYLE, WM_APP, WNDCLASSEXW,
    };

    /// Message posté à la fenêtre de messages : « une demande de glisser attend ».
    const WM_GLISSER: u32 = WM_APP + 0x41;
    /// Repli de l'image de glisser : l'icône officielle d'AETHRYON.
    const ICONE: &[u8] = include_bytes!("../icons/128x128.png");

    /// Crée, sur le FIL PRINCIPAL (setup de Tauri), la fenêtre de messages qui lancera les glisser.
    pub fn installer(app: &AppHandle, principale: isize) -> Result<(), String> {
        let _ = APP.set(app.clone());
        FENETRE_PRINCIPALE.store(principale, Ordering::SeqCst);
        // SAFETY : appels Win32 sur le fil principal ; la classe et le titre sont des chaînes statiques.
        unsafe {
            // Déjà fait par tao pour sa fenêtre (glisser-déposer) : S_FALSE ici, sans effet.
            let _ = OleInitialize(None);
            let instance = GetModuleHandleW(PCWSTR::null()).map_err(|e| format!("Module introuvable ({e})."))?;
            let classe = w!("AETHRYON-flux-glisser");
            let wc = WNDCLASSEXW { cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32, lpfnWndProc: Some(procedure), hInstance: instance.into(), lpszClassName: classe, ..Default::default() };
            if RegisterClassExW(&wc) == 0 {
                return Err("Classe de la fenêtre de messages non enregistrée.".into());
            }
            let h = CreateWindowExW(WINDOW_EX_STYLE(0), classe, w!("AETHRYON flux"), WINDOW_STYLE(0), 0, 0, 0, 0, Some(HWND_MESSAGE), None, Some(instance.into()), None)
                .map_err(|e| format!("Fenêtre de messages non créée ({e})."))?;
            FENETRE_MESSAGES.store(h.0 as isize, Ordering::SeqCst);
        }
        Ok(())
    }

    pub(super) fn poster() -> Result<(), String> {
        let h = FENETRE_MESSAGES.load(Ordering::SeqCst);
        if h == 0 {
            return Err("Glisser indisponible : la fenêtre de messages n'a pas été créée.".into());
        }
        // SAFETY : HWND créé par `installer`, vivant pendant toute l'application.
        unsafe { PostMessageW(Some(HWND(h as *mut c_void)), WM_GLISSER, WPARAM(0), LPARAM(0)) }.map_err(|e| format!("Glisser non transmis au fil principal ({e})."))
    }

    unsafe extern "system" fn procedure(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if msg == WM_GLISSER {
            let prise = attente().take();
            if let Some((demande, tx)) = prise {
                let jeton = demande.jeton.clone();
                let fichiers = demande.chemins.len();
                // Jamais de panique à travers une fonction « system » (arrêt du processus) : elle devient une erreur.
                let fin = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| executer(demande, &tx))).unwrap_or_else(|_| {
                    let _ = tx.send(Err("Erreur interne pendant le glisser.".into()));
                    Fin { jeton, resultat: "erreur", effet: "aucun", cible: "inconnue", application: None, fichiers, message: Some("Erreur interne pendant le glisser.".into()) }
                });
                ANNULE.store(false, Ordering::SeqCst);
                EN_COURS.store(false, Ordering::SeqCst);
                emettre_fin(&fin);
            }
            return LRESULT(0);
        }
        // SAFETY : traitement par défaut de Windows.
        unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
    }

    /// IDList du Shell, libérées à la fin du glisser.
    struct Idlists(Vec<*mut ITEMIDLIST>);
    impl Drop for Idlists {
        fn drop(&mut self) {
            for p in self.0.drain(..) {
                // SAFETY : chaque pointeur vient d'ILCreateFromPathW et n'est libéré qu'une fois.
                unsafe { ILFree(Some(p as *const ITEMIDLIST)) };
            }
        }
    }

    fn large(p: &Path) -> Vec<u16> {
        p.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    #[implement(IDropSource)]
    struct SourceAethryon {
        /// Bouton logique tenu au départ (MK_LBUTTON, ou MK_RBUTTON si le glisser part du bouton droit).
        bouton: MODIFIERKEYS_FLAGS,
    }

    #[allow(non_snake_case)]
    impl IDropSource_Impl for SourceAethryon_Impl {
        fn QueryContinueDrag(&self, echap: BOOL, etat: MODIFIERKEYS_FLAGS) -> HRESULT {
            if echap.as_bool() || ANNULE.load(Ordering::SeqCst) {
                DRAGDROP_S_CANCEL
            } else if (etat & self.bouton).0 == 0 {
                DRAGDROP_S_DROP
            } else {
                S_OK
            }
        }
        fn GiveFeedback(&self, _effet: DROPEFFECT) -> HRESULT {
            DRAGDROP_S_USEDEFAULTCURSORS
        }
    }

    /// Objet de données du Shell pour ces fichiers (le même que l'Explorateur : CF_HDROP, liste d'IDList…). Les IDList
    /// restent vivantes jusqu'à la fin du glisser (`Idlists` les libère).
    enum ErreurDonnees {
        Introuvable(String),
        Shell(windows::core::Error),
    }

    fn objet_de_donnees(chemins: &[PathBuf]) -> Result<(IDataObject, Idlists), ErreurDonnees> {
        // SAFETY : chaînes UTF-16 terminées par zéro ; chaque IDList est libérée une seule fois par `Idlists`.
        unsafe {
            let mut idlists = Idlists(Vec::with_capacity(chemins.len()));
            for c in chemins {
                let l = large(c);
                let p = ILCreateFromPathW(PCWSTR(l.as_ptr()));
                if p.is_null() {
                    return Err(ErreurDonnees::Introuvable(c.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()));
                }
                idlists.0.push(p);
            }
            let refs: Vec<*const ITEMIDLIST> = idlists.0.iter().map(|p| *p as *const ITEMIDLIST).collect();
            // Voie de l'Explorateur (tableau d'éléments du Shell) ; repli : le même objet du Shell construit directement à
            // partir des IDList absolues (dossier parent : le Bureau). Wine 8 n'implémente ni l'une ni l'autre (E_NOTIMPL).
            let donnees = SHCreateShellItemArrayFromIDLists(&refs)
                .and_then(|t: IShellItemArray| t.BindToHandler(None, &BHID_DataObject))
                .or_else(|_| SHCreateDataObject(None, Some(&refs), None::<&IDataObject>))
                .map_err(ErreurDonnees::Shell)?;
            Ok((donnees, idlists))
        }
    }

    fn fin(d: &Demande, resultat: &'static str, message: Option<String>) -> Fin {
        Fin { jeton: d.jeton.clone(), resultat, effet: "aucun", cible: "inconnue", application: None, fichiers: d.chemins.len(), message }
    }

    /// Bouton LOGIQUE tenu (les boutons physiques sont inversés pour les gauchers : SM_SWAPBUTTON).
    fn bouton_tenu() -> Option<MODIFIERKEYS_FLAGS> {
        // SAFETY : lectures d'état sans effet.
        unsafe {
            let gauche = GetAsyncKeyState(VK_LBUTTON.0 as i32) < 0;
            let droit = GetAsyncKeyState(VK_RBUTTON.0 as i32) < 0;
            let inverse = GetSystemMetrics(SM_SWAPBUTTON) != 0;
            let (logique_gauche, logique_droit) = if inverse { (droit, gauche) } else { (gauche, droit) };
            if logique_gauche {
                Some(MK_LBUTTON)
            } else if logique_droit {
                Some(MK_RBUTTON)
            } else {
                None
            }
        }
    }

    fn executer(d: Demande, tx: &mpsc::Sender<Result<(), String>>) -> Fin {
        let Some(bouton) = bouton_tenu() else {
            // Le bouton a été relâché avant que le fil principal ne prenne la demande : rien n'est glissé.
            let _ = tx.send(Ok(()));
            return fin(&d, "annule", Some("Bouton de la souris relâché avant le début du glisser.".into()));
        };
        // SAFETY : COM/OLE initialisés sur ce fil (STA de tao) ; chaque objet COM est libéré à la fin de la portée ;
        // les IDList sont gardées vivantes jusqu'après DoDragDrop.
        unsafe {
            let (donnees, idlists) = match objet_de_donnees(&d.chemins) {
                Ok(x) => x,
                Err(e) => {
                    let m = match e {
                        ErreurDonnees::Introuvable(nom) => format!("Le Shell ne trouve pas « {nom} »."),
                        ErreurDonnees::Shell(e) => format!("Objet de données du Shell indisponible (0x{:08X}).", e.code().0 as u32),
                    };
                    let _ = tx.send(Err(m.clone()));
                    return fin(&d, "erreur", Some(m));
                }
            };
            // Image de glisser (facultative : sans elle, Windows montre le curseur « + Copier »).
            let aide: windows::core::Result<IDragSourceHelper> = CoCreateInstance(&CLSID_DragDropHelper, None, CLSCTX_INPROC_SERVER);
            if let Ok(aide) = aide {
                if let Ok(aide2) = windows::core::Interface::cast::<IDragSourceHelper2>(&aide) {
                    let _ = aide2.SetFlags(DSH_ALLOWDROPDESCRIPTIONTEXT.0 as u32);
                }
                if let Some(image) = image_glisser(d.miniature.as_deref()) {
                    if aide.InitializeFromBitmap(&image, &donnees).is_err() {
                        let _ = DeleteObject(image.hbmpDragImage.into());
                    }
                }
            }
            let source: IDropSource = SourceAethryon { bouton }.into();
            let _ = tx.send(Ok(()));
            let mut effet = DROPEFFECT_NONE;
            // Copie ou lien SEULEMENT : jamais de déplacement hors du dossier surveillé.
            let hr = DoDragDrop(&donnees, &source, DROPEFFECT(DROPEFFECT_COPY.0 | DROPEFFECT_LINK.0), &mut effet);
            drop(idlists);
            let resultat = if hr == DRAGDROP_S_DROP && effet != DROPEFFECT_NONE {
                "depose"
            } else if hr == DRAGDROP_S_DROP || hr == DRAGDROP_S_CANCEL {
                "annule"
            } else {
                "erreur"
            };
            let effet_txt = if effet.0 & DROPEFFECT_COPY.0 != 0 {
                "copie"
            } else if effet.0 & DROPEFFECT_LINK.0 != 0 {
                "lien"
            } else {
                "aucun"
            };
            let (cible, application) = cible_sous_curseur(resultat == "depose");
            let message = match resultat {
                "erreur" => Some(format!("DoDragDrop a échoué (0x{:08X}).", hr.0 as u32)),
                "annule" if ANNULE.load(Ordering::SeqCst) => Some("Annulé par AETHRYON.".into()),
                _ => None,
            };
            Fin { jeton: d.jeton.clone(), resultat, effet: effet_txt, cible, application, fichiers: d.chemins.len(), message }
        }
    }

    /// Fenêtre sous le curseur au moment du dépôt : la nôtre (`interne`) ou celle d'une autre application, dont on
    /// donne le nom d'exécutable (sans dossier) seulement après un dépôt accepté.
    fn cible_sous_curseur(avec_application: bool) -> (&'static str, Option<String>) {
        // SAFETY : lectures d'état de fenêtres ; le descripteur de processus est fermé.
        unsafe {
            let mut pt = POINT::default();
            if GetCursorPos(&mut pt).is_err() {
                return ("inconnue", None);
            }
            let h = WindowFromPoint(pt);
            if h.is_invalid() {
                return ("inconnue", None);
            }
            let racine = GetAncestor(h, GA_ROOT);
            if racine.0 as isize == FENETRE_PRINCIPALE.load(Ordering::SeqCst) && !racine.is_invalid() {
                return ("interne", None);
            }
            if !avec_application {
                return ("externe", None);
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(h, Some(&mut pid));
            if pid == 0 {
                return ("externe", None);
            }
            let Ok(p) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return ("externe", None) };
            let mut tampon = [0u16; 1024];
            let mut n = tampon.len() as u32;
            let r = QueryFullProcessImageNameW(p, PROCESS_NAME_WIN32, PWSTR(tampon.as_mut_ptr()), &mut n);
            let _ = CloseHandle(p);
            if r.is_err() {
                return ("externe", None);
            }
            let chemin = String::from_utf16_lossy(&tampon[..n as usize]);
            ("externe", chemin.rsplit(['\\', '/']).next().map(|s| s.chars().take(80).collect()))
        }
    }

    /// Image de glisser : la miniature du média (JPEG 480 px) réduite à 200 px, ou l'icône d'AETHRYON. Décodage et
    /// réduction par WIC (Windows), pixels BGRA prémultipliés dans une section DIB ; aucune couleur rendue transparente.
    fn image_glisser(miniature: Option<&Path>) -> Option<SHDRAGIMAGE> {
        // SAFETY : appelée sur le fil principal, COM initialisé ; tampons dimensionnés exactement.
        unsafe {
            let fabrique: IWICImagingFactory = CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER).ok()?;
            let depuis_fichier = |m: &Path| -> Option<IWICBitmapDecoder> {
                let l = large(m);
                fabrique.CreateDecoderFromFilename(PCWSTR(l.as_ptr()), None, GENERIC_READ, WICDecodeMetadataCacheOnDemand).ok()
            };
            let depuis_icone = || -> Option<IWICBitmapDecoder> {
                let flux = fabrique.CreateStream().ok()?;
                flux.InitializeFromMemory(ICONE).ok()?;
                fabrique.CreateDecoderFromStream(&flux, std::ptr::null(), WICDecodeMetadataCacheOnDemand).ok()
            };
            let decodeur = miniature.and_then(depuis_fichier).or_else(depuis_icone)?;
            let cadre = decodeur.GetFrame(0).ok()?;
            let (mut l, mut h) = (0u32, 0u32);
            cadre.GetSize(&mut l, &mut h).ok()?;
            if l == 0 || h == 0 {
                return None;
            }
            let echelle = (IMAGE_MAX as f64 / l as f64).min(IMAGE_MAX as f64 / h as f64).min(1.0);
            let lc = ((l as f64 * echelle).round() as u32).max(1);
            let hc = ((h as f64 * echelle).round() as u32).max(1);
            let reduit = fabrique.CreateBitmapScaler().ok()?;
            reduit.Initialize(&cadre, lc, hc, WICBitmapInterpolationModeFant).ok()?;
            let converti = WICConvertBitmapSource(&GUID_WICPixelFormat32bppPBGRA, &reduit).ok()?;
            let mut pixels = vec![0u8; (lc as usize) * (hc as usize) * 4];
            converti.CopyPixels(std::ptr::null(), lc * 4, &mut pixels).ok()?;
            let info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: lc as i32,
                    biHeight: -(hc as i32), // de haut en bas, comme les pixels de WIC
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bits: *mut c_void = std::ptr::null_mut();
            let image = CreateDIBSection(None, &info, DIB_RGB_COLORS, &mut bits, None, 0).ok()?;
            if bits.is_null() {
                let _ = DeleteObject(image.into());
                return None;
            }
            std::ptr::copy_nonoverlapping(pixels.as_ptr(), bits as *mut u8, pixels.len());
            Some(SHDRAGIMAGE {
                sizeDragImage: SIZE { cx: lc as i32, cy: hc as i32 },
                // Curseur au milieu, aux trois quarts de la hauteur : l'image flotte au-dessus de la cible visée.
                ptOffset: POINT { x: lc as i32 / 2, y: (hc as i32 * 3) / 4 },
                hbmpDragImage: image,
                crColorKey: COLORREF(CLR_NONE as u32),
            })
        }
    }

    /// Essais de la PRÉPARATION du glisser (image, objet de données, source), compilés pour Windows et exécutés sous
    /// Wine par le banc : ils ne démontrent ni DoDragDrop, ni un dépôt dans Premiere Pro (aucune souris, aucune cible).
    #[cfg(test)]
    mod essais {
        use super::*;
        use windows::Win32::Foundation::E_NOTIMPL;
        use windows::Win32::Graphics::Gdi::{GetObjectW, BITMAP};
        use windows::Win32::System::Com::{DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL};
        use windows::Win32::System::Ole::{ReleaseStgMedium, CF_HDROP};
        use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};

        fn com() {
            // SAFETY : initialisation OLE du fil d'essai (S_FALSE si déjà faite).
            unsafe {
                let _ = OleInitialize(None);
            }
        }

        fn dossier(nom: &str) -> PathBuf {
            let d = std::env::temp_dir().join(format!("aethryon-glisser-{nom}-{}", std::process::id()));
            std::fs::create_dir_all(&d).unwrap();
            d
        }

        /// Dimensions et premier pixel (B, G, R, A prémultipliés) d'une image de glisser.
        fn lire(i: &SHDRAGIMAGE) -> (i32, i32, [u8; 4]) {
            let mut b = BITMAP::default();
            // SAFETY : section DIB créée par image_glisser ; lecture de sa description et d'un pixel.
            unsafe {
                assert!(GetObjectW(i.hbmpDragImage.into(), std::mem::size_of::<BITMAP>() as i32, Some(&mut b as *mut BITMAP as *mut c_void)) > 0);
                assert!(!b.bmBits.is_null() && b.bmBitsPixel == 32);
                let mut p = [0u8; 4];
                std::ptr::copy_nonoverlapping(b.bmBits as *const u8, p.as_mut_ptr(), 4);
                (b.bmWidth, b.bmHeight, p)
            }
        }

        #[test]
        fn image_de_glisser_depuis_la_miniature_et_repli() {
            com();
            let d = dossier("image");
            let jpeg = d.join("miniature.jpg");
            std::fs::write(&jpeg, include_bytes!("../../e2e/fixtures/coucher-1s.jpg")).unwrap();
            let i = image_glisser(Some(&jpeg)).expect("miniature décodée et réduite par WIC");
            let (l, h, p) = lire(&i);
            assert_eq!((i.sizeDragImage.cx, l), (200, 200), "réduite à 200 px de large");
            assert!(h > 0 && h <= 200 && i.sizeDragImage.cy == h, "{h}");
            assert_eq!(p[3], 255, "JPEG opaque : alpha 255, aucune couleur rendue transparente");
            assert_eq!(i.crColorKey.0, CLR_NONE as u32);
            assert_eq!((i.ptOffset.x, i.ptOffset.y), (100, (h * 3) / 4));
            // SAFETY : image créée ici, jamais confiée à IDragSourceHelper.
            unsafe {
                let _ = DeleteObject(i.hbmpDragImage.into());
            }
            for absente in [None, Some(d.join("absente.jpg"))] {
                let r = image_glisser(absente.as_deref()).expect("repli : icône d'AETHRYON");
                assert_eq!((r.sizeDragImage.cx, r.sizeDragImage.cy), (128, 128));
                // SAFETY : idem.
                unsafe {
                    let _ = DeleteObject(r.hbmpDragImage.into());
                }
            }
            let _ = std::fs::remove_dir_all(&d);
        }

        #[test]
        fn objet_de_donnees_du_shell_porte_nos_chemins() {
            com();
            let d = dossier("donnees");
            let a = d.join("Soirée 🎬 — « été ».mp4");
            let b = d.join("Nappe.wav");
            std::fs::write(&a, b"a").unwrap();
            std::fs::write(&b, b"b").unwrap();
            let (o, _idlists) = match objet_de_donnees(&[a.clone(), b.clone()]) {
                Ok(x) => x,
                Err(ErreurDonnees::Shell(e)) if e.code() == E_NOTIMPL => {
                    // Ni l'une ni l'autre voie sur ce système : rien à vérifier ici (le dire, sans échouer).
                    eprintln!("objet de données du Shell non fourni par ce système (E_NOTIMPL)");
                    return;
                }
                Err(ErreurDonnees::Shell(e)) => panic!("Shell : 0x{:08X}", e.code().0 as u32),
                Err(ErreurDonnees::Introuvable(n)) => panic!("introuvable : {n}"),
            };
            let format = FORMATETC { cfFormat: CF_HDROP.0, ptd: std::ptr::null_mut(), dwAspect: DVASPECT_CONTENT.0, lindex: -1, tymed: TYMED_HGLOBAL.0 as u32 };
            // SAFETY : lecture du CF_HDROP comme le fait wry au dépôt, puis libération du support.
            unsafe {
                let mut m = o.GetData(&format).expect("CF_HDROP fourni");
                assert!(m.pUnkForRelease.is_none(), "support possédé par l'appelant (wry le libère par DragFinish)");
                let h = HDROP(m.u.hGlobal.0 as _);
                let n = DragQueryFileW(h, 0xFFFF_FFFF, None);
                let mut vus = Vec::new();
                for k in 0..n {
                    let longueur = DragQueryFileW(h, k, None) as usize;
                    let mut t = vec![0u16; longueur + 1];
                    DragQueryFileW(h, k, Some(&mut t));
                    vus.push(String::from_utf16_lossy(&t[..longueur]));
                }
                ReleaseStgMedium(&mut m);
                let noms: Vec<String> = vus.iter().map(|v| v.rsplit('\\').next().unwrap_or("").to_string()).collect();
                assert_eq!(noms, ["Soirée 🎬 — « été ».mp4", "Nappe.wav"], "{vus:?}");
            }
            let _ = std::fs::remove_dir_all(&d);
        }

        #[test]
        fn source_de_glisser_copie_annule_ou_depose() {
            let s: IDropSource = SourceAethryon { bouton: MK_LBUTTON }.into();
            // SAFETY : appels de l'interface COM créée ici.
            unsafe {
                assert_eq!(s.QueryContinueDrag(true, MK_LBUTTON), DRAGDROP_S_CANCEL, "Échap");
                assert_eq!(s.QueryContinueDrag(false, MODIFIERKEYS_FLAGS(0)), DRAGDROP_S_DROP, "bouton relâché");
                assert_eq!(s.QueryContinueDrag(false, MK_LBUTTON), S_OK, "bouton tenu");
                assert_eq!(s.QueryContinueDrag(false, MK_RBUTTON), DRAGDROP_S_DROP, "autre bouton seulement");
                ANNULE.store(true, Ordering::SeqCst);
                assert_eq!(s.QueryContinueDrag(false, MK_LBUTTON), DRAGDROP_S_CANCEL, "annulation demandée");
                ANNULE.store(false, Ordering::SeqCst);
                assert_eq!(s.GiveFeedback(DROPEFFECT_COPY), DRAGDROP_S_USEDEFAULTCURSORS);
            }
            let d = SourceAethryon { bouton: MK_RBUTTON };
            let s2: IDropSource = d.into();
            // SAFETY : idem.
            unsafe {
                assert_eq!(s2.QueryContinueDrag(false, MK_RBUTTON), S_OK);
            }
        }
    }
}

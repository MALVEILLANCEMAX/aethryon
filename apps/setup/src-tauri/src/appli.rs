//! Fenêtre du setup (Tauri 2, WebView2) : 960 × 640, sans cadre, fond obsidienne dès le premier pixel, montrée
//! seulement après le premier rendu de l'interface. Instance unique. Les opérations longues tournent hors du fil
//! de l'interface et envoient leur avancement réel (événement « avancement »). NON TESTÉ SOUS WINDOWS.

use crate::{charger, dwm, environnement, Arguments};
use aethryon_setup_moteur::charge::Charge;
use aethryon_setup_moteur::desinstallation;
use aethryon_setup_moteur::detection::{self, Detection};
use aethryon_setup_moteur::journal::Journal;
use aethryon_setup_moteur::operations::{executer, Avancement, Demande, Operation};
use aethryon_setup_moteur::plateforme::Environnement;
use aethryon_setup_moteur::session::{self, EtatInitial};
use aethryon_setup_moteur::{dossier_installation, Options};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

#[derive(Clone)]
pub struct Etat {
    env: Environnement,
    charge: Arc<Result<Charge, String>>,
    amorce: Option<PathBuf>,
    demande: String,
    journal: Journal,
    annuler: Arc<AtomicBool>,
    occupe: Arc<AtomicBool>,
    manuel: Arc<Mutex<Option<PathBuf>>>,
    montree: Arc<AtomicBool>,
}

impl Etat {
    fn charge(&self) -> Result<&Charge, String> {
        self.charge.as_ref().as_ref().map_err(|e| e.clone())
    }
}

fn montrer(w: &WebviewWindow, e: &Etat) {
    if e.montree.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Ok(h) = w.hwnd() {
        for l in dwm::appliquer(h.0 as isize, dwm::FOND) {
            e.journal.info(&l);
        }
    }
    let _ = w.show();
    let _ = w.set_focus();
}

#[tauri::command]
fn etat_initial(e: State<'_, Etat>) -> Result<EtatInitial, String> {
    let c = e.charge()?;
    let manuel = e.manuel.lock().map(|m| m.clone()).unwrap_or(None);
    Ok(session::etat_initial(&e.env, c, &e.demande, manuel.as_deref(), e.journal.chemin().map(|p| p.display().to_string())))
}

#[tauri::command]
fn detecter(e: State<'_, Etat>, exe_manuel: Option<String>) -> Result<Detection, String> {
    let c = e.charge()?;
    let m = exe_manuel.map(PathBuf::from);
    if let Ok(mut x) = e.manuel.lock() {
        *x = m.clone();
    }
    Ok(detection::detecter(&e.env, &c.manifeste.extension.hote_ppro, m.as_deref()))
}

#[tauri::command]
async fn choisir_dossier(app: AppHandle) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().set_title("Dossier des médias AETHRYON").blocking_pick_folder().and_then(|f| f.into_path().ok()).map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
async fn choisir_premiere(app: AppHandle) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().set_title("Dossier qui contient Adobe Premiere Pro.exe").blocking_pick_folder().and_then(|f| f.into_path().ok()).map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
fn espace_libre(e: State<'_, Etat>, chemin: String) -> Option<u64> {
    // Le dossier n'existe peut-être pas encore : on mesure le premier parent existant.
    let mut p = PathBuf::from(chemin);
    loop {
        if p.exists() {
            return e.env.systeme.espace_libre(&p);
        }
        if !p.pop() {
            return None;
        }
    }
}

#[tauri::command]
async fn lancer(app: AppHandle, e: State<'_, Etat>, operation: String, options: Options) -> Result<Avancement, String> {
    let e = e.inner().clone();
    if e.occupe.swap(true, Ordering::SeqCst) {
        return Err("Une opération est déjà en cours.".into());
    }
    e.annuler.store(false, Ordering::SeqCst);
    let op = match operation.as_str() {
        "reparer" => Operation::Reparer,
        "mettreAJour" => Operation::MettreAJour,
        _ => Operation::Installer,
    };
    let r = tauri::async_runtime::spawn_blocking(move || {
        let c = e.charge()?;
        let d = Demande { operation: op, options, amorce: e.amorce.clone(), annuler: e.annuler.clone() };
        let av = executer(&e.env, c, &d, &e.journal, &mut |a| {
            let _ = app.emit("avancement", a);
        });
        e.occupe.store(false, Ordering::SeqCst);
        Ok(av)
    })
    .await
    .map_err(|x| x.to_string())?;
    r
}

#[tauri::command]
fn annuler(e: State<'_, Etat>) {
    e.journal.avert("Annulation demandée par l'utilisateur");
    e.annuler.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn inventaire_medias(e: State<'_, Etat>, chemin: String) -> (u64, u64) {
    desinstallation::inventaire_medias(e.env.fs.as_ref(), Path::new(&chemin))
}

#[tauri::command]
async fn desinstaller(app: AppHandle, e: State<'_, Etat>, garder_medias: bool, garder_navigateur: bool) -> Result<Avancement, String> {
    let e = e.inner().clone();
    if e.occupe.swap(true, Ordering::SeqCst) {
        return Err("Une opération est déjà en cours.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let av = desinstallation::desinstaller(&e.env, garder_medias, garder_navigateur, &e.journal, &mut |a| {
            let _ = app.emit("avancement", a);
        });
        e.occupe.store(false, Ordering::SeqCst);
        av
    })
    .await
    .map_err(|x| x.to_string())
}

#[tauri::command]
fn ouvrir(e: State<'_, Etat>, quoi: String) -> Result<(), String> {
    let explorer = |p: &Path| e.env.systeme.lancer(Path::new("explorer.exe"), &[p.display().to_string()]);
    match quoi.as_str() {
        "premiere" => {
            let c = e.charge()?;
            let d = detection::detecter(&e.env, &c.manifeste.extension.hote_ppro, None);
            let p = d.principale.ok_or("Premiere Pro n'a pas été trouvé.")?;
            e.env.systeme.lancer(Path::new(&p.exe), &[])
        }
        "aethryon" => {
            let exe = dossier_installation(&e.env).join(detection::DESKTOP_EXE);
            if !exe.is_file() {
                return Err("AETHRYON Desktop n'est pas installé.".into());
            }
            e.env.systeme.lancer(&exe, &[])
        }
        "journal" => {
            let j = e.journal.chemin().cloned().unwrap_or_else(|| e.env.emplacements.journaux());
            e.env.systeme.lancer(Path::new("notepad.exe"), &[j.display().to_string()])
        }
        "navigateur" => {
            let d = aethryon_setup_moteur::navigateur::dossier(&e.env);
            if !e.env.fs.est_dossier(&d) {
                return Err("L'extension navigateur n'est pas dans son dossier.".into());
            }
            explorer(&d)
        }
        "medias" => {
            let c = e.env.emplacements.dossier_medias_par_defaut();
            let d = aethryon_setup_moteur::config_desktop::dossier_medias_actuel(&e.env).map(PathBuf::from).unwrap_or(c);
            explorer(&d)
        }
        _ => Err("Ouverture inconnue.".into()),
    }
}

#[tauri::command]
fn fenetre(w: WebviewWindow, e: State<'_, Etat>, action: String) {
    match action.as_str() {
        "reduire" => {
            let _ = w.minimize();
        }
        // Pendant une opération, la fermeture passe par l'interface (« Arrêter et tout remettre en l'état »).
        "fermer" if !e.occupe.load(Ordering::SeqCst) => {
            e.journal.info("Fermeture du setup");
            w.app_handle().exit(0);
        }
        _ => {}
    }
}

#[tauri::command]
fn pret(w: WebviewWindow, e: State<'_, Etat>) {
    montrer(&w, e.inner());
}

pub fn demarrer(args: Arguments) {
    let env = environnement();
    let journal = Journal::fichier(env.fs.clone(), env.emplacements.journaux());
    let charge = charger(&args).map(|(c, _)| c);
    let demande = args.demande();
    journal.info(&format!(
        "=== AETHRYON Setup (interface) : demande « {demande} », charge {}",
        charge.as_ref().map(|c| c.manifeste.version.clone()).unwrap_or_else(|e| format!("ILLISIBLE ({e})"))
    ));
    {
        let j = journal.clone();
        std::panic::set_hook(Box::new(move |p| j.erreur(&format!("Arrêt inattendu : {p}"))));
    }
    let etat = Etat {
        env,
        charge: Arc::new(charge),
        amorce: args.valeur("--amorce").map(PathBuf::from),
        demande: demande.into(),
        journal,
        annuler: Arc::new(AtomicBool::new(false)),
        occupe: Arc::new(AtomicBool::new(false)),
        manuel: Arc::new(Mutex::new(None)),
        montree: Arc::new(AtomicBool::new(false)),
    };
    let reduit = args.a("--animations-reduites");
    let resultat = tauri::Builder::default()
        // Instance unique (premier greffon) : un second lancement ramène la fenêtre ouverte au premier plan.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(etat.clone())
        .setup(move |app| {
            if let Some(w) = app.get_webview_window("main") {
                if reduit {
                    let _ = w.eval("document.documentElement.dataset.motion='reduced'");
                }
                // Filet de sécurité : si l'interface ne signale pas son premier rendu, la fenêtre apparaît quand même.
                let w2 = w.clone();
                let e2 = etat.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(4));
                    if !e2.montree.load(Ordering::SeqCst) {
                        e2.journal.avert("Interface lente à s'afficher : fenêtre montrée par le filet de sécurité");
                        let w3 = w2.clone();
                        let _ = w2.run_on_main_thread(move || montrer(&w3, &e2));
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            etat_initial,
            detecter,
            choisir_dossier,
            choisir_premiere,
            espace_libre,
            lancer,
            annuler,
            inventaire_medias,
            desinstaller,
            ouvrir,
            fenetre,
            pret
        ])
        .run(tauri::generate_context!());
    if let Err(e) = resultat {
        let env = environnement();
        Journal::fichier(env.fs.clone(), env.emplacements.journaux()).erreur(&format!("Interface impossible à ouvrir ({e}). WebView2 est-il installé ?"));
        std::process::exit(4);
    }
}

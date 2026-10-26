//! Application Tauri : fenêtre sans décorations (barre de titre dessinée par l'interface), zone de notification,
//! instance unique, notifications Windows, service d'arrière-plan du noyau. NON TESTÉ SOUS WINDOWS.

use crate::{commandes, commandes_cloud, commandes_index, commandes_musique};
use aethryon_noyau::index::{self, AvisIndex, IndexMedias};
use aethryon_noyau::musique::donnees::Magasin;
use aethryon_noyau::musique::imports::Imports;
use aethryon_noyau::cloud::Transferts;
use aethryon_noyau::coffre::Coffre;
use aethryon_noyau::compte::{self, GestionCompte, Serveur};
use aethryon_noyau::bibliotheque::Media;
use aethryon_noyau::chemins::Emplacements;
use aethryon_noyau::flux::{Accordes, Origine};
use aethryon_noyau::journal;
use aethryon_noyau::noms;
use aethryon_noyau::plateforme;
use aethryon_noyau::service::{Moteur, Notifieur, ResultatEnvoi, Service};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, WindowEvent};
use tauri_plugin_notification::NotificationExt;

/// État partagé avec les commandes.
pub struct EtatApp {
    pub service: OnceLock<Service>,
    /// `assistant`, `reparer` ou `normal`.
    pub mode: Mutex<String>,
    pub arriere_plan: bool,
    pub assistant_annule: Arc<AtomicBool>,
    pub quitter: AtomicBool,
    pub avis_zone_montre: AtomicBool,
    /// Chemins remis par le SYSTÈME (survol, dépôt sur la fenêtre, sélecteur de fichiers) : seuls ceux-là peuvent être
    /// classés ou importés (flux.rs). Jamais écrit sur le disque.
    pub accordes: Mutex<Accordes>,
    /// Imports de fichiers déposés en cours : lot → demande d'annulation.
    pub imports: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// Liaison au compte (clé « desktop » dans le coffre DPAPI, jamais remise à l'interface).
    pub compte: OnceLock<Arc<GestionCompte>>,
    /// Transferts d'AETHRYON Cloud (envois directs, téléchargements).
    pub cloud: OnceLock<Transferts>,
    /// Section MUSIQUE : bibliothèque musicale, playlists, historique, reprise (R\musique\).
    pub musique: OnceLock<Arc<Magasin>>,
    /// Imports autorisés d'AETHRYON Music suivis et rapatriés.
    pub imports_musique: OnceLock<Imports>,
    /// AETHRYON Index : scanner de médias locaux (index SQLite dans R\index ou l'emplacement choisi).
    pub index: OnceLock<IndexMedias>,
}

impl EtatApp {
    pub fn service(&self) -> Result<&Service, String> {
        self.service.get().ok_or_else(|| "Service AETHRYON pas encore démarré.".to_string())
    }

    pub fn accorder(&self, origine: Origine, chemins: &[String]) {
        self.accordes.lock().unwrap_or_else(|e| e.into_inner()).accorder(origine, chemins, std::time::Instant::now());
    }

    /// Parmi `chemins`, ceux que le système a remis (forme normalisée, comme l'identifiant d'index). Le verrou n'est
    /// tenu que le temps de ce tri, jamais pendant une copie.
    pub fn chemins_accordes(&self, chemins: &[String], pour_import: bool) -> HashSet<String> {
        let a = self.accordes.lock().unwrap_or_else(|e| e.into_inner());
        let t = std::time::Instant::now();
        chemins.iter().filter(|c| a.accorde(c, pour_import, t)).map(|c| noms::normaliser_pour_id(c)).collect()
    }
}

fn textes(chemins: &[PathBuf]) -> Vec<String> {
    chemins.iter().map(|p| p.to_string_lossy().into_owned()).collect()
}

struct NotifieurTauri {
    app: AppHandle,
}

fn fenetre_au_premier_plan(app: &AppHandle) -> bool {
    app.get_webview_window("main").map(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false)).unwrap_or(false)
}

fn notifier(app: &AppHandle, titre: &str, corps: &str) {
    if let Err(e) = app.notification().builder().title(titre).body(corps).show() {
        journal::avert("notification", &format!("Notification Windows non affichée ({e})"));
    }
}

impl Notifieur for NotifieurTauri {
    fn changement(&self, quoi: &str) {
        let _ = self.app.emit("changement", quoi);
        if quoi == "config" {
            autoriser_dossiers(&self.app);
        }
        // Bibliothèque unifiée : copie des médias d'index.json dans l'index (asynchrone ; le service n'est plus
        // verrouillé quand il prévient).
        if quoi == "bibliotheque" {
            let etat = self.app.state::<EtatApp>();
            if let (Some(ix), Some(s)) = (etat.index.get(), etat.service.get()) {
                ix.signaler_bibliotheque(s.medias());
            }
        }
    }
    fn media_pret(&self, m: &Media) {
        let _ = self.app.emit("media-pret", m);
        if !fenetre_au_premier_plan(&self.app) {
            notifier(&self.app, "Média prêt", &format!("{}.{} est dans la bibliothèque AETHRYON.", m.nom, m.ext));
        }
    }
    fn resultat_commande(&self, r: &ResultatEnvoi) {
        let _ = self.app.emit("resultat-commande", r);
        if fenetre_au_premier_plan(&self.app) {
            return;
        }
        let etat = self.app.state::<EtatApp>();
        let Some(s) = etat.service.get() else { return };
        let n = s.config().notifications;
        if r.ok && n.import_reussi {
            notifier(&self.app, "Importé dans Premiere Pro", &r.message);
        } else if !r.ok && n.erreurs {
            notifier(&self.app, "Import non effectué", &r.message);
        }
    }
    fn naviguer(&self, section: &str) {
        montrer(&self.app);
        let _ = self.app.emit("naviguer", section);
    }
}

/// Avis d'AETHRYON Index → événements de l'interface ; fin de scan notifiée seulement si la fenêtre est en arrière-plan.
struct AvisIndexTauri {
    app: AppHandle,
}

impl AvisIndex for AvisIndexTauri {
    fn progression(&self, p: &index::Progression) {
        let _ = self.app.emit("index-progression", p);
    }
    fn fin(&self, r: &index::Resume) {
        let _ = self.app.emit("index-fin", r);
        if !fenetre_au_premier_plan(&self.app) && r.etat == "termine" {
            notifier(
                &self.app,
                "Scan terminé",
                &format!("{} vidéos, {} audios, {} images{}.", r.medias.video, r.medias.audio, r.medias.image, if r.erreurs > 0 { format!(", {} erreurs", r.erreurs) } else { String::new() }),
            );
        }
    }
    fn changement(&self, quoi: &str) {
        let _ = self.app.emit("index-changement", quoi);
        if quoi == "reglages" {
            autoriser_dossiers(&self.app);
        }
    }
    fn enrichissement(&self, e: &index::Enrichissement) {
        let _ = self.app.emit("index-enrichissement", e);
    }
    fn migration(&self, m: &index::Migration) {
        let _ = self.app.emit("index-migration", m);
    }
}

pub fn montrer(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Le protocole `asset:` ne sert que la racine des échanges (miniatures) et les dossiers surveillés (lecteur intégré).
pub fn autoriser_dossiers(app: &AppHandle) {
    let etat = app.state::<EtatApp>();
    let Some(s) = etat.service.get() else { return };
    let scope = app.asset_protocol_scope();
    let _ = scope.allow_directory(s.emplacements().miniatures(), false);
    // Pochettes extraites par la section MUSIQUE (images seulement, jamais d'audio ici).
    let _ = scope.allow_directory(s.emplacements().racine.join("musique").join("pochettes"), false);
    for d in s.config().dossiers_surveilles {
        let _ = scope.allow_directory(&d, true);
    }
    // Miniatures de l'index (images seulement). Les médias scannés, eux, ne sont ouverts qu'un par un (index_apercu).
    if let Some(ix) = etat.index.get() {
        let _ = scope.allow_directory(ix.dossier_miniatures(), true);
    }
}

fn mode_depuis(args: &[String]) -> String {
    if args.iter().any(|a| a == "--reparer") {
        "reparer".into()
    } else if args.iter().any(|a| a == "--assistant") {
        "assistant".into()
    } else {
        "normal".into()
    }
}

pub fn lancer(args: Vec<String>) {
    let mode = mode_depuis(&args);
    let arriere_plan = args.iter().any(|a| a == "--arriere-plan");
    tauri::Builder::default()
        // Instance unique : doit être le premier greffon. Une seconde instance transmet ses arguments puis se ferme.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let m = mode_depuis(&argv);
            if m != "normal" {
                if let Some(e) = app.try_state::<EtatApp>() {
                    *e.mode.lock().unwrap_or_else(|x| x.into_inner()) = m.clone();
                }
                let _ = app.emit("mode", m);
            }
            montrer(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(EtatApp {
            service: OnceLock::new(),
            mode: Mutex::new(mode),
            arriere_plan,
            assistant_annule: Arc::new(AtomicBool::new(false)),
            quitter: AtomicBool::new(false),
            avis_zone_montre: AtomicBool::new(false),
            accordes: Mutex::new(Accordes::default()),
            imports: Mutex::new(HashMap::new()),
            compte: OnceLock::new(),
            cloud: OnceLock::new(),
            musique: OnceLock::new(),
            imports_musique: OnceLock::new(),
            index: OnceLock::new(),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let emp = Emplacements::depuis_environnement().ok_or("profil utilisateur introuvable")?;
            let exe = std::env::current_exe()?;
            let racine = emp.racine.clone();
            let dossier_config = emp.config.clone();
            let service = Service::demarrer(emp, plateforme::systeme(), Box::new(NotifieurTauri { app: handle.clone() }), exe);
            journal::info("appli", &format!("WebView2 {}", tauri::webview_version().unwrap_or_else(|_| "introuvable".into())));
            let etat = app.state::<EtatApp>();
            let _ = etat.service.set(service);
            // Compte relié et AETHRYON Cloud : adresse du site figée ; seule la page d'accord du Desktop peut être ouverte.
            let (h1, h2) = (handle.clone(), handle.clone());
            let gestion = GestionCompte::new(
                Serveur::production(),
                Coffre::sous(&racine),
                compte::nom_ordinateur(),
                aethryon_noyau::VERSION.into(),
                Box::new(move |e| {
                    let _ = h1.emit("compte", e);
                }),
                Box::new(|url| {
                    if !url.starts_with(&format!("{}/desktop/connecter?code=", compte::BASE_PRODUCTION)) {
                        return Err("adresse refusée".into());
                    }
                    plateforme::systeme().ouvrir(Path::new(url))
                }),
            );
            let _ = etat.cloud.set(Transferts::new(gestion.clone(), Box::new(move |t| {
                let _ = h2.emit("cloud-transfert", t);
            })));
            // 3.8.1 : conversions d'un lien (« Coller un lien », relais de l'extension vers Premiere Pro) avec la clé du
            // coffre, lue à chaque conversion ; adresse d'ytapi figée.
            if let Some(s) = etat.service.get() {
                let g = gestion.clone();
                s.installer_conversion(Moteur { api: aethryon_noyau::conversion::Api::production(), cle: Box::new(move || g.cle()) });
            }
            if gestion.etat().relie {
                let g = gestion.clone();
                std::thread::spawn(move || {
                    g.rafraichir();
                });
            }
            let mag = Arc::new(Magasin::sous(&racine));
            let h3 = handle.clone();
            let _ = etat.imports_musique.set(Imports::new(gestion.clone(), mag.clone(), Box::new(move |t| {
                let _ = h3.emit("musique-import", t);
            })));
            let _ = etat.musique.set(mag);
            let _ = etat.compte.set(gestion);
            // AETHRYON Index : réglages dans %APPDATA%\AETHRYON\index-medias.json, index dans R\index (déplaçable).
            let ix = IndexMedias::demarrer(&dossier_config, &racine, Box::new(index::volumes::VolumesSysteme), Box::new(AvisIndexTauri { app: handle.clone() }));
            if let Some(s) = etat.service.get() {
                ix.signaler_bibliotheque(s.medias());
            }
            let _ = etat.index.set(ix);
            autoriser_dossiers(&handle);
            // Écran de démarrage : la fenêtre peut s'ouvrir avant l'interface. Si le parcours d'installation va s'ouvrir
            // (même règle que App.tsx), elle prend sa taille dès maintenant : rien ne change de taille sous l'écran.
            if etat.mode.lock().map(|m| m.as_str() != "normal").unwrap_or(false) || etat.service.get().is_some_and(|s| !s.assistant_termine()) {
                let _ = commandes::mode_fenetre(handle.clone(), "assistant".into());
            }
            // Bordure blanche de Windows 11 : attributs DWM posés avant le premier affichage (voir dwm.rs).
            if let Some(w) = app.get_webview_window("main") {
                if let Ok(h) = w.hwnd() {
                    for l in crate::dwm::appliquer(h.0 as isize, crate::dwm::SANS_BORDURE) {
                        journal::info("fenetre", &l);
                    }
                    // Glisser natif vers Premiere Pro / l'Explorateur : fenêtre de messages créée ici, sur le fil principal.
                    if let Err(m) = crate::glisser::installer(&handle, h.0 as isize) {
                        journal::avert("flux", &m);
                    }
                }
            }
            // Filet de sécurité : si l'interface ne s'est pas signalée (erreur JavaScript), la fenêtre apparaît quand même.
            if !etat.arriere_plan {
                let h = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    if let Some(w) = h.get_webview_window("main") {
                        if !w.is_visible().unwrap_or(true) {
                            journal::avert("appli", "Interface non signalée après 5 s : fenêtre montrée par sécurité.");
                            let _ = w.show();
                        }
                    }
                });
            }

            let ouvrir = MenuItem::with_id(app, "ouvrir", "Ouvrir AETHRYON", true, None::<&str>)?;
            let dossier = MenuItem::with_id(app, "dossier", "Ouvrir le dossier des médias", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quitter = MenuItem::with_id(app, "quitter", "Quitter AETHRYON", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&ouvrir, &dossier, &sep, &quitter])?;
            // Menu natif : en place jusqu'à ce que le menu dessiné par AETHRYON soit prêt (zone.rs le retire alors), et
            // en repli s'il ne peut pas l'être. Clic gauche inchangé ; clic droit : menu dessiné s'il est prêt.
            let mut zone = TrayIconBuilder::with_id("principal")
                .tooltip("AETHRYON Desktop")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, ev| action_zone(app, ev.id().as_ref()))
                .on_tray_icon_event(|zone, ev| match ev {
                    TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } => {
                        crate::zone::cacher(zone.app_handle());
                        montrer(zone.app_handle())
                    }
                    TrayIconEvent::Click { button: MouseButton::Right, button_state: MouseButtonState::Up, position, rect, .. } => {
                        crate::zone::ouvrir(zone.app_handle(), position, rect)
                    }
                    _ => {}
                });
            // Petit logo officiel (16 à 24 px) pour la zone de notification ; repli sur l'icône de l'application.
            match tauri::image::Image::from_bytes(include_bytes!("../icons/zone-32.png")) {
                Ok(i) => zone = zone.icon(i),
                Err(_) => {
                    if let Some(icone) = app.default_window_icon() {
                        zone = zone.icon(icone.clone());
                    }
                }
            }
            zone.build(app)?;
            Ok(())
        })
        .on_window_event(|fenetre, ev| {
            if fenetre.label() == crate::zone::ETIQUETTE {
                crate::zone::evenement(fenetre, ev);
                return;
            }
            // Flux : le cœur note lui-même les chemins que le SYSTÈME remet (survol, dépôt). L'interface reçoit le même
            // événement et ne peut ensuite que renvoyer ces chemins-là (classement, import).
            if let WindowEvent::DragDrop(d) = ev {
                let etat = fenetre.app_handle().state::<EtatApp>();
                match d {
                    DragDropEvent::Enter { paths, .. } => etat.accorder(Origine::Survol, &textes(paths)),
                    DragDropEvent::Drop { paths, .. } => {
                        etat.accorder(Origine::Depot, &textes(paths));
                        journal::info("flux", &format!("Dépôt sur la fenêtre : {} élément(s).", paths.len()));
                    }
                    _ => {}
                }
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = ev {
                let app = fenetre.app_handle();
                let etat = app.state::<EtatApp>();
                if etat.quitter.load(Ordering::SeqCst) {
                    return;
                }
                // Avant la fin du premier parcours d'installation, fermer la fenêtre quitte AETHRYON (rien n'est réduit
                // dans la zone de notification tant que l'utilisateur n'a rien configuré).
                if etat.service.get().map(|s| !s.assistant_termine()).unwrap_or(true) {
                    quitter_app(app);
                    return;
                }
                // Fermer la fenêtre garde AETHRYON dans la zone de notification (surveillance et battement continuent).
                api.prevent_close();
                let _ = fenetre.hide();
                if !etat.avis_zone_montre.swap(true, Ordering::SeqCst) {
                    notifier(app, "AETHRYON reste disponible", "La surveillance continue. Rouvrez AETHRYON depuis la zone de notification.");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commandes::etat,
            commandes::mode_lancement,
            commandes::fenetre_prete,
            commandes::fenetre,
            commandes::mode_fenetre,
            commandes::config_modifier,
            commandes::choisir_dossier,
            commandes::choisir_fichiers,
            commandes::choisir_premiere,
            commandes::media_action,
            commandes::importer,
            commandes::a_analyser,
            commandes::analyse_enregistrer,
            commandes::ajouter_fichiers,
            commandes::dossier_ajouter,
            commandes::dossier_retirer,
            commandes::transferts_effacer,
            commandes::transfert_piloter,
            commandes::rescanner,
            commandes::redetecter,
            commandes::diagnostic,
            commandes::assistant_executer,
            commandes::assistant_annuler,
            commandes::assistant_fin,
            commandes::ouvrir_premiere,
            commandes::panneau_desinstaller,
            commandes::ouvrir_dossier,
            commandes::rapport_exporter,
            commandes::lancer_desinstalleur,
            commandes::quitter,
            commandes::webview2,
            commandes::maj_rechercher,
            commandes::maj_installer,
            commandes::reparer_avec_setup,
            commandes::ouvrir_page_setup,
            commandes::glisser_medias,
            commandes::glisser_annuler,
            commandes::flux_classer,
            commandes::importer_fichiers,
            commandes::importer_annuler,
            commandes::envoyer_vers_premiere,
            commandes_cloud::compte_etat,
            commandes_cloud::compte_relier,
            commandes_cloud::compte_annuler,
            commandes_cloud::compte_rafraichir,
            commandes_cloud::compte_deconnecter,
            commandes_cloud::convertir_lien,
            commandes_cloud::cloud_etat,
            commandes_cloud::cloud_objets,
            commandes_cloud::cloud_lien,
            commandes_cloud::cloud_supprimer,
            commandes_cloud::cloud_telecharger,
            commandes_cloud::cloud_envoyer,
            commandes_cloud::cloud_annuler,
            commandes_cloud::cloud_transferts,
            commandes_musique::musique_vue,
            commandes_musique::musique_playlists,
            commandes_musique::musique_historique_noter,
            commandes_musique::musique_historique_effacer,
            commandes_musique::musique_fiche_enregistrer,
            commandes_musique::musique_fiche_retirer,
            commandes_musique::musique_lecture,
            commandes_musique::musique_ouvrir_lien,
            commandes_musique::musique_connecteurs,
            commandes_musique::musique_analyser,
            commandes_musique::musique_rechercher,
            commandes_musique::musique_synchroniser,
            commandes_musique::musique_importer,
            commandes_musique::musique_imports,
            commandes_musique::musique_import_annuler,
            commandes_index::index_volumes,
            commandes_index::index_reglages,
            commandes_index::index_reglages_modifier,
            commandes_index::index_scan_lancer,
            commandes_index::index_scan_annuler,
            commandes_index::index_etat,
            commandes_index::index_resume,
            commandes_index::index_rechercher,
            commandes_index::bibliotheque_requete,
            commandes_index::index_media_action,
            commandes_index::index_apercu,
            commandes_index::index_miniatures_demander,
            commandes_index::index_analyse_enregistrer,
            commandes_index::index_emplacement_deplacer,
            commandes_index::index_everything,
            commandes_index::index_retirer,
            crate::zone::zone_menu_pret,
            crate::zone::zone_menu_fermer,
            crate::zone::zone_menu_choisir,
        ])
        .run(tauri::generate_context!())
        .expect("lancement d'AETHRYON Desktop impossible");
}

/// Actions du menu de la zone de notification, natif ou dessiné (zone.rs) : les mêmes trois.
pub fn action_zone(app: &AppHandle, id: &str) {
    match id {
        "ouvrir" => montrer(app),
        "dossier" => {
            if let Some(s) = app.state::<EtatApp>().service.get() {
                let d = s.config().dossier_medias;
                let _ = s.plateforme().ouvrir(Path::new(&d));
            }
        }
        "quitter" => quitter_app(app),
        _ => {}
    }
}

pub fn quitter_app(app: &AppHandle) {
    let etat = app.state::<EtatApp>();
    etat.quitter.store(true, Ordering::SeqCst);
    if let Some(s) = etat.service.get() {
        s.arreter();
    }
    // Scan en cours : annulé proprement (lot validé, rien n'est marqué absent) ; repris au prochain lancement.
    if let Some(ix) = etat.index.get() {
        ix.arreter();
        ix.attendre_scan(std::time::Duration::from_secs(3));
    }
    journal::info("appli", "Fermeture demandée par l'utilisateur.");
    app.exit(0);
}

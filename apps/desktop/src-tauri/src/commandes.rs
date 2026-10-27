//! Commandes appelées par l'interface React (`invoke`). Les médias sont désignés par leur identifiant d'index ;
//! l'interface ne fournit jamais un chemin à ouvrir ou à afficher. NON TESTÉ SOUS WINDOWS.

use crate::appli::{self, EtatApp};
use aethryon_noyau::assistant::{self, Contexte, Diagnostic, Options, Rapport};
use aethryon_noyau::bibliotheque::{AAnalyser, AnalyseWeb};
use aethryon_noyau::config::Config;
use aethryon_noyau::flux::{self, Bilan, Classement, Origine};
use aethryon_noyau::plateforme::{self, ResultatUpia};
use aethryon_noyau::service::{Envoi, Instantane};
use aethryon_noyau::{journal, noms};
use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, State};
use tauri_plugin_dialog::DialogExt;

type R<T> = Result<T, String>;

#[tauri::command]
pub fn etat(e: State<EtatApp>) -> R<Instantane> {
    Ok(e.service()?.instantane())
}

#[tauri::command]
pub fn mode_lancement(e: State<EtatApp>) -> String {
    e.mode.lock().map(|m| m.clone()).unwrap_or_else(|x| x.into_inner().clone())
}

/// L'interface est dessinée, ou l'écran de démarrage est montré (src/lib/demarrage.ts) : on montre la fenêtre (sauf
/// lancement en arrière-plan au démarrage de Windows).
#[tauri::command]
pub fn fenetre_prete(app: AppHandle, e: State<EtatApp>) {
    if !e.arriere_plan || e.mode.lock().map(|m| m.as_str() != "normal").unwrap_or(false) {
        appli::montrer(&app);
    }
    // Menu dessiné de la zone de notification : créé une fois, plus tard, sur un fil à part (zone.rs).
    crate::zone::prechauffer(&app);
}

/// Égide : fond natif de la fenêtre principale = fond (« canvas ») du thème appliqué, pour qu'un agrandissement ou un
/// redimensionnement ne montre jamais une bande d'une autre couleur avant que WebView2 repeigne. Seulement une couleur
/// `#RRGGBB` (la préférence elle-même reste dans le stockage local de WebView2, lue par theme-boot.js).
#[tauri::command]
pub fn fenetre_fond(app: AppHandle, couleur: String) -> R<()> {
    let c = aethryon_noyau::config::couleur_hex(&couleur).ok_or("couleur refusée")?;
    let w = app.get_webview_window("main").ok_or("fenêtre absente")?;
    w.set_background_color(Some(tauri::window::Color(c[0], c[1], c[2], 255))).map_err(|e| e.to_string())
}

/// Boutons de légende dessinés : `reduire`, `agrandir` (bascule), `fermer` (réduit dans la zone de notification).
#[tauri::command]
pub fn fenetre(app: AppHandle, action: String) -> R<()> {
    let w = app.get_webview_window("main").ok_or("fenêtre absente")?;
    match action.as_str() {
        "reduire" => w.minimize().map_err(|e| e.to_string()),
        "agrandir" => {
            if w.is_maximized().unwrap_or(false) {
                w.unmaximize().map_err(|e| e.to_string())
            } else {
                w.maximize().map_err(|e| e.to_string())
            }
        }
        "fermer" => w.close().map_err(|e| e.to_string()),
        _ => Err("action inconnue".into()),
    }
}

/// `assistant` : 960 × 640, taille fixe ; `app` : 1280 × 800, redimensionnable (900 × 640 au moins).
#[tauri::command]
pub fn mode_fenetre(app: AppHandle, mode: String) -> R<()> {
    let w = app.get_webview_window("main").ok_or("fenêtre absente")?;
    let (l, h, redim) = if mode == "assistant" { (960.0, 640.0, false) } else { (1280.0, 800.0, true) };
    let _ = w.unmaximize();
    let _ = w.set_min_size(Some(LogicalSize::new(if redim { 900.0 } else { l }, if redim { 640.0 } else { h })));
    w.set_size(LogicalSize::new(l, h)).map_err(|e| e.to_string())?;
    let _ = w.set_resizable(redim);
    let _ = w.set_maximizable(redim);
    let _ = w.center();
    Ok(())
}

#[tauri::command]
pub fn config_modifier(e: State<EtatApp>, modif: Value) -> R<Config> {
    e.service()?.modifier_config(&modif)
}

#[tauri::command]
pub async fn choisir_dossier(app: AppHandle, titre: String) -> Option<String> {
    app.dialog().file().set_title(titre).blocking_pick_folder().and_then(|f| f.into_path().ok()).map(|p| p.to_string_lossy().into_owned())
}

/// Sélecteur de fichiers de Windows. Les chemins choisis sont notés comme « remis par le système » : `importer_fichiers`
/// les accepte ensuite (comme ceux d'un dépôt sur la fenêtre).
#[tauri::command]
pub async fn choisir_fichiers(app: AppHandle) -> Vec<String> {
    let v: Vec<String> = app
        .dialog()
        .file()
        .set_title("Ajouter des médias à AETHRYON")
        .add_filter("Médias", &["mp4", "mov", "m4v", "webm", "mkv", "mp3", "wav", "m4a", "aac", "png", "jpg", "jpeg", "gif"])
        .blocking_pick_files()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|f| f.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    app.state::<EtatApp>().accorder(Origine::Selecteur, &v);
    v
}

/// « Premiere Pro est installé dans un autre dossier » : l'utilisateur désigne le dossier qui contient l'exe.
#[tauri::command]
pub async fn choisir_premiere(app: AppHandle) -> R<Option<String>> {
    let Some(d) = app.dialog().file().set_title("Dossier qui contient Adobe Premiere Pro.exe").blocking_pick_folder().and_then(|f| f.into_path().ok()) else {
        return Ok(None);
    };
    let exe = d.join(plateforme::PREMIERE_EXE);
    if !exe.is_file() {
        return Err(format!("Ce dossier ne contient pas « {} ».", plateforme::PREMIERE_EXE));
    }
    Ok(Some(exe.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn media_action(e: State<EtatApp>, id: String, action: String) -> R<()> {
    if !noms::est_id_valide(&id) {
        return Err("Identifiant invalide.".into());
    }
    e.service()?.action_media(&id, &action)
}

#[tauri::command]
pub fn importer(e: State<EtatApp>, ids: Vec<String>, chutier: Option<String>) -> R<String> {
    e.service()?.importer(&ids, chutier.as_deref())
}

#[tauri::command]
pub fn a_analyser(e: State<EtatApp>, max: usize) -> R<Vec<AAnalyser>> {
    Ok(e.service()?.a_analyser(max.min(16)))
}

#[tauri::command]
pub fn analyse_enregistrer(e: State<EtatApp>, id: String, analyse: AnalyseWeb, jpeg: Option<String>) -> R<()> {
    let octets = match jpeg {
        Some(b) => {
            let b = b.strip_prefix("data:image/jpeg;base64,").unwrap_or(&b);
            Some(base64::engine::general_purpose::STANDARD.decode(b).map_err(|_| "Miniature mal encodée.")?)
        }
        None => None,
    };
    e.service()?.enregistrer_analyse(&id, &analyse, octets.as_deref())
}

#[tauri::command]
pub fn ajouter_fichiers(e: State<EtatApp>, chemins: Vec<String>) -> R<Vec<String>> {
    e.service()?.ajouter_fichiers(&chemins)
}

#[tauri::command]
pub fn dossier_ajouter(app: AppHandle, e: State<EtatApp>, chemin: String) -> R<()> {
    e.service()?.ajouter_dossier(&chemin)?;
    appli::autoriser_dossiers(&app);
    Ok(())
}

#[tauri::command]
pub fn dossier_retirer(e: State<EtatApp>, chemin: String) -> R<()> {
    e.service()?.retirer_dossier(&chemin)
}

#[tauri::command]
pub fn transferts_effacer(e: State<EtatApp>) -> R<usize> {
    Ok(e.service()?.effacer_transferts_termines())
}

/// Nocturne : annuler, mettre en pause ou reprendre une conversion que CE Desktop reçoit (écran Transferts).
#[tauri::command]
pub fn transfert_piloter(e: State<EtatApp>, id: String, action: String) -> R<()> {
    e.service()?.piloter_transfert(&id, &action)
}

#[tauri::command]
pub fn rescanner(e: State<EtatApp>) -> R<()> {
    e.service()?.rescanner();
    Ok(())
}

#[tauri::command]
pub fn redetecter(e: State<EtatApp>) -> R<()> {
    e.service()?.redetecter();
    Ok(())
}

/// Écran « Détection » de l'assistant : rien n'est installé ni modifié.
#[tauri::command]
pub async fn diagnostic(app: AppHandle, premiere: Option<String>) -> R<Diagnostic> {
    let e = app.state::<EtatApp>();
    let s = e.service()?.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let ctx = Contexte {
            plateforme: s.plateforme(),
            emp: s.emplacements(),
            exe: s.exe().to_path_buf(),
            premiere_manuel: premiere.map(PathBuf::from).or_else(|| s.premiere_manuel()),
        };
        assistant::diagnostiquer(&ctx, &s.dossier_defaut())
    })
    .await
    .map_err(|e| e.to_string())
}

/// Écran « Installation » : déroule les cinq étapes réelles ; la progression arrive par l'événement
/// `assistant-progression` (état complet des étapes après chaque opération).
#[tauri::command]
pub async fn assistant_executer(app: AppHandle, options: Options, premiere: Option<String>) -> R<Rapport> {
    let e = app.state::<EtatApp>();
    let s = e.service()?.clone();
    let annule = e.assistant_annule.clone();
    annule.store(false, Ordering::SeqCst);
    let a = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let ctx = Contexte {
            plateforme: s.plateforme(),
            emp: s.emplacements(),
            exe: s.exe().to_path_buf(),
            premiere_manuel: premiere.map(PathBuf::from).or_else(|| s.premiere_manuel()),
        };
        let r = assistant::executer(&ctx, &options, &annule, &mut |etapes| {
            let _ = a.emit("assistant-progression", etapes);
        });
        s.recharger();
        r
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn assistant_annuler(e: State<EtatApp>) {
    e.assistant_annule.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn assistant_fin(app: AppHandle, e: State<EtatApp>) -> R<()> {
    *e.mode.lock().map_err(|_| "verrou")? = "normal".into();
    e.service()?.recharger();
    appli::autoriser_dossiers(&app);
    Ok(())
}

/// « Ouvrir Premiere Pro » : lance l'exe détecté (côté Desktop, ce qui est permis ; le panneau, lui, ne lance rien).
#[tauri::command]
pub fn ouvrir_premiere(e: State<EtatApp>) -> R<()> {
    let s = e.service()?;
    let exe = s.instantane().premiere.principale.map(|i| i.exe).ok_or("Premiere Pro n'a pas été détecté sur ce PC.")?;
    s.plateforme().lancer(Path::new(&exe), &[])
}

#[tauri::command]
pub async fn panneau_desinstaller(app: AppHandle) -> R<ResultatUpia> {
    let e = app.state::<EtatApp>();
    let s = e.service()?.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let cc = s.plateforme().creative_cloud();
        let ccx = s.emplacements().premiere().join("aethryon-premiere.ccx");
        let r = plateforme::upia_retirer(s.plateforme(), &cc, Some(&ccx));
        journal::info("integrations", &format!("Désinstallation du panneau : {} ({:?})", r.message, r.code));
        if r.ok {
            s.marquer_panneau(None);
        }
        s.redetecter();
        r
    })
    .await
    .map_err(|e| e.to_string())
}

/// `journaux`, `medias` ou `racine` : seulement ces dossiers connus.
#[tauri::command]
pub fn ouvrir_dossier(e: State<EtatApp>, quoi: String) -> R<()> {
    let s = e.service()?;
    let d = match quoi.as_str() {
        "journaux" => s.emplacements().journaux(),
        "medias" => PathBuf::from(s.config().dossier_medias),
        "racine" => s.emplacements().racine.clone(),
        _ => return Err("Dossier inconnu.".into()),
    };
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    s.plateforme().ouvrir(&d)
}

#[tauri::command]
pub async fn rapport_exporter(app: AppHandle) -> R<Option<String>> {
    let e = app.state::<EtatApp>();
    let s = e.service()?.clone();
    let Some(f) = app.dialog().file().set_title("Exporter un rapport AETHRYON").set_file_name("rapport-AETHRYON.txt").add_filter("Texte", &["txt"]).blocking_save_file() else {
        return Ok(None);
    };
    let p = f.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&p, s.rapport()).map_err(|e| format!("Rapport non écrit ({}).", e.kind()))?;
    Ok(Some(p.to_string_lossy().into_owned()))
}

/// Lance le désinstalleur installé à côté de l'exe (`desinstaller.exe`), qui pose ses propres questions.
#[tauri::command]
pub fn lancer_desinstalleur(e: State<EtatApp>) -> R<()> {
    let s = e.service()?;
    let d = s.exe().parent().ok_or("dossier d'installation inconnu")?.join("desinstaller.exe");
    if !d.is_file() {
        return Err("Désinstalleur introuvable : utilisez Paramètres Windows › Applications.".into());
    }
    s.plateforme().lancer(&d, &[])
}

#[tauri::command]
pub fn quitter(app: AppHandle) {
    appli::quitter_app(&app);
}

#[tauri::command]
pub fn webview2() -> Option<String> {
    tauri::webview_version().ok()
}

// ---- Flux : glisser-déposer (« Flow ») -----------------------------------------------------------------------------

static JETONS: AtomicU64 = AtomicU64::new(1);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlisserDemarre {
    pub jeton: String,
    /// Chemins glissés, tels que résolus par le cœur (l'interface les reconnaît dans l'événement de survol).
    pub chemins: Vec<String>,
}

/// Glisser natif de médias de la bibliothèque vers une autre application (Premiere Pro, Explorateur) : l'interface
/// donne des IDENTIFIANTS ; le cœur résout et valide les chemins. Répond quand `DoDragDrop` a démarré ; la fin arrive
/// par l'événement `flux-glisser-fin` (jeton, déposé / annulé / erreur, effet, cible). Windows seulement.
#[tauri::command]
pub async fn glisser_medias(app: AppHandle, ids: Vec<String>) -> R<GlisserDemarre> {
    let e = app.state::<EtatApp>();
    let s = e.service()?.clone();
    // Médias d'index.json : règles du Flux ; médias de l'index (scan) : chemins relus dans l'index, fichiers présents.
    let medias = match s.chemins_pour_glisser(&ids) {
        Ok(m) => m,
        Err(refus) => {
            let Some(ix) = e.index.get() else { return Err(refus) };
            let connus: std::collections::HashSet<String> = s.medias().into_iter().map(|m| m.id).collect();
            let mut v = Vec::new();
            for id in &ids {
                if connus.contains(id) {
                    v.extend(s.chemins_pour_glisser(std::slice::from_ref(id))?);
                } else {
                    v.push((id.clone(), ix.chemin_media(id).map_err(|_| refus.clone())?));
                }
            }
            v
        }
    };
    let miniature = medias.first().map(|(id, _)| s.emplacements().miniature(id)).filter(|p| p.is_file());
    let jeton = format!("g{}-{}", std::process::id(), JETONS.fetch_add(1, Ordering::SeqCst));
    let chemins: Vec<PathBuf> = medias.into_iter().map(|(_, p)| p).collect();
    let textes: Vec<String> = chemins.iter().map(|p| p.to_string_lossy().into_owned()).collect();
    let rx = crate::glisser::demarrer(crate::glisser::Demande { jeton: jeton.clone(), chemins, miniature })?;
    let r = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(4))).await.map_err(|e| e.to_string())?;
    match r {
        Ok(Ok(())) => Ok(GlisserDemarre { jeton, chemins: textes }),
        Ok(Err(m)) => Err(m),
        Err(_) => {
            crate::glisser::abandonner();
            Err("Le glisser n'a pas pu démarrer (fil principal occupé) : réessayez.".into())
        }
    }
}

/// Arrête le glisser natif en cours (comme Échap). Vrai si un glisser était en cours.
#[tauri::command]
pub fn glisser_annuler() -> bool {
    crate::glisser::annuler()
}

/// Classe ce qui survole la fenêtre ou y est déposé : médias de l'index (identifiants), fichiers externes
/// importables, dossiers, refus motivés. Seuls les chemins remis par le système (survol, dépôt, sélecteur) sont examinés.
#[tauri::command]
pub async fn flux_classer(app: AppHandle, chemins: Vec<String>) -> R<Classement> {
    let e = app.state::<EtatApp>();
    let s = e.service()?.clone();
    let autorises = e.chemins_accordes(&chemins, false);
    tauri::async_runtime::spawn_blocking(move || s.classer_chemins(&chemins, &|c| autorises.contains(&noms::normaliser_pour_id(c)))).await.map_err(|e| e.to_string())
}

/// Importe des fichiers externes DÉPOSÉS sur la fenêtre (ou choisis dans le sélecteur) : copie atomique dans le
/// dossier des médias, sans doublon. `lot` (choisi par l'interface) corrèle les avis `flux-import` ; le bilan arrive
/// en réponse et par l'événement `flux-import-fin`.
#[tauri::command]
pub async fn importer_fichiers(app: AppHandle, lot: String, chemins: Vec<String>) -> R<Bilan> {
    if !flux::lot_valide(&lot) {
        return Err("Identifiant de lot refusé.".into());
    }
    let e = app.state::<EtatApp>();
    let s = e.service()?.clone();
    let autorises = e.chemins_accordes(&chemins, true);
    let annule = Arc::new(AtomicBool::new(false));
    {
        let mut l = e.imports.lock().map_err(|_| "verrou")?;
        if l.contains_key(&lot) {
            return Err("Ce lot est déjà en cours.".into());
        }
        l.insert(lot.clone(), annule.clone());
    }
    let (a, l2) = (app.clone(), lot.clone());
    let r = tauri::async_runtime::spawn_blocking(move || {
        s.importer_fichiers(&l2, &chemins, &|c| autorises.contains(&noms::normaliser_pour_id(c)), &annule, &mut |p| {
            let _ = a.emit("flux-import", p);
        })
    })
    .await;
    if let Ok(mut l) = e.imports.lock() {
        l.remove(&lot);
    }
    let b = r.map_err(|e| e.to_string())?;
    let _ = app.emit("flux-import-fin", &b);
    Ok(b)
}

/// Annule un import de fichiers en cours (le fichier en copie est abandonné, son `.part` retiré).
#[tauri::command]
pub fn importer_annuler(e: State<EtatApp>, lot: String) -> bool {
    e.imports.lock().ok().and_then(|l| l.get(&lot).map(|a| a.store(true, Ordering::SeqCst))).is_some()
}

/// « Envoyer vers Premiere » : commande `importer` déposée pour le panneau (contrat §5) SEULEMENT si le panneau bat
/// (moins de 15 s) ; sinon rien n'est envoyé et la réponse le dit (`non-connecte`). Le résultat réel du panneau arrive
/// par `resultat-commande` (`ok`, `message`, `expire`).
#[tauri::command]
pub fn envoyer_vers_premiere(e: State<EtatApp>, ids: Vec<String>, chutier: Option<String>) -> R<Envoi> {
    e.service()?.envoyer_vers_premiere(&ids, chutier.as_deref())
}

// ---- Mises à jour d'AETHRYON Desktop (jamais silencieuses) ----------------------------------------------------

/// Lit l'annonce publiée (`maj_desktop::URL_ANNONCE`, figée) et la compare à cette version. Rien n'est téléchargé.
#[tauri::command]
pub async fn maj_rechercher() -> R<aethryon_noyau::maj_desktop::Recherche> {
    use aethryon_noyau::maj_desktop::{rechercher, Source};
    tauri::async_runtime::spawn_blocking(|| rechercher(&Source::production(), aethryon_noyau::VERSION)).await.map_err(|e| e.to_string())?
}

/// Sur clic « Mettre à jour » : relit l'annonce (rien n'est repris de l'interface), télécharge le setup, vérifie son
/// SHA-256, le lance avec `--mettre-a-jour`, puis AETHRYON Desktop se ferme proprement. Avancement : « maj-progression ».
#[tauri::command]
pub async fn maj_installer(app: AppHandle) -> R<()> {
    telecharger_et_lancer_setup(app, aethryon_noyau::maj_desktop::ARGUMENT_SETUP).await
}

/// « Réparer avec AETHRYON Setup » (panneau AETHRYON absent) : le mécanisme de « Mettre à jour » — annonce publiée
/// relue, setup PUBLIÉ téléchargé et vérifié (SHA-256, taille, « MZ ») —, lancé sur son écran de maintenance
/// (`--maintenance` : « Réparer » réinstalle l'extension CEP), puis AETHRYON Desktop se ferme. En cas d'échec,
/// l'interface propose la page de téléchargement (`ouvrir_page_setup`).
#[tauri::command]
pub async fn reparer_avec_setup(app: AppHandle) -> R<()> {
    telecharger_et_lancer_setup(app, aethryon_noyau::maj_desktop::ARGUMENT_REPARATION).await
}

/// Page de téléchargement d'AETHRYON Setup (adresse figée : l'interface ne transmet aucune adresse).
#[tauri::command]
pub fn ouvrir_page_setup(e: State<EtatApp>) -> R<()> {
    e.service()?.plateforme().ouvrir(std::path::Path::new(aethryon_noyau::maj_desktop::PAGE_TELECHARGEMENT))
}

async fn telecharger_et_lancer_setup(app: AppHandle, argument: &'static str) -> R<()> {
    use aethryon_noyau::maj_desktop::{dossier_temporaire, lancer_setup_avec, rechercher, telecharger, Source, ARGUMENT_SETUP};
    let a = app.clone();
    let exe = tauri::async_runtime::spawn_blocking(move || -> R<PathBuf> {
        let src = Source::production();
        let r = rechercher(&src, aethryon_noyau::VERSION)?;
        if argument == ARGUMENT_SETUP && !r.disponible {
            return Err("AETHRYON Desktop est déjà à jour.".into());
        }
        journal::info("maj", &format!("Setup {} ({argument}) : téléchargement de {}", r.annonce.version, r.annonce.fichier));
        let mut dernier = std::time::Instant::now() - std::time::Duration::from_secs(1);
        telecharger(&src, &r.annonce, &dossier_temporaire(), &mut |etape, fait, total| {
            if etape != "telechargement" || fait >= total || dernier.elapsed().as_millis() >= 120 {
                dernier = std::time::Instant::now();
                let _ = a.emit("maj-progression", serde_json::json!({ "etape": etape, "fait": fait, "total": total }));
            }
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .inspect_err(|e| journal::avert("maj", &format!("Mise à jour abandonnée : {e}")))?;
    let _ = app.emit("maj-progression", serde_json::json!({ "etape": "lancement", "fait": 0, "total": 1 }));
    lancer_setup_avec(&exe, argument).inspect_err(|e| journal::avert("maj", e))?;
    journal::info("maj", &format!("Setup lancé avec {argument} : fermeture d'AETHRYON Desktop."));
    // L'interface affiche « Fermeture… » un instant, puis l'application s'arrête (service compris).
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(900));
        let a2 = app.clone();
        let _ = app.run_on_main_thread(move || appli::quitter_app(&a2));
    });
    Ok(())
}

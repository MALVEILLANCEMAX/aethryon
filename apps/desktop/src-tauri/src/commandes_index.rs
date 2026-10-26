//! Commandes d'AETHRYON Index (scanner de médias locaux, `aethryon_noyau::index`). Tout ce qui lit le disque ou
//! l'index tourne hors du fil de l'interface (`spawn_blocking`) ; le scan lui-même tourne sur ses propres fils et
//! répond tout de suite (numéro du scan), la suite arrivant par les événements `index-progression`, `index-fin`,
//! `index-changement`, `index-enrichissement`, `index-migration`. Les médias sont désignés par leur identifiant
//! (SHA-1 du chemin, même règle qu'`index.json`) : l'interface ne donne jamais un chemin à ouvrir. Seules les CIBLES
//! d'un scan et l'emplacement de l'index sont des chemins (choisis par l'utilisateur). NON TESTÉ SOUS WINDOWS.

use crate::appli::{self, EtatApp};
use aethryon_noyau::bibliotheque::AnalyseWeb;
use aethryon_noyau::index::base::{AAnalyserIndex, Page, Requete};
use aethryon_noyau::index::everything::EtatEverything;
use aethryon_noyau::index::reglages::{Cible, Reglages};
use aethryon_noyau::index::{EtatIndex, IndexMedias, Resume, VolumeIndex};
use base64::Engine;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

type R<T> = Result<T, String>;

fn index(e: &EtatApp) -> R<IndexMedias> {
    e.index.get().cloned().ok_or_else(|| "AETHRYON Index n'est pas encore démarré.".to_string())
}

fn index_app(app: &AppHandle) -> R<IndexMedias> {
    index(&app.state::<EtatApp>())
}

async fn bloquant<T: Send + 'static>(f: impl FnOnce() -> R<T> + Send + 'static) -> R<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/// Volumes du système et ce que l'index en contient (met à jour « indisponible » / « présent »).
#[tauri::command]
pub async fn index_volumes(app: AppHandle) -> R<Vec<VolumeIndex>> {
    let ix = index_app(&app)?;
    bloquant(move || ix.volumes()).await
}

#[tauri::command]
pub fn index_reglages(e: State<EtatApp>) -> R<Reglages> {
    Ok(index(&e)?.reglages())
}

/// Modification partielle (cibles, types, extensions, exclusions, liens, fils, Everything, surveillance…).
#[tauri::command]
pub fn index_reglages_modifier(e: State<EtatApp>, modif: Value) -> R<Reglages> {
    index(&e)?.modifier_reglages(&modif)
}

/// Lance un scan (cibles des réglages si `cibles` est nul). Répond avec le numéro du scan.
#[tauri::command]
pub async fn index_scan_lancer(app: AppHandle, cibles: Option<Vec<Cible>>) -> R<i64> {
    let ix = index_app(&app)?;
    bloquant(move || ix.lancer_scan(cibles)).await
}

#[tauri::command]
pub fn index_scan_annuler(e: State<EtatApp>) -> bool {
    index(&e).map(|ix| ix.annuler_scan()).unwrap_or(false)
}

#[tauri::command]
pub async fn index_etat(app: AppHandle) -> R<EtatIndex> {
    let ix = index_app(&app)?;
    bloquant(move || Ok(ix.etat())).await
}

/// Résumé d'un scan (le dernier si `scan` est nul).
#[tauri::command]
pub async fn index_resume(app: AppHandle, scan: Option<i64>) -> R<Option<Resume>> {
    let ix = index_app(&app)?;
    bloquant(move || Ok(ix.resume(scan))).await
}

/// Recherche dans les médias scannés (sources « index » et « everything »).
#[tauri::command]
pub async fn index_rechercher(app: AppHandle, requete: Requete) -> R<Page> {
    let ix = index_app(&app)?;
    bloquant(move || ix.rechercher(&requete)).await
}

/// Bibliothèque unifiée : dossiers surveillés (index.json) et médias scannés, avec leur source.
#[tauri::command]
pub async fn bibliotheque_requete(app: AppHandle, requete: Requete) -> R<Page> {
    let ix = index_app(&app)?;
    bloquant(move || ix.bibliotheque(&requete)).await
}

/// `ouvrir` (application associée) ou `explorateur` (Explorateur sur le fichier), par identifiant seulement.
#[tauri::command]
pub fn index_media_action(e: State<EtatApp>, id: String, action: String) -> R<()> {
    let chemin = index(&e)?.chemin_media(&id)?;
    let s = e.service()?;
    match action.as_str() {
        "ouvrir" => s.plateforme().ouvrir(&chemin),
        "explorateur" => s.plateforme().afficher_dans_explorateur(&chemin),
        _ => Err("Action inconnue.".into()),
    }
}

/// Aperçu ou lecture d'un média de l'index dans l'interface : SEUL ce fichier est ouvert au protocole `asset:`.
/// Renvoie son chemin, à passer à `convertFileSrc`.
#[tauri::command]
pub fn index_apercu(app: AppHandle, e: State<EtatApp>, id: String) -> R<String> {
    let chemin = index(&e)?.chemin_media(&id)?;
    app.asset_protocol_scope().allow_file(&chemin).map_err(|x| x.to_string())?;
    Ok(chemin.to_string_lossy().into_owned())
}

/// Cartes visibles : images et pochettes passent en tête de file ; les vidéos à analyser par le WebView2 sont
/// renvoyées (16 au plus), chacune ouverte au protocole `asset:` pour l'élément vidéo.
#[tauri::command]
pub async fn index_miniatures_demander(app: AppHandle, ids: Vec<String>) -> R<Vec<AAnalyserIndex>> {
    let ix = index_app(&app)?;
    let v = bloquant(move || ix.demander_miniatures(&ids)).await?;
    let scope = app.asset_protocol_scope();
    for a in &v {
        let _ = scope.allow_file(&a.chemin);
    }
    Ok(v)
}

/// Résultat de l'analyse d'une vidéo par le WebView2 : durée, définition, échec, et image JPEG (data URL ou base64).
#[tauri::command]
pub async fn index_analyse_enregistrer(app: AppHandle, id: String, analyse: AnalyseWeb, jpeg: Option<String>) -> R<()> {
    let ix = index_app(&app)?;
    let octets = match jpeg {
        Some(b) => {
            if b.len() > 8 * 1024 * 1024 {
                return Err("Miniature trop lourde.".into());
            }
            let b = b.strip_prefix("data:image/jpeg;base64,").unwrap_or(&b);
            Some(base64::engine::general_purpose::STANDARD.decode(b).map_err(|_| "Miniature mal encodée.")?)
        }
        None => None,
    };
    bloquant(move || ix.enregistrer_analyse(&id, &analyse, octets.as_deref())).await
}

/// Déplace l'index, le cache et les miniatures (migration sûre ; avancement par `index-migration`).
#[tauri::command]
pub async fn index_emplacement_deplacer(app: AppHandle, chemin: String) -> R<String> {
    let ix = index_app(&app)?;
    let r = bloquant(move || ix.deplacer_emplacement(&chemin)).await?;
    appli::autoriser_dossiers(&app);
    Ok(r)
}

#[tauri::command]
pub async fn index_everything(app: AppHandle) -> R<EtatEverything> {
    let ix = index_app(&app)?;
    bloquant(move || Ok(ix.everything())).await
}

/// Retire de l'index tout ce qui est sous `chemin` (les fichiers ne sont jamais touchés).
#[tauri::command]
pub async fn index_retirer(app: AppHandle, chemin: String) -> R<u64> {
    let ix = index_app(&app)?;
    bloquant(move || ix.retirer(&chemin)).await
}

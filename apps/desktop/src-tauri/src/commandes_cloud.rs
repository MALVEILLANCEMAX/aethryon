//! Commandes du compte relié et d'AETHRYON Cloud (Paramètres › Compte, section CLOUD). L'interface ne reçoit JAMAIS la
//! clé « desktop » : seulement l'état du compte (`compte`), les objets du cloud, des liens signés courts (aperçu, lien
//! temporaire) et l'avancement réel des transferts (`cloud-transfert`). Les médias à envoyer sont désignés par leur
//! identifiant d'index ; les objets du cloud par leur identifiant (validé par le noyau). NON TESTÉ SOUS WINDOWS.

use crate::appli::EtatApp;
use aethryon_noyau::cloud::{Client, ErreurCloud, EtatCloud, Filtres, Lien, ListeCloud, TransfertCloud};
use aethryon_noyau::compte::EtatCompte;
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

type R<T> = Result<T, ErreurCloud>;

fn ko(code: &str, message: &str) -> ErreurCloud {
    ErreurCloud { statut: 0, code: code.into(), message: message.into() }
}

fn compte(e: &EtatApp) -> Result<std::sync::Arc<aethryon_noyau::compte::GestionCompte>, ErreurCloud> {
    e.compte.get().cloned().ok_or_else(|| ko("demarrage", "Service AETHRYON pas encore démarré."))
}

/// Appel au cloud avec la clé du coffre ; une clé refusée (401) relit le compte (la liaison est alors effacée).
fn avec_client<T: Send + 'static>(app: &AppHandle, f: impl FnOnce(&Client) -> R<T> + Send + 'static) -> R<T> {
    let c = compte(&app.state::<EtatApp>())?;
    let cle = c.cle().ok_or_else(|| ko("non_relie", "AETHRYON Desktop n'est pas relié au compte (Paramètres › Compte)."))?;
    let r = f(&Client { srv: c.serveur(), cle: &cle });
    if matches!(&r, Err(e) if e.statut == 401) {
        std::thread::spawn(move || {
            c.rafraichir();
        });
    }
    r
}

async fn bloquant<T: Send + 'static>(f: impl FnOnce() -> R<T> + Send + 'static) -> R<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| ko("interne", &e.to_string()))?
}

// ---- Compte relié ---------------------------------------------------------------------------------------------------

#[tauri::command]
pub fn compte_etat(e: State<EtatApp>) -> R<EtatCompte> {
    Ok(compte(&e)?.etat())
}

/// « Relier ce Desktop » : code affiché, page d'accord ouverte dans le navigateur, interrogation en arrière-plan.
#[tauri::command]
pub async fn compte_relier(app: AppHandle) -> R<EtatCompte> {
    let c = compte(&app.state::<EtatApp>())?;
    bloquant(move || c.demarrer_appairage().map_err(|m| ko("appairage", &m))).await
}

#[tauri::command]
pub fn compte_annuler(e: State<EtatApp>) -> R<EtatCompte> {
    Ok(compte(&e)?.annuler_appairage())
}

/// 3.8.1 : « Coller un lien » (Accueil) : conversion par ytapi avec la clé du compte relié ; le transfert initial est
/// rendu tout de suite, l'avancement réel arrive par les événements « changement » (écran Transferts).
#[tauri::command]
pub fn convertir_lien(e: State<EtatApp>, url: String, format: String) -> R<aethryon_noyau::transferts::Transfert> {
    if !compte(&e)?.etat().relie {
        return Err(ko("non_relie", aethryon_noyau::conversion::TEXTE_NON_RELIE));
    }
    if format != "mp4" && format != "mp3" {
        return Err(ko("format", "Format refusé : MP4 ou MP3."));
    }
    let d = aethryon_noyau::conversion::Demande {
        id: aethryon_noyau::conversion::id_desktop(),
        url: url.chars().take(aethryon_noyau::conversion::URL_MAX + 1).collect(),
        format,
        extrait: None,
        titre: None,
        origine: "desktop".into(),
        premiere: false,
    };
    e.service().map_err(|m| ko("demarrage", &m))?.convertir(d).map_err(|m| ko("conversion", &m))
}

#[tauri::command]
pub async fn compte_rafraichir(app: AppHandle) -> R<EtatCompte> {
    let c = compte(&app.state::<EtatApp>())?;
    bloquant(move || Ok(c.rafraichir())).await
}

/// « Se déconnecter » : transferts du cloud arrêtés (la clé va disparaître), clé révoquée sur le site, effacée ici.
#[tauri::command]
pub async fn compte_deconnecter(app: AppHandle) -> R<EtatCompte> {
    let e = app.state::<EtatApp>();
    let c = compte(&e)?;
    if let Some(t) = e.cloud.get() {
        t.annuler_tout();
    }
    if let Some(i) = e.imports_musique.get() {
        i.annuler_tout();
    }
    bloquant(move || Ok(c.deconnecter())).await
}

// ---- AETHRYON Cloud ---------------------------------------------------------------------------------------------------

#[tauri::command]
pub async fn cloud_etat(app: AppHandle) -> R<EtatCloud> {
    let a = app.clone();
    bloquant(move || avec_client(&a, |c| c.etat())).await
}

#[tauri::command]
pub async fn cloud_objets(app: AppHandle, filtres: Filtres) -> R<ListeCloud> {
    let a = app.clone();
    bloquant(move || avec_client(&a, move |c| c.lister(&filtres))).await
}

/// Lien signé court : `apercu` (lecture dans le lecteur intégré) ou `telecharger` (« Copier un lien temporaire »).
#[tauri::command]
pub async fn cloud_lien(app: AppHandle, id: String, usage: String) -> R<Lien> {
    let a = app.clone();
    bloquant(move || avec_client(&a, move |c| c.lien(&id, &usage))).await
}

#[tauri::command]
pub async fn cloud_supprimer(app: AppHandle, id: String) -> R<Value> {
    let a = app.clone();
    bloquant(move || avec_client(&a, move |c| c.supprimer(&id).map(|(o, q)| json!({ "objet": o, "quota": q })))).await
}

/// Télécharge l'objet dans le dossier des médias (jamais d'écrasement) ; avancement par `cloud-transfert`.
#[tauri::command]
pub async fn cloud_telecharger(app: AppHandle, id: String) -> R<TransfertCloud> {
    let a = app.clone();
    let o = bloquant(move || avec_client(&a, move |c| c.objet(&id))).await?;
    if o.statut != "sauvegarde" {
        return Err(ko("pas_disponible", "Ce fichier n'est pas disponible au téléchargement."));
    }
    let e = app.state::<EtatApp>();
    let dossier = PathBuf::from(e.service().map_err(|m| ko("demarrage", &m))?.config().dossier_medias);
    let t = e.cloud.get().ok_or_else(|| ko("demarrage", "Service AETHRYON pas encore démarré."))?;
    Ok(t.telecharger(o, dossier))
}

/// Envoie des médias de la bibliothèque (identifiants d'index) : un à la fois, avancement par `cloud-transfert`.
#[tauri::command]
pub fn cloud_envoyer(e: State<EtatApp>, ids: Vec<String>) -> R<Vec<TransfertCloud>> {
    let c = compte(&e)?;
    let etat = c.etat();
    if !etat.relie {
        return Err(ko("non_relie", "AETHRYON Desktop n'est pas relié au compte (Paramètres › Compte)."));
    }
    if etat.cloud.as_ref().is_some_and(|x| !x.disponible) {
        return Err(ko("forbidden", "AETHRYON Cloud est réservé à l'administrateur."));
    }
    let fichiers = e.service().map_err(|m| ko("demarrage", &m))?.fichiers_pour_cloud(&ids).map_err(|m| ko("media", &m))?;
    let t = e.cloud.get().ok_or_else(|| ko("demarrage", "Service AETHRYON pas encore démarré."))?;
    Ok(t.envoyer(fichiers))
}

#[tauri::command]
pub fn cloud_annuler(e: State<EtatApp>, id: String) -> bool {
    e.cloud.get().is_some_and(|t| t.annuler(&id))
}

#[tauri::command]
pub fn cloud_transferts(e: State<EtatApp>) -> Vec<TransfertCloud> {
    e.cloud.get().map(|t| t.liste()).unwrap_or_default()
}

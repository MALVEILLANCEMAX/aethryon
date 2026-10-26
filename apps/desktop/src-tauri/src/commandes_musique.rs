//! Commandes de la section MUSIQUE. L'interface ne reçoit jamais la clé « desktop » ni un chemin à ouvrir : les
//! morceaux sont désignés par leur identifiant d'index, les liens externes passent par une liste fermée d'hôtes
//! officiels (`client::lien_ouvrable`), les imports par le corps de l'action `importer` de la fiche (champs fermés).
//! Lecture des fichiers locaux par le protocole `asset:` (dossiers surveillés) ; pochettes extraites servies depuis
//! `R\musique\pochettes\` seulement. NON TESTÉ SOUS WINDOWS.

use crate::appli::EtatApp;
use aethryon_noyau::cloud::ErreurCloud;
use aethryon_noyau::musique::client::{self, ClientMusique};
use aethryon_noyau::musique::donnees::{EntreeHistorique, EtatLecture, FicheEnregistree, Magasin, OpPlaylist, SourcePlaylist, TitreIdentifie, VueMusique};
use aethryon_noyau::musique::imports::{Cible, ImportSuivi, Imports, Presentation};
use aethryon_noyau::{horloge, plateforme};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

type R<T> = Result<T, ErreurCloud>;

fn ko(code: &str, message: &str) -> ErreurCloud {
    ErreurCloud { statut: 0, code: code.into(), message: message.into() }
}

fn magasin(e: &EtatApp) -> R<Arc<Magasin>> {
    e.musique.get().cloned().ok_or_else(|| ko("demarrage", "Service AETHRYON pas encore démarré."))
}

fn imports(e: &EtatApp) -> R<&Imports> {
    e.imports_musique.get().ok_or_else(|| ko("demarrage", "Service AETHRYON pas encore démarré."))
}

async fn bloquant<T: Send + 'static>(f: impl FnOnce() -> R<T> + Send + 'static) -> R<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| ko("interne", &e.to_string()))?
}

/// Appel au relais `/api/music/*` avec la clé du coffre ; une clé refusée (401) relit le compte.
fn avec_client<T: Send + 'static>(app: &AppHandle, f: impl FnOnce(&ClientMusique) -> R<T>) -> R<T> {
    let c = app.state::<EtatApp>().compte.get().cloned().ok_or_else(|| ko("demarrage", "Service AETHRYON pas encore démarré."))?;
    let cle = c.cle().ok_or_else(|| ko("non_relie", "Reliez AETHRYON Desktop à votre compte (Paramètres › Compte) pour analyser et importer."))?;
    let r = f(&ClientMusique { srv: c.serveur(), cle: &cle });
    if matches!(&r, Err(e) if e.statut == 401) {
        std::thread::spawn(move || {
            c.rafraichir();
        });
    }
    r
}

// ---- Bibliothèque locale, playlists, historique, reprise ------------------------------------------------------------

#[tauri::command]
pub async fn musique_vue(app: AppHandle) -> R<VueMusique> {
    let e = app.state::<EtatApp>();
    let m = magasin(&e)?;
    let medias = e.service().map_err(|x| ko("demarrage", &x))?.medias();
    bloquant(move || Ok(m.vue(&medias))).await
}

#[tauri::command]
pub fn musique_playlists(e: State<EtatApp>, op: OpPlaylist) -> R<Value> {
    let (l, id) = magasin(&e)?.modifier_playlists(op).map_err(|m| ko("refuse", &m))?;
    Ok(json!({ "playlists": l, "id": id }))
}

#[tauri::command]
pub fn musique_historique_noter(e: State<EtatApp>, entree: EntreeHistorique) -> R<Vec<EntreeHistorique>> {
    magasin(&e)?.noter(entree).map_err(|m| ko("refuse", &m))
}

#[tauri::command]
pub fn musique_historique_effacer(e: State<EtatApp>) -> R<()> {
    magasin(&e)?.effacer_historique().map_err(|m| ko("ecriture", &m))
}

#[tauri::command]
pub fn musique_fiche_enregistrer(e: State<EtatApp>, fiche: FicheEnregistree) -> R<Vec<FicheEnregistree>> {
    magasin(&e)?.enregistrer_fiche(fiche).map_err(|m| ko("refuse", &m))
}

#[tauri::command]
pub fn musique_fiche_retirer(e: State<EtatApp>, url: String) -> R<Vec<FicheEnregistree>> {
    magasin(&e)?.retirer_fiche(&url).map_err(|m| ko("ecriture", &m))
}

#[tauri::command]
pub fn musique_lecture(e: State<EtatApp>, etat: EtatLecture) -> R<EtatLecture> {
    magasin(&e)?.enregistrer_lecture(etat).map_err(|m| ko("refuse", &m))
}

/// « Ouvrir dans Spotify / Apple Music / … » : seulement une page officielle de la liste fermée.
#[tauri::command]
pub fn musique_ouvrir_lien(url: String) -> R<()> {
    if !client::lien_ouvrable(&url) {
        return Err(ko("lien_refuse", "Ce lien ne peut pas être ouvert depuis AETHRYON."));
    }
    plateforme::systeme().ouvrir(Path::new(&url)).map_err(|m| ko("ouverture", &m))
}

// ---- AETHRYON Music (relais d'account) ---------------------------------------------------------------------------

#[tauri::command]
pub async fn musique_connecteurs(app: AppHandle) -> R<Value> {
    let a = app.clone();
    bloquant(move || avec_client(&a, |c| c.connecteurs())).await
}

#[tauri::command]
pub async fn musique_analyser(app: AppHandle, url: String, type_lien: Option<String>) -> R<Value> {
    let a = app.clone();
    bloquant(move || avec_client(&a, |c| c.analyser(&url, type_lien.as_deref()))).await
}

#[tauri::command]
pub async fn musique_rechercher(app: AppHandle, q: String, source: String) -> R<Value> {
    let a = app.clone();
    bloquant(move || avec_client(&a, |c| c.rechercher(&q, &source))).await
}

/// Candidats de correspondance : les morceaux de la bibliothèque locale (`bib:<id>`), sans aucun chemin.
fn candidats(m: &Magasin, medias: &[aethryon_noyau::bibliotheque::Media]) -> Value {
    Value::Array(
        m.actualiser(medias)
            .into_iter()
            .take(10_000)
            .map(|p| json!({ "ref": format!("bib:{}", p.id), "origine": "bibliotheque", "titre": p.titre, "artistes": p.artistes, "dureeS": p.duree_s, "isrc": p.isrc }))
            .collect(),
    )
}

/// Synchronise une playlist (ou un album) d'un service vers les fichiers POSSÉDÉS : la playlist AETHRYON garde les
/// morceaux correspondants (sûrs ou probables) ; les titres sans fichier restent « identifiés » (aucun téléchargement).
#[tauri::command]
pub async fn musique_synchroniser(app: AppHandle, url: String) -> R<Value> {
    let e = app.state::<EtatApp>();
    let m = magasin(&e)?;
    let medias = e.service().map_err(|x| ko("demarrage", &x))?.medias();
    let a = app.clone();
    bloquant(move || {
        let cand = candidats(&m, &medias);
        let r = avec_client(&a, |c| c.synchroniser(&url, &cand))?;
        let pl = &r["playlist"];
        let mut ids = Vec::new();
        let mut sans = Vec::new();
        for (i, p) in pl["pistes"].as_array().cloned().unwrap_or_default().iter().enumerate() {
            match p["correspondance"]["ref"].as_str().and_then(|x| x.strip_prefix("bib:")) {
                Some(id) => ids.push(id.to_string()),
                None => sans.push(TitreIdentifie {
                    position: p["position"].as_u64().unwrap_or(i as u64 + 1) as u32,
                    titre: p["piste"]["titre"].as_str().unwrap_or("Titre sans nom").chars().take(300).collect(),
                    artistes: p["piste"]["artistes"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).take(12).collect()).unwrap_or_default(),
                    duree_s: p["piste"]["dureeS"].as_f64(),
                }),
            }
        }
        let source = SourcePlaylist {
            connecteur: pl["source"].as_str().unwrap_or("").chars().take(20).collect(),
            url: url.trim().into(),
            titre: pl["titre"].as_str().map(|t| t.chars().take(200).collect()),
            snapshot: pl["snapshot"].as_str().map(|t| t.chars().take(200).collect()),
            synchronisee_le: horloge::iso(horloge::maintenant()),
            sans_fichier: sans,
        };
        let nom = pl["titre"].as_str().unwrap_or("Playlist synchronisée").to_string();
        let playlists = m.enregistrer_synchronisee(&nom, ids, source).map_err(|x| ko("refuse", &x))?;
        Ok(json!({ "resultat": r, "playlists": playlists }))
    })
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[derive(Default)]
pub struct PresentationVue {
    pub url: String,
    pub connecteur: String,
    pub titre: Option<String>,
    pub artistes: Vec<String>,
    pub pochette: Option<String>,
}

#[tauri::command]
pub fn musique_importer(app: AppHandle, corps: Value, presentation: PresentationVue) -> R<ImportSuivi> {
    let e = app.state::<EtatApp>();
    let s = e.service().map_err(|x| ko("demarrage", &x))?.clone();
    let dossier = PathBuf::from(s.config().dossier_medias);
    let p = Presentation { url: presentation.url, connecteur: presentation.connecteur, titre: presentation.titre, artistes: presentation.artistes, pochette: presentation.pochette };
    imports(&e)?
        .lancer(corps, p, Cible { dossier_medias: dossier, rescanner: Box::new(move || s.rescanner()) })
        .map_err(|m| ko("refuse", &m))
}

#[tauri::command]
pub fn musique_imports(e: State<EtatApp>) -> Vec<ImportSuivi> {
    e.imports_musique.get().map(|i| i.liste()).unwrap_or_default()
}

#[tauri::command]
pub fn musique_import_annuler(e: State<EtatApp>, id: String) -> bool {
    e.imports_musique.get().is_some_and(|i| i.annuler(&id))
}

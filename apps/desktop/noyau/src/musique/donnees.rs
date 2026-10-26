//! Données de la section MUSIQUE, gardées par le cœur dans `R\musique\` (écriture atomique, `atomique.rs`), TOUJOURS à
//! part des fichiers audio (jamais une étiquette réécrite) :
//!
//! | Fichier | Contenu |
//! |---|---|
//! | `etiquettes.json` | fiches des morceaux de la bibliothèque (cache des étiquettes, relu si taille ou date changent) |
//! | `pochettes\<empreinte>.jpg/png/webp` | pochettes intégrées extraites (une par image distincte) |
//! | `provenances.json` | origine des fichiers importés (connecteur, lien, licence, attribution, déclaration, cloud) |
//! | `playlists.json` | playlists personnelles (références aux médias, ordre choisi par glisser-déposer) |
//! | `historique.json` | historique des liens analysés, des imports, des fiches enregistrées (300 au plus) |
//! | `fiches.json` | fiches enregistrées depuis un lien (action `enregistrer_lien`, aucun fichier) |
//! | `lecture.json` | reprise de lecture (file, position, volume, aléatoire, répétition) |
//!
//! Chaque modification passe par une fonction qui VALIDE tout (identifiants, longueurs, permutations) avant d'écrire.
//! Un fichier illisible n'est jamais écrasé en silence : il est mis de côté (`.illisible`) puis remplacé.

use super::etiquettes::{self, Qualite};
use crate::atomique::{self, Lecture};
use crate::bibliotheque::{EtatMedia, Media, TypeMedia};
use crate::{horloge, journal, noms};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const PLAYLISTS_MAX: usize = 200;
pub const PISTES_PAR_PLAYLIST_MAX: usize = 5000;
pub const HISTORIQUE_MAX: usize = 300;
pub const FICHES_MAX: usize = 500;
pub const FILE_MAX: usize = 5000;
const NOM_MAX: usize = 80;

// ---- Formes enregistrées ----------------------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Provenance {
    pub connecteur: String,
    pub source_url: Option<String>,
    pub licence: Option<Value>,
    pub attribution: Option<String>,
    pub attestation: bool,
    pub import_id: Option<String>,
    pub importe_le: String,
    /// État du cloud au moment de l'import (administrateur), tel que le serveur l'a donné.
    pub cloud: Option<Value>,
}

/// Fiche d'un morceau de la bibliothèque, vue par l'interface.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Piste {
    pub id: String,
    pub titre: String,
    pub artistes: Vec<String>,
    pub album: Option<String>,
    pub artiste_album: Option<String>,
    pub numero: Option<u32>,
    pub disque: Option<u32>,
    pub annee: Option<u32>,
    pub genre: Option<String>,
    pub isrc: Option<String>,
    pub duree_s: Option<f64>,
    pub qualite: Qualite,
    /// Nom du fichier de la pochette dans `R\musique\pochettes\`, ou rien.
    pub pochette: Option<String>,
    /// `ok` (étiquettes lues), `absentes` (fichier sans étiquette : titre = nom du fichier), `illisible`.
    pub etiquetage: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub erreur: Option<String>,
    /// Taille et date du fichier quand il a été lu (le cache est relu si l'une change).
    pub empreinte: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provenance: Option<Provenance>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SourcePlaylist {
    pub connecteur: String,
    pub url: String,
    pub titre: Option<String>,
    pub snapshot: Option<String>,
    pub synchronisee_le: String,
    /// Titres identifiés sans fichier possédé (montrés comme identifiés, jamais téléchargés).
    #[serde(default)]
    pub sans_fichier: Vec<TitreIdentifie>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TitreIdentifie {
    pub position: u32,
    pub titre: String,
    pub artistes: Vec<String>,
    pub duree_s: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub nom: String,
    pub pistes: Vec<String>,
    pub cree_le: String,
    pub modifie_le: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<SourcePlaylist>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct EntreeHistorique {
    pub id: String,
    pub quand: String,
    /// `analyse`, `import`, `enregistrement`, `synchronisation`.
    pub action: String,
    pub url: String,
    pub connecteur: String,
    pub titre: Option<String>,
    pub artistes: Vec<String>,
    pub pochette: Option<String>,
    /// État de la fiche (`lien_reconnu`, `identifie`, `correspondance`, `telechargeable`) ou de l'import.
    pub etat: String,
    pub import_id: Option<String>,
    pub media_id: Option<String>,
    pub erreur: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct FicheEnregistree {
    pub url: String,
    pub connecteur: String,
    #[serde(rename = "type")]
    pub type_fiche: String,
    pub titre: Option<String>,
    pub artistes: Vec<String>,
    pub album: Option<String>,
    pub pochette: Option<String>,
    pub duree_s: Option<f64>,
    pub etat: String,
    pub enregistree_le: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct EtatLecture {
    /// Références : `loc:<id du média>` (fichier local) ou `cloud:<id de l'objet>` (écoute par lien signé).
    pub file: Vec<String>,
    pub index: usize,
    pub position_s: f64,
    pub aleatoire: bool,
    /// `non`, `tout`, `un`.
    pub repetition: String,
    pub volume: f64,
    pub maj_le: String,
}

impl Default for EtatLecture {
    fn default() -> Self {
        Self { file: Vec::new(), index: 0, position_s: 0.0, aleatoire: false, repetition: "non".into(), volume: 0.8, maj_le: String::new() }
    }
}

#[derive(Serialize, Deserialize, Default)]
struct Enveloppe<T> {
    schema: u32,
    #[serde(default)]
    contenu: T,
}

/// Vue complète renvoyée à l'interface.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VueMusique {
    pub pistes: Vec<Piste>,
    pub playlists: Vec<Playlist>,
    pub historique: Vec<EntreeHistorique>,
    pub fiches: Vec<FicheEnregistree>,
    pub lecture: EtatLecture,
    /// Dossier des pochettes (servi au WebView par le protocole `asset:`, portée limitée à ce dossier).
    pub dossier_pochettes: String,
}

// ---- Opérations sur les playlists (validées) ----------------------------------------------------------------------

#[derive(Deserialize, Debug, Clone)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum OpPlaylist {
    Creer { nom: String, #[serde(default)] pistes: Vec<String> },
    Renommer { id: String, nom: String },
    Supprimer { id: String },
    Ajouter { id: String, pistes: Vec<String>, #[serde(default)] position: Option<usize> },
    Retirer { id: String, position: usize },
    Deplacer { id: String, de: usize, vers: usize },
    /// Nouvel ordre complet : doit être une permutation exacte des pistes actuelles.
    Reordonner { id: String, pistes: Vec<String> },
}

fn nom_valide(n: &str) -> Result<String, String> {
    let n = etiquettes::propre(n).ok_or("Donnez un nom à la playlist.")?;
    if n.chars().count() > NOM_MAX {
        return Err(format!("Nom trop long ({NOM_MAX} caractères au plus)."));
    }
    Ok(n)
}

fn ids_valides(ids: &[String]) -> Result<(), String> {
    if ids.iter().all(|i| noms::est_id_valide(i)) { Ok(()) } else { Err("Identifiant de morceau invalide.".into()) }
}

fn id_playlist_valide(id: &str) -> bool {
    id.len() == 35 && id.starts_with("pl_") && id[3..].chars().all(|c| c.is_ascii_hexdigit())
}

/// Applique une opération ; erreur lisible, rien n'est modifié en cas d'erreur.
pub fn appliquer(listes: &mut Vec<Playlist>, op: OpPlaylist, maintenant: &str) -> Result<Option<String>, String> {
    let trouver = |l: &mut Vec<Playlist>, id: &str| -> Result<usize, String> {
        if !id_playlist_valide(id) {
            return Err("Playlist inconnue.".into());
        }
        l.iter().position(|p| p.id == id).ok_or_else(|| "Playlist inconnue.".to_string())
    };
    match op {
        OpPlaylist::Creer { nom, pistes } => {
            if listes.len() >= PLAYLISTS_MAX {
                return Err(format!("{PLAYLISTS_MAX} playlists au plus."));
            }
            let nom = nom_valide(&nom)?;
            ids_valides(&pistes)?;
            if pistes.len() > PISTES_PAR_PLAYLIST_MAX {
                return Err("Trop de morceaux pour une playlist.".into());
            }
            let id = format!("pl_{}", uuid::Uuid::new_v4().simple());
            listes.push(Playlist { id: id.clone(), nom, pistes, cree_le: maintenant.into(), modifie_le: maintenant.into(), source: None });
            Ok(Some(id))
        }
        OpPlaylist::Renommer { id, nom } => {
            let i = trouver(listes, &id)?;
            listes[i].nom = nom_valide(&nom)?;
            listes[i].modifie_le = maintenant.into();
            Ok(None)
        }
        OpPlaylist::Supprimer { id } => {
            let i = trouver(listes, &id)?;
            listes.remove(i);
            Ok(None)
        }
        OpPlaylist::Ajouter { id, pistes, position } => {
            let i = trouver(listes, &id)?;
            ids_valides(&pistes)?;
            let p = &mut listes[i];
            if p.pistes.len() + pistes.len() > PISTES_PAR_PLAYLIST_MAX {
                return Err("Trop de morceaux pour une playlist.".into());
            }
            let at = position.unwrap_or(p.pistes.len()).min(p.pistes.len());
            p.pistes.splice(at..at, pistes);
            p.modifie_le = maintenant.into();
            Ok(None)
        }
        OpPlaylist::Retirer { id, position } => {
            let i = trouver(listes, &id)?;
            let p = &mut listes[i];
            if position >= p.pistes.len() {
                return Err("Morceau absent de la playlist.".into());
            }
            p.pistes.remove(position);
            p.modifie_le = maintenant.into();
            Ok(None)
        }
        OpPlaylist::Deplacer { id, de, vers } => {
            let i = trouver(listes, &id)?;
            let p = &mut listes[i];
            if de >= p.pistes.len() || vers >= p.pistes.len() {
                return Err("Position hors de la playlist.".into());
            }
            let x = p.pistes.remove(de);
            p.pistes.insert(vers, x);
            p.modifie_le = maintenant.into();
            Ok(None)
        }
        OpPlaylist::Reordonner { id, pistes } => {
            let i = trouver(listes, &id)?;
            let p = &mut listes[i];
            let mut a = p.pistes.clone();
            let mut b = pistes.clone();
            a.sort();
            b.sort();
            if a != b {
                return Err("Nouvel ordre refusé : ce n'est pas la même liste de morceaux.".into());
            }
            p.pistes = pistes;
            p.modifie_le = maintenant.into();
            Ok(None)
        }
    }
}

/// Reprise de lecture validée (références, bornes, énumérations).
pub fn lecture_valide(mut l: EtatLecture, maintenant: &str) -> Result<EtatLecture, String> {
    if l.file.len() > FILE_MAX {
        return Err("File d'attente trop longue.".into());
    }
    for r in &l.file {
        let ok = match r.split_once(':') {
            Some(("loc", id)) => noms::est_id_valide(id),
            Some(("cloud", id)) => crate::cloud::id_valide(id),
            _ => false,
        };
        if !ok {
            return Err("Référence de morceau invalide dans la file.".into());
        }
    }
    if !["non", "tout", "un"].contains(&l.repetition.as_str()) {
        return Err("Mode de répétition inconnu.".into());
    }
    if !l.volume.is_finite() || !l.position_s.is_finite() {
        return Err("Valeur de lecture invalide.".into());
    }
    l.volume = l.volume.clamp(0.0, 1.0);
    l.position_s = l.position_s.clamp(0.0, 4.0 * 3600.0);
    l.index = if l.file.is_empty() { 0 } else { l.index.min(l.file.len() - 1) };
    l.maj_le = maintenant.into();
    Ok(l)
}

fn texte_borne(s: &str, max: usize) -> String {
    s.chars().filter(|c| !c.is_control()).take(max).collect()
}

fn url_https(u: &str) -> Option<String> {
    let u = u.trim();
    ((u.starts_with("https://") || u.starts_with("spotify:")) && u.len() <= 2048 && !u.chars().any(|c| c.is_control() || c == ' ')).then(|| u.to_string())
}

/// Entrée d'historique nettoyée (venue de l'interface ou d'un import).
pub fn historique_propre(mut e: EntreeHistorique, maintenant: &str) -> Result<EntreeHistorique, String> {
    if !["analyse", "import", "enregistrement", "synchronisation"].contains(&e.action.as_str()) {
        return Err("Action d'historique inconnue.".into());
    }
    e.url = url_https(&e.url).ok_or("Lien refusé (https seulement).")?;
    e.connecteur = texte_borne(&e.connecteur, 20);
    e.titre = e.titre.as_deref().and_then(etiquettes::propre);
    e.artistes = e.artistes.iter().filter_map(|a| etiquettes::propre(a)).take(12).collect();
    e.pochette = e.pochette.as_deref().and_then(url_https).filter(|u| u.starts_with("https://"));
    e.etat = texte_borne(&e.etat, 30);
    e.erreur = e.erreur.as_deref().map(|x| texte_borne(x, 300));
    if e.media_id.as_deref().is_some_and(|m| !noms::est_id_valide(m)) {
        e.media_id = None;
    }
    if e.id.is_empty() {
        e.id = format!("h_{}", uuid::Uuid::new_v4().simple());
    }
    if e.quand.is_empty() {
        e.quand = maintenant.into();
    }
    Ok(e)
}

pub fn fiche_propre(mut f: FicheEnregistree, maintenant: &str) -> Result<FicheEnregistree, String> {
    f.url = url_https(&f.url).ok_or("Lien refusé (https seulement).")?;
    f.connecteur = texte_borne(&f.connecteur, 20);
    f.type_fiche = texte_borne(&f.type_fiche, 20);
    f.titre = f.titre.as_deref().and_then(etiquettes::propre);
    f.album = f.album.as_deref().and_then(etiquettes::propre);
    f.artistes = f.artistes.iter().filter_map(|a| etiquettes::propre(a)).take(12).collect();
    f.pochette = f.pochette.as_deref().and_then(url_https).filter(|u| u.starts_with("https://"));
    f.etat = texte_borne(&f.etat, 30);
    f.duree_s = f.duree_s.filter(|d| d.is_finite() && *d >= 0.0);
    f.enregistree_le = maintenant.into();
    Ok(f)
}

// ---- Magasin --------------------------------------------------------------------------------------------------------

#[derive(Default)]
struct Etat {
    charge: bool,
    pistes: BTreeMap<String, Piste>,
    provenances: BTreeMap<String, Provenance>,
    playlists: Vec<Playlist>,
    historique: Vec<EntreeHistorique>,
    fiches: Vec<FicheEnregistree>,
    lecture: EtatLecture,
}

pub struct Magasin {
    dossier: PathBuf,
    etat: Mutex<Etat>,
    /// Nombre de fichiers dont les étiquettes ont été lues (essais : le cache évite toute relecture inutile).
    pub lectures: std::sync::atomic::AtomicUsize,
}

fn lire_ou_vide<T: DeserializeOwned + Default>(chemin: &Path) -> T {
    match atomique::lire_json::<Enveloppe<T>>(chemin) {
        Lecture::Lu(e) => e.contenu,
        Lecture::Absent => T::default(),
        Lecture::Illisible(m) => {
            let mut de_cote = chemin.as_os_str().to_os_string();
            de_cote.push(".illisible");
            let _ = std::fs::rename(chemin, &de_cote);
            journal::avert("musique", &format!("{} mis de côté : {m}.", chemin.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()));
            T::default()
        }
    }
}

fn empreinte(m: &Media) -> String {
    format!("{}:{}", m.taille, m.modifie_le)
}

impl Magasin {
    pub fn sous(racine: &Path) -> Magasin {
        Magasin { dossier: racine.join("musique"), etat: Mutex::new(Etat::default()), lectures: Default::default() }
    }

    pub fn dossier_pochettes(&self) -> PathBuf {
        self.dossier.join("pochettes")
    }

    fn chemin(&self, n: &str) -> PathBuf {
        self.dossier.join(n)
    }

    fn verrou(&self) -> std::sync::MutexGuard<'_, Etat> {
        let mut e = self.etat.lock().unwrap_or_else(|x| x.into_inner());
        if !e.charge {
            e.pistes = lire_ou_vide(&self.chemin("etiquettes.json"));
            e.provenances = lire_ou_vide(&self.chemin("provenances.json"));
            e.playlists = lire_ou_vide(&self.chemin("playlists.json"));
            e.historique = lire_ou_vide(&self.chemin("historique.json"));
            e.fiches = lire_ou_vide(&self.chemin("fiches.json"));
            e.lecture = lire_ou_vide(&self.chemin("lecture.json"));
            e.charge = true;
        }
        e
    }

    fn ecrire<T: Serialize>(&self, n: &str, v: &T) -> Result<(), String> {
        atomique::ecrire_json(&self.chemin(n), &Enveloppe { schema: 1, contenu: v }, false).map_err(|e| format!("Enregistrement impossible ({}).", e.kind()))
    }

    /// Enregistre une pochette (nom = empreinte SHA-256 de l'image : une seule copie par image distincte).
    fn garder_pochette(&self, octets: &[u8], ext: &str) -> Option<String> {
        let h: String = Sha256::digest(octets).iter().take(16).map(|b| format!("{b:02x}")).collect();
        let nom = format!("{h}.{ext}");
        let p = self.dossier_pochettes().join(&nom);
        if p.is_file() || atomique::ecrire(&p, octets).is_ok() {
            Some(nom)
        } else {
            None
        }
    }

    /// Met la bibliothèque musicale à jour depuis l'index : chaque média audio disponible a sa fiche ; les étiquettes ne
    /// sont relues que pour un fichier nouveau ou modifié ; les fiches des médias disparus de l'index sont retirées
    /// (leur provenance reste, si le fichier revient).
    pub fn actualiser(&self, medias: &[Media]) -> Vec<Piste> {
        let audio: Vec<&Media> = medias.iter().filter(|m| m.type_media == TypeMedia::Audio && m.etat == EtatMedia::Disponible).collect();
        let mut e = self.verrou();
        let mut change = false;
        let ids: std::collections::BTreeSet<&str> = audio.iter().map(|m| m.id.as_str()).collect();
        let avant = e.pistes.len();
        e.pistes.retain(|id, _| ids.contains(id.as_str()));
        change |= e.pistes.len() != avant;
        for m in &audio {
            let em = empreinte(m);
            if e.pistes.get(&m.id).is_some_and(|p| p.empreinte == em) {
                continue;
            }
            drop(e);
            let lu = etiquettes::lire(Path::new(&m.chemin));
            self.lectures.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let piste = match lu {
                Ok(t) => Piste {
                    id: m.id.clone(),
                    titre: t.titre.clone().unwrap_or_else(|| m.nom.clone()),
                    artistes: t.artistes.clone(),
                    album: t.album.clone(),
                    artiste_album: t.artiste_album.clone(),
                    numero: t.numero,
                    disque: t.disque,
                    annee: t.annee,
                    genre: t.genre.clone(),
                    isrc: t.isrc.clone(),
                    duree_s: t.duree_s.or(m.duree),
                    qualite: t.qualite.clone(),
                    pochette: t.pochette.as_ref().and_then(|(o, x)| self.garder_pochette(o, x)),
                    etiquetage: if t.etiquete { "ok".into() } else { "absentes".into() },
                    erreur: None,
                    empreinte: em,
                    provenance: None,
                },
                Err(msg) => Piste {
                    id: m.id.clone(),
                    titre: m.nom.clone(),
                    artistes: Vec::new(),
                    album: None,
                    artiste_album: None,
                    numero: None,
                    disque: None,
                    annee: None,
                    genre: None,
                    isrc: None,
                    duree_s: m.duree,
                    qualite: Qualite { codec: m.ext.to_lowercase(), conteneur: m.ext.to_lowercase(), ..Default::default() },
                    pochette: None,
                    etiquetage: "illisible".into(),
                    erreur: Some(msg),
                    empreinte: em,
                    provenance: None,
                },
            };
            e = self.verrou();
            e.pistes.insert(m.id.clone(), piste);
            change = true;
        }
        if change {
            if let Err(m) = self.ecrire("etiquettes.json", &e.pistes) {
                journal::avert("musique", &m);
            }
        }
        let prov = e.provenances.clone();
        e.pistes
            .values()
            .cloned()
            .map(|mut p| {
                p.provenance = prov.get(&p.id).cloned();
                p
            })
            .collect()
    }

    pub fn vue(&self, medias: &[Media]) -> VueMusique {
        let pistes = self.actualiser(medias);
        let e = self.verrou();
        VueMusique {
            pistes,
            playlists: e.playlists.clone(),
            historique: e.historique.clone(),
            fiches: e.fiches.clone(),
            lecture: e.lecture.clone(),
            dossier_pochettes: self.dossier_pochettes().to_string_lossy().into_owned(),
        }
    }

    pub fn playlists(&self) -> Vec<Playlist> {
        self.verrou().playlists.clone()
    }

    pub fn modifier_playlists(&self, op: OpPlaylist) -> Result<(Vec<Playlist>, Option<String>), String> {
        let mut e = self.verrou();
        let mut l = e.playlists.clone();
        let id = appliquer(&mut l, op, &horloge::iso(horloge::maintenant()))?;
        self.ecrire("playlists.json", &l)?;
        e.playlists = l.clone();
        Ok((l, id))
    }

    /// Playlist synchronisée depuis un service : créée ou mise à jour par son lien d'origine.
    pub fn enregistrer_synchronisee(&self, nom: &str, pistes: Vec<String>, source: SourcePlaylist) -> Result<Vec<Playlist>, String> {
        ids_valides(&pistes)?;
        let mut e = self.verrou();
        let mut l = e.playlists.clone();
        let t = horloge::iso(horloge::maintenant());
        match l.iter_mut().find(|p| p.source.as_ref().is_some_and(|s| s.url == source.url)) {
            Some(p) => {
                p.pistes = pistes;
                p.source = Some(source);
                p.modifie_le = t;
            }
            None => {
                if l.len() >= PLAYLISTS_MAX {
                    return Err(format!("{PLAYLISTS_MAX} playlists au plus."));
                }
                l.push(Playlist { id: format!("pl_{}", uuid::Uuid::new_v4().simple()), nom: nom_valide(nom)?, pistes, cree_le: t.clone(), modifie_le: t, source: Some(source) });
            }
        }
        self.ecrire("playlists.json", &l)?;
        e.playlists = l.clone();
        Ok(l)
    }

    pub fn noter(&self, entree: EntreeHistorique) -> Result<Vec<EntreeHistorique>, String> {
        let entree = historique_propre(entree, &horloge::iso(horloge::maintenant()))?;
        let mut e = self.verrou();
        let mut h = e.historique.clone();
        // Une entrée d'import se met à jour (même identifiant d'import) au lieu de s'empiler.
        if let Some(i) = entree.import_id.as_ref().and_then(|imp| h.iter().position(|x| x.import_id.as_deref() == Some(imp))) {
            h.remove(i);
        }
        h.insert(0, entree);
        h.truncate(HISTORIQUE_MAX);
        self.ecrire("historique.json", &h)?;
        e.historique = h.clone();
        Ok(h)
    }

    pub fn effacer_historique(&self) -> Result<(), String> {
        let mut e = self.verrou();
        self.ecrire("historique.json", &Vec::<EntreeHistorique>::new())?;
        e.historique.clear();
        Ok(())
    }

    pub fn enregistrer_fiche(&self, f: FicheEnregistree) -> Result<Vec<FicheEnregistree>, String> {
        let f = fiche_propre(f, &horloge::iso(horloge::maintenant()))?;
        let mut e = self.verrou();
        let mut l = e.fiches.clone();
        l.retain(|x| x.url != f.url);
        l.insert(0, f);
        l.truncate(FICHES_MAX);
        self.ecrire("fiches.json", &l)?;
        e.fiches = l.clone();
        Ok(l)
    }

    pub fn retirer_fiche(&self, url: &str) -> Result<Vec<FicheEnregistree>, String> {
        let mut e = self.verrou();
        let mut l = e.fiches.clone();
        l.retain(|x| x.url != url);
        self.ecrire("fiches.json", &l)?;
        e.fiches = l.clone();
        Ok(l)
    }

    pub fn enregistrer_lecture(&self, l: EtatLecture) -> Result<EtatLecture, String> {
        let l = lecture_valide(l, &horloge::iso(horloge::maintenant()))?;
        let mut e = self.verrou();
        self.ecrire("lecture.json", &l)?;
        e.lecture = l.clone();
        Ok(l)
    }

    /// Provenance d'un fichier importé, rattachée à l'identifiant que l'index donnera au fichier final.
    pub fn noter_provenance(&self, chemin_final: &Path, p: Provenance) -> Result<String, String> {
        let id = noms::id_media(&chemin_final.to_string_lossy());
        let mut e = self.verrou();
        let mut m = e.provenances.clone();
        m.insert(id.clone(), p);
        self.ecrire("provenances.json", &m)?;
        e.provenances = m;
        Ok(id)
    }
}

#[cfg(test)]
mod essais {
    use super::*;
    use crate::bibliotheque::Origine;

    fn media(dir: &Path, fichier: &str, modifie: &str) -> Media {
        let src = super::super::etiquettes::essais_fixture(fichier);
        let dst = dir.join(fichier);
        if !dst.exists() {
            std::fs::copy(&src, &dst).unwrap();
        }
        let chemin = dst.to_string_lossy().into_owned();
        let (nom, ext) = fichier.rsplit_once('.').unwrap();
        Media {
            id: noms::id_media(&chemin),
            chemin,
            nom: nom.into(),
            ext: ext.into(),
            type_media: TypeMedia::Audio,
            taille: std::fs::metadata(&dst).unwrap().len(),
            ajoute_le: "2026-10-24T00:00:00Z".into(),
            modifie_le: modifie.into(),
            duree: None,
            largeur: None,
            hauteur: None,
            ips: None,
            codec_video: None,
            codec_audio: None,
            miniature: None,
            etat: EtatMedia::Disponible,
            erreur: None,
            premiere_compatible: None,
            origine: Origine::default(),
        }
    }

    #[test]
    fn bibliotheque_lue_une_fois_puis_cache_relu_si_le_fichier_change() {
        let d = tempfile::tempdir().unwrap();
        let mag = Magasin::sous(&d.path().join("R"));
        let mut ms = vec![media(d.path(), "nocturne.mp3", "a"), media(d.path(), "ivoire.flac", "a"), media(d.path(), "sans-etiquette.wav", "a")];
        let mut video = media(d.path(), "champagne.m4a", "a");
        video.type_media = TypeMedia::Video;
        ms.push(video);
        let p = mag.actualiser(&ms);
        assert_eq!(p.len(), 3, "seuls les médias audio disponibles");
        assert_eq!(mag.lectures.load(std::sync::atomic::Ordering::Relaxed), 3);
        let noct = p.iter().find(|x| x.titre == "Clair de nuit").unwrap();
        let poch = noct.pochette.clone().unwrap();
        assert!(mag.dossier_pochettes().join(&poch).is_file(), "pochette extraite à part");
        let wav = p.iter().find(|x| x.etiquetage == "absentes").unwrap();
        assert_eq!(wav.titre, "sans-etiquette", "titre = nom du fichier, signalé « absentes »");
        // Un second passage ne relit rien ; un nouveau magasin (redémarrage) relit le cache disque, sans relire les fichiers.
        mag.actualiser(&ms);
        assert_eq!(mag.lectures.load(std::sync::atomic::Ordering::Relaxed), 3);
        let mag2 = Magasin::sous(&d.path().join("R"));
        assert_eq!(mag2.actualiser(&ms).len(), 3);
        assert_eq!(mag2.lectures.load(std::sync::atomic::Ordering::Relaxed), 0);
        // Fichier modifié : relu ; fichier disparu de l'index : fiche retirée.
        ms[0].modifie_le = "b".into();
        ms.remove(1);
        let p = mag2.actualiser(&ms);
        assert_eq!(mag2.lectures.load(std::sync::atomic::Ordering::Relaxed), 1);
        assert_eq!(p.len(), 2);
        // Les fichiers audio ne sont jamais modifiés.
        let o = std::fs::read(d.path().join("nocturne.mp3")).unwrap();
        assert_eq!(o, std::fs::read(super::super::etiquettes::essais_fixture("nocturne.mp3")).unwrap());
    }

    #[test]
    fn pochette_identique_gardee_une_seule_fois() {
        let d = tempfile::tempdir().unwrap();
        let sous = d.path().join("b");
        std::fs::create_dir_all(&sous).unwrap();
        let mag = Magasin::sous(&d.path().join("R"));
        let a = media(d.path(), "nocturne.mp3", "a");
        let b = media(&sous, "nocturne.mp3", "a");
        let p = mag.actualiser(&[a, b]);
        assert_eq!(p.len(), 2);
        assert_eq!(p[0].pochette, p[1].pochette);
        assert_eq!(std::fs::read_dir(mag.dossier_pochettes()).unwrap().count(), 1);
    }

    #[test]
    fn playlists_creer_ajouter_deplacer_reordonner_avec_refus() {
        let d = tempfile::tempdir().unwrap();
        let mag = Magasin::sous(d.path());
        let (a, b, c) = ("a".repeat(40), "b".repeat(40), "c".repeat(40));
        assert!(noms::est_id_valide(&a), "forme d'identifiant d'index");
        let (_, id) = mag.modifier_playlists(OpPlaylist::Creer { nom: "  Nuit   blanche ".into(), pistes: vec![a.clone()] }).unwrap();
        let id = id.unwrap();
        let (l, _) = mag.modifier_playlists(OpPlaylist::Ajouter { id: id.clone(), pistes: vec![b.clone(), c.clone()], position: None }).unwrap();
        assert_eq!(l[0].nom, "Nuit blanche");
        assert_eq!(l[0].pistes, vec![a.clone(), b.clone(), c.clone()]);
        let (l, _) = mag.modifier_playlists(OpPlaylist::Deplacer { id: id.clone(), de: 2, vers: 0 }).unwrap();
        assert_eq!(l[0].pistes, vec![c.clone(), a.clone(), b.clone()]);
        let (l, _) = mag.modifier_playlists(OpPlaylist::Reordonner { id: id.clone(), pistes: vec![a.clone(), b.clone(), c.clone()] }).unwrap();
        assert_eq!(l[0].pistes, vec![a.clone(), b.clone(), c.clone()]);
        // Refus : pas une permutation, identifiant invalide, position hors liste, nom vide ou trop long, playlist inconnue.
        assert!(mag.modifier_playlists(OpPlaylist::Reordonner { id: id.clone(), pistes: vec![a.clone(), a.clone(), c.clone()] }).is_err());
        assert!(mag.modifier_playlists(OpPlaylist::Ajouter { id: id.clone(), pistes: vec!["../x".into()], position: None }).is_err());
        assert!(mag.modifier_playlists(OpPlaylist::Deplacer { id: id.clone(), de: 0, vers: 9 }).is_err());
        assert!(mag.modifier_playlists(OpPlaylist::Creer { nom: "   ".into(), pistes: vec![] }).is_err());
        assert!(mag.modifier_playlists(OpPlaylist::Creer { nom: "x".repeat(81), pistes: vec![] }).is_err());
        assert!(mag.modifier_playlists(OpPlaylist::Supprimer { id: "pl_inconnue".into() }).is_err());
        // Rien n'a bougé après les refus ; relu depuis le disque par un nouveau magasin.
        let relu = Magasin::sous(d.path()).playlists();
        assert_eq!(relu[0].pistes, vec![a.clone(), b, c]);
        let (l, _) = mag.modifier_playlists(OpPlaylist::Retirer { id: id.clone(), position: 0 }).unwrap();
        assert_eq!(l[0].pistes.len(), 2);
        let (l, _) = mag.modifier_playlists(OpPlaylist::Supprimer { id }).unwrap();
        assert!(l.is_empty());
        // Aucun fichier temporaire oublié.
        assert!(std::fs::read_dir(d.path().join("musique")).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().ends_with(".tmp")));
    }

    #[test]
    fn fichier_illisible_mis_de_cote_jamais_ecrase_en_silence() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("musique")).unwrap();
        std::fs::write(d.path().join("musique/playlists.json"), b"{ coupe").unwrap();
        let mag = Magasin::sous(d.path());
        assert!(mag.playlists().is_empty());
        assert!(d.path().join("musique/playlists.json.illisible").is_file());
    }

    #[test]
    fn historique_borne_mis_a_jour_par_import_et_valide() {
        let d = tempfile::tempdir().unwrap();
        let mag = Magasin::sous(d.path());
        for i in 0..(HISTORIQUE_MAX + 5) {
            mag.noter(EntreeHistorique { action: "analyse".into(), url: format!("https://archive.org/details/x{i}"), connecteur: "archive".into(), etat: "telechargeable".into(), ..Default::default() }).unwrap();
        }
        let h = mag.noter(EntreeHistorique { action: "import".into(), url: "https://archive.org/details/y".into(), import_id: Some("mus_1".into()), etat: "en_file".into(), ..Default::default() }).unwrap();
        assert_eq!(h.len(), HISTORIQUE_MAX);
        let h = mag.noter(EntreeHistorique { action: "import".into(), url: "https://archive.org/details/y".into(), import_id: Some("mus_1".into()), etat: "termine".into(), ..Default::default() }).unwrap();
        assert_eq!(h.iter().filter(|x| x.import_id.as_deref() == Some("mus_1")).count(), 1);
        assert_eq!(h[0].etat, "termine");
        assert!(mag.noter(EntreeHistorique { action: "analyse".into(), url: "http://archive.org/x".into(), ..Default::default() }).is_err(), "http refusé");
        assert!(mag.noter(EntreeHistorique { action: "pirater".into(), url: "https://x.y".into(), ..Default::default() }).is_err());
        let h = mag.noter(EntreeHistorique { action: "analyse".into(), url: "https://x.y/a".into(), pochette: Some("javascript:alert(1)".into()), ..Default::default() }).unwrap();
        assert_eq!(h[0].pochette, None);
        mag.effacer_historique().unwrap();
        assert!(Magasin::sous(d.path()).verrou().historique.is_empty());
    }

    #[test]
    fn reprise_de_lecture_validee() {
        let d = tempfile::tempdir().unwrap();
        let mag = Magasin::sous(d.path());
        let a = format!("loc:{}", "a".repeat(40));
        let l = mag.enregistrer_lecture(EtatLecture { file: vec![a.clone()], index: 7, position_s: -3.0, volume: 4.0, repetition: "tout".into(), ..Default::default() }).unwrap();
        assert_eq!((l.index, l.position_s, l.volume), (0, 0.0, 1.0));
        assert!(mag.enregistrer_lecture(EtatLecture { file: vec!["file:C:/x".into()], ..Default::default() }).is_err());
        assert!(mag.enregistrer_lecture(EtatLecture { repetition: "toujours".into(), ..Default::default() }).is_err());
        assert!(mag.enregistrer_lecture(EtatLecture { volume: f64::NAN, ..Default::default() }).is_err());
        assert_eq!(Magasin::sous(d.path()).verrou().lecture.file, vec![a]);
    }

    #[test]
    fn fiches_enregistrees_dedoublonnees() {
        let d = tempfile::tempdir().unwrap();
        let mag = Magasin::sous(d.path());
        let f = FicheEnregistree { url: "https://open.spotify.com/track/abc".into(), connecteur: "spotify".into(), etat: "identifie".into(), ..Default::default() };
        mag.enregistrer_fiche(f.clone()).unwrap();
        let l = mag.enregistrer_fiche(f).unwrap();
        assert_eq!(l.len(), 1);
        assert!(mag.retirer_fiche("https://open.spotify.com/track/abc").unwrap().is_empty());
    }
}

//! AETHRYON INDEX : scanner de médias locaux, dans l'esprit d'« Everything » (recherche instantanée sur un index
//! local), qui fonctionne sans aucun logiciel supplémentaire.
//!
//! - Cibles : un dossier, un ou plusieurs disques, ou tous les disques disponibles (`reglages::Cible`).
//! - Scan ASYNCHRONE sur des fils dédiés en priorité basse (processeur ET E/S sous Windows), nombre de fils borné,
//!   annulable à tout moment ; progression réelle (fichiers vus, médias par type, dossiers, erreurs) ; « mesurable »
//!   seulement quand un total existe (mode Everything, métadonnées, miniatures) : sinon indéterminée, jamais de
//!   pourcentage inventé.
//! - Index persistant SQLite (`base`), incrémental : ajouts, modifications, renommages et déplacements reconnus par
//!   l'identifiant de fichier (NTFS), suppressions (absents 7 jours), disques débranchés « indisponibles » (jamais
//!   effacés), doublons d'index (même fichier vu par deux chemins).
//! - Surveillance en direct des DOSSIERS ciblés (jamais d'un disque entier), métadonnées différées et miniatures
//!   progressives (`enrichissement`), mode accéléré Everything facultatif (`everything`).
//! - Bibliothèque unifiée : les médias d'`index.json` (dossiers surveillés) sont recopiés dans l'index avec leur
//!   source, et une seule requête (recherche, filtres, tri, pagination) sert les deux. `index.json` et le contrat avec
//!   le panneau Premiere ne changent pas : les fichiers scannés n'y vont jamais.
//!
//! Les fichiers d'origine ne sont JAMAIS déplacés, renommés ni modifiés : l'index ne fait que les lire.

pub mod base;
pub mod enrichissement;
pub mod everything;
pub mod parcours;
pub mod priorite;
pub mod reglages;
pub mod volumes;

#[cfg(test)]
mod essais;

use self::base::{AAnalyserIndex, Base, Bilan, Ecriture, Page, Requete, Source, Totaux, SRC_EVERYTHING, SRC_NATIF};
use self::everything::EtatEverything;
use self::parcours::{Compteurs, FichierVu, ListeDossier, Message, Options, RacineParcours};
use self::reglages::{Cible, Exclusions, GenreCible, ModeEverything, Reglages};
use self::volumes::{IdentVolume, SourceVolumes, Volume};
use crate::bibliotheque::{AnalyseWeb, Media, TypeMedia};
use crate::{horloge, journal, noms};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, RecvTimeoutError};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, RwLock};
use std::time::{Duration, Instant};

/// Liste d'erreurs gardée dans le résumé (le compte, lui, est complet).
pub const ERREURS_LISTEES: usize = 200;
/// Dossiers surveillés en direct au plus.
pub const VEILLE_MAX: usize = 32;
const REGROUPEMENT_VEILLE: Duration = Duration::from_millis(1500);
const PERIODE_PROGRESSION: Duration = Duration::from_millis(250);

/// Avis vers l'interface (événements Tauri dans l'application, rien dans les essais).
pub trait AvisIndex: Send + Sync + 'static {
    fn progression(&self, p: &Progression);
    fn fin(&self, r: &Resume);
    /// `index` (contenu), `bibliotheque` (copie d'index.json), `reglages`, `volumes`.
    fn changement(&self, quoi: &str);
    fn enrichissement(&self, e: &Enrichissement);
    fn migration(&self, m: &Migration);
}

pub struct AvisMuet;

impl AvisIndex for AvisMuet {
    fn progression(&self, _: &Progression) {}
    fn fin(&self, _: &Resume) {}
    fn changement(&self, _: &str) {}
    fn enrichissement(&self, _: &Enrichissement) {}
    fn migration(&self, _: &Migration) {}
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompteTypes {
    pub video: u64,
    pub audio: u64,
    pub image: u64,
}

impl CompteTypes {
    pub fn total(&self) -> u64 {
        self.video + self.audio + self.image
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Preparation,
    Parcours,
    Everything,
    Rapprochement,
    Termine,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progression {
    pub scan: i64,
    pub phase: Phase,
    /// `natif`, `everything` ou `mixte`.
    pub mode: String,
    pub cibles: Vec<String>,
    pub fichiers_vus: u64,
    pub dossiers: u64,
    pub medias: CompteTypes,
    pub octets: u64,
    pub erreurs: u64,
    pub liens_ignores: u64,
    pub exclus: u64,
    pub boucles_evitees: u64,
    pub bilan: Bilan,
    /// Vrai seulement si un total réel est connu (mode Everything) : sinon progression indéterminée.
    pub mesurable: bool,
    pub fraction: Option<f64>,
    pub dossier_courant: Option<String>,
    /// Fichiers vus par seconde.
    pub debit: f64,
    pub ecoule_ms: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ErreurScan {
    pub chemin: String,
    pub message: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Resume {
    pub scan: i64,
    /// `termine`, `annule` ou `erreur`.
    pub etat: String,
    pub mode: String,
    pub debut: String,
    pub fin: String,
    pub duree_ms: u64,
    pub cibles: Vec<String>,
    pub medias: CompteTypes,
    pub total_medias: u64,
    pub fichiers_vus: u64,
    pub dossiers: u64,
    pub octets: u64,
    pub erreurs: u64,
    pub erreurs_liste: Vec<ErreurScan>,
    pub liens_ignores: u64,
    pub exclus: u64,
    pub boucles_evitees: u64,
    pub bilan: Bilan,
    /// Cibles sur un volume débranché ou absent : leurs fichiers sont « indisponibles », pas supprimés.
    pub volumes_indisponibles: Vec<String>,
    pub message: Option<String>,
    pub debit: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Enrichissement {
    /// `metadonnees`, `miniatures` ou `repos`.
    pub phase: String,
    pub fait: u64,
    /// Total réel (fichiers en attente au début de la phase + faits) : progression mesurable.
    pub total: u64,
    pub actif: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Migration {
    /// `base`, `miniatures`, `verification`, `bascule`, `termine` ou `erreur`.
    pub etape: String,
    pub fait: u64,
    pub total: u64,
    pub message: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EtatIndex {
    pub scan: Option<Progression>,
    pub dernier: Option<Resume>,
    /// Cibles d'un scan interrompu (coupure, fermeture) : « Reprendre » relance un scan incrémental.
    pub interrompu: Option<Vec<Cible>>,
    pub totaux: Totaux,
    pub emplacement: String,
    pub taille_index: u64,
    pub enrichissement: Enrichissement,
    pub everything: EtatEverything,
    pub mode_everything: ModeEverything,
    /// Dossiers surveillés en direct.
    pub veille: Vec<String>,
    pub migration: bool,
}

/// Volume tel que montré par l'écran du scanner : le volume et ce que l'index en contient.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VolumeIndex {
    #[serde(flatten)]
    pub volume: Volume,
    pub indexe: base::StatVolume,
    /// Cible enregistrée dans les réglages.
    pub cible: bool,
}

struct ScanActif {
    annule: Arc<AtomicBool>,
    progression: Arc<Mutex<Progression>>,
}

#[derive(Default)]
struct Travail {
    bibliotheque: Option<Vec<Media>>,
    prioritaires: VecDeque<i64>,
    veille: HashMap<PathBuf, (Instant, bool)>,
    rescanner_veille: bool,
    reveil: bool,
}

struct Partage {
    config: PathBuf,
    racine: PathBuf,
    reglages: Mutex<Reglages>,
    avis: Box<dyn AvisIndex>,
    volumes: Box<dyn SourceVolumes>,
    volumes_vus: Mutex<Vec<Volume>>,
    acces: RwLock<()>,
    lecteur: Mutex<Option<Base>>,
    scan: Mutex<Option<ScanActif>>,
    dernier: Mutex<Option<Resume>>,
    travail: Mutex<Travail>,
    cv: Condvar,
    arret: AtomicBool,
    migration: AtomicBool,
    enrich: Mutex<Enrichissement>,
    veilleur: Mutex<Option<notify::RecommendedWatcher>>,
    veille: Mutex<Vec<String>>,
    pause: Mutex<Option<Duration>>,
    fin_scan: Condvar,
}

fn verrou<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Le moteur de l'index (clonable, partagé avec les commandes Tauri).
#[derive(Clone)]
pub struct IndexMedias {
    p: Arc<Partage>,
}

fn options(r: &Reglages, pause: Option<Duration>) -> Options {
    Options {
        extensions: r.table_extensions(),
        exclusions: Exclusions::depuis(&r.exclusions),
        exclure_caches: r.exclure_caches,
        suivre_liens: r.suivre_liens,
        taille_min: r.taille_min,
        fils: r.fils as usize,
        pause,
    }
}

fn cle(p: &Path) -> String {
    reglages::cle_dossier(&p.to_string_lossy())
}

/// Racines à parcourir : chemins propres, sans doublon ni racine incluse dans une autre (la plus haute gagne).
pub fn resoudre_cibles(cibles: &[Cible], vus: &[Volume]) -> Vec<PathBuf> {
    let mut l: Vec<PathBuf> = Vec::new();
    for c in cibles {
        match c.genre {
            GenreCible::Tous => l.extend(vus.iter().filter(|v| v.pour_tous()).map(|v| PathBuf::from(&v.racine))),
            _ => l.extend(reglages::chemin_propre(&c.chemin)),
        }
    }
    l.sort_by_key(|p| cle(p).len());
    let mut gardees: Vec<PathBuf> = Vec::new();
    for p in l {
        let k = cle(&p);
        let incluse = gardees.iter().any(|g| {
            let kg = cle(g);
            k == kg || kg.is_empty() || k.starts_with(&format!("{kg}\\"))
        });
        if !incluse {
            gardees.push(p);
        }
    }
    gardees
}

impl IndexMedias {
    /// `config` : dossier des réglages (`%APPDATA%\AETHRYON`) ; `racine` : `R` (`%LOCALAPPDATA%\AETHRYON`).
    pub fn demarrer(config: &Path, racine: &Path, volumes: Box<dyn SourceVolumes>, avis: Box<dyn AvisIndex>) -> IndexMedias {
        let ch = reglages::charger(config);
        for r in &ch.remarques {
            journal::avert("index", r);
        }
        let p = Arc::new(Partage {
            config: config.to_path_buf(),
            racine: racine.to_path_buf(),
            reglages: Mutex::new(ch.reglages),
            avis,
            volumes,
            volumes_vus: Mutex::new(Vec::new()),
            acces: RwLock::new(()),
            lecteur: Mutex::new(None),
            scan: Mutex::new(None),
            dernier: Mutex::new(None),
            travail: Mutex::new(Travail::default()),
            cv: Condvar::new(),
            arret: AtomicBool::new(false),
            migration: AtomicBool::new(false),
            enrich: Mutex::new(Enrichissement { phase: "repos".into(), ..Default::default() }),
            veilleur: Mutex::new(None),
            veille: Mutex::new(Vec::new()),
            pause: Mutex::new(None),
            fin_scan: Condvar::new(),
        });
        let ix = IndexMedias { p };
        let emplacement = ix.emplacement();
        nettoyer_migration(&emplacement, true);
        match Base::ouvrir(&emplacement, 2000) {
            Ok(b) => {
                match b.marquer_interrompus() {
                    Ok(n) if n > 0 => journal::avert("index", &format!("{n} scan(s) interrompu(s) (coupure ou fermeture) : reprise par un scan incrémental.")),
                    _ => {}
                }
                *verrou(&ix.p.dernier) = b.resume(None).and_then(|r| serde_json::from_str(&r).ok());
            }
            Err(e) => journal::avert("index", &format!("Index indisponible au démarrage : {e}")),
        }
        let m = ix.clone();
        let _ = std::thread::Builder::new().name("aethryon-index-entretien".into()).spawn(move || m.entretien());
        ix.relancer_veille();
        ix
    }

    pub fn emplacement(&self) -> PathBuf {
        verrou(&self.p.reglages).emplacement.as_ref().map(PathBuf::from).unwrap_or_else(|| self.p.racine.join("index"))
    }

    fn miniatures_bibliotheque(&self) -> PathBuf {
        self.p.racine.join("bibliotheque").join("miniatures")
    }

    /// Dossier des miniatures de l'index (pour la portée `asset:` de l'interface).
    pub fn dossier_miniatures(&self) -> PathBuf {
        self.emplacement().join("miniatures")
    }

    pub fn reglages(&self) -> Reglages {
        verrou(&self.p.reglages).clone()
    }

    pub fn modifier_reglages(&self, patch: &Value) -> Result<Reglages, String> {
        let r = {
            let mut g = verrou(&self.p.reglages);
            let mut copie = g.clone();
            copie.appliquer(patch)?;
            reglages::enregistrer(&self.p.config, &copie).map_err(|e| format!("Réglages de l'index non enregistrés ({}).", e.kind()))?;
            *g = copie.clone();
            copie
        };
        self.relancer_veille();
        self.reveiller();
        self.p.avis.changement("reglages");
        Ok(r)
    }

    /// Essais : pause après chaque dossier (scan ralenti, coupure simulée).
    #[doc(hidden)]
    pub fn regler_pause(&self, d: Option<Duration>) {
        *verrou(&self.p.pause) = d;
    }

    fn reveiller(&self) {
        verrou(&self.p.travail).reveil = true;
        self.p.cv.notify_all();
    }

    pub fn arreter(&self) {
        self.p.arret.store(true, Ordering::SeqCst);
        if let Some(s) = verrou(&self.p.scan).as_ref() {
            s.annule.store(true, Ordering::SeqCst);
        }
        *verrou(&self.p.veilleur) = None;
        self.p.cv.notify_all();
    }

    // ---- Volumes ----

    /// Volumes du système, avec ce que l'index en contient. Met à jour les disponibilités (fichiers d'un disque
    /// débranché → « indisponibles », de retour → « présents » ; lettre changée → chemins réécrits).
    pub fn volumes(&self) -> Result<Vec<VolumeIndex>, String> {
        let vus = self.p.volumes.lister();
        *verrou(&self.p.volumes_vus) = vus.clone();
        let _g = self.p.acces.read().unwrap_or_else(|e| e.into_inner());
        let b = Base::ouvrir(&self.emplacement(), 2000)?;
        let (indispo, retrouves) = b.appliquer_volumes(&vus).map_err(base::err)?;
        if indispo + retrouves > 0 {
            self.p.avis.changement("index");
        }
        let stats = b.stats_volumes().map_err(base::err)?;
        let cibles = verrou(&self.p.reglages).cibles.clone();
        Ok(vus
            .into_iter()
            .map(|v| {
                let indexe = v.cle.as_ref().and_then(|c| stats.get(c)).cloned().unwrap_or_default();
                let cible = cibles.iter().any(|c| c.genre == GenreCible::Volume && noms::normaliser_pour_id(&c.chemin) == noms::normaliser_pour_id(&v.racine));
                VolumeIndex { volume: v, indexe, cible }
            })
            .collect())
    }

    // ---- Scan ----

    /// Lance un scan (les cibles des réglages si `cibles` est absent). Répond tout de suite avec le numéro du scan :
    /// la progression arrive par `AvisIndex::progression`, le résumé par `AvisIndex::fin`.
    pub fn lancer_scan(&self, cibles: Option<Vec<Cible>>) -> Result<i64, String> {
        if self.p.migration.load(Ordering::SeqCst) {
            return Err("L'index est en cours de déplacement : réessaie dans un instant.".into());
        }
        if verrou(&self.p.scan).is_some() {
            return Err("Un scan est déjà en cours.".into());
        }
        let reg = self.reglages();
        let cibles = cibles.unwrap_or_else(|| reg.cibles.clone());
        if cibles.is_empty() {
            return Err("Choisis au moins un dossier ou un disque à scanner.".into());
        }
        for c in &cibles {
            if c.genre != GenreCible::Tous && reglages::chemin_propre(&c.chemin).is_none() {
                return Err(format!("Chemin refusé : « {} » (chemin complet attendu).", c.chemin));
            }
        }
        if reg.table_extensions().is_empty() {
            return Err("Aucun type de média n'est retenu (vidéo, audio, image) : rien à chercher.".into());
        }
        let vus = self.p.volumes.lister();
        *verrou(&self.p.volumes_vus) = vus.clone();
        let racines = resoudre_cibles(&cibles, &vus);
        if racines.is_empty() {
            return Err("Aucun disque disponible pour ces cibles.".into());
        }
        let emplacement = self.emplacement();
        let mode_everything = reg.everything == ModeEverything::Auto;
        let textes: Vec<String> = racines.iter().map(|r| r.to_string_lossy().into_owned()).collect();
        let mut g = verrou(&self.p.scan);
        if g.is_some() {
            return Err("Un scan est déjà en cours.".into());
        }
        let id = {
            let _a = self.p.acces.read().unwrap_or_else(|e| e.into_inner());
            let b = Base::ouvrir(&emplacement, 2000)?;
            b.debuter_scan(if mode_everything { "auto" } else { "natif" }, &serde_json::to_string(&cibles).unwrap_or_default()).map_err(base::err)?
        };
        let annule = Arc::new(AtomicBool::new(false));
        let progression = Arc::new(Mutex::new(Progression {
            scan: id,
            phase: Phase::Preparation,
            mode: "natif".into(),
            cibles: textes,
            fichiers_vus: 0,
            dossiers: 0,
            medias: CompteTypes::default(),
            octets: 0,
            erreurs: 0,
            liens_ignores: 0,
            exclus: 0,
            boucles_evitees: 0,
            bilan: Bilan::default(),
            mesurable: false,
            fraction: None,
            dossier_courant: None,
            debit: 0.0,
            ecoule_ms: 0,
        }));
        *g = Some(ScanActif { annule: annule.clone(), progression: progression.clone() });
        drop(g);
        let opts = Arc::new(options(&reg, *verrou(&self.p.pause)));
        let moi = self.clone();
        let r = std::thread::Builder::new().name("aethryon-index-scan".into()).spawn(move || {
            let resume = moi.executer(id, racines, vus, opts, annule, progression, mode_everything, &emplacement);
            moi.terminer(resume);
        });
        if let Err(e) = r {
            *verrou(&self.p.scan) = None;
            return Err(format!("Scan impossible à lancer ({e})."));
        }
        Ok(id)
    }

    pub fn annuler_scan(&self) -> bool {
        match verrou(&self.p.scan).as_ref() {
            Some(s) => {
                s.annule.store(true, Ordering::SeqCst);
                true
            }
            None => false,
        }
    }

    /// Attend la fin du scan en cours (essais, fermeture). Vrai si plus aucun scan ne tourne.
    pub fn attendre_scan(&self, max: Duration) -> bool {
        let limite = Instant::now() + max;
        let mut g = verrou(&self.p.scan);
        while g.is_some() {
            let reste = limite.saturating_duration_since(Instant::now());
            if reste.is_zero() {
                return false;
            }
            g = self.p.fin_scan.wait_timeout(g, reste).map(|x| x.0).unwrap_or_else(|e| e.into_inner().0);
        }
        true
    }

    fn terminer(&self, r: Resume) {
        *verrou(&self.p.dernier) = Some(r.clone());
        *verrou(&self.p.scan) = None;
        self.p.fin_scan.notify_all();
        self.p.avis.fin(&r);
        self.p.avis.changement("index");
        if r.etat == "termine" {
            self.relancer_veille();
        }
        self.reveiller();
    }

    #[allow(clippy::too_many_arguments)]
    fn executer(
        &self,
        id: i64,
        racines: Vec<PathBuf>,
        vus: Vec<Volume>,
        opts: Arc<Options>,
        annule: Arc<AtomicBool>,
        prog: Arc<Mutex<Progression>>,
        mode_everything: bool,
        emplacement: &Path,
    ) -> Resume {
        priorite::basse();
        let debut = Instant::now();
        let debut_iso = horloge::iso(horloge::maintenant());
        let cibles: Vec<String> = racines.iter().map(|r| r.to_string_lossy().into_owned()).collect();
        let c = Arc::new(Compteurs::default());
        let mut erreurs: Vec<ErreurScan> = Vec::new();
        let mut indisponibles: Vec<String> = Vec::new();
        let mut message = None;
        let mut mode = "natif".to_string();
        let mut ecr = Ecriture::nouvelle(id, SRC_NATIF, opts.clone());
        let _acces = self.p.acces.read().unwrap_or_else(|e| e.into_inner());
        let etat = match Base::ouvrir(emplacement, 16_000) {
            Err(e) => {
                message = Some(e);
                "erreur"
            }
            Ok(b) => {
                if let Err(e) = b.appliquer_volumes(&vus) {
                    journal::avert("index", &format!("Volumes non appliqués : {e}"));
                }
                // Racines sur un volume connu mais débranché : indisponibles, rien n'est effacé.
                let mut prets: Vec<RacineParcours> = Vec::new();
                for r in &racines {
                    let iv = volumes::volume_de(r, &vus);
                    if let Some(v) = iv.volume.as_ref().filter(|v| !v.disponible) {
                        let n = b.marquer_racine(r, base::INDISPONIBLE, ecr.maintenant).unwrap_or(0);
                        ecr.bilan.indisponibles += n;
                        indisponibles.push(format!("{} ({})", r.display(), v.message.clone().unwrap_or_else(|| "volume indisponible".into())));
                        continue;
                    }
                    prets.push(RacineParcours { chemin: r.clone(), volume: Arc::new(iv) });
                }
                // Mode Everything : racines locales NTFS (indexées par Everything par défaut), si Everything est prêt.
                let (par_everything, natives): (Vec<RacineParcours>, Vec<RacineParcours>) = if mode_everything && everything::detecter().disponible {
                    prets.into_iter().partition(|r| r.volume.ids_fiables)
                } else {
                    (Vec::new(), prets)
                };
                if !par_everything.is_empty() {
                    mode = if natives.is_empty() { "everything".into() } else { "mixte".into() };
                }
                verrou(&prog).mode = mode.clone();
                let r = self.boucle_ecriture(&b, &mut ecr, natives, par_everything, &opts, &annule, &c, &prog, &mut erreurs, debut);
                if let Err(e) = r {
                    message = Some(e);
                    "erreur"
                } else {
                    let _ = b.purger_absents(ecr.maintenant);
                    b.compacter_journal();
                    if annule.load(Ordering::SeqCst) {
                        "annule"
                    } else {
                        "termine"
                    }
                }
            }
        };
        ecr.clore();
        let l = |x: &std::sync::atomic::AtomicU64| x.load(Ordering::Relaxed);
        let medias = CompteTypes { video: l(&c.video), audio: l(&c.audio), image: l(&c.image) };
        let duree = debut.elapsed();
        let resume = Resume {
            scan: id,
            etat: etat.into(),
            mode,
            debut: debut_iso,
            fin: horloge::iso(horloge::maintenant()),
            duree_ms: duree.as_millis() as u64,
            cibles,
            total_medias: medias.total(),
            medias,
            fichiers_vus: l(&c.fichiers_vus),
            dossiers: l(&c.dossiers),
            octets: l(&c.octets),
            erreurs: l(&c.erreurs) + if etat == "erreur" { 1 } else { 0 },
            erreurs_liste: erreurs,
            liens_ignores: l(&c.liens),
            exclus: l(&c.exclus),
            boucles_evitees: l(&c.boucles),
            bilan: ecr.bilan.clone(),
            volumes_indisponibles: indisponibles,
            message,
            debit: (l(&c.fichiers_vus) as f64 / duree.as_secs_f64().max(0.001) * 10.0).round() / 10.0,
        };
        if let Ok(b) = Base::ouvrir(emplacement, 2000) {
            let _ = b.finir_scan(id, &resume.etat, &serde_json::to_string(&resume).unwrap_or_default());
        }
        {
            let mut p = verrou(&prog);
            p.phase = Phase::Termine;
            p.bilan = resume.bilan.clone();
            self.p.avis.progression(&p);
        }
        journal::info(
            "index",
            &format!(
                "Scan {id} {} en {} ms : {} vidéos, {} audios, {} images, {} erreurs ({} fichiers vus, {} dossiers).",
                resume.etat, resume.duree_ms, resume.medias.video, resume.medias.audio, resume.medias.image, resume.erreurs, resume.fichiers_vus, resume.dossiers
            ),
        );
        resume
    }

    #[allow(clippy::too_many_arguments)]
    fn boucle_ecriture(
        &self,
        b: &Base,
        ecr: &mut Ecriture,
        natives: Vec<RacineParcours>,
        par_everything: Vec<RacineParcours>,
        opts: &Arc<Options>,
        annule: &Arc<AtomicBool>,
        c: &Arc<Compteurs>,
        prog: &Arc<Mutex<Progression>>,
        erreurs: &mut Vec<ErreurScan>,
        debut: Instant,
    ) -> Result<(), String> {
        let mut en_tx = false;
        let mut lot = 0usize;
        let mut dernier_commit = Instant::now();
        let mut derniere_prog = Instant::now() - PERIODE_PROGRESSION;
        let mut courant: Option<String> = None;
        let emettre = |courant: &Option<String>, ecr: &Ecriture, phase: Phase, fraction: Option<f64>| {
            let mut p = verrou(prog);
            let l = |x: &std::sync::atomic::AtomicU64| x.load(Ordering::Relaxed);
            p.phase = phase;
            p.fichiers_vus = l(&c.fichiers_vus);
            p.dossiers = l(&c.dossiers);
            p.medias = CompteTypes { video: l(&c.video), audio: l(&c.audio), image: l(&c.image) };
            p.octets = l(&c.octets);
            p.erreurs = l(&c.erreurs);
            p.liens_ignores = l(&c.liens);
            p.exclus = l(&c.exclus);
            p.boucles_evitees = l(&c.boucles);
            p.bilan = ecr.bilan.clone();
            p.mesurable = fraction.is_some();
            p.fraction = fraction;
            p.dossier_courant = courant.clone();
            p.ecoule_ms = debut.elapsed().as_millis() as u64;
            p.debit = (p.fichiers_vus as f64 / debut.elapsed().as_secs_f64().max(0.001) * 10.0).round() / 10.0;
            self.p.avis.progression(&p);
        };
        let valider = |en_tx: &mut bool| -> Result<(), String> {
            if *en_tx {
                b.valider().map_err(base::err)?;
                *en_tx = false;
            }
            Ok(())
        };
        // 1. Racines lues dans l'index d'Everything (aucun parcours du disque).
        ecr.source = SRC_EVERYTHING;
        for (i, r) in par_everything.iter().enumerate() {
            if annule.load(Ordering::SeqCst) {
                break;
            }
            let exts: Vec<String> = opts.extensions.keys().cloned().collect();
            let mut groupe: Option<ListeDossier> = None;
            let mut vus_dossiers: HashSet<String> = HashSet::new();
            let mut recus = 0u64;
            let mut echec = None;
            let racine_txt = r.chemin.to_string_lossy().into_owned();
            let cle_racine = cle(&r.chemin);
            let resultat = everything::lister(&racine_txt, &exts, annule, everything::PAR_PAGE, &mut |page, total| {
                for e in page {
                    recus += 1;
                    let Some(f) = fichier_everything(e, &r.chemin, &cle_racine, opts) else { continue };
                    let (dossier, fv) = f;
                    let k = cle(&dossier);
                    if groupe.as_ref().map(|g| cle(&g.chemin) != k).unwrap_or(true) {
                        if let Some(g) = groupe.take() {
                            if let Err(x) = (|| -> Result<(), String> {
                                if !en_tx {
                                    b.commencer().map_err(base::err)?;
                                    en_tx = true;
                                }
                                b.appliquer(ecr, &g).map_err(base::err)
                            })() {
                                echec = Some(x);
                                return false;
                            }
                            vus_dossiers.insert(cle(&g.chemin));
                        }
                        let partiel = vus_dossiers.contains(&k);
                        groupe = Some(ListeDossier { chemin: dossier, racine: i, volume: r.volume.clone(), fichiers: Vec::new(), partiel });
                        c.dossiers.fetch_add(1, Ordering::Relaxed);
                    }
                    c.fichiers_vus.fetch_add(1, Ordering::Relaxed);
                    match fv.type_media {
                        TypeMedia::Video => c.video.fetch_add(1, Ordering::Relaxed),
                        TypeMedia::Audio => c.audio.fetch_add(1, Ordering::Relaxed),
                        TypeMedia::Image => c.image.fetch_add(1, Ordering::Relaxed),
                    };
                    c.octets.fetch_add(fv.taille, Ordering::Relaxed);
                    if let Some(g) = groupe.as_mut() {
                        g.fichiers.push(fv);
                    }
                }
                if en_tx && dernier_commit.elapsed() > Duration::from_millis(300) {
                    if b.valider().is_err() {
                        return false;
                    }
                    en_tx = false;
                    dernier_commit = Instant::now();
                }
                if derniere_prog.elapsed() >= PERIODE_PROGRESSION {
                    derniere_prog = Instant::now();
                    courant = groupe.as_ref().map(|g| g.chemin.to_string_lossy().into_owned());
                    emettre(&courant, ecr, Phase::Everything, Some(if total == 0 { 1.0 } else { (recus as f64 / total as f64).min(1.0) }));
                }
                !annule.load(Ordering::SeqCst)
            });
            if let Some(x) = echec {
                b.annuler_transaction();
                return Err(x);
            }
            match resultat {
                Ok(_) => {
                    if let Some(g) = groupe.take() {
                        if !en_tx {
                            b.commencer().map_err(base::err)?;
                            en_tx = true;
                        }
                        b.appliquer(ecr, &g).map_err(base::err)?;
                    }
                    valider(&mut en_tx)?;
                    if !annule.load(Ordering::SeqCst) {
                        b.commencer().map_err(base::err)?;
                        let vid = b.id_volume(ecr, &r.volume).ok();
                        if let Err(e) = b.finir_racine(ecr, &r.chemin, vid) {
                            b.annuler_transaction();
                            return Err(base::err(e));
                        }
                        b.valider().map_err(base::err)?;
                    }
                }
                Err(x) => {
                    valider(&mut en_tx)?;
                    c.erreurs.fetch_add(1, Ordering::Relaxed);
                    erreurs.push(ErreurScan { chemin: racine_txt.clone(), message: format!("Everything : {x}") });
                }
            }
        }
        ecr.source = SRC_NATIF;
        // 2. Scanner natif.
        if !natives.is_empty() && !annule.load(Ordering::SeqCst) {
            let (tx, rx) = sync_channel::<Message>(64);
            let fils = parcours::parcourir(natives.clone(), opts.clone(), annule.clone(), c.clone(), tx);
            loop {
                match rx.recv_timeout(PERIODE_PROGRESSION) {
                    Ok(Message::Dossier(l)) => {
                        if !en_tx {
                            b.commencer().map_err(base::err)?;
                            en_tx = true;
                        }
                        if let Err(e) = b.appliquer(ecr, &l) {
                            b.annuler_transaction();
                            annule.store(true, Ordering::SeqCst);
                            return Err(base::err(e));
                        }
                        courant = Some(l.chemin.to_string_lossy().into_owned());
                        lot += 1;
                        if lot >= 400 || dernier_commit.elapsed() > Duration::from_millis(300) {
                            valider(&mut en_tx)?;
                            lot = 0;
                            dernier_commit = Instant::now();
                        }
                    }
                    Ok(Message::Erreur { chemin, message }) => {
                        if erreurs.len() < ERREURS_LISTEES {
                            erreurs.push(ErreurScan { chemin, message });
                        }
                    }
                    Ok(Message::RacineFinie { racine, complete, introuvable }) => {
                        valider(&mut en_tx)?;
                        let r = &natives[racine];
                        if complete && !annule.load(Ordering::SeqCst) {
                            emettre(&courant, ecr, Phase::Rapprochement, None);
                            b.commencer().map_err(base::err)?;
                            let vid = b.id_volume(ecr, &r.volume).ok();
                            if let Err(e) = b.finir_racine(ecr, &r.chemin, vid) {
                                b.annuler_transaction();
                                return Err(base::err(e));
                            }
                            b.valider().map_err(base::err)?;
                        } else if introuvable {
                            // Dossier supprimé ou renommé sur un volume présent : ses fichiers sont absents.
                            let n = b.marquer_racine(&r.chemin, base::ABSENT, ecr.maintenant).map_err(base::err)?;
                            ecr.bilan.supprimes += n;
                        }
                    }
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }
                if derniere_prog.elapsed() >= PERIODE_PROGRESSION {
                    derniere_prog = Instant::now();
                    emettre(&courant, ecr, Phase::Parcours, None);
                }
            }
            for f in fils {
                let _ = f.join();
            }
        }
        valider(&mut en_tx)?;
        Ok(())
    }

    // ---- État, résumés, recherche ----

    pub fn etat(&self) -> EtatIndex {
        let scan = verrou(&self.p.scan).as_ref().map(|s| verrou(&s.progression).clone());
        let emplacement = self.emplacement();
        let (totaux, interrompu) = self
            .avec_lecteur(|b| {
                let t = b.totaux().map_err(base::err)?;
                let i = b.dernier_interrompu().and_then(|(_, c)| serde_json::from_str::<Vec<Cible>>(&c).ok());
                Ok((t, i))
            })
            .unwrap_or_default();
        let taille = ["", "-wal"].iter().map(|s| std::fs::metadata(emplacement.join(format!("{}{s}", base::NOM_BASE))).map(|m| m.len()).unwrap_or(0)).sum();
        let reg = self.reglages();
        EtatIndex {
            scan,
            dernier: verrou(&self.p.dernier).clone(),
            interrompu,
            totaux,
            emplacement: emplacement.to_string_lossy().into_owned(),
            taille_index: taille,
            enrichissement: verrou(&self.p.enrich).clone(),
            everything: if reg.everything == ModeEverything::Auto { everything::detecter() } else { EtatEverything { raison: Some("Mode Everything désactivé dans les réglages.".into()), ..Default::default() } },
            mode_everything: reg.everything,
            veille: verrou(&self.p.veille).clone(),
            migration: self.p.migration.load(Ordering::SeqCst),
        }
    }

    pub fn everything(&self) -> EtatEverything {
        everything::detecter()
    }

    pub fn resume(&self, id: Option<i64>) -> Option<Resume> {
        if id.is_none() {
            if let Some(r) = verrou(&self.p.dernier).clone() {
                return Some(r);
            }
        }
        self.avec_lecteur(|b| Ok(b.resume(id).and_then(|r| serde_json::from_str(&r).ok()))).ok().flatten()
    }

    fn avec_lecteur<T>(&self, f: impl FnOnce(&Base) -> Result<T, String>) -> Result<T, String> {
        let _a = self.p.acces.read().unwrap_or_else(|e| e.into_inner());
        if self.p.migration.load(Ordering::SeqCst) {
            return Err("L'index est en cours de déplacement.".into());
        }
        let mut g = verrou(&self.p.lecteur);
        if g.is_none() {
            *g = Some(Base::ouvrir(&self.emplacement(), 8000)?);
        }
        f(g.as_ref().ok_or("index fermé")?)
    }

    /// Recherche dans l'index (sources « index » et « everything » si la requête n'en précise pas).
    pub fn rechercher(&self, r: &Requete) -> Result<Page, String> {
        let mut r = r.clone();
        if r.sources.is_empty() {
            r.sources = vec![Source::Index, Source::Everything];
        }
        self.requete(&r)
    }

    /// Bibliothèque unifiée : dossiers surveillés (index.json) et médias de l'index, avec leur source.
    pub fn bibliotheque(&self, r: &Requete) -> Result<Page, String> {
        self.requete(r)
    }

    fn requete(&self, r: &Requete) -> Result<Page, String> {
        let (e, m) = (self.emplacement(), self.miniatures_bibliotheque());
        self.avec_lecteur(|b| b.rechercher(r, &e, &m))
    }

    // ---- Bibliothèque (copie d'index.json) ----

    /// Copie à faire des médias d'index.json (asynchrone, regroupée) : appelée à chaque changement de la bibliothèque.
    pub fn signaler_bibliotheque(&self, medias: Vec<Media>) {
        verrou(&self.p.travail).bibliotheque = Some(medias);
        self.reveiller();
    }

    /// Copie immédiate (essais).
    pub fn synchroniser_bibliotheque(&self, medias: &[Media]) -> Result<u64, String> {
        let _a = self.p.acces.read().unwrap_or_else(|e| e.into_inner());
        Base::ouvrir(&self.emplacement(), 2000)?.synchroniser_bibliotheque(medias).map_err(base::err)
    }

    // ---- Actions sur un média de l'index ----

    /// Chemin d'un média PRÉSENT de l'index (fichier ordinaire, extension média), désigné par son identifiant.
    pub fn chemin_media(&self, id: &str) -> Result<PathBuf, String> {
        if !noms::est_id_valide(id) {
            return Err("Identifiant invalide.".into());
        }
        let l = self.avec_lecteur(|b| b.par_idm(id).map_err(base::err))?.ok_or("Média inconnu de l'index.")?;
        let (_, chemin, _, ext, etat, _, _) = l;
        if etat != base::PRESENT {
            return Err("Ce média n'est pas disponible (disque débranché ou fichier supprimé).".into());
        }
        let m = std::fs::metadata(&chemin).map_err(|_| "Fichier introuvable : il a été déplacé ou supprimé.")?;
        if !m.is_file() || self.reglages().table_extensions().get(&ext).is_none() && reglages::VIDEO.iter().chain(reglages::AUDIO).chain(reglages::IMAGE).all(|e| *e != ext) {
            return Err("Ce chemin n'est pas un média.".into());
        }
        Ok(chemin)
    }

    /// Cartes visibles : les images et pochettes audio sans miniature passent en tête de file ; les vidéos à analyser
    /// par le WebView2 sont renvoyées (16 au plus).
    pub fn demander_miniatures(&self, ids: &[String]) -> Result<Vec<AAnalyserIndex>, String> {
        let mut videos = Vec::new();
        let mut prio = Vec::new();
        for id in ids.iter().take(200) {
            if !noms::est_id_valide(id) {
                continue;
            }
            let Some((rid, chemin, ty, ext, etat, mini, en_ligne)) = self.avec_lecteur(|b| b.par_idm(id).map_err(base::err))? else { continue };
            if etat != base::PRESENT || en_ligne {
                continue;
            }
            match ty {
                TypeMedia::Video if (mini == base::MINI_A_FAIRE || mini == base::MINI_WEBVIEW) && enrichissement::VIDEO_WEBVIEW.contains(&ext.as_str()) => {
                    if videos.len() < 16 {
                        videos.push(AAnalyserIndex { id: id.clone(), chemin: chemin.to_string_lossy().into_owned(), type_media: ty, ext });
                    }
                }
                TypeMedia::Audio | TypeMedia::Image if mini == base::MINI_A_FAIRE => prio.push(rid),
                _ => {}
            }
        }
        if !prio.is_empty() {
            let mut t = verrou(&self.p.travail);
            for r in prio {
                if !t.prioritaires.contains(&r) {
                    t.prioritaires.push_back(r);
                }
            }
            while t.prioritaires.len() > 400 {
                t.prioritaires.pop_front();
            }
            t.reveil = true;
            self.p.cv.notify_all();
        }
        Ok(videos)
    }

    /// Analyse d'une vidéo par le WebView2 : miniature (JPEG, réduite et réencodée ici), durée et définition.
    pub fn enregistrer_analyse(&self, id: &str, a: &AnalyseWeb, jpeg: Option<&[u8]>) -> Result<(), String> {
        if !noms::est_id_valide(id) {
            return Err("Identifiant invalide.".into());
        }
        let emplacement = self.emplacement();
        let _a = self.p.acces.read().unwrap_or_else(|e| e.into_inner());
        let b = Base::ouvrir(&emplacement, 2000)?;
        let (rid, ..) = b.par_idm(id).map_err(base::err)?.ok_or("Média inconnu de l'index.")?;
        let mut mini = if a.echec { base::MINI_ECHEC } else { base::MINI_WEBVIEW };
        if let Some(o) = jpeg {
            if !o.starts_with(&[0xFF, 0xD8, 0xFF]) {
                return Err("Miniature refusée : JPEG attendu.".into());
            }
            enrichissement::ecrire_depuis_octets(o, &base::chemin_miniature(&emplacement, rid))?;
            mini = base::MINI_FAITE;
        }
        let valide = |v: f64| v.is_finite() && v > 0.0 && v < 1.0e7;
        let (l, h) = match (a.largeur, a.hauteur) {
            (Some(l), Some(h)) if l > 0 && h > 0 && l < 100_000 && h < 100_000 => (Some(l), Some(h)),
            _ => (None, None),
        };
        b.enregistrer_analyse(rid, a.duree.filter(|d| valide(*d)).map(|d| (d * 1000.0).round() / 1000.0), l, h, mini).map_err(base::err)?;
        self.p.avis.changement("index");
        Ok(())
    }

    /// Retire de l'index tout ce qui est sous `chemin` (les fichiers ne sont pas touchés).
    pub fn retirer(&self, chemin: &str) -> Result<u64, String> {
        let p = reglages::chemin_propre(chemin).ok_or("Chemin complet attendu.")?;
        if verrou(&self.p.scan).is_some() {
            return Err("Un scan est en cours : annule-le d'abord.".into());
        }
        let n = {
            let _a = self.p.acces.read().unwrap_or_else(|e| e.into_inner());
            Base::ouvrir(&self.emplacement(), 2000)?.retirer_racine(&p).map_err(base::err)?
        };
        self.p.avis.changement("index");
        Ok(n)
    }

    // ---- Emplacement de l'index (migration sûre) ----

    /// Déplace l'index, le cache et les miniatures vers `nouveau` (ex. `D:\AETHRYON\Index`) : copie cohérente de la
    /// base (`VACUUM INTO`), copie des miniatures, vérification (intégrité, nombre de fichiers), bascule des réglages,
    /// puis seulement suppression de l'ancien emplacement. En cas d'échec, l'ancien emplacement reste en service.
    pub fn deplacer_emplacement(&self, nouveau: &str) -> Result<String, String> {
        let cible = reglages::chemin_propre(nouveau).ok_or("Chemin complet attendu (ex. D:\\AETHRYON\\Index).")?;
        if verrou(&self.p.scan).is_some() {
            return Err("Un scan est en cours : annule-le ou attends sa fin avant de déplacer l'index.".into());
        }
        if self.p.migration.swap(true, Ordering::SeqCst) {
            return Err("Un déplacement de l'index est déjà en cours.".into());
        }
        let r = self.migrer(&cible);
        self.p.migration.store(false, Ordering::SeqCst);
        match &r {
            Ok(_) => {
                self.p.avis.migration(&Migration { etape: "termine".into(), fait: 1, total: 1, message: None });
                self.p.avis.changement("reglages");
                self.p.avis.changement("index");
            }
            Err(e) => self.p.avis.migration(&Migration { etape: "erreur".into(), fait: 0, total: 0, message: Some(e.clone()) }),
        }
        self.reveiller();
        r.map(|p| p.to_string_lossy().into_owned())
    }

    fn migrer(&self, cible: &Path) -> Result<PathBuf, String> {
        let _ecriture = self.p.acces.write().unwrap_or_else(|e| e.into_inner());
        *verrou(&self.p.lecteur) = None;
        let ancien = self.emplacement();
        if cle(&ancien) == cle(cible) {
            return Err("L'index est déjà à cet emplacement.".into());
        }
        if cle(cible).starts_with(&format!("{}\\", cle(&ancien))) {
            return Err("Le nouvel emplacement ne peut pas être dans l'ancien.".into());
        }
        crate::config::tester_ecriture(cible)?;
        nettoyer_migration(cible, false);
        if cible.join(base::NOM_BASE).exists() {
            return Err(format!("Un index existe déjà dans « {} » : choisis un dossier vide.", cible.display()));
        }
        // Dossier vide seulement : rien de l'utilisateur ne peut être écrasé ni retiré en cas d'échec.
        if std::fs::read_dir(cible).map(|mut l| l.next().is_some()).unwrap_or(true) {
            return Err(format!("« {} » n'est pas vide : choisis un dossier vide (ou un nouveau dossier).", cible.display()));
        }
        let avis = |etape: &str, fait: u64, total: u64| self.p.avis.migration(&Migration { etape: etape.into(), fait, total, message: None });
        // Place libre : base + miniatures + 64 Mo de marge.
        let mini_src = ancien.join("miniatures");
        let (n_mini, o_mini) = taille_arbre(&mini_src);
        let o_base = std::fs::metadata(ancien.join(base::NOM_BASE)).map(|m| m.len()).unwrap_or(0)
            + std::fs::metadata(ancien.join(format!("{}-wal", base::NOM_BASE))).map(|m| m.len()).unwrap_or(0);
        if let Some(libre) = espace_libre(cible) {
            if libre < o_base + o_mini + 64 * 1024 * 1024 {
                return Err(format!("Place insuffisante dans « {} » : {} Mo libres, {} Mo nécessaires.", cible.display(), libre >> 20, (o_base + o_mini) >> 20));
            }
        }
        let marqueur = cible.join("migration-en-cours.json");
        crate::atomique::ecrire_json(&marqueur, &serde_json::json!({ "de": ancien.to_string_lossy(), "le": horloge::iso(horloge::maintenant()) }), false)
            .map_err(|e| format!("Écriture impossible dans « {} » ({}).", cible.display(), e.kind()))?;
        let echec = |m: String| {
            nettoyer_migration(cible, false);
            let _ = std::fs::remove_file(cible.join(base::NOM_BASE));
            let _ = std::fs::remove_dir_all(cible.join("miniatures"));
            let _ = std::fs::remove_file(&marqueur);
            m
        };
        // 1. Base : copie cohérente et compacte.
        avis("base", 0, 1);
        let tmp_base = cible.join(format!("{}.migration.tmp", base::NOM_BASE));
        let n_avant = if ancien.join(base::NOM_BASE).exists() {
            let b = Base::ouvrir(&ancien, 2000).map_err(echec)?;
            let n = b.nombre_fichiers();
            b.c.execute("VACUUM INTO ?1", [tmp_base.to_string_lossy()]).map_err(|e| echec(format!("Copie de l'index impossible : {e}")))?;
            Some(n)
        } else {
            None
        };
        // 2. Miniatures.
        let tmp_mini = cible.join("miniatures.migration.tmp");
        if mini_src.is_dir() {
            let mut fait = 0u64;
            copier_arbre(&mini_src, &tmp_mini, &mut |_| {
                fait += 1;
                if fait % 500 == 0 {
                    avis("miniatures", fait, n_mini);
                }
            })
            .map_err(|e| echec(format!("Copie des miniatures impossible : {e}")))?;
            let (n2, _) = taille_arbre(&tmp_mini);
            if n2 != n_mini {
                return Err(echec(format!("Copie des miniatures incomplète ({n2} sur {n_mini}).")));
            }
        }
        // 3. Vérification.
        avis("verification", 0, 1);
        if let Some(n) = n_avant {
            std::fs::rename(&tmp_base, cible.join(base::NOM_BASE)).map_err(|e| echec(format!("Renommage impossible ({}).", e.kind())))?;
            let b = Base::ouvrir(cible, 2000).map_err(echec)?;
            let ok = b.integrite();
            if ok != "ok" || b.nombre_fichiers() != n {
                drop(b);
                return Err(echec(format!("Vérification de la copie échouée ({ok}).")));
            }
        }
        if tmp_mini.is_dir() {
            std::fs::rename(&tmp_mini, cible.join("miniatures")).map_err(|e| echec(format!("Renommage des miniatures impossible ({}).", e.kind())))?;
        }
        // 4. Bascule : les réglages désignent le nouvel emplacement.
        avis("bascule", 0, 1);
        {
            let mut g = verrou(&self.p.reglages);
            let mut copie = g.clone();
            copie.emplacement = Some(cible.to_string_lossy().into_owned());
            reglages::enregistrer(&self.p.config, &copie).map_err(|e| echec(format!("Réglages non enregistrés ({}).", e.kind())))?;
            *g = copie;
        }
        let _ = std::fs::remove_file(&marqueur);
        // 5. Ancien emplacement retiré (seulement nos fichiers).
        for s in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(ancien.join(format!("{}{s}", base::NOM_BASE)));
        }
        let _ = std::fs::remove_dir_all(&mini_src);
        let _ = std::fs::remove_dir(&ancien);
        journal::info("index", &format!("Index déplacé : {} → {}", ancien.display(), cible.display()));
        Ok(cible.to_path_buf())
    }

    // ---- Surveillance en direct des dossiers ciblés ----

    fn relancer_veille(&self) {
        let reg = self.reglages();
        let dossiers: Vec<String> = if reg.surveiller {
            reg.cibles.iter().filter(|c| c.genre == GenreCible::Dossier).filter_map(|c| reglages::chemin_propre(&c.chemin)).filter(|p| p.is_dir()).map(|p| p.to_string_lossy().into_owned()).take(VEILLE_MAX).collect()
        } else {
            Vec::new()
        };
        if *verrou(&self.p.veille) == dossiers {
            return;
        }
        *verrou(&self.p.veilleur) = None;
        if dossiers.is_empty() {
            verrou(&self.p.veille).clear();
            return;
        }
        let p = Arc::downgrade(&self.p);
        let rappel = move |r: notify::Result<notify::Event>| {
            let Some(p) = p.upgrade() else { return };
            let mut t = verrou(&p.travail);
            match r {
                Ok(ev) => {
                    use notify::EventKind;
                    if !matches!(ev.kind, EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) | EventKind::Any | EventKind::Other) {
                        return;
                    }
                    let creation = matches!(ev.kind, EventKind::Create(_));
                    for chemin in ev.paths {
                        let est_dossier = chemin.is_dir();
                        let dossier = if est_dossier { chemin.clone() } else { chemin.parent().map(Path::to_path_buf).unwrap_or(chemin.clone()) };
                        let e = t.veille.entry(dossier).or_insert((Instant::now(), false));
                        e.0 = Instant::now();
                        // Dossier créé (copié, déplacé ici) : parcouru en entier ; sinon seul le dossier est relu.
                        e.1 |= creation && est_dossier;
                        if !chemin.is_dir() && matches!(ev.kind, EventKind::Remove(_) | EventKind::Modify(notify::event::ModifyKind::Name(_))) {
                            // Dossier supprimé ou renommé : son ancien chemin aussi.
                            t.veille.entry(chemin.clone()).or_insert((Instant::now(), false)).0 = Instant::now();
                        }
                    }
                }
                Err(_) => t.rescanner_veille = true,
            }
            t.reveil = true;
            drop(t);
            p.cv.notify_all();
        };
        use notify::Watcher;
        match notify::recommended_watcher(rappel) {
            Ok(mut w) => {
                let mut actifs = Vec::new();
                for d in &dossiers {
                    match w.watch(Path::new(d), notify::RecursiveMode::Recursive) {
                        Ok(()) => actifs.push(d.clone()),
                        Err(e) => journal::avert("index", &format!("Surveillance en direct impossible de « {d} » ({e}).")),
                    }
                }
                *verrou(&self.p.veilleur) = Some(w);
                *verrou(&self.p.veille) = actifs;
            }
            Err(e) => journal::avert("index", &format!("Surveillance en direct indisponible ({e}).")),
        }
    }

    /// Dossiers signalés par la surveillance : relus (sans récursion, sauf dossier nouveau) et rapprochés de l'index.
    fn traiter_veille(&self, b: &Base, dossiers: Vec<(PathBuf, bool)>) -> Result<bool, String> {
        let reg = self.reglages();
        let opts = Arc::new(options(&reg, None));
        let vus = verrou(&self.p.volumes_vus).clone();
        let racines: Vec<PathBuf> = verrou(&self.p.veille).iter().map(PathBuf::from).collect();
        let scan = b.c.query_row("SELECT coalesce(max(id), 0) FROM scans", [], |r| r.get::<_, i64>(0)).unwrap_or(0);
        let mut ecr = Ecriture::nouvelle(scan, SRC_NATIF, opts.clone());
        let mut change = false;
        for (d, recursif) in dossiers {
            let Some(racine) = racines.iter().find(|r| d == **r || d.starts_with(r)) else { continue };
            // Un dossier exclu (ou sous un dossier exclu) n'est jamais relu.
            if opts.exclusions.exclut_sous(racine, &d) {
                continue;
            }
            let iv = Arc::new(volumes::volume_de(&d, &vus));
            if !d.exists() {
                let n = b.marquer_racine(&d, base::ABSENT, ecr.maintenant).map_err(base::err)?;
                change |= n > 0;
                continue;
            }
            if recursif {
                let c = Arc::new(Compteurs::default());
                let (tx, rx) = sync_channel::<Message>(64);
                let annule = Arc::new(AtomicBool::new(false));
                let fils = parcours::parcourir(vec![RacineParcours { chemin: d.clone(), volume: iv.clone() }], opts.clone(), annule, c, tx);
                b.commencer().map_err(base::err)?;
                for m in rx {
                    if let Message::Dossier(l) = m {
                        b.appliquer(&mut ecr, &l).map_err(base::err)?;
                    }
                }
                b.valider().map_err(base::err)?;
                for f in fils {
                    let _ = f.join();
                }
                change = true;
                continue;
            }
            let lecture = match parcours::lire_dossier(&d, opts.suivre_liens) {
                Ok(l) => l,
                Err(_) => continue,
            };
            let mut fichiers = Vec::new();
            for e in lecture.entrees {
                if !matches!(e.genre, parcours::GenreEntree::Fichier) {
                    continue;
                }
                let Some(nom) = e.nom.to_str().map(str::to_owned) else { continue };
                let Some((ext, ty)) = opts.type_de(&nom) else { continue };
                if (opts.exclure_caches && e.cache) || e.taille == 0 || e.taille < opts.taille_min {
                    continue;
                }
                if ext == "ts" && !parcours::est_flux_mpeg_ts(&d.join(&e.nom), e.taille, e.en_ligne) {
                    continue;
                }
                fichiers.push(FichierVu { nom, ext, type_media: ty, taille: e.taille, modifie_ms: e.modifie_ms, cree_ms: e.cree_ms, fid: if iv.ids_fiables { e.fid } else { None }, en_ligne: e.en_ligne });
            }
            b.commencer().map_err(base::err)?;
            b.appliquer(&mut ecr, &ListeDossier { chemin: d.clone(), racine: 0, volume: iv, fichiers, partiel: false }).map_err(base::err)?;
            b.valider().map_err(base::err)?;
            change = true;
        }
        Ok(change)
    }

    // ---- Fil d'entretien : copie de la bibliothèque, veille, métadonnées, miniatures ----

    fn entretien(&self) {
        priorite::basse();
        let mut derniere_prog = Instant::now();
        // Vrai quand le dernier lot d'arrière-plan était vide : on n'ouvre plus l'index pour rien jusqu'au prochain réveil.
        let mut rien = false;
        loop {
            let (biblio, veille, prio, rescanner) = {
                let mut t = verrou(&self.p.travail);
                if !t.reveil {
                    t = self.p.cv.wait_timeout(t, Duration::from_millis(800)).map(|x| x.0).unwrap_or_else(|e| e.into_inner().0);
                }
                if t.reveil {
                    rien = false;
                }
                t.reveil = false;
                let maintenant = Instant::now();
                let prets: Vec<PathBuf> = t.veille.iter().filter(|(_, (i, _))| maintenant.duration_since(*i) >= REGROUPEMENT_VEILLE).map(|(p, _)| p.clone()).collect();
                let veille: Vec<(PathBuf, bool)> = prets.into_iter().filter_map(|p| t.veille.remove(&p).map(|(_, r)| (p, r))).collect();
                let prio: Vec<i64> = (0..8).filter_map(|_| t.prioritaires.pop_front()).collect();
                (t.bibliotheque.take(), veille, prio, std::mem::take(&mut t.rescanner_veille))
            };
            if self.p.arret.load(Ordering::SeqCst) {
                return;
            }
            let scan_en_cours = verrou(&self.p.scan).is_some();
            if self.p.migration.load(Ordering::SeqCst) || (biblio.is_none() && veille.is_empty() && prio.is_empty() && !rescanner && (rien || scan_en_cours)) {
                if let Some(m) = biblio {
                    verrou(&self.p.travail).bibliotheque.get_or_insert(m);
                }
                continue;
            }
            let _a = self.p.acces.read().unwrap_or_else(|e| e.into_inner());
            let emplacement = self.emplacement();
            let connexion = match Base::ouvrir(&emplacement, 4000) {
                Ok(b) => b,
                Err(e) => {
                    journal::avert("index", &e);
                    drop(_a);
                    std::thread::sleep(Duration::from_secs(5));
                    continue;
                }
            };
            let b = &connexion;
            if let Some(m) = biblio {
                match b.synchroniser_bibliotheque(&m) {
                    Ok(n) if n > 0 => self.p.avis.changement("bibliotheque"),
                    Ok(_) => {}
                    Err(e) => journal::avert("index", &format!("Copie de la bibliothèque : {e}")),
                }
            }
            if !veille.is_empty() {
                match self.traiter_veille(b, veille) {
                    Ok(true) => self.p.avis.changement("index"),
                    Ok(false) => {}
                    Err(e) => {
                        b.annuler_transaction();
                        journal::avert("index", &format!("Surveillance en direct : {e}"));
                    }
                }
            }
            if rescanner && !scan_en_cours {
                let cibles: Vec<Cible> = verrou(&self.p.veille).iter().map(|d| Cible { genre: GenreCible::Dossier, chemin: d.clone() }).collect();
                if !cibles.is_empty() {
                    drop(_a);
                    let _ = self.lancer_scan(Some(cibles));
                    continue;
                }
            }
            let reg = self.reglages();
            let mut travaille = false;
            // Miniatures demandées par les cartes visibles : toujours servies, même pendant un scan.
            if !prio.is_empty() {
                if let Ok(l) = b.par_ids(&prio) {
                    for a in l {
                        let etat = enrichissement::miniature(&a, &emplacement);
                        let _ = b.poser_mini(a.id, etat);
                    }
                    self.p.avis.changement("miniatures");
                }
                travaille = true;
            }
            // Arrière-plan : seulement hors scan (le scan a déjà le disque).
            if !scan_en_cours {
                if reg.metadonnees {
                    if let Ok(l) = b.a_enrichir(24) {
                        if !l.is_empty() {
                            travaille = true;
                            let n = l.len() as u64;
                            let _ = b.commencer();
                            for a in &l {
                                let m = enrichissement::metadonnees(a, &emplacement, reg.miniatures);
                                let _ = b.enregistrer_meta(a.id, &m);
                            }
                            let _ = b.valider();
                            self.avancer("metadonnees", n, || b.totaux().map(|t| t.metadonnees_a_faire).unwrap_or(0), &mut derniere_prog);
                        }
                    }
                }
                if !travaille && reg.miniatures {
                    if let Ok(l) = b.a_miniaturer(6) {
                        if !l.is_empty() {
                            travaille = true;
                            let n = l.len() as u64;
                            for a in &l {
                                let etat = enrichissement::miniature(a, &emplacement);
                                let _ = b.poser_mini(a.id, etat);
                            }
                            self.avancer("miniatures", n, || b.totaux().map(|t| t.miniatures_a_faire).unwrap_or(0), &mut derniere_prog);
                        }
                    }
                }
            }
            if travaille {
                verrou(&self.p.travail).reveil = true;
            } else {
                rien = !scan_en_cours;
                let mut e = verrou(&self.p.enrich);
                if e.actif {
                    *e = Enrichissement { phase: "repos".into(), fait: e.fait, total: e.total, actif: false };
                    let c = e.clone();
                    drop(e);
                    self.p.avis.enrichissement(&c);
                    self.p.avis.changement("index");
                }
            }
        }
    }

    fn avancer(&self, phase: &str, n: u64, restants: impl FnOnce() -> u64, derniere: &mut Instant) {
        let mut e = verrou(&self.p.enrich);
        if e.phase != phase || !e.actif {
            *e = Enrichissement { phase: phase.into(), fait: 0, total: 0, actif: true };
        }
        e.fait += n;
        if derniere.elapsed() >= Duration::from_millis(500) {
            *derniere = Instant::now();
            e.total = e.fait + restants();
            let c = e.clone();
            drop(e);
            self.p.avis.enrichissement(&c);
            self.p.avis.changement("index");
        }
    }
}

/// Élément Everything → fichier média retenu (racine, exclusions, caché, type, taille) et son dossier.
fn fichier_everything(e: &everything::ElementEverything, racine: &Path, cle_racine: &str, opts: &Options) -> Option<(PathBuf, FichierVu)> {
    if e.dossier {
        return None;
    }
    let chemin = PathBuf::from(&e.chemin);
    let k = cle(&chemin);
    if !(cle_racine.is_empty() || k.starts_with(&format!("{cle_racine}\\"))) {
        return None;
    }
    let dossier = chemin.parent()?.to_path_buf();
    let nom = chemin.file_name()?.to_str()?.to_string();
    let (ext, type_media) = opts.type_de(&nom)?;
    if dossier != racine && opts.exclusions.exclut_sous(racine, &dossier) {
        return None;
    }
    let attributs = e.attributs.unwrap_or(0);
    if opts.exclure_caches {
        let caches = attributs & 0x6 != 0
            || dossier.strip_prefix(racine).map(|r| r.components().any(|c| c.as_os_str().to_string_lossy().starts_with('.'))).unwrap_or(false)
            || nom.starts_with('.');
        if caches {
            return None;
        }
    }
    let en_ligne = attributs & (0x1000 | 0x40000 | 0x400000) != 0;
    let (taille, modifie) = match (e.taille, e.modifie_ms) {
        (Some(t), Some(m)) => (t, m),
        _ => {
            let m = std::fs::metadata(&chemin).ok()?;
            (m.len(), m.modified().map(parcours::ms_systeme).unwrap_or(0))
        }
    };
    if taille == 0 || taille < opts.taille_min {
        return None;
    }
    if ext == "ts" && !parcours::est_flux_mpeg_ts(&chemin, taille, en_ligne) {
        return None;
    }
    Some((dossier, FichierVu { nom, ext, type_media, taille, modifie_ms: modifie, cree_ms: e.cree_ms, fid: None, en_ligne }))
}

/// Restes d'une migration interrompue (fichiers `.migration.tmp`, marqueur) : retirés. Si `d` n'est PAS
/// l'emplacement en service (bascule jamais faite), la base et les miniatures copiées le sont aussi.
fn nettoyer_migration(d: &Path, en_service: bool) {
    if !d.join("migration-en-cours.json").exists() {
        return;
    }
    let _ = std::fs::remove_file(d.join(format!("{}.migration.tmp", base::NOM_BASE)));
    let _ = std::fs::remove_dir_all(d.join("miniatures.migration.tmp"));
    if !en_service {
        for s in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(d.join(format!("{}{s}", base::NOM_BASE)));
        }
        let _ = std::fs::remove_dir_all(d.join("miniatures"));
    }
    let _ = std::fs::remove_file(d.join("migration-en-cours.json"));
}

fn taille_arbre(d: &Path) -> (u64, u64) {
    let (mut n, mut o) = (0u64, 0u64);
    let mut pile = vec![d.to_path_buf()];
    while let Some(x) = pile.pop() {
        let Ok(l) = std::fs::read_dir(&x) else { continue };
        for e in l.flatten() {
            match e.file_type() {
                Ok(t) if t.is_dir() => pile.push(e.path()),
                Ok(t) if t.is_file() => {
                    n += 1;
                    o += e.metadata().map(|m| m.len()).unwrap_or(0);
                }
                _ => {}
            }
        }
    }
    (n, o)
}

fn copier_arbre(src: &Path, dst: &Path, f: &mut dyn FnMut(u64)) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for e in std::fs::read_dir(src)? {
        let e = e?;
        let t = e.file_type()?;
        let cible = dst.join(e.file_name());
        if t.is_dir() {
            copier_arbre(&e.path(), &cible, f)?;
        } else if t.is_file() {
            let n = std::fs::copy(e.path(), &cible)?;
            f(n);
        }
    }
    Ok(())
}

fn espace_libre(d: &Path) -> Option<u64> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let w: Vec<u16> = d.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let mut libre = 0u64;
        let ok = unsafe { windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(w.as_ptr(), &mut libre, std::ptr::null_mut(), std::ptr::null_mut()) };
        (ok != 0).then_some(libre)
    }
    #[cfg(unix)]
    {
        let c = std::ffi::CString::new(d.to_string_lossy().as_bytes().to_vec()).ok()?;
        let mut s: libc::statvfs = unsafe { std::mem::zeroed() };
        (unsafe { libc::statvfs(c.as_ptr(), &mut s) } == 0).then(|| s.f_bavail as u64 * s.f_frsize as u64)
    }
}

/// Utilisé par les essais : identité de volume d'un chemin, sans énumération.
pub fn ident_pour(chemin: &Path) -> IdentVolume {
    volumes::volume_de(chemin, &[])
}

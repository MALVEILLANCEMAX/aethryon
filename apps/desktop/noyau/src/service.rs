//! Service d'arrière-plan d'AETHRYON Desktop : un seul processus, deux fils.
//! - surveillance : veilleur `notify` + planificateur → passages → `index.json`, liaison des transferts ;
//! - échanges (toutes les secondes) : battement Desktop (2 s), battement et imports du panneau, commandes entrantes
//!   (liste fermée), résultats des commandes envoyées, transferts, détection de Premiere (5 min).
//! L'interface lit un instantané et reçoit des avis de changement par le trait [`Notifieur`].

use crate::assistant::PanneauCep;
use crate::atomique::{self, Lecture};
use crate::battements::{self, BattementDesktop, BattementPanneau, Imports, PremiereEtat};
use crate::bibliotheque::{self, AAnalyser, AnalyseWeb, DossierIndex, EtatMedia, Index, Media, Suivi};
use crate::chemins::Emplacements;
use crate::commandes::{self, ActionDesktop, Entrante};
use crate::config::{self, Config, Prive};
use crate::conversion::{self, Avancee, Demande};
use crate::flux;
use crate::horloge;
use crate::journal;
use crate::nettoyage;
use crate::noms;
use crate::plateforme::{self, CreativeCloud, DetectionPremiere, EtatNavigateur, Plateforme};
use crate::surveillance::{Planificateur, Signal, Veilleur};
use crate::transferts::{self, Transfert};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

pub trait Notifieur: Send + Sync + 'static {
    /// `bibliotheque`, `transferts`, `liaison`, `config`.
    fn changement(&self, quoi: &str);
    fn media_pret(&self, media: &Media);
    fn resultat_commande(&self, r: &ResultatEnvoi);
    fn naviguer(&self, section: &str);
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResultatEnvoi {
    pub nom: String,
    pub action: String,
    pub ids: Vec<String>,
    pub ok: bool,
    pub message: String,
    pub le: String,
    /// La commande a expiré (2 minutes sans réponse du panneau), close par le Desktop ou par le panneau lui-même.
    pub expire: bool,
}

/// Vrai si le résultat écrit est une expiration : « Expirée : … » (Desktop, commandes.rs) ou « commande expirée … »
/// (panneau, contrat.js). Jamais vrai pour un résultat positif.
pub fn est_expiration(ok: bool, message: &str) -> bool {
    let m = message.trim_start().to_lowercase();
    !ok && (m.starts_with("expirée") || m.starts_with("commande expirée"))
}

/// Réponse à « Envoyer vers Premiere » : la commande `importer` est déposée pour le panneau, ou RIEN n'est envoyé parce
/// que le panneau ne bat plus (plus de 15 s).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "etat", rename_all = "kebab-case")]
pub enum Envoi {
    Envoye { nom: String },
    NonConnecte { message: String, age: Option<f64> },
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Liaison {
    pub connecte: bool,
    pub age: Option<f64>,
    pub panneau: Option<BattementPanneau>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Instantane {
    pub version: String,
    pub plateforme: String,
    pub config: Config,
    pub assistant_termine: bool,
    pub racine: String,
    pub dossier_config: String,
    pub index: Index,
    pub transferts: Vec<Transfert>,
    pub liaison: Liaison,
    pub imports: Imports,
    pub premiere: DetectionPremiere,
    pub creative_cloud: CreativeCloud,
    /// Panneau AETHRYON (extension CEP posée par AETHRYON Setup), relu sur le disque à chaque instantané.
    pub panneau_cep: Option<PanneauCep>,
    pub native_messaging: Vec<EtatNavigateur>,
    pub demarrage_actif: bool,
    pub desinstallation_presente: bool,
    pub erreurs_dossiers: Vec<(String, String)>,
    pub journaux: (usize, u64),
    pub resultats: Vec<ResultatEnvoi>,
    pub en_attente: Vec<String>,
    /// Nocturne : transferts que CE Desktop reçoit lui-même en ce moment (conversions) : annulables, et en pause
    /// pendant la réception du fichier. Les autres (navigateur, autre processus) ne se pilotent pas d'ici.
    pub transferts_pilotables: Vec<String>,
}

struct Etat {
    config: Config,
    prive: Prive,
    index: Index,
    suivi: Suivi,
    transferts: Vec<Transfert>,
    panneau: Option<BattementPanneau>,
    connecte: bool,
    imports: Imports,
    detection: DetectionPremiere,
    cc: CreativeCloud,
    erreurs_dossiers: Vec<(String, String)>,
    envoyees: BTreeMap<String, (Vec<String>, String)>,
    resultats: Vec<ResultatEnvoi>,
    premier_passage: bool,
}

/// 3.8.1 : conversion d'un lien (« Coller un lien », relais « Envoyer vers › Premiere Pro » de l'extension) : adresse
/// d'ytapi et clé « desktop » du coffre, LUE à chaque conversion (jamais gardée ici, jamais remise à l'interface).
pub struct Moteur {
    pub api: conversion::Api,
    pub cle: Box<dyn Fn() -> Option<String> + Send + Sync>,
}

const PREMIERE_FERME: &str = "Fichier enregistré dans AETHRYON Desktop, mais Premiere Pro n'est pas ouvert (ou le panneau AETHRYON est fermé) : ouvre Premiere Pro, puis importe-le depuis le panneau AETHRYON.";
const PREMIERE_MUET: &str = "Fichier enregistré dans AETHRYON Desktop, mais le panneau AETHRYON n'a pas répondu (Premiere Pro fermé ou panneau caché) : importe-le depuis le panneau AETHRYON.";
const PREMIERE_SANS_PROJET: &str = "Fichier enregistré dans AETHRYON Desktop, mais aucun projet n'est ouvert dans Premiere Pro : ouvre un projet, puis importe-le depuis le panneau AETHRYON.";

/// Conversions suivies en même temps, au plus.
const CONVERSIONS_MAX: usize = 3;
#[cfg(not(test))]
const ATTENTE_PAS: Duration = Duration::from_millis(1000);
#[cfg(test)]
const ATTENTE_PAS: Duration = Duration::from_millis(50);

struct Partage {
    conversion: OnceLock<Moteur>,
    conversions: AtomicUsize,
    /// Conversions en cours dans ce processus, par identifiant de transfert (annuler, pause, reprise).
    pilotes: Mutex<HashMap<String, Arc<conversion::Pilote>>>,
    emp: Emplacements,
    plateforme: Box<dyn Plateforme>,
    notifieur: Box<dyn Notifieur>,
    etat: Mutex<Etat>,
    tx: Mutex<Sender<Signal>>,
    arret: AtomicBool,
    exe: PathBuf,
    dossier_defaut: String,
}

#[derive(Clone)]
pub struct Service {
    p: Arc<Partage>,
}

fn verrou(m: &Mutex<Etat>) -> MutexGuard<'_, Etat> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Dossier des médias par défaut : `<Téléchargements>\AETHRYON` (contrat §1).
pub fn dossier_medias_defaut(p: &dyn Plateforme) -> String {
    p.dossier_telechargements()
        .or_else(|| std::env::var_os("USERPROFILE").map(|u| PathBuf::from(u).join("Downloads")))
        .unwrap_or_else(|| PathBuf::from("Downloads"))
        .join("AETHRYON")
        .to_string_lossy()
        .into_owned()
}

/// Transfert d'une conversion qui commence (3.8.1, contrat §12 proposé).
fn transfert_initial(d: &Demande) -> Transfert {
    Transfert {
        schema: 1,
        id: d.id.clone(),
        titre: d.titre.clone(),
        plateforme: conversion::plateforme(&d.url).map(String::from),
        format: Some(d.format.clone()),
        etat: "attente".into(),
        progression: Some(0.0),
        fichier_attendu: None,
        chemin: None,
        erreur: None,
        maj_le: horloge::iso(horloge::maintenant()),
        origine: Some(d.origine.clone()),
        premiere: None,
        code: None,
        recus: None,
        total: None,
        vitesse: None,
        pause: None,
    }
}

fn dossiers_index(c: &Config) -> Vec<DossierIndex> {
    c.dossiers_surveilles
        .iter()
        .map(|d| DossierIndex { chemin: d.clone(), principal: noms::normaliser_pour_id(d) == noms::normaliser_pour_id(&c.dossier_medias) })
        .collect()
}

impl Service {
    pub fn demarrer(emp: Emplacements, plateforme: Box<dyn Plateforme>, notifieur: Box<dyn Notifieur>, exe: PathBuf) -> Service {
        let _ = emp.creer_arborescence();
        journal::initialiser(&emp.journaux(), "desktop");
        let defaut = dossier_medias_defaut(plateforme.as_ref());
        let ch = config::charger(&emp, &defaut);
        for r in &ch.remarques {
            journal::avert("config", r);
        }
        let prive = config::charger_prive(&emp);
        let index = match atomique::lire_json::<Index>(&emp.index_json()) {
            Lecture::Lu(i) => i,
            Lecture::Absent => Index::default(),
            Lecture::Illisible(m) => {
                journal::avert("bibliotheque", &format!("index.json {m} : reconstruit au premier passage"));
                Index::default()
            }
        };
        let suivi = atomique::lire_json::<Suivi>(&emp.suivi_json()).ok().unwrap_or_default();
        let bilan = nettoyage::nettoyer(&emp, &index, horloge::maintenant());
        journal::info("demarrage", &format!("AETHRYON Desktop {} ({}) ; nettoyage : {bilan:?}", crate::VERSION, plateforme.nom()));
        let detection = plateforme::detecter_premiere(plateforme.as_ref(), prive.premiere_exe_manuel.as_deref().map(Path::new));
        let cc = plateforme.creative_cloud();
        let (tx, rx) = channel();
        let p = Arc::new(Partage {
            conversion: OnceLock::new(),
            conversions: AtomicUsize::new(0),
            pilotes: Mutex::new(HashMap::new()),
            etat: Mutex::new(Etat {
                config: ch.config,
                prive,
                index,
                suivi,
                transferts: transferts::lister(&emp.transferts()),
                panneau: None,
                connecte: false,
                imports: Imports::default(),
                detection,
                cc,
                erreurs_dossiers: vec![],
                envoyees: BTreeMap::new(),
                resultats: vec![],
                premier_passage: true,
            }),
            emp,
            plateforme,
            notifieur,
            tx: Mutex::new(tx),
            arret: AtomicBool::new(false),
            exe,
            dossier_defaut: defaut,
        });
        let s = Service { p };
        let a = s.clone();
        std::thread::Builder::new().name("aethryon-surveillance".into()).spawn(move || a.boucle_surveillance(rx)).ok();
        let b = s.clone();
        std::thread::Builder::new().name("aethryon-echanges".into()).spawn(move || b.boucle_echanges()).ok();
        s
    }

    pub fn emplacements(&self) -> &Emplacements {
        &self.p.emp
    }
    pub fn plateforme(&self) -> &dyn Plateforme {
        self.p.plateforme.as_ref()
    }
    pub fn exe(&self) -> &Path {
        &self.p.exe
    }
    pub fn dossier_defaut(&self) -> String {
        self.p.dossier_defaut.clone()
    }
    pub fn config(&self) -> Config {
        verrou(&self.p.etat).config.clone()
    }
    pub fn assistant_termine(&self) -> bool {
        verrou(&self.p.etat).prive.assistant_termine
    }
    pub fn premiere_manuel(&self) -> Option<PathBuf> {
        verrou(&self.p.etat).prive.premiere_exe_manuel.as_ref().map(PathBuf::from)
    }

    fn signal(&self, s: Signal) {
        if let Ok(tx) = self.p.tx.lock() {
            let _ = tx.send(s);
        }
    }

    pub fn arreter(&self) {
        self.p.arret.store(true, Ordering::SeqCst);
        self.signal(Signal::Arret);
    }

    pub fn rescanner(&self) {
        self.signal(Signal::Rescan);
    }

    /// 3.8.1 : pose le moteur de conversion (une seule fois, après la liaison au compte).
    pub fn installer_conversion(&self, m: Moteur) {
        let _ = self.p.conversion.set(m);
    }

    // ---- Surveillance ---------------------------------------------------------------------------------------------

    fn boucle_surveillance(&self, rx: Receiver<Signal>) {
        let (dossiers, actif) = {
            let e = verrou(&self.p.etat);
            (e.config.dossiers_surveilles.clone(), e.config.surveillance)
        };
        let mut veilleur = actif.then(|| self.nouveau_veilleur(&dossiers));
        let mut plan = Planificateur::nouveau(actif);
        while !self.p.arret.load(Ordering::SeqCst) {
            let t = Instant::now();
            if plan.doit_passer(t) {
                let instable = self.passage();
                plan.fait(Instant::now(), instable);
            }
            match rx.recv_timeout(plan.attente(Instant::now())) {
                Ok(Signal::Changement) => plan.changement(Instant::now()),
                Ok(Signal::Rescan) => plan.immediat(Instant::now()),
                Ok(Signal::Dossiers) => {
                    let (dossiers, actif) = {
                        let e = verrou(&self.p.etat);
                        (e.config.dossiers_surveilles.clone(), e.config.surveillance)
                    };
                    drop(veilleur.take());
                    veilleur = actif.then(|| self.nouveau_veilleur(&dossiers));
                    plan.actif = actif;
                    plan.immediat(Instant::now());
                }
                Ok(Signal::Arret) => break,
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
        drop(veilleur);
    }

    fn nouveau_veilleur(&self, dossiers: &[String]) -> Veilleur {
        let tx = self.p.tx.lock().map(|t| t.clone()).expect("canal");
        let v = Veilleur::demarrer(dossiers, tx);
        for (d, m) in &v.erreurs {
            journal::avert("surveillance", &format!("{d} : {m}"));
        }
        v
    }

    /// Un passage complet. Renvoie `true` si un fichier bouge encore.
    pub fn passage(&self) -> bool {
        let (dossiers, ancien, mut suivi, premier) = {
            let e = verrou(&self.p.etat);
            (dossiers_index(&e.config), e.index.clone(), e.suivi.clone(), e.premier_passage)
        };
        let chemins: Vec<String> = dossiers.iter().map(|d| d.chemin.clone()).collect();
        let (fichiers, erreurs) = bibliotheque::lister_fichiers(&chemins, &[self.p.emp.racine.clone()]);
        let mut p = bibliotheque::passer(&ancien, &mut suivi, &dossiers, fichiers, horloge::maintenant(), premier);
        let mut e = verrou(&self.p.etat);
        // Analyses arrivées pendant le passage : reportées si le fichier n'a pas changé.
        for m in p.index.medias.iter_mut() {
            if let Some(c) = e.index.media(&m.id) {
                if c.taille == m.taille && c.modifie_le == m.modifie_le {
                    if m.miniature.is_none() && c.miniature.is_some() {
                        m.miniature = c.miniature.clone();
                        p.change = true;
                    }
                    if m.duree.is_none() && c.duree.is_some() {
                        m.duree = c.duree;
                        p.change = true;
                    }
                    if m.largeur.is_none() && c.largeur.is_some() {
                        m.largeur = c.largeur;
                        m.hauteur = c.hauteur;
                        p.change = true;
                    }
                }
            }
            if let (Some(courant), Some(s)) = (e.suivi.medias.get(&m.id), suivi.medias.get_mut(&m.id)) {
                if s.analyse_web.is_none() && courant.taille == s.taille && courant.modifie == s.modifie {
                    s.analyse_web = courant.analyse_web.clone();
                }
            }
        }
        // Transferts : liaison avec les médias arrivés.
        let lies = transferts::relier(&e.transferts, &mut p.index, horloge::maintenant());
        for t in &lies {
            if let Err(err) = transferts::ecrire(&self.p.emp.transferts(), t) {
                journal::avert("transferts", &format!("{} non mis à jour ({})", t.id, err.kind()));
            }
        }
        if !lies.is_empty() {
            p.change = true;
            e.transferts = transferts::lister(&self.p.emp.transferts());
        }
        let erreurs_changent = erreurs != e.erreurs_dossiers;
        e.erreurs_dossiers = erreurs;
        e.premier_passage = false;
        e.suivi = suivi;
        let prets: Vec<Media> = p.prets.iter().filter_map(|id| p.index.media(id).cloned()).collect();
        let notifier_prets = e.config.notifications.media_pret;
        if p.change {
            e.index = p.index;
            if let Err(err) = atomique::ecrire_json(&self.p.emp.index_json(), &e.index, false) {
                journal::erreur("bibliotheque", &format!("index.json non écrit ({})", err.kind()));
            }
        }
        let _ = atomique::ecrire_json(&self.p.emp.suivi_json(), &e.suivi, false);
        drop(e);
        if p.change || erreurs_changent {
            self.p.notifieur.changement("bibliotheque");
        }
        if !lies.is_empty() {
            self.p.notifieur.changement("transferts");
        }
        for m in prets {
            journal::info("bibliotheque", &format!("Média prêt : {}.{}", m.nom, m.ext));
            if notifier_prets {
                self.p.notifieur.media_pret(&m);
            }
        }
        p.instable
    }

    // ---- Échanges -----------------------------------------------------------------------------------------------------

    fn boucle_echanges(&self) {
        let mut dernier_battement: Option<Instant> = None;
        let mut derniere_detection = Instant::now();
        let mut tour = 0u64;
        while !self.p.arret.load(Ordering::SeqCst) {
            let t = horloge::maintenant();
            if dernier_battement.map(|d| d.elapsed() >= Duration::from_secs(2)).unwrap_or(true) {
                self.ecrire_battement(t);
                dernier_battement = Some(Instant::now());
            }
            self.lire_panneau(t);
            self.traiter_commandes(t);
            self.suivre_envoyees(t);
            if tour % 2 == 0 {
                self.lire_transferts();
            }
            if derniere_detection.elapsed() > Duration::from_secs(300) {
                self.redetecter();
                derniere_detection = Instant::now();
            }
            tour += 1;
            std::thread::sleep(Duration::from_millis(1000));
        }
    }

    fn ecrire_battement(&self, t: horloge::Instant) {
        let b = {
            let e = verrou(&self.p.etat);
            let pr = e.detection.principale.as_ref();
            BattementDesktop::nouveau(
                &e.config.dossier_medias,
                PremiereEtat { detecte: pr.is_some(), version: pr.and_then(|i| i.version.clone()), compatible: pr.and_then(|i| i.compatible) },
                t,
            )
        };
        if let Err(err) = battements::ecrire_desktop(&self.p.emp, &b) {
            journal::avert("battement", &format!("etat/desktop.json non écrit ({})", err.kind()));
        }
    }

    fn lire_panneau(&self, t: horloge::Instant) {
        let lu = battements::lire_panneau(&self.p.emp);
        let imports = battements::lire_imports(&self.p.emp);
        let mut e = verrou(&self.p.etat);
        let mut change = false;
        match lu {
            Lecture::Lu(b) => {
                let connecte = b.connecte(t);
                let vu = (b.projet.clone(), b.projet_ouvert, b.premiere_version.clone(), b.version.clone());
                let avant = e.panneau.as_ref().map(|a| (a.projet.clone(), a.projet_ouvert, a.premiere_version.clone(), a.version.clone()));
                change |= connecte != e.connecte || avant.as_ref() != Some(&vu);
                e.connecte = connecte;
                e.panneau = Some(b);
            }
            Lecture::Absent => {
                change |= e.connecte || e.panneau.is_some();
                e.connecte = false;
                e.panneau = None;
            }
            Lecture::Illisible(_) => {
                // Réessayé au passage suivant ; la fraîcheur se recalcule sur le dernier battement lu.
                let c = e.panneau.as_ref().map(|b| b.connecte(t)).unwrap_or(false);
                change |= c != e.connecte;
                e.connecte = c;
            }
        }
        if let Lecture::Lu(i) = imports {
            if i != e.imports {
                e.imports = i;
                change = true;
            }
        }
        drop(e);
        if change {
            self.p.notifieur.changement("liaison");
        }
    }

    fn traiter_commandes(&self, t: horloge::Instant) {
        for c in commandes::relever(&self.p.emp, t) {
            match c {
                Entrante::Refusee { action, raison, .. } => {
                    journal::avert("commandes", &format!("Commande refusée « {action} » : {raison}"));
                }
                Entrante::Expiree { .. } => {}
                Entrante::Action { nom, commande, action: ActionDesktop::ConvertirPourPremiere { demande } } => {
                    // Moteur pas encore posé (premières millisecondes du démarrage) : commande reprise au tour suivant.
                    if self.p.conversion.get().is_none() {
                        continue;
                    }
                    let id = demande.id.clone();
                    let (ok, message) = if horloge::age_secondes(&commande.cree_le, t).is_none_or(|a| a > commandes::EXPIRATION_S) {
                        let m = "AETHRYON Desktop n'a pas pris la demande à temps (2 minutes) : relance l'envoi depuis l'extension.";
                        self.modifier_transfert(&id, |x| {
                            x.etat = "erreur".into();
                            x.code = Some("expire".into());
                            x.erreur = Some(m.into());
                            x.progression = None;
                        });
                        (false, format!("Expirée : {m}"))
                    } else {
                        match self.convertir(demande) {
                            Ok(_) => (true, "Conversion lancée par AETHRYON Desktop.".to_string()),
                            Err(m) => (false, m),
                        }
                    };
                    journal::info("commandes", &format!("convertir-pour-premiere de {} : {}", commande.de, if ok { "lancée" } else { "refusée" }));
                    if let Err(err) = commandes::clore(&self.p.emp, &nom, commande, ok, &message, t) {
                        journal::avert("commandes", &format!("Résultat non écrit ({})", err.kind()));
                    }
                }
                Entrante::Action { nom, commande, action } => {
                    let (ok, message) = match self.executer_action(&action) {
                        Ok(m) => (true, m),
                        Err(m) => (false, m),
                    };
                    journal::info("commandes", &format!("{} de {} : {} {}", commande.action, commande.de, if ok { "fait" } else { "échec" }, message));
                    if let Err(err) = commandes::clore(&self.p.emp, &nom, commande, ok, &message, t) {
                        journal::avert("commandes", &format!("Résultat non écrit ({})", err.kind()));
                    }
                }
            }
        }
    }

    fn executer_action(&self, a: &ActionDesktop) -> Result<String, String> {
        match a {
            ActionDesktop::AfficherDansExplorateur { id } => {
                self.action_media(id, "explorateur")?;
                Ok("Explorateur ouvert sur le fichier.".into())
            }
            ActionDesktop::OuvrirDossierMedias => {
                let d = self.config().dossier_medias;
                self.p.plateforme.ouvrir(Path::new(&d))?;
                Ok("Dossier des médias ouvert.".into())
            }
            ActionDesktop::Rescanner => {
                self.rescanner();
                Ok("Nouveau passage lancé.".into())
            }
            ActionDesktop::AjouterDossierSurveille { chemin } => self.ajouter_dossier(chemin).map(|_| "Dossier ajouté à la surveillance.".into()),
            ActionDesktop::RetirerDossierSurveille { chemin } => self.retirer_dossier(chemin).map(|_| "Dossier retiré de la surveillance.".into()),
            ActionDesktop::OuvrirDesktop { section } => {
                self.p.notifieur.naviguer(section);
                Ok("AETHRYON Desktop au premier plan.".into())
            }
            // Traitée à part (traiter_commandes) : jamais ici.
            ActionDesktop::ConvertirPourPremiere { .. } => Err("Commande traitée à part.".into()),
        }
    }

    fn suivre_envoyees(&self, t: horloge::Instant) {
        let noms: Vec<(String, Vec<String>, String)> = verrou(&self.p.etat).envoyees.iter().map(|(n, (ids, a))| (n.clone(), ids.clone(), a.clone())).collect();
        for (nom, ids, action) in noms {
            let Some(c) = commandes::resultat(&self.p.emp, &nom) else { continue };
            let r = c.resultat.unwrap();
            let expire = est_expiration(r.ok, &r.message);
            let res = ResultatEnvoi { nom: nom.clone(), action, ids, ok: r.ok, message: r.message, le: horloge::iso(t), expire };
            {
                let mut e = verrou(&self.p.etat);
                e.envoyees.remove(&nom);
                e.resultats.insert(0, res.clone());
                e.resultats.truncate(20);
            }
            journal::info("commandes", &format!("Résultat de {} : {} {}", res.action, res.ok, res.message));
            self.p.notifieur.resultat_commande(&res);
        }
    }

    fn lire_transferts(&self) {
        let l = transferts::lister(&self.p.emp.transferts());
        let mut e = verrou(&self.p.etat);
        if l != e.transferts {
            e.transferts = l;
            drop(e);
            self.p.notifieur.changement("transferts");
            // Un transfert nouveau peut déjà correspondre à un média arrivé.
            self.rescanner();
        }
    }

    pub fn redetecter(&self) {
        let manuel = self.premiere_manuel();
        let d = plateforme::detecter_premiere(self.p.plateforme.as_ref(), manuel.as_deref());
        let cc = self.p.plateforme.creative_cloud();
        let mut e = verrou(&self.p.etat);
        let change = d != e.detection || cc != e.cc;
        e.detection = d;
        e.cc = cc;
        drop(e);
        if change {
            self.p.notifieur.changement("liaison");
        }
    }

    // ---- API de l'interface -----------------------------------------------------------------------------------------

    pub fn instantane(&self) -> Instantane {
        // Battement du panneau relu à la demande : l'âge montré est celui du fichier, pas celui du dernier passage
        // d'échanges (jusqu'à 1 s plus tôt). Le banc d'intégration a mesuré 11,6 s d'âge apparent pour un panneau caché
        // (battement toutes les 10 s, seuil 12 s) avant ce changement.
        let relu = battements::lire_panneau(&self.p.emp).ok();
        let e = verrou(&self.p.etat);
        let t = horloge::maintenant();
        let panneau = relu.or_else(|| e.panneau.clone());
        let mut en_attente: Vec<String> = e.envoyees.keys().cloned().collect();
        en_attente.sort();
        Instantane {
            version: crate::VERSION.into(),
            plateforme: self.p.plateforme.nom().into(),
            config: e.config.clone(),
            assistant_termine: e.prive.assistant_termine,
            racine: self.p.emp.racine.to_string_lossy().into_owned(),
            dossier_config: self.p.emp.config.to_string_lossy().into_owned(),
            index: e.index.clone(),
            transferts: e.transferts.clone(),
            liaison: Liaison { connecte: panneau.as_ref().map(|b| b.connecte(t)).unwrap_or(false), age: panneau.as_ref().and_then(|b| b.age(t)), panneau },
            imports: e.imports.clone(),
            premiere: e.detection.clone(),
            creative_cloud: e.cc.clone(),
            panneau_cep: crate::assistant::detecter_panneau_cep(&self.p.emp),
            native_messaging: plateforme::etat_nm(self.p.plateforme.as_ref(), &self.p.emp.manifeste_nm()),
            demarrage_actif: plateforme::demarrage_auto_actif(self.p.plateforme.as_ref(), &self.p.exe),
            desinstallation_presente: self.p.plateforme.reg_lire(plateforme::CLE_DESINSTALLATION, Some("DisplayVersion")).is_some(),
            erreurs_dossiers: e.erreurs_dossiers.clone(),
            journaux: journal::resume(&self.p.emp.journaux()),
            resultats: e.resultats.clone(),
            en_attente,
            transferts_pilotables: {
                let mut v: Vec<String> = self.p.pilotes.lock().unwrap_or_else(|x| x.into_inner()).keys().cloned().collect();
                v.sort();
                v
            },
        }
    }

    /// Recharge config et réglages privés depuis le disque (après l'assistant).
    pub fn recharger(&self) {
        let ch = config::charger(&self.p.emp, &self.p.dossier_defaut);
        let prive = config::charger_prive(&self.p.emp);
        {
            let mut e = verrou(&self.p.etat);
            e.config = ch.config;
            e.prive = prive;
        }
        self.redetecter();
        self.signal(Signal::Dossiers);
        self.p.notifieur.changement("config");
    }

    pub fn modifier_config(&self, patch: &Value) -> Result<Config, String> {
        let mut e = verrou(&self.p.etat);
        let mut c = e.config.clone();
        c.appliquer(patch)?;
        if c.dossier_medias != e.config.dossier_medias {
            config::tester_ecriture(Path::new(&c.dossier_medias))?;
        }
        if c.demarrage_auto != e.config.demarrage_auto {
            plateforme::demarrage_auto(self.p.plateforme.as_ref(), &self.p.exe, c.demarrage_auto)?;
        }
        config::enregistrer(&self.p.emp, &c).map_err(|err| format!("config.json non écrit ({}).", err.kind()))?;
        let dossiers = c.dossiers_surveilles != e.config.dossiers_surveilles || c.surveillance != e.config.surveillance;
        journal::info("config", &format!("Réglages modifiés : {}", patch.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>().join(", ")).unwrap_or_default()));
        e.config = c.clone();
        drop(e);
        if dossiers {
            self.signal(Signal::Dossiers);
        }
        self.p.notifieur.changement("config");
        Ok(c)
    }

    pub fn ajouter_dossier(&self, chemin: &str) -> Result<(), String> {
        let p = Path::new(chemin);
        if !noms::est_absolu(chemin) || noms::est_racine_volume(chemin) || noms::est_dossier_systeme(chemin) {
            return Err("Ce dossier ne peut pas être surveillé (racine d'un disque ou dossier système).".into());
        }
        if !p.is_dir() {
            return Err("Dossier introuvable.".into());
        }
        let mut l = self.config().dossiers_surveilles;
        if l.iter().any(|d| noms::normaliser_pour_id(d) == noms::normaliser_pour_id(chemin)) {
            return Ok(());
        }
        l.push(chemin.to_string());
        self.modifier_config(&serde_json::json!({ "dossiersSurveilles": l })).map(|_| ())
    }

    pub fn retirer_dossier(&self, chemin: &str) -> Result<(), String> {
        let c = self.config();
        if noms::normaliser_pour_id(chemin) == noms::normaliser_pour_id(&c.dossier_medias) {
            return Err("Le dossier des médias principal reste surveillé ; changez-le dans Paramètres.".into());
        }
        let l: Vec<String> = c.dossiers_surveilles.into_iter().filter(|d| noms::normaliser_pour_id(d) != noms::normaliser_pour_id(chemin)).collect();
        self.modifier_config(&serde_json::json!({ "dossiersSurveilles": l })).map(|_| ())
    }

    /// Demande d'import envoyée au panneau (commande `importer`, contrat §5). Renvoie le nom du fichier de commande.
    pub fn importer(&self, ids: &[String], chutier: Option<&str>) -> Result<String, String> {
        if ids.is_empty() || ids.len() > 200 {
            return Err("Sélection vide ou trop grande (200 médias au plus).".into());
        }
        let mut e = verrou(&self.p.etat);
        for id in ids {
            match e.index.media(id) {
                Some(m) if m.etat == EtatMedia::Disponible => {}
                Some(m) => return Err(format!("« {} » n'est pas disponible ({}).", m.nom, match m.etat { EtatMedia::EnCours => "en cours", EtatMedia::Introuvable => "introuvable", _ => "erreur" })),
                None => return Err("Média inconnu de la bibliothèque.".into()),
            }
        }
        let chutier = chutier.unwrap_or(&e.config.chutier_par_defaut).to_string();
        if !config::CHUTIERS.contains(&chutier.as_str()) {
            return Err("Chutier inconnu.".into());
        }
        let (nom, _) = commandes::deposer_importer(&self.p.emp, ids, &chutier, horloge::maintenant()).map_err(|err| format!("Commande non écrite ({}).", err.kind()))?;
        e.envoyees.insert(nom.clone(), (ids.to_vec(), "importer".into()));
        journal::info("commandes", &format!("Import demandé au panneau : {} média(s), chutier {chutier}", ids.len()));
        Ok(nom)
    }

    /// « Envoyer vers Premiere » (flux) : comme [`Service::importer`], mais RIEN n'est déposé si le panneau ne bat plus
    /// (battement relu à l'instant, seuil de 15 s) : l'interface le dit au lieu d'attendre 2 minutes une expiration.
    pub fn envoyer_vers_premiere(&self, ids: &[String], chutier: Option<&str>) -> Result<Envoi, String> {
        let t = horloge::maintenant();
        let b = battements::lire_panneau(&self.p.emp).ok().or_else(|| verrou(&self.p.etat).panneau.clone());
        let age = b.as_ref().and_then(|b| b.age(t)).map(|a| (a * 10.0).round() / 10.0);
        if !b.as_ref().map(|b| b.connecte(t)).unwrap_or(false) {
            let message = match age {
                Some(a) if a >= 0.0 => format!("Premiere Pro n'est pas connecté : le panneau AETHRYON ne donne plus signe de vie depuis {} s. Rien n'a été envoyé.", a.round() as i64),
                _ => "Premiere Pro n'est pas connecté : ouvrez le panneau AETHRYON dans Premiere Pro. Rien n'a été envoyé.".to_string(),
            };
            journal::info("flux", "Envoi vers Premiere : panneau non connecté, rien n'a été envoyé.");
            return Ok(Envoi::NonConnecte { message, age });
        }
        let nom = self.importer(ids, chutier)?;
        Ok(Envoi::Envoye { nom })
    }

    // ---- Conversion d'un lien (3.8.1) ---------------------------------------------------------------------------------

    /// Lance une conversion par ytapi avec la clé du compte relié : le transfert est écrit « attente » tout de suite, puis
    /// suivi dans un fil (conversion, téléchargement, « pret » quand la bibliothèque a le fichier) ; `premiere` : import
    /// demandé ensuite au panneau (commande `importer`, §5), résultat RÉEL noté dans le transfert.
    pub fn convertir(&self, d: Demande) -> Result<Transfert, String> {
        if !transferts::id_valide(&d.id) || !transferts::FORMATS.contains(&d.format.as_str()) {
            return Err("Demande de conversion invalide.".into());
        }
        let url = conversion::valider_url(&d.url)?;
        let d = Demande { url, ..d };
        let avec_trace = d.origine == "extension";
        let refuser = |code: &str, m: &str| {
            if avec_trace {
                self.ecrire_transfert(&Transfert { etat: "erreur".into(), code: Some(code.into()), erreur: Some(m.into()), progression: None, ..transfert_initial(&d) });
            }
            Err(m.to_string())
        };
        let Some(moteur) = self.p.conversion.get() else {
            return refuser("demarrage", "AETHRYON Desktop démarre encore : réessaie dans un instant.");
        };
        let Some(cle) = (moteur.cle)() else {
            return refuser("non_relie", conversion::TEXTE_NON_RELIE);
        };
        if self.p.conversions.fetch_add(1, Ordering::SeqCst) >= CONVERSIONS_MAX {
            self.p.conversions.fetch_sub(1, Ordering::SeqCst);
            return refuser("occupe", "Trois conversions sont déjà en cours : attends la fin de l'une d'elles, puis relance.");
        }
        let t = transfert_initial(&d);
        self.ecrire_transfert(&t);
        journal::info("conversion", &format!("Conversion demandée ({}, {}{}).", d.origine, d.format, if d.extrait.is_some() { ", extrait" } else { "" }));
        let pilote = Arc::new(conversion::Pilote::default());
        self.p.pilotes.lock().unwrap_or_else(|x| x.into_inner()).insert(d.id.clone(), pilote.clone());
        let s = self.clone();
        let api = moteur.api.clone();
        let depart = t.clone();
        let suivie = d.clone();
        let lance = std::thread::Builder::new().name("aethryon-conversion".into()).spawn(move || {
            s.suivre_conversion(suivie, &api, &cle, &pilote);
            s.p.conversions.fetch_sub(1, Ordering::SeqCst);
        });
        if lance.is_err() {
            self.p.pilotes.lock().unwrap_or_else(|x| x.into_inner()).remove(&d.id);
            self.p.conversions.fetch_sub(1, Ordering::SeqCst);
            return refuser("interne", "Conversion impossible à lancer.");
        }
        Ok(depart)
    }

    fn suivre_conversion(&self, d: Demande, api: &conversion::Api, cle: &str, pilote: &conversion::Pilote) {
        let dossier = PathBuf::from(self.config().dossier_medias);
        let mut dernier: Option<(String, Instant)> = None;
        let r = conversion::convertir(api, cle, &d, &dossier, &self.p.arret, pilote, &mut |a| {
            // (étape notée pour le rythme d'écriture, état écrit dans le transfert, mise à jour)
            let (etape, etat, maj): (&str, &str, Box<dyn FnOnce(&mut Transfert)>) = match a {
                Avancee::Attente => ("attente", "attente", Box::new(|_| {})),
                // Progression du serveur seulement quand il la mesure (sinon : inconnue, jamais inventée).
                Avancee::Conversion(p) => ("conversion", "conversion", Box::new(move |x| x.progression = p)),
                Avancee::Titre(t) => ("titre", "", Box::new(move |x| x.titre = Some(t))),
                Avancee::Telechargement { nom, recus, total, vitesse } => ("telechargement", "telechargement", Box::new(move |x| {
                    x.fichier_attendu = Some(nom);
                    x.progression = total.filter(|t| *t > 0).map(|t| (recus as f64 / t as f64).clamp(0.0, 1.0));
                    (x.recus, x.total, x.vitesse, x.pause) = (Some(recus), total, vitesse, None);
                })),
                Avancee::Pause { nom, recus, total } => ("pause", "telechargement", Box::new(move |x| {
                    x.fichier_attendu = Some(nom);
                    x.progression = total.filter(|t| *t > 0).map(|t| (recus as f64 / t as f64).clamp(0.0, 1.0));
                    (x.recus, x.total, x.vitesse, x.pause) = (Some(recus), total, None, Some(true));
                })),
            };
            // Un changement d'étape (pause et reprise comprises) part tout de suite ; la progression au plus deux fois
            // par seconde.
            let change = dernier.as_ref().is_none_or(|(e, t)| e != etape || t.elapsed() >= Duration::from_millis(500));
            if change {
                dernier = Some((etape.to_string(), Instant::now()));
                self.modifier_transfert(&d.id, |x| {
                    if !etat.is_empty() {
                        x.etat = etat.into();
                    }
                    maj(x);
                });
            }
        });
        // Fichier reçu (ou échec) : plus rien à piloter ; l'import éventuel dans Premiere suit sans pilote.
        self.p.pilotes.lock().unwrap_or_else(|x| x.into_inner()).remove(&d.id);
        let chemin = match r {
            Ok(c) => c,
            Err(e) => {
                let demande = pilote.annule() && e.code == "annule";
                if demande {
                    journal::info("conversion", "Conversion annulée par l'utilisateur.");
                } else {
                    journal::avert("conversion", &format!("Conversion en échec ({}) : {}", e.code, e.message));
                }
                self.modifier_transfert(&d.id, |x| {
                    x.etat = "erreur".into();
                    x.code = Some(e.code.chars().take(40).collect());
                    x.erreur = Some(if demande { "Annulé à ta demande.".into() } else { e.message.clone() });
                    x.progression = None;
                    (x.vitesse, x.pause) = (None, None);
                });
                return;
            }
        };
        let nom = chemin.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        journal::info("conversion", &format!("Fichier enregistré : {nom}"));
        // Fichier complet : la surveillance le découvre, puis relie le transfert (« pret ») par son nom.
        self.modifier_transfert(&d.id, |x| {
            x.etat = "telechargement".into();
            x.progression = Some(1.0);
            x.fichier_attendu = Some(nom.clone());
            (x.vitesse, x.pause) = (None, None);
            x.recus = x.total.or(x.recus);
        });
        self.rescanner();
        if d.premiere {
            self.importer_apres_conversion(&d.id, &chemin);
        }
    }

    /// Relais de l'extension : média disponible et transfert relié, puis commande `importer` (chutier par défaut), et son
    /// résultat RÉEL (`importe`, `non-connecte`, `sans-projet`, `echec`) noté dans le transfert.
    fn importer_apres_conversion(&self, id: &str, chemin: &Path) {
        let id_media = noms::id_media(&chemin.to_string_lossy());
        let pret = self.attendre(Duration::from_secs(120), || {
            let disponible = verrou(&self.p.etat).index.media(&id_media).is_some_and(|m| m.etat == EtatMedia::Disponible);
            disponible && self.lire_transfert(id).is_some_and(|t| t.etat == "pret")
        });
        let noter = |etat: &str, message: Option<String>| {
            self.modifier_transfert(id, |x| {
                x.premiere = Some(etat.into());
                x.erreur = message;
            });
            journal::info("conversion", &format!("Import dans Premiere Pro : {etat}"));
        };
        if !pret {
            return noter("echec", Some("Fichier enregistré, mais la bibliothèque ne l'a pas encore pris en compte : importe-le depuis le panneau AETHRYON.".into()));
        }
        let nom = match self.envoyer_vers_premiere(&[id_media], None) {
            Ok(Envoi::Envoye { nom }) => nom,
            Ok(Envoi::NonConnecte { .. }) => return noter("non-connecte", Some(PREMIERE_FERME.into())),
            Err(m) => return noter("echec", Some(m)),
        };
        noter("demande", None);
        let mut r = None;
        self.attendre(Duration::from_secs(150), || {
            r = commandes::resultat(&self.p.emp, &nom).and_then(|c| c.resultat);
            r.is_some()
        });
        match r {
            Some(r) if r.ok => noter("importe", None),
            Some(r) if est_expiration(r.ok, &r.message) => noter("non-connecte", Some(PREMIERE_MUET.into())),
            Some(r) if r.message.trim_start().to_lowercase().starts_with("aucun projet") => noter("sans-projet", Some(PREMIERE_SANS_PROJET.into())),
            Some(r) => noter("echec", Some(format!("Fichier enregistré dans AETHRYON Desktop, mais l'import dans Premiere Pro a échoué : {}", r.message))),
            None => noter("non-connecte", Some(PREMIERE_MUET.into())),
        }
    }

    fn attendre(&self, max: Duration, mut f: impl FnMut() -> bool) -> bool {
        let t = Instant::now();
        loop {
            if f() {
                return true;
            }
            if t.elapsed() >= max || self.p.arret.load(Ordering::SeqCst) {
                return false;
            }
            std::thread::sleep(ATTENTE_PAS);
        }
    }

    /// Nocturne (écran Transferts) : `annuler` une conversion de CE Desktop à toute étape, la mettre en `pause` pendant
    /// la réception du fichier, ou la `reprendre`. Refus clair pour un transfert qui ne se pilote pas d'ici.
    pub fn piloter_transfert(&self, id: &str, action: &str) -> Result<(), String> {
        let pilote = self.p.pilotes.lock().unwrap_or_else(|x| x.into_inner()).get(id).cloned();
        let Some(p) = pilote else {
            return Err("Ce transfert ne se pilote pas depuis AETHRYON Desktop (reçu par le navigateur, ou déjà terminé).".into());
        };
        match action {
            "annuler" => {
                p.mettre_en_pause(false);
                p.annuler();
            }
            "pause" => {
                if self.lire_transfert(id).is_none_or(|t| t.etat != "telechargement") {
                    return Err("La pause n'est possible que pendant la réception du fichier : la conversion a lieu sur le serveur.".into());
                }
                p.mettre_en_pause(true);
            }
            "reprendre" => p.mettre_en_pause(false),
            _ => return Err("Action de transfert inconnue.".into()),
        }
        journal::info("conversion", &format!("Transfert : {action} demandé."));
        self.p.notifieur.changement("transferts");
        Ok(())
    }

    fn lire_transfert(&self, id: &str) -> Option<Transfert> {
        transferts::chemin_transfert(&self.p.emp.transferts(), id).and_then(|c| atomique::lire_json::<Transfert>(&c).ok())
    }

    /// Écrit un transfert (date de mise à jour posée ici), met la liste à jour et prévient l'interface.
    fn ecrire_transfert(&self, t: &Transfert) {
        let mut t = t.clone();
        t.maj_le = horloge::iso(horloge::maintenant());
        if let Err(err) = transferts::ecrire(&self.p.emp.transferts(), &t) {
            journal::avert("transferts", &format!("{} non écrit ({})", t.id, err.kind()));
            return;
        }
        {
            let mut e = verrou(&self.p.etat);
            match e.transferts.iter().position(|x| x.id == t.id) {
                Some(i) => e.transferts[i] = t,
                None => e.transferts.insert(0, t),
            }
        }
        self.p.notifieur.changement("transferts");
    }

    /// Modifie un transfert relu sur le disque (jamais une copie ancienne : la surveillance a pu le relier entre-temps).
    fn modifier_transfert(&self, id: &str, f: impl FnOnce(&mut Transfert)) {
        let Some(mut t) = self.lire_transfert(id) else { return };
        f(&mut t);
        self.ecrire_transfert(&t);
    }

    /// Chemins à glisser vers une autre application, résolus depuis l'index : identifiants valides, médias disponibles,
    /// dans un dossier surveillé, fichiers ordinaires existants. Jamais un chemin venu de l'interface.
    pub fn chemins_pour_glisser(&self, ids: &[String]) -> Result<Vec<(String, PathBuf)>, String> {
        if ids.is_empty() || ids.len() > flux::GLISSER_MAX {
            return Err(format!("Sélection vide ou trop grande ({} médias au plus).", flux::GLISSER_MAX));
        }
        let mut vus = std::collections::HashSet::new();
        let mut v = Vec::new();
        for id in ids {
            if !noms::est_id_valide(id) {
                return Err("Identifiant invalide.".into());
            }
            if !vus.insert(id.as_str()) {
                continue;
            }
            let etat = verrou(&self.p.etat).index.media(id).map(|m| (m.etat, m.nom.clone()));
            match etat {
                Some((EtatMedia::Disponible, _)) => {}
                Some((_, nom)) => return Err(format!("« {nom} » n'est pas disponible.")),
                None => return Err("Média inconnu de la bibliothèque.".into()),
            }
            let p = self.chemin_verifie(id)?;
            if !std::fs::symlink_metadata(&p).map(|m| m.file_type().is_file()).unwrap_or(false) {
                return Err("Ce média n'est pas un fichier ordinaire.".into());
            }
            v.push((id.clone(), p));
        }
        Ok(v)
    }

    /// Médias de l'index (copie), pour la bibliothèque musicale (section MUSIQUE).
    pub fn medias(&self) -> Vec<crate::bibliotheque::Media> {
        verrou(&self.p.etat).index.medias.clone()
    }

    /// Médias de la bibliothèque à envoyer vers AETHRYON Cloud : désignés par identifiant, disponibles, dans un dossier
    /// surveillé, fichiers ordinaires (jamais un chemin venu de l'interface). Taille relue sur le disque.
    pub fn fichiers_pour_cloud(&self, ids: &[String]) -> Result<Vec<crate::cloud::FichierLocal>, String> {
        let chemins = self.chemins_pour_glisser(ids)?;
        let e = verrou(&self.p.etat);
        let mut v = Vec::new();
        for (id, p) in chemins {
            let m = e.index.media(&id).ok_or("Média inconnu de la bibliothèque.")?;
            let taille = std::fs::metadata(&p).map(|x| x.len()).map_err(|_| format!("« {} » est illisible.", m.nom))?;
            v.push(crate::cloud::FichierLocal { media_id: Some(id.clone()), chemin: p, nom: format!("{}.{}", m.nom, m.ext), taille });
        }
        Ok(v)
    }

    /// Classe ce qui survole la fenêtre ou y est déposé (`autorise` : chemins remis par le système).
    pub fn classer_chemins(&self, chemins: &[String], autorise: &dyn Fn(&str) -> bool) -> flux::Classement {
        let (index, surveilles) = {
            let e = verrou(&self.p.etat);
            (e.index.clone(), e.config.dossiers_surveilles.clone())
        };
        flux::classer(chemins, &flux::Perimetre { index: &index, surveilles: &surveilles, racine: &self.p.emp.racine, autorise })
    }

    /// Import de fichiers externes déposés (copie atomique, sans doublon) dans le dossier des médias ; la surveillance
    /// les découvre ensuite (« en cours » pendant la copie, puis « disponible »). Long : à appeler hors du fil principal.
    pub fn importer_fichiers(&self, lot: &str, chemins: &[String], autorise: &dyn Fn(&str) -> bool, annule: &AtomicBool, progression: &mut dyn FnMut(&flux::Progression)) -> flux::Bilan {
        let (index, config) = {
            let e = verrou(&self.p.etat);
            (e.index.clone(), e.config.clone())
        };
        let dossier = PathBuf::from(&config.dossier_medias);
        let cible = flux::Cible {
            dossier: &dossier,
            espace_libre: self.p.plateforme.espace_libre(&dossier),
            perimetre: flux::Perimetre { index: &index, surveilles: &config.dossiers_surveilles, racine: &self.p.emp.racine, autorise },
            pas_progression: flux::PAS_PROGRESSION,
        };
        let b = flux::importer(lot, chemins, &cible, annule, progression);
        journal::info(
            "flux",
            &format!("Import de fichiers déposés : {} importé(s), {} déjà là, {} refusé(s), {} en échec, {} annulé(s) ; {} octets copiés.", b.importes, b.deja_la, b.refuses, b.echecs, b.annules, b.octets),
        );
        for f in &b.fichiers {
            if let flux::Issue::Refuse { raison } | flux::Issue::Echec { raison } = &f.issue {
                journal::info("flux", &format!("« {} » : {raison}", f.nom));
            }
        }
        if b.importes > 0 {
            self.rescanner();
        }
        b
    }

    /// Note dans `config.json` la version du panneau installé (ou son retrait : `None`).
    pub fn marquer_panneau(&self, version: Option<String>) {
        let mut e = verrou(&self.p.etat);
        e.config.premiere.installe_le = version.as_ref().map(|_| horloge::iso(horloge::maintenant()));
        e.config.premiere.ccx_installe = version;
        let _ = config::enregistrer(&self.p.emp, &e.config);
        drop(e);
        self.p.notifieur.changement("config");
    }

    pub fn a_analyser(&self, max: usize) -> Vec<AAnalyser> {
        let e = verrou(&self.p.etat);
        bibliotheque::a_analyser(&e.index, &e.suivi, max)
    }

    /// Résultat d'une analyse du WebView2 : miniature JPEG (480 px de large au plus) et mesures.
    pub fn enregistrer_analyse(&self, id: &str, a: &AnalyseWeb, jpeg: Option<&[u8]>) -> Result<(), String> {
        if !noms::est_id_valide(id) {
            return Err("Identifiant invalide.".into());
        }
        let mut a = a.clone();
        if let Some(j) = jpeg {
            if !j.starts_with(&[0xFF, 0xD8, 0xFF]) || j.len() > 4 * 1024 * 1024 {
                return Err("Miniature refusée (JPEG attendu, 4 Mo au plus).".into());
            }
            atomique::ecrire(&self.p.emp.miniature(id), j).map_err(|err| format!("Miniature non écrite ({}).", err.kind()))?;
            a.miniature = true;
        } else {
            a.miniature = false;
        }
        let mut e = verrou(&self.p.etat);
        let Etat { index, suivi, .. } = &mut *e;
        if !bibliotheque::appliquer_analyse(index, suivi, id, &a) {
            return Ok(());
        }
        let _ = atomique::ecrire_json(&self.p.emp.index_json(), &e.index, false);
        let _ = atomique::ecrire_json(&self.p.emp.suivi_json(), &e.suivi, false);
        drop(e);
        self.p.notifieur.changement("bibliotheque");
        Ok(())
    }

    fn chemin_verifie(&self, id: &str) -> Result<PathBuf, String> {
        let e = verrou(&self.p.etat);
        let m = e.index.media(id).ok_or("Média inconnu de la bibliothèque.")?;
        if !e.config.dossiers_surveilles.iter().any(|d| noms::est_dans(&m.chemin, d)) {
            return Err("Ce fichier n'est plus dans un dossier surveillé.".into());
        }
        let p = PathBuf::from(&m.chemin);
        if !p.exists() {
            return Err("Fichier introuvable : déplacé, renommé ou supprimé.".into());
        }
        Ok(p)
    }

    /// `ouvrir` (application associée) ou `explorateur` (Explorateur sur le fichier), par identifiant seulement.
    pub fn action_media(&self, id: &str, action: &str) -> Result<(), String> {
        let p = self.chemin_verifie(id)?;
        match action {
            "ouvrir" => self.p.plateforme.ouvrir(&p),
            "explorateur" => self.p.plateforme.afficher_dans_explorateur(&p),
            _ => Err("Action inconnue.".into()),
        }
    }

    /// Copie des fichiers choisis par l'utilisateur dans le dossier des médias (noms nettoyés, jamais d'écrasement).
    pub fn ajouter_fichiers(&self, chemins: &[String]) -> Result<Vec<String>, String> {
        let dossier = PathBuf::from(self.config().dossier_medias);
        std::fs::create_dir_all(&dossier).map_err(|e| format!("Dossier des médias indisponible ({}).", e.kind()))?;
        let mut copies = Vec::new();
        for c in chemins {
            let src = PathBuf::from(c);
            let nom = src.file_name().map(|n| n.to_string_lossy().into_owned()).ok_or("Nom de fichier invalide.")?;
            let ext = nom.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_default();
            if bibliotheque::type_par_extension(&ext).is_none() {
                return Err(format!("« {nom} » n'est pas un média pris en charge (vidéo, audio ou image)."));
            }
            let propre = noms::nettoyer_nom_fichier(&nom);
            let (souche, ext_p) = propre.rsplit_once('.').map(|(a, b)| (a.to_string(), format!(".{b}"))).unwrap_or((propre.clone(), String::new()));
            let mut cible = dossier.join(&propre);
            let mut n = 2;
            while cible.exists() {
                cible = dossier.join(format!("{souche} ({n}){ext_p}"));
                n += 1;
            }
            if cible.to_string_lossy().chars().count() > noms::CHEMIN_MAX {
                return Err(format!("Chemin trop long pour Windows : « {nom} ». Renommez le fichier ou choisissez un dossier plus court."));
            }
            std::fs::copy(&src, &cible).map_err(|e| format!("Copie de « {nom} » impossible ({}).", e.kind()))?;
            copies.push(cible.to_string_lossy().into_owned());
        }
        journal::info("bibliotheque", &format!("{} fichier(s) ajouté(s) au dossier des médias", copies.len()));
        self.rescanner();
        Ok(copies)
    }

    pub fn effacer_transferts_termines(&self) -> usize {
        let n = transferts::effacer_termines(&self.p.emp.transferts());
        self.lire_transferts();
        n
    }

    /// Rapport de diagnostic exporté par l'utilisateur (aucun secret : versions, états, réglages, fin du journal).
    pub fn rapport(&self) -> String {
        let i = self.instantane();
        let mut r = String::new();
        r.push_str(&format!("Rapport AETHRYON Desktop {} — {}\n\n", i.version, horloge::iso(horloge::maintenant())));
        r.push_str(&format!("Plateforme : {}\nRacine des échanges : {}\nConfiguration : {}\n", i.plateforme, i.racine, i.dossier_config));
        r.push_str(&format!("Premiere Pro : {}\n", serde_json::to_string(&i.premiere).unwrap_or_default()));
        r.push_str(&format!("Creative Cloud : {}\n", serde_json::to_string(&i.creative_cloud).unwrap_or_default()));
        r.push_str(&format!("Panneau AETHRYON (CEP) : {}\n", serde_json::to_string(&i.panneau_cep).unwrap_or_default()));
        r.push_str(&format!("Panneau connecté : {} (âge {:?} s)\n", i.liaison.connecte, i.liaison.age));
        r.push_str(&format!("Native Messaging : {}\n", serde_json::to_string(&i.native_messaging).unwrap_or_default()));
        r.push_str(&format!("Démarrage automatique : {}\n", i.demarrage_actif));
        r.push_str(&format!("Réglages : {}\n", serde_json::to_string(&i.config).unwrap_or_default()));
        r.push_str(&format!("Bibliothèque : {} média(s) ; dossiers en erreur : {:?}\n", i.index.medias.len(), i.erreurs_dossiers));
        r.push_str(&format!("Transferts : {}\n\n--- Journal (200 dernières lignes) ---\n", i.transferts.len()));
        for l in journal::dernieres_lignes(&self.p.emp.journaux(), 200) {
            r.push_str(&l);
            r.push('\n');
        }
        journal::masquer(&r)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plateforme::factice::Factice;
    use std::sync::Mutex as M;

    #[derive(Default)]
    struct Temoin {
        avis: M<Vec<String>>,
    }
    struct N(Arc<Temoin>);
    impl Notifieur for N {
        fn changement(&self, q: &str) {
            self.0.avis.lock().unwrap().push(format!("changement:{q}"));
        }
        fn media_pret(&self, m: &Media) {
            self.0.avis.lock().unwrap().push(format!("pret:{}", m.nom));
        }
        fn resultat_commande(&self, r: &ResultatEnvoi) {
            self.0.avis.lock().unwrap().push(format!("resultat:{}:{}", r.action, r.ok));
            if r.expire {
                self.0.avis.lock().unwrap().push(format!("expire:{}", r.nom));
            }
        }
        fn naviguer(&self, s: &str) {
            self.0.avis.lock().unwrap().push(format!("naviguer:{s}"));
        }
    }

    fn attendre(mut f: impl FnMut() -> bool, secondes: u64) -> bool {
        let t = Instant::now();
        while t.elapsed() < Duration::from_secs(secondes) {
            if f() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        false
    }

    #[test]
    fn service_de_bout_en_bout() {
        let d = tempfile::tempdir().unwrap();
        let emp = Emplacements::sous(d.path());
        let medias = d.path().join("Téléchargements").join("AETHRYON");
        std::fs::create_dir_all(&medias).unwrap();
        config::enregistrer(&emp, &Config::defaut(&medias.to_string_lossy())).unwrap();
        let temoin = Arc::new(Temoin::default());
        let s = Service::demarrer(emp.clone(), Box::new(Factice::default()), Box::new(N(temoin.clone())), d.path().join("a.exe"));

        // Battement du Desktop écrit.
        assert!(attendre(|| battements::lire_desktop(&emp).ok().is_some(), 5));
        // Un fichier arrive : en-cours puis disponible, avec la notification « média prêt ».
        let f = medias.join("Coucher de soleil — vertical.mp4");
        std::fs::write(&f, crate::mesure::essais::mp4(12, 720, 1280, 30, false)).unwrap();
        assert!(attendre(|| s.instantane().index.medias.iter().any(|m| m.etat == EtatMedia::Disponible), 15), "{:?}", s.instantane().index);
        assert!(temoin.avis.lock().unwrap().iter().any(|a| a == "pret:Coucher de soleil — vertical"));
        let i: Index = atomique::lire_json(&emp.index_json()).ok().unwrap();
        assert_eq!(i.medias[0].hauteur, Some(1280));
        let id = i.medias[0].id.clone();

        // Commande du panneau : afficher dans l'Explorateur (par id), refus d'une action hors liste.
        let t = horloge::maintenant();
        for (n, action, args) in [("c1", "afficher-dans-explorateur", serde_json::json!({"id": id})), ("c2", "supprimer", serde_json::json!({})), ("c3", "ouvrir-desktop", serde_json::json!({"section": "bibliotheque"}))] {
            let c = commandes::Commande { schema: 1, id: n.into(), de: "panneau".into(), pour: "desktop".into(), action: action.into(), args, cree_le: horloge::iso(t), resultat: None };
            atomique::ecrire_json(&emp.a_traiter().join(commandes::nom_fichier(t, n)), &c, false).unwrap();
        }
        assert!(attendre(|| commandes::resultat(&emp, &commandes::nom_fichier(t, "c3")).is_some(), 5));
        assert!(commandes::resultat(&emp, &commandes::nom_fichier(t, "c1")).unwrap().resultat.unwrap().ok);
        assert!(!commandes::resultat(&emp, &commandes::nom_fichier(t, "c2")).unwrap().resultat.unwrap().ok);
        assert!(temoin.avis.lock().unwrap().iter().any(|a| a == "naviguer:bibliotheque"));

        // Import demandé au panneau ; le panneau répond ; le résultat remonte.
        let nom = s.importer(&[id.clone()], None).unwrap();
        assert!(s.importer(&["0".repeat(40)], None).is_err());
        let mut c: commandes::Commande = atomique::lire_json(&emp.a_traiter().join(&nom)).ok().unwrap();
        assert_eq!(c.args["chutier"], "aethryon");
        c.resultat = Some(commandes::Resultat { ok: true, message: "1 média importé dans AETHRYON".into(), le: horloge::iso(t) });
        atomique::ecrire_json(&emp.traitees().join(&nom), &c, false).unwrap();
        std::fs::remove_file(emp.a_traiter().join(&nom)).unwrap();
        assert!(attendre(|| temoin.avis.lock().unwrap().iter().any(|a| a == "resultat:importer:true"), 5));

        // Battement du panneau : connecté.
        let b = BattementPanneau { schema: 1, version: Some("1.0.0-beta.1".into()), battement: horloge::iso_ms(horloge::maintenant()), premiere_version: Some("26.5.2".into()), projet_ouvert: Some(true), projet: Some("Montage-voyage".into()), visible: Some(true) };
        atomique::ecrire_json(&emp.battement_panneau(), &b, false).unwrap();
        assert!(attendre(|| s.instantane().liaison.connecte, 5));

        // Analyse du WebView2 : miniature enregistrée.
        s.enregistrer_analyse(&id, &AnalyseWeb::default(), Some(&[0xFF, 0xD8, 0xFF, 0xE0, 1, 2])).unwrap();
        assert!(emp.miniature(&id).is_file());
        assert!(s.enregistrer_analyse(&id, &AnalyseWeb::default(), Some(b"<svg>")).is_err());

        // Réglages : clé inconnue refusée, thème accepté.
        assert!(s.modifier_config(&serde_json::json!({"theme": "clair"})).is_ok());
        assert!(s.modifier_config(&serde_json::json!({"x": 1})).is_err());
        assert!(s.ajouter_dossier("C:\\Windows").is_err());
        assert!(s.retirer_dossier(&medias.to_string_lossy()).is_err());

        // Ajout de fichiers : nom nettoyé, jamais d'écrasement.
        // Windows interdit « : » et « ? » dans un nom : la source y porte des espaces superflus à nettoyer.
        let src = d.path().join(if cfg!(windows) { "Clip   nuit .mp4" } else { "Clip: nuit?.mp4" });
        std::fs::write(&src, b"x").unwrap();
        let a = s.ajouter_fichiers(&[src.to_string_lossy().into_owned(), src.to_string_lossy().into_owned()]).unwrap();
        assert!(a[0].ends_with("Clip nuit.mp4"), "{a:?}");
        assert!(a[1].contains("(2)"));
        assert!(s.ajouter_fichiers(&[d.path().join("x.exe").to_string_lossy().into_owned()]).is_err());
        assert!(s.rapport().contains("AETHRYON Desktop"));
        s.arreter();
    }

    fn battre(emp: &Emplacements, il_y_a_s: i64) {
        let t = horloge::maintenant() - chrono::Duration::seconds(il_y_a_s);
        let b = BattementPanneau { schema: 1, version: Some("1.0.0-beta.2".into()), battement: horloge::iso_ms(t), premiere_version: Some("26.5.2".into()), projet_ouvert: Some(true), projet: Some("Montage-voyage".into()), visible: Some(false) };
        atomique::ecrire_json(&emp.battement_panneau(), &b, false).unwrap();
    }

    #[test]
    fn flux_de_bout_en_bout() {
        let d = tempfile::tempdir().unwrap();
        let emp = Emplacements::sous(d.path());
        let medias = d.path().join("Téléchargements").join("AETHRYON");
        let externe = d.path().join("Bureau");
        std::fs::create_dir_all(&medias).unwrap();
        std::fs::create_dir_all(&externe).unwrap();
        config::enregistrer(&emp, &Config::defaut(&medias.to_string_lossy())).unwrap();
        let temoin = Arc::new(Temoin::default());
        let s = Service::demarrer(emp.clone(), Box::new(Factice::default()), Box::new(N(temoin.clone())), d.path().join("a.exe"));
        std::fs::write(medias.join("Plage.mp4"), crate::mesure::essais::mp4(4, 1280, 720, 30, false)).unwrap();
        assert!(attendre(|| s.instantane().index.medias.iter().any(|m| m.etat == EtatMedia::Disponible), 15));
        let id = s.instantane().index.medias[0].id.clone();

        // Glisser vers l'extérieur : seulement des identifiants d'index, résolus et validés par le cœur.
        let g = s.chemins_pour_glisser(&[id.clone(), id.clone()]).unwrap();
        assert_eq!(g.len(), 1, "doublon retiré");
        assert_eq!(g[0].1, medias.join("Plage.mp4"));
        assert!(s.chemins_pour_glisser(&[]).is_err());
        assert!(s.chemins_pour_glisser(&["C:\\Windows\\notepad.exe".into()]).is_err());
        assert!(s.chemins_pour_glisser(&["0".repeat(40)]).is_err());

        // Envoyer vers Premiere : panneau absent, puis battement trop vieux → RIEN n'est déposé.
        let rien = || std::fs::read_dir(emp.a_traiter()).unwrap().count();
        assert!(matches!(s.envoyer_vers_premiere(&[id.clone()], None).unwrap(), Envoi::NonConnecte { age: None, .. }));
        battre(&emp, 20);
        match s.envoyer_vers_premiere(&[id.clone()], None).unwrap() {
            Envoi::NonConnecte { message, age } => assert!(message.contains("depuis 20 s") && age.unwrap() >= 20.0, "{message}"),
            x => panic!("{x:?}"),
        }
        assert_eq!(rien(), 0, "aucune commande écrite sans panneau connecté");
        // Panneau caché qui bat toutes les 10 s : 13 s reste « connecté » (seuil 15 s) → commande déposée.
        battre(&emp, 13);
        let Envoi::Envoye { nom } = s.envoyer_vers_premiere(&[id.clone()], Some("selection")).unwrap() else { panic!() };
        let c: commandes::Commande = atomique::lire_json(&emp.a_traiter().join(&nom)).ok().unwrap();
        assert_eq!((c.action.as_str(), c.args["chutier"].as_str()), ("importer", Some("selection")));
        // Le panneau la prend, puis l'expire lui-même (texte de contrat.js) : le résultat remonte comme « expiré ».
        let mut c2 = c.clone();
        c2.resultat = Some(commandes::Resultat { ok: false, message: "commande expirée (plus de 2 minutes sans traitement)".into(), le: horloge::iso(horloge::maintenant()) });
        std::fs::rename(emp.a_traiter().join(&nom), emp.traitees().join(&nom)).unwrap();
        atomique::ecrire_json(&emp.traitees().join(&nom), &c2, false).unwrap();
        assert!(attendre(|| temoin.avis.lock().unwrap().iter().any(|a| *a == format!("expire:{nom}")), 5));
        assert!(!est_expiration(true, "Expirée : x") && est_expiration(false, "Expirée : le panneau…") && !est_expiration(false, "Aucun projet ouvert"));

        // Import de fichiers déposés : copie dans le dossier des médias, découverte « en cours » puis « disponible ».
        let src = externe.join("Rushes — plage.mp4");
        std::fs::write(&src, crate::mesure::essais::mp4(6, 1280, 720, 25, false)).unwrap();
        let src_txt = src.to_string_lossy().into_owned();
        let accorde = |c: &str| noms::normaliser_pour_id(c) == noms::normaliser_pour_id(&src_txt);
        let cl = s.classer_chemins(&[src_txt.clone(), medias.join("Plage.mp4").to_string_lossy().into_owned()], &|_| true);
        assert_eq!((cl.fichiers.len(), cl.medias.len()), (1, 1));
        let mut avis = Vec::new();
        let b = s.importer_fichiers("lot-essai", &[src_txt.clone(), externe.join("autre.mp4").to_string_lossy().into_owned()], &accorde, &AtomicBool::new(false), &mut |p| avis.push(p.etape));
        assert_eq!((b.importes, b.refuses), (1, 1), "{b:?}");
        assert!(matches!(&b.fichiers[1].issue, flux::Issue::Refuse { raison } if raison == flux::RAISON_HORS_PERIMETRE));
        let flux::Issue::Importe { id: nouveau, chemin, .. } = &b.fichiers[0].issue else { panic!() };
        assert!(src.exists(), "copie, jamais déplacement");
        assert_eq!(std::path::Path::new(chemin).parent().unwrap(), medias.as_path());
        assert!(avis.contains(&"termine"));
        assert!(attendre(|| s.instantane().index.media(nouveau).map(|m| m.etat == EtatMedia::Disponible).unwrap_or(false), 15), "{:?}", s.instantane().index);
        // Redéposé : déjà là, rien de copié.
        let b = s.importer_fichiers("lot-essai-2", &[src_txt.clone()], &accorde, &AtomicBool::new(false), &mut |_| {});
        assert!(matches!(&b.fichiers[0].issue, flux::Issue::DejaLa { id: Some(i), .. } if i == nouveau), "{b:?}");
        s.arreter();
    }

    /// 3.8.1 (contrat §12, proposé) : « Envoyer vers › Premiere Pro » de l'extension → hôte NM (`envoyer-premiere`, liste
    /// fermée, aucun jeton) → commande `convertir-pour-premiere` → le Desktop convertit avec SA clé (faux ytapi local),
    /// enregistre `<nom>.part` puis un nom unique, la bibliothèque l'indexe, commande `importer` pour le panneau, résultat
    /// réel rendu par `etat-envoi`. Desktop non relié : refus clair, rien n'est demandé au serveur.
    #[test]
    fn envoi_premiere_commande_preparer_puis_importer() {
        use crate::essais_http::{Reponse, Serveur};
        use std::io::Cursor;
        let video = crate::mesure::essais::mp4(4, 640, 360, 30, false);
        let (taille, octets) = (video.len() as u64, video.clone());
        let suivis = Arc::new(AtomicUsize::new(0));
        let n = suivis.clone();
        let srv = Serveur::demarrer(move |r| {
            let hote = r.entete("host").unwrap_or("").to_string();
            match (r.methode.as_str(), r.chemin()) {
                ("POST", "/media/jobs") => Reponse::Json(202, serde_json::json!({ "job_id": "job_abc123", "status": "queued" })),
                ("GET", "/media/jobs/job_abc123") if n.fetch_add(1, Ordering::SeqCst) == 0 => Reponse::Json(200, serde_json::json!({ "job_id": "job_abc123", "status": "running", "progress": 40.0 })),
                ("GET", "/media/jobs/job_abc123") => Reponse::Json(200, serde_json::json!({
                    "job_id": "job_abc123", "status": "done", "title": "Coucher de soleil", "filename": "Coucher de soleil [abc].mp4", "size_bytes": taille,
                    "file_url": format!("https://{hote}/media/jobs/job_abc123/file/Coucher%20de%20soleil%20%5Babc%5D.mp4"),
                })),
                ("GET", c) if c.starts_with("/media/jobs/job_abc123/file/") => Reponse::Octets(200, octets.clone(), "video/mp4"),
                _ => Reponse::Json(404, serde_json::json!({ "error": "not_found", "detail": "Introuvable." })),
            }
        });
        let d = tempfile::tempdir().unwrap();
        let emp = Emplacements::sous(d.path());
        let medias = d.path().join("Téléchargements").join("AETHRYON");
        std::fs::create_dir_all(&medias).unwrap();
        std::fs::write(medias.join("Coucher de soleil [abc].mp4"), b"ancien fichier, jamais \xc3\xa9cras\xc3\xa9").unwrap();
        config::enregistrer(&emp, &Config::defaut(&medias.to_string_lossy())).unwrap();
        let s = Service::demarrer(emp.clone(), Box::new(Factice::default()), Box::new(N(Arc::new(Temoin::default()))), d.path().join("a.exe"));
        let cle: Arc<M<Option<String>>> = Arc::new(M::new(Some("ytc_cle_du_desktop_relie".into())));
        let c2 = cle.clone();
        s.installer_conversion(Moteur { api: conversion::Api::essai(&format!("{}/media", srv.base), srv.autorite.clone()), cle: Box::new(move || c2.lock().unwrap().clone()) });
        // Panneau AETHRYON ouvert dans Premiere (battement frais tout au long de l'essai).
        let fin = Arc::new(AtomicBool::new(false));
        let (f2, e2) = (fin.clone(), emp.clone());
        std::thread::spawn(move || {
            while !f2.load(Ordering::SeqCst) {
                let b = BattementPanneau { schema: 1, version: Some("1.0.0".into()), battement: horloge::iso_ms(horloge::maintenant()), premiere_version: Some("26.5.2".into()), projet_ouvert: Some(true), projet: Some("Montage".into()), visible: Some(true) };
                let _ = atomique::ecrire_json(&e2.battement_panneau(), &b, false);
                std::thread::sleep(Duration::from_millis(300));
            }
        });
        assert!(attendre(|| battements::lire_desktop(&emp).ok().is_some(), 5), "battement du Desktop");

        // 1. Hôte NM : liste fermée (un jeton fait refuser le message sans être répété), puis l'envoi accepté.
        let trame = |v: serde_json::Value| { let mut o = Vec::new(); crate::nm::ecrire_message(&mut o, &v).unwrap(); o };
        let mut entree = trame(serde_json::json!({ "type": "envoyer-premiere", "id": "Ab3dEf6hIj9kLm2n", "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "jeton": "SECRET-NE-PAS-ECRIRE" }));
        entree.extend(trame(serde_json::json!({ "type": "envoyer-premiere", "id": "Ab3dEf6hIj9kLm2n", "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "titre": "Coucher de soleil" })));
        let lances = AtomicUsize::new(0);
        let lancer = || {
            lances.fetch_add(1, Ordering::SeqCst);
            Ok::<(), String>(())
        };
        let mut sortie = Vec::new();
        crate::nm::executer_avec(&mut Cursor::new(entree), &mut sortie, &crate::nm::Contexte { emplacements: &emp, source: &crate::maj_extension::Source::production() }, &lancer).unwrap();
        let mut c = Cursor::new(sortie);
        let r1: serde_json::Value = serde_json::from_slice(&crate::nm::lire_message(&mut c).unwrap().unwrap()).unwrap();
        let r2: serde_json::Value = serde_json::from_slice(&crate::nm::lire_message(&mut c).unwrap().unwrap()).unwrap();
        assert_eq!(r1["ok"], false);
        assert!(!r1.to_string().contains("SECRET"));
        assert_eq!((r2["ok"].clone(), r2["etat"].clone(), r2["desktop"].clone()), (serde_json::json!(true), serde_json::json!("envoye"), serde_json::json!(true)), "{r2}");
        assert_eq!(lances.load(Ordering::SeqCst), 0, "Desktop en marche : rien à lancer");

        // 2. Le Desktop prend la commande, convertit avec SA clé : MP4 H.264 pour Premiere (1080p, transcode).
        let id_tr = "Ab3dEf6hIj9kLm2n";
        let etat = |id: &str| crate::nm::etat_envoi(serde_json::json!({ "type": "etat-envoi", "id": id }).as_object().unwrap(), &emp, true);
        assert!(attendre(|| s.lire_transfert(id_tr).is_some_and(|t| t.etat == "pret"), 40), "{:?}", s.lire_transfert(id_tr));
        let post = srv.vues("POST", "/media/jobs");
        assert_eq!(post.len(), 1);
        assert_eq!(post[0].entete("authorization"), Some("Bearer ytc_cle_du_desktop_relie"));
        assert_eq!(post[0].json(), serde_json::json!({ "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "fmt": "mp4", "quality": "1080", "transcode": true }));
        assert!(srv.vues("GET", "/media/jobs/job_abc123/file/").iter().all(|r| r.entete("authorization") == Some("Bearer ytc_cle_du_desktop_relie")));
        // Nom unique : l'ancien fichier du même nom n'est jamais écrasé ; aucun .part ne reste.
        let final_ = medias.join("Coucher de soleil [abc] (2).mp4");
        assert_eq!(std::fs::read(&final_).unwrap(), video);
        assert_eq!(std::fs::read(medias.join("Coucher de soleil [abc].mp4")).unwrap(), "ancien fichier, jamais écrasé".as_bytes());
        assert!(!std::fs::read_dir(&medias).unwrap().any(|e| e.unwrap().file_name().to_string_lossy().ends_with(".part")));
        let id_media = noms::id_media(&final_.to_string_lossy());
        assert!(s.instantane().index.media(&id_media).is_some_and(|m| m.etat == EtatMedia::Disponible), "indexé par la bibliothèque");

        // 3. Commande `importer` déposée pour le panneau (chutier par défaut « aethryon ») ; le panneau répond.
        let mut nom_cmd = None;
        assert!(attendre(|| {
            nom_cmd = std::fs::read_dir(emp.a_traiter()).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned())
                .find(|n| atomique::lire_json::<commandes::Commande>(&emp.a_traiter().join(n)).ok().is_some_and(|c| c.action == "importer"));
            nom_cmd.is_some()
        }, 20), "commande importer");
        let nom_cmd = nom_cmd.unwrap();
        assert_eq!(etat(id_tr)["etat"], "import");
        let mut cmd: commandes::Commande = atomique::lire_json(&emp.a_traiter().join(&nom_cmd)).ok().unwrap();
        assert_eq!((cmd.de.as_str(), cmd.pour.as_str()), ("desktop", "panneau"));
        assert_eq!(cmd.args, serde_json::json!({ "ids": [id_media], "chutier": "aethryon" }));
        cmd.resultat = Some(commandes::Resultat { ok: true, message: "1 importé dans « AETHRYON » (Montage)".into(), le: horloge::iso(horloge::maintenant()) });
        atomique::ecrire_json(&emp.traitees().join(&nom_cmd), &cmd, false).unwrap();
        std::fs::remove_file(emp.a_traiter().join(&nom_cmd)).unwrap();
        assert!(attendre(|| etat(id_tr)["etat"] == "importe", 10), "{}", etat(id_tr));
        let t = s.lire_transfert(id_tr).unwrap();
        assert_eq!((t.origine.as_deref(), t.premiere.as_deref(), t.titre.as_deref()), (Some("extension"), Some("importe"), Some("Coucher de soleil")));
        let commande_conv = std::fs::read_dir(emp.traitees()).unwrap().flatten().map(|e| std::fs::read_to_string(e.path()).unwrap()).find(|c| c.contains("convertir-pour-premiere")).unwrap();
        assert!(!commande_conv.contains("ytc_") && commande_conv.contains("\"ok\": true"), "la commande ne porte jamais la clé");

        // 4. Desktop plus relié : refus clair, l'extension l'apprend (« non-relie »), aucune requête au serveur.
        *cle.lock().unwrap() = None;
        let d2 = Demande { id: "Zz9yXw8vUt7sRq6p".into(), url: "https://youtu.be/dQw4w9WgXcQ".into(), format: "mp3".into(), extrait: None, titre: None, origine: "extension".into(), premiere: true };
        assert_eq!(s.convertir(d2).unwrap_err(), conversion::TEXTE_NON_RELIE);
        assert_eq!(etat("Zz9yXw8vUt7sRq6p")["etat"], "non-relie");
        assert_eq!(srv.vues("POST", "/media/jobs").len(), 1);

        // 5. Desktop arrêté (aucun battement) : l'hôte dépose la commande et lance le Desktop, une fois.
        let d3 = tempfile::tempdir().unwrap();
        let emp3 = Emplacements::sous(d3.path());
        let mut sortie = Vec::new();
        let m = trame(serde_json::json!({ "type": "envoyer-premiere", "id": "Cc1", "url": "https://www.tiktok.com/@a/video/7123456789012345678", "format": "mp3", "debut": 1.5, "fin": 9.25 }));
        crate::nm::executer_avec(&mut Cursor::new(m), &mut sortie, &crate::nm::Contexte { emplacements: &emp3, source: &crate::maj_extension::Source::production() }, &lancer).unwrap();
        assert_eq!(lances.load(Ordering::SeqCst), 1);
        let c3: commandes::Commande = std::fs::read_dir(emp3.a_traiter()).unwrap().flatten().find_map(|e| atomique::lire_json(&e.path()).ok()).unwrap();
        assert_eq!((c3.action.as_str(), c3.de.as_str()), ("convertir-pour-premiere", "navigateur"));
        assert_eq!(c3.args, serde_json::json!({ "transfert": "Cc1", "url": "https://www.tiktok.com/@a/video/7123456789012345678", "format": "mp3", "debutMs": 1500, "finMs": 9250 }));
        fin.store(true, Ordering::SeqCst);
        s.arreter();
    }

    /// Nocturne : une conversion de CE Desktop se pilote depuis Transferts (pause pendant la réception, reprise,
    /// annulation) ; le transfert porte les octets reçus et la pause ; un transfert inconnu est refusé clairement.
    #[test]
    fn transfert_pilote_pause_reprise_annulation() {
        use crate::essais_http::{Reponse, Serveur};
        let octets: Vec<u8> = (0..(900 * 1024u32)).map(|i| (i % 251) as u8).collect();
        let total = octets.len();
        let srv = Serveur::demarrer(move |r| {
            let hote = r.entete("host").unwrap_or("").to_string();
            match (r.methode.as_str(), r.chemin()) {
                ("POST", "/media/jobs") => Reponse::Json(202, serde_json::json!({ "job_id": "job_srv01", "status": "done", "title": "Essai", "filename": "Essai [s1].mp4",
                    "size_bytes": total, "file_url": format!("https://{hote}/media/jobs/job_srv01/file") })),
                ("GET", "/media/jobs/job_srv01/file") => match r.entete("range").and_then(|v| v.strip_prefix("bytes=")).and_then(|v| v.strip_suffix('-')).and_then(|v| v.parse::<usize>().ok()) {
                    Some(a) => Reponse::LenteAvec { statut: 206, entetes: vec![("Content-Range".into(), format!("bytes {a}-{}/{total}", total - 1))], corps: octets[a..].to_vec(), bloc: 16 * 1024, pause: Duration::from_millis(20) },
                    None => Reponse::Lente(octets.clone(), 16 * 1024, Duration::from_millis(20)),
                },
                _ => Reponse::Json(404, serde_json::json!({ "error": "not_found" })),
            }
        });
        let d = tempfile::tempdir().unwrap();
        let emp = Emplacements::sous(d.path());
        let medias = d.path().join("Medias");
        std::fs::create_dir_all(&medias).unwrap();
        config::enregistrer(&emp, &Config::defaut(&medias.to_string_lossy())).unwrap();
        let s = Service::demarrer(emp.clone(), Box::new(Factice::default()), Box::new(N(Arc::new(Temoin::default()))), d.path().join("a.exe"));
        s.installer_conversion(Moteur { api: conversion::Api::essai(&format!("{}/media", srv.base), srv.autorite.clone()), cle: Box::new(|| Some("ytc_cle".into())) });
        assert!(s.piloter_transfert("inconnu", "pause").unwrap_err().contains("ne se pilote pas"));
        let id = conversion::id_desktop();
        let dem = Demande { id: id.clone(), url: "https://youtu.be/abc".into(), format: "mp4".into(), extrait: None, titre: None, origine: "desktop".into(), premiere: false };
        s.convertir(dem).unwrap();
        assert!(s.instantane().transferts_pilotables.contains(&id));
        assert!(attendre(|| s.lire_transfert(&id).is_some_and(|t| t.etat == "telechargement" && t.recus.unwrap_or(0) > 0), 20));
        s.piloter_transfert(&id, "pause").unwrap();
        assert!(attendre(|| s.lire_transfert(&id).is_some_and(|t| t.pause == Some(true)), 10), "pause écrite dans le transfert");
        let t = s.lire_transfert(&id).unwrap();
        assert_eq!((t.total, t.vitesse), (Some(total as u64), None));
        assert!(t.recus.unwrap() < total as u64);
        s.piloter_transfert(&id, "reprendre").unwrap();
        assert!(attendre(|| s.lire_transfert(&id).is_some_and(|t| t.etat == "pret"), 30), "{:?}", s.lire_transfert(&id));
        let t = s.lire_transfert(&id).unwrap();
        assert_eq!((t.pause, t.recus), (None, Some(total as u64)));
        assert!(!s.instantane().transferts_pilotables.contains(&id), "terminé : plus rien à piloter");
        assert!(srv.vues("GET", "/media/jobs/job_srv01/file").iter().any(|r| r.entete("range").is_some()), "reprise par plage");
        // Annulation à la demande : état d'erreur au code « annule », message dit tel quel, rien dans le dossier.
        let id2 = conversion::id_desktop();
        s.convertir(Demande { id: id2.clone(), url: "https://youtu.be/abd".into(), format: "mp4".into(), extrait: None, titre: None, origine: "desktop".into(), premiere: false }).unwrap();
        assert!(attendre(|| s.lire_transfert(&id2).is_some_and(|t| t.recus.unwrap_or(0) > 0), 20));
        s.piloter_transfert(&id2, "annuler").unwrap();
        assert!(attendre(|| s.lire_transfert(&id2).is_some_and(|t| t.etat == "erreur"), 10));
        let t = s.lire_transfert(&id2).unwrap();
        assert_eq!((t.code.as_deref(), t.erreur.as_deref()), (Some("annule"), Some("Annulé à ta demande.")));
        assert!(!std::fs::read_dir(&medias).unwrap().flatten().any(|e| e.file_name().to_string_lossy().ends_with(".part")));
        s.arreter();
    }
}

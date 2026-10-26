//! Installation, réparation et mise à jour : cinq étapes RÉELLES, chacune faite d'opérations observables, avec une
//! progression mesurée (octets écrits, fichiers vérifiés) et un retour arrière complet en cas d'échec ou d'annulation.
//!
//! 1. Vérification : SHA-256 de la charge, intégrité de l'extension signée, espace disque, dossier des médias
//!    inscriptible (fichier témoin), Premiere et AETHRYON Desktop ouverts ou non.
//! 2. Installation : copie d'AETHRYON Desktop, extraction de l'extension signée (préparation puis bascule),
//!    extension navigateur dans son dossier géré (préparation puis bascule, version précédente gardée), copie de
//!    maintenance du setup.
//! 3. Enregistrement : entrée « Applications installées » (HKCU), raccourci du menu Démarrer, démarrage avec Windows.
//! 4. Configuration : config.json (contrat), desktop.json, inventaire installation.json.
//! 5. Validation : tout est relu (fichiers, empreintes, Manifest signé, registre, préférences) ; PlayerDebugMode
//!    inchangé. Puis nettoyage des sauvegardes et retrait de l'ancienne bêta NSIS.
//!
//! Les fichiers remplacés sont d'abord RENOMMÉS (Windows permet de renommer un exe en cours d'exécution), jamais
//! supprimés avant la validation : le retour arrière les remet en place.

use crate::charge::{sha256_hex, Charge, FichierCharge};
use crate::config_desktop;
use crate::detection::{player_debug_mode, DESKTOP_EXE, PREMIERE_EXE};
use crate::journal::{self, Journal};
use crate::navigateur;
use crate::plateforme::*;
use crate::zxp::{self, PaquetZxp};
use crate::*;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Etat {
    Attente,
    EnCours,
    Termine,
    Echec,
    Annule,
    Ignore,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SousEtape {
    pub libelle: String,
    pub etat: Etat,
    pub detail: Option<String>,
    pub duree_ms: Option<u64>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Etape {
    pub cle: String,
    pub titre: String,
    pub description: String,
    pub etat: Etat,
    pub sous: Vec<SousEtape>,
    /// Progression mesurée de l'étape (octets pour la copie, éléments sinon).
    pub fait: u64,
    pub total: u64,
    pub duree_ms: Option<u64>,
    /// Une ligne écrite par le moteur à la fin de l'étape (ce qui a réellement été fait).
    pub resume: Option<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Resultat {
    pub version: String,
    pub version_desktop: Option<String>,
    pub version_extension: Option<String>,
    pub extension_remplacant: bool,
    pub dossier_medias: String,
    pub dossier_installation: String,
    pub dossier_extension: Option<String>,
    pub exe_desktop: Option<String>,
    pub premiere_ouvert: bool,
    /// Version de la bêta NSIS (« AETHRYON-Desktop ») remplacée par cette installation, s'il y en avait une.
    pub ancienne_beta_remplacee: Option<String>,
    /// Extension navigateur dans le dossier géré (`%LOCALAPPDATA%\AETHRYON\extension`) : version en place et chemin.
    pub version_navigateur: Option<String>,
    pub dossier_navigateur: Option<String>,
    pub avertissements: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Avancement {
    pub operation: String,
    pub etapes: Vec<Etape>,
    pub courante: usize,
    pub termine: bool,
    pub succes: bool,
    pub annule: bool,
    pub erreur: Option<String>,
    /// Ce que le retour arrière a remis en place (ou n'a pas pu remettre).
    pub retour_arriere: Vec<String>,
    pub ecoule_ms: u64,
    pub resultat: Option<Resultat>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Operation {
    Installer,
    Reparer,
    MettreAJour,
}

impl Operation {
    pub fn nom(self) -> &'static str {
        match self {
            Operation::Installer => "installer",
            Operation::Reparer => "reparer",
            Operation::MettreAJour => "mettreAJour",
        }
    }
}

pub struct Demande {
    pub operation: Operation,
    pub options: Options,
    /// AETHRYON-Setup.exe d'origine : sa copie est gardée dans le dossier d'installation (Modifier, Désinstaller).
    pub amorce: Option<PathBuf>,
    pub annuler: Arc<AtomicBool>,
}

// ---- Suivi de la progression ------------------------------------------------------------------------------------

pub(crate) struct Suivi<'a> {
    pub av: Avancement,
    rapport: &'a mut dyn FnMut(&Avancement),
    debut: Instant,
    debut_etape: Instant,
    debut_sous: Instant,
    dernier_envoi: Instant,
    pub journal: Journal,
}

impl<'a> Suivi<'a> {
    pub fn nouveau(operation: &str, etapes: &[(&str, &str, &str)], journal: Journal, rapport: &'a mut dyn FnMut(&Avancement)) -> Self {
        let av = Avancement {
            operation: operation.into(),
            etapes: etapes
                .iter()
                .map(|(c, t, d)| Etape { cle: (*c).into(), titre: (*t).into(), description: (*d).into(), etat: Etat::Attente, sous: vec![], fait: 0, total: 0, duree_ms: None, resume: None })
                .collect(),
            courante: 0,
            termine: false,
            succes: false,
            annule: false,
            erreur: None,
            retour_arriere: vec![],
            ecoule_ms: 0,
            resultat: None,
        };
        let t = Instant::now();
        Suivi { av, rapport, debut: t, debut_etape: t, debut_sous: t, dernier_envoi: t, journal }
    }
    pub fn envoyer(&mut self) {
        self.av.ecoule_ms = self.debut.elapsed().as_millis() as u64;
        self.dernier_envoi = Instant::now();
        (self.rapport)(&self.av);
    }
    pub fn commencer(&mut self, i: usize, total: u64) {
        self.av.courante = i;
        self.av.etapes[i].etat = Etat::EnCours;
        self.av.etapes[i].total = total;
        self.debut_etape = Instant::now();
        self.journal.info(&format!("Étape « {} » : début", self.av.etapes[i].titre));
        self.envoyer();
    }
    pub fn sous(&mut self, libelle: &str) {
        let i = self.av.courante;
        self.av.etapes[i].sous.push(SousEtape { libelle: libelle.into(), etat: Etat::EnCours, detail: None, duree_ms: None });
        self.debut_sous = Instant::now();
        self.envoyer();
    }
    pub fn sous_fin(&mut self, etat: Etat, detail: Option<String>) {
        let i = self.av.courante;
        let d = self.debut_sous.elapsed().as_millis() as u64;
        if let Some(s) = self.av.etapes[i].sous.last_mut() {
            s.etat = etat;
            s.duree_ms = Some(d);
            if let Some(x) = &detail {
                s.detail = Some(x.clone());
            }
            let ligne = format!("  {} : {:?}{}", s.libelle, etat, detail.map(|x| format!(" — {x}")).unwrap_or_default());
            self.journal.info(&ligne);
        }
        self.envoyer();
    }
    pub fn ok(&mut self, detail: impl Into<Option<String>>) {
        self.sous_fin(Etat::Termine, detail.into())
    }
    pub fn ignore(&mut self, libelle: &str, raison: &str) {
        self.sous(libelle);
        self.sous_fin(Etat::Ignore, Some(raison.into()));
    }
    pub fn avance(&mut self, n: u64) {
        let i = self.av.courante;
        self.av.etapes[i].fait = (self.av.etapes[i].fait + n).min(self.av.etapes[i].total.max(self.av.etapes[i].fait + n));
        if self.dernier_envoi.elapsed().as_millis() >= 40 {
            self.envoyer();
        }
    }
    pub fn terminer_avec(&mut self, resume: impl Into<String>) {
        let i = self.av.courante;
        self.av.etapes[i].resume = Some(resume.into());
        self.terminer();
    }
    pub fn terminer(&mut self) {
        let i = self.av.courante;
        self.av.etapes[i].etat = Etat::Termine;
        self.av.etapes[i].fait = self.av.etapes[i].total;
        self.av.etapes[i].duree_ms = Some(self.debut_etape.elapsed().as_millis() as u64);
        self.envoyer();
    }
    pub fn echouer(&mut self, msg: &str, annule: bool) {
        let i = self.av.courante;
        self.av.etapes[i].etat = if annule { Etat::Annule } else { Etat::Echec };
        if let Some(s) = self.av.etapes[i].sous.last_mut() {
            if s.etat == Etat::EnCours {
                s.etat = if annule { Etat::Annule } else { Etat::Echec };
                s.detail = Some(msg.to_string());
            }
        }
        self.av.etapes[i].duree_ms = Some(self.debut_etape.elapsed().as_millis() as u64);
        self.av.erreur = Some(msg.to_string());
        self.av.annule = annule;
        self.journal.erreur(msg);
        self.envoyer();
    }
}

// ---- Retour arrière ---------------------------------------------------------------------------------------------

#[derive(Debug)]
pub(crate) enum Inverse {
    SupprimerFichier(PathBuf),
    SupprimerArbre(PathBuf),
    /// Remet `sauvegarde` à la place de `cible` (fichier ou dossier renommé).
    Restaurer { sauvegarde: PathBuf, cible: PathBuf },
    RestaurerContenu { chemin: PathBuf, avant: Option<Vec<u8>> },
    RestaurerValeur { cle: String, nom: String, avant: Option<Valeur> },
    RestaurerCle { cle: String, avant: Option<Vec<(String, Valeur)>> },
    SupprimerDossierSiVide(PathBuf),
}

pub(crate) fn derouler(env: &Environnement, pile: &mut Vec<Inverse>, journal: &Journal) -> Vec<String> {
    let mut faits = Vec::new();
    while let Some(op) = pile.pop() {
        let (desc, r): (String, Result<(), String>) = match &op {
            Inverse::SupprimerFichier(p) => (format!("retiré {}", p.display()), if env.fs.existe(p) { env.fs.supprimer_fichier(p).map_err(|e| e.to_string()) } else { Ok(()) }),
            Inverse::SupprimerArbre(p) => (format!("retiré {}", p.display()), env.fs.supprimer_arbre(p).map_err(|e| e.to_string())),
            Inverse::Restaurer { sauvegarde, cible } => (
                format!("remis en place {}", cible.display()),
                (|| {
                    if env.fs.existe(cible) {
                        env.fs.supprimer_arbre(cible).map_err(|e| e.to_string())?;
                    }
                    env.fs.renommer(sauvegarde, cible).map_err(|e| e.to_string())
                })(),
            ),
            Inverse::RestaurerContenu { chemin, avant } => (
                format!("rétabli {}", chemin.display()),
                match avant {
                    Some(d) => env.fs.ecrire_tout(chemin, d).map_err(|e| e.to_string()),
                    None => {
                        if env.fs.existe(chemin) {
                            env.fs.supprimer_fichier(chemin).map_err(|e| e.to_string())
                        } else {
                            Ok(())
                        }
                    }
                },
            ),
            Inverse::RestaurerValeur { cle, nom, avant } => (
                format!("rétabli HKCU\\{cle}\\{nom}"),
                match avant {
                    Some(v) => env.registre.ecrire(cle, nom, v).map_err(|e| e.to_string()),
                    None => env.registre.supprimer_valeur(cle, nom).map_err(|e| e.to_string()),
                },
            ),
            Inverse::RestaurerCle { cle, avant } => (
                format!("rétabli HKCU\\{cle}"),
                (|| {
                    env.registre.supprimer_cle(cle).map_err(|e| e.to_string())?;
                    if let Some(vals) = avant {
                        for (n, v) in vals {
                            env.registre.ecrire(cle, n, v).map_err(|e| e.to_string())?;
                        }
                    }
                    Ok(())
                })(),
            ),
            Inverse::SupprimerDossierSiVide(p) => (
                format!("retiré {} (vide)", p.display()),
                match env.fs.lister(p) {
                    Ok(v) if v.is_empty() => env.fs.supprimer_arbre(p).map_err(|e| e.to_string()),
                    _ => Ok(()),
                },
            ),
        };
        match r {
            Ok(()) => {
                journal.info(&format!("Retour arrière : {desc}"));
                faits.push(desc);
            }
            Err(e) => {
                journal.erreur(&format!("Retour arrière impossible : {desc} ({e})"));
                faits.push(format!("ÉCHEC : {desc} ({e})"));
            }
        }
    }
    faits
}

// ---- Outils -----------------------------------------------------------------------------------------------------

pub fn octets_lisibles(n: u64) -> String {
    // Unités binaires, comme l'Explorateur de Windows et l'interface (« 22,1 Mo »).
    if n < 1024 {
        return format!("{n} octets");
    }
    let mut v = n as f64 / 1024.0;
    let mut u = 0;
    let unites = ["Ko", "Mo", "Go", "To"];
    while v >= 1024.0 && u < unites.len() - 1 {
        v /= 1024.0;
        u += 1;
    }
    let s = if v >= 100.0 { format!("{v:.0}") } else { format!("{v:.1}") };
    format!("{} {}", s.replace('.', ","), unites[u])
}

/// Chemin abrégé pour l'affichage : « AppData\\Local\\Programs\\AETHRYON » (comme les maquettes).
pub fn court(env: &Environnement, p: &Path) -> String {
    let t = p.to_string_lossy().replace('/', "\\");
    for (base, nom) in [(&env.emplacements.local, "AppData\\Local"), (&env.emplacements.itinerant, "AppData\\Roaming")] {
        let b = base.to_string_lossy().replace('/', "\\");
        if t.to_lowercase().starts_with(&b.to_lowercase()) {
            return format!("{nom}{}", &t[b.len()..]);
        }
    }
    t
}

fn controle(annuler: &AtomicBool) -> Result<(), String> {
    if annuler.load(Ordering::SeqCst) {
        Err("Installation annulée à votre demande.".into())
    } else {
        Ok(())
    }
}

/// Écrit `cible` via `cible.nouveau`, puis bascule ; l'ancien fichier est renommé dans `sauvegardes`.
fn poser_fichier(env: &Environnement, cible: &Path, d: &[u8], sauvegardes: &Path, pile: &mut Vec<Inverse>, avance: &mut dyn FnMut(u64)) -> Result<(), String> {
    let nom = cible.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let nouveau = cible.with_file_name(format!("{nom}.nouveau"));
    if env.fs.existe(&nouveau) {
        let _ = env.fs.supprimer_arbre(&nouveau);
    }
    pile.push(Inverse::SupprimerFichier(nouveau.clone()));
    env.fs.ecrire(&nouveau, d, avance).map_err(|e| format!("Écriture de {} impossible ({e}).", cible.display()))?;
    pile.pop();
    if env.fs.existe(cible) {
        env.fs.creer_dossiers(sauvegardes).map_err(|e| e.to_string())?;
        let sauvegarde = sauvegardes.join(&nom);
        if env.fs.existe(&sauvegarde) {
            let _ = env.fs.supprimer_arbre(&sauvegarde);
        }
        env.fs.renommer(cible, &sauvegarde).map_err(|e| format!("{} est verrouillé ({e}). Fermez AETHRYON et réessayez.", cible.display()))?;
        pile.push(Inverse::Restaurer { sauvegarde, cible: cible.to_path_buf() });
    }
    pile.push(Inverse::SupprimerFichier(cible.to_path_buf()));
    if let Err(e) = env.fs.renommer(&nouveau, cible) {
        let _ = env.fs.supprimer_fichier(&nouveau);
        return Err(format!("Mise en place de {} impossible ({e}).", cible.display()));
    }
    Ok(())
}

/// Écriture atomique d'un petit fichier (préférences) avec mémorisation du contenu précédent.
fn ecrire_preferences(env: &Environnement, p: &Path, d: &[u8], pile: &mut Vec<Inverse>) -> Result<(), String> {
    let avant = env.fs.lire(p).ok();
    if let Some(parent) = p.parent() {
        if !env.fs.existe(parent) {
            env.fs.creer_dossiers(parent).map_err(|e| e.to_string())?;
            pile.push(Inverse::SupprimerDossierSiVide(parent.to_path_buf()));
        }
    }
    pile.push(Inverse::RestaurerContenu { chemin: p.to_path_buf(), avant });
    let tmp = p.with_file_name(format!("{}.{}.tmp", p.file_name().unwrap_or_default().to_string_lossy(), std::process::id()));
    env.fs.ecrire_tout(&tmp, d).map_err(|e| format!("Écriture de {} impossible ({e}).", p.display()))?;
    env.fs.renommer(&tmp, p).map_err(|e| {
        let _ = env.fs.supprimer_fichier(&tmp);
        format!("Écriture de {} impossible ({e}).", p.display())
    })
}

pub fn valeurs_desinstallation(dossier: &Path, version: &str, desktop: bool, taille_ko: u32) -> Vec<(&'static str, Valeur)> {
    let setup = dossier.join(NOM_SETUP);
    let icone = if desktop { dossier.join(DESKTOP_EXE) } else { setup.clone() };
    let s = |x: String| Valeur::Chaine(x);
    vec![
        ("DisplayName", s(PRODUIT.into())),
        ("DisplayVersion", s(version.into())),
        ("Publisher", s(EDITEUR.into())),
        ("DisplayIcon", s(format!("\"{}\",0", icone.display()))),
        ("InstallLocation", s(dossier.display().to_string())),
        ("UninstallString", s(format!("\"{}\" --desinstaller", setup.display()))),
        ("QuietUninstallString", s(format!("\"{}\" --desinstaller --silencieux", setup.display()))),
        ("ModifyPath", s(format!("\"{}\" --maintenance", setup.display()))),
        ("Comments", s(if desktop { "Extension AETHRYON pour Premiere Pro et AETHRYON Desktop".into() } else { "Extension AETHRYON pour Premiere Pro".into() })),
        ("InstallDate", s(journal::date_compacte())),
        ("EstimatedSize", Valeur::Dword(taille_ko)),
        ("NoModify", Valeur::Dword(0)),
        ("NoRepair", Valeur::Dword(1)),
        ("Language", Valeur::Dword(0x040C)),
    ]
}

pub(crate) fn commande_run(exe: &Path) -> String {
    format!("\"{}\" --arriere-plan", exe.display())
}

const ETAPES: [(&str, &str, &str); 5] = [
    ("verification", "Vérification", "Empreintes de la charge, extension signée, espace disque, dossier des médias."),
    ("installation", "Installation", "AETHRYON Desktop, extension Premiere Pro, extension navigateur, copie de maintenance."),
    ("enregistrement", "Enregistrement des composants", "Applications installées, menu Démarrer, démarrage avec Windows."),
    ("configuration", "Configuration", "Dossier des médias et préférences."),
    ("validation", "Validation", "Fichiers, signature, registre et préférences relus."),
];

// ---- Exécution --------------------------------------------------------------------------------------------------

pub fn executer(env: &Environnement, charge: &Charge, d: &Demande, journal: &Journal, rapport: &mut dyn FnMut(&Avancement)) -> Avancement {
    let mut s = Suivi::nouveau(d.operation.nom(), &ETAPES, journal.clone(), rapport);
    journal.info(&format!(
        "=== AETHRYON Setup {} : {} (Desktop : {}, extension : {}, médias : {})",
        charge.manifeste.version,
        d.operation.nom(),
        d.options.desktop,
        d.options.extension,
        d.options.dossier_medias
    ));
    s.envoyer();
    let mut pile: Vec<Inverse> = Vec::new();
    match deroulement(env, charge, d, &mut s, &mut pile) {
        Ok(res) => {
            s.av.termine = true;
            s.av.succes = true;
            s.av.resultat = Some(res);
            journal.info("=== Terminé avec succès");
            s.envoyer();
        }
        Err(e) => {
            let annule = d.annuler.load(Ordering::SeqCst);
            s.echouer(&e, annule);
            journal.avert("Retour arrière : début");
            s.av.retour_arriere = derouler(env, &mut pile, journal);
            s.av.termine = true;
            s.av.succes = false;
            journal.avert("=== Échec : tout ce qui avait été posé a été retiré ou remis en place");
            s.envoyer();
        }
    }
    s.av
}

fn deroulement(env: &Environnement, charge: &Charge, d: &Demande, s: &mut Suivi, pile: &mut Vec<Inverse>) -> Result<Resultat, String> {
    let o = &d.options;
    if !o.extension && !o.desktop {
        return Err("Aucun composant choisi.".into());
    }
    let desktop = o.desktop && charge.manifeste.desktop.is_some();
    let dossier = dossier_installation(env);
    let pid = std::process::id();
    let sauvegardes = dossier.join(format!(".retour-arriere-{pid}"));
    let cep_parent = env.emplacements.dossier_extensions_cep().parent().map(Path::to_path_buf).unwrap_or_default();
    let preparation = cep_parent.join(format!("AETHRYON-preparation-{pid}"));
    let sauvegarde_ext = cep_parent.join(format!("AETHRYON-retour-arriere-{pid}"));
    let final_ext = env.emplacements.dossier_extension();
    let debug_avant = player_debug_mode(env.registre.as_ref());
    let mut res = Resultat { version: charge.manifeste.version.clone(), dossier_medias: o.dossier_medias.clone(), dossier_installation: dossier.display().to_string(), ..Default::default() };

    // ---- 1. Vérification
    let fichiers = charge.fichiers(desktop, o.extension);
    s.commencer(0, fichiers.len() as u64 + 4);
    s.sous(&format!("Paquet AETHRYON : {} fichier(s), empreintes SHA-256", fichiers.len()));
    let mut contenus: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    for f in &fichiers {
        controle(&d.annuler)?;
        contenus.insert(f.source.clone(), charge.lire_verifie(f)?);
        s.avance(1);
    }
    s.ok(Some(format!("{} vérifiés, identiques à charge.json", fichiers.len())));
    let paquet = if o.extension {
        s.sous("Extension Premiere Pro : signature et Manifest");
        let z = contenus.get(&charge.manifeste.extension.fichier.source).ok_or("Extension absente de la charge.")?;
        let p = PaquetZxp::ouvrir(z)?;
        if p.id != ID_EXTENSION {
            return Err(format!("Extension inattendue « {} » (attendu {ID_EXTENSION}).", p.id));
        }
        s.ok(Some(format!("{} fichiers conformes au Manifest signé{}", p.references.len(), if p.horodate { ", horodatage présent" } else { "" })));
        s.avance(1);
        Some(p)
    } else {
        s.ignore("Extension Premiere Pro", "non choisie");
        None
    };
    let nav = match (&charge.manifeste.navigateur, desktop) {
        (Some(n), true) => {
            s.sous("Extension navigateur : contenu de l'archive et identifiant de production");
            let z = contenus.get(&n.fichier.source).ok_or("Extension navigateur absente de la charge.")?;
            let a = navigateur::verifier(z, &n.version)?;
            s.ok(Some(format!("{} fichiers sûrs, identifiant {}", a.fichiers.len(), a.id)));
            Some(a)
        }
        (Some(_), false) => {
            s.ignore("Extension navigateur", "AETHRYON Desktop non choisi (c'est lui qui la met à jour)");
            None
        }
        (None, _) => None,
    };
    let amorce = match &d.amorce {
        Some(a) => Some(env.fs.lire(a).map_err(|e| format!("Copie de maintenance : {} illisible ({e}).", a.display()))?),
        None => None,
    };
    s.sous("Espace disque");
    let requis = charge.taille_installee(desktop) + paquet.as_ref().map(|p| p.taille()).unwrap_or(0) + amorce.as_ref().map(|a| a.len() as u64).unwrap_or(0);
    match env.systeme.espace_libre(&env.emplacements.local) {
        Some(libre) if libre < requis + requis / 10 => return Err(format!("Espace disque insuffisant : {} requis, {} libres.", octets_lisibles(requis), octets_lisibles(libre))),
        Some(libre) => s.ok(Some(format!("{} requis, {} libres", octets_lisibles(requis), octets_lisibles(libre)))),
        None => s.ok(Some(format!("{} requis ; espace libre non mesuré", octets_lisibles(requis)))),
    }
    s.avance(1);
    s.sous("Dossier des médias inscriptible");
    controle(&d.annuler)?;
    let medias = PathBuf::from(&o.dossier_medias);
    if o.dossier_medias.trim().is_empty() || !(o.dossier_medias.contains(":\\") || o.dossier_medias.starts_with("\\\\") || medias.is_absolute()) {
        return Err("Dossier des médias : un chemin complet est requis.".into());
    }
    if env.fs.type_de(&medias) == Some(TypeEntree::Fichier) {
        return Err(format!("{} est un fichier, pas un dossier.", medias.display()));
    }
    if !env.fs.existe(&medias) {
        // Dossiers créés : retirés au retour arrière s'ils sont restés vides.
        let mut a_creer = vec![];
        let mut c = medias.clone();
        while !env.fs.existe(&c) {
            a_creer.push(c.clone());
            match parent_de(&c) {
                Some(p) => c = p,
                None => break,
            }
        }
        env.fs.creer_dossiers(&medias).map_err(|e| format!("Création de {} impossible ({e}).", medias.display()))?;
        for x in a_creer.into_iter().rev() {
            pile.push(Inverse::SupprimerDossierSiVide(x));
        }
    }
    let temoin = medias.join(format!(".aethryon-essai-{pid}"));
    env.fs.ecrire_tout(&temoin, b"AETHRYON").map_err(|e| format!("{} n'est pas inscriptible ({e}).", medias.display()))?;
    env.fs.supprimer_fichier(&temoin).map_err(|e| format!("{} : fichier témoin non supprimé ({e}).", medias.display()))?;
    s.ok(Some(o.dossier_medias.clone()));
    s.avance(1);
    s.sous("Premiere Pro et AETHRYON Desktop");
    res.premiere_ouvert = env.systeme.processus_present(PREMIERE_EXE);
    let desktop_ouvert = desktop && env.systeme.processus_present(DESKTOP_EXE);
    let mut notes = vec![];
    if res.premiere_ouvert {
        notes.push("Premiere Pro est ouvert : redémarrez-le pour voir l'extension");
        res.avertissements.push("Premiere Pro était ouvert : redémarrez-le pour charger l'extension.".into());
    }
    if desktop_ouvert {
        notes.push("AETHRYON Desktop est ouvert : il sera fermé pendant la copie");
    }
    s.ok(Some(if notes.is_empty() { "fermés".to_string() } else { notes.join(" ; ") }));
    s.avance(1);
    let libre = env.systeme.espace_libre(&env.emplacements.local).map(|l| format!(", {} libres", octets_lisibles(l))).unwrap_or_default();
    s.terminer_avec(format!("Charge et extension signée vérifiées · {} requis{libre}.", octets_lisibles(requis)));

    // ---- 2. Installation
    controle(&d.annuler)?;
    let source_nav = charge.manifeste.navigateur.as_ref().map(|n| n.fichier.source.as_str());
    let total = contenus
        .iter()
        .filter(|(k, _)| Some(k.as_str()) != paquet.as_ref().map(|_| charge.manifeste.extension.fichier.source.as_str()) && Some(k.as_str()) != source_nav)
        .map(|(_, v)| v.len() as u64)
        .sum::<u64>()
        + paquet.as_ref().map(|p| p.taille()).unwrap_or(0)
        + nav.as_ref().map(|a| a.taille()).unwrap_or(0)
        + amorce.as_ref().map(|a| a.len() as u64).unwrap_or(0);
    s.commencer(1, total);
    if !env.fs.existe(&dossier) {
        env.fs.creer_dossiers(&dossier).map_err(|e| format!("Création de {} impossible ({e}).", dossier.display()))?;
        pile.push(Inverse::SupprimerArbre(dossier.clone()));
    }
    pile.push(Inverse::SupprimerArbre(sauvegardes.clone()));
    let mut installes: Vec<FichierInstalle> = vec![];
    if desktop {
        let comp = charge.manifeste.desktop.as_ref().ok_or("AETHRYON Desktop absent de la charge.")?;
        s.sous(&format!("AETHRYON Desktop {}", comp.version));
        if desktop_ouvert {
            let n = env.systeme.fermer_processus(DESKTOP_EXE);
            s.journal.info(&format!("AETHRYON Desktop fermé ({n} processus)"));
        }
        for f in &comp.fichiers {
            controle(&d.annuler)?;
            let cible = dossier.join(&f.nom);
            let donnees = &contenus[&f.source];
            poser_fichier(env, &cible, donnees, &sauvegardes, pile, &mut |n| s.avance(n))?;
            installes.push(FichierInstalle { chemin: cible.display().to_string(), sha256: f.sha256.clone(), taille: f.taille });
        }
        let taille: u64 = comp.fichiers.iter().map(|f| f.taille).sum();
        s.ok(Some(format!("{} fichiers, {} → {}", comp.fichiers.len(), octets_lisibles(taille), court(env, &dossier))));
        res.version_desktop = Some(comp.version.clone());
        res.exe_desktop = Some(dossier.join(&comp.exe).display().to_string());
    } else {
        s.ignore("AETHRYON Desktop", "non choisi");
    }
    if let Some(p) = &paquet {
        s.sous(&format!("Extension Premiere Pro {}", p.version));
        controle(&d.annuler)?;
        env.fs.supprimer_arbre(&preparation).map_err(|e| e.to_string())?;
        pile.push(Inverse::SupprimerArbre(preparation.clone()));
        let cible_prep = preparation.join(ID_EXTENSION);
        zxp::extraire(env.fs.as_ref(), p, &cible_prep, &mut |n| s.avance(n))?;
        zxp::verifier_dossier(env.fs.as_ref(), &cible_prep).map_err(|e| format!("Extension préparée non conforme : {e}"))?;
        controle(&d.annuler)?;
        env.fs.creer_dossiers(&env.emplacements.dossier_extensions_cep()).map_err(|e| e.to_string())?;
        if env.fs.existe(&final_ext) {
            env.fs.creer_dossiers(&sauvegarde_ext).map_err(|e| e.to_string())?;
            pile.push(Inverse::SupprimerArbre(sauvegarde_ext.clone()));
            let sauvegarde = sauvegarde_ext.join(ID_EXTENSION);
            env.fs.renommer(&final_ext, &sauvegarde).map_err(|e| format!("L'extension en place est verrouillée ({e}). Fermez Premiere Pro et réessayez."))?;
            pile.push(Inverse::Restaurer { sauvegarde, cible: final_ext.clone() });
        }
        env.fs.renommer(&cible_prep, &final_ext).map_err(|e| format!("Mise en place de l'extension impossible ({e})."))?;
        pile.push(Inverse::SupprimerArbre(final_ext.clone()));
        s.ok(Some(format!("{} fichiers signés et leur signature, sans lien symbolique → {}", p.references.len(), court(env, &final_ext))));
        res.version_extension = Some(p.version.clone());
        res.extension_remplacant = charge.manifeste.extension.remplacant;
        res.dossier_extension = Some(final_ext.display().to_string());
    } else {
        s.ignore("Extension Premiere Pro", "non choisie");
    }
    let geree = navigateur::dossier(env);
    let local = env.emplacements.donnees_locales();
    let prep_nav = local.join(format!("extension-preparation-{pid}"));
    let sauvegarde_nav = local.join(format!("extension-retour-arriere-{pid}"));
    let mut nav_posee = false;
    if let Some(a) = &nav {
        let en_place = navigateur::version_en_place(env.fs.as_ref(), &geree);
        if en_place.as_deref().and_then(|v| aethryon_archive_extension::comparer_versions(v, &a.version)) == Some(std::cmp::Ordering::Greater) {
            // Déjà mise à jour par AETHRYON Desktop : jamais de retour à une version plus ancienne.
            let v = en_place.unwrap_or_default();
            s.ignore(&format!("Extension navigateur {}", a.version), &format!("version {v} déjà en place, plus récente : gardée"));
            res.version_navigateur = Some(v);
        } else {
            s.sous(&format!("Extension navigateur {}", a.version));
            controle(&d.annuler)?;
            env.fs.supprimer_arbre(&prep_nav).map_err(|e| e.to_string())?;
            if !env.fs.existe(&local) {
                env.fs.creer_dossiers(&local).map_err(|e| e.to_string())?;
                pile.push(Inverse::SupprimerDossierSiVide(local.clone()));
            }
            pile.push(Inverse::SupprimerArbre(prep_nav.clone()));
            navigateur::extraire(env.fs.as_ref(), a, &prep_nav, &mut |n| s.avance(n))?;
            navigateur::verifier_dossier(env.fs.as_ref(), &prep_nav, a)?;
            controle(&d.annuler)?;
            if env.fs.type_de(&geree) == Some(TypeEntree::Lien) {
                return Err(format!("{} est un lien : l'extension navigateur n'y est pas copiée.", geree.display()));
            }
            if env.fs.existe(&geree) {
                env.fs.supprimer_arbre(&sauvegarde_nav).map_err(|e| e.to_string())?;
                env.fs.renommer(&geree, &sauvegarde_nav).map_err(|e| format!("Le dossier de l'extension navigateur est utilisé ({e}). Fermez les fenêtres qui l'affichent et réessayez."))?;
                pile.push(Inverse::Restaurer { sauvegarde: sauvegarde_nav.clone(), cible: geree.clone() });
            }
            env.fs.renommer(&prep_nav, &geree).map_err(|e| format!("Mise en place de l'extension navigateur impossible ({e})."))?;
            pile.push(Inverse::SupprimerArbre(geree.clone()));
            s.ok(Some(format!("{} fichiers, sans lien symbolique → {}", a.fichiers.len(), court(env, &geree))));
            res.version_navigateur = Some(a.version.clone());
            nav_posee = true;
        }
        res.dossier_navigateur = Some(geree.display().to_string());
    }
    let setup_copie = dossier.join(NOM_SETUP);
    match &amorce {
        Some(a) => {
            s.sous(&format!("Programme de maintenance ({NOM_SETUP})"));
            poser_fichier(env, &setup_copie, a, &sauvegardes, pile, &mut |n| s.avance(n))?;
            installes.push(FichierInstalle { chemin: setup_copie.display().to_string(), sha256: sha256_hex(a), taille: a.len() as u64 });
            s.ok(Some(format!("{} → {}", octets_lisibles(a.len() as u64), court(env, &dossier))));
        }
        None if env.fs.est_fichier(&setup_copie) => {
            s.ignore("Programme de maintenance", "copie en place conservée");
            let a = env.fs.lire(&setup_copie).map_err(|e| e.to_string())?;
            installes.push(FichierInstalle { chemin: setup_copie.display().to_string(), sha256: sha256_hex(&a), taille: a.len() as u64 });
        }
        None => return Err("Copie de maintenance du setup indisponible : Réparer et Désinstaller ne fonctionneraient pas.".into()),
    }
    let quoi = match (desktop, paquet.is_some()) {
        (true, true) => "AETHRYON Desktop et l'extension copiés",
        (true, false) => "AETHRYON Desktop copié",
        _ => "Extension copiée",
    };
    s.terminer_avec(format!("{quoi} · {} écrits.", octets_lisibles(total)));

    // ---- 3. Enregistrement
    controle(&d.annuler)?;
    s.commencer(2, 3);
    s.sous("Applications installées : Modifier et Désinstaller");
    let taille_ko = ((installes.iter().map(|f| f.taille).sum::<u64>() + paquet.as_ref().map(|p| p.taille()).unwrap_or(0)) / 1024).min(u32::MAX as u64) as u32;
    let avant = env.registre.valeurs(CLE_DESINSTALLATION);
    pile.push(Inverse::RestaurerCle { cle: CLE_DESINSTALLATION.into(), avant });
    env.registre.supprimer_cle(CLE_DESINSTALLATION).map_err(|e| e.to_string())?;
    for (n, v) in valeurs_desinstallation(&dossier, &charge.manifeste.version, desktop, taille_ko) {
        env.registre.ecrire(CLE_DESINSTALLATION, n, &v).map_err(|e| format!("Registre : écriture de {n} impossible ({e})."))?;
    }
    s.ok(Some(format!("HKCU\\{CLE_DESINSTALLATION}")));
    s.avance(1);
    let lnk = env.emplacements.raccourci();
    let exe_desktop = dossier.join(DESKTOP_EXE);
    if desktop {
        s.sous("Raccourci du menu Démarrer");
        let avant = env.fs.lire(&lnk).ok();
        pile.push(Inverse::RestaurerContenu { chemin: lnk.clone(), avant });
        env.systeme.creer_raccourci(&lnk, &exe_desktop, "", "AETHRYON Desktop").map_err(|e| format!("Raccourci impossible ({e})."))?;
        s.ok(Some(lnk.display().to_string()));
    } else {
        s.ignore("Raccourci du menu Démarrer", "AETHRYON Desktop non choisi");
    }
    s.avance(1);
    s.sous("Démarrage avec Windows");
    let avant = env.registre.lire(Racine::Hkcu, CLE_RUN, VALEUR_RUN);
    pile.push(Inverse::RestaurerValeur { cle: CLE_RUN.into(), nom: VALEUR_RUN.into(), avant });
    let run_attendu = if desktop && o.demarrage_auto { Some(commande_run(&exe_desktop)) } else { None };
    match &run_attendu {
        Some(c) => {
            env.registre.ecrire(CLE_RUN, VALEUR_RUN, &Valeur::Chaine(c.clone())).map_err(|e| format!("Registre : démarrage automatique impossible ({e})."))?;
            s.ok(Some("activé, discret (zone de notification)".into()));
        }
        None => {
            env.registre.supprimer_valeur(CLE_RUN, VALEUR_RUN).map_err(|e| e.to_string())?;
            s.ok(Some("désactivé".into()));
        }
    }
    s.avance(1);
    s.terminer_avec(format!(
        "Applications installées (Modifier, Désinstaller){}, démarrage avec Windows {}.",
        if desktop { ", menu Démarrer" } else { "" },
        if run_attendu.is_some() { "activé" } else { "désactivé" }
    ));

    // ---- 4. Configuration
    controle(&d.annuler)?;
    s.commencer(3, 3);
    s.sous("Préférences partagées (config.json)");
    let (conf, illisible) = config_desktop::fusionner_config(env, o, res.version_extension.as_deref(), matches!(d.operation, Operation::Reparer | Operation::MettreAJour));
    if let Some(i) = illisible {
        let ancien = env.fs.lire(&config_desktop::chemin_config(env)).unwrap_or_default();
        ecrire_preferences(env, &i, &ancien, pile)?;
        res.avertissements.push(format!("Ancien config.json illisible, mis de côté : {}", i.display()));
    }
    ecrire_preferences(env, &config_desktop::chemin_config(env), &conf, pile)?;
    s.ok(Some(config_desktop::chemin_config(env).display().to_string()));
    s.avance(1);
    if desktop {
        s.sous("AETHRYON Desktop prêt à l'emploi (desktop.json)");
        ecrire_preferences(env, &config_desktop::chemin_prive(env), &config_desktop::fusionner_prive(env), pile)?;
        s.ok(None);
    } else {
        s.ignore("AETHRYON Desktop prêt à l'emploi", "non choisi");
    }
    s.avance(1);
    s.sous("Inventaire de l'installation (installation.json)");
    let ancien = lire_inventaire(env, &dossier);
    let maintenant = journal::date_iso();
    let inv = Inventaire {
        schema: 1,
        produit: PRODUIT.into(),
        version: charge.manifeste.version.clone(),
        installe_le: ancien.as_ref().map(|a| a.installe_le.clone()).unwrap_or_else(|| maintenant.clone()),
        mis_a_jour_le: maintenant,
        options: Options { desktop, ..o.clone() },
        fichiers: installes.clone(),
        version_desktop: res.version_desktop.clone(),
        version_extension: res.version_extension.clone(),
        dossier_extension: res.dossier_extension.clone(),
        raccourci: desktop.then(|| lnk.display().to_string()),
        version_navigateur: res.version_navigateur.clone(),
        dossier_navigateur: res.dossier_navigateur.clone(),
    };
    ecrire_preferences(env, &dossier.join(NOM_INVENTAIRE), &serde_json::to_vec_pretty(&inv).unwrap_or_default(), pile)?;
    s.ok(None);
    s.avance(1);
    s.terminer_avec(format!("Médias dans {} ; préférences enregistrées.", court(env, &medias)));

    // ---- 5. Validation : tout est relu, rien n'est supposé.
    controle(&d.annuler)?;
    s.commencer(4, 7);
    s.sous("Fichiers installés relus (SHA-256)");
    for f in &installes {
        let lu = env.fs.lire(Path::new(&f.chemin)).map_err(|e| format!("Validation : {} illisible ({e}).", f.chemin))?;
        if sha256_hex(&lu) != f.sha256 {
            return Err(format!("Validation : {} diffère de la charge.", f.chemin));
        }
    }
    s.ok(Some(format!("{} fichier(s) identiques", installes.len())));
    s.avance(1);
    if paquet.is_some() {
        s.sous("Extension : fichiers conformes au Manifest signé");
        let n = zxp::verifier_dossier(env.fs.as_ref(), &final_ext).map_err(|e| format!("Validation de l'extension : {e}"))?;
        s.ok(Some(format!("{n} fichiers, signature présente, aucun lien symbolique")));
    } else {
        s.ignore("Extension", "non choisie");
    }
    s.avance(1);
    match (&nav, nav_posee) {
        (Some(a), true) => {
            s.sous("Extension navigateur : fichiers relus");
            let n = navigateur::verifier_dossier(env.fs.as_ref(), &geree, a)?;
            s.ok(Some(format!("{n} fichiers identiques à l'archive, version {}", a.version)));
        }
        (Some(_), false) => s.ignore("Extension navigateur", "version plus récente gardée"),
        (None, _) => s.ignore("Extension navigateur", if charge.manifeste.navigateur.is_some() { "AETHRYON Desktop non choisi" } else { "absente de cette charge" }),
    }
    s.avance(1);
    s.sous("Registre relu");
    let lu = |n: &str| env.registre.chaine(Racine::Hkcu, CLE_DESINSTALLATION, n);
    if lu("DisplayVersion").as_deref() != Some(charge.manifeste.version.as_str()) || lu("Publisher").as_deref() != Some(EDITEUR) {
        return Err("Validation : entrée « Applications installées » incomplète.".into());
    }
    let desinst = lu("UninstallString").unwrap_or_default();
    if !desinst.contains(NOM_SETUP) || !env.fs.est_fichier(&setup_copie) {
        return Err("Validation : la désinstallation ne pointe pas vers la copie du setup.".into());
    }
    if env.registre.chaine(Racine::Hkcu, CLE_RUN, VALEUR_RUN) != run_attendu {
        return Err("Validation : démarrage avec Windows différent du choix.".into());
    }
    s.ok(Some("Applications installées, démarrage avec Windows".into()));
    s.avance(1);
    s.sous("Préférences relues");
    if config_desktop::dossier_medias_actuel(env).as_deref() != Some(o.dossier_medias.as_str()) {
        return Err("Validation : config.json ne contient pas le dossier des médias choisi.".into());
    }
    if !env.fs.est_dossier(&medias) {
        return Err("Validation : dossier des médias absent.".into());
    }
    s.ok(None);
    s.avance(1);
    s.sous("PlayerDebugMode non modifié");
    if player_debug_mode(env.registre.as_ref()) != debug_avant {
        return Err("Validation : PlayerDebugMode a changé (le setup ne doit jamais l'écrire).".into());
    }
    s.ok(Some(if debug_avant.is_empty() { "désactivé, comme avant".into() } else { "laissé tel quel (activé avant le setup)".into() }));
    s.avance(1);
    // Nettoyage : à partir d'ici, plus de retour arrière (tout est validé).
    s.sous("Nettoyage");
    pile.clear();
    let mut restes = vec![];
    if env.fs.existe(&sauvegarde_nav) {
        // La version remplacée devient « précédente » (comme après une mise à jour par AETHRYON Desktop).
        let prec = navigateur::precedente(env);
        let _ = env.fs.supprimer_arbre(&prec);
        if env.fs.renommer(&sauvegarde_nav, &prec).is_err() {
            let _ = env.fs.supprimer_arbre(&sauvegarde_nav);
        }
    }
    for p in [&sauvegardes, &preparation, &sauvegarde_ext, &prep_nav] {
        if env.fs.existe(p) && env.fs.supprimer_arbre(p).is_err() {
            restes.push(p.display().to_string());
        }
    }
    let mut migration = None;
    if let Some(v) = env.registre.chaine(Racine::Hkcu, CLE_ANCIENNE_BETA, "DisplayVersion") {
        for n in ["desinstaller.exe"] {
            let p = dossier.join(n);
            if env.fs.existe(&p) && env.fs.supprimer_fichier(&p).is_err() {
                restes.push(p.display().to_string());
            }
        }
        // Dossiers de la bêta NSIS (desktop/installateur/aethryon-desktop.nsi) : le panneau UXP (.ccx) et les licences.
        // Aucun n'appartient à ce setup ; sans ce retrait, le dossier d'installation ne serait jamais vide.
        for n in ["panneau", "licences"] {
            let p = dossier.join(n);
            if env.fs.existe(&p) && env.fs.supprimer_arbre(&p).is_err() {
                restes.push(p.display().to_string());
            }
        }
        let _ = env.registre.supprimer_cle(CLE_ANCIENNE_BETA);
        migration = Some(v.clone());
        res.ancienne_beta_remplacee = Some(v.clone());
        res.avertissements.push(format!(
            "La bêta {v} d'AETHRYON Desktop a été remplacée. Si l'ancien plugin UXP « AETHRYON » apparaît encore dans Premiere Pro, retirez-le dans l'application Creative Cloud Desktop, parmi les plugins installés."
        ));
    }
    if !restes.is_empty() {
        s.journal.avert(&format!("Nettoyage incomplet (fichiers verrouillés) : {}", restes.join(", ")));
    }
    s.ok(Some(match migration {
        Some(v) => format!("sauvegardes retirées, bêta {v} remplacée"),
        None => "sauvegardes retirées".into(),
    }));
    s.avance(1);
    s.terminer_avec(format!("{} fichier(s), extension signée, registre et préférences relus.", installes.len()));
    Ok(res)
}

/// Fichiers d'un composant (pour les essais).
pub fn noms(f: &[FichierCharge]) -> Vec<String> {
    f.iter().map(|x| x.nom.clone()).collect()
}

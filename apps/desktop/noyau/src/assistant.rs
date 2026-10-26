//! Assistant d'installation et de réparation (brief §3, écran 4). Cinq étapes, chacune faite d'opérations RÉELLES,
//! avec leur durée réelle et un message clair ; rien n'est simulé :
//! 1. Vérification — Premiere Pro (version lue dans l'exe), Creative Cloud, panneau AETHRYON (extension CEP posée par
//!    AETHRYON Setup dans `%APPDATA%\Adobe\CEP\extensions\fr.aethryon.premiere`, version lue dans
//!    `CSXS/manifest.xml`), dossier des médias (écriture réelle d'un fichier témoin, espace libre), Premiere ouvert ;
//! 2. Installation — présence d'AETHRYON Desktop et du panneau. Depuis la v2, le Desktop N'INSTALLE PLUS le panneau
//!    (plus de `.ccx` UXP ni d'UPIA) : absent, il renvoie vers « Réparer avec AETHRYON Setup » ;
//! 3. Enregistrement des composants — Native Messaging (Chrome, Edge, Brave), démarrage automatique, entrée
//!    « Applications installées » posée par l'installateur ;
//! 4. Configuration — `config.json`, arborescence des échanges, index ;
//! 5. Validation — panneau relu sur le disque, fichiers présents, clés relues.
//!
//! Les opérations sont idempotentes : « Réparer » relance exactement le même parcours.

use crate::bibliotheque::{DossierIndex, Index};
use crate::chemins::Emplacements;
use crate::config::{self, Config};
use crate::plateforme::{self, CreativeCloud, DetectionPremiere, InstallPremiere, Plateforme};
use crate::{atomique, horloge, journal};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

/// Panneau AETHRYON v2 : extension CEP qu'AETHRYON Setup installe (`Emplacements::extension_cep`). Le Desktop la
/// constate seulement (dossier et `CSXS/manifest.xml`) ; il ne l'installe ni ne la modifie.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PanneauCep {
    pub dossier: String,
    /// `ExtensionBundleVersion` du manifeste (`2.0.1`) ; `None` s'il est illisible.
    pub version: Option<String>,
    /// Texte affiché tel quel : « Panneau AETHRYON 2.0.1 installé ».
    pub libelle: String,
}

/// Panneau absent : un seul message, et une seule action (« Réparer avec AETHRYON Setup »).
pub const PANNEAU_ABSENT: &str = "Panneau AETHRYON absent : « Réparer avec AETHRYON Setup » l'installe.";

/// Panneau CEP réellement installé pour cet utilisateur, ou `None` (dossier ou `CSXS/manifest.xml` absent).
pub fn detecter_panneau_cep(emp: &Emplacements) -> Option<PanneauCep> {
    let dossier = emp.extension_cep();
    let xml = std::fs::read(dossier.join("CSXS").join("manifest.xml")).ok()?;
    let version = version_manifeste_cep(&String::from_utf8_lossy(&xml));
    let libelle = match &version {
        Some(v) => format!("Panneau AETHRYON {v} installé"),
        None => "Panneau AETHRYON installé (version illisible)".into(),
    };
    Some(PanneauCep { dossier: dossier.to_string_lossy().into_owned(), version, libelle })
}

/// `ExtensionBundleVersion` de l'élément `<ExtensionManifest …>` (commentaires XML ignorés, guillemets simples ou
/// doubles). Valeur bornée : 32 caractères parmi chiffres, lettres, `.`, `-`, `+`.
pub fn version_manifeste_cep(xml: &str) -> Option<String> {
    let mut texte = String::with_capacity(xml.len());
    let mut reste = xml;
    while let Some(i) = reste.find("<!--") {
        texte.push_str(&reste[..i]);
        reste = reste[i..].find("-->").map(|j| &reste[i + j + 3..]).unwrap_or("");
    }
    texte.push_str(reste);
    let debut = texte.find("<ExtensionManifest")?;
    let balise = &texte[debut..];
    let balise = &balise[..balise.find('>')?];
    let mut morceau = balise;
    let valeur = loop {
        let i = morceau.find("ExtensionBundleVersion")?;
        let apres = morceau[i + "ExtensionBundleVersion".len()..].trim_start();
        if let Some(v) = apres.strip_prefix('=') {
            break v.trim_start();
        }
        morceau = apres;
    };
    let q = valeur.chars().next().filter(|c| *c == '"' || *c == '\'')?;
    let v = &valeur[1..];
    let v = &v[..v.find(q)?];
    (!v.is_empty() && v.len() <= 32 && v.chars().all(|c| c.is_ascii_alphanumeric() || ".-+".contains(c))).then(|| v.to_string())
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub dossier_medias: String,
    pub surveillance: bool,
    pub demarrage_auto: bool,
    pub installer_panneau: bool,
    /// `toutes`, `importantes` ou `aucune`.
    pub notifications: String,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Etat {
    Attente,
    EnCours,
    Ok,
    Ignore,
    AConfirmer,
    Erreur,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    pub libelle: String,
    pub etat: Etat,
    pub message: Option<String>,
    pub duree_ms: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Etape {
    pub numero: u8,
    pub titre: String,
    pub description: String,
    pub etat: Etat,
    pub duree_ms: u64,
    pub operations: Vec<Operation>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PanneauFinal {
    /// `installe`, `a-confirmer`, `non-installe` ou `ignore`.
    pub statut: String,
    pub version: Option<String>,
    pub message: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Rapport {
    pub etapes: Vec<Etape>,
    pub reussi: bool,
    pub annule: bool,
    pub version: String,
    pub panneau: PanneauFinal,
    pub dossier_medias: String,
    pub premiere: Option<InstallPremiere>,
    pub duree_ms: u64,
}

/// Diagnostic de l'écran « Détection » : rien n'est installé ni modifié.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub premiere: DetectionPremiere,
    pub creative_cloud: CreativeCloud,
    /// Panneau AETHRYON (extension CEP) installé par AETHRYON Setup.
    pub panneau: Option<PanneauCep>,
    pub panneau_present: bool,
    pub dossier_defaut: String,
    pub espace_libre: Option<u64>,
    pub duree_ms: u64,
    pub plateforme: String,
}

pub struct Contexte<'a> {
    pub plateforme: &'a dyn Plateforme,
    pub emp: &'a Emplacements,
    pub exe: PathBuf,
    pub premiere_manuel: Option<PathBuf>,
}

pub fn diagnostiquer(ctx: &Contexte, dossier_defaut: &str) -> Diagnostic {
    let t = Instant::now();
    let premiere = plateforme::detecter_premiere(ctx.plateforme, ctx.premiere_manuel.as_deref());
    let creative_cloud = ctx.plateforme.creative_cloud();
    let panneau = detecter_panneau_cep(ctx.emp);
    Diagnostic {
        panneau_present: panneau.is_some(),
        panneau,
        espace_libre: ctx.plateforme.espace_libre(Path::new(dossier_defaut)),
        dossier_defaut: dossier_defaut.to_string(),
        premiere,
        creative_cloud,
        duree_ms: t.elapsed().as_millis() as u64,
        plateforme: ctx.plateforme.nom().to_string(),
    }
}

pub fn sha256_fichier(p: &Path) -> std::io::Result<String> {
    let mut h = Sha256::new();
    let mut f = std::fs::File::open(p)?;
    std::io::copy(&mut f, &mut h)?;
    Ok(h.finalize().iter().map(|o| format!("{o:02x}")).collect())
}

pub fn taille_lisible(o: u64) -> String {
    let (v, u) = match o {
        o if o >= 1 << 30 => (o as f64 / (1u64 << 30) as f64, "Go"),
        o if o >= 1 << 20 => (o as f64 / (1u64 << 20) as f64, "Mo"),
        o if o >= 1 << 10 => (o as f64 / 1024.0, "Ko"),
        o => (o as f64, "octets"),
    };
    if u == "octets" {
        format!("{o}\u{a0}octets")
    } else if v >= 100.0 {
        format!("{v:.0}\u{a0}{u}")
    } else {
        format!("{}\u{a0}{u}", format!("{v:.1}").replace('.', ","))
    }
}

const ETAPES: [(&str, &str); 5] = [
    ("Vérification", "Premiere Pro, Creative Cloud, panneau AETHRYON, dossier des médias."),
    ("Installation", "AETHRYON Desktop et le panneau Premiere Pro."),
    ("Enregistrement des composants", "Liaison navigateur, démarrage avec Windows, désinstallation."),
    ("Configuration", "Dossier des médias et préférences."),
    ("Validation", "Panneau, fichiers et clés relus."),
];

struct Deroule<'r> {
    etapes: Vec<Etape>,
    rappel: &'r mut dyn FnMut(&[Etape]),
    debut_etape: Instant,
}

impl Deroule<'_> {
    fn commencer_etape(&mut self, i: usize) {
        self.etapes[i].etat = Etat::EnCours;
        self.debut_etape = Instant::now();
        (self.rappel)(&self.etapes);
    }
    fn operation(&mut self, i: usize, libelle: &str, f: impl FnOnce() -> (Etat, Option<String>)) -> Etat {
        self.etapes[i].operations.push(Operation { libelle: libelle.into(), etat: Etat::EnCours, message: None, duree_ms: 0 });
        (self.rappel)(&self.etapes);
        let t = Instant::now();
        let (etat, message) = f();
        let o = self.etapes[i].operations.last_mut().unwrap();
        o.etat = etat;
        o.message = message.clone();
        o.duree_ms = t.elapsed().as_millis() as u64;
        journal::info("assistant", &format!("{} › {} : {:?} {}", self.etapes[i].titre, libelle, etat, message.unwrap_or_default()));
        (self.rappel)(&self.etapes);
        etat
    }
    fn finir_etape(&mut self, i: usize) {
        let ops = &self.etapes[i].operations;
        self.etapes[i].etat = if ops.iter().any(|o| o.etat == Etat::Erreur) {
            Etat::Erreur
        } else if ops.iter().any(|o| o.etat == Etat::AConfirmer) {
            Etat::AConfirmer
        } else {
            Etat::Ok
        };
        self.etapes[i].duree_ms = self.debut_etape.elapsed().as_millis() as u64;
        (self.rappel)(&self.etapes);
    }
}

fn notifications(choix: &str) -> config::Notifications {
    match choix {
        "toutes" => config::Notifications { media_pret: true, import_reussi: true, erreurs: true },
        "aucune" => config::Notifications { media_pret: false, import_reussi: false, erreurs: false },
        _ => config::Notifications::default(),
    }
}

/// Déroule les cinq étapes. `rappel` reçoit l'état complet après chaque changement (progression réelle).
pub fn executer(ctx: &Contexte, opts: &Options, annule: &AtomicBool, rappel: &mut dyn FnMut(&[Etape])) -> Rapport {
    let debut = Instant::now();
    let p = ctx.plateforme;
    let etapes = ETAPES
        .iter()
        .enumerate()
        .map(|(i, (t, d))| Etape { numero: i as u8 + 1, titre: t.to_string(), description: d.to_string(), etat: Etat::Attente, duree_ms: 0, operations: vec![] })
        .collect();
    let mut d = Deroule { etapes, rappel, debut_etape: Instant::now() };
    let dossier = PathBuf::from(&opts.dossier_medias);
    let mut detection = DetectionPremiere::default();
    let mut cc = CreativeCloud::default();
    let mut bloque = false;
    let mut panneau = PanneauFinal { statut: "ignore".into(), version: None, message: String::new() };
    let mut cep = detecter_panneau_cep(ctx.emp);
    let arrete = || annule.load(Ordering::SeqCst);

    journal::info("assistant", &format!("Début : dossier {}, panneau {}", opts.dossier_medias, opts.installer_panneau));

    // ---- 1. Vérification ------------------------------------------------------------------------------------------
    d.commencer_etape(0);
    d.operation(0, "Adobe Premiere Pro", || {
        detection = plateforme::detecter_premiere(p, ctx.premiere_manuel.as_deref());
        match &detection.principale {
            None => (Etat::Ignore, Some("Premiere Pro introuvable : AETHRYON Desktop fonctionne seul.".into())),
            Some(i) => match (&i.version, i.compatible) {
                (Some(v), Some(true)) => (Etat::Ok, Some(format!("Version {v} · panneau AETHRYON pris en charge."))),
                (Some(v), _) => (Etat::Erreur, Some(format!("Version {v} : le panneau demande Premiere Pro 25.6 ou plus récent."))),
                (None, _) => (Etat::AConfirmer, Some("Version illisible dans l'exécutable : compatibilité non vérifiée.".into())),
            },
        }
    });
    d.operation(0, "Creative Cloud Desktop", || {
        cc = p.creative_cloud();
        match &cc.upia {
            Some(_) => (Etat::Ok, Some("Présent (installe et met à jour Premiere Pro).".into())),
            None => (Etat::Ignore, Some("Creative Cloud Desktop introuvable : le panneau AETHRYON n'en dépend pas.".into())),
        }
    });
    d.operation(0, "Panneau AETHRYON", || match &cep {
        Some(c) => (Etat::Ok, Some(format!("{} · {}.", c.libelle, c.dossier))),
        None if !opts.installer_panneau => (Etat::Ignore, Some("Absent ; AETHRYON Desktop fonctionne sans lui.".into())),
        None => (Etat::AConfirmer, Some(PANNEAU_ABSENT.into())),
    });
    let dossier_ok = d.operation(0, "Dossier des médias", || match config::tester_ecriture(&dossier) {
        Err(m) => (Etat::Erreur, Some(m)),
        Ok(()) => (
            Etat::Ok,
            Some(match p.espace_libre(&dossier) {
                Some(o) => format!("Écriture vérifiée · {} libres.", taille_lisible(o)),
                None => "Écriture vérifiée.".into(),
            }),
        ),
    });
    if let Some(true) = detection.en_cours {
        d.operation(0, "Premiere Pro ouvert", || (Etat::AConfirmer, Some("Premiere Pro est ouvert : fermez-le puis rouvrez-le après l'installation pour voir le panneau.".into())));
    }
    d.finir_etape(0);
    if dossier_ok == Etat::Erreur {
        bloque = true;
    }

    // ---- 2. Installation --------------------------------------------------------------------------------------------
    if !bloque && !arrete() {
        d.commencer_etape(1);
        d.operation(1, "AETHRYON Desktop", || match std::fs::metadata(&ctx.exe) {
            Ok(m) => (Etat::Ok, Some(format!("Présent dans {} · {}.", ctx.exe.parent().map(|x| x.display().to_string()).unwrap_or_default(), taille_lisible(m.len())))),
            Err(_) => (Etat::Erreur, Some("Exécutable introuvable.".into())),
        });
        let raison_ignore = if !opts.installer_panneau {
            Some("Vous continuez sans le panneau.")
        } else if detection.principale.is_none() {
            Some("Premiere Pro introuvable.")
        } else if detection.principale.as_ref().and_then(|i| i.compatible) == Some(false) {
            Some("Version de Premiere Pro trop ancienne (25.6 ou plus récent requis).")
        } else {
            None
        };
        d.operation(1, "Panneau Premiere Pro (AETHRYON Setup)", || {
            if let Some(c) = &cep {
                panneau = PanneauFinal { statut: "installe".into(), version: c.version.clone(), message: format!("{} par AETHRYON Setup.", c.libelle) };
                return (Etat::Ok, Some(panneau.message.clone()));
            }
            if let Some(r) = raison_ignore {
                panneau.statut = "ignore".into();
                panneau.message = r.into();
                return (Etat::Ignore, Some(r.into()));
            }
            panneau.statut = "non-installe".into();
            panneau.message = PANNEAU_ABSENT.into();
            (Etat::AConfirmer, Some(PANNEAU_ABSENT.into()))
        });
        d.finir_etape(1);
    }

    // ---- 3. Enregistrement des composants -------------------------------------------------------------------------
    if !bloque && !arrete() {
        d.commencer_etape(2);
        d.operation(2, "Liaison navigateur (Native Messaging) : Chrome, Edge, Brave", || {
            let r = plateforme::enregistrer_nm(p, &ctx.exe, &ctx.emp.manifeste_nm());
            let ko: Vec<String> = r.iter().filter(|e| !e.enregistre).map(|e| format!("{} : {}", e.navigateur, e.message.clone().unwrap_or_default())).collect();
            if ko.is_empty() {
                (Etat::Ok, Some("Hôte local fr.aethryon.desktop enregistré pour l'utilisateur (HKCU).".into()))
            } else {
                (Etat::Erreur, Some(ko.join(" ; ")))
            }
        });
        d.operation(2, "Démarrage avec Windows", || match plateforme::demarrage_auto(p, &ctx.exe, opts.demarrage_auto) {
            Ok(()) => (Etat::Ok, Some(if opts.demarrage_auto { "Activé, réduit dans la zone de notification." } else { "Désactivé." }.into())),
            Err(e) => (Etat::Erreur, Some(e)),
        });
        d.operation(2, "Désinstallation dans Paramètres Windows", || match p.reg_lire(plateforme::CLE_DESINSTALLATION, Some("DisplayVersion")) {
            Some(v) => (Etat::Ok, Some(format!("Entrée « Applications installées » présente (version {v})."))),
            None => (Etat::Ignore, Some("Entrée absente : AETHRYON Desktop n'a pas été installé par son installateur.".into())),
        });
        d.finir_etape(2);
    }

    // ---- 4. Configuration ---------------------------------------------------------------------------------------------
    let mut config_ecrite = false;
    if !bloque && !arrete() {
        d.commencer_etape(3);
        d.operation(3, "Préférences", || {
            let mut c: Config = config::charger(ctx.emp, &opts.dossier_medias).config;
            let ancien = c.dossier_medias.clone();
            c.dossier_medias = opts.dossier_medias.clone();
            c.dossiers_surveilles.retain(|x| crate::noms::normaliser_pour_id(x) != crate::noms::normaliser_pour_id(&ancien));
            c.surveillance = opts.surveillance;
            c.demarrage_auto = opts.demarrage_auto;
            c.notifications = notifications(&opts.notifications);
            let def = c.dossier_medias.clone();
            c.normaliser(&def);
            match config::enregistrer(ctx.emp, &c) {
                Ok(()) => {
                    config_ecrite = true;
                    (Etat::Ok, Some(format!("Enregistrées dans {}.", ctx.emp.config_json().display())))
                }
                Err(e) => (Etat::Erreur, Some(format!("config.json non écrit ({}).", e.kind()))),
            }
        });
        d.operation(3, "Bibliothèque et échanges avec le panneau", || {
            if let Err(e) = ctx.emp.creer_arborescence() {
                return (Etat::Erreur, Some(format!("Dossiers d'échange non créés ({}).", e.kind())));
            }
            if !ctx.emp.index_json().exists() {
                let index = Index { dossiers: vec![DossierIndex { chemin: opts.dossier_medias.clone(), principal: true }], ..Default::default() };
                if let Err(e) = atomique::ecrire_json(&ctx.emp.index_json(), &index, false) {
                    return (Etat::Erreur, Some(format!("Index non écrit ({}).", e.kind())));
                }
            }
            (Etat::Ok, Some(format!("Prêts dans {}.", ctx.emp.racine.display())))
        });
        d.finir_etape(3);
    }

    // ---- 5. Validation ------------------------------------------------------------------------------------------------
    if !bloque && !arrete() {
        d.commencer_etape(4);
        d.operation(4, "Panneau AETHRYON relu", || {
            cep = detecter_panneau_cep(ctx.emp);
            match &cep {
                Some(c) => {
                    panneau = PanneauFinal { statut: "installe".into(), version: c.version.clone(), message: format!("{} par AETHRYON Setup.", c.libelle) };
                    (Etat::Ok, Some(format!("{} : CSXS/manifest.xml relu.", c.libelle)))
                }
                None if panneau.statut == "ignore" => (Etat::Ignore, Some("Aucun panneau à vérifier.".into())),
                None => {
                    panneau.statut = "non-installe".into();
                    panneau.message = PANNEAU_ABSENT.into();
                    (Etat::AConfirmer, Some(PANNEAU_ABSENT.into()))
                }
            }
        });
        d.operation(4, "Fichiers", || {
            let mut manquants = Vec::new();
            for (nom, chemin) in [("config.json", ctx.emp.config_json()), ("index.json", ctx.emp.index_json()), ("manifeste Native Messaging", ctx.emp.manifeste_nm())] {
                if !chemin.is_file() {
                    manquants.push(nom.to_string());
                }
            }
            if manquants.is_empty() {
                (Etat::Ok, Some("Configuration, index et manifeste Native Messaging présents.".into()))
            } else {
                (Etat::Erreur, Some(format!("Manquants : {}.", manquants.join(", "))))
            }
        });
        d.operation(4, "Clés du registre", || {
            let nm = plateforme::etat_nm(p, &ctx.emp.manifeste_nm());
            let ko: Vec<String> = nm.iter().filter(|e| !e.enregistre).map(|e| e.navigateur.clone()).collect();
            let run = plateforme::demarrage_auto_actif(p, &ctx.exe);
            if ko.is_empty() && run == opts.demarrage_auto {
                (Etat::Ok, Some("Native Messaging (3 navigateurs) et démarrage relus.".into()))
            } else {
                let mut m = Vec::new();
                if !ko.is_empty() {
                    m.push(format!("Native Messaging absent pour {}", ko.join(", ")));
                }
                if run != opts.demarrage_auto {
                    m.push("valeur de démarrage différente".into());
                }
                (Etat::Erreur, Some(m.join(" ; ") + "."))
            }
        });
        d.finir_etape(4);
    }

    let annule_final = annule.load(Ordering::SeqCst);
    let reussi = !bloque && !annule_final && config_ecrite && d.etapes[4].etat != Etat::Attente;
    if reussi {
        let mut prive = config::charger_prive(ctx.emp);
        prive.assistant_termine = true;
        prive.assistant_termine_le = Some(horloge::iso(horloge::maintenant()));
        if let Some(m) = &ctx.premiere_manuel {
            prive.premiere_exe_manuel = Some(m.to_string_lossy().into_owned());
        }
        let _ = config::enregistrer_prive(ctx.emp, &prive);
    }
    if panneau.message.is_empty() {
        panneau.message = "Panneau non installé.".into();
    }
    journal::info("assistant", &format!("Fin : réussi {reussi}, annulé {annule_final}, panneau {}", panneau.statut));
    Rapport {
        etapes: d.etapes,
        reussi,
        annule: annule_final,
        version: crate::VERSION.into(),
        panneau,
        dossier_medias: opts.dossier_medias.clone(),
        premiere: detection.principale,
        duree_ms: debut.elapsed().as_millis() as u64,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plateforme::factice::Factice;

    fn options(d: &Path) -> Options {
        Options { dossier_medias: d.join("Téléchargements").join("AETHRYON").to_string_lossy().into_owned(), surveillance: true, demarrage_auto: true, installer_panneau: true, notifications: "importantes".into() }
    }

    /// Le manifeste RÉEL de l'extension CEP 2.0.1 (en-tête commenté compris), tel qu'AETHRYON Setup le pose.
    const MANIFESTE_201: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"no\"?>\n<!--\n  AETHRYON pour Premiere Pro v2 : coque CEP. <ExtensionManifest ExtensionBundleVersion=\"0.0.0\"> dans un commentaire.\n-->\n<ExtensionManifest xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" ExtensionBundleId=\"fr.aethryon.premiere\" ExtensionBundleVersion=\"2.0.1\" ExtensionBundleName=\"AETHRYON\" Version=\"12.0\">\n  <ExtensionList><Extension Id=\"fr.aethryon.premiere.panneau\" Version=\"2.0.1\"/></ExtensionList>\n</ExtensionManifest>\n";

    /// Pose le panneau comme AETHRYON Setup : `%APPDATA%\Adobe\CEP\extensions\fr.aethryon.premiere\CSXS\manifest.xml`.
    fn poser_cep(emp: &Emplacements, manifeste: &str) {
        let csxs = emp.extension_cep().join("CSXS");
        std::fs::create_dir_all(&csxs).unwrap();
        std::fs::write(csxs.join("manifest.xml"), manifeste).unwrap();
        std::fs::write(emp.extension_cep().join("index.html"), "<!doctype html>").unwrap();
    }

    fn premiere_et_cc(f: &Factice) {
        f.ajouter_premiere("C:\\Program Files\\Adobe\\Adobe Premiere Pro 2026\\Adobe Premiere Pro.exe", Some("26.5.2.13"));
        f.upia_present();
        f.reg_ecrire(plateforme::CLE_DESINSTALLATION, Some("DisplayVersion"), "1.2.0-beta.2").unwrap();
    }

    #[test]
    fn diagnostic_lit_le_panneau_cep_installe() {
        let d = tempfile::tempdir().unwrap();
        let emp = Emplacements::sous(d.path());
        assert_eq!(emp.extension_cep(), d.path().join("Roaming").join("Adobe").join("CEP").join("extensions").join("fr.aethryon.premiere"));
        let f = Factice::default();
        premiere_et_cc(&f);
        let ctx = Contexte { plateforme: &f, emp: &emp, exe: d.path().join("aethryon-desktop.exe"), premiere_manuel: None };
        // Absent : rien de trouvé, et aucune recherche d'un .ccx (aucun fichier lu à côté de l'exe).
        let diag = diagnostiquer(&ctx, "C:\\M");
        assert!(!diag.panneau_present && diag.panneau.is_none());
        // Présent avec le manifeste 2.0.1 : présent, version lue, texte affiché.
        poser_cep(&emp, MANIFESTE_201);
        let diag = diagnostiquer(&ctx, "C:\\M");
        assert!(diag.panneau_present);
        let p = diag.panneau.unwrap();
        assert_eq!(p.version.as_deref(), Some("2.0.1"));
        assert_eq!(p.libelle, "Panneau AETHRYON 2.0.1 installé");
        assert_eq!(Path::new(&p.dossier), emp.extension_cep());
        // Manifeste illisible : présent, version inconnue (jamais inventée).
        poser_cep(&emp, "<ExtensionManifest ExtensionBundleId=\"fr.aethryon.premiere\">");
        let p = detecter_panneau_cep(&emp).unwrap();
        assert_eq!((p.version, p.libelle.as_str()), (None, "Panneau AETHRYON installé (version illisible)"));
        // Dossier retiré : absent.
        std::fs::remove_dir_all(emp.extension_cep()).unwrap();
        assert!(!diagnostiquer(&ctx, "C:\\M").panneau_present);
    }

    #[test]
    fn version_du_manifeste_cep() {
        assert_eq!(version_manifeste_cep(MANIFESTE_201).as_deref(), Some("2.0.1"), "le commentaire d'en-tête est ignoré");
        assert_eq!(version_manifeste_cep("<ExtensionManifest Version='12.0' ExtensionBundleVersion = '2.1.0-beta.1'>").as_deref(), Some("2.1.0-beta.1"));
        for x in ["", "<ExtensionManifest>", "<ExtensionManifest ExtensionBundleVersion=\"\">", "<ExtensionManifest ExtensionBundleVersion=2.0.1>", "<Autre ExtensionBundleVersion=\"2.0.1\">", "<ExtensionManifest ExtensionBundleVersion=\"2.0.1 ; rm\">"] {
            assert_eq!(version_manifeste_cep(x), None, "{x}");
        }
    }

    #[test]
    fn parcours_complet_avec_le_panneau_cep() {
        let d = tempfile::tempdir().unwrap();
        let emp = Emplacements::sous(d.path());
        let f = Factice::default();
        premiere_et_cc(&f);
        poser_cep(&emp, MANIFESTE_201);
        let exe = d.path().join("aethryon-desktop.exe");
        std::fs::write(&exe, b"MZ").unwrap();
        let ctx = Contexte { plateforme: &f, emp: &emp, exe: exe.clone(), premiere_manuel: None };
        let mut instantanes = 0;
        let r = executer(&ctx, &options(d.path()), &AtomicBool::new(false), &mut |_| instantanes += 1);
        assert!(r.reussi, "{:#?}", r.etapes);
        assert!(instantanes > 20, "progression publiée à chaque opération");
        assert!(r.etapes.iter().all(|e| e.etat == Etat::Ok), "{:#?}", r.etapes);
        assert_eq!((r.panneau.statut.as_str(), r.panneau.version.as_deref()), ("installe", Some("2.0.1")));
        let op = &r.etapes[0].operations[2];
        assert_eq!((op.libelle.as_str(), op.etat), ("Panneau AETHRYON", Etat::Ok));
        assert!(op.message.as_deref().unwrap().starts_with("Panneau AETHRYON 2.0.1 installé"), "{op:?}");
        assert_eq!(r.premiere.unwrap().version.as_deref(), Some("26.5.2.13"));
        let c = config::charger(&emp, "x").config;
        assert!(c.demarrage_auto && c.surveillance && c.notifications.media_pret && !c.notifications.import_reussi);
        assert!(config::charger_prive(&emp).assistant_termine);
        assert!(emp.index_json().is_file() && emp.manifeste_nm().is_file());
        // Plus de .ccx ni d'UPIA : rien de copié, aucun /install, aucun /list ; le panneau n'est jamais modifié.
        assert!(!emp.premiere().join("aethryon-premiere.ccx").exists());
        assert!(!f.appels().iter().any(|a| a.contains("/install") || a.contains("/list") || a.contains(".ccx")), "{:?}", f.appels());
        assert_eq!(std::fs::read_to_string(emp.extension_cep().join("CSXS").join("manifest.xml")).unwrap(), MANIFESTE_201);
        let textes = format!("{:?}", r.etapes);
        assert!(!textes.contains("Paquet") && !textes.contains("paquet"), "{textes}");
        // Réparer = même parcours, sans erreur (idempotent).
        let r2 = executer(&ctx, &options(d.path()), &AtomicBool::new(false), &mut |_| {});
        assert!(r2.reussi && r2.etapes.iter().all(|e| e.etat == Etat::Ok));
    }

    #[test]
    fn panneau_absent_renvoie_vers_aethryon_setup() {
        let d = tempfile::tempdir().unwrap();
        let emp = Emplacements::sous(d.path());
        let f = Factice::default();
        premiere_et_cc(&f);
        let exe = d.path().join("aethryon-desktop.exe");
        std::fs::write(&exe, b"MZ").unwrap();
        let ctx = Contexte { plateforme: &f, emp: &emp, exe, premiere_manuel: None };
        let r = executer(&ctx, &options(d.path()), &AtomicBool::new(false), &mut |_| {});
        assert!(r.reussi, "AETHRYON Desktop fonctionne sans le panneau");
        assert_eq!((r.panneau.statut.as_str(), r.panneau.message.as_str()), ("non-installe", PANNEAU_ABSENT));
        for (e, libelle) in [(0, "Panneau AETHRYON"), (1, "Panneau Premiere Pro (AETHRYON Setup)"), (4, "Panneau AETHRYON relu")] {
            let op = r.etapes[e].operations.iter().find(|o| o.libelle == libelle).unwrap();
            assert_eq!((op.etat, op.message.as_deref()), (Etat::AConfirmer, Some(PANNEAU_ABSENT)), "{op:?}");
        }
        assert!(!f.appels().iter().any(|a| a.starts_with("EXEC") || a.starts_with("OUVRIR")), "{:?}", f.appels());
        assert!(!format!("{:?}", r.etapes).contains("paquet du panneau"));
    }

    #[test]
    fn continuer_sans_le_panneau() {
        let d = tempfile::tempdir().unwrap();
        let emp = Emplacements::sous(d.path());
        let f = Factice::default();
        let exe = d.path().join("aethryon-desktop.exe");
        std::fs::write(&exe, b"MZ").unwrap();
        let ctx = Contexte { plateforme: &f, emp: &emp, exe, premiere_manuel: None };
        let r = executer(&ctx, &Options { demarrage_auto: false, installer_panneau: false, ..options(d.path()) }, &AtomicBool::new(false), &mut |_| {});
        assert!(r.reussi, "le Desktop fonctionne seul");
        assert_eq!(r.panneau.statut, "ignore");
        assert!(r.etapes.iter().all(|e| e.etat == Etat::Ok), "{:#?}", r.etapes);
        for (e, libelle) in [(0, "Panneau AETHRYON"), (1, "Panneau Premiere Pro (AETHRYON Setup)"), (4, "Panneau AETHRYON relu")] {
            assert_eq!(r.etapes[e].operations.iter().find(|o| o.libelle == libelle).unwrap().etat, Etat::Ignore);
        }
    }

    #[test]
    fn sans_premiere_ni_creative_cloud() {
        let d = tempfile::tempdir().unwrap();
        let emp = Emplacements::sous(d.path());
        let f = Factice::default();
        let exe = d.path().join("aethryon-desktop.exe");
        std::fs::write(&exe, b"MZ").unwrap();
        let ctx = Contexte { plateforme: &f, emp: &emp, exe, premiere_manuel: None };
        let r = executer(&ctx, &Options { demarrage_auto: false, ..options(d.path()) }, &AtomicBool::new(false), &mut |_| {});
        assert!(r.reussi, "le Desktop fonctionne seul");
        assert_eq!(r.panneau.statut, "ignore");
        assert_eq!(r.etapes[0].operations[0].etat, Etat::Ignore);
        assert!(!f.appels().iter().any(|a| a.starts_with("EXEC")), "aucun appel à UPIA");
    }

    #[test]
    fn dossier_non_inscriptible_bloque_et_annulation() {
        let d = tempfile::tempdir().unwrap();
        let emp = Emplacements::sous(d.path());
        let f = Factice::default();
        let fichier = d.path().join("pas-un-dossier");
        std::fs::write(&fichier, b"x").unwrap();
        let exe = d.path().join("e.exe");
        std::fs::write(&exe, b"MZ").unwrap();
        let ctx = Contexte { plateforme: &f, emp: &emp, exe, premiere_manuel: None };
        let mut o = options(d.path());
        o.dossier_medias = fichier.join("AETHRYON").to_string_lossy().into_owned();
        let r = executer(&ctx, &o, &AtomicBool::new(false), &mut |_| {});
        assert!(!r.reussi);
        assert_eq!(r.etapes[0].etat, Etat::Erreur);
        assert!(r.etapes[1..].iter().all(|e| e.etat == Etat::Attente), "rien n'est installé après une vérification bloquante");
        let r = executer(&ctx, &options(d.path()), &AtomicBool::new(true), &mut |_| {});
        assert!(r.annule && !r.reussi);
        assert!(!config::charger_prive(&emp).assistant_termine);
    }

    #[test]
    fn tailles() {
        assert_eq!(taille_lisible(845_654), "826\u{a0}Ko");
        assert_eq!(taille_lisible(82_565), "80,6\u{a0}Ko");
        assert_eq!(taille_lisible(182 * (1 << 30)), "182\u{a0}Go");
        assert_eq!(taille_lisible(12), "12\u{a0}octets");
    }
}

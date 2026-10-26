//! Désinstallation : retire tout ce que le setup a posé (et ce qu'AETHRYON Desktop crée à l'usage : clés Native
//! Messaging, démarrage automatique, données), en gardant les médias si l'utilisateur le demande. Le dossier géré de
//! l'extension navigateur (`%LOCALAPPDATA%\AETHRYON\extension`, chargé dans Chrome) n'est retiré QUE si
//! l'utilisateur l'a demandé (case de la confirmation, `--supprimer-extension-navigateur` en mode silencieux) : sans
//! lui, l'extension disparaîtrait de Chrome. Elle va jusqu'au
//! bout même si un élément résiste, et dit précisément ce qui reste.
//!
//! Le journal (`%LOCALAPPDATA%\AETHRYON\journaux`) est gardé : c'est la trace de la désinstallation.

use crate::detection::DESKTOP_EXE;
use crate::journal::Journal;
use crate::operations::{octets_lisibles, Avancement, Etat, Resultat, Suivi};
use crate::plateforme::*;
use crate::*;
use std::path::{Path, PathBuf};

const ETAPES: [(&str, &str, &str); 5] = [
    ("fermeture", "Fermeture", "AETHRYON Desktop est fermé s'il est ouvert."),
    ("extension", "Extension Premiere Pro", "Dossier de l'extension CEP de l'utilisateur."),
    ("desktop", "AETHRYON Desktop", "Application, raccourci, démarrage avec Windows, Native Messaging."),
    ("registre", "Applications installées", "Entrée de désinstallation de Windows."),
    ("donnees", "Données", "Préférences et bibliothèque ; médias selon votre choix."),
];

/// Nombre de fichiers et taille du dossier des médias (pour la confirmation « supprimer les médias »).
pub fn inventaire_medias(fs: &dyn Fs, dossier: &Path) -> (u64, u64) {
    let mut n = 0;
    let mut t = 0;
    let mut pile = vec![dossier.to_path_buf()];
    while let Some(d) = pile.pop() {
        for nom in fs.lister(&d).unwrap_or_default() {
            let p = d.join(&nom);
            match fs.type_de(&p) {
                Some(TypeEntree::Dossier) => pile.push(p),
                Some(TypeEntree::Fichier) => {
                    n += 1;
                    t += fs.taille(&p).unwrap_or(0);
                }
                _ => {}
            }
        }
    }
    (n, t)
}

fn dossier_medias(env: &Environnement, inv: Option<&Inventaire>) -> Option<PathBuf> {
    inv.map(|i| i.options.dossier_medias.clone()).or_else(|| crate::config_desktop::dossier_medias_actuel(env)).filter(|s| !s.trim().is_empty()).map(PathBuf::from)
}

/// Vrai si le dossier de l'extension est bien le nôtre (identifiant lu dans son manifeste).
fn extension_est_aethryon(env: &Environnement, d: &Path) -> bool {
    env.fs
        .lire(&d.join("CSXS").join("manifest.xml"))
        .ok()
        .and_then(|x| crate::zxp::lire_manifeste_cep(&String::from_utf8_lossy(&x)).ok())
        .map(|(id, _, _)| id == ID_EXTENSION)
        .unwrap_or(false)
}

pub fn desinstaller(env: &Environnement, garder_medias: bool, garder_navigateur: bool, journal: &Journal, rapport: &mut dyn FnMut(&Avancement)) -> Avancement {
    let mut s = Suivi::nouveau("desinstaller", &ETAPES, journal.clone(), rapport);
    let dossier = dossier_installation(env);
    let inv = lire_inventaire(env, &dossier);
    let version = env.registre.chaine(Racine::Hkcu, CLE_DESINSTALLATION, "DisplayVersion").unwrap_or_else(|| "inconnue".into());
    journal.info(&format!("=== Désinstallation d'AETHRYON {version} (médias gardés : {garder_medias}, extension navigateur gardée : {garder_navigateur})"));
    let medias = dossier_medias(env, inv.as_ref());
    let mut restes: Vec<String> = vec![];
    let retirer = |s: &mut Suivi, p: &Path, arbre: bool, restes: &mut Vec<String>| -> bool {
        if !env.fs.existe(p) {
            return false;
        }
        let r = if arbre { env.fs.supprimer_arbre(p) } else { env.fs.supprimer_fichier(p) };
        match r {
            Ok(()) => true,
            Err(e) => {
                s.journal.avert(&format!("Non retiré : {} ({e})", p.display()));
                restes.push(p.display().to_string());
                false
            }
        }
    };

    // 1. Fermeture
    s.commencer(0, 1);
    s.sous("AETHRYON Desktop");
    let n = if env.systeme.processus_present(DESKTOP_EXE) { env.systeme.fermer_processus(DESKTOP_EXE) } else { 0 };
    s.ok(Some(if n > 0 { format!("fermé ({n} processus)") } else { "n'était pas ouvert".into() }));
    s.avance(1);
    s.terminer_avec(if n > 0 { "AETHRYON Desktop a été fermé." } else { "AETHRYON Desktop n'était pas ouvert." });

    // 2. Extension
    s.commencer(1, 1);
    let ext = env.emplacements.dossier_extension();
    s.sous(&ext.display().to_string());
    match env.fs.type_de(&ext) {
        None => s.ok(Some("absente".into())),
        Some(TypeEntree::Lien) => {
            // Un lien (installation de développement) : on retire le lien, jamais sa cible.
            retirer(&mut s, &ext, true, &mut restes);
            s.ok(Some("lien retiré (sa cible est intacte)".into()));
        }
        Some(_) if extension_est_aethryon(env, &ext) || inv.as_ref().and_then(|i| i.dossier_extension.as_ref()).is_some() => {
            let ok = retirer(&mut s, &ext, true, &mut restes);
            s.ok(Some(if ok { "retirée".into() } else { "fichiers verrouillés : fermez Premiere Pro".into() }));
        }
        Some(_) => {
            s.sous_fin(Etat::Ignore, Some("ce dossier n'est pas l'extension AETHRYON : laissé intact".into()));
        }
    }
    if let Some(cep) = env.emplacements.dossier_extensions_cep().parent() {
        for nom in env.fs.lister(cep).unwrap_or_default() {
            if nom.starts_with("AETHRYON-preparation-") || nom.starts_with("AETHRYON-retour-arriere-") {
                retirer(&mut s, &cep.join(nom), true, &mut restes);
            }
        }
    }
    s.avance(1);
    let ext_reste = env.fs.existe(&ext);
    s.terminer_avec(if ext_reste { "Extension laissée en place (voir ci-dessus).".to_string() } else { format!("Plus rien dans {}.", crate::operations::court(env, &env.emplacements.dossier_extensions_cep())) });

    // 3. Desktop
    s.commencer(2, 4);
    s.sous("Application");
    let mut fichiers: Vec<PathBuf> = inv.as_ref().map(|i| i.fichiers.iter().map(|f| PathBuf::from(&f.chemin)).collect()).unwrap_or_default();
    for n in [DESKTOP_EXE, "WebView2Loader.dll", "desinstaller.exe"] {
        let p = dossier.join(n);
        if !fichiers.contains(&p) {
            fichiers.push(p);
        }
    }
    let mut n_retires = 0;
    for f in fichiers.iter().filter(|f| !f.ends_with(NOM_SETUP)) {
        if retirer(&mut s, f, false, &mut restes) {
            n_retires += 1;
        }
    }
    s.ok(Some(format!("{n_retires} fichier(s) retiré(s)")));
    s.avance(1);
    s.sous("Raccourci du menu Démarrer");
    let lnk = inv.as_ref().and_then(|i| i.raccourci.clone()).map(PathBuf::from).unwrap_or_else(|| env.emplacements.raccourci());
    let r = retirer(&mut s, &lnk, false, &mut restes);
    s.ok(Some(if r { "retiré".into() } else { "absent".into() }));
    s.avance(1);
    s.sous("Démarrage avec Windows");
    let _ = env.registre.supprimer_valeur(CLE_RUN, VALEUR_RUN);
    s.ok(Some(if env.registre.lire(Racine::Hkcu, CLE_RUN, VALEUR_RUN).is_none() { "retiré".into() } else { "toujours présent".into() }));
    s.avance(1);
    s.sous("Native Messaging (Chrome, Edge, Brave)");
    for c in CLES_NM {
        let _ = env.registre.supprimer_cle(c);
    }
    s.ok(None);
    s.avance(1);
    s.terminer_avec(format!("{n_retires} fichier(s), raccourci, démarrage avec Windows et Native Messaging retirés."));

    // 4. Registre
    s.commencer(3, 1);
    s.sous("Entrée « Applications installées »");
    let _ = env.registre.supprimer_cle(CLE_DESINSTALLATION);
    let _ = env.registre.supprimer_cle(CLE_ANCIENNE_BETA);
    let cle_ok = !env.registre.cle_existe(CLE_DESINSTALLATION);
    if !cle_ok {
        restes.push(format!("HKCU\\{CLE_DESINSTALLATION}"));
    }
    s.ok(Some(if cle_ok { "retirée".into() } else { "toujours présente".into() }));
    s.avance(1);
    s.terminer_avec(if cle_ok { "AETHRYON n'apparaît plus dans Paramètres › Applications." } else { "L'entrée de désinstallation n'a pas pu être retirée." });

    // 5. Données
    s.commencer(4, 5);
    s.sous("Préférences (%APPDATA%\\AETHRYON)");
    retirer(&mut s, &env.emplacements.donnees_itinerantes(), true, &mut restes);
    s.ok(None);
    s.avance(1);
    let local = env.emplacements.donnees_locales();
    let nav = crate::navigateur::dossier(env);
    let nav_present = env.fs.existe(&nav) || env.fs.existe(&crate::navigateur::precedente(env));
    s.sous("Extension navigateur (%LOCALAPPDATA%\\AETHRYON\\extension)");
    if !nav_present {
        s.ok(Some("absente".into()));
    } else if garder_navigateur {
        s.ok(Some("gardée, à votre demande : Chrome peut toujours la charger".into()));
    } else {
        let a = retirer(&mut s, &nav, true, &mut restes);
        retirer(&mut s, &crate::navigateur::precedente(env), true, &mut restes);
        s.ok(Some(if a || !env.fs.existe(&nav) { "retirée : supprimez-la aussi de chrome://extensions".into() } else { "fichiers verrouillés".into() }));
    }
    s.avance(1);
    s.sous("Bibliothèque et échanges (%LOCALAPPDATA%\\AETHRYON, journaux gardés)");
    for nom in env.fs.lister(&local).unwrap_or_default() {
        if !nom.eq_ignore_ascii_case("journaux") && !(garder_navigateur && crate::navigateur::est_dossier_navigateur(&nom)) {
            let p = local.join(&nom);
            let arbre = env.fs.est_dossier(&p);
            retirer(&mut s, &p, arbre, &mut restes);
        }
    }
    s.ok(None);
    s.avance(1);
    match (&medias, garder_medias) {
        (Some(m), true) => {
            s.sous("Médias");
            s.ok(Some(format!("gardés : {}", m.display())));
        }
        (Some(m), false) => {
            s.sous("Médias");
            let (n, t) = inventaire_medias(env.fs.as_ref(), m);
            let ok = retirer(&mut s, m, true, &mut restes);
            s.ok(Some(if ok { format!("supprimés : {n} fichier(s), {}", octets_lisibles(t)) } else { "absents ou verrouillés".into() }));
        }
        (None, _) => s.ignore("Médias", "aucun dossier configuré"),
    }
    s.avance(1);
    s.sous("Dossier d'installation");
    retirer(&mut s, &dossier, true, &mut restes);
    s.ok(Some(dossier.display().to_string()));
    s.avance(1);
    s.terminer_avec(match (garder_medias, garder_navigateur && nav_present) {
        (true, true) => "Préférences et bibliothèque retirées ; médias, extension navigateur et journal gardés.",
        (true, false) => "Préférences et bibliothèque retirées ; médias gardés, journal gardé.",
        (false, true) => "Préférences, bibliothèque et médias retirés ; extension navigateur et journal gardés.",
        (false, false) => "Préférences, bibliothèque et médias retirés ; journal gardé.",
    });

    s.av.termine = true;
    s.av.succes = cle_ok;
    s.av.resultat = Some(Resultat {
        version,
        dossier_medias: medias.map(|m| m.display().to_string()).unwrap_or_default(),
        dossier_installation: dossier.display().to_string(),
        avertissements: restes.iter().map(|r| format!("Non retiré (verrouillé ?) : {r}")).collect(),
        ..Default::default()
    });
    if !restes.is_empty() {
        s.av.erreur = Some(format!("{} élément(s) n'ont pas pu être retirés.", restes.len()));
    }
    journal.info(&format!("=== Désinstallation terminée ({} reste(s))", restes.len()));
    s.envoyer();
    s.av
}

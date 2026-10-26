//! Hôte Native Messaging `fr.aethryon.desktop` (contrat §6).
//!
//! Lancé par Chrome, Edge ou Brave (`aethryon-desktop.exe chrome-extension://<id>/ --parent-window=…`, ou explicitement
//! avec `--nm`), il lit des messages JSON précédés de leur longueur (u32 petit-boutiste) sur l'entrée standard et répond
//! de même sur la sortie standard. Messages, en liste fermée (contrat §6) :
//! - `ping` ; `transfert` (n'écrit que `R\transferts\<id>.json`) ;
//! - `etat-extension` : version du DOSSIER GÉRÉ de l'extension (`R\extension`), son chemin, la version précédente ;
//! - `mettre-a-jour-extension` (`version` seulement) : lit `latest.json` à l'adresse FIGÉE du site, télécharge,
//!   vérifie et installe l'archive dans `R\extension` (maj_extension). Avant la réponse finale, l'hôte envoie des
//!   messages `{"type":"avancement","etape","fait","total"}` (étapes réelles), sur ce même port.
//! - 3.8.1 (contrat §12, proposé) : `envoyer-premiere` (`id`, `url` de la PAGE de la vidéo, `format`, `debut`/`fin`
//!   en secondes, `titre`) écrit le transfert « attente » et dépose la commande `convertir-pour-premiere` pour le
//!   Desktop, qu'il lance s'il ne bat plus ; `etat-envoi` (`id`) rend l'état RÉEL lu dans `R\transferts\<id>.json`.
//! Règles :
//! - n'écrit QUE dans `R\transferts\`, dans `R\commandes\a-traiter\` (`convertir-pour-premiere`) et dans le
//!   dossier géré de l'extension et ses frères (`extension-precedente`, `extension-preparation-<pid>`) ; aucun
//!   journal, aucune configuration ;
//! - ne manipule jamais de jeton, et n'accepte JAMAIS de chemin ni d'adresse de fichier : les champs autorisés sont en
//!   liste fermée, tout autre champ fait refuser le message entier, sans en répéter la valeur ; seule adresse admise,
//!   celle de la page d'une vidéo YouTube, TikTok ou X dans `envoyer-premiere` (validée, jamais répétée) ;
//! - messages de 64 Kio au plus ; origine de l'appelant vérifiée quand le navigateur la donne.

use crate::atomique::Lecture;
use crate::battements;
use crate::chemins::Emplacements;
use crate::commandes;
use crate::conversion;
use crate::horloge;
use crate::maj_extension::{self, Etape, Source};
use crate::transferts::{self, Transfert};
use serde_json::{json, Map, Value};
use std::io::{self, Read, Write};
use std::path::Path;
use std::time::Instant;

pub const TAILLE_MAX: u32 = 64 * 1024;
const CHAMPS_TRANSFERT: [&str; 8] = ["type", "id", "titre", "plateforme", "format", "etat", "progression", "fichierAttendu"];
const CHAMPS_MISE_A_JOUR: [&str; 2] = ["type", "version"];
/// 3.8.1 : « Envoyer vers › Premiere Pro » relayé au Desktop (contrat §12, proposé).
pub const CHAMPS_ENVOI: [&str; 7] = ["type", "id", "url", "format", "debut", "fin", "titre"];
const CHAMPS_ETAT_ENVOI: [&str; 2] = ["type", "id"];
/// Envoi resté « attente » alors que le Desktop ne bat plus : il ne répond pas.
const SANS_DESKTOP_S: f64 = 90.0;
/// Ce que cet hôte sait faire (réponse à `ping`).
pub const CAPACITES: [&str; 6] = ["ping", "transfert", "etat-extension", "mettre-a-jour-extension", "envoyer-premiere", "etat-envoi"];

/// Ce dont l'hôte a besoin : emplacements du profil et source des mises à jour (production : `Source::production()`).
pub struct Contexte<'a> {
    pub emplacements: &'a Emplacements,
    pub source: &'a Source,
}

/// Vrai si l'argument est l'origine d'une extension autorisée (`chrome-extension://<id>/`).
pub fn origine_autorisee(arg: &str) -> bool {
    arg.strip_prefix("chrome-extension://")
        .map(|r| r.trim_end_matches('/'))
        .map(|id| crate::EXTENSIONS_AUTORISEES.contains(&id))
        .unwrap_or(false)
}

/// Mode hôte Native Messaging : `--nm` explicite, ou lancement par un navigateur (origine en argument).
pub fn est_mode_nm(args: &[String]) -> bool {
    args.iter().skip(1).any(|a| a == "--nm" || a.starts_with("chrome-extension://"))
}

/// Origine fournie par le navigateur, si présente.
pub fn origine(args: &[String]) -> Option<&str> {
    args.iter().skip(1).map(String::as_str).find(|a| a.starts_with("chrome-extension://"))
}

pub fn lire_message<R: Read>(r: &mut R) -> io::Result<Option<Vec<u8>>> {
    let mut l = [0u8; 4];
    match r.read_exact(&mut l) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let n = u32::from_le_bytes(l);
    if n > TAILLE_MAX {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "message trop long"));
    }
    let mut b = vec![0u8; n as usize];
    r.read_exact(&mut b)?;
    Ok(Some(b))
}

pub fn ecrire_message<W: Write>(w: &mut W, v: &Value) -> io::Result<()> {
    let b = serde_json::to_vec(v).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    w.write_all(&(b.len() as u32).to_le_bytes())?;
    w.write_all(&b)?;
    w.flush()
}

fn refus(message: &str) -> Value {
    json!({ "ok": false, "erreur": message })
}

/// Traite un message et renvoie la réponse. `transferts` est le SEUL dossier où l'on écrit.
pub fn traiter(message: &[u8], transferts_dir: &Path, desktop_actif: bool) -> Value {
    let Ok(Value::Object(o)) = serde_json::from_slice::<Value>(message) else {
        return refus("Message illisible : objet JSON attendu.");
    };
    match o.get("type").and_then(Value::as_str) {
        Some("ping") => json!({ "ok": true, "hote": crate::NOM_HOTE_NM, "version": crate::VERSION, "desktop": desktop_actif, "capacites": CAPACITES }),
        Some("transfert") => {
            if let Some(cle) = o.keys().find(|k| !CHAMPS_TRANSFERT.contains(&k.as_str())) {
                let cle: String = cle.chars().filter(|c| c.is_ascii_alphanumeric()).take(32).collect();
                return refus(&format!("Champ non autorisé : « {cle} ». Ce canal ne transporte ni jeton, ni adresse, ni chemin."));
            }
            let mut m: Map<String, Value> = o.clone();
            m.remove("type");
            m.insert("schema".into(), json!(1));
            m.insert("majLe".into(), json!(horloge::iso(horloge::maintenant())));
            let t = match serde_json::from_value::<Transfert>(Value::Object(m)).map_err(|_| "Transfert mal formé.".to_string()).and_then(Transfert::valider) {
                Ok(t) => t,
                Err(e) => return refus(&e),
            };
            // Un transfert déjà relié par le Desktop (`pret`, avec chemin) n'est pas rétrogradé par un message tardif.
            if let Some(c) = transferts::chemin_transfert(transferts_dir, &t.id) {
                if let Lecture::Lu(ancien) = crate::atomique::lire_json::<Transfert>(&c) {
                    if ancien.etat == "pret" && ancien.chemin.is_some() {
                        return json!({ "ok": true, "id": t.id, "etat": "pret" });
                    }
                }
            }
            match transferts::ecrire(transferts_dir, &t) {
                Ok(()) => json!({ "ok": true, "id": t.id, "etat": t.etat }),
                Err(e) => refus(&format!("Écriture impossible ({}).", e.kind())),
            }
        }
        _ => refus("Type de message inconnu."),
    }
}

/// Champ hors de la liste fermée : refus sans répéter sa valeur.
fn champ_refuse(o: &Map<String, Value>, permis: &[&str]) -> Option<Value> {
    o.keys().find(|k| !permis.contains(&k.as_str())).map(|cle| {
        let cle: String = cle.chars().filter(|c| c.is_ascii_alphanumeric()).take(32).collect();
        refus(&format!("Champ non autorisé : « {cle} ». Ce canal ne transporte ni jeton, ni adresse, ni chemin."))
    })
}

/// `etat-extension` : dossier géré, version en place et version précédente (lus dans leurs manifestes).
pub fn etat_extension(o: &Map<String, Value>, emp: &Emplacements) -> Value {
    if let Some(r) = champ_refuse(o, &["type"]) {
        return r;
    }
    let e = maj_extension::etat(emp);
    json!({ "ok": true, "dossier": e.dossier, "version": e.version, "precedente": e.precedente })
}

/// `mettre-a-jour-extension` : progression (`avancement`) écrite sur `w` au fil de l'eau, puis réponse finale rendue.
pub fn mettre_a_jour_extension<W: Write>(o: &Map<String, Value>, ctx: &Contexte, w: &mut W) -> Value {
    if let Some(r) = champ_refuse(o, &CHAMPS_MISE_A_JOUR) {
        return r;
    }
    let version = match o.get("version") {
        None => None,
        Some(Value::String(v)) if aethryon_archive_extension::version_valide(v) => Some(v.as_str()),
        Some(_) => return refus("Version mal formée."),
    };
    let mut derniere: Option<(Etape, Instant)> = None;
    let mut avance = |etape: Etape, fait: u64, total: u64| {
        let maintenant = Instant::now();
        let changee = derniere.is_none_or(|(e, _)| e != etape);
        let due = derniere.is_none_or(|(_, t)| maintenant.duration_since(t).as_millis() >= 150);
        if changee || due || fait >= total {
            derniere = Some((etape, maintenant));
            let _ = ecrire_message(w, &json!({ "type": "avancement", "etape": etape.nom(), "fait": fait, "total": total }));
        }
    };
    match maj_extension::mettre_a_jour(ctx.emplacements, ctx.source, version, &mut avance) {
        Ok(f) => json!({ "ok": true, "version": f.version, "dossier": f.dossier, "deja": f.deja, "precedente": f.precedente }),
        Err(e) => json!({ "ok": false, "erreur": e.message, "etape": e.etape.nom() }),
    }
}

/// `envoyer-premiere` : transfert « attente » écrit, commande `convertir-pour-premiere` déposée pour le Desktop, Desktop
/// lancé s'il ne bat plus (`lancer`). Rien n'est converti ici : c'est le Desktop qui convertit, avec SA clé.
pub fn envoyer_premiere(o: &Map<String, Value>, emp: &Emplacements, desktop_actif: bool, lancer: &dyn Fn() -> Result<(), String>) -> Value {
    if let Some(r) = champ_refuse(o, &CHAMPS_ENVOI) {
        return r;
    }
    let Some(id) = o.get("id").and_then(Value::as_str).filter(|i| transferts::id_valide(i)).map(String::from) else {
        return refus("Identifiant d'envoi refusé (lettres, chiffres, tirets, 64 caractères au plus).");
    };
    let url = match o.get("url").and_then(Value::as_str).map(conversion::valider_url) {
        Some(Ok(u)) => u,
        Some(Err(m)) => return refus(&m),
        None => return refus("Lien de la vidéo manquant."),
    };
    let format = match o.get("format") {
        None => "mp4",
        Some(Value::String(f)) if transferts::FORMATS.contains(&f.as_str()) => f.as_str(),
        Some(_) => return refus("Format refusé (mp4 ou mp3)."),
    }
    .to_string();
    let borne = |k: &str| -> Result<Option<f64>, ()> {
        match o.get(k) {
            None | Some(Value::Null) => Ok(None),
            Some(v) => v.as_f64().map(Some).ok_or(()),
        }
    };
    let extrait = match (borne("debut"), borne("fin")) {
        (Ok(a), Ok(b)) => match conversion::extrait_secondes(a, b) {
            Ok(x) => x,
            Err(m) => return refus(&m),
        },
        _ => return refus("Extrait refusé : début et fin attendus, en secondes."),
    };
    let titre = match o.get("titre") {
        None | Some(Value::Null) => None,
        Some(Value::String(t)) => Some(t.chars().filter(|c| !c.is_control()).take(transferts::TITRE_MAX).collect::<String>().trim().to_string()).filter(|t| !t.is_empty()),
        Some(_) => return refus("Titre refusé."),
    };
    let dir = emp.transferts();
    // Même envoi déjà en cours (réponse perdue, service worker relancé) : rien de plus, aucune seconde conversion.
    if let Some(c) = transferts::chemin_transfert(&dir, &id) {
        if let Lecture::Lu(t) = crate::atomique::lire_json::<Transfert>(&c) {
            if !t.termine() {
                return json!({ "ok": true, "id": id, "etat": "envoye", "desktop": desktop_actif, "deja": true });
            }
        }
    }
    let t0 = horloge::maintenant();
    let t = Transfert {
        schema: 1,
        id: id.clone(),
        titre: titre.clone(),
        plateforme: conversion::plateforme(&url).map(String::from),
        format: Some(format.clone()),
        etat: "attente".into(),
        progression: Some(0.0),
        fichier_attendu: None,
        chemin: None,
        erreur: None,
        maj_le: horloge::iso(t0),
        origine: Some("extension".into()),
        premiere: None,
        code: None,
        recus: None,
        total: None,
        vitesse: None,
        pause: None,
    };
    if let Err(e) = transferts::ecrire(&dir, &t) {
        return refus(&format!("Écriture impossible ({}).", e.kind()));
    }
    let d = conversion::Demande { id: id.clone(), url, format, extrait, titre, origine: "extension".into(), premiere: true };
    if let Err(e) = commandes::deposer_convertir(emp, &d, t0) {
        let _ = std::fs::remove_file(dir.join(format!("{id}.json")));
        return refus(&format!("Commande non écrite ({}).", e.kind()));
    }
    let lance = !desktop_actif && lancer().is_ok();
    json!({ "ok": true, "id": id, "etat": "envoye", "desktop": desktop_actif, "lance": lance })
}

/// `etat-envoi` : état RÉEL d'un envoi vers Premiere, lu dans `R\transferts\<id>.json` (écrit par le Desktop).
/// `envoye`, `conversion`, `telechargement` (progression de 0 à 1), `import`, puis `importe`, `premiere-absent`,
/// `sans-projet`, `non-relie`, `desktop-absent` ou `echec` (avec le message clair du Desktop).
pub fn etat_envoi(o: &Map<String, Value>, emp: &Emplacements, desktop_actif: bool) -> Value {
    if let Some(r) = champ_refuse(o, &CHAMPS_ETAT_ENVOI) {
        return r;
    }
    let Some(chemin) = o.get("id").and_then(Value::as_str).and_then(|i| transferts::chemin_transfert(&emp.transferts(), i)) else {
        return refus("Identifiant d'envoi refusé.");
    };
    let t = match crate::atomique::lire_json::<Transfert>(&chemin) {
        Lecture::Lu(t) => t,
        Lecture::Absent => return refus("Envoi inconnu d'AETHRYON Desktop."),
        // Écriture atomique : un fichier illisible est relu au passage suivant.
        Lecture::Illisible(_) => return json!({ "ok": true, "etat": "envoye" }),
    };
    let message = t.erreur.clone();
    let (etat, message) = match t.etat.as_str() {
        "attente" => {
            let vieux = horloge::age_secondes(&t.maj_le, horloge::maintenant()).is_some_and(|a| a > SANS_DESKTOP_S);
            if vieux && !desktop_actif {
                ("desktop-absent", Some("AETHRYON Desktop ne répond pas : ouvre-le, puis relance l'envoi.".to_string()))
            } else {
                ("envoye", None)
            }
        }
        "conversion" => ("conversion", None),
        "telechargement" => ("telechargement", None),
        "pret" => match t.premiere.as_deref() {
            Some("importe") => ("importe", None),
            Some("non-connecte") => ("premiere-absent", message),
            Some("sans-projet") => ("sans-projet", message),
            Some("echec") => ("echec", message),
            _ if !desktop_actif => ("echec", Some("AETHRYON Desktop s'est arrêté avant l'import : importe le fichier depuis le panneau AETHRYON de Premiere Pro.".to_string())),
            _ => ("import", None),
        },
        _ if t.code.as_deref() == Some("non_relie") => ("non-relie", message),
        _ => ("echec", message.or_else(|| Some("La conversion a échoué.".into()))),
    };
    let mut r = json!({ "ok": true, "id": t.id, "etat": etat });
    if matches!(etat, "envoye" | "conversion" | "telechargement") {
        if let Some(p) = t.progression.filter(|p| p.is_finite()) {
            r["progression"] = json!((p.clamp(0.0, 1.0) * 1000.0).round() / 1000.0);
        }
    }
    if let Some(m) = message {
        r["message"] = json!(m);
    }
    r
}

/// Lance AETHRYON Desktop (le même exécutable, réduit dans la zone de notification : `--arriere-plan`), détaché, sans
/// console, entrées et sorties fermées (jamais les tubes du navigateur). NON TESTÉ SOUS WINDOWS : si Chrome place
/// l'hôte dans un objet de tâche qui tue ses enfants, `CREATE_BREAKAWAY_FROM_JOB` est essayé d'abord.
pub fn lancer_desktop() -> Result<(), String> {
    use std::process::{Command, Stdio};
    let exe = std::env::current_exe().map_err(|e| format!("exécutable introuvable ({})", e.kind()))?;
    let mut c = Command::new(exe);
    c.arg("--arriere-plan").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
        c.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB);
        if c.spawn().is_ok() {
            return Ok(());
        }
        c.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    c.spawn().map(|_| ()).map_err(|e| format!("lancement impossible ({})", e.kind()))
}

/// Boucle de l'hôte : jusqu'à la fermeture de l'entrée standard par le navigateur.
pub fn executer<R: Read, W: Write>(r: &mut R, w: &mut W, ctx: &Contexte) -> io::Result<()> {
    executer_avec(r, w, ctx, &lancer_desktop)
}

/// Comme [`executer`], avec un autre lanceur du Desktop (essais).
pub fn executer_avec<R: Read, W: Write>(r: &mut R, w: &mut W, ctx: &Contexte, lancer: &dyn Fn() -> Result<(), String>) -> io::Result<()> {
    let transferts_dir = ctx.emplacements.transferts();
    let battement_desktop = ctx.emplacements.battement_desktop();
    loop {
        let message = match lire_message(r) {
            Ok(Some(m)) => m,
            Ok(None) => return Ok(()),
            Err(e) => {
                let _ = ecrire_message(w, &refus("Message refusé (trop long ou tronqué)."));
                return Err(e);
            }
        };
        let objet = match serde_json::from_slice::<Value>(&message) {
            Ok(Value::Object(o)) => Some(o),
            _ => None,
        };
        let actif = || match crate::atomique::lire_json::<battements::BattementDesktop>(&battement_desktop) {
            Lecture::Lu(b) => horloge::age_secondes(&b.battement, horloge::maintenant()).map(|a| a < battements::DESKTOP_FRAIS_S).unwrap_or(false),
            _ => false,
        };
        let vide = Map::new();
        let o = objet.as_ref().unwrap_or(&vide);
        let reponse = match objet.as_ref().and_then(|o| o.get("type")).and_then(Value::as_str) {
            Some("etat-extension") => etat_extension(o, ctx.emplacements),
            Some("mettre-a-jour-extension") => mettre_a_jour_extension(o, ctx, w),
            Some("envoyer-premiere") => envoyer_premiere(o, ctx.emplacements, actif(), lancer),
            Some("etat-envoi") => etat_envoi(o, ctx.emplacements, actif()),
            _ => traiter(&message, &transferts_dir, actif()),
        };
        ecrire_message(w, &reponse)?;
    }
}

/// Point d'entrée du mode hôte (`aethryon-desktop.exe --nm`, ou lancé par le navigateur avec l'origine en argument),
/// partagé par l'application et par le banc d'intégration. Codes : 0 fin normale, 1 message refusé ou tronqué,
/// 2 origine refusée, 3 profil introuvable.
pub fn principal(args: &[String]) -> i32 {
    principal_avec(args, &Source::production())
}

/// Comme `principal`, avec une autre source de mises à jour (banc Linux, fonctionnalité `essais`, seulement).
pub fn principal_avec(args: &[String], source: &Source) -> i32 {
    if let Some(o) = origine(args) {
        if !origine_autorisee(o) {
            eprintln!("AETHRYON : origine refusée.");
            return 2;
        }
    }
    let Some(emp) = crate::chemins::Emplacements::depuis_environnement() else {
        eprintln!("AETHRYON : profil utilisateur introuvable.");
        return 3;
    };
    let entree = io::stdin();
    let sortie = io::stdout();
    match executer(&mut entree.lock(), &mut sortie.lock(), &Contexte { emplacements: &emp, source }) {
        Ok(()) => 0,
        Err(_) => 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn trame(v: &Value) -> Vec<u8> {
        let mut o = Vec::new();
        ecrire_message(&mut o, v).unwrap();
        o
    }

    fn reponses(sortie: &[u8]) -> Vec<Value> {
        let mut c = Cursor::new(sortie.to_vec());
        let mut v = Vec::new();
        while let Some(m) = lire_message(&mut c).unwrap() {
            v.push(serde_json::from_slice(&m).unwrap());
        }
        v
    }

    #[test]
    fn origines_et_mode() {
        assert!(origine_autorisee("chrome-extension://necpohicddjeaeaaomaakehcbccapabg/"));
        assert!(origine_autorisee("chrome-extension://dnllfjakdgmgfiompaheickmbjjlgjdc/"));
        assert!(!origine_autorisee("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"));
        assert!(!origine_autorisee("https://exemple.fr/"));
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(est_mode_nm(&a(&["x.exe", "chrome-extension://necpohicddjeaeaaomaakehcbccapabg/", "--parent-window=0"])));
        assert!(est_mode_nm(&a(&["x.exe", "--nm"])));
        assert!(!est_mode_nm(&a(&["x.exe", "--assistant"])));
    }

    #[test]
    fn echange_complet() {
        let d = tempfile::tempdir().unwrap();
        let emp = Emplacements::sous(d.path());
        let tr = emp.transferts();
        let mut entree = Vec::new();
        entree.extend(trame(&json!({"type": "ping"})));
        entree.extend(trame(&json!({"type": "transfert", "id": "job-1", "titre": "Coucher de soleil", "plateforme": "youtube",
            "format": "mp4", "etat": "telechargement", "progression": 0.25, "fichierAttendu": "Coucher de soleil.mp4"})));
        entree.extend(trame(&json!({"type": "transfert", "id": "job-2", "etat": "attente", "jeton": "SECRET-NE-PAS-ECRIRE"})));
        entree.extend(trame(&json!({"type": "transfert", "id": "job-3", "etat": "attente", "url": "https://x/y?sig=SECRET"})));
        entree.extend(trame(&json!({"type": "transfert", "id": "../../evil", "etat": "attente"})));
        entree.extend(trame(&json!({"type": "lancer", "exe": "cmd"})));
        let mut sortie = Vec::new();
        executer(&mut Cursor::new(entree), &mut sortie, &Contexte { emplacements: &emp, source: &Source::production() }).unwrap();
        let r = reponses(&sortie);
        assert_eq!(r.len(), 6);
        assert_eq!(r[0]["ok"], true);
        assert_eq!(r[0]["desktop"], false);
        assert_eq!(r[1], json!({"ok": true, "id": "job-1", "etat": "telechargement"}));
        assert_eq!(r[2]["ok"], false);
        assert!(!r[2].to_string().contains("SECRET"), "la valeur refusée n'est jamais répétée");
        assert!(!r[3].to_string().contains("SECRET"));
        assert_eq!(r[4]["ok"], false);
        assert_eq!(r[5]["ok"], false);
        // Seul job-1 est écrit, et rien en dehors du dossier des transferts.
        let fichiers: Vec<_> = std::fs::read_dir(&tr).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        assert_eq!(fichiers, vec!["job-1.json".to_string()]);
        let tout: Vec<_> = std::fs::read_dir(&emp.racine).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(tout.len(), 1);
        let contenu = std::fs::read_to_string(tr.join("job-1.json")).unwrap();
        assert!(contenu.contains("\"fichierAttendu\": \"Coucher de soleil.mp4\""));
    }

    #[test]
    fn message_trop_long_ou_tronque() {
        let d = tempfile::tempdir().unwrap();
        let emp = Emplacements::sous(d.path());
        let ctx = Contexte { emplacements: &emp, source: &Source::production() };
        let mut entree = (TAILLE_MAX + 1).to_le_bytes().to_vec();
        entree.extend(vec![b' '; 16]);
        let mut sortie = Vec::new();
        assert!(executer(&mut Cursor::new(entree), &mut sortie, &ctx).is_err());
        assert_eq!(reponses(&sortie)[0]["ok"], false);
        let mut entree = 50u32.to_le_bytes().to_vec();
        entree.extend(b"{\"type\"");
        let mut sortie = Vec::new();
        assert!(executer(&mut Cursor::new(entree), &mut sortie, &ctx).is_err());
    }

    #[test]
    fn mise_a_jour_de_l_extension_par_l_hote() {
        use crate::maj_extension::essais::{publier, zip_extension, CLE_PROD};
        use crate::reseau::serveur_essai::Serveur;
        let s = Serveur::demarrer();
        let d = tempfile::tempdir().unwrap();
        let emp = Emplacements::sous(d.path());
        let src = Source::essai(&s.base, s.autorite.clone(), aethryon_archive_extension::ID_PRODUCTION);
        let z = zip_extension("3.6.1", CLE_PROD, &[]);
        publier(&s, "3.6.1", &z);
        let mut entree = Vec::new();
        entree.extend(trame(&json!({"type": "etat-extension"})));
        // Adresse ou chemin fournis par l'extension : refusés sans être répétés, rien n'est téléchargé.
        entree.extend(trame(&json!({"type": "mettre-a-jour-extension", "version": "3.6.1", "url": "https://ailleurs.example/x.zip"})));
        entree.extend(trame(&json!({"type": "mettre-a-jour-extension", "dossier": "C:\\Windows"})));
        entree.extend(trame(&json!({"type": "mettre-a-jour-extension", "version": "../3"})));
        entree.extend(trame(&json!({"type": "etat-extension", "chemin": "/etc"})));
        entree.extend(trame(&json!({"type": "mettre-a-jour-extension", "version": "3.6.1"})));
        entree.extend(trame(&json!({"type": "etat-extension"})));
        let mut sortie = Vec::new();
        executer(&mut Cursor::new(entree), &mut sortie, &Contexte { emplacements: &emp, source: &src }).unwrap();
        let r = reponses(&sortie);
        assert_eq!(r[0], json!({"ok": true, "dossier": emp.extension_geree().display().to_string(), "version": null, "precedente": null}));
        for x in &r[1..5] {
            assert_eq!(x["ok"], false, "{x}");
            assert!(!x.to_string().contains("ailleurs") && !x.to_string().contains("Windows") && !x.to_string().contains("/etc"));
        }
        let avancement: Vec<&Value> = r[5..].iter().filter(|x| x["type"] == "avancement").collect();
        let etapes: Vec<&str> = avancement.iter().map(|x| x["etape"].as_str().unwrap()).fold(vec![], |mut v, e| { if v.last() != Some(&e) { v.push(e) } v });
        assert_eq!(etapes, ["telechargement", "verification", "installation"]);
        let fin = r.iter().rev().nth(1).unwrap();
        assert_eq!(fin["ok"], true, "{fin}");
        assert_eq!(fin["version"], "3.6.1");
        assert_eq!(fin["deja"], false);
        assert_eq!(r.last().unwrap()["version"], "3.6.1");
        assert_eq!(s.vus("/aethryon-extension-3.6.1.zip"), 1, "une seule archive téléchargée");
    }

    #[test]
    fn transfert_pret_non_retrograde() {
        let d = tempfile::tempdir().unwrap();
        let mut t: Transfert = serde_json::from_value(json!({"schema": 1, "id": "j", "etat": "pret", "chemin": "C:\\M\\a.mp4", "majLe": ""})).unwrap();
        t.fichier_attendu = Some("a.mp4".into());
        transferts::ecrire(d.path(), &t).unwrap();
        let r = traiter(&serde_json::to_vec(&json!({"type": "transfert", "id": "j", "etat": "telechargement"})).unwrap(), d.path(), true);
        assert_eq!(r["etat"], "pret");
        assert_eq!(transferts::lister(d.path())[0].etat, "pret");
    }
}

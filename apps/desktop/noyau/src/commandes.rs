//! File de commandes (contrat §5) : `R\commandes\a-traiter\<horodatage>-<uuid>.json` puis `traitees\` avec le
//! résultat. Liste FERMÉE d'actions ; toute autre action est refusée et journalisée. Les médias sont désignés par leur
//! `id` d'index, jamais par un chemin libre : le destinataire relit le chemin dans l'index.

use crate::atomique::{self, Lecture};
use crate::chemins::Emplacements;
use crate::horloge::{self, Instant};
use crate::noms;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// Une commande non traitée après 2 minutes est expirée (le panneau peut être fermé).
pub const EXPIRATION_S: f64 = 120.0;
/// Garde des commandes traitées.
pub const GARDE_TRAITEES_JOURS: i64 = 7;
pub const SECTIONS: [&str; 5] = ["accueil", "bibliotheque", "transferts", "integrations", "parametres"];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Resultat {
    pub ok: bool,
    pub message: String,
    pub le: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Commande {
    pub schema: u32,
    pub id: String,
    pub de: String,
    pub pour: String,
    pub action: String,
    #[serde(default)]
    pub args: Value,
    pub cree_le: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resultat: Option<Resultat>,
}

/// Actions que le Desktop accepte (contrat §5, liste fermée).
#[derive(Clone, Debug, PartialEq)]
pub enum ActionDesktop {
    AfficherDansExplorateur { id: String },
    OuvrirDossierMedias,
    Rescanner,
    AjouterDossierSurveille { chemin: String },
    RetirerDossierSurveille { chemin: String },
    OuvrirDesktop { section: String },
    /// 3.8.1 (contrat §12, proposé) : déposée par l'hôte Native Messaging pour « Envoyer vers › Premiere Pro » de
    /// l'extension : conversion par le Desktop (sa clé), fichier dans le dossier des médias, puis commande `importer`.
    /// Seulement le lien de la PAGE de la vidéo : jamais de jeton ni d'adresse de fichier signée.
    ConvertirPourPremiere { demande: crate::conversion::Demande },
}

pub fn analyser_action(action: &str, args: &Value) -> Result<ActionDesktop, String> {
    let texte = |cle: &str| -> Result<String, String> {
        args.get(cle).and_then(Value::as_str).map(String::from).ok_or(format!("argument « {cle} » manquant"))
    };
    match action {
        "afficher-dans-explorateur" => {
            let id = texte("id")?;
            if !noms::est_id_valide(&id) {
                return Err("identifiant de média invalide".into());
            }
            Ok(ActionDesktop::AfficherDansExplorateur { id })
        }
        "ouvrir-dossier-medias" => Ok(ActionDesktop::OuvrirDossierMedias),
        "rescanner" => Ok(ActionDesktop::Rescanner),
        "ajouter-dossier-surveille" | "retirer-dossier-surveille" => {
            let chemin = texte("chemin")?;
            if !noms::est_absolu(&chemin) || chemin.len() > 1024 || chemin.contains("..") {
                return Err("chemin de dossier refusé (chemin complet attendu)".into());
            }
            Ok(if action.starts_with("ajouter") {
                ActionDesktop::AjouterDossierSurveille { chemin }
            } else {
                ActionDesktop::RetirerDossierSurveille { chemin }
            })
        }
        "ouvrir-desktop" => {
            let section = args.get("section").and_then(Value::as_str).unwrap_or("accueil").to_string();
            if !SECTIONS.contains(&section.as_str()) {
                return Err("section inconnue".into());
            }
            Ok(ActionDesktop::OuvrirDesktop { section })
        }
        "convertir-pour-premiere" => {
            const ARGS: [&str; 6] = ["transfert", "url", "format", "debutMs", "finMs", "titre"];
            if args.as_object().is_none_or(|o| o.keys().any(|k| !ARGS.contains(&k.as_str()))) {
                return Err("arguments hors de la liste autorisée".into());
            }
            let id = texte("transfert")?;
            if !crate::transferts::id_valide(&id) {
                return Err("identifiant de transfert invalide".into());
            }
            let url = crate::conversion::valider_url(&texte("url")?).map_err(|_| "lien refusé".to_string())?;
            let format = args.get("format").and_then(Value::as_str).unwrap_or("mp4").to_string();
            if !crate::transferts::FORMATS.contains(&format.as_str()) {
                return Err("format refusé".into());
            }
            let extrait = match (args.get("debutMs"), args.get("finMs")) {
                (None, None) => None,
                (Some(a), Some(b)) => crate::conversion::extrait_ms(a.as_u64().ok_or("extrait refusé")?, b.as_u64().ok_or("extrait refusé")?)?,
                _ => return Err("extrait refusé".into()),
            };
            let titre = match args.get("titre") {
                None | Some(Value::Null) => None,
                Some(Value::String(t)) => Some(t.chars().filter(|c| !c.is_control()).take(crate::transferts::TITRE_MAX).collect::<String>().trim().to_string()).filter(|t| !t.is_empty()),
                Some(_) => return Err("titre refusé".into()),
            };
            Ok(ActionDesktop::ConvertirPourPremiere {
                demande: crate::conversion::Demande { id, url, format, extrait, titre, origine: "extension".into(), premiere: true },
            })
        }
        _ => Err("action hors de la liste autorisée".into()),
    }
}

/// Nom de fichier d'une commande : `<horodatage>-<uuid>.json`.
pub fn nom_fichier(t: Instant, id: &str) -> String {
    format!("{}-{}.json", horloge::horodatage_fichier(t), id)
}

fn nom_valide(nom: &str) -> bool {
    nom.ends_with(".json") && !atomique::est_temporaire(nom) && noms::est_nom_propre(nom) && nom.len() < 128
}

/// Dépose une commande `importer` pour le panneau (import DEMANDÉ par l'utilisateur depuis le Desktop).
pub fn deposer_importer(emp: &Emplacements, ids: &[String], chutier: &str, t: Instant) -> std::io::Result<(String, Commande)> {
    let id = uuid::Uuid::new_v4().to_string();
    let c = Commande {
        schema: 1,
        id: id.clone(),
        de: "desktop".into(),
        pour: "panneau".into(),
        action: "importer".into(),
        args: json!({ "ids": ids, "chutier": chutier }),
        cree_le: horloge::iso(t),
        resultat: None,
    };
    let nom = nom_fichier(t, &id);
    atomique::ecrire_json(&emp.a_traiter().join(&nom), &c, true)?;
    Ok((nom, c))
}

/// 3.8.1 : dépose `convertir-pour-premiere` pour le Desktop (hôte Native Messaging). Renvoie le nom du fichier.
pub fn deposer_convertir(emp: &Emplacements, d: &crate::conversion::Demande, t: Instant) -> std::io::Result<String> {
    let id = uuid::Uuid::new_v4().to_string();
    let mut args = json!({ "transfert": d.id, "url": d.url, "format": d.format });
    if let Some((a, z)) = d.extrait {
        args["debutMs"] = json!(a);
        args["finMs"] = json!(z);
    }
    if let Some(titre) = &d.titre {
        args["titre"] = json!(titre);
    }
    let c = Commande { schema: 1, id: id.clone(), de: "navigateur".into(), pour: "desktop".into(), action: "convertir-pour-premiere".into(), args, cree_le: horloge::iso(t), resultat: None };
    let nom = nom_fichier(t, &id);
    atomique::ecrire_json(&emp.a_traiter().join(&nom), &c, true)?;
    Ok(nom)
}

/// Ce que le Desktop doit faire d'une commande entrante.
#[derive(Debug)]
pub enum Entrante {
    /// Commande pour le Desktop, valide : à exécuter puis clore avec [`clore`].
    Action { nom: String, commande: Commande, action: ActionDesktop },
    /// Refusée (action hors liste, arguments invalides) : déjà close avec un résultat négatif.
    Refusee { nom: String, action: String, raison: String },
    /// Commande du Desktop au panneau restée plus de 2 minutes : close comme expirée.
    Expiree { nom: String, commande: Commande },
}

/// Parcourt `a-traiter\`. Les fichiers illisibles sont laissés pour le passage suivant (jamais effacés).
pub fn relever(emp: &Emplacements, t: Instant) -> Vec<Entrante> {
    let mut sortie = Vec::new();
    let Ok(l) = std::fs::read_dir(emp.a_traiter()) else { return sortie };
    let mut noms_fichiers: Vec<String> = l.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| nom_valide(n)).collect();
    noms_fichiers.sort();
    for nom in noms_fichiers {
        let chemin = emp.a_traiter().join(&nom);
        let Lecture::Lu(c) = atomique::lire_json::<Commande>(&chemin) else { continue };
        if c.pour == "desktop" {
            match analyser_action(&c.action, &c.args) {
                Ok(action) => sortie.push(Entrante::Action { nom, commande: c, action }),
                Err(raison) => {
                    let action = c.action.chars().take(48).collect::<String>();
                    let _ = clore(emp, &nom, c, false, &format!("Refusée : {raison}."), t);
                    sortie.push(Entrante::Refusee { nom, action, raison });
                }
            }
        } else if c.pour == "panneau" && c.de == "desktop" {
            let age = horloge::age_secondes(&c.cree_le, t).unwrap_or(f64::MAX);
            if age > EXPIRATION_S && expirer(emp, &nom, c.clone(), t) {
                sortie.push(Entrante::Expiree { nom, commande: c });
            }
        }
    }
    sortie
}

/// Expire une commande du Desktop au panneau restée sans réponse. Comme le panneau (« prendre avant de traiter »),
/// le Desktop la PREND d'abord en la déplaçant dans `traitees\` : si le panneau l'a prise juste avant (course à
/// 2 minutes), le déplacement échoue et son résultat réel n'est jamais écrasé par « Expirée ».
fn expirer(emp: &Emplacements, nom: &str, mut c: Commande, t: Instant) -> bool {
    let _ = std::fs::create_dir_all(emp.traitees());
    if std::fs::rename(emp.a_traiter().join(nom), emp.traitees().join(nom)).is_err() {
        return false;
    }
    c.resultat = Some(Resultat {
        ok: false,
        message: "Expirée : le panneau AETHRYON n'a pas répondu en 2 minutes (Premiere fermé, aucun projet ouvert ou panneau caché).".into(),
        le: horloge::iso(t),
    });
    let _ = atomique::ecrire_json(&emp.traitees().join(nom), &c, true);
    true
}

/// Écrit la commande avec son résultat dans `traitees\` puis la retire de `a-traiter\`.
pub fn clore(emp: &Emplacements, nom: &str, mut c: Commande, ok: bool, message: &str, t: Instant) -> std::io::Result<()> {
    c.resultat = Some(Resultat { ok, message: message.to_string(), le: horloge::iso(t) });
    atomique::ecrire_json(&emp.traitees().join(nom), &c, true)?;
    match std::fs::remove_file(emp.a_traiter().join(nom)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

/// Lit le résultat d'une commande envoyée (dans `traitees\`), s'il existe.
pub fn resultat(emp: &Emplacements, nom: &str) -> Option<Commande> {
    if !nom_valide(nom) {
        return None;
    }
    atomique::lire_json::<Commande>(&emp.traitees().join(nom)).ok().filter(|c| c.resultat.is_some())
}

/// Commandes traitées de plus de 7 jours : retirées. Renvoie le nombre de fichiers retirés.
pub fn nettoyer_traitees(dossier: &Path, t: Instant) -> usize {
    let Ok(l) = std::fs::read_dir(dossier) else { return 0 };
    let limite = std::time::SystemTime::from(t) - std::time::Duration::from_secs(GARDE_TRAITEES_JOURS as u64 * 86_400);
    let vieux: Vec<PathBuf> = l
        .flatten()
        .filter(|e| e.metadata().and_then(|m| m.modified()).map(|m| m < limite).unwrap_or(false))
        .map(|e| e.path())
        .collect();
    vieux.iter().filter(|p| std::fs::remove_file(p).is_ok()).count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn deposer(emp: &Emplacements, nom: &str, v: Value) {
        atomique::ecrire_json(&emp.a_traiter().join(nom), &v, false).unwrap();
    }

    #[test]
    fn liste_fermee() {
        let id = "a".repeat(40);
        assert_eq!(analyser_action("afficher-dans-explorateur", &json!({"id": id})).unwrap(), ActionDesktop::AfficherDansExplorateur { id: id.clone() });
        assert!(analyser_action("afficher-dans-explorateur", &json!({"chemin": "C:\\Windows"})).is_err());
        assert!(analyser_action("afficher-dans-explorateur", &json!({"id": "C:\\Windows\\notepad.exe"})).is_err());
        assert!(analyser_action("lancer", &json!({"exe": "cmd.exe"})).is_err());
        assert!(analyser_action("importer", &json!({})).is_err(), "« importer » est pour le panneau, pas pour le Desktop");
        assert_eq!(analyser_action("ouvrir-desktop", &json!({"section": "bibliotheque"})).unwrap(), ActionDesktop::OuvrirDesktop { section: "bibliotheque".into() });
        assert!(analyser_action("ouvrir-desktop", &json!({"section": "../../x"})).is_err());
        assert!(analyser_action("ajouter-dossier-surveille", &json!({"chemin": "relatif"})).is_err());
        assert!(analyser_action("ajouter-dossier-surveille", &json!({"chemin": "C:\\a\\..\\Windows"})).is_err());
        assert!(analyser_action("ajouter-dossier-surveille", &json!({"chemin": "D:\\Rushes\\Voyage"})).is_ok());
        assert_eq!(analyser_action("rescanner", &json!({})).unwrap(), ActionDesktop::Rescanner);
    }

    #[test]
    fn cycle_complet() {
        let d = tempfile::tempdir().unwrap();
        let emp = Emplacements::sous(d.path());
        emp.creer_arborescence().unwrap();
        let t = horloge::lire("2026-10-18T03:00:00Z").unwrap();
        let ok = Commande { schema: 1, id: "u1".into(), de: "panneau".into(), pour: "desktop".into(), action: "rescanner".into(),
            args: json!({}), cree_le: horloge::iso(t), resultat: None };
        deposer(&emp, &nom_fichier(t, "u1"), serde_json::to_value(&ok).unwrap());
        let mauvaise = Commande { action: "executer".into(), id: "u2".into(), ..ok.clone() };
        deposer(&emp, &nom_fichier(t, "u2"), serde_json::to_value(&mauvaise).unwrap());
        std::fs::write(emp.a_traiter().join("20261018T030000000Z-u3.json"), b"{\"schema\":").unwrap();
        std::fs::write(emp.a_traiter().join("x.json.1-1.tmp"), b"{}").unwrap();
        let (nom_imp, _) = deposer_importer(&emp, &["b".repeat(40)], "aethryon", t).unwrap();

        let e = relever(&emp, t + chrono::Duration::seconds(1));
        assert_eq!(e.len(), 2, "{e:?}");
        let Entrante::Action { nom, commande, action } = &e[0] else { panic!() };
        assert_eq!(*action, ActionDesktop::Rescanner);
        clore(&emp, nom, commande.clone(), true, "Passage lancé.", t).unwrap();
        assert!(matches!(&e[1], Entrante::Refusee { action, .. } if action == "executer"));
        let refusee = resultat(&emp, &nom_fichier(t, "u2")).unwrap();
        assert!(!refusee.resultat.unwrap().ok);
        assert!(resultat(&emp, &nom_fichier(t, "u1")).unwrap().resultat.unwrap().ok);
        assert!(emp.a_traiter().join("20261018T030000000Z-u3.json").exists(), "illisible : laissé pour le passage suivant");
        assert!(resultat(&emp, &nom_imp).is_none(), "le panneau n'a pas encore répondu");

        // Le panneau ne répond pas : expirée après 2 minutes.
        let e = relever(&emp, t + chrono::Duration::seconds(121));
        assert!(e.iter().any(|x| matches!(x, Entrante::Expiree { nom, .. } if *nom == nom_imp)));
        let r = resultat(&emp, &nom_imp).unwrap();
        assert!(!r.resultat.as_ref().unwrap().ok && r.resultat.unwrap().message.starts_with("Expirée"));
        assert!(!emp.a_traiter().join(&nom_imp).exists());
        assert!(resultat(&emp, "..\\..\\config.json").is_none());
    }

    #[test]
    fn expiration_ne_remplace_jamais_le_resultat_du_panneau() {
        let d = tempfile::tempdir().unwrap();
        let emp = Emplacements::sous(d.path());
        emp.creer_arborescence().unwrap();
        let t = horloge::lire("2026-10-18T03:00:00Z").unwrap();
        let (nom, mut c) = deposer_importer(&emp, &["c".repeat(40)], "aethryon", t).unwrap();
        // Course : le panneau prend la commande (déplacement) et écrit son résultat juste avant l'expiration.
        std::fs::rename(emp.a_traiter().join(&nom), emp.traitees().join(&nom)).unwrap();
        c.resultat = Some(Resultat { ok: true, message: "1 importé dans « AETHRYON »".into(), le: horloge::iso(t) });
        atomique::ecrire_json(&emp.traitees().join(&nom), &c, false).unwrap();
        assert!(!expirer(&emp, &nom, c.clone(), t + chrono::Duration::seconds(121)), "déjà prise : rien n'est écrit");
        let r = resultat(&emp, &nom).unwrap().resultat.unwrap();
        assert!(r.ok && r.message.starts_with("1 importé"), "{r:?}");
    }
}

//! Préférences communes : `%APPDATA%\AETHRYON\config.json` (contrat d'échange, schéma 1, lu par AETHRYON Desktop et
//! par l'extension) et `desktop.json` (propre au Desktop). Le setup n'y change que ses champs ; toutes les autres
//! clés sont gardées telles quelles. Un fichier illisible n'est jamais écrasé en silence : il est mis de côté.

use crate::plateforme::Environnement;
use crate::{journal, Notifications, Options};
use serde_json::{json, Map, Value};
use std::path::PathBuf;

pub fn chemin_config(env: &Environnement) -> PathBuf {
    env.emplacements.donnees_itinerantes().join("config.json")
}

pub fn chemin_prive(env: &Environnement) -> PathBuf {
    env.emplacements.donnees_itinerantes().join("desktop.json")
}

fn lire_objet(env: &Environnement, p: &std::path::Path) -> Result<Option<Map<String, Value>>, ()> {
    match env.fs.lire(p) {
        Err(_) => Ok(None),
        Ok(d) => match serde_json::from_slice::<Value>(&d) {
            Ok(Value::Object(m)) => Ok(Some(m)),
            _ => Err(()),
        },
    }
}

pub fn dossier_medias_actuel(env: &Environnement) -> Option<String> {
    let m = lire_objet(env, &chemin_config(env)).ok()??;
    m.get("dossierMedias").and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty()).map(str::to_string)
}

/// Maintenance (Réparer, Mettre à jour) : les réglages changés dans AETHRYON Desktop depuis l'installation
/// (config.json) priment sur les choix gardés dans l'inventaire, qui ne reviennent jamais d'eux-mêmes. Valeur absente,
/// vide ou d'un autre type : celle de l'inventaire reste.
pub fn appliquer_preferences(env: &Environnement, o: &mut Options) {
    let Ok(Some(m)) = lire_objet(env, &chemin_config(env)) else { return };
    if let Some(d) = m.get("dossierMedias").and_then(Value::as_str).filter(|s| !s.trim().is_empty()) {
        o.dossier_medias = d.to_string();
    }
    if let Some(v) = m.get("surveillance").and_then(Value::as_bool) {
        o.surveillance = v;
    }
    if let Some(v) = m.get("demarrageAuto").and_then(Value::as_bool) {
        o.demarrage_auto = v;
    }
    if let Some(p) = [Notifications::Toutes, Notifications::Importantes, Notifications::Aucune].into_iter().find(|p| m.get("notifications") == Some(&notifications_json(*p))) {
        o.notifications = p;
    }
}

pub fn notifications_json(n: Notifications) -> Value {
    match n {
        Notifications::Toutes => json!({ "mediaPret": true, "importReussi": true, "erreurs": true }),
        Notifications::Importantes => json!({ "mediaPret": true, "importReussi": false, "erreurs": true }),
        Notifications::Aucune => json!({ "mediaPret": false, "importReussi": false, "erreurs": false }),
    }
}

/// Contenu fusionné de config.json, et éventuellement le nom sous lequel l'ancien fichier illisible a été rangé.
/// `maintenance` (Réparer, Mettre à jour) : des notifications réglées à la carte dans AETHRYON Desktop restent telles
/// quelles (les trois choix du setup ne les décrivent pas toutes).
pub fn fusionner_config(env: &Environnement, o: &Options, version_extension: Option<&str>, maintenance: bool) -> (Vec<u8>, Option<PathBuf>) {
    let p = chemin_config(env);
    let (mut m, illisible) = match lire_objet(env, &p) {
        Ok(Some(m)) => (m, None),
        Ok(None) => (Map::new(), None),
        Err(()) => (Map::new(), Some(p.with_file_name(format!("config.json.illisible-{}", journal::date_compacte())))),
    };
    m.entry("schema").or_insert(json!(1));
    m.insert("dossierMedias".into(), json!(o.dossier_medias));
    // Le dossier des médias est surveillé en premier ; les autres dossiers choisis dans le Desktop restent.
    let mut surv: Vec<String> = vec![o.dossier_medias.clone()];
    if let Some(Value::Array(a)) = m.get("dossiersSurveilles") {
        for v in a.iter().filter_map(|x| x.as_str()) {
            if !surv.iter().any(|s| s.eq_ignore_ascii_case(v)) {
                surv.push(v.to_string());
            }
        }
    }
    m.insert("dossiersSurveilles".into(), json!(surv));
    m.insert("surveillance".into(), json!(o.surveillance));
    m.insert("demarrageAuto".into(), json!(o.desktop && o.demarrage_auto));
    let a_la_carte = maintenance && m.get("notifications").and_then(Value::as_object).is_some_and(|n| ["mediaPret", "importReussi", "erreurs"].iter().all(|k| n.get(*k).is_some_and(Value::is_boolean)));
    if !a_la_carte {
        m.insert("notifications".into(), notifications_json(o.notifications));
    }
    if let Some(v) = version_extension {
        let mut pr = match m.remove("premiere") {
            Some(Value::Object(x)) => x,
            _ => Map::new(),
        };
        pr.insert("extensionCep".into(), json!({ "version": v, "dossier": env.emplacements.dossier_extension().to_string_lossy(), "installeeLe": journal::date_iso() }));
        m.insert("premiere".into(), Value::Object(pr));
    }
    (serde_json::to_vec_pretty(&Value::Object(m)).unwrap_or_default(), illisible)
}

/// desktop.json : le parcours d'installation du Desktop est déjà fait par le setup (il ne doit pas réinstaller
/// l'ancien panneau UXP au premier lancement).
pub fn fusionner_prive(env: &Environnement) -> Vec<u8> {
    let mut m = lire_objet(env, &chemin_prive(env)).ok().flatten().unwrap_or_default();
    m.insert("assistantTermine".into(), json!(true));
    m.insert("assistantTermineLe".into(), json!(journal::date_iso()));
    m.insert("installePar".into(), json!("AETHRYON Setup"));
    serde_json::to_vec_pretty(&Value::Object(m)).unwrap_or_default()
}

#[cfg(test)]
mod essais {
    use super::*;
    use crate::factice::Banc;
    use crate::plateforme::Fs;

    fn opts(d: &str) -> Options {
        Options { extension: true, desktop: true, dossier_medias: d.into(), surveillance: false, demarrage_auto: true, notifications: Notifications::Aucune }
    }

    #[test]
    fn fusion_garde_les_cles_inconnues() {
        let b = Banc::nouveau();
        let p = chemin_config(&b.env);
        b.fs.poser(&p, br#"{"schema":1,"dossierMedias":"C:\\Ancien","dossiersSurveilles":["C:\\Ancien","D:\\Rushes"],"theme":"sombre","inconnu":{"a":1}}"#);
        assert_eq!(dossier_medias_actuel(&b.env).as_deref(), Some("C:\\Ancien"));
        let (d, illisible) = fusionner_config(&b.env, &opts("C:\\Users\\Élodie\\Videos\\AETHRYON"), Some("1.0.0"), false);
        assert!(illisible.is_none());
        let v: Value = serde_json::from_slice(&d).unwrap();
        assert_eq!(v["theme"], "sombre");
        assert_eq!(v["inconnu"]["a"], 1);
        assert_eq!(v["dossiersSurveilles"], json!(["C:\\Users\\Élodie\\Videos\\AETHRYON", "C:\\Ancien", "D:\\Rushes"]));
        assert_eq!(v["notifications"]["mediaPret"], false);
        assert_eq!(v["premiere"]["extensionCep"]["version"], "1.0.0");
        assert_eq!(v["surveillance"], false);
    }

    #[test]
    fn preferences_du_desktop_seulement_si_valides() {
        let b = Banc::nouveau();
        let mut o = opts("C:\\Inventaire");
        appliquer_preferences(&b.env, &mut o);
        assert_eq!(o, opts("C:\\Inventaire"), "sans config.json : l'inventaire");
        b.fs.poser(chemin_config(&b.env), br#"{"dossierMedias":"  ","surveillance":"non","demarrageAuto":null,"notifications":{"mediaPret":true}}"#);
        appliquer_preferences(&b.env, &mut o);
        assert_eq!(o, opts("C:\\Inventaire"), "valeurs vides ou d'un autre type : l'inventaire");
        b.fs.poser(chemin_config(&b.env), br#"{"dossierMedias":"D:\\M","surveillance":true,"demarrageAuto":false,"notifications":{"mediaPret":true,"importReussi":true,"erreurs":true}}"#);
        appliquer_preferences(&b.env, &mut o);
        assert_eq!((o.dossier_medias.as_str(), o.surveillance, o.demarrage_auto, o.notifications), ("D:\\M", true, false, Notifications::Toutes));
    }

    #[test]
    fn fichier_illisible_mis_de_cote() {
        let b = Banc::nouveau();
        b.fs.poser(chemin_config(&b.env), b"{ pas du json");
        let (d, illisible) = fusionner_config(&b.env, &opts("C:\\M"), None, false);
        assert!(illisible.unwrap().to_string_lossy().contains("config.json.illisible-"));
        let v: Value = serde_json::from_slice(&d).unwrap();
        assert_eq!(v["schema"], 1);
        b.fs.poser(chemin_prive(&b.env), br#"{"premiereExeManuel":"D:\\P.exe"}"#);
        let v: Value = serde_json::from_slice(&fusionner_prive(&b.env)).unwrap();
        assert_eq!(v["assistantTermine"], true);
        assert_eq!(v["premiereExeManuel"], "D:\\P.exe");
        assert!(b.fs.existe(&chemin_config(&b.env)));
    }
}

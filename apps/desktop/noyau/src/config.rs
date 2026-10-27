//! `%APPDATA%\AETHRYON\config.json` (contrat §2, schema 1) : écrit par le Desktop, lu par le panneau.
//! Les clés inconnues sont conservées telles quelles. Un fichier illisible n'est jamais écrasé en silence : il est mis
//! de côté (`config.json.illisible`) et le Desktop repart des valeurs par défaut.
//!
//! `desktop.json` (même dossier) garde ce qui ne regarde que le Desktop : assistant terminé, chemin de Premiere indiqué
//! à la main. Il est hors contrat et le panneau ne le lit pas.

use crate::atomique::{self, Lecture};
use crate::chemins::Emplacements;
use crate::noms;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::Path;

pub const THEMES: [&str; 3] = ["systeme", "clair", "sombre"];
pub const ANIMATIONS: [&str; 3] = ["systeme", "oui", "non"];
pub const CHUTIERS: [&str; 3] = ["aethryon", "selection", "racine"];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Notifications {
    #[serde(default = "vrai")]
    pub media_pret: bool,
    #[serde(default)]
    pub import_reussi: bool,
    #[serde(default = "vrai")]
    pub erreurs: bool,
}

impl Default for Notifications {
    fn default() -> Self {
        Self { media_pret: true, import_reussi: false, erreurs: true }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PremiereConfig {
    #[serde(default)]
    pub ccx_installe: Option<String>,
    #[serde(default)]
    pub installe_le: Option<String>,
}

fn vrai() -> bool {
    true
}
fn un() -> u32 {
    1
}
fn systeme() -> String {
    "systeme".into()
}
fn aethryon() -> String {
    "aethryon".into()
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    #[serde(default = "un")]
    pub schema: u32,
    #[serde(default)]
    pub dossier_medias: String,
    #[serde(default)]
    pub dossiers_surveilles: Vec<String>,
    #[serde(default = "vrai")]
    pub surveillance: bool,
    #[serde(default)]
    pub demarrage_auto: bool,
    #[serde(default)]
    pub notifications: Notifications,
    #[serde(default = "systeme")]
    pub theme: String,
    #[serde(default = "systeme")]
    pub reduire_animations: String,
    /// Désactivé par défaut : le brief interdit l'import non sollicité (contrat §2).
    #[serde(default)]
    pub import_auto: bool,
    #[serde(default = "aethryon")]
    pub chutier_par_defaut: String,
    #[serde(default)]
    pub premiere: PremiereConfig,
    /// Clés inconnues : conservées.
    #[serde(flatten)]
    pub autres: Map<String, Value>,
}

impl Config {
    pub fn defaut(dossier_medias: &str) -> Self {
        Self {
            schema: 1,
            dossier_medias: dossier_medias.to_string(),
            dossiers_surveilles: vec![dossier_medias.to_string()],
            surveillance: true,
            demarrage_auto: false,
            notifications: Notifications::default(),
            theme: systeme(),
            reduire_animations: systeme(),
            import_auto: false,
            chutier_par_defaut: aethryon(),
            premiere: PremiereConfig::default(),
            autres: Map::new(),
        }
    }

    /// Remet d'aplomb les valeurs hors liste et garde l'invariant « le dossier des médias est surveillé en premier ».
    /// Renvoie la liste des corrections (pour le journal).
    pub fn normaliser(&mut self, dossier_par_defaut: &str) -> Vec<String> {
        let mut corr = Vec::new();
        self.schema = 1;
        if self.dossier_medias.trim().is_empty() || !noms::est_absolu(&self.dossier_medias) {
            corr.push("dossierMedias absent ou relatif : dossier par défaut".into());
            self.dossier_medias = dossier_par_defaut.to_string();
        }
        if !THEMES.contains(&self.theme.as_str()) {
            corr.push(format!("theme inconnu : {}", self.theme));
            self.theme = systeme();
        }
        if !ANIMATIONS.contains(&self.reduire_animations.as_str()) {
            corr.push(format!("reduireAnimations inconnu : {}", self.reduire_animations));
            self.reduire_animations = systeme();
        }
        if !CHUTIERS.contains(&self.chutier_par_defaut.as_str()) {
            corr.push(format!("chutierParDefaut inconnu : {}", self.chutier_par_defaut));
            self.chutier_par_defaut = aethryon();
        }
        let mut vus: Vec<String> = Vec::new();
        let mut liste = vec![self.dossier_medias.clone()];
        liste.extend(self.dossiers_surveilles.iter().cloned());
        let mut propres = Vec::new();
        for d in liste {
            let cle = noms::normaliser_pour_id(d.trim_end_matches(['\\', '/']));
            if d.trim().is_empty() || !noms::est_absolu(&d) || vus.contains(&cle) {
                continue;
            }
            vus.push(cle);
            propres.push(d);
        }
        if propres != self.dossiers_surveilles {
            self.dossiers_surveilles = propres;
        }
        corr
    }

    /// Applique une modification partielle venue de l'interface. Seules les clés connues sont acceptées, avec leur type.
    pub fn appliquer(&mut self, patch: &Value) -> Result<(), String> {
        let obj = patch.as_object().ok_or("modification attendue sous forme d'objet")?;
        let mut copie = self.clone();
        for (cle, v) in obj {
            match cle.as_str() {
                "dossierMedias" => {
                    let s = v.as_str().ok_or("dossierMedias : texte attendu")?;
                    if !noms::est_absolu(s) {
                        return Err("Le dossier des médias doit être un chemin complet.".into());
                    }
                    let ancien = copie.dossier_medias.clone();
                    copie.dossier_medias = s.to_string();
                    copie.dossiers_surveilles.retain(|d| noms::normaliser_pour_id(d) != noms::normaliser_pour_id(&ancien));
                }
                "dossiersSurveilles" => {
                    let l = v.as_array().ok_or("dossiersSurveilles : liste attendue")?;
                    copie.dossiers_surveilles =
                        l.iter().map(|x| x.as_str().map(String::from).ok_or("dossiersSurveilles : textes attendus")).collect::<Result<_, _>>()?;
                }
                "surveillance" => copie.surveillance = v.as_bool().ok_or("surveillance : booléen attendu")?,
                "demarrageAuto" => copie.demarrage_auto = v.as_bool().ok_or("demarrageAuto : booléen attendu")?,
                "importAuto" => copie.import_auto = v.as_bool().ok_or("importAuto : booléen attendu")?,
                "theme" => copie.theme = choix(v, &THEMES, "theme")?,
                "reduireAnimations" => copie.reduire_animations = choix(v, &ANIMATIONS, "reduireAnimations")?,
                "chutierParDefaut" => copie.chutier_par_defaut = choix(v, &CHUTIERS, "chutierParDefaut")?,
                "notifications" => {
                    let o = v.as_object().ok_or("notifications : objet attendu")?;
                    for (k, b) in o {
                        let b = b.as_bool().ok_or("notifications : booléens attendus")?;
                        match k.as_str() {
                            "mediaPret" => copie.notifications.media_pret = b,
                            "importReussi" => copie.notifications.import_reussi = b,
                            "erreurs" => copie.notifications.erreurs = b,
                            _ => return Err(format!("notifications : clé inconnue « {k} »")),
                        }
                    }
                }
                autre => return Err(format!("Réglage inconnu : « {autre} »")),
            }
        }
        let defaut = copie.dossier_medias.clone();
        copie.normaliser(&defaut);
        *self = copie;
        Ok(())
    }
}

fn choix(v: &Value, liste: &[&str], nom: &str) -> Result<String, String> {
    let s = v.as_str().ok_or(format!("{nom} : texte attendu"))?;
    if liste.contains(&s) {
        Ok(s.to_string())
    } else {
        Err(format!("{nom} : valeur refusée « {s} »"))
    }
}

/// Résultat du chargement de la configuration.
pub struct Chargement {
    pub config: Config,
    /// `false` si aucun fichier n'existait (premier lancement).
    pub existait: bool,
    /// Messages pour le journal (aucune donnée sensible).
    pub remarques: Vec<String>,
}

pub fn charger(emp: &Emplacements, dossier_par_defaut: &str) -> Chargement {
    let chemin = emp.config_json();
    let mut remarques = Vec::new();
    let (mut config, existait) = match atomique::lire_json::<Config>(&chemin) {
        Lecture::Lu(c) => (c, true),
        Lecture::Absent => (Config::defaut(dossier_par_defaut), false),
        Lecture::Illisible(m) => {
            let copie = chemin.with_file_name("config.json.illisible");
            let _ = std::fs::rename(&chemin, &copie);
            remarques.push(format!("config.json {m} : mis de côté en config.json.illisible, valeurs par défaut"));
            (Config::defaut(dossier_par_defaut), false)
        }
    };
    remarques.extend(config.normaliser(dossier_par_defaut));
    Chargement { config, existait, remarques }
}

pub fn enregistrer(emp: &Emplacements, config: &Config) -> std::io::Result<()> {
    atomique::ecrire_json(&emp.config_json(), config, true)
}

/// Réglages propres au Desktop (hors contrat).
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Prive {
    pub assistant_termine: bool,
    pub assistant_termine_le: Option<String>,
    /// Chemin de « Adobe Premiere Pro.exe » indiqué à la main dans l'assistant (dossier non standard).
    pub premiere_exe_manuel: Option<String>,
    #[serde(flatten)]
    pub autres: Map<String, Value>,
}

pub fn charger_prive(emp: &Emplacements) -> Prive {
    atomique::lire_json::<Prive>(&emp.prive_json()).ok().unwrap_or_default()
}

pub fn enregistrer_prive(emp: &Emplacements, p: &Prive) -> std::io::Result<()> {
    atomique::ecrire_json(&emp.prive_json(), p, true)
}

/// Vrai si on peut écrire dans le dossier (fichier témoin créé puis retiré). Message clair sinon.
pub fn tester_ecriture(dossier: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dossier).map_err(|e| message_ecriture(dossier, &e))?;
    let temoin = dossier.join(format!(".aethryon-temoin-{}.tmp", std::process::id()));
    std::fs::write(&temoin, b"AETHRYON").map_err(|e| message_ecriture(dossier, &e))?;
    let _ = std::fs::remove_file(&temoin);
    Ok(())
}

fn message_ecriture(dossier: &Path, e: &std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::PermissionDenied {
        format!(
            "Windows refuse l'écriture dans « {} ». Si l'« Accès contrôlé aux dossiers » de Microsoft Defender est actif, \
             autorisez AETHRYON Desktop (Sécurité Windows › Protection contre les virus et menaces › Gérer la protection \
             contre les ransomware › Autoriser une application), ou choisissez un autre dossier.",
            dossier.display()
        )
    } else {
        format!("Impossible d'écrire dans « {} » ({}).", dossier.display(), e.kind())
    }
}

/// Égide : couleur `#RRGGBB` → [r, g, b] (fond natif de la fenêtre, commande `fenetre_fond`) ; tout le reste est refusé.
pub fn couleur_hex(s: &str) -> Option<[u8; 3]> {
    let h = s.strip_prefix('#')?;
    if h.len() != 6 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let v = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok();
    Some([v(0)?, v(2)?, v(4)?])
}

#[cfg(test)]
mod tests {
    #[test]
    fn couleur_hex_seulement_rrggbb() {
        assert_eq!(super::couleur_hex("#101113"), Some([0x10, 0x11, 0x13]));
        assert_eq!(super::couleur_hex("#FAF8f3"), Some([0xfa, 0xf8, 0xf3]));
        for mauvais in ["", "#fff", "101113", "#1011134", "#10111g", "url(x)", "#10 113", "red"] {
            assert_eq!(super::couleur_hex(mauvais), None, "{mauvais}");
        }
    }

    use super::*;
    use serde_json::json;

    const DEF: &str = "C:\\Users\\Élodie\\Downloads\\AETHRYON";

    #[test]
    fn forme_du_contrat() {
        let c = Config::defaut(DEF);
        let v = serde_json::to_value(&c).unwrap();
        for k in [
            "schema", "dossierMedias", "dossiersSurveilles", "surveillance", "demarrageAuto", "notifications", "theme",
            "reduireAnimations", "importAuto", "chutierParDefaut", "premiere",
        ] {
            assert!(v.get(k).is_some(), "clé {k} manquante");
        }
        assert_eq!(v["importAuto"], false);
        assert_eq!(v["chutierParDefaut"], "aethryon");
        assert_eq!(v["notifications"], json!({"mediaPret": true, "importReussi": false, "erreurs": true}));
        assert_eq!(v["premiere"], json!({"ccxInstalle": null, "installeLe": null}));
        assert_eq!(v["dossiersSurveilles"], json!([DEF]));
    }

    #[test]
    fn cles_inconnues_conservees_et_valeurs_corrigees() {
        let brut = json!({"schema": 1, "dossierMedias": DEF, "theme": "fluo", "chutierParDefaut": "x", "futur": {"a": 1},
                          "dossiersSurveilles": ["D:\\Rushes", DEF, "d:\\rushes", "relatif"]});
        let mut c: Config = serde_json::from_value(brut).unwrap();
        let corr = c.normaliser(DEF);
        assert_eq!(corr.len(), 2);
        assert_eq!(c.theme, "systeme");
        assert_eq!(c.chutier_par_defaut, "aethryon");
        assert_eq!(c.dossiers_surveilles, vec![DEF.to_string(), "D:\\Rushes".to_string()]);
        assert_eq!(serde_json::to_value(&c).unwrap()["futur"], json!({"a": 1}));
    }

    #[test]
    fn modification_partielle() {
        let mut c = Config::defaut(DEF);
        c.appliquer(&json!({"theme": "clair", "notifications": {"importReussi": true}, "demarrageAuto": true})).unwrap();
        assert_eq!(c.theme, "clair");
        assert!(c.notifications.import_reussi && c.notifications.media_pret && c.demarrage_auto);
        assert!(c.appliquer(&json!({"theme": "fluo"})).is_err());
        assert!(c.appliquer(&json!({"inconnu": 1})).is_err());
        assert!(c.appliquer(&json!({"dossierMedias": "relatif"})).is_err());
        assert_eq!(c.theme, "clair", "une modification refusée ne laisse aucune trace");
        c.appliquer(&json!({"dossierMedias": "D:\\Médias AETHRYON"})).unwrap();
        assert_eq!(c.dossiers_surveilles, vec!["D:\\Médias AETHRYON".to_string()]);
    }

    #[test]
    fn chargement_tolerant() {
        let d = tempfile::tempdir().unwrap();
        let e = Emplacements::sous(d.path());
        let ch = charger(&e, DEF);
        assert!(!ch.existait);
        enregistrer(&e, &ch.config).unwrap();
        assert!(charger(&e, DEF).existait);
        std::fs::write(e.config_json(), b"{\"schema\": 1, \"theme\"").unwrap();
        let ch = charger(&e, DEF);
        assert!(!ch.existait && ch.remarques.iter().any(|r| r.contains("illisible")));
        assert!(e.config.join("config.json.illisible").exists(), "le fichier illisible est gardé de côté");
        let mut p = charger_prive(&e);
        assert!(!p.assistant_termine);
        p.assistant_termine = true;
        enregistrer_prive(&e, &p).unwrap();
        assert!(charger_prive(&e).assistant_termine);
        assert!(tester_ecriture(&d.path().join("Médias")).is_ok());
    }
}

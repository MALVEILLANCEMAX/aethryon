//! Battements (contrat §4). Le Desktop écrit `etat/desktop.json` toutes les 2 s ; il lit `etat/panneau.json`
//! (« Premiere connecté » si le battement a moins de 15 s, contrat v1.1 §9) et `etat/imports.json` (état « Importé »).

use crate::atomique::{self, Lecture};
use crate::chemins::Emplacements;
use crate::horloge::{self, Instant};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Âge maximal du battement du panneau pour dire « Premiere connecté » : 15 s (contrat v1.1 §9, accepté le 18 octobre :
/// un panneau caché bat toutes les 10 s). Le même seuil décide si « Envoyer vers Premiere » part ou non (flux).
pub const PANNEAU_FRAIS_S: f64 = 15.0;
/// Âge maximal du battement du Desktop vu par le panneau (rappel du contrat, employé par l'hôte Native Messaging).
pub const DESKTOP_FRAIS_S: f64 = 6.0;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct PremiereEtat {
    pub detecte: bool,
    pub version: Option<String>,
    pub compatible: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BattementDesktop {
    pub schema: u32,
    pub pid: u32,
    pub version: String,
    pub battement: String,
    pub dossier_medias: String,
    pub premiere: PremiereEtat,
}

impl BattementDesktop {
    pub fn nouveau(dossier_medias: &str, premiere: PremiereEtat, t: Instant) -> Self {
        Self {
            schema: 1,
            pid: std::process::id(),
            version: crate::VERSION.to_string(),
            battement: horloge::iso_ms(t),
            dossier_medias: dossier_medias.to_string(),
            premiere,
        }
    }
}

pub fn ecrire_desktop(emp: &Emplacements, b: &BattementDesktop) -> std::io::Result<()> {
    atomique::ecrire_json(&emp.battement_desktop(), b, false)
}

/// Battement du panneau : lu avec tolérance (champs facultatifs), il vient d'un autre programme.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct BattementPanneau {
    pub schema: u32,
    pub version: Option<String>,
    pub battement: String,
    pub premiere_version: Option<String>,
    pub projet_ouvert: Option<bool>,
    pub projet: Option<String>,
    pub visible: Option<bool>,
}

impl BattementPanneau {
    pub fn age(&self, t: Instant) -> Option<f64> {
        horloge::age_secondes(&self.battement, t)
    }
    /// « Premiere connecté » : battement de moins de 15 s (et pas venu du futur de plus de 5 s).
    pub fn connecte(&self, t: Instant) -> bool {
        self.age(t).map(|a| a > -5.0 && a < PANNEAU_FRAIS_S).unwrap_or(false)
    }
}

pub fn lire_panneau(emp: &Emplacements) -> Lecture<BattementPanneau> {
    atomique::lire_json(&emp.battement_panneau())
}

pub fn lire_desktop(emp: &Emplacements) -> Lecture<BattementDesktop> {
    atomique::lire_json(&emp.battement_desktop())
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(default)]
pub struct ImportFait {
    pub projet: Option<String>,
    pub chutier: Option<String>,
    pub le: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(default)]
pub struct Imports {
    pub schema: u32,
    pub imports: BTreeMap<String, Vec<ImportFait>>,
}

pub fn lire_imports(emp: &Emplacements) -> Lecture<Imports> {
    atomique::lire_json(&emp.imports_json())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn battement_desktop_au_format_du_contrat() {
        let t = horloge::lire("2026-10-18T03:00:00Z").unwrap();
        let b = BattementDesktop::nouveau("C:\\M", PremiereEtat { detecte: true, version: Some("26.5.2".into()), compatible: Some(true) }, t);
        let v = serde_json::to_value(&b).unwrap();
        assert_eq!(v["schema"], 1);
        assert_eq!(v["dossierMedias"], "C:\\M");
        assert_eq!(v["battement"], "2026-10-18T03:00:00.000Z");
        assert_eq!(v["premiere"], json!({"detecte": true, "version": "26.5.2", "compatible": true}));
        assert!(v["pid"].as_u64().unwrap() > 0);
        let d = tempfile::tempdir().unwrap();
        let e = Emplacements::sous(d.path());
        ecrire_desktop(&e, &b).unwrap();
        assert_eq!(lire_desktop(&e).ok().unwrap(), b);
    }

    #[test]
    fn panneau_connecte_si_frais() {
        let t = horloge::lire("2026-10-18T03:00:20Z").unwrap();
        let p: BattementPanneau = serde_json::from_value(json!({"schema": 1, "version": "1.0.0-beta.1",
            "battement": "2026-10-18T03:00:10Z", "premiereVersion": "26.5.2", "projetOuvert": true, "projet": "Montage-voyage",
            "visible": true, "champFutur": 3})).unwrap();
        assert!(p.connecte(t));
        // Contrat v1.1 : 13 s (panneau caché, battement toutes les 10 s) reste « connecté » ; 15 s ne l'est plus.
        assert!(p.connecte(horloge::lire("2026-10-18T03:00:23Z").unwrap()));
        assert!(!p.connecte(horloge::lire("2026-10-18T03:00:25Z").unwrap()));
        assert!(!BattementPanneau { battement: "n'importe quoi".into(), ..Default::default() }.connecte(t));
        let i: Imports = serde_json::from_value(json!({"schema": 1, "imports": {"abc": [{"projet": "P", "chutier": "AETHRYON", "le": "2026-10-18T03:00:00Z"}]}})).unwrap();
        assert_eq!(i.imports["abc"][0].chutier.as_deref(), Some("AETHRYON"));
    }
}

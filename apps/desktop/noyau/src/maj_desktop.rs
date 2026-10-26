//! Mise à jour d'AETHRYON Desktop (Paramètres › Mises à jour). JAMAIS silencieuse : rien n'est téléchargé ni lancé
//! sans un clic de l'utilisateur ; seule la lecture de l'annonce peut se faire d'elle-même (avis discret).
//!
//! 1. Annonce : `latest.json` à l'adresse FIGÉE `URL_ANNONCE`, publié avec le setup (web/scripts/fetch-downloads.sh) :
//!    `{"version","file","sha256","size","released","notes"}` — `version` est celle d'AETHRYON Desktop contenue dans
//!    le setup (comparée à `crate::VERSION`), `file` le nom du setup (`AETHRYON-Setup-<version du setup>.exe`).
//! 2. Téléchargement du setup (même dossier du site, HTTPS, aucune redirection, taille bornée) dans
//!    `%TEMP%\AETHRYON-mise-a-jour\`, sous un nom provisoire ; SHA-256 et taille comparés à l'annonce, en-tête « MZ ».
//! 3. Lancement : `AETHRYON-Setup-….exe --mettre-a-jour` (le setup s'ouvre directement sur « Mettre à jour » de son
//!    mode maintenance), puis AETHRYON Desktop se ferme proprement (le setup remplace ses fichiers).

use crate::reseau::{self, Racines};
use serde::Serialize;
use std::cmp::Ordering;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Adresse de l'annonce, figée (production).
pub const URL_ANNONCE: &str = "https://raccourci.malvu.fr/downloads/desktop/latest.json";
const BASE: &str = "https://raccourci.malvu.fr/downloads/desktop/";
const ANNONCE_MAX: u64 = 64 * 1024;
/// Le setup 2.0.0-beta.2 fait environ 27 Mio.
pub const SETUP_MAX: u64 = 300 * 1024 * 1024;
/// Argument qui ouvre le setup sur « Mettre à jour ».
pub const ARGUMENT_SETUP: &str = "--mettre-a-jour";
/// « Réparer avec AETHRYON Setup » : le setup PUBLIÉ s'ouvre sur son écran de maintenance (« Réparer » ; « Mettre à
/// jour » s'il est plus récent), qui réinstalle le panneau AETHRYON (extension CEP).
pub const ARGUMENT_REPARATION: &str = "--maintenance";
/// Page de téléchargement d'AETHRYON Setup, figée : repli quand le setup publié ne peut pas être lancé.
pub const PAGE_TELECHARGEMENT: &str = "https://raccourci.malvu.fr/#surfaces";

#[derive(Clone, Debug)]
pub struct Source {
    base: String,
    racines: Racines,
}

impl Source {
    pub fn production() -> Source {
        Source { base: BASE.into(), racines: Racines::Mozilla }
    }
    #[cfg(any(test, feature = "essais"))]
    pub fn essai(base: &str, autorite_der: Vec<u8>) -> Source {
        Source { base: base.into(), racines: Racines::Essai(autorite_der) }
    }
}

/// `latest.json` d'AETHRYON Desktop, vérifié champ par champ.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Annonce {
    pub version: String,
    pub fichier: String,
    pub sha256: String,
    pub taille: u64,
    pub publiee: String,
    pub notes: Vec<String>,
}

/// Résultat d'une recherche.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Recherche {
    pub actuelle: String,
    pub disponible: bool,
    pub annonce: Annonce,
}

fn parties(v: &str) -> Option<([u64; 3], Option<u64>)> {
    let (noyau, pre) = match v.split_once('-') {
        Some((n, p)) => (n, Some(p.strip_prefix("beta.")?.parse::<u64>().ok()?)),
        None => (v, None),
    };
    let n: Vec<u64> = noyau.split('.').map(|x| if (1..=5).contains(&x.len()) && x.bytes().all(|c| c.is_ascii_digit()) { x.parse().ok() } else { None }).collect::<Option<_>>()?;
    (n.len() == 3).then(|| ([n[0], n[1], n[2]], pre))
}

/// Versions d'AETHRYON Desktop : `1.2.3` ou `1.2.3-beta.N` (une bêta précède la version finale).
pub fn comparer(a: &str, b: &str) -> Option<Ordering> {
    let (x, px) = parties(a)?;
    let (y, py) = parties(b)?;
    Some(x.cmp(&y).then(match (px, py) {
        (None, None) => Ordering::Equal,
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (Some(p), Some(q)) => p.cmp(&q),
    }))
}

fn date_valide(s: &str) -> bool {
    s.len() == 10 && s.bytes().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == b'-' } else { c.is_ascii_digit() })
}

pub fn lire_annonce(octets: &[u8]) -> Result<Annonce, String> {
    let Ok(serde_json::Value::Object(o)) = serde_json::from_slice::<serde_json::Value>(octets) else {
        return Err("latest.json illisible.".into());
    };
    let refus = |c: &str| Err(format!("latest.json : champ « {c} » invalide."));
    let s = |k: &str| o.get(k).and_then(|v| v.as_str());
    let Some(version) = s("version").filter(|v| parties(v).is_some()) else { return refus("version") };
    let Some(fichier) = s("file").filter(|f| f.strip_prefix("AETHRYON-Setup-").and_then(|r| r.strip_suffix(".exe")).is_some_and(|v| parties(v).is_some())) else {
        return refus("file");
    };
    let Some(sha256) = s("sha256").filter(|h| h.len() == 64 && h.bytes().all(|c| matches!(c, b'0'..=b'9' | b'a'..=b'f'))) else { return refus("sha256") };
    let Some(taille) = o.get("size").and_then(|v| v.as_u64()).filter(|t| (1..=SETUP_MAX).contains(t)) else { return refus("size") };
    let Some(publiee) = s("released").filter(|d| date_valide(d)) else { return refus("released") };
    let Some(notes) = o.get("notes").and_then(|v| v.as_array()).filter(|n| n.len() <= 30 && n.iter().all(|x| x.is_string())) else { return refus("notes") };
    let notes = notes
        .iter()
        .filter_map(|x| x.as_str())
        .map(|n| n.chars().map(|c| if c.is_control() { ' ' } else { c }).collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ").chars().take(240).collect::<String>())
        .filter(|n| !n.is_empty())
        .take(8)
        .collect();
    Ok(Annonce { version: version.into(), fichier: fichier.into(), sha256: sha256.into(), taille, publiee: publiee.into(), notes })
}

/// Lit l'annonce et la compare à la version en cours (`actuelle`, `crate::VERSION` en production).
pub fn rechercher(src: &Source, actuelle: &str) -> Result<Recherche, String> {
    let corps = reseau::obtenir(&src.racines, &format!("{}latest.json", src.base), ANNONCE_MAX, Duration::from_secs(20), &mut |_, _| {})?;
    let annonce = lire_annonce(&corps)?;
    let disponible = comparer(&annonce.version, actuelle) == Some(Ordering::Greater);
    Ok(Recherche { actuelle: actuelle.into(), disponible, annonce })
}

/// Dossier des téléchargements de mise à jour (`%TEMP%\AETHRYON-mise-a-jour`).
pub fn dossier_temporaire() -> PathBuf {
    std::env::temp_dir().join("AETHRYON-mise-a-jour")
}

/// Télécharge le setup annoncé dans `dossier`, le vérifie, et rend son chemin. Rien n'est gardé s'il est refusé.
/// `avance(étape, fait, total)` : « telechargement » (octets reçus), puis « verification ».
pub fn telecharger(src: &Source, a: &Annonce, dossier: &Path, avance: &mut dyn FnMut(&'static str, u64, u64)) -> Result<PathBuf, String> {
    let octets = reseau::obtenir(&src.racines, &format!("{}{}", src.base, a.fichier), a.taille, Duration::from_secs(900), &mut |n, _| avance("telechargement", n, a.taille))?;
    avance("verification", 0, 1);
    if octets.len() as u64 != a.taille || aethryon_archive_extension::sha256_hex(&octets) != a.sha256 {
        return Err("Empreinte SHA-256 du setup différente de celle annoncée : fichier refusé, rien n'est lancé.".into());
    }
    if !octets.starts_with(b"MZ") {
        return Err("Le fichier reçu n'est pas un programme Windows : rien n'est lancé.".into());
    }
    // Anciens téléchargements retirés ; écriture sous un nom provisoire, puis renommage.
    let _ = fs::remove_dir_all(dossier);
    fs::create_dir_all(dossier).map_err(|e| format!("Dossier temporaire inaccessible ({}).", e.kind()))?;
    let provisoire = dossier.join(format!("{}.partiel", a.fichier));
    let cible = dossier.join(&a.fichier);
    (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&provisoire)?;
        f.write_all(&octets)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&provisoire, &cible)
    })()
    .map_err(|e| {
        let _ = fs::remove_file(&provisoire);
        format!("Écriture du setup impossible ({}).", e.kind())
    })?;
    // Relu depuis le disque avant le lancement.
    if fs::read(&cible).map(|d| aethryon_archive_extension::sha256_hex(&d)).ok().as_deref() != Some(a.sha256.as_str()) {
        let _ = fs::remove_file(&cible);
        return Err("Setup altéré sur le disque : rien n'est lancé.".into());
    }
    avance("verification", 1, 1);
    Ok(cible)
}

/// Lance le setup vérifié sur « Mettre à jour ». NON TESTÉ SOUS WINDOWS (SmartScreen peut demander une confirmation).
pub fn lancer_setup(exe: &Path) -> Result<(), String> {
    lancer_setup_avec(exe, ARGUMENT_SETUP)
}

/// Lance le setup vérifié avec `argument` (`ARGUMENT_SETUP` ou `ARGUMENT_REPARATION`).
pub fn lancer_setup_avec(exe: &Path, argument: &str) -> Result<(), String> {
    std::process::Command::new(exe).arg(argument).spawn().map(|_| ()).map_err(|e| format!("Le setup ne démarre pas ({}).", e.kind()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reseau::serveur_essai::{Reponse, Serveur};

    fn faux_setup() -> Vec<u8> {
        let mut d = b"MZ".to_vec();
        d.extend(std::iter::repeat_n(0x90u8, 300_000));
        d
    }

    fn annonce(version: &str, fichier: &str, d: &[u8]) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({"version": version, "file": fichier, "sha256": aethryon_archive_extension::sha256_hex(d), "size": d.len(),
            "released": "2026-10-21", "notes": ["Bouton « Mettre à jour »"]})).unwrap()
    }

    #[test]
    fn versions_avec_betas() {
        assert_eq!(comparer("1.0.0-beta.4", "1.0.0-beta.3"), Some(Ordering::Greater));
        assert_eq!(comparer("1.0.0", "1.0.0-beta.9"), Some(Ordering::Greater));
        assert_eq!(comparer("1.0.0-beta.10", "1.0.0-beta.9"), Some(Ordering::Greater));
        assert_eq!(comparer("1.1.0-beta.1", "1.0.9"), Some(Ordering::Greater));
        assert_eq!(comparer("1.0", "1.0.0"), None);
        assert_eq!(comparer("1.0.0-rc.1", "1.0.0"), None);
    }

    #[test]
    fn schema_exact() {
        let d = faux_setup();
        let a = lire_annonce(&annonce("1.0.0-beta.4", "AETHRYON-Setup-2.0.0-beta.3.exe", &d)).unwrap();
        assert_eq!((a.version.as_str(), a.fichier.as_str(), a.taille), ("1.0.0-beta.4", "AETHRYON-Setup-2.0.0-beta.3.exe", d.len() as u64));
        for f in ["../AETHRYON-Setup-2.0.0.exe", "AETHRYON-Setup-2.0.0.exe.bat", "https://x/AETHRYON-Setup-2.0.0.exe", "autre.exe", "AETHRYON-Setup-2.0.exe"] {
            assert!(lire_annonce(&annonce("1.0.0", f, &d)).is_err(), "{f}");
        }
        assert!(lire_annonce(&annonce("1.0.0-rc", "AETHRYON-Setup-2.0.0.exe", &d)).is_err());
    }

    #[test]
    fn recherche_telechargement_verifie_et_refus() {
        let s = Serveur::demarrer();
        let src = Source::essai(&s.base, s.autorite.clone());
        let d = faux_setup();
        let nom = "AETHRYON-Setup-2.0.0-beta.3.exe";
        s.route("/latest.json", Reponse::Ok(annonce("1.0.0-beta.4", nom, &d), "application/json"));
        s.route(&format!("/{nom}"), Reponse::Ok(d.clone(), "application/vnd.microsoft.portable-executable"));
        let r = rechercher(&src, "1.0.0-beta.3").unwrap();
        assert!(r.disponible);
        assert!(!rechercher(&src, "1.0.0-beta.4").unwrap().disponible, "même version : rien à proposer");
        assert!(!rechercher(&src, "1.0.0").unwrap().disponible, "version installée plus récente : rien à proposer");
        let t = tempfile::tempdir().unwrap();
        let mut vus = 0;
        let mut etapes = vec![];
        let exe = telecharger(&src, &r.annonce, &t.path().join("maj"), &mut |e, n, _| {
            if e == "telechargement" {
                vus = n
            }
            if etapes.last() != Some(&e) {
                etapes.push(e)
            }
        })
        .unwrap();
        assert_eq!(etapes, ["telechargement", "verification"]);
        assert_eq!(vus, d.len() as u64);
        assert_eq!(fs::read(&exe).unwrap(), d);
        assert!(exe.ends_with(nom));
        // Fichier servi modifié : refusé, rien n'est gardé.
        let mut altere = d.clone();
        altere[1000] = 0;
        s.route(&format!("/{nom}"), Reponse::Ok(altere, "application/octet-stream"));
        let dossier = t.path().join("maj2");
        assert!(telecharger(&src, &r.annonce, &dossier, &mut |_, _, _| {}).unwrap_err().contains("SHA-256"));
        assert!(!dossier.join(nom).exists());
        // Pas un exe Windows (empreinte pourtant cohérente).
        let pas_exe = vec![b'x'; 2000];
        s.route("/latest.json", Reponse::Ok(annonce("1.0.0-beta.4", nom, &pas_exe), "application/json"));
        s.route(&format!("/{nom}"), Reponse::Ok(pas_exe, "application/octet-stream"));
        let r = rechercher(&src, "1.0.0-beta.3").unwrap();
        assert!(telecharger(&src, &r.annonce, &dossier, &mut |_, _, _| {}).unwrap_err().contains("programme Windows"));
        // Redirection : refusée.
        s.route("/latest.json", Reponse::Redirection(format!("{}ailleurs.json", s.base)));
        assert!(rechercher(&src, "1.0.0-beta.3").unwrap_err().contains("Redirection"));
    }
}

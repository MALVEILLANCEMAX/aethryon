//! Mise à jour en un clic de l'extension navigateur (message Native Messaging `mettre-a-jour-extension`, contrat §6).
//!
//! Une extension chargée « non empaquetée » ne peut pas remplacer ses propres fichiers. AETHRYON Desktop le fait pour
//! elle, dans le DOSSIER GÉRÉ `R\extension` (`%LOCALAPPDATA%\AETHRYON\extension`), que l'utilisateur a chargé une
//! seule fois dans Chrome ; l'extension se recharge ensuite (`chrome.runtime.reload()`) et lit les nouveaux fichiers.
//!
//! 1. Annonce : `latest.json` lu à l'adresse FIGÉE `URL_ANNONCE` (HTTPS, aucune redirection, 64 Kio au plus).
//!    Le message de l'extension ne porte QUE la version attendue : jamais d'adresse, jamais de chemin.
//! 2. Téléchargement de l'archive annoncée (même dossier du site, nom imposé par le schéma), taille bornée.
//! 3. Vérification : taille et SHA-256 contre l'annonce, puis chaque entrée de l'archive (archive-extension) :
//!    ni chemin absolu, ni `..`, ni lien symbolique ; manifeste « AETHRYON », Manifest V3, identifiant de production.
//! 4. Installation : extraction dans le dossier frère `R\extension-preparation-<pid>`, relecture, puis bascule par
//!    renommages (`extension` → `extension-precedente`, préparation → `extension`), relecture du manifeste en place.
//!    Tout échec remet la version précédente ; une bascule interrompue (arrêt du PC) est reprise au passage suivant.

use crate::chemins::Emplacements;
use crate::reseau::{self, Racines};
use aethryon_archive_extension::{self as archive, Archive};
use serde::Serialize;
use std::cmp::Ordering;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Adresse de l'annonce, figée (production).
pub const URL_ANNONCE: &str = "https://raccourci.malvu.fr/downloads/extension/latest.json";
const BASE: &str = "https://raccourci.malvu.fr/downloads/extension/";

/// D'où viennent l'annonce et l'archive, et quel identifiant est exigé.
#[derive(Clone, Debug)]
pub struct Source {
    base: String,
    racines: Racines,
    id: String,
}

impl Source {
    /// Production : adresse figée, racines de Mozilla, identifiant de production.
    pub fn production() -> Source {
        Source { base: BASE.into(), racines: Racines::Mozilla, id: archive::ID_PRODUCTION.into() }
    }

    /// Essais seulement : serveur HTTPS local, son autorité, et l'identifiant attendu.
    #[cfg(any(test, feature = "essais"))]
    pub fn essai(base: &str, autorite_der: Vec<u8>, id: &str) -> Source {
        Source { base: base.into(), racines: Racines::Essai(autorite_der), id: id.into() }
    }

    /// Banc Linux (`essais`) : `AETHRYON_ESSAI_MAJ_BASE` (https://…/), `AETHRYON_ESSAI_MAJ_CA` (fichier PEM de
    /// l'autorité locale), `AETHRYON_ESSAI_MAJ_ID` (identifiant exigé). Sans elles : production.
    #[cfg(feature = "essais")]
    pub fn depuis_environnement() -> Source {
        let (Some(base), Some(ca)) = (std::env::var("AETHRYON_ESSAI_MAJ_BASE").ok(), std::env::var("AETHRYON_ESSAI_MAJ_CA").ok()) else {
            return Source::production();
        };
        let pem = fs::read(ca).unwrap_or_default();
        let der = ureq::tls::Certificate::from_pem(&pem).map(|c| c.der().to_vec()).unwrap_or_default();
        let id = std::env::var("AETHRYON_ESSAI_MAJ_ID").unwrap_or_else(|_| archive::ID_PRODUCTION.into());
        Source::essai(&base, der, &id)
    }

    pub fn url_annonce(&self) -> String {
        format!("{}latest.json", self.base)
    }
    fn url_archive(&self, fichier: &str) -> String {
        format!("{}{}", self.base, fichier)
    }
    pub fn id(&self) -> &str {
        &self.id
    }
}

/// Étapes montrées par l'extension.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Etape {
    Telechargement,
    Verification,
    Installation,
}

impl Etape {
    pub fn nom(self) -> &'static str {
        match self {
            Etape::Telechargement => "telechargement",
            Etape::Verification => "verification",
            Etape::Installation => "installation",
        }
    }
}

/// Erreur d'une mise à jour : message lisible et étape où elle s'est produite.
#[derive(Clone, Debug, PartialEq)]
pub struct Echec {
    pub etape: Etape,
    pub message: String,
}

/// Ce que le dossier géré contient (message `etat-extension`).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EtatGere {
    pub dossier: String,
    pub version: Option<String>,
    pub precedente: Option<String>,
}

/// Fin d'une mise à jour réussie.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Fin {
    pub version: String,
    pub dossier: String,
    /// Rien n'a été téléchargé : le dossier géré contenait déjà cette version (ou une plus récente).
    pub deja: bool,
    pub precedente: Option<String>,
}

/// Version lue dans `<dossier>/manifest.json` (nom AETHRYON exigé), ou `None`.
pub fn version_dans(dossier: &Path) -> Option<String> {
    let m: serde_json::Value = serde_json::from_slice(&fs::read(dossier.join("manifest.json")).ok()?).ok()?;
    if m.get("name").and_then(|n| n.as_str()) != Some("AETHRYON") {
        return None;
    }
    m.get("version").and_then(|v| v.as_str()).filter(|v| archive::version_valide(v)).map(str::to_string)
}

pub fn etat(emp: &Emplacements) -> EtatGere {
    EtatGere {
        dossier: emp.extension_geree().display().to_string(),
        version: version_dans(&emp.extension_geree()),
        precedente: version_dans(&emp.extension_precedente()),
    }
}

/// Points de la bascule (essais : une panne y est injectée pour éprouver le retour arrière).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Point {
    Preparee,
    AncienneMiseDeCote,
    Basculee,
}

fn renommer(de: &Path, vers: &Path) -> io::Result<()> {
    // Sous Windows, un antivirus ou l'indexation peuvent tenir un fichier un instant : quelques essais espacés.
    let mut derniere = None;
    for i in 0..10u64 {
        match fs::rename(de, vers) {
            Ok(()) => return Ok(()),
            Err(e) => {
                derniere = Some(e);
                std::thread::sleep(Duration::from_millis(40 * (i + 1)));
            }
        }
    }
    Err(derniere.unwrap_or_else(|| io::Error::other("renommage impossible")))
}

fn retirer(p: &Path) {
    // `remove_dir_all` ne suit pas les liens symboliques (CVE-2022-21658 corrigée).
    match fs::symlink_metadata(p) {
        Ok(m) if m.is_dir() => {
            let _ = fs::remove_dir_all(p);
        }
        Ok(_) => {
            let _ = fs::remove_file(p);
        }
        Err(_) => {}
    }
}

/// Reprise d'une bascule interrompue : dossier géré absent mais version précédente présente → elle est remise en
/// place. Les préparations et abandons d'autres processus sont retirés. Rien n'est fait si un autre processus prépare.
pub fn reprendre(emp: &Emplacements) -> Vec<String> {
    let mut faits = Vec::new();
    let (g, p) = (emp.extension_geree(), emp.extension_precedente());
    if fs::symlink_metadata(&g).is_err() && p.is_dir() && renommer(&p, &g).is_ok() {
        faits.push("version précédente remise en place (bascule interrompue)".into());
    }
    let moi = std::process::id();
    for e in fs::read_dir(&emp.racine).into_iter().flatten().flatten() {
        let n = e.file_name().to_string_lossy().into_owned();
        let autre = |prefixe: &str| n.strip_prefix(prefixe).and_then(|x| x.parse::<u32>().ok()).is_some_and(|pid| pid != moi);
        if autre("extension-preparation-") || autre("extension-abandon-") {
            retirer(&e.path());
            faits.push(format!("{n} retiré"));
        }
    }
    faits
}

fn ecrire_fichier(p: &Path, d: &[u8]) -> io::Result<()> {
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut f = fs::OpenOptions::new().write(true).create_new(true).open(p)?;
    f.write_all(d)?;
    f.sync_all()
}

fn chemin_de(base: &Path, relatif: &str) -> PathBuf {
    relatif.split('/').fold(base.to_path_buf(), |b, x| b.join(x))
}

/// Relit chaque fichier préparé et le compare à l'archive (rien de plus, rien de moins).
fn relire(dossier: &Path, a: &Archive) -> Result<(), String> {
    for (c, d) in &a.fichiers {
        let p = chemin_de(dossier, c);
        let m = fs::symlink_metadata(&p).map_err(|_| format!("{c} absent après extraction."))?;
        if !m.is_file() || fs::read(&p).map_err(|e| e.to_string())? != *d {
            return Err(format!("{c} diffère de l'archive après extraction."));
        }
    }
    Ok(())
}

/// Installe l'archive vérifiée dans le dossier géré (préparation, bascule, relecture), en gardant la version
/// précédente. `panne` est appelé à chaque point de la bascule (production : `&mut |_| Ok(())`).
pub fn installer(emp: &Emplacements, a: &Archive, avance: &mut dyn FnMut(u64, u64), panne: &mut dyn FnMut(Point) -> io::Result<()>) -> Result<Option<String>, String> {
    let (g, prec) = (emp.extension_geree(), emp.extension_precedente());
    let prep = emp.extension_preparation(std::process::id());
    let abandon = emp.racine.join(format!("extension-abandon-{}", std::process::id()));
    fs::create_dir_all(&emp.racine).map_err(|e| format!("Dossier AETHRYON inaccessible ({}).", e.kind()))?;
    if fs::symlink_metadata(&g).is_ok_and(|m| !m.is_dir()) {
        return Err("Le dossier géré de l'extension n'est pas un dossier ordinaire : rien n'est remplacé.".into());
    }
    retirer(&prep);
    retirer(&abandon);
    // 1. Préparation dans le dossier frère.
    let total = a.fichiers.len() as u64;
    let prepare = (|| -> Result<(), String> {
        fs::create_dir(&prep).map_err(|e| format!("Préparation impossible ({}).", e.kind()))?;
        for (i, (c, d)) in a.fichiers.iter().enumerate() {
            ecrire_fichier(&chemin_de(&prep, c), d).map_err(|e| format!("Écriture de {c} impossible ({}).", e.kind()))?;
            avance(i as u64 + 1, total);
        }
        relire(&prep, a)?;
        panne(Point::Preparee).map_err(|e| format!("Préparation interrompue ({e})."))
    })();
    if let Err(e) = prepare {
        retirer(&prep);
        return Err(e);
    }
    // 2. Bascule : l'ancienne version devient « précédente », la préparation prend sa place.
    let ancienne = version_dans(&g);
    let avait = g.is_dir();
    let remettre = |faite: bool| {
        if faite {
            // La nouvelle version est en place mais refusée : écartée, la précédente revient.
            if g.exists() {
                let _ = renommer(&g, &abandon);
            }
        }
        if avait && !g.exists() {
            let _ = renommer(&prec, &g);
        }
        retirer(&prep);
        retirer(&abandon);
    };
    if avait {
        retirer(&prec);
        if let Err(e) = renommer(&g, &prec) {
            retirer(&prep);
            return Err(format!("Le dossier de l'extension est utilisé par un autre programme ({}). Ferme les fenêtres qui l'affichent, puis réessaie.", e.kind()));
        }
    }
    if let Err(e) = panne(Point::AncienneMiseDeCote) {
        remettre(false);
        return Err(format!("Bascule interrompue ({e}) : version précédente remise en place."));
    }
    if let Err(e) = renommer(&prep, &g) {
        remettre(false);
        return Err(format!("Mise en place impossible ({}) : version précédente remise en place.", e.kind()));
    }
    // 3. Relecture du dossier en place.
    let valide = panne(Point::Basculee).map_err(|e| e.to_string()).and_then(|_| {
        if version_dans(&g).as_deref() == Some(a.version.as_str()) {
            relire(&g, a)
        } else {
            Err("manifeste illisible".into())
        }
    });
    if let Err(e) = valide {
        remettre(true);
        return Err(format!("Validation de la nouvelle version impossible ({e}) : version précédente remise en place."));
    }
    Ok(ancienne)
}

/// Remet la version précédente à la place de la version en place (les deux sont échangées).
pub fn revenir(emp: &Emplacements) -> Result<String, String> {
    let (g, prec) = (emp.extension_geree(), emp.extension_precedente());
    let v = version_dans(&prec).ok_or("Aucune version précédente gardée.")?;
    let tmp = emp.racine.join(format!("extension-abandon-{}", std::process::id()));
    retirer(&tmp);
    if g.exists() {
        renommer(&g, &tmp).map_err(|e| format!("Dossier utilisé ({}).", e.kind()))?;
    }
    if let Err(e) = renommer(&prec, &g) {
        let _ = renommer(&tmp, &g);
        return Err(format!("Retour impossible ({}).", e.kind()));
    }
    if tmp.exists() {
        let _ = renommer(&tmp, &prec);
    }
    Ok(v)
}

fn echec(etape: Etape) -> impl Fn(String) -> Echec {
    move |message| Echec { etape, message }
}

/// Mise à jour complète. `demandee` : version que l'extension a vue annoncée (garde-fou, jamais une adresse).
/// `avance(étape, fait, total)` : progression réelle (octets reçus, fichiers écrits).
pub fn mettre_a_jour(emp: &Emplacements, src: &Source, demandee: Option<&str>, avance: &mut dyn FnMut(Etape, u64, u64)) -> Result<Fin, Echec> {
    let _ = reprendre(emp);
    let dossier = emp.extension_geree().display().to_string();
    // 1. Annonce.
    let corps = reseau::obtenir(&src.racines, &src.url_annonce(), archive::TAILLE_ANNONCE_MAX as u64, Duration::from_secs(20), &mut |_, _| {}).map_err(echec(Etape::Telechargement))?;
    let a = archive::lire_annonce(&corps).map_err(echec(Etape::Telechargement))?;
    if let Some(v) = demandee {
        if archive::comparer_versions(&a.version, v).is_none_or(|o| o == Ordering::Less) {
            return Err(Echec { etape: Etape::Telechargement, message: format!("Le site annonce la version {} : la version {v} n'y est pas encore.", a.version) });
        }
    }
    if let Some(en_place) = version_dans(&emp.extension_geree()) {
        if archive::comparer_versions(&en_place, &a.version).is_some_and(|o| o != Ordering::Less) {
            return Ok(Fin { version: en_place, dossier, deja: true, precedente: version_dans(&emp.extension_precedente()) });
        }
    }
    // 2. Téléchargement.
    avance(Etape::Telechargement, 0, a.taille);
    let octets = reseau::obtenir(&src.racines, &src.url_archive(&a.fichier), a.taille, Duration::from_secs(300), &mut |n, _| avance(Etape::Telechargement, n, a.taille))
        .map_err(echec(Etape::Telechargement))?;
    // 3. Vérification.
    avance(Etape::Verification, 0, 2);
    archive::verifier_empreinte(&octets, &a).map_err(echec(Etape::Verification))?;
    avance(Etape::Verification, 1, 2);
    let arc = archive::ouvrir_archive(&octets, &src.id).map_err(echec(Etape::Verification))?;
    if arc.version != a.version {
        return Err(Echec { etape: Etape::Verification, message: format!("L'archive contient la version {}, {} annoncée : rien n'est installé.", arc.version, a.version) });
    }
    avance(Etape::Verification, 2, 2);
    // 4. Installation.
    let precedente = installer(emp, &arc, &mut |n, t| avance(Etape::Installation, n, t), &mut |_| Ok(())).map_err(echec(Etape::Installation))?;
    Ok(Fin { version: arc.version, dossier, deja: false, precedente })
}

#[cfg(test)]
pub(crate) mod essais {
    use super::*;
    use crate::reseau::serveur_essai::{Reponse, Serveur};
    use std::io::Cursor;

    pub const CLE_PROD: &str = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAl7CIpdRND225d9rNbcSqnsnWegwKRDYvPw1+KgdTbsrhH89lEATaHSI1BYHdl7nN7YOAof0AEGKMOHCu45RT9VbUfL48f4ZPvbo3xatomRFXf2xxr5uYSQSnl6GoJmH+1abQ6A1/X6TH+4B94XVgQEHzY6HAx8RkRucpnKUbegM68W20aCbj/iAVDH/+KoATUQTbyZlZ777IeliS2Ha5CBSQuPKFeP5O+vx3QzJwpHdCVLPoYpQlAEzEdqqEAT2w9KjbLqkPzPimomUvpoKPEMqjoXDqGRAyWi3+7npNGY38uv9cuRzi1LBfY1CjoWoH/mlJ/zJMUvCEK00VubYgiQIDAQAB";
    pub const CLE_DEV: &str = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA126rx25u3bhvFIgpmqGBctWs2VfWnd23Px8SCmImifXZ2SlAL9AK9Nr/zq5JAbjNhPkgyP5QsnJ4Vxm4/R4PQ79NC6iu0ifVDRBWJItmU//eswzeGKZIvB4P8kuBl560LG8Ewin0Wbicjk9ErSlc7JGbCqGtZfWl9geiHW87zLxqahcN+YcUr2k05daofQlxzqzqnw9bfIh5rG4F5iswiBzmZVtxRNFMJDNowhoPvPfNmrwULpV15WYgcIV6245XzHb4ST5TVjN1XK8PvW8ILunD8lF/uPfyB3JojH2mS/Z/TFtjmLJjiHlJZLH8g203P9B9g81iGA8gDyyoSuQgAwIDAQAB";

    pub fn zip_extension(version: &str, cle: &str, extra: &[(&str, &[u8])]) -> Vec<u8> {
        let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let o = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        z.start_file("manifest.json", o).unwrap();
        z.write_all(&serde_json::to_vec(&serde_json::json!({"manifest_version": 3, "name": "AETHRYON", "version": version, "key": cle})).unwrap()).unwrap();
        z.start_file("popup/popup.html", o).unwrap();
        z.write_all(format!("<p>version {version}</p>").as_bytes()).unwrap();
        for (n, d) in extra {
            z.start_file(*n, o).unwrap();
            z.write_all(d).unwrap();
        }
        z.finish().unwrap().into_inner()
    }

    pub fn annonce(version: &str, z: &[u8]) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({"version": version, "file": format!("aethryon-extension-{version}.zip"), "sha256": archive::sha256_hex(z),
            "size": z.len(), "released": "2026-10-21", "minChrome": 116, "notes": ["Bouton « Mettre à jour »"]})).unwrap()
    }

    pub fn publier(s: &Serveur, version: &str, z: &[u8]) {
        s.route("/latest.json", Reponse::Ok(annonce(version, z), "application/json"));
        s.route(&format!("/aethryon-extension-{version}.zip"), Reponse::Ok(z.to_vec(), "application/zip"));
    }

    fn profil() -> (tempfile::TempDir, Emplacements) {
        let d = tempfile::tempdir().unwrap();
        let e = Emplacements::sous(d.path());
        (d, e)
    }

    fn source(s: &Serveur) -> Source {
        Source::essai(&s.base, s.autorite.clone(), archive::ID_PRODUCTION)
    }

    fn lancer(e: &Emplacements, src: &Source, v: Option<&str>) -> (Result<Fin, Echec>, Vec<(Etape, u64, u64)>) {
        let mut pas = vec![];
        let r = mettre_a_jour(e, src, v, &mut |x, f, t| pas.push((x, f, t)));
        (r, pas)
    }

    #[test]
    fn premiere_installation_puis_mise_a_jour_avec_version_precedente() {
        let s = Serveur::demarrer();
        let (_d, e) = profil();
        let z1 = zip_extension("3.6.1", CLE_PROD, &[]);
        publier(&s, "3.6.1", &z1);
        let (r, pas) = lancer(&e, &source(&s), Some("3.6.1"));
        let f = r.unwrap();
        assert_eq!((f.version.as_str(), f.deja, f.precedente.clone()), ("3.6.1", false, None));
        assert!(pas.iter().any(|p| p.0 == Etape::Telechargement && p.1 == z1.len() as u64), "octets réellement reçus annoncés");
        assert!(pas.iter().any(|p| p.0 == Etape::Verification) && pas.iter().any(|p| p.0 == Etape::Installation));
        assert_eq!(etat(&e), EtatGere { dossier: e.extension_geree().display().to_string(), version: Some("3.6.1".into()), precedente: None });
        // Même version : rien n'est retéléchargé.
        let avant = s.vus("/aethryon-extension-3.6.1.zip");
        let (r, _) = lancer(&e, &source(&s), Some("3.6.1"));
        assert!(r.unwrap().deja);
        assert_eq!(s.vus("/aethryon-extension-3.6.1.zip"), avant);
        // Nouvelle version : l'ancienne est gardée comme précédente.
        let z2 = zip_extension("3.6.2", CLE_PROD, &[("nouveau.js", b"// 3.6.2")]);
        publier(&s, "3.6.2", &z2);
        let f = lancer(&e, &source(&s), Some("3.6.2")).0.unwrap();
        assert_eq!((f.version.as_str(), f.precedente.as_deref()), ("3.6.2", Some("3.6.1")));
        assert!(e.extension_geree().join("nouveau.js").is_file());
        assert_eq!(etat(&e).precedente.as_deref(), Some("3.6.1"));
        // Retour arrière demandé : les deux versions s'échangent.
        assert_eq!(revenir(&e).unwrap(), "3.6.1");
        assert_eq!((etat(&e).version.as_deref(), etat(&e).precedente.as_deref()), (Some("3.6.1"), Some("3.6.2")));
        // Aucun dossier de préparation ne reste.
        let restes: Vec<_> = fs::read_dir(&e.racine).unwrap().flatten().map(|x| x.file_name().to_string_lossy().into_owned()).filter(|n| n.contains("preparation") || n.contains("abandon")).collect();
        assert!(restes.is_empty(), "{restes:?}");
    }

    #[test]
    fn archive_alteree_ou_mauvaise_empreinte_refusee_rien_installe() {
        let s = Serveur::demarrer();
        let (_d, e) = profil();
        let z = zip_extension("3.6.1", CLE_PROD, &[]);
        // latest.json annonce l'empreinte de l'archive d'origine, le serveur sert une archive modifiée.
        s.route("/latest.json", Reponse::Ok(annonce("3.6.1", &z), "application/json"));
        let mut altere = z.clone();
        let n = altere.len();
        altere[n / 3] ^= 0x20;
        s.route("/aethryon-extension-3.6.1.zip", Reponse::Ok(altere, "application/zip"));
        let err = lancer(&e, &source(&s), Some("3.6.1")).0.unwrap_err();
        assert_eq!(err.etape, Etape::Verification);
        assert!(err.message.contains("SHA-256"), "{}", err.message);
        assert!(!e.extension_geree().exists());
        // Mauvaise empreinte annoncée (archive intacte).
        let mut faux: serde_json::Value = serde_json::from_slice(&annonce("3.6.1", &z)).unwrap();
        faux["sha256"] = serde_json::json!("0".repeat(64));
        s.route("/latest.json", Reponse::Ok(serde_json::to_vec(&faux).unwrap(), "application/json"));
        s.route("/aethryon-extension-3.6.1.zip", Reponse::Ok(z, "application/zip"));
        assert!(lancer(&e, &source(&s), None).0.unwrap_err().message.contains("SHA-256"));
        assert!(!e.extension_geree().exists());
    }

    #[test]
    fn traversee_ou_mauvais_identifiant_refuses() {
        let s = Serveur::demarrer();
        let (_d, e) = profil();
        let z = zip_extension("3.6.1", CLE_PROD, &[("../../evil.js", b"x")]);
        publier(&s, "3.6.1", &z);
        let err = lancer(&e, &source(&s), None).0.unwrap_err();
        assert!(err.message.contains("Entrée refusée"), "{}", err.message);
        assert!(!e.racine.parent().unwrap().join("evil.js").exists() && !e.extension_geree().exists());
        let z = zip_extension("3.6.1", CLE_DEV, &[]);
        publier(&s, "3.6.1", &z);
        assert!(lancer(&e, &source(&s), None).0.unwrap_err().message.contains("Identifiant d'extension inattendu"));
        assert!(!e.extension_geree().exists());
    }

    #[test]
    fn annonce_plus_ancienne_ou_redirigee_refusee() {
        let s = Serveur::demarrer();
        let (_d, e) = profil();
        publier(&s, "3.6.0", &zip_extension("3.6.0", CLE_PROD, &[]));
        assert!(lancer(&e, &source(&s), Some("3.6.1")).0.unwrap_err().message.contains("n'y est pas encore"));
        s.route("/latest.json", Reponse::Redirection(format!("{}ailleurs/latest.json", s.base)));
        assert!(lancer(&e, &source(&s), None).0.unwrap_err().message.contains("Redirection refusée"));
        assert_eq!(s.vus("/ailleurs/latest.json"), 0);
    }

    #[test]
    fn panne_a_chaque_point_de_la_bascule_puis_retour_arriere() {
        let (_d, e) = profil();
        let ancienne = archive::ouvrir_archive(&zip_extension("3.6.1", CLE_PROD, &[]), archive::ID_PRODUCTION).unwrap();
        installer(&e, &ancienne, &mut |_, _| {}, &mut |_| Ok(())).unwrap();
        let nouvelle = archive::ouvrir_archive(&zip_extension("3.6.2", CLE_PROD, &[("x.js", b"2")]), archive::ID_PRODUCTION).unwrap();
        for point in [Point::Preparee, Point::AncienneMiseDeCote, Point::Basculee] {
            let r = installer(&e, &nouvelle, &mut |_, _| {}, &mut |p| if p == point { Err(io::Error::other("coupure simulée")) } else { Ok(()) });
            assert!(r.is_err(), "{point:?}");
            assert_eq!(version_dans(&e.extension_geree()).as_deref(), Some("3.6.1"), "version précédente en place après {point:?}");
            assert!(!e.extension_geree().join("x.js").exists());
            assert!(!e.extension_preparation(std::process::id()).exists());
        }
        // Arrêt brutal entre les deux renommages : dossier géré absent, précédente présente → reprise.
        installer(&e, &nouvelle, &mut |_, _| {}, &mut |_| Ok(())).unwrap();
        fs::rename(e.extension_geree(), e.racine.join("extension-preparation-999999")).unwrap();
        assert!(!e.extension_geree().exists());
        let faits = reprendre(&e);
        assert!(faits.iter().any(|f| f.contains("remise en place")), "{faits:?}");
        assert_eq!(version_dans(&e.extension_geree()).as_deref(), Some("3.6.1"));
        assert!(!e.racine.join("extension-preparation-999999").exists(), "préparation orpheline retirée");
    }
}

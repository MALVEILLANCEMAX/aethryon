//! Vérification de l'extension navigateur AETHRYON, partagée par AETHRYON Desktop (message Native Messaging
//! `mettre-a-jour-extension`, desktop/noyau/src/maj_extension.rs) et AETHRYON Setup (dossier géré installé avec le
//! reste, setup/moteur/src/navigateur.rs).
//!
//! Rien ici ne touche au disque ni au réseau : on reçoit des octets, on rend un verdict.
//! - `lire_annonce` : `latest.json` publié avec l'archive (extension/scripts/zip.mjs l'écrit), schéma exact ;
//! - `verifier_empreinte` : taille et SHA-256 de l'archive téléchargée, comparées à l'annonce ;
//! - `ouvrir_archive` : chaque entrée est examinée AVANT toute écriture : ni chemin absolu, ni lecteur (`C:`), ni
//!   `..`, ni barre oblique inverse, ni lien symbolique, ni nom réservé de Windows, ni doublon (à la casse près),
//!   tailles bornées ; `manifest.json` à la racine, nom « AETHRYON », Manifest V3, et clé publique dont l'identifiant
//!   Chrome est celui attendu (production : `necpohicddjeaeaaomaakehcbccapabg`).

use base64::Engine;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::collections::BTreeSet;
use std::io::{Cursor, Read};

/// Identifiant Chrome de l'extension de production (clé « installation locale », extension/src/manifest-key.prod.json).
pub const ID_PRODUCTION: &str = "necpohicddjeaeaaomaakehcbccapabg";
/// `latest.json` : 64 Kio au plus (comme l'extension, src/background/update.ts).
pub const TAILLE_ANNONCE_MAX: usize = 64 * 1024;
/// Archive : 64 Mio au plus (la 3.6.0 fait moins de 2 Mio).
pub const TAILLE_ARCHIVE_MAX: u64 = 64 * 1024 * 1024;
const ENTREES_MAX: usize = 4000;
const FICHIER_MAX: u64 = 32 * 1024 * 1024;
const TOTAL_MAX: u64 = 128 * 1024 * 1024;

/// `latest.json` de l'extension, vérifié champ par champ.
#[derive(Clone, Debug, PartialEq)]
pub struct Annonce {
    pub version: String,
    pub fichier: String,
    pub sha256: String,
    pub taille: u64,
    pub publiee: String,
    pub chrome_min: u32,
    pub notes: Vec<String>,
}

/// Archive vérifiée : version et identifiant lus dans son manifeste, fichiers (chemins POSIX relatifs) et contenus.
#[derive(Clone, Debug)]
pub struct Archive {
    pub version: String,
    pub id: String,
    pub fichiers: Vec<(String, Vec<u8>)>,
}

impl Archive {
    pub fn taille(&self) -> u64 {
        self.fichiers.iter().map(|(_, d)| d.len() as u64).sum()
    }
}

/// Version de manifeste : 1 à 4 nombres de 1 à 5 chiffres (« 3.6.1 »).
pub fn version_valide(v: &str) -> bool {
    let p: Vec<&str> = v.split('.').collect();
    (1..=4).contains(&p.len()) && p.iter().all(|x| (1..=5).contains(&x.len()) && x.bytes().all(|c| c.is_ascii_digit()))
}

/// Compare deux versions de manifeste (nombre par nombre, les absents valent 0) ; `None` si l'une est invalide.
pub fn comparer_versions(a: &str, b: &str) -> Option<Ordering> {
    if !version_valide(a) || !version_valide(b) {
        return None;
    }
    let n = |v: &str| v.split('.').map(|x| x.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    let (x, y) = (n(a), n(b));
    for i in 0..4 {
        let o = x.get(i).copied().unwrap_or(0).cmp(&y.get(i).copied().unwrap_or(0));
        if o != Ordering::Equal {
            return Some(o);
        }
    }
    Some(Ordering::Equal)
}

pub fn sha256_hex(d: &[u8]) -> String {
    Sha256::digest(d).iter().map(|b| format!("{b:02x}")).collect()
}

/// Identifiant Chrome d'une clé publique (base64 du DER) : 32 premiers chiffres hexadécimaux de son SHA-256, écrits a–p.
pub fn id_depuis_cle(cle_b64: &str) -> Option<String> {
    let der = base64::engine::general_purpose::STANDARD.decode(cle_b64.trim()).ok()?;
    if der.is_empty() {
        return None;
    }
    let h = Sha256::digest(&der);
    Some(h[..16].iter().flat_map(|b| [b >> 4, b & 0x0f]).map(|n| (b'a' + n) as char).collect())
}

fn date_valide(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' || !s.bytes().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit()) {
        return false;
    }
    let m: u32 = s[5..7].parse().unwrap_or(0);
    let j: u32 = s[8..10].parse().unwrap_or(0);
    (1..=12).contains(&m) && (1..=31).contains(&j)
}

/// Texte d'une note : sans caractère de contrôle, espaces repliés, 240 caractères au plus.
fn nettoyer(n: &str) -> String {
    let t: String = n.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    t.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(240).collect()
}

/// `latest.json` → annonce vérifiée (schéma exact d'extension/scripts/zip.mjs), sinon un refus lisible.
pub fn lire_annonce(octets: &[u8]) -> Result<Annonce, String> {
    if octets.len() > TAILLE_ANNONCE_MAX {
        return Err("latest.json trop long.".into());
    }
    let Ok(Value::Object(o)) = serde_json::from_slice::<Value>(octets) else {
        return Err("latest.json illisible.".into());
    };
    let refus = |c: &str| Err(format!("latest.json : champ « {c} » invalide."));
    let Some(version) = o.get("version").and_then(Value::as_str).filter(|v| version_valide(v)) else { return refus("version") };
    let fichier = format!("aethryon-extension-{version}.zip");
    if o.get("file").and_then(Value::as_str) != Some(fichier.as_str()) {
        return refus("file");
    }
    let Some(sha256) = o.get("sha256").and_then(Value::as_str).filter(|s| s.len() == 64 && s.bytes().all(|c| matches!(c, b'0'..=b'9' | b'a'..=b'f'))) else {
        return refus("sha256");
    };
    let Some(taille) = o.get("size").and_then(Value::as_u64).filter(|t| (1..=TAILLE_ARCHIVE_MAX).contains(t)) else { return refus("size") };
    let Some(publiee) = o.get("released").and_then(Value::as_str).filter(|d| date_valide(d)) else { return refus("released") };
    let Some(chrome_min) = o.get("minChrome").and_then(Value::as_u64).filter(|n| (1..=9999).contains(n)) else { return refus("minChrome") };
    let Some(notes) = o.get("notes").and_then(Value::as_array).filter(|n| n.len() <= 30 && n.iter().all(Value::is_string)) else { return refus("notes") };
    Ok(Annonce {
        version: version.into(),
        fichier,
        sha256: sha256.into(),
        taille,
        publiee: publiee.into(),
        chrome_min: chrome_min as u32,
        notes: notes.iter().filter_map(Value::as_str).map(nettoyer).filter(|n| !n.is_empty()).take(8).collect(),
    })
}

/// Taille et SHA-256 de l'archive, comparées à l'annonce.
pub fn verifier_empreinte(octets: &[u8], a: &Annonce) -> Result<(), String> {
    if octets.len() as u64 != a.taille {
        return Err(format!("Archive de {} octets, {} annoncés : téléchargement refusé.", octets.len(), a.taille));
    }
    if sha256_hex(octets) != a.sha256 {
        return Err("Empreinte SHA-256 différente de celle annoncée : archive altérée, rien n'est installé.".into());
    }
    Ok(())
}

const RESERVES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8",
    "LPT9",
];

/// Chemin d'une entrée, s'il est sûr : relatif, POSIX, sans `.` ni `..`, sans lecteur, sans barre oblique inverse,
/// sans caractère interdit par Windows, sans nom réservé, sans point ni espace final (Windows les retire).
pub fn chemin_sur(nom: &str) -> Result<String, String> {
    let refus = || Err(format!("Entrée refusée dans l'archive : « {} ».", nom.chars().filter(|c| !c.is_control()).take(80).collect::<String>()));
    if nom.is_empty() || nom.len() > 400 || nom.starts_with('/') || nom.contains('\\') || nom.contains(':') {
        return refus();
    }
    let nom = nom.strip_suffix('/').unwrap_or(nom);
    let mut parties = Vec::new();
    for p in nom.split('/') {
        if p.is_empty() || p == "." || p == ".." || p.ends_with('.') || p.ends_with(' ') || p.starts_with(' ') {
            return refus();
        }
        if p.chars().any(|c| c.is_control() || matches!(c, '<' | '>' | '"' | '|' | '?' | '*')) {
            return refus();
        }
        let base = p.split('.').next().unwrap_or("").to_ascii_uppercase();
        if RESERVES.contains(&base.as_str()) {
            return refus();
        }
        parties.push(p);
    }
    Ok(parties.join("/"))
}

/// Examine toute l'archive et la lit en mémoire, sans rien écrire. `id_attendu` : identifiant Chrome exigé.
pub fn ouvrir_archive(octets: &[u8], id_attendu: &str) -> Result<Archive, String> {
    if octets.len() as u64 > TAILLE_ARCHIVE_MAX {
        return Err("Archive trop grande.".into());
    }
    let mut z = zip::ZipArchive::new(Cursor::new(octets)).map_err(|e| format!("Archive illisible ({e})."))?;
    if z.len() == 0 || z.len() > ENTREES_MAX {
        return Err("Archive vide ou trop de fichiers.".into());
    }
    let mut vus = BTreeSet::new();
    let mut dossiers = BTreeSet::new();
    let mut fichiers = Vec::new();
    let mut total = 0u64;
    for i in 0..z.len() {
        let mut f = z.by_index(i).map_err(|e| format!("Entrée {i} illisible ({e})."))?;
        let chemin = chemin_sur(f.name())?;
        let mode = f.unix_mode().unwrap_or(0) & 0o170000;
        if f.is_symlink() || (mode != 0 && mode != 0o100000 && mode != 0o040000) {
            return Err(format!("Lien symbolique ou fichier spécial refusé dans l'archive : « {chemin} »."));
        }
        if !vus.insert(chemin.to_lowercase()) {
            return Err(format!("Entrée en double dans l'archive : « {chemin} »."));
        }
        if f.is_dir() {
            dossiers.insert(chemin.to_lowercase());
            continue;
        }
        let taille = f.size();
        total += taille;
        if taille > FICHIER_MAX || total > TOTAL_MAX {
            return Err("Archive trop grande une fois décompressée.".into());
        }
        let mut d = Vec::with_capacity(taille as usize);
        (&mut f).take(taille + 1).read_to_end(&mut d).map_err(|e| format!("« {chemin} » illisible ({e})."))?;
        if d.len() as u64 != taille {
            return Err(format!("« {chemin} » : taille différente de celle de l'archive."));
        }
        fichiers.push((chemin, d));
    }
    // Un fichier ne peut pas porter le nom d'un dossier (« a » et « a/b »).
    for (c, _) in &fichiers {
        let bas = c.to_lowercase();
        let mut p = bas.as_str();
        while let Some(i) = p.rfind('/') {
            p = &p[..i];
            if fichiers.iter().any(|(x, _)| x.to_lowercase() == p) {
                return Err(format!("« {p} » est à la fois un fichier et un dossier dans l'archive."));
            }
        }
    }
    let manifeste = fichiers.iter().find(|(c, _)| c == "manifest.json").map(|(_, d)| d).ok_or("manifest.json absent de la racine de l'archive.")?;
    let Ok(Value::Object(m)) = serde_json::from_slice::<Value>(manifeste) else {
        return Err("manifest.json illisible.".into());
    };
    if m.get("manifest_version").and_then(Value::as_u64) != Some(3) || m.get("name").and_then(Value::as_str) != Some("AETHRYON") {
        return Err("Ce n'est pas l'extension AETHRYON (nom ou Manifest V3).".into());
    }
    let version = m.get("version").and_then(Value::as_str).filter(|v| version_valide(v)).ok_or("manifest.json : version invalide.")?.to_string();
    let id = m.get("key").and_then(Value::as_str).and_then(id_depuis_cle).ok_or("manifest.json : clé publique absente ou illisible.")?;
    if id != id_attendu {
        return Err(format!("Identifiant d'extension inattendu ({id}) : seule l'extension de production est installée."));
    }
    Ok(Archive { version, id, fichiers })
}

#[cfg(test)]
mod essais {
    use super::*;
    use std::io::Write;

    /// Clés PUBLIQUES réelles (extension/src/manifest-key.prod.json et .dev.json, recopiées : le banc du Desktop ne
    /// monte que desktop/). Celle de production donne ID_PRODUCTION.
    pub const CLE_PROD: &str = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAl7CIpdRND225d9rNbcSqnsnWegwKRDYvPw1+KgdTbsrhH89lEATaHSI1BYHdl7nN7YOAof0AEGKMOHCu45RT9VbUfL48f4ZPvbo3xatomRFXf2xxr5uYSQSnl6GoJmH+1abQ6A1/X6TH+4B94XVgQEHzY6HAx8RkRucpnKUbegM68W20aCbj/iAVDH/+KoATUQTbyZlZ777IeliS2Ha5CBSQuPKFeP5O+vx3QzJwpHdCVLPoYpQlAEzEdqqEAT2w9KjbLqkPzPimomUvpoKPEMqjoXDqGRAyWi3+7npNGY38uv9cuRzi1LBfY1CjoWoH/mlJ/zJMUvCEK00VubYgiQIDAQAB";
    pub const CLE_DEV: &str = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA126rx25u3bhvFIgpmqGBctWs2VfWnd23Px8SCmImifXZ2SlAL9AK9Nr/zq5JAbjNhPkgyP5QsnJ4Vxm4/R4PQ79NC6iu0ifVDRBWJItmU//eswzeGKZIvB4P8kuBl560LG8Ewin0Wbicjk9ErSlc7JGbCqGtZfWl9geiHW87zLxqahcN+YcUr2k05daofQlxzqzqnw9bfIh5rG4F5iswiBzmZVtxRNFMJDNowhoPvPfNmrwULpV15WYgcIV6245XzHb4ST5TVjN1XK8PvW8ILunD8lF/uPfyB3JojH2mS/Z/TFtjmLJjiHlJZLH8g203P9B9g81iGA8gDyyoSuQgAwIDAQAB";

    fn cle(c: &str) -> String {
        c.to_string()
    }

    fn zip_de(entrees: &[(&str, &[u8])]) -> Vec<u8> {
        let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let o = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (n, d) in entrees {
            z.start_file(*n, o).unwrap();
            z.write_all(d).unwrap();
        }
        z.finish().unwrap().into_inner()
    }

    fn manifeste(version: &str, cle_b64: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({"manifest_version": 3, "name": "AETHRYON", "version": version, "key": cle_b64})).unwrap()
    }

    #[test]
    fn identifiants_des_cles_reelles() {
        assert_eq!(id_depuis_cle(&cle(CLE_PROD)).as_deref(), Some(ID_PRODUCTION));
        assert_eq!(id_depuis_cle(&cle(CLE_DEV)).as_deref(), Some("dnllfjakdgmgfiompaheickmbjjlgjdc"));
        assert_eq!(id_depuis_cle("pas du base64 !"), None);
    }

    #[test]
    fn versions() {
        assert_eq!(comparer_versions("3.6.1", "3.6.0"), Some(Ordering::Greater));
        assert_eq!(comparer_versions("3.6", "3.6.0"), Some(Ordering::Equal));
        assert_eq!(comparer_versions("3.10.0", "3.9.9"), Some(Ordering::Greater));
        assert_eq!(comparer_versions("3.6.0-beta", "3.6.0"), None);
        assert!(!version_valide("1.2.3.4.5") && !version_valide("") && !version_valide("1..2"));
    }

    #[test]
    fn annonce_schema_exact() {
        let bon = serde_json::json!({"version": "3.6.1", "file": "aethryon-extension-3.6.1.zip", "sha256": "a".repeat(64), "size": 1234,
            "released": "2026-10-21", "minChrome": 116, "notes": ["Bouton « Mettre à jour »", "\u{7}ligne\n  repliée"]});
        let a = lire_annonce(&serde_json::to_vec(&bon).unwrap()).unwrap();
        assert_eq!(a.fichier, "aethryon-extension-3.6.1.zip");
        assert_eq!(a.notes[1], "ligne repliée");
        for (champ, valeur) in [
            ("file", serde_json::json!("../../evil.zip")),
            ("file", serde_json::json!("https://ailleurs.example/aethryon-extension-3.6.1.zip")),
            ("sha256", serde_json::json!("A".repeat(64))),
            ("size", serde_json::json!(0)),
            ("size", serde_json::json!(TAILLE_ARCHIVE_MAX + 1)),
            ("version", serde_json::json!("3.6.1-beta")),
            ("released", serde_json::json!("demain")),
            ("notes", serde_json::json!([1, 2])),
        ] {
            let mut v = bon.clone();
            v[champ] = valeur;
            assert!(lire_annonce(&serde_json::to_vec(&v).unwrap()).is_err(), "{champ} devrait être refusé");
        }
        assert!(lire_annonce(b"[]").is_err());
        assert!(lire_annonce(&vec![b' '; TAILLE_ANNONCE_MAX + 1]).is_err());
    }

    #[test]
    fn empreinte_et_taille() {
        let z = zip_de(&[("manifest.json", &manifeste("3.6.1", &cle(CLE_PROD)))]);
        let mut a = Annonce { version: "3.6.1".into(), fichier: "aethryon-extension-3.6.1.zip".into(), sha256: sha256_hex(&z), taille: z.len() as u64, publiee: "2026-10-21".into(), chrome_min: 116, notes: vec![] };
        verifier_empreinte(&z, &a).unwrap();
        let mut altere = z.clone();
        let n = altere.len();
        altere[n / 2] ^= 0x55;
        assert!(verifier_empreinte(&altere, &a).unwrap_err().contains("SHA-256"));
        a.taille += 1;
        assert!(verifier_empreinte(&z, &a).unwrap_err().contains("octets"));
    }

    #[test]
    fn archive_de_production_acceptee() {
        let z = zip_de(&[("manifest.json", &manifeste("3.6.1", &cle(CLE_PROD))), ("popup/popup.html", b"<p>ok</p>"), ("assets/fonts/a.woff2", b"\0\x01")]);
        let a = ouvrir_archive(&z, ID_PRODUCTION).unwrap();
        assert_eq!((a.version.as_str(), a.id.as_str(), a.fichiers.len()), ("3.6.1", ID_PRODUCTION, 3));
    }

    #[test]
    fn mauvais_identifiant_refuse() {
        let z = zip_de(&[("manifest.json", &manifeste("3.6.1", &cle(CLE_DEV)))]);
        assert!(ouvrir_archive(&z, ID_PRODUCTION).unwrap_err().contains("Identifiant d'extension inattendu"));
        let sans_cle = zip_de(&[("manifest.json", br#"{"manifest_version":3,"name":"AETHRYON","version":"3.6.1"}"#)]);
        assert!(ouvrir_archive(&sans_cle, ID_PRODUCTION).is_err());
        let autre_nom = zip_de(&[("manifest.json", &serde_json::to_vec(&serde_json::json!({"manifest_version": 3, "name": "Autre", "version": "1.0", "key": cle(CLE_PROD)})).unwrap())]);
        assert!(ouvrir_archive(&autre_nom, ID_PRODUCTION).is_err());
        assert!(ouvrir_archive(&zip_de(&[("popup.html", b"x")]), ID_PRODUCTION).unwrap_err().contains("manifest.json absent"));
    }

    #[test]
    fn traversee_et_chemins_dangereux_refuses() {
        let m = manifeste("3.6.1", &cle(CLE_PROD));
        for nom in ["../evil.js", "a/../../evil.js", "/etc/passwd", "C:/Windows/evil.dll", "a\\..\\evil.js", "nul.txt", "a/CON", "a./b", "a /b", "./a", "a//b", "f:flux"] {
            let z = zip_de(&[("manifest.json", &m), (nom, b"x")]);
            assert!(ouvrir_archive(&z, ID_PRODUCTION).is_err(), "« {nom} » devrait être refusé");
        }
        // Doublon à la casse près (un seul fichier sous Windows), fichier qui est aussi un dossier.
        assert!(ouvrir_archive(&zip_de(&[("manifest.json", &m), ("A.js", b"1"), ("a.js", b"2")]), ID_PRODUCTION).is_err());
        assert!(ouvrir_archive(&zip_de(&[("manifest.json", &m), ("x", b"1"), ("x/y", b"2")]), ID_PRODUCTION).is_err());
    }

    #[test]
    fn lien_symbolique_refuse() {
        let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let o = zip::write::SimpleFileOptions::default();
        z.start_file("manifest.json", o).unwrap();
        z.write_all(&manifeste("3.6.1", &cle(CLE_PROD))).unwrap();
        z.add_symlink("popup", "/etc", o).unwrap();
        let z = z.finish().unwrap().into_inner();
        assert!(ouvrir_archive(&z, ID_PRODUCTION).unwrap_err().contains("Lien symbolique"));
    }

    #[test]
    fn archive_alteree_refusee() {
        let z = zip_de(&[("manifest.json", &manifeste("3.6.1", &cle(CLE_PROD))), ("gros.js", &vec![b'a'; 50_000])]);
        // Octets du contenu compressé modifiés : CRC différent, lecture refusée.
        let mut altere = z.clone();
        let pos = altere.windows(7).position(|w| w == b"gros.js").unwrap() + 7 + 8;
        altere[pos] ^= 0xff;
        assert!(ouvrir_archive(&altere, ID_PRODUCTION).is_err());
        assert!(ouvrir_archive(b"PK\x03\x04pas une archive", ID_PRODUCTION).is_err());
    }
}

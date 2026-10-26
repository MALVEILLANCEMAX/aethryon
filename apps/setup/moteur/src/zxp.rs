//! Paquet ZXP signé (extension CEP) : lecture, contrôle d'intégrité contre le Manifest signé de
//! `META-INF/signatures.xml`, extraction fichier par fichier (jamais de lien symbolique), revérification sur disque.
//!
//! La signature RSA et l'horodatage sont vérifiés à la construction (`signature-cep/zxp.py` et xmlsec1). Ici, le setup
//! s'assure que les octets copiés sont exactement ceux que le Manifest signé décrit : chaque fichier présent, chaque
//! SHA-256 identique, aucun fichier en plus, aucun lien.

use base64::Engine;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::{Cursor, Read};
use std::path::Path;

use crate::plateforme::{Fs, TypeEntree};

pub const MIMETYPE: &[u8] = b"application/vnd.adobe.air-ucf-package+zip";
const DSIG: &str = "http://www.w3.org/2000/09/xmldsig#";
const SHA256_URI: &str = "http://www.w3.org/2001/04/xmlenc#sha256";
const SHA1_URI: &str = "http://www.w3.org/2000/09/xmldsig#sha1";

#[derive(Debug, Clone)]
pub struct Reference {
    pub uri: String,
    pub sha256: bool,
    pub empreinte: Vec<u8>,
}

#[derive(Debug)]
pub struct PaquetZxp {
    /// Fichiers (chemin `/` -> contenu), sans les dossiers.
    pub fichiers: BTreeMap<String, Vec<u8>>,
    pub references: Vec<Reference>,
    pub id: String,
    pub version: String,
    pub hote_ppro: Option<String>,
    pub horodate: bool,
}

fn b64(s: &str) -> Option<Vec<u8>> {
    let propre: String = s.chars().filter(|c| !c.is_whitespace()).collect();
    base64::engine::general_purpose::STANDARD.decode(propre).ok()
}

fn empreinte(sha256: bool, d: &[u8]) -> Vec<u8> {
    if sha256 {
        Sha256::digest(d).to_vec()
    } else {
        sha1(d).to_vec()
    }
}

/// SHA-1 minimal (références SHA-1 permises par XML-DSig ; ZXPSignCmd écrit SHA-256, on accepte les deux).
fn sha1(d: &[u8]) -> [u8; 20] {
    let mut h: [u32; 5] = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];
    let mut m = d.to_vec();
    let bits = (d.len() as u64).wrapping_mul(8);
    m.push(0x80);
    while m.len() % 64 != 56 {
        m.push(0);
    }
    m.extend_from_slice(&bits.to_be_bytes());
    for bloc in m.chunks(64) {
        let mut w = [0u32; 80];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([bloc[4 * i], bloc[4 * i + 1], bloc[4 * i + 2], bloc[4 * i + 3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let (mut a, mut b, mut c, mut dd, mut e) = (h[0], h[1], h[2], h[3], h[4]);
        for (i, wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | (!b & dd), 0x5A827999),
                20..=39 => (b ^ c ^ dd, 0x6ED9EBA1),
                40..=59 => ((b & c) | (b & dd) | (c & dd), 0x8F1BBCDC),
                _ => (b ^ c ^ dd, 0xCA62C1D6),
            };
            let t = a.rotate_left(5).wrapping_add(f).wrapping_add(e).wrapping_add(k).wrapping_add(*wi);
            e = dd;
            dd = c;
            c = b.rotate_left(30);
            b = a;
            a = t;
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(dd);
        h[4] = h[4].wrapping_add(e);
    }
    let mut o = [0u8; 20];
    for (i, x) in h.iter().enumerate() {
        o[4 * i..4 * i + 4].copy_from_slice(&x.to_be_bytes());
    }
    o
}

/// Un nom d'entrée sûr : relatif, sans `..`, sans `\`, sans `:` ni caractère de contrôle, sans composant vide.
fn nom_sur(n: &str) -> bool {
    !n.is_empty()
        && !n.starts_with('/')
        && !n.contains('\\')
        && !n.contains(':')
        && !n.chars().any(|c| c.is_control())
        && n.trim_end_matches('/').split('/').all(|c| !c.is_empty() && c != "." && c != "..")
}

pub fn lire_references(xml: &str) -> Result<(Vec<Reference>, bool), String> {
    let doc = roxmltree::Document::parse(xml).map_err(|e| format!("signatures.xml illisible ({e})."))?;
    let est = |n: &roxmltree::Node, nom: &str| n.is_element() && n.tag_name().name() == nom && n.tag_name().namespace() == Some(DSIG);
    let signature = doc.descendants().find(|n| est(n, "Signature")).ok_or("signatures.xml : aucun élément Signature.")?;
    if !signature.descendants().any(|n| est(&n, "SignatureValue")) || !signature.descendants().any(|n| est(&n, "X509Certificate")) {
        return Err("signatures.xml : valeur de signature ou certificat absent.".into());
    }
    let manifeste = signature
        .descendants()
        .find(|n| est(n, "Manifest") && n.attribute("Id") == Some("PackageContents"))
        .ok_or("signatures.xml : Manifest « PackageContents » absent.")?;
    let mut refs = Vec::new();
    for r in manifeste.children().filter(|n| est(n, "Reference")) {
        let uri = r.attribute("URI").ok_or("Reference sans URI.")?.to_string();
        let algo = r.children().find(|n| est(n, "DigestMethod")).and_then(|n| n.attribute("Algorithm")).unwrap_or("");
        let sha256 = match algo {
            SHA256_URI => true,
            SHA1_URI => false,
            _ => return Err(format!("algorithme d'empreinte inconnu pour {uri}.")),
        };
        let valeur = r.children().find(|n| est(n, "DigestValue")).and_then(|n| n.text()).ok_or("DigestValue absent.")?;
        refs.push(Reference { uri, sha256, empreinte: b64(valeur).ok_or("DigestValue illisible.")? });
    }
    if refs.is_empty() {
        return Err("Manifest vide.".into());
    }
    let horodate = doc.descendants().any(|n| n.is_element() && n.tag_name().name() == "EncapsulatedTimeStamp");
    Ok((refs, horodate))
}

/// Identifiant, version et intervalle de Premiere lus dans `CSXS/manifest.xml`.
pub fn lire_manifeste_cep(xml: &str) -> Result<(String, String, Option<String>), String> {
    let doc = roxmltree::Document::parse(xml).map_err(|e| format!("CSXS/manifest.xml illisible ({e})."))?;
    let r = doc.root_element();
    if r.tag_name().name() != "ExtensionManifest" {
        return Err("CSXS/manifest.xml : élément ExtensionManifest absent.".into());
    }
    let id = r.attribute("ExtensionBundleId").ok_or("ExtensionBundleId absent.")?.to_string();
    let version = r.attribute("ExtensionBundleVersion").unwrap_or("").to_string();
    let hote = doc
        .descendants()
        .find(|n| n.is_element() && n.tag_name().name() == "Host" && n.attribute("Name") == Some("PPRO"))
        .and_then(|n| n.attribute("Version"))
        .map(str::to_string);
    Ok((id, version, hote))
}

impl PaquetZxp {
    pub fn ouvrir(octets: &[u8]) -> Result<PaquetZxp, String> {
        let mut a = zip::ZipArchive::new(Cursor::new(octets)).map_err(|e| format!("ZXP illisible ({e})."))?;
        let mut fichiers = BTreeMap::new();
        for i in 0..a.len() {
            let mut f = a.by_index(i).map_err(|e| format!("ZXP : entrée illisible ({e})."))?;
            let nom = f.name().to_string();
            if !nom_sur(&nom) {
                return Err(format!("ZXP : nom d'entrée refusé « {nom} »."));
            }
            if let Some(mode) = f.unix_mode() {
                if mode & 0o170000 == 0o120000 {
                    return Err(format!("ZXP : lien symbolique refusé « {nom} » (problème connu de novembre 2024)."));
                }
            }
            if f.is_dir() {
                continue;
            }
            let mut v = Vec::with_capacity(f.size() as usize);
            f.read_to_end(&mut v).map_err(|e| format!("ZXP : {nom} illisible ({e})."))?;
            if fichiers.insert(nom.clone(), v).is_some() {
                return Err(format!("ZXP : entrée en double « {nom} »."));
            }
        }
        if fichiers.get("mimetype").map(|v| v.as_slice()) != Some(MIMETYPE) {
            return Err("ZXP : mimetype absent ou inattendu.".into());
        }
        let xml = fichiers.get("META-INF/signatures.xml").ok_or("ZXP non signé : META-INF/signatures.xml absent.")?;
        let xml = std::str::from_utf8(xml).map_err(|_| "signatures.xml n'est pas en UTF-8.")?;
        let (references, horodate) = lire_references(xml)?;
        let man = fichiers.get("CSXS/manifest.xml").ok_or("ZXP : CSXS/manifest.xml absent.")?;
        let (id, version, hote_ppro) = lire_manifeste_cep(&String::from_utf8_lossy(man))?;
        let p = PaquetZxp { fichiers, references, id, version, hote_ppro, horodate };
        p.verifier_integrite()?;
        Ok(p)
    }

    /// Chaque fichier correspond à sa référence ; aucun fichier hors Manifest (sauf signatures.xml).
    pub fn verifier_integrite(&self) -> Result<(), String> {
        let mut vus = std::collections::BTreeSet::new();
        for r in &self.references {
            if !nom_sur(&r.uri) {
                return Err(format!("Manifest : URI refusée « {} ».", r.uri));
            }
            let d = self.fichiers.get(&r.uri).ok_or_else(|| format!("Manifest : {} absent du paquet.", r.uri))?;
            if empreinte(r.sha256, d) != r.empreinte {
                return Err(format!("{} : empreinte différente du Manifest signé.", r.uri));
            }
            vus.insert(r.uri.as_str());
        }
        let en_trop: Vec<&String> = self.fichiers.keys().filter(|k| k.as_str() != "META-INF/signatures.xml" && !vus.contains(k.as_str())).collect();
        if !en_trop.is_empty() {
            return Err(format!("fichiers non signés dans le paquet : {}", en_trop.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")));
        }
        Ok(())
    }

    pub fn taille(&self) -> u64 {
        self.fichiers.values().map(|v| v.len() as u64).sum()
    }
}

fn chemin_de(dossier: &Path, rel: &str) -> std::path::PathBuf {
    let mut p = dossier.to_path_buf();
    for c in rel.split('/') {
        p.push(c);
    }
    p
}

/// Écrit le paquet extrait dans `dossier` (qui doit être vide ou absent) : chaque fichier, `mimetype` et
/// `META-INF/signatures.xml` compris, sans aucun lien. `avance` reçoit les octets écrits.
pub fn extraire(fs: &dyn Fs, p: &PaquetZxp, dossier: &Path, avance: &mut dyn FnMut(u64)) -> Result<(), String> {
    fs.creer_dossiers(dossier).map_err(|e| format!("Création de {} impossible ({e}).", dossier.display()))?;
    for (rel, d) in &p.fichiers {
        let cible = chemin_de(dossier, rel);
        if let Some(parent) = cible.parent() {
            fs.creer_dossiers(parent).map_err(|e| format!("Création de {} impossible ({e}).", parent.display()))?;
        }
        fs.ecrire(&cible, d, avance).map_err(|e| format!("Écriture de {} impossible ({e}).", cible.display()))?;
    }
    Ok(())
}

/// Revérifie une extension installée sur disque contre son Manifest signé. Renvoie le nombre de fichiers conformes.
pub fn verifier_dossier(fs: &dyn Fs, dossier: &Path) -> Result<usize, String> {
    let sig = fs.lire(&chemin_de(dossier, "META-INF/signatures.xml")).map_err(|_| "META-INF/signatures.xml absent : extension non signée.".to_string())?;
    let (refs, _) = lire_references(&String::from_utf8_lossy(&sig))?;
    let mut n = 0;
    for r in &refs {
        if !nom_sur(&r.uri) {
            return Err(format!("URI refusée « {} ».", r.uri));
        }
        let c = chemin_de(dossier, &r.uri);
        match fs.type_de(&c) {
            Some(TypeEntree::Fichier) => {}
            Some(TypeEntree::Lien) => return Err(format!("{} est un lien symbolique.", r.uri)),
            _ => return Err(format!("{} manquant.", r.uri)),
        }
        let d = fs.lire(&c).map_err(|e| format!("{} illisible ({e}).", r.uri))?;
        if empreinte(r.sha256, &d) != r.empreinte {
            return Err(format!("{} modifié depuis la signature.", r.uri));
        }
        n += 1;
    }
    // Aucun fichier ni lien en plus.
    let attendus: std::collections::BTreeSet<String> = refs.iter().map(|r| r.uri.to_lowercase()).chain(["meta-inf/signatures.xml".to_string()]).collect();
    let mut pile = vec![(dossier.to_path_buf(), String::new())];
    while let Some((d, prefixe)) = pile.pop() {
        for nom in fs.lister(&d).map_err(|e| format!("{} illisible ({e}).", d.display()))? {
            let rel = if prefixe.is_empty() { nom.clone() } else { format!("{prefixe}/{nom}") };
            let c = d.join(&nom);
            match fs.type_de(&c) {
                Some(TypeEntree::Dossier) => pile.push((c, rel)),
                Some(TypeEntree::Lien) => return Err(format!("lien symbolique en trop : {rel}")),
                _ => {
                    if !attendus.contains(&rel.to_lowercase()) {
                        return Err(format!("fichier non signé en trop : {rel}"));
                    }
                }
            }
        }
    }
    Ok(n)
}

#[cfg(test)]
pub mod essais {
    use super::*;

    /// Un ZXP « signé » pour les essais : Manifest exact (empreintes réelles), signature RSA factice.
    pub fn zxp_essai(version: &str, extra: &[(&str, &[u8])]) -> Vec<u8> {
        use std::io::Write;
        let manifest = format!(
            r#"<ExtensionManifest Version="7.0" ExtensionBundleId="fr.aethryon.premiere" ExtensionBundleVersion="{version}"><ExecutionEnvironment><HostList><Host Name="PPRO" Version="[25.0,99.9]"/></HostList></ExecutionEnvironment></ExtensionManifest>"#
        );
        let mut fichiers: Vec<(String, Vec<u8>)> = vec![
            ("CSXS/manifest.xml".into(), manifest.into_bytes()),
            ("client/index.html".into(), b"<!doctype html><p>AETHRYON</p>".to_vec()),
        ];
        for (n, d) in extra {
            fichiers.push((n.to_string(), d.to_vec()));
        }
        let e = |d: &[u8]| base64::engine::general_purpose::STANDARD.encode(Sha256::digest(d));
        let mut refs = format!(r#"<Reference URI="mimetype"><DigestMethod Algorithm="{SHA256_URI}"/><DigestValue>{}</DigestValue></Reference>"#, e(MIMETYPE));
        for (n, d) in &fichiers {
            refs += &format!(r#"<Reference URI="{}"><DigestMethod Algorithm="{SHA256_URI}"/><DigestValue>{}</DigestValue></Reference>"#, n.replace('&', "&amp;"), e(d));
        }
        let sig = format!(
            "<signatures>\r\n<Signature xmlns=\"{DSIG}\" Id=\"PackageSignature\">\r\n<SignedInfo/>\r\n<SignatureValue Id=\"PackageSignatureValue\">AAAA</SignatureValue>\r\n<KeyInfo><X509Data><X509Certificate>AAAA</X509Certificate></X509Data></KeyInfo>\r\n<Object>\r\n<Manifest Id=\"PackageContents\">\r\n{refs}</Manifest>\r\n</Object>\r\n</Signature>\r\n</signatures>"
        );
        let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let o = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        z.start_file("mimetype", o).unwrap();
        z.write_all(MIMETYPE).unwrap();
        z.add_directory("META-INF/", o).unwrap();
        z.start_file("META-INF/signatures.xml", o).unwrap();
        z.write_all(sig.as_bytes()).unwrap();
        for (n, d) in &fichiers {
            z.start_file(n.as_str(), o).unwrap();
            z.write_all(d).unwrap();
        }
        z.finish().unwrap().into_inner()
    }

    #[test]
    fn sha1_connu() {
        let h: String = sha1(b"abc").iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(h, "a9993e364706816aba3e25717850c26c9cd0d89d");
        let h: String = sha1(&[b'a'; 1000]).iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(h, "291e9a6c66994949b57ba5e650361e98fc36b1ba");
    }

    #[test]
    fn paquet_valide_et_extraction() {
        let z = zxp_essai("1.2.3", &[("client/Éléments/a&b.txt", b"x")]);
        let p = PaquetZxp::ouvrir(&z).unwrap();
        assert_eq!((p.id.as_str(), p.version.as_str(), p.hote_ppro.as_deref()), ("fr.aethryon.premiere", "1.2.3", Some("[25.0,99.9]")));
        let b = crate::factice::Banc::nouveau();
        let d = Path::new("C:\\Users\\Élodie\\AppData\\Roaming\\Adobe\\CEP\\extensions\\fr.aethryon.premiere");
        let mut octets = 0;
        extraire(b.fs.as_ref(), &p, d, &mut |n| octets += n).unwrap();
        assert_eq!(octets, p.taille());
        assert_eq!(verifier_dossier(b.fs.as_ref(), d).unwrap(), 4); // mimetype + 3 fichiers
        // Un fichier modifié, ajouté, ou remplacé par un lien : refusé.
        b.fs.ecrire_tout(&d.join("client").join("index.html"), b"autre").unwrap();
        assert!(verifier_dossier(b.fs.as_ref(), d).unwrap_err().contains("modifié"));
        extraire(b.fs.as_ref(), &p, d, &mut |_| {}).unwrap();
        b.fs.ecrire_tout(&d.join("en-trop.js"), b"x").unwrap();
        assert!(verifier_dossier(b.fs.as_ref(), d).unwrap_err().contains("en trop"));
        b.fs.supprimer_fichier(&d.join("en-trop.js")).unwrap();
        b.fs.supprimer_fichier(&d.join("mimetype")).unwrap();
        b.fs.poser_lien(d.join("mimetype"));
        assert!(verifier_dossier(b.fs.as_ref(), d).unwrap_err().contains("lien"));
    }

    #[test]
    fn paquets_refuses() {
        let mut z = zxp_essai("1.0.0", &[]);
        // Octet modifié dans un fichier signé (le ZIP reste lisible : on remplace dans la zone non compressée).
        let i = z.windows(9).position(|w| w == b"AETHRYON<").unwrap();
        z[i] = b'X';
        assert!(PaquetZxp::ouvrir(&z).is_err());
        assert!(!nom_sur("../x") && !nom_sur("/x") && !nom_sur("a\\b") && !nom_sur("C:x") && nom_sur("a/b.js"));
    }
}

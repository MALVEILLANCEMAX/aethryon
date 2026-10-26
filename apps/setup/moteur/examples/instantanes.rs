//! Produit, avec le VRAI moteur sur un système FACTICE, les données que la maquette de l'API Tauri rejoue pour les
//! captures Playwright : états d'ouverture (installation, Premiere introuvable, maintenance, mise à jour) et suites
//! d'avancements réels (installation, échec avec retour arrière, désinstallation).
//!
//!   cargo run -p aethryon-setup-moteur --example instantanes -- <dossier de sortie>

use aethryon_setup_moteur::charge::{self, sha256_hex, Charge, ComposantDesktop, ComposantExtension, FichierCharge, ManifesteCharge};
use aethryon_setup_moteur::desinstallation::desinstaller;
use aethryon_setup_moteur::factice::Banc;
use aethryon_setup_moteur::journal::Journal;
use aethryon_setup_moteur::operations::{executer, Demande, Operation};
use aethryon_setup_moteur::plateforme::*;
use aethryon_setup_moteur::session::etat_initial;
use aethryon_setup_moteur::*;
use base64::Engine;
use sha2::{Digest, Sha256};
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

const MIMETYPE: &[u8] = b"application/vnd.adobe.air-ucf-package+zip";

fn zxp(version: &str) -> Vec<u8> {
    let manifest = format!(r#"<ExtensionManifest Version="7.0" ExtensionBundleId="fr.aethryon.premiere" ExtensionBundleVersion="{version}"><ExecutionEnvironment><HostList><Host Name="PPRO" Version="[25.0,99.9]"/></HostList></ExecutionEnvironment></ExtensionManifest>"#);
    let mut fichiers: Vec<(String, Vec<u8>)> = vec![("CSXS/manifest.xml".into(), manifest.into_bytes())];
    for (i, t) in [180_000usize, 640_000, 52_000, 1_200_000, 24_000].iter().enumerate() {
        fichiers.push((format!("client/assets/morceau-{i}.js"), vec![(i as u8) + 1; *t]));
    }
    let e = |d: &[u8]| base64::engine::general_purpose::STANDARD.encode(Sha256::digest(d));
    let alg = "http://www.w3.org/2001/04/xmlenc#sha256";
    let mut refs = format!(r#"<Reference URI="mimetype"><DigestMethod Algorithm="{alg}"/><DigestValue>{}</DigestValue></Reference>"#, e(MIMETYPE));
    for (n, d) in &fichiers {
        refs += &format!(r#"<Reference URI="{n}"><DigestMethod Algorithm="{alg}"/><DigestValue>{}</DigestValue></Reference>"#, e(d));
    }
    let sig = format!("<signatures><Signature xmlns=\"http://www.w3.org/2000/09/xmldsig#\"><SignedInfo/><SignatureValue>AA</SignatureValue><KeyInfo><X509Data><X509Certificate>AA</X509Certificate></X509Data></KeyInfo><Object><Manifest Id=\"PackageContents\">{refs}</Manifest></Object><Object><EncapsulatedTimeStamp>AA</EncapsulatedTimeStamp></Object></Signature></signatures>");
    let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let o = zip::write::SimpleFileOptions::default();
    z.start_file("mimetype", o.compression_method(zip::CompressionMethod::Stored)).unwrap();
    z.write_all(MIMETYPE).unwrap();
    z.start_file("META-INF/signatures.xml", o).unwrap();
    z.write_all(sig.as_bytes()).unwrap();
    for (n, d) in &fichiers {
        z.start_file(n.as_str(), o).unwrap();
        z.write_all(d).unwrap();
    }
    z.finish().unwrap().into_inner()
}

fn fc(source: &str, nom: &str, d: &[u8]) -> FichierCharge {
    FichierCharge { source: source.into(), nom: nom.into(), sha256: sha256_hex(d), taille: d.len() as u64 }
}

fn charge(version: &str, ext: &str, desk: &str) -> Charge {
    let z = zxp(ext);
    let exe = vec![0x4Du8; 12_400_000];
    let dll = vec![0x5Au8; 160_000];
    let mut signature = std::collections::BTreeMap::new();
    signature.insert("algorithme".into(), "rsa-sha1".into());
    signature.insert("horodatage".into(), "RFC 3161, autorité locale".into());
    let m = ManifesteCharge {
        schema: 1,
        produit: "AETHRYON".into(),
        version: version.into(),
        editeur: "AETHRYON".into(),
        construit_le: "2026-10-18T00:00:00Z".into(),
        extension: ComposantExtension { id: ID_EXTENSION.into(), version: ext.into(), fichier: fc("extension/fr.aethryon.premiere.zxp", "fr.aethryon.premiere.zxp", &z), hote_ppro: "[25.0,99.9]".into(), remplacant: false, signature },
        desktop: Some(ComposantDesktop { version: desk.into(), exe: "aethryon-desktop.exe".into(), fichiers: vec![fc("desktop/aethryon-desktop.exe", "aethryon-desktop.exe", &exe), fc("desktop/WebView2Loader.dll", "WebView2Loader.dll", &dll)] }),
        navigateur: None,
        interface: vec![],
    };
    Charge::ouvrir(charge::construire(&m, &[("extension/fr.aethryon.premiere.zxp", &z), ("desktop/aethryon-desktop.exe", &exe), ("desktop/WebView2Loader.dll", &dll)])).unwrap()
}

const AMORCE: &str = "C:\\Users\\Élodie\\Downloads\\AETHRYON-Setup-2.0.0-beta.2.exe";

fn pc(premiere: bool) -> Banc {
    let b = Banc::nouveau();
    b.fs.poser(AMORCE, &vec![1u8; 4_000_000]);
    if premiere {
        let exe = "C:\\Program Files\\Adobe\\Adobe Premiere Pro 2026\\Adobe Premiere Pro.exe";
        b.fs.poser(exe, b"MZ");
        b.systeme.poser_version(exe, "26.5.2.13");
    }
    b.fs.poser("C:\\Program Files\\Adobe\\Adobe Creative Cloud\\ACC\\Creative Cloud.exe", b"MZ");
    b.registre.poser(Racine::Hklm, "SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}", "pv", Valeur::Chaine("141.0.3537.71".into()));
    b.registre.poser(Racine::Hklm, "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion", "CurrentBuildNumber", Valeur::Chaine("26100".into()));
    b
}

fn demande(b: &Banc, op: Operation) -> Demande {
    Demande { operation: op, options: Options::par_defaut(&b.env), amorce: Some(PathBuf::from(AMORCE)), annuler: Arc::new(AtomicBool::new(false)) }
}

/// Les chemins du système factice mêlent `\` et `/` sous Linux : on les remet au format Windows.
fn ecrire(dossier: &Path, nom: &str, v: &impl serde::Serialize) {
    let t = serde_json::to_string_pretty(v).unwrap().replace('/', "\\\\").replace("\\\\\\\\", "\\\\");
    std::fs::write(dossier.join(nom), t).unwrap();
}

fn main() {
    let sortie = PathBuf::from(std::env::args().nth(1).expect("dossier de sortie"));
    std::fs::create_dir_all(&sortie).unwrap();
    let c = charge("2.0.0-beta.2", "2.0.0", "1.0.0-beta.3");

    let b = pc(true);
    ecrire(&sortie, "etat-installation.json", &etat_initial(&b.env, &c, "normal", None, None));
    ecrire(&sortie, "etat-introuvable.json", &etat_initial(&pc(false).env, &c, "normal", None, None));

    let mut vus = vec![];
    let av = executer(&b.env, &c, &demande(&b, Operation::Installer), &Journal::memoire(), &mut |a| vus.push(a.clone()));
    assert!(av.succes);
    ecrire(&sortie, "installation.json", &vus);
    ecrire(&sortie, "etat-maintenance.json", &etat_initial(&b.env, &c, "maintenance", None, None));
    let c2 = charge("2.0.0-beta.3", "2.1.0", "1.0.0-beta.4");
    ecrire(&sortie, "etat-mise-a-jour.json", &etat_initial(&b.env, &c2, "maintenance", None, None));

    b.fs.poser("C:\\Users\\Élodie\\Videos\\AETHRYON\\coucher-de-soleil.mp4", &vec![0u8; 48_000_000]);
    b.fs.poser("C:\\Users\\Élodie\\Videos\\AETHRYON\\interview.mov", &vec![0u8; 1_320_000_000]);
    let (n, t) = aethryon_setup_moteur::desinstallation::inventaire_medias(b.fs.as_ref(), Path::new("C:\\Users\\Élodie\\Videos\\AETHRYON"));
    ecrire(&sortie, "medias.json", &(n, t));
    let mut vus = vec![];
    desinstaller(&b.env, true, true, &Journal::memoire(), &mut |a| vus.push(a.clone()));
    ecrire(&sortie, "desinstallation.json", &vus);

    // PC du propriétaire : la bêta 1.0.0-beta.2 (installateur NSIS) est déjà là ; elle est remplacée.
    let b = pc(true);
    let d = dossier_installation(&b.env);
    b.fs.poser(d.join("aethryon-desktop.exe"), b"MZ ancien");
    b.fs.poser(d.join("desinstaller.exe"), b"MZ nsis");
    b.fs.poser(d.join("panneau").join("aethryon-premiere.ccx"), b"PK");
    b.fs.poser(d.join("licences").join("LICENSE-Inter.txt"), b"OFL");
    b.registre.poser(Racine::Hkcu, CLE_ANCIENNE_BETA, "DisplayVersion", Valeur::Chaine("1.0.0-beta.2".into()));
    ecrire(&sortie, "etat-ancienne-beta.json", &etat_initial(&b.env, &c, "normal", None, None));
    let mut vus = vec![];
    let av = executer(&b.env, &c, &demande(&b, Operation::Installer), &Journal::memoire(), &mut |a| vus.push(a.clone()));
    assert!(av.succes && av.resultat.as_ref().unwrap().ancienne_beta_remplacee.is_some());
    ecrire(&sortie, "installation-ancienne-beta.json", &vus);

    let b = pc(true);
    *b.registre.panne.lock().unwrap() = Some("EstimatedSize".into());
    let mut vus = vec![];
    let av = executer(&b.env, &c, &demande(&b, Operation::Installer), &Journal::memoire(), &mut |a| vus.push(a.clone()));
    assert!(!av.succes);
    ecrire(&sortie, "echec.json", &vus);
    println!("instantanés écrits dans {}", sortie.display());
}

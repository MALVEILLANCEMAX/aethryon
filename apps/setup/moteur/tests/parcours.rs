//! Parcours complets sur un système FACTICE (fichiers et registre en mémoire) : installation, détection de
//! l'installation (mode maintenance), réparation, mise à jour, pannes avec retour arrière, annulation,
//! désinstallation (médias gardés ou supprimés), remplacement de l'ancienne bêta NSIS.

use aethryon_setup_moteur::charge::{self, sha256_hex, Charge, ComposantDesktop, ComposantExtension, ComposantNavigateur, FichierCharge, ManifesteCharge};
use aethryon_setup_moteur::navigateur;
use aethryon_setup_moteur::desinstallation::{desinstaller, inventaire_medias};
use aethryon_setup_moteur::factice::Banc;
use aethryon_setup_moteur::journal::Journal;
use aethryon_setup_moteur::operations::{executer, Avancement, Demande, Etat, Operation};
use aethryon_setup_moteur::plateforme::*;
use aethryon_setup_moteur::*;
use base64::Engine;
use sha2::{Digest, Sha256};
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

const MIMETYPE: &[u8] = b"application/vnd.adobe.air-ucf-package+zip";

fn zxp(version: &str) -> Vec<u8> {
    let manifest = format!(r#"<ExtensionManifest Version="7.0" ExtensionBundleId="fr.aethryon.premiere" ExtensionBundleVersion="{version}"><ExecutionEnvironment><HostList><Host Name="PPRO" Version="[25.0,99.9]"/></HostList></ExecutionEnvironment></ExtensionManifest>"#);
    let fichiers: Vec<(String, Vec<u8>)> = vec![
        ("CSXS/manifest.xml".into(), manifest.into_bytes()),
        ("client/index.html".into(), format!("<p>AETHRYON {version}</p>").into_bytes()),
        ("client/js/app.js".into(), vec![7u8; 300_000]),
    ];
    let e = |d: &[u8]| base64::engine::general_purpose::STANDARD.encode(Sha256::digest(d));
    let alg = "http://www.w3.org/2001/04/xmlenc#sha256";
    let mut refs = format!(r#"<Reference URI="mimetype"><DigestMethod Algorithm="{alg}"/><DigestValue>{}</DigestValue></Reference>"#, e(MIMETYPE));
    for (n, d) in &fichiers {
        refs += &format!(r#"<Reference URI="{n}"><DigestMethod Algorithm="{alg}"/><DigestValue>{}</DigestValue></Reference>"#, e(d));
    }
    let sig = format!("<signatures><Signature xmlns=\"http://www.w3.org/2000/09/xmldsig#\" Id=\"PackageSignature\"><SignedInfo/><SignatureValue>AAAA</SignatureValue><KeyInfo><X509Data><X509Certificate>AAAA</X509Certificate></X509Data></KeyInfo><Object><Manifest Id=\"PackageContents\">{refs}</Manifest></Object></Signature></signatures>");
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

/// Clé PUBLIQUE de production de l'extension navigateur (extension/src/manifest-key.prod.json).
const CLE_PROD: &str = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAl7CIpdRND225d9rNbcSqnsnWegwKRDYvPw1+KgdTbsrhH89lEATaHSI1BYHdl7nN7YOAof0AEGKMOHCu45RT9VbUfL48f4ZPvbo3xatomRFXf2xxr5uYSQSnl6GoJmH+1abQ6A1/X6TH+4B94XVgQEHzY6HAx8RkRucpnKUbegM68W20aCbj/iAVDH/+KoATUQTbyZlZ777IeliS2Ha5CBSQuPKFeP5O+vx3QzJwpHdCVLPoYpQlAEzEdqqEAT2w9KjbLqkPzPimomUvpoKPEMqjoXDqGRAyWi3+7npNGY38uv9cuRzi1LBfY1CjoWoH/mlJ/zJMUvCEK00VubYgiQIDAQAB";

fn zip_navigateur(version: &str, extra: &[(&str, &[u8])]) -> Vec<u8> {
    let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let o = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let m = format!(r#"{{"manifest_version":3,"name":"AETHRYON","version":"{version}","key":"{CLE_PROD}"}}"#);
    for (n, d) in [("manifest.json", m.as_bytes()), ("popup/popup.html", b"<p>popup</p>".as_slice())].into_iter().chain(extra.iter().copied()) {
        z.start_file(n, o).unwrap();
        z.write_all(d).unwrap();
    }
    z.finish().unwrap().into_inner()
}

fn charge(version: &str, ext_version: &str, desktop_version: &str) -> Charge {
    charge_nav(version, ext_version, desktop_version, Some(zip_navigateur("3.6.1", &[])), "3.6.1")
}

fn charge_nav(version: &str, ext_version: &str, desktop_version: &str, nav: Option<Vec<u8>>, nav_version: &str) -> Charge {
    let z = zxp(ext_version);
    let exe = format!("MZ AETHRYON Desktop {desktop_version}").into_bytes().repeat(40_000);
    let dll = b"MZ WebView2Loader".to_vec();
    let m = ManifesteCharge {
        schema: 1,
        produit: "AETHRYON".into(),
        version: version.into(),
        editeur: "AETHRYON".into(),
        construit_le: String::new(),
        extension: ComposantExtension {
            id: "fr.aethryon.premiere".into(),
            version: ext_version.into(),
            fichier: fc("extension/fr.aethryon.premiere.zxp", "fr.aethryon.premiere.zxp", &z),
            hote_ppro: "[25.0,99.9]".into(),
            remplacant: false,
            signature: Default::default(),
        },
        desktop: Some(ComposantDesktop {
            version: desktop_version.into(),
            exe: "aethryon-desktop.exe".into(),
            fichiers: vec![fc("desktop/aethryon-desktop.exe", "aethryon-desktop.exe", &exe), fc("desktop/WebView2Loader.dll", "WebView2Loader.dll", &dll)],
        }),
        navigateur: nav.as_ref().map(|n| ComposantNavigateur { id: navigateur::ID_PRODUCTION.into(), version: nav_version.into(), fichier: fc("navigateur/aethryon-extension.zip", "aethryon-extension.zip", n) }),
        interface: vec![],
    };
    let mut fichiers: Vec<(&str, &[u8])> = vec![("extension/fr.aethryon.premiere.zxp", &z), ("desktop/aethryon-desktop.exe", &exe), ("desktop/WebView2Loader.dll", &dll)];
    if let Some(n) = &nav {
        fichiers.push(("navigateur/aethryon-extension.zip", n));
    }
    let octets = charge::construire(&m, &fichiers);
    Charge::ouvrir(octets).unwrap()
}

const AMORCE: &str = "C:\\Users\\Élodie\\Downloads\\AETHRYON-Setup-2.0.0-beta.1.exe";

fn banc() -> Banc {
    let b = Banc::nouveau();
    b.fs.poser(AMORCE, b"MZ amorce AETHRYON Setup");
    b
}

fn demande(b: &Banc, op: Operation) -> Demande {
    Demande { operation: op, options: Options::par_defaut(&b.env), amorce: Some(PathBuf::from(AMORCE)), annuler: Arc::new(AtomicBool::new(false)) }
}

fn lancer(b: &Banc, c: &Charge, d: &Demande) -> (Avancement, Vec<Avancement>) {
    let mut vus = vec![];
    let j = Journal::fichier(b.fs.clone(), b.env.emplacements.journaux());
    let av = executer(&b.env, c, d, &j, &mut |a| vus.push(a.clone()));
    (av, vus)
}

fn hkcu(b: &Banc, cle: &str, nom: &str) -> Option<String> {
    b.registre.chaine(Racine::Hkcu, cle, nom)
}

fn install_dir(b: &Banc) -> PathBuf {
    b.env.emplacements.dossier_installation()
}

/// Photographie de tout ce qui compte (fichiers + clés HKCU), pour vérifier un retour arrière à l'identique.
fn photo(b: &Banc) -> (Vec<String>, Vec<String>, Vec<Option<String>>) {
    let mut f = b.fs.fichiers_sous("C:\\Users\\Élodie");
    f.retain(|x| !x.contains("journaux"));
    f.sort();
    let mut contenus: Vec<Option<String>> = f.iter().map(|x| b.fs.lire(Path::new(x)).ok().map(|d| sha256_hex(&d))).collect();
    contenus.push(hkcu(b, CLE_DESINSTALLATION, "DisplayVersion"));
    contenus.push(hkcu(b, CLE_RUN, VALEUR_RUN));
    // Les clés parentes (Software\\Microsoft\\…\\Uninstall) existent toujours sous Windows : on ne compare que les nôtres.
    let cles = b.registre.toutes_les_cles_hkcu().into_iter().filter(|k| k.contains("aethryon") || k.contains("csxs")).collect();
    (f, cles, contenus)
}

/// Chemins comparés au format Windows (sous Linux, `Path::join` ajoute des `/`).
fn w(s: impl AsRef<str>) -> String {
    s.as_ref().replace('/', "\\")
}

#[test]
fn installation_complete() {
    let b = banc();
    let c = charge("2.0.0-beta.1", "1.0.0", "1.0.0-beta.3");
    let (av, vus) = lancer(&b, &c, &demande(&b, Operation::Installer));
    assert!(av.succes, "{:?}", av.erreur);
    assert!(av.etapes.iter().all(|e| e.etat == Etat::Termine));
    assert!(vus.len() > 15, "progression envoyée au fil de l'eau");
    // Progression réelle et monotone de la copie (octets).
    let copie: Vec<u64> = vus.iter().filter(|a| a.courante == 1).map(|a| a.etapes[1].fait).collect();
    assert!(copie.windows(2).all(|w| w[0] <= w[1]));
    assert!(av.etapes[1].total > 1_000_000);
    let d = install_dir(&b);
    // Fichiers
    for n in ["aethryon-desktop.exe", "WebView2Loader.dll", "AETHRYON-Setup.exe", "installation.json"] {
        assert!(b.fs.est_fichier(&d.join(n)), "{n}");
    }
    let ext = b.env.emplacements.dossier_extension();
    assert_eq!(w(ext.to_string_lossy()), "C:\\Users\\Élodie\\AppData\\Roaming\\Adobe\\CEP\\extensions\\fr.aethryon.premiere");
    for n in ["mimetype", "META-INF\\signatures.xml", "CSXS\\manifest.xml", "client\\js\\app.js"] {
        assert!(b.fs.est_fichier(&ext.join(n)), "{n}");
    }
    // Aucun reste de préparation ni de sauvegarde.
    assert!(b.fs.lister(Path::new("C:\\Users\\Élodie\\AppData\\Roaming\\Adobe\\CEP")).unwrap() == vec!["extensions".to_string()]);
    assert!(!b.fs.lister(&d).unwrap().iter().any(|n| n.starts_with(".retour")));
    // Registre
    assert_eq!(hkcu(&b, CLE_DESINSTALLATION, "DisplayVersion").as_deref(), Some("2.0.0-beta.1"));
    assert_eq!(hkcu(&b, CLE_DESINSTALLATION, "Publisher").as_deref(), Some("AETHRYON"));
    assert_eq!(w(hkcu(&b, CLE_DESINSTALLATION, "UninstallString").unwrap()), w(format!("\"{}\\AETHRYON-Setup.exe\" --desinstaller", d.display())));
    assert_eq!(w(hkcu(&b, CLE_DESINSTALLATION, "ModifyPath").unwrap()), w(format!("\"{}\\AETHRYON-Setup.exe\" --maintenance", d.display())));
    assert_eq!(w(hkcu(&b, CLE_DESINSTALLATION, "DisplayIcon").unwrap()), w(format!("\"{}\\aethryon-desktop.exe\",0", d.display())));
    assert!(b.registre.lire(Racine::Hkcu, CLE_DESINSTALLATION, "EstimatedSize").unwrap().dword().unwrap() > 1000);
    assert_eq!(w(hkcu(&b, CLE_RUN, VALEUR_RUN).unwrap()), w(format!("\"{}\\aethryon-desktop.exe\" --arriere-plan", d.display())));
    // PlayerDebugMode : jamais écrit.
    assert!(!b.registre.toutes_les_cles_hkcu().iter().any(|k| k.contains("csxs")));
    // Raccourci, préférences, médias
    assert_eq!(b.systeme.raccourcis.lock().unwrap().len(), 1);
    assert!(b.fs.est_dossier(Path::new("C:\\Users\\Élodie\\Videos\\AETHRYON")));
    let conf: serde_json::Value = serde_json::from_slice(&b.fs.lire(Path::new("C:\\Users\\Élodie\\AppData\\Roaming\\AETHRYON\\config.json")).unwrap()).unwrap();
    assert_eq!(w(conf["dossierMedias"].as_str().unwrap()), "C:\\Users\\Élodie\\Videos\\AETHRYON");
    assert_eq!(conf["demarrageAuto"], true);
    let r = av.resultat.unwrap();
    assert_eq!((r.version_desktop.as_deref(), r.version_extension.as_deref()), (Some("1.0.0-beta.3"), Some("1.0.0")));
    // Journal écrit
    let j = b.fs.fichiers_sous(b.env.emplacements.journaux());
    assert_eq!(j.len(), 1);
    assert!(String::from_utf8(b.fs.lire(Path::new(&j[0])).unwrap()).unwrap().contains("Terminé avec succès"));
}

#[test]
fn maintenance_detectee_puis_reparation() {
    let b = banc();
    let c = charge("2.0.0-beta.1", "1.0.0", "1.0.0-beta.3");
    assert!(installation_existante(&b.env).is_none());
    assert!(lancer(&b, &c, &demande(&b, Operation::Installer)).0.succes);
    let inst = installation_existante(&b.env).expect("mode maintenance");
    assert_eq!(inst.version, "2.0.0-beta.1");
    assert_eq!(actions_possibles(&inst.version, &c.manifeste.version), vec![Action::Reparer, Action::Desinstaller]);
    // Dégâts : exe supprimé, fichier de l'extension altéré, démarrage automatique retiré, raccourci effacé.
    let d = install_dir(&b);
    let ext = b.env.emplacements.dossier_extension();
    b.fs.supprimer_fichier(&d.join("aethryon-desktop.exe")).unwrap();
    b.fs.ecrire_tout(&ext.join("client").join("index.html"), b"abime").unwrap();
    b.fs.ecrire_tout(&ext.join("parasite.js"), b"x").unwrap();
    b.registre.supprimer_valeur(CLE_RUN, VALEUR_RUN).unwrap();
    // Réparer : avec les choix enregistrés dans l'inventaire.
    let mut dem = demande(&b, Operation::Reparer);
    dem.options = inst.inventaire.unwrap().options;
    dem.amorce = Some(d.join(NOM_SETUP)); // lancé depuis la copie gardée
    let (av, _) = lancer(&b, &c, &dem);
    assert!(av.succes, "{:?}", av.erreur);
    assert!(b.fs.est_fichier(&d.join("aethryon-desktop.exe")));
    assert_eq!(b.fs.lire(&ext.join("client").join("index.html")).unwrap(), b"<p>AETHRYON 1.0.0</p>");
    assert!(!b.fs.existe(&ext.join("parasite.js")));
    assert!(hkcu(&b, CLE_RUN, VALEUR_RUN).is_some());
}

#[test]
fn mise_a_jour() {
    let b = banc();
    let v1 = charge("2.0.0-beta.1", "1.0.0", "1.0.0-beta.3");
    assert!(lancer(&b, &v1, &demande(&b, Operation::Installer)).0.succes);
    let v2 = charge("2.0.0-beta.2", "1.1.0", "1.0.0-beta.4");
    let inst = installation_existante(&b.env).unwrap();
    assert_eq!(actions_possibles(&inst.version, &v2.manifeste.version), vec![Action::MettreAJour, Action::Desinstaller]);
    b.systeme.processus.lock().unwrap().insert("aethryon-desktop.exe".into());
    let mut dem = demande(&b, Operation::MettreAJour);
    dem.options = inst.inventaire.as_ref().unwrap().options.clone();
    let (av, _) = lancer(&b, &v2, &dem);
    assert!(av.succes, "{:?}", av.erreur);
    assert_eq!(b.systeme.fermes.lock().unwrap().as_slice(), ["aethryon-desktop.exe"]);
    assert_eq!(hkcu(&b, CLE_DESINSTALLATION, "DisplayVersion").as_deref(), Some("2.0.0-beta.2"));
    let inv = lire_inventaire(&b.env, &install_dir(&b)).unwrap();
    assert_eq!(inv.version_extension.as_deref(), Some("1.1.0"));
    assert_eq!(inv.installe_le, inst.inventaire.unwrap().installe_le, "date d'installation d'origine gardée");
    let exe = b.fs.lire(&install_dir(&b).join("aethryon-desktop.exe")).unwrap();
    assert!(String::from_utf8_lossy(&exe[..40]).contains("1.0.0-beta.4"));
    // Une charge plus ancienne ne propose que la désinstallation.
    assert_eq!(actions_possibles("2.0.0-beta.2", &v1.manifeste.version), vec![Action::Desinstaller]);
}

#[test]
fn panne_pendant_l_enregistrement_retour_arriere_complet() {
    let b = banc();
    let avant = photo(&b);
    let c = charge("2.0.0-beta.1", "1.0.0", "1.0.0-beta.3");
    *b.registre.panne.lock().unwrap() = Some("EstimatedSize".into());
    let (av, _) = lancer(&b, &c, &demande(&b, Operation::Installer));
    assert!(!av.succes && av.termine);
    assert_eq!(av.etapes[2].etat, Etat::Echec);
    assert_eq!(av.etapes[3].etat, Etat::Attente);
    assert!(!av.retour_arriere.is_empty() && av.retour_arriere.iter().all(|x| !x.starts_with("ÉCHEC")));
    assert_eq!(photo(&b), avant, "état d'origine retrouvé à l'identique (hors journal)");
    assert!(!b.fs.existe(&install_dir(&b)));
    assert!(!b.fs.existe(&b.env.emplacements.dossier_extension()));
}

#[test]
fn panne_pendant_une_mise_a_jour_garde_la_version_en_place() {
    let b = banc();
    let v1 = charge("2.0.0-beta.1", "1.0.0", "1.0.0-beta.3");
    assert!(lancer(&b, &v1, &demande(&b, Operation::Installer)).0.succes);
    let avant = photo(&b);
    let v2 = charge("2.0.0-beta.2", "1.1.0", "1.0.0-beta.4");
    // La validation ne trouve pas config.json conforme : panne d'écriture sur le fichier temporaire de config.json.
    *b.fs.panne.lock().unwrap() = Some("config.json".into());
    let mut dem = demande(&b, Operation::MettreAJour);
    dem.options = installation_existante(&b.env).unwrap().inventaire.unwrap().options;
    let (av, _) = lancer(&b, &v2, &dem);
    *b.fs.panne.lock().unwrap() = None;
    assert!(!av.succes);
    assert_eq!(av.etapes[3].etat, Etat::Echec);
    assert_eq!(photo(&b), avant, "la version 2.0.0-beta.1 est intacte");
    assert_eq!(hkcu(&b, CLE_DESINSTALLATION, "DisplayVersion").as_deref(), Some("2.0.0-beta.1"));
    let html = b.fs.lire(&b.env.emplacements.dossier_extension().join("client").join("index.html")).unwrap();
    assert_eq!(html, b"<p>AETHRYON 1.0.0</p>");
}

#[test]
fn annulation_pendant_la_copie() {
    let b = banc();
    let avant = photo(&b);
    let c = charge("2.0.0-beta.1", "1.0.0", "1.0.0-beta.3");
    let dem = demande(&b, Operation::Installer);
    let drapeau = dem.annuler.clone();
    let mut vus = 0;
    let j = Journal::memoire();
    let av = executer(&b.env, &c, &dem, &j, &mut |a| {
        vus += 1;
        if a.courante == 1 && a.etapes[1].fait > 0 {
            drapeau.store(true, Ordering::SeqCst);
        }
    });
    assert!(av.annule && !av.succes);
    assert_eq!(av.etapes[1].etat, Etat::Annule);
    assert_eq!(photo(&b), avant);
    assert!(j.texte().contains("annulée"));
}

#[test]
fn charge_alteree_refusee_avant_toute_copie() {
    let b = banc();
    let c = charge("2.0.0-beta.1", "1.0.0", "1.0.0-beta.3");
    let mut m = c.manifeste.clone();
    m.desktop.as_mut().unwrap().fichiers[0].sha256 = "0".repeat(64);
    let z = zxp("1.0.0");
    let exe = b"MZ".to_vec();
    let alteree = Charge::ouvrir(charge::construire(&m, &[("extension/fr.aethryon.premiere.zxp", &z), ("desktop/aethryon-desktop.exe", &exe), ("desktop/WebView2Loader.dll", b"MZ WebView2Loader")])).unwrap();
    let avant = photo(&b);
    let (av, _) = lancer(&b, &alteree, &demande(&b, Operation::Installer));
    assert!(!av.succes);
    assert_eq!(av.etapes[0].etat, Etat::Echec);
    assert!(av.erreur.unwrap().contains("SHA-256"));
    // Rien d'autre que le journal n'a été écrit.
    assert_eq!(photo(&b), avant);
    assert!(!b.fs.existe(&install_dir(&b)));
}

#[test]
fn extension_seule_sans_desktop_et_espace_insuffisant() {
    let b = banc();
    let c = charge("2.0.0-beta.1", "1.0.0", "1.0.0-beta.3");
    let mut dem = demande(&b, Operation::Installer);
    dem.options.desktop = false;
    let (av, _) = lancer(&b, &c, &dem);
    assert!(av.succes, "{:?}", av.erreur);
    let d = install_dir(&b);
    assert!(!b.fs.existe(&d.join("aethryon-desktop.exe")));
    assert!(b.fs.est_fichier(&d.join(NOM_SETUP)));
    assert!(hkcu(&b, CLE_RUN, VALEUR_RUN).is_none(), "pas de démarrage automatique sans Desktop");
    assert_eq!(w(hkcu(&b, CLE_DESINSTALLATION, "DisplayIcon").unwrap()), w(format!("\"{}\\AETHRYON-Setup.exe\",0", d.display())));
    assert!(b.systeme.raccourcis.lock().unwrap().is_empty());
    let b2 = banc();
    *b2.systeme.espace.lock().unwrap() = Some(1000);
    let (av, _) = lancer(&b2, &c, &demande(&b2, Operation::Installer));
    assert!(av.erreur.unwrap().contains("Espace disque insuffisant"));
}

#[test]
fn desinstallation_en_gardant_les_medias() {
    let b = banc();
    let c = charge("2.0.0-beta.1", "1.0.0", "1.0.0-beta.3");
    assert!(lancer(&b, &c, &demande(&b, Operation::Installer)).0.succes);
    // Ce que le Desktop crée ensuite à l'usage : médias, bibliothèque, clés Native Messaging.
    b.fs.poser("C:\\Users\\Élodie\\Videos\\AETHRYON\\clip.mp4", &[1u8; 5000]);
    b.fs.poser("C:\\Users\\Élodie\\AppData\\Local\\AETHRYON\\bibliotheque\\index.json", b"{}");
    for k in CLES_NM {
        b.registre.ecrire(k, "", &Valeur::Chaine("x".into())).unwrap();
    }
    assert_eq!(inventaire_medias(b.fs.as_ref(), Path::new("C:\\Users\\Élodie\\Videos\\AETHRYON")), (1, 5000));
    let j = Journal::fichier(b.fs.clone(), b.env.emplacements.journaux());
    let av = desinstaller(&b.env, true, true, &j, &mut |_| {});
    assert!(av.succes && av.erreur.is_none(), "{:?}", av.erreur);
    assert!(!b.fs.existe(&install_dir(&b)));
    assert!(!b.fs.existe(&b.env.emplacements.dossier_extension()));
    assert!(!b.fs.existe(&b.env.emplacements.raccourci()));
    assert!(!b.fs.existe(&b.env.emplacements.donnees_itinerantes()));
    assert!(!b.fs.existe(Path::new("C:\\Users\\Élodie\\AppData\\Local\\AETHRYON\\bibliotheque")));
    assert!(b.fs.est_fichier(Path::new("C:\\Users\\Élodie\\Videos\\AETHRYON\\clip.mp4")), "médias gardés");
    assert!(!b.fs.fichiers_sous(b.env.emplacements.journaux()).is_empty(), "journal gardé");
    assert!(installation_existante(&b.env).is_none());
    let cles = b.registre.toutes_les_cles_hkcu();
    assert!(!cles.iter().any(|k| k.contains("aethryon")), "{cles:?}");
    assert!(hkcu(&b, CLE_RUN, VALEUR_RUN).is_none());
}

#[test]
fn desinstallation_en_supprimant_les_medias_et_extension_etrangere_intacte() {
    let b = banc();
    let c = charge("2.0.0-beta.1", "1.0.0", "1.0.0-beta.3");
    let mut dem = demande(&b, Operation::Installer);
    dem.options.dossier_medias = "D:\\Rushes\\AETHRYON".into();
    b.fs.creer_dossiers(Path::new("D:\\")).unwrap();
    assert!(lancer(&b, &c, &dem).0.succes);
    b.fs.poser("D:\\Rushes\\AETHRYON\\a.mp4", b"a");
    b.fs.poser("D:\\Rushes\\autre.mp4", b"b");
    // Une autre extension CEP à côté : jamais touchée.
    b.fs.poser("C:\\Users\\Élodie\\AppData\\Roaming\\Adobe\\CEP\\extensions\\com.autre\\CSXS\\manifest.xml", b"<ExtensionManifest ExtensionBundleId=\"com.autre\"/>");
    let av = desinstaller(&b.env, false, true, &Journal::memoire(), &mut |_| {});
    assert!(av.succes);
    assert!(!b.fs.existe(Path::new("D:\\Rushes\\AETHRYON")));
    assert!(b.fs.est_fichier(Path::new("D:\\Rushes\\autre.mp4")));
    assert!(b.fs.existe(Path::new("C:\\Users\\Élodie\\AppData\\Roaming\\Adobe\\CEP\\extensions\\com.autre\\CSXS\\manifest.xml")));
}

#[test]
fn desinstallation_d_un_lien_ne_touche_pas_sa_cible() {
    let b = banc();
    let ext = b.env.emplacements.dossier_extension();
    b.fs.creer_dossiers(ext.parent().unwrap()).unwrap();
    b.fs.poser_lien(&ext);
    b.fs.poser("C:\\dev\\aethryon\\CSXS\\manifest.xml", b"x");
    let av = desinstaller(&b.env, true, true, &Journal::memoire(), &mut |_| {});
    assert!(av.succes);
    assert!(!b.fs.existe(&ext));
    assert!(b.fs.existe(Path::new("C:\\dev\\aethryon\\CSXS\\manifest.xml")));
}

#[test]
fn ancienne_beta_nsis_remplacee() {
    let b = banc();
    let d = install_dir(&b);
    // Bêta 1.0.0-beta.2 posée par l'installateur NSIS : même dossier, autre clé.
    b.fs.poser(d.join("aethryon-desktop.exe"), b"MZ ancien");
    b.fs.poser(d.join("desinstaller.exe"), b"MZ nsis");
    b.fs.poser(d.join("panneau").join("aethryon-premiere-1.0.0-beta.2.ccx"), b"PK");
    b.fs.poser(d.join("licences").join("LICENSE-Inter.txt"), b"OFL");
    b.registre.poser(Racine::Hkcu, CLE_ANCIENNE_BETA, "DisplayVersion", Valeur::Chaine("1.0.0-beta.2".into()));
    b.registre.poser(Racine::Hkcu, CLE_ANCIENNE_BETA, "InstallLocation", Valeur::Chaine(d.display().to_string()));
    let det = detection::detecter(&b.env, "[25.0,99.9]", None);
    assert_eq!(det.ancienne_beta.as_deref(), Some("1.0.0-beta.2"));
    assert!(det.installation.is_none(), "ce n'est pas une installation de ce setup");
    let c = charge("2.0.0-beta.1", "1.0.0", "1.0.0-beta.3");
    let (av, _) = lancer(&b, &c, &demande(&b, Operation::Installer));
    assert!(av.succes, "{:?}", av.erreur);
    assert!(!b.registre.cle_existe(CLE_ANCIENNE_BETA));
    assert!(!b.fs.existe(&d.join("desinstaller.exe")) && !b.fs.existe(&d.join("panneau")) && !b.fs.existe(&d.join("licences")));
    let r = av.resultat.unwrap();
    assert_eq!(r.ancienne_beta_remplacee.as_deref(), Some("1.0.0-beta.2"));
    assert!(r.avertissements.iter().any(|a| a.contains("1.0.0-beta.2") && a.contains("plugin UXP « AETHRYON »") && a.contains("Creative Cloud")));
    assert!(String::from_utf8_lossy(&b.fs.lire(&d.join("aethryon-desktop.exe")).unwrap()).contains("1.0.0-beta.3"));
}

#[test]
fn playerdebugmode_deja_actif_laisse_tel_quel() {
    let b = banc();
    b.registre.poser(Racine::Hkcu, "Software\\Adobe\\CSXS.12", "PlayerDebugMode", Valeur::Chaine("1".into()));
    let c = charge("2.0.0-beta.1", "1.0.0", "1.0.0-beta.3");
    let (av, _) = lancer(&b, &c, &demande(&b, Operation::Installer));
    assert!(av.succes);
    assert_eq!(hkcu(&b, "Software\\Adobe\\CSXS.12", "PlayerDebugMode").as_deref(), Some("1"));
    let v = &av.etapes[4].sous.iter().find(|s| s.libelle.contains("PlayerDebugMode")).unwrap().detail;
    assert!(v.as_ref().unwrap().contains("tel quel"));
}

fn geree(b: &Banc) -> PathBuf {
    b.env.emplacements.local.join("AETHRYON").join("extension")
}

fn version_geree(b: &Banc) -> Option<String> {
    navigateur::version_en_place(b.fs.as_ref(), &geree(b))
}

#[test]
fn extension_navigateur_dans_le_dossier_gere() {
    let b = banc();
    let (av, _) = lancer(&b, &charge("2.0.0-beta.3", "2.0.0", "1.0.0-beta.4"), &demande(&b, Operation::Installer));
    assert!(av.succes, "{:?}", av.erreur);
    let r = av.resultat.unwrap();
    assert_eq!(r.version_navigateur.as_deref(), Some("3.6.1"));
    assert_eq!(r.dossier_navigateur.as_deref().map(w), Some(w(geree(&b).display().to_string())));
    assert_eq!(version_geree(&b).as_deref(), Some("3.6.1"));
    assert!(b.fs.est_fichier(&geree(&b).join("popup").join("popup.html")));
    let inv = lire_inventaire(&b.env, &install_dir(&b)).unwrap();
    assert_eq!(inv.version_navigateur.as_deref(), Some("3.6.1"));
    // Sans AETHRYON Desktop, le dossier géré n'est pas posé (c'est le Desktop qui le met à jour).
    let b2 = banc();
    let mut d = demande(&b2, Operation::Installer);
    d.options.desktop = false;
    let (av, _) = lancer(&b2, &charge("2.0.0-beta.3", "2.0.0", "1.0.0-beta.4"), &d);
    assert!(av.succes);
    assert_eq!(version_geree(&b2), None);
}

#[test]
fn extension_navigateur_mise_a_jour_jamais_retrogradee() {
    let b = banc();
    assert!(lancer(&b, &charge("2.0.0-beta.3", "2.0.0", "1.0.0-beta.4"), &demande(&b, Operation::Installer)).0.succes);
    // Setup plus récent avec la 3.6.2 : remplacée, la 3.6.1 devient « précédente ».
    let c = charge_nav("2.0.0-beta.4", "2.0.0", "1.0.0-beta.5", Some(zip_navigateur("3.6.2", &[("nouveau.js", b"2")])), "3.6.2");
    let (av, _) = lancer(&b, &c, &demande(&b, Operation::MettreAJour));
    assert!(av.succes, "{:?}", av.erreur);
    assert_eq!(version_geree(&b).as_deref(), Some("3.6.2"));
    assert_eq!(navigateur::version_en_place(b.fs.as_ref(), &navigateur::precedente(&b.env)).as_deref(), Some("3.6.1"));
    // AETHRYON Desktop l'a déjà passée en 3.7.0 : une réparation avec la 3.6.2 la garde.
    b.fs.poser(geree(&b).join("manifest.json"), format!(r#"{{"manifest_version":3,"name":"AETHRYON","version":"3.7.0","key":"{CLE_PROD}"}}"#).as_bytes());
    let (av, _) = lancer(&b, &c, &demande(&b, Operation::Reparer));
    assert!(av.succes, "{:?}", av.erreur);
    assert_eq!(version_geree(&b).as_deref(), Some("3.7.0"));
    assert_eq!(av.resultat.unwrap().version_navigateur.as_deref(), Some("3.7.0"));
}

#[test]
fn extension_navigateur_panne_apres_la_bascule_retour_arriere() {
    let b = banc();
    assert!(lancer(&b, &charge("2.0.0-beta.3", "2.0.0", "1.0.0-beta.4"), &demande(&b, Operation::Installer)).0.succes);
    let c = charge_nav("2.0.0-beta.4", "2.0.0", "1.0.0-beta.5", Some(zip_navigateur("3.6.2", &[])), "3.6.2");
    // Panne à l'écriture de l'inventaire (étape 4) : tout revient, y compris la 3.6.1 du dossier géré.
    *b.fs.panne.lock().unwrap() = Some("installation.json".into());
    let (av, _) = lancer(&b, &c, &demande(&b, Operation::MettreAJour));
    assert!(!av.succes);
    *b.fs.panne.lock().unwrap() = None;
    assert_eq!(version_geree(&b).as_deref(), Some("3.6.1"));
    let local = b.env.emplacements.local.join("AETHRYON");
    assert!(b.fs.lister(&local).unwrap().iter().all(|n| !navigateur::est_dossier_de_travail(n)), "{:?}", b.fs.lister(&local));
}

#[test]
fn extension_navigateur_archive_dangereuse_refusee_avant_toute_copie() {
    let b = banc();
    let c = charge_nav("2.0.0-beta.3", "2.0.0", "1.0.0-beta.4", Some(zip_navigateur("3.6.1", &[("../../evil.js", b"x")])), "3.6.1");
    let (av, _) = lancer(&b, &c, &demande(&b, Operation::Installer));
    assert!(!av.succes);
    assert!(av.erreur.unwrap_or_default().contains("Entrée refusée"));
    assert!(!b.fs.existe(&geree(&b)) && !b.fs.existe(&install_dir(&b).join("aethryon-desktop.exe")));
}

#[test]
fn desinstallation_garde_l_extension_navigateur_sauf_demande() {
    let b = banc();
    assert!(lancer(&b, &charge("2.0.0-beta.3", "2.0.0", "1.0.0-beta.4"), &demande(&b, Operation::Installer)).0.succes);
    let av = desinstaller(&b.env, true, true, &Journal::memoire(), &mut |_| {});
    assert!(av.succes);
    assert_eq!(version_geree(&b).as_deref(), Some("3.6.1"), "gardée : Chrome peut toujours la charger");
    assert!(!b.fs.existe(&b.env.emplacements.local.join("AETHRYON").join("bibliotheque")));
    let b = banc();
    assert!(lancer(&b, &charge("2.0.0-beta.3", "2.0.0", "1.0.0-beta.4"), &demande(&b, Operation::Installer)).0.succes);
    let av = desinstaller(&b.env, true, false, &Journal::memoire(), &mut |_| {});
    assert!(av.succes);
    assert!(!b.fs.existe(&geree(&b)), "retirée à la demande");
}

/// Réglages changés dans AETHRYON Desktop (Paramètres) après l'installation : Mettre à jour puis Réparer, lancés comme
/// par l'interface ou `--silencieux` (options de `session::etat_initial`), les gardent tels quels au lieu de revenir
/// aux choix de l'installation (inventaire).
#[test]
fn maintenance_garde_les_reglages_changes_dans_desktop() {
    let b = banc();
    assert!(lancer(&b, &charge("2.0.0-beta.6", "2.0.1", "1.1.0-beta.3"), &demande(&b, Operation::Installer)).0.succes);
    let conf = b.env.emplacements.donnees_itinerantes().join("config.json");
    let prive = b.env.emplacements.donnees_itinerantes().join("desktop.json");
    let autre = "D:\\Montage\\Médias";
    let notifs = serde_json::json!({ "mediaPret": false, "importReussi": true, "erreurs": true });
    let mut m: serde_json::Value = serde_json::from_slice(&b.fs.lire(&conf).unwrap()).unwrap();
    m["dossierMedias"] = autre.into();
    m["dossiersSurveilles"] = serde_json::json!([autre, "D:\\Rushes"]);
    m["surveillance"] = false.into();
    m["demarrageAuto"] = false.into();
    m["notifications"] = notifs.clone();
    m["theme"] = "clair".into();
    m["chutierParDefaut"] = "selection".into();
    b.fs.poser(&conf, &serde_json::to_vec_pretty(&m).unwrap());
    // « Démarrer avec Windows » coupé dans le Desktop : il retire aussi la valeur Run.
    b.registre.supprimer_valeur(CLE_RUN, VALEUR_RUN).unwrap();
    let mut p: serde_json::Value = serde_json::from_slice(&b.fs.lire(&prive).unwrap()).unwrap();
    p["premiereExeManuel"] = "E:\\Adobe\\Adobe Premiere Pro.exe".into();
    b.fs.poser(&prive, &serde_json::to_vec_pretty(&p).unwrap());
    let c = charge("2.0.0-beta.7", "2.0.1", "1.2.0-beta.1");
    for op in [Operation::MettreAJour, Operation::Reparer] {
        let e = session::etat_initial(&b.env, &c, "normal", None, None);
        assert_eq!((e.options.dossier_medias.as_str(), e.options.surveillance, e.options.demarrage_auto), (autre, false, false), "{op:?} : options proposées");
        let d = Demande { operation: op, options: e.options, amorce: Some(PathBuf::from(AMORCE)), annuler: Arc::new(AtomicBool::new(false)) };
        let (av, _) = lancer(&b, &c, &d);
        assert!(av.succes, "{op:?} : {:?}", av.erreur);
        let v: serde_json::Value = serde_json::from_slice(&b.fs.lire(&conf).unwrap()).unwrap();
        assert_eq!(v["dossierMedias"], autre, "{op:?}");
        assert_eq!(v["dossiersSurveilles"], serde_json::json!([autre, "D:\\Rushes"]), "{op:?}");
        assert_eq!((v["surveillance"].clone(), v["demarrageAuto"].clone()), (false.into(), false.into()), "{op:?}");
        assert_eq!(v["notifications"], notifs, "{op:?} : notifications à la carte gardées");
        assert_eq!((v["theme"].as_str(), v["chutierParDefaut"].as_str()), (Some("clair"), Some("selection")), "{op:?}");
        assert!(hkcu(&b, CLE_RUN, VALEUR_RUN).is_none(), "{op:?} : démarrage avec Windows resté coupé");
        let w: serde_json::Value = serde_json::from_slice(&b.fs.lire(&prive).unwrap()).unwrap();
        assert_eq!(w["premiereExeManuel"], "E:\\Adobe\\Adobe Premiere Pro.exe", "{op:?}");
        assert_eq!(lire_inventaire(&b.env, &install_dir(&b)).unwrap().options.dossier_medias, autre, "{op:?} : inventaire");
    }
}

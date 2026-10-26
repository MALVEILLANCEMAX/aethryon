//! Écran « Détection » : ce qui est RÉELLEMENT présent sur le PC. Aucune compatibilité n'est supposée : la version de
//! Premiere vient de l'exe (ressource de version), la compatibilité de l'intervalle `PPRO` du manifeste de
//! l'extension embarquée. Une version illisible donne « compatibilité inconnue », jamais « compatible ».

use crate::plateforme::*;
use crate::{installation_existante, version, InstallationExistante};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Instant;

pub const PREMIERE_EXE: &str = "Adobe Premiere Pro.exe";
pub const DESKTOP_EXE: &str = "aethryon-desktop.exe";
const UPIA_REL: &str = "Adobe\\OOBE\\PDApp\\UPI\\UnifiedPluginInstallerAgent\\UnifiedPluginInstallerAgent.exe";
const CC_REL: &str = "Adobe\\Adobe Creative Cloud\\ACC\\Creative Cloud.exe";
/// Client EdgeUpdate du runtime WebView2 « Evergreen » (documentation de distribution de WebView2).
const WEBVIEW2_CLIENT: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstallPremiere {
    pub exe: String,
    pub dossier: String,
    pub version: Option<String>,
    /// `Some(true)` seulement si la version lue est dans l'intervalle de l'extension ; `None` si illisible.
    pub compatible: Option<bool>,
    pub beta: bool,
    /// `dossier`, `registre` ou `manuel`.
    pub source: String,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    pub premiere: Vec<InstallPremiere>,
    pub principale: Option<InstallPremiere>,
    /// Ce qui a été cherché (écran « introuvable »).
    pub cherche: Vec<String>,
    pub premiere_ouvert: bool,
    /// Intervalle de Premiere accepté par l'extension embarquée (`[25.0,99.9]`).
    pub intervalle_extension: String,
    pub creative_cloud: Option<String>,
    pub webview2: Option<String>,
    /// « Windows 11 · 64 bits » (numéro de build lu dans le registre).
    pub windows: Option<String>,
    pub dossier_extensions: String,
    /// Clés `HKCU\Software\Adobe\CSXS.n` où PlayerDebugMode vaut 1 (information : le setup ne l'écrit jamais).
    pub player_debug_mode: Vec<String>,
    /// Extension `fr.aethryon.premiere` déjà présente (version lue dans son manifeste), et si c'est un lien.
    pub extension_presente: Option<String>,
    pub extension_est_lien: bool,
    pub installation: Option<InstallationExistante>,
    /// Bêta précédente (installateur NSIS « AETHRYON-Desktop »), à remplacer.
    pub ancienne_beta: Option<String>,
    pub desktop_ouvert: bool,
    pub espace_libre: Option<u64>,
    pub duree_ms: u64,
}

fn chemin_premiere(p: &str) -> PathBuf {
    let p = PathBuf::from(p.trim().trim_matches('"'));
    if p.extension().map(|e| e.eq_ignore_ascii_case("exe")).unwrap_or(false) {
        p
    } else {
        p.join(PREMIERE_EXE)
    }
}

pub fn est_dossier_premiere(nom: &str) -> bool {
    let n = nom.to_lowercase();
    n.starts_with("adobe premiere pro") && !n.contains("elements")
}

/// Candidats : dossiers `<Program Files>\Adobe\Adobe Premiere Pro*`, puis indices du registre (HKLM, lecture seule).
pub fn candidats_premiere(env: &Environnement) -> (Vec<(PathBuf, String)>, Vec<String>) {
    let mut c = Vec::new();
    let mut cherche = Vec::new();
    for base in &env.emplacements.programmes {
        let adobe = base.join("Adobe");
        cherche.push(format!("{}\\Adobe Premiere Pro*", adobe.display()));
        if let Ok(noms) = env.fs.lister(&adobe) {
            for n in noms {
                if est_dossier_premiere(&n) && env.fs.est_dossier(&adobe.join(&n)) {
                    c.push((adobe.join(&n).join(PREMIERE_EXE), "dossier".to_string()));
                }
            }
        }
    }
    let app_paths = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Adobe Premiere Pro.exe";
    cherche.push(format!("HKLM\\{app_paths}"));
    if let Some(v) = env.registre.chaine(Racine::Hklm, app_paths, "") {
        c.push((chemin_premiere(&v), "registre".into()));
    }
    cherche.push("HKLM\\SOFTWARE\\Adobe\\Premiere Pro\\<version>".into());
    for sous in env.registre.sous_cles(Racine::Hklm, "SOFTWARE\\Adobe\\Premiere Pro") {
        let cle = format!("SOFTWARE\\Adobe\\Premiere Pro\\{sous}");
        for nom in ["InstallPath", "Install Path", "Path"] {
            if let Some(v) = env.registre.chaine(Racine::Hklm, &cle, nom) {
                c.push((chemin_premiere(&v), "registre".into()));
            }
        }
    }
    (c, cherche)
}

pub fn detecter_premiere(env: &Environnement, intervalle: &str, exe_manuel: Option<&Path>) -> (Vec<InstallPremiere>, Option<InstallPremiere>, Vec<String>) {
    let (mut candidats, cherche) = candidats_premiere(env);
    if let Some(m) = exe_manuel {
        candidats.insert(0, (chemin_premiere(&m.to_string_lossy()), "manuel".into()));
    }
    let mut v: Vec<InstallPremiere> = Vec::new();
    for (exe, source) in candidats {
        if !env.fs.est_fichier(&exe) {
            continue;
        }
        let texte = exe.to_string_lossy().into_owned();
        if v.iter().any(|i| i.exe.to_lowercase() == texte.to_lowercase()) {
            continue;
        }
        let ver = env.systeme.version_fichier(&exe);
        let dossier = exe.parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
        v.push(InstallPremiere {
            compatible: ver.as_deref().and_then(|x| version::dans_intervalle(x, intervalle)),
            beta: dossier.to_lowercase().contains("(beta)"),
            exe: texte,
            dossier,
            version: ver,
            source,
        });
    }
    let cle = |i: &InstallPremiere| (i.compatible == Some(true), !i.beta, i.version.as_deref().and_then(version::lire));
    let principale = v.iter().max_by(|a, b| cle(a).partial_cmp(&cle(b)).unwrap_or(std::cmp::Ordering::Equal)).cloned();
    (v, principale, cherche)
}

pub fn creative_cloud(env: &Environnement) -> Option<String> {
    let mut candidats: Vec<PathBuf> = env.emplacements.programmes.iter().map(|b| b.join(CC_REL)).collect();
    candidats.extend(env.emplacements.programmes_communs.iter().map(|b| b.join(UPIA_REL)));
    candidats.into_iter().find(|p| env.fs.est_fichier(p)).map(|p| p.to_string_lossy().into_owned())
}

pub fn webview2(reg: &dyn Registre) -> Option<String> {
    let cles = [
        (Racine::Hklm, format!("SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{WEBVIEW2_CLIENT}")),
        (Racine::Hklm, format!("SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{WEBVIEW2_CLIENT}")),
        (Racine::Hkcu, format!("Software\\Microsoft\\EdgeUpdate\\Clients\\{WEBVIEW2_CLIENT}")),
    ];
    cles.iter().filter_map(|(r, c)| reg.chaine(*r, c, "pv")).find(|v| !v.is_empty() && v != "0.0.0.0")
}

pub fn windows(reg: &dyn Registre) -> Option<String> {
    let build: u32 = reg.chaine(Racine::Hklm, "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion", "CurrentBuildNumber")?.trim().parse().ok()?;
    // Windows 11 garde « 10 » dans ses numéros internes : seul le build (≥ 22000) les distingue.
    Some(format!("Windows {} · 64 bits", if build >= 22000 { "11" } else { "10" }))
}

/// Clés CSXS.n de HKCU où PlayerDebugMode est actif (lu, jamais écrit).
pub fn player_debug_mode(reg: &dyn Registre) -> Vec<String> {
    (9..=13)
        .filter_map(|n| {
            let cle = format!("Software\\Adobe\\CSXS.{n}");
            let v = reg.lire(Racine::Hkcu, &cle, "PlayerDebugMode")?;
            let actif = match v {
                Valeur::Chaine(s) => s.trim() == "1",
                Valeur::Dword(d) => d == 1,
            };
            actif.then(|| format!("HKCU\\{cle}"))
        })
        .collect()
}

pub fn extension_presente(env: &Environnement) -> (Option<String>, bool) {
    let d = env.emplacements.dossier_extension();
    match env.fs.type_de(&d) {
        None => (None, false),
        Some(TypeEntree::Lien) => (Some("lien".into()), true),
        _ => {
            let v = env
                .fs
                .lire(&d.join("CSXS").join("manifest.xml"))
                .ok()
                .and_then(|x| crate::zxp::lire_manifeste_cep(&String::from_utf8_lossy(&x)).ok())
                .map(|(_, v, _)| v)
                .unwrap_or_else(|| "illisible".into());
            (Some(v), false)
        }
    }
}

pub fn detecter(env: &Environnement, intervalle: &str, exe_manuel: Option<&Path>) -> Detection {
    let debut = Instant::now();
    let (premiere, principale, cherche) = detecter_premiere(env, intervalle, exe_manuel);
    let (extension_presente, extension_est_lien) = extension_presente(env);
    let installation = installation_existante(env);
    let cible_espace = env.emplacements.local.clone();
    Detection {
        premiere,
        principale,
        cherche,
        premiere_ouvert: env.systeme.processus_present(PREMIERE_EXE),
        intervalle_extension: intervalle.to_string(),
        creative_cloud: creative_cloud(env),
        webview2: webview2(env.registre.as_ref()),
        windows: windows(env.registre.as_ref()),
        dossier_extensions: env.emplacements.dossier_extensions_cep().to_string_lossy().into_owned(),
        player_debug_mode: player_debug_mode(env.registre.as_ref()),
        extension_presente,
        extension_est_lien,
        ancienne_beta: env.registre.chaine(Racine::Hkcu, crate::CLE_ANCIENNE_BETA, "DisplayVersion"),
        installation,
        desktop_ouvert: env.systeme.processus_present(DESKTOP_EXE),
        espace_libre: env.systeme.espace_libre(&cible_espace),
        duree_ms: debut.elapsed().as_millis() as u64,
    }
}

#[cfg(test)]
mod essais {
    use super::*;
    use crate::factice::Banc;

    #[test]
    fn premiere_trouve_et_compatibilite_jamais_supposee() {
        let b = Banc::nouveau();
        let d26 = "C:\\Program Files\\Adobe\\Adobe Premiere Pro 2026";
        let d24 = "C:\\Program Files\\Adobe\\Adobe Premiere Pro 2024";
        let dbeta = "C:\\Program Files\\Adobe\\Adobe Premiere Pro (Beta)";
        let delem = "C:\\Program Files\\Adobe\\Adobe Premiere Elements 2026";
        for d in [d26, d24, dbeta, delem] {
            b.fs.poser(format!("{d}\\{PREMIERE_EXE}"), b"MZ");
        }
        b.systeme.poser_version(format!("{d26}\\{PREMIERE_EXE}"), "26.5.2.13");
        b.systeme.poser_version(format!("{d24}\\{PREMIERE_EXE}"), "24.6.4.2");
        // (Beta) : version illisible -> compatibilité inconnue, jamais « compatible ».
        let det = detecter(&b.env, "[25.0,99.9]", None);
        assert_eq!(det.premiere.len(), 3, "Elements est ignoré");
        let p = det.principale.unwrap();
        assert_eq!((p.version.as_deref(), p.compatible), (Some("26.5.2.13"), Some(true)));
        let v24 = det.premiere.iter().find(|i| i.dossier.ends_with("2024")).unwrap();
        assert_eq!(v24.compatible, Some(false));
        let beta = det.premiere.iter().find(|i| i.beta).unwrap();
        assert_eq!(beta.compatible, None);
        assert!(det.cherche.iter().any(|c| c.contains("Adobe Premiere Pro*")));
    }

    #[test]
    fn premiere_introuvable_puis_chemin_manuel_et_registre() {
        let b = Banc::nouveau();
        let det = detecter(&b.env, "[25.0,99.9]", None);
        assert!(det.premiere.is_empty() && det.principale.is_none());
        let exe = "D:\\Logiciels\\Premiere\\Adobe Premiere Pro.exe";
        b.fs.poser(exe, b"MZ");
        b.systeme.poser_version(exe, "25.6.0.80");
        let det = detecter(&b.env, "[25.0,99.9]", Some(Path::new("D:\\Logiciels\\Premiere")));
        assert_eq!(det.principale.as_ref().map(|p| p.source.as_str()), Some("manuel"));
        // Indice du registre HKLM (lecture seule), dédoublonné avec le chemin manuel.
        b.registre.poser(Racine::Hklm, "SOFTWARE\\Adobe\\Premiere Pro\\25.0", "InstallPath", Valeur::Chaine("D:\\Logiciels\\Premiere".into()));
        let det = detecter(&b.env, "[25.0,99.9]", None);
        assert_eq!(det.premiere.len(), 1);
        assert_eq!(det.premiere[0].source, "registre");
    }

    #[test]
    fn environnement_windows_creative_cloud_webview2_debug() {
        let b = Banc::nouveau();
        assert!(det_vide(&b));
        b.fs.poser(format!("C:\\Program Files\\{CC_REL}"), b"MZ");
        b.registre.poser(Racine::Hklm, &format!("SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{WEBVIEW2_CLIENT}"), "pv", Valeur::Chaine("141.0.3537.71".into()));
        b.registre.poser(Racine::Hklm, "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion", "CurrentBuildNumber", Valeur::Chaine("26100".into()));
        b.registre.poser(Racine::Hkcu, "Software\\Adobe\\CSXS.12", "PlayerDebugMode", Valeur::Chaine("1".into()));
        b.registre.poser(Racine::Hkcu, "Software\\Adobe\\CSXS.11", "PlayerDebugMode", Valeur::Chaine("0".into()));
        b.systeme.processus.lock().unwrap().insert(PREMIERE_EXE.to_lowercase());
        let d = detecter(&b.env, "[25.0,99.9]", None);
        assert!(d.creative_cloud.is_some());
        assert_eq!(d.webview2.as_deref(), Some("141.0.3537.71"));
        assert_eq!(d.windows.as_deref(), Some("Windows 11 · 64 bits"));
        assert_eq!(d.player_debug_mode, vec!["HKCU\\Software\\Adobe\\CSXS.12".to_string()]);
        assert!(d.premiere_ouvert);
        assert_eq!(d.espace_libre, Some(182_000_000_000));
    }

    fn det_vide(b: &Banc) -> bool {
        let d = detecter(&b.env, "[25.0,99.9]", None);
        d.creative_cloud.is_none() && d.webview2.is_none() && d.windows.is_none() && d.player_debug_mode.is_empty() && d.installation.is_none()
    }
}

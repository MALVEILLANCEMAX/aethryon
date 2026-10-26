//! Intégration avec le système. Le trait [`Plateforme`] isole tout ce qui touche à Windows (registre HKCU,
//! Explorateur, processus, informations de version d'un exe, Known Folders). La logique qui s'en sert (Native
//! Messaging, démarrage automatique, UPIA, détection de Premiere) est écrite ici, de façon portable, et testée sous
//! Linux avec une plateforme factice qui enregistre chaque opération.
//!
//! - `windows.rs` : implémentation réelle (`cfg(windows)`) — **NON TESTÉE SOUS WINDOWS** à ce stade ;
//! - `autre.rs` : remplaçant portable (Linux, essais) qui répond « non pris en charge ».

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[cfg(windows)]
mod windows;
#[cfg(not(windows))]
mod autre;
#[cfg(test)]
pub mod factice;

/// Plateforme du système en cours.
pub fn systeme() -> Box<dyn Plateforme> {
    #[cfg(windows)]
    {
        Box::new(windows::Windows)
    }
    #[cfg(not(windows))]
    {
        Box::new(autre::Autre)
    }
}

// ---- Faits fixes (audit §4) ----------------------------------------------------------------------------------------

/// Chemin d'UPIA relatif à `%CommonProgramFiles%` (doc Adobe, « Install plugins »).
pub const UPIA_REL: &str = "Adobe\\Adobe Desktop Common\\RemoteComponents\\UPI\\UnifiedPluginInstallerAgent\\UnifiedPluginInstallerAgent.exe";
/// Nom de l'exécutable de Premiere Pro.
pub const PREMIERE_EXE: &str = "Adobe Premiere Pro.exe";
/// Clés Native Messaging par utilisateur (HKCU) : Chrome, Edge, Brave.
pub const NAVIGATEURS_NM: [(&str, &str); 3] = [
    ("Chrome", "Software\\Google\\Chrome\\NativeMessagingHosts"),
    ("Edge", "Software\\Microsoft\\Edge\\NativeMessagingHosts"),
    ("Brave", "Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts"),
];
/// Démarrage automatique (HKCU) et nom de la valeur.
pub const CLE_RUN: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
pub const VALEUR_RUN: &str = "AETHRYON Desktop";
/// Entrée « Applications installées » écrite par l'installateur NSIS.
pub const CLE_DESINSTALLATION: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AETHRYON-Desktop";

// ---- Types -----------------------------------------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstallPremiere {
    pub exe: String,
    pub dossier: String,
    /// Version de fichier lue dans l'exe (`26.5.2.13`), ou `None` si illisible.
    pub version: Option<String>,
    /// `Some(true)` si la version lue est ≥ 25.6.0 ; `None` si la version n'a pas pu être lue (jamais supposée).
    pub compatible: Option<bool>,
    /// Glisser-déposer (27.0 et plus) : seulement si la version le permet.
    pub glisser: Option<bool>,
    pub beta: bool,
    /// `dossier`, `registre` ou `manuel`.
    pub source: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct DetectionPremiere {
    pub installations: Vec<InstallPremiere>,
    /// Installation retenue : la plus récente compatible (version stable de préférence), sinon la plus récente.
    pub principale: Option<InstallPremiere>,
    /// Ce qui a été cherché (pour l'écran « introuvable »).
    pub cherche: Vec<String>,
    pub en_cours: Option<bool>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreativeCloud {
    /// `UnifiedPluginInstallerAgent.exe` : sa présence vaut « Creative Cloud Desktop présent » (audit §4.1).
    pub upia: Option<String>,
    pub application: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct SortieProcessus {
    pub code: Option<i32>,
    pub sortie: String,
    pub duree_ms: u64,
}

pub trait Plateforme: Send + Sync {
    /// `windows` ou `autre`.
    fn nom(&self) -> &'static str;
    /// Candidats à `Adobe Premiere Pro.exe` : dossiers d'Adobe et indices du registre (chemin, source).
    fn candidats_premiere(&self) -> (Vec<(PathBuf, String)>, Vec<String>);
    /// Version de fichier d'un exécutable (`GetFileVersionInfoW`).
    fn version_fichier(&self, exe: &Path) -> Option<String>;
    fn existe(&self, chemin: &Path) -> bool {
        chemin.exists()
    }
    /// `UnifiedPluginInstallerAgent.exe` et `Creative Cloud.exe`.
    fn creative_cloud(&self) -> CreativeCloud;
    /// Un processus portant ce nom d'exe tourne-t-il ? `None` si on ne sait pas le dire.
    fn processus_present(&self, nom_exe: &str) -> Option<bool>;
    /// Lance un programme sans fenêtre de console et attend sa fin (délai maximal).
    fn executer(&self, exe: &Path, args: &[String], delai: Duration) -> Result<SortieProcessus, String>;
    /// Ouvre un fichier avec l'application associée (`.ccx` → Creative Cloud ; média → lecteur par défaut).
    fn ouvrir(&self, chemin: &Path) -> Result<(), String>;
    /// Explorateur positionné sur le fichier.
    fn afficher_dans_explorateur(&self, chemin: &Path) -> Result<(), String>;
    /// Lance un programme détaché (Premiere Pro, désinstalleur).
    fn lancer(&self, exe: &Path, args: &[String]) -> Result<(), String>;
    // Registre HKCU (chaînes seulement).
    fn reg_lire(&self, cle: &str, valeur: Option<&str>) -> Option<String>;
    fn reg_ecrire(&self, cle: &str, valeur: Option<&str>, donnee: &str) -> Result<(), String>;
    fn reg_supprimer_valeur(&self, cle: &str, valeur: &str) -> Result<(), String>;
    fn reg_supprimer_cle(&self, cle: &str) -> Result<(), String>;
    fn espace_libre(&self, chemin: &Path) -> Option<u64>;
    /// Dossier Téléchargements de l'utilisateur (Known Folder, même s'il a été déplacé).
    fn dossier_telechargements(&self) -> Option<PathBuf>;
    /// Termine les autres processus du même exécutable (désinstallation). Renvoie leur nombre.
    fn terminer_autres_instances(&self) -> usize;
}

// ---- Versions --------------------------------------------------------------------------------------------------------

/// `26.5.2.13` → `[26, 5, 2]` (les composants manquants valent 0).
pub fn lire_version(v: &str) -> Option<[u32; 3]> {
    let mut p = v.trim().split(['.', ',', ' ']).filter(|s| !s.is_empty()).map(|s| s.parse::<u32>().ok());
    let a = p.next()??;
    let b = p.next().unwrap_or(Some(0))?;
    let c = p.next().unwrap_or(Some(0))?;
    Some([a, b, c])
}

pub fn au_moins(v: &str, min: [u32; 3]) -> Option<bool> {
    lire_version(v).map(|x| x >= min)
}

/// Vrai si un nom de dossier ressemble à une installation de Premiere (« Adobe Premiere Pro 2026 », « (Beta) »).
pub fn est_dossier_premiere(nom: &str) -> bool {
    let n = nom.to_lowercase();
    n.starts_with("adobe premiere pro") && !n.contains("elements")
}

/// Assemble la détection à partir des candidats. Ne suppose aucune version : seule la version lue dans l'exe compte.
pub fn detecter_premiere(p: &dyn Plateforme, exe_manuel: Option<&Path>) -> DetectionPremiere {
    let (mut candidats, cherche) = p.candidats_premiere();
    if let Some(m) = exe_manuel {
        candidats.insert(0, (m.to_path_buf(), "manuel".into()));
    }
    let mut d = DetectionPremiere { cherche, ..Default::default() };
    for (exe, source) in candidats {
        if !p.existe(&exe) {
            continue;
        }
        let exe_txt = exe.to_string_lossy().into_owned();
        if d.installations.iter().any(|i| crate::noms::normaliser_pour_id(&i.exe) == crate::noms::normaliser_pour_id(&exe_txt)) {
            continue;
        }
        let version = p.version_fichier(&exe);
        let dossier = exe_txt.rsplit_once(['\\', '/']).map(|(d, _)| d.to_string()).unwrap_or_default();
        let beta = dossier.to_lowercase().contains("(beta)");
        d.installations.push(InstallPremiere {
            compatible: version.as_deref().and_then(|v| au_moins(v, crate::PREMIERE_MIN)),
            glisser: version.as_deref().and_then(|v| au_moins(v, crate::PREMIERE_GLISSER)),
            exe: exe_txt,
            dossier,
            version,
            beta,
            source,
        });
    }
    let cle = |i: &InstallPremiere| (i.compatible == Some(true), !i.beta, i.version.as_deref().and_then(lire_version).unwrap_or([0, 0, 0]));
    d.principale = d.installations.iter().max_by_key(|i| cle(i)).cloned();
    d.en_cours = p.processus_present(PREMIERE_EXE);
    d
}

// ---- UPIA ------------------------------------------------------------------------------------------------------------

/// Arguments exacts (audit §4.2) : `/install <chemin du .ccx>`.
pub fn args_upia_installer(ccx: &Path) -> Vec<String> {
    vec!["/install".into(), ccx.to_string_lossy().into_owned()]
}
/// `/list all`.
pub fn args_upia_lister() -> Vec<String> {
    vec!["/list".into(), "all".into()]
}
/// `/remove <nom ou chemin>` (la doc écrit un chemin, son exemple passe un nom : on essaie le nom, l'id, puis le chemin).
pub fn args_upia_retirer(cible: &str) -> Vec<String> {
    vec!["/remove".into(), cible.into()]
}

/// Sortie d'UPIA décodée : UTF-16 petit-boutiste si elle en a l'air, sinon UTF-8 (avec remplacement).
pub fn decoder_sortie(octets: &[u8]) -> String {
    let zeros = octets.iter().skip(1).step_by(2).filter(|&&b| b == 0).count();
    if octets.len() >= 4 && zeros * 2 >= octets.len() / 2 {
        let mut u: Vec<u16> = octets.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        if u.first() == Some(&0xFEFF) {
            u.remove(0);
        }
        String::from_utf16_lossy(&u)
    } else {
        String::from_utf8_lossy(crate::atomique::sans_bom(octets)).into_owned()
    }
}

/// La sortie de `/list all` mentionne-t-elle le panneau ? (format exact de la sortie : non documenté, on cherche l'id
/// `fr.aethryon.premiere`, sinon une ligne qui contient le nom « AETHRYON » comme mot entier).
pub fn liste_contient_panneau(sortie: &str) -> bool {
    let s = sortie.to_lowercase();
    if s.contains(crate::ID_PANNEAU) {
        return true;
    }
    s.lines().any(|l| {
        l.split(|c: char| !c.is_alphanumeric()).any(|mot| mot == "aethryon")
            && !l.contains("not installed")
            && !l.contains("non install")
    })
}

/// Version que `/list all` affiche pour le panneau (premier nombre `a.b.c` de la ligne qui le mentionne), si la sortie
/// en donne une. Sert à repérer une ancienne version encore listée après une mise à jour (0.9.1 au lieu de 0.9.2).
pub fn version_listee(sortie: &str) -> Option<String> {
    let ligne = sortie.lines().find(|l| {
        let b = l.to_lowercase();
        b.contains(crate::ID_PANNEAU) || b.split(|c: char| !c.is_alphanumeric()).any(|mot| mot == "aethryon")
    })?;
    ligne
        .split(|c: char| !(c.is_ascii_digit() || c == '.'))
        .map(|t| t.trim_matches('.'))
        .find(|t| t.split('.').count() == 3 && t.split('.').all(|n| !n.is_empty() && n.len() <= 4))
        .map(String::from)
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResultatUpia {
    pub ok: bool,
    pub code: Option<i32>,
    pub message: String,
    pub sortie: String,
}

fn upia(cc: &CreativeCloud) -> Result<PathBuf, String> {
    cc.upia.as_ref().map(PathBuf::from).ok_or_else(|| {
        "L'outil d'installation d'Adobe (UnifiedPluginInstallerAgent) est introuvable : Creative Cloud Desktop n'est pas installé.".into()
    })
}

pub fn upia_installer(p: &dyn Plateforme, cc: &CreativeCloud, ccx: &Path) -> ResultatUpia {
    let exe = match upia(cc) {
        Ok(e) => e,
        Err(m) => return ResultatUpia { ok: false, code: None, message: m, sortie: String::new() },
    };
    match p.executer(&exe, &args_upia_installer(ccx), Duration::from_secs(180)) {
        Ok(s) => ResultatUpia {
            ok: s.code == Some(0),
            code: s.code,
            message: if s.code == Some(0) {
                "Creative Cloud a installé le panneau.".into()
            } else {
                format!("L'outil d'Adobe a répondu {} : installation non confirmée.", s.code.map(|c| c.to_string()).unwrap_or_else(|| "sans code (délai dépassé)".into()))
            },
            sortie: s.sortie,
        },
        Err(e) => ResultatUpia { ok: false, code: None, message: e, sortie: String::new() },
    }
}

pub fn upia_lister(p: &dyn Plateforme, cc: &CreativeCloud) -> Result<(bool, String), String> {
    let exe = upia(cc)?;
    let s = p.executer(&exe, &args_upia_lister(), Duration::from_secs(60))?;
    if s.code != Some(0) && s.sortie.trim().is_empty() {
        return Err(format!("L'outil d'Adobe n'a pas pu lister les plug-ins (code {}).", s.code.map(|c| c.to_string()).unwrap_or_else(|| "inconnu".into())));
    }
    Ok((liste_contient_panneau(&s.sortie), s.sortie))
}

/// Retire le panneau : par nom, puis par identifiant, puis par chemin du `.ccx` (s'il est fourni).
pub fn upia_retirer(p: &dyn Plateforme, cc: &CreativeCloud, ccx: Option<&Path>) -> ResultatUpia {
    let exe = match upia(cc) {
        Ok(e) => e,
        Err(m) => return ResultatUpia { ok: false, code: None, message: m, sortie: String::new() },
    };
    let mut cibles = vec![crate::NOM_PANNEAU.to_string(), crate::ID_PANNEAU.to_string()];
    if let Some(c) = ccx.filter(|c| p.existe(c)) {
        cibles.push(c.to_string_lossy().into_owned());
    }
    let mut derniere = ResultatUpia { ok: false, code: None, message: String::new(), sortie: String::new() };
    for c in cibles {
        match p.executer(&exe, &args_upia_retirer(&c), Duration::from_secs(120)) {
            Ok(s) if s.code == Some(0) => return ResultatUpia { ok: true, code: s.code, message: "Panneau retiré par Creative Cloud.".into(), sortie: s.sortie },
            Ok(s) => derniere = ResultatUpia { ok: false, code: s.code, message: format!("L'outil d'Adobe a répondu {:?}.", s.code), sortie: s.sortie },
            Err(e) => derniere = ResultatUpia { ok: false, code: None, message: e, sortie: String::new() },
        }
    }
    derniere.message = format!(
        "{} Retirez le panneau à la main : Creative Cloud Desktop › Plug-ins › Gérer les plug-ins › AETHRYON › Désinstaller.",
        derniere.message
    );
    derniere
}

// ---- Native Messaging ----------------------------------------------------------------------------------------------

/// Manifeste de l'hôte (contrat §6) : `path` absolu vers `aethryon-desktop.exe` ; Chrome passe l'origine en argument,
/// que l'exe reconnaît comme le mode `--nm` (un manifeste ne peut pas porter d'argument).
pub fn manifeste_nm(exe: &Path) -> serde_json::Value {
    serde_json::json!({
        "name": crate::NOM_HOTE_NM,
        "description": "AETHRYON Desktop",
        "path": exe.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": crate::EXTENSIONS_AUTORISEES.iter().map(|id| format!("chrome-extension://{id}/")).collect::<Vec<_>>(),
    })
}

pub fn cle_nm(base: &str) -> String {
    format!("{base}\\{}", crate::NOM_HOTE_NM)
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EtatNavigateur {
    pub navigateur: String,
    pub enregistre: bool,
    pub message: Option<String>,
}

/// Écrit le manifeste puis les trois clés HKCU (valeur par défaut = chemin du manifeste).
pub fn enregistrer_nm(p: &dyn Plateforme, exe: &Path, manifeste: &Path) -> Vec<EtatNavigateur> {
    if let Err(e) = crate::atomique::ecrire_json(manifeste, &manifeste_nm(exe), true) {
        return NAVIGATEURS_NM
            .iter()
            .map(|(n, _)| EtatNavigateur { navigateur: n.to_string(), enregistre: false, message: Some(format!("Manifeste non écrit ({}).", e.kind())) })
            .collect();
    }
    let m = manifeste.to_string_lossy().into_owned();
    NAVIGATEURS_NM
        .iter()
        .map(|(n, base)| match p.reg_ecrire(&cle_nm(base), None, &m) {
            Ok(()) => EtatNavigateur { navigateur: n.to_string(), enregistre: true, message: None },
            Err(e) => EtatNavigateur { navigateur: n.to_string(), enregistre: false, message: Some(e) },
        })
        .collect()
}

pub fn etat_nm(p: &dyn Plateforme, manifeste: &Path) -> Vec<EtatNavigateur> {
    let m = manifeste.to_string_lossy().into_owned();
    NAVIGATEURS_NM
        .iter()
        .map(|(n, base)| {
            let v = p.reg_lire(&cle_nm(base), None);
            let ok = v.as_deref().map(|v| v.eq_ignore_ascii_case(&m)).unwrap_or(false) && p.existe(manifeste);
            EtatNavigateur {
                navigateur: n.to_string(),
                enregistre: ok,
                message: match v {
                    None => Some("Clé absente.".into()),
                    Some(_) if !ok => Some("Clé présente mais manifeste différent ou absent.".into()),
                    _ => None,
                },
            }
        })
        .collect()
}

pub fn retirer_nm(p: &dyn Plateforme, manifeste: &Path) -> Vec<String> {
    let mut erreurs = Vec::new();
    for (n, base) in NAVIGATEURS_NM {
        if let Err(e) = p.reg_supprimer_cle(&cle_nm(base)) {
            erreurs.push(format!("{n} : {e}"));
        }
    }
    let _ = std::fs::remove_file(manifeste);
    erreurs
}

// ---- Démarrage automatique -------------------------------------------------------------------------------------------

/// Donnée de la valeur `Run` : exe entre guillemets, puis `--arriere-plan`.
pub fn commande_run(exe: &Path) -> String {
    format!("\"{}\" --arriere-plan", exe.to_string_lossy())
}

pub fn demarrage_auto(p: &dyn Plateforme, exe: &Path, actif: bool) -> Result<(), String> {
    if actif {
        p.reg_ecrire(CLE_RUN, Some(VALEUR_RUN), &commande_run(exe))
    } else {
        p.reg_supprimer_valeur(CLE_RUN, VALEUR_RUN)
    }
}

pub fn demarrage_auto_actif(p: &dyn Plateforme, exe: &Path) -> bool {
    p.reg_lire(CLE_RUN, Some(VALEUR_RUN)).map(|v| v.eq_ignore_ascii_case(&commande_run(exe))).unwrap_or(false)
}

/// Argument exact pour l'Explorateur : `/select,"<chemin>"`.
pub fn argument_explorateur(chemin: &Path) -> String {
    format!("/select,\"{}\"", chemin.to_string_lossy())
}

#[cfg(test)]
mod tests {
    use super::factice::Factice;
    use super::*;

    #[test]
    fn versions() {
        assert_eq!(lire_version("26.5.2.13"), Some([26, 5, 2]));
        assert_eq!(lire_version("25.6"), Some([25, 6, 0]));
        assert_eq!(lire_version("vingt"), None);
        assert_eq!(au_moins("25.6.0.0", crate::PREMIERE_MIN), Some(true));
        assert_eq!(au_moins("25.5.9", crate::PREMIERE_MIN), Some(false));
        assert_eq!(au_moins("26.5.2", crate::PREMIERE_GLISSER), Some(false));
        assert!(est_dossier_premiere("Adobe Premiere Pro 2026") && est_dossier_premiere("Adobe Premiere Pro (Beta)"));
        assert!(!est_dossier_premiere("Adobe Premiere Elements 2025") && !est_dossier_premiere("Adobe After Effects 2026"));
    }

    #[test]
    fn detection_sans_compatibilite_fictive() {
        let f = Factice::default();
        f.ajouter_premiere("C:\\Program Files\\Adobe\\Adobe Premiere Pro 2025\\Adobe Premiere Pro.exe", Some("25.2.1.4"));
        f.ajouter_premiere("C:\\Program Files\\Adobe\\Adobe Premiere Pro 2026\\Adobe Premiere Pro.exe", Some("26.5.2.13"));
        f.ajouter_premiere("C:\\Program Files\\Adobe\\Adobe Premiere Pro (Beta)\\Adobe Premiere Pro.exe", Some("27.1.0.5"));
        f.ajouter_premiere("C:\\Program Files\\Adobe\\Adobe Premiere Pro 2027\\Adobe Premiere Pro.exe", None);
        let d = detecter_premiere(&f, None);
        assert_eq!(d.installations.len(), 4);
        let p = d.principale.unwrap();
        assert_eq!(p.version.as_deref(), Some("26.5.2.13"), "stable et compatible avant la bêta");
        assert_eq!((p.compatible, p.glisser), (Some(true), Some(false)));
        let inconnue = d.installations.iter().find(|i| i.version.is_none()).unwrap();
        assert_eq!(inconnue.compatible, None, "version illisible : compatibilité inconnue, jamais supposée");
        assert_eq!(d.installations.iter().find(|i| i.version.as_deref() == Some("25.2.1.4")).unwrap().compatible, Some(false));
        let vide = detecter_premiere(&Factice::default(), None);
        assert!(vide.principale.is_none() && !vide.cherche.is_empty());
    }

    #[test]
    fn upia_commandes_exactes() {
        let f = Factice::default();
        f.upia_present();
        let cc = f.creative_cloud();
        f.repondre_upia("/install", 0, "");
        let r = upia_installer(&f, &cc, Path::new("C:\\Users\\Élodie\\AppData\\Local\\AETHRYON\\premiere\\aethryon-premiere.ccx"));
        assert!(r.ok);
        let appels = f.appels();
        assert_eq!(appels[0], format!("EXEC {} /install C:\\Users\\Élodie\\AppData\\Local\\AETHRYON\\premiere\\aethryon-premiere.ccx", cc.upia.clone().unwrap()));
        f.repondre_upia("/list", 0, "Plugin Name   Version   Status\nAETHRYON   0.9.2   Enabled\n");
        let (liste, sortie) = upia_lister(&f, &cc).unwrap();
        assert!(liste);
        assert_eq!(version_listee(&sortie).as_deref(), Some("0.9.2"));
        assert_eq!(version_listee("fr.aethryon.premiere (v0.9.1) enabled").as_deref(), Some("0.9.1"));
        assert_eq!(version_listee("AETHRYON enabled"), None, "sortie sans version : rien n'est supposé");
        assert_eq!(version_listee("Autre 1.2.3\nAETHRYON"), None);
        f.repondre_upia("/list", 0, "Plugin Name   Version\nAutre   1.0\n");
        assert!(!upia_lister(&f, &cc).unwrap().0);
        f.repondre_upia("/remove", 1, "not found");
        let r = upia_retirer(&f, &cc, None);
        assert!(!r.ok && r.message.contains("Gérer les plug-ins"));
        let appels = f.appels();
        assert!(appels.iter().any(|a| a.ends_with("/remove AETHRYON")));
        assert!(appels.iter().any(|a| a.ends_with("/remove fr.aethryon.premiere")));
        let sans = Factice::default();
        assert!(!upia_installer(&sans, &sans.creative_cloud(), Path::new("x.ccx")).ok);
    }

    #[test]
    fn sortie_utf16() {
        let s = "AETHRYON 1.0 installé";
        let mut o = vec![0xFF, 0xFE];
        for u in s.encode_utf16() {
            o.extend_from_slice(&u.to_le_bytes());
        }
        assert_eq!(decoder_sortie(&o), s);
        assert_eq!(decoder_sortie(s.as_bytes()), s);
        assert!(liste_contient_panneau("x fr.aethryon.premiere y"));
        assert!(!liste_contient_panneau("AETHRYONX tools"));
    }

    #[test]
    fn native_messaging_hkcu() {
        let d = tempfile::tempdir().unwrap();
        let f = Factice::default();
        let manifeste = d.path().join("nm").join("fr.aethryon.desktop.json");
        let exe = Path::new("C:\\Users\\Élodie\\AppData\\Local\\Programs\\AETHRYON\\aethryon-desktop.exe");
        let r = enregistrer_nm(&f, exe, &manifeste);
        assert!(r.iter().all(|e| e.enregistre));
        let m: serde_json::Value = serde_json::from_slice(&std::fs::read(&manifeste).unwrap()).unwrap();
        assert_eq!(m["name"], "fr.aethryon.desktop");
        assert_eq!(m["type"], "stdio");
        assert_eq!(m["path"], exe.to_string_lossy().as_ref());
        assert_eq!(m["allowed_origins"], serde_json::json!(["chrome-extension://necpohicddjeaeaaomaakehcbccapabg/", "chrome-extension://dnllfjakdgmgfiompaheickmbjjlgjdc/"]));
        assert_eq!(f.reg_lire("Software\\Google\\Chrome\\NativeMessagingHosts\\fr.aethryon.desktop", None).unwrap(), manifeste.to_string_lossy());
        assert!(f.reg_lire("Software\\Microsoft\\Edge\\NativeMessagingHosts\\fr.aethryon.desktop", None).is_some());
        assert!(f.reg_lire("Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\fr.aethryon.desktop", None).is_some());
        assert!(etat_nm(&f, &manifeste).iter().all(|e| e.enregistre));
        assert!(retirer_nm(&f, &manifeste).is_empty());
        assert!(etat_nm(&f, &manifeste).iter().all(|e| !e.enregistre));
        assert!(!manifeste.exists());
    }

    #[test]
    fn demarrage_et_explorateur() {
        let f = Factice::default();
        let exe = Path::new("C:\\Program Files\\AETHRYON\\aethryon-desktop.exe");
        demarrage_auto(&f, exe, true).unwrap();
        assert_eq!(f.reg_lire(CLE_RUN, Some(VALEUR_RUN)).unwrap(), "\"C:\\Program Files\\AETHRYON\\aethryon-desktop.exe\" --arriere-plan");
        assert!(demarrage_auto_actif(&f, exe));
        demarrage_auto(&f, exe, false).unwrap();
        assert!(!demarrage_auto_actif(&f, exe));
        assert_eq!(argument_explorateur(Path::new("C:\\M\\Été 🎬.mp4")), "/select,\"C:\\M\\Été 🎬.mp4\"");
    }
}

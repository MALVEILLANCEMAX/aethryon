//! Coffre d'AETHRYON Desktop : la clé « desktop » du compte (ytc_…, 30 jours) et le compte relié.
//!
//! - La clé n'est JAMAIS remise à l'interface (WebView2) : ni par une commande, ni par un événement, ni dans le stockage
//!   de la WebView. Seul le cœur Rust la lit, pour ses propres requêtes vers account.
//! - Windows : chiffrée par DPAPI (`CryptProtectData`, portée de l'utilisateur Windows, entropie propre à AETHRYON,
//!   aucune fenêtre : `CRYPTPROTECT_UI_FORBIDDEN`) dans `R\compte\liaison.dpapi` ; un autre compte Windows ou une
//!   autre machine ne peuvent pas la déchiffrer. NON TESTÉ SOUS UN VRAI WINDOWS (essayé sous Wine).
//! - Ailleurs (essais Linux) : fichier aux droits 0600 dans un dossier 0700 (`R/compte/liaison.json`).
//! - Écriture atomique (fichier temporaire puis renommage) ; un coffre illisible (corrompu, autre utilisateur) est traité
//!   comme « non relié » et effacé à la prochaine liaison.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// Entropie supplémentaire de DPAPI : un autre programme du même utilisateur qui appellerait CryptUnprotectData sans
/// elle n'obtient rien (défense en profondeur, pas un secret).
#[cfg_attr(not(windows), allow(dead_code))]
const ENTROPIE: &[u8] = b"AETHRYON-Desktop/compte/v1";

/// Ce que garde le coffre.
#[derive(Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Liaison {
    /// Clé « desktop » (secret porteur). Jamais affichée, jamais journalisée (Debug masqué).
    pub cle: String,
    pub expire_le: Option<String>,
    pub email: String,
    pub nom: String,
    pub relie_le: String,
}

impl std::fmt::Debug for Liaison {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Liaison").field("cle", &"ytc_…(masquée)").field("expire_le", &self.expire_le).finish()
    }
}

#[derive(Clone, Debug)]
pub struct Coffre {
    dossier: PathBuf,
}

impl Coffre {
    /// Coffre sous la racine `R` du contrat (`%LOCALAPPDATA%\AETHRYON`).
    pub fn sous(racine: &Path) -> Coffre {
        Coffre { dossier: racine.join("compte") }
    }

    pub fn chemin(&self) -> PathBuf {
        #[cfg(windows)]
        return self.dossier.join("liaison.dpapi");
        #[cfg(not(windows))]
        return self.dossier.join("liaison.json");
    }

    /// `Ok(None)` : aucune liaison. Un fichier illisible (corrompu, autre utilisateur Windows) donne `Ok(None)` aussi.
    pub fn lire(&self) -> io::Result<Option<Liaison>> {
        let octets = match fs::read(self.chemin()) {
            Ok(o) => o,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e),
        };
        let clair = match ouvrir(&octets) {
            Some(c) => c,
            None => return Ok(None),
        };
        Ok(serde_json::from_slice::<Liaison>(&clair).ok().filter(|l| l.cle.starts_with("ytc_") && l.cle.len() <= 200))
    }

    pub fn ecrire(&self, l: &Liaison) -> io::Result<()> {
        creer_dossier_prive(&self.dossier)?;
        let clair = serde_json::to_vec(l).map_err(io::Error::other)?;
        let scelle = sceller(&clair)?;
        let final_ = self.chemin();
        let tmp = self.dossier.join(format!(".liaison-{}.tmp", std::process::id()));
        {
            let mut f = ouvrir_prive(&tmp)?;
            f.write_all(&scelle)?;
            f.sync_all()?;
        }
        fs::rename(&tmp, &final_).inspect_err(|_| {
            let _ = fs::remove_file(&tmp);
        })
    }

    /// Efface la liaison (déconnexion, clé refusée). Sans erreur si rien n'existe.
    pub fn effacer(&self) -> io::Result<()> {
        match fs::remove_file(self.chemin()) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        }
    }
}

#[cfg(unix)]
fn creer_dossier_prive(d: &Path) -> io::Result<()> {
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
    fs::DirBuilder::new().recursive(true).mode(0o700).create(d)?;
    fs::set_permissions(d, fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn creer_dossier_prive(d: &Path) -> io::Result<()> {
    fs::create_dir_all(d)
}

#[cfg(unix)]
fn ouvrir_prive(p: &Path) -> io::Result<fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(p)
}

#[cfg(not(unix))]
fn ouvrir_prive(p: &Path) -> io::Result<fs::File> {
    fs::OpenOptions::new().write(true).create(true).truncate(true).open(p)
}

#[cfg(windows)]
fn sceller(clair: &[u8]) -> io::Result<Vec<u8>> {
    dpapi::proteger(clair).map_err(io::Error::other)
}

#[cfg(windows)]
fn ouvrir(scelle: &[u8]) -> Option<Vec<u8>> {
    dpapi::deproteger(scelle).ok()
}

#[cfg(not(windows))]
fn sceller(clair: &[u8]) -> io::Result<Vec<u8>> {
    Ok(clair.to_vec())
}

#[cfg(not(windows))]
fn ouvrir(scelle: &[u8]) -> Option<Vec<u8>> {
    Some(scelle.to_vec())
}

#[cfg(windows)]
mod dpapi {
    use super::ENTROPIE;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};

    fn blob(d: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB { cbData: d.len() as u32, pbData: d.as_ptr() as *mut u8 }
    }

    /// Copie le tampon rendu par DPAPI puis le libère (LocalFree).
    fn reprendre(b: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        if b.pbData.is_null() {
            return Vec::new();
        }
        // SAFETY : DPAPI a alloué `cbData` octets à `pbData` (LocalAlloc) ; copiés puis libérés une seule fois.
        let v = unsafe { std::slice::from_raw_parts(b.pbData, b.cbData as usize).to_vec() };
        unsafe { LocalFree(b.pbData as _) };
        v
    }

    pub fn proteger(clair: &[u8]) -> Result<Vec<u8>, String> {
        let entree = blob(clair);
        let ent = blob(ENTROPIE);
        let mut sortie = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        // SAFETY : tampons d'entrée vivants pendant l'appel ; `sortie` reçoit un tampon alloué par DPAPI.
        let ok = unsafe { CryptProtectData(&entree, std::ptr::null(), &ent, std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut sortie) };
        if ok == 0 {
            return Err(format!("Protection Windows (DPAPI) indisponible ({}).", std::io::Error::last_os_error()));
        }
        Ok(reprendre(sortie))
    }

    pub fn deproteger(scelle: &[u8]) -> Result<Vec<u8>, String> {
        let entree = blob(scelle);
        let ent = blob(ENTROPIE);
        let mut sortie = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        // SAFETY : comme ci-dessus ; aucune description demandée (null).
        let ok = unsafe { CryptUnprotectData(&entree, std::ptr::null_mut(), &ent, std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut sortie) };
        if ok == 0 {
            return Err("Liaison illisible (autre utilisateur Windows ou fichier abîmé).".into());
        }
        Ok(reprendre(sortie))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn liaison() -> Liaison {
        Liaison { cle: format!("ytc_{}", "A".repeat(64)), expire_le: Some("2026-11-22T10:00:00.000Z".into()), email: "admin@example.test".into(), nom: "Admin".into(), relie_le: "2026-10-23T10:00:00Z".into() }
    }

    #[test]
    fn aller_retour_effacement_et_droits() {
        let d = tempfile::tempdir().unwrap();
        let c = Coffre::sous(d.path());
        assert_eq!(c.lire().unwrap(), None, "aucune liaison au départ");
        c.ecrire(&liaison()).unwrap();
        assert_eq!(c.lire().unwrap(), Some(liaison()));
        // La clé n'apparaît jamais dans une sortie de débogage (journaux).
        assert!(!format!("{:?}", liaison()).contains("AAAA"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(c.chemin()).unwrap().permissions().mode() & 0o777, 0o600, "fichier lisible par son seul propriétaire");
            assert_eq!(fs::metadata(d.path().join("compte")).unwrap().permissions().mode() & 0o777, 0o700);
        }
        #[cfg(windows)]
        {
            // DPAPI : le fichier ne contient pas la clé en clair.
            let brut = fs::read(c.chemin()).unwrap();
            assert!(!brut.windows(8).any(|w| w == b"ytc_AAAA"), "clé chiffrée par DPAPI");
        }
        let restes: Vec<_> = fs::read_dir(d.path().join("compte")).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(restes.len(), 1, "aucun fichier temporaire laissé : {restes:?}");
        c.effacer().unwrap();
        c.effacer().unwrap();
        assert_eq!(c.lire().unwrap(), None);
    }

    #[test]
    fn coffre_abime_ou_etranger_ignore() {
        let d = tempfile::tempdir().unwrap();
        let c = Coffre::sous(d.path());
        fs::create_dir_all(d.path().join("compte")).unwrap();
        fs::write(c.chemin(), b"\x00\x01pas une liaison").unwrap();
        assert_eq!(c.lire().unwrap(), None, "illisible : non relié");
        fs::write(c.chemin(), br#"{"cle":"autre","expireLe":null,"email":"x","nom":"y","relieLe":"z"}"#).unwrap();
        assert_eq!(c.lire().unwrap(), None, "clé de forme inattendue refusée");
    }
}

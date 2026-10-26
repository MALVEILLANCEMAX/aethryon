//! Volumes (disques) : lettre, nom, type (fixe, amovible, réseau, optique, mémoire), système de fichiers, taille et
//! espace libre, disponibilité. Sous Windows : `GetLogicalDriveStringsW`, `GetDriveTypeW`, `GetVolumeInformationW`,
//! `GetDiskFreeSpaceExW`, `GetVolumeNameForVolumeMountPointW`, `QueryDosDeviceW` (lecteurs `subst`), chaque volume
//! interrogé sur son propre fil (un lecteur réseau déconnecté ne bloque pas les autres ; 4 s au plus), erreurs critiques
//! coupées (`SEM_FAILCRITICALERRORS` : jamais de fenêtre « Insérez un disque » pour un lecteur de cartes vide).
//! Ailleurs (essais) : `/proc/mounts` et `statvfs`.
//!
//! Identité d'un volume dans l'index (`cle`) : numéro de série du volume (`serie:1a2b3c4d`), stable quand la lettre
//! change (clé USB rebranchée en F: au lieu de E:) ; lecteur réseau : `reseau:<lettre>` ; numéro absent :
//! `lettre:<x>` ; lecteur `subst` : identité du volume sous-jacent (voir `volume_de`). Les identifiants de fichiers ne
//! servent (renommages, déplacements, doublons) que sur NTFS local (`idsFiables`) : FAT32 et exFAT n'ont pas
//! d'identifiant stable, et sur ReFS l'identifiant 64 bits n'est pas garanti unique.

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GenreVolume {
    Fixe,
    Amovible,
    Reseau,
    Optique,
    Memoire,
    Inconnu,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Volume {
    /// `C:\` (Windows), point de montage ailleurs.
    pub racine: String,
    pub lettre: Option<String>,
    /// Nom du volume (« Données », « CLÉ USB »).
    pub nom: Option<String>,
    pub genre: GenreVolume,
    pub systeme_fichiers: Option<String>,
    pub taille: Option<u64>,
    pub libre: Option<u64>,
    pub disponible: bool,
    /// Raison d'une indisponibilité (lecteur vide, réseau injoignable…).
    pub message: Option<String>,
    /// Numéro de série affiché (`1A2B-3C4D`).
    pub serie: Option<String>,
    /// Identité du volume dans l'index (voir l'en-tête du module).
    pub cle: Option<String>,
    pub guid: Option<String>,
    /// Volume qui porte Windows.
    pub systeme: bool,
    /// Lecteur `subst` (dossier présenté comme un disque).
    pub substitue: bool,
    pub ids_fiables: bool,
}

impl Volume {
    pub fn vide(racine: &str, genre: GenreVolume) -> Self {
        Volume {
            racine: racine.to_string(),
            lettre: lettre_de(racine),
            nom: None,
            genre,
            systeme_fichiers: None,
            taille: None,
            libre: None,
            disponible: false,
            message: None,
            serie: None,
            cle: None,
            guid: None,
            systeme: false,
            substitue: false,
            ids_fiables: false,
        }
    }

    /// Retenu par la cible « tous les disques disponibles » : fixe ou amovible, disponible, pas un `subst`.
    pub fn pour_tous(&self) -> bool {
        self.disponible && !self.substitue && matches!(self.genre, GenreVolume::Fixe | GenreVolume::Amovible)
    }
}

pub fn lettre_de(racine: &str) -> Option<String> {
    let b = racine.as_bytes();
    (b.len() >= 2 && b[1] == b':' && b[0].is_ascii_alphabetic()).then(|| (b[0] as char).to_ascii_uppercase().to_string())
}

/// Source des volumes : le système, ou une liste fixée par les essais (disque « débranché »).
pub trait SourceVolumes: Send + Sync {
    fn lister(&self) -> Vec<Volume>;
}

pub struct VolumesSysteme;

impl SourceVolumes for VolumesSysteme {
    fn lister(&self) -> Vec<Volume> {
        lister_systeme()
    }
}

/// Essais : volumes choisis (modifiables pendant l'essai).
pub struct VolumesFixes(pub std::sync::Mutex<Vec<Volume>>);

impl SourceVolumes for VolumesFixes {
    fn lister(&self) -> Vec<Volume> {
        self.0.lock().map(|v| v.clone()).unwrap_or_default()
    }
}

/// Identité du volume d'une racine de scan, d'après les volumes énumérés (plus long préfixe).
#[derive(Clone, Debug, PartialEq)]
pub struct IdentVolume {
    pub cle: String,
    pub ids_fiables: bool,
    pub volume: Option<Volume>,
}

pub fn volume_de(racine: &Path, vus: &[Volume]) -> IdentVolume {
    let cle_racine = crate::noms::normaliser_pour_id(&racine.to_string_lossy());
    let mut meilleur: Option<&Volume> = None;
    for v in vus {
        let r = crate::noms::normaliser_pour_id(v.racine.trim_end_matches(['\\', '/']));
        let dedans = cle_racine == r || cle_racine.starts_with(&format!("{r}\\")) || r.is_empty();
        if dedans && meilleur.map(|m| m.racine.len() < v.racine.len()).unwrap_or(true) {
            meilleur = Some(v);
        }
    }
    if let Some(v) = meilleur {
        if v.substitue {
            if let Some(s) = &v.serie {
                return IdentVolume { cle: format!("serie:{}", s.replace('-', "").to_lowercase()), ids_fiables: v.ids_fiables, volume: None };
            }
        }
        if let Some(c) = &v.cle {
            return IdentVolume { cle: c.clone(), ids_fiables: v.ids_fiables, volume: Some(v.clone()) };
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let dev = std::fs::metadata(racine).map(|m| m.dev()).ok();
        return IdentVolume { cle: dev.map(|d| format!("dev:{d}")).unwrap_or_else(|| "dev:inconnu".into()), ids_fiables: true, volume: None };
    }
    #[cfg(not(unix))]
    {
        let (vol, _) = super::reglages::decouper_volume(&cle_racine);
        IdentVolume { cle: if vol.starts_with("\\\\") { format!("unc:{vol}") } else { format!("lettre:{}", vol.trim_end_matches(':')) }, ids_fiables: false, volume: None }
    }
}

#[cfg(windows)]
pub fn lister_systeme() -> Vec<Volume> {
    systeme::lister()
}

#[cfg(not(windows))]
pub fn lister_systeme() -> Vec<Volume> {
    unix::lister()
}

#[cfg(windows)]
mod systeme {
    use super::*;
    use std::os::windows::ffi::OsStrExt;
    use std::sync::mpsc::channel;
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Storage::FileSystem::{
        GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDriveStringsW, GetVolumeInformationW, GetVolumeNameForVolumeMountPointW, QueryDosDeviceW,
    };
    use windows_sys::Win32::System::Diagnostics::Debug::{SetThreadErrorMode, SEM_FAILCRITICALERRORS};

    fn large(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    }

    fn texte(b: &[u16]) -> String {
        let n = b.iter().position(|c| *c == 0).unwrap_or(b.len());
        String::from_utf16_lossy(&b[..n])
    }

    pub fn lister() -> Vec<Volume> {
        let mut buf = vec![0u16; 2048];
        let n = unsafe { GetLogicalDriveStringsW(buf.len() as u32, buf.as_mut_ptr()) } as usize;
        if n == 0 || n > buf.len() {
            return Vec::new();
        }
        let racines: Vec<String> = buf[..n].split(|c| *c == 0).filter(|s| !s.is_empty()).map(String::from_utf16_lossy).collect();
        let (tx, rx) = channel();
        for (i, r) in racines.iter().enumerate() {
            let (tx, r) = (tx.clone(), r.clone());
            let _ = std::thread::Builder::new().name("aethryon-index-volume".into()).spawn(move || {
                let _ = tx.send((i, infos(&r)));
            });
        }
        drop(tx);
        let limite = Instant::now() + Duration::from_secs(4);
        let mut res: Vec<Option<Volume>> = vec![None; racines.len()];
        while res.iter().any(Option::is_none) {
            match rx.recv_timeout(limite.saturating_duration_since(Instant::now())) {
                Ok((i, v)) => res[i] = Some(v),
                Err(_) => break,
            }
        }
        racines
            .into_iter()
            .zip(res)
            .map(|(r, v)| {
                v.unwrap_or_else(|| {
                    let mut x = Volume::vide(&r, GenreVolume::Inconnu);
                    x.message = Some("Le lecteur ne répond pas (4 s) : réseau injoignable ou disque en veille.".into());
                    x
                })
            })
            .collect()
    }

    fn infos(racine: &str) -> Volume {
        let mut ancien = 0u32;
        unsafe { SetThreadErrorMode(SEM_FAILCRITICALERRORS, &mut ancien) };
        let v = infos_sans_dialogue(racine);
        unsafe { SetThreadErrorMode(ancien, std::ptr::null_mut()) };
        v
    }

    fn infos_sans_dialogue(racine: &str) -> Volume {
        let w = large(racine);
        let genre = match unsafe { GetDriveTypeW(w.as_ptr()) } {
            2 => GenreVolume::Amovible,
            3 => GenreVolume::Fixe,
            4 => GenreVolume::Reseau,
            5 => GenreVolume::Optique,
            6 => GenreVolume::Memoire,
            _ => GenreVolume::Inconnu,
        };
        let mut v = Volume::vide(racine, genre);
        if let Some(l) = &v.lettre {
            let dev = large(&format!("{l}:"));
            let mut cible = vec![0u16; 1024];
            let n = unsafe { QueryDosDeviceW(dev.as_ptr(), cible.as_mut_ptr(), cible.len() as u32) };
            v.substitue = n > 0 && texte(&cible).starts_with("\\??\\");
        }
        let systeme = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
        v.systeme = v.lettre.as_deref().map(|l| systeme.to_ascii_uppercase().starts_with(l)).unwrap_or(false);
        let (mut nom, mut fs) = (vec![0u16; 261], vec![0u16; 261]);
        let (mut serie, mut maxc, mut drapeaux) = (0u32, 0u32, 0u32);
        let ok = unsafe {
            GetVolumeInformationW(w.as_ptr(), nom.as_mut_ptr(), nom.len() as u32, &mut serie, &mut maxc, &mut drapeaux, fs.as_mut_ptr(), fs.len() as u32)
        } != 0;
        if !ok {
            let e = std::io::Error::last_os_error();
            v.message = Some(match e.raw_os_error() {
                Some(21) => "Aucun média dans le lecteur (lecteur de cartes vide, disque éjecté).".into(),
                Some(53) | Some(67) | Some(1222) => "Lecteur réseau injoignable.".into(),
                Some(5) => "Windows refuse l'accès à ce volume.".into(),
                _ => format!("Volume illisible ({e})."),
            });
            v.cle = v.lettre.as_ref().map(|l| format!("lettre:{}", l.to_ascii_lowercase()));
            return v;
        }
        v.disponible = true;
        let n = texte(&nom);
        v.nom = (!n.is_empty()).then_some(n);
        let f = texte(&fs);
        // NTFS seulement : sur ReFS, l'identifiant 64 bits n'est pas garanti unique. Un `subst` porte les fichiers du
        // volume NTFS sous-jacent : mêmes identifiants (doublons reconnus entre `S:\x` et `D:\Photos\x`).
        v.ids_fiables = matches!(genre, GenreVolume::Fixe | GenreVolume::Amovible) && f.eq_ignore_ascii_case("NTFS");
        v.systeme_fichiers = (!f.is_empty()).then_some(f);
        v.serie = Some(format!("{:04X}-{:04X}", serie >> 16, serie & 0xFFFF));
        let lettre = v.lettre.clone().unwrap_or_default().to_ascii_lowercase();
        // Un `subst` n'a pas de clé propre : ses fichiers appartiennent au volume sous-jacent (voir `volume_de`).
        v.cle = if v.substitue {
            None
        } else if genre == GenreVolume::Reseau {
            Some(format!("reseau:{lettre}"))
        } else if serie == 0 {
            Some(format!("lettre:{lettre}"))
        } else {
            Some(format!("serie:{serie:08x}"))
        };
        let (mut libre, mut total) = (0u64, 0u64);
        if unsafe { GetDiskFreeSpaceExW(w.as_ptr(), &mut libre, &mut total, std::ptr::null_mut()) } != 0 {
            v.libre = Some(libre);
            v.taille = Some(total);
        }
        if genre != GenreVolume::Reseau {
            let mut g = vec![0u16; 64];
            if unsafe { GetVolumeNameForVolumeMountPointW(w.as_ptr(), g.as_mut_ptr(), g.len() as u32) } != 0 {
                v.guid = Some(texte(&g));
            }
        }
        v
    }
}

#[cfg(not(windows))]
mod unix {
    use super::*;

    fn decoder(s: &str) -> String {
        // /proc/mounts échappe espace, tabulation, saut de ligne et barre oblique inverse en octal (\040…).
        let mut o = Vec::new();
        let b = s.as_bytes();
        let mut i = 0;
        while i < b.len() {
            if b[i] == b'\\' && i + 3 < b.len() + 1 && b.get(i + 1..i + 4).map(|x| x.iter().all(|c| (b'0'..=b'7').contains(c))).unwrap_or(false) {
                let v = u8::from_str_radix(std::str::from_utf8(&b[i + 1..i + 4]).unwrap_or("0"), 8).unwrap_or(b'?');
                o.push(v);
                i += 4;
            } else {
                o.push(b[i]);
                i += 1;
            }
        }
        String::from_utf8_lossy(&o).into_owned()
    }

    pub fn lister() -> Vec<Volume> {
        use std::os::unix::fs::MetadataExt;
        let Ok(t) = std::fs::read_to_string("/proc/mounts") else {
            return Vec::new();
        };
        let mut vus = std::collections::HashSet::new();
        let mut v = Vec::new();
        for l in t.lines() {
            let c: Vec<&str> = l.split_whitespace().collect();
            if c.len() < 3 {
                continue;
            }
            let (point, fs) = (decoder(c[1]), c[2]);
            let genre = match fs {
                "ext2" | "ext3" | "ext4" | "xfs" | "btrfs" | "zfs" | "f2fs" | "overlay" => {
                    if point.starts_with("/media/") || point.starts_with("/run/media/") {
                        GenreVolume::Amovible
                    } else {
                        GenreVolume::Fixe
                    }
                }
                "vfat" | "exfat" | "ntfs" | "ntfs3" | "fuseblk" => GenreVolume::Amovible,
                "nfs" | "nfs4" | "cifs" | "smb3" => GenreVolume::Reseau,
                "iso9660" | "udf" => GenreVolume::Optique,
                _ => continue,
            };
            let Ok(m) = std::fs::metadata(&point) else { continue };
            if !vus.insert(m.dev()) {
                continue;
            }
            let mut x = Volume::vide(&point, genre);
            x.disponible = true;
            x.systeme_fichiers = Some(fs.to_string());
            x.systeme = point == "/";
            x.cle = Some(format!("dev:{}", m.dev()));
            x.ids_fiables = genre != GenreVolume::Reseau;
            x.nom = Path::new(&point).file_name().map(|n| n.to_string_lossy().into_owned());
            let cp = std::ffi::CString::new(point.as_bytes().to_vec()).unwrap_or_default();
            let mut s: libc::statvfs = unsafe { std::mem::zeroed() };
            if unsafe { libc::statvfs(cp.as_ptr(), &mut s) } == 0 {
                x.taille = Some(s.f_blocks as u64 * s.f_frsize as u64);
                x.libre = Some(s.f_bavail as u64 * s.f_frsize as u64);
            }
            v.push(x);
        }
        v
    }
}

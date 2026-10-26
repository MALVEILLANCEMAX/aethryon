//! Parcours des dossiers (scanner natif), sur des fils dédiés en priorité basse, nombre de fils borné.
//!
//! - Windows : un seul appel système par lot d'entrées (`GetFileInformationByHandleEx(FileIdBothDirectoryInfo)` sur
//!   la poignée du dossier, chemins `\\?\` pour les chemins longs) : nom, taille, dates, attributs, étiquette de point
//!   d'analyse et IDENTIFIANT DE FICHIER NTFS de chaque entrée, sans ouvrir les fichiers. Repli sur `read_dir` si le
//!   système de fichiers refuse cette classe (certains partages réseau).
//! - Ailleurs : `read_dir` et `lstat` (inode).
//!
//! Liens symboliques, jonctions et points de montage : NON suivis par défaut (comptés « liens ignorés »). Même suivis,
//! aucune boucle n'est possible : chaque dossier ouvert est identifié (volume + identifiant de fichier, ou dev + inode)
//! et un dossier déjà parcouru ne l'est jamais deux fois (« boucles évitées ») ; profondeur bornée à 128 en dernier
//! filet. Fichiers « en ligne seulement » (OneDrive, attributs RECALL_*) : indexés, jamais ouverts (aucun
//! téléchargement provoqué). Aucun fichier n'est jamais écrit, déplacé ni renommé : le parcours ne fait que lire.

use super::reglages::Exclusions;
use super::volumes::IdentVolume;
use crate::bibliotheque::TypeMedia;
use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, AtomicUsize, Ordering};
use std::sync::mpsc::SyncSender;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

pub const PROFONDEUR_MAX: u16 = 128;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GenreEntree {
    Fichier,
    Dossier,
    /// Lien symbolique, jonction ou point de montage vers un dossier.
    LienDossier,
    LienFichier,
    Autre,
}

#[derive(Clone, Debug)]
pub struct Entree {
    pub nom: OsString,
    pub genre: GenreEntree,
    pub taille: u64,
    pub modifie_ms: i64,
    pub cree_ms: Option<i64>,
    /// Identifiant de fichier (NTFS : référence de fichier ; Unix : inode).
    pub fid: Option<i64>,
    /// Caché ou système (attributs Windows), ou nom commençant par « . ».
    pub cache: bool,
    /// « En ligne seulement » (fichier de OneDrive non téléchargé…) : jamais ouvert.
    pub en_ligne: bool,
    /// Unix : périphérique de l'entrée (un point de montage en change).
    pub dev: Option<u64>,
}

pub struct LectureDossier {
    /// Identité du dossier ouvert : (volume ou périphérique, identifiant de fichier).
    pub identite: Option<(u64, u128)>,
    pub entrees: Vec<Entree>,
}

/// Fichier média retenu.
#[derive(Clone, Debug, PartialEq)]
pub struct FichierVu {
    pub nom: String,
    pub ext: String,
    pub type_media: TypeMedia,
    pub taille: u64,
    pub modifie_ms: i64,
    pub cree_ms: Option<i64>,
    pub fid: Option<i64>,
    pub en_ligne: bool,
}

/// Contenu média d'un dossier, envoyé à l'écrivain de l'index.
#[derive(Clone, Debug)]
pub struct ListeDossier {
    pub chemin: PathBuf,
    pub racine: usize,
    pub volume: Arc<IdentVolume>,
    pub fichiers: Vec<FichierVu>,
    /// Liste incomplète (mode Everything, dossier vu en deux fois) : rien n'est marqué absent.
    pub partiel: bool,
}

pub enum Message {
    Dossier(ListeDossier),
    Erreur { chemin: String, message: String },
    /// Fin du parcours d'une racine : `complete` = racine lue et scan non annulé ; `introuvable` = la racine n'existe pas.
    RacineFinie { racine: usize, complete: bool, introuvable: bool },
}

#[derive(Default, Debug)]
pub struct Compteurs {
    pub fichiers_vus: AtomicU64,
    pub dossiers: AtomicU64,
    pub video: AtomicU64,
    pub audio: AtomicU64,
    pub image: AtomicU64,
    pub octets: AtomicU64,
    pub erreurs: AtomicU64,
    pub liens: AtomicU64,
    pub exclus: AtomicU64,
    pub boucles: AtomicU64,
}

impl Compteurs {
    pub fn lire(c: &AtomicU64) -> u64 {
        c.load(Ordering::Relaxed)
    }
    fn plus(c: &AtomicU64, n: u64) {
        c.fetch_add(n, Ordering::Relaxed);
    }
}

#[derive(Clone, Debug)]
pub struct Options {
    pub extensions: HashMap<String, TypeMedia>,
    pub exclusions: Exclusions,
    pub exclure_caches: bool,
    pub suivre_liens: bool,
    pub taille_min: u64,
    pub fils: usize,
    /// Pause après chaque dossier (économie ; essais de coupure).
    pub pause: Option<Duration>,
}

impl Options {
    /// Type média d'un nom de fichier retenu (extension connue, pas un fichier de service).
    pub fn type_de(&self, nom: &str) -> Option<(String, TypeMedia)> {
        if nom.starts_with("._") || nom.starts_with("~$") || nom.eq_ignore_ascii_case("desktop.ini") || nom.eq_ignore_ascii_case("thumbs.db") {
            return None;
        }
        let (souche, ext) = nom.rsplit_once('.')?;
        if souche.is_empty() {
            return None;
        }
        let ext = ext.to_ascii_lowercase();
        let t = *self.extensions.get(&ext)?;
        Some((ext, t))
    }
}

#[derive(Clone, Debug)]
pub struct RacineParcours {
    pub chemin: PathBuf,
    pub volume: Arc<IdentVolume>,
}

/// Message d'erreur lisible (aucune donnée du fichier).
pub fn message_erreur(e: &io::Error) -> String {
    match (e.kind(), e.raw_os_error()) {
        (io::ErrorKind::PermissionDenied, _) | (_, Some(5)) => "Accès refusé par le système.".into(),
        (io::ErrorKind::NotFound, _) | (_, Some(2)) | (_, Some(3)) => "Introuvable (supprimé ou déplacé pendant le scan).".into(),
        (_, Some(21)) => "Lecteur non prêt (média retiré).".into(),
        (_, Some(32)) => "Dossier occupé par une autre application.".into(),
        (_, Some(1920)) => "Le système ne peut pas accéder à ce dossier.".into(),
        (_, Some(n)) => format!("Lecture impossible (code {n})."),
        (k, None) => format!("Lecture impossible ({k:?})."),
    }
}

/// `.ts` est aussi l'extension du TypeScript : un fichier n'est retenu que s'il a la forme d'un flux MPEG-TS (octet de
/// synchronisation 0x47 tous les 188 octets, ou 192 pour le M2TS). Un fichier « en ligne seulement » n'est pas ouvert.
pub fn est_flux_mpeg_ts(chemin: &Path, taille: u64, en_ligne: bool) -> bool {
    if en_ligne {
        return taille >= 1024 * 1024;
    }
    use std::io::Read;
    let Ok(mut f) = std::fs::File::open(chemin) else { return false };
    let mut b = [0u8; 197];
    let mut lu = 0;
    while lu < b.len() {
        match f.read(&mut b[lu..]) {
            Ok(0) => break,
            Ok(n) => lu += n,
            Err(_) => return false,
        }
    }
    (lu > 188 && b[0] == 0x47 && b[188] == 0x47) || (lu >= 197 && b[4] == 0x47 && b[196] == 0x47)
}

// ---- Lecture d'un dossier ------------------------------------------------------------------------------------------

#[cfg(windows)]
pub use win::lire_dossier;

#[cfg(not(windows))]
pub use nix::lire_dossier;

#[cfg(windows)]
mod win {
    use super::*;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FileIdBothDirectoryInfo, FileIdBothDirectoryRestartInfo, GetFileInformationByHandle, GetFileInformationByHandleEx,
        BY_HANDLE_FILE_INFORMATION, FILE_FLAG_BACKUP_SEMANTICS, FILE_ID_BOTH_DIR_INFO, FILE_LIST_DIRECTORY, FILE_SHARE_DELETE, FILE_SHARE_READ,
        FILE_SHARE_WRITE, OPEN_EXISTING,
    };

    const ATTR_CACHE: u32 = 0x2;
    const ATTR_SYSTEME: u32 = 0x4;
    const ATTR_DOSSIER: u32 = 0x10;
    const ATTR_POINT_ANALYSE: u32 = 0x400;
    const ATTR_HORS_LIGNE: u32 = 0x1000;
    const ATTR_RAPPEL_OUVERTURE: u32 = 0x40000;
    const ATTR_RAPPEL_LECTURE: u32 = 0x400000;
    /// Bit « substitut de nom » d'une étiquette de point d'analyse : liens symboliques, jonctions, points de montage.
    const SUBSTITUT_DE_NOM: u32 = 0x2000_0000;
    const EPOQUE_FILETIME: i64 = 116_444_736_000_000_000;

    struct Poignee(HANDLE);
    impl Drop for Poignee {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.0) };
        }
    }

    /// Chemin `\\?\` (chemins longs, aucun traitement des noms par Win32).
    pub fn verbatim(p: &Path) -> Vec<u16> {
        let s: Vec<u16> = p.as_os_str().encode_wide().collect();
        let txt = String::from_utf16_lossy(&s);
        let mut v: Vec<u16> = Vec::with_capacity(s.len() + 8);
        if txt.starts_with("\\\\?\\") {
            v.extend_from_slice(&s);
        } else if let Some(reste) = txt.strip_prefix("\\\\") {
            v.extend("\\\\?\\UNC\\".encode_utf16());
            v.extend(reste.encode_utf16());
        } else {
            v.extend("\\\\?\\".encode_utf16());
            v.extend_from_slice(&s);
        }
        v.push(0);
        v
    }

    fn ms(t: i64) -> i64 {
        (t - EPOQUE_FILETIME) / 10_000
    }

    pub fn lire_dossier(chemin: &Path, suivre: bool) -> io::Result<LectureDossier> {
        let w = verbatim(chemin);
        let h = unsafe {
            CreateFileW(
                w.as_ptr(),
                FILE_LIST_DIRECTORY,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                std::ptr::null(),
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS,
                std::ptr::null_mut(),
            )
        };
        if h == INVALID_HANDLE_VALUE || h.is_null() {
            return Err(io::Error::last_os_error());
        }
        let p = Poignee(h);
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        let identite = (unsafe { GetFileInformationByHandle(p.0, &mut info) } != 0)
            .then(|| (info.dwVolumeSerialNumber as u64, ((info.nFileIndexHigh as u128) << 32) | info.nFileIndexLow as u128));
        let mut tampon = vec![0u64; 8192];
        let octets = tampon.len() * 8;
        let mut entrees = Vec::new();
        let mut classe = FileIdBothDirectoryRestartInfo;
        let decalage_nom = std::mem::offset_of!(FILE_ID_BOTH_DIR_INFO, FileName);
        loop {
            let ok = unsafe { GetFileInformationByHandleEx(p.0, classe, tampon.as_mut_ptr() as *mut core::ffi::c_void, octets as u32) } != 0;
            if !ok {
                let e = unsafe { GetLastError() };
                if e == 18 {
                    break; // ERROR_NO_MORE_FILES
                }
                if classe == FileIdBothDirectoryRestartInfo && matches!(e, 1 | 50 | 87 | 124) {
                    classe = FileIdBothDirectoryInfo;
                    continue;
                }
                if entrees.is_empty() && matches!(e, 1 | 50 | 87 | 124) {
                    drop(p);
                    return super::nix_std::lire(chemin, suivre, identite);
                }
                return Err(io::Error::from_raw_os_error(e as i32));
            }
            classe = FileIdBothDirectoryInfo;
            let base = tampon.as_ptr() as *const u8;
            let mut off = 0usize;
            loop {
                if off + decalage_nom > octets {
                    break;
                }
                let e: FILE_ID_BOTH_DIR_INFO = unsafe { std::ptr::read_unaligned(base.add(off) as *const FILE_ID_BOTH_DIR_INFO) };
                let n = e.FileNameLength as usize / 2;
                if off + decalage_nom + n * 2 > octets {
                    break;
                }
                let mut nom16 = vec![0u16; n];
                unsafe { std::ptr::copy_nonoverlapping(base.add(off + decalage_nom) as *const u16, nom16.as_mut_ptr(), n) };
                let point = nom16 == [b'.' as u16] || nom16 == [b'.' as u16, b'.' as u16];
                if !point {
                    let a = e.FileAttributes;
                    let dossier = a & ATTR_DOSSIER != 0;
                    let lien = a & ATTR_POINT_ANALYSE != 0 && e.EaSize & SUBSTITUT_DE_NOM != 0;
                    let genre = match (dossier, lien) {
                        (true, true) => GenreEntree::LienDossier,
                        (true, false) => GenreEntree::Dossier,
                        (false, true) => GenreEntree::LienFichier,
                        (false, false) => GenreEntree::Fichier,
                    };
                    let commence_point = nom16.first() == Some(&(b'.' as u16));
                    entrees.push(Entree {
                        nom: OsString::from_wide(&nom16),
                        genre,
                        taille: e.EndOfFile.max(0) as u64,
                        modifie_ms: ms(e.LastWriteTime),
                        cree_ms: (e.CreationTime > 0).then(|| ms(e.CreationTime)),
                        fid: (e.FileId != 0).then_some(e.FileId),
                        cache: a & (ATTR_CACHE | ATTR_SYSTEME) != 0 || commence_point,
                        en_ligne: a & (ATTR_HORS_LIGNE | ATTR_RAPPEL_OUVERTURE | ATTR_RAPPEL_LECTURE) != 0,
                        dev: None,
                    });
                }
                if e.NextEntryOffset == 0 {
                    break;
                }
                off += e.NextEntryOffset as usize;
            }
        }
        // Lien suivi vers un fichier : taille et date de la cible.
        if suivre {
            for x in entrees.iter_mut().filter(|x| x.genre == GenreEntree::LienFichier) {
                if let Ok(m) = std::fs::metadata(chemin.join(&x.nom)) {
                    x.taille = m.len();
                    x.modifie_ms = m.modified().map(super::ms_systeme).unwrap_or(x.modifie_ms);
                }
            }
        }
        Ok(LectureDossier { identite, entrees })
    }
}

/// Lecture portable par `read_dir` (Unix ; repli sous Windows).
mod nix_std {
    use super::*;

    pub fn lire(chemin: &Path, suivre: bool, identite: Option<(u64, u128)>) -> io::Result<LectureDossier> {
        let mut entrees = Vec::new();
        for e in std::fs::read_dir(chemin)? {
            let Ok(e) = e else { continue };
            let nom = e.file_name();
            let commence_point = nom.to_string_lossy().starts_with('.');
            let Ok(ft) = e.file_type() else { continue };
            let lien = ft.is_symlink();
            let meta = if lien { std::fs::metadata(e.path()) } else { e.metadata() };
            let Ok(m) = meta else {
                // Lien cassé ou entrée disparue entre la liste et la lecture.
                if lien {
                    entrees.push(Entree { nom, genre: GenreEntree::Autre, taille: 0, modifie_ms: 0, cree_ms: None, fid: None, cache: commence_point, en_ligne: false, dev: None });
                }
                continue;
            };
            let genre = match (lien, m.is_dir(), m.is_file()) {
                (true, true, _) => GenreEntree::LienDossier,
                (true, false, true) => GenreEntree::LienFichier,
                (false, true, _) => GenreEntree::Dossier,
                (false, false, true) => GenreEntree::Fichier,
                _ => GenreEntree::Autre,
            };
            let _ = suivre;
            #[cfg(unix)]
            let (fid, dev, cache, en_ligne) = {
                use std::os::unix::fs::MetadataExt;
                (Some(m.ino() as i64), Some(m.dev()), commence_point, false)
            };
            #[cfg(windows)]
            let (fid, dev, cache, en_ligne) = {
                use std::os::windows::fs::MetadataExt;
                let a = m.file_attributes();
                (None, None, a & 0x6 != 0 || commence_point, a & (0x1000 | 0x40000 | 0x400000) != 0)
            };
            entrees.push(Entree {
                nom,
                genre,
                taille: m.len(),
                modifie_ms: m.modified().map(ms_systeme).unwrap_or(0),
                cree_ms: m.created().ok().map(ms_systeme),
                fid,
                cache,
                en_ligne,
                dev,
            });
        }
        Ok(LectureDossier { identite, entrees })
    }
}

pub(crate) fn ms_systeme(t: std::time::SystemTime) -> i64 {
    match t.duration_since(std::time::UNIX_EPOCH) {
        Ok(d) => d.as_millis() as i64,
        Err(e) => -(e.duration().as_millis() as i64),
    }
}

#[cfg(not(windows))]
mod nix {
    use super::*;

    pub fn lire_dossier(chemin: &Path, suivre: bool) -> io::Result<LectureDossier> {
        use std::os::unix::fs::MetadataExt;
        let m = std::fs::metadata(chemin)?;
        if !m.is_dir() {
            return Err(io::Error::new(io::ErrorKind::NotADirectory, "pas un dossier"));
        }
        nix_std::lire(chemin, suivre, Some((m.dev(), m.ino() as u128)))
    }
}

// ---- Parcours ------------------------------------------------------------------------------------------------------

struct Tache {
    chemin: PathBuf,
    racine: usize,
    profondeur: u16,
}

struct Partage {
    opts: Arc<Options>,
    racines: Vec<RacineParcours>,
    annule: Arc<AtomicBool>,
    c: Arc<Compteurs>,
    file: Mutex<(Vec<Tache>, usize)>,
    cv: Condvar,
    restants: Vec<AtomicUsize>,
    /// 0 : lue ; 1 : erreur ; 2 : introuvable.
    echec_racine: Vec<AtomicU8>,
    serie_racine: Vec<Mutex<Option<u64>>>,
    visites: Mutex<HashSet<(u64, u128)>>,
    volumes_croises: Mutex<HashMap<u64, Arc<IdentVolume>>>,
}

/// Lance le parcours des racines sur `opts.fils` fils (1 à 4). Les messages arrivent dans l'ordre où les dossiers sont
/// terminés ; `RacineFinie` d'une racine arrive après tous ses dossiers. Les fils se terminent seuls (file vide ou
/// annulation) : l'appelant lit les messages jusqu'à ce que le canal se ferme.
pub fn parcourir(racines: Vec<RacineParcours>, opts: Arc<Options>, annule: Arc<AtomicBool>, c: Arc<Compteurs>, tx: SyncSender<Message>) -> Vec<std::thread::JoinHandle<()>> {
    let n = racines.len();
    let p = Arc::new(Partage {
        restants: (0..n).map(|_| AtomicUsize::new(1)).collect(),
        echec_racine: (0..n).map(|_| AtomicU8::new(0)).collect(),
        serie_racine: (0..n).map(|_| Mutex::new(None)).collect(),
        file: Mutex::new((racines.iter().enumerate().rev().map(|(i, r)| Tache { chemin: r.chemin.clone(), racine: i, profondeur: 0 }).collect(), 0)),
        cv: Condvar::new(),
        visites: Mutex::new(HashSet::new()),
        volumes_croises: Mutex::new(HashMap::new()),
        opts: opts.clone(),
        racines,
        annule,
        c,
    });
    let fils = opts.fils.clamp(1, 4);
    (0..fils)
        .filter_map(|i| {
            let (p, tx) = (p.clone(), tx.clone());
            std::thread::Builder::new().name(format!("aethryon-index-parcours-{i}")).spawn(move || p.travailler(tx)).ok()
        })
        .collect()
}

impl Partage {
    fn travailler(&self, tx: SyncSender<Message>) {
        super::priorite::basse();
        loop {
            let tache = {
                let mut g = self.file.lock().unwrap_or_else(|e| e.into_inner());
                loop {
                    if let Some(t) = g.0.pop() {
                        g.1 += 1;
                        break Some(t);
                    }
                    if g.1 == 0 {
                        break None;
                    }
                    g = self.cv.wait(g).unwrap_or_else(|e| e.into_inner());
                }
            };
            let Some(t) = tache else {
                self.cv.notify_all();
                return;
            };
            let racine = t.racine;
            if !self.annule.load(Ordering::Relaxed) {
                self.traiter(t, &tx);
                if let Some(d) = self.opts.pause {
                    std::thread::sleep(d);
                }
            }
            if self.restants[racine].fetch_sub(1, Ordering::AcqRel) == 1 {
                let echec = self.echec_racine[racine].load(Ordering::Acquire);
                let _ = tx.send(Message::RacineFinie { racine, complete: echec == 0 && !self.annule.load(Ordering::Relaxed), introuvable: echec == 2 });
            }
            let mut g = self.file.lock().unwrap_or_else(|e| e.into_inner());
            g.1 -= 1;
            let fini = g.0.is_empty() && g.1 == 0;
            drop(g);
            if fini {
                self.cv.notify_all();
            }
        }
    }

    fn volume_croise(&self, serie: u64) -> Arc<IdentVolume> {
        let mut m = self.volumes_croises.lock().unwrap_or_else(|e| e.into_inner());
        m.entry(serie)
            .or_insert_with(|| {
                let cle = if cfg!(windows) { format!("serie:{serie:08x}") } else { format!("dev:{serie}") };
                Arc::new(IdentVolume { cle, ids_fiables: !cfg!(windows), volume: None })
            })
            .clone()
    }

    fn traiter(&self, t: Tache, tx: &SyncSender<Message>) {
        let o = &self.opts;
        let lecture = match lire_dossier(&t.chemin, o.suivre_liens) {
            Ok(l) => l,
            Err(e) => {
                Compteurs::plus(&self.c.erreurs, 1);
                if t.profondeur == 0 {
                    let introuvable = e.kind() == io::ErrorKind::NotFound || matches!(e.raw_os_error(), Some(2) | Some(3));
                    self.echec_racine[t.racine].store(if introuvable { 2 } else { 1 }, Ordering::Release);
                }
                let _ = tx.send(Message::Erreur { chemin: t.chemin.to_string_lossy().into_owned(), message: message_erreur(&e) });
                return;
            }
        };
        if let Some(id) = lecture.identite {
            if !self.visites.lock().unwrap_or_else(|e| e.into_inner()).insert(id) {
                Compteurs::plus(&self.c.boucles, 1);
                return;
            }
        }
        let serie = lecture.identite.map(|i| i.0);
        let volume = {
            let mut s = self.serie_racine[t.racine].lock().unwrap_or_else(|e| e.into_inner());
            if t.profondeur == 0 {
                *s = serie;
            }
            match (serie, *s) {
                (Some(a), Some(b)) if a != b => self.volume_croise(a),
                _ => self.racines[t.racine].volume.clone(),
            }
        };
        Compteurs::plus(&self.c.dossiers, 1);
        let mut fichiers = Vec::new();
        let mut sous: Vec<PathBuf> = Vec::new();
        for e in lecture.entrees {
            if self.annule.load(Ordering::Relaxed) {
                // Liste interrompue : jamais envoyée (elle ferait croire à des fichiers supprimés).
                return;
            }
            let Some(nom) = e.nom.to_str().map(str::to_owned) else {
                // Nom non représentable en Unicode : ignoré plutôt qu'enregistré faux.
                continue;
            };
            match e.genre {
                GenreEntree::Dossier | GenreEntree::LienDossier => {
                    if e.genre == GenreEntree::LienDossier && !o.suivre_liens {
                        Compteurs::plus(&self.c.liens, 1);
                        continue;
                    }
                    #[cfg(unix)]
                    {
                        if e.genre == GenreEntree::Dossier && !o.suivre_liens && e.dev.is_some() && serie.is_some() && e.dev != serie {
                            // Point de montage : un autre système de fichiers.
                            Compteurs::plus(&self.c.liens, 1);
                            continue;
                        }
                    }
                    let chemin = t.chemin.join(&e.nom);
                    if (o.exclure_caches && e.cache) || o.exclusions.exclut(&chemin, &nom) {
                        Compteurs::plus(&self.c.exclus, 1);
                        continue;
                    }
                    if t.profondeur + 1 >= PROFONDEUR_MAX {
                        Compteurs::plus(&self.c.boucles, 1);
                        continue;
                    }
                    sous.push(chemin);
                }
                GenreEntree::Fichier | GenreEntree::LienFichier => {
                    Compteurs::plus(&self.c.fichiers_vus, 1);
                    let Some((ext, type_media)) = o.type_de(&nom) else { continue };
                    if e.genre == GenreEntree::LienFichier && !o.suivre_liens {
                        Compteurs::plus(&self.c.liens, 1);
                        continue;
                    }
                    if (o.exclure_caches && e.cache) || e.taille == 0 || e.taille < o.taille_min {
                        continue;
                    }
                    if ext == "ts" && !est_flux_mpeg_ts(&t.chemin.join(&e.nom), e.taille, e.en_ligne) {
                        continue;
                    }
                    match type_media {
                        TypeMedia::Video => Compteurs::plus(&self.c.video, 1),
                        TypeMedia::Audio => Compteurs::plus(&self.c.audio, 1),
                        TypeMedia::Image => Compteurs::plus(&self.c.image, 1),
                    }
                    Compteurs::plus(&self.c.octets, e.taille);
                    fichiers.push(FichierVu {
                        nom,
                        ext,
                        type_media,
                        taille: e.taille,
                        modifie_ms: e.modifie_ms,
                        cree_ms: e.cree_ms,
                        fid: if volume.ids_fiables { e.fid } else { None },
                        en_ligne: e.en_ligne,
                    });
                }
                GenreEntree::Autre => {}
            }
        }
        if !sous.is_empty() {
            self.restants[t.racine].fetch_add(sous.len(), Ordering::AcqRel);
            let mut g = self.file.lock().unwrap_or_else(|e| e.into_inner());
            for s in sous.into_iter().rev() {
                g.0.push(Tache { chemin: s, racine: t.racine, profondeur: t.profondeur + 1 });
            }
            drop(g);
            self.cv.notify_all();
        }
        let _ = tx.send(Message::Dossier(ListeDossier { chemin: t.chemin, racine: t.racine, volume, fichiers, partiel: false }));
    }
}

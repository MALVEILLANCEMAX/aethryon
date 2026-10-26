//! Mode accéléré Everything (FACULTATIF, désactivé par défaut) : quand Everything (voidtools) est lancé et que sa base
//! est chargée, les médias d'un volume sont lus dans SON index par l'IPC documentée du SDK (Everything 1.4 :
//! `WM_COPYDATA`, requête `EVERYTHING_IPC_QUERY2`, réponse `EVERYTHING_IPC_LIST2`, fenêtre
//! `EVERYTHING_TASKBAR_NOTIFICATION`), au lieu de parcourir le disque. Sinon : repli automatique sur le scanner natif.
//!
//! Ce qui a été retenu, et pourquoi :
//! - le protocole est réimplémenté ici en Rust à partir de `everything_ipc.h` et `Everything.c` du SDK officiel
//!   (Everything-SDK.zip, code sous licence MIT, © David Carpenter) : AUCUNE DLL n'est livrée ni chargée
//!   (`Everything64.dll` n'est pas nécessaire) ; Everything lui-même est sous licence MIT (License.txt de voidtools) et
//!   n'est jamais livré avec AETHRYON : il doit être installé et lancé par l'utilisateur ;
//! - pas d'`es.exe` (outil en ligne de commande distinct, à installer à part) ni de SDK3 / tubes nommés d'Everything
//!   1.5 (encore en alpha) ; la fenêtre de l'instance « 1.5a » est essayée avec la même IPC 1.4, sans garantie ;
//! - Everything ne donne pas d'identifiant de fichier : en mode Everything, un fichier renommé ou déplacé est vu comme
//!   supprimé puis ajouté (ses métadonnées sont relues) ; le scanner natif, lui, les reconnaît.
//! - la recherche envoyée : `file: ext:mp4;mkv;… "E:\Dossier\"`, triée par chemin (dossier par dossier), par pages
//!   de 5 000 résultats (mémoire bornée) ; chaque chemin est revérifié côté AETHRYON (racine, exclusions, types).

use serde::{Deserialize, Serialize};
use std::sync::atomic::AtomicBool;
use std::time::Duration;

pub const CLASSES: [&str; 2] = ["EVERYTHING_TASKBAR_NOTIFICATION", "EVERYTHING_TASKBAR_NOTIFICATION_(1.5a)"];
/// `EVERYTHING_WM_IPC` = `WM_USER`.
pub const WM_IPC: u32 = 0x0400;
pub const IPC_VERSION: [usize; 4] = [0, 1, 2, 3];
pub const IPC_BASE_CHARGEE: usize = 401;
pub const COPYDATA_QUERY2W: usize = 18;
pub const REQ_CHEMIN_COMPLET: u32 = 0x0000_0004;
pub const REQ_TAILLE: u32 = 0x0000_0010;
pub const REQ_CREE: u32 = 0x0000_0020;
pub const REQ_MODIFIE: u32 = 0x0000_0040;
pub const REQ_ATTRIBUTS: u32 = 0x0000_0100;
pub const DEMANDE: u32 = REQ_CHEMIN_COMPLET | REQ_TAILLE | REQ_CREE | REQ_MODIFIE | REQ_ATTRIBUTS;
pub const TRI_CHEMIN: u32 = 3;
pub const ELEMENT_DOSSIER: u32 = 1;
pub const PAR_PAGE: u32 = 5000;
const EPOQUE_FILETIME: i64 = 116_444_736_000_000_000;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct EtatEverything {
    pub disponible: bool,
    pub version: Option<String>,
    pub base_chargee: bool,
    pub raison: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ElementEverything {
    pub chemin: String,
    pub dossier: bool,
    pub taille: Option<u64>,
    pub cree_ms: Option<i64>,
    pub modifie_ms: Option<i64>,
    pub attributs: Option<u32>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Reponse {
    pub total: u32,
    pub decalage: u32,
    pub elements: Vec<ElementEverything>,
}

/// Recherche Everything des médias sous une racine (guillemets : chemins avec espaces).
pub fn recherche(racine: &str, extensions: &[String]) -> String {
    let mut r = racine.replace('"', "");
    if !r.ends_with('\\') {
        r.push('\\');
    }
    format!("file: ext:{} \"{r}\"", extensions.join(";"))
}

/// Corps d'une requête `EVERYTHING_IPC_QUERY2` (UTF-16, alignement 1 octet).
pub fn requete(fenetre_reponse: u32, id_reponse: u32, decalage: u32, max: u32, texte: &str) -> Vec<u8> {
    let mut v = Vec::with_capacity(28 + texte.len() * 2 + 2);
    for x in [fenetre_reponse, id_reponse, 0, decalage, max, DEMANDE, TRI_CHEMIN] {
        v.extend_from_slice(&x.to_le_bytes());
    }
    for u in texte.encode_utf16() {
        v.extend_from_slice(&u.to_le_bytes());
    }
    v.extend_from_slice(&[0, 0]);
    v
}

fn u32le(b: &[u8], i: usize) -> Result<u32, String> {
    b.get(i..i + 4).map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]])).ok_or_else(|| "Réponse d'Everything tronquée.".into())
}

fn i64le(b: &[u8], i: usize) -> Result<i64, String> {
    b.get(i..i + 8).map(|s| i64::from_le_bytes([s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7]])).ok_or_else(|| "Réponse d'Everything tronquée.".into())
}

fn texte(b: &[u8], i: &mut usize) -> Result<String, String> {
    let n = u32le(b, *i)? as usize;
    *i += 4;
    let fin = *i + n * 2;
    let s = b.get(*i..fin).ok_or("Réponse d'Everything tronquée.")?;
    let u: Vec<u16> = s.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
    *i = fin + 2;
    String::from_utf16(&u).map_err(|_| "Nom illisible dans la réponse d'Everything.".into())
}

fn ms_filetime(t: i64) -> Option<i64> {
    (t > 0 && t != i64::MAX).then(|| (t - EPOQUE_FILETIME) / 10_000)
}

/// Lit une réponse `EVERYTHING_IPC_LIST2` (ordre des champs : celui de `_Everything_GetRequestData` du SDK).
pub fn decoder(b: &[u8]) -> Result<Reponse, String> {
    let total = u32le(b, 0)?;
    let n = u32le(b, 4)? as usize;
    let decalage = u32le(b, 8)?;
    let drapeaux = u32le(b, 12)?;
    if n > 10_000_000 || 20 + n * 8 > b.len() {
        return Err("Réponse d'Everything incohérente.".into());
    }
    let mut elements = Vec::with_capacity(n);
    for k in 0..n {
        let flags = u32le(b, 20 + k * 8)?;
        let mut i = u32le(b, 24 + k * 8)? as usize;
        let mut e = ElementEverything { chemin: String::new(), dossier: flags & ELEMENT_DOSSIER != 0, taille: None, cree_ms: None, modifie_ms: None, attributs: None };
        if drapeaux & 0x1 != 0 {
            texte(b, &mut i)?;
        }
        if drapeaux & 0x2 != 0 {
            texte(b, &mut i)?;
        }
        if drapeaux & REQ_CHEMIN_COMPLET != 0 {
            e.chemin = texte(b, &mut i)?;
        }
        if drapeaux & 0x8 != 0 {
            texte(b, &mut i)?;
        }
        if drapeaux & REQ_TAILLE != 0 {
            let t = i64le(b, i)?;
            e.taille = (t >= 0).then_some(t as u64);
            i += 8;
        }
        if drapeaux & REQ_CREE != 0 {
            e.cree_ms = ms_filetime(i64le(b, i)?);
            i += 8;
        }
        if drapeaux & REQ_MODIFIE != 0 {
            e.modifie_ms = ms_filetime(i64le(b, i)?);
            i += 8;
        }
        if drapeaux & 0x80 != 0 {
            i += 8;
        }
        if drapeaux & REQ_ATTRIBUTS != 0 {
            e.attributs = Some(u32le(b, i)?);
        }
        if !e.chemin.is_empty() {
            elements.push(e);
        }
    }
    Ok(Reponse { total, decalage, elements })
}

/// Réponse `EVERYTHING_IPC_LIST2` (essais : serveur factice). `tous` = nombre total de résultats.
pub fn encoder_reponse(tous: u32, decalage: u32, elements: &[ElementEverything]) -> Vec<u8> {
    let mut entete = Vec::new();
    for x in [tous, elements.len() as u32, decalage, DEMANDE, TRI_CHEMIN] {
        entete.extend_from_slice(&x.to_le_bytes());
    }
    let debut_donnees = 20 + elements.len() * 8;
    let mut donnees = Vec::new();
    for e in elements {
        let off = (debut_donnees + donnees.len()) as u32;
        entete.extend_from_slice(&(if e.dossier { ELEMENT_DOSSIER } else { 0 }).to_le_bytes());
        entete.extend_from_slice(&off.to_le_bytes());
        let u: Vec<u16> = e.chemin.encode_utf16().collect();
        donnees.extend_from_slice(&(u.len() as u32).to_le_bytes());
        for c in &u {
            donnees.extend_from_slice(&c.to_le_bytes());
        }
        donnees.extend_from_slice(&[0, 0]);
        donnees.extend_from_slice(&(e.taille.map(|t| t as i64).unwrap_or(-1)).to_le_bytes());
        let ft = |m: Option<i64>| m.map(|m| m * 10_000 + EPOQUE_FILETIME).unwrap_or(0);
        donnees.extend_from_slice(&ft(e.cree_ms).to_le_bytes());
        donnees.extend_from_slice(&ft(e.modifie_ms).to_le_bytes());
        donnees.extend_from_slice(&e.attributs.unwrap_or(0x20).to_le_bytes());
    }
    entete.extend_from_slice(&donnees);
    entete
}

/// Lecture des médias d'une racine dans l'index d'Everything, page par page. `f` reçoit chaque page et le total ;
/// il renvoie faux pour arrêter. Renvoie le nombre d'éléments reçus.
pub fn lister(racine: &str, extensions: &[String], annule: &AtomicBool, par_page: u32, f: &mut dyn FnMut(&[ElementEverything], u32) -> bool) -> Result<u64, String> {
    let q = recherche(racine, extensions);
    let (mut decalage, mut recus) = (0u32, 0u64);
    loop {
        let r = interroger(&q, decalage, par_page.max(1), annule, Duration::from_secs(60))?;
        if r.elements.is_empty() {
            break;
        }
        recus += r.elements.len() as u64;
        decalage += r.elements.len() as u32;
        if !f(&r.elements, r.total) || decalage >= r.total {
            break;
        }
    }
    Ok(recus)
}

#[cfg(not(windows))]
pub fn detecter() -> EtatEverything {
    EtatEverything { disponible: false, version: None, base_chargee: false, raison: Some("Everything n'existe que sous Windows.".into()) }
}

#[cfg(not(windows))]
pub fn interroger(_q: &str, _d: u32, _m: u32, _a: &AtomicBool, _delai: Duration) -> Result<Reponse, String> {
    Err("Everything n'existe que sous Windows.".into())
}

#[cfg(windows)]
pub use win::{detecter, interroger};

#[cfg(windows)]
mod win {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Mutex;
    use std::time::Instant;
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::DataExchange::COPYDATASTRUCT;
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        ChangeWindowMessageFilterEx, CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, FindWindowExW, FindWindowW, MsgWaitForMultipleObjects, PeekMessageW,
        RegisterClassExW, SendMessageTimeoutW, HWND_MESSAGE, MSG, MSGFLT_ALLOW, PM_REMOVE, QS_ALLINPUT, SMTO_ABORTIFHUNG, WM_COPYDATA, WNDCLASSEXW,
    };

    static REPONSE: Mutex<Option<(u32, Vec<u8>)>> = Mutex::new(None);
    static COMPTEUR: AtomicU32 = AtomicU32::new(1);

    fn large(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe extern "system" fn procedure(h: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
        if msg == WM_COPYDATA && l != 0 {
            let cds = unsafe { &*(l as *const COPYDATASTRUCT) };
            if !cds.lpData.is_null() && cds.cbData > 0 && cds.cbData < 1 << 30 {
                let o = unsafe { std::slice::from_raw_parts(cds.lpData as *const u8, cds.cbData as usize) }.to_vec();
                if let Ok(mut r) = REPONSE.lock() {
                    *r = Some((cds.dwData as u32, o));
                }
                return 1;
            }
        }
        unsafe { DefWindowProcW(h, msg, w, l) }
    }

    /// Fenêtre de notification d'Everything (de premier niveau, cachée) ; à défaut, une fenêtre « message seulement »
    /// de la même classe (essais sous Wine sans affichage : seules ces fenêtres-là peuvent y être créées).
    pub(super) fn fenetre_everything() -> Option<HWND> {
        CLASSES.iter().find_map(|c| {
            let w = large(c);
            let mut h = unsafe { FindWindowW(w.as_ptr(), std::ptr::null()) };
            if h.is_null() {
                h = unsafe { FindWindowExW(HWND_MESSAGE, std::ptr::null_mut(), w.as_ptr(), std::ptr::null()) };
            }
            (!h.is_null()).then_some(h)
        })
    }

    fn commande(h: HWND, cmd: usize) -> Option<usize> {
        let mut r = 0usize;
        let ok = unsafe { SendMessageTimeoutW(h, WM_IPC, cmd, 0, SMTO_ABORTIFHUNG, 2000, &mut r) };
        (ok != 0).then_some(r)
    }

    pub fn detecter() -> EtatEverything {
        let Some(h) = fenetre_everything() else {
            return EtatEverything { disponible: false, version: None, base_chargee: false, raison: Some("Everything n'est pas lancé.".into()) };
        };
        let v: Vec<String> = IPC_VERSION.iter().map(|c| commande(h, *c).map(|x| x.to_string()).unwrap_or_else(|| "?".into())).collect();
        let charge = commande(h, IPC_BASE_CHARGEE).map(|x| x != 0).unwrap_or(false);
        EtatEverything {
            disponible: charge,
            version: Some(v.join(".")),
            base_chargee: charge,
            raison: (!charge).then(|| "Everything est lancé mais sa base n'est pas encore chargée.".into()),
        }
    }

    struct Fenetre(HWND);
    impl Drop for Fenetre {
        fn drop(&mut self) {
            unsafe { DestroyWindow(self.0) };
        }
    }

    fn fenetre_reponse() -> Result<Fenetre, String> {
        let classe = large("AETHRYON_INDEX_EVERYTHING");
        let inst = unsafe { GetModuleHandleW(std::ptr::null()) };
        let mut wc: WNDCLASSEXW = unsafe { std::mem::zeroed() };
        wc.cbSize = std::mem::size_of::<WNDCLASSEXW>() as u32;
        wc.lpfnWndProc = Some(procedure);
        wc.hInstance = inst;
        wc.lpszClassName = classe.as_ptr();
        unsafe { RegisterClassExW(&wc) }; // déjà enregistrée : sans effet
        let h = unsafe { CreateWindowExW(0, classe.as_ptr(), std::ptr::null(), 0, 0, 0, 0, 0, HWND_MESSAGE, std::ptr::null_mut(), inst, std::ptr::null()) };
        if h.is_null() {
            return Err(format!("Fenêtre de réponse impossible ({}).", std::io::Error::last_os_error()));
        }
        // Everything lancé en administrateur : ses réponses doivent passer le filtre de messages (UIPI).
        unsafe { ChangeWindowMessageFilterEx(h, WM_COPYDATA, MSGFLT_ALLOW, std::ptr::null_mut()) };
        Ok(Fenetre(h))
    }

    pub fn interroger(q: &str, decalage: u32, max: u32, annule: &AtomicBool, delai: Duration) -> Result<Reponse, String> {
        let ev = fenetre_everything().ok_or("Everything n'est plus lancé.")?;
        let f = fenetre_reponse()?;
        let id = 0x4145_0000 | (COMPTEUR.fetch_add(1, Ordering::Relaxed) & 0xFFFF);
        if let Ok(mut r) = REPONSE.lock() {
            *r = None;
        }
        let corps = requete(f.0 as usize as u32, id, decalage, max, q);
        let cds = COPYDATASTRUCT { dwData: COPYDATA_QUERY2W, cbData: corps.len() as u32, lpData: corps.as_ptr() as *mut core::ffi::c_void };
        let mut r = 0usize;
        let ok = unsafe { SendMessageTimeoutW(ev, WM_COPYDATA, f.0 as WPARAM, &cds as *const COPYDATASTRUCT as LPARAM, SMTO_ABORTIFHUNG, 5000, &mut r) };
        if ok == 0 || r == 0 {
            return Err("Everything n'a pas accepté la requête (version trop ancienne ou occupé).".into());
        }
        let limite = Instant::now() + delai;
        loop {
            let mut msg: MSG = unsafe { std::mem::zeroed() };
            while unsafe { PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) } != 0 {
                unsafe { DispatchMessageW(&msg) };
            }
            if let Some((rid, o)) = REPONSE.lock().ok().and_then(|mut r| r.take()) {
                if rid == id {
                    return decoder(&o);
                }
            }
            if annule.load(Ordering::Relaxed) {
                return Err("Scan annulé.".into());
            }
            if Instant::now() > limite {
                return Err("Everything ne répond pas.".into());
            }
            unsafe { MsgWaitForMultipleObjects(0, std::ptr::null(), 0, 50, QS_ALLINPUT) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn elements() -> Vec<ElementEverything> {
        vec![
            ElementEverything { chemin: "C:\\Médias\\Été 2024\\plage — côte.mp4".into(), dossier: false, taille: Some(845_654), cree_ms: Some(1_700_000_000_000), modifie_ms: Some(1_700_000_100_000), attributs: Some(0x20) },
            ElementEverything { chemin: "C:\\Médias\\Été 2024\\chant.flac".into(), dossier: false, taille: Some(12), cree_ms: None, modifie_ms: Some(1_600_000_000_000), attributs: Some(0x22) },
        ]
    }

    #[test]
    fn requete_query2_octet_par_octet() {
        let q = recherche("C:\\Médias", &["mp4".into(), "flac".into()]);
        assert_eq!(q, "file: ext:mp4;flac \"C:\\Médias\\\"");
        let b = requete(0x1234, 0x4145_0001, 10, 5000, &q);
        assert_eq!(&b[0..4], &0x1234u32.to_le_bytes());
        assert_eq!(&b[4..8], &0x4145_0001u32.to_le_bytes());
        assert_eq!(&b[8..12], &0u32.to_le_bytes(), "aucun drapeau de recherche (pas de casse, pas de regex)");
        assert_eq!(&b[12..16], &10u32.to_le_bytes());
        assert_eq!(&b[16..20], &5000u32.to_le_bytes());
        assert_eq!(&b[20..24], &DEMANDE.to_le_bytes());
        assert_eq!(&b[24..28], &TRI_CHEMIN.to_le_bytes());
        assert_eq!(b.len(), 28 + q.encode_utf16().count() * 2 + 2);
        assert_eq!(&b[b.len() - 2..], &[0, 0]);
    }

    #[test]
    fn reponse_list2_aller_retour() {
        let e = elements();
        let r = decoder(&encoder_reponse(7, 3, &e)).unwrap();
        assert_eq!((r.total, r.decalage), (7, 3));
        assert_eq!(r.elements, e);
        assert!(decoder(&[1, 0, 0]).is_err(), "réponse tronquée refusée");
        let mut b = encoder_reponse(1, 0, &e[..1]);
        b.truncate(b.len() - 10);
        assert!(decoder(&b).is_err());
    }
}

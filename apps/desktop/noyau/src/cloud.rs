//! AETHRYON Cloud dans le Desktop (section CLOUD, administrateur seulement) : lecture de la bibliothèque cloud, liens
//! temporaires, suppression, TÉLÉCHARGEMENT vers le dossier des médias et ENVOI d'un média local, par le cœur Rust.
//!
//! Règles :
//! - Toutes les requêtes vers account portent la clé « desktop » du coffre (jamais vue par l'interface) ; le serveur
//!   relit le rôle à chaque appel (403 pour un compte ordinaire) et contrôle le propriétaire de chaque objet.
//! - Envoi : empreintes SHA-256 + MD5 calculées ICI (progression réelle), réservation du quota
//!   (`POST /api/cloud/envois`), PUT DIRECT du fichier sur l'URL présignée (aucun octet ne passe par le VPS), en-têtes
//!   en liste fermée et exactement ceux signés, puis `…/confirmer` : « Sauvegardé » seulement si le serveur a vérifié
//!   l'objet (HEAD). Une coupure ou une annulation libère la réservation (`…/annuler`).
//! - Téléchargement : lien signé de 5 min, GET en flux vers `<nom>.part` réservé en exclusivité dans le dossier des
//!   médias, taille et SHA-256 comparés à l'objet, puis renommage SANS JAMAIS écraser (« Clip (2).mp4 »).
//! - HTTPS seulement, aucune redirection, réponses JSON bornées ; identifiants d'objets validés avant tout chemin.

use crate::compte::{self, GestionCompte, ReponseApi, Serveur};
use crate::flux;
use crate::noms;
use crate::reseau;
use base64::Engine;
use md5::{Digest as _, Md5};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Sha256;
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const BLOC: usize = 256 * 1024;
/// En-têtes qu'une URL d'envoi peut imposer (signés par account) : rien d'autre n'est envoyé au stockage.
const ENTETES_PERMIS: [&str; 5] = ["content-length", "content-type", "content-md5", "content-disposition", "x-amz-meta-sha256"];

/// Types acceptés par le cloud (extension → type MIME), MÊME table qu'account (`cloud/service.ts`, TYPES).
pub fn type_mime(nom: &str) -> Option<&'static str> {
    let ext = nom.rsplit_once('.')?.1.to_ascii_lowercase();
    Some(match ext.as_str() {
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "ogg" | "opus" => "audio/ogg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "gif" => "image/gif",
        _ => return None,
    })
}

pub fn id_valide(id: &str) -> bool {
    id.len() == 22 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

// ---- Données d'account -------------------------------------------------------------------------------------------

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Quota {
    pub max: u64,
    pub utilise: u64,
    pub reserve: u64,
    pub sauvegarde: u64,
    pub disponible: u64,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EtatCloud {
    pub actif: bool,
    pub quota: Quota,
    pub retention_jours: u32,
    pub taille_max_fichier: u64,
    pub sauvegarde_auto: bool,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ObjetCloud {
    pub id: String,
    pub nom: String,
    #[serde(rename = "type")]
    pub type_mime: String,
    pub taille: u64,
    pub statut: String,
    pub libelle: String,
    pub origine: String,
    pub plateforme: Option<String>,
    pub cree_le: String,
    pub envoye_le: Option<String>,
    pub expire_le: Option<String>,
    pub expire_dans_jours: Option<u32>,
    pub sha256: Option<String>,
    pub erreur: Option<String>,
    pub apercu: bool,
    /// Fiche musicale gardée À PART de l'audio (account : `meta.musique`) ; reste après l'expiration de l'audio.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub musique: Option<serde_json::Value>,
    /// Vrai seulement si l'audio est encore sauvegardé (« Sauvegardé ») ; faux après l'expiration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_disponible: Option<bool>,
    /// Réimport autorisé proposé quand l'audio a expiré ou n'a pas pu être sauvegardé.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reimport: Option<serde_json::Value>,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListeCloud {
    pub items: Vec<ObjetCloud>,
    pub total: u64,
    pub page: u32,
    pub taille_page: u32,
    pub quota: Option<Quota>,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Lien {
    pub url: String,
    pub expire_le: String,
    pub usage: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EnvoiSigne {
    pub url: String,
    pub methode: String,
    pub entetes: BTreeMap<String, String>,
    pub expire_le: String,
}

/// Refus d'account (ou du réseau, `statut` 0) : code machine et message lisible.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ErreurCloud {
    pub statut: u16,
    pub code: String,
    pub message: String,
}

impl std::fmt::Display for ErreurCloud {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

fn reseau_ko(m: String) -> ErreurCloud {
    ErreurCloud { statut: 0, code: "reseau".into(), message: m }
}

fn refus(r: &ReponseApi) -> ErreurCloud {
    let repli = match r.statut {
        401 => "La liaison d'AETHRYON Desktop n'est plus valable : reliez-le de nouveau (Paramètres › Compte).".to_string(),
        403 => "AETHRYON Cloud est réservé à l'administrateur.".to_string(),
        404 => "Fichier introuvable dans votre Cloud.".to_string(),
        s => format!("Le cloud répond {s}."),
    };
    ErreurCloud { statut: r.statut, code: r.code(), message: r.message(&repli) }
}

fn decoder<T: for<'de> Deserialize<'de>>(v: &Value) -> Result<T, ErreurCloud> {
    serde_json::from_value(v.clone()).map_err(|_| ErreurCloud { statut: 0, code: "reponse".into(), message: "Réponse inattendue du cloud.".into() })
}

/// Encodage d'un paramètre de requête (RFC 3986, caractères non réservés gardés).
fn encoder(s: &str) -> String {
    let mut o = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => o.push(b as char),
            _ => o.push_str(&format!("%{b:02X}")),
        }
    }
    o
}

/// Filtres de la bibliothèque cloud (valeurs contrôlées ici ET par account).
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Filtres {
    pub q: String,
    pub statut: String,
    #[serde(rename = "type")]
    pub type_media: String,
    pub tri: String,
    pub page: u32,
    /// Bibliothèque musicale du cloud (fiches expirées comprises) : `musique=1` (section MUSIQUE).
    pub musique: bool,
}

impl Filtres {
    fn requete(&self) -> Result<String, ErreurCloud> {
        let ko = |q: &str| Err(ErreurCloud { statut: 400, code: "invalid_request".into(), message: format!("Filtre refusé : {q}.") });
        if self.q.chars().count() > 100 {
            return ko("recherche trop longue");
        }
        if !["", "actifs", "en_attente", "envoi_en_cours", "sauvegarde", "echec", "suppression_en_attente", "expire", "envois"].contains(&self.statut.as_str()) {
            return ko("statut");
        }
        if !["", "video", "audio", "image"].contains(&self.type_media.as_str()) {
            return ko("type");
        }
        if !["", "recent", "expiration", "taille", "nom"].contains(&self.tri.as_str()) {
            return ko("tri");
        }
        let mut p = vec![format!("taillePage=100"), format!("page={}", self.page.clamp(1, 1000))];
        if self.musique {
            p.push("musique=1".into());
        }
        for (k, v) in [("q", &self.q), ("statut", &self.statut), ("type", &self.type_media), ("tri", &self.tri)] {
            if !v.is_empty() {
                p.push(format!("{k}={}", encoder(v)));
            }
        }
        Ok(p.join("&"))
    }
}

// ---- Appels à account (clé « desktop ») ----------------------------------------------------------------------------

pub struct Client<'a> {
    pub srv: &'a Serveur,
    pub cle: &'a str,
}

impl Client<'_> {
    fn appel(&self, methode: &str, chemin: &str, corps: Option<&Value>, attendu: u16) -> Result<Value, ErreurCloud> {
        let r = compte::appel(self.srv, methode, chemin, Some(self.cle), corps).map_err(reseau_ko)?;
        if r.statut != attendu {
            return Err(refus(&r));
        }
        Ok(r.json)
    }

    pub fn etat(&self) -> Result<EtatCloud, ErreurCloud> {
        decoder(&self.appel("GET", "/api/cloud/etat", None, 200)?)
    }

    pub fn lister(&self, f: &Filtres) -> Result<ListeCloud, ErreurCloud> {
        decoder(&self.appel("GET", &format!("/api/cloud/objets?{}", f.requete()?), None, 200)?)
    }

    fn verifier_id(id: &str) -> Result<(), ErreurCloud> {
        if id_valide(id) { Ok(()) } else { Err(ErreurCloud { statut: 400, code: "invalid_request".into(), message: "Identifiant de fichier invalide.".into() }) }
    }

    pub fn objet(&self, id: &str) -> Result<ObjetCloud, ErreurCloud> {
        Self::verifier_id(id)?;
        let v = self.appel("GET", &format!("/api/cloud/objets/{id}"), None, 200)?;
        decoder(&v["objet"])
    }

    pub fn lien(&self, id: &str, usage: &str) -> Result<Lien, ErreurCloud> {
        Self::verifier_id(id)?;
        if usage != "telecharger" && usage != "apercu" {
            return Err(ErreurCloud { statut: 400, code: "invalid_request".into(), message: "Usage du lien refusé.".into() });
        }
        let l: Lien = decoder(&self.appel("POST", &format!("/api/cloud/objets/{id}/lien"), Some(&json!({ "usage": usage })), 200)?)?;
        if !l.url.starts_with("https://") {
            return Err(ErreurCloud { statut: 0, code: "reponse".into(), message: "Lien refusé : HTTPS seulement.".into() });
        }
        Ok(l)
    }

    pub fn supprimer(&self, id: &str) -> Result<(ObjetCloud, Quota), ErreurCloud> {
        Self::verifier_id(id)?;
        let v = self.appel("POST", &format!("/api/cloud/objets/{id}/supprimer"), Some(&json!({})), 200)?;
        Ok((decoder(&v["objet"])?, decoder(&v["quota"])?))
    }

    pub fn reserver(&self, nom: &str, type_mime: &str, taille: u64, sha256: &str, md5: &str) -> Result<(ObjetCloud, EnvoiSigne), ErreurCloud> {
        let v = self.appel("POST", "/api/cloud/envois", Some(&json!({ "nom": nom, "type": type_mime, "taille": taille, "sha256": sha256, "md5": md5, "origine": "desktop" })), 201)?;
        Ok((decoder(&v["objet"])?, decoder(&v["envoi"])?))
    }

    pub fn confirmer(&self, id: &str) -> Result<(ObjetCloud, Quota), ErreurCloud> {
        Self::verifier_id(id)?;
        let v = self.appel("POST", &format!("/api/cloud/envois/{id}/confirmer"), Some(&json!({})), 200)?;
        Ok((decoder(&v["objet"])?, decoder(&v["quota"])?))
    }

    pub fn annuler(&self, id: &str) -> Result<(), ErreurCloud> {
        Self::verifier_id(id)?;
        self.appel("POST", &format!("/api/cloud/envois/{id}/annuler"), Some(&json!({})), 200).map(|_| ())
    }
}

// ---- Fichiers : empreintes, envoi direct, téléchargement ----------------------------------------------------------------

/// Échec d'une étape de transfert : code machine (affiché comme « erreur de synchronisation »), message lisible.
#[derive(Debug, Clone, PartialEq)]
pub struct ErreurTransfert {
    pub code: String,
    pub message: String,
}

fn et(code: &str, message: impl Into<String>) -> ErreurTransfert {
    ErreurTransfert { code: code.into(), message: message.into() }
}

impl From<ErreurCloud> for ErreurTransfert {
    fn from(e: ErreurCloud) -> Self {
        let code = if e.code.is_empty() { format!("http_{}", e.statut) } else { e.code };
        ErreurTransfert { code, message: e.message }
    }
}

/// SHA-256 (hexadécimal) et MD5 (base64) du fichier, lus en flux ; `avance(octets lus)`.
pub fn empreintes(chemin: &Path, taille: u64, annule: &AtomicBool, avance: &mut dyn FnMut(u64)) -> Result<(String, String), ErreurTransfert> {
    let mut f = fs::File::open(chemin).map_err(|e| et("lecture", format!("Lecture impossible ({}).", flux::raison_io(&e))))?;
    let (mut s, mut m) = (Sha256::new(), Md5::new());
    let mut tampon = vec![0u8; BLOC];
    let mut fait = 0u64;
    loop {
        if annule.load(Ordering::SeqCst) {
            return Err(et("annule", "Envoi annulé."));
        }
        let n = match f.read(&mut tampon) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(et("lecture", format!("Lecture interrompue ({}).", flux::raison_io(&e)))),
        };
        sha2::Digest::update(&mut s, &tampon[..n]);
        m.update(&tampon[..n]);
        fait += n as u64;
        avance(fait);
    }
    if fait != taille {
        return Err(et("fichier_modifie", "Le fichier a changé pendant la préparation : réessayez quand il sera terminé."));
    }
    let hex: String = sha2::Digest::finalize(s).iter().map(|b| format!("{b:02x}")).collect();
    Ok((hex, base64::engine::general_purpose::STANDARD.encode(m.finalize())))
}

/// Lecteur qui compte les octets, s'arrête sur annulation et ne dépasse jamais `taille`.
struct Lecteur<'a> {
    f: fs::File,
    fait: u64,
    taille: u64,
    annule: &'a AtomicBool,
    avance: &'a mut dyn FnMut(u64),
}

impl Read for Lecteur<'_> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.annule.load(Ordering::SeqCst) {
            return Err(io::Error::other("annulé"));
        }
        let reste = (self.taille - self.fait).min(buf.len() as u64) as usize;
        if reste == 0 {
            return Ok(0);
        }
        let n = self.f.read(&mut buf[..reste])?;
        self.fait += n as u64;
        (self.avance)(self.fait);
        Ok(n)
    }
}

/// Délai d'un transfert : au moins 10 min, et 256 Kio/s au pire (2 Go → 2 h 10).
fn delai_pour(taille: u64) -> Duration {
    Duration::from_secs((taille / (256 * 1024)).max(600))
}

/// PUT direct du fichier sur l'URL présignée, avec EXACTEMENT les en-têtes signés (liste fermée).
pub fn deposer(srv: &Serveur, e: &EnvoiSigne, chemin: &Path, taille: u64, annule: &AtomicBool, avance: &mut dyn FnMut(u64)) -> Result<(), ErreurTransfert> {
    if e.methode != "PUT" || !e.url.starts_with("https://") {
        return Err(et("reponse", "URL d'envoi refusée (HTTPS et PUT seulement)."));
    }
    if e.entetes.keys().any(|k| !ENTETES_PERMIS.contains(&k.as_str())) || e.entetes.get("content-length").map(|v| v.as_str()) != Some(taille.to_string().as_str()) {
        return Err(et("reponse", "En-têtes d'envoi inattendus : envoi refusé."));
    }
    let f = fs::File::open(chemin).map_err(|e| et("lecture", format!("Lecture impossible ({}).", flux::raison_io(&e))))?;
    if f.metadata().map(|m| m.len()).unwrap_or(0) != taille {
        return Err(et("fichier_modifie", "Le fichier a changé depuis sa préparation : réessayez."));
    }
    let a = reseau::agent(&srv.racines, delai_pour(taille));
    let mut req = a.put(&e.url);
    for (k, v) in &e.entetes {
        req = req.header(k.as_str(), v.as_str());
    }
    let mut lecteur = Lecteur { f, fait: 0, taille, annule, avance };
    let r = req.send(ureq::SendBody::from_reader(&mut lecteur));
    if annule.load(Ordering::SeqCst) {
        return Err(et("annule", "Envoi annulé."));
    }
    let rep = r.map_err(|x| et("envoi_interrompu", format!("Envoi interrompu : {}", reseau::message(&x))))?;
    match rep.status().as_u16() {
        200 | 201 | 204 => Ok(()),
        403 => Err(et("envoi_refuse", "Le stockage a refusé l'envoi (lien d'envoi expiré ou signature refusée).")),
        400 => Err(et("objet_invalide", "Le stockage a refusé le fichier (empreinte ou taille différente).")),
        s if s >= 500 => Err(et(&format!("http_{s}"), "Stockage cloud momentanément indisponible.")),
        s => Err(et(&format!("http_{s}"), format!("Le stockage répond {s}."))),
    }
}

/// Télécharge l'objet par son lien signé vers `dossier` : `<nom>.part` réservé en exclusivité, taille et SHA-256
/// vérifiés, renommage sans écrasement. Renvoie le chemin final.
pub fn telecharger_vers(srv: &Serveur, url: &str, o: &ObjetCloud, dossier: &Path, annule: &AtomicBool, avance: &mut dyn FnMut(u64)) -> Result<PathBuf, ErreurTransfert> {
    let propre = noms::nettoyer_nom_fichier(&o.nom);
    if propre.is_empty() {
        return Err(et("nom", "Nom de fichier inutilisable."));
    }
    fs::create_dir_all(dossier).map_err(|e| et("ecriture", format!("Dossier des médias inaccessible ({}).", flux::raison_io(&e))))?;
    let (mut final_, part, mut sortie, n) = flux::reserver(dossier, &propre, 1).map_err(|e| match e {
        flux::ErreurCopie::Annule => et("annule", "Téléchargement annulé."),
        flux::ErreurCopie::Echec(m) => et("ecriture", m),
    })?;
    let r = (|| -> Result<(), ErreurTransfert> {
        let a = reseau::agent(&srv.racines, delai_pour(o.taille));
        let mut rep = a.get(url).call().map_err(|x| et("telechargement_interrompu", format!("Téléchargement impossible : {}", reseau::message(&x))))?;
        match rep.status().as_u16() {
            200 => {}
            403 => return Err(et("lien_refuse", "Lien temporaire expiré ou refusé par le stockage : relancez le téléchargement.")),
            404 => return Err(et("objet_absent", "Fichier absent du stockage.")),
            s if (300..400).contains(&s) => return Err(et("reponse", "Redirection refusée.")),
            s => return Err(et(&format!("http_{s}"), format!("Le stockage répond {s}."))),
        }
        if rep.body().content_length().is_some_and(|n| n != o.taille) {
            return Err(et("taille", "Le stockage annonce une autre taille que celle du fichier."));
        }
        let mut lecteur = rep.body_mut().with_config().limit(o.taille.saturating_add(1)).reader();
        let mut s = Sha256::new();
        let mut tampon = vec![0u8; BLOC];
        let mut fait = 0u64;
        loop {
            if annule.load(Ordering::SeqCst) {
                return Err(et("annule", "Téléchargement annulé."));
            }
            let k = match lecteur.read(&mut tampon) {
                Ok(0) => break,
                Ok(k) => k,
                Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                Err(_) => return Err(et("telechargement_interrompu", "Téléchargement interrompu : connexion coupée.")),
            };
            sortie.write_all(&tampon[..k]).map_err(|e| et("ecriture", format!("Écriture interrompue ({}).", flux::raison_io(&e))))?;
            sha2::Digest::update(&mut s, &tampon[..k]);
            fait += k as u64;
            if fait > o.taille {
                return Err(et("taille", "Le stockage envoie plus d'octets que la taille du fichier."));
            }
            avance(fait);
        }
        if fait != o.taille {
            return Err(et("telechargement_interrompu", "Téléchargement interrompu : fichier incomplet."));
        }
        if let Some(attendu) = &o.sha256 {
            let hex: String = sha2::Digest::finalize(s).iter().map(|b| format!("{b:02x}")).collect();
            if &hex != attendu {
                return Err(et("empreinte", "Fichier reçu différent de celui du cloud (empreinte SHA-256) : rien n'est gardé."));
            }
        }
        sortie.sync_all().map_err(|e| et("ecriture", format!("Écriture non confirmée par le disque ({}).", flux::raison_io(&e))))?;
        Ok(())
    })();
    drop(sortie);
    if let Err(e) = r {
        let _ = fs::remove_file(&part);
        return Err(e);
    }
    let mut essai = n;
    for _ in 0..8 {
        match flux::renommer_avec_reessais(&part, &final_) {
            Ok(()) => return Ok(final_),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                essai += 1;
                final_ = dossier.join(flux::candidat(&propre, essai));
                while !flux::libre(&final_) && essai < n + 1000 {
                    essai += 1;
                    final_ = dossier.join(flux::candidat(&propre, essai));
                }
            }
            Err(e) => {
                let _ = fs::remove_file(&part);
                return Err(et("ecriture", format!("Renommage final impossible ({}).", flux::raison_io(&e))));
            }
        }
    }
    let _ = fs::remove_file(&part);
    Err(et("ecriture", "Renommage final impossible : noms occupés."))
}

// ---- Transferts suivis (file, progression réelle, annulation) ----------------------------------------------------------

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Sens {
    Envoi,
    Telechargement,
}

/// `attente` (en attente de sauvegarde, dans la file), `verification` (empreintes), `envoi`, `confirmation` (le
/// serveur vérifie l'objet), `telechargement`, puis `termine`, `echec` ou `annule`.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Etape {
    Attente,
    Verification,
    Envoi,
    Confirmation,
    Telechargement,
    Termine,
    Echec,
    Annule,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TransfertCloud {
    pub id: String,
    pub sens: Sens,
    pub media_id: Option<String>,
    pub objet_id: Option<String>,
    pub nom: String,
    pub taille: u64,
    pub etape: Etape,
    /// Octets traités dans l'étape en cours (empreintes, envoi ou téléchargement) : jamais estimés.
    pub fait: u64,
    pub total: u64,
    /// Statut final de l'objet côté serveur (`sauvegarde`, `en_attente`, `echec`).
    pub statut: Option<String>,
    pub code: Option<String>,
    pub message: Option<String>,
    /// Téléchargement : chemin final dans le dossier des médias.
    pub chemin: Option<String>,
    pub cree_le: String,
    pub fini_le: Option<String>,
}

/// Fichier local à envoyer (résolu par le service depuis l'index : jamais un chemin venu de l'interface).
#[derive(Clone, Debug)]
pub struct FichierLocal {
    pub media_id: Option<String>,
    pub chemin: PathBuf,
    pub nom: String,
    pub taille: u64,
}

enum Tache {
    Envoi(String, FichierLocal),
    Telechargement(String, ObjetCloud, PathBuf),
}

type Avis = Box<dyn Fn(&TransfertCloud) + Send + Sync>;

struct Interne {
    compte: Arc<GestionCompte>,
    liste: Mutex<Vec<TransfertCloud>>,
    annulations: Mutex<HashMap<String, Arc<AtomicBool>>>,
    envois: Mutex<VecDeque<Tache>>,
    telechargements: Mutex<VecDeque<Tache>>,
    fil_envois: AtomicBool,
    fil_telechargements: AtomicBool,
    compteur: AtomicU64,
    avis: Avis,
}

#[derive(Clone)]
pub struct Transferts {
    i: Arc<Interne>,
}

const GARDES: usize = 60;

fn horodatage() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

impl Transferts {
    pub fn new(compte: Arc<GestionCompte>, avis: Avis) -> Transferts {
        Transferts {
            i: Arc::new(Interne {
                compte,
                liste: Mutex::default(),
                annulations: Mutex::default(),
                envois: Mutex::default(),
                telechargements: Mutex::default(),
                fil_envois: AtomicBool::new(false),
                fil_telechargements: AtomicBool::new(false),
                compteur: AtomicU64::new(0),
                avis,
            }),
        }
    }

    pub fn liste(&self) -> Vec<TransfertCloud> {
        self.i.liste.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    fn nouveau(&self, sens: Sens, nom: &str, taille: u64, media_id: Option<String>, objet_id: Option<String>) -> TransfertCloud {
        let n = self.i.compteur.fetch_add(1, Ordering::SeqCst) + 1;
        let t = TransfertCloud {
            id: format!("{}-{n}", if sens == Sens::Envoi { "env" } else { "tel" }),
            sens,
            media_id,
            objet_id,
            nom: nom.into(),
            taille,
            etape: Etape::Attente,
            fait: 0,
            total: taille,
            statut: None,
            code: None,
            message: None,
            chemin: None,
            cree_le: horodatage(),
            fini_le: None,
        };
        {
            let mut l = self.i.liste.lock().unwrap_or_else(|e| e.into_inner());
            l.push(t.clone());
            // Seuls les transferts terminés les plus anciens sont oubliés.
            while l.len() > GARDES {
                match l.iter().position(|x| matches!(x.etape, Etape::Termine | Etape::Echec | Etape::Annule)) {
                    Some(p) => {
                        l.remove(p);
                    }
                    None => break,
                }
            }
        }
        self.i.annulations.lock().unwrap_or_else(|e| e.into_inner()).insert(t.id.clone(), Arc::new(AtomicBool::new(false)));
        (self.i.avis)(&t);
        t
    }

    /// Met les fichiers dans la file d'envoi (un envoi à la fois). Un type refusé par le cloud échoue tout de suite.
    pub fn envoyer(&self, fichiers: Vec<FichierLocal>) -> Vec<TransfertCloud> {
        let mut v = Vec::new();
        for f in fichiers {
            let t = self.nouveau(Sens::Envoi, &f.nom, f.taille, f.media_id.clone(), None);
            if type_mime(&f.nom).is_none() {
                v.push(self.i.finir(&t.id, Etape::Echec, Some("type_refuse"), "Type non accepté par le cloud : vidéo, audio ou GIF seulement."));
                continue;
            }
            self.i.envois.lock().unwrap_or_else(|e| e.into_inner()).push_back(Tache::Envoi(t.id.clone(), f));
            v.push(t);
        }
        self.i.clone().lancer(true);
        v
    }

    pub fn telecharger(&self, o: ObjetCloud, dossier: PathBuf) -> TransfertCloud {
        let t = self.nouveau(Sens::Telechargement, &o.nom, o.taille, None, Some(o.id.clone()));
        self.i.telechargements.lock().unwrap_or_else(|e| e.into_inner()).push_back(Tache::Telechargement(t.id.clone(), o, dossier));
        self.i.clone().lancer(false);
        t
    }

    /// Annule tout (déconnexion du compte) : files vidées, transferts en cours arrêtés.
    pub fn annuler_tout(&self) -> usize {
        let ids: Vec<String> = self.i.annulations.lock().unwrap_or_else(|e| e.into_inner()).keys().cloned().collect();
        ids.iter().filter(|id| self.annuler(id)).count()
    }

    /// Annule un transfert en attente ou en cours (la réservation d'un envoi est libérée).
    pub fn annuler(&self, id: &str) -> bool {
        let Some(a) = self.i.annulations.lock().unwrap_or_else(|e| e.into_inner()).get(id).cloned() else { return false };
        a.store(true, Ordering::SeqCst);
        // En attente dans une file : retiré tout de suite.
        for file in [&self.i.envois, &self.i.telechargements] {
            let mut f = file.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(p) = f.iter().position(|t| matches!(t, Tache::Envoi(x, _) | Tache::Telechargement(x, _, _) if x == id)) {
                f.remove(p);
                drop(f);
                self.i.finir(id, Etape::Annule, Some("annule"), "Annulé.");
                return true;
            }
        }
        true
    }
}

impl Interne {
    fn modifier(&self, id: &str, f: impl FnOnce(&mut TransfertCloud)) -> Option<TransfertCloud> {
        let t = {
            let mut l = self.liste.lock().unwrap_or_else(|e| e.into_inner());
            let t = l.iter_mut().find(|t| t.id == id)?;
            f(t);
            t.clone()
        };
        (self.avis)(&t);
        Some(t)
    }

    fn finir(&self, id: &str, etape: Etape, code: Option<&str>, message: &str) -> TransfertCloud {
        self.annulations.lock().unwrap_or_else(|e| e.into_inner()).remove(id);
        self.modifier(id, |t| {
            t.etape = etape;
            t.code = code.map(String::from);
            t.message = Some(message.into());
            t.fini_le = Some(horodatage());
        })
        .unwrap_or_else(|| panic!("transfert {id} inconnu"))
    }

    fn lancer(self: Arc<Self>, envoi: bool) {
        let drapeau = if envoi { &self.fil_envois } else { &self.fil_telechargements };
        if drapeau.swap(true, Ordering::SeqCst) {
            return;
        }
        std::thread::spawn(move || loop {
            let tache = if envoi { self.envois.lock() } else { self.telechargements.lock() }.unwrap_or_else(|e| e.into_inner()).pop_front();
            match tache {
                Some(Tache::Envoi(id, f)) => self.faire_envoi(&id, &f),
                Some(Tache::Telechargement(id, o, d)) => self.faire_telechargement(&id, &o, &d),
                None => {
                    let drapeau = if envoi { &self.fil_envois } else { &self.fil_telechargements };
                    drapeau.store(false, Ordering::SeqCst);
                    // Une tâche arrivée entre la file vide et le drapeau baissé : reprise.
                    let vide = if envoi { self.envois.lock() } else { self.telechargements.lock() }.unwrap_or_else(|e| e.into_inner()).is_empty();
                    if vide || drapeau.swap(true, Ordering::SeqCst) {
                        return;
                    }
                }
            }
        });
    }

    /// Progression réelle, publiée au plus toutes les 120 ms (et toujours à la fin de l'étape).
    fn progression<'a>(&'a self, id: &'a str, etape: Etape, total: u64) -> impl FnMut(u64) + 'a {
        let mut dernier = Instant::now() - Duration::from_secs(1);
        self.modifier(id, |t| {
            t.etape = etape;
            t.fait = 0;
            t.total = total;
        });
        move |fait| {
            if fait >= total || dernier.elapsed() >= Duration::from_millis(120) {
                dernier = Instant::now();
                self.modifier(id, |t| t.fait = fait);
            }
        }
    }

    fn cle(&self) -> Result<String, ErreurTransfert> {
        self.compte.cle().ok_or_else(|| et("non_relie", "AETHRYON Desktop n'est pas relié au compte (Paramètres › Compte)."))
    }

    fn faire_envoi(&self, id: &str, f: &FichierLocal) {
        let Some(annule) = self.annulations.lock().unwrap_or_else(|e| e.into_inner()).get(id).cloned() else { return };
        let mut objet: Option<String> = None;
        let r = (|| -> Result<(ObjetCloud, Quota), ErreurTransfert> {
            let cle = self.cle()?;
            let c = Client { srv: self.compte.serveur(), cle: &cle };
            let ty = type_mime(&f.nom).ok_or_else(|| et("type_refuse", "Type non accepté par le cloud."))?;
            let (sha, md5) = empreintes(&f.chemin, f.taille, &annule, &mut self.progression(id, Etape::Verification, f.taille))?;
            let (o, envoi) = c.reserver(&f.nom, ty, f.taille, &sha, &md5)?;
            objet = Some(o.id.clone());
            self.modifier(id, |t| t.objet_id = Some(o.id.clone()));
            deposer(c.srv, &envoi, &f.chemin, f.taille, &annule, &mut self.progression(id, Etape::Envoi, f.taille))?;
            self.modifier(id, |t| {
                t.etape = Etape::Confirmation;
                t.fait = 0;
                t.total = 0;
            });
            Ok(c.confirmer(&o.id)?)
        })();
        match r {
            Ok((o, _)) => {
                let (etape, msg) = match o.statut.as_str() {
                    "sauvegarde" => (Etape::Termine, match o.expire_dans_jours {
                        Some(j) => format!("Sauvegardé · expire dans {j} jours"),
                        None => "Sauvegardé".into(),
                    }),
                    "en_attente" => (Etape::Termine, "En attente de sauvegarde : le serveur vérifiera le fichier plus tard.".into()),
                    _ => (Etape::Echec, o.erreur.clone().map(|e| format!("Échec de sauvegarde ({e}).")).unwrap_or_else(|| "Échec de sauvegarde.".into())),
                };
                let code = if etape == Etape::Echec { o.erreur.clone() } else { None };
                self.modifier(id, |t| t.statut = Some(o.statut.clone()));
                self.finir(id, etape, code.as_deref(), &msg);
                crate::journal::info("cloud", &format!("Envoi {id} : {}", o.statut));
            }
            Err(e) => {
                // Réservation libérée (best effort) : une coupure ne garde pas de place dans le quota.
                if let (Some(oid), Ok(cle)) = (&objet, self.cle()) {
                    let _ = Client { srv: self.compte.serveur(), cle: &cle }.annuler(oid);
                }
                if e.code == "token_revoked" || e.code == "invalid_token" || e.code == "token_expired" {
                    self.compte.rafraichir();
                }
                let etape = if e.code == "annule" { Etape::Annule } else { Etape::Echec };
                self.finir(id, etape, Some(&e.code), &e.message);
                crate::journal::avert("cloud", &format!("Envoi {id} : {}", e.code));
            }
        }
    }

    fn faire_telechargement(&self, id: &str, o: &ObjetCloud, dossier: &Path) {
        let Some(annule) = self.annulations.lock().unwrap_or_else(|e| e.into_inner()).get(id).cloned() else { return };
        let r = (|| -> Result<PathBuf, ErreurTransfert> {
            let cle = self.cle()?;
            let c = Client { srv: self.compte.serveur(), cle: &cle };
            let l = c.lien(&o.id, "telecharger")?;
            telecharger_vers(c.srv, &l.url, o, dossier, &annule, &mut self.progression(id, Etape::Telechargement, o.taille))
        })();
        match r {
            Ok(p) => {
                let nom = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                self.modifier(id, |t| t.chemin = Some(p.to_string_lossy().into_owned()));
                self.finir(id, Etape::Termine, None, &format!("Téléchargé dans le dossier des médias : {nom}"));
                crate::journal::info("cloud", &format!("Téléchargement {id} terminé."));
            }
            Err(e) => {
                let etape = if e.code == "annule" { Etape::Annule } else { Etape::Echec };
                self.finir(id, etape, Some(&e.code), &e.message);
                crate::journal::avert("cloud", &format!("Téléchargement {id} : {}", e.code));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::coffre::{Coffre, Liaison};
    use crate::essais_http::{Reponse, Requete, Serveur as Banc};
    use std::sync::atomic::AtomicUsize;

    const CLE: &str = "ytc_AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEfGhIjKlMnOpQrStUvWxYzAbCdEfGhIjKl";
    const OID: &str = "AbCdEfGhIjKlMnOpQrStUv";

    fn md5b64(b: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(Md5::digest(b))
    }
    fn sha(b: &[u8]) -> String {
        sha2::Sha256::digest(b).iter().map(|x| format!("{x:02x}")).collect()
    }

    fn objet(statut: &str, taille: u64, sha256: Option<String>) -> Value {
        json!({ "id": OID, "nom": "Plan large — été.mp4", "type": "video/mp4", "taille": taille, "statut": statut, "libelle": "x", "origine": "desktop",
            "plateforme": null, "creeLe": "2026-10-23T10:00:00.000Z", "envoyeLe": null, "expireLe": "2026-11-22T10:00:00.000Z", "expireDansJours": 30,
            "sha256": sha256, "erreur": null, "apercu": true })
    }
    fn quota() -> Value {
        json!({ "max": 9000, "utilise": 100, "reserve": 0, "sauvegarde": 100, "disponible": 8900, "global": { "max": 9000, "utilise": 100, "ecart": 0 } })
    }

    struct Monde {
        banc: Banc,
        dossier: tempfile::TempDir,
        compte: Arc<GestionCompte>,
        avis: Arc<Mutex<Vec<TransfertCloud>>>,
        t: Transferts,
    }

    fn monde(g: impl Fn(&Requete, &str) -> Reponse + Send + Sync + 'static) -> Monde {
        let base: Arc<Mutex<String>> = Arc::default();
        let b2 = base.clone();
        let banc = Banc::demarrer(move |r| {
            if r.chemin().starts_with("/api/") {
                assert_eq!(r.entete("authorization"), Some(format!("Bearer {CLE}").as_str()), "clé « desktop » sur chaque appel");
                assert!(r.entete("origin").is_none());
            }
            g(r, &b2.lock().unwrap())
        });
        *base.lock().unwrap() = banc.base.clone();
        let dossier = tempfile::tempdir().unwrap();
        let coffre = Coffre::sous(dossier.path());
        coffre.ecrire(&Liaison { cle: CLE.into(), expire_le: None, email: "admin@example.test".into(), nom: "Admin".into(), relie_le: "x".into() }).unwrap();
        let compte = GestionCompte::new(Serveur::essai(&banc.base, banc.autorite.clone()), coffre, "PC".into(), "1".into(), Box::new(|_| {}), Box::new(|_| Ok(())));
        let avis: Arc<Mutex<Vec<TransfertCloud>>> = Arc::default();
        let a2 = avis.clone();
        let t = Transferts::new(compte.clone(), Box::new(move |x| a2.lock().unwrap().push(x.clone())));
        Monde { banc, dossier, compte, avis, t }
    }

    fn fini(t: &Transferts, id: &str) -> TransfertCloud {
        let d = Instant::now();
        loop {
            let x = t.liste().into_iter().find(|x| x.id == id).unwrap();
            if matches!(x.etape, Etape::Termine | Etape::Echec | Etape::Annule) {
                return x;
            }
            assert!(d.elapsed() < Duration::from_secs(20), "transfert jamais terminé : {x:?}");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn fichier(m: &Monde, nom: &str, octets: &[u8]) -> FichierLocal {
        let p = m.dossier.path().join(nom);
        fs::write(&p, octets).unwrap();
        FichierLocal { media_id: Some("m".repeat(40)), chemin: p, nom: nom.into(), taille: octets.len() as u64 }
    }

    /// account + stockage : réservation, PUT vérifié (en-têtes signés, octets, MD5), confirmation.
    fn serveur_envoi(recu: Arc<Mutex<Vec<u8>>>, statut_put: u16) -> impl Fn(&Requete, &str) -> Reponse + Send + Sync {
        move |r, base| match (r.methode.as_str(), r.chemin()) {
            ("POST", "/api/cloud/envois") => {
                let j = r.json();
                assert_eq!(j["origine"], "desktop");
                assert_eq!(j["type"], "video/mp4");
                let taille = j["taille"].as_u64().unwrap();
                Reponse::Json(201, json!({ "objet": objet("envoi_en_cours", taille, j["sha256"].as_str().map(String::from)), "envoi": {
                    "url": format!("{base}/seau/aethryon-cloud/v1/x/{OID}?X-Amz-Signature=abc"), "methode": "PUT", "expireLe": "2026-10-23T10:15:00.000Z",
                    "entetes": { "content-length": taille.to_string(), "content-type": "video/mp4", "content-md5": j["md5"], "content-disposition": "attachment; filename=\"Plan large - ete.mp4\"", "x-amz-meta-sha256": j["sha256"] } } }))
            }
            ("PUT", p) if p.starts_with("/seau/") => {
                assert!(r.entete("authorization").is_none(), "aucune clé vers le stockage");
                assert_eq!(r.entete("content-md5").unwrap(), md5b64(&r.corps), "MD5 signé = octets envoyés");
                assert_eq!(r.entete("x-amz-meta-sha256").unwrap(), sha(&r.corps));
                assert!(r.entete("transfer-encoding").is_none(), "longueur fixe (exigée par S3), jamais « chunked »");
                *recu.lock().unwrap() = r.corps.clone();
                Reponse::Json(statut_put, Value::Null)
            }
            ("POST", p) if p.ends_with("/confirmer") => Reponse::Json(200, json!({ "objet": objet("sauvegarde", recu.lock().unwrap().len() as u64, None), "quota": quota() })),
            ("POST", p) if p.ends_with("/annuler") => Reponse::Json(200, json!({ "objet": objet("echec", 1, None), "quota": quota() })),
            _ => Reponse::Json(404, json!({ "error": "not_found", "message": "?" })),
        }
    }

    #[test]
    fn envoi_reussi_direct_vers_le_stockage() {
        let recu: Arc<Mutex<Vec<u8>>> = Arc::default();
        let m = monde(serveur_envoi(recu.clone(), 200));
        let octets: Vec<u8> = (0..700_000u32).map(|i| (i * 7 % 251) as u8).collect();
        let v = m.t.envoyer(vec![fichier(&m, "Plan large — été.mp4", &octets)]);
        let x = fini(&m.t, &v[0].id);
        assert_eq!((x.etape, x.statut.as_deref()), (Etape::Termine, Some("sauvegarde")), "{x:?}");
        assert_eq!(x.message.as_deref(), Some("Sauvegardé · expire dans 30 jours"));
        assert_eq!(*recu.lock().unwrap(), octets, "octets identiques chez le stockage");
        // Progression RÉELLE : préparation puis envoi, croissante, jusqu'au total exact ; « confirmation » avant la fin.
        let a = m.avis.lock().unwrap();
        let envoi: Vec<u64> = a.iter().filter(|t| t.etape == Etape::Envoi).map(|t| t.fait).collect();
        assert!(envoi.windows(2).all(|w| w[0] <= w[1]) && envoi.last() == Some(&(octets.len() as u64)), "{envoi:?}");
        assert!(a.iter().any(|t| t.etape == Etape::Verification && t.fait == octets.len() as u64));
        let i_conf = a.iter().position(|t| t.etape == Etape::Confirmation).unwrap();
        assert!(a[..i_conf].iter().all(|t| t.statut.is_none()), "« Sauvegardé » jamais avant la confirmation du serveur");
        // Aucune clé ni URL signée dans les états remis à l'interface.
        assert!(a.iter().all(|t| !serde_json::to_string(t).unwrap().contains("ytc_") && !serde_json::to_string(t).unwrap().contains("Signature")));
        assert_eq!(m.banc.vues("POST", "/api/cloud/envois").iter().filter(|r| r.chemin() == "/api/cloud/envois").count(), 1, "une seule réservation");
    }

    #[test]
    fn envoi_interrompu_libere_la_reservation() {
        let recu: Arc<Mutex<Vec<u8>>> = Arc::default();
        let m = monde(serveur_envoi(recu, 200));
        *m.banc.couper_apres.lock().unwrap() = Some(100_000);
        let octets = vec![7u8; 900_000];
        let v = m.t.envoyer(vec![fichier(&m, "Coupe.mp4", &octets)]);
        let x = fini(&m.t, &v[0].id);
        assert_eq!((x.etape, x.code.as_deref()), (Etape::Echec, Some("envoi_interrompu")), "{x:?}");
        assert!(x.statut.is_none(), "jamais « Sauvegardé »");
        assert_eq!(m.banc.vues("POST", "/api/cloud/envois/").iter().filter(|r| r.chemin().ends_with("/annuler")).count(), 1, "réservation libérée");
        assert_eq!(m.banc.vues("POST", "/api/cloud/envois/").iter().filter(|r| r.chemin().ends_with("/confirmer")).count(), 0);
        assert!(m.banc.vues("PUT", "/seau/").iter().all(|r| r.incomplet), "le stockage n'a reçu qu'un envoi incomplet");
    }

    #[test]
    fn refus_du_serveur_trop_gros_quota_doublon_et_lien_expire() {
        for (statut, code, message) in [
            (413, "fichier_trop_volumineux", "Fichier trop volumineux pour le cloud : 2,0 Go au plus par fichier."),
            (409, "quota_atteint", "Espace cloud insuffisant : 0,1 Go libres sur 9,0 Go, il en faut 0,9 Go."),
            (409, "deja_dans_le_cloud", "Ce fichier est déjà sauvegardé dans ton cloud : aucune seconde copie n'est envoyée."),
            (403, "forbidden", "AETHRYON Cloud est réservé à l'administrateur."),
        ] {
            let m = monde(move |r, _| match r.chemin() {
                "/api/cloud/envois" => Reponse::Json(statut, json!({ "error": code, "message": message })),
                _ => Reponse::Json(404, Value::Null),
            });
            let v = m.t.envoyer(vec![fichier(&m, "Gros.mp4", b"0123456789")]);
            let x = fini(&m.t, &v[0].id);
            assert_eq!((x.etape, x.code.as_deref(), x.message.as_deref()), (Etape::Echec, Some(code), Some(message)));
            assert!(m.banc.vues("PUT", "/").is_empty(), "rien n'est envoyé au stockage");
        }
        // Lien d'envoi expiré (403 du stockage) : échec lisible, réservation libérée.
        let m = monde(serveur_envoi(Arc::default(), 403));
        let v = m.t.envoyer(vec![fichier(&m, "Expire.mp4", b"abcdef")]);
        let x = fini(&m.t, &v[0].id);
        assert_eq!(x.code.as_deref(), Some("envoi_refuse"));
        // Type refusé : aucun appel.
        let v = m.t.envoyer(vec![fichier(&m, "Photo.png", b"png")]);
        assert_eq!((v[0].etape, v[0].code.as_deref()), (Etape::Echec, Some("type_refuse")));
    }

    #[test]
    fn telechargement_sans_ecrasement_verifie_et_annulable() {
        let octets: Vec<u8> = (0..300_000u32).map(|i| (i % 253) as u8).collect();
        let s = sha(&octets);
        let o2 = octets.clone();
        let lent = Arc::new(AtomicBool::new(false));
        let coupe = Arc::new(AtomicBool::new(false));
        let (l2, c2) = (lent.clone(), coupe.clone());
        let m = monde(move |r, base| match (r.methode.as_str(), r.chemin()) {
            ("POST", p) if p.ends_with("/lien") => Reponse::Json(200, json!({ "url": format!("{base}/seau/obj?X-Amz-Signature=x"), "expireLe": "2026-10-23T10:05:00.000Z", "usage": "telecharger" })),
            ("GET", "/seau/obj") if c2.load(Ordering::SeqCst) => Reponse::Coupee(o2[..1000].to_vec(), o2.len() as u64),
            ("GET", "/seau/obj") if l2.load(Ordering::SeqCst) => Reponse::Lente(o2.clone(), 4096, Duration::from_millis(30)),
            ("GET", "/seau/obj") => Reponse::Octets(200, o2.clone(), "video/mp4"),
            _ => Reponse::Json(404, Value::Null),
        });
        let medias = m.dossier.path().join("Vidéos");
        fs::create_dir_all(&medias).unwrap();
        fs::write(medias.join("Plan large — été.mp4"), b"copie locale a garder").unwrap();
        let o: ObjetCloud = serde_json::from_value(objet("sauvegarde", octets.len() as u64, Some(s.clone()))).unwrap();
        let x = fini(&m.t, &m.t.telecharger(o.clone(), medias.clone()).id);
        assert_eq!(x.etape, Etape::Termine, "{x:?}");
        let chemin = PathBuf::from(x.chemin.unwrap());
        assert_eq!(chemin.file_name().unwrap(), "Plan large — été (2).mp4", "jamais d'écrasement");
        assert_eq!(fs::read(&chemin).unwrap(), octets);
        assert_eq!(fs::read(medias.join("Plan large — été.mp4")).unwrap(), b"copie locale a garder");
        // Empreinte différente : rien n'est gardé.
        let faux = ObjetCloud { sha256: Some("0".repeat(64)), ..o.clone() };
        let x = fini(&m.t, &m.t.telecharger(faux, medias.clone()).id);
        assert_eq!(x.code.as_deref(), Some("empreinte"));
        // Connexion coupée en plein corps : « téléchargement interrompu », rien n'est gardé.
        coupe.store(true, Ordering::SeqCst);
        let x = fini(&m.t, &m.t.telecharger(o.clone(), medias.clone()).id);
        assert_eq!(x.code.as_deref(), Some("telechargement_interrompu"), "{x:?}");
        coupe.store(false, Ordering::SeqCst);
        // Annulation pendant un téléchargement lent : `.part` retiré.
        lent.store(true, Ordering::SeqCst);
        let t = m.t.telecharger(o, medias.clone());
        std::thread::sleep(Duration::from_millis(300));
        assert!(m.t.annuler(&t.id));
        let x = fini(&m.t, &t.id);
        assert_eq!(x.etape, Etape::Annule);
        let noms: Vec<String> = fs::read_dir(&medias).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        assert!(!noms.iter().any(|n| n.ends_with(".part")), "aucun .part laissé : {noms:?}");
        assert_eq!(noms.len(), 2);
        assert!(m.avis.lock().unwrap().iter().filter(|t| t.etape == Etape::Telechargement).all(|t| t.fait <= t.total));
    }

    #[test]
    fn lien_expire_et_cle_revoquee() {
        let n = Arc::new(AtomicUsize::new(0));
        let n2 = n.clone();
        let m = monde(move |r, base| match (r.methode.as_str(), r.chemin()) {
            ("POST", p) if p.ends_with("/lien") => Reponse::Json(200, json!({ "url": format!("{base}/seau/expire?X-Amz-Signature=x"), "expireLe": "2026-10-23T10:05:00.000Z", "usage": "telecharger" })),
            ("GET", "/seau/expire") => Reponse::Octets(403, b"<Error><Code>AccessDenied</Code></Error>".to_vec(), "application/xml"),
            ("GET", "/api/cloud/etat") => {
                n2.fetch_add(1, Ordering::SeqCst);
                Reponse::Json(401, json!({ "error": "token_revoked", "message": "Liaison d'AETHRYON Desktop révoquée ou expirée : reliez-le de nouveau (Paramètres › Compte)." }))
            }
            ("GET", "/api/desktop/moi") => Reponse::Json(401, json!({ "error": "token_revoked", "message": "révoquée" })),
            _ => Reponse::Json(404, Value::Null),
        });
        let o: ObjetCloud = serde_json::from_value(objet("sauvegarde", 10, None)).unwrap();
        let x = fini(&m.t, &m.t.telecharger(o, m.dossier.path().to_path_buf()).id);
        assert_eq!(x.code.as_deref(), Some("lien_refuse"), "{x:?}");
        let cle = m.compte.cle().unwrap();
        let e = Client { srv: m.compte.serveur(), cle: &cle }.etat().unwrap_err();
        assert_eq!((e.statut, e.code.as_str()), (401, "token_revoked"));
        // Identifiants et filtres contrôlés AVANT tout appel.
        let c = Client { srv: m.compte.serveur(), cle: &cle };
        assert_eq!(c.lien("../../etc", "telecharger").unwrap_err().code, "invalid_request");
        assert_eq!(c.lister(&Filtres { statut: "tout".into(), ..Filtres::default() }).unwrap_err().code, "invalid_request");
        assert!(m.banc.vues("POST", "/api/cloud/objets/..").is_empty());
        assert_eq!(Filtres { q: "été & co".into(), statut: "sauvegarde".into(), type_media: "audio".into(), tri: "nom".into(), page: 2, musique: false }.requete().unwrap(), "taillePage=100&page=2&q=%C3%A9t%C3%A9%20%26%20co&statut=sauvegarde&type=audio&tri=nom");
        assert_eq!(Filtres { musique: true, ..Filtres::default() }.requete().unwrap(), "taillePage=100&page=1&musique=1");
        assert_eq!(n.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn types_du_cloud() {
        for (n, t) in [("a.MP4", Some("video/mp4")), ("b.m4a", Some("audio/mp4")), ("c.opus", Some("audio/ogg")), ("d.gif", Some("image/gif")), ("e.png", None), ("sans", None)] {
            assert_eq!(type_mime(n), t, "{n}");
        }
        assert!(id_valide(OID) && !id_valide("court") && !id_valide("AbCdEfGhIjKlMnOpQrSt/v"));
    }
}

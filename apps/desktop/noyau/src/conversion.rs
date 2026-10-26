//! Conversion d'un lien par ytapi avec la clé « desktop » du compte relié (3.8.1) : « Coller un lien » de l'Accueil, et
//! « Envoyer vers › Premiere Pro » de l'extension, relayé par l'hôte Native Messaging (contrat §12, proposé).
//!
//! 1. `POST <api>/jobs?wait=0` : lien de la PAGE de la vidéo, format, extrait éventuel (`startMs`/`endMs`) ; MP4 en
//!    1080p avec `transcode` (H.264 + AAC garanti par ytapi, comme l'extension pour Premiere) ; un compte occupé
//!    (429 `active_job_limit`) attend son tour, sans consommer de quota ;
//! 2. suivi `GET <api>/jobs/<id>?wait=20&change=true` : progression RÉELLE du serveur, jamais inventée ;
//! 3. fichier : `GET <file_url>` (même origine et chemin de CE travail seulement) vers `<nom>.part` réservé en
//!    exclusivité dans le dossier des médias, taille vérifiée, puis renommage SANS JAMAIS écraser (« Clip (2).mp4 »).
//!
//! Nocturne : chaque conversion a un [`Pilote`] (écran Transferts). « Annuler » arrête à toute étape (le travail est
//! supprimé du serveur pendant la conversion, le `.part` est effacé). « Pause » ne vaut que pendant la RÉCEPTION du
//! fichier (la conversion a lieu sur le serveur) : la connexion est fermée, le `.part` gardé ; « Reprendre » redemande
//! la suite par `Range: bytes=<reçus>-` et n'accepte qu'un `206` dont `Content-Range` commence exactement là ; un
//! serveur qui ignore la plage (`200`) fait repartir de zéro (fichier tronqué, rien de mélangé). Le débit est MESURÉ
//! sur les dernières secondes reçues, jamais estimé.
//!
//! La clé ne voyage que dans `Authorization` (jamais dans une adresse) ; mêmes quotas et refus que l'extension (account,
//! internal.ts). HTTPS seulement, aucune redirection, réponses JSON bornées, adresse d'ytapi figée en production.

use crate::reseau::{self, Racines};
use crate::{flux, noms};
use serde_json::{json, Value};
use std::fs;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// ytapi (même adresse que l'extension, `extension/scripts/build.mjs`), figée.
pub const API_PRODUCTION: &str = "https://api.malvu.fr/media";
pub const URL_MAX: usize = 2048;
/// Extrait : 6 h au plus (ytapi valide de toute façon les bornes).
pub const EXTRAIT_MAX_MS: u64 = 6 * 3600 * 1000;
const JSON_MAX: u64 = 256 * 1024;
const FICHIER_MAX: u64 = 3 * 1024 * 1024 * 1024;
/// Domaines acceptés (ceux d'ytapi, `ALLOWED_DOMAINS`) et plateforme du contrat.
const DOMAINES: [(&str, &str); 6] =
    [("youtube.com", "youtube"), ("youtu.be", "youtube"), ("youtube-nocookie.com", "youtube"), ("tiktok.com", "tiktok"), ("twitter.com", "x"), ("x.com", "x")];
#[cfg(not(test))]
const PAUSE: Duration = Duration::from_millis(1000);
#[cfg(test)]
const PAUSE: Duration = Duration::from_millis(10);
/// Compte occupé : attente de son tour, 15 minutes au plus.
const OCCUPE_MAX: Duration = Duration::from_secs(15 * 60);
const SUIVI_MAX: Duration = Duration::from_secs(2 * 3600);

pub const TEXTE_NON_RELIE: &str = "AETHRYON Desktop n'est pas relié à ton compte : ouvre AETHRYON Desktop › Paramètres › Compte, puis relance.";
const TEXTE_CLE_REFUSEE: &str = "La clé d'AETHRYON Desktop a été refusée (révoquée ou expirée) : relie-le de nouveau dans Paramètres › Compte.";
const TEXTE_LIEN: &str = "Lien non pris en charge : colle le lien d'une vidéo YouTube, TikTok ou X.";

/// ytapi : base HTTPS et autorités de confiance.
#[derive(Clone, Debug)]
pub struct Api {
    pub(crate) base: String,
    pub(crate) racines: Racines,
}

impl Api {
    pub fn production() -> Api {
        Api { base: API_PRODUCTION.into(), racines: Racines::Mozilla }
    }
    #[cfg(any(test, feature = "essais"))]
    pub fn essai(base: &str, autorite_der: Vec<u8>) -> Api {
        Api { base: base.trim_end_matches('/').into(), racines: Racines::Essai(autorite_der) }
    }
}

/// Une conversion demandée.
#[derive(Clone, Debug, PartialEq)]
pub struct Demande {
    /// Identifiant du transfert (`R\transferts\<id>.json`).
    pub id: String,
    /// Lien de la PAGE de la vidéo, déjà passé par [`valider_url`].
    pub url: String,
    /// `mp4` ou `mp3`.
    pub format: String,
    /// Extrait (début, fin) en millisecondes.
    pub extrait: Option<(u64, u64)>,
    pub titre: Option<String>,
    /// `desktop` (« Coller un lien ») ou `extension` (relais Native Messaging).
    pub origine: String,
    /// Import dans Premiere Pro une fois le fichier dans la bibliothèque (relais de l'extension).
    pub premiere: bool,
}

/// Commandes de l'utilisateur sur UNE conversion en cours (écran Transferts).
#[derive(Debug, Default)]
pub struct Pilote {
    annule: AtomicBool,
    pause: AtomicBool,
}

impl Pilote {
    /// Arrête la conversion à l'étape où elle est (effet au plus tard une seconde après).
    pub fn annuler(&self) {
        self.annule.store(true, Ordering::SeqCst);
    }
    /// Pause (vrai) ou reprise (faux) de la réception du fichier.
    pub fn mettre_en_pause(&self, oui: bool) {
        self.pause.store(oui, Ordering::SeqCst);
    }
    pub fn annule(&self) -> bool {
        self.annule.load(Ordering::SeqCst)
    }
    pub fn en_pause(&self) -> bool {
        self.pause.load(Ordering::SeqCst)
    }
}

/// Débit mesuré : octets reçus sur les trois dernières secondes (au moins une demi-seconde d'observation).
#[derive(Default)]
struct Debit {
    points: std::collections::VecDeque<(Instant, u64)>,
}

impl Debit {
    fn noter(&mut self, fait: u64) -> Option<u64> {
        let t = Instant::now();
        self.points.push_back((t, fait));
        while self.points.len() > 2 && self.points.front().is_some_and(|(a, _)| t.duration_since(*a) > Duration::from_secs(3)) {
            self.points.pop_front();
        }
        let (a, f0) = *self.points.front()?;
        let duree = t.duration_since(a).as_secs_f64();
        (duree >= 0.5 && fait >= f0).then(|| ((fait - f0) as f64 / duree).round() as u64)
    }
    fn oublier(&mut self) {
        self.points.clear();
    }
}

/// Avancement réel, remis au fil de l'eau.
#[derive(Clone, Debug, PartialEq)]
pub enum Avancee {
    /// En file sur le serveur, ou compte occupé (il attend son tour).
    Attente,
    /// Conversion sur le serveur ; progression de 0 à 1 seulement si le serveur la mesure.
    Conversion(Option<f64>),
    /// Titre donné par le serveur.
    Titre(String),
    /// Fichier en cours de réception : nom final prévu, octets reçus, total annoncé, débit mesuré (octets par seconde).
    Telechargement { nom: String, recus: u64, total: Option<u64>, vitesse: Option<u64> },
    /// Réception en pause (demandée par l'utilisateur) : connexion fermée, octets reçus gardés.
    Pause { nom: String, recus: u64, total: Option<u64> },
}

#[derive(Clone, Debug, PartialEq)]
pub struct Echec {
    pub code: String,
    pub message: String,
}

fn echec(code: &str, message: impl Into<String>) -> Echec {
    Echec { code: code.into(), message: message.into() }
}

fn plateforme_hote(hote: &str) -> Option<&'static str> {
    DOMAINES.iter().find(|(d, _)| hote == *d || hote.strip_suffix(d).is_some_and(|r| r.ends_with('.') && r.len() > 1)).map(|(_, p)| *p)
}

/// Lien de la page d'une vidéo YouTube, TikTok ou X : HTTPS (un lien sans schéma ou en HTTP est réécrit), sans
/// identifiants ni port inhabituel, 2 048 caractères au plus, fragment retiré. Le message de refus ne répète jamais le
/// lien. ytapi revalide tout.
pub fn valider_url(brut: &str) -> Result<String, String> {
    let t = brut.trim();
    if t.is_empty() {
        return Err("Colle d'abord le lien d'une vidéo.".into());
    }
    if t.len() > URL_MAX || t.chars().any(|c| c.is_whitespace() || c.is_control() || c == '\\') {
        return Err(TEXTE_LIEN.into());
    }
    let (schema, reste) = match t.split_once("://") {
        Some((s, r)) if s.len() <= 5 => (s.to_ascii_lowercase(), r),
        _ => ("https".to_string(), t),
    };
    if schema != "https" && schema != "http" {
        return Err(TEXTE_LIEN.into());
    }
    let fin = reste.find(['/', '?', '#']).unwrap_or(reste.len());
    let autorite = &reste[..fin];
    if autorite.is_empty() || autorite.contains('@') {
        return Err(TEXTE_LIEN.into());
    }
    let hote = match autorite.rsplit_once(':') {
        Some((h, "443")) => h,
        Some(_) => return Err(TEXTE_LIEN.into()),
        None => autorite,
    }
    .to_ascii_lowercase();
    if plateforme_hote(&hote).is_none() {
        return Err(TEXTE_LIEN.into());
    }
    let suite = reste[fin..].split('#').next().unwrap_or("");
    Ok(format!("https://{hote}{suite}"))
}

/// Identifiant d'un transfert ouvert par « Coller un lien » (`desk-` + 32 chiffres hexadécimaux aléatoires).
pub fn id_desktop() -> String {
    format!("desk-{}", uuid::Uuid::new_v4().simple())
}

/// Plateforme du contrat (`youtube`, `tiktok`, `x`) d'un lien validé.
pub fn plateforme(url: &str) -> Option<&'static str> {
    let r = url.strip_prefix("https://")?;
    plateforme_hote(r.split(['/', '?', '#']).next().unwrap_or(""))
}

/// Bornes d'un extrait reçues en secondes (message de l'extension) → millisecondes ; les deux ou aucune.
pub fn extrait_secondes(debut: Option<f64>, fin: Option<f64>) -> Result<Option<(u64, u64)>, String> {
    match (debut, fin) {
        (None, None) => Ok(None),
        (Some(a), Some(b)) if a.is_finite() && b.is_finite() && a >= 0.0 && b >= 0.0 => extrait_ms((a * 1000.0).round() as u64, (b * 1000.0).round() as u64),
        _ => Err("Extrait refusé : début et fin attendus, en secondes.".into()),
    }
}

pub fn extrait_ms(debut: u64, fin: u64) -> Result<Option<(u64, u64)>, String> {
    if fin <= debut || fin > EXTRAIT_MAX_MS {
        return Err("Extrait refusé : la fin doit suivre le début (6 h au plus).".into());
    }
    Ok(Some((debut, fin)))
}

/// Corps de `POST /jobs` : ni jeton, ni cookie, seulement le lien de la page et les réglages.
pub fn corps_requete(d: &Demande) -> Value {
    let mut b = json!({ "url": d.url, "fmt": d.format });
    if d.format == "mp4" {
        // Premiere importe le H.264 + AAC : 1080p (H.264 presque toujours disponible, copié sans réencodage) et
        // transcode=true pour une vidéo entière ; un extrait est toujours réencodé en H.264 + AAC par le serveur.
        b["quality"] = json!("1080");
        if d.extrait.is_none() {
            b["transcode"] = json!(true);
        }
    }
    if let Some((a, z)) = d.extrait {
        b["startMs"] = json!(a);
        b["endMs"] = json!(z);
    }
    b
}

#[derive(Clone, Debug, Default, PartialEq)]
struct Statut {
    id: String,
    etat: String,
    progression: Option<f64>,
    titre: Option<String>,
    fichier: Option<String>,
    nom: Option<String>,
    taille: Option<u64>,
    erreur: Option<String>,
    detail: Option<String>,
}

fn texte(v: &Value, k: &str, max: usize) -> Option<String> {
    v.get(k).and_then(Value::as_str).map(|s| s.chars().filter(|c| !c.is_control()).take(max).collect::<String>().trim().to_string()).filter(|s| !s.is_empty())
}

fn id_travail_valide(id: &str) -> bool {
    (6..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn lire_statut(v: &Value) -> Option<Statut> {
    let id = v.get("job_id")?.as_str().filter(|i| id_travail_valide(i))?.to_string();
    let etat = v.get("status")?.as_str().filter(|s| ["queued", "running", "done", "error"].contains(s))?.to_string();
    // Extrait : `progression` (mesurée) ; vidéo entière : `progress` (0 à 100).
    let p = v.get("progression").and_then(Value::as_f64).or_else(|| v.get("progress").and_then(Value::as_f64)).filter(|p| p.is_finite());
    Some(Statut {
        id,
        etat,
        progression: p.map(|p| (p / 100.0).clamp(0.0, 1.0)),
        titre: texte(v, "title", 300),
        fichier: v.get("file_url").and_then(Value::as_str).map(String::from),
        nom: texte(v, "filename", 255),
        taille: v.get("size_bytes").and_then(Value::as_u64),
        erreur: texte(v, "error", 64),
        detail: texte(v, "detail", 300),
    })
}

/// Réponse JSON d'ytapi : statut, corps (ou `Null`), `Retry-After` en secondes.
fn appel(api: &Api, cle: &str, methode: &str, cible: &str, corps: Option<&Value>, delai: Duration) -> Result<(u16, Value, Option<u64>), Echec> {
    let url = format!("{}{}", api.base, cible);
    if !url.starts_with("https://") {
        return Err(echec("reponse", "Adresse refusée : HTTPS seulement."));
    }
    let a = reseau::agent(&api.racines, delai);
    let auth = format!("Bearer {cle}");
    let rep = match (methode, corps) {
        ("GET", _) => a.get(&url).header("Accept", "application/json").header("Authorization", &auth).call(),
        ("DELETE", _) => a.delete(&url).header("Accept", "application/json").header("Authorization", &auth).call(),
        (_, Some(c)) => a.post(&url).header("Accept", "application/json").header("Authorization", &auth).header("Content-Type", "application/json").send(c.to_string().as_bytes()),
        (_, None) => a.post(&url).header("Accept", "application/json").header("Authorization", &auth).send_empty(),
    };
    let mut rep = rep.map_err(|e| echec("reseau", reseau::message(&e)))?;
    let statut = rep.status().as_u16();
    if (300..400).contains(&statut) {
        return Err(echec("reponse", "Redirection refusée par AETHRYON Desktop."));
    }
    let attente = rep.headers().get("retry-after").and_then(|h| h.to_str().ok()).and_then(|s| s.trim().parse::<u64>().ok());
    let mut octets = Vec::new();
    rep.body_mut().with_config().limit(JSON_MAX).reader().read_to_end(&mut octets).map_err(|_| echec("reponse", "Réponse du serveur illisible ou trop grande."))?;
    let v = if octets.is_empty() { Value::Null } else { serde_json::from_slice(&octets).unwrap_or(Value::Null) };
    Ok((statut, v, attente))
}

/// Refus d'ytapi (`{"error", "detail"}`, textes français de docs/ERREURS.md) : code et phrase du serveur.
fn refus(statut: u16, v: &Value) -> Echec {
    if statut == 401 {
        return echec("non_relie", TEXTE_CLE_REFUSEE);
    }
    let code = texte(v, "error", 40).filter(|c| c.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')).unwrap_or_else(|| format!("http_{statut}"));
    let message = texte(v, "detail", 300).or_else(|| texte(v, "message", 300)).unwrap_or_else(|| match statut {
        s if s >= 500 => "Serveur AETHRYON momentanément indisponible : réessaie dans un instant.".to_string(),
        s => format!("Le serveur AETHRYON a refusé la conversion ({s})."),
    });
    echec(&code, message)
}

fn pause(d: Duration, arreter: &dyn Fn() -> bool) -> bool {
    let fin = Instant::now() + d;
    while Instant::now() < fin {
        if arreter() {
            return false;
        }
        std::thread::sleep(PAUSE.min(fin.saturating_duration_since(Instant::now())).max(Duration::from_millis(1)));
    }
    !arreter()
}

fn attente_serveur(s: Option<u64>) -> Duration {
    if cfg!(test) {
        return PAUSE;
    }
    Duration::from_secs(s.unwrap_or(5).clamp(3, 60))
}

/// Adresse du fichier : même origine et chemin de CE travail seulement (la clé ne va jamais ailleurs).
fn fichier_sur(api: &Api, s: &Statut) -> Result<String, Echec> {
    let refuse = || echec("reponse", "Réponse inattendue du serveur : l'adresse du fichier a été refusée par sécurité.");
    let u = s.fichier.as_deref().ok_or_else(refuse)?;
    let prefixe = format!("{}/jobs/{}/file", api.base, s.id);
    let suite = u.strip_prefix(&prefixe).ok_or_else(refuse)?;
    if u.len() > 4096 || !(suite.is_empty() || suite.starts_with('/')) || suite.contains(['?', '#', '\\']) || suite.contains("..") || suite.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(refuse());
    }
    Ok(u.to_string())
}

/// Nom du fichier : celui du serveur (« Titre [id].mp4 ») nettoyé pour Windows, avec la bonne extension.
fn nom_fichier(s: &Statut, d: &Demande) -> String {
    let ext = format!(".{}", d.format);
    let propre = s.nom.as_deref().map(noms::nettoyer_nom_fichier).unwrap_or_default();
    if propre.to_lowercase().ends_with(&ext) && propre.len() > ext.len() {
        return propre;
    }
    let souche = s.titre.as_deref().or(d.titre.as_deref()).map(noms::nettoyer_nom_fichier).filter(|t| !t.is_empty()).unwrap_or_else(|| "AETHRYON".into());
    noms::nettoyer_nom_fichier(&format!("{} [{}]{ext}", souche.chars().take(90).collect::<String>(), s.id))
}

/// Conversion complète : travail créé, suivi, fichier enregistré dans `dossier`. Renvoie le chemin final.
pub fn convertir(api: &Api, cle: &str, d: &Demande, dossier: &Path, arret: &AtomicBool, pilote: &Pilote, avance: &mut dyn FnMut(Avancee)) -> Result<PathBuf, Echec> {
    let arreter = || arret.load(Ordering::SeqCst) || pilote.annule();
    let annule = &arreter;
    let corps = corps_requete(d);
    let debut = Instant::now();
    let mut reseau_ko = 0u32;
    let mut s = loop {
        if annule() {
            return Err(echec("annule", "Conversion annulée."));
        }
        match appel(api, cle, "POST", "/jobs?wait=0", Some(&corps), Duration::from_secs(30)) {
            Err(e) if e.code == "reseau" && reseau_ko < 2 => {
                reseau_ko += 1;
                if !pause(PAUSE * 3, annule) {
                    return Err(echec("annule", "Conversion annulée."));
                }
            }
            Err(e) => return Err(e),
            Ok((200 | 202, v, _)) => break lire_statut(&v).ok_or_else(|| echec("reponse", "Réponse inattendue du serveur AETHRYON."))?,
            Ok((429, v, ra)) if ["active_job_limit", "rate_limited"].contains(&v.get("error").and_then(Value::as_str).unwrap_or("")) && debut.elapsed() < OCCUPE_MAX => {
                // Une conversion du compte est déjà en cours (autre appareil) : on attend son tour, sans quota consommé.
                avance(Avancee::Attente);
                if !pause(attente_serveur(ra), annule) {
                    return Err(echec("annule", "Conversion annulée."));
                }
            }
            Ok((statut, v, _)) => return Err(refus(statut, &v)),
        }
    };
    let mut titre: Option<String> = None;
    let mut echecs = 0u32;
    loop {
        if s.titre.is_some() && s.titre != titre {
            titre = s.titre.clone();
            avance(Avancee::Titre(titre.clone().unwrap_or_default()));
        }
        match s.etat.as_str() {
            "queued" => avance(Avancee::Attente),
            "running" => avance(Avancee::Conversion(s.progression)),
            "done" => break,
            _ => {
                let code = s.erreur.clone().filter(|c| c.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')).unwrap_or_else(|| "echec".into());
                return Err(echec(&code, s.detail.clone().unwrap_or_else(|| "La conversion a échoué sur le serveur.".into())));
            }
        }
        if annule() {
            let _ = appel(api, cle, "DELETE", &format!("/jobs/{}", s.id), None, Duration::from_secs(10));
            return Err(echec("annule", "Conversion annulée."));
        }
        if debut.elapsed() > SUIVI_MAX {
            return Err(echec("delai", "La conversion ne se termine pas : réessaie plus tard."));
        }
        let t = Instant::now();
        match appel(api, cle, "GET", &format!("/jobs/{}?wait=20&change=true", s.id), None, Duration::from_secs(30)) {
            Ok((200, v, _)) => match lire_statut(&v) {
                Some(n) if n.id == s.id => {
                    echecs = 0;
                    s = n;
                }
                _ => echecs += 1,
            },
            Ok((404, _, _)) => return Err(echec("job_not_found", "La conversion a expiré sur le serveur : relance-la.")),
            Ok((statut, v, _)) if statut != 429 && statut < 500 => return Err(refus(statut, &v)),
            Ok(_) | Err(_) => echecs += 1,
        }
        if echecs >= 8 {
            return Err(echec("reseau", "Impossible de joindre le serveur AETHRYON : vérifie la connexion, puis relance."));
        }
        // Au plus un suivi par seconde, même si le serveur répond tout de suite.
        if s.etat != "done" && !pause(PAUSE.saturating_sub(t.elapsed()) + if echecs > 0 { PAUSE * 2 * echecs } else { Duration::ZERO }, annule) {
            // Annulé entre deux suivis : le travail est aussi supprimé du serveur.
            let _ = appel(api, cle, "DELETE", &format!("/jobs/{}", s.id), None, Duration::from_secs(10));
            return Err(echec("annule", "Conversion annulée."));
        }
    }
    let url = fichier_sur(api, &s)?;
    telecharger(api, cle, &url, &nom_fichier(&s, d), s.taille, dossier, annule, pilote, avance)
}

fn annulee() -> Echec {
    echec("annule", "Conversion annulée.")
}

/// `Content-Range: bytes <début>-<fin>/<total|*>` → (début, fin, total).
fn lire_plage(v: &str) -> Option<(u64, u64, Option<u64>)> {
    let (plage, total) = v.trim().strip_prefix("bytes ")?.split_once('/')?;
    let (a, b) = plage.split_once('-')?;
    let total = if total == "*" { None } else { Some(total.parse().ok()?) };
    Some((a.parse().ok()?, b.parse().ok()?, total))
}

/// Issue d'une connexion de réception.
enum Reception {
    Complet,
    Pause,
}

/// Une connexion : le fichier entier (`fait` = 0), ou sa suite (`Range: bytes=<fait>-`, `206` exigé au bon octet ;
/// `200` = plage ignorée : le `.part` est tronqué et la réception repart de zéro). S'arrête à la fin du corps, à
/// l'annulation ou à la pause (la connexion est alors fermée).
#[allow(clippy::too_many_arguments)]
fn recevoir(a: &ureq::Agent, cle: &str, url: &str, sortie: &mut fs::File, fait: &mut u64, attendu: &mut Option<u64>, debit: &mut Debit, annule: &dyn Fn() -> bool, pilote: &Pilote, avance: &mut dyn FnMut(u64, Option<u64>, Option<u64>)) -> Result<Reception, Echec> {
    let mut requete = a.get(url).header("Authorization", &format!("Bearer {cle}"));
    if *fait > 0 {
        requete = requete.header("Range", &format!("bytes={}-", *fait));
    }
    let mut rep = requete.call().map_err(|e| echec("telechargement_interrompu", format!("Téléchargement impossible : {}", reseau::message(&e))))?;
    match rep.status().as_u16() {
        200 => {
            if *fait > 0 {
                // Plage ignorée par le serveur : on repart de zéro, sans jamais mélanger deux réceptions.
                sortie.set_len(0).and_then(|_| sortie.seek(SeekFrom::Start(0))).map_err(|e| echec("ecriture", format!("Reprise impossible ({}).", flux::raison_io(&e))))?;
                *fait = 0;
                debit.oublier();
            }
            let annonce = rep.body().content_length();
            if let (Some(x), Some(t)) = (annonce, *attendu) {
                if x != t {
                    return Err(echec("taille", "Le serveur annonce une autre taille que celle du fichier converti."));
                }
            }
            *attendu = attendu.or(annonce);
        }
        206 if *fait > 0 => {
            let plage = rep.headers().get("content-range").and_then(|h| h.to_str().ok()).and_then(lire_plage);
            match plage {
                Some((debut, _, total)) if debut == *fait && attendu.is_none_or(|t| total == Some(t)) => *attendu = attendu.or(total),
                _ => return Err(echec("reprise", "Reprise refusée : le serveur renvoie une autre partie du fichier. Relance la conversion.")),
            }
        }
        401 => return Err(echec("non_relie", TEXTE_CLE_REFUSEE)),
        404 | 410 => return Err(echec("file_expired", "Le fichier a expiré sur le serveur : relance la conversion.")),
        416 if attendu.is_some_and(|t| *fait == t) => return Ok(Reception::Complet),
        s if (300..400).contains(&s) => return Err(echec("reponse", "Redirection refusée.")),
        s => return Err(echec(&format!("http_{s}"), format!("Le serveur répond {s} pendant le téléchargement."))),
    }
    let reste = attendu.map(|t| t.saturating_sub(*fait)).unwrap_or(FICHIER_MAX);
    let mut lecteur = rep.body_mut().with_config().limit(reste.saturating_add(1)).reader();
    let mut tampon = vec![0u8; 256 * 1024];
    loop {
        if annule() {
            return Err(annulee());
        }
        if pilote.en_pause() {
            return Ok(Reception::Pause);
        }
        let k = match lecteur.read(&mut tampon) {
            Ok(0) => return Ok(Reception::Complet),
            Ok(k) => k,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => return Err(echec("telechargement_interrompu", "Téléchargement interrompu : connexion coupée.")),
        };
        sortie.write_all(&tampon[..k]).map_err(|e| echec("ecriture", format!("Écriture interrompue ({}).", flux::raison_io(&e))))?;
        *fait += k as u64;
        if attendu.is_some_and(|t| *fait > t) || *fait > FICHIER_MAX {
            return Err(echec("taille", "Le serveur envoie plus d'octets qu'annoncé."));
        }
        avance(*fait, *attendu, debit.noter(*fait));
    }
}

/// Fichier du travail vers `<nom>.part` réservé en exclusivité, taille vérifiée, renommage sans écrasement ; pause et
/// reprise par plage d'octets (en-tête du module).
#[allow(clippy::too_many_arguments)]
fn telecharger(api: &Api, cle: &str, url: &str, nom: &str, taille: Option<u64>, dossier: &Path, annule: &dyn Fn() -> bool, pilote: &Pilote, avance: &mut dyn FnMut(Avancee)) -> Result<PathBuf, Echec> {
    if taille.is_some_and(|t| t > FICHIER_MAX) {
        return Err(echec("fichier_trop_volumineux", "Fichier trop volumineux pour AETHRYON Desktop."));
    }
    fs::create_dir_all(dossier).map_err(|e| echec("ecriture", format!("Dossier des médias inaccessible ({}).", flux::raison_io(&e))))?;
    let (mut final_, part, mut sortie, n) = flux::reserver(dossier, nom, 1).map_err(|e| match e {
        flux::ErreurCopie::Annule => annulee(),
        flux::ErreurCopie::Echec(m) => echec("ecriture", m),
    })?;
    let nom_final = |p: &Path| p.file_name().map(|x| x.to_string_lossy().into_owned()).unwrap_or_default();
    avance(Avancee::Telechargement { nom: nom_final(&final_), recus: 0, total: taille, vitesse: None });
    let r = (|| -> Result<(), Echec> {
        let a = reseau::agent(&api.racines, Duration::from_secs(3 * 3600));
        let nom = nom_final(&final_);
        let (mut fait, mut attendu, mut debit) = (0u64, taille, Debit::default());
        loop {
            if annule() {
                return Err(annulee());
            }
            let fin = recevoir(&a, cle, url, &mut sortie, &mut fait, &mut attendu, &mut debit, annule, pilote, &mut |recus, total, vitesse| {
                avance(Avancee::Telechargement { nom: nom.clone(), recus, total, vitesse })
            })?;
            match fin {
                Reception::Complet => break,
                Reception::Pause => {
                    avance(Avancee::Pause { nom: nom.clone(), recus: fait, total: attendu });
                    while pilote.en_pause() {
                        if annule() {
                            return Err(annulee());
                        }
                        std::thread::sleep(PAUSE.min(Duration::from_millis(200)));
                    }
                    debit.oublier();
                    avance(Avancee::Telechargement { nom: nom.clone(), recus: fait, total: attendu, vitesse: None });
                }
            }
        }
        if attendu.is_some_and(|t| fait != t) || fait == 0 {
            return Err(echec("telechargement_interrompu", "Téléchargement interrompu : fichier incomplet."));
        }
        sortie.sync_all().map_err(|e| echec("ecriture", format!("Écriture non confirmée par le disque ({}).", flux::raison_io(&e))))?;
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
                final_ = dossier.join(flux::candidat(nom, essai));
                while !flux::libre(&final_) && essai < n + 1000 {
                    essai += 1;
                    final_ = dossier.join(flux::candidat(nom, essai));
                }
            }
            Err(e) => {
                let _ = fs::remove_file(&part);
                return Err(echec("ecriture", format!("Renommage final impossible ({}).", flux::raison_io(&e))));
            }
        }
    }
    let _ = fs::remove_file(&part);
    Err(echec("ecriture", "Renommage final impossible : noms occupés."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn liens_acceptes_et_refuses() {
        assert_eq!(valider_url(" https://www.youtube.com/watch?v=dQw4w9WgXcQ#t=3 ").unwrap(), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
        assert_eq!(valider_url("youtu.be/dQw4w9WgXcQ").unwrap(), "https://youtu.be/dQw4w9WgXcQ");
        assert_eq!(valider_url("http://X.com/a/status/1").unwrap(), "https://x.com/a/status/1");
        assert_eq!(plateforme("https://vm.tiktok.com/ZM1/"), Some("tiktok"));
        for mauvais in ["", "https://evil.example/watch?v=x", "https://youtube.com.evil.example/", "https://user:pw@youtube.com/", "ftp://youtube.com/x",
            "https://youtube.com:8443/x", "https://notyoutube.com/x", "https://www.youtube.com/watch?v=x y", "javascript:alert(1)"] {
            let e = valider_url(mauvais).unwrap_err();
            assert!(!e.contains("evil") && !e.contains("pw"), "le lien refusé n'est jamais répété : {e}");
        }
        assert_eq!(extrait_secondes(Some(1.5), Some(4.25)).unwrap(), Some((1500, 4250)));
        assert!(extrait_secondes(Some(4.0), Some(1.0)).is_err() && extrait_secondes(Some(1.0), None).is_err());
        let d = Demande { id: "t".into(), url: "https://youtu.be/x".into(), format: "mp4".into(), extrait: None, titre: None, origine: "desktop".into(), premiere: false };
        assert_eq!(corps_requete(&d), json!({"url": "https://youtu.be/x", "fmt": "mp4", "quality": "1080", "transcode": true}));
        let d = Demande { format: "mp3".into(), extrait: Some((1000, 2000)), ..d };
        assert_eq!(corps_requete(&d), json!({"url": "https://youtu.be/x", "fmt": "mp3", "startMs": 1000, "endMs": 2000}));
    }

    // ---- Nocturne : annulation, pause et reprise par plage d'octets (serveur HTTPS local) -------------------------

    use crate::essais_http::{Reponse, Requete, Serveur};
    use std::sync::{Arc, Mutex};

    fn fichier_essai() -> Vec<u8> {
        (0..(1200 * 1024u32)).map(|i| (i.wrapping_mul(2654435761) >> 13) as u8).collect()
    }

    /// Travail déjà terminé sur le serveur ; le fichier est servi lentement (32 Kio toutes les 25 ms), avec ou sans
    /// prise en charge des plages.
    fn serveur(octets: Vec<u8>, plages: bool) -> Serveur {
        let total = octets.len();
        Serveur::demarrer(move |r: &Requete| {
            let hote = r.entete("host").unwrap_or("").to_string();
            match (r.methode.as_str(), r.chemin()) {
                ("POST", "/media/jobs") => Reponse::Json(202, json!({ "job_id": "job_pause1", "status": "done", "title": "Essai", "filename": "Essai [p1].mp4",
                    "size_bytes": total, "file_url": format!("https://{hote}/media/jobs/job_pause1/file") })),
                ("GET", "/media/jobs/job_pause1/file") => {
                    let debut = r.entete("range").and_then(|v| v.strip_prefix("bytes=")).and_then(|v| v.strip_suffix('-')).and_then(|v| v.parse::<usize>().ok());
                    match debut {
                        Some(a) if plages && a < total => Reponse::LenteAvec { statut: 206, entetes: vec![("Content-Range".into(), format!("bytes {a}-{}/{total}", total - 1))],
                            corps: octets[a..].to_vec(), bloc: 32 * 1024, pause: Duration::from_millis(25) },
                        _ => Reponse::Lente(octets.clone(), 32 * 1024, Duration::from_millis(25)),
                    }
                }
                _ => Reponse::Json(404, json!({ "error": "not_found" })),
            }
        })
    }

    struct Course {
        fil: std::thread::JoinHandle<Result<PathBuf, Echec>>,
        pilote: Arc<Pilote>,
        journal: Arc<Mutex<Vec<Avancee>>>,
    }

    /// Lance la conversion dans un fil ; `pause_apres` : pause demandée dès que ce nombre d'octets est reçu.
    fn lancer(srv: &Serveur, dossier: &Path, pause_apres: Option<u64>, annule_apres: Option<u64>) -> Course {
        let api = Api::essai(&format!("{}/media", srv.base), srv.autorite.clone());
        let pilote = Arc::new(Pilote::default());
        let journal: Arc<Mutex<Vec<Avancee>>> = Arc::default();
        let (p2, j2, dossier) = (pilote.clone(), journal.clone(), dossier.to_path_buf());
        let fil = std::thread::spawn(move || {
            let d = Demande { id: "desk-essai".into(), url: "https://youtu.be/x".into(), format: "mp4".into(), extrait: None, titre: None, origine: "desktop".into(), premiere: false };
            let arret = AtomicBool::new(false);
            let mut pause_faite = false;
            convertir(&api, "ytc_cle", &d, &dossier, &arret, &p2, &mut |a| {
                if let Avancee::Telechargement { recus, .. } = a {
                    if pause_apres.is_some_and(|n| recus >= n) && !pause_faite {
                        pause_faite = true;
                        p2.mettre_en_pause(true);
                    }
                    if annule_apres.is_some_and(|n| recus >= n) {
                        p2.annuler();
                    }
                }
                j2.lock().unwrap().push(a);
            })
        });
        Course { fil, pilote, journal }
    }

    fn attendre(mut f: impl FnMut() -> bool) -> bool {
        let fin = Instant::now() + Duration::from_secs(20);
        while Instant::now() < fin {
            if f() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        false
    }

    fn pause_vue(c: &Course) -> Option<u64> {
        c.journal.lock().unwrap().iter().find_map(|a| if let Avancee::Pause { recus, .. } = a { Some(*recus) } else { None })
    }

    #[test]
    fn plage_et_debit() {
        assert_eq!(lire_plage("bytes 100-999/1000"), Some((100, 999, Some(1000))));
        assert_eq!(lire_plage("bytes 0-9/*"), Some((0, 9, None)));
        assert_eq!(lire_plage("octets 0-9/10"), None);
        assert_eq!(lire_plage("bytes 5/10"), None);
        let mut d = Debit::default();
        assert_eq!(d.noter(0), None, "aucune mesure sans durée");
        std::thread::sleep(Duration::from_millis(600));
        let v = d.noter(600_000).expect("mesure après une demi-seconde");
        assert!((500_000..=1_100_000).contains(&v), "{v} octets/s");
        d.oublier();
        assert_eq!(d.noter(700_000), None);
    }

    #[test]
    fn pause_puis_reprise_par_plage() {
        let octets = fichier_essai();
        let srv = serveur(octets.clone(), true);
        let dir = tempfile::tempdir().unwrap();
        let c = lancer(&srv, dir.path(), Some(256 * 1024), None);
        assert!(attendre(|| pause_vue(&c).is_some()), "pause jamais signalée");
        let recus = pause_vue(&c).unwrap();
        // En pause : connexion fermée, `.part` gardé tel quel, plus aucun octet.
        let part = std::fs::read_dir(dir.path()).unwrap().flatten().map(|e| e.path()).find(|p| p.to_string_lossy().ends_with(".part")).expect(".part gardé");
        std::thread::sleep(Duration::from_millis(400));
        assert_eq!(std::fs::metadata(&part).unwrap().len(), recus, "rien n'arrive pendant la pause");
        assert_eq!(srv.vues("GET", "/media/jobs/job_pause1/file").len(), 1);
        c.pilote.mettre_en_pause(false);
        let chemin = c.fil.join().unwrap().expect("conversion terminée après la reprise");
        assert_eq!(std::fs::read(&chemin).unwrap(), octets, "fichier identique, octet pour octet");
        let get = srv.vues("GET", "/media/jobs/job_pause1/file");
        assert_eq!(get.len(), 2);
        assert_eq!(get[1].entete("range"), Some(format!("bytes={recus}-").as_str()), "la suite seulement");
        assert_eq!(get[1].entete("authorization"), Some("Bearer ytc_cle"));
        let j = c.journal.lock().unwrap();
        assert!(j.iter().any(|a| matches!(a, Avancee::Telechargement { vitesse: Some(v), .. } if *v > 0)), "débit mesuré pendant la réception");
        assert!(matches!(j.last(), Some(Avancee::Telechargement { recus, total: Some(t), .. }) if *recus == *t && *t == octets.len() as u64));
        assert!(!std::fs::read_dir(dir.path()).unwrap().flatten().any(|e| e.file_name().to_string_lossy().ends_with(".part")));
    }

    #[test]
    fn reprise_ignoree_par_le_serveur_repart_de_zero() {
        let octets = fichier_essai();
        let srv = serveur(octets.clone(), false);
        let dir = tempfile::tempdir().unwrap();
        let c = lancer(&srv, dir.path(), Some(300 * 1024), None);
        assert!(attendre(|| pause_vue(&c).is_some()));
        c.pilote.mettre_en_pause(false);
        let chemin = c.fil.join().unwrap().expect("terminée malgré la plage ignorée");
        assert_eq!(std::fs::read(&chemin).unwrap(), octets, "tronqué puis repris de zéro : rien de mélangé");
        assert_eq!(srv.vues("GET", "/media/jobs/job_pause1/file").len(), 2);
    }

    #[test]
    fn annulation_pendant_la_reception_et_pendant_la_conversion() {
        // Pendant la réception : `.part` effacé, aucun fichier final.
        let srv = serveur(fichier_essai(), true);
        let dir = tempfile::tempdir().unwrap();
        let c = lancer(&srv, dir.path(), None, Some(128 * 1024));
        let e = c.fil.join().unwrap().unwrap_err();
        assert_eq!(e.code, "annule");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0, "ni .part ni fichier final");
        // En pause : l'annulation l'emporte aussi.
        let dir = tempfile::tempdir().unwrap();
        let c = lancer(&srv, dir.path(), Some(64 * 1024), None);
        assert!(attendre(|| pause_vue(&c).is_some()));
        c.pilote.annuler();
        assert_eq!(c.fil.join().unwrap().unwrap_err().code, "annule");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
        // Pendant la conversion sur le serveur : le travail y est supprimé (DELETE).
        let srv = Serveur::demarrer(|r: &Requete| match (r.methode.as_str(), r.chemin()) {
            ("POST", "/media/jobs") => Reponse::Json(202, json!({ "job_id": "job_long1", "status": "running", "progress": 5.0 })),
            ("GET", "/media/jobs/job_long1") => Reponse::Json(200, json!({ "job_id": "job_long1", "status": "running", "progress": 12.0 })),
            ("DELETE", "/media/jobs/job_long1") => Reponse::Json(200, json!({ "job_id": "job_long1", "deleted": true })),
            _ => Reponse::Json(404, json!({ "error": "not_found" })),
        });
        let dir = tempfile::tempdir().unwrap();
        let c = lancer(&srv, dir.path(), None, None);
        assert!(attendre(|| c.journal.lock().unwrap().iter().any(|a| matches!(a, Avancee::Conversion(_)))));
        c.pilote.annuler();
        assert_eq!(c.fil.join().unwrap().unwrap_err().code, "annule");
        assert_eq!(srv.vues("DELETE", "/media/jobs/job_long1").len(), 1, "travail supprimé du serveur");
    }
}

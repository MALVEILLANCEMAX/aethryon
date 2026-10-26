//! Appels de la section MUSIQUE au relais d'account (`/api/music/*`, account/src/music.ts) avec la clé « desktop » du
//! coffre. Le relais transmet à AETHRYON Music (ytapi) ; la clé « desktop » n'ouvre QUE ces routes-là (moindre
//! privilège : ni conversions, ni AETHRYON Tools), en plus de `/api/desktop/moi` et du Cloud de l'administrateur.
//!
//! Tout est validé ICI avant le moindre appel (liens https, identifiants, sources, corps d'import à champs fermés) ;
//! les réponses sont bornées (4 Mio : fiche d'une playlist de 500 titres, correspondances) et décodées sans rien
//! exécuter. Jamais de redirection suivie, jamais une adresse de téléchargement venue de l'interface.

use crate::cloud::ErreurCloud;
use crate::compte::{self, Serveur};
use serde_json::{json, Map, Value};
use std::time::Duration;

const REPONSE_MAX: u64 = 4 * 1024 * 1024;
const DELAI: Duration = Duration::from_secs(45);
pub const SOURCES_RECHERCHE: [&str; 4] = ["spotify", "apple", "archive", "commons"];

pub type ErreurMusique = ErreurCloud;

fn ko(statut: u16, code: &str, message: &str) -> ErreurMusique {
    ErreurCloud { statut, code: code.into(), message: message.into() }
}

/// Lien accepté par l'analyse : https (ou `spotify:`), sans espace ni caractère de contrôle, 2 048 caractères au plus.
pub fn lien_valide(u: &str) -> bool {
    let u = u.trim();
    (u.starts_with("https://") || u.starts_with("spotify:")) && u.len() <= 2048 && !u.chars().any(|c| c.is_control() || c.is_whitespace())
}

/// Identifiant d'un import d'AETHRYON Music (`mus_…`).
pub fn id_import_valide(id: &str) -> bool {
    id.len() <= 48 && id.starts_with("mus_") && id.len() > 4 && id[4..].bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Corps d'un import : champs FERMÉS (`url`, `type`, `fichier`, `episode`, `attestation`), `attestation` booléen
/// exact. Le serveur relit de toute façon la source ; ce filtre empêche l'interface d'ajouter quoi que ce soit.
pub fn corps_import(v: &Value) -> Result<Value, ErreurMusique> {
    let o = v.as_object().ok_or_else(|| ko(400, "requete_invalide", "Demande d'import invalide."))?;
    let mut s = Map::new();
    for (k, x) in o {
        match (k.as_str(), x) {
            ("url", Value::String(u)) if lien_valide(u) => {
                s.insert(k.clone(), Value::String(u.trim().into()));
            }
            ("type", Value::String(t)) if ["podcast", "fichier"].contains(&t.as_str()) => {
                s.insert(k.clone(), x.clone());
            }
            ("fichier" | "episode", Value::String(t)) if !t.is_empty() && t.len() <= 512 && !t.chars().any(|c| c.is_control()) => {
                s.insert(k.clone(), x.clone());
            }
            ("attestation", Value::Bool(_)) => {
                s.insert(k.clone(), x.clone());
            }
            ("type" | "fichier" | "episode" | "attestation", Value::Null) => {}
            _ => return Err(ko(400, "requete_invalide", &format!("Champ d'import refusé : « {k} ». "))),
        }
    }
    if !s.contains_key("url") {
        return Err(ko(400, "lien_invalide", "Lien de la source absent ou invalide."));
    }
    Ok(Value::Object(s))
}

/// Hôtes des pages OFFICIELLES qu'« Ouvrir dans … » peut ouvrir dans le navigateur (liste fermée, https, sans
/// identifiants ni port) : rien d'autre ne peut être lancé depuis la section MUSIQUE.
pub const HOTES_OUVRABLES: [&str; 10] = [
    "open.spotify.com", "music.apple.com", "podcasts.apple.com", "soundcloud.com", "www.deezer.com", "deezer.com",
    "archive.org", "commons.wikimedia.org", "creativecommons.org", "raccourci.malvu.fr",
];

pub fn lien_ouvrable(u: &str) -> bool {
    let Some(reste) = u.strip_prefix("https://") else { return false };
    if !lien_valide(u) || u.contains('\\') {
        return false;
    }
    let hote = reste.split(['/', '?', '#']).next().unwrap_or("");
    HOTES_OUVRABLES.contains(&hote)
}

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

/// Message lisible d'un refus du relais ou d'AETHRYON Music (`detail` d'ytapi, `message` d'account).
fn refus(r: &compte::ReponseApi) -> ErreurMusique {
    let texte = r.json.get("detail").or_else(|| r.json.get("message")).and_then(|m| m.as_str()).map(|m| m.chars().filter(|c| !c.is_control()).take(400).collect::<String>());
    let repli = match r.statut {
        401 => "La liaison d'AETHRYON Desktop n'est plus valable : reliez-le de nouveau (Paramètres › Compte).".to_string(),
        404 => "AETHRYON Music n'est pas ouvert sur ce serveur, ou l'élément est introuvable.".to_string(),
        429 => "Trop de demandes en peu de temps : réessayez dans quelques minutes.".to_string(),
        s if s >= 500 => "AETHRYON Music est momentanément indisponible.".to_string(),
        s => format!("AETHRYON Music répond {s}."),
    };
    let code = r.json.get("error").and_then(|c| c.as_str()).filter(|c| c.len() <= 40 && c.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')).unwrap_or("").to_string();
    ErreurCloud { statut: r.statut, code, message: texte.filter(|t| !t.is_empty()).unwrap_or(repli) }
}

pub struct ClientMusique<'a> {
    pub srv: &'a Serveur,
    pub cle: &'a str,
}

impl ClientMusique<'_> {
    fn appel(&self, methode: &str, chemin: &str, corps: Option<&Value>, attendus: &[u16]) -> Result<Value, ErreurMusique> {
        debug_assert!(chemin.starts_with("/api/music/"));
        let r = compte::appel_borne(self.srv, methode, chemin, Some(self.cle), corps, REPONSE_MAX, DELAI).map_err(|m| ko(0, "reseau", &m))?;
        if !attendus.contains(&r.statut) {
            return Err(refus(&r));
        }
        Ok(r.json)
    }

    pub fn connecteurs(&self) -> Result<Value, ErreurMusique> {
        self.appel("GET", "/api/music/connecteurs", None, &[200])
    }

    pub fn analyser(&self, url: &str, type_: Option<&str>) -> Result<Value, ErreurMusique> {
        if !lien_valide(url) {
            return Err(ko(400, "lien_invalide", "Collez un lien complet qui commence par https://."));
        }
        let mut c = json!({ "url": url.trim() });
        match type_ {
            None | Some("") => {}
            Some(t @ ("podcast" | "fichier")) => c["type"] = json!(t),
            Some(_) => return Err(ko(400, "type_invalide", "Type de lien inconnu.")),
        }
        self.appel("POST", "/api/music/analyser", Some(&c), &[200])
    }

    pub fn rechercher(&self, q: &str, source: &str) -> Result<Value, ErreurMusique> {
        let q = q.trim();
        if q.is_empty() || q.chars().count() > 200 {
            return Err(ko(400, "recherche_vide", "Tapez de 1 à 200 caractères."));
        }
        if !SOURCES_RECHERCHE.contains(&source) {
            return Err(ko(400, "source_invalide", "Source de recherche inconnue."));
        }
        self.appel("GET", &format!("/api/music/rechercher?q={}&source={source}", encoder(q)), None, &[200])
    }

    pub fn correspondances(&self, pistes: &Value, candidats: &Value) -> Result<Value, ErreurMusique> {
        if !pistes.as_array().is_some_and(|a| (1..=500).contains(&a.len())) || !candidats.as_array().is_some_and(|a| a.len() <= 10_000) {
            return Err(ko(400, "pistes_invalides", "De 1 à 500 titres, 10 000 fichiers au plus."));
        }
        self.appel("POST", "/api/music/correspondances", Some(&json!({ "pistes": pistes, "candidats": candidats })), &[200])
    }

    pub fn synchroniser(&self, url: &str, candidats: &Value) -> Result<Value, ErreurMusique> {
        if !lien_valide(url) {
            return Err(ko(400, "lien_invalide", "Lien de playlist invalide."));
        }
        self.appel("POST", "/api/music/playlists/synchroniser", Some(&json!({ "url": url.trim(), "candidats": candidats })), &[200])
    }

    pub fn importer(&self, corps: &Value) -> Result<Value, ErreurMusique> {
        let c = corps_import(corps)?;
        self.appel("POST", "/api/music/imports", Some(&c), &[200, 201, 202])
    }

    pub fn imports(&self) -> Result<Value, ErreurMusique> {
        self.appel("GET", "/api/music/imports", None, &[200])
    }

    pub fn import(&self, id: &str) -> Result<Value, ErreurMusique> {
        if !id_import_valide(id) {
            return Err(ko(400, "requete_invalide", "Identifiant d'import invalide."));
        }
        self.appel("GET", &format!("/api/music/imports/{id}"), None, &[200])
    }

    pub fn annuler(&self, id: &str) -> Result<Value, ErreurMusique> {
        if !id_import_valide(id) {
            return Err(ko(400, "requete_invalide", "Identifiant d'import invalide."));
        }
        self.appel("POST", &format!("/api/music/imports/{id}/annuler"), Some(&json!({})), &[200, 202, 204])
    }
}

#[cfg(test)]
mod essais {
    use super::*;

    #[test]
    fn liens_et_identifiants() {
        assert!(lien_valide("https://archive.org/details/x"));
        assert!(lien_valide("spotify:track:4uLU6hMCjMI75M1A2tKUQC"));
        assert!(!lien_valide("http://archive.org/details/x"));
        assert!(!lien_valide("file:///C:/Windows/win.ini"));
        assert!(!lien_valide("https://a.b/x y"));
        assert!(!lien_valide(&format!("https://a.b/{}", "x".repeat(2050))));
        assert!(id_import_valide("mus_abc-DEF_1"));
        assert!(!id_import_valide("mus_../../x"));
        assert!(!id_import_valide("job_1"));
    }

    #[test]
    fn seules_les_pages_officielles_s_ouvrent() {
        assert!(lien_ouvrable("https://open.spotify.com/track/abc"));
        assert!(lien_ouvrable("https://music.apple.com/fr/album/x/1?i=2"));
        assert!(!lien_ouvrable("https://open.spotify.com.evil.example/x"));
        assert!(!lien_ouvrable("https://user@open.spotify.com/x"));
        assert!(!lien_ouvrable("https://open.spotify.com:8443/x"));
        assert!(!lien_ouvrable("http://open.spotify.com/x"));
        assert!(!lien_ouvrable("file:///C:/x"));
        assert!(!lien_ouvrable("https://exemple.fr/x.exe"));
    }

    #[test]
    fn corps_d_import_a_champs_fermes() {
        let c = corps_import(&json!({ "url": "https://archive.org/details/x", "fichier": "a.mp3", "attestation": null })).unwrap();
        assert_eq!(c, json!({ "url": "https://archive.org/details/x", "fichier": "a.mp3" }));
        assert!(corps_import(&json!({ "url": "https://x.y/a.mp3", "type": "fichier", "attestation": true })).is_ok());
        // « true » en texte, champ inconnu, lien absent ou non https : refusés avant tout appel.
        assert!(corps_import(&json!({ "url": "https://x.y/a.mp3", "attestation": "true" })).is_err());
        assert!(corps_import(&json!({ "url": "https://x.y/a.mp3", "taille": 1 })).is_err());
        assert!(corps_import(&json!({ "url": "http://x.y/a.mp3" })).is_err());
        assert!(corps_import(&json!({ "type": "fichier" })).is_err());
        assert!(corps_import(&json!([1])).is_err());
    }
}

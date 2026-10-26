//! AETHRYON Desktop relié au compte (Paramètres › Compte) : appairage par code et page d'accord du site
//! (account/src/desktop.ts, même flux que le panneau Premiere, inspiré de la RFC 8628).
//!
//! 1. « Relier » : `POST /api/desktop/appairage` (nom de l'ordinateur, version) → code « ABCD-EFGH » affiché dans le
//!    Desktop ; le navigateur s'ouvre sur `/desktop/connecter?code=ABCD-EFGH` (adresse construite ICI depuis la base
//!    figée, jamais reprise de la réponse) ; l'utilisateur, connecté au site, autorise.
//! 2. Le cœur interroge `POST /api/desktop/jeton` à l'intervalle donné (+5 s après un « trop rapide », RFC 8628 §3.5)
//!    jusqu'à la clé, au refus ou à l'expiration (10 min) ; une panne réseau ne l'arrête pas avant l'expiration.
//! 3. La clé « desktop » va dans le coffre ([`crate::coffre`], DPAPI sous Windows) ; l'interface ne reçoit que
//!    l'[`EtatCompte`] (compte, rôle, état du cloud), JAMAIS la clé.
//! 4. `GET /api/desktop/moi` à l'ouverture et sur demande ; 401 (clé révoquée dans « Mes jetons », expirée) → liaison
//!    effacée, l'interface propose de relier de nouveau. « Se déconnecter » : `POST /api/desktop/deconnexion` puis
//!    effacement local (même si le site est injoignable).
//!
//! Requêtes : HTTPS seulement, aucune redirection, aucune origine, aucun cookie, réponses bornées (64 Kio).
//! Adresse figée en production (`BASE_PRODUCTION`) ; une autre base n'existe que dans les essais.

use crate::coffre::{Coffre, Liaison};
use crate::reseau::{self, Racines};
use serde::Serialize;
use serde_json::{json, Value};
use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Site AETHRYON (account derrière le nginx du site), figé.
pub const BASE_PRODUCTION: &str = "https://raccourci.malvu.fr";
const REPONSE_MAX: u64 = 64 * 1024;
const DELAI: Duration = Duration::from_secs(20);
#[cfg(not(test))]
const INTERVALLE_MIN_S: u64 = 1;
#[cfg(test)]
const INTERVALLE_MIN_S: u64 = 0;

/// Serveur d'account : base HTTPS et autorités de confiance.
#[derive(Clone, Debug)]
pub struct Serveur {
    pub(crate) base: String,
    pub(crate) racines: Racines,
}

impl Serveur {
    pub fn production() -> Serveur {
        Serveur { base: BASE_PRODUCTION.into(), racines: Racines::Mozilla }
    }
    #[cfg(any(test, feature = "essais"))]
    pub fn essai(base: &str, autorite_der: Vec<u8>) -> Serveur {
        Serveur { base: base.trim_end_matches('/').into(), racines: Racines::Essai(autorite_der) }
    }
    /// Banc Linux seulement (fonctionnalité `essais`) : `AETHRYON_COMPTE_BASE` et `AETHRYON_COMPTE_AUTORITE` (DER).
    #[cfg(feature = "essais")]
    pub fn depuis_environnement() -> Option<Serveur> {
        let base = std::env::var("AETHRYON_COMPTE_BASE").ok()?;
        let der = std::fs::read(std::env::var_os("AETHRYON_COMPTE_AUTORITE")?).ok()?;
        Some(Serveur::essai(&base, der))
    }
    pub fn base(&self) -> &str {
        &self.base
    }
}

/// Réponse d'account : statut, corps JSON (ou `Null`), `Retry-After` éventuel.
#[derive(Debug)]
pub struct ReponseApi {
    pub statut: u16,
    pub json: Value,
}

impl ReponseApi {
    /// Message lisible du serveur (`message`), ou un repli.
    pub fn message(&self, repli: &str) -> String {
        self.json.get("message").and_then(|m| m.as_str()).map(nettoyer).filter(|m| !m.is_empty()).unwrap_or_else(|| repli.to_string())
    }
    pub fn code(&self) -> String {
        self.json.get("error").and_then(|m| m.as_str()).filter(|c| c.len() <= 40 && c.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')).unwrap_or("").to_string()
    }
}

/// Texte venu du serveur : sans caractère de contrôle, borné (affiché tel quel par l'interface, jamais interprété).
pub(crate) fn nettoyer(s: &str) -> String {
    s.chars().filter(|c| !c.is_control()).take(400).collect::<String>().trim().to_string()
}

/// Appel JSON d'account (`chemin` commence par `/api/`). `cle` : Bearer de la clé « desktop ».
pub fn appel(srv: &Serveur, methode: &str, chemin: &str, cle: Option<&str>, corps: Option<&Value>) -> Result<ReponseApi, String> {
    appel_borne(srv, methode, chemin, cle, corps, REPONSE_MAX, DELAI)
}

/// Comme [`appel`], avec une taille de réponse et un délai choisis (section MUSIQUE : fiches d'album ou de playlist,
/// correspondances de 500 titres).
pub fn appel_borne(srv: &Serveur, methode: &str, chemin: &str, cle: Option<&str>, corps: Option<&Value>, max: u64, delai: Duration) -> Result<ReponseApi, String> {
    debug_assert!(chemin.starts_with("/api/"));
    let url = format!("{}{}", srv.base, chemin);
    if !url.starts_with("https://") {
        return Err("Adresse refusée : HTTPS seulement.".into());
    }
    let a = reseau::agent(&srv.racines, delai);
    let auth = cle.map(|c| format!("Bearer {c}"));
    let rep = match (methode, corps) {
        ("GET", _) => {
            let mut r = a.get(&url).header("Accept", "application/json");
            if let Some(h) = &auth {
                r = r.header("Authorization", h);
            }
            r.call()
        }
        (m, c) => {
            let texte = c.map(|v| v.to_string()).unwrap_or_default();
            let mut r = match m {
                "PUT" => a.put(&url),
                _ => a.post(&url),
            }
            .header("Accept", "application/json");
            if let Some(h) = &auth {
                r = r.header("Authorization", h);
            }
            if c.is_some() {
                r.header("Content-Type", "application/json").send(texte.as_bytes())
            } else {
                r.send_empty()
            }
        }
    };
    let mut rep = rep.map_err(|e| reseau::message(&e))?;
    let statut = rep.status().as_u16();
    if (300..400).contains(&statut) {
        return Err("Redirection refusée par AETHRYON Desktop.".into());
    }
    let mut octets = Vec::new();
    rep.body_mut().with_config().limit(max).reader().read_to_end(&mut octets).map_err(|_| "Réponse du site illisible ou trop grande.".to_string())?;
    let json = if octets.is_empty() { Value::Null } else { serde_json::from_slice(&octets).unwrap_or(Value::Null) };
    Ok(ReponseApi { statut, json })
}

// ---- État vu par l'interface (jamais la clé) ----------------------------------------------------------------------

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompteVu {
    pub email: String,
    pub nom: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CloudVu {
    pub disponible: bool,
    /// `non_admin`, `ferme` (CLOUD coupé sur le serveur) ou absent.
    pub raison: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppairageVu {
    /// « ABCD-EFGH », à comparer à celui de la page d'accord.
    pub code_utilisateur: String,
    /// Page d'accord (base figée + code).
    pub url: String,
    pub expire_le: String,
    /// `en-attente`, `autorise`, `refuse`, `expire`, `deja-utilise`, `erreur`.
    pub etat: String,
    pub message: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct EtatCompte {
    pub relie: bool,
    pub compte: Option<CompteVu>,
    pub administrateur: Option<bool>,
    pub cloud: Option<CloudVu>,
    pub cle_expire_le: Option<String>,
    pub relie_le: Option<String>,
    pub appairage: Option<AppairageVu>,
    /// Dernière erreur lisible (site injoignable, liaison révoquée…).
    pub erreur: Option<String>,
    /// La dernière vérification n'a pas pu joindre le site : l'état affiché est celui connu avant.
    pub hors_ligne: bool,
    pub verifie_le: Option<String>,
}

type Avis = Box<dyn Fn(&EtatCompte) + Send + Sync>;
type Ouvrir = Box<dyn Fn(&str) -> Result<(), String> + Send + Sync>;

/// Liaison du Desktop au compte : un seul gestionnaire par application.
pub struct GestionCompte {
    srv: Serveur,
    coffre: Coffre,
    hote: String,
    version: String,
    etat: Mutex<EtatCompte>,
    liaison: Mutex<Option<Liaison>>,
    /// Numéro de l'appairage en cours : l'annuler (ou en lancer un autre) arrête l'interrogation précédente.
    generation: AtomicU64,
    avis: Avis,
    ouvrir: Ouvrir,
}

fn maintenant() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Nom de l'ordinateur (affiché sur la page d'accord et dans « Mes jetons ») : `COMPUTERNAME` sous Windows.
pub fn nom_ordinateur() -> String {
    let brut = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_default();
    let n: String = brut.chars().filter(|c| !c.is_control()).take(60).collect::<String>().trim().to_string();
    if n.is_empty() { "Ordinateur".into() } else { n }
}

impl GestionCompte {
    pub fn new(srv: Serveur, coffre: Coffre, hote: String, version: String, avis: Avis, ouvrir: Ouvrir) -> Arc<GestionCompte> {
        let l = coffre.lire().ok().flatten();
        let mut e = EtatCompte::default();
        if let Some(l) = &l {
            e.relie = true;
            e.compte = Some(CompteVu { email: l.email.clone(), nom: l.nom.clone() });
            e.cle_expire_le = l.expire_le.clone();
            e.relie_le = Some(l.relie_le.clone());
        }
        Arc::new(GestionCompte { srv, coffre, hote, version, etat: Mutex::new(e), liaison: Mutex::new(l), generation: AtomicU64::new(0), avis, ouvrir })
    }

    pub fn serveur(&self) -> &Serveur {
        &self.srv
    }

    pub fn etat(&self) -> EtatCompte {
        self.etat.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Clé « desktop » pour les requêtes du cœur (cloud). Jamais exposée à l'interface.
    pub fn cle(&self) -> Option<String> {
        self.liaison.lock().unwrap_or_else(|e| e.into_inner()).as_ref().map(|l| l.cle.clone())
    }

    fn modifier(&self, f: impl FnOnce(&mut EtatCompte)) -> EtatCompte {
        let e = {
            let mut g = self.etat.lock().unwrap_or_else(|e| e.into_inner());
            f(&mut g);
            g.clone()
        };
        (self.avis)(&e);
        e
    }

    /// Lance un appairage : code affiché, page d'accord ouverte dans le navigateur, interrogation en arrière-plan.
    pub fn demarrer_appairage(self: &Arc<Self>) -> Result<EtatCompte, String> {
        let gen = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let r = appel(&self.srv, "POST", "/api/desktop/appairage", None, Some(&json!({ "hote": self.hote, "versionDesktop": self.version })))?;
        if r.statut != 200 {
            let m = r.message(&format!("Le site refuse la liaison ({}).", r.statut));
            self.modifier(|e| e.erreur = Some(m.clone()));
            return Err(m);
        }
        let code_appareil = r.json.get("codeAppareil").and_then(|v| v.as_str()).filter(|c| c.len() == 43 && c.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')).map(String::from);
        let code = r.json.get("codeUtilisateur").and_then(|v| v.as_str()).filter(|c| c.len() == 9 && c.as_bytes()[4] == b'-' && c.bytes().enumerate().all(|(i, b)| i == 4 || b.is_ascii_uppercase())).map(String::from);
        let (Some(code_appareil), Some(code)) = (code_appareil, code) else {
            return Err("Réponse inattendue du site : liaison impossible.".into());
        };
        let duree = r.json.get("expireDans").and_then(|v| v.as_u64()).unwrap_or(600).clamp(30, 900);
        let intervalle = r.json.get("intervalle").and_then(|v| v.as_u64()).unwrap_or(3).clamp(INTERVALLE_MIN_S, 60);
        let url = format!("{}/desktop/connecter?code={}", self.srv.base, code);
        let expire_le = (chrono::Utc::now() + chrono::Duration::seconds(duree as i64)).to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let ouverte = (self.ouvrir)(&url);
        let e = self.modifier(|e| {
            e.erreur = None;
            e.appairage = Some(AppairageVu {
                code_utilisateur: code.clone(),
                url: url.clone(),
                expire_le,
                etat: "en-attente".into(),
                message: ouverte.err().map(|m| format!("Navigateur non ouvert ({m}) : ouvrez l'adresse affichée.")),
            });
        });
        let moi = self.clone();
        std::thread::spawn(move || moi.interroger(gen, code_appareil, intervalle, Instant::now() + Duration::from_secs(duree)));
        Ok(e)
    }

    /// Arrête l'appairage en cours (le code expirera seul sur le serveur).
    pub fn annuler_appairage(&self) -> EtatCompte {
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.modifier(|e| e.appairage = None)
    }

    fn actif(&self, gen: u64) -> bool {
        self.generation.load(Ordering::SeqCst) == gen
    }

    fn fin_appairage(&self, gen: u64, etat: &str, message: String) {
        if !self.actif(gen) {
            return;
        }
        self.modifier(|e| {
            if let Some(a) = e.appairage.as_mut() {
                a.etat = etat.into();
                a.message = Some(message);
            }
        });
    }

    fn interroger(self: Arc<Self>, gen: u64, code_appareil: String, mut intervalle: u64, fin: Instant) {
        loop {
            // Attente par petits pas : une annulation arrête l'interrogation tout de suite.
            let reveil = Instant::now() + Duration::from_secs(intervalle) + Duration::from_millis(25);
            while Instant::now() < reveil {
                if !self.actif(gen) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            if !self.actif(gen) {
                return;
            }
            if Instant::now() >= fin {
                return self.fin_appairage(gen, "expire", "Code expiré (10 min) : relancez la liaison.".into());
            }
            let r = match appel(&self.srv, "POST", "/api/desktop/jeton", None, Some(&json!({ "codeAppareil": code_appareil }))) {
                Ok(r) => r,
                Err(m) => {
                    if self.actif(gen) {
                        self.modifier(|e| {
                            if let Some(a) = e.appairage.as_mut() {
                                a.message = Some(format!("{m} Nouvel essai dans {intervalle} s."));
                            }
                        });
                    }
                    continue;
                }
            };
            match r.statut {
                428 => {
                    if self.actif(gen) {
                        self.modifier(|e| {
                            if let Some(a) = e.appairage.as_mut() {
                                a.message = None;
                            }
                        });
                    }
                }
                429 => intervalle = (intervalle + 5).min(60),
                200 => return self.recevoir_cle(gen, &r.json),
                403 | 409 => return self.fin_appairage(gen, "refuse", r.message("Liaison refusée sur le site AETHRYON.")),
                410 => {
                    let etat = if r.json.get("etat").and_then(|v| v.as_str()) == Some("deja-utilise") { "deja-utilise" } else { "expire" };
                    return self.fin_appairage(gen, etat, r.message("Code expiré : relancez la liaison."));
                }
                404 => return self.fin_appairage(gen, "erreur", r.message("La liaison d'AETHRYON Desktop n'est pas ouverte sur le site.")),
                s => {
                    let m = r.message(&format!("Le site répond {s}."));
                    if s == 400 {
                        return self.fin_appairage(gen, "erreur", m);
                    }
                }
            }
        }
    }

    fn recevoir_cle(&self, gen: u64, j: &Value) {
        let cle = j.get("cle").and_then(|v| v.as_str()).filter(|c| c.starts_with("ytc_") && c.len() <= 200 && c.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'));
        let Some(cle) = cle else { return self.fin_appairage(gen, "erreur", "Réponse inattendue du site : liaison impossible.".into()) };
        let s = |k: &str| j.get("compte").and_then(|c| c.get(k)).and_then(|v| v.as_str()).map(nettoyer).unwrap_or_default();
        let l = Liaison { cle: cle.into(), expire_le: j.get("expireLe").and_then(|v| v.as_str()).map(nettoyer), email: s("email"), nom: s("nom"), relie_le: maintenant() };
        if let Err(e) = self.coffre.ecrire(&l) {
            crate::journal::avert("compte", &format!("Liaison non enregistrée dans le coffre ({e})."));
            return self.fin_appairage(gen, "erreur", "La liaison n'a pas pu être enregistrée sur cet ordinateur.".into());
        }
        crate::journal::info("compte", "AETHRYON Desktop relié au compte.");
        *self.liaison.lock().unwrap_or_else(|e| e.into_inner()) = Some(l.clone());
        if !self.actif(gen) {
            // Annulé pendant la remise : la clé est gardée (elle a été délivrée), l'état le dit.
        }
        self.modifier(|e| {
            e.relie = true;
            e.compte = Some(CompteVu { email: l.email.clone(), nom: l.nom.clone() });
            e.cle_expire_le = l.expire_le.clone();
            e.relie_le = Some(l.relie_le.clone());
            e.erreur = None;
            if let Some(a) = e.appairage.as_mut() {
                a.etat = "autorise".into();
                a.message = None;
            }
        });
        self.rafraichir();
        self.modifier(|e| e.appairage = None);
    }

    /// Relit le compte (`/api/desktop/moi`) : rôle, état du cloud ; clé refusée → liaison effacée.
    pub fn rafraichir(&self) -> EtatCompte {
        let Some(cle) = self.cle() else { return self.etat() };
        match appel(&self.srv, "GET", "/api/desktop/moi", Some(&cle), None) {
            Err(m) => self.modifier(|e| {
                e.hors_ligne = true;
                e.erreur = Some(m);
            }),
            Ok(r) if r.statut == 200 => {
                let j = &r.json;
                let s = |a: &str, k: &str| j.get(a).and_then(|c| c.get(k)).and_then(|v| v.as_str()).map(nettoyer);
                let admin = j.get("administrateur").and_then(|v| v.as_bool());
                let dispo = j.get("cloud").and_then(|c| c.get("disponible")).and_then(|v| v.as_bool()).unwrap_or(false);
                let raison = s("cloud", "raison").filter(|r| matches!(r.as_str(), "non_admin" | "ferme"));
                self.modifier(|e| {
                    e.relie = true;
                    e.compte = Some(CompteVu { email: s("compte", "email").unwrap_or_default(), nom: s("compte", "nom").unwrap_or_default() });
                    e.administrateur = admin;
                    e.cloud = Some(CloudVu { disponible: dispo && admin == Some(true), raison });
                    e.cle_expire_le = s("cle", "expireLe").or(e.cle_expire_le.clone());
                    e.hors_ligne = false;
                    e.erreur = None;
                    e.verifie_le = Some(maintenant());
                })
            }
            Ok(r) if r.statut == 401 => {
                let m = r.message("La liaison d'AETHRYON Desktop n'est plus valable : reliez-le de nouveau.");
                self.oublier(Some(m))
            }
            Ok(r) => {
                let m = r.message(&format!("Le site répond {}.", r.statut));
                self.modifier(|e| {
                    e.hors_ligne = r.statut >= 500;
                    e.erreur = Some(m);
                })
            }
        }
    }

    /// Clé refusée par le serveur (401) : liaison effacée de cet ordinateur.
    pub fn oublier(&self, raison: Option<String>) -> EtatCompte {
        if let Err(e) = self.coffre.effacer() {
            crate::journal::avert("compte", &format!("Liaison non effacée ({e})."));
        }
        *self.liaison.lock().unwrap_or_else(|e| e.into_inner()) = None;
        crate::journal::info("compte", "Liaison au compte effacée de cet ordinateur.");
        self.modifier(|e| {
            *e = EtatCompte { erreur: raison, ..EtatCompte::default() };
        })
    }

    /// « Se déconnecter » : la clé est révoquée sur le serveur (si joignable), puis effacée ici dans tous les cas.
    pub fn deconnecter(&self) -> EtatCompte {
        self.generation.fetch_add(1, Ordering::SeqCst);
        let mut avis = None;
        if let Some(cle) = self.cle() {
            match appel(&self.srv, "POST", "/api/desktop/deconnexion", Some(&cle), None) {
                Ok(r) if r.statut == 204 || r.statut == 401 => {}
                Ok(r) => avis = Some(format!("Déconnecté de cet ordinateur ; le site a répondu {} : révoquez l'accès dans « Mes jetons » du site si besoin.", r.statut)),
                Err(_) => avis = Some("Déconnecté de cet ordinateur ; le site était injoignable : révoquez l'accès dans « Mes jetons » du site.".into()),
            }
        }
        self.oublier(avis)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::essais_http::{Reponse, Serveur as Banc};
    use std::sync::atomic::AtomicUsize;

    fn gestion(b: &Banc, dossier: &std::path::Path, ouvertes: Arc<Mutex<Vec<String>>>) -> (Arc<GestionCompte>, Arc<Mutex<Vec<EtatCompte>>>) {
        let avis: Arc<Mutex<Vec<EtatCompte>>> = Arc::default();
        let a2 = avis.clone();
        let g = GestionCompte::new(
            Serveur::essai(&b.base, b.autorite.clone()),
            Coffre::sous(dossier),
            "PC-ESSAI".into(),
            "1.1.0-beta.1".into(),
            Box::new(move |e| a2.lock().unwrap().push(e.clone())),
            Box::new(move |u| {
                ouvertes.lock().unwrap().push(u.to_string());
                Ok(())
            }),
        );
        (g, avis)
    }

    fn attendre(g: &GestionCompte, f: impl Fn(&EtatCompte) -> bool) -> EtatCompte {
        let t = Instant::now();
        loop {
            let e = g.etat();
            if f(&e) {
                return e;
            }
            assert!(t.elapsed() < Duration::from_secs(10), "état jamais atteint : {e:?}");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    const CLE: &str = "ytc_AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEfGhIjKlMnOpQrStUvWxYzAbCdEfGhIjKl";

    #[test]
    fn appairage_complet_puis_moi_puis_deconnexion() {
        let polls = Arc::new(AtomicUsize::new(0));
        let p2 = polls.clone();
        let b = Banc::demarrer(move |r| match (r.methode.as_str(), r.chemin()) {
            ("POST", "/api/desktop/appairage") => {
                assert!(r.entete("origin").is_none(), "aucune origine");
                assert_eq!(r.json()["hote"], "PC-ESSAI");
                Reponse::Json(200, json!({ "codeAppareil": "A".repeat(43), "codeUtilisateur": "BCDF-GHJK", "urlVerification": "https://ailleurs.example/piege", "expireDans": 600, "intervalle": 0 }))
            }
            ("POST", "/api/desktop/jeton") => {
                if p2.fetch_add(1, Ordering::SeqCst) < 2 {
                    Reponse::Json(428, json!({ "etat": "en-attente", "message": "En attente." }))
                } else {
                    Reponse::Json(200, json!({ "cle": CLE, "expireLe": "2026-11-22T10:00:00.000Z", "compte": { "email": "admin@example.test", "nom": "Admin\u{0007}" } }))
                }
            }
            ("GET", "/api/desktop/moi") => {
                assert_eq!(r.entete("authorization"), Some(format!("Bearer {CLE}").as_str()));
                Reponse::Json(200, json!({ "compte": { "email": "admin@example.test", "nom": "Admin" }, "administrateur": true, "cloud": { "disponible": true, "raison": null }, "cle": { "expireLe": "2026-11-22T10:00:00.000Z" } }))
            }
            ("POST", "/api/desktop/deconnexion") => Reponse::Json(204, Value::Null),
            _ => Reponse::Json(404, json!({ "error": "x" })),
        });
        let d = tempfile::tempdir().unwrap();
        let ouvertes: Arc<Mutex<Vec<String>>> = Arc::default();
        let (g, avis) = gestion(&b, d.path(), ouvertes.clone());
        assert!(!g.etat().relie);
        let e = g.demarrer_appairage().unwrap();
        let a = e.appairage.unwrap();
        assert_eq!(a.code_utilisateur, "BCDF-GHJK");
        assert_eq!(a.url, format!("{}/desktop/connecter?code=BCDF-GHJK", b.base), "adresse construite depuis la base, jamais reprise de la réponse");
        assert_eq!(ouvertes.lock().unwrap().as_slice(), [a.url.clone()]);
        let e = attendre(&g, |e| e.relie && e.appairage.is_none() && e.cloud.is_some());
        assert_eq!(e.compte, Some(CompteVu { email: "admin@example.test".into(), nom: "Admin".into() }));
        assert_eq!(e.administrateur, Some(true));
        assert_eq!(e.cloud, Some(CloudVu { disponible: true, raison: None }));
        assert_eq!(g.cle().as_deref(), Some(CLE));
        // La clé n'est JAMAIS dans ce que voit l'interface (états sérialisés, avis).
        for x in avis.lock().unwrap().iter() {
            assert!(!serde_json::to_string(x).unwrap().contains("ytc_"), "aucune clé dans l'état : {x:?}");
        }
        // Une nouvelle instance (redémarrage) relit la liaison du coffre.
        let (g2, _) = gestion(&b, d.path(), Arc::default());
        assert!(g2.etat().relie);
        assert_eq!(g2.cle().as_deref(), Some(CLE));
        let e = g2.deconnecter();
        assert!(!e.relie && e.erreur.is_none(), "{e:?}");
        assert_eq!(g2.cle(), None);
        assert_eq!(Coffre::sous(d.path()).lire().unwrap(), None, "liaison effacée");
        assert_eq!(b.vues("POST", "/api/desktop/deconnexion").len(), 1);
    }

    #[test]
    fn refus_expiration_rejeu_et_trop_rapide() {
        for (statut, corps, attendu) in [
            (403, json!({ "etat": "refuse", "message": "Liaison refusée sur le site AETHRYON." }), "refuse"),
            (410, json!({ "etat": "expire", "message": "Ce code a expiré." }), "expire"),
            (410, json!({ "etat": "deja-utilise", "message": "Ce code a déjà servi." }), "deja-utilise"),
            (409, json!({ "error": "too_many_desktop", "etat": "refuse", "message": "Tu as déjà 3 ordinateurs reliés." }), "refuse"),
        ] {
            let n = Arc::new(AtomicUsize::new(0));
            let n2 = n.clone();
            let c2 = corps.clone();
            let b = Banc::demarrer(move |r| match r.chemin() {
                "/api/desktop/appairage" => Reponse::Json(200, json!({ "codeAppareil": "B".repeat(43), "codeUtilisateur": "BCDF-GHJK", "expireDans": 600, "intervalle": 0 })),
                "/api/desktop/jeton" => {
                    if n2.fetch_add(1, Ordering::SeqCst) == 0 {
                        Reponse::Json(429, json!({ "etat": "trop-rapide" }))
                    } else {
                        Reponse::Json(statut, c2.clone())
                    }
                }
                _ => Reponse::Json(404, Value::Null),
            });
            let d = tempfile::tempdir().unwrap();
            let (g, _) = gestion(&b, d.path(), Arc::default());
            g.demarrer_appairage().unwrap();
            let e = attendre(&g, |e| e.appairage.as_ref().is_some_and(|a| a.etat != "en-attente"));
            let a = e.appairage.unwrap();
            assert_eq!(a.etat, attendu, "{statut} {corps}");
            assert_eq!(a.message.as_deref(), corps["message"].as_str());
            assert!(!e.relie && g.cle().is_none());
        }
    }

    #[test]
    fn annulation_et_cle_revoquee() {
        let b = Banc::demarrer(move |r| match r.chemin() {
            "/api/desktop/appairage" => Reponse::Json(200, json!({ "codeAppareil": "C".repeat(43), "codeUtilisateur": "BCDF-GHJK", "expireDans": 600, "intervalle": 1 })),
            "/api/desktop/jeton" => Reponse::Json(428, json!({ "etat": "en-attente" })),
            "/api/desktop/moi" => Reponse::Json(401, json!({ "error": "token_revoked", "message": "L'accès d'AETHRYON Desktop à ton compte a été révoqué : reliez-le de nouveau pour continuer.", "revokedBy": "user" })),
            _ => Reponse::Json(404, Value::Null),
        });
        let d = tempfile::tempdir().unwrap();
        let (g, _) = gestion(&b, d.path(), Arc::default());
        g.demarrer_appairage().unwrap();
        let e = g.annuler_appairage();
        assert!(e.appairage.is_none());
        std::thread::sleep(Duration::from_millis(1300));
        assert!(b.vues("POST", "/api/desktop/jeton").len() <= 1, "l'interrogation s'arrête à l'annulation");
        // Liaison existante dont la clé a été révoquée dans « Mes jetons » : effacée, le message du site est gardé.
        Coffre::sous(d.path()).ecrire(&Liaison { cle: CLE.into(), expire_le: None, email: "a@example.test".into(), nom: "A".into(), relie_le: "x".into() }).unwrap();
        let (g2, _) = gestion(&b, d.path(), Arc::default());
        let e = g2.rafraichir();
        assert!(!e.relie);
        assert!(e.erreur.unwrap().contains("révoqué"));
        assert_eq!(Coffre::sous(d.path()).lire().unwrap(), None);
    }

    #[test]
    fn site_injoignable_garde_la_liaison() {
        let d = tempfile::tempdir().unwrap();
        Coffre::sous(d.path()).ecrire(&Liaison { cle: CLE.into(), expire_le: None, email: "a@example.test".into(), nom: "A".into(), relie_le: "x".into() }).unwrap();
        // Adresse où rien n'écoute : la liaison reste, l'état dit « hors ligne ».
        let g = GestionCompte::new(Serveur::essai("https://127.0.0.1:9", vec![]), Coffre::sous(d.path()), "PC".into(), "1".into(), Box::new(|_| {}), Box::new(|_| Ok(())));
        let e = g.rafraichir();
        assert!(e.relie && e.hors_ligne, "{e:?}");
        assert!(g.cle().is_some());
        // HTTPS seulement : une base http est refusée avant toute connexion.
        let r = appel(&Serveur::essai("http://127.0.0.1:9", vec![]), "GET", "/api/desktop/moi", None, None);
        assert!(r.unwrap_err().contains("HTTPS"));
    }
}

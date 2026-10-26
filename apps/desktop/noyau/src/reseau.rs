//! Lecture HTTPS de fichiers PUBLICS du site (latest.json, archive de l'extension, setup). Règles :
//! - HTTPS seulement (refus avant toute connexion, et `https_only` de ureq) ;
//! - aucune redirection suivie : un 3xx est un refus ;
//! - statut 200 exigé, taille bornée (en-tête Content-Length ET octets réellement reçus) ;
//! - ni cookie, ni jeton, ni identifiant : seulement « User-Agent: AETHRYON-Desktop/<version> » ;
//! - racines de confiance de Mozilla (webpki-roots), embarquées : le même comportement sous Windows et sous Wine.
//!   NON TESTÉ SOUS WINDOWS : un antivirus qui intercepte le HTTPS avec sa propre autorité fera échouer la lecture
//!   (l'extension retombe alors sur la page de téléchargement).
//!
//! Les adresses de production sont figées dans `maj_extension` et `maj_desktop` ; une autre base n'est possible que
//! dans les essais (`cfg(test)`) et dans le banc Linux (fonctionnalité `essais`, jamais pour l'exe Windows).

use std::io::Read;
use std::time::Duration;

/// Autorités de confiance.
#[derive(Clone, Debug)]
pub enum Racines {
    /// Production : racines de Mozilla (webpki-roots).
    Mozilla,
    /// Essais seulement : une autorité locale (DER).
    #[cfg(any(test, feature = "essais"))]
    Essai(Vec<u8>),
}

pub(crate) fn agent(r: &Racines, delai: Duration) -> ureq::Agent {
    #[allow(unused_mut)]
    let mut tls = ureq::tls::TlsConfig::builder();
    #[cfg(any(test, feature = "essais"))]
    if let Racines::Essai(der) = r {
        tls = tls.root_certs(ureq::tls::RootCerts::new_with_certs(&[ureq::tls::Certificate::from_der(der).to_owned()]));
    }
    #[cfg(not(any(test, feature = "essais")))]
    let _ = r;
    ureq::Agent::config_builder()
        .https_only(true)
        .max_redirects(0)
        .http_status_as_error(false)
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_global(Some(delai))
        .user_agent(format!("AETHRYON-Desktop/{}", crate::VERSION))
        .tls_config(tls.build())
        .build()
        .into()
}

pub(crate) fn message(e: &ureq::Error) -> String {
    use ureq::Error as E;
    match e {
        E::Timeout(_) => "Délai dépassé : le site ne répond pas assez vite.".into(),
        E::HostNotFound | E::ConnectionFailed => "Site injoignable : vérifie la connexion à Internet.".into(),
        // rustls rend ses refus de certificat sous forme d'erreur d'entrée-sortie (InvalidData).
        E::Io(io) if io.kind() == std::io::ErrorKind::InvalidData || io.to_string().contains("certificate") => "Connexion sécurisée refusée (certificat du site non reconnu).".into(),
        E::Io(_) => "Connexion interrompue pendant le téléchargement.".into(),
        E::TooManyRedirects | E::RedirectFailed => "Redirection refusée : seul le fichier attendu est lu, à son adresse exacte.".into(),
        E::RequireHttpsOnly(_) => "Adresse refusée : HTTPS seulement.".into(),
        E::BodyExceedsLimit(_) => "Fichier plus grand qu'annoncé : téléchargement arrêté.".into(),
        E::Tls(_) | E::Rustls(_) => "Connexion sécurisée refusée (certificat du site non reconnu).".into(),
        _ => format!("Lecture impossible depuis le site ({e})."),
    }
}

/// GET de `url` (HTTPS), corps de `max` octets au plus. `avance(reçus, annoncés)` après chaque bloc.
pub fn obtenir(r: &Racines, url: &str, max: u64, delai: Duration, avance: &mut dyn FnMut(u64, Option<u64>)) -> Result<Vec<u8>, String> {
    if !url.starts_with("https://") {
        return Err("Adresse refusée : HTTPS seulement.".into());
    }
    let mut rep = agent(r, delai).get(url).header("Accept", "*/*").header("Cache-Control", "no-cache").call().map_err(|e| message(&e))?;
    let s = rep.status().as_u16();
    if (300..400).contains(&s) {
        return Err("Redirection refusée : seul le fichier attendu est lu, à son adresse exacte.".into());
    }
    if s != 200 {
        return Err(if s == 404 { "Fichier absent du site (404) : rien n'est encore publié.".into() } else { format!("Le site répond {s}.") });
    }
    let annonce = rep.body().content_length();
    if annonce.is_some_and(|n| n > max) {
        return Err("Fichier plus grand qu'annoncé : téléchargement refusé.".into());
    }
    let mut lecteur = rep.body_mut().with_config().limit(max.saturating_add(1)).reader();
    let mut v = Vec::with_capacity(annonce.unwrap_or(0).min(max) as usize);
    let mut bloc = vec![0u8; 64 * 1024];
    loop {
        let n = lecteur.read(&mut bloc).map_err(|e| {
            if e.to_string().contains("limit") {
                "Fichier plus grand qu'annoncé : téléchargement arrêté.".to_string()
            } else {
                "Connexion interrompue pendant le téléchargement.".to_string()
            }
        })?;
        if n == 0 {
            break;
        }
        v.extend_from_slice(&bloc[..n]);
        if v.len() as u64 > max {
            return Err("Fichier plus grand qu'annoncé : téléchargement arrêté.".into());
        }
        avance(v.len() as u64, annonce);
    }
    if annonce.is_some_and(|n| n != v.len() as u64) {
        return Err("Connexion interrompue pendant le téléchargement.".into());
    }
    Ok(v)
}

/// Serveur HTTPS local des essais : autorité et certificat produits à la volée (rcgen), réponses programmées.
#[cfg(test)]
pub(crate) mod serveur_essai {
    use std::collections::HashMap;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    #[derive(Clone)]
    pub enum Reponse {
        Ok(Vec<u8>, &'static str),
        Redirection(String),
        Statut(u16),
        /// Content-Length annoncé, puis la connexion se coupe après ces octets.
        Coupee(Vec<u8>, u64),
    }

    pub struct Serveur {
        pub base: String,
        pub autorite: Vec<u8>,
        routes: Arc<Mutex<HashMap<String, Reponse>>>,
        pub requetes: Arc<Mutex<Vec<String>>>,
    }

    impl Serveur {
        pub fn demarrer() -> Serveur {
            use rcgen::{BasicConstraints, CertificateParams, IsCa, KeyPair, SanType};
            let mut p_ca = CertificateParams::new(Vec::<String>::new()).unwrap();
            p_ca.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
            let k_ca = KeyPair::generate().unwrap();
            let ca = p_ca.self_signed(&k_ca).unwrap();
            let mut p = CertificateParams::new(Vec::<String>::new()).unwrap();
            p.subject_alt_names = vec![SanType::IpAddress([127, 0, 0, 1].into())];
            let k = KeyPair::generate().unwrap();
            let feuille = p.signed_by(&k, &ca, &k_ca).unwrap();
            let cle = rustls::pki_types::PrivateKeyDer::Pkcs8(rustls::pki_types::PrivatePkcs8KeyDer::from(k.serialize_der()));
            let cfg = Arc::new(
                rustls::ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
                    .with_safe_default_protocol_versions()
                    .unwrap()
                    .with_no_client_auth()
                    .with_single_cert(vec![feuille.der().clone()], cle)
                    .unwrap(),
            );
            let l = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = l.local_addr().unwrap().port();
            let routes: Arc<Mutex<HashMap<String, Reponse>>> = Arc::default();
            let requetes: Arc<Mutex<Vec<String>>> = Arc::default();
            let (r2, q2) = (routes.clone(), requetes.clone());
            std::thread::spawn(move || {
                for flux in l.incoming().flatten() {
                    let (cfg, r, q) = (cfg.clone(), r2.clone(), q2.clone());
                    std::thread::spawn(move || {
                        let Ok(c) = rustls::ServerConnection::new(cfg) else { return };
                        let mut t = rustls::StreamOwned::new(c, flux);
                        let mut tete = Vec::new();
                        let mut o = [0u8; 1];
                        while !tete.ends_with(b"\r\n\r\n") && tete.len() < 8192 {
                            match t.read(&mut o) {
                                Ok(1) => tete.push(o[0]),
                                _ => return,
                            }
                        }
                        let ligne = String::from_utf8_lossy(&tete).lines().next().unwrap_or("").to_string();
                        let chemin = ligne.split(' ').nth(1).unwrap_or("").to_string();
                        q.lock().unwrap().push(chemin.clone());
                        let rep = r.lock().unwrap().get(&chemin).cloned().unwrap_or(Reponse::Statut(404));
                        let _ = match rep {
                            Reponse::Ok(d, ty) => t.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: {ty}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", d.len()).as_bytes()).and_then(|_| t.write_all(&d)),
                            Reponse::Redirection(vers) => t.write_all(format!("HTTP/1.1 302 Found\r\nLocation: {vers}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes()),
                            Reponse::Statut(s) => t.write_all(format!("HTTP/1.1 {s} X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes()),
                            Reponse::Coupee(d, n) => t.write_all(format!("HTTP/1.1 200 OK\r\nContent-Length: {n}\r\nConnection: close\r\n\r\n").as_bytes()).and_then(|_| t.write_all(&d)),
                        };
                        let _ = t.flush();
                        t.conn.send_close_notify();
                        let _ = t.flush();
                    });
                }
            });
            Serveur { base: format!("https://127.0.0.1:{port}/"), autorite: ca.der().to_vec(), routes, requetes }
        }
        pub fn route(&self, chemin: &str, r: Reponse) {
            self.routes.lock().unwrap().insert(chemin.to_string(), r);
        }
        pub fn vus(&self, chemin: &str) -> usize {
            self.requetes.lock().unwrap().iter().filter(|c| *c == chemin).count()
        }
        pub fn racines(&self) -> super::Racines {
            super::Racines::Essai(self.autorite.clone())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::serveur_essai::{Reponse, Serveur};
    use super::*;

    const D: Duration = Duration::from_secs(10);

    #[test]
    fn https_seulement_et_taille_bornee() {
        let s = Serveur::demarrer();
        s.route("/a.json", Reponse::Ok(b"{\"x\":1}".to_vec(), "application/json"));
        s.route("/gros", Reponse::Ok(vec![b'x'; 5000], "application/octet-stream"));
        s.route("/coupe", Reponse::Coupee(vec![b'x'; 100], 4000));
        let r = s.racines();
        assert_eq!(obtenir(&r, &format!("{}a.json", s.base), 100, D, &mut |_, _| {}).unwrap(), b"{\"x\":1}");
        assert!(obtenir(&r, &format!("{}a.json", s.base).replace("https://", "http://"), 100, D, &mut |_, _| {}).unwrap_err().contains("HTTPS"));
        assert!(obtenir(&r, &format!("{}gros", s.base), 4096, D, &mut |_, _| {}).unwrap_err().contains("plus grand"));
        assert!(obtenir(&r, &format!("{}coupe", s.base), 8192, D, &mut |_, _| {}).unwrap_err().contains("interrompue"));
        assert!(obtenir(&r, &format!("{}absent", s.base), 100, D, &mut |_, _| {}).unwrap_err().contains("404"));
        // Autorité inconnue (racines de Mozilla) : refus du certificat local.
        let e = obtenir(&Racines::Mozilla, &format!("{}a.json", s.base), 100, D, &mut |_, _| {}).unwrap_err();
        assert!(e.contains("certificat"), "{e}");
    }

    #[test]
    fn redirection_jamais_suivie() {
        let s = Serveur::demarrer();
        s.route("/latest.json", Reponse::Redirection(format!("{}ailleurs.json", s.base)));
        s.route("/ailleurs.json", Reponse::Ok(b"{}".to_vec(), "application/json"));
        let e = obtenir(&s.racines(), &format!("{}latest.json", s.base), 100, D, &mut |_, _| {}).unwrap_err();
        assert!(e.contains("Redirection refusée"), "{e}");
        assert_eq!(s.vus("/ailleurs.json"), 0, "la cible de la redirection n'est jamais demandée");
    }
}

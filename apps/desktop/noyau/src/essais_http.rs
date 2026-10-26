//! Serveur HTTPS LOCAL des essais du compte et du cloud (127.0.0.1, autorité produite à la volée par rcgen) : chaque
//! requête (méthode, chemin, en-têtes, corps lu selon Content-Length) est remise à un gestionnaire écrit par l'essai,
//! qui joue tour à tour account (`/api/desktop/*`, `/api/cloud/*`) et le fournisseur S3 (URL présignées). Il sait aussi
//! couper une réponse en plein corps, couper la connexion pendant un envoi, et ralentir un corps (annulation).
#![cfg(test)]

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Clone, Debug)]
pub struct Requete {
    pub methode: String,
    /// Chemin ET requête (`/seau/x?X-Amz-Signature=…`).
    pub cible: String,
    /// Noms en minuscules.
    pub entetes: HashMap<String, String>,
    pub corps: Vec<u8>,
    /// Le corps annoncé n'est pas arrivé en entier (connexion coupée par le client).
    pub incomplet: bool,
}

impl Requete {
    pub fn chemin(&self) -> &str {
        self.cible.split('?').next().unwrap_or("")
    }
    pub fn json(&self) -> serde_json::Value {
        serde_json::from_slice(&self.corps).unwrap_or(serde_json::Value::Null)
    }
    pub fn entete(&self, n: &str) -> Option<&str> {
        self.entetes.get(n).map(|s| s.as_str())
    }
}

#[derive(Clone, Debug)]
pub enum Reponse {
    Json(u16, serde_json::Value),
    Octets(u16, Vec<u8>, &'static str),
    /// Content-Length annoncé, puis la connexion se coupe après ces octets.
    Coupee(Vec<u8>, u64),
    /// Corps envoyé par blocs de `bloc` octets, `pause` entre deux blocs (annulation pendant un téléchargement).
    Lente(Vec<u8>, usize, Duration),
    /// Comme `Lente`, avec un statut et des en-têtes choisis (`206` + `Content-Range` : reprise par plage d'octets).
    LenteAvec { statut: u16, entetes: Vec<(String, String)>, corps: Vec<u8>, bloc: usize, pause: Duration },
}

type Gestionnaire = dyn Fn(&Requete) -> Reponse + Send + Sync;

pub struct Serveur {
    pub base: String,
    pub autorite: Vec<u8>,
    pub requetes: Arc<Mutex<Vec<Requete>>>,
    /// Coupe la connexion après ce nombre d'octets de CORPS reçus (envoi interrompu), une fois.
    pub couper_apres: Arc<Mutex<Option<usize>>>,
}

impl Serveur {
    pub fn demarrer(g: impl Fn(&Requete) -> Reponse + Send + Sync + 'static) -> Serveur {
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
        let requetes: Arc<Mutex<Vec<Requete>>> = Arc::default();
        let couper_apres: Arc<Mutex<Option<usize>>> = Arc::default();
        let g: Arc<Gestionnaire> = Arc::new(g);
        let (q2, c2) = (requetes.clone(), couper_apres.clone());
        std::thread::spawn(move || {
            for flux in l.incoming().flatten() {
                let (cfg, q, g, coupe) = (cfg.clone(), q2.clone(), g.clone(), c2.clone());
                std::thread::spawn(move || servir(flux, cfg, q, g, coupe));
            }
        });
        Serveur { base: format!("https://127.0.0.1:{port}"), autorite: ca.der().to_vec(), requetes, couper_apres }
    }

    pub fn vues(&self, methode: &str, prefixe: &str) -> Vec<Requete> {
        self.requetes.lock().unwrap().iter().filter(|r| r.methode == methode && r.chemin().starts_with(prefixe)).cloned().collect()
    }
}

fn servir(flux: std::net::TcpStream, cfg: Arc<rustls::ServerConfig>, q: Arc<Mutex<Vec<Requete>>>, g: Arc<Gestionnaire>, coupe: Arc<Mutex<Option<usize>>>) {
    let _ = flux.set_read_timeout(Some(Duration::from_secs(20)));
    let Ok(c) = rustls::ServerConnection::new(cfg) else { return };
    let mut t = rustls::StreamOwned::new(c, flux);
    let mut tete = Vec::new();
    let mut o = [0u8; 1];
    while !tete.ends_with(b"\r\n\r\n") && tete.len() < 16384 {
        match t.read(&mut o) {
            Ok(1) => tete.push(o[0]),
            _ => return,
        }
    }
    let texte = String::from_utf8_lossy(&tete).to_string();
    let mut lignes = texte.split("\r\n");
    let premiere = lignes.next().unwrap_or("");
    let mut morceaux = premiere.split(' ');
    let methode = morceaux.next().unwrap_or("").to_string();
    let cible = morceaux.next().unwrap_or("").to_string();
    let mut entetes = HashMap::new();
    for l in lignes {
        if let Some((n, v)) = l.split_once(':') {
            entetes.insert(n.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }
    let annonce: usize = entetes.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    // La coupure simulée ne vise que les envois (PUT) : réservations et confirmations passent.
    let limite = if methode == "PUT" { coupe.lock().unwrap().take() } else { None };
    let mut corps = Vec::with_capacity(annonce.min(1 << 24));
    let mut bloc = vec![0u8; 16 * 1024];
    let mut incomplet = false;
    while corps.len() < annonce {
        if let Some(n) = limite {
            if corps.len() >= n {
                incomplet = true;
                break;
            }
        }
        let max = (annonce - corps.len()).min(bloc.len());
        match t.read(&mut bloc[..max]) {
            Ok(0) | Err(_) => {
                incomplet = true;
                break;
            }
            Ok(k) => corps.extend_from_slice(&bloc[..k]),
        }
    }
    let r = Requete { methode, cible, entetes, corps, incomplet };
    q.lock().unwrap().push(r.clone());
    if incomplet && limite.is_some() {
        // Coupure simulée côté serveur : la connexion se ferme sans réponse.
        let _ = t.sock.shutdown(std::net::Shutdown::Both);
        return;
    }
    let rep = g(&r);
    let _ = match rep {
        Reponse::Json(s, v) => {
            let d = serde_json::to_vec(&v).unwrap();
            t.write_all(format!("HTTP/1.1 {s} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", d.len()).as_bytes()).and_then(|_| t.write_all(&d))
        }
        Reponse::Octets(s, d, ty) => t.write_all(format!("HTTP/1.1 {s} X\r\nContent-Type: {ty}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", d.len()).as_bytes()).and_then(|_| t.write_all(&d)),
        Reponse::Coupee(d, n) => t.write_all(format!("HTTP/1.1 200 OK\r\nContent-Length: {n}\r\nConnection: close\r\n\r\n").as_bytes()).and_then(|_| t.write_all(&d)),
        Reponse::LenteAvec { statut, entetes, corps, bloc, pause } => {
            let tete: String = entetes.iter().map(|(n, v)| format!("{n}: {v}\r\n")).collect();
            let mut r = t.write_all(format!("HTTP/1.1 {statut} X\r\nContent-Type: video/mp4\r\n{tete}Content-Length: {}\r\nConnection: close\r\n\r\n", corps.len()).as_bytes());
            for morceau in corps.chunks(bloc.max(1)) {
                if r.is_err() {
                    break;
                }
                r = t.write_all(morceau).and_then(|_| t.flush());
                std::thread::sleep(pause);
            }
            r
        }
        Reponse::Lente(d, b, pause) => {
            let mut r = t.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", d.len()).as_bytes());
            for morceau in d.chunks(b.max(1)) {
                if r.is_err() {
                    break;
                }
                r = t.write_all(morceau).and_then(|_| t.flush());
                std::thread::sleep(pause);
            }
            r
        }
    };
    let _ = t.flush();
    t.conn.send_close_notify();
    let _ = t.flush();
}

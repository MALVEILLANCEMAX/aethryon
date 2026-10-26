//! Imports suivis de la section MUSIQUE : seulement pour une source qui AUTORISE le téléchargement (le serveur le
//! décide et relit la source ; le cœur ne fait que transmettre le corps de l'action `importer` de la fiche).
//!
//! 1. `POST /api/music/imports` → identifiant `mus_…` ;
//! 2. suivi `GET /api/music/imports/{id}` toutes les 1,2 s : la progression montrée est CELLE DU SERVEUR (octets
//!    reçus, total s'il est connu ; jamais de pourcentage inventé) ;
//! 3. à `termine` : rapatriement de `GET /api/music/imports/{id}/fichier` dans `<dossier des médias>\Musique\`
//!    (`.part` exclusif, octets comptés, taille vérifiée contre celle annoncée, renommage sans écrasement) ;
//! 4. provenance (licence, attribution, lien, déclaration, cloud) gardée à part ; historique mis à jour ; l'index
//!    reprend le fichier au passage suivant (surveillance).
//!
//! Annulation : à tout moment ; le serveur est prévenu (`…/annuler`), le `.part` est effacé. Un import terminé côté
//! serveur reste téléchargeable 60 min ; une copie locale n'est jamais supprimée par l'AETHRYON Cloud.

use super::client::{id_import_valide, ClientMusique};
use super::donnees::{EntreeHistorique, Magasin, Provenance};
use crate::compte::{GestionCompte, Serveur};
use crate::{flux, horloge, journal, noms, reseau};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const SOUS_DOSSIER: &str = "Musique";
const FICHIER_MAX: u64 = 600 * 1024 * 1024;
#[cfg(not(test))]
const INTERVALLE: Duration = Duration::from_millis(1200);
#[cfg(test)]
const INTERVALLE: Duration = Duration::from_millis(20);
const SUIVI_MAX: u32 = 3 * 3600;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Avancement {
    pub octets: u64,
    pub total: Option<u64>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportSuivi {
    /// Identifiant local (`imp_…`), stable dès la demande.
    pub id: String,
    pub distant: Option<String>,
    pub url: String,
    pub connecteur: String,
    pub titre: Option<String>,
    pub artistes: Vec<String>,
    pub pochette: Option<String>,
    /// `demande`, puis les états du serveur (`en_file`, `telechargement`, `verification`, `etiquetage`), puis
    /// `rapatriement` (copie sur l'ordinateur), `termine`, `echec` ou `annule`.
    pub etape: String,
    pub serveur: Option<Avancement>,
    pub local: Option<Avancement>,
    pub licence: Option<Value>,
    pub attribution: Option<String>,
    pub cloud: Option<Value>,
    pub audio: Option<Value>,
    pub code: Option<String>,
    pub message: Option<String>,
    pub chemin: Option<String>,
    pub media_id: Option<String>,
    pub maj_le: String,
}

impl ImportSuivi {
    fn actif(&self) -> bool {
        !["termine", "echec", "annule"].contains(&self.etape.as_str())
    }
}

pub type AvisImport = Box<dyn Fn(&ImportSuivi) + Send + Sync>;

/// Où et comment l'import se fait (le dossier des médias et le rescan viennent du service).
pub struct Cible {
    pub dossier_medias: PathBuf,
    pub rescanner: Box<dyn Fn() + Send + Sync>,
}

/// Fiche minimale de l'import (affichage pendant l'import).
#[derive(Clone, Debug, Default)]
pub struct Presentation {
    pub url: String,
    pub connecteur: String,
    pub titre: Option<String>,
    pub artistes: Vec<String>,
    pub pochette: Option<String>,
}

pub struct Imports {
    compte: Arc<GestionCompte>,
    magasin: Arc<Magasin>,
    avis: Arc<AvisImport>,
    liste: Arc<Mutex<Vec<ImportSuivi>>>,
    annules: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str()).map(|x| x.chars().filter(|c| !c.is_control()).take(400).collect())
}

fn avancement(v: &Value) -> Option<Avancement> {
    let p = v.get("progression")?;
    Some(Avancement { octets: p.get("octets").and_then(|x| x.as_u64()).unwrap_or(0), total: p.get("total").and_then(|x| x.as_u64()).filter(|t| *t > 0) })
}

/// Rapatrie le fichier d'un import terminé (`/api/music/imports/{id}/fichier`, clé « desktop » en Bearer).
pub fn rapatrier(srv: &Serveur, cle: &str, id: &str, nom: &str, taille: Option<u64>, dossier: &Path, annule: &AtomicBool, avance: &mut dyn FnMut(u64)) -> Result<PathBuf, (String, String)> {
    let e = |c: &str, m: String| (c.to_string(), m);
    if !id_import_valide(id) {
        return Err(e("requete_invalide", "Identifiant d'import invalide.".into()));
    }
    let propre = noms::nettoyer_nom_fichier(nom);
    let ext = propre.rsplit_once('.').map(|(_, x)| x.to_lowercase()).unwrap_or_default();
    if propre.is_empty() || !["mp3", "ogg", "oga", "opus", "flac", "wav", "m4a"].contains(&ext.as_str()) {
        return Err(e("nom", "Nom de fichier audio refusé.".into()));
    }
    if taille.is_some_and(|t| t > FICHIER_MAX) {
        return Err(e("fichier_trop_volumineux", "Fichier trop volumineux.".into()));
    }
    fs::create_dir_all(dossier).map_err(|x| e("ecriture", format!("Dossier des médias inaccessible ({}).", flux::raison_io(&x))))?;
    let (mut final_, part, mut sortie, n) = flux::reserver(dossier, &propre, 1).map_err(|x| match x {
        flux::ErreurCopie::Annule => e("annule", "Import annulé.".into()),
        flux::ErreurCopie::Echec(m) => e("ecriture", m),
    })?;
    let r = (|| -> Result<(), (String, String)> {
        let url = format!("{}/api/music/imports/{id}/fichier", srv.base());
        if !url.starts_with("https://") {
            return Err(e("reponse", "HTTPS seulement.".into()));
        }
        let a = reseau::agent(&srv.racines, Duration::from_secs(600));
        let mut rep = a.get(&url).header("Authorization", &format!("Bearer {cle}")).call().map_err(|x| e("rapatriement_interrompu", format!("Copie impossible : {}", reseau::message(&x))))?;
        match rep.status().as_u16() {
            200 => {}
            401 => return Err(e("unauthorized", "Liaison d'AETHRYON Desktop refusée : reliez-le de nouveau.".into())),
            410 => return Err(e("fichier_expire", "Le fichier n'est plus sur le serveur (60 min) : relancez l'import.".into())),
            s if (300..400).contains(&s) => return Err(e("reponse", "Redirection refusée.".into())),
            s => return Err(e(&format!("http_{s}"), format!("Le serveur répond {s}."))),
        }
        let annonce = rep.body().content_length();
        if let (Some(a), Some(t)) = (annonce, taille) {
            if a != t {
                return Err(e("taille", "Le serveur annonce une autre taille que celle de l'import.".into()));
            }
        }
        let attendu = taille.or(annonce);
        let mut lecteur = rep.body_mut().with_config().limit(attendu.unwrap_or(FICHIER_MAX).saturating_add(1)).reader();
        let mut tampon = vec![0u8; 256 * 1024];
        let mut fait = 0u64;
        loop {
            if annule.load(Ordering::SeqCst) {
                return Err(e("annule", "Import annulé.".into()));
            }
            let k = match lecteur.read(&mut tampon) {
                Ok(0) => break,
                Ok(k) => k,
                Err(x) if x.kind() == io::ErrorKind::Interrupted => continue,
                Err(_) => return Err(e("rapatriement_interrompu", "Copie interrompue : connexion coupée.".into())),
            };
            sortie.write_all(&tampon[..k]).map_err(|x| e("ecriture", format!("Écriture interrompue ({}).", flux::raison_io(&x))))?;
            fait += k as u64;
            if attendu.is_some_and(|t| fait > t) || fait > FICHIER_MAX {
                return Err(e("taille", "Le serveur envoie plus d'octets qu'annoncé.".into()));
            }
            avance(fait);
        }
        if attendu.is_some_and(|t| fait != t) || fait == 0 {
            return Err(e("rapatriement_interrompu", "Copie interrompue : fichier incomplet.".into()));
        }
        sortie.sync_all().map_err(|x| e("ecriture", format!("Écriture non confirmée ({}).", flux::raison_io(&x))))?;
        Ok(())
    })();
    drop(sortie);
    if let Err(x) = r {
        let _ = fs::remove_file(&part);
        return Err(x);
    }
    let mut essai = n;
    for _ in 0..8 {
        match flux::renommer_avec_reessais(&part, &final_) {
            Ok(()) => return Ok(final_),
            Err(x) if x.kind() == io::ErrorKind::AlreadyExists => {
                essai += 1;
                final_ = dossier.join(flux::candidat(&propre, essai));
            }
            Err(x) => {
                let _ = fs::remove_file(&part);
                return Err(e("ecriture", format!("Renommage final impossible ({}).", flux::raison_io(&x))));
            }
        }
    }
    let _ = fs::remove_file(&part);
    Err(e("ecriture", "Renommage final impossible : noms occupés.".into()))
}

impl Imports {
    pub fn new(compte: Arc<GestionCompte>, magasin: Arc<Magasin>, avis: AvisImport) -> Imports {
        Imports { compte, magasin, avis: Arc::new(avis), liste: Default::default(), annules: Default::default() }
    }

    pub fn liste(&self) -> Vec<ImportSuivi> {
        self.liste.lock().unwrap_or_else(|x| x.into_inner()).clone()
    }

    pub fn annuler(&self, id: &str) -> bool {
        match self.annules.lock().unwrap_or_else(|x| x.into_inner()).get(id) {
            Some(a) => {
                a.store(true, Ordering::SeqCst);
                true
            }
            None => false,
        }
    }

    pub fn annuler_tout(&self) -> usize {
        let l = self.annules.lock().unwrap_or_else(|x| x.into_inner());
        l.values().for_each(|a| a.store(true, Ordering::SeqCst));
        l.len()
    }

    /// Lance un import (corps de l'action `importer` de la fiche, filtré par le client). Renvoie l'état initial.
    pub fn lancer(&self, corps: Value, p: Presentation, cible: Cible) -> Result<ImportSuivi, String> {
        let corps = super::client::corps_import(&corps).map_err(|e| e.message)?;
        if !self.compte.etat().relie {
            return Err("AETHRYON Desktop n'est pas relié au compte (Paramètres › Compte).".into());
        }
        let actifs = self.liste().iter().filter(|i| i.actif()).count();
        if actifs >= 2 {
            return Err("Deux imports sont déjà en cours : attendez la fin de l'un d'eux.".into());
        }
        let t = ImportSuivi {
            id: format!("imp_{}", uuid::Uuid::new_v4().simple()),
            distant: None,
            url: corps["url"].as_str().unwrap_or_default().into(),
            connecteur: p.connecteur.chars().take(20).collect(),
            titre: p.titre,
            artistes: p.artistes,
            pochette: p.pochette.filter(|u| u.starts_with("https://")),
            etape: "demande".into(),
            serveur: None,
            local: None,
            licence: None,
            attribution: None,
            cloud: None,
            audio: None,
            code: None,
            message: None,
            chemin: None,
            media_id: None,
            maj_le: horloge::iso(horloge::maintenant()),
        };
        let annule = Arc::new(AtomicBool::new(false));
        self.annules.lock().unwrap_or_else(|x| x.into_inner()).insert(t.id.clone(), annule.clone());
        self.publier(&t);
        let (compte, magasin, avis, liste, annules) = (self.compte.clone(), self.magasin.clone(), self.avis.clone(), self.liste.clone(), self.annules.clone());
        let depart = t.clone();
        std::thread::spawn(move || {
            let fin = suivre(&compte, &magasin, corps, depart, &annule, &cible, &mut |x| publier_dans(&liste, &avis, x));
            publier_dans(&liste, &avis, &fin);
            annules.lock().unwrap_or_else(|x| x.into_inner()).remove(&fin.id);
            let _ = magasin.noter(EntreeHistorique {
                action: "import".into(),
                url: fin.url.clone(),
                connecteur: fin.connecteur.clone(),
                titre: fin.titre.clone(),
                artistes: fin.artistes.clone(),
                pochette: fin.pochette.clone(),
                etat: fin.etape.clone(),
                import_id: fin.distant.clone().or(Some(fin.id.clone())),
                media_id: fin.media_id.clone(),
                erreur: fin.message.clone().filter(|_| fin.etape == "echec"),
                ..Default::default()
            });
        });
        Ok(t)
    }

    fn publier(&self, t: &ImportSuivi) {
        publier_dans(&self.liste, &self.avis, t);
    }
}

fn publier_dans(liste: &Mutex<Vec<ImportSuivi>>, avis: &AvisImport, t: &ImportSuivi) {
    let mut t = t.clone();
    t.maj_le = horloge::iso(horloge::maintenant());
    {
        let mut l = liste.lock().unwrap_or_else(|x| x.into_inner());
        match l.iter().position(|x| x.id == t.id) {
            Some(i) => l[i] = t.clone(),
            None => l.push(t.clone()),
        }
        let n = l.len();
        if n > 60 {
            l.drain(0..n - 60);
        }
    }
    avis(&t);
}

fn echec(mut t: ImportSuivi, code: &str, message: &str) -> ImportSuivi {
    t.etape = if code == "annule" { "annule".into() } else { "echec".into() };
    t.code = Some(code.into());
    t.message = Some(message.into());
    t
}

fn suivre(compte: &GestionCompte, magasin: &Magasin, corps: Value, mut t: ImportSuivi, annule: &AtomicBool, cible: &Cible, publier: &mut dyn FnMut(&ImportSuivi)) -> ImportSuivi {
    let Some(cle) = compte.cle() else { return echec(t, "non_relie", "AETHRYON Desktop n'est plus relié au compte.") };
    let srv = compte.serveur();
    let c = ClientMusique { srv, cle: &cle };
    let v = match c.importer(&corps) {
        Ok(v) => v,
        Err(e) => return echec(t, if e.code.is_empty() { "refuse" } else { &e.code }, &e.message),
    };
    let Some(id) = v["import"]["id"].as_str().filter(|i| id_import_valide(i)).map(String::from) else {
        return echec(t, "reponse", "Réponse inattendue d'AETHRYON Music.");
    };
    t.distant = Some(id.clone());
    let mut tours = 0u32;
    let mut vue = v["import"].clone();
    loop {
        if annule.load(Ordering::SeqCst) {
            let _ = c.annuler(&id);
            return echec(t, "annule", "Import annulé.");
        }
        let etat = s(&vue, "etat").unwrap_or_default();
        t.serveur = avancement(&vue);
        t.titre = s(&vue, "titre").or(t.titre);
        if let Some(a) = vue.get("artistes").and_then(|a| a.as_array()).filter(|a| !a.is_empty()) {
            t.artistes = a.iter().filter_map(|x| x.as_str().map(String::from)).take(12).collect();
        }
        t.licence = vue.get("licence").filter(|x| !x.is_null()).cloned();
        t.attribution = s(&vue, "attribution");
        t.cloud = vue.get("cloud").filter(|x| !x.is_null()).cloned();
        match etat.as_str() {
            "en_file" | "telechargement" | "verification" | "etiquetage" => {
                if t.etape != etat || tours % 2 == 0 {
                    t.etape = etat;
                    publier(&t);
                }
            }
            "termine" => break,
            "echec" => {
                let code = vue["erreur"]["code"].as_str().unwrap_or("echec").to_string();
                let m = s(&vue["erreur"], "detail").unwrap_or_else(|| "L'import a échoué sur le serveur.".into());
                return echec(t, &code, &m);
            }
            "annule" => return echec(t, "annule", "Import annulé sur le serveur."),
            _ => return echec(t, "reponse", "État d'import inconnu."),
        }
        tours += 1;
        if tours > SUIVI_MAX {
            return echec(t, "delai", "L'import ne se termine pas : réessayez plus tard.");
        }
        std::thread::sleep(INTERVALLE);
        vue = match c.import(&id) {
            Ok(v) => v["import"].clone(),
            Err(e) if e.statut == 0 => continue,
            Err(e) => return echec(t, if e.code.is_empty() { "suivi" } else { &e.code }, &e.message),
        };
    }
    // Terminé côté serveur : copie sur l'ordinateur.
    let fichier = vue["fichier"].clone();
    let nom = s(&fichier, "nom").unwrap_or_default();
    let taille = fichier["taille"].as_u64();
    t.audio = fichier.get("audio").filter(|x| !x.is_null()).cloned();
    t.etape = "rapatriement".into();
    t.local = Some(Avancement { octets: 0, total: taille });
    publier(&t);
    let dossier = cible.dossier_medias.join(SOUS_DOSSIER);
    let mut dernier = std::time::Instant::now();
    let mut copie = t.clone();
    let r = rapatrier(srv, &cle, &id, &nom, taille, &dossier, annule, &mut |o| {
        if dernier.elapsed() >= Duration::from_millis(100) {
            dernier = std::time::Instant::now();
            copie.local = Some(Avancement { octets: o, total: taille });
            publier(&copie);
        }
    });
    let chemin = match r {
        Ok(p) => p,
        Err((code, m)) => {
            if code == "annule" {
                let _ = c.annuler(&id);
            }
            return echec(t, &code, &m);
        }
    };
    let octets = fs::metadata(&chemin).map(|m| m.len()).unwrap_or(0);
    t.local = Some(Avancement { octets, total: taille.or(Some(octets)) });
    t.chemin = Some(chemin.to_string_lossy().into_owned());
    match magasin.noter_provenance(
        &chemin,
        Provenance {
            connecteur: t.connecteur.clone(),
            source_url: s(&vue, "sourceUrl").or(Some(t.url.clone())),
            licence: t.licence.clone(),
            attribution: t.attribution.clone(),
            attestation: vue["attestation"].as_bool().unwrap_or(false),
            import_id: Some(id.clone()),
            importe_le: horloge::iso(horloge::maintenant()),
            cloud: t.cloud.clone(),
        },
    ) {
        Ok(mid) => t.media_id = Some(mid),
        Err(m) => journal::avert("musique", &m),
    }
    (cible.rescanner)();
    t.etape = "termine".into();
    t.message = Some(format!("Enregistré dans {}", SOUS_DOSSIER));
    t
}

#[cfg(test)]
mod essais {
    use super::*;
    use crate::coffre::{Coffre, Liaison};
    use crate::essais_http::{Reponse, Serveur as Http};
    use serde_json::json;
    use std::sync::atomic::AtomicUsize;

    fn mp3() -> Vec<u8> {
        std::fs::read(super::super::etiquettes::essais_fixture("nocturne.mp3")).unwrap()
    }

    fn compte(h: &Http, d: &Path) -> Arc<GestionCompte> {
        let coffre = Coffre::sous(d);
        coffre.ecrire(&Liaison { cle: "ytc_desktop_essai_0123456789".into(), expire_le: None, email: "admin@example.test".into(), nom: "Admin".into(), relie_le: "x".into() }).unwrap();
        GestionCompte::new(Serveur::essai(&h.base, h.autorite.clone()), coffre, "PC".into(), "1".into(), Box::new(|_| {}), Box::new(|_| Ok(())))
    }

    fn gestion(h: &Http, d: &Path) -> (Imports, Arc<Mutex<Vec<ImportSuivi>>>, Arc<Magasin>) {
        let vus = Arc::new(Mutex::new(Vec::new()));
        let v2 = vus.clone();
        let mag = Arc::new(Magasin::sous(&d.join("R")));
        (Imports::new(compte(h, d), mag.clone(), Box::new(move |t| v2.lock().unwrap().push(t.clone()))), vus, mag)
    }

    fn attendre(i: &Imports, id: &str) -> ImportSuivi {
        for _ in 0..500 {
            if let Some(t) = i.liste().into_iter().find(|x| x.id == id && !x.actif()) {
                return t;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("import non terminé");
    }

    fn cible(d: &Path, n: Arc<AtomicUsize>) -> Cible {
        Cible { dossier_medias: d.join("Medias"), rescanner: Box::new(move || { n.fetch_add(1, Ordering::SeqCst); }) }
    }

    fn vue(etat: &str, octets: u64, total: Option<u64>, taille: u64) -> Value {
        json!({ "import": { "id": "mus_essai1", "etat": etat, "titre": "Clair de nuit", "artistes": ["Atelier Chouette"],
            "progression": { "octets": octets, "total": total, "pourcentage": null },
            "licence": { "code": "cc0", "nom": "CC0 1.0", "libre": true }, "attribution": "« Clair de nuit », CC0, via Internet Archive",
            "sourceUrl": "https://archive.org/details/clair", "attestation": false, "cloud": { "etat": "sauvegarde", "libelle": "Sauvegardé" },
            "fichier": if etat == "termine" { json!({ "nom": "Atelier Chouette - Clair de nuit.mp3", "taille": taille, "type": "audio/mpeg",
                "audio": { "codec": "mp3", "debitKbps": 192 } }) } else { Value::Null } } })
    }

    #[test]
    fn import_reel_d_un_fichier_libre_suivi_puis_rapatrie_octets_identiques() {
        let audio = mp3();
        let n = audio.len() as u64;
        let tours = Arc::new(AtomicUsize::new(0));
        let (t2, a2) = (tours.clone(), audio.clone());
        let h = Http::demarrer(move |r| match (r.methode.as_str(), r.chemin()) {
            ("POST", "/api/music/imports") => {
                assert_eq!(r.entete("authorization"), Some("Bearer ytc_desktop_essai_0123456789"));
                assert_eq!(r.json(), json!({ "url": "https://archive.org/details/clair", "fichier": "clair.mp3" }), "corps transmis tel quel, filtré");
                Reponse::Json(202, vue("en_file", 0, None, n))
            }
            ("GET", "/api/music/imports/mus_essai1") => {
                let k = t2.fetch_add(1, Ordering::SeqCst);
                Reponse::Json(200, if k < 2 { vue("telechargement", n / 2, None, n) } else if k < 3 { vue("verification", n, Some(n), n) } else { vue("termine", n, Some(n), n) })
            }
            ("GET", "/api/music/imports/mus_essai1/fichier") => Reponse::Octets(200, a2.clone(), "audio/mpeg"),
            _ => Reponse::Json(404, json!({ "error": "introuvable" })),
        });
        let d = tempfile::tempdir().unwrap();
        let (imp, vus, mag) = gestion(&h, d.path());
        let rescans = Arc::new(AtomicUsize::new(0));
        let t = imp.lancer(json!({ "url": "https://archive.org/details/clair", "fichier": "clair.mp3" }), Presentation { url: "https://archive.org/details/clair".into(), connecteur: "archive".into(), ..Default::default() }, cible(d.path(), rescans.clone())).unwrap();
        assert_eq!(t.etape, "demande");
        let fin = attendre(&imp, &t.id);
        assert_eq!(fin.etape, "termine", "{:?}", fin.message);
        let chemin = PathBuf::from(fin.chemin.clone().unwrap());
        assert_eq!(chemin.parent().unwrap(), d.path().join("Medias").join("Musique"));
        assert_eq!(std::fs::read(&chemin).unwrap(), audio, "octets identiques");
        assert_eq!(rescans.load(Ordering::SeqCst), 1);
        // Progression réelle : états du serveur dans l'ordre, total inconnu tant que le serveur ne le dit pas.
        let etapes: Vec<String> = vus.lock().unwrap().iter().map(|x| x.etape.clone()).collect();
        let pos = |e: &str| etapes.iter().position(|x| x == e).unwrap_or_else(|| panic!("{e} absent de {etapes:?}"));
        assert!(pos("demande") < pos("telechargement") && pos("telechargement") < pos("verification") && pos("verification") < pos("rapatriement") && pos("rapatriement") < pos("termine"));
        assert!(vus.lock().unwrap().iter().filter(|x| x.etape == "telechargement").all(|x| x.serveur.as_ref().unwrap().total.is_none()), "aucun total inventé");
        // Provenance gardée à part, sous l'identifiant que l'index donnera au fichier ; historique noté.
        let mid = fin.media_id.unwrap();
        assert_eq!(mid, noms::id_media(&chemin.to_string_lossy()));
        let h2 = mag.noter(EntreeHistorique { action: "analyse".into(), url: "https://x.y/z".into(), ..Default::default() }).unwrap();
        assert!(h2.iter().any(|x| x.action == "import" && x.etat == "termine" && x.media_id.as_deref() == Some(&mid)));
        assert!(std::fs::read_to_string(d.path().join("R/musique/provenances.json")).unwrap().contains("cc0"));
        assert!(!std::fs::read_dir(chemin.parent().unwrap()).unwrap().any(|e| e.unwrap().file_name().to_string_lossy().ends_with(".part")));
    }

    #[test]
    fn source_commerciale_refusee_par_le_serveur_rien_ecrit() {
        let h = Http::demarrer(|_| Reponse::Json(403, json!({ "error": "telechargement_non_autorise", "detail": "Spotify n'autorise aucun téléchargement." })));
        let d = tempfile::tempdir().unwrap();
        let (imp, _, _) = gestion(&h, d.path());
        let t = imp.lancer(json!({ "url": "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC" }), Presentation::default(), cible(d.path(), Default::default())).unwrap();
        let fin = attendre(&imp, &t.id);
        assert_eq!((fin.etape.as_str(), fin.code.as_deref()), ("echec", Some("telechargement_non_autorise")));
        assert_eq!(fin.message.as_deref(), Some("Spotify n'autorise aucun téléchargement."));
        assert!(!d.path().join("Medias").exists());
    }

    #[test]
    fn annulation_pendant_le_rapatriement_previent_le_serveur_sans_part() {
        let audio = [mp3(), mp3(), mp3(), mp3()].concat();
        let n = audio.len() as u64;
        let annulations = Arc::new(AtomicUsize::new(0));
        let (a2, an2) = (audio.clone(), annulations.clone());
        let h = Http::demarrer(move |r| match (r.methode.as_str(), r.chemin()) {
            ("POST", "/api/music/imports") => Reponse::Json(202, vue("termine", n, Some(n), n)),
            ("GET", "/api/music/imports/mus_essai1/fichier") => Reponse::Lente(a2.clone(), 4096, Duration::from_millis(30)),
            ("POST", "/api/music/imports/mus_essai1/annuler") => {
                an2.fetch_add(1, Ordering::SeqCst);
                Reponse::Json(200, json!({}))
            }
            _ => Reponse::Json(404, json!({})),
        });
        let d = tempfile::tempdir().unwrap();
        let (imp, vus, _) = gestion(&h, d.path());
        let t = imp.lancer(json!({ "url": "https://archive.org/details/clair" }), Presentation::default(), cible(d.path(), Default::default())).unwrap();
        for _ in 0..300 {
            if vus.lock().unwrap().iter().any(|x| x.local.as_ref().is_some_and(|l| l.octets > 0)) {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(imp.annuler(&t.id));
        let fin = attendre(&imp, &t.id);
        assert_eq!(fin.etape, "annule");
        assert_eq!(annulations.load(Ordering::SeqCst), 1);
        let dossier = d.path().join("Medias/Musique");
        assert_eq!(std::fs::read_dir(&dossier).map(|l| l.count()).unwrap_or(0), 0, "ni .part ni fichier");
    }

    #[test]
    fn taille_differente_refusee_et_cle_refusee() {
        let audio = mp3();
        let n = audio.len() as u64;
        let a2 = audio.clone();
        let h = Http::demarrer(move |r| match (r.methode.as_str(), r.chemin()) {
            ("POST", "/api/music/imports") => Reponse::Json(202, vue("termine", n + 10, Some(n + 10), n + 10)),
            ("GET", "/api/music/imports/mus_essai1/fichier") => Reponse::Octets(200, a2.clone(), "audio/mpeg"),
            _ => Reponse::Json(404, json!({})),
        });
        let d = tempfile::tempdir().unwrap();
        let (imp, _, _) = gestion(&h, d.path());
        let t = imp.lancer(json!({ "url": "https://archive.org/details/clair" }), Presentation::default(), cible(d.path(), Default::default())).unwrap();
        let fin = attendre(&imp, &t.id);
        assert_eq!((fin.etape.as_str(), fin.code.as_deref()), ("echec", Some("taille")));
        assert_eq!(std::fs::read_dir(d.path().join("Medias/Musique")).unwrap().count(), 0);

        let h = Http::demarrer(|_| Reponse::Json(401, json!({ "error": "token_revoked" })));
        let d = tempfile::tempdir().unwrap();
        let (imp, _, _) = gestion(&h, d.path());
        let t = imp.lancer(json!({ "url": "https://archive.org/details/clair" }), Presentation::default(), cible(d.path(), Default::default())).unwrap();
        assert_eq!(attendre(&imp, &t.id).code.as_deref(), Some("token_revoked"));
        // Corps refusé avant tout appel.
        assert!(imp.lancer(json!({ "url": "https://x.y/a.mp3", "attestation": "true" }), Presentation::default(), cible(d.path(), Default::default())).is_err());
    }
}

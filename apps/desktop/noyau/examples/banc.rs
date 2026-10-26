//! Banc d'intégration (étape D) : le VRAI service d'AETHRYON Desktop (`Service::demarrer`, surveillance, index,
//! battements, file de commandes, transferts, journaux), compilé pour Linux et piloté par le banc Node
//! `integration/banc.test.mjs`, qui fait tourner en face le vrai moteur du panneau Premiere sur le MÊME dossier.
//!
//! Ce qui diffère de l'application Windows, et seulement cela :
//! - la plateforme : `Banc` note dans un fichier les appels système (Explorateur, ouverture) au lieu de les faire ;
//!   pas de registre, pas de Premiere, pas de Creative Cloud ;
//! - l'analyse que le WebView2 de l'interface fait d'habitude (miniature JPEG 480 × 270, durée, définition) est faite
//!   ici par ffmpeg/ffprobe, puis remise au service par la même fonction (`enregistrer_analyse`) ;
//! - l'assistant d'installation n'est pas joué : `config.json` est écrit avec les valeurs par défaut s'il manque.
//!
//! Modes :
//!   banc --nm | banc chrome-extension://<id>/   hôte Native Messaging (même code que l'exe : `nm::principal`)
//!   banc [--sans-analyse]                         service ; commandes sur l'entrée standard, événements JSON en sortie
//!
//! Commandes (une par ligne) : `importer <id>[,<id>…] [chutier]`, `instantane`, `rescanner`, `arret`.
//! Variables : AETHRYON_BASE (racine des profils : `<base>/Roaming/AETHRYON`, `<base>/Local/AETHRYON`), BANC_MAISON
//! (dossier personnel : `Downloads/AETHRYON` y est le dossier des médias), BANC_JOURNAL (appels système notés).

use aethryon_noyau::bibliotheque::{AnalyseWeb, Media, TypeMedia};
use aethryon_noyau::chemins::Emplacements;
use aethryon_noyau::config::{self, Config};
use aethryon_noyau::plateforme::{CreativeCloud, Plateforme, SortieProcessus};
use aethryon_noyau::service::{Notifieur, ResultatEnvoi, Service};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;

fn sortie(v: Value) {
    let mut o = std::io::stdout().lock();
    let _ = writeln!(o, "{v}");
    let _ = o.flush();
}

struct Banc {
    maison: PathBuf,
    journal: Option<PathBuf>,
    registre: Mutex<HashMap<(String, String), String>>,
}

impl Banc {
    fn noter(&self, ligne: String) {
        if let Some(j) = &self.journal {
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(j) {
                let _ = writeln!(f, "{ligne}");
            }
        }
    }
}

impl Plateforme for Banc {
    fn nom(&self) -> &'static str {
        "banc"
    }
    fn candidats_premiere(&self) -> (Vec<(PathBuf, String)>, Vec<String>) {
        (Vec::new(), vec!["(banc Linux : aucune recherche de Premiere)".into()])
    }
    fn version_fichier(&self, _exe: &Path) -> Option<String> {
        None
    }
    fn creative_cloud(&self) -> CreativeCloud {
        CreativeCloud::default()
    }
    fn processus_present(&self, _nom_exe: &str) -> Option<bool> {
        None
    }
    fn executer(&self, exe: &Path, args: &[String], _delai: Duration) -> Result<SortieProcessus, String> {
        self.noter(format!("EXEC {} {}", exe.display(), args.join(" ")));
        Err("Banc : aucun programme lancé.".into())
    }
    fn ouvrir(&self, chemin: &Path) -> Result<(), String> {
        self.noter(format!("OUVRIR {}", chemin.display()));
        Ok(())
    }
    fn afficher_dans_explorateur(&self, chemin: &Path) -> Result<(), String> {
        self.noter(format!("EXPLORATEUR {}", chemin.display()));
        Ok(())
    }
    fn lancer(&self, exe: &Path, args: &[String]) -> Result<(), String> {
        self.noter(format!("LANCER {} {}", exe.display(), args.join(" ")));
        Ok(())
    }
    fn reg_lire(&self, c: &str, v: Option<&str>) -> Option<String> {
        self.registre.lock().unwrap().get(&(c.to_lowercase(), v.unwrap_or("").to_lowercase())).cloned()
    }
    fn reg_ecrire(&self, c: &str, v: Option<&str>, d: &str) -> Result<(), String> {
        self.registre.lock().unwrap().insert((c.to_lowercase(), v.unwrap_or("").to_lowercase()), d.to_string());
        Ok(())
    }
    fn reg_supprimer_valeur(&self, c: &str, v: &str) -> Result<(), String> {
        self.registre.lock().unwrap().remove(&(c.to_lowercase(), v.to_lowercase()));
        Ok(())
    }
    fn reg_supprimer_cle(&self, c: &str) -> Result<(), String> {
        let p = c.to_lowercase();
        self.registre.lock().unwrap().retain(|(k, _), _| *k != p);
        Ok(())
    }
    fn espace_libre(&self, _chemin: &Path) -> Option<u64> {
        None
    }
    fn dossier_telechargements(&self) -> Option<PathBuf> {
        Some(self.maison.join("Downloads"))
    }
    fn terminer_autres_instances(&self) -> usize {
        0
    }
}

struct Sortie;
impl Notifieur for Sortie {
    fn changement(&self, quoi: &str) {
        sortie(json!({ "evenement": "changement", "quoi": quoi }));
    }
    fn media_pret(&self, m: &Media) {
        sortie(json!({ "evenement": "media-pret", "id": m.id, "nom": m.nom }));
    }
    fn resultat_commande(&self, r: &ResultatEnvoi) {
        sortie(json!({ "evenement": "resultat", "resultat": r }));
    }
    fn naviguer(&self, section: &str) {
        sortie(json!({ "evenement": "naviguer", "section": section }));
    }
}

/// Ce que l'interface fait d'habitude dans le WebView2 (élément vidéo + canvas), fait ici par ffprobe et ffmpeg.
fn analyser(chemin: &str, type_media: TypeMedia) -> (AnalyseWeb, Option<Vec<u8>>) {
    let mut a = AnalyseWeb::default();
    let sonde = Command::new("ffprobe")
        .args(["-v", "error", "-show_entries", "format=duration:stream=width,height", "-of", "json", chemin])
        .output();
    if let Some(o) = sonde.ok().filter(|o| o.status.success()) {
        if let Ok(v) = serde_json::from_slice::<Value>(&o.stdout) {
            a.duree = v["format"]["duration"].as_str().and_then(|d| d.parse().ok()).filter(|_| type_media != TypeMedia::Image);
            if let Some(s) = v["streams"].as_array().and_then(|s| s.iter().find(|s| s["width"].is_u64())) {
                a.largeur = s["width"].as_u64().map(|x| x as u32);
                a.hauteur = s["height"].as_u64().map(|x| x as u32);
            }
        }
    } else {
        a.echec = true;
        return (a, None);
    }
    if type_media == TypeMedia::Audio {
        return (a, None);
    }
    let image = Command::new("ffmpeg")
        .args(["-v", "error", "-i", chemin, "-frames:v", "1", "-vf"])
        .arg("scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2:black")
        .args(["-q:v", "4", "-f", "mjpeg", "pipe:1"])
        .output();
    match image {
        Ok(o) if o.status.success() && o.stdout.starts_with(&[0xFF, 0xD8, 0xFF]) => (a, Some(o.stdout)),
        _ => {
            a.echec = true;
            (a, None)
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if aethryon_noyau::nm::est_mode_nm(&args) {
        // Fonctionnalité `essais` (banc seulement) : source des mises à jour lue dans l'environnement
        // (AETHRYON_ESSAI_MAJ_BASE, AETHRYON_ESSAI_MAJ_CA, AETHRYON_ESSAI_MAJ_ID) ; sinon la production, figée.
        #[cfg(feature = "essais")]
        std::process::exit(aethryon_noyau::nm::principal_avec(&args, &aethryon_noyau::maj_extension::Source::depuis_environnement()));
        #[cfg(not(feature = "essais"))]
        std::process::exit(aethryon_noyau::nm::principal(&args));
    }
    let emp = Emplacements::depuis_environnement().expect("AETHRYON_BASE ou HOME");
    let maison = PathBuf::from(std::env::var_os("BANC_MAISON").expect("BANC_MAISON"));
    let plateforme = Banc { maison: maison.clone(), journal: std::env::var_os("BANC_JOURNAL").map(PathBuf::from), registre: Mutex::new(HashMap::new()) };
    // Assistant non joué : configuration par défaut du contrat (§2), dossier des médias créé.
    if !emp.config_json().exists() {
        let medias = maison.join("Downloads").join("AETHRYON");
        std::fs::create_dir_all(&medias).expect("dossier des médias");
        config::enregistrer(&emp, &Config::defaut(&medias.to_string_lossy())).expect("config.json");
    }
    let exe = std::env::current_exe().unwrap_or_default();
    let s = Service::demarrer(emp, Box::new(plateforme), Box::new(Sortie), exe);
    sortie(json!({ "evenement": "demarre", "pid": std::process::id(), "version": aethryon_noyau::VERSION }));

    if !args.iter().any(|a| a == "--sans-analyse") {
        let a = s.clone();
        std::thread::spawn(move || loop {
            for m in a.a_analyser(4) {
                let (analyse, jpeg) = analyser(&m.chemin, m.type_media);
                let r = a.enregistrer_analyse(&m.id, &analyse, jpeg.as_deref());
                sortie(json!({ "evenement": "analyse", "id": m.id, "miniature": jpeg.is_some(), "echec": analyse.echec, "ok": r.is_ok() }));
            }
            std::thread::sleep(Duration::from_millis(400));
        });
    }

    for ligne in std::io::stdin().lock().lines() {
        let Ok(ligne) = ligne else { break };
        let mut mots = ligne.split_whitespace();
        match mots.next() {
            Some("importer") => {
                let ids: Vec<String> = mots.next().unwrap_or("").split(',').filter(|x| !x.is_empty()).map(String::from).collect();
                let chutier = mots.next();
                match s.importer(&ids, chutier) {
                    Ok(nom) => sortie(json!({ "evenement": "importer", "ok": true, "nom": nom })),
                    Err(e) => sortie(json!({ "evenement": "importer", "ok": false, "erreur": e })),
                }
            }
            Some("instantane") => sortie(json!({ "evenement": "instantane", "instantane": s.instantane() })),
            Some("rescanner") => s.rescanner(),
            Some("arret") => break,
            _ => sortie(json!({ "evenement": "inconnu", "ligne": ligne })),
        }
    }
    s.arreter();
    std::thread::sleep(Duration::from_millis(300));
    sortie(json!({ "evenement": "arrete" }));
}

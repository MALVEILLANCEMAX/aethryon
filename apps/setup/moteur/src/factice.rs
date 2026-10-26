//! Système factice en mémoire pour les essais : fichiers, registre (HKCU et HKLM) et système. Chemins comparés à la
//! façon de Windows (insensibles à la casse, `/` et `\` équivalents). On peut y injecter des pannes pour éprouver
//! le retour arrière.

use crate::plateforme::*;
use std::collections::{BTreeMap, BTreeSet};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

fn cle_chemin(p: &Path) -> String {
    let s = p.to_string_lossy().replace('/', "\\");
    let s = s.trim_end_matches('\\');
    s.to_lowercase()
}

fn parent(c: &str) -> Option<&str> {
    c.rfind('\\').map(|i| &c[..i])
}

#[derive(Clone, Debug)]
enum Noeud {
    Fichier(Vec<u8>),
    Dossier,
    Lien,
}

#[derive(Default)]
pub struct FsFactice {
    /// clé normalisée -> (nom d'origine, nœud)
    noeuds: Mutex<BTreeMap<String, (String, Noeud)>>,
    /// Une écriture, un renommage ou une suppression dont le chemin contient ce texte échoue.
    pub panne: Mutex<Option<String>>,
    pub ecritures: Mutex<u64>,
}

impl FsFactice {
    pub fn nouveau() -> Self {
        Self::default()
    }
    fn verifier_panne(&self, p: &Path) -> io::Result<()> {
        if let Some(motif) = self.panne.lock().unwrap().as_ref() {
            if cle_chemin(p).contains(&motif.to_lowercase()) {
                return Err(io::Error::other(format!("panne simulée sur {}", p.display())));
            }
        }
        Ok(())
    }
    pub fn poser(&self, p: impl AsRef<Path>, contenu: &[u8]) {
        let p = p.as_ref();
        if let Some(d) = parent_de(p) {
            self.creer_dossiers(&d).unwrap();
        }
        self.noeuds.lock().unwrap().insert(cle_chemin(p), (p.to_string_lossy().into_owned(), Noeud::Fichier(contenu.to_vec())));
    }
    pub fn poser_lien(&self, p: impl AsRef<Path>) {
        let p = p.as_ref();
        self.noeuds.lock().unwrap().insert(cle_chemin(p), (p.to_string_lossy().into_owned(), Noeud::Lien));
    }
    /// Tous les fichiers sous un dossier (chemins d'origine), pour les vérifications des essais.
    pub fn fichiers_sous(&self, p: impl AsRef<Path>) -> Vec<String> {
        let base = cle_chemin(p.as_ref()) + "\\";
        self.noeuds
            .lock()
            .unwrap()
            .iter()
            .filter(|(k, (_, n))| k.starts_with(&base) && matches!(n, Noeud::Fichier(_)))
            .map(|(_, (o, _))| o.clone())
            .collect()
    }
    pub fn nombre_entrees(&self) -> usize {
        self.noeuds.lock().unwrap().len()
    }
}

impl Fs for FsFactice {
    fn lire(&self, p: &Path) -> io::Result<Vec<u8>> {
        match self.noeuds.lock().unwrap().get(&cle_chemin(p)) {
            Some((_, Noeud::Fichier(d))) => Ok(d.clone()),
            Some(_) => Err(io::Error::other("pas un fichier")),
            None => Err(io::Error::new(io::ErrorKind::NotFound, format!("introuvable : {}", p.display()))),
        }
    }
    fn ecrire(&self, p: &Path, donnees: &[u8], avance: &mut dyn FnMut(u64)) -> io::Result<()> {
        self.verifier_panne(p)?;
        let k = cle_chemin(p);
        let mut n = self.noeuds.lock().unwrap();
        match parent(&k).map(|x| n.get(x).map(|(_, y)| y.clone())) {
            Some(Some(Noeud::Dossier)) => {}
            _ => return Err(io::Error::new(io::ErrorKind::NotFound, format!("dossier parent absent : {}", p.display()))),
        }
        if matches!(n.get(&k), Some((_, Noeud::Dossier | Noeud::Lien))) {
            return Err(io::Error::other("un dossier ou un lien porte déjà ce nom"));
        }
        n.insert(k, (p.to_string_lossy().into_owned(), Noeud::Fichier(donnees.to_vec())));
        drop(n);
        for bloc in donnees.chunks(256 * 1024) {
            avance(bloc.len() as u64);
        }
        *self.ecritures.lock().unwrap() += 1;
        Ok(())
    }
    fn creer_dossiers(&self, p: &Path) -> io::Result<()> {
        self.verifier_panne(p)?;
        let orig = p.to_string_lossy().replace('/', "\\");
        let orig = orig.trim_end_matches('\\').to_string();
        let mut n = self.noeuds.lock().unwrap();
        let mut acc = String::new();
        for (i, morceau) in orig.split('\\').enumerate() {
            if i > 0 {
                acc.push('\\');
            }
            acc.push_str(morceau);
            let k = acc.to_lowercase();
            match n.get(&k) {
                Some((_, Noeud::Dossier)) => {}
                Some(_) => return Err(io::Error::other(format!("{acc} existe et n'est pas un dossier"))),
                None => {
                    n.insert(k, (acc.clone(), Noeud::Dossier));
                }
            }
        }
        Ok(())
    }
    fn type_de(&self, p: &Path) -> Option<TypeEntree> {
        self.noeuds.lock().unwrap().get(&cle_chemin(p)).map(|(_, n)| match n {
            Noeud::Fichier(_) => TypeEntree::Fichier,
            Noeud::Dossier => TypeEntree::Dossier,
            Noeud::Lien => TypeEntree::Lien,
        })
    }
    fn supprimer_fichier(&self, p: &Path) -> io::Result<()> {
        self.verifier_panne(p)?;
        let k = cle_chemin(p);
        let mut n = self.noeuds.lock().unwrap();
        match n.get(&k) {
            Some((_, Noeud::Fichier(_) | Noeud::Lien)) => {
                n.remove(&k);
                Ok(())
            }
            Some(_) => Err(io::Error::other("c'est un dossier")),
            None => Err(io::Error::new(io::ErrorKind::NotFound, "introuvable")),
        }
    }
    fn supprimer_arbre(&self, p: &Path) -> io::Result<()> {
        self.verifier_panne(p)?;
        let k = cle_chemin(p);
        let prefixe = k.clone() + "\\";
        let mut n = self.noeuds.lock().unwrap();
        let a_retirer: Vec<String> = n.keys().filter(|x| **x == k || x.starts_with(&prefixe)).cloned().collect();
        for x in a_retirer {
            n.remove(&x);
        }
        Ok(())
    }
    fn renommer(&self, de: &Path, vers: &Path) -> io::Result<()> {
        self.verifier_panne(de)?;
        self.verifier_panne(vers)?;
        let kd = cle_chemin(de);
        let kv = cle_chemin(vers);
        let mut n = self.noeuds.lock().unwrap();
        if !n.contains_key(&kd) {
            return Err(io::Error::new(io::ErrorKind::NotFound, format!("introuvable : {}", de.display())));
        }
        if let Some((_, noeud)) = n.get(&kv) {
            // Comme MoveFileEx(MOVEFILE_REPLACE_EXISTING) : un fichier peut en remplacer un autre, pas un dossier.
            if matches!(noeud, Noeud::Dossier) {
                return Err(io::Error::new(io::ErrorKind::AlreadyExists, "la destination existe"));
            }
        }
        match parent(&kv).map(|x| n.get(x).map(|(_, y)| y.clone())) {
            Some(Some(Noeud::Dossier)) => {}
            _ => return Err(io::Error::new(io::ErrorKind::NotFound, "dossier parent de la destination absent")),
        }
        let prefixe = kd.clone() + "\\";
        let a_deplacer: Vec<(String, (String, Noeud))> =
            n.iter().filter(|(x, _)| **x == kd || x.starts_with(&prefixe)).map(|(a, b)| (a.clone(), b.clone())).collect();
        let base_orig = vers.to_string_lossy().replace('/', "\\");
        let base_orig = base_orig.trim_end_matches('\\').to_string();
        for (x, (orig, noeud)) in a_deplacer {
            n.remove(&x);
            let reste = &x[kd.len()..];
            let reste_orig = &orig.replace('/', "\\")[orig.len() - reste.len()..];
            n.insert(kv.clone() + reste, (base_orig.clone() + reste_orig, noeud));
        }
        Ok(())
    }
    fn lister(&self, p: &Path) -> io::Result<Vec<String>> {
        let k = cle_chemin(p);
        let n = self.noeuds.lock().unwrap();
        match n.get(&k) {
            Some((_, Noeud::Dossier)) => {}
            _ => return Err(io::Error::new(io::ErrorKind::NotFound, format!("dossier introuvable : {}", p.display()))),
        }
        let prefixe = k + "\\";
        let mut v: Vec<String> = n
            .iter()
            .filter(|(x, _)| x.starts_with(&prefixe) && !x[prefixe.len()..].contains('\\'))
            .map(|(_, (o, _))| o.rsplit(['\\', '/']).next().unwrap_or(o).to_string())
            .collect();
        v.sort();
        Ok(v)
    }
    fn taille(&self, p: &Path) -> io::Result<u64> {
        match self.noeuds.lock().unwrap().get(&cle_chemin(p)) {
            Some((_, Noeud::Fichier(d))) => Ok(d.len() as u64),
            Some(_) => Ok(0),
            None => Err(io::Error::new(io::ErrorKind::NotFound, "introuvable")),
        }
    }
}

type CleReg = (u8, String);

#[derive(Default)]
pub struct RegistreFactice {
    cles: Mutex<BTreeMap<CleReg, BTreeMap<String, (String, Valeur)>>>,
    pub panne: Mutex<Option<String>>,
}

fn rk(r: Racine, cle: &str) -> CleReg {
    (if r == Racine::Hkcu { 0 } else { 1 }, cle.trim_matches('\\').to_lowercase())
}

impl RegistreFactice {
    pub fn nouveau() -> Self {
        Self::default()
    }
    pub fn poser(&self, racine: Racine, cle: &str, nom: &str, v: Valeur) {
        let mut c = self.cles.lock().unwrap();
        // Comme le vrai registre : les clés parentes existent.
        let morceaux: Vec<&str> = cle.trim_matches('\\').split('\\').collect();
        for i in 1..morceaux.len() {
            c.entry(rk(racine, &morceaux[..i].join("\\"))).or_default();
        }
        c.entry(rk(racine, cle)).or_default().insert(nom.to_lowercase(), (nom.to_string(), v));
    }
    pub fn toutes_les_cles_hkcu(&self) -> Vec<String> {
        self.cles.lock().unwrap().keys().filter(|(r, _)| *r == 0).map(|(_, k)| k.clone()).collect()
    }
}

impl Registre for RegistreFactice {
    fn lire(&self, racine: Racine, cle: &str, nom: &str) -> Option<Valeur> {
        self.cles.lock().unwrap().get(&rk(racine, cle))?.get(&nom.to_lowercase()).map(|(_, v)| v.clone())
    }
    fn sous_cles(&self, racine: Racine, cle: &str) -> Vec<String> {
        let (r, k) = rk(racine, cle);
        let prefixe = k + "\\";
        let mut v: BTreeSet<String> = BTreeSet::new();
        for (rr, x) in self.cles.lock().unwrap().keys() {
            if *rr == r && x.starts_with(&prefixe) {
                v.insert(x[prefixe.len()..].split('\\').next().unwrap_or("").to_string());
            }
        }
        v.into_iter().collect()
    }
    fn valeurs(&self, cle: &str) -> Option<Vec<(String, Valeur)>> {
        self.cles.lock().unwrap().get(&rk(Racine::Hkcu, cle)).map(|m| m.values().cloned().collect())
    }
    fn ecrire(&self, cle: &str, nom: &str, v: &Valeur) -> io::Result<()> {
        if let Some(m) = self.panne.lock().unwrap().as_ref() {
            if cle.to_lowercase().contains(&m.to_lowercase()) || nom.to_lowercase().contains(&m.to_lowercase()) {
                return Err(io::Error::other("panne simulée du registre"));
            }
        }
        self.poser(Racine::Hkcu, cle, nom, v.clone());
        Ok(())
    }
    fn supprimer_valeur(&self, cle: &str, nom: &str) -> io::Result<()> {
        if let Some(m) = self.cles.lock().unwrap().get_mut(&rk(Racine::Hkcu, cle)) {
            m.remove(&nom.to_lowercase());
        }
        Ok(())
    }
    fn supprimer_cle(&self, cle: &str) -> io::Result<()> {
        let (r, k) = rk(Racine::Hkcu, cle);
        let prefixe = k.clone() + "\\";
        self.cles.lock().unwrap().retain(|(rr, x), _| !(*rr == r && (*x == k || x.starts_with(&prefixe))));
        Ok(())
    }
}

#[derive(Default)]
pub struct SystemeFactice {
    /// chemin de l'exe (normalisé) -> version de fichier
    pub versions: Mutex<BTreeMap<String, String>>,
    pub processus: Mutex<BTreeSet<String>>,
    pub fermes: Mutex<Vec<String>>,
    pub lances: Mutex<Vec<(String, Vec<String>)>>,
    pub raccourcis: Mutex<Vec<(String, String, String)>>,
    pub espace: Mutex<Option<u64>>,
    /// Les raccourcis sont aussi écrits dans ce système de fichiers factice (pour la désinstallation).
    pub fs: Option<std::sync::Arc<FsFactice>>,
}

impl SystemeFactice {
    pub fn poser_version(&self, exe: impl AsRef<Path>, v: &str) {
        self.versions.lock().unwrap().insert(cle_chemin(exe.as_ref()), v.to_string());
    }
}

impl Systeme for SystemeFactice {
    fn version_fichier(&self, exe: &Path) -> Option<String> {
        self.versions.lock().unwrap().get(&cle_chemin(exe)).cloned()
    }
    fn processus_present(&self, nom_exe: &str) -> bool {
        self.processus.lock().unwrap().contains(&nom_exe.to_lowercase())
    }
    fn fermer_processus(&self, nom_exe: &str) -> usize {
        let present = self.processus.lock().unwrap().remove(&nom_exe.to_lowercase());
        if present {
            self.fermes.lock().unwrap().push(nom_exe.to_string());
        }
        present as usize
    }
    fn creer_raccourci(&self, lnk: &Path, cible: &Path, arguments: &str, _description: &str) -> Result<(), String> {
        if let Some(fs) = &self.fs {
            fs.ecrire_tout(lnk, format!("[raccourci factice] {} {}", cible.display(), arguments).as_bytes()).map_err(|e| e.to_string())?;
        }
        self.raccourcis.lock().unwrap().push((lnk.display().to_string(), cible.display().to_string(), arguments.to_string()));
        Ok(())
    }
    fn lancer(&self, exe: &Path, arguments: &[String]) -> Result<(), String> {
        self.lances.lock().unwrap().push((exe.display().to_string(), arguments.to_vec()));
        Ok(())
    }
    fn espace_libre(&self, _p: &Path) -> Option<u64> {
        *self.espace.lock().unwrap()
    }
}

/// Un environnement factice complet, avec les dossiers d'un utilisateur « Élodie » sous `C:\Users`.
pub struct Banc {
    pub fs: std::sync::Arc<FsFactice>,
    pub registre: std::sync::Arc<RegistreFactice>,
    pub systeme: std::sync::Arc<SystemeFactice>,
    pub env: Environnement,
}

impl Banc {
    pub fn nouveau() -> Self {
        let fs = std::sync::Arc::new(FsFactice::nouveau());
        let registre = std::sync::Arc::new(RegistreFactice::nouveau());
        let systeme = std::sync::Arc::new(SystemeFactice { fs: Some(fs.clone()), ..Default::default() });
        *systeme.espace.lock().unwrap() = Some(182 * 1_000_000_000);
        let u = PathBuf::from("C:\\Users\\Élodie");
        let emplacements = Emplacements {
            local: u.join("AppData\\Local"),
            itinerant: u.join("AppData\\Roaming"),
            videos: u.join("Videos"),
            menu_demarrer: u.join("AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs"),
            programmes: vec![PathBuf::from("C:\\Program Files")],
            programmes_communs: vec![PathBuf::from("C:\\Program Files\\Common Files")],
        };
        for d in [&emplacements.local, &emplacements.itinerant, &emplacements.videos, &emplacements.menu_demarrer] {
            fs.creer_dossiers(d).unwrap();
        }
        fs.creer_dossiers(Path::new("C:\\Program Files")).unwrap();
        let env = Environnement { fs: fs.clone(), registre: registre.clone(), systeme: systeme.clone(), emplacements };
        Banc { fs, registre, systeme, env }
    }
}

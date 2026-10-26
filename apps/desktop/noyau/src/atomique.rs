//! Écriture atomique (contrat §1) : on écrit un fichier temporaire `…tmp` à côté, on le vide sur le disque, puis on
//! le renomme par-dessus la cible. Un lecteur voit donc l'ancienne version ou la nouvelle, jamais un fichier à moitié
//! écrit. Le nom temporaire porte le numéro du processus et un compteur (`index.json.4242-7.tmp`) : deux processus
//! (Desktop et l'hôte Native Messaging) ne se marchent jamais dessus ; il se termine toujours par `.tmp`, ce qui permet
//! aux lecteurs de l'ignorer et au nettoyage de supprimer les orphelins.
//!
//! Lecture tolérante : un JSON absent, illisible ou incomplet est signalé, jamais effacé ; l'appelant réessaie au
//! passage suivant. UTF-8 sans BOM à l'écriture ; un BOM éventuel est ignoré à la lecture.

use serde::{de::DeserializeOwned, Serialize};
use std::fs;
use std::io::{self, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

static COMPTEUR: AtomicU64 = AtomicU64::new(0);

/// Écrit `contenu` dans `chemin` de façon atomique (crée le dossier parent au besoin).
pub fn ecrire(chemin: &Path, contenu: &[u8]) -> io::Result<()> {
    let parent = chemin.parent().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "chemin sans dossier"))?;
    fs::create_dir_all(parent)?;
    let nom = chemin
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "chemin sans nom de fichier"))?
        .to_string_lossy()
        .into_owned();
    let n = COMPTEUR.fetch_add(1, Ordering::Relaxed);
    let tmp = parent.join(format!("{nom}.{}-{n}.tmp", std::process::id()));
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(contenu)?;
        f.sync_all()?;
    }
    // Sous Windows, le renommage peut échouer brièvement si un lecteur (le panneau) tient le fichier ouvert :
    // quelques essais espacés, puis abandon propre (le fichier temporaire est retiré).
    let mut derniere = None;
    for essai in 0..8u64 {
        match fs::rename(&tmp, chemin) {
            Ok(()) => return Ok(()),
            Err(e) => {
                derniere = Some(e);
                std::thread::sleep(Duration::from_millis(15 * (essai + 1)));
            }
        }
    }
    let _ = fs::remove_file(&tmp);
    Err(derniere.unwrap_or_else(|| io::Error::other("renommage impossible")))
}

/// Sérialise en JSON (indenté si `joli`) puis écrit de façon atomique.
pub fn ecrire_json<T: Serialize + ?Sized>(chemin: &Path, valeur: &T, joli: bool) -> io::Result<()> {
    let mut octets = if joli { serde_json::to_vec_pretty(valeur) } else { serde_json::to_vec(valeur) }
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    octets.push(b'\n');
    ecrire(chemin, &octets)
}

/// Résultat d'une lecture tolérante.
#[derive(Debug)]
pub enum Lecture<T> {
    Absent,
    /// JSON illisible ou incomplet : on réessaiera au passage suivant. Le message ne contient aucune donnée du fichier.
    Illisible(String),
    Lu(T),
}

impl<T> Lecture<T> {
    pub fn ok(self) -> Option<T> {
        match self {
            Lecture::Lu(v) => Some(v),
            _ => None,
        }
    }
}

/// Retire un BOM UTF-8 éventuel.
pub fn sans_bom(octets: &[u8]) -> &[u8] {
    octets.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(octets)
}

pub fn lire_json<T: DeserializeOwned>(chemin: &Path) -> Lecture<T> {
    match fs::read(chemin) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Lecture::Absent,
        Err(e) => Lecture::Illisible(format!("lecture impossible ({})", e.kind())),
        Ok(octets) => match serde_json::from_slice(sans_bom(&octets)) {
            Ok(v) => Lecture::Lu(v),
            Err(e) => Lecture::Illisible(format!("JSON illisible ou incomplet (ligne {}, colonne {})", e.line(), e.column())),
        },
    }
}

/// Vrai si le nom désigne un fichier temporaire (le nôtre ou celui d'un autre écrivain).
pub fn est_temporaire(nom: &str) -> bool {
    nom.to_ascii_lowercase().ends_with(".tmp")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ecriture_puis_lecture() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("sous").join("index.json");
        ecrire_json(&f, &serde_json::json!({"schema": 1, "nom": "Coucher de soleil sur la côte"}), true).unwrap();
        let v: serde_json::Value = lire_json(&f).ok().unwrap();
        assert_eq!(v["nom"], "Coucher de soleil sur la côte");
        // Aucun fichier temporaire ne reste.
        let restes: Vec<_> = fs::read_dir(f.parent().unwrap()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(restes.len(), 1);
        // Pas de BOM à l'écriture.
        assert_ne!(&fs::read(&f).unwrap()[..3], &[0xEF, 0xBB, 0xBF]);
    }

    #[test]
    fn remplacement_et_tolerance() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("c.json");
        ecrire(&f, b"{\"a\":1}").unwrap();
        ecrire(&f, b"{\"a\":2}").unwrap();
        let v: serde_json::Value = lire_json(&f).ok().unwrap();
        assert_eq!(v["a"], 2);
        // JSON tronqué : signalé, jamais effacé.
        fs::write(&f, b"{\"a\":").unwrap();
        assert!(matches!(lire_json::<serde_json::Value>(&f), Lecture::Illisible(_)));
        assert!(f.exists());
        // BOM accepté à la lecture.
        fs::write(&f, b"\xEF\xBB\xBF{\"a\":3}").unwrap();
        let v: serde_json::Value = lire_json(&f).ok().unwrap();
        assert_eq!(v["a"], 3);
        assert!(matches!(lire_json::<serde_json::Value>(&d.path().join("absent.json")), Lecture::Absent));
    }

    #[test]
    fn chemins_unicode() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("Élodie — vidéos 🎬").join("état.json");
        ecrire_json(&f, &serde_json::json!({"ok": true}), false).unwrap();
        assert!(f.exists());
        assert!(est_temporaire("index.json.12-3.tmp"));
        assert!(est_temporaire("X.TMP"));
        assert!(!est_temporaire("index.json"));
    }
}

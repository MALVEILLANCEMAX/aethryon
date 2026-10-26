//! Journaux locaux : `R\journaux\desktop-AAAA-MM-JJ.log`, un fichier par jour, 5 Mo au plus par jour (au-delà,
//! une ligne signale la coupure), gardés 14 jours. Rien n'est envoyé nulle part. Les motifs qui ressemblent à des
//! secrets (jeton, clé, mot de passe, en-tête d'autorisation, paramètre `sig=`) sont masqués avant écriture.

use crate::horloge;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

pub const TAILLE_MAX_JOUR: u64 = 5 * 1024 * 1024;
pub const GARDE_JOURS: i64 = 14;

struct Journal {
    dossier: PathBuf,
    prefixe: String,
}

static JOURNAL: OnceLock<Mutex<Journal>> = OnceLock::new();

/// Active (ou redirige) la journalisation dans `dossier`.
pub fn initialiser(dossier: &Path, prefixe: &str) {
    let _ = std::fs::create_dir_all(dossier);
    let j = JOURNAL.get_or_init(|| Mutex::new(Journal { dossier: dossier.to_path_buf(), prefixe: prefixe.to_string() }));
    if let Ok(mut j) = j.lock() {
        j.dossier = dossier.to_path_buf();
        j.prefixe = prefixe.to_string();
    }
}

/// Masque ce qui ressemble à un secret. Appliqué à chaque ligne, même si aucun secret n'est censé passer.
pub fn masquer(texte: &str) -> String {
    let mut sortie = String::with_capacity(texte.len());
    let minuscule = texte.to_ascii_lowercase();
    let cles = ["token", "jeton", "password", "mot de passe", "secret", "authorization", "apikey", "api_key", "sig", "cookie", "bearer"];
    let mut i = 0usize;
    let octets = texte.as_bytes();
    'externe: while i < texte.len() {
        for c in cles {
            if minuscule[i..].starts_with(c) && (i == 0 || !minuscule.as_bytes()[i - 1].is_ascii_alphanumeric()) {
                let mut j = i + c.len();
                // Séparateur « = », « : » ou espace, puis la valeur jusqu'au prochain blanc, « & », « " » ou « , ».
                let debut_sep = j;
                while j < texte.len() && matches!(octets[j], b'=' | b':' | b' ' | b'"') {
                    j += 1;
                }
                if j == debut_sep {
                    break;
                }
                let debut_val = j;
                while j < texte.len() && !matches!(octets[j], b' ' | b'&' | b'"' | b',' | b'\n' | b';') {
                    j += 1;
                }
                // « Bearer xyz », « Basic xyz » : le jeton est le mot suivant.
                let mot = &minuscule[debut_val..j];
                if (mot == "bearer" || mot == "basic") && j < texte.len() && octets[j] == b' ' {
                    j += 1;
                    while j < texte.len() && !matches!(octets[j], b' ' | b'&' | b'"' | b',' | b'\n' | b';') {
                        j += 1;
                    }
                }
                if j > debut_val {
                    sortie.push_str(&texte[i..debut_val]);
                    sortie.push_str("•••");
                    i = j;
                    continue 'externe;
                }
                break;
            }
        }
        let ch = texte[i..].chars().next().unwrap();
        sortie.push(ch);
        i += ch.len_utf8();
    }
    sortie
}

pub fn ecrire(niveau: &str, module: &str, message: &str) {
    let Some(j) = JOURNAL.get() else { return };
    let Ok(j) = j.lock() else { return };
    ecrire_dans(&j.dossier, &j.prefixe, niveau, module, message);
}

/// Écrit une ligne dans le journal du jour de `dossier` (sans état global : employé par `ecrire` et par les essais).
pub fn ecrire_dans(dossier: &Path, prefixe: &str, niveau: &str, module: &str, message: &str) {
    let t = horloge::maintenant();
    let chemin = dossier.join(format!("{}-{}.log", prefixe, horloge::jour(t)));
    let taille = std::fs::metadata(&chemin).map(|m| m.len()).unwrap_or(0);
    if taille > TAILLE_MAX_JOUR {
        return;
    }
    let ligne = if taille + 512 > TAILLE_MAX_JOUR {
        format!("{} AVERT journal : taille maximale du jour atteinte, lignes suivantes ignorées\n", horloge::iso_ms(t))
    } else {
        format!("{} {:<5} {}: {}\n", horloge::iso_ms(t), niveau, module, masquer(message).replace('\n', " ⏎ "))
    };
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&chemin) {
        let _ = f.write_all(ligne.as_bytes());
    }
}

pub fn info(module: &str, message: &str) {
    ecrire("INFO", module, message)
}
pub fn avert(module: &str, message: &str) {
    ecrire("AVERT", module, message)
}
pub fn erreur(module: &str, message: &str) {
    ecrire("ERREUR", module, message)
}

/// Fichiers de journal présents : (nombre, octets).
pub fn resume(dossier: &Path) -> (usize, u64) {
    let Ok(l) = std::fs::read_dir(dossier) else { return (0, 0) };
    l.flatten()
        .filter(|e| e.file_name().to_string_lossy().ends_with(".log"))
        .filter_map(|e| e.metadata().ok())
        .fold((0, 0), |(n, o), m| (n + 1, o + m.len()))
}

/// Dernières lignes du journal du Desktop (rapport exporté par l'utilisateur).
pub fn dernieres_lignes(dossier: &Path, n: usize) -> Vec<String> {
    let Ok(l) = std::fs::read_dir(dossier) else { return vec![] };
    let mut f: Vec<PathBuf> = l.flatten().map(|e| e.path()).filter(|p| p.file_name().map(|n| n.to_string_lossy().starts_with("desktop-")).unwrap_or(false)).collect();
    f.sort();
    let mut lignes = Vec::new();
    for p in f.iter().rev() {
        let Ok(t) = std::fs::read_to_string(p) else { continue };
        let mut v: Vec<String> = t.lines().map(String::from).collect();
        v.extend(lignes);
        lignes = v;
        if lignes.len() >= n {
            break;
        }
    }
    let debut = lignes.len().saturating_sub(n);
    lignes[debut..].to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masquage() {
        assert_eq!(masquer("appel avec token=abc123&x=1"), "appel avec token=•••&x=1");
        assert_eq!(masquer("Authorization: Bearer xyz"), "Authorization: •••");
        assert_eq!(masquer("https://x/y?sig=ABCDEF&e=1"), "https://x/y?sig=•••&e=1");
        assert_eq!(masquer("jeton : 42"), "jeton : •••");
        assert_eq!(masquer("Coucher de soleil sur la côte.mp4 — 826 Ko"), "Coucher de soleil sur la côte.mp4 — 826 Ko");
        assert_eq!(masquer("signature du paquet"), "signature du paquet", "« sig » au début d'un mot sans séparateur : rien à masquer");
        assert_eq!(masquer("design token"), "design token");
    }

    #[test]
    fn ecriture_quotidienne() {
        let d = tempfile::tempdir().unwrap();
        ecrire_dans(d.path(), "desktop", "INFO", "essai", "Démarrage d'AETHRYON Desktop — mot de passe: hunter2");
        let (n, o) = resume(d.path());
        assert_eq!(n, 1);
        assert!(o > 0);
        let l = dernieres_lignes(d.path(), 10);
        assert!(l[0].contains("Démarrage") && !l[0].contains("hunter2"));
    }
}

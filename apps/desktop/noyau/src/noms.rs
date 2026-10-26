//! Noms et chemins : identifiant d'un média (contrat §3), nettoyage des noms de fichiers pour Windows (caractères
//! interdits, noms réservés, point ou espace final, NFC, longueur), et appartenance d'un chemin à un dossier surveillé
//! (protection contre l'injection de chemins, contrat §5 et §7).

use sha1::{Digest, Sha1};
use std::path::{Component, Path};
use unicode_normalization::UnicodeNormalization;

/// Longueur maximale d'un nom de fichier créé par AETHRYON (audit §4.4).
pub const NOM_MAX: usize = 120;
/// Longueur maximale d'un chemin complet créé par AETHRYON (marge sous MAX_PATH = 260).
pub const CHEMIN_MAX: usize = 240;

/// Chemin normalisé pour l'identifiant : minuscules, séparateurs `\`.
pub fn normaliser_pour_id(chemin: &str) -> String {
    chemin.replace('/', "\\").to_lowercase()
}

/// `id` d'un média : SHA-1 hexadécimal du chemin normalisé (contrat §3).
pub fn id_media(chemin: &str) -> String {
    let mut h = Sha1::new();
    h.update(normaliser_pour_id(chemin).as_bytes());
    h.finalize().iter().map(|o| format!("{o:02x}")).collect()
}

/// Vrai si `id` a la forme d'un identifiant d'index (40 chiffres hexadécimaux minuscules).
pub fn est_id_valide(id: &str) -> bool {
    id.len() == 40 && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

const RESERVES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2",
    "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Nettoie un nom de fichier pour Windows : NFC, caractères `<>:"/\|?*` et de contrôle remplacés, espaces repliés,
/// point ou espace final retiré, nom réservé préfixé, longueur limitée à [`NOM_MAX`] caractères (extension gardée).
pub fn nettoyer_nom_fichier(nom: &str) -> String {
    let nfc: String = nom.nfc().collect();
    let mut propre = String::with_capacity(nfc.len());
    let mut espace = false;
    for c in nfc.chars() {
        let c = match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => ' ',
            c if (c as u32) < 0x20 || c == '\u{7f}' => ' ',
            c => c,
        };
        if c.is_whitespace() {
            if !espace && !propre.is_empty() {
                propre.push(' ');
            }
            espace = true;
        } else {
            propre.push(c);
            espace = false;
        }
    }
    let mut propre = propre.trim_end_matches(['.', ' ']).trim_start().to_string();
    // « Nuit .mp4 » → « Nuit.mp4 » : pas d'espace avant l'extension.
    if let Some(i) = propre.rfind('.') {
        if i > 0 && propre.len() - i <= 8 {
            let (souche, ext) = propre.split_at(i);
            let souche = souche.trim_end_matches([' ', '.']);
            if !souche.is_empty() {
                propre = format!("{souche}{ext}");
            }
        }
    }
    if propre.is_empty() {
        propre = "média".into();
    }
    // Nom réservé (avec ou sans extension) : « CON.mp4 » est interdit sous Windows.
    let base = propre.split('.').next().unwrap_or("").trim().to_ascii_uppercase();
    if RESERVES.contains(&base.as_str()) {
        propre = format!("_{propre}");
    }
    if propre.chars().count() > NOM_MAX {
        let (souche, ext) = match propre.rfind('.') {
            Some(i) if propre.len() - i <= 8 && i > 0 => (propre[..i].to_string(), propre[i..].to_string()),
            _ => (propre.clone(), String::new()),
        };
        let garde = NOM_MAX.saturating_sub(ext.chars().count()).max(1);
        let souche: String = souche.chars().take(garde).collect();
        propre = format!("{}{}", souche.trim_end_matches(['.', ' ']), ext);
    }
    propre
}

/// Vrai si `nom` est déjà un nom de fichier propre (aucun séparateur, rien à nettoyer).
pub fn est_nom_propre(nom: &str) -> bool {
    !nom.is_empty() && nom != "." && nom != ".." && nettoyer_nom_fichier(nom) == nom
}

/// Composants « lexicaux » d'un chemin absolu : refuse `..`, `.` est ignoré. Comparaison insensible à la casse.
fn composants(chemin: &str) -> Option<Vec<String>> {
    let unifie = chemin.replace('\\', "/");
    let mut v = Vec::new();
    for (i, partie) in unifie.split('/').enumerate() {
        match partie {
            "" if i == 0 => v.push(String::new()), // racine Unix ou UNC
            "" | "." => {}
            ".." => return None,
            p => v.push(p.to_lowercase()),
        }
    }
    Some(v)
}

/// Vrai si `chemin` est `dossier` lui-même ou se trouve dessous (sans `..`, casse ignorée, comme sous Windows).
pub fn est_dans(chemin: &str, dossier: &str) -> bool {
    match (composants(chemin), composants(dossier)) {
        (Some(c), Some(d)) => !d.is_empty() && c.len() >= d.len() && c[..d.len()] == d[..],
        _ => false,
    }
}

/// Vrai si `chemin` est absolu au sens de Windows (`C:\…`, `\\serveur\partage\…`) ou d'Unix (`/…`, essais).
pub fn est_absolu(chemin: &str) -> bool {
    let b = chemin.as_bytes();
    (b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/'))
        || chemin.starts_with("\\\\")
        || Path::new(chemin).is_absolute()
}

/// Vrai si le chemin désigne une racine de volume (`C:\`) : jamais un dossier surveillé.
pub fn est_racine_volume(chemin: &str) -> bool {
    let t = chemin.trim_end_matches(['\\', '/']);
    (t.len() == 2 && t.as_bytes()[1] == b':') || t.is_empty() || Path::new(chemin).components().all(|c| matches!(c, Component::RootDir | Component::Prefix(_)))
}

/// Dossiers système qu'on refuse de surveiller (préfixes, casse ignorée).
pub fn est_dossier_systeme(chemin: &str) -> bool {
    let c = normaliser_pour_id(chemin);
    let sys = ["c:\\windows", "c:\\program files", "c:\\program files (x86)", "c:\\programdata", "c:\\$recycle.bin"];
    sys.iter().any(|s| c == *s || c.starts_with(&format!("{s}\\")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifiant_stable_et_insensible_a_la_casse() {
        let a = id_media("C:\\Users\\Élodie\\Downloads\\AETHRYON\\Coucher de soleil sur la côte.mp4");
        let b = id_media("c:/users/élodie/downloads/aethryon/coucher de soleil sur la CÔTE.mp4");
        assert_eq!(a, b);
        assert!(est_id_valide(&a));
        // Valeur figée : le panneau et le Desktop doivent produire exactement la même chose.
        assert_eq!(id_media("C:\\A\\b.mp4"), {
            let mut h = Sha1::new();
            h.update("c:\\a\\b.mp4".as_bytes());
            h.finalize().iter().map(|o| format!("{o:02x}")).collect::<String>()
        });
        assert!(!est_id_valide("../../etc"));
        assert!(!est_id_valide(&a.to_uppercase()));
    }

    #[test]
    fn nettoyage_windows() {
        assert_eq!(nettoyer_nom_fichier("Clip: «Paris» / Nuit?*.mp4"), "Clip «Paris» Nuit.mp4");
        assert_eq!(nettoyer_nom_fichier("a<b>c|d\"e.mp4"), "a b c d e.mp4");
        assert_eq!(nettoyer_nom_fichier("fin.   "), "fin");
        assert_eq!(nettoyer_nom_fichier("CON.mp4"), "_CON.mp4");
        assert_eq!(nettoyer_nom_fichier("lpt1"), "_lpt1");
        assert_eq!(nettoyer_nom_fichier("console.mp4"), "console.mp4");
        assert_eq!(nettoyer_nom_fichier("   "), "média");
        assert_eq!(nettoyer_nom_fichier("tab\there\nnl.mp3"), "tab here nl.mp3");
        // NFC : « é » décomposé devient composé.
        assert_eq!(nettoyer_nom_fichier("Cafe\u{301}.mp4"), "Café.mp4");
        // Emoji gardés.
        assert_eq!(nettoyer_nom_fichier("Soirée 🎬.mp4"), "Soirée 🎬.mp4");
        let long = format!("{}.mp4", "é".repeat(300));
        let n = nettoyer_nom_fichier(&long);
        assert_eq!(n.chars().count(), NOM_MAX);
        assert!(n.ends_with(".mp4"));
        assert!(est_nom_propre("Coucher de soleil.mp4"));
        assert!(!est_nom_propre("..\\x.mp4"));
        assert!(!est_nom_propre(".."));
    }

    #[test]
    fn appartenance_aux_dossiers() {
        let d = "C:\\Users\\Élodie\\Downloads\\AETHRYON";
        assert!(est_dans("C:\\Users\\Élodie\\Downloads\\AETHRYON\\a.mp4", d));
        assert!(est_dans("c:/users/élodie/downloads/aethryon/sous/a.mp4", d));
        assert!(est_dans(d, d));
        assert!(!est_dans("C:\\Users\\Élodie\\Downloads\\AETHRYON-autre\\a.mp4", d));
        assert!(!est_dans("C:\\Users\\Élodie\\Downloads\\AETHRYON\\..\\secret.txt", d));
        assert!(!est_dans("C:\\Windows\\a.mp4", d));
        assert!(est_absolu("C:\\x") && est_absolu("\\\\nas\\medias") && !est_absolu("x\\y") && !est_absolu("C:x"));
        assert!(est_racine_volume("C:\\") && est_racine_volume("D:") && !est_racine_volume("D:\\Rushes"));
        assert!(est_dossier_systeme("C:\\Windows\\System32") && est_dossier_systeme("c:\\program files\\Adobe"));
        assert!(!est_dossier_systeme("C:\\Users\\Élodie\\Videos"));
    }
}

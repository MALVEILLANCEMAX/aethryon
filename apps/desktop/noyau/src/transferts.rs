//! Transferts (`R\transferts\<id>.json`, contrat §6). Écrits par l'hôte Native Messaging (lancé par le navigateur)
//! et par le Desktop, qui relie un transfert à l'entrée de l'index quand le fichier attendu arrive (`pret`).
//! 3.8.1 (contrat §12, proposé) : le Desktop écrit aussi les transferts de SES conversions (« Coller un lien »,
//! « Envoyer vers › Premiere Pro » relayé par l'extension), avec trois champs facultatifs : `origine`, `premiere`
//! (import demandé au panneau) et `code` (code stable d'une erreur).
//! Validation stricte : identifiant court, nom de fichier sans chemin, états et formats en liste fermée, aucun jeton
//! ni adresse (le schéma n'a pas de champ pour cela).

use crate::atomique::{self, Lecture};
use crate::bibliotheque::{EtatMedia, Index};
use crate::horloge::{self, Instant};
use crate::noms;
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const ETATS: [&str; 5] = ["attente", "telechargement", "conversion", "pret", "erreur"];
pub const FORMATS: [&str; 2] = ["mp4", "mp3"];
pub const TITRE_MAX: usize = 300;
/// 3.8.1 : qui a demandé la conversion.
pub const ORIGINES: [&str; 2] = ["desktop", "extension"];
/// 3.8.1 : import dans Premiere Pro demandé par le Desktop, puis son résultat RÉEL (commande `importer`, §5).
pub const ETATS_PREMIERE: [&str; 5] = ["demande", "importe", "non-connecte", "sans-projet", "echec"];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Transfert {
    pub schema: u32,
    pub id: String,
    #[serde(default)]
    pub titre: Option<String>,
    #[serde(default)]
    pub plateforme: Option<String>,
    #[serde(default)]
    pub format: Option<String>,
    pub etat: String,
    #[serde(default)]
    pub progression: Option<f64>,
    #[serde(default)]
    pub fichier_attendu: Option<String>,
    #[serde(default)]
    pub chemin: Option<String>,
    #[serde(default)]
    pub erreur: Option<String>,
    pub maj_le: String,
    /// 3.8.1 : `desktop` ou `extension` (absent : transfert annoncé par l'extension, contrat §6).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origine: Option<String>,
    /// 3.8.1 : import dans Premiere Pro ([`ETATS_PREMIERE`]) ; absent : rien de demandé.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub premiere: Option<String>,
    /// 3.8.1 : code stable d'une erreur (`non_relie`, `quota_exceeded`…), à côté du message `erreur`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// Nocturne : octets du fichier déjà reçus par le Desktop (conversion qu'il télécharge lui-même), total annoncé par
    /// le serveur, débit MESURÉ sur les dernières secondes (octets par seconde) et pause demandée dans Transferts.
    /// Absents : inconnus (jamais estimés).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recus: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vitesse: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pause: Option<bool>,
}

pub fn id_valide(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn texte_propre(s: &str, max: usize) -> String {
    s.chars().filter(|c| !c.is_control()).take(max).collect::<String>().trim().to_string()
}

impl Transfert {
    /// Vérifie et nettoie un transfert venu de l'extérieur (hôte Native Messaging). Message clair en cas de refus.
    pub fn valider(mut self) -> Result<Self, String> {
        if !id_valide(&self.id) {
            return Err("Identifiant de transfert refusé (lettres, chiffres, tirets, 64 caractères au plus).".into());
        }
        if !ETATS.contains(&self.etat.as_str()) {
            return Err(format!("État de transfert inconnu : « {} ».", texte_propre(&self.etat, 24)));
        }
        if let Some(f) = &self.format {
            if !FORMATS.contains(&f.as_str()) {
                return Err(format!("Format refusé : « {} » (mp4 ou mp3).", texte_propre(f, 12)));
            }
        }
        if let Some(p) = &self.plateforme {
            if p.is_empty() || p.len() > 24 || !p.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') {
                return Err("Plateforme refusée.".into());
            }
        }
        if let Some(p) = self.progression {
            if !p.is_finite() || !(0.0..=1.0).contains(&p) {
                return Err("Progression hors de 0 à 1.".into());
            }
        }
        if let Some(n) = &self.fichier_attendu {
            if !noms::est_nom_propre(n) || n.chars().count() > noms::NOM_MAX {
                return Err("Nom de fichier attendu refusé : un nom simple, sans dossier ni caractère interdit.".into());
            }
        }
        if self.origine.as_deref().is_some_and(|o| !ORIGINES.contains(&o)) || self.premiere.as_deref().is_some_and(|p| !ETATS_PREMIERE.contains(&p)) {
            return Err("Transfert mal formé.".into());
        }
        if let Some(c) = &self.code {
            if c.is_empty() || c.len() > 40 || !c.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
                return Err("Transfert mal formé.".into());
            }
        }
        // Octets et débit : bornés (10 Gio, 10 Gio/s) et cohérents ; sinon ignorés plutôt que refusés (simple affichage).
        const BORNE: u64 = 10 * 1024 * 1024 * 1024;
        if self.recus.is_some_and(|r| r > BORNE) || self.total.is_some_and(|t| t > BORNE) || self.recus.zip(self.total).is_some_and(|(r, t)| r > t) {
            (self.recus, self.total) = (None, None);
        }
        if self.vitesse.is_some_and(|v| v > BORNE) {
            self.vitesse = None;
        }
        self.titre = self.titre.map(|t| texte_propre(&t, TITRE_MAX)).filter(|t| !t.is_empty());
        self.erreur = self.erreur.map(|t| texte_propre(&t, TITRE_MAX)).filter(|t| !t.is_empty());
        self.schema = 1;
        Ok(self)
    }

    pub fn termine(&self) -> bool {
        self.etat == "pret" || self.etat == "erreur"
    }
}

pub fn chemin_transfert(dossier: &Path, id: &str) -> Option<std::path::PathBuf> {
    id_valide(id).then(|| dossier.join(format!("{id}.json")))
}

pub fn ecrire(dossier: &Path, t: &Transfert) -> std::io::Result<()> {
    let chemin = chemin_transfert(dossier, &t.id).ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "identifiant refusé"))?;
    atomique::ecrire_json(&chemin, t, true)
}

/// Lit tous les transferts lisibles (les illisibles sont ignorés jusqu'au passage suivant).
pub fn lister(dossier: &Path) -> Vec<Transfert> {
    let mut v = Vec::new();
    let Ok(l) = std::fs::read_dir(dossier) else { return v };
    for e in l.flatten() {
        let nom = e.file_name().to_string_lossy().into_owned();
        if atomique::est_temporaire(&nom) || !nom.ends_with(".json") {
            continue;
        }
        if let Lecture::Lu(t) = atomique::lire_json::<Transfert>(&e.path()) {
            if id_valide(&t.id) && format!("{}.json", t.id) == nom {
                v.push(t);
            }
        }
    }
    v.sort_by(|a, b| b.maj_le.cmp(&a.maj_le));
    v
}

/// Relie les transferts non terminés aux médias arrivés : même nom de fichier (casse ignorée) et média disponible.
/// Renvoie les transferts modifiés (à réécrire) ; l'origine du média est complétée dans l'index.
pub fn relier(transferts: &[Transfert], index: &mut Index, t: Instant) -> Vec<Transfert> {
    let mut modifies = Vec::new();
    for tr in transferts.iter().filter(|x| !x.termine()) {
        let Some(attendu) = &tr.fichier_attendu else { continue };
        let attendu = attendu.to_lowercase();
        let Some(m) = index.medias.iter_mut().find(|m| {
            m.etat == EtatMedia::Disponible && m.chemin.rsplit(['\\', '/']).next().map(|n| n.to_lowercase() == attendu).unwrap_or(false)
        }) else {
            continue;
        };
        let mut n = tr.clone();
        n.etat = "pret".into();
        n.progression = Some(1.0);
        n.chemin = Some(m.chemin.clone());
        n.maj_le = horloge::iso(t);
        if m.origine.plateforme == "local" {
            if let Some(p) = &tr.plateforme {
                m.origine.plateforme = p.clone();
                m.origine.titre = tr.titre.clone();
            }
        }
        modifies.push(n);
    }
    modifies
}

/// Retire les transferts terminés (bouton « Effacer les terminés »). Renvoie le nombre de fichiers retirés.
pub fn effacer_termines(dossier: &Path) -> usize {
    lister(dossier)
        .into_iter()
        .filter(|t| t.termine())
        .filter_map(|t| chemin_transfert(dossier, &t.id))
        .filter(|c| std::fs::remove_file(c).is_ok())
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bibliotheque::{Media, Origine, TypeMedia};
    use serde_json::json;

    fn tr(v: serde_json::Value) -> Result<Transfert, String> {
        serde_json::from_value::<Transfert>(v).map_err(|e| e.to_string())?.valider()
    }

    #[test]
    fn validation_stricte() {
        let ok = tr(json!({"schema": 1, "id": "job-42", "titre": "Coucher\u{0007} de soleil", "plateforme": "youtube", "format": "mp4",
            "etat": "telechargement", "progression": 0.64, "fichierAttendu": "Coucher de soleil.mp4", "majLe": "2026-10-18T03:00:00Z"})).unwrap();
        assert_eq!(ok.titre.as_deref(), Some("Coucher de soleil"));
        assert!(tr(json!({"schema": 1, "id": "../x", "etat": "attente", "majLe": ""})).is_err());
        assert!(tr(json!({"schema": 1, "id": "a", "etat": "fini", "majLe": ""})).is_err());
        assert!(tr(json!({"schema": 1, "id": "a", "etat": "attente", "format": "exe", "majLe": ""})).is_err());
        assert!(tr(json!({"schema": 1, "id": "a", "etat": "attente", "progression": 1.5, "majLe": ""})).is_err());
        assert!(tr(json!({"schema": 1, "id": "a", "etat": "attente", "fichierAttendu": "..\\..\\Windows\\x.mp4", "majLe": ""})).is_err());
        assert!(tr(json!({"schema": 1, "id": "a", "etat": "attente", "fichierAttendu": "C:\\x.mp4", "majLe": ""})).is_err());
        assert!(tr(json!({"schema": 1, "id": "a", "etat": "attente", "plateforme": "YouTube!", "majLe": ""})).is_err());
    }

    #[test]
    fn ecriture_liste_liaison_effacement() {
        let d = tempfile::tempdir().unwrap();
        let t0 = horloge::lire("2026-10-18T03:00:00Z").unwrap();
        let a = tr(json!({"schema": 1, "id": "a1", "titre": "Le Passage", "plateforme": "youtube", "format": "mp4", "etat": "telechargement",
            "progression": 0.5, "fichierAttendu": "AETHRYON — Le Passage.MP4", "majLe": "2026-10-18T03:00:00Z"})).unwrap();
        ecrire(d.path(), &a).unwrap();
        std::fs::write(d.path().join("illisible.json"), b"{").unwrap();
        std::fs::write(d.path().join("autre.json"), serde_json::to_vec(&json!({"schema":1,"id":"pas-le-meme","etat":"attente","majLe":""})).unwrap()).unwrap();
        let l = lister(d.path());
        assert_eq!(l.len(), 1, "le nom du fichier doit correspondre à l'identifiant");
        let mut index = Index::default();
        index.medias.push(Media {
            id: "x".repeat(40), chemin: "C:\\M\\AETHRYON — Le Passage.mp4".into(), nom: "AETHRYON — Le Passage".into(), ext: "mp4".into(),
            type_media: TypeMedia::Video, taille: 1, ajoute_le: String::new(), modifie_le: String::new(), duree: None, largeur: None,
            hauteur: None, ips: None, codec_video: None, codec_audio: None, miniature: None, etat: EtatMedia::Disponible, erreur: None,
            premiere_compatible: None, origine: Origine::default(),
        });
        let m = relier(&l, &mut index, t0);
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].etat, "pret");
        assert_eq!(m[0].chemin.as_deref(), Some("C:\\M\\AETHRYON — Le Passage.mp4"));
        assert_eq!(index.medias[0].origine.plateforme, "youtube");
        assert_eq!(index.medias[0].origine.titre.as_deref(), Some("Le Passage"));
        ecrire(d.path(), &m[0]).unwrap();
        assert!(relier(&lister(d.path()), &mut index, t0).is_empty(), "déjà prêt");
        assert_eq!(effacer_termines(d.path()), 1);
        assert!(lister(d.path()).is_empty());
    }
}

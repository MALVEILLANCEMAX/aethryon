//! Surveillance des dossiers : événements du système (crate `notify`, ReadDirectoryChangesW sous Windows), regroupés
//! pendant 400 ms, plus un passage de secours toutes les 30 s (tampon d'événements débordé, disque réseau, dossier
//! recréé) et un nouveau passage 2 s après tout fichier encore en mouvement.

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc::Sender;
use std::time::{Duration, Instant};

pub const REGROUPEMENT: Duration = Duration::from_millis(400);
pub const SECOURS: Duration = Duration::from_secs(30);
pub const REVERIFICATION: Duration = Duration::from_secs(2);

/// Signaux reçus par la boucle de surveillance.
#[derive(Debug, Clone, PartialEq)]
pub enum Signal {
    /// Un fichier a bougé dans un dossier surveillé.
    Changement,
    /// Passage complet demandé (commande `rescanner`, réglages modifiés, tampon débordé).
    Rescan,
    /// La liste des dossiers a changé : relancer le veilleur.
    Dossiers,
    Arret,
}

/// Veilleur `notify` sur une liste de dossiers. Les dossiers absents sont signalés, pas fatals.
pub struct Veilleur {
    _veilleur: Option<RecommendedWatcher>,
    pub erreurs: Vec<(String, String)>,
}

impl Veilleur {
    pub fn demarrer(dossiers: &[String], tx: Sender<Signal>) -> Self {
        let mut erreurs = Vec::new();
        let rappel = move |r: notify::Result<notify::Event>| match r {
            Ok(ev) => {
                if matches!(ev.kind, EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) | EventKind::Any | EventKind::Other) {
                    let _ = tx.send(Signal::Changement);
                }
            }
            // Erreur du veilleur (tampon débordé…) : passage complet.
            Err(_) => {
                let _ = tx.send(Signal::Rescan);
            }
        };
        let mut veilleur = match notify::recommended_watcher(rappel) {
            Ok(v) => v,
            Err(e) => {
                erreurs.push((String::new(), format!("Surveillance indisponible ({e}) : passages toutes les 30 s seulement.")));
                return Self { _veilleur: None, erreurs };
            }
        };
        for d in dossiers {
            let p = PathBuf::from(d);
            if let Err(e) = veilleur.watch(&p, RecursiveMode::Recursive) {
                erreurs.push((d.clone(), format!("Surveillance impossible ({e}).")));
            }
        }
        Self { _veilleur: Some(veilleur), erreurs }
    }
}

/// Planificateur pur (testable) : quand faire le prochain passage.
#[derive(Debug, Clone)]
pub struct Planificateur {
    pub dernier: Option<Instant>,
    regroupe_jusqu_a: Option<Instant>,
    reverif_a: Option<Instant>,
    pub actif: bool,
}

impl Planificateur {
    pub fn nouveau(actif: bool) -> Self {
        Self { dernier: None, regroupe_jusqu_a: None, reverif_a: None, actif }
    }
    /// Un événement arrive : passage dans 400 ms (les événements suivants ne repoussent pas l'échéance au-delà).
    pub fn changement(&mut self, t: Instant) {
        if self.regroupe_jusqu_a.is_none() {
            self.regroupe_jusqu_a = Some(t + REGROUPEMENT);
        }
    }
    pub fn immediat(&mut self, t: Instant) {
        self.regroupe_jusqu_a = Some(t);
    }
    /// Après un passage : `instable` = un fichier bouge encore.
    pub fn fait(&mut self, t: Instant, instable: bool) {
        self.dernier = Some(t);
        self.regroupe_jusqu_a = None;
        self.reverif_a = instable.then(|| t + REVERIFICATION);
    }
    fn echeance(&self) -> Option<Instant> {
        let secours = if self.actif { Some(self.dernier.map(|d| d + SECOURS).unwrap_or_else(Instant::now)) } else { None };
        [self.regroupe_jusqu_a, self.reverif_a, secours].into_iter().flatten().min()
    }
    pub fn doit_passer(&self, t: Instant) -> bool {
        self.dernier.is_none() || self.echeance().map(|e| e <= t).unwrap_or(false)
    }
    /// Délai d'attente du prochain signal (borné à 1 s pour rester réactif à l'arrêt).
    pub fn attente(&self, t: Instant) -> Duration {
        self.echeance().map(|e| e.saturating_duration_since(t)).unwrap_or(Duration::from_secs(1)).min(Duration::from_secs(1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;

    #[test]
    fn planification() {
        let t0 = Instant::now();
        let mut p = Planificateur::nouveau(true);
        assert!(p.doit_passer(t0), "premier passage immédiat");
        p.fait(t0, false);
        assert!(!p.doit_passer(t0 + Duration::from_secs(1)));
        assert!(p.doit_passer(t0 + Duration::from_secs(31)), "passage de secours à 30 s");
        p.changement(t0 + Duration::from_secs(2));
        p.changement(t0 + Duration::from_millis(2300));
        assert!(!p.doit_passer(t0 + Duration::from_millis(2300)));
        assert!(p.doit_passer(t0 + Duration::from_millis(2400)), "regroupement de 400 ms, non repoussé");
        p.fait(t0 + Duration::from_millis(2400), true);
        assert!(p.doit_passer(t0 + Duration::from_millis(4400)), "nouvelle vérification 2 s après un fichier instable");
        let mut inactif = Planificateur::nouveau(false);
        inactif.fait(t0, false);
        assert!(!inactif.doit_passer(t0 + Duration::from_secs(3600)), "surveillance coupée : pas de passage de secours");
        inactif.immediat(t0);
        assert!(inactif.doit_passer(t0), "« rescanner » fonctionne même surveillance coupée");
    }

    #[test]
    fn evenements_reels_du_systeme() {
        let d = tempfile::tempdir().unwrap();
        let (tx, rx) = channel();
        let v = Veilleur::demarrer(&[d.path().to_string_lossy().into_owned(), "/dossier/absent/aethryon".into()], tx);
        assert_eq!(v.erreurs.len(), 1, "le dossier absent est signalé sans bloquer les autres");
        std::thread::sleep(Duration::from_millis(100));
        std::fs::write(d.path().join("Coucher de soleil.mp4"), b"x").unwrap();
        let s = rx.recv_timeout(Duration::from_secs(5)).expect("aucun événement reçu");
        assert!(matches!(s, Signal::Changement | Signal::Rescan));
    }
}

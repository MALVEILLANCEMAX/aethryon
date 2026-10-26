//! Dates ISO 8601 UTC (contrat §1) et horodatages de noms de fichiers.

use chrono::{DateTime, SecondsFormat, Utc};

pub type Instant = DateTime<Utc>;

pub fn maintenant() -> Instant {
    Utc::now()
}

/// `2026-10-18T03:00:00Z` (secondes, suffixe Z), la forme employée dans tous les fichiers d'échange.
pub fn iso(t: Instant) -> String {
    t.to_rfc3339_opts(SecondsFormat::Secs, true)
}

/// `2026-10-18T03:00:00.123Z`, pour les battements (le panneau compare des âges de quelques secondes).
pub fn iso_ms(t: Instant) -> String {
    t.to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// Lit une date ISO 8601 (avec ou sans millisecondes, avec fuseau). `None` si illisible.
pub fn lire(texte: &str) -> Option<Instant> {
    DateTime::parse_from_rfc3339(texte.trim()).ok().map(|d| d.with_timezone(&Utc))
}

/// Âge en secondes d'une date ISO par rapport à `t` (négatif si la date est dans le futur).
pub fn age_secondes(texte: &str, t: Instant) -> Option<f64> {
    lire(texte).map(|d| (t - d).num_milliseconds() as f64 / 1000.0)
}

/// Préfixe des fichiers de commande : `20261018T030000123Z` (trié chronologiquement par le nom).
pub fn horodatage_fichier(t: Instant) -> String {
    t.format("%Y%m%dT%H%M%S%3fZ").to_string()
}

/// `AAAA-MM-JJ` (nom des journaux quotidiens).
pub fn jour(t: Instant) -> String {
    t.format("%Y-%m-%d").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn formats() {
        let t = Utc.with_ymd_and_hms(2026, 10, 18, 3, 4, 5).unwrap() + chrono::Duration::milliseconds(123);
        assert_eq!(iso(t), "2026-10-18T03:04:05Z");
        assert_eq!(iso_ms(t), "2026-10-18T03:04:05.123Z");
        assert_eq!(horodatage_fichier(t), "20261018T030405123Z");
        assert_eq!(jour(t), "2026-10-18");
        assert_eq!(lire("2026-10-18T03:04:05Z").unwrap(), Utc.with_ymd_and_hms(2026, 10, 18, 3, 4, 5).unwrap());
        assert_eq!(lire("2026-10-18T05:04:05+02:00").unwrap(), Utc.with_ymd_and_hms(2026, 10, 18, 3, 4, 5).unwrap());
        assert!(lire("hier").is_none());
        assert_eq!(age_secondes("2026-10-18T03:04:00Z", t).unwrap(), 5.123);
    }
}

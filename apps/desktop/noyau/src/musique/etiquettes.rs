//! Lecture des étiquettes et des propriétés audio RÉELLES d'un fichier de la bibliothèque (crate `lofty`, MIT OU
//! Apache-2.0, lecture seule) : titre, artistes, album, artiste de l'album, numéros de piste et de disque, année, genre,
//! ISRC, durée, codec, débit, fréquence, bits par échantillon, canaux, pochette intégrée.
//!
//! Rien n'est jamais écrit dans le fichier audio. Les valeurs « qualité » viennent des en-têtes du flux (pas d'une
//! supposition d'après l'extension) ; une valeur que le format ne porte pas reste `None` (jamais inventée).

use lofty::file::{AudioFile, FileType, TaggedFileExt};
use lofty::picture::PictureType;
use lofty::prelude::{Accessor, ItemKey};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::BufReader;
use std::path::Path;

/// Taille maximale d'une pochette intégrée gardée (au-delà : ignorée, jamais tronquée).
pub const POCHETTE_MAX: usize = 8 * 1024 * 1024;
const TEXTE_MAX: usize = 300;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Qualite {
    /// `mp3`, `aac`, `alac`, `flac`, `opus`, `vorbis`, `pcm`, `aiff`, `ape`, `wavpack`, `mpc`, `speex`, ou `inconnu`.
    pub codec: String,
    /// Conteneur lu (`mp3`, `mp4`, `flac`, `ogg`, `wav`, `aiff`…).
    pub conteneur: String,
    pub debit_kbps: Option<u32>,
    pub frequence_hz: Option<u32>,
    pub bits: Option<u8>,
    pub canaux: Option<u8>,
    pub sans_perte: bool,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct Etiquettes {
    pub titre: Option<String>,
    pub artistes: Vec<String>,
    pub album: Option<String>,
    pub artiste_album: Option<String>,
    pub numero: Option<u32>,
    pub disque: Option<u32>,
    pub annee: Option<u32>,
    pub genre: Option<String>,
    pub isrc: Option<String>,
    pub duree_s: Option<f64>,
    pub qualite: Qualite,
    /// Pochette intégrée : octets et extension (`jpg`, `png`, `webp`), reconnue par ses octets magiques.
    pub pochette: Option<(Vec<u8>, &'static str)>,
    /// Le fichier porte au moins une étiquette lisible (titre, artiste ou album).
    pub etiquete: bool,
}

/// Texte d'étiquette : sans caractère de contrôle, espaces resserrés, borné ; vide → None.
pub fn propre(s: &str) -> Option<String> {
    let t: String = s.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    let t: String = t.chars().take(TEXTE_MAX).collect();
    (!t.is_empty()).then_some(t)
}

/// Artistes : valeurs multiples de l'étiquette, ou une valeur « A; B » / « A / B » ; doublons retirés, 12 au plus.
pub fn separer_artistes<'a>(valeurs: impl Iterator<Item = &'a str>) -> Vec<String> {
    let mut v: Vec<String> = Vec::new();
    for brut in valeurs {
        for morceau in brut.split(['\0', ';']).flat_map(|m| m.split(" / ")) {
            if let Some(p) = propre(morceau) {
                if !v.iter().any(|x| x.to_lowercase() == p.to_lowercase()) && v.len() < 12 {
                    v.push(p);
                }
            }
        }
    }
    v
}

/// Type d'image reconnu par ses octets (jamais d'après le type annoncé par l'étiquette).
pub fn type_image(o: &[u8]) -> Option<&'static str> {
    if o.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if o.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("png")
    } else if o.len() > 12 && &o[0..4] == b"RIFF" && &o[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

fn conteneur(t: FileType) -> &'static str {
    match t {
        FileType::Aac => "aac",
        FileType::Aiff => "aiff",
        FileType::Ape => "ape",
        FileType::Flac => "flac",
        FileType::Mpeg => "mp3",
        FileType::Mp4 => "mp4",
        FileType::Mpc => "mpc",
        FileType::Opus | FileType::Vorbis | FileType::Speex => "ogg",
        FileType::Wav => "wav",
        FileType::WavPack => "wavpack",
        _ => "inconnu",
    }
}

/// Codec du flux MP4 (AAC, ALAC…) : relu par le lecteur MP4 de lofty, qui décode la description du flux.
fn codec_mp4(chemin: &Path) -> &'static str {
    use lofty::config::ParseOptions;
    use lofty::mp4::{Mp4Codec, Mp4File};
    let Ok(f) = File::open(chemin) else { return "inconnu" };
    match Mp4File::read_from(&mut BufReader::new(f), ParseOptions::new().read_cover_art(false)) {
        Ok(m) => match m.properties().codec() {
            Mp4Codec::AAC => "aac",
            Mp4Codec::ALAC => "alac",
            Mp4Codec::MP3 => "mp3",
            Mp4Codec::FLAC => "flac",
            _ => "inconnu",
        },
        Err(_) => "inconnu",
    }
}

/// Lit le fichier. Erreur : fichier illisible ou format non reconnu (message lisible).
pub fn lire(chemin: &Path) -> Result<Etiquettes, String> {
    let f = lofty::read_from_path(chemin).map_err(|e| format!("Étiquettes illisibles ({e})."))?;
    let t = f.file_type();
    let p = f.properties();
    let codec = match t {
        FileType::Aac => "aac",
        FileType::Aiff => "aiff",
        FileType::Ape => "ape",
        FileType::Flac => "flac",
        FileType::Mpeg => "mp3",
        FileType::Mp4 => codec_mp4(chemin),
        FileType::Mpc => "mpc",
        FileType::Opus => "opus",
        FileType::Vorbis => "vorbis",
        FileType::Speex => "speex",
        FileType::Wav => "pcm",
        FileType::WavPack => "wavpack",
        _ => "inconnu",
    };
    let sans_perte = matches!(codec, "flac" | "alac" | "pcm" | "aiff" | "ape" | "wavpack");
    let duree = p.duration().as_secs_f64();
    let qualite = Qualite {
        codec: codec.into(),
        conteneur: conteneur(t).into(),
        debit_kbps: p.audio_bitrate().or(p.overall_bitrate()).filter(|d| *d > 0),
        frequence_hz: p.sample_rate().filter(|d| *d > 0),
        // Les bits par échantillon n'ont de sens que pour un flux sans perte (un MP3 n'en a pas).
        bits: if sans_perte { p.bit_depth().filter(|b| *b > 0) } else { None },
        canaux: p.channels().filter(|c| *c > 0),
        sans_perte,
    };
    let mut e = Etiquettes { duree_s: (duree > 0.0).then_some((duree * 1000.0).round() / 1000.0), qualite, ..Default::default() };
    let Some(tag) = f.primary_tag().or_else(|| f.first_tag()) else {
        return Ok(e);
    };
    e.titre = tag.title().and_then(|s| propre(&s));
    let mut artistes = separer_artistes(tag.get_strings(&ItemKey::TrackArtist));
    if artistes.is_empty() {
        if let Some(a) = tag.artist() {
            artistes = separer_artistes(std::iter::once(a.as_ref()));
        }
    }
    e.artistes = artistes;
    e.album = tag.album().and_then(|s| propre(&s));
    e.artiste_album = tag.get_string(&ItemKey::AlbumArtist).and_then(propre);
    e.numero = tag.track().filter(|n| *n > 0 && *n < 10_000);
    e.disque = tag.disk().filter(|n| *n > 0 && *n < 1000);
    e.annee = tag.year().filter(|a| (1000..=9999).contains(a)).or_else(|| {
        tag.get_string(&ItemKey::RecordingDate).and_then(|d| d.get(0..4)).and_then(|a| a.parse().ok()).filter(|a: &u32| (1000..=9999).contains(a))
    });
    e.genre = tag.genre().and_then(|s| propre(&s));
    e.isrc = tag
        .get_string(&ItemKey::Isrc)
        .map(|s| s.trim().replace('-', "").to_uppercase())
        .filter(|s| s.len() == 12 && s.chars().all(|c| c.is_ascii_alphanumeric()));
    let images = tag.pictures();
    let image = images.iter().find(|i| i.pic_type() == PictureType::CoverFront).or_else(|| images.first());
    if let Some(i) = image {
        let o = i.data();
        if o.len() <= POCHETTE_MAX {
            if let Some(ext) = type_image(o) {
                e.pochette = Some((o.to_vec(), ext));
            }
        }
    }
    e.etiquete = e.titre.is_some() || !e.artistes.is_empty() || e.album.is_some();
    Ok(e)
}

/// Fichiers audio d'essai (produits localement par ffmpeg : sinusoïdes, aucun droit de tiers).
#[cfg(test)]
pub(crate) fn essais_fixture(n: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("essais-audio").join(n)
}

#[cfg(test)]
mod essais {
    use super::*;
    use super::essais_fixture as fixture;

    #[test]
    fn mp3_etiquettes_completes_et_pochette() {
        let e = lire(&fixture("nocturne.mp3")).unwrap();
        assert_eq!(e.titre.as_deref(), Some("Clair de nuit"));
        assert_eq!(e.artistes, vec!["Atelier Chouette"]);
        assert_eq!(e.album.as_deref(), Some("Nocturnes"));
        assert_eq!(e.artiste_album.as_deref(), Some("Atelier Chouette"));
        assert_eq!(e.numero, Some(2));
        assert_eq!(e.disque, Some(1));
        assert_eq!(e.annee, Some(2024));
        assert_eq!(e.genre.as_deref(), Some("Ambiant"));
        assert_eq!(e.isrc.as_deref(), Some("FRZZZ2400002"));
        assert!(e.etiquete);
        let q = &e.qualite;
        assert_eq!((q.codec.as_str(), q.conteneur.as_str(), q.sans_perte), ("mp3", "mp3", false));
        assert_eq!(q.frequence_hz, Some(44_100));
        assert_eq!(q.canaux, Some(2));
        assert_eq!(q.bits, None, "un MP3 n'a pas de bits par échantillon");
        let d = q.debit_kbps.unwrap();
        assert!((180..=200).contains(&d), "débit mesuré {d}");
        let s = e.duree_s.unwrap();
        assert!((1.4..1.7).contains(&s), "durée {s}");
        let (img, ext) = e.pochette.unwrap();
        assert_eq!(ext, "png");
        assert_eq!(type_image(&img), Some("png"));
    }

    #[test]
    fn flac_sans_perte_24_bits_96_khz_et_deux_artistes() {
        let e = lire(&fixture("ivoire.flac")).unwrap();
        assert_eq!(e.titre.as_deref(), Some("Ivoire"));
        assert_eq!(e.artistes, vec!["Atelier Chouette", "Invité"]);
        assert_eq!(e.numero, Some(3));
        assert_eq!(e.annee, Some(2024));
        let q = &e.qualite;
        assert_eq!((q.codec.as_str(), q.sans_perte, q.bits, q.frequence_hz, q.canaux), ("flac", true, Some(24), Some(96_000), Some(2)));
        assert!(e.pochette.is_none());
    }

    #[test]
    fn m4a_aac_reconnu_par_le_flux_et_opus() {
        let e = lire(&fixture("champagne.m4a")).unwrap();
        assert_eq!((e.qualite.codec.as_str(), e.qualite.conteneur.as_str(), e.qualite.sans_perte), ("aac", "mp4", false));
        assert_eq!(e.titre.as_deref(), Some("Champagne"));
        assert_eq!(e.qualite.frequence_hz, Some(48_000));
        let o = lire(&fixture("obsidienne.opus")).unwrap();
        assert_eq!((o.qualite.codec.as_str(), o.qualite.conteneur.as_str()), ("opus", "ogg"));
        assert_eq!(o.artistes, vec!["Or Clair"]);
    }

    #[test]
    fn wav_sans_etiquette_mesure_sans_rien_inventer() {
        let e = lire(&fixture("sans-etiquette.wav")).unwrap();
        assert!(!e.etiquete);
        assert_eq!(e.titre, None);
        assert!(e.artistes.is_empty());
        let q = &e.qualite;
        assert_eq!((q.codec.as_str(), q.sans_perte, q.bits, q.frequence_hz, q.canaux), ("pcm", true, Some(16), Some(22_050), Some(1)));
    }

    #[test]
    fn fichier_qui_n_est_pas_de_l_audio_est_refuse() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("faux.mp3");
        std::fs::write(&p, b"<html>pas un mp3</html>").unwrap();
        assert!(lire(&p).is_err());
    }

    #[test]
    fn textes_et_artistes_nettoyes() {
        assert_eq!(propre("  a\u{0}b \n c "), Some("a b c".into()));
        assert_eq!(propre("   "), None);
        assert_eq!(separer_artistes(["A; B", "b", "C / D"].into_iter()), vec!["A", "B", "C", "D"]);
        assert_eq!(type_image(b"GIF89a"), None);
    }
}

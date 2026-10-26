//! Métadonnées différées et miniatures progressives de l'index, en arrière-plan (un seul fil, priorité basse), après le
//! scan ; les cartes visibles passent devant (`demander_miniatures`).
//!
//! - Audio : `musique::etiquettes::lire` (lofty, lecture seule) : durée, codec, titre, artistes, album, année, et
//!   pochette intégrée → miniature (décodée et réduite ici, jamais copiée telle quelle).
//! - Vidéo : en-têtes MP4 / MOV / M4V / 3GP par `mesure::mesurer` (durée, définition, i/s, codecs) ; la miniature vient
//!   du WebView2 du Desktop (élément vidéo + canvas, même approche que la bibliothèque), à la demande des cartes
//!   visibles : `etatMiniature = "webview"`.
//! - Image : définition lue dans l'en-tête ; miniature par le crate `image` (JPEG, PNG, GIF, WebP, BMP, TIFF), plafonds
//!   de taille de fichier, de pixels et de mémoire, orientation EXIF appliquée ; HEIC/HEIF/AVIF : pas de décodeur
//!   (`impossible`).
//!
//! Miniatures : JPEG 320 px au plus grand côté, dans `<emplacement>\miniatures\<xx>\<id>.jpg`, écrites atomiquement.
//! Les fichiers d'origine ne sont jamais modifiés.

use super::base::{self, AEnrichir, MetaExtraite, META_ECHEC, META_FAITE, MINI_ECHEC, MINI_FAITE, MINI_IMPOSSIBLE, MINI_WEBVIEW};
use crate::bibliotheque::TypeMedia;
use std::io::{BufRead, Cursor, Seek};
use std::path::Path;

pub const MINI_COTE: u32 = 320;
pub const IMAGE_OCTETS_MAX: u64 = 256 * 1024 * 1024;
pub const IMAGE_PIXELS_MAX: u64 = 120_000_000;
const MEMOIRE_MAX: u64 = 768 * 1024 * 1024;
/// Fond posé sous la transparence (gris nuit de l'interface).
const FOND: [u8; 3] = [20, 18, 17];

/// Conteneurs vidéo que le WebView2 (Chromium) lit en général : miniature à la demande.
pub const VIDEO_WEBVIEW: &[&str] = &["mp4", "m4v", "mov", "webm", "mkv", "ogv", "3gp"];
/// Images décodables ici.
pub const IMAGE_DECODABLE: &[&str] = &["png", "jpg", "jpeg", "jpe", "jfif", "webp", "gif", "tif", "tiff", "bmp", "dib"];

/// Métadonnées d'un fichier (et, pour l'audio, sa pochette si `miniatures`).
pub fn metadonnees(a: &AEnrichir, emplacement: &Path, miniatures: bool) -> MetaExtraite {
    match a.type_media {
        TypeMedia::Audio => audio(a, emplacement, miniatures),
        TypeMedia::Video => {
            let mut m = MetaExtraite { etat: META_FAITE, ..Default::default() };
            if let Some(x) = crate::mesure::mesurer(&a.chemin, &a.ext) {
                m.duree = x.duree;
                m.largeur = x.largeur;
                m.hauteur = x.hauteur;
                m.ips = x.ips;
                m.codec_video = x.codec_video;
                m.codec_audio = x.codec_audio;
            }
            m.mini = Some(if VIDEO_WEBVIEW.contains(&a.ext.as_str()) { MINI_WEBVIEW } else { MINI_IMPOSSIBLE });
            m
        }
        TypeMedia::Image => {
            let mut m = MetaExtraite { etat: META_FAITE, ..Default::default() };
            match image::ImageReader::open(&a.chemin).and_then(|r| r.with_guessed_format()).map(|r| r.into_dimensions()) {
                Ok(Ok((l, h))) => {
                    m.largeur = Some(l);
                    m.hauteur = Some(h);
                }
                _ => {
                    if IMAGE_DECODABLE.contains(&a.ext.as_str()) {
                        m.etat = META_ECHEC;
                        m.mini = Some(MINI_IMPOSSIBLE);
                    }
                }
            }
            if !IMAGE_DECODABLE.contains(&a.ext.as_str()) {
                m.mini = Some(MINI_IMPOSSIBLE);
            }
            m
        }
    }
}

fn audio(a: &AEnrichir, emplacement: &Path, miniatures: bool) -> MetaExtraite {
    match crate::musique::etiquettes::lire(&a.chemin) {
        Ok(e) => {
            let mut m = MetaExtraite {
                etat: META_FAITE,
                duree: e.duree_s,
                codec_audio: Some(e.qualite.codec.clone()).filter(|c| c != "inconnu"),
                titre: e.titre.clone(),
                artistes: (!e.artistes.is_empty()).then(|| e.artistes.join(" ; ")),
                album: e.album.clone(),
                annee: e.annee,
                ..Default::default()
            };
            m.mini = match (&e.pochette, miniatures) {
                (Some((o, _)), true) => Some(match ecrire_depuis_octets(o, &base::chemin_miniature(emplacement, a.id)) {
                    Ok(()) => MINI_FAITE,
                    Err(_) => MINI_ECHEC,
                }),
                (Some(_), false) => None,
                (None, _) => Some(MINI_IMPOSSIBLE),
            };
            m
        }
        Err(_) => MetaExtraite { etat: META_ECHEC, mini: Some(MINI_IMPOSSIBLE), ..Default::default() },
    }
}

/// Miniature d'un fichier (images et pochettes audio). Renvoie l'état de miniature à enregistrer.
pub fn miniature(a: &AEnrichir, emplacement: &Path) -> i64 {
    let cible = base::chemin_miniature(emplacement, a.id);
    match a.type_media {
        TypeMedia::Video => {
            if VIDEO_WEBVIEW.contains(&a.ext.as_str()) {
                MINI_WEBVIEW
            } else {
                MINI_IMPOSSIBLE
            }
        }
        TypeMedia::Audio => match crate::musique::etiquettes::lire(&a.chemin) {
            Ok(e) => match e.pochette {
                Some((o, _)) => {
                    if ecrire_depuis_octets(&o, &cible).is_ok() {
                        MINI_FAITE
                    } else {
                        MINI_ECHEC
                    }
                }
                None => MINI_IMPOSSIBLE,
            },
            Err(_) => MINI_IMPOSSIBLE,
        },
        TypeMedia::Image => {
            if !IMAGE_DECODABLE.contains(&a.ext.as_str()) || a.taille > IMAGE_OCTETS_MAX {
                return MINI_IMPOSSIBLE;
            }
            match image::ImageReader::open(&a.chemin).map_err(|e| e.to_string()).and_then(|r| decoder(r)).and_then(|img| ecrire(&img, &cible)) {
                Ok(()) => MINI_FAITE,
                Err(_) => MINI_ECHEC,
            }
        }
    }
}

fn decoder<R: BufRead + Seek>(r: image::ImageReader<R>) -> Result<image::DynamicImage, String> {
    use image::ImageDecoder;
    let mut r = r.with_guessed_format().map_err(|e| e.to_string())?;
    let mut l = image::Limits::default();
    l.max_image_width = Some(40_000);
    l.max_image_height = Some(40_000);
    l.max_alloc = Some(MEMOIRE_MAX);
    r.limits(l);
    let mut d = r.into_decoder().map_err(|e| e.to_string())?;
    let (w, h) = d.dimensions();
    if w == 0 || h == 0 || w as u64 * h as u64 > IMAGE_PIXELS_MAX {
        return Err("image trop grande".into());
    }
    let o = d.orientation().unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut img = image::DynamicImage::from_decoder(d).map_err(|e| e.to_string())?;
    img.apply_orientation(o);
    Ok(img)
}

/// Pochette ou JPEG du WebView2 : décodé, réduit, réencodé (jamais écrit tel quel).
pub fn ecrire_depuis_octets(octets: &[u8], cible: &Path) -> Result<(), String> {
    if octets.len() > 32 * 1024 * 1024 {
        return Err("image trop lourde".into());
    }
    let img = decoder(image::ImageReader::new(Cursor::new(octets)))?;
    ecrire(&img, cible)
}

/// JPEG de 320 px au plus grand côté (qualité 80), transparence posée sur le fond de l'interface.
pub fn ecrire(img: &image::DynamicImage, cible: &Path) -> Result<(), String> {
    let petite = img.thumbnail(MINI_COTE, MINI_COTE);
    let rgba = petite.to_rgba8();
    let (l, h) = rgba.dimensions();
    let mut rgb = image::RgbImage::new(l, h);
    for (x, y, p) in rgba.enumerate_pixels() {
        let a = p[3] as u32;
        let m = |c: u8, f: u8| ((c as u32 * a + f as u32 * (255 - a)) / 255) as u8;
        rgb.put_pixel(x, y, image::Rgb([m(p[0], FOND[0]), m(p[1], FOND[1]), m(p[2], FOND[2])]));
    }
    let mut tampon = Vec::with_capacity(32 * 1024);
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut tampon, 80).encode_image(&rgb).map_err(|e| e.to_string())?;
    crate::atomique::ecrire(cible, &tampon).map_err(|e| e.to_string())
}

//! Mesures sans ffmpeg, en lisant seulement les en-têtes :
//! - MP4 / MOV / M4A / M4V : boîtes `moov` → `mvhd`, `trak` (`tkhd`, `mdhd`, `hdlr`, `stsd`, `stts`, `esds`) : durée,
//!   définition affichée (rotation comprise), images par seconde, codecs vidéo et audio ;
//! - WAV : durée et PCM ; PNG, GIF, JPEG : définition.
//!
//! Le reste (durée d'un MP3 ou d'un WebM, miniature) vient du WebView2 du Desktop (contrat §3). Un fichier qu'on ne
//! sait pas lire donne `None`, jamais une valeur inventée.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Mesure {
    pub duree: Option<f64>,
    pub largeur: Option<u32>,
    pub hauteur: Option<u32>,
    pub ips: Option<f64>,
    pub codec_video: Option<String>,
    pub codec_audio: Option<String>,
}

/// Plafond de lecture de la boîte `moov` (les index de très longs fichiers dépassent rarement quelques Mo).
const MOOV_MAX: u64 = 64 * 1024 * 1024;

pub fn mesurer(chemin: &Path, ext: &str) -> Option<Mesure> {
    match ext {
        "mp4" | "m4v" | "mov" | "m4a" | "3gp" => mesurer_mp4(chemin),
        "wav" => mesurer_wav(chemin),
        "png" | "gif" | "jpg" | "jpeg" => mesurer_image(chemin, ext),
        _ => None,
    }
}

fn u16be(b: &[u8], i: usize) -> Option<u32> {
    b.get(i..i + 2).map(|s| u16::from_be_bytes([s[0], s[1]]) as u32)
}
fn u32be(b: &[u8], i: usize) -> Option<u32> {
    b.get(i..i + 4).map(|s| u32::from_be_bytes([s[0], s[1], s[2], s[3]]))
}
fn u64be(b: &[u8], i: usize) -> Option<u64> {
    b.get(i..i + 8).map(|s| u64::from_be_bytes([s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7]]))
}
fn i32be(b: &[u8], i: usize) -> Option<i32> {
    u32be(b, i).map(|v| v as i32)
}

/// Parcourt les boîtes d'un tampon : (type, contenu).
fn boites(b: &[u8]) -> Vec<([u8; 4], &[u8])> {
    let mut v = Vec::new();
    let mut i = 0usize;
    while i + 8 <= b.len() {
        let taille = u32be(b, i).unwrap_or(0) as u64;
        let mut t = [0u8; 4];
        t.copy_from_slice(&b[i + 4..i + 8]);
        let (entete, total) = match taille {
            1 => match u64be(b, i + 8) {
                Some(l) => (16u64, l),
                None => break,
            },
            0 => (8, (b.len() - i) as u64),
            n => (8, n),
        };
        if total < entete || i as u64 + total > b.len() as u64 {
            break;
        }
        v.push((t, &b[i + entete as usize..i + total as usize]));
        i += total as usize;
    }
    v
}

fn enfant<'a>(b: &'a [u8], nom: &[u8; 4]) -> Option<&'a [u8]> {
    boites(b).into_iter().find(|(t, _)| t == nom).map(|(_, c)| c)
}

#[derive(Default, Debug)]
struct Piste {
    genre: [u8; 4],
    echelle: u32,
    duree: u64,
    largeur: u32,
    hauteur: u32,
    tourne: bool,
    codec: Option<String>,
    echantillons: u64,
}

fn codec_de(fourcc: &[u8; 4], entree: &[u8]) -> String {
    match fourcc {
        b"avc1" | b"avc3" => "h264".into(),
        b"hvc1" | b"hev1" => "hevc".into(),
        b"av01" => "av1".into(),
        b"vp09" => "vp9".into(),
        b"vp08" => "vp8".into(),
        b"mp4v" => "mpeg4".into(),
        b"apch" | b"apcn" | b"apcs" | b"apco" | b"ap4h" | b"ap4x" => "prores".into(),
        b"mp4a" => codec_mp4a(entree),
        b"Opus" => "opus".into(),
        b".mp3" => "mp3".into(),
        b"ac-3" => "ac3".into(),
        b"ec-3" => "eac3".into(),
        b"alac" => "alac".into(),
        b"fLaC" => "flac".into(),
        b"lpcm" | b"sowt" | b"twos" | b"in24" | b"in32" | b"fl32" | b"fl64" | b"raw " => "pcm".into(),
        autre => String::from_utf8_lossy(autre).trim().to_ascii_lowercase(),
    }
}

/// `mp4a` : AAC le plus souvent, parfois du MP3 ; l'`objectTypeIndication` du descripteur `esds` tranche.
fn codec_mp4a(entree: &[u8]) -> String {
    // Entrée audio : 8 (en-tête générique d'échantillon) + 20 octets, puis les boîtes filles (dont esds).
    let filles = entree.get(28..).unwrap_or(&[]);
    if let Some(esds) = enfant(filles, b"esds") {
        let d = esds.get(4..).unwrap_or(&[]); // version + drapeaux
        let mut i = 0usize;
        // Descripteur ES (0x03), longueur variable, ES_ID (2), drapeaux (1), puis DecoderConfig (0x04).
        while i < d.len() {
            let tag = d[i];
            i += 1;
            let mut l = 0usize;
            for _ in 0..4 {
                let Some(&o) = d.get(i) else { break };
                i += 1;
                l = (l << 7) | (o & 0x7f) as usize;
                if o & 0x80 == 0 {
                    break;
                }
            }
            match tag {
                0x03 => {
                    let drapeaux = *d.get(i + 2).unwrap_or(&0);
                    i += 3;
                    if drapeaux & 0x80 != 0 {
                        i += 2;
                    }
                    if drapeaux & 0x40 != 0 {
                        i += 1 + *d.get(i).unwrap_or(&0) as usize;
                    }
                    if drapeaux & 0x20 != 0 {
                        i += 2;
                    }
                }
                0x04 => {
                    return match d.get(i) {
                        Some(0x69) | Some(0x6B) => "mp3".into(),
                        _ => "aac".into(),
                    }
                }
                _ => i += l,
            }
        }
    }
    "aac".into()
}

fn lire_piste(trak: &[u8]) -> Piste {
    let mut p = Piste::default();
    if let Some(tkhd) = enfant(trak, b"tkhd") {
        let v = tkhd.first().copied().unwrap_or(0);
        // Matrice puis largeur et hauteur (16.16) aux 44 derniers octets ; en v1, les champs de date sont plus longs.
        let base_matrice = if v == 1 { 4 + 8 + 8 + 4 + 4 + 8 + 8 + 2 + 2 + 2 + 2 } else { 4 + 4 + 4 + 4 + 4 + 4 + 8 + 2 + 2 + 2 + 2 };
        let a = i32be(tkhd, base_matrice).unwrap_or(0x10000);
        let b = i32be(tkhd, base_matrice + 4).unwrap_or(0);
        let d = i32be(tkhd, base_matrice + 16).unwrap_or(0x10000);
        p.tourne = a == 0 && d == 0 && b != 0;
        p.largeur = u32be(tkhd, base_matrice + 36).unwrap_or(0) >> 16;
        p.hauteur = u32be(tkhd, base_matrice + 40).unwrap_or(0) >> 16;
    }
    if let Some(mdia) = enfant(trak, b"mdia") {
        if let Some(mdhd) = enfant(mdia, b"mdhd") {
            if mdhd.first() == Some(&1) {
                p.echelle = u32be(mdhd, 20).unwrap_or(0);
                p.duree = u64be(mdhd, 24).unwrap_or(0);
            } else {
                p.echelle = u32be(mdhd, 12).unwrap_or(0);
                p.duree = u32be(mdhd, 16).unwrap_or(0) as u64;
            }
        }
        if let Some(hdlr) = enfant(mdia, b"hdlr") {
            if let Some(g) = hdlr.get(8..12) {
                p.genre.copy_from_slice(g);
            }
        }
        if let Some(stbl) = enfant(mdia, b"minf").and_then(|m| enfant(m, b"stbl")) {
            if let Some(stsd) = enfant(stbl, b"stsd") {
                if let Some((fourcc, entree)) = boites(stsd.get(8..).unwrap_or(&[])).first() {
                    p.codec = Some(codec_de(fourcc, entree));
                    if &p.genre == b"vide" && (p.largeur == 0 || p.hauteur == 0) {
                        p.largeur = u16be(entree, 24).unwrap_or(0);
                        p.hauteur = u16be(entree, 26).unwrap_or(0);
                    }
                }
            }
            if let Some(stts) = enfant(stbl, b"stts") {
                let n = u32be(stts, 4).unwrap_or(0) as usize;
                p.echantillons = (0..n.min(1_000_000)).filter_map(|k| u32be(stts, 8 + k * 8)).map(|c| c as u64).sum();
            }
        }
    }
    p
}

fn mesurer_mp4(chemin: &Path) -> Option<Mesure> {
    let mut f = File::open(chemin).ok()?;
    let longueur = f.metadata().ok()?.len();
    let mut pos = 0u64;
    let mut moov = None;
    // Boîtes de premier niveau, en sautant (la boîte `mdat` peut peser des gigaoctets).
    for _ in 0..64 {
        if pos + 8 > longueur {
            break;
        }
        f.seek(SeekFrom::Start(pos)).ok()?;
        let mut h = [0u8; 16];
        f.read_exact(&mut h[..8]).ok()?;
        let mut taille = u32::from_be_bytes([h[0], h[1], h[2], h[3]]) as u64;
        let mut entete = 8u64;
        if taille == 1 {
            f.read_exact(&mut h[8..16]).ok()?;
            taille = u64::from_be_bytes([h[8], h[9], h[10], h[11], h[12], h[13], h[14], h[15]]);
            entete = 16;
        } else if taille == 0 {
            taille = longueur - pos;
        }
        if taille < entete {
            break;
        }
        if &h[4..8] == b"moov" {
            let n = taille - entete;
            if n > MOOV_MAX {
                return None;
            }
            let mut tampon = vec![0u8; n as usize];
            f.seek(SeekFrom::Start(pos + entete)).ok()?;
            f.read_exact(&mut tampon).ok()?;
            moov = Some(tampon);
            break;
        }
        pos += taille;
    }
    let moov = moov?;
    let mut m = Mesure::default();
    if let Some(mvhd) = enfant(&moov, b"mvhd") {
        let (echelle, duree) = if mvhd.first() == Some(&1) {
            (u32be(mvhd, 20).unwrap_or(0), u64be(mvhd, 24).unwrap_or(0))
        } else {
            (u32be(mvhd, 12).unwrap_or(0), u32be(mvhd, 16).unwrap_or(0) as u64)
        };
        if echelle > 0 && duree > 0 && duree != u32::MAX as u64 {
            m.duree = Some(arrondi(duree as f64 / echelle as f64, 3));
        }
    }
    for (t, trak) in boites(&moov) {
        if &t != b"trak" {
            continue;
        }
        let p = lire_piste(trak);
        let secondes = if p.echelle > 0 { p.duree as f64 / p.echelle as f64 } else { 0.0 };
        match &p.genre {
            b"vide" if m.codec_video.is_none() => {
                m.codec_video = p.codec.clone();
                if p.largeur > 0 && p.hauteur > 0 {
                    let (l, h) = if p.tourne { (p.hauteur, p.largeur) } else { (p.largeur, p.hauteur) };
                    m.largeur = Some(l);
                    m.hauteur = Some(h);
                }
                if secondes > 0.0 && p.echantillons > 0 {
                    m.ips = Some(arrondi(p.echantillons as f64 / secondes, 3));
                }
                if m.duree.is_none() && secondes > 0.0 {
                    m.duree = Some(arrondi(secondes, 3));
                }
            }
            b"soun" if m.codec_audio.is_none() => {
                m.codec_audio = p.codec.clone();
                if m.duree.is_none() && secondes > 0.0 {
                    m.duree = Some(arrondi(secondes, 3));
                }
            }
            _ => {}
        }
    }
    Some(m)
}

fn arrondi(v: f64, chiffres: i32) -> f64 {
    let f = 10f64.powi(chiffres);
    (v * f).round() / f
}

fn mesurer_wav(chemin: &Path) -> Option<Mesure> {
    let mut f = File::open(chemin).ok()?;
    let mut h = [0u8; 12];
    f.read_exact(&mut h).ok()?;
    if &h[0..4] != b"RIFF" || &h[8..12] != b"WAVE" {
        return None;
    }
    let mut debit = 0u32;
    let mut format = 0u16;
    for _ in 0..64 {
        let mut c = [0u8; 8];
        if f.read_exact(&mut c).is_err() {
            break;
        }
        let taille = u32::from_le_bytes([c[4], c[5], c[6], c[7]]);
        match &c[0..4] {
            b"fmt " => {
                let mut fmt = vec![0u8; taille.min(64) as usize];
                f.read_exact(&mut fmt).ok()?;
                format = u16::from_le_bytes([fmt[0], fmt[1]]);
                debit = u32::from_le_bytes([fmt[8], fmt[9], fmt[10], fmt[11]]);
                let reste = taille as i64 - fmt.len() as i64 + (taille % 2) as i64;
                f.seek(SeekFrom::Current(reste)).ok()?;
            }
            b"data" => {
                let mut m = Mesure { codec_audio: Some(if format == 3 { "pcm-float".into() } else { "pcm".into() }), ..Default::default() };
                if debit > 0 {
                    m.duree = Some(arrondi(taille as f64 / debit as f64, 3));
                }
                return Some(m);
            }
            _ => {
                f.seek(SeekFrom::Current(taille as i64 + (taille % 2) as i64)).ok()?;
            }
        }
    }
    None
}

fn mesurer_image(chemin: &Path, ext: &str) -> Option<Mesure> {
    let mut f = File::open(chemin).ok()?;
    let mut b = vec![0u8; 64 * 1024];
    let n = f.read(&mut b).ok()?;
    b.truncate(n);
    let (l, h) = match ext {
        "png" if b.starts_with(b"\x89PNG\r\n\x1a\n") && &b.get(12..16)? == b"IHDR" => (u32be(&b, 16)?, u32be(&b, 20)?),
        "gif" if b.starts_with(b"GIF8") => (u16::from_le_bytes([b[6], b[7]]) as u32, u16::from_le_bytes([b[8], b[9]]) as u32),
        "jpg" | "jpeg" if b.starts_with(&[0xFF, 0xD8]) => {
            let mut i = 2usize;
            let mut trouve = None;
            while i + 9 < b.len() {
                if b[i] != 0xFF {
                    i += 1;
                    continue;
                }
                let marque = b[i + 1];
                let l = u16be(&b, i + 2)? as usize;
                if (0xC0..=0xCF).contains(&marque) && ![0xC4, 0xC8, 0xCC].contains(&marque) {
                    trouve = Some((u16be(&b, i + 7)?, u16be(&b, i + 5)?));
                    break;
                }
                i += 2 + l;
            }
            trouve?
        }
        _ => return None,
    };
    if l == 0 || h == 0 {
        return None;
    }
    Some(Mesure { largeur: Some(l), hauteur: Some(h), ..Default::default() })
}

/// Liste d'import de Premiere retenue par le contrat §3 : `Some(true)` si l'extension ET les codecs connus y sont,
/// `Some(false)` si l'un des deux en sort, `None` si on ne sait pas (codecs non mesurés).
pub fn premiere_compatible(ext: &str, codec_video: Option<&str>, codec_audio: Option<&str>) -> Option<bool> {
    let audio_ok = |a: Option<&str>| match a {
        None => Some(true),
        Some("aac") | Some("pcm") | Some("pcm-float") | Some("mp3") => Some(true),
        Some("opus") | Some("vorbis") | Some("flac") => Some(false),
        Some(_) => None,
    };
    match ext {
        "mp4" | "m4v" | "mov" => match codec_video {
            Some("h264") | Some("hevc") | Some("prores") => audio_ok(codec_audio),
            Some("av1") | Some("vp9") | Some("vp8") => Some(false),
            Some(_) => None,
            None if codec_audio.is_some() => audio_ok(codec_audio),
            None => None,
        },
        "m4a" => match codec_audio {
            Some("aac") => Some(true),
            Some("opus") | Some("flac") => Some(false),
            _ => None,
        },
        "mp3" | "wav" | "aac" | "png" | "jpg" | "jpeg" | "gif" => Some(true),
        "webm" | "mkv" | "opus" | "ogg" | "webp" => Some(false),
        _ => None,
    }
}

#[cfg(test)]
pub(crate) mod essais {
    //! Fabrique de petits fichiers MP4 synthétiques (boîtes minimales) pour les essais.
    fn boite(t: &[u8; 4], contenu: &[u8]) -> Vec<u8> {
        let mut v = ((contenu.len() + 8) as u32).to_be_bytes().to_vec();
        v.extend_from_slice(t);
        v.extend_from_slice(contenu);
        v
    }
    fn tkhd(l: u32, h: u32, tourne: bool) -> Vec<u8> {
        let mut c = vec![0u8; 4 + 4 + 4 + 4 + 4 + 4 + 8 + 2 + 2 + 2 + 2];
        let m: [i32; 9] = if tourne { [0, 0x10000, 0, -0x10000, 0, 0, 0, 0, 0x4000_0000] } else { [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x4000_0000] };
        for x in m {
            c.extend_from_slice(&x.to_be_bytes());
        }
        c.extend_from_slice(&(l << 16).to_be_bytes());
        c.extend_from_slice(&(h << 16).to_be_bytes());
        boite(b"tkhd", &c)
    }
    fn piste(genre: &[u8; 4], echelle: u32, duree: u32, fourcc: &[u8; 4], echantillons: u32, l: u32, h: u32, tourne: bool) -> Vec<u8> {
        let mut mdhd = vec![0u8; 12];
        mdhd.extend_from_slice(&echelle.to_be_bytes());
        mdhd.extend_from_slice(&duree.to_be_bytes());
        mdhd.extend_from_slice(&[0u8; 4]);
        let mut hdlr = vec![0u8; 8];
        hdlr.extend_from_slice(genre);
        hdlr.extend_from_slice(&[0u8; 13]);
        let mut entree = vec![0u8; 28];
        if fourcc == b"mp4a" {
            // esds avec objectTypeIndication 0x40 (AAC).
            let esds = [0u8, 0, 0, 0, 0x03, 0x19, 0, 1, 0, 0x04, 0x11, 0x40, 0x15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            entree.extend_from_slice(&boite(b"esds", &esds));
        }
        let mut stsd = vec![0u8, 0, 0, 0, 0, 0, 0, 1];
        stsd.extend_from_slice(&boite(fourcc, &entree));
        let mut stts = vec![0u8, 0, 0, 0, 0, 0, 0, 1];
        stts.extend_from_slice(&echantillons.to_be_bytes());
        stts.extend_from_slice(&(duree / echantillons.max(1)).to_be_bytes());
        let stbl = boite(b"stbl", &[boite(b"stsd", &stsd), boite(b"stts", &stts)].concat());
        let minf = boite(b"minf", &stbl);
        let mdia = boite(b"mdia", &[boite(b"mdhd", &mdhd), boite(b"hdlr", &hdlr), minf].concat());
        boite(b"trak", &[tkhd(l, h, tourne), mdia].concat())
    }
    /// MP4 de `secondes` secondes, H.264 `l`×`h` à `ips` i/s et AAC ; `mdat` factice placé AVANT `moov`.
    pub fn mp4(secondes: u32, l: u32, h: u32, ips: u32, tourne: bool) -> Vec<u8> {
        let mut mvhd = vec![0u8; 12];
        mvhd.extend_from_slice(&1000u32.to_be_bytes());
        mvhd.extend_from_slice(&(secondes * 1000).to_be_bytes());
        mvhd.extend_from_slice(&[0u8; 80]);
        let moov = boite(
            b"moov",
            &[
                boite(b"mvhd", &mvhd),
                piste(b"vide", 15360, secondes * 15360, b"avc1", secondes * ips, l, h, tourne),
                piste(b"soun", 48000, secondes * 48000, b"mp4a", secondes * 47, 0, 0, false),
            ]
            .concat(),
        );
        [boite(b"ftyp", b"isom\0\0\x02\0isomiso2avc1mp41"), boite(b"mdat", &vec![0u8; 4096]), moov].concat()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mp4_synthetique() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("Coucher de soleil sur la côte.mp4");
        std::fs::write(&f, essais::mp4(12, 1280, 720, 30, false)).unwrap();
        let m = mesurer(&f, "mp4").unwrap();
        assert_eq!(m.duree, Some(12.0));
        assert_eq!((m.largeur, m.hauteur), (Some(1280), Some(720)));
        assert_eq!(m.ips, Some(30.0));
        assert_eq!(m.codec_video.as_deref(), Some("h264"));
        assert_eq!(m.codec_audio.as_deref(), Some("aac"));
        assert_eq!(premiere_compatible("mp4", m.codec_video.as_deref(), m.codec_audio.as_deref()), Some(true));
    }

    #[test]
    fn mp4_vertical_par_rotation() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("v.mov");
        std::fs::write(&f, essais::mp4(4, 1920, 1080, 25, true)).unwrap();
        let m = mesurer(&f, "mov").unwrap();
        assert_eq!((m.largeur, m.hauteur), (Some(1080), Some(1920)));
        assert_eq!(m.ips, Some(25.0));
    }

    #[test]
    fn fichiers_illisibles_sans_valeur_inventee() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("faux.mp4");
        std::fs::write(&f, b"pas une video").unwrap();
        assert!(mesurer(&f, "mp4").map(|m| m.duree.is_none() && m.codec_video.is_none()).unwrap_or(true));
        let tronque = &essais::mp4(5, 640, 360, 30, false)[..4400];
        std::fs::write(&f, tronque).unwrap();
        assert!(mesurer(&f, "mp4").is_none(), "moov tronqué : aucune mesure");
        assert!(mesurer(&d.path().join("absent.mp4"), "mp4").is_none());
    }

    #[test]
    fn wav_png_gif() {
        let d = tempfile::tempdir().unwrap();
        // WAV 48 kHz stéréo 16 bits, 2 s.
        let debit = 48000u32 * 2 * 2;
        let donnees = debit * 2;
        let mut w = b"RIFF".to_vec();
        w.extend_from_slice(&(36 + donnees).to_le_bytes());
        w.extend_from_slice(b"WAVEfmt ");
        w.extend_from_slice(&16u32.to_le_bytes());
        w.extend_from_slice(&1u16.to_le_bytes());
        w.extend_from_slice(&2u16.to_le_bytes());
        w.extend_from_slice(&48000u32.to_le_bytes());
        w.extend_from_slice(&debit.to_le_bytes());
        w.extend_from_slice(&4u16.to_le_bytes());
        w.extend_from_slice(&16u16.to_le_bytes());
        w.extend_from_slice(b"data");
        w.extend_from_slice(&donnees.to_le_bytes());
        w.resize(w.len() + donnees as usize, 0);
        let f = d.path().join("nappe.wav");
        std::fs::write(&f, &w).unwrap();
        let m = mesurer(&f, "wav").unwrap();
        assert_eq!(m.duree, Some(2.0));
        assert_eq!(m.codec_audio.as_deref(), Some("pcm"));
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
        png.extend_from_slice(&480u32.to_be_bytes());
        png.extend_from_slice(&270u32.to_be_bytes());
        let f = d.path().join("i.png");
        std::fs::write(&f, &png).unwrap();
        assert_eq!(mesurer(&f, "png").unwrap().largeur, Some(480));
        let gif = b"GIF89a\xe0\x01\x0e\x01".to_vec();
        let f = d.path().join("g.gif");
        std::fs::write(&f, &gif).unwrap();
        let m = mesurer(&f, "gif").unwrap();
        assert_eq!((m.largeur, m.hauteur), (Some(480), Some(270)));
    }

    /// Fichiers RÉELS produits par ffmpeg (clip synthétique « Coucher de soleil sur la côte », 12 s, 1280 × 720, 30 i/s),
    /// si le dossier `AETHRYON_ECHANTILLONS` est fourni ; sinon l'essai est sauté (rien n'est supposé).
    #[test]
    fn echantillons_reels() {
        let Some(d) = std::env::var_os("AETHRYON_ECHANTILLONS").map(std::path::PathBuf::from) else {
            eprintln!("AETHRYON_ECHANTILLONS absent : essai sur fichiers réels sauté");
            return;
        };
        let m = mesurer(&d.join("coucher.mp4"), "mp4").unwrap();
        assert_eq!((m.codec_video.as_deref(), m.codec_audio.as_deref()), (Some("h264"), Some("aac")));
        assert_eq!((m.largeur, m.hauteur), (Some(1280), Some(720)));
        assert_eq!(m.ips, Some(30.0));
        assert!((m.duree.unwrap() - 12.0).abs() < 0.1, "{:?}", m.duree);
        let v = mesurer(&d.join("vertical.mp4"), "mp4").unwrap();
        assert_eq!((v.largeur, v.hauteur), (Some(720), Some(1280)));
        let p = mesurer(&d.join("prores.mov"), "mov").unwrap();
        assert_eq!(p.codec_video.as_deref(), Some("prores"));
        assert_eq!(premiere_compatible("mov", p.codec_video.as_deref(), p.codec_audio.as_deref()), Some(true));
        let a = mesurer(&d.join("coucher.m4a"), "m4a").unwrap();
        assert_eq!(a.codec_audio.as_deref(), Some("aac"));
        let w = mesurer(&d.join("nappe.wav"), "wav").unwrap();
        assert!((w.duree.unwrap() - 12.0).abs() < 0.1);
        assert_eq!(mesurer(&d.join("image.png"), "png").unwrap().largeur, Some(1280));
        assert_eq!(mesurer(&d.join("image.jpg"), "jpg").unwrap().hauteur, Some(720));
        assert!(mesurer(&d.join("passage.gif"), "gif").unwrap().largeur.is_some());
        assert!(mesurer(&d.join("coucher.webm"), "webm").is_none(), "WebM : laissé au WebView2");
        assert_eq!(premiere_compatible("webm", None, None), Some(false));
    }

    #[test]
    fn liste_premiere_du_contrat() {
        assert_eq!(premiere_compatible("mov", Some("hevc"), Some("aac")), Some(true));
        assert_eq!(premiere_compatible("mp4", Some("av1"), Some("opus")), Some(false));
        assert_eq!(premiere_compatible("mp4", Some("h264"), Some("opus")), Some(false));
        assert_eq!(premiere_compatible("webm", None, None), Some(false));
        assert_eq!(premiere_compatible("mp3", None, None), Some(true));
        assert_eq!(premiere_compatible("gif", None, None), Some(true));
        assert_eq!(premiere_compatible("mp4", None, None), None, "non mesuré : null");
        assert_eq!(premiere_compatible("tiff", None, None), None);
    }
}

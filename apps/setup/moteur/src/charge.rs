//! La charge embarquée dans AETHRYON-Setup.exe : une archive ZIP qui contient `charge.json` (versions, SHA-256 de
//! chaque fichier) et les fichiers eux-mêmes. Rien n'est copié avant que TOUTES les empreintes aient été revérifiées.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::{Cursor, Read};
use std::sync::Mutex;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FichierCharge {
    /// Chemin dans l'archive (`desktop/aethryon-desktop.exe`).
    pub source: String,
    /// Nom dans le dossier d'installation (`aethryon-desktop.exe`).
    pub nom: String,
    pub sha256: String,
    pub taille: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComposantExtension {
    pub id: String,
    pub version: String,
    pub fichier: FichierCharge,
    /// Intervalle de versions de Premiere (hôte PPRO) lu dans `CSXS/manifest.xml`, par exemple `[25.0,99.9]`.
    pub hote_ppro: String,
    /// Vrai si c'est le remplaçant d'essai et non la vraie extension AETHRYON.
    #[serde(default)]
    pub remplacant: bool,
    /// Signature : algorithme, horodatage, empreinte SHA-256 du certificat (vérifiés à la construction par zxp.py
    /// et xmlsec1 ; le setup revérifie l'intégrité de chaque fichier contre le Manifest signé).
    #[serde(default)]
    pub signature: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComposantDesktop {
    pub version: String,
    pub exe: String,
    pub fichiers: Vec<FichierCharge>,
}

/// Extension NAVIGATEUR de production (archive ZIP publiée, identique octet pour octet), posée dans le dossier géré.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComposantNavigateur {
    /// Identifiant Chrome (`necpohicddjeaeaaomaakehcbccapabg`), revérifié dans l'archive.
    pub id: String,
    pub version: String,
    pub fichier: FichierCharge,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ManifesteCharge {
    pub schema: u32,
    pub produit: String,
    pub version: String,
    pub editeur: String,
    #[serde(default)]
    pub construit_le: String,
    pub extension: ComposantExtension,
    pub desktop: Option<ComposantDesktop>,
    /// Extension navigateur (absente des charges 2.0.0-beta.2 et plus anciennes).
    #[serde(default)]
    pub navigateur: Option<ComposantNavigateur>,
    /// L'interface du setup elle-même (aethryon-setup-ui.exe, WebView2Loader.dll), extraite par l'amorce.
    #[serde(default)]
    pub interface: Vec<FichierCharge>,
}

pub struct Charge {
    pub manifeste: ManifesteCharge,
    archive: Mutex<zip::ZipArchive<Cursor<Vec<u8>>>>,
    pub taille: u64,
}

pub fn sha256_hex(d: &[u8]) -> String {
    let h = Sha256::digest(d);
    h.iter().map(|b| format!("{b:02x}")).collect()
}

impl Charge {
    pub fn ouvrir(octets: Vec<u8>) -> Result<Charge, String> {
        let taille = octets.len() as u64;
        let mut archive = zip::ZipArchive::new(Cursor::new(octets)).map_err(|e| format!("Charge illisible ({e})."))?;
        let manifeste: ManifesteCharge = {
            let mut f = archive.by_name("charge.json").map_err(|_| "charge.json absent de la charge.".to_string())?;
            let mut s = String::new();
            f.read_to_string(&mut s).map_err(|e| format!("charge.json illisible ({e})."))?;
            serde_json::from_str(&s).map_err(|e| format!("charge.json invalide ({e})."))?
        };
        if manifeste.schema != 1 || manifeste.produit != "AETHRYON" {
            return Err("Cette charge n'est pas une charge AETHRYON (schéma 1).".into());
        }
        Ok(Charge { manifeste, archive: Mutex::new(archive), taille })
    }

    pub fn lire(&self, source: &str) -> Result<Vec<u8>, String> {
        let mut a = self.archive.lock().unwrap_or_else(|e| e.into_inner());
        let mut f = a.by_name(source).map_err(|_| format!("{source} absent de la charge."))?;
        let mut v = Vec::with_capacity(f.size() as usize);
        f.read_to_end(&mut v).map_err(|e| format!("{source} illisible ({e})."))?;
        Ok(v)
    }

    /// Lit un fichier ET vérifie sa taille et son SHA-256 contre `charge.json`.
    pub fn lire_verifie(&self, f: &FichierCharge) -> Result<Vec<u8>, String> {
        let d = self.lire(&f.source)?;
        if d.len() as u64 != f.taille || sha256_hex(&d) != f.sha256 {
            return Err(format!("{} : empreinte SHA-256 différente de charge.json (charge altérée).", f.source));
        }
        Ok(d)
    }

    /// Fichiers à vérifier selon les composants choisis.
    pub fn fichiers(&self, desktop: bool, extension: bool) -> Vec<FichierCharge> {
        let mut v = Vec::new();
        if extension {
            v.push(self.manifeste.extension.fichier.clone());
        }
        if desktop {
            if let Some(d) = &self.manifeste.desktop {
                v.extend(d.fichiers.iter().cloned());
            }
            // Le dossier géré de l'extension navigateur appartient au Desktop (il le met à jour) : posé avec lui.
            if let Some(n) = &self.manifeste.navigateur {
                v.push(n.fichier.clone());
            }
        }
        v
    }

    pub fn taille_installee(&self, desktop: bool) -> u64 {
        let mut t = self.manifeste.extension.fichier.taille;
        if desktop {
            if let Some(d) = &self.manifeste.desktop {
                t += d.fichiers.iter().map(|f| f.taille).sum::<u64>();
            }
            if let Some(n) = &self.manifeste.navigateur {
                // Décompressée, l'extension occupe environ trois fois son archive.
                t += n.fichier.taille * 3;
            }
        }
        t
    }
}

/// Construit une charge (essais et script de construction) à partir de fichiers en mémoire.
pub fn construire(manifeste: &ManifesteCharge, fichiers: &[(&str, &[u8])]) -> Vec<u8> {
    use std::io::Write;
    let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let opt = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    z.start_file("charge.json", opt).unwrap();
    z.write_all(serde_json::to_string_pretty(manifeste).unwrap().as_bytes()).unwrap();
    for (nom, d) in fichiers {
        z.start_file(*nom, opt).unwrap();
        z.write_all(d).unwrap();
    }
    z.finish().unwrap().into_inner()
}

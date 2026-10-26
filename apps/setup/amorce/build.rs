// La charge (charge.zip) est embarquée telle quelle : AETHRYON_CHARGE_ZIP désigne le fichier. Sans elle (essais du
// moteur, vérification du code), une charge vide est embarquée et l'amorce le dit à l'ouverture.
// Ressources Windows : icône, manifeste (asInvoker), informations de version.
fn main() {
    println!("cargo:rerun-if-env-changed=AETHRYON_CHARGE_ZIP");
    println!("cargo:rerun-if-changed=amorce.rc");
    println!("cargo:rerun-if-changed=amorce.manifest");
    let charge = match std::env::var("AETHRYON_CHARGE_ZIP") {
        Ok(c) if !c.is_empty() => {
            println!("cargo:rerun-if-changed={c}");
            c
        }
        _ => {
            let vide = std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("charge-vide.zip");
            std::fs::write(&vide, b"").unwrap();
            vide.to_string_lossy().into_owned()
        }
    };
    println!("cargo:rustc-env=AETHRYON_CHARGE={charge}");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        embed_resource::compile("amorce.rc", embed_resource::NONE).manifest_required().unwrap();
    }
}

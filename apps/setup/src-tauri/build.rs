// Manifeste d'application Windows : `asInvoker` (aucune élévation : sans lui, la détection d'installateurs de Windows
// élève tout exe dont le nom contient « setup »), DPI par écran, contrôles communs v6, Windows 10 et 11.
fn main() {
    let attributs = tauri_build::Attributes::new().windows_attributes(tauri_build::WindowsAttributes::new().app_manifest(include_str!("manifeste.xml")));
    tauri_build::try_build(attributs).expect("tauri-build");
}

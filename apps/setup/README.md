# AETHRYON Setup (Windows installer, beta)

One installer for **AETHRYON Desktop** and the **Premiere Pro panel**: detection, installation, repair, update and
uninstall, with a five-screen interface. Version **2.0.0-beta.8**.

Tauri 2 · Rust · React · WebView2.

## Components

```
moteur/         install / maintenance / uninstall engine behind traits (Windows implementation + fakes for tests)
src-tauri/      the "AETHRYON Setup" interface and silent modes (--silencieux)
amorce/         AETHRYON-Setup.exe: a single file that embeds the payload and starts the interface
signature-cep/  CEP (ZXP) signing scripts and format notes — the certificate and its password are NOT in the repo
charge-exemple/ example payload layout
e2e/            screenshot harness with sample states
```

## Build and test

```bash
npm ci && npm run build                        # interface
cargo test -p aethryon-setup-moteur            # engine tests (run on Linux with fake system layers)
```

Building the real installer (`scripts/construire.sh`) needs the Desktop build, the CEP extension folder and the
signing material, all passed explicitly through environment variables; nothing is downloaded or signed implicitly.

Downloads: [AETHRYON-Setup-2.0.0-beta.8.exe](https://raccourci.malvu.fr/downloads/premiere/AETHRYON-Setup-2.0.0-beta.8.exe)
([SHA256SUMS](https://raccourci.malvu.fr/downloads/premiere/SHA256SUMS)). History: [`CHANGELOG.md`](CHANGELOG.md).

#!/bin/bash
# Construction complète d'AETHRYON Setup pour Windows, depuis Linux, sans rien publier :
#   1. extension CEP : la vraie (EXTENSION_CEP) si elle existe, sinon le remplaçant d'essai ; signée en ZXP
#      (signature-cep/signer-extension.sh : zxp.py + vérification croisée xmlsec1), avec et sans horodatage ;
#   2. interfaces : setup (vite) et AETHRYON Desktop (vitest, vite) ;
#   3. conteneur JETABLE rust:1-bookworm (3 Go, 4 processeurs, 2 tâches de compilation par défaut — CARGO_BUILD_JOBS —,
#      faible priorité, AUCUNE étiquette Traefik) :
#      essais du moteur (Linux), AETHRYON Desktop et l'interface du setup pour x86_64-pc-windows-gnu, crochet de
#      signature (sans effet), charge.zip (scripts/charge.py), amorce AETHRYON-Setup-<version>.exe, SHA256SUMS ;
#   4. ESSAIS_WINE=1 : installation, maintenance, réparation et désinstallation sous Wine 8 (essais-wine/essai-setup.sh),
#      avec l'exemple index-essai du noyau (index SQLite et réglages gardés par les mises à jour) ;
#   5. CAPTURES=1 : captures Playwright de chaque écran (données rejouées du vrai moteur) ;
#   6. le conteneur est supprimé (GARDER=1 pour le garder).
# Sources : registre npm, crates.io, Debian apt dans le conteneur, image rust:1-bookworm de Docker Hub. Aucune licence
# acceptée (pas de ZXPSignCmd, pas de MSVC, pas de cargo-xwin).
# EXTENSION_NAVIGATEUR : dossier de la release de l'extension navigateur (latest.json, SHA256SUMS, archive), par défaut
# extension/release du dépôt ; l'archive est vérifiée contre latest.json ET SHA256SUMS avant d'être embarquée (posée
# par le setup dans %LOCALAPPDATA%\AETHRYON\extension). Absente : setup sans extension navigateur (signalé).
# Variables : TRAVAIL (obligatoire, hors du dépôt), EXTENSION_CEP (« remplacant » force le remplaçant d'essai), ZXP_REFERENCE, CIBLE_DESKTOP, REGISTRE, CONTENEUR, ESSAIS_WINE, CAPTURES,
# GARDER, BETA_NSIS (installateur NSIS de la bêta 1.0.0-beta.2, vérifié par son SHA256SUMS, pour l'essai Wine de son
# remplacement ; par défaut celui du paquet D s'il existe).
set -euo pipefail
ICI=$(cd "$(dirname "$0")/.." && pwd)
DEPOT=$(dirname "$ICI")
VERSION=$(node -p "require('$ICI/package.json').version")
# Version du setup d'ESSAI plus récent (jamais livré) : dernier nombre + 1 (2.0.0-beta.2 → 2.0.0-beta.3).
VERSION_MAJ=$(python3 -I -c "import re,sys; v=sys.argv[1]; m=re.search(r'(\d+)$', v); print(v[:m.start()] + str(int(m.group(1)) + 1))" "$VERSION")
TRAVAIL=${TRAVAIL:?TRAVAIL : dossier de travail hors du dépôt}
CIBLE_DESKTOP=${CIBLE_DESKTOP:-$TRAVAIL/cible-desktop}
REGISTRE=${REGISTRE:-$TRAVAIL/registre}
# Extension CEP par défaut : 2.0.1 (traite la commande « importer » du Desktop), livrée par extension-premiere/scripts/construire.mjs --livrer.
EXTENSION_CEP=${EXTENSION_CEP:?EXTENSION_CEP must point to a local build artefact}
BETA_NSIS=${BETA_NSIS:?BETA_NSIS must point to a local build artefact}
C=${CONTENEUR:-aethryon-setup-construction}
etape() { echo; echo "=== $1 ($(date -u +%H:%M:%S))"; }
mkdir -p "$TRAVAIL"/{cible,sortie,zxp,essais,navigateur} "$CIBLE_DESKTOP" "$REGISTRE"
EXTENSION_NAVIGATEUR=${EXTENSION_NAVIGATEUR:-$DEPOT/extension/release}
rm -f "$TRAVAIL"/navigateur/*
ARG_NAV=""
if [ -f "$EXTENSION_NAVIGATEUR/latest.json" ]; then
  NAV_ZIP=$(python3 -I -c "import json,sys,re; r=json.load(open(sys.argv[1])); f=r['file']; assert re.fullmatch(r'aethryon-extension-\d+\.\d+\.\d+\.zip', f) and f == 'aethryon-extension-%s.zip' % r['version']; print(f)" "$EXTENSION_NAVIGATEUR/latest.json")
  (cd "$EXTENSION_NAVIGATEUR" && grep " $NAV_ZIP\$" SHA256SUMS | sha256sum --quiet -c -) || { echo "ERREUR : $NAV_ZIP différent de SHA256SUMS" >&2; exit 1; }
  python3 -I -c "import json,sys,hashlib,os; r=json.load(open(sys.argv[1])); d=open(sys.argv[2],'rb').read(); assert r['sha256']==hashlib.sha256(d).hexdigest() and r['size']==len(d), 'latest.json ≠ archive'" "$EXTENSION_NAVIGATEUR/latest.json" "$EXTENSION_NAVIGATEUR/$NAV_ZIP"
  cp "$EXTENSION_NAVIGATEUR/$NAV_ZIP" "$EXTENSION_NAVIGATEUR/latest.json" "$TRAVAIL/navigateur/"
  ARG_NAV="--navigateur-zip /navigateur/$NAV_ZIP"
  echo "extension navigateur embarquée : $NAV_ZIP ($(sha256sum "$TRAVAIL/navigateur/$NAV_ZIP" | cut -c1-16)…, identique à latest.json et SHA256SUMS)"
else
  echo "NOTE : pas de release de l'extension navigateur dans $EXTENSION_NAVIGATEUR : setup SANS extension navigateur"
fi
rm -f "$TRAVAIL/essais/beta-nsis.exe" "$TRAVAIL/essais/setup-precedent.exe"
# SETUP_PRECEDENT : setup PUBLIÉ précédent (vérifié par son SHA256SUMS) pour l'essai Wine de --mettre-a-jour (section 8).
if [ -n "${SETUP_PRECEDENT:-}" ] && [ -f "$SETUP_PRECEDENT" ]; then
  ATTENDU=$(grep " $(basename "$SETUP_PRECEDENT")\$" "$(dirname "$SETUP_PRECEDENT")/SHA256SUMS" 2>/dev/null | cut -d' ' -f1)
  if [ -n "$ATTENDU" ] && [ "$(sha256sum "$SETUP_PRECEDENT" | cut -d' ' -f1)" = "$ATTENDU" ]; then
    cp "$SETUP_PRECEDENT" "$TRAVAIL/essais/setup-precedent.exe" && echo "setup précédent pour l'essai Wine : empreinte vérifiée ${ATTENDU:0:16}…"
  else
    echo "setup précédent : empreinte absente ou différente, section 8 non lancée"
  fi
fi
if [ -f "$BETA_NSIS" ]; then
  # Empreinte vérifiée contre le SHA256SUMS livré à côté (paquet D) : jamais un autre fichier sous ce nom.
  ATTENDU=$(grep " $(basename "$BETA_NSIS")\$" "$(dirname "$BETA_NSIS")/SHA256SUMS" 2>/dev/null | cut -d' ' -f1)
  if [ -n "$ATTENDU" ] && [ "$(sha256sum "$BETA_NSIS" | cut -d' ' -f1)" = "$ATTENDU" ]; then
    cp "$BETA_NSIS" "$TRAVAIL/essais/beta-nsis.exe" && echo "bêta 2 (NSIS) pour l'essai Wine : empreinte vérifiée ${ATTENDU:0:16}…"
  else
    echo "bêta 2 (NSIS) : empreinte absente ou différente, essai de remplacement non lancé"
  fi
fi

etape "Signature CEP : essais (matériel jetable ; ZXP_REFERENCE = un ZXP signé par Adobe, facultatif)"
bash "$ICI/signature-cep/essais.sh"

etape "Extension CEP à embarquer"
REMPLACANT=""
if [ "$EXTENSION_CEP" != "remplacant" ] && [ -f "$EXTENSION_CEP/CSXS/manifest.xml" ]; then
  SOURCE_EXT=$EXTENSION_CEP
  echo "vraie extension : $SOURCE_EXT"
else
  SOURCE_EXT=$ICI/charge-exemple/fr.aethryon.premiere
  REMPLACANT="--remplacant"
  echo "vraie extension absente ou écartée (EXTENSION_CEP=$EXTENSION_CEP) : REMPLAÇANT d'essai ($SOURCE_EXT)"
fi
bash "$ICI/signature-cep/signer-extension.sh" "$SOURCE_EXT" "$TRAVAIL/zxp/fr.aethryon.premiere.zxp"
SANS_HORODATAGE=1 bash "$ICI/signature-cep/signer-extension.sh" "$SOURCE_EXT" "$TRAVAIL/zxp/fr.aethryon.premiere-sans-horodatage.zxp"

etape "Interfaces : dépendances, essais, construction"
(cd "$ICI" && npm ci --no-audit --no-fund >/dev/null && npm run build >/dev/null && echo "interface du setup : dist/")
(cd "$DEPOT/desktop" && npm ci --no-audit --no-fund >/dev/null && npx vitest run 2>&1 | grep -E "Tests " && npm run build >/dev/null && echo "interface du Desktop : dist/")

etape "Conteneur jetable"
docker rm -f "$C" >/dev/null 2>&1 || true
docker run -d --name "$C" --memory 3g --memory-swap 3g --cpus 4 --cpu-shares 256 --pids-limit 4096 \
  -v "$DEPOT":/depot -v "$TRAVAIL/cible":/cible -v "$CIBLE_DESKTOP":/cible-desktop -v "$REGISTRE":/usr/local/cargo/registry \
  -v "$TRAVAIL/sortie":/sortie -v "$TRAVAIL/zxp":/zxp:ro -v "$TRAVAIL/navigateur":/navigateur:ro -v "$TRAVAIL/essais":/essais:ro -e CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}" -e CARGO_TERM_COLOR=never rust:1-bookworm sleep infinity >/dev/null
echo "étiquettes du conteneur : $(docker inspect "$C" --format '{{json .Config.Labels}}')"
docker exec "$C" bash -c 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq --no-install-recommends mingw-w64 python3 >/dev/null && rustup target add x86_64-pc-windows-gnu >/dev/null 2>&1 && rustc --version'

etape "Moteur : essais (Linux)"
docker exec "$C" bash -c 'cd /depot/setup && CARGO_TARGET_DIR=/cible nice -n 19 cargo test -p aethryon-setup-moteur 2>&1 | grep -E "^test |test result"'

etape "AETHRYON Desktop et interface du setup : construction Windows (x86_64-pc-windows-gnu)"
docker exec "$C" bash -c 'cd /depot/desktop && CARGO_TARGET_DIR=/cible-desktop nice -n 19 ionice -c3 cargo build --release --target x86_64-pc-windows-gnu -p aethryon-desktop --features custom-protocol 2>&1 | grep -E "^(warning|error)|Finished" | tail -3'
docker exec "$C" bash -c 'cd /depot/setup && CARGO_TARGET_DIR=/cible nice -n 19 ionice -c3 cargo build --release --target x86_64-pc-windows-gnu -p aethryon-setup-ui --features custom-protocol 2>&1 | grep -E "^(warning|error)|Finished" | tail -3'

etape "Charge et amorce"
docker exec -e VERSION="$VERSION" -e REMPLACANT="$REMPLACANT" -e ARG_NAV="$ARG_NAV" "$C" bash -c 'set -e
  rm -rf /sortie/* && mkdir -p /sortie/charge/desktop /sortie/charge/ui
  DESK_VER=$(grep -m1 "^version" /depot/desktop/src-tauri/Cargo.toml | cut -d\" -f2)
  WV=$(ls /cible/x86_64-pc-windows-gnu/release/build/webview2-com-sys-*/out/x64/WebView2Loader.dll | head -1)
  cp /cible-desktop/x86_64-pc-windows-gnu/release/aethryon-desktop.exe /sortie/charge/desktop/
  cp /cible/x86_64-pc-windows-gnu/release/aethryon-setup-ui.exe /sortie/charge/ui/
  cp "$WV" /sortie/charge/desktop/ && cp "$WV" /sortie/charge/ui/
  bash /depot/setup/scripts/signer.sh /sortie/charge/ui/aethryon-setup-ui.exe
  bash /depot/setup/scripts/signer.sh /sortie/charge/desktop/aethryon-desktop.exe
  python3 -I -c "import json,sys; v=json.load(open(sys.argv[1])); c=v[\"certificat\"]; h=v.get(\"horodatage\",{}); json.dump({\"algorithme\": v[\"algo\"], \"certificat\": c[\"sujet\"], \"certificatSha256\": c[\"sha256\"], \"certificatValideAu\": c[\"valide_au\"], \"horodatage\": h.get(\"date\",\"absent\"), \"autoriteHorodatage\": h.get(\"autorite\",\"\"), \"verification\": \"zxp.py + xmlsec1 à la construction\"}, open(\"/sortie/charge/signature.json\",\"w\"), ensure_ascii=False)" /zxp/fr.aethryon.premiere.zxp.verification.json
  python3 -I /depot/setup/scripts/charge.py --sortie /sortie/charge.zip --version "$VERSION" --zxp /zxp/fr.aethryon.premiere.zxp $REMPLACANT --signature-json /sortie/charge/signature.json \
    --desktop-exe /sortie/charge/desktop/aethryon-desktop.exe --desktop-dll /sortie/charge/desktop/WebView2Loader.dll --desktop-version "$DESK_VER" \
    --ui-exe /sortie/charge/ui/aethryon-setup-ui.exe --ui-dll /sortie/charge/ui/WebView2Loader.dll $ARG_NAV
  cd /depot/setup && AETHRYON_CHARGE_ZIP=/sortie/charge.zip CARGO_TARGET_DIR=/cible nice -n 19 cargo build --release --target x86_64-pc-windows-gnu -p aethryon-setup 2>&1 | grep -E "^(warning|error)|Finished" | tail -3
  cp /cible/x86_64-pc-windows-gnu/release/aethryon-setup.exe "/sortie/AETHRYON-Setup-$VERSION.exe"
  bash /depot/setup/scripts/signer.sh "/sortie/AETHRYON-Setup-$VERSION.exe"
  cp /zxp/fr.aethryon.premiere.zxp /zxp/fr.aethryon.premiere-sans-horodatage.zxp /sortie/
  cp /sortie/charge/desktop/aethryon-desktop.exe /sortie/
  cd /sortie && sha256sum "AETHRYON-Setup-$VERSION.exe" aethryon-desktop.exe fr.aethryon.premiere.zxp fr.aethryon.premiere-sans-horodatage.zxp > SHA256SUMS
  # Annonce de mise à jour d AETHRYON Desktop (downloads/desktop/latest.json), à publier AVEC ce setup.
  python3 -I /depot/web/scripts/latest-desktop.py --setup "/sortie/AETHRYON-Setup-$VERSION.exe" --desktop-version "$DESK_VER" --notes /depot/desktop/CHANGELOG.md --sortie /sortie/latest-desktop.json
  rm -rf /sortie/charge && ls -la /sortie'

if [ "${ESSAIS_WINE:-0}" = "1" ]; then
  etape "Setup d'ESSAI « $VERSION_MAJ » pour éprouver « Mettre à jour » (jamais livré)"
  docker exec -e VERSION_MAJ="$VERSION_MAJ" "$C" bash -c 'set -e; rm -rf /tmp/maj && mkdir -p /tmp/maj && cd /tmp/maj && cp /sortie/charge.zip . && python3 -I - <<PY
import json, zipfile
src = zipfile.ZipFile("charge.zip"); m = json.loads(src.read("charge.json")); m["version"] = "$VERSION_MAJ"
with zipfile.ZipFile("charge-maj.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for i in src.infolist():
        z.writestr(i, json.dumps(m, ensure_ascii=False).encode() if i.filename == "charge.json" else src.read(i.filename))
PY
    cd /depot/setup && AETHRYON_CHARGE_ZIP=/tmp/maj/charge-maj.zip CARGO_TARGET_DIR=/cible nice -n 19 cargo build --release --target x86_64-pc-windows-gnu -p aethryon-setup 2>&1 | grep -E "^(warning|error)|Finished" | tail -1
    cp /cible/x86_64-pc-windows-gnu/release/aethryon-setup.exe /tmp/AETHRYON-Setup-essai-maj.exe'
  etape "AETHRYON Index pour l'essai : exemple index-essai du noyau, compilé pour Windows (jamais livré)"
  docker exec "$C" bash -c 'cd /depot/desktop && CARGO_TARGET_DIR=/cible-desktop nice -n 19 ionice -c3 cargo build --release --target x86_64-pc-windows-gnu -p aethryon-noyau --example index-essai 2>&1 | grep -E "^(warning|error)|Finished" | tail -3
    cp /cible-desktop/x86_64-pc-windows-gnu/release/examples/index-essai.exe /tmp/index-essai.exe'
  etape "Essais sous Wine 8 (ce n'est pas Windows)"
  docker exec -e VERSION="$VERSION" -e VERSION_MAJ="$VERSION_MAJ" -e BETA_NSIS=/essais/beta-nsis.exe -e SETUP_PRECEDENT=/essais/setup-precedent.exe -e INDEX_ESSAI=/tmp/index-essai.exe "$C" bash /depot/setup/essais-wine/essai-setup.sh "/sortie/AETHRYON-Setup-$VERSION.exe" /tmp/AETHRYON-Setup-essai-maj.exe
fi

if [ "${CAPTURES:-0}" = "1" ]; then
  etape "Captures Playwright (Chromium) : données rejouées produites par le vrai moteur sur un système factice"
  docker exec "$C" bash -c 'cd /depot/setup && CARGO_TARGET_DIR=/cible nice -n 19 cargo run -q -p aethryon-setup-moteur --example instantanes -- /depot/setup/e2e/donnees'
  (cd "$ICI" && SORTIE="$TRAVAIL/sortie/captures" node e2e/captures.mjs)
fi

if [ "${GARDER:-0}" != "1" ]; then
  etape "Suppression du conteneur"
  docker rm -f "$C" >/dev/null
fi
echo; echo "Fichiers construits : $TRAVAIL/sortie"; cat "$TRAVAIL/sortie/SHA256SUMS"
rm -f "$TRAVAIL/sortie/charge.zip"

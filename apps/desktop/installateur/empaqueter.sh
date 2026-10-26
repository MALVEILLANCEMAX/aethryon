#!/bin/bash
# Empaquetage Windows, exécuté DANS le conteneur de construction (makensis de Debian, aucun téléchargement) :
#   1. étage : aethryon-desktop.exe + WebView2Loader.dll (cible x86_64-pc-windows-gnu), panneau .ccx + panneau.json,
#      licences ;
#   2. makensis → AETHRYON-Desktop-Setup-<version>.exe ;
#   3. SHA256SUMS.
# Variables : PANNEAU_CCX (chemin du .ccx à embarquer), PANNEAU_VERSION, PANNEAU_VERSION_MANIFESTE, SIGNER (crochet).
set -euo pipefail
SRC=${SRC:-/src}
CIBLE=${CIBLE:-/cible/x86_64-pc-windows-gnu/release}
SORTIE=${SORTIE_DIR:-/sortie}
VERSION=$(grep -m1 '"version"' "$SRC/src-tauri/tauri.conf.json" | sed -E 's/.*"([0-9][^"]*)".*/\1/')
PANNEAU_CCX=${PANNEAU_CCX:?PANNEAU_CCX obligatoire (le .ccx du panneau à embarquer)}
PANNEAU_VERSION=${PANNEAU_VERSION:?PANNEAU_VERSION obligatoire (version produit du panneau, ex. 1.0.0-beta.2)}
MANIFESTE=$(unzip -p "$PANNEAU_CCX" manifest.json)
PANNEAU_VERSION_MANIFESTE=${PANNEAU_VERSION_MANIFESTE:-$(printf '%s' "$MANIFESTE" | grep -m1 '"version"' | sed -E 's/.*"([0-9][^"]*)".*/\1/')}
# Le panneau embarqué doit être celui qu'UPIA connaît sous l'identifiant de Desktop (ID_PANNEAU, nom AETHRYON) :
# installation, liste et retrait en dépendent.
printf '%s' "$MANIFESTE" | grep -q '"id": "fr.aethryon.premiere"' || { echo "ERREUR : identifiant du panneau ≠ fr.aethryon.premiere" >&2; exit 1; }
printf '%s' "$MANIFESTE" | grep -q '"name": "AETHRYON"' || { echo "ERREUR : nom du panneau ≠ AETHRYON" >&2; exit 1; }
# 1.0.0-beta.N s'écrit 0.9.N dans le manifeste (Adobe) et 0.9.N.0 pour Windows (quatre nombres).
case "$VERSION" in
  *-beta.*) VERSION_WINDOWS="0.9.${VERSION##*-beta.}.0" ;;
  *) VERSION_WINDOWS="${VERSION%%-*}.0" ;;
esac
E=$SORTIE/etage
rm -rf "$E"; mkdir -p "$E/panneau" "$E/licences"
cp "$CIBLE/aethryon-desktop.exe" "$CIBLE/WebView2Loader.dll" "$E/"
cp "$PANNEAU_CCX" "$E/panneau/aethryon-premiere.ccx"
SHA=$(sha256sum "$E/panneau/aethryon-premiere.ccx" | cut -d' ' -f1)
printf '{\n  "chemin": "aethryon-premiere.ccx",\n  "version": "%s",\n  "versionManifeste": "%s",\n  "sha256": "%s"\n}\n' "$PANNEAU_VERSION" "$PANNEAU_VERSION_MANIFESTE" "$SHA" > "$E/panneau/panneau.json"
cp "$SRC/src/assets/fonts/LICENSE-Inter.txt" "$SRC/src/assets/fonts/LICENSE-PlayfairDisplay.txt" "$E/licences/"
cp "$SRC/installateur/LICENCES-TIERS.txt" "$E/licences/"
DEF=(-DVERSION="$VERSION" -DVERSION_WINDOWS="$VERSION_WINDOWS" -DETAGE="$E" -DSORTIE="$SORTIE/AETHRYON-Desktop-Setup-$VERSION.exe")
[ -n "${SIGNER:-}" ] && DEF+=(-DSIGNER="$SIGNER")
cd "$SRC/installateur"
makensis -V2 "${DEF[@]}" aethryon-desktop.nsi
cd "$SORTIE"
cp "$E/aethryon-desktop.exe" "$E/WebView2Loader.dll" .
cp "$E/panneau/aethryon-premiere.ccx" "aethryon-premiere-$PANNEAU_VERSION.ccx"
sha256sum "AETHRYON-Desktop-Setup-$VERSION.exe" aethryon-desktop.exe WebView2Loader.dll "aethryon-premiere-$PANNEAU_VERSION.ccx" > SHA256SUMS
cat SHA256SUMS
ls -la "$SORTIE"

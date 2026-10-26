#!/bin/bash
# Construction complète d'AETHRYON Desktop pour Windows, depuis Linux, sans rien publier :
#   1. interface : npm ci, essais vitest, vite build (dist/) ;
#   2. conteneur JETABLE rust:1-bookworm (3 Go, 4 processeurs, 2 tâches de compilation par défaut — CARGO_BUILD_JOBS —
#      car 4 tâches manquent de mémoire sur le crate « windows » ; faible priorité, AUCUNE étiquette Traefik) :
#      apt (mingw-w64, nsis, unzip), cible x86_64-pc-windows-gnu, `cargo test -p aethryon-noyau -p aethryon-archive-extension`,
#      `cargo build --release --target x86_64-pc-windows-gnu --features custom-protocol` ;
#   3. installateur NSIS maison (installateur/empaqueter.sh) et SHA256SUMS ;
#   4. ESSAIS_WINE=1 : essais de l'exe et de l'installateur sous Wine 8 (Debian), essais du cœur et de la préparation
#      du glisser natif compilés pour Windows — Wine n'est PAS Windows ;
#   5. le conteneur est supprimé (GARDER=1 pour le garder).
# Sources autorisées : registre npm, crates.io, Debian apt dans le conteneur, image rust:1-bookworm de Docker Hub.
#
# Variables : TRAVAIL (cible Cargo, registre, sortie ; hors du dépôt), PANNEAU_CCX (panneau à embarquer ; par défaut
# celui que premiere/scripts/construire-ccx.mjs construit depuis premiere/ du MÊME arbre, vérifié contre
# premiere/EMPREINTES.txt), PANNEAU_VERSION, CONTENEUR, ESSAIS_WINE, GARDER.
set -euo pipefail
ICI=$(cd "$(dirname "$0")/.." && pwd)
DEPOT=$(dirname "$ICI")
TRAVAIL=${TRAVAIL:-$DEPOT/.construction-desktop}
C=${CONTENEUR:-aethryon-desktop-construction}
etape() { echo; echo "=== $1 ($(date -u +%H:%M:%S))"; }
mkdir -p "$TRAVAIL"/{cible,registre,sortie,panneau}

etape "Panneau Premiere à embarquer"
if [ -z "${PANNEAU_CCX:-}" ]; then
  # Panneau du même arbre : construction déterministe, puis comparaison avec l'empreinte versionnée.
  PANNEAU_VERSION=$(node -p "require('$DEPOT/premiere/version.json').produit")
  node "$DEPOT/premiere/scripts/construire-ccx.mjs" --sortie "$TRAVAIL/panneau" >/dev/null
  PANNEAU_CCX="$TRAVAIL/panneau/aethryon-premiere-$PANNEAU_VERSION.ccx"
  ATTENDU=$(grep -E " aethryon-premiere-$PANNEAU_VERSION\.ccx\$" "$DEPOT/premiere/EMPREINTES.txt" | cut -d' ' -f1)
  OBTENU=$(sha256sum "$PANNEAU_CCX" | cut -d' ' -f1)
  if [ "$ATTENDU" != "$OBTENU" ]; then
    echo "ERREUR : le .ccx construit ($OBTENU) diffère de premiere/EMPREINTES.txt ($ATTENDU)." >&2
    echo "Relancer d'abord : sh premiere/scripts/construire.sh (essais, rendus, .ccx, empreintes)." >&2
    exit 1
  fi
else
  mkdir -p "$TRAVAIL/panneau"
  cp "$PANNEAU_CCX" "$TRAVAIL/panneau/"
  PANNEAU_VERSION=${PANNEAU_VERSION:?PANNEAU_VERSION obligatoire avec PANNEAU_CCX}
fi
NOM_CCX=$(basename "$PANNEAU_CCX")
# Manifeste RÉEL de l'extension CEP livrée (essai Wine du diagnostic : « Panneau AETHRYON 2.0.1 installé »).
MANIFESTE_CEP=${MANIFESTE_CEP:?MANIFESTE_CEP must point to a local build artefact}
if [ -f "$MANIFESTE_CEP" ]; then cp "$MANIFESTE_CEP" "$TRAVAIL/panneau/cep-manifest.xml"; else echo "NOTE : $MANIFESTE_CEP absent, essai Wine du panneau CEP impossible"; fi
echo "panneau $PANNEAU_VERSION : $NOM_CCX ($(sha256sum "$TRAVAIL/panneau/$NOM_CCX" | cut -c1-16)…)"

etape "Interface : dépendances, essais, construction"
(cd "$ICI" && npm ci --no-audit --no-fund >/dev/null && npx vitest run && npm run build)

etape "Conteneur jetable"
docker rm -f "$C" >/dev/null 2>&1 || true
docker run -d --name "$C" --memory 3g --memory-swap 3g --cpus 4 --cpu-shares 256 --pids-limit 4096 \
  -v "$ICI":/src -v "$TRAVAIL/cible":/cible -v "$TRAVAIL/registre":/usr/local/cargo/registry \
  -v "$TRAVAIL/sortie":/sortie -v "$TRAVAIL/panneau":/panneau:ro -e CARGO_TARGET_DIR=/cible -e CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}" \
  -e CARGO_TERM_COLOR=never rust:1-bookworm sleep infinity >/dev/null
echo "étiquettes : $(docker inspect "$C" --format '{{json .Config.Labels}}')"
docker exec "$C" bash -c 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq --no-install-recommends mingw-w64 nsis unzip >/dev/null && rustup target add x86_64-pc-windows-gnu >/dev/null 2>&1 && rustc --version && makensis -VERSION && echo'

etape "Cœur Rust : essais (Linux)"
docker exec "$C" bash -c 'cd /src && nice -n 19 cargo test -p aethryon-noyau -p aethryon-archive-extension 2>&1 | grep -E "^test |test result"'

etape "Application : construction Windows (x86_64-pc-windows-gnu)"
docker exec "$C" bash -c 'cd /src && nice -n 19 ionice -c3 cargo build --release --target x86_64-pc-windows-gnu -p aethryon-desktop --features custom-protocol 2>&1 | grep -vE "^\s+(Compiling|Downloaded|Downloading)" | tail -5'

etape "Installateur NSIS et empreintes"
docker exec -e PANNEAU_CCX="/panneau/$NOM_CCX" -e PANNEAU_VERSION="$PANNEAU_VERSION" "$C" bash -c 'rm -rf /sortie/*; bash /src/installateur/empaqueter.sh'

if [ "${ESSAIS_WINE:-0}" = "1" ]; then
  etape "Essais sous Wine 8 (ce n'est pas Windows)"
  docker exec "$C" bash -c 'export DEBIAN_FRONTEND=noninteractive WINEDEBUG=-all; dpkg --add-architecture i386 && apt-get update -qq && apt-get install -y -qq --no-install-recommends wine wine64 wine32:i386 python3 >/dev/null 2>&1
    rm -rf ~/.wine; timeout 300 /usr/lib/wine/wine wineboot -i >/dev/null 2>&1; /usr/lib/wine/wine winecfg -v win10 >/dev/null 2>&1
    cd /src/essais-wine && x86_64-w64-mingw32-gcc -shared -O2 -o /tmp/bcryptprimitives.dll bcryptprimitives-wine.c -ladvapi32 -Wl,--kill-at && cp /tmp/bcryptprimitives.dll ~/.wine/drive_c/windows/system32/
    python3 /src/essais-wine/essai-nm.py /sortie/aethryon-desktop.exe && bash /src/essais-wine/essai-diagnostic.sh && bash /src/essais-wine/essai-installateur.sh /sortie/AETHRYON-Desktop-Setup-*.exe
    # Essais du cœur compilés POUR WINDOWS, exécutés sous Wine (locale UTF-8 indispensable aux noms accentués).
    cd /src && cargo test -p aethryon-noyau --target x86_64-pc-windows-gnu --no-run 2>&1 | tail -1
    T=$(ls -t /cible/x86_64-pc-windows-gnu/debug/deps/aethryon_noyau-*.exe | head -1)
    cd /tmp && LANG=C.UTF-8 LC_ALL=C.UTF-8 timeout 600 /usr/lib/wine/wine "$T" --test-threads=1 2>&1 | grep -E "test result|FAILED"
    # Préparation du glisser natif (src-tauri/src/glisser.rs : image par WIC, source OLE, objet de données du Shell),
    # essais compilés POUR WINDOWS, exécutés sous Wine. Aucun DoDragDrop ici : ni souris, ni cible, ni Premiere.
    cd /src && cargo test -p aethryon-desktop --target x86_64-pc-windows-gnu --no-run 2>&1 | tail -1
    G=$(ls -t /cible/x86_64-pc-windows-gnu/debug/deps/aethryon_desktop-*.exe | head -1)
    mkdir -p /tmp/essai-glisser && cp "$G" /tmp/essai-glisser/essais.exe && cp /sortie/WebView2Loader.dll /tmp/essai-glisser/
    cd /tmp/essai-glisser && LANG=C.UTF-8 LC_ALL=C.UTF-8 timeout 300 /usr/lib/wine/wine essais.exe --test-threads=1 --nocapture 2>&1 | grep -E "^test |test result|FAILED|E_NOTIMPL"'
fi

if [ "${GARDER:-0}" != "1" ]; then
  etape "Suppression du conteneur"
  docker rm -f "$C" >/dev/null
fi
echo; echo "Fichiers construits : $TRAVAIL/sortie"; cat "$TRAVAIL/sortie/SHA256SUMS"

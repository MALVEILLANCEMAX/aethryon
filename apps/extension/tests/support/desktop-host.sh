#!/bin/bash
# Construit l'hôte Native Messaging d'AETHRYON Desktop pour Linux (exemple `banc` du noyau : `banc --nm` ou
# `banc chrome-extension://<id>/` = le même code que `aethryon-desktop.exe --nm`, desktop/noyau/src/nm.rs), comme
# integration/lancer.sh : conteneur JETABLE rust:1-bookworm (3 Go, 4 processeurs, faible priorité, AUCUNE étiquette
# Traefik), supprimé ensuite ; sources montées en LECTURE SEULE (la branche du Desktop n'est jamais modifiée).
#   tests/support/desktop-host.sh <dépôt contenant desktop/> <dossier cible Cargo> [<registre Cargo>]
# Affiche le chemin de l'exécutable (à passer au banc : AETHRYON_NM_EXE=… node --test tests/browser/desktop.test.mjs).
set -euo pipefail
DEPOT=$(cd "${1:?dépôt contenant desktop/}" && pwd)
CIBLE=$(mkdir -p "${2:?dossier cible Cargo}" && cd "$2" && pwd)
REGISTRE=${3:-$CIBLE/../registre}
mkdir -p "$REGISTRE"
REGISTRE=$(cd "$REGISTRE" && pwd)
C=aethryon-nm-extension-construction
docker rm -f "$C" >/dev/null 2>&1 || true
docker run -d --name "$C" --memory 3g --memory-swap 3g --cpus 4 --cpu-shares 256 --pids-limit 4096 \
  -v "$DEPOT/desktop":/src:ro -v "$CIBLE":/cible -v "$REGISTRE":/usr/local/cargo/registry \
  -e CARGO_TARGET_DIR=/cible -e CARGO_TERM_COLOR=never rust:1-bookworm sleep infinity >/dev/null
echo "étiquettes du conteneur : $(docker inspect "$C" --format '{{json .Config.Labels}}')" >&2
trap 'docker rm -f "$C" >/dev/null 2>&1 || true' EXIT
# --features essais : la source des mises à jour (maj_extension) peut être un serveur HTTPS local du banc.
docker exec -w /src "$C" nice -n 19 cargo build --locked -p aethryon-noyau --features essais --example banc >&2
echo "$CIBLE/debug/examples/banc"

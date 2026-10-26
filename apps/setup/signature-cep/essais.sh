#!/bin/bash
# Essais de la signature CEP (essais_zxp.py) dans un conteneur JETABLE debian:bookworm-slim, avec un matériel de
# signature jetable (jamais celui de <dossier privé de signature>). ZXP_REFERENCE : un ZXP réel signé par ZXPSignCmd
# d'Adobe (facultatif) pour vérifier que le format relevé est fidèle.
set -euo pipefail
ICI=$(cd "$(dirname "$0")" && pwd)
C=aethryon-signature-cep-essais
docker rm -f "$C" >/dev/null 2>&1 || true
docker run -d --name "$C" --memory 3g --memory-swap 3g --cpus 4 --cpu-shares 256 --pids-limit 1024 debian:bookworm-slim sleep infinity >/dev/null
docker exec "$C" bash -c 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq --no-install-recommends python3 python3-lxml python3-cryptography xmlsec1 openssl >/dev/null 2>&1; mkdir -p /essais /ref'
docker cp "$ICI/zxp.py" "$C:/essais/" && docker cp "$ICI/essais_zxp.py" "$C:/essais/" && docker cp "$ICI/creer-certificats.sh" "$C:/essais/"
REF=""
if [ -n "${ZXP_REFERENCE:-}" ] && [ -f "$ZXP_REFERENCE" ]; then docker cp "$ZXP_REFERENCE" "$C:/ref/reference.zxp"; REF="--reference /ref/reference.zxp"; fi
set +e
docker exec "$C" bash -c "cd /tmp && python3 -I -W error::ResourceWarning /essais/essais_zxp.py $REF 2>&1 | grep -E '^test_|^Ran|^OK|FAILED|Error'"
CODE=$?
docker rm -f "$C" >/dev/null
exit $CODE

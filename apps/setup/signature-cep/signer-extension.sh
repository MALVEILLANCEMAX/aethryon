#!/bin/bash
# Signe une extension CEP en ZXP depuis Linux, puis vérifie la signature de deux façons indépendantes :
#   1. zxp.py verifier : signature de SignedInfo, Manifest, CHAQUE fichier, aucun fichier en trop, aucun lien
#      symbolique, horodatage RFC 3161 (empreinte + signature de l'autorité locale) ;
#   2. xmlsec1 (libxml2 / OpenSSL, implémentation XML-DSig indépendante) : SignedInfo ET toutes les références du
#      Manifest, sur le paquet extrait.
# Conteneur JETABLE debian:bookworm-slim (3 Go, 4 processeurs, faible priorité, aucune étiquette Traefik), supprimé à
# la fin (GARDER=1 pour le garder). Paquets Debian : python3-lxml, python3-cryptography, xmlsec1, openssl, unzip.
# Le matériel secret reste dans $SECRETS (0700, hors Git) ; rien n'est affiché ni envoyé hors de la machine.
#
# usage : signer-extension.sh <dossier-extension> <sortie.zxp>
#   SECRETS (obligatoire, dossier privé hors dépôt), SANS_HORODATAGE=1, ALGO=rsa-sha1|rsa-sha256, CONTENEUR, GARDER
set -euo pipefail
ICI=$(cd "$(dirname "$0")" && pwd)
SOURCE=$(cd "${1:?usage : signer-extension.sh <dossier-extension> <sortie.zxp>}" && pwd)
SORTIE=${2:?usage : signer-extension.sh <dossier-extension> <sortie.zxp>}
mkdir -p "$(dirname "$SORTIE")"
SORTIE_DIR=$(cd "$(dirname "$SORTIE")" && pwd)
NOM=$(basename "$SORTIE")
SECRETS=${SECRETS:?SECRETS must point to the private signing folder (outside the repository)}
C=${CONTENEUR:-aethryon-signature-cep}
ALGO=${ALGO:-rsa-sha1}
( umask 077; mkdir -p "$SECRETS" ); chmod 700 "$SECRETS"

if ! docker inspect "$C" >/dev/null 2>&1; then
  docker run -d --name "$C" --memory 3g --memory-swap 3g --cpus 4 --cpu-shares 256 --pids-limit 1024 \
    debian:bookworm-slim sleep infinity >/dev/null
  echo "conteneur $C, étiquettes : $(docker inspect "$C" --format '{{json .Config.Labels}}')"
  docker exec "$C" bash -c 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq --no-install-recommends python3 python3-lxml python3-cryptography xmlsec1 openssl unzip >/dev/null 2>&1'
fi
# Copie dans le conteneur (docker cp suit la source telle quelle : un lien symbolique reste un lien et sera refusé).
docker exec "$C" rm -rf /travail
docker exec "$C" mkdir -p /travail/source /travail/sortie /secrets
docker cp "$SOURCE/." "$C:/travail/source/"
docker cp "$ICI/zxp.py" "$C:/travail/zxp.py"
docker cp "$ICI/creer-certificats.sh" "$C:/travail/creer-certificats.sh"
# Secrets : copiés dans le conteneur le temps de la signature, jamais affichés, effacés ensuite.
if [ -e "$SECRETS/signature.p12" ]; then
  docker cp "$SECRETS/." "$C:/secrets/"
else
  docker exec "$C" bash /travail/creer-certificats.sh /secrets
  docker cp "$C:/secrets/." "$SECRETS/"
  chmod 700 "$SECRETS" "$SECRETS/tsa"; find "$SECRETS" -type f -exec chmod 600 {} +
fi
OPT_H="--tsa-dossier /secrets/tsa"; OPT_V="--exiger-horodatage --tsa-ca /secrets/tsa/tsa.crt.pem"
if [ "${SANS_HORODATAGE:-0}" = "1" ]; then OPT_H="--sans-horodatage"; OPT_V=""; fi
docker exec "$C" bash -c "cd /tmp && python3 -I /travail/zxp.py signer --source /travail/source --sortie /travail/sortie/$NOM \
  --p12 /secrets/signature.p12 --mot-de-passe-fichier /secrets/mot-de-passe $OPT_H --algo $ALGO"
echo "--- vérification 1 : zxp.py"
docker exec "$C" bash -c "cd /tmp && python3 -I /travail/zxp.py verifier /travail/sortie/$NOM $OPT_V"
echo "--- vérification 2 : xmlsec1 (SignedInfo + toutes les références du Manifest, paquet extrait)"
docker exec "$C" bash -c "set -e; rm -rf /tmp/x && mkdir /tmp/x && cd /tmp/x && unzip -q /travail/sortie/$NOM && cp META-INF/signatures.xml ./_sig.xml
  N=\$(grep -o '<Reference URI=\"[^#]' _sig.xml | wc -l)
  xmlsec1 --verify --insecure --id-attr:Id 'http://www.w3.org/2000/09/xmldsig#:Manifest' --enabled-reference-uris same-doc,local,remote _sig.xml > /tmp/xmlsec.txt 2>&1 || true
  tail -3 /tmp/xmlsec.txt
  grep -q '^OK' /tmp/xmlsec.txt && grep -q 'SignedInfo References (ok/all): 1/1' /tmp/xmlsec.txt && grep -q \"Manifests References (ok/all): \$N/\$N\" /tmp/xmlsec.txt && echo \"xmlsec1 : VALIDE (\$N/\$N fichiers)\" || { echo 'xmlsec1 : INVALIDE'; exit 1; }"
docker exec "$C" bash -c "cd /tmp && python3 -I /travail/zxp.py verifier /travail/sortie/$NOM --json $OPT_V > /travail/sortie/$NOM.verification.json"
docker cp "$C:/travail/sortie/$NOM" "$SORTIE_DIR/$NOM"
docker cp "$C:/travail/sortie/$NOM.verification.json" "$SORTIE_DIR/$NOM.verification.json"
# Numéro de série de l'autorité d'horodatage : incrémenté par openssl ts, à conserver.
docker cp "$C:/secrets/tsa/serie" "$SECRETS/tsa/serie" && chmod 600 "$SECRETS/tsa/serie"
docker exec "$C" rm -rf /secrets /travail
if [ "${GARDER:-0}" != "1" ]; then docker rm -f "$C" >/dev/null; fi
echo "ZXP : $SORTIE_DIR/$NOM ($(sha256sum "$SORTIE_DIR/$NOM" | cut -c1-16)…)"

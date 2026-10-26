#!/bin/bash
# Crée, UNE fois, le matériel de signature CEP d'essai, hors du dépôt Git, dans un dossier réservé à root :
#   $SECRETS/signature.p12      clé RSA 2048 + certificat auto-signé X.509 v1 (comme `ZXPSignCmd -selfSignedCert`)
#   $SECRETS/mot-de-passe       mot de passe aléatoire du PKCS#12 et de la clé d'horodatage (0600)
#   $SECRETS/signature.crt.pem  certificat public (sans secret)
#   $SECRETS/tsa/               autorité d'horodatage RFC 3161 LOCALE (openssl ts) : rien ne sort de la machine
# Ne remplace jamais un matériel existant. N'affiche ni clé ni mot de passe (seulement les empreintes publiques).
# À lancer dans un conteneur jetable qui monte $SECRETS (voir signer-extension.sh) ; openssl 3 requis.
set -euo pipefail
umask 077
SECRETS=${1:?usage : creer-certificats.sh <dossier-secrets>}
SUJET=${SUJET:-/C=FR/O=AETHRYON/CN=AETHRYON}
JOURS=${JOURS:-3650}
mkdir -p "$SECRETS/tsa"
chmod 700 "$SECRETS" "$SECRETS/tsa"
if [ -e "$SECRETS/signature.p12" ]; then
  echo "Matériel déjà présent dans $SECRETS : rien n'est remplacé."
  exit 0
fi
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
openssl rand -base64 33 | tr -d '\n' > "$SECRETS/mot-de-passe"
PW="file:$SECRETS/mot-de-passe"

# Certificat de signature : X.509 v1, sans extension, signé SHA-256, comme celui que fabrique ZXPSignCmd.
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$T/cle.pem" 2>/dev/null
openssl req -new -key "$T/cle.pem" -subj "$SUJET" -out "$T/demande.csr"
openssl x509 -req -in "$T/demande.csr" -signkey "$T/cle.pem" -days "$JOURS" -sha256 \
  -set_serial "0x$(openssl rand -hex 8)" -out "$SECRETS/signature.crt.pem" 2>/dev/null
openssl pkcs12 -export -inkey "$T/cle.pem" -in "$SECRETS/signature.crt.pem" -name "AETHRYON CEP" \
  -passout "$PW" -out "$SECRETS/signature.p12"
shred -u "$T/cle.pem" 2>/dev/null || rm -f "$T/cle.pem"

# Autorité d'horodatage locale (certificat auto-signé, usage étendu timeStamping critique, exigé par RFC 3161).
cd "$SECRETS/tsa"
openssl req -x509 -newkey rsa:2048 -keyout tsa.key.pem -passout "$PW" -sha256 -days "$JOURS" \
  -subj "/C=FR/O=AETHRYON/CN=AETHRYON horodatage local" \
  -addext "basicConstraints=critical,CA:FALSE" -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,timeStamping" -out tsa.crt.pem 2>/dev/null
echo 01 > serie
# Politique : OID dérivé d'un UUID aléatoire (arc 2.25, ISO/IEC 9834-8), propre à cette autorité locale.
POLITIQUE="2.25.$(python3 -c 'import uuid; print(uuid.uuid4().int)')"
cat > tsa.cnf <<EOF
[ tsa ]
default_tsa = tsa_locale
[ tsa_locale ]
dir = .
serial = \$dir/serie
crypto_device = builtin
signer_cert = \$dir/tsa.crt.pem
certs = \$dir/tsa.crt.pem
signer_key = \$dir/tsa.key.pem
signer_digest = sha256
default_policy = $POLITIQUE
other_policies = $POLITIQUE
digests = sha1, sha256
accuracy = secs:1
ordering = no
tsa_name = yes
ess_cert_id_chain = no
ess_cert_id_alg = sha256
EOF
chmod 600 "$SECRETS"/* "$SECRETS"/tsa/* 2>/dev/null || true
chmod 700 "$SECRETS/tsa"
echo "Matériel créé dans $SECRETS (droits 0700/0600)."
echo "Certificat de signature : $(openssl x509 -in "$SECRETS/signature.crt.pem" -noout -subject -enddate | tr '\n' ' ')"
echo "  SHA-256 : $(openssl x509 -in "$SECRETS/signature.crt.pem" -noout -fingerprint -sha256 | cut -d= -f2)"
echo "Autorité d'horodatage locale : $(openssl x509 -in tsa.crt.pem -noout -subject -enddate | tr '\n' ' ')"

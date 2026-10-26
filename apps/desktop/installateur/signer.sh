#!/bin/bash
# Crochet de signature appelé par makensis (!finalize) avec le chemin de l'exécutable à signer.
# SANS EFFET : le propriétaire n'a acheté aucun certificat (décision D2 de l'audit : Store MSIX, Certum OV ≈ 209 €/an,
# ou Artifact Signing). Quand un certificat existera, remplacer le corps par la commande de l'autorité choisie, par
# exemple osslsigncode (PKCS#11 / carte) ou la signature dans le nuage de Certum, puis construire avec
#   makensis -DSIGNER=/chemin/installateur/signer.sh …
# et signer aussi aethryon-desktop.exe AVANT l'empaquetage (même commande).
echo "signer.sh : aucun certificat configuré, « $1 » n'est pas signé." >&2
exit 0

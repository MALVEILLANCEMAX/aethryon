#!/bin/bash
# Crochet de signature Authenticode d'AETHRYON Setup : appelé par construire.sh pour aethryon-setup-ui.exe et
# aethryon-desktop.exe AVANT l'empaquetage dans la charge, puis pour AETHRYON-Setup-<version>.exe à la fin.
# SANS EFFET tant que le propriétaire n'a pas acheté de certificat (décision D2 : Certum OV ≈ 209 €/an, signature
# dans le nuage, ou Store MSIX). Ensuite : remplacer le corps par la commande de l'autorité choisie, par exemple
#   osslsigncode sign -pkcs11module … -h sha256 -t <horodatage RFC 3161> -in "$1" -out "$1.signe" && mv "$1.signe" "$1"
# Ce crochet ne concerne PAS la signature CEP de l'extension (signature-cep/, ZXP), qui est déjà faite.
echo "signer.sh : aucun certificat Authenticode configuré, « $(basename "$1") » n'est pas signé." >&2
exit 0

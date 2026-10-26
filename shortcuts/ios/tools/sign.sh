#!/usr/bin/env bash
# Signature du raccourci DÉJÀ VALIDÉ par HubSign (RoutineHub), puis contrôles du fichier signé.
#
# À savoir avant de lancer :
# - HubSign est un service TIERS : il reçoit tout le contenu du raccourci (aucun secret dedans :
#   le jeton est demandé à l'installation ; tools/hubsign.py refuse d'envoyer un jeton) ;
# - la signature « Tout le monde » passe par iCloud : chaque signature crée un enregistrement
#   iCloud PUBLIC appartenant au compte de HubSign, que vous ne pouvez ni renommer ni supprimer
#   (constaté le 2026-10-10 via https://www.icloud.com/shortcuts/api/records/<id>).
# En cas d'échec, dist/ n'est pas modifié : le fichier non signé reste dans build/ et n'est PAS
# installable sur iPhone.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"
PY=.venv/bin/python
NAME="${1:-AETHRYON}"                     # AETHRYON (v3) ; anciens : YouTube-Converter, YouTube-Converter-DEBUG
STAGE=final; [[ "$NAME" == *-DEBUG ]] && STAGE=debug
DISPLAY_NAME="${NAME//-/ }"
UNSIGNED=build/$NAME.unsigned.shortcut
SIGNED=build/$NAME.signed.shortcut

[[ -f "$UNSIGNED" ]] || tools/build.sh
echo "== Validation avant envoi"
$PY tools/validate.py --stage "$STAGE" "$UNSIGNED" | grep -E "FAIL|=="
$PY tools/validate.py --stage "$STAGE" "$UNSIGNED" >/dev/null || { echo "Raccourci invalide : rien n'est envoyé."; exit 1; }

echo "== Signature HubSign"
rm -f "$SIGNED"
$PY tools/hubsign.py "$UNSIGNED" "$SIGNED" --name "$DISPLAY_NAME"

echo "== Contrôle du fichier signé"
{
    echo "Signé le $(date -u '+%Y-%m-%d %H:%M UTC') par HubSign (https://hubsign.routinehub.services/sign)"
    $PY tools/inspect_signed.py "$SIGNED" --compare "$UNSIGNED"
    $PY tools/validate.py --stage "$STAGE" "$SIGNED"
} | tee "build/SIGNATURE-$NAME.txt"

mkdir -p dist
install -m 0644 "$SIGNED" "dist/$NAME.shortcut"
if [[ "$NAME" == YouTube-Converter ]]; then cp "build/SIGNATURE-$NAME.txt" dist/SIGNATURE.txt; else cp "build/SIGNATURE-$NAME.txt" "dist/SIGNATURE-$NAME.txt"; fi
(cd dist && sha256sum "$NAME.shortcut" > "$NAME.shortcut.sha256")
echo
echo "Fichier signé et vérifié : $HERE/dist/$NAME.shortcut"
echo "Installation : à tester sur un iPhone (voir TEST_IPHONE.md). Rien n'est mis en ligne."

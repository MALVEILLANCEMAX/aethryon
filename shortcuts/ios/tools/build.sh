#!/usr/bin/env bash
# Build reproductible du raccourci « AETHRYON » (src/AETHRYON.cherri) : compilateur Cherri figé (+ patch),
# tests A à D, validation statique et tests par mutation du validateur.
# Rien n'est envoyé à l'extérieur : Cherri compile toujours avec --skip-sign (sous Linux, sans
# cette option, il enverrait le raccourci au service HubSign). La signature est une étape à part :
# tools/sign.sh (make sign).
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"
mkdir -p build

tools/build-cherri.sh | tail -n 1
if [[ ! -x .venv/bin/python ]]; then
    python3 -m venv .venv
    .venv/bin/pip install -q --require-hashes --only-binary=:all: -r tools/requirements.txt
fi
PY=.venv/bin/python

# compile SOURCE SORTIE : Cherri écrit « <nom>_unsigned.shortcut » à côté du source.
compile() {
    local src=$1 out=$2 name
    name="$(sed -n 's/^#define name //p' "$src" | head -n1)"
    rm -f "$(dirname "$src")/${name}_unsigned.shortcut"
    .bin/cherri "$src" --skip-sign --no-ansi
    mv -f "$(dirname "$src")/${name}_unsigned.shortcut" "$out"
    echo "compilé : $out ($(stat -c %s "$out") octets)"
}

echo "== Test A : pipeline minimal (une notification)"
compile tests/stages/A-minimal.cherri build/A-minimal.unsigned.shortcut
$PY - build/A-minimal.unsigned.shortcut <<'EOF'
import plistlib, sys
p = plistlib.load(open(sys.argv[1], "rb"))
ids = [a["WFWorkflowActionIdentifier"] for a in p["WFWorkflowActions"]]
assert ids == ["is.workflow.actions.notification"], ids
print("  PASS  plist valide, 1 action (notification)")
EOF

echo "== Test B : logique native (partage, presse-papiers, saisie, question, menu)"
compile tests/stages/B-native.cherri build/B-native.unsigned.shortcut
$PY tools/validate.py --stage native build/B-native.unsigned.shortcut | grep -E "FAIL|=="

echo "== Test C : requêtes HTTP (généré depuis src/, sans l'enregistrement)"
{
    echo "// GÉNÉRÉ par tools/build.sh depuis src/AETHRYON.cherri : ne pas éditer."
    sed -e '/^\/\/ 9\. Enregistrement/,$d' -e 's/^#define name AETHRYON$/#define name AETHRYON Test C/' \
        src/AETHRYON.cherri
    echo 'show("{@titre} : {lienFichier}")'
} > tests/stages/C-http.cherri
compile tests/stages/C-http.cherri build/C-http.unsigned.shortcut
$PY tools/validate.py --stage http build/C-http.unsigned.shortcut | grep -E "FAIL|=="

echo "== Test D : raccourci final"
compile src/AETHRYON.cherri build/AETHRYON.unsigned.shortcut
$PY tools/validate.py build/AETHRYON.unsigned.shortcut
# src/YouTube-Converter.cherri (v2) reste en référence, non construit. La version DEBUG (parcours v1)
# n'est plus construite : AETHRYON
# affiche elle-même le détail de chaque échec. Simulation d'exécution : tools/simulate.py.
echo "== Le validateur détecte-t-il les défauts ? (tests par mutation)"
$PY tests/validator_mutants.py build/AETHRYON.unsigned.shortcut
echo
echo "Non signé (NON installable sur iPhone) : build/AETHRYON.unsigned.shortcut"
echo "Signature : make sign (envoie le raccourci au service tiers HubSign)."

#!/bin/bash
# Essai sous Wine du mode --diagnostic de l'exe WINDOWS : un faux « Adobe Premiere Pro.exe » (ressource de version
# 26.5.2.13, rien d'Adobe) est placé dans C:\Program Files\Adobe\Adobe Premiere Pro 2026 ; on vérifie la recherche
# par dossier et la lecture de version (GetFileVersionInfoW). Panneau AETHRYON : le manifeste RÉEL de l'extension CEP
# 2.0.1 (/panneau/cep-manifest.xml, copié par scripts/construire.sh) est posé là où AETHRYON Setup l'installe
# (%APPDATA%\Adobe\CEP\extensions\fr.aethryon.premiere\CSXS) : le diagnostic doit dire « installé 2.0.1 », puis
# « absent » une fois le dossier retiré. Wine n'est pas Windows.
set -u
export WINEDEBUG=-all
W=/usr/lib/wine/wine
cd "$(dirname "$0")/faux-premiere" && x86_64-w64-mingw32-windres version.rc -O coff -o /tmp/version.o && x86_64-w64-mingw32-gcc -O2 main.c /tmp/version.o -o /tmp/faux.exe
P="$HOME/.wine/drive_c/Program Files/Adobe/Adobe Premiere Pro 2026"
mkdir -p "$P" && cp /tmp/faux.exe "$P/Adobe Premiere Pro.exe"
U=$(ls -d ~/.wine/drive_c/users/*/ | grep -v Public | head -1)
CEP="$U/AppData/Roaming/Adobe/CEP/extensions/fr.aethryon.premiere"
rm -rf "$CEP" && mkdir -p "$CEP/CSXS" && cp "${MANIFESTE_CEP:-/panneau/cep-manifest.xml}" "$CEP/CSXS/manifest.xml"
$W /sortie/aethryon-desktop.exe --diagnostic > /tmp/diag.json 2>/dev/null
rm -rf "$CEP"
$W /sortie/aethryon-desktop.exe --diagnostic > /tmp/diag-sans-panneau.json 2>/dev/null
cat /tmp/diag.json
python3 - <<'PY'
import json
d = json.load(open("/tmp/diag.json"))
p = d["premiere"]["principale"]
assert p and p["version"] == "26.5.2.13" and p["compatible"] is True and p["glisser"] is False, p
assert d["plateforme"] == "windows"
c = d["panneau"]
assert c and c["version"] == "2.0.1" and c["libelle"] == "Panneau AETHRYON 2.0.1 installé", c
assert c["dossier"].lower().endswith("\\appdata\\roaming\\adobe\\cep\\extensions\\fr.aethryon.premiere"), c
assert "panneauEmbarque" not in d, "plus aucune recherche du .ccx"
s = json.load(open("/tmp/diag-sans-panneau.json"))
assert s["panneau"] is None and "panneauEmbarque" not in s, s.get("panneau")
print("ESSAI DIAGNOSTIC SOUS WINE : RÉUSSI (version lue dans l'exe, compatibilité calculée, glisser-déposer refusé avant 27.0 ;", c["libelle"], "dans", c["dossier"], "; absent une fois retiré)")
PY

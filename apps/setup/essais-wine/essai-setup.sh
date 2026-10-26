#!/bin/bash
# Essais d'AETHRYON-Setup.exe (Windows) SOUS WINE 8 — Wine n'est PAS Windows : pas de WebView2 (l'interface ne
# s'ouvre pas), pas de DWM, pas de vrai Premiere ni de CEP. On éprouve ici l'exe réel et sa logique système, par les
# modes sans fenêtre : amorce (extraction vérifiée, relance depuis %TEMP%), détection, installation, détection de
# l'installation (maintenance), réparation, désinstallation ; fichiers et clés HKCU qui apparaissent puis disparaissent ;
# extension navigateur dans son dossier géré (%LOCALAPPDATA%\AETHRYON\extension), --mettre-a-jour (lancement par
# AETHRYON Desktop), dossier géré gardé ou retiré à la désinstallation.
#   essai-setup.sh /sortie/AETHRYON-Setup-<version>.exe [setup d'essai plus récent]
#   BETA_NSIS=<AETHRYON-Desktop-Setup-1.0.0-beta.2.exe> : section 7, remplacement du VRAI installateur NSIS de la bêta 2.
#   SETUP_PRECEDENT=<setup PUBLIÉ précédent> : section 8, --mettre-a-jour par-dessus une installation de ce setup.
#     Réglages changés dans le Desktop précédent (config.json, desktop.json, Run) gardés ; dossier géré et fichiers CEP inchangés.
#   INDEX_ESSAI=<index-essai.exe> (exemple du noyau) : sections 4 bis et 8, index SQLite et ses réglages gardés par la mise à jour.
set -u
export WINEDEBUG=-all
# Locale UTF-8 : sans elle, Wine lit mal les noms accentués des fichiers Linux (« Icône » → « IcC4ne »), ce que Windows
# ne fait pas (même règle que les essais Wine du Desktop).
export LANG=C.UTF-8 LC_ALL=C.UTF-8
S=${1:?usage : essai-setup.sh AETHRYON-Setup.exe [setup d'essai d'une version plus récente]}
S2=${2:-}
ICI=$(cd "$(dirname "$0")" && pwd)
DEPOT=$(dirname "$(dirname "$ICI")")
ECHECS=0
ok() { echo "OK    $*"; }
ko() { echo "ÉCHEC $*"; ECHECS=$((ECHECS+1)); }

export DEBIAN_FRONTEND=noninteractive
if ! command -v wine >/dev/null 2>&1; then
  dpkg --add-architecture i386 && apt-get update -qq && apt-get install -y -qq --no-install-recommends wine wine64 wine32:i386 python3 python3-lxml python3-cryptography xmlsec1 openssl unzip >/dev/null 2>&1
fi
W=/usr/lib/wine/wine
rm -rf ~/.wine; timeout 300 $W wineboot -i >/dev/null 2>&1; $W winecfg -v win10 >/dev/null 2>&1
# Wine 8 n'a pas bcryptprimitives.dll (ProcessPrng, utilisé par la bibliothèque standard de Rust) : remplaçant
# d'essai seulement, jamais livré (même procédé que les essais du Desktop).
x86_64-w64-mingw32-gcc -shared -O2 -o /tmp/bcryptprimitives.dll "$DEPOT/desktop/essais-wine/bcryptprimitives-wine.c" -ladvapi32 -Wl,--kill-at && cp /tmp/bcryptprimitives.dll ~/.wine/drive_c/windows/system32/
# Faux « Adobe Premiere Pro.exe » (ressource de version 26.5.2.13, rien d'Adobe) pour la détection.
(cd "$DEPOT/desktop/essais-wine/faux-premiere" && x86_64-w64-mingw32-windres version.rc -O coff -o /tmp/version.o && x86_64-w64-mingw32-gcc -O2 main.c /tmp/version.o -o /tmp/faux.exe)
P="$HOME/.wine/drive_c/Program Files/Adobe/Adobe Premiere Pro 2026"
mkdir -p "$P" && cp /tmp/faux.exe "$P/Adobe Premiere Pro.exe"

U=$(ls -d ~/.wine/drive_c/users/*/ | grep -v Public | head -1)
NOMU=$(basename "$U")
L="$U/AppData/Local"
R="$U/AppData/Roaming"
INST="$L/Programs/AETHRYON"
EXT="$R/Adobe/CEP/extensions/fr.aethryon.premiere"
NAV="$L/AETHRYON/extension"
ID_PROD=necpohicddjeaeaaomaakehcbccapabg
K='HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\AETHRYON'
reg_val() { $W reg query "$1" /v "$2" 2>/dev/null | tr -d '\r' | grep -i " $2 " | sed -E 's/.*REG_[A-Z]+ +//'; }
reg_existe() { $W reg query "$1" >/dev/null 2>&1; }
attendre_fichier() { for _ in $(seq 1 120); do [ -s "$1" ] && return 0; sleep 1; done; return 1; }
json() { python3 -I -c "import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2]))" "$@"; }
# Identifiant Chrome d'un manifest.json (SHA-256 de la clé publique, 32 premiers chiffres écrits a–p).
# Version de l'extension CEP installée (ExtensionBundleVersion de son manifeste).
version_cep() { grep -o 'ExtensionBundleVersion="[^"]*"' "$EXT/CSXS/manifest.xml" 2>/dev/null | head -1 | cut -d'"' -f2; }
id_nav() { python3 -I -c "import json,sys,base64,hashlib; k=json.load(open(sys.argv[1]))['key']; print(''.join(chr(97+int(c,16)) for c in hashlib.sha256(base64.b64decode(k)).hexdigest()[:32]))" "$1" 2>/dev/null; }
# Empreinte d'un arbre (chemins relatifs et SHA-256 de chaque fichier ; $2 : motif -path écarté) : « inchangé » avant / après.
empreinte_arbre() { [ -d "$1" ] || { echo absent; return; }; (cd "$1" && find . -type f -not -path "${2:-//}" -print0 | sort -z | xargs -0 -r sha256sum) | sha256sum | cut -c1-16; }
empreinte() { [ -f "$1" ] && sha256sum < "$1" | cut -c1-16 || echo absent; }
# INDEX_ESSAI : exemple index-essai du noyau (le VRAI moteur d'AETHRYON Index, compilé pour Windows, jamais livré).
IX=${INDEX_ESSAI:-}
index_essai() { timeout 180 $W "$IX" "$@" 2>/dev/null | tr -d '\r' | tail -1; }
# Médias réels du dépôt (3 sons, 2 images) et un son dans « exclu-essai » (exclusion de l'index).
# Hors des dossiers du shell (Documents, Vidéos…), que Wine relie à des dossiers Linux.
MED="$U/Rushes essai"; WMED="C:\\users\\$NOMU\\Rushes essai"
preparer_medias() {
  mkdir -p "$MED/exclu-essai" && cp "$DEPOT/desktop/noyau/essais-audio/"{nocturne.mp3,ivoire.flac,sans-etiquette.wav} "$MED/"
  cp "$DEPOT/brand/favicon/icon-192.png" "$MED/Affiche AETHRYON.png" && cp "$DEPOT/setup/src-tauri/icons/128x128.png" "$MED/Icône.png"
  cp "$DEPOT/desktop/noyau/essais-audio/obsidienne.opus" "$MED/exclu-essai/"
}
# Totaux d'une sortie d'index-essai, et comparaison de deux sorties (mêmes médias, mêmes réglages).
totaux_index() { printf '%s' "$1" | python3 -I -c 'import json,sys; d=json.loads(sys.stdin.read()); print(d["total"], d["audio"], d["image"], d["video"], d["fils"], "exclu-essai" in d["exclusions"], sorted(d["noms"]) == sorted(["Affiche AETHRYON.png", "Icône.png", "ivoire.flac", "nocturne.mp3", "sans-etiquette.wav"]))' 2>/dev/null; }
meme_index() { python3 -I -c 'import json,sys; a,b=(json.loads(x) for x in sys.argv[1:3]); k=["emplacement","total","audio","image","video","noms","fils","exclusions"]; print([x for x in k if a[x]!=b[x]] or "identique")' "$1" "$2" 2>/dev/null; }

echo "--- 1. Détection (amorce → interface extraite et vérifiée → --etat)"
timeout 180 $W "$S" --etat 'Z:\tmp\etat1.json'; echo "code $?"
if [ -s /tmp/etat1.json ]; then
  ok "amorce : charge ouverte, interface extraite (SHA-256 vérifiés) et lancée"
  [ "$(json /tmp/etat1.json 'd["mode"]')" = "installation" ] && ok "mode « installation » (aucune clé HKCU AETHRYON)" || ko "mode inattendu"
  [ "$(json /tmp/etat1.json 'd["detection"]["principale"]["version"], d["detection"]["principale"]["compatible"]')" = "('26.5.2.13', True)" ] && ok "Premiere 26.5.2.13 trouvé dans Program Files\\Adobe, version lue dans l'exe, compatible avec [25.0,99.9]" || ko "détection de Premiere : $(json /tmp/etat1.json 'd["detection"]["principale"]')"
  echo "      charge : extension $(json /tmp/etat1.json 'd["charge"]["versionExtension"]') (remplaçant : $(json /tmp/etat1.json 'd["charge"]["extensionRemplacant"]')), Desktop $(json /tmp/etat1.json 'd["charge"]["versionDesktop"]'), extension navigateur $(json /tmp/etat1.json 'd["charge"].get("versionNavigateur")'), signature $(json /tmp/etat1.json 'd["charge"]["signature"].get("algorithme")')"
  DESK=$(json /tmp/etat1.json 'd["charge"]["versionDesktop"]'); VNAV=$(json /tmp/etat1.json 'd["charge"].get("versionNavigateur")'); VCEP=$(json /tmp/etat1.json 'd["charge"]["versionExtension"]')
  [ "$(json /tmp/etat1.json 'd["demande"]')" = "normal" ] && ok "demande « normal » sans argument" || ko "demande : $(json /tmp/etat1.json 'd["demande"]')"
else
  ko "aucun état écrit"
fi
ls /tmp | grep -q '^AETHRYON-Setup-[0-9]' && ko "dossier temporaire de l'amorce non nettoyé" || ok "dossier temporaire de l'amorce nettoyé"

echo "--- 2. Installation silencieuse"
timeout 300 $W "$S" --silencieux --installer --rapport 'Z:\tmp\r-install.json'; CODE=$?
[ $CODE -eq 0 ] && ok "installation : code 0" || ko "installation : code $CODE ($(json /tmp/r-install.json 'd.get("erreur")' 2>/dev/null))"
for f in aethryon-desktop.exe WebView2Loader.dll AETHRYON-Setup.exe installation.json; do
  [ -f "$INST/$f" ] && ok "fichier : %LOCALAPPDATA%\\Programs\\AETHRYON\\$f" || ko "absent : $f"
done
cmp -s "$S" "$INST/AETHRYON-Setup.exe" && ok "copie de maintenance identique au setup lancé" || ko "copie de maintenance différente"
for f in mimetype META-INF/signatures.xml CSXS/manifest.xml; do
  [ -f "$EXT/$f" ] && ok "extension : %APPDATA%\\Adobe\\CEP\\extensions\\fr.aethryon.premiere\\$f" || ko "extension : $f absent"
done
[ -z "$(find "$EXT" -type l)" ] && ok "aucun lien symbolique dans l'extension installée" || ko "liens symboliques présents"
if python3 -I "$DEPOT/setup/signature-cep/zxp.py" verifier "$EXT" --exiger-horodatage > /tmp/verif.txt 2>&1; then
  ok "extension installée : SIGNATURE VALIDE (zxp.py : SignedInfo, Manifest, chaque fichier, aucun fichier en trop, horodatage)"
else
  ko "extension installée : $(cat /tmp/verif.txt)"
fi
rm -rf /tmp/x && cp -r "$EXT" /tmp/x && cp /tmp/x/META-INF/signatures.xml /tmp/x/_sig.xml
N=$(grep -o '<Reference URI="[^#]' /tmp/x/_sig.xml | wc -l)
(cd /tmp/x && xmlsec1 --verify --insecure --id-attr:Id 'http://www.w3.org/2000/09/xmldsig#:Manifest' --enabled-reference-uris same-doc,local,remote _sig.xml > /tmp/xmlsec.txt 2>&1)
grep -q "Manifests References (ok/all): $N/$N" /tmp/xmlsec.txt && grep -q 'SignedInfo References (ok/all): 1/1' /tmp/xmlsec.txt && ok "extension installée : xmlsec1 valide SignedInfo et $N/$N références" || ko "xmlsec1 : $(tail -3 /tmp/xmlsec.txt | tr '\n' ' ')"
for v in DisplayName DisplayVersion Publisher DisplayIcon InstallLocation UninstallString QuietUninstallString ModifyPath EstimatedSize NoModify NoRepair; do
  X=$(reg_val "$K" $v); [ -n "$X" ] && ok "HKCU Uninstall\\AETHRYON : $v = $X" || ko "valeur $v absente"
done
[ "$(reg_val "$K" Publisher)" = "AETHRYON" ] && ok "éditeur « AETHRYON »" || ko "éditeur inattendu"
RUN=$($W reg query 'HKCU\Software\Microsoft\Windows\CurrentVersion\Run' /v 'AETHRYON Desktop' 2>/dev/null | tr -d '\r' | grep -o '".*')
[ -n "$RUN" ] && ok "démarrage avec Windows : $RUN" || ko "valeur Run absente"
LNK=$(find "$R/Microsoft/Windows/Start Menu/Programs" -iname 'AETHRYON.lnk' 2>/dev/null | head -1)
[ -n "$LNK" ] && ok "raccourci du menu Démarrer : $(basename "$LNK") ($(stat -c %s "$LNK") octets, IShellLinkW de Wine)" || ko "raccourci absent"
[ -f "$R/AETHRYON/config.json" ] && ok "config.json : dossierMedias = $(json "$R/AETHRYON/config.json" 'd["dossierMedias"]')" || ko "config.json absent"
[ "$(json "$R/AETHRYON/desktop.json" 'd["assistantTermine"]' 2>/dev/null)" = "True" ] && ok "desktop.json : l'ancien assistant UXP du Desktop ne se relancera pas" || ko "desktop.json"
reg_existe 'HKCU\Software\Adobe' && ko "une clé HKCU\\Software\\Adobe existe (PlayerDebugMode ?)" || ok "PlayerDebugMode jamais écrit (aucune clé HKCU\\Software\\Adobe)"
J=$(ls "$L/AETHRYON/journaux/"setup-*.log 2>/dev/null | head -1)
[ -n "$J" ] && ok "journal : %LOCALAPPDATA%\\AETHRYON\\journaux\\$(basename "$J") ($(wc -l < "$J") lignes)" || ko "journal absent"
DIAG=$(timeout 120 $W "$INST/aethryon-desktop.exe" --diagnostic 2>/dev/null | tr -d '\r')
printf '%s' "$DIAG" | python3 -I -c 'import json,sys; d=json.load(sys.stdin); assert d["version"]==sys.argv[1], d["version"]' "${DESK:-?}" 2>/dev/null && ok "AETHRYON Desktop installé démarre sous Wine (--diagnostic, version ${DESK:-?})" || ko "Desktop installé : diagnostic illisible"
# Diagnostic du Desktop installé (ce que son assistant affiche) : le panneau CEP que CE setup vient de poser.
VCEP=$(grep -o 'ExtensionBundleVersion="[^"]*"' "$EXT/CSXS/manifest.xml" | head -1 | cut -d'"' -f2)
diag_cep() { printf '%s' "$1" | python3 -I -c 'import json,sys; c=json.load(sys.stdin).get("panneau") or {}; print(c.get("libelle"))' 2>&1; }
[ "$(diag_cep "$DIAG")" = "Panneau AETHRYON $VCEP installé" ] && ok "assistant du Desktop installé : « Panneau AETHRYON $VCEP installé » (dossier CEP posé par le setup)" || ko "diagnostic du panneau CEP : $(diag_cep "$DIAG")"
if [ "${VNAV:-None}" != "None" ]; then
  [ "$(json "$NAV/manifest.json" 'd["version"]' 2>/dev/null)" = "$VNAV" ] && ok "extension navigateur $VNAV dans le dossier géré %LOCALAPPDATA%\\AETHRYON\\extension" || ko "dossier géré : manifest.json absent ou autre version"
  [ "$(id_nav "$NAV/manifest.json")" = "$ID_PROD" ] && ok "dossier géré : identifiant de production $ID_PROD (clé du manifeste)" || ko "dossier géré : identifiant $(id_nav "$NAV/manifest.json")"
  [ -z "$(find "$NAV" -type l)" ] && [ -f "$NAV/popup/popup.html" ] && ok "dossier géré : $(find "$NAV" -type f | wc -l) fichiers, aucun lien symbolique" || ko "dossier géré : contenu inattendu"
  [ "$(json "$INST/installation.json" 'd.get("versionNavigateur")')" = "$VNAV" ] && ok "installation.json : versionNavigateur $VNAV" || ko "installation.json sans versionNavigateur"
  [ -z "$(ls "$L/AETHRYON" | grep -E '^extension-(preparation|retour-arriere|abandon)-')" ] && ok "aucun dossier de préparation de l'extension navigateur restant" || ko "restes : $(ls "$L/AETHRYON")"
else
  ko "charge sans extension navigateur"
fi

echo "--- 3. Maintenance : le setup détecte l'installation"
timeout 180 $W "$S" --etat 'Z:\tmp\etat2.json' >/dev/null 2>&1
[ "$(json /tmp/etat2.json 'd["mode"], d["actions"]')" = "('maintenance', ['reparer', 'desinstaller'])" ] && ok "mode « maintenance » : Réparer, Désinstaller (même version)" || ko "maintenance : $(json /tmp/etat2.json 'd["mode"], d["actions"]')"

echo "--- 4. Réparation, lancée depuis la copie de maintenance (relance depuis %TEMP%)"
rm -f "$INST/aethryon-desktop.exe"; echo "abîmé" >> "$EXT/CSXS/manifest.xml"; echo x > "$EXT/en-trop.js"
$W reg delete 'HKCU\Software\Microsoft\Windows\CurrentVersion\Run' /v 'AETHRYON Desktop' /f >/dev/null 2>&1
rm -f /tmp/r-reparer.json
timeout 120 $W "$INST/AETHRYON-Setup.exe" --silencieux --reparer --rapport 'Z:\tmp\r-reparer.json'; echo "code de la copie : $? (elle se relance depuis %TEMP% puis rend la main)"
if attendre_fichier /tmp/r-reparer.json; then
  sleep 3
  [ "$(json /tmp/r-reparer.json 'd["succes"]')" = "True" ] && ok "réparation réussie" || ko "réparation : $(json /tmp/r-reparer.json 'd["erreur"]')"
  [ -f "$INST/aethryon-desktop.exe" ] && ok "exe du Desktop remis en place" || ko "exe toujours absent"
  [ ! -e "$EXT/en-trop.js" ] && ! grep -q abîmé "$EXT/CSXS/manifest.xml" && ok "extension remise à l'identique (fichier abîmé réécrit, fichier en trop retiré)" || ko "extension non réparée"
  python3 -I "$DEPOT/setup/signature-cep/zxp.py" verifier "$EXT" --exiger-horodatage >/dev/null 2>&1 && ok "extension réparée : signature valide" || ko "extension réparée : signature invalide"
  $W reg query 'HKCU\Software\Microsoft\Windows\CurrentVersion\Run' /v 'AETHRYON Desktop' >/dev/null 2>&1 && ok "démarrage avec Windows rétabli" || ko "Run non rétabli"
else
  ko "aucun rapport de réparation"
fi

if [ -n "$S2" ]; then
  VM=${VERSION_MAJ:-2.0.0-beta.3}
  echo "--- 4 bis. Mise à jour par un setup plus récent (setup d'ESSAI $VM, même contenu, jamais livré)"
  timeout 180 $W "$S2" --etat 'Z:\tmp\etat-maj.json' >/dev/null 2>&1
  [ "$(json /tmp/etat-maj.json 'd["mode"], d["actions"]')" = "('maintenance', ['mettreAJour', 'desinstaller'])" ] && ok "le setup plus récent propose : Mettre à jour, Désinstaller" || ko "actions : $(json /tmp/etat-maj.json 'd["actions"]')"
  # Lancé par AETHRYON Desktop (« Mettre à jour ») : --mettre-a-jour SANS --silencieux ouvre l'interface (WebView2,
  # absente de Wine) sur la mise à jour. Ici : la même demande, lue par --etat.
  timeout 180 $W "$S2" --mettre-a-jour --etat 'Z:\tmp\etat-maj-directe.json' >/dev/null 2>&1
  [ "$(json /tmp/etat-maj-directe.json 'd["demande"], d["mode"], d["actions"][0]')" = "('mettreAJour', 'maintenance', 'mettreAJour')" ] && ok "--mettre-a-jour : demande « mettreAJour » en maintenance, « Mettre à jour » en tête (l'interface la lance dès l'ouverture)" || ko "--mettre-a-jour : $(json /tmp/etat-maj-directe.json 'd["demande"], d["mode"], d["actions"]')"
  timeout 180 $W "$S" --mettre-a-jour --etat 'Z:\tmp\etat-maj-meme.json' >/dev/null 2>&1
  [ "$(json /tmp/etat-maj-meme.json 'd["demande"], "mettreAJour" in d["actions"]')" = "('mettreAJour', False)" ] && ok "--mettre-a-jour avec un setup de la MÊME version : aucune mise à jour proposée (maintenance ordinaire)" || ko "même version : $(json /tmp/etat-maj-meme.json 'd["demande"], d["actions"]')"
  if [ -n "$IX" ] && [ -f "$IX" ]; then
    # Index créé par le VRAI moteur du Desktop installé (scan d'un dossier, réglages « fils » et exclusion changés).
    preparer_medias; IXA=$(index_essai scanner "$WMED")
    [ "$(totaux_index "$IXA")" = "5 3 2 0 3 True True" ] && ok "AETHRYON Index (moteur ${DESK:-?}) : 5 médias indexés (3 sons, 2 images, « exclu-essai » écarté), réglages changés (fils 3, exclusion)" || ko "index avant la mise à jour : $IXA"
    EIX=$(empreinte_arbre "$L/AETHRYON/index"); ERI=$(empreinte "$R/AETHRYON/index-medias.json")
  fi
  timeout 300 $W "$S2" --silencieux --mettre-a-jour --rapport 'Z:\tmp\r-maj.json'; CODE=$?
  [ $CODE -eq 0 ] && ok "mise à jour : code 0" || ko "mise à jour : code $CODE"
  [ "$(reg_val "$K" DisplayVersion)" = "$VM" ] && ok "DisplayVersion = $VM" || ko "DisplayVersion = $(reg_val "$K" DisplayVersion)"
  cmp -s "$S2" "$INST/AETHRYON-Setup.exe" && ok "copie de maintenance remplacée par le setup plus récent" || ko "copie de maintenance non remplacée"
  [ "$(json "$INST/installation.json" 'd["version"]')" = "$VM" ] && ok "installation.json : $VM (date d'installation d'origine gardée : $(json "$INST/installation.json" 'd["installeLe"]'))" || ko "inventaire non mis à jour"
  [ -z "$(ls -a "$INST" | grep '^\.retour')" ] && ok "aucune sauvegarde restante après la mise à jour" || ko "sauvegardes restantes"
  [ "$(json "$NAV/manifest.json" 'd["version"]' 2>/dev/null)" = "${VNAV:-}" ] && ok "dossier géré après la mise à jour : extension navigateur ${VNAV:-}" || ko "dossier géré après la mise à jour"
  [ -z "$(ls "$L/AETHRYON" | grep -E '^extension-(preparation|retour-arriere|abandon)-')" ] && ok "mise à jour : aucun dossier de travail de l'extension navigateur restant" || ko "restes : $(ls "$L/AETHRYON")"
  if [ -n "${EIX:-}" ]; then
    [ "$EIX" != absent ] && [ "$(empreinte_arbre "$L/AETHRYON/index")" = "$EIX" ] && [ "$(empreinte "$R/AETHRYON/index-medias.json")" = "$ERI" ] && ok "index SQLite (%LOCALAPPDATA%\\AETHRYON\\index : $(ls "$L/AETHRYON/index" | tr '\n' ' ')) et index-medias.json identiques octet pour octet après la mise à jour" || ko "index ou réglages de l'index changés par la mise à jour ($EIX → $(empreinte_arbre "$L/AETHRYON/index"))"
    [ "$(meme_index "$IXA" "$(index_essai lire)")" = identique ] && ok "le moteur rouvre l'index gardé : mêmes médias, mêmes réglages" || ko "index relu après la mise à jour : $(index_essai lire)"
  fi
  timeout 180 $W "$S" --etat 'Z:\tmp\etat-ancien.json' >/dev/null 2>&1
  [ "$(json /tmp/etat-ancien.json 'd["actions"]')" = "['desinstaller']" ] && ok "le setup plus ANCIEN ne propose plus que « Désinstaller »" || ko "setup ancien : $(json /tmp/etat-ancien.json 'd["actions"]')"
fi

echo "--- 5. Désinstallation par QuietUninstallString (médias gardés)"
mkdir -p "$U/Videos/AETHRYON" && echo "média" > "$U/Videos/AETHRYON/clip.mp4"
QUS=$(reg_val "$K" QuietUninstallString); echo "      QuietUninstallString = $QUS"
rm -f /tmp/r-des.json
timeout 120 $W "$INST/AETHRYON-Setup.exe" --desinstaller --silencieux --rapport 'Z:\tmp\r-des.json'
if attendre_fichier /tmp/r-des.json; then
  sleep 6
  [ "$(json /tmp/r-des.json 'd["succes"]')" = "True" ] && ok "désinstallation réussie" || ko "désinstallation : $(json /tmp/r-des.json 'd["erreur"]')"
  [ ! -e "$INST" ] && ok "dossier d'installation retiré (copie de maintenance comprise)" || ko "reste : $(ls "$INST" 2>/dev/null | tr '\n' ' ')"
  [ ! -e "$EXT" ] && ok "extension retirée" || ko "extension toujours là"
  reg_existe "$K" && ko "clé Uninstall\\AETHRYON toujours là" || ok "clé Uninstall\\AETHRYON retirée"
  $W reg query 'HKCU\Software\Microsoft\Windows\CurrentVersion\Run' /v 'AETHRYON Desktop' >/dev/null 2>&1 && ko "valeur Run toujours là" || ok "démarrage avec Windows retiré"
  [ -z "$(find "$R/Microsoft/Windows/Start Menu/Programs" -iname 'AETHRYON.lnk' 2>/dev/null)" ] && ok "raccourci retiré" || ko "raccourci toujours là"
  [ ! -e "$R/AETHRYON" ] && ok "préférences retirées" || ko "préférences toujours là"
  [ -f "$U/Videos/AETHRYON/clip.mp4" ] && ok "médias gardés (Vidéos\\AETHRYON\\clip.mp4)" || ko "médias supprimés alors qu'ils devaient rester"
  [ -n "$(ls "$L/AETHRYON/journaux/" 2>/dev/null)" ] && ok "journal gardé" || ko "journal disparu"
  [ -f "$NAV/manifest.json" ] && ok "extension navigateur GARDÉE dans le dossier géré (pas de --supprimer-extension-navigateur)" || ko "dossier géré retiré sans qu'on le demande"
  [ ! -e "$L/AETHRYON/bibliotheque" ] && [ ! -e "$L/AETHRYON/etat" ] && [ ! -e "$L/AETHRYON/index" ] && ok "bibliothèque, échanges et index retirés malgré tout" || ko "restes : $(ls "$L/AETHRYON")"
  timeout 180 $W "$S" --etat 'Z:\tmp\etat3.json' >/dev/null 2>&1
  [ "$(json /tmp/etat3.json 'd["mode"]')" = "installation" ] && ok "après désinstallation, le setup repart en mode « installation »" || ko "mode après désinstallation"
else
  ko "aucun rapport de désinstallation"
fi
sleep 4
REST=$(find ~/.wine/drive_c/users/"$NOMU"/AppData/Local/Temp /tmp -maxdepth 1 -name 'AETHRYON-Setup-relance-*' 2>/dev/null | wc -l)
[ "$REST" -eq 0 ] && ok "copies relancées dans %TEMP% effacées" || echo "NOTE  $REST copie(s) relancée(s) encore dans %TEMP% (effacement différé par cmd/ping de Wine)"

echo "--- 5 bis. Réinstallation, puis désinstallation AVEC --supprimer-extension-navigateur"
timeout 300 $W "$S" --silencieux --installer --rapport 'Z:\tmp\r-install2.json'; CODE=$?
[ $CODE -eq 0 ] && [ -f "$NAV/manifest.json" ] && ok "réinstallation : code 0, dossier géré en place (version $(json "$NAV/manifest.json" 'd["version"]'))" || ko "réinstallation : code $CODE"
rm -f /tmp/r-des3.json
timeout 120 $W "$INST/AETHRYON-Setup.exe" --desinstaller --silencieux --supprimer-extension-navigateur --rapport 'Z:\tmp\r-des3.json'
if attendre_fichier /tmp/r-des3.json; then
  sleep 6
  [ "$(json /tmp/r-des3.json 'd["succes"]')" = "True" ] && ok "désinstallation avec retrait de l'extension navigateur réussie" || ko "désinstallation : $(json /tmp/r-des3.json 'd["erreur"]')"
  [ ! -e "$NAV" ] && [ ! -e "$L/AETHRYON/extension-precedente" ] && ok "dossier géré retiré, à la demande (et la version précédente)" || ko "dossier géré toujours là"
  json /tmp/r-des3.json '[s["detail"] for e in d["etapes"] for s in e["sous"] if s["libelle"].startswith("Extension navigateur")][0]' > /tmp/nav-detail.txt 2>/dev/null && ok "rapport : « $(cat /tmp/nav-detail.txt) »" || ko "rapport sans sous-étape « Extension navigateur »"
else
  ko "aucun rapport de désinstallation (5 bis)"
fi
sleep 4

echo "--- 6. Panne réelle pendant l'installation : retour arrière"
# Un FICHIER nommé AETHRYON à la place du dossier des préférences : l'étape « Configuration » échoue après la copie
# et l'enregistrement. Tout ce qui a été posé doit disparaître.
rm -rf "$R/AETHRYON" && echo "bloque" > "$R/AETHRYON"
timeout 300 $W "$S" --silencieux --installer --rapport 'Z:\tmp\r-panne.json'; CODE=$?
[ $CODE -eq 1 ] && ok "installation refusée : code 1 ($(json /tmp/r-panne.json 'd["erreur"]'))" || ko "code $CODE"
[ "$(json /tmp/r-panne.json '[e["etat"] for e in d["etapes"]]')" = "['termine', 'termine', 'termine', 'echec', 'attente']" ] && ok "étapes : vérification, copie, enregistrement faites ; configuration en échec" || ko "étapes : $(json /tmp/r-panne.json '[e["etat"] for e in d["etapes"]]')"
echo "      retour arrière : $(json /tmp/r-panne.json 'len(d["retourArriere"])') opération(s), échecs : $(json /tmp/r-panne.json 'len([x for x in d["retourArriere"] if x.startswith("ÉCHEC")])')"
[ ! -e "$INST" ] && ok "dossier d'installation retiré" || ko "reste : $(ls -a "$INST" | tr '\n' ' ')"
[ ! -e "$EXT" ] && ok "extension retirée" || ko "extension restée"
[ -z "$(ls "$R/Adobe/CEP" 2>/dev/null | grep -v '^extensions$')" ] && ok "aucun dossier de préparation ni de sauvegarde sous %APPDATA%\\Adobe\\CEP" || ko "restes : $(ls "$R/Adobe/CEP")"
reg_existe "$K" && ko "clé Uninstall\\AETHRYON restée" || ok "clé Uninstall\\AETHRYON retirée"
$W reg query 'HKCU\Software\Microsoft\Windows\CurrentVersion\Run' /v 'AETHRYON Desktop' >/dev/null 2>&1 && ko "valeur Run restée" || ok "valeur Run retirée"
[ -z "$(find "$R/Microsoft/Windows/Start Menu/Programs" -iname 'AETHRYON.lnk' 2>/dev/null)" ] && ok "raccourci retiré" || ko "raccourci resté"
[ "$(cat "$R/AETHRYON")" = "bloque" ] && ok "le fichier qui bloquait est intact" || ko "fichier modifié"
[ ! -e "$NAV" ] && [ -z "$(ls "$L/AETHRYON" 2>/dev/null | grep -E '^extension')" ] && ok "extension navigateur retirée par le retour arrière (aucun dossier extension*)" || ko "restes de l'extension navigateur : $(ls "$L/AETHRYON" 2>/dev/null | tr '\n' ' ')"
rm -f "$R/AETHRYON"

if [ -n "${BETA_NSIS:-}" ] && [ -f "$BETA_NSIS" ]; then
  echo "--- 7. Remplacement de la bêta 1.0.0-beta.2 : son VRAI installateur NSIS (/S), puis ce setup"
  KB='HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\AETHRYON-Desktop'
  timeout 300 $W "$BETA_NSIS" /S; echo "      installateur NSIS de la bêta 2 : code $?"
  for _ in $(seq 1 30); do reg_existe "$KB" && [ -f "$INST/desinstaller.exe" ] && break; sleep 1; done
  [ "$(reg_val "$KB" DisplayVersion)" = "1.0.0-beta.2" ] && ok "bêta 2 installée par son installateur NSIS : Uninstall\AETHRYON-Desktop, DisplayVersion 1.0.0-beta.2" || ko "bêta 2 non installée : $(reg_val "$KB" DisplayVersion)"
  [ -f "$INST/desinstaller.exe" ] && [ -d "$INST/panneau" ] && [ -d "$INST/licences" ] && ok "bêta 2 : desinstaller.exe, panneau\ (.ccx UXP) et licences\ dans %LOCALAPPDATA%\Programs\AETHRYON" || ko "bêta 2 : fichiers attendus absents ($(ls "$INST" 2>/dev/null | tr '\n' ' '))"
  timeout 180 $W "$S" --etat 'Z:\tmp\etat-beta.json' >/dev/null 2>&1
  [ "$(json /tmp/etat-beta.json 'd["mode"], d["detection"]["ancienneBeta"]')" = "('installation', '1.0.0-beta.2')" ] && ok "détection : mode « installation », ancienne bêta 1.0.0-beta.2 repérée (« À remplacer »)" || ko "détection : $(json /tmp/etat-beta.json 'd["mode"], d["detection"].get("ancienneBeta")')"
  timeout 300 $W "$S" --silencieux --installer --rapport 'Z:\tmp\r-beta.json'; CODE=$?
  [ $CODE -eq 0 ] && ok "installation par-dessus la bêta 2 : code 0" || ko "installation par-dessus la bêta 2 : code $CODE ($(json /tmp/r-beta.json 'd.get("erreur")' 2>/dev/null))"
  reg_existe "$KB" && ko "Uninstall\AETHRYON-Desktop toujours là" || ok "entrée de la bêta 2 (Uninstall\AETHRYON-Desktop) retirée"
  [ "$(reg_val "$K" DisplayVersion)" = "$(json /tmp/etat-beta.json 'd["charge"]["version"]')" ] && ok "entrée du setup : Uninstall\AETHRYON, DisplayVersion $(reg_val "$K" DisplayVersion)" || ko "entrée du setup absente"
  [ ! -e "$INST/desinstaller.exe" ] && [ ! -e "$INST/panneau" ] && [ ! -e "$INST/licences" ] && ok "fichiers propres à la bêta 2 retirés (desinstaller.exe, panneau\, licences\)" || ko "restes de la bêta 2 : $(ls "$INST" | tr '\n' ' ')"
  DIAG=$(timeout 120 $W "$INST/aethryon-desktop.exe" --diagnostic 2>/dev/null | tr -d '\r')
  printf '%s' "$DIAG" | python3 -I -c 'import json,sys; d=json.load(sys.stdin); assert d["version"]==sys.argv[1], d["version"]' "${DESK:-?}" 2>/dev/null && ok "AETHRYON Desktop de la bêta 2 remplacé par ${DESK:-?} (--diagnostic)" || ko "Desktop après remplacement : diagnostic illisible"
  [ "$(json /tmp/r-beta.json 'd["resultat"]["ancienneBetaRemplacee"]')" = "1.0.0-beta.2" ] && ok "rapport : ancienneBetaRemplacee = 1.0.0-beta.2" || ko "rapport : $(json /tmp/r-beta.json 'd["resultat"].get("ancienneBetaRemplacee")')"
  json /tmp/r-beta.json '[a for a in d["resultat"]["avertissements"] if "plugin UXP" in a and "Creative Cloud" in a][0]' >/tmp/conseil.txt 2>/dev/null && ok "conseil affiché : $(cat /tmp/conseil.txt)" || ko "aucun conseil sur l'ancien plugin UXP"
  python3 -I "$DEPOT/setup/signature-cep/zxp.py" verifier "$EXT" --exiger-horodatage >/dev/null 2>&1 && ok "extension CEP installée par-dessus la bêta 2 : signature valide" || ko "extension : signature invalide"
  rm -f /tmp/r-des2.json
  timeout 120 $W "$INST/AETHRYON-Setup.exe" --desinstaller --silencieux --rapport 'Z:\tmp\r-des2.json'
  if attendre_fichier /tmp/r-des2.json; then
    sleep 6
    [ ! -e "$INST" ] && ok "désinstallation ensuite : dossier d'installation entièrement retiré (rien de la bêta 2 ne reste)" || ko "reste : $(ls -a "$INST" 2>/dev/null | tr '\n' ' ')"
    reg_existe "$KB" || reg_existe "$K" && ko "clés restantes" || ok "aucune clé Uninstall AETHRYON ni AETHRYON-Desktop"
  else
    ko "aucun rapport de désinstallation après le remplacement"
  fi
else
  echo "NOTE  section 7 non lancée : BETA_NSIS absent (installateur NSIS de la bêta 2)"
fi

if [ -n "${SETUP_PRECEDENT:-}" ] && [ -f "$SETUP_PRECEDENT" ]; then
  echo "--- 8. Mise à jour depuis le setup PUBLIÉ précédent ($(basename "$SETUP_PRECEDENT")) par --mettre-a-jour"
  rm -rf "$L/AETHRYON"/extension*
  timeout 180 $W "$SETUP_PRECEDENT" --etat 'Z:\tmp\etat-prec.json' >/dev/null 2>&1
  VP=$(json /tmp/etat-prec.json 'd["charge"]["version"]'); DP=$(json /tmp/etat-prec.json 'd["charge"]["versionDesktop"]'); NP=$(json /tmp/etat-prec.json 'd["charge"].get("versionNavigateur")'); CP=$(json /tmp/etat-prec.json 'd["charge"]["versionExtension"]')
  timeout 300 $W "$SETUP_PRECEDENT" --silencieux --installer --rapport 'Z:\tmp\r-prec.json'; CODE=$?
  [ $CODE -eq 0 ] && [ "$(reg_val "$K" DisplayVersion)" = "$VP" ] && ok "setup précédent installé : code 0, DisplayVersion $VP" || ko "setup précédent : code $CODE, DisplayVersion $(reg_val "$K" DisplayVersion)"
  DIAG=$(timeout 120 $W "$INST/aethryon-desktop.exe" --diagnostic 2>/dev/null | tr -d '\r')
  printf '%s' "$DIAG" | python3 -I -c 'import json,sys; d=json.load(sys.stdin); assert d["version"]==sys.argv[1], d["version"]' "$DP" 2>/dev/null && ok "AETHRYON Desktop $DP en place (--diagnostic)" || ko "Desktop précédent : diagnostic illisible"
  [ "$(json "$NAV/manifest.json" 'd["version"]' 2>/dev/null)" = "$NP" ] && ok "dossier géré : extension navigateur $NP" || ko "dossier géré avant la mise à jour : $(json "$NAV/manifest.json" 'd["version"]' 2>/dev/null)"
  [ "$(version_cep)" = "$CP" ] && ok "extension CEP $CP en place (manifeste installé)" || ko "extension CEP avant la mise à jour : $(version_cep)"
  # Réglages changés dans AETHRYON Desktop $DP (Paramètres), écrits comme il les écrit : config.json et desktop.json,
  # valeur Run retirée avec « Démarrer avec Windows » coupé. Puis un index déjà là (moteur de ce setup), et les
  # empreintes de ce que la mise à jour ne doit pas changer.
  WAUTRE="C:\\users\\$NOMU\\Montage\\Médias AETHRYON"; mkdir -p "$U/Montage/Médias AETHRYON"
  python3 -I - "$R/AETHRYON/config.json" "$R/AETHRYON/desktop.json" "$WAUTRE" <<'PY'
import json, sys
c, p, autre = sys.argv[1:4]
d = json.load(open(c, encoding="utf-8"))
d.update({"dossierMedias": autre, "dossiersSurveilles": [autre, "C:\\users\\Public\\Rushes"], "surveillance": False, "demarrageAuto": False,
          "notifications": {"mediaPret": False, "importReussi": True, "erreurs": True}, "theme": "clair", "reduireAnimations": "oui", "chutierParDefaut": "selection"})
json.dump(d, open(c, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
q = json.load(open(p, encoding="utf-8")); q["premiereExeManuel"] = "E:\\Adobe\\Adobe Premiere Pro.exe"
json.dump(q, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY
  $W reg delete 'HKCU\Software\Microsoft\Windows\CurrentVersion\Run' /v 'AETHRYON Desktop' /f >/dev/null 2>&1
  EIX=""
  if [ -n "$IX" ] && [ -f "$IX" ]; then
    rm -rf "$L/AETHRYON/index" "$R/AETHRYON/index-medias.json"; preparer_medias; IXA=$(index_essai scanner "$WMED")
    [ "$(totaux_index "$IXA")" = "5 3 2 0 3 True True" ] && ok "index déjà là avant la mise à jour : 5 médias, réglages de l'index changés" || ko "index avant la mise à jour : $IXA"
    EIX=$(empreinte_arbre "$L/AETHRYON/index"); ERI=$(empreinte "$R/AETHRYON/index-medias.json")
  fi
  ENAV=$(empreinte_arbre "$NAV"); NNAV=$(find "$NAV" -type f | wc -l); ECEP=$(empreinte_arbre "$EXT" './META-INF/*')
  timeout 180 $W "$S" --etat 'Z:\tmp\etat-p1.json' >/dev/null 2>&1
  [ "$(json /tmp/etat-p1.json 'd["mode"], d["actions"]')" = "('maintenance', ['mettreAJour', 'desinstaller'])" ] && ok "ce setup, sur l'installation $VP : Mettre à jour, Désinstaller" || ko "actions : $(json /tmp/etat-p1.json 'd["mode"], d["actions"]')"
  timeout 180 $W "$S" --mettre-a-jour --etat 'Z:\tmp\etat-p2.json' >/dev/null 2>&1
  [ "$(json /tmp/etat-p2.json 'd["demande"], d["mode"], d["actions"][0]')" = "('mettreAJour', 'maintenance', 'mettreAJour')" ] && ok "--mettre-a-jour (comme lancé par Desktop $DP) : demande « mettreAJour », « Mettre à jour » en tête" || ko "--mettre-a-jour : $(json /tmp/etat-p2.json 'd["demande"], d["mode"], d["actions"]')"
  timeout 300 $W "$S" --silencieux --mettre-a-jour --rapport 'Z:\tmp\r-p3.json'; CODE=$?
  [ $CODE -eq 0 ] && ok "mise à jour $VP → ${VERSION:-?} : code 0" || ko "mise à jour : code $CODE ($(json /tmp/r-p3.json 'd.get("erreur")' 2>/dev/null))"
  [ "$(reg_val "$K" DisplayVersion)" = "${VERSION:-?}" ] && ok "DisplayVersion = ${VERSION:-?}" || ko "DisplayVersion = $(reg_val "$K" DisplayVersion)"
  cmp -s "$S" "$INST/AETHRYON-Setup.exe" && ok "copie de maintenance = ce setup" || ko "copie de maintenance non remplacée"
  DIAG=$(timeout 120 $W "$INST/aethryon-desktop.exe" --diagnostic 2>/dev/null | tr -d '\r')
  printf '%s' "$DIAG" | python3 -I -c 'import json,sys; d=json.load(sys.stdin); assert d["version"]==sys.argv[1], d["version"]' "${DESK:-?}" 2>/dev/null && ok "AETHRYON Desktop $DP remplacé par ${DESK:-?} (--diagnostic)" || ko "Desktop après la mise à jour : $(printf '%s' "$DIAG" | head -c 120)"
  [ "$(diag_cep "$DIAG")" = "Panneau AETHRYON $VCEP installé" ] && ok "après la mise à jour depuis $VP : « Panneau AETHRYON $VCEP installé »" || ko "diagnostic du panneau CEP après la mise à jour : $(diag_cep "$DIAG")"
  [ "$(json "$NAV/manifest.json" 'd["version"]' 2>/dev/null)" = "${VNAV:-}" ] && [ "$(id_nav "$NAV/manifest.json")" = "$ID_PROD" ] && ok "dossier géré : extension navigateur ${VNAV:-}, identifiant de production $ID_PROD" || ko "dossier géré après la mise à jour : $(json "$NAV/manifest.json" 'd["version"]' 2>/dev/null)"
  [ "$(json "$L/AETHRYON/extension-precedente/manifest.json" 'd["version"]' 2>/dev/null)" = "$NP" ] && ok "version remplacée gardée : extension-precedente = $NP" || ko "extension-precedente : $(ls "$L/AETHRYON" | tr '\n' ' ')"
  [ -z "$(find "$NAV" -type l)" ] && ok "dossier géré : $(find "$NAV" -type f | wc -l) fichiers, aucun lien symbolique" || ko "liens symboliques dans le dossier géré"
  [ "$(json "$INST/installation.json" 'd["version"], d.get("versionNavigateur")')" = "('${VERSION:-?}', '${VNAV:-}')" ] && ok "installation.json : ${VERSION:-?}, extension navigateur ${VNAV:-}" || ko "installation.json : $(json "$INST/installation.json" 'd["version"], d.get("versionNavigateur")')"
  [ -z "$(ls -a "$INST" | grep '^\.retour')" ] && [ -z "$(ls "$L/AETHRYON" | grep -E '^extension-(preparation|retour-arriere|abandon)-')" ] && ok "aucune sauvegarde ni dossier de travail restant" || ko "restes : $(ls -a "$INST" "$L/AETHRYON" | tr '\n' ' ')"
  python3 -I "$DEPOT/setup/signature-cep/zxp.py" verifier "$EXT" --exiger-horodatage >/dev/null 2>&1 && ok "extension CEP après la mise à jour : signature valide" || ko "extension CEP : signature invalide"
  [ "$(version_cep)" = "${VCEP:-}" ] && ok "extension CEP $CP remplacée par ${VCEP:-?} (manifeste installé)" || ko "extension CEP après la mise à jour : $(version_cep)"
  python3 -I - "$R/AETHRYON/config.json" "$R/AETHRYON/desktop.json" "$WAUTRE" > /tmp/reglages.txt 2>&1 <<'PY'
import json, sys
c = json.load(open(sys.argv[1], encoding="utf-8")); p = json.load(open(sys.argv[2], encoding="utf-8")); autre = sys.argv[3]
attendu = {"dossierMedias": autre, "dossiersSurveilles": [autre, "C:\\users\\Public\\Rushes"], "surveillance": False, "demarrageAuto": False,
           "notifications": {"mediaPret": False, "importReussi": True, "erreurs": True}, "theme": "clair", "reduireAnimations": "oui", "chutierParDefaut": "selection"}
ecarts = ["%s=%r" % (k, c.get(k)) for k, v in attendu.items() if c.get(k) != v]
if p.get("premiereExeManuel") != "E:\\Adobe\\Adobe Premiere Pro.exe" or p.get("assistantTermine") is not True:
    ecarts.append("desktop.json")
print(ecarts or "gardés")
PY
  [ "$(cat /tmp/reglages.txt)" = gardés ] && ok "réglages changés dans le Desktop $DP gardés (config.json : dossier des médias, dossiers surveillés, surveillance et démarrage coupés, notifications à la carte, thème, animations, chutier ; desktop.json : chemin de Premiere)" || ko "réglages perdus par la mise à jour : $(cat /tmp/reglages.txt)"
  $W reg query 'HKCU\Software\Microsoft\Windows\CurrentVersion\Run' /v 'AETHRYON Desktop' >/dev/null 2>&1 && ko "démarrage avec Windows rétabli par la mise à jour alors qu'il était coupé" || ok "démarrage avec Windows resté coupé (aucune valeur Run)"
  [ "$(json "$INST/installation.json" 'd["options"]["dossierMedias"]')" = "$WAUTRE" ] && ok "installation.json : dossier des médias $WAUTRE" || ko "installation.json : $(json "$INST/installation.json" 'd["options"]')"
  if [ -n "$EIX" ]; then
    [ "$EIX" != absent ] && [ "$(empreinte_arbre "$L/AETHRYON/index")" = "$EIX" ] && [ "$(empreinte "$R/AETHRYON/index-medias.json")" = "$ERI" ] && ok "index SQLite et index-medias.json identiques octet pour octet après la mise à jour $VP → ${VERSION:-?}" || ko "index ou réglages de l'index changés par la mise à jour"
    [ "$(meme_index "$IXA" "$(index_essai lire)")" = identique ] && ok "AETHRYON Desktop ${DESK:-?} (moteur) rouvre l'index gardé : mêmes médias, mêmes réglages" || ko "index relu après la mise à jour : $(index_essai lire)"
  fi
  [ "$ENAV" != absent ] && [ "$(empreinte_arbre "$NAV")" = "$ENAV" ] && ok "dossier géré inchangé : extension navigateur ${VNAV:-?}, mêmes $NNAV fichiers octet pour octet" || ko "dossier géré modifié par la mise à jour ($ENAV → $(empreinte_arbre "$NAV"))"
  [ "$ECEP" != absent ] && [ "$(empreinte_arbre "$EXT" './META-INF/*')" = "$ECEP" ] && ok "extension CEP ${VCEP:-?} : mêmes fichiers que celle du setup $VP (signature refaite seulement)" || ko "extension CEP : fichiers différents de ceux du setup $VP"
  timeout 180 $W "$SETUP_PRECEDENT" --etat 'Z:\tmp\etat-p4.json' >/dev/null 2>&1
  [ "$(json /tmp/etat-p4.json 'd["actions"]')" = "['desinstaller']" ] && ok "le setup $VP ne propose plus que « Désinstaller » (jamais de retour en arrière)" || ko "setup précédent : $(json /tmp/etat-p4.json 'd["actions"]')"
  rm -f /tmp/r-p5.json
  timeout 120 $W "$INST/AETHRYON-Setup.exe" --desinstaller --silencieux --supprimer-extension-navigateur --rapport 'Z:\tmp\r-p5.json'
  if attendre_fichier /tmp/r-p5.json; then
    sleep 6
    [ ! -e "$INST" ] && ! reg_existe "$K" && [ -z "$(ls "$L/AETHRYON" 2>/dev/null | grep -E '^extension')" ] && ok "désinstallation finale : installation, clé et dossiers extension* retirés" || ko "restes après désinstallation : $(ls -a "$INST" "$L/AETHRYON" 2>/dev/null | tr '\n' ' ')"
  else
    ko "aucun rapport de désinstallation (section 8)"
  fi
else
  echo "NOTE  section 8 non lancée : SETUP_PRECEDENT absent (setup publié précédent)"
fi

echo
if [ $ECHECS -eq 0 ]; then echo "ESSAIS SOUS WINE : TOUS RÉUSSIS"; else echo "ESSAIS SOUS WINE : $ECHECS ÉCHEC(S)"; fi
exit $ECHECS

#!/bin/bash
# Essai de l'installateur NSIS et du mode --desinstaller de l'exe WINDOWS, SOUS WINE 8 (pas Windows) :
# installation silencieuse (/S), clés HKCU, puis composants posés comme le ferait l'assistant (Native Messaging,
# démarrage automatique, dossier de médias), puis désinstallation silencieuse. Vérifie fichiers et registre.
set -u
export WINEDEBUG=-all
W=/usr/lib/wine/wine
S=${1:-$(ls /sortie/AETHRYON-Desktop-Setup-*.exe | head -1)}
U=$(ls -d ~/.wine/drive_c/users/*/ | grep -v Public | head -1)
L="$U/AppData/Local"
ok() { echo "OK   $*"; }
ko() { echo "ÉCHEC $*"; ECHECS=$((ECHECS+1)); }
ECHECS=0
reg_existe() { $W reg query "$1" ${2:+/v "$2"} >/dev/null 2>&1; }

timeout 300 $W "$S" /S; echo "installateur : code $?"
sleep 2
[ -f "$L/Programs/AETHRYON/aethryon-desktop.exe" ] && ok "exe installé dans %LOCALAPPDATA%\\Programs\\AETHRYON" || ko "exe absent"
[ -f "$L/Programs/AETHRYON/panneau/aethryon-premiere.ccx" ] && ok "panneau .ccx installé" || ko "ccx absent"
[ -f "$L/Programs/AETHRYON/desinstaller.exe" ] && ok "désinstalleur écrit" || ko "désinstalleur absent"
K='HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\AETHRYON-Desktop'
for v in DisplayName DisplayVersion UninstallString ModifyPath QuietUninstallString InstallLocation EstimatedSize; do
  reg_existe "$K" $v && ok "clé de désinstallation : $v = $($W reg query "$K" /v $v 2>/dev/null | grep -i "$v" | sed -E 's/.*REG_[A-Z]+ +//' | tr -d '\r')" || ko "valeur $v absente"
done

# Depuis la v2, l'exe ne cherche plus le .ccx posé à côté de lui (ancien installateur NSIS) : le panneau est l'extension
# CEP d'AETHRYON Setup. Ici, aucune extension CEP : le diagnostic de l'exe INSTALLÉ dit « absent », sans panneauEmbarque.
CCX="$L/Programs/AETHRYON/panneau/aethryon-premiere.ccx"
DIAG=$(timeout 120 $W "$L/Programs/AETHRYON/aethryon-desktop.exe" --diagnostic 2>/dev/null | tr -d '\r')
VERDICT=$(printf '%s' "$DIAG" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("panneau"), "panneauEmbarque" in d)' 2>&1)
[ "$VERDICT" = "None False" ] && ok "diagnostic de l'exe installé : panneau CEP absent, aucun .ccx cherché" || ko "diagnostic du panneau : $VERDICT"
MANIF=$(unzip -p "$CCX" manifest.json)
printf '%s' "$MANIF" | grep -q '"id": "fr.aethryon.premiere"' && printf '%s' "$MANIF" | grep -q '"version": "0.9.2"' && ok "manifeste du .ccx installé : fr.aethryon.premiere 0.9.2 (identifiant attendu par UPIA /list et /remove)" || ko "manifeste du .ccx inattendu"

# Ce que l'assistant aurait posé (essai indépendant de WebView2) : clés NM, démarrage, données et un média.
EXE='C:\users\'"$(basename "$U")"'\AppData\Local\Programs\AETHRYON\aethryon-desktop.exe'
for c in 'Software\Google\Chrome\NativeMessagingHosts\fr.aethryon.desktop' 'Software\Microsoft\Edge\NativeMessagingHosts\fr.aethryon.desktop' 'Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\fr.aethryon.desktop'; do
  $W reg add "HKCU\\$c" /ve /d 'C:\x\fr.aethryon.desktop.json' /f >/dev/null 2>&1
done
$W reg add 'HKCU\Software\Microsoft\Windows\CurrentVersion\Run' /v 'AETHRYON Desktop' /d "\"$EXE\" --arriere-plan" /f >/dev/null 2>&1
mkdir -p "$L/AETHRYON/etat" "$U/Downloads/AETHRYON"
echo '{}' > "$L/AETHRYON/etat/desktop.json"
echo 'video' > "$U/Downloads/AETHRYON/Coucher de soleil.mp4"

# Désinstallation silencieuse (/S : « Garder vos médias ? » répond Oui par défaut).
timeout 300 $W "$L/Programs/AETHRYON/desinstaller.exe" /S; echo "désinstalleur : code $?"
sleep 4
[ ! -e "$L/Programs/AETHRYON/aethryon-desktop.exe" ] && ok "exe retiré" || ko "exe encore présent"
[ ! -e "$L/AETHRYON" ] && ok "données %LOCALAPPDATA%\\AETHRYON retirées" || ko "données encore présentes : $(ls -R "$L/AETHRYON" | head -5 | tr '\n' ' ')"
[ -f "$U/Downloads/AETHRYON/Coucher de soleil.mp4" ] && ok "média gardé (choix par défaut)" || ko "média supprimé"
reg_existe "$K" && ko "clé de désinstallation restante" || ok "clé de désinstallation retirée"
reg_existe 'HKCU\Software\Google\Chrome\NativeMessagingHosts\fr.aethryon.desktop' && ko "clé NM Chrome restante" || ok "clés Native Messaging retirées"
reg_existe 'HKCU\Software\Microsoft\Windows\CurrentVersion\Run' 'AETHRYON Desktop' && ko "démarrage automatique restant" || ok "démarrage automatique retiré"
B=$(ls "$U/AppData/Local/Temp/AETHRYON-desinstallation.txt" "$U/Temp/AETHRYON-desinstallation.txt" 2>/dev/null | head -1)
[ -n "$B" ] && { ok "bilan écrit par --desinstaller :"; sed 's/^/       /' "$B"; } || ko "bilan --desinstaller introuvable"
echo "ÉCHECS : $ECHECS"
exit $ECHECS

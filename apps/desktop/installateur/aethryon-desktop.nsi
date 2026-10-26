; AETHRYON Desktop — installateur Windows par utilisateur (NSIS maison, sans nsis_tauri_utils.dll ni téléchargement).
; Construit sous Linux (makensis de Debian) par installateur/empaqueter.sh. NON TESTÉ SOUS WINDOWS.
;
; Rôle volontairement sobre (audit §6.4) : une page de marque, la copie des fichiers, puis il lance
; « aethryon-desktop.exe --assistant », qui déroule le vrai parcours premium (détection, configuration, installation du
; panneau par Creative Cloud, enregistrement, validation) avec ses opérations réelles.
;  - Aucun droit d'administrateur : %LOCALAPPDATA%\Programs\AETHRYON, clés HKCU seulement.
;  - « Applications installées » : Modifier → « aethryon-desktop.exe --reparer » ; Désinstaller → ce désinstalleur, qui
;    appelle « aethryon-desktop.exe --desinstaller » (panneau retiré par UPIA, clés Native Messaging et démarrage
;    automatique retirés) et demande si l'on garde ses médias (oui par défaut).
;  - Signature : crochet !finalize sans effet tant qu'aucun certificat n'existe (voir installateur/signer.sh).

Unicode true
ManifestDPIAware true
RequestExecutionLevel user
SetCompressor /SOLID lzma
; Pas de date enregistrée dans l'archive : deux constructions des mêmes fichiers donnent le même installateur.
SetDateSave off

!ifndef VERSION
  !define VERSION "1.0.0-beta.4"
!endif
!ifndef VERSION_WINDOWS
  !define VERSION_WINDOWS "0.9.2.0"
!endif
!ifndef ETAGE
  !define ETAGE "etage"
!endif
!ifndef SORTIE
  !define SORTIE "AETHRYON-Desktop-Setup-${VERSION}.exe"
!endif

!define PRODUIT "AETHRYON Desktop"
!define EXE "aethryon-desktop.exe"
!define DESINSTALLEUR "desinstaller.exe"
!define CLE_DESINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\AETHRYON-Desktop"
!define CLE_WEBVIEW2 "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
!define CLE_WEBVIEW2_U "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

; Signature : `makensis -DSIGNER=/chemin/signer.sh …`. Sans -DSIGNER, rien n'est signé (bêta personnelle).
!ifdef SIGNER
  !finalize '"${SIGNER}" "%1"' = 0
  !uninstfinalize '"${SIGNER}" "%1"' = 0
!endif

Name "${PRODUIT}"
Caption "Installation d'AETHRYON"
UninstallCaption "Désinstallation d'AETHRYON"
BrandingText "AETHRYON Desktop ${VERSION}"
OutFile "${SORTIE}"
InstallDir "$LOCALAPPDATA\Programs\AETHRYON"
InstallDirRegKey HKCU "${CLE_DESINST}" "InstallLocation"
ShowInstDetails nevershow
ShowUninstDetails show

VIProductVersion "${VERSION_WINDOWS}"
VIFileVersion "${VERSION_WINDOWS}"
VIAddVersionKey /LANG=1036 "ProductName" "${PRODUIT}"
VIAddVersionKey /LANG=1036 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1036 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1036 "FileDescription" "Installation d'AETHRYON Desktop"
VIAddVersionKey /LANG=1036 "CompanyName" "AETHRYON"
VIAddVersionKey /LANG=1036 "LegalCopyright" "© 2026 AETHRYON"
VIAddVersionKey /LANG=1036 "OriginalFilename" "${SORTIE}"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "WinVer.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"

; ---- Apparence de marque (images tirées des fichiers officiels par scripts/icones.mjs) --------------------------------
!define MUI_ICON "installateur.ico"
!define MUI_UNICON "installateur.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP "bienvenue.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "bienvenue.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "entete.bmp"
!define MUI_HEADERIMAGE_UNBITMAP "entete.bmp"
!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT "Arrêter l'installation d'AETHRYON ? Rien n'aura été configuré."

!define MUI_WELCOMEPAGE_TITLE "Bienvenue dans AETHRYON"
!define MUI_WELCOMEPAGE_TEXT "Vos médias. Votre espace de création.$\r$\n$\r$\nCet installateur copie AETHRYON Desktop dans votre profil Windows (aucun droit d'administrateur), puis ouvre AETHRYON pour vérifier Premiere Pro et installer le panneau, étape par étape.$\r$\n$\r$\nVersion ${VERSION} · bêta personnelle, non signée."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES

!define MUI_WELCOMEPAGE_TITLE "Désinstaller AETHRYON"
!define MUI_WELCOMEPAGE_TEXT "AETHRYON retire le panneau de Premiere Pro (par Creative Cloud), la liaison avec les navigateurs, le démarrage automatique et ses réglages.$\r$\n$\r$\nVos médias restent en place, sauf si vous demandez le contraire à l'étape suivante."
!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "French"

Var MediasSupprimes

Function .onInit
  SetShellVarContext current
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP|MB_OK "AETHRYON Desktop demande Windows 10 ou 11." /SD IDOK
    Abort
  ${EndIf}
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP|MB_OK "AETHRYON Desktop demande une version 64 bits de Windows." /SD IDOK
    Abort
  ${EndIf}
FunctionEnd

Section "AETHRYON Desktop" SecPrincipale
  SetShellVarContext current
  ; WebView2 (clé documentée par Microsoft) : présent sous Windows 11. Sans lui, l'interface ne peut pas s'ouvrir.
  ReadRegStr $0 HKLM "${CLE_WEBVIEW2}" "pv"
  ReadRegStr $1 HKCU "${CLE_WEBVIEW2_U}" "pv"
  ${If} "$0$1" == ""
  ${OrIf} "$0$1" == "0.0.0.0"
    MessageBox MB_ICONEXCLAMATION|MB_OK "Microsoft Edge WebView2 n'a pas été trouvé. AETHRYON Desktop en a besoin pour afficher son interface.$\r$\nInstallez « Microsoft Edge WebView2 Runtime » depuis le site de Microsoft, puis relancez cet installateur." /SD IDOK
  ${EndIf}

  ; Mise à jour : une instance ouverte tiendrait l'exe verrouillé.
  DetailPrint "Fermeture d'une instance d'AETHRYON Desktop déjà ouverte…"
  nsExec::Exec 'taskkill /F /IM ${EXE}'
  Pop $0
  Sleep 400

  SetOutPath "$INSTDIR"
  File "${ETAGE}\${EXE}"
  File "${ETAGE}\WebView2Loader.dll"
  SetOutPath "$INSTDIR\panneau"
  File "${ETAGE}\panneau\aethryon-premiere.ccx"
  File "${ETAGE}\panneau\panneau.json"
  SetOutPath "$INSTDIR\licences"
  File "${ETAGE}\licences\*.*"
  SetOutPath "$INSTDIR"

  WriteUninstaller "$INSTDIR\${DESINSTALLEUR}"
  CreateShortCut "$SMPROGRAMS\AETHRYON.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0 SW_SHOWNORMAL "" "AETHRYON Desktop"

  ; « Applications installées » (HKCU) : Modifier = réparer dans l'application ; Désinstaller = ce désinstalleur.
  WriteRegStr HKCU "${CLE_DESINST}" "DisplayName" "${PRODUIT}"
  WriteRegStr HKCU "${CLE_DESINST}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${CLE_DESINST}" "Publisher" "AETHRYON"
  WriteRegStr HKCU "${CLE_DESINST}" "DisplayIcon" '"$INSTDIR\${EXE}",0'
  WriteRegStr HKCU "${CLE_DESINST}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${CLE_DESINST}" "UninstallString" '"$INSTDIR\${DESINSTALLEUR}"'
  WriteRegStr HKCU "${CLE_DESINST}" "QuietUninstallString" '"$INSTDIR\${DESINSTALLEUR}" /S'
  WriteRegStr HKCU "${CLE_DESINST}" "ModifyPath" '"$INSTDIR\${EXE}" --reparer'
  WriteRegDWORD HKCU "${CLE_DESINST}" "NoModify" 0
  WriteRegDWORD HKCU "${CLE_DESINST}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${CLE_DESINST}" "EstimatedSize" "$0"

  ; Le vrai parcours d'installation se déroule dans l'application (sauf installation silencieuse).
  ${IfNot} ${Silent}
    DetailPrint "Ouverture d'AETHRYON pour terminer l'installation…"
    Exec '"$INSTDIR\${EXE}" --assistant'
  ${EndIf}
  SetAutoClose true
SectionEnd

Function un.onInit
  SetShellVarContext current
  StrCpy $MediasSupprimes "non"
FunctionEnd

Section "Uninstall"
  SetShellVarContext current
  ; Garder les médias ? Oui par défaut ; « Non » demande une confirmation (seuls les fichiers indexés par AETHRYON dans
  ; le dossier des médias principal sont supprimés, jamais un autre fichier).
  MessageBox MB_ICONQUESTION|MB_YESNO|MB_DEFBUTTON1 "Garder vos médias ?$\r$\n$\r$\nOui : vos vidéos, sons et images restent dans le dossier des médias.$\r$\nNon : les fichiers qu'AETHRYON a indexés dans ce dossier seront supprimés." /SD IDYES IDYES garder
    MessageBox MB_ICONEXCLAMATION|MB_YESNO|MB_DEFBUTTON2 "Supprimer définitivement les médias indexés par AETHRYON ? Cette action ne peut pas être annulée." /SD IDNO IDNO garder
    StrCpy $MediasSupprimes "oui"
  garder:

  DetailPrint "Retrait du panneau Premiere Pro, de la liaison navigateur et du démarrage automatique…"
  ${If} ${FileExists} "$INSTDIR\${EXE}"
    ${If} $MediasSupprimes == "oui"
      ExecWait '"$INSTDIR\${EXE}" --desinstaller --supprimer-medias' $0
    ${Else}
      ExecWait '"$INSTDIR\${EXE}" --desinstaller' $0
    ${EndIf}
    DetailPrint "Composants retirés (code $0). Bilan : %TEMP%\AETHRYON-desinstallation.txt"
  ${EndIf}
  ; Filet de sécurité si l'exe n'a pas pu tourner : les clés HKCU connues.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "AETHRYON Desktop"
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\fr.aethryon.desktop"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\fr.aethryon.desktop"
  DeleteRegKey HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\fr.aethryon.desktop"
  nsExec::Exec 'taskkill /F /IM ${EXE}'
  Pop $0
  Sleep 300

  Delete "$SMPROGRAMS\AETHRYON.lnk"
  Delete "$INSTDIR\${EXE}"
  Delete "$INSTDIR\WebView2Loader.dll"
  Delete "$INSTDIR\panneau\aethryon-premiere.ccx"
  Delete "$INSTDIR\panneau\panneau.json"
  RMDir "$INSTDIR\panneau"
  RMDir /r "$INSTDIR\licences"
  Delete "$INSTDIR\${DESINSTALLEUR}"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${CLE_DESINST}"
SectionEnd

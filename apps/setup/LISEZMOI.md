# AETHRYON Setup 2.0.0-beta.2 : installateur sur mesure, vraie extension Premiere Pro signée, fenêtre sans bordure blanche

> **Bêta personnelle, NON TESTÉE SOUS WINDOWS.** Rien n'est publié, déployé ni signé par un certificat payant.
>
> Tout a été construit et essayé sous Linux :
> - essais Rust sur un système factice ;
> - captures dans Chromium ;
> - exe Windows réel sous Wine 8.
>
> Le premier vrai essai sera celui du propriétaire, sur son PC Windows 11.

Réponse au premier retour du propriétaire (`retours/RETOUR-1.md`) :
- **un setup .exe stylé** remplace l'assistant NSIS gris ;
- **Réparer, Mettre à jour, Désinstaller** quand AETHRYON est déjà installé ;
- **plus de bordure blanche** autour d'AETHRYON Desktop et du setup.

## 1. Contenu de ce dossier

| Fichier | Rôle |
|---|---|
| `AETHRYON-Setup-2.0.0-beta.2.exe` | **le seul fichier à lancer**. Il embarque l'interface du setup, AETHRYON Desktop 1.0.0-beta.3 et l'extension `fr.aethryon.premiere` signée |
| `aethryon-desktop.exe` | AETHRYON Desktop 1.0.0-beta.3 seul (déjà dans le setup ; pour comparaison) |
| `fr.aethryon.premiere.zxp` | l'extension CEP **signée et horodatée** que le setup installe |
| `fr.aethryon.premiere-sans-horodatage.zxp` | la même, signée **sans** horodatage : variante de diagnostic (§6) |
| `SHA256SUMS` | empreintes. Sous Windows : `Get-FileHash .\<fichier> -Algorithm SHA256` |
| `captures/` | les 18 écrans du setup (Chromium, 960 × 640) et 6 planches côte à côte avec les maquettes approuvées |
| `essais/` | journaux des essais : Wine (81 vérifications), signature (11 essais), construction |
| `LISEZMOI.md` | ce document |

Empreintes SHA-256 :
- `7a070f81e07ac11df6bf38a9d13fb2923987f35f6c41047513aef4891474064e` : `AETHRYON-Setup-2.0.0-beta.2.exe` (5,6 Mio)
- `39c47c80d6841e7ccb4c91c5be8f07d7798ec09499a6e7662b5abb9e50c8168d` : `aethryon-desktop.exe` (6,0 Mio)
- `1842fbc78fe8e9b67cd9c726659438c9e8d1fd6c045d4a8907cadab2194b6b3d` : `fr.aethryon.premiere.zxp`
- `f0193de9c8e6c00c016e0948553bdf1a76588d98a2fe86761518be67a174018b` : `fr.aethryon.premiere-sans-horodatage.zxp`

**Extension embarquée : la VRAIE extension CEP 2.0.0** (`premiere-pro/V2-A-cep/fr.aethryon.premiere/`, 20 fichiers,
21 références signées avec `mimetype`). Plus de remplaçant d'essai : les écrans « Détection » et « Terminé » n'écrivent
plus « (provisoire) ».

Historique : la 2.0.0-beta.1 embarquait un remplaçant (0.0.1), parce que le `CSXS/manifest.xml` de l'extension n'était
pas du XML bien formé (« -- » dans le commentaire d'en-tête, refusé par le contrôle du setup). Le manifeste est
corrigé côté extension (branche `feat/v2-integration`) et contrôlé à chaque construction de l'extension ; la
signature refuse toujours un manifeste mal formé.

## 2. Essai du propriétaire (Windows 11)

1. Vérifier l'empreinte (`SHA256SUMS`).
2. Lancer `AETHRYON-Setup-2.0.0-beta.2.exe`. Il n'est **pas signé** (Authenticode) : SmartScreen avertira. Pour cette
   bêta personnelle seulement : « Informations complémentaires », puis « Exécuter quand même ». Aucune demande de
   droits d'administrateur ne doit apparaître (manifeste `asInvoker`). Si Windows en demande, c'est un défaut à signaler.
3. **Bienvenue**, puis **Détection**, puis **Configuration**, puis **Installation**, puis **Terminé**. Les cinq écrans
   reprennent les maquettes de l'étape B.
4. Ouvrir Premiere Pro : menu **Fenêtre › Extensions › AETHRYON**. C'est l'essai E1 : le panneau
   doit s'afficher **sans PlayerDebugMode**.
5. Relancer le setup, ou passer par Paramètres Windows › Applications › AETHRYON › **Modifier**. L'écran « AETHRYON est
   déjà installé » propose Réparer et Désinstaller.
6. À signaler : une capture de la fenêtre, plein écran, sur fond clair (bordure ?), le journal
   `%LOCALAPPDATA%\AETHRYON\journaux\setup-AAAAMMJJ.log`, et ce qu'affiche Premiere.

**La bêta 1.0.0-beta.2 (installateur NSIS) est remplacée** : même dossier ; `desinstaller.exe`, `panneau\`, `licences\`
et l'entrée « AETHRYON-Desktop » sont retirés (prouvé sous Wine avec le vrai installateur NSIS, §4). Son ancien
plugin **UXP « AETHRYON »** n'est pas géré par le setup : la Détection et l'écran de fin disent de le retirer dans
l'application Creative Cloud Desktop, parmi les plugins installés, s'il apparaît encore dans Premiere.

## 3. Le setup

### 3.1 Un seul exe, sans droits d'administrateur

`AETHRYON-Setup.exe` est une **amorce** de 5,3 Mio. Elle embarque la charge `charge.zip` :
- `charge.json`, avec la version et le SHA-256 de chaque fichier ;
- l'interface (`aethryon-setup-ui.exe`, Tauri 2 et WebView2, avec `WebView2Loader.dll`) ;
- AETHRYON Desktop et l'extension signée.

Pourquoi une amorce : avec la cible GNU, une application Tauri a besoin de `WebView2Loader.dll` **à côté** de l'exe.
Seule la cible MSVC peut lier ce chargeur en statique.

L'amorce :
- refuse une seconde instance (mutex) et ramène la fenêtre ouverte au premier plan ;
- vérifie que WebView2 est présent. S'il manque, un message Windows l'explique et rien n'est modifié ;
- extrait l'interface dans `%TEMP%\AETHRYON-Setup-<pid>`, **en vérifiant chaque SHA-256** ;
- la lance, puis nettoie.

Lancée depuis le dossier d'installation (la copie de maintenance), elle se recopie d'abord dans `%TEMP%` et se relance
de là. Ainsi, la désinstallation peut tout retirer, y compris cette copie ; la copie temporaire s'efface ensuite.

Manifeste Windows (amorce et interface) : `asInvoker`, DPI par écran (PerMonitorV2), Windows 10 et 11, UTF-8.
Informations de version : « AETHRYON Setup », éditeur AETHRYON.

### 3.2 Écrans

| Écran | Ce qui est réel |
|---|---|
| Bienvenue | chouette officielle animée (clignements), version et Windows lus sur le PC, « Licence et confidentialité » |
| Détection | voir le détail sous ce tableau |
| Configuration | dossier des médias (Vidéos › AETHRYON par défaut, ou celui déjà choisi dans le Desktop), espace libre mesuré, AETHRYON Desktop (facultatif, coché), surveillance, démarrage avec Windows, notifications (Toutes, Importantes, Aucune) |
| Installation | **5 étapes réelles**, voir §3.3 ; durées mesurées ; octets écrits pendant la copie ; « Afficher le journal » ; « Annuler » |
| Terminé | « AETHRYON est prêt. », version installée, extension installée, dossier configuré, « Ouvrir AETHRYON » (si le Desktop est installé), « Ouvrir Premiere Pro » (si Premiere a été trouvé) |
| **Maintenance** | « AETHRYON est déjà installé » ; versions et dossiers lus dans l'inventaire ; **Réparer** (même version), **Mettre à jour vers X** (setup plus récent), **Désinstaller** |
| Désinstallation | voir le détail sous ce tableau |

**Détection** :
- Premiere Pro est cherché dans `Program Files\Adobe\Adobe Premiere Pro*` et dans le registre (HKLM, en lecture
  seule). Sa version est **lue dans l'exe**.
- La compatibilité se calcule sur l'intervalle `PPRO` **du manifeste de l'extension embarquée**. Une version
  illisible donne « Version illisible », jamais « Compatible ».
- Creative Cloud (non nécessaire), WebView2, l'espace disque et la bêta précédente sont aussi relevés.
- PlayerDebugMode **lu** pour information, jamais écrit.
- Si Premiere n'est pas trouvé, trois choix sont proposés (maquette 2b).

**Désinstallation** : on choisit de **garder ou supprimer les médias**. Le nombre de fichiers et leur taille sont
mesurés. La suppression exige une case de confirmation. Les étapes se déroulent réellement, puis un écran de fin
liste ce qui n'a pas pu être retiré.

Animations :
- apparitions et sceau de liaison ;
- chouette au travail pendant l'installation ;
- reflet du bouton « Commencer ».

Le mode réduit s'applique quand « Effets d'animation » est coupé dans Windows (`prefers-reduced-motion`) ou avec
`--animations-reduites`. La fenêtre fait 960 × 640, sans cadre, et n'apparaît qu'**après le premier rendu** : pas
d'éclair blanc.

### 3.3 Les cinq étapes (moteur `moteur/src/operations.rs`)

1. **Vérification** :
   - SHA-256 de chaque fichier de la charge ;
   - extension : chaque fichier comparé au **Manifest signé** de `META-INF/signatures.xml`, aucun fichier en trop,
     aucun lien symbolique ;
   - espace disque ;
   - dossier des médias **inscriptible**, prouvé par un fichier témoin écrit puis retiré ;
   - Premiere et Desktop ouverts ou non.
2. **Installation** :
   - Desktop vers `%LOCALAPPDATA%\Programs\AETHRYON`. Chaque fichier passe par `.nouveau` ; l'ancien est **renommé**
     en sauvegarde, jamais effacé avant la validation ;
   - extension extraite dans un dossier de préparation, revérifiée, puis basculée dans
     `%APPDATA%\Adobe\CEP\extensions\fr.aethryon.premiere`, avec `mimetype` et `META-INF\signatures.xml` ;
   - copie de maintenance `AETHRYON-Setup.exe`.
3. **Enregistrement** :
   - `HKCU\…\Uninstall\AETHRYON` : DisplayName, DisplayVersion, Publisher « AETHRYON », DisplayIcon, InstallLocation,
     UninstallString, QuietUninstallString, ModifyPath (`--maintenance`), EstimatedSize, InstallDate, NoModify 0,
     NoRepair 1 ;
   - raccourci du menu Démarrer ;
   - démarrage avec Windows (même valeur `Run` que le Desktop).
4. **Configuration** :
   - `%APPDATA%\AETHRYON\config.json` (contrat partagé). Les clés inconnues sont gardées ; un fichier illisible est
     mis de côté ;
   - `desktop.json` : l'ancien assistant UXP du Desktop ne se relance pas ;
   - inventaire `installation.json`.
5. **Validation** : tout est **relu** (fichiers, Manifest signé, registre, préférences), et PlayerDebugMode doit être
   inchangé. Ensuite, les sauvegardes sont retirées et la bêta NSIS est remplacée.

**Retour arrière** : en cas d'échec ou d'annulation, chaque action est défaite dans l'ordre inverse :
- fichiers et extension remis en place ;
- clés rétablies ;
- dossiers créés retirés.

L'écran le dit (« Retour arrière fait : 11 opération(s) défaite(s) ») et propose « Réessayer ».

**Journal** : `%LOCALAPPDATA%\AETHRYON\journaux\setup-AAAAMMJJ.log`, sans secret. Il est gardé après une
désinstallation.

Modes sans fenêtre, pour les essais et les mises à jour futures :
- `--silencieux --installer|--reparer|--mettre-a-jour|--desinstaller [--sans-desktop] [--supprimer-medias] [--rapport f.json]` ;
- `--etat f.json` écrit la détection.

## 4. Preuves (Linux), et comment

| Preuve | Résultat |
|---|---|
| Moteur, `cargo test -p aethryon-setup-moteur` (fichiers et registre **factices** en mémoire) | **26 essais verts**, dont : installation complète, maintenance détectée puis réparation, mise à jour, **panne simulée** à l'enregistrement puis pendant une mise à jour (retour arrière **à l'identique**, version précédente intacte), annulation pendant la copie, charge altérée refusée avant toute copie, extension seule, espace insuffisant, désinstallation en gardant ou en supprimant les médias, extension étrangère intacte, lien de développement retiré sans toucher sa cible, bêta NSIS remplacée, PlayerDebugMode laissé tel quel |
| Captures Playwright (Chromium, 960 × 640) | **18 écrans** (dont Détection et Terminé avec la bêta 2 remplacée) sans erreur de console, sans débordement ni chevauchement du pied. Les données rejouées sont produites par le **vrai moteur** sur un système factice (`moteur/examples/instantanes.rs`) : textes, étapes, durées et octets sont les siens |
| Comparaison avec les maquettes | 6 planches (`captures/comparaison-*.png`) : mêmes grilles, typographie, chouette, fil d'or, règle d'étapes. Écarts au §8 |
| Signature CEP | §5 : 11 essais verts, dont la **référence Adobe** ; xmlsec1 valide |
| **Wine 8 : l'exe Windows réel** (`essais-wine/essai-setup.sh`) | **81 vérifications vertes**, détaillées sous ce tableau |
| AETHRYON Desktop 1.0.0-beta.3 | 54 essais du cœur (Linux) et 19 essais vitest ; construit pour Windows ; démarre sous Wine (`--diagnostic`) |

Les 81 vérifications sous Wine :
1. **Amorce** : charge ouverte, interface extraite et vérifiée, dossier temporaire nettoyé.
2. **Détection** : faux « Adobe Premiere Pro.exe » 26.5.2.13 trouvé et compatible.
3. **Installation** :
   - fichiers ;
   - extension installée **à signature valide** (zxp.py, et xmlsec1 sur le dossier installé) ;
   - toutes les valeurs HKCU, la valeur `Run`, le raccourci `.lnk` (IShellLinkW), `config.json` et le journal ;
   - aucune clé `HKCU\Software\Adobe` créée.
4. **Maintenance** détectée : Réparer, Désinstaller.
5. **Réparation** lancée depuis la copie de maintenance, qui se relance depuis `%TEMP%` : exe supprimé remis,
   extension abîmée réécrite, fichier en trop retiré, démarrage rétabli.
6. **Mise à jour** par un setup d'essai 2.0.0-beta.3, jamais livré : « Mettre à jour » proposé, version et copie de
   maintenance remplacées, date d'installation gardée ; le setup plus ancien ne propose plus que « Désinstaller ».
7. **Désinstallation** par la `QuietUninstallString` : dossier, extension, clés, raccourci et préférences retirés ;
   médias et journal gardés.
8. **Panne réelle** (un fichier bloque le dossier des préférences) : installation refusée, **retour arrière complet**,
   rien ne reste.
9. **Remplacement de la bêta 2** : son VRAI installateur NSIS (`AETHRYON-Desktop-Setup-1.0.0-beta.2.exe` du paquet D,
   empreinte vérifiée, `/S`) pose la bêta ; le setup la détecte (« À remplacer »), s'installe par-dessus (entrée
   `AETHRYON-Desktop`, `desinstaller.exe`, `panneau\`, `licences\` retirés ; Desktop 1.0.0-beta.3 ; extension à
   signature valide ; conseil sur l'ancien plugin UXP dans le rapport), puis se désinstalle sans laisser de dossier.

## 5. Signature de l'extension CEP depuis Linux (`signature-cep/`, détails dans `FORMAT.md`)

- **ZXPSignCmd n'a pas été utilisé.** Le dépôt d'Adobe qui le publie porte une licence du SDK CEP qui s'accepte « en
  téléchargeant, copiant, installant ou utilisant toute partie de ce SDK ». L'outil n'a donc jamais été téléchargé.
  Décision au propriétaire (§9).
- **Réimplémentation fidèle** (`zxp.py`). Le format est relevé sur un vrai ZXP signé par ZXPSignCmd :
  - XML-DSig avec Manifest des fichiers (SHA-256), C14N 1.0, certificat dans KeyInfo ;
  - horodatage XAdES : réponse RFC 3161 complète, calculée sur la forme canonique de `SignatureValue`.
- **Preuves** :
  - `zxp.py verifier` déclare **valide le ZXP d'Adobe**, et invalide dès qu'un octet change ;
  - **xmlsec1** (implémentation indépendante) valide le ZXP d'Adobe **et** les nôtres ;
  - 11 essais verts : falsifications détectées, liens symboliques et manifeste mal formé refusés, certificat v1 comme
    ZXPSignCmd.
- **Certificat** : auto-signé, RSA 2048, X.509 v1, `C=FR, O=AETHRYON, CN=AETHRYON`, valable jusqu'au 15 octobre 2036.
  Empreinte SHA-256 `BC:B9:BD:0A:06:EE:E8:A3:6F:5E:D0:3E:AF:B4:A4:61:86:6D:39:A8:B9:23:85:93:95:76:F8:64:3E:CE:56:50`.
- **Horodatage** : autorité RFC 3161 **locale** (`openssl ts`). Rien ne sort de la machine.
- **Secrets** : clé, mot de passe et clé de l'autorité dans un dossier privé hors dépôt (variable `SECRETS`) (0700, hors Git).
  Rien n'est jamais affiché.
- **Problème connu de novembre 2024** : aucun lien symbolique (refusé à la signature, à la vérification et à
  l'installation). Le setup extrait lui-même les fichiers, sans passer par UPIA, et les revérifie avant et après. Pas
  de `.DS_Store` ni de `__MACOSX`. PlayerDebugMode n'est jamais écrit.

## 6. Bordure blanche (AETHRYON Desktop 1.0.0-beta.3 et le setup)

**Mesure sur la capture du propriétaire** : une bande **blanche de 5 px** (plus 1 px de transition) à gauche, à droite
et en bas, **rien en haut**.

**Lecture de tao 0.37.1** :
- pour une fenêtre sans cadre **avec** ombre, `WM_NCCALCSIZE` garde une zone non cliente de
  `SM_CXSIZEFRAME + SM_CXPADDEDBORDER` à gauche, à droite et en bas, et de 1 px en haut (`calculate_insets_for_dpi`) ;
- c'est elle qui apparaît peinte en clair ;
- tao 0.37.1 est la dernière version publiée (crates.io, 18 octobre). Le correctif tao#1361 du bug voisin tao#1359
  (hauteur qui grandit) n'y est pas.

**Correction**, appliquée au Desktop et au setup :
- `shadow: false` : la zone cliente couvre toute la fenêtre, il n'y a plus de zone non cliente à peindre ;
- puis, par DWM (`src-tauri/src/dwm.rs`, crate `windows`) :
  - `DwmExtendFrameIntoClientArea(1)` pour l'ombre (procédé de `window-shadows`, Tauri 1) ;
  - `DWMWA_WINDOW_CORNER_PREFERENCE = ROUND` ;
  - `DWMWA_BORDER_COLOR` : la couleur du fond #0F0F10 pour le setup, `DWMWA_COLOR_NONE` pour le Desktop (qui a un
    thème clair) ;
  - `DWMWA_USE_IMMERSIVE_DARK_MODE`.

**Éclair blanc** : `backgroundColor` de la fenêtre et de WebView2 (wry le passe à `ControllerOptions3` dès la
création), fond posé sur `html` dès le premier pixel, fenêtre montrée après le premier rendu React. Le redimensionnement
du Desktop passe par la fenêtre de saisie de tauri-runtime-wry, qui fonctionne aussi sans ombre.

## 7. NON TESTÉ SOUS WINDOWS (précisément)

- **La bordure** : DWM n'existe ni sous Linux ni sous Wine. Que la bande blanche ait disparu, que l'ombre et les coins
  arrondis soient là, sous Windows 11 à 100, 125, 150 et 200 %, avec et sans focus, avec « couleur d'accentuation sur
  les bordures » activée.
- **L'interface du setup dans WebView2** : glissement par la barre dessinée, réduire et fermer, dialogues de choix de
  dossier, « Ouvrir Premiere Pro », « Ouvrir AETHRYON », « Afficher le journal » (Bloc-notes), instance unique, mode
  « Effets d'animation » de Windows.
- **L'acceptation de la signature par le vrai CEP** de Premiere, sans PlayerDebugMode, avec un certificat auto-signé et
  une autorité d'horodatage **locale** et non reconnue. Si le panneau reste vide, essayer la variante
  `fr.aethryon.premiere-sans-horodatage.zxp` : l'extraire à la place, puis Fenêtre › Extensions. Ensuite, la décision
  d'une autorité publique (§9).
- `rsa-sha1` comme méthode de signature : c'est ce qu'écrit ZXPSignCmd et ce que CEP accepte d'après la référence, mais
  ce n'est pas vérifié dans la version de Premiere du propriétaire.
- **Le vrai Premiere** : sa détection réelle (dossiers 2025, 2026, Beta, version de fichier exacte), Premiere ouvert
  pendant l'installation, « Fenêtre › Extensions » en français.
- **SmartScreen** sur le setup non signé. Pas de demande d'élévation, grâce au manifeste `asInvoker` (non vérifié).
- Paramètres Windows › Applications : affichage de l'entrée, boutons Modifier et Désinstaller, icône, taille.
- Raccourci réel du menu Démarrer (Wine en écrit un), démarrage réel avec Windows, OneDrive sur le dossier Vidéos,
  antivirus face à une amorce qui s'extrait dans `%TEMP%`.
- Remplacement de la bêta NSIS **sur le PC du propriétaire** (prouvé sous Wine seulement), son plugin UXP déjà installé
  (retrait par Creative Cloud, à la main), et le Desktop 1.0.0-beta.2 ouvert pendant la mise à jour (il est fermé par
  le setup : `TerminateProcess`).
- La construction GNU (mingw) n'est pas la voie MSVC documentée par Tauri. Une version publiée devra être construite
  sous Windows (décision D4).

## 8. Écarts avec les maquettes approuvées

- **Détection** : lignes adaptées à CEP. « Extension AETHRYON » (signée et horodatée, dossier des extensions)
  remplace « Glisser-déposer vers la timeline (27.0) », qui concernait UXP. Creative Cloud est « pas nécessaire ».
  « Continuer sans Premiere Pro » remplace « sans le panneau » : l'extension est posée de toute façon et apparaîtra
  avec Premiere.
- **Configuration** : « Installer AETHRYON Desktop » remplace « Installer le panneau Premiere Pro par Creative
  Cloud ». L'extension est toujours installée ; le Desktop est facultatif.
- **Installation** : sous-titre « Chaque ligne est une opération réelle, mesurée sur ce PC. » au lieu de « Environ une
  minute », qui n'était pas mesuré. Résumés et durées réels. Une barre fine d'octets écrits apparaît pendant la copie.
- **Terminé** : « Version installée : AETHRYON 2.0.0-beta.2 » ; « Extension 2.0.0 installée » ; pied « Réparer ou
  désinstaller : Paramètres Windows › Applications › AETHRYON › Modifier, ou relancez ce setup ».
- **Nouveaux écrans** dans le même langage (aucune maquette) : maintenance, confirmation de désinstallation,
  désinstallation, fin, échec avec retour arrière.

## 9. Décisions attendues du propriétaire

1. **Essai E1** sur son PC : extension sans PlayerDebugMode. Avec ou sans horodatage local ?
2. **Horodatage public** pour une publication : une requête vers une autorité comme `http://time.certum.pl/`, qui ne
   reçoit qu'une empreinte. Aujourd'hui, rien ne sort de la machine.
3. **ZXPSignCmd** : accepter ou non la licence du SDK CEP d'Adobe. Cela permettrait une contre-épreuve
   `ZXPSignCmd -verify` sur Windows. Ce n'est pas nécessaire au setup.
4. **Signature Authenticode** du setup (D2). Le crochet `scripts/signer.sh` est prêt et sans effet.
5. **Construction MSVC** (D4), et redistribution de `WebView2Loader.dll`.

## 10. Reconstruire

```
TRAVAIL=<hors dépôt> ESSAIS_WINE=1 CAPTURES=1 [EXTENSION_CEP=<dossier>] [ZXP_REFERENCE=<un ZXP d'Adobe>] \
  bash setup/scripts/construire.sh
```

Ce que fait le script :
- essais de la signature ;
- signature de l'extension ;
- interfaces ;
- conteneur jetable `rust:1-bookworm` (3 Go, 4 processeurs, faible priorité, aucune étiquette Traefik) : essais du
  moteur, Desktop et interface pour Windows, charge, amorce, `SHA256SUMS`, essais Wine, captures ;
- suppression du conteneur.

Sources : npm, crates.io, Debian apt, images officielles de Docker Hub. Branche `feat/v2-setup`.

# AETHRYON Desktop — application Windows (1.0.0-beta.2, étape D)

> **Bêta personnelle, non signée, NON TESTÉE SOUS WINDOWS.** Rien n'est publié, déployé, signé ni soumis. Tout ce qui
> suit a été construit et essayé sous Linux (essais automatiques, captures avec une maquette de l'API Tauri, Wine 8).
> Le premier vrai essai sera celui du propriétaire sur son PC Windows 11 (voir `TESTS-MANUELS.md`).

## 1. Ce que fait AETHRYON Desktop

- **Bibliothèque** : surveille le dossier des médias (par défaut `Téléchargements\AETHRYON`) et d'autres dossiers
  choisis ; tient l'index du contrat (`%LOCALAPPDATA%\AETHRYON\bibliotheque\index.json`) que lit le panneau Premiere.
  Cartes ou liste, recherche, filtres, tri, sélection multiple ; aperçu dans un lecteur intégré (code temporel,
  image par image, J K L, bande d'images, aperçu au survol) ; ouvrir, afficher dans l'Explorateur, copier le chemin,
  **importer dans Premiere** (commande `importer` déposée pour le panneau, qui confirme).
- **Flux (glisser-déposer, branche `feat/flow-natif`, socle sans visuel)** : glisser natif d'une carte vers Premiere Pro
  ou l'Explorateur (OLE, NON DÉMONTRÉ), zones internes par les événements de dépôt de Tauri, import atomique de fichiers
  déposés, « Surveiller ce dossier », envoi vers Premiere aux états réels. Voir `FLUX.md`.
- **Transferts** : téléchargements du navigateur repérés dans le dossier (`.crdownload`, `.part`), et transferts
  annoncés par l'extension via l'hôte Native Messaging (`%LOCALAPPDATA%\AETHRYON\transferts\`).
- Mise à jour en un clic de l'extension navigateur (1.0.0-beta.4) : l'hôte reçoit `mettre-a-jour-extension` (la
  version seulement), lit `latest.json` à l'adresse figée du site (HTTPS seul, aucune redirection), vérifie taille,
  SHA-256 et contenu de l'archive (identifiant de production), et l'installe dans le dossier géré
  `%LOCALAPPDATA%\AETHRYON\extension` par bascule atomique, en gardant `extension-precedente` (`noyau/src/maj_extension.rs`).
- **Intégrations** : Premiere Pro (version LUE dans l'exe, compatibilité 25.6+ calculée, glisser-déposer seulement
  27.0+), réparation, désinstallation du panneau par l'outil d'Adobe (UPIA) ; extension navigateur « En préparation ».
- **Paramètres** : thème (Système, Clair, Sombre), « Réduire les animations », dossiers, notifications, démarrage avec
  Windows, journaux locaux et rapport, mises à jour (« Rechercher les mises à jour », « Mettre à jour » : `downloads/desktop/latest.json`, setup vérifié
  lancé avec `--mettre-a-jour`, puis fermeture ; jamais sans clic ; avis discret dans la barre latérale), à propos et
  licences.
- **Parcours d'installation en 5 écrans** (Bienvenue, Détection, Configuration, Installation, Terminé), lancé par
  l'installateur, au premier démarrage, par `--reparer` (« Modifier » dans Paramètres Windows) et par Intégrations ›
  Réparer. L'écran « Installation » déroule 5 étapes **réelles** :
  1. Vérification — Premiere Pro et Creative Cloud détectés, paquet du panneau vérifié (SHA-256), écriture réelle d'un
     fichier témoin dans le dossier des médias, espace libre, Premiere ouvert ou non ;
  2. Installation — présence d'AETHRYON Desktop, copie du `.ccx`, `UnifiedPluginInstallerAgent.exe /install <ccx>`
     (repli : ouverture du `.ccx` par Creative Cloud, marquée « à confirmer ») ;
  3. Enregistrement des composants — clés Native Messaging HKCU pour Chrome, Edge et Brave, démarrage automatique,
     entrée « Applications installées » ;
  4. Configuration — `config.json`, arborescence d'échange, index ;
  5. Validation — `UPIA /list all` doit mentionner le panneau, fichiers et clés relus.
  L'écran final dit « AETHRYON est prêt. » avec la version, l'état réel du panneau et le dossier, « Ouvrir AETHRYON » et,
  si Premiere a été trouvé, « Ouvrir Premiere Pro ».

> **Étape D (18 octobre)** : Desktop 1.0.0-beta.2 embarque le **vrai panneau 1.0.0-beta.2** (manifeste 0.9.2),
> construit depuis `premiere/` du même arbre. Banc d'intégration, corrections et matrice des essais :
> `INTEGRATION.md` à la racine de la branche `feat/aethryon-premiere`. Paquet d'essai du propriétaire :
> `premiere-pro/D-paquet-essai/`. Le tableau ci-dessous décrit la livraison de l'étape C (beta.1, panneau provisoire).

## 2. Contenu livré à l'étape C (`premiere-pro/C-desktop/`)

| Fichier | Rôle |
|---|---|
| `AETHRYON-Desktop-Setup-1.0.0-beta.1.exe` | installateur par utilisateur (NSIS maison, sans téléchargement) |
| `aethryon-desktop.exe`, `WebView2Loader.dll` | l'application seule (déjà dans l'installateur) |
| `aethryon-premiere-1.0.0-beta.1.ccx` | panneau embarqué **provisoire** (celui de `desktop-premiere/panneau-1.0.0-beta.1`, manifeste 0.9.1) |
| `SHA256SUMS` | empreintes ; sous Windows : `Get-FileHash .\<fichier> -Algorithm SHA256` |
| `captures/` | captures de l'interface (maquette de l'API Tauri) et planches côte à côte avec les maquettes approuvées |
| `sources-desktop-<commit>.tar.gz` | sources du dossier `desktop/` de la branche `feat/desktop` |
| `LISEZMOI.md`, `TESTS-MANUELS.md` | ce document, la liste des essais à faire sur le PC |

## 3. Installer (bêta personnelle)

1. Vérifier l'empreinte de l'installateur (`SHA256SUMS`).
2. Lancer `AETHRYON-Desktop-Setup-1.0.0-beta.2.exe`. **Non signé** : Windows SmartScreen affichera un avertissement.
   Pour cette bêta personnelle seulement, « Informations complémentaires » puis « Exécuter quand même ». Ce n'est PAS
   un parcours d'utilisateur : une publication exige une signature (audit §5, décision D2).
3. L'installateur copie l'application dans `%LOCALAPPDATA%\Programs\AETHRYON` (aucun droit d'administrateur), crée
   le raccourci « AETHRYON » du menu Démarrer et l'entrée « Applications installées », puis ouvre AETHRYON sur le
   parcours d'installation.
4. **Réparer** : Paramètres Windows › Applications › AETHRYON Desktop › Modifier (lance `--reparer`), ou AETHRYON ›
   Intégrations › Réparer. **Désinstaller** : Paramètres Windows › Applications › Désinstaller ; le désinstalleur
   lance `aethryon-desktop.exe --desinstaller` (panneau retiré par UPIA, clés et démarrage retirés, données d'AETHRYON
   supprimées) et demande « Garder vos médias ? » (Oui par défaut ; « Non » ne supprime que les fichiers indexés du
   dossier des médias principal, après une seconde confirmation). Bilan : `%TEMP%\AETHRYON-desinstallation.txt`.

## 4. Architecture

```
desktop/
├── noyau/        cœur Rust portable (crate aethryon-noyau), testé sous Linux
│   ├── config.rs           %APPDATA%\AETHRYON\config.json (contrat §2) ; desktop.json (privé)
│   ├── bibliotheque.rs     index §3, passages (partiels, tailles qui changent, introuvables 7 j, erreurs)
│   ├── mesure.rs           en-têtes MP4/MOV (codecs, durée, i/s, rotation), WAV, PNG, GIF, JPEG — sans ffmpeg
│   ├── surveillance.rs     notify (événements, regroupés 400 ms) + passage de secours 30 s + revérification 2 s
│   ├── battements.rs       etat/desktop.json (2 s), etat/panneau.json (< 12 s = connecté), etat/imports.json
│   ├── commandes.rs        file §5 : liste fermée, ids d'index, expiration 2 min, traitées gardées 7 j
│   ├── transferts.rs       §6 : validation stricte, liaison au média arrivé (pret)
│   ├── nm.rs               hôte Native Messaging (u32 + JSON, 64 Kio, champs en liste fermée)
│   ├── maj_extension.rs    mise à jour de l'extension navigateur dans son dossier géré (bascule, retour arrière)
│   ├── maj_desktop.rs      annonce downloads/desktop/latest.json, setup téléchargé et vérifié
│   ├── reseau.rs           HTTPS seul (ureq + rustls/ring, racines Mozilla), aucune redirection, taille bornée
│   ├── assistant.rs        les 5 étapes réelles ; desinstallation.rs
│   ├── journal.rs          journaux quotidiens, 5 Mo/jour, 14 jours, secrets masqués ; nettoyage.rs
│   ├── service.rs          un processus, deux fils (surveillance, échanges)
│   └── plateforme/         trait Plateforme : windows.rs (cfg(windows)), autre.rs (remplaçant), factice.rs (essais)
├── src-tauri/    application Tauri 2 : fenêtre sans cadre, zone de notification, instance unique, notifications,
│                 modes --nm, --desinstaller, --diagnostic, --assistant, --reparer, --arriere-plan
├── src/          interface React + TypeScript (Vite), feuilles de style de l'étape B reprises telles quelles
├── installateur/ script NSIS, empaquetage, crochet de signature (sans effet), images de marque
├── e2e/          maquette de l'API Tauri + captures Playwright
├── essais-wine/  essais de l'exe et de l'installateur Windows sous Wine 8
└── scripts/      construire.sh (construction complète), icones.mjs (icônes depuis les SVG officiels)
```

**Précisions de mise en œuvre du contrat d'échange (v1)** — retenues par le directeur (contrat §8) :
- Écriture atomique : le fichier temporaire s'appelle `<fichier>.<pid>-<n>.tmp` (et non `<fichier>.tmp`) pour que le
  Desktop et l'hôte Native Messaging n'utilisent jamais le même nom ; il se termine toujours par `.tmp`.
- Nom des commandes : `<AAAAMMJJTHHMMSSmmmZ>-<uuid>.json` (tri chronologique par le nom).
- `index.json` reste exactement au format §3 : le suivi interne (tailles vues, date de disparition, analyses) est dans
  `bibliotheque\suivi-desktop.json` ; les réglages propres au Desktop dans `%APPDATA%\AETHRYON\desktop.json`.
- Un téléchargement `.crdownload` / `.part` apparaît dans l'index en `en-cours` sous le chemin FINAL attendu (même `id`
  que le fichier terminé).
- Hôte Native Messaging : un manifeste ne peut pas porter d'argument, et Chrome lance l'hôte avec l'origine de
  l'extension en argument. `aethryon-desktop.exe` reconnaît donc `--nm` **et** `chrome-extension://<id>/` ; une
  origine hors des deux identifiants du contrat est refusée (code 2). Le manifeste est écrit dans
  `%LOCALAPPDATA%\AETHRYON\nm\fr.aethryon.desktop.json`, `allowed_origins` = production ET développement (contrat §6).
- Miniatures 480 × 270 (bandes noires pour les verticales) ; formes d'onde pour l'audio ; produites par le WebView2.

**Panneau embarqué** : `scripts/construire.sh` construit le `.ccx` depuis `premiere/` du même arbre
(`premiere/scripts/construire-ccx.mjs`, déterministe) et refuse de continuer si son SHA-256 diffère de
`premiere/EMPREINTES.txt`. `installateur/empaqueter.sh` vérifie l'identifiant `fr.aethryon.premiere` et le nom
`AETHRYON` du manifeste, puis écrit `panneau\panneau.json` (version, version du manifeste, SHA-256) à côté de l'exe ;
à l'exécution, `AETHRYON_PANNEAU_JSON` peut désigner un autre fichier. `PANNEAU_CCX` + `PANNEAU_VERSION` remplacent
le panneau du même arbre si besoin.

## 5. Construire

```
TRAVAIL=/chemin/hors/du/depot ESSAIS_WINE=1 scripts/construire.sh
```
Interface (npm, vitest, vite) sur l'hôte, puis conteneur jetable `rust:1-bookworm` (3 Go, 4 processeurs, faible
priorité, aucune étiquette Traefik) : essais du noyau, construction `x86_64-pc-windows-gnu`, NSIS, empreintes,
essais sous Wine, suppression du conteneur. Sources : npm, crates.io, Debian apt, Docker Hub (image rust). Aucune
licence acceptée (pas de `cargo-xwin`, pas de MSVC). La cible GNU n'est pas la voie Windows documentée par Tauri (MSVC) :
une version publiée devra être construite sous Windows (décision D4).

## 6. Ce qui est prouvé, et comment

| Preuve | Résultat |
|---|---|
| `cargo test -p aethryon-noyau` (Linux, conteneur) | **52 essais verts**, dont un sur de vrais fichiers ffmpeg (MP4 H.264/AAC 12 s 30 i/s, vertical, ProRes, M4A, WAV, PNG, JPEG, GIF, WebM) |
| Essais du noyau compilés POUR WINDOWS, exécutés sous Wine 8 (locale UTF-8) | **52 essais verts** aussi (chemins Unicode, écriture atomique par `MoveFileEx`, surveillance `ReadDirectoryChangesW` de Wine) ; `windows.rs` compile pour Windows |
| `vitest` (interface) | **18 essais verts** (typographie, tailles, codes temporels, dates, recherche, tri, sélection, liaison) |
| Playwright + maquette de l'API Tauri (Chromium) | 17 écrans capturés sans erreur de console ; lecture vidéo réelle (WebM), bande d'images et aperçu au survol réels, formes d'onde calculées sur de vrais MP3/WAV ; planches comparées aux maquettes |
| Wine 8 : `aethryon-desktop.exe chrome-extension://…` | hôte Native Messaging : ping, transfert écrit, champ « jeton » refusé sans écho, origine inconnue refusée, rien d'écrit hors de `transferts\` |
| Wine 8 : `aethryon-desktop.exe --diagnostic` | faux « Adobe Premiere Pro.exe » (version 26.5.2.13) trouvé dans `Program Files\Adobe`, version lue par `GetFileVersionInfoW`, compatible, glisser-déposer refusé (< 27.0) |
| Wine 8 : installateur `/S` puis désinstalleur `/S` | fichiers et clés HKCU (`ModifyPath … --reparer`, `QuietUninstallString`…) posés puis retirés ; `--desinstaller` retire clés NM et démarrage, supprime les données, garde les médias |

Wine n'est pas Windows (pas de WebView2, pas de Creative Cloud) : ces essais montrent que l'exe Windows démarre et que
sa logique système tourne, rien de plus. Sous Wine 8, un remplaçant de `bcryptprimitives.dll` (fourni par Windows
10/11, absent de Wine 8) est copié dans le `system32` de Wine pour l'essai seulement ; il n'est jamais livré.

## 7. NON TESTÉ SOUS WINDOWS (précisément)

- **Toute l'interface dans WebView2** : ouverture de la fenêtre sans cadre, glissement par la barre de titre, boutons
  de légende, coins arrondis et ombre de Windows 11, mise à l'échelle 125–200 %, thème « Système » relayé par WebView2,
  « Effets d'animation » de Windows → `prefers-reduced-motion`.
- Protocole `asset:` : miniatures, lecteur intégré (H.264/AAC, HEVC, ProRes non lu), miniatures produites par le
  WebView2 (`crossOrigin` + en-tête `Access-Control-Allow-Origin` du protocole asset, lu dans le code de Tauri 2.12.4).
- Zone de notification, instance unique (`--reparer` transmis à l'instance ouverte), notifications Windows du greffon
  Tauri (« only works for installed apps »), démarrage automatique réel au démarrage de Windows (`--arriere-plan`).
- **UPIA** : `/install`, `/list all` (format de sortie inconnu : on cherche `fr.aethryon.premiere` ou le mot AETHRYON),
  `/remove` (nom, identifiant, puis chemin) ; besoin éventuel des droits d'administrateur ou du « Developer Mode » (R9,
  R10) ; repli par ouverture du `.ccx` dans Creative Cloud.
- Détection sur un vrai PC : dossiers `Adobe Premiere Pro 2025/2026/(Beta)`, indices du registre (non documentés),
  version de fichier réelle de Premiere (format exact à relever), Premiere ouvert, Creative Cloud présent.
- Native Messaging lancé par un vrai Chrome / Edge / Brave (l'extension ne l'utilise pas encore).
- Surveillance `ReadDirectoryChangesW` (débordement de tampon, disques réseau), copie en cours qui verrouille le
  fichier, « Accès contrôlé aux dossiers » de Defender, chemins de plus de 260 caractères, noms Unicode et emoji.
- Panneau Premiere : battement `etat/panneau.json`, commande `importer` et `imports.json` (le panneau v2 est construit
  par un autre agent sur le même contrat) ; « Ouvrir Premiere Pro ».
- SmartScreen sur l'installateur non signé ; mise à jour par-dessus une version précédente.

## 8. Écarts avec les maquettes approuvées (voir `captures/comparaison-*.png`)

- **Données réelles plutôt que factices** : « Dimanche 18 octobre » (la maquette écrivait « Samedi »), version
  `1.0.0-beta.1`, nombre de transferts réellement actifs.
- **Transferts** : pas de boutons « Suspendre », « Annuler » ni « Réessayer » — le Desktop ne pilote pas le
  téléchargement du navigateur ; la progression d'un `.crdownload` est indéterminée (seule la taille reçue est
  connue) ; « 14,2 Mo reçus » au lieu de « 14,2 / 22,1 Mo ».
- **Intégrations** : « Canal local : fichiers locaux, sans port » au lieu de « Appairé le… » et pas de « Réinitialiser
  l'appairage » (le contrat v1 n'a pas d'appairage) ; ligne « Creative Cloud Desktop » à la place de « Chutier
  AETHRYON créé » (non vérifiable depuis le Desktop).
- **Installation** : l'appel à Creative Cloud est dans l'étape 2 « Installation » (comme demandé), pas dans l'étape 3 ;
  descriptions d'étapes réelles (« Premiere Pro, Creative Cloud, paquet du panneau, dossier des médias »).
- **Écran final** : « Fenêtre › UXP Plugins › AETHRYON (intitulé de la documentation d'Adobe) » au lieu de « Fenêtre ›
  Extensions › AETHRYON » (libellé français non relevé).
- **Aperçu** : pas de « Débit vidéo / audio » séparés ni de profil H.264 (« High 3.1 »), ni fréquence ou nombre de
  canaux audio : on affiche le débit moyen calculé et les codecs lus dans les en-têtes. GIF : durée non mesurée.
- **Paramètres** : « Mises à jour manuelles » sans bouton « Rechercher » (aucun service de mise à jour) ; à propos sans
  « FFmpeg : LGPL » (rien de FFmpeg n'est livré).
- **Animations** : ressorts approchés par des courbes CSS (pas de bibliothèque `motion`) ; mêmes durées et courbes que
  le système.

## 9. Décisions attendues du propriétaire

- **D2 — signature** avant toute publication (Store MSIX gratuit si Native Messaging et UPIA y fonctionnent, sinon
  certificat OV Certum ≈ 209 €/an) : rien n'est acheté. Le crochet `installateur/signer.sh` est prêt.
- **D4 — construction des versions publiées** sous Windows (MSVC) : les constructions GNU de ce serveur servent à itérer.
- **Redistribution de `WebView2Loader.dll`** : conditions de Microsoft à vérifier avant publication.
- **Identifiants d'extension** : le manifeste Native Messaging autorise production ET développement dans cette
  construction d'essai ; les versions publiées ne garderont que l'identifiant de production (contrat §8.5).
- Précisions du contrat (§4) : retenues par le directeur (contrat §8). Étape D : faite (`INTEGRATION.md`).

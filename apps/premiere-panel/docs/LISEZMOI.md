# AETHRYON pour Premiere Pro v2 — extension CEP (version 2.0.0)

> **État : construite, NON SIGNÉE ici, NON PUBLIÉE, jamais lancée dans Premiere.** Le dossier `fr.aethryon.premiere/`
> est signé en ZXP (auto-signé et horodaté) par l’étape de l’installateur (`setup/`). Rien n’a été envoyé, déployé ni
> installé. Les routes de compte `/api/premiere/*` ne sont pas encore en production (branche `feat/v2-compte`, mise en
> production sur accord du propriétaire) : d’ici là, la page Compte affiche honnêtement « Pas encore disponible ».
>
> **Intégration (2026-10-18, branche `feat/v2-integration`)** : manifeste `CSXS/manifest.xml` corrigé (le commentaire
> d’en-tête contenait « -- », ce qui le rendait mal formé) et contrôlé à chaque construction ; client d’API aligné sur
> le vrai serveur account ; bout en bout contre une pile jetable de ce serveur (§7).

Sources : branche `feat/v2-cep` puis `feat/v2-integration`, dossier `extension-premiere/`.

## 1. Ce que c’est

Une **vraie extension** (CEP 12, « extension » dans le vocabulaire d’Adobe) : une seule interface web
(Preact + TypeScript, construite par Vite pour Chromium 99) qui parle à son hôte **uniquement** par l’interface
`Hote` (`src/hote/types.ts`). Trois implémentations :

| Hôte | Fichier | Rôle |
|---|---|---|
| CEP | `src/hote/cep.ts` | Premiere 25.x–26.x : CSInterface (sous-ensemble écrit d’après celle d’Adobe), ExtendScript par appels figés, Node.js 17 |
| UXP WebView | `src/hote/uxp-webview.ts` | ébauche qui compile, pont `postMessage` documenté (voir `PLAN-COQUE-UXP.md`) |
| Maquette | `src/hote/maquette.ts` | essais et captures, aucun réseau ; jamais livrée |

Un quatrième, `banc` (`src/hote/banc.ts`), sert à l’essai de bout en bout : Premiere simulé, mais réseau et disque
réels par le **même** code Node que la coque CEP.

## 2. Contenu du dossier livré

```
fr.aethryon.premiere/
  CSXS/manifest.xml        CSXS 12, hôte PPRO [25.0,99.9], menu « AETHRYON », 480 × 760 (minimum 280 × 320)
  client/index.html        CSP stricte, script classique (pas de module ES : file:// dans CEP)
  client/assets/           aethryon.js, style-*.css, polices Inter et Playfair Display, logo officiel (SVG)
  jsx/aethryon.jsx         script hôte ExtendScript (ECMAScript 3), liste fermée de fonctions
  icons/                   icônes du panneau (chouette officielle, 23 × 23)
  LICENCES/                Inter et Playfair Display (OFL 1.1), Preact (MIT), mention de marque
```

Empreintes : `SHA256SUMS` à côté du dossier (`sha256sum -c SHA256SUMS` depuis ce dossier). Manifeste en XML bien formé
(contrôle intégré `scripts/xml-bien-forme.mjs`, recoupé par expat), aucun lien symbolique (problème connu des ZXP de
novembre 2024), aucune carte de source, aucun code de maquette (contrôlé par `scripts/construire.mjs`).

## 3. Les pages

- **Accueil** (priorité du propriétaire) : grand champ « Colle un lien YouTube, TikTok ou X » ; plateforme reconnue à la
  frappe ; carte d’aperçu (miniature servie par le serveur, titre, durée) ; Vidéo MP4 / Audio MP3, qualité (tailles
  estimées), extrait facultatif (début, fin, jusqu’à 3 min en MP4, 10 min en MP3) ; « Importer dans Premiere » :
  conversion sur le serveur AETHRYON (`transcode: true`, MP4 H.264 + AAC), téléchargement en flux dans le dossier des
  médias (`<nom>.aethryon.part` puis renommage, jamais d’écrasement), import dans le chutier « AETHRYON » ou le
  chutier sélectionné ; progression réelle en trois étapes ; toast de succès réel (« Moniteur source ») ; la carte du
  clip arrivé est glissable vers la timeline ; imports récents sous le champ (à défaut, les derniers fichiers du
  dossier) ; annulation (le serveur est prévenu).
- **Bibliothèque** : grille ou liste virtualisées ; recherche sans accents (après 120 ms), filtres par type, état et
  source, tri ; miniatures fabriquées dans le panneau (`<video>` + canvas, cache disque) ; aperçu dans le panneau
  (lecture, pause, barre glissable, code temporel, J K L, ← →) ; sélection multiple (Ctrl, Maj, Ctrl A) et import
  groupé ; « Insérer à la tête de lecture » (clic explicite) ; moniteur source ; Explorateur ; copier le chemin ;
  **glisser vers le panneau Projet et la timeline** (`com.adobe.cep.dnd.file.N` + `text/uri-list` + `text/plain`, chacun
  dans un `try`, fichiers complets et présents seulement) ; états Disponible / En cours / Importé (vérifié dans le
  projet) / Introuvable / Erreur.
- **Compte** : connexion par page d’accord (V2-CONNEXION.md) : le navigateur par défaut s’ouvre sur
  `…/premiere/connecter?code=…`, le panneau montre le code et interroge `/api/premiere/jeton` (428 ; 429 : attente du
  `Retry-After` ; 403 refusé ou compte suspendu ; 409 trois ordinateurs, bouton « Mes jetons » ; 410 expiré ou déjà
  utilisé ; 400 code inconnu ; 404 « Pas encore disponible ») ; clé enregistrée **protégée par DPAPI** (PowerShell, la clé passe par l’entrée standard
  en base64, jamais en argument) ou, à défaut, fichier du profil réservé à l’utilisateur (`icacls`) ; quota du jour ;
  5 dernières conversions ; « Se déconnecter » révoque la clé sur le serveur puis l’efface du PC.
- **Réglages** : dossier des médias (défaut `%USERPROFILE%\Downloads\AETHRYON`, ou celui d’AETHRYON Desktop) ; chutier ;
  format et qualité par défaut ; import automatique des fichiers envoyés par le navigateur **désactivé par défaut** ;
  « Réduire les animations » (Système, Oui, Non) ; langue Français ; état d’AETHRYON Desktop (facultatif).
- **Diagnostic** : essai unique produisant un rapport copiable (aussi enregistré dans
  `%LOCALAPPDATA%\AETHRYON\journaux\`) : versions, signature et PlayerDebugMode, pont ExtendScript, lecture d’un MP4
  H.264/AAC **local** + miniature, `importFiles` dans un chutier temporaire puis nettoyage, réseau, dossier, protection
  de la clé, et **glisser vers le panneau Projet et la timeline** prouvé en relisant le projet et la séquence.

## 4. Sécurité

- Jamais `PlayerDebugMode`, jamais `--disable-web-security` ni `--mixed-context` ; Node par `--enable-nodejs` ;
  `--allow-file-access-from-files` pour lire les médias locaux et en tirer des miniatures.
- ExtendScript : un seul point d’entrée `AETHRYON.appel("<nom>", "<charge>")`, nom comparé à une liste fermée, charge
  JSON encodée par `encodeURIComponent` (seuls `[A-Za-z0-9-_.!~*'()%]` passent), lue par un analyseur JSON sans `eval`.
  Aucun script chargé à distance, aucun `eval` dans le paquet (contrôlé à la construction).
- Réseau par Node : https seulement ; la clé ne part que vers les deux origines configurées (le panneau reconstruit
  l’adresse du fichier au lieu de suivre `file_url`, et ne suit aucune redirection) ; aucun cookie.
- La clé n’est jamais affichée, jamais journalisée (`src/lib/journal.ts` masque `ytc_…`, `Bearer …`, les champs
  sensibles et les valeurs déclarées) ; vérifié par les essais unitaires et de bout en bout.
- Processus : `execFile` avec arguments en tableau (jamais de shell) pour PowerShell, `icacls`, `reg query`,
  `explorer.exe /select,`.
- Le panneau ne supprime que ses propres fichiers (cache, essais du diagnostic, `.aethryon.part`).

## 5. Serveur attendu

| Service | Route | Usage |
|---|---|---|
| ytapi (`https://api.malvu.fr/media`) | `GET /health` | diagnostic |
| | `POST /preview`, `GET /preview/thumbnail/{id}` | carte d’aperçu |
| | `POST /jobs`, `GET /jobs/{id}?wait=25&change=true`, `GET /jobs/{id}/file`, `DELETE /jobs/{id}` | conversion, suivi par attente longue, fichier, annulation |
| compte (`https://raccourci.malvu.fr`) | `POST /api/premiere/appairage`, `POST /api/premiere/jeton` | V2-CONNEXION.md |
| | `GET /api/premiere/moi`, `POST /api/premiere/deconnexion` | routes **réelles** de `feat/v2-compte` (note d’API de V2-CONNEXION.md) ; corps strict de l’appairage `{hote, versionPremiere, versionExtension}` ; un seul endroit : `ROUTES` dans `src/api/client.ts` |
| | page `/premiere/connecter?code=…`, `/dashboard/cles` (« Mes jetons ») | navigateur par défaut |

Tant que les routes `/api/premiere/*` n’existent pas en production (404), ou que la connexion n’y est pas ouverte
(`404 premiere_closed`), la page Compte affiche « Pas encore disponible » et dit que la bibliothèque, l’aperçu, le
glisser-déposer et l’import de fichiers locaux fonctionnent sans compte. Appels par Node seulement (aucun CORS côté
serveur), sans en-tête Origin ni cookie.

## 6. Fichiers écrits sur le PC

| Fichier | Contenu |
|---|---|
| `%USERPROFILE%\Downloads\AETHRYON\*.mp4|mp3` | médias convertis (dossier réglable, partagé avec l’extension navigateur et Desktop) |
| `%APPDATA%\AETHRYON\premiere\cle.dpapi` (ou `cle.json` en repli) | clé « premiere » protégée |
| `%APPDATA%\AETHRYON\premiere\reglages.json`, `recents.json` | réglages, imports récents |
| `%LOCALAPPDATA%\AETHRYON\premiere\miniatures\` | miniatures et mesures en cache |
| `%LOCALAPPDATA%\AETHRYON\premiere\diagnostic\` | petits MP4 d’essai du diagnostic |
| `%LOCALAPPDATA%\AETHRYON\journaux\panneau-AAAA-MM-JJ.log`, `diagnostic-*.txt` | journal sans secret, rapports |
| `%LOCALAPPDATA%\AETHRYON\etat\panneau.json`, `imports.json` | seulement si AETHRYON Desktop est installé (contrat v1.1) |

**AETHRYON Desktop est facultatif** : le panneau lit son index et son battement s’ils existent (métadonnées,
miniatures, « Connecté »), sinon il lit lui-même le dossier. Depuis la 2.0.1, il traite la seule commande `importer`
que lui envoie le Desktop (contrat §5, §9 : relève de `commandes\a-traiter\` chaque seconde tant que le panneau est
chargé, prise par renommage dans `commandes\traitees\`, identifiants relus dans l'index, import habituel puis résultat
réel ; « Aucun projet ouvert dans Premiere Pro. » sans projet ; `expire: true` après 2 minutes). Aucune autre action.

## 7. Ce qui est prouvé, et comment

| Preuve | Commande | Résultat |
|---|---|---|
| 78 essais unitaires (2026-10-18, intégration) : manifeste en XML bien formé (16 essais du contrôle, dont l’ancien en-tête fautif refusé), client d’API contre un faux serveur calqué sur le vrai account (routes `moi`/`deconnexion`, corps strict, chaque code d’erreur et son message), téléchargement (.part, renommage, coupure, annulation, redirection refusée, noms Windows), déduplication, recherche/filtres/tri, clé (DPAPI simulé, repli 0600) jamais journalisée, script ExtendScript en ES3 exécuté sur un faux Premiere, coque CEP entière sur faux Premiere et vrai Node, typographie française, compatibilité Chromium 99 | `npm test` | 78/78 |
| Rendus de 23 états (dont « Pas encore disponible ») × 300, 480 et 960 px, sans erreur de page ni débordement (contrôle automatique) ; relus à l’œil contre les maquettes et les reproches du propriétaire | `npx vite build --mode maquette && node tests/e2e/rendus.mjs` | 69/69 |
| Bout en bout dans Chromium, vrai code Node : faux serveur (connexion par page d’accord, aperçu, conversion, `.part`, import, bibliothèque, formats du glisser, insertion, import automatique, déconnexion révoquée) puis **préproduction** (compte `cep-e2e@preprod.test`, clé créée puis révoquée, faux worker : aperçu, extrait 0:00–0:01, MP4 **H.264 + AAC** vérifié par ffprobe, miniature fabriquée dans le panneau) | `node tests/e2e/bout-en-bout.mjs` | 31/31 (feat/v2-cep) |
| **Bout en bout C (2026-10-18)** contre une **pile jetable** de la branche d’intégration : VRAI account (migration 012, `PREMIERE_CONNEXION=1`) derrière le vrai site, VRAI ytapi au faux worker. Appairage au corps strict (200) ; accord sur la **vraie page `/premiere/connecter`** (utilisateur d’essai connecté) ; clé reçue une fois (428 puis 200), fichier 0600 ; `/moi` 200 ; « Mes jetons » liste « Premiere Pro · BANC-E2E » ; aperçu ; conversion `transcode: true` ; MP4 **H.264 + AAC** (ffprobe) ; import simulé ; déconnexion 204 puis clé refusée par ytapi (`/preview`, `/jobs` 401) et `/moi` (`token_revoked`) ; aucun secret dans les journaux du panneau ni des 3 conteneurs | `PILE=… PILE_SITE=… PILE_API=… node tests/e2e/bout-en-bout.mjs --sans-preprod` | A 23/23 + C 16/16 |

Captures : `captures/` ; journaux des essais : `essais/`.

## 8. NON TESTÉ DANS PREMIERE

Rien de ce qui suit n’a tourné dans Premiere (impossible ici) ; c’est l’objet du diagnostic intégré et de la séance E0 :

1. Chargement de l’extension signée sans PlayerDebugMode (E1).
2. ExtendScript réel : `importFiles`, `createBin`, `getInsertionBin`, `deleteBin`, `Track.insertClip`,
   `getPlayerPosition`, `sourceMonitor.openFilePath`, `isOffline` (logique essayée sur un faux modèle seulement).
3. Glisser vers le panneau Projet et la timeline (`com.adobe.cep.dnd.file.N` : communauté, non documenté) (E2).
4. Lecture `<video>` d’un MP4 local et miniature par canvas dans CEP 12 / Chromium 99 (E3) ; les essais ont tourné
   dans le Chromium récent de Playwright, pas dans Chromium 99.
5. Node 17.7.1 de CEP (les essais Node ont tourné en Node 22 ; aucune API postérieure n’est utilisée).
6. DPAPI réel par PowerShell et `icacls` (simulés dans les essais).
7. Événements CEP : visibilité du panneau, menu du panneau, `registerKeyEventsInterest` (J K L).
8. Ouverture du navigateur par défaut (`cep.util.openURLInDefaultBrowser`), dialogue de dossier (`cep.fs`).

## 9. Le faire tourner chez le propriétaire (après signature)

1. Installer par le setup (ZXP signé extrait dans `%APPDATA%\Adobe\CEP\extensions\fr.aethryon.premiere`).
2. Premiere › Fenêtre › Extensions › **AETHRYON**.
3. Ouvrir un projet et une séquence, puis Réglages › Diagnostic › « Lancer le diagnostic », faire les deux essais de
   glisser, puis « Copier le rapport » et l’envoyer.

## 10. Reconstruire

```
cd extension-premiere
npm ci
npm test
node scripts/construire.mjs --livrer <dossier de livraison>
```

La construction est déterministe (mêmes sources → mêmes empreintes).

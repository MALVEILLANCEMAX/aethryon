# Extension AETHRYON (Chrome, Edge, Brave — Manifest V3)

Architecture : `../docs/EXTENSION.md`. Distribution : `../docs/EXTENSION-STORE.md` (décision du 2026-10-11 :
**distribution directe depuis le site, jamais sur un store**). Journal des versions : `CHANGELOG.md`.

**Statut : version 1.0.0, en développement.** L'extension n'est publiée nulle part. Le ZIP se télécharge sur
https://raccourci.malvu.fr/extension une fois la page mise en ligne, et la connexion au compte ne fonctionne
qu'après le déploiement de la partie serveur (`../docs/DEPLOIEMENT.md` §14, validation du propriétaire) : avant,
l'extension le dit clairement (« La connexion de l'extension n'est pas encore disponible sur le site AETHRYON »).

Convertis seulement des contenus pour lesquels tu disposes des droits nécessaires ; l'installation hors store ne
change rien aux conditions de YouTube, TikTok et X.

## Installer l'extension sur ton ordinateur

Pour Chrome ou Microsoft Edge 140 ou plus récent, ou Brave à jour, sur ordinateur (pas sur téléphone). Aucune mise à
jour automatique : l'extension te prévient quand une nouvelle version est disponible, et tu la remplaces toi-même.
Libellés vérifiés dans l'interface française de Chromium 153 (`tests/browser/install.test.mjs`) ; Edge et Brave
d'après leurs documentations officielles, **non vérifiés sur un vrai navigateur** (`../docs/AUDIT-SECURITE-EXTENSION.md`).

1. Télécharge `aethryon-extension-<version>.zip` sur la page de l'extension, et le fichier `SHA256SUMS` qui
   l'accompagne. Ne la télécharge nulle part ailleurs : une extension chargée en mode développeur n'est examinée par
   personne, et le navigateur ne demande aucune confirmation de ses autorisations.
2. Vérifie l'archive (facultatif, recommandé) :
   - Linux : `sha256sum -c SHA256SUMS --ignore-missing` doit afficher `aethryon-extension-<version>.zip: OK` ;
   - macOS : `shasum -a 256 aethryon-extension-<version>.zip`, puis compare avec la ligne du fichier `SHA256SUMS` ;
   - Windows (PowerShell) : `Get-FileHash .\aethryon-extension-<version>.zip -Algorithm SHA256`, puis compare de même
     (PowerShell affiche l'empreinte en majuscules : seule la valeur compte).
3. Décompresse l'archive dans un dossier **que tu garderas** (par exemple `Documents\AETHRYON`) : le navigateur lit
   l'extension depuis ce dossier à chaque démarrage.
4. Ouvre la page des extensions : `chrome://extensions` (Chrome), `edge://extensions` (Edge), `brave://extensions`
   (Brave).
5. Active le **mode développeur** (interrupteur en haut à droite dans Chrome et Brave, en bas du panneau de gauche
   dans Edge) et **laisse-le activé** : depuis Chrome 134, une extension chargée ainsi est désactivée quand il est
   coupé (Chrome la signale alors aussi comme « potentiellement dangereuse » dans son contrôle de sécurité, vu dans
   Chromium 153). Edge affiche un avertissement permanent tant qu'une extension du mode développeur est active.
6. Clique sur « Charger l'extension non empaquetée » (Chrome, Brave) ou « Charger l'extension décompressée »
   (« Load unpacked » dans un Edge en anglais), et choisis le dossier décompressé (celui qui contient `manifest.json`).
7. Vérifie l'identifiant affiché sur la carte : `necpohicddjeaeaaomaakehcbccapabg`. C'est l'identifiant de cette
   version ; le serveur AETHRYON l'accepte une fois la partie serveur de la connexion déployée (§14 ci-dessus). Un autre
   identifiant ne pourra pas se connecter.
8. La page d'accueil de l'extension s'ouvre : elle confirme l'installation et la version, montre comment
   **épingler** l'icône (pièce de puzzle › punaise ; dans Edge : bouton « Extensions » › œil « Afficher dans la barre
   d'outils » ; ou « Détails » › « Épingler à la barre d'outils ») — l'état est lu dans le navigateur —, puis la
   **notice sur tes données**. Rien n'est envoyé à un serveur avant que tu cliques sur « Accepter ».
9. « Se connecter à AETHRYON » : une fenêtre du site s'ouvre ; connecte-toi si besoin, puis clique sur
   « Autoriser ». Même compte et même quota que le raccourci iPhone.

Mettre à jour : quand le popup affiche « Nouvelle version X.Y.Z disponible », ouvre la page de téléchargement,
remplace le contenu du dossier chargé (celui qui contient `manifest.json`) par celui de la nouvelle archive
(`manifest.json` doit rester directement dans ce dossier), puis clique sur l'icône ↻ « Actualiser » de la carte AETHRYON (Chrome, Brave) ou sur son lien « Recharger »
(« Reload », Edge). Recharge les onglets YouTube, TikTok ou X déjà ouverts. Connexion, accord à la notice et réglages
sont conservés (vérifié dans Chromium : `tests/browser/install.test.mjs`). **Ne supprime pas l'extension pour la mettre
à jour** : la supprimer efface sa connexion et ses réglages. L'extension ne télécharge et n'installe jamais rien
d'elle-même.

Désinstaller : déconnecte-toi d'abord (popup › « Se déconnecter » : la clé est révoquée sur le serveur), puis
« Supprimer » dans la page des extensions et supprime le dossier. Supprimée sans déconnexion, sa clé reste valable
jusqu'à son expiration : révoque-la dans « Mes jetons » › « Extensions connectées ».

## Construire et empaqueter

```bash
npm ci
npm run build          # version distribuée : production, clé « installation locale » (identifiant stable) → dist/
npm run build:dev      # préproduction (127.0.0.1:18111, localhost:18110 ; AETHRYON_API, AETHRYON_SITE,
                       # AETHRYON_UPDATE_URL pour une autre pile de test) → dist-dev/
npm run package        # build de production + release/ :
                       #   aethryon-extension-<version>.zip (reproductible : entrées triées, 1980-01-01, 0644),
                       #   SHA256SUMS (format sha256sum), latest.json (version, fichier, empreinte, taille, date,
                       #   Chrome minimal, notes tirées de CHANGELOG.md)
```

Nouvelle version : changer `version` dans `package.json` (seule source : le manifeste la reprend), ajouter sa
section `## <version> — AAAA-MM-JJ` en tête de `CHANGELOG.md`, puis `npm run package`. Le build de production
refuse toute adresse de test, carte de sources ou fichier source ; `release/` et `dist*/` ne sont pas versionnés.
La marque vient de `brand/master` : `python3 ../brand/master/tools/export_web.py --extension` régénère
`src/shared/brand-head.ts` (tête maître, petit logo, liseré, logotype), les icônes sont lues dans
`brand/master/png`.

## Tests

```bash
npm run typecheck && npm test   # unitaires (service worker simulé, notice, connexion, avis de version, marque,
                                # pictogrammes v3 = ceux du site)
npm run test:release            # paquet : deux constructions → même SHA-256, contenu, manifeste (CSP, Chrome 140),
                                # icônes, latest.json
npm run test:browser            # Chromium réel : popup, réglages, accueil, intégrations (pages fabriquées),
                                # connexion réelle et erreurs de connexion, téléchargements réels, sessions,
                                # ZIP distribué chargé tel quel, installation et mise à jour dans chrome://extensions
                                # en français (install), essais de sécurité du protocole (securite),
                                # destination Premiere Pro : fichiers écrits dans Téléchargements/AETHRYON (premiere)
```

Les tests navigateur qui parlent au compte et à ytapi visent une pile de préproduction ISOLÉE (site
`http://localhost:18110`, ytapi à faux worker `http://127.0.0.1:18111`) ; voir `../docs/TESTS.md`.

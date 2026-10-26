# Démonstration du ZIP final contre une pile jetable (aucune production touchée)

Le **vrai ZIP** (`extension/release/`, reproductible) est servi par la page `/extension` d'un site construit avec
`EXTENSION_DOWNLOAD=1`, téléchargé par son bouton, décompressé et chargé dans Chromium. Il parle à une pile jetable
(`ytc2-dx-*` : site, account avec la migration 004, ytapi à **faux worker**) comme à la production. Le relais TLS local
`dx-proxy.mjs` répond pour `raccourci.malvu.fr` et `api.malvu.fr` (préfixe `/media` retiré comme Traefik). Le
navigateur de test y est dirigé par `--host-resolver-rules` ; tout autre nom est introuvable. Les pages YouTube et
TikTok sont **fabriquées** (`tests/fixtures`) et servies par interception.

```bash
# depuis la racine du dépôt (branche d'intégration)
(cd extension && npm ci && npm run package)                   # ZIP reproductible + SHA256SUMS + latest.json
EXTENSION_DOWNLOAD=1 bash web/scripts/fetch-downloads.sh
docker build -q -t ytc2-account:dx account
docker build -q --target preprod -t ytc2-ytapi:dx ytapi
docker build -q --build-arg EXTENSION_DOWNLOAD=1 --build-arg ACCOUNT_UPSTREAM=ytc2-dx-account:3000 --build-arg REAL_IP_FROM=127.0.0.1/32 -t ytc2-web:dx web
bash extension/tests/demo/dx-stack.sh up                      # aucun label, réseaux et volumes propres, 127.0.0.1 seulement
node extension/tests/demo/dx-proxy.mjs &                      # relais TLS 127.0.0.1:18199
node extension/tests/demo/demo-zip-final.mjs                  # 55 contrôles, captures dans demo-out/
                                                              # (DX_STATE : mode.json et journal du relais ; DEMO_OUT : captures)
bash extension/tests/demo/dx-stack.sh down; pkill -f dx-proxy.mjs
```

- **Session de test** : l'outil `create-test-session` refuse une `PUBLIC_URL` en https (garde contre la production).
  La démonstration le lance avec `PUBLIC_URL` surchargée pour ce seul processus, dans le conteneur jetable : même
  base, même secret. Le cookie reçoit le préfixe `__Secure-` qu'attend account en https. La connexion Google
  elle-même n'est pas rejouée.
- **ytapi** : l'image de préproduction omet `--root-path` dans sa commande ; `dx-stack.sh` la relance avec le même
  `--root-path /media` que la production (`entrypoint.sh`). Sans cela, l'extension refuse l'adresse du fichier
  (contrôle de sécurité `safeFileUrl`), comme il se doit.
- **Requêtes** : aucune lecture par Node des noms de production. Les fichiers servis sont lus **par le
  navigateur**, à travers le relais.
- **Parties** : A page `/extension` et téléchargement réel du ZIP (empreinte affichée = archive = `latest.json` = release de
  la branche) ; B contenu de l'archive ; C extension chargée depuis le ZIP téléchargé (notice, connexion PKCE, conversions,
  quota, « Mes jetons », révocation, pannes, déconnexion) ; D avis de nouvelle version ; E cohérence du site publié
  (`EXTENSION_DOWNLOAD=1`) : statuts de l'accueil, onglet « Extension », feuille de route, FAQ, confidentialité, guide
  « Bien démarrer », « Mes jetons ».

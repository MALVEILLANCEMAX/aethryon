# account — comptes Google, jetons API, quotas

Service Node 22 (TypeScript compilé, Hono, Better Auth 1.7.7 + @better-auth/api-key 1.7.7, SQLite via
`node:sqlite`). Contrat : `../docs/CONTRAT.md` §3 à §7.

## Ports

- **3000** — API publique `/api/*`, servie derrière le nginx du site (même origine).
- **3001** — API interne `/internal/v1/*` pour ytapi : réseau Docker interne seulement, en-tête
  `X-Internal-Token` comparé à temps constant (empreintes SHA-256 de même longueur).
- **3002** — API interne du bot Discord `/internal/v1/discord/*` (`src/discord-internal.ts`) : ouverte seulement
  si `DISCORD_INTERNAL_TOKEN_FILE` existe ; secret PROPRE au bot (`X-Bot-Token`), sous-réseau
  `DISCORD_INTERNAL_ALLOW_FROM` ; le secret de ytapi ne l'ouvre pas, et inversement (docs/DISCORD-BOT.md §17).

## Liaison Discord (`src/discord.ts`, migration 005)

OAuth2 « code » depuis le site (scope `identify`, `state` à usage unique lié au compte ET à la session, 10 min,
empreinte seule en base ; jeton d'accès Discord jeté après `/users/@me`) ; clés `ytc_` « discord » de 15 min pour
le bot (même quota, même historique) ; lien de téléchargement à usage unique relayé depuis ytapi (la clé ne sort
jamais d'account). Fermée proprement tant que `DISCORD_CLIENT_SECRET_FILE` manque. Tests : `test/discord.test.ts`
(faux Discord local `test/fake-discord.ts`, aucune requête vers Discord), `test/migration-005.test.ts`.

## AETHRYON pour Premiere Pro (`src/premiere.ts`, migration 012)

Connexion du panneau Premiere par une page d'accord (inspirée de la RFC 8628) : `POST /api/premiere/appairage`
(code d'appareil de 32 octets, seule son empreinte est gardée ; code utilisateur « ABCD-EFGH », 10 min), accord sur
`/premiere/connecter` (`/api/premiere/demande|autoriser|refuser`, session + CSRF), `POST /api/premiere/jeton`
(428 en attente, 200 clé « premiere » une seule fois, 403 refusé, 410 expiré ou déjà utilisé — la clé remise est
alors révoquée —, 429 trop rapide), `GET /api/premiere/moi`, `POST /api/premiere/deconnexion`. Clé de 30 jours, au
plus 3 par compte, même quota qu'une clé d'extension. Fermée tant que `PREMIERE_CONNEXION` ≠ 1. Tests :
`test/premiere.test.ts`.

## Sécurité (choix et raisons)

- Google seulement, PKCE + `state`, scopes `openid email profile` ; e-mail non vérifié refusé ;
  jetons Google jamais stockés (hooks qui les mettent à null, `updateAccountOnSignIn: false`) ; avatar
  non stocké ; liaison de comptes désactivée ; `disableIdTokenSignIn`.
- Cookies `HttpOnly`, `SameSite=Lax`, `Secure` + préfixe `__Secure-` en https ; sessions 30 jours.
- CSRF : vérification d'origine de Better Auth **et** middleware propre (Origin = `PUBLIC_URL`,
  JSON obligatoire hors routes Better Auth, types « simples » refusés).
- Routes du plugin `/api/auth/api-key/*` fermées : tout passe par `/api/keys` (plafond, validation,
  révocation datée). Limite de vérification par clé du plugin désactivée (10/jour par défaut !).
- Clés : `ytc_` + 64 lettres, empreinte SHA-256 seulement, secret renvoyé une seule fois.
- Deux connexions SQLite : « auth » (Better Auth, transactions asynchrones) et « app » (transactions
  métier synchrones, réessais asynchrones si le verrou est pris) : jamais d'entrelacement.
- Quota atomique (`BEGIN IMMEDIATE`) ; jour métier Europe/Paris.
- Journaux JSON sans cookies, jetons, secrets ni e-mails (filtrage + masquage de motifs).

## Variables

Voir `../docs/CONTRAT.md` §3. Les secrets sont lus dans des fichiers (`*_FILE`). Google est désactivé
proprement tant que `GOOGLE_CLIENT_ID_FILE` / `GOOGLE_CLIENT_SECRET_FILE` sont absents ou vides.
`TECH_MAX_ACTIVE_PER_USER` (défaut 5, 1–20) : plafond technique de jobs actifs par utilisateur, jamais
levé par le rôle admin (docs/ADMIN.md §3).

## Administration (Control Center, `../docs/ADMIN.md`)

- Rôle en base (`user.role`) ; `ADMIN_EMAILS` = liste d'amorçage (promotion à la création d'une session
  si l'e-mail est vérifié et lié à Google ; jamais de rétrogradation automatique).
- API `/api/admin/*` (`src/admin.ts`) : garde unique 401/403, limiteur 60 mutations/min/admin, journal
  `ytc_admin_event` (acteur, cible, résultat, avant/après). `GET /api/admin/session` → 204/401/403 sans
  corps, pour l'`auth_request` de nginx.
- Quotas effectifs : `UsageService.policyFor()` (admin ou illimité ⇒ pas de limite quotidienne ni
  commerciale ; `TECH_MAX_ACTIVE_PER_USER` toujours appliqué). Pour un quota illimité, l'API interne
  annonce `limits.daily = remaining_today = 1000000` (ytapi ne décide que sur `max_active`) et `/api/me`
  renvoie `today.limit = today.remaining = null`, `today.unlimited = true`.
- État de ytapi par son API interne (`YTAPI_INTERNAL_URL/internal/v1/*`, jeton interne, délai 3 s) ; le
  jeton n'est jamais envoyé à une adresse `https://` (publique, via Traefik).

## Commandes

```bash
npm ci && npm run build      # dist/
npm test                     # 210 tests (node:test, base temporaire, faux Google, faux ytapi, faux Discord)
npm run typecheck
node dist/main.js            # démarrage (migrations Better Auth puis migrations propres)
node dist/tools/migrate.js up | down 1 | status
node dist/tools/backup.js    # VACUUM INTO $BACKUP_DIR, 14 conservées
node dist/tools/restore.js <fichier> --force   # service arrêté
node dist/tools/purge.js     # rétention (aussi faite chaque jour par le service)
node dist/tools/admin.js grant --email <adresse>   # rôle admin (Google vérifié exigé ; 0 fait, 1 refusé, 2 usage)
node dist/tools/admin.js list                      # administrateurs actuels
YTC_ALLOW_TEST_SESSIONS=1 node dist/tools/create-test-session.js --email x@y.test --out f   # préprod seulement
```

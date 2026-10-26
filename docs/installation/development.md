# Development setup

This guide starts the website, the account service and the media API on your machine. Everything stays on
`127.0.0.1`; the media API uses a **fake worker**, so no request ever reaches YouTube, TikTok, X or any other platform.

## Prerequisites

- Docker with `docker-compose` 1.29+ (or Docker Compose v2: replace `docker-compose` by `docker compose`)
- GNU Make, Bash
- Node.js 22 and npm (unit tests and app builds)
- Python 3.11+ (error-code check, Shortcut tools)
- Rust stable (only for `apps/desktop` and `apps/setup`)

## 1. Configure

```bash
cp .env.example .env     # ports, admin e-mail, optional Discord ids — all example values
make dev-secrets         # random secrets in .dev/secrets/ (git-ignored, values never printed)
```

`make dev-secrets` creates:

| File | Used by |
|---|---|
| `.dev/secrets/account/better_auth_secret` | account (session signing) |
| `.dev/secrets/account/account_internal_token` | account and media-api (private API) |
| `.dev/secrets/media-api/tokens` | media-api admin token labelled `dev` |

## 2. Build and start

```bash
make dev-build           # copies the signed Shortcut into the web build, builds the three images
make dev-up              # starts web, account and media-api
```

| URL | What |
|---|---|
| http://localhost:18110 | Website and account API (`/api/*`) |
| http://127.0.0.1:18111 | Media API (fake worker) — `GET /health` |

Ports and the private subnet can be changed in `.env` (`DEV_WEB_PORT`, `DEV_API_PORT`, `DEV_INTERNAL_SUBNET`).

## 3. Try it

Without Google or SMTP credentials, sign-in is closed and the site says so. You can still browse every public page,
download the Shortcut from `/installer`, and call the media API with the local admin token:

```bash
TOKEN=$(cut -d' ' -f2 .dev/secrets/media-api/tokens)      # stays in your shell, never commit it
curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=aqz-KE-bpKQ","fmt":"mp3"}' \
  'http://127.0.0.1:18111/jobs?wait=5'
unset TOKEN
```

The fake worker answers with a small local file: the flow is real, the media is not downloaded.

## 4. Optional integrations

Each integration is disabled until its credentials exist. Use **test** credentials only, and add the variables with a
`docker-compose.override.yml` next to `compose.dev.yml` (keep it out of Git):

```yaml
services:
  account:
    environment:
      SMTP_HOST: smtp.example.com
      SMTP_USER: example-user
      SMTP_PASSWORD_FILE: /run/secrets/smtp_password
      MAIL_FROM: "AETHRYON <noreply@example.com>"
```

| Integration | Variables (see `apps/account/.env.example`) | Secret files in `.dev/secrets/account/` |
|---|---|---|
| Google sign-in | `GOOGLE_CLIENT_ID_FILE`, `GOOGLE_CLIENT_SECRET_FILE` (already set) | `google_client_id`, `google_client_secret` |
| E-mail sign-up | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD_FILE`, `MAIL_FROM` | `smtp_password` |
| Discord login / linking | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET_FILE`, `DISCORD_LOGIN` | `discord_client_secret` |
| Stripe (test mode) | `BILLING=test`, `STRIPE_SECRET_KEY_FILE`, `STRIPE_WEBHOOK_SECRET_FILE` | `stripe_secret_key` (`sk_test_…`), `stripe_webhook_secret` |
| S3 / Backblaze B2 | `CLOUD=on`, `CLOUD_S3_*` | `s3_access_key_id`, `s3_secret_access_key` |
| Spotify import | `MUSIC_ENABLED`, `MUSIC_SPOTIFY_*_FILE` (media-api) | in `.dev/secrets/media-api/` |

Google OAuth: create a *Web application* client in Google Cloud with the redirect URI
`http://localhost:18110/api/auth/callback/google`.

## 5. Database and migrations

account stores everything in one SQLite file (`/data/account.sqlite` in the `account-data` volume). Migrations are
versioned SQL files in `apps/account/src/migrations/` (`NNN_name.up.sql` + `NNN_name.down.sql`) applied automatically
at start-up; the table `ytc_migration` records them. **Never** copy a production database into a development
environment, and never commit a `.sqlite` file.

Reset the local database: `make dev-down && docker volume rm aethryon-dev_account-data`.

## 6. Tests

```bash
make test                # everything that runs offline
make test-account        # or one component at a time
```

The media API tests run in a container **without network** (`docker run --network none`).

## 7. Discord bot (optional)

Create your own application in the Discord Developer Portal, put the bot token in
`.dev/secrets/discord-bot/discord_bot_token`, set `DISCORD_CLIENT_ID` and `DISCORD_GUILD_ID` in `.env`, then:

```bash
docker-compose -p aethryon-dev -f compose.dev.yml --profile discord up -d discord-bot
```

See [`apps/discord-bot/README.md`](../../apps/discord-bot/README.md) for command registration.

## 8. Browser extension against the local stack

```bash
cd apps/extension && npm ci && npm run build:dev    # endpoints: http://localhost:18110 and http://127.0.0.1:18111
```

Load `apps/extension/dist-dev` as an unpacked extension (developer mode). Its fixed development ID
(`dnllfjakdgmgfiompaheickmbjjlgjdc`) is the one allowed by `EXTENSION_IDS` in `compose.dev.yml`.

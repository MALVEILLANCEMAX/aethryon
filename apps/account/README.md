# AETHRYON account service

Accounts, sessions, personal keys, quotas, history, the admin Control Center API, billing, Discord linking and device
sign-in for Desktop and the Premiere panel.

Node 22 (TypeScript compiled) · [Hono](https://hono.dev) · [Better Auth](https://www.better-auth.com) with the API-key
plugin · SQLite through `node:sqlite` · Stripe SDK · AWS S3 SDK (for the optional Cloud).

## Ports

| Port | API | Reachable from |
|---|---|---|
| 3000 | Public API `/api/*` | the website's nginx only (same origin) |
| 3001 | Internal API `/internal/v1/*` for the media API | private network, `X-Internal-Token`, `INTERNAL_ALLOW_FROM` |
| 3002 | Bot API `/internal/v1/discord/*` | private network, its own `X-Bot-Token`, only if `DISCORD_INTERNAL_TOKEN_FILE` exists |

## Security choices

- Google sign-in with PKCE and `state`, scopes `openid email profile`; unverified e-mails refused; Google tokens are
  never stored. E-mail + password sign-up with a password policy and 6-digit codes. Discord login only for an account
  already linked.
- Cookies `HttpOnly`, `SameSite=Lax`, `Secure` with the `__Secure-` prefix over HTTPS.
- CSRF: Better Auth's origin check **and** an own middleware (Origin must equal `PUBLIC_URL`, JSON bodies only).
- The plugin's own `/api/auth/api-key/*` routes are closed: keys go through `/api/keys` (limit, validation, dated
  revocation, rotation).
- Keys are `ytc_` + 64 characters, stored as SHA-256 hashes, returned once. Each key has a type (shortcut, extension,
  discord, desktop, premiere) with its own lifetime and rights.
- Quotas are reserved atomically (`BEGIN IMMEDIATE`); the business day follows Europe/Paris.
- JSON logs without cookies, keys, secrets or e-mail addresses.

## Run and test

```bash
npm ci
npm run typecheck
npm test                 # node --test, with fake Discord, Stripe, SMTP and S3 services (no network)
npm run build && npm start
```

In Docker, use the development stack from the repository root (`make dev-up`). Configuration:
[`.env.example`](.env.example) — secrets are always files (`*_FILE`).

## Database and migrations

One SQLite file (`DB_PATH`, WAL mode). Versioned, reversible migrations live in [`src/migrations`](src/migrations)
(`NNN_name.up.sql` / `NNN_name.down.sql`) and are applied at start-up; `ytc_migration` records them. Backups use
`VACUUM INTO` into `BACKUP_DIR`.

Never commit, copy or publish a real database: it contains accounts, sessions and history.

## Main modules

```
src/app.ts            HTTP routes (public API)
src/auth.ts           Better Auth setup (Google, e-mail)
src/keys.ts           personal keys
src/usage.ts          quotas, history, error texts
src/internal.ts       API for the media API (authorize, usage)
src/discord*.ts       Discord linking and the bot API
src/premiere.ts, src/desktop.ts   device sign-in (RFC 8628-style)
src/facturation.ts, src/stripe-client.ts, src/abonnement.ts   billing (off by default)
src/cloud/, src/stockage/   optional private S3 storage (off by default)
src/admin.ts, src/stats.ts  Control Center
```

# Self-hosting notes

The official service runs these same components with Docker behind a TLS reverse proxy. This repository does **not**
ship production deployment scripts: they were specific to one server and were left out on purpose. This page lists
what a production deployment needs so that you can write your own.

> [!WARNING]
> Running a media conversion service makes you responsible for how it is used. Read
> [responsible use](../legal/responsible-use.md) first, restrict access to people you trust, and respect the terms of
> the platforms you connect to.

## Checklist

1. **Reverse proxy with TLS** in front of `web` (site) and `media-api` (API). Pass the client IP in a header you
   control and set `TRUST_PROXY_IP_HEADER` (account), `REAL_IP_FROM` (web build argument) and `FORWARDED_ALLOW_IPS`
   (media-api) to your proxy's network only.
2. **Two Docker networks**: an edge network for the proxy, and a private network (`internal: true`) between account,
   media-api and the bot. Set `INTERNAL_ALLOW_FROM` / `DISCORD_INTERNAL_ALLOW_FROM` to that subnet.
3. **Secrets as files** (mode `0400`, owned by the container user), mounted read-only on `/run/secrets`:
   Better Auth secret, internal tokens, OAuth secrets, SMTP password, Stripe keys, S3 keys, bot token.
   Generate random values with `openssl rand -base64 48`.
4. **Persistent volume** for account's SQLite database and its backups. Back it up with `VACUUM INTO` (consistent
   copy) and encrypt off-site copies. Never publish it.
5. **Web build arguments** (`apps/web/Dockerfile`): `ACCOUNT_UPSTREAM`, `REAL_IP_FROM`, `CONTROL_CENTER`, `INDEXING`,
   `EXTENSION_DOWNLOAD`, `OFFRES`. Fill in the legal notices of your own service in `apps/web/src/lib/legal.tsx`
   (the build refuses placeholders unless `ALLOW_LEGAL_PLACEHOLDERS=1`).
6. **Your own client builds**: the extension's production endpoints are compiled in (`apps/extension/scripts/build.mjs`)
   and its ID is fixed by `src/manifest-key.prod.json`; generate your own key pair and change the endpoints for a
   separate deployment. The iOS Shortcut must also point to your API (`shortcuts/ios/src/AETHRYON.cherri`) and be
   signed again.
7. **Container hardening** (as in `compose.dev.yml`): read-only root filesystem, `tmpfs` for `/tmp`, `cap_drop: [ALL]`,
   `no-new-privileges`, memory/CPU/PID limits, log rotation.
8. **Updates**: rebuild the media-api image regularly (yt-dlp follows the platforms' changes) and keep Node, Python and
   base images patched.

## What is not provided

- Deployment, rollback and backup scripts of the official server.
- Production credentials of any kind.
- The production database, logs or user files.

#!/usr/bin/env bash
# Generates random LOCAL development secrets in .dev/secrets/ (git-ignored). Values are never printed.
#   account/better_auth_secret, account/account_internal_token   (read by uid 1000 inside the container)
#   media-api/account_internal_token (copy), media-api/tokens      (admin token "dev", read by uid 10001)
# Optional integrations (Google, Discord, Stripe, SMTP, S3, Spotify) are NOT created: put your own credentials
# in the files listed in .env.example if you want to try them.
set -euo pipefail
umask 077
HERE="$(cd "$(dirname "$0")/.." && pwd)"
D="$HERE/.dev/secrets"
mkdir -p "$D/account" "$D/media-api" "$D/discord-bot"
rand() { head -c 48 /dev/urandom | base64 | tr -d '\n/+='; }
[[ -s "$D/account/better_auth_secret" ]] || rand > "$D/account/better_auth_secret"
[[ -s "$D/account/account_internal_token" ]] || rand > "$D/account/account_internal_token"
cp "$D/account/account_internal_token" "$D/media-api/account_internal_token"
if [[ ! -s "$D/media-api/tokens" ]]; then
  printf 'dev %s\n' "$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" > "$D/media-api/tokens"
fi
# Containers run as fixed uids; chown needs root (or rootless Docker, where it is not required).
if [[ $(id -u) == 0 ]]; then
  chown -R 1000:1000 "$D/account" "$D/discord-bot"
  chown -R 10001:10001 "$D/media-api"
  chmod 700 "$D/account" "$D/media-api" "$D/discord-bot"
  chmod 400 "$D"/account/* "$D"/media-api/*
else
  chmod 755 "$D" "$D/account" "$D/media-api" "$D/discord-bot"; chmod 444 "$D"/account/* "$D"/media-api/*
  echo "note: not root, secrets are world-readable inside .dev/ so the containers can read them (dev only)."
fi
echo "Development secrets ready in $D (values not shown)."

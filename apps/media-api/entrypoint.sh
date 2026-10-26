#!/bin/sh
# Container entry point: a single uvicorn worker. yt-dlp is updated by rebuilding the image
# (`make update`); the root filesystem is read-only.
set -eu

# --proxy-headers + --forwarded-allow-ips: trust X-Forwarded-For only from Traefik's network so
# rate limiting sees the real client IP. --root-path: Traefik strips /media, the app still
# builds its absolute URLs (status_url, file_url) with it. --no-access-log: uvicorn would log
# query strings (?token=...); the app logs requests itself (path + token label only).
exec uvicorn app.main:app \
    --host 0.0.0.0 --port 8000 --workers 1 \
    --proxy-headers --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-127.0.0.1}" \
    --root-path "${ROOT_PATH:-}" \
    --no-access-log --no-server-header \
    --timeout-graceful-shutdown 10 \
    --log-level "$(echo "${LOG_LEVEL:-info}" | tr '[:upper:]' '[:lower:]')"

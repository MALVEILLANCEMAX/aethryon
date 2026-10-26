# API overview

AETHRYON exposes two HTTP APIs. Every client (Shortcut, extension, bot, Desktop) uses the **media API** with a
personal key; the **account API** is used by the website with a session cookie.

## Media API (`apps/media-api`)

Base URL of the official service: `https://api.malvu.fr/media`. Local development: `http://127.0.0.1:18111`.

Authentication: `Authorization: Bearer <key>` — a personal `ytc_…` key created in the website (« Mes jetons »), or an
admin token from `TOKENS_FILE` on a self-hosted instance.

| Method and path | Purpose |
|---|---|
| `GET /health` | Liveness and tool versions (no authentication) |
| `GET /status` | Service state: queue, cache, limits |
| `GET /limites` | Current limits for the caller |
| `POST /jobs?wait=20` | Create a job: `{"url": "...", "fmt": "mp4" \| "mp3" \| "gif"}`; with `wait`, short jobs return already finished |
| `GET /jobs/{id}?wait=20` | Job status (`queued`, `running`, `done`, `error`) with a `stage` and a `progress` |
| `GET /jobs/{id}/file` | Download the result (owner only) |
| `DELETE /jobs/{id}` | Cancel or delete a job |
| `GET /jobs` | The caller's recent jobs |
| `POST /jobs/{id}/derive`, `POST /jobs/{id}/keep` | Derived outputs and retention (AETHRYON Tools) |
| `GET /jobs/{id}/storyboard(.jpg)`, `GET /jobs/{id}/waveform`, `GET /jobs/{id}/media` | Previews for the editors |
| `POST /preview`, `GET /preview/thumbnail/{tid}` | Title, duration and thumbnail before converting |
| `POST /uploads`, `PUT /uploads/{id}/chunks/{n}`, `POST /uploads/{id}/complete` | Upload your own file to Tools |
| `GET /info`, `GET /dl` | Legacy synchronous endpoints |

Clips use `startMs`/`endMs` in the job body: only the requested range is fetched when the platform allows it.

Example:

```bash
curl -s -H "Authorization: Bearer $AETHRYON_KEY" -H 'content-type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=<id>","fmt":"mp3"}' \
  'https://api.malvu.fr/media/jobs?wait=20'
```

Errors are JSON objects with a stable `error` code and a user-facing `detail` text; the full list is in
[`ERREURS.md`](ERREURS.md) (French).

## Account API (`apps/account`)

Served by the website under `/api/*` (same origin, `HttpOnly` session cookie, Origin check and JSON-only bodies for
state-changing requests).

| Method and path | Purpose |
|---|---|
| `GET /api/health` | Liveness |
| `GET /api/config` | Public configuration: enabled sign-in methods, platforms, quotas, Shortcut link and version |
| `GET /api/status` | Public service status |
| `GET /api/me` | Current user, quota, linked accounts |
| `GET /api/keys`, `POST /api/keys` | List or create personal keys (the secret is returned once) |
| `POST /api/keys/{id}/revoke`, `POST /api/keys/{id}/rotate` | Revoke or rotate a key |
| `GET /api/activity` | Conversion history |
| `GET /api/account/export` | Export of the user's own data |
| `/api/auth/*` | Better Auth routes (Google, e-mail, sign-out) |

Internal APIs (`:3001` for the media API, `:3002` for the bot) are only reachable on the private Docker network and
require their own shared secrets; they are not part of the public contract.

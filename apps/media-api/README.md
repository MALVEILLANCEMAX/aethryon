# AETHRYON media API

The conversion service behind every AETHRYON client. It receives a public link, downloads the media with
[yt-dlp](https://github.com/yt-dlp/yt-dlp), converts it with FFmpeg, and serves the file to the job owner for a
limited time.

Python 3.12 · FastAPI · uvicorn (one worker) · yt-dlp · FFmpeg · read-only container, non-root user.

> [!IMPORTANT]
> Use this service only for content you own or are allowed to download, and respect the platforms' terms
> ([responsible use](../../docs/legal/responsible-use.md)). Tests and the development stack never contact a platform.

## What it does

- **Jobs**: `POST /jobs` creates a job (MP4, MP3 or GIF; clips with `startMs`/`endMs`); `GET /jobs/{id}` follows it;
  `GET /jobs/{id}/file` downloads the result. Short jobs finish within the `wait` window. Endpoint list:
  [API overview](../../docs/api/README.md).
- **Personal keys**: with `USER_KEYS_ENABLED=true`, `ytc_…` keys are checked by the account service over a private
  network; quota is reserved there atomically when a job is created. One active job per user.
- **Limits**: duration, size (checked before and during download), free disk space, queue, per-IP rate limit,
  timeouts, file lifetime (`JOB_TTL_MIN`).
- **Politeness**: a circuit breaker pauses requests to a platform after a refusal or a rate limit, with growing
  cool-downs, minimum intervals and limited concurrency.
- **Result cache**: the same media with the same output parameters is served again without a new download.
- **AETHRYON Tools** (optional): derived outputs (compression, GIF, crop), storyboards, waveforms, file uploads.
- **Errors**: JSON `{"error": "<code>", "detail": "<message>"}` with stable codes ([catalogue](../../docs/api/ERREURS.md)).

## Run

Development (fake worker, no platform contacted) — from the repository root:

```bash
make dev-secrets && make dev-build && make dev-up      # http://127.0.0.1:18111/health
```

Tests (offline container):

```bash
make test            # docker build --target test && docker run --network none
```

Image targets in the [`Dockerfile`](Dockerfile): `runtime` (real worker), `preprod` (fake worker from
`preprod/fake_worker.py`, used by the development stack), `test` (pytest).

## Configuration

Every setting is documented in [`.env.example`](.env.example). Secrets are files: `TOKENS_FILE` (labelled admin
tokens, one `label token` per line, managed with `scripts/rotate_token.py`) and `ACCOUNT_INTERNAL_TOKEN_FILE`.

| Script | Purpose |
|---|---|
| `scripts/rotate_token.py` | Create or replace an admin token for a label (shown once in the terminal) |
| `scripts/disable_env_token.py` | Remove the legacy single `API_TOKEN` once labelled tokens are used |
| `scripts/cookies_install.py` | Validate and install a cookies file for yt-dlp (optional, your own account only) |
| `scripts/smoke_test.sh` | End-to-end smoke test against a running instance |

Logs never contain tokens, cookies or query strings: uvicorn's access log is disabled and the app logs the path and
the token label only.

## Layout

```
app/main.py         routes (FastAPI)
app/jobs.py         job queue, ownership, lifetime
app/worker.py       yt-dlp + FFmpeg in a separate process
app/runner.py       process pool, timeouts, cancellation
app/security.py     auth, rate limits, client IP
app/userkeys.py     personal keys (account service)
app/extraits.py     clips: range download and cutting
app/studio.py       AETHRYON Tools operations
app/music/          optional legal music connectors (off by default)
tests/              pytest suite (about 1,000 tests, offline)
```

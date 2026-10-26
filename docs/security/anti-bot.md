# Anti-bot protection (self-hosted Cap)

Code: `apps/account/src/antibot.ts`, `apps/web/src/lib/verification.ts`, `apps/web/src/ui/VerificationOverlay.tsx`,
`apps/web/nginx/default.conf` (location `/cap/`). Some code comments still point to internal documents
(`docs/SECURITE-ANTIBOT.md`, `deploy/…`) that are not part of this repository; this page replaces them.

## Architecture

```
browser ── website nginx ──┬─ /api/*                          → account
                           └─ POST /cap/<site key>/challenge|redeem → Cap (internal network only)
account ── siteverify ──→ Cap ── Redis (internal network only)
```

- [Cap](https://github.com/tiagozip/cap) standalone (Apache-2.0) and Redis run on internal Docker networks, with no
  published port and no reverse-proxy route. Only the two public Cap endpoints are relayed by the website's nginx
  (same origin, rate limited, cookies and `Authorization` stripped, `X-Forwarded-For` rewritten with the real IP).
- The widget (`@cap.js/widget`) is loaded on demand only; its WebAssembly (`@cap.js/wasm`) is served by the website
  from `/cap/wasm/`, never from a CDN. The Content Security Policy only adds `'wasm-unsafe-eval'` and
  `worker-src 'self' blob:`.

## Levels

| Level | When | Effect |
|---|---|---|
| 1 | Normal visitors and actions | Nothing: no challenge, no extra script. |
| 2 | Sign-up code request, password reset; password login after 3 failures in 15 min; website jobs (Tools, Music imports) above a rate threshold or with automation signals | A proof-of-work challenge. A success grants a 30-minute server-side pass for website jobs. |
| 3 | Repeated refused proofs or rate-limit hits | `429 temporarily_blocked` for 15 minutes on sensitive actions. |

The subject is the signed-in account, otherwise a truncated HMAC of IP + user agent (never the IP alone). Key-based
clients (extension, iOS Shortcut, Desktop, Premiere panel, Discord bot), OAuth callbacks, the Stripe webhook and file
downloads are never challenged.

## Proof flow (server side)

1. The sensitive action answers `403 {"error":"challenge_required","challenge":{…}}` with a single-use ticket bound to
   the subject and the action (5 minutes).
2. The browser solves the Cap challenge and replays the same request with `X-Aethryon-Challenge` and
   `X-Aethryon-Verification`.
3. account consumes the ticket, rejects replayed tokens, then calls Cap `siteverify` on the internal network.
4. Errors: `challenge_failed` (403), `challenge_expired` (403), `verification_unavailable` (503, fail-closed),
   `temporarily_blocked` (429).

## Configuration (account)

`ANTIBOT` = `off` (default, nothing is asked) | `observe` (decisions counted, nothing asked) | `on`.
With `observe` or `on`: `CAP_INTERNAL_URL` (`http://<cap container>:3000`), `CAP_SITE_KEY` or `CAP_SITE_KEY_FILE`
(public site key), `CAP_SECRET_FILE` (site key secret, read from a file, never logged). Tuning variables:
`ANTIBOT_TICKET_TTL_S`, `ANTIBOT_PASS_TTL_S`, `ANTIBOT_BLOCK_S`, `ANTIBOT_LOGIN_FAILURES`, `ANTIBOT_TRAVAUX_SEUIL`,
`ANTIBOT_ECHECS_BLOCAGE`, `ANTIBOT_EVENT_DAYS`, `ANTIBOT_COUNTER_DAYS` (see `apps/account/src/config.ts`).

Stored data (migration 016): daily counters (90 days) and suspicious events (14 days, 5,000 rows max), with no e-mail
address and no full IP (/24 or /48 prefix only). The website build arg `CAP_UPSTREAM` names the Cap container for nginx.

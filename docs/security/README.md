# Security notes

How to report a vulnerability: [`SECURITY.md`](../../SECURITY.md).

## Principles

- **No secret in the repository.** Services read secrets from files mounted read-only (`*_FILE` variables).
  `*.env.example` files only contain non-working placeholders.
- **No production data in the repository**: no database, backup, log, upload, cookie or user file.
- **Least privilege between services.** The media API never sees the database; it asks account over a private network
  with a dedicated token. The bot has its own token and its own internal port. Keys have types (shortcut, extension,
  discord, desktop, premiere) with their own rights and lifetimes.
- **Keys are hashed.** Personal keys are stored as SHA-256 hashes and shown once.
- **Strict browser security.** The website has a Content Security Policy without `unsafe-inline`; the extension's
  pages use `script-src 'self'` and package all their code (no remote code).
- **Containers are hardened**: read-only root filesystem, `cap_drop: [ALL]`, `no-new-privileges`, resource limits.
- **Tests never reach real platforms**: the media API test suite runs in a container with `--network none`.

## Secret scanning

| Where | Tool |
|---|---|
| Every push and pull request, full history | [gitleaks](https://github.com/gitleaks/gitleaks) (`.github/workflows/secrets.yml`) |
| Locally | `make scan` |

`.gitleaks.toml` extends the default rules with a short allowlist of **reviewed false positives** (public extension
keys, SHA-256 digests of brand files, obviously fake test values). Adding an entry requires a review: a real secret
must be revoked, not allowlisted.

## The iOS Shortcut

The signed `shortcuts/ios/dist/AETHRYON.shortcut` contains **no token**: the key is requested at import time
(import question with an empty default) and stays on the user's device. `tools/validate.py` fails the build if a
token-like string or a `Bearer` value appears in the file. The signature is an Apple certificate chain added by the
third-party signing service HubSign; it contains no private key.

## The browser extension

`src/manifest-key.*.json` hold the **public** half of the extension key (it fixes the extension ID). The private key
used to package releases is not part of the repository.

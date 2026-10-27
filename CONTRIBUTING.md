# Contributing to AETHRYON

Thank you for taking the time to contribute. This guide explains how to set up the project, what we expect in a
pull request, and the few rules that keep AETHRYON safe for its users.

## Ground rules

- Be kind and constructive: this project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
- **Never commit secrets** (tokens, keys, passwords, cookies, `.env` files), databases, logs, user files or personal
  data — not even in tests, screenshots or issue attachments. Use obviously fake values such as `alice@example.test`.
- Security problems go through [private reporting](SECURITY.md), never through public issues.
- Keep the scope of AETHRYON in mind: public links, content you have the rights to, no circumvention of DRM or access
  controls. Contributions that weaken this will not be accepted ([responsible use](docs/legal/responsible-use.md)).
- Discuss large changes in an issue first, so that nobody spends days on something that cannot be merged.

## Project layout

```
apps/            web, account, media-api, extension, discord-bot, desktop, premiere-panel, setup
shortcuts/ios/   iOS Shortcut sources (Cherri), validator and the signed file
packages/brand/  master identity (owl, logotype, icons) and generators
docs/            architecture, installation, API, security, legal
assets/          README media (banner, logo, GIFs, screenshots)
```

Each app has its own `README.md` with its commands. Most code comments and some docs are in French; English
contributions are welcome, and translations of comments are a great first contribution.

## Development setup

Requirements: Docker + `docker-compose`, GNU Make, Node.js 22, Python 3.11+ (Rust stable for `desktop/` and `setup/`).

```bash
cp .env.example .env
make dev-secrets && make dev-build && make dev-up   # local stack on 127.0.0.1, fake media worker
make test                                           # unit tests that run offline
```

Details: [`docs/installation/development.md`](docs/installation/development.md).

Rules for local testing:

- The development media API uses a **fake worker**. Tests must not contact YouTube, TikTok, X or any other
  platform; mock them instead (see `apps/media-api/tests` and `apps/media-api/preprod/fake_worker.py`).
- Use **test mode** credentials only (Stripe `sk_test_…`, a test Discord application, a test Google OAuth client).

## Making a change

1. Fork the repository and create a branch from `main`: `feat/short-description` or `fix/short-description`.
2. Keep the change focused. Add or update tests next to the code you touch.
3. Run the checks of the components you changed:

   | Component | Commands |
   |---|---|
   | `apps/account` | `npm ci && npm run typecheck && npm test` |
   | `apps/web` | `npm ci && npm run build` and `node --test tests/*.test.ts` |
   | `apps/media-api` | `make test` (offline container) |
   | `apps/extension` | `npm ci && npm run typecheck && npm test && npm run build` |
   | `apps/discord-bot` | `npm ci && npm run typecheck && npm test` |
   | `apps/premiere-panel` | `npm ci && npm run typecheck && npm test` |
   | `apps/desktop` | `npm ci && npm test` and `cargo test -p aethryon-noyau` |
   | `packages/design` | `npm ci && node scripts/build.mjs --check && npm run typecheck && npm test` (or `make test-design`) |
   | error codes | `python3 scripts/check-error-codes.py` |
   | secrets | `make scan` |

4. Update the documentation and `CHANGELOG.md` (section *Unreleased*) when behaviour changes.
5. Open a pull request using the template. Describe **what** changed, **why**, and **how you tested it**.

### Commit messages

Short imperative summary (≤ 72 characters), blank line, then the details: `Add GIF export to the clip editor`.
Reference issues with `Fixes #123` when relevant.

### Code style

- TypeScript: strict mode, no `any` without a reason, follow the existing structure of each app.
- Python: type hints, small functions, `pytest` tests.
- Rust: `cargo fmt` and `cargo clippy` clean.
- User-facing text is French today; keep the tone short, honest and precise (never promise what the code does not do).
- Accessibility matters: keyboard navigation, contrast (WCAG AA) and `prefers-reduced-motion`.
- Brand: reuse the existing assets in `packages/brand`; do not redraw the owl or the logotype.

## Error codes

User-facing error codes are shared by every component. The catalogue is
[`docs/api/ERREURS.md`](docs/api/ERREURS.md); `scripts/check-error-codes.py` checks that account, the media API and the
bot use exactly the same codes and texts.

## Reporting bugs and requesting features

Use the issue templates. For bugs, include the component, version, platform/browser, steps to reproduce, and what you
expected. Remove any personal information from logs and screenshots before posting them.

## License of contributions

The project license has not been chosen yet (see the README). By opening a pull request you agree that your
contribution may be distributed under the license the owner adopts for the code. Brand assets are not part of
the code license.

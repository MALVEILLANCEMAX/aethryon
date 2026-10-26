# Changelog

All notable changes to this repository are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each app also keeps its own detailed history
(`apps/extension/CHANGELOG.md`, `apps/desktop/CHANGELOG.md`, `apps/setup/CHANGELOG.md`).

## [Unreleased]

## [0.1.0] — 2026-10-26 — First public source release (private preview)

First release of the AETHRYON monorepo as an open-source project, prepared from the private production repository
with a **fresh Git history**.

### Added

- Monorepo layout: `apps/` (web, account, media-api, extension, discord-bot, desktop, premiere-panel, setup),
  `shortcuts/ios`, `packages/brand`, `docs/`, `assets/`.
- Reproducible local development stack (`compose.dev.yml`, `make dev-*`): no reverse-proxy labels, no production
  domain, fake media worker, random local secrets.
- Configuration examples with non-working placeholder values (`.env.example` files).
- Documentation: README, per-component guides, architecture, installation, API overview, security, responsible use.
- Community files: contributing guide, security policy, Code of Conduct (Contributor Covenant 2.1), issue and pull
  request templates, funding file.
- GitHub Actions: lint/typecheck, unit tests and builds of the published parts, secret scanning, link checking
  (read-only permissions, no deployment).

### Component versions in this release

| Component | Version |
|---|---|
| Browser extension | 3.8.1 |
| iOS Shortcut | 3.0 (signed file `shortcuts/ios/dist/AETHRYON.shortcut`) |
| AETHRYON Desktop | 1.2.0-beta.2 |
| Premiere Pro panel (CEP) | 2.0.1 |
| AETHRYON Setup | 2.0.0-beta.8 |
| Website / account / media API / Discord bot | state of the production branch on 2026-10-26 (`b9b5af1`, footer support link included) |

### Changed compared with the private repository

- Production deployment scripts, production compose files, infrastructure notes and internal reports were removed.
- Personal data in legal settings and test fixtures was replaced with neutral placeholders.
- The website build no longer fails with the default `OFFRES=reelles` setting (the `/premium` nginx location is now
  conditional, like the page itself).
- The optional proof-of-origin token plugin build option was removed from the media API image.

### Known issues

- `apps/account/test/music.test.ts`: the test « clé « desktop » … ytapi restent fermés » fails on the production
  branch too — the key authorizer now accepts « desktop » keys for media API access. It is marked `todo` until the
  maintainers decide whether the test is stale or the authorizer must be tightened.
- Discord and iPhone screen recordings are not available yet (see `assets/README.md`).

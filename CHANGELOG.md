# Changelog

All notable changes to this repository are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each app also keeps its own detailed history
(`apps/extension/CHANGELOG.md`, `apps/desktop/CHANGELOG.md`, `apps/setup/CHANGELOG.md`).

## [Unreleased]

### Added

- **Égide**, the shared design system (`packages/design`), synced from production (`5e941c4`): design tokens, a theme
  engine that computes contrast (27 WCAG pairs per theme), six themes (Obsidian, Ivory, OLED, Midnight, Minimal,
  Custom), a strict theme file format with import and export, a theme editor, an in-house icon set and framework-free
  DOM components. Checked by `make test-design` and a CI job (generated files, website copy, master owl, size budgets).
- Website, AETHRYON Desktop **1.3.0-beta.1**, browser extension **3.9.0** and AETHRYON Setup **2.0.0-beta.9** move to
  Égide: new layout, Settings › Appearance with the theme editor, platform catalogue with the real state of each
  platform. Building extension 3.9.0 from this repository gives the published archive byte for byte.
- Platform registry synced from production (`c81fdac` to `4ce9ce6`): one registry of platforms in the media API,
  beta platforms behind `PLATEFORMES_BETA`, a per-platform circuit breaker, Wikimedia Commons (with author, licence and
  source attribution) and Bluesky, the interface catalogue `docs/api/CATALOGUE-PLATEFORMES.json` and
  `make test-platforms`.
- `docs/design/`: before/after screenshots of the Égide redesign (test accounts and sample data only).
- `LICENSE` (Apache License 2.0), `NOTICE`, `TRADEMARK.md` and `assets/LICENSE-ASSETS.md`: the code is Apache-2.0, the
  AETHRYON brand (name, owl, logotype, visuals) stays reserved. Package manifests and crates now declare `Apache-2.0`.
- Anti-bot protection with a self-hosted [Cap](https://github.com/tiagozip/cap) instance, synced from production
  (`604cca1`): server-side challenges on sensitive website actions (sign-up, password reset, repeated login failures,
  website jobs), a security page in the Control Center, migration 016. Off by default (`ANTIBOT=off`); see
  `docs/security/anti-bot.md`.

### Changed

- Website, Desktop and extension fonts: Marcellus, Hanken Grotesk and Geist Mono (SIL OFL), shipped once in
  `packages/design/fonts`, replace Inter and Playfair Display. The experimental WebGL "retro" objects, the "Athena" owl
  exploration and the old unused token generator of the website were removed.
- Code of Conduct reports go through GitHub private reporting until a dedicated address is published.
- `.gitignore` covers more secret and data file types.

### Fixed

- Desktop core: the test `metadonnees_et_miniatures_progressives` no longer depends on the ranking of equal search
  results (it failed on the CI runner).

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

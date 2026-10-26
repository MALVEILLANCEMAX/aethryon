# AETHRYON website

The public website, the personal space (keys, activity, settings, linked accounts), the admin Control Center and
AETHRYON Tools — a single-page app whose public pages are **pre-rendered at build time** and served by nginx with a
strict Content Security Policy.

React 19 · React Router · Vite · Tailwind CSS 4 · Motion · nginx (unprivileged) · fonts self-hosted
(Inter, Playfair Display — SIL OFL).

<p align="center">
  <img src="../../assets/screenshots/site-home.png" alt="Home page" width="720">
</p>

## Develop

The site needs the account API behind `/api/*`. The simplest way is the development stack from the repository root:

```bash
make dev-secrets && make dev-build && make dev-up       # http://localhost:18110
```

Build and tests without Docker:

```bash
npm ci
ALLOW_LEGAL_PLACEHOLDERS=1 VITE_LEGAL_DRAFT=1 npm run build   # tsc + vite + SSR pre-render + dist checks
node --test --test-concurrency=1 tests/*.test.ts             # unit tests
npm run typecheck
```

`npm run build` runs `vite build`, renders the public routes with React's static renderer (`src/entry-static.tsx`),
writes them into `dist/` (`scripts/prerender.mjs`) and checks the result (`scripts/check-dist.mjs`): every nginx
location must match a route, no inline script or style, no test address in the bundle.

## Build arguments (Docker)

| Argument | Default | Meaning |
|---|---|---|
| `ACCOUNT_UPSTREAM` | — | `host:port` of the account service |
| `REAL_IP_FROM` | **required** | network of the trusted reverse proxy (real client IP for rate limits) |
| `CONTROL_CENTER` | `1` | include the admin Control Center |
| `INDEXING` | `0` | `1` = pages indexable by search engines, sitemap served |
| `EXTENSION_DOWNLOAD` | `0` | `1` = serve the browser-extension release files |
| `OFFRES` | `reelles` | pricing section: `reelles` (free offer only), `apercu`, `vente` |
| `DISCORD_PHASE` | `inactif` | what the legal pages say about the bot |
| `LOGOS_PLATEFORMES` | `neutres` | neutral pictograms; official platform logos only by explicit decision |
| `ALLOW_LEGAL_PLACEHOLDERS` | `0` | accept empty legal notices (development only) |

## Legal notices

`src/lib/legal.tsx` holds the publisher information shown in the legal pages. It is **empty in this repository**:
each deployment fills in its own (the production build refuses placeholders).

## Media not stored in Git

The launch film (`public/media/film/aethryon-v35-*.mp4`, about 17 MB) is not in the repository. The poster image is.
To see the film locally, download it from the official site into `public/media/film/`
([1080p](https://raccourci.malvu.fr/media/film/aethryon-v35-1080.mp4),
[720p](https://raccourci.malvu.fr/media/film/aethryon-v35-720.mp4)).

## Layout

```
src/landing/     home page sections
src/app/         pages (account, keys, activity, help, legal…)
src/outils/      AETHRYON Tools (editor)
src/admin/       Control Center
src/ui/          shared components and brand
src/lib/         API client, config, offers, legal texts
nginx/           server configuration and security headers
scripts/         pre-render, dist checks, downloads
```

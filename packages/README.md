# Shared packages

| Package | Contents | Used by |
|---|---|---|
| [`brand`](brand/README.md) | Master identity: owl head, Marcellus logotype outlines, variants, PNG icons, generators | website, extension, Desktop, Setup, panel, README |

Other shared code currently lives inside the apps and is consumed through relative paths, on purpose (it keeps each
app buildable on its own):

- `apps/desktop/archive-extension` — Rust crate that verifies browser-extension archives, used by Desktop and Setup;
- `apps/web/src/ui/brand` — generated brand modules, also imported by the extension's tests;
- `docs/api/ERREURS.md` — the error catalogue shared by account, the media API and the bot.

Moving them into `packages/` is possible later, but changes Cargo workspaces and build scripts; it is tracked as a
refactoring idea, not done in the first release.

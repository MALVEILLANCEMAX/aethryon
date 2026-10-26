## What does this change?

<!-- A short description of the change and the problem it solves. Link the issue: Fixes #123 -->

## How was it tested?

<!-- Commands you ran (see CONTRIBUTING.md) and what you checked by hand. -->

- [ ] Unit tests of the touched components pass locally
- [ ] Documentation and `CHANGELOG.md` (Unreleased) updated when behaviour changes

## Safety checklist

- [ ] No secrets, `.env` files, databases, logs, cookies or personal data in the diff (`make scan` is clean)
- [ ] Tests do not contact YouTube, TikTok, X or any other platform (mocks or the fake worker only)
- [ ] User-facing text stays honest: no feature is announced that the code does not provide
- [ ] Brand assets reused from `packages/brand` (no redrawn logo or new mascot)

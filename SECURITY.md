# Security Policy

AETHRYON handles accounts, personal access keys and media files. We take security reports seriously and we are
grateful for responsible disclosure.

## Reporting a vulnerability

**Please do not open a public issue, discussion or pull request for a vulnerability.**

Report it privately through GitHub:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability** (GitHub private vulnerability reporting).
3. Describe the issue, the affected component and version, and the steps to reproduce.

Please include, when possible:

- the component (`apps/web`, `apps/account`, `apps/media-api`, `apps/extension`, `apps/discord-bot`,
  `apps/desktop`, `apps/premiere-panel`, `apps/setup`, `shortcuts/ios`) and its version;
- a minimal proof of concept that only uses **your own** accounts, keys and test data;
- the impact you expect (confidentiality, integrity, availability).

Never include real tokens, cookies, passwords, personal data or other users' files in a report. If you accidentally
obtained someone else's data, stop, do not keep a copy, and tell us in the report.

## What to expect

- An acknowledgement within **7 days**.
- A first assessment within **14 days**, with the planned fix or mitigation.
- Credit in the release notes once the fix is published, if you wish.

## Scope

In scope: the code in this repository and the official deployment at `raccourci.malvu.fr` / `api.malvu.fr`
**within the limits below**.

Out of scope, please do not:

- run automated scanners, load tests or denial-of-service attempts against the official deployment;
- access, modify or delete data that is not yours, or try to exploit other users' accounts;
- use social engineering, phishing or physical attacks;
- report issues that require a compromised device, an outdated browser, or a self-built extension with a modified ID.

Third-party platforms (YouTube, TikTok, X, Discord, Apple, Adobe, Google, Stripe…) have their own security programs.

## Supported versions

Only the latest released version of each component receives security fixes:

| Component | Supported |
|---|---|
| Browser extension | latest `3.x` |
| iOS Shortcut | `3.0` |
| Discord bot, website, account, media API | `main` (continuously deployed by the maintainers) |
| Desktop, Premiere panel, Setup | latest beta |

## Handling secrets

This repository must never contain secrets. Configuration examples (`*.env.example`) use non-working placeholder
values, and services read their secrets from files outside the repository. Every pull request is scanned with
[gitleaks](https://github.com/gitleaks/gitleaks). If you find a real secret in the history, report it privately as a
vulnerability.

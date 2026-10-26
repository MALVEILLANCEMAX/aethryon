# AETHRYON panel for Premiere Pro (CEP, beta)

A panel inside Adobe Premiere Pro: paste a link, convert it with your AETHRYON account, and import the result into the
open project. Also shows the AETHRYON Desktop library.

Preact · Vite · CEP 12 (`CSXS` manifest, host `PPRO` 25.0+) · version **2.0.1** · installed by AETHRYON Setup.

> [!NOTE]
> "Premiere Pro" is a trademark of Adobe. This panel is an independent project, not made or endorsed by Adobe, and it
> uses no Adobe logo.

## Sign-in

The panel uses a device-authorization flow: it shows a short code, you approve it on the website
(`/premiere/connecter`), and it receives a dedicated key (30 days, same quota as your other clients).

## Build and test

```bash
npm ci
npm run typecheck
npm test               # vitest, with a fake Premiere host and a fake server
npm run build          # vite build
npm run construire     # assemble the CEP extension folder (unsigned)
```

Signing the CEP package (ZXP) uses a private certificate that is **not** part of this repository; see
`apps/setup/signature-cep/` for the format and the scripts (the secret folder is passed explicitly).

## Layout

```
cep/          CEP manifest, icons, ExtendScript bridge
src/hote/     host adapters: CEP, test harness
src/api/      AETHRYON API client
src/ui/       panel interface (pages, components)
tests/        unit tests, fake host and fake server
maquette/     sample media for the harness
```

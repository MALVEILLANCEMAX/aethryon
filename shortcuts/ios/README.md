<p align="center"><img src="../../assets/logo.svg" width="64" alt=""></p>

<h1 align="center">AETHRYON for iPhone (Apple Shortcuts)</h1>

<p align="center">
  Share a video link to <b>AETHRYON</b> and get an MP4 in Photos or an MP3 in Files.<br>
  Version <b>3.0</b> · generated from code with <a href="https://github.com/electrikmilk/cherri">Cherri</a> · signed file included
</p>

<p align="center">
  <a href="https://www.icloud.com/shortcuts/e1e2eaadf6c841bd884c9dbe680675d1"><img alt="Add the Shortcut from iCloud" src="https://img.shields.io/badge/Add%20from%20iCloud-AETHRYON%203.0-D4AF7C?style=for-the-badge&labelColor=0F0F10"></a>
  <a href="https://raccourci.malvu.fr/downloads/AETHRYON.shortcut"><img alt="Download the signed .shortcut file" src="https://img.shields.io/badge/Signed%20file-.shortcut-2A2A2E?style=for-the-badge&labelColor=0F0F10"></a>
</p>

> [!NOTE]
> A screen recording on a real iPhone is not available yet (see [`assets/README.md`](../../assets/README.md)).

## Install on iPhone

1. Create an account on [raccourci.malvu.fr](https://raccourci.malvu.fr), then a **personal key** in *Mes jetons*.
   The key is shown once: copy it.
2. Open the [iCloud link](https://www.icloud.com/shortcuts/e1e2eaadf6c841bd884c9dbe680675d1) **in Safari** and tap
   *Add Shortcut*. (Fallback: download the [signed file](https://raccourci.malvu.fr/downloads/AETHRYON.shortcut) and
   open it with the Shortcuts app.)
3. When Shortcuts asks *« Colle ton jeton AETHRYON »*, paste your key. It stays in the Shortcut on your device.

The guided version of these steps (with a QR code to continue on the iPhone) is at
[raccourci.malvu.fr/installer](https://raccourci.malvu.fr/installer).

## Use

From YouTube, TikTok or X: **Share** › **AETHRYON** › choose **MP4** (saved to Photos) or **MP3** (saved to Files).
Without a shared link, the Shortcut reads the clipboard, then asks for a link.

What happens:

1. the link is taken from the share sheet, the clipboard or a prompt;
2. TikTok short links (`vm.tiktok.com`, `vt.tiktok.com`, `tiktok.com/t/`) are expanded **on the iPhone**;
3. `POST /jobs?wait=20` creates the job on the [media API](../../docs/api/README.md) with your key;
4. the Shortcut follows the job (bounded, about 13 minutes at most), then downloads the file;
5. the file type is checked positively (MP4/MOV for Photos, MP3 for Files) before saving: an error page or a JSON
   answer can never end up in your library;
6. a confirmation appears only after the file is saved; errors show AETHRYON's readable message.

## Compatibility

| | |
|---|---|
| Designed for | iOS 27, iPhone |
| Declared minimum | Shortcuts client version 900 |
| iPad, Mac | Not tested |
| Languages | Interface texts in French |

## What is in this folder

```
src/AETHRYON.cherri              the single source of the distributed Shortcut
dist/AETHRYON.shortcut           the signed file (AEA1, Apple certificate chain), 308 actions
dist/AETHRYON.shortcut.sha256    34fcffb3…f25559
dist/SIGNATURE-AETHRYON.txt      what was checked at signing time
tools/build.sh                   pinned Cherri compiler + stage tests A–D + validation (no network send)
tools/validate.py                static validator (structure, API contract, conditions, secrets)
tools/inspect_signed.py          checks the Apple chain and extracts the signed content
tools/simulate.py                runs the Shortcut logic offline
tools/sign.sh, tools/hubsign.py  signing through the third-party HubSign service
tests/                           stage sources and mutation tests of the validator
```

## Privacy and security

- The file contains **no token and no personal data**: the key is an import question with an empty default value.
  `tools/validate.py` fails if a token-like string (32+ characters) or a `Bearer` value appears, and if the import
  question has a default value.
- The only URL inside the Shortcut is the API endpoint `https://api.malvu.fr/media/jobs?wait=20`.
- The signature is an Apple certificate chain added by HubSign (a third-party signing service). It contains no
  private key. Each signing creates a public iCloud record owned by HubSign: sign only when needed.

Check the file yourself:

```bash
python3 -m venv .venv && .venv/bin/pip install --require-hashes --only-binary=:all: -r tools/requirements.txt
.venv/bin/python tools/inspect_signed.py dist/AETHRYON.shortcut     # Apple chain + content
.venv/bin/python tools/validate.py dist/AETHRYON.shortcut           # structure, API contract, no secret
(cd dist && sha256sum -c AETHRYON.shortcut.sha256)
```

## Build your own

```bash
make build      # pinned Cherri compiler (built from source), compiles src/ and runs every check — nothing is sent
make sign       # sends the compiled Shortcut to HubSign for signing (third-party service), then re-checks it
```

To use your own instance, change the API URL in `src/AETHRYON.cherri` and in `tools/validate.py` (`API_JOBS`), build,
then sign. iOS only installs signed Shortcuts.

#!/usr/bin/env python3
"""`make cookies-install FILE=/path/to/cookies.txt`: validate and install YouTube cookies.

- validates the Netscape format and the presence of a logged-in YouTube session (no value is
  ever printed);
- installs it as secrets/cookies.txt, owner root, group 10001 (the app user), mode 440;
- securely deletes the source file (shred -u);
- the running service picks the new file up within ~1 s (no restart needed).
Use --force to install a file that fails validation (it is then reported in /status).
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.cookies import validate  # noqa: E402

APP_GID = 10001


def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if not a.startswith("--")]
    force = "--force" in argv
    if len(args) != 1 or not args[0]:
        print("usage : make cookies-install FILE=/path/to/cookies.txt", file=sys.stderr)
        return 2
    source = Path(args[0]).expanduser()
    if not source.is_file():
        print(f"Fichier introuvable : {source}", file=sys.stderr)
        return 2
    report = validate(source)
    print(f"Vérification : {report.state} — {report.detail}")
    print(f"  entrées : {report.entries} (youtube.com : {report.youtube_entries}, google.com : {report.google_entries})")
    if report.earliest_login_expiry:
        print(f"  première expiration d'un cookie de session : {report.earliest_login_expiry}")
    if not report.usable and not force:
        print("Fichier NON installé (ajoutez --force pour l'installer quand même). Source conservée.")
        return 1

    secrets_dir = Path(os.environ.get("YTAPI_SECRETS_DIR", ROOT / "secrets"))
    secrets_dir.mkdir(parents=True, exist_ok=True)
    is_root = os.geteuid() == 0
    if is_root:
        os.chown(secrets_dir, 0, APP_GID)
        os.chmod(secrets_dir, 0o750)
    target = secrets_dir / "cookies.txt"
    tmp = secrets_dir / f".cookies.{os.getpid()}.tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "wb") as handle, source.open("rb") as src:
            shutil.copyfileobj(src, handle)
        if is_root:
            os.chown(tmp, 0, APP_GID)
        os.chmod(tmp, 0o440)
        os.replace(tmp, target)
    finally:
        tmp.unlink(missing_ok=True)
    print(f"Installé : {target} (root:{APP_GID}, mode 440). Pris en compte sous ~1 s, sans redémarrage.")

    if shutil.which("shred"):
        rc = subprocess.run(["shred", "-u", "--", str(source)], check=False).returncode
    else:
        source.unlink(missing_ok=True)
        rc = 0
    if rc != 0 or source.exists():
        print(f"ÉCHEC de la suppression de la source : supprimez-la à la main (shred -u {source}).",
              file=sys.stderr)
        return 1
    print(f"Source supprimée de façon sécurisée : {source}")
    print("Vérifiez : make status (rubrique cookies), puis UN seul test YouTube.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

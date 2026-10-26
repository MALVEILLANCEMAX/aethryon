#!/usr/bin/env python3
"""`make rotate-token LABEL=iphone`: create or replace the token of one label in secrets/tokens.

The new token is shown ONLY on this terminal (QR code + text); it is never written to a log.
The running service reloads the file within ~1 s (no restart). Other labels keep working.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.tokens import LABEL_RE, generate_token, parse_tokens, write_tokens_file  # noqa: E402

APP_UID = APP_GID = 10001


def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if not a.startswith("--")]
    if len(args) != 1 or not LABEL_RE.fullmatch(args[0].lower()):
        print("usage : make rotate-token LABEL=iphone   (label : a-z, 0-9, _ ou -, 32 caractères max)", file=sys.stderr)
        return 2
    label = args[0].lower()
    path = Path(os.environ.get("YTAPI_TOKENS_FILE", ROOT / "secrets" / "tokens"))
    is_root = os.geteuid() == 0
    path.parent.mkdir(parents=True, exist_ok=True)
    if is_root and path.parent.name == "secrets":
        os.chown(path.parent, 0, APP_GID)
        os.chmod(path.parent, 0o750)

    tokens: dict[str, str] = {}
    if path.exists():
        tokens, _invalid = parse_tokens(path.read_text(encoding="utf-8"))
    replaced = label in tokens
    token = generate_token()
    tokens[label] = token
    write_tokens_file(path, tokens, uid=APP_UID if is_root else None, gid=APP_GID if is_root else None)

    print(f"Jeton « {label} » {'remplacé' if replaced else 'créé'} dans {path} (mode 600).")
    if replaced:
        print("L'ancien jeton de ce label cesse de fonctionner d'ici ~1 seconde.")
    if "--no-qr" not in argv and shutil.which("qrencode"):
        print("\nScannez ce QR code avec l'appareil photo de l'iPhone, puis « Copier » :\n")
        subprocess.run(["qrencode", "-t", "ansiutf8"], input=token.encode(), check=False)
    print("\nJeton (à copier dans votre gestionnaire de mots de passe / l'en-tête du Raccourci) :\n")
    print(f"    {token}\n")
    print("Dans le Raccourci : en-tête Authorization = Bearer <jeton> (avec l'espace).")
    print("Ensuite, effacez l'écran et l'historique du terminal : clear (et fermez l'onglet).")
    env_file = Path(os.environ.get("YTAPI_ENV_FILE", ROOT / ".env"))
    if env_file.exists() and any(line.startswith("API_TOKEN=") and len(line.strip()) > len("API_TOKEN=")
                                 for line in env_file.read_text().splitlines()):
        print("\nRappel : le jeton API_TOKEN du .env (label « env ») reste valide.")
        print("Une fois le Raccourci mis à jour, désactivez-le avec : make disable-env-token")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

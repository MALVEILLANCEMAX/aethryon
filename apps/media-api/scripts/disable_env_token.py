#!/usr/bin/env python3
"""API_TOKEN in .env, never printed.

`make disable-env-token`: blank API_TOKEN once labelled tokens exist. Refuses if secrets/tokens
holds no valid token (the service would refuse to start).
`make env-token-from-label LABEL=iphone` (`--copy-label LABEL`): copy that label's token into
API_TOKEN, for a rollback to the v1 image, which only knows API_TOKEN.
The container must then be recreated (`docker-compose up -d ytapi`, done by make).
Overrides for tests: YTAPI_TOKENS_FILE, YTAPI_ENV_FILE.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.tokens import parse_tokens  # noqa: E402


def _set_api_token(env: Path, value: str) -> bool:
    """Rewrite API_TOKEN=<value> atomically (mode 600); returns True if the file changed."""
    lines = env.read_text(encoding="utf-8").splitlines()
    wanted = f"API_TOKEN={value}"
    found = False
    for i, line in enumerate(lines):
        if line.startswith("API_TOKEN="):
            found = True
            if line.strip() == wanted:
                return False
            lines[i] = wanted
    if not found:
        lines.append(wanted)
    tmp = env.with_name(env.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    os.replace(tmp, env)
    return True


def main(argv: list[str]) -> int:
    tokens_file = Path(os.environ.get("YTAPI_TOKENS_FILE", ROOT / "secrets" / "tokens"))
    env = Path(os.environ.get("YTAPI_ENV_FILE", ROOT / ".env"))
    tokens, _ = parse_tokens(tokens_file.read_text(encoding="utf-8")) if tokens_file.is_file() else ({}, [])
    if len(argv) == 3 and argv[1] == "--copy-label":
        label = argv[2]
        if label not in tokens:
            known = ", ".join(sorted(tokens)) or "aucun"
            print(f"Refusé : pas de jeton « {label} » dans secrets/tokens (connus : {known}).", file=sys.stderr)
            return 1
        changed = _set_api_token(env, tokens[label])
        print(f"API_TOKEN = jeton « {label} » (valeur non affichée)." if changed else
              f"API_TOKEN vaut déjà le jeton « {label} ».")
        return 0
    if len(argv) != 1:
        print("usage: disable_env_token.py [--copy-label LABEL]", file=sys.stderr)
        return 2
    if not tokens:
        print("Refusé : aucun jeton dans secrets/tokens. Lancez d'abord : make rotate-token LABEL=iphone",
              file=sys.stderr)
        return 1
    if not _set_api_token(env, ""):
        print("API_TOKEN est déjà vide dans .env.")
        return 0
    print(f"API_TOKEN vidé dans .env. Jetons restants : {', '.join(sorted(tokens))}.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

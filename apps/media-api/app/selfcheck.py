"""`make status`: print GET /status from inside the container (the token never leaves it)."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

from .tokens import parse_tokens


def _any_token() -> str | None:
    token = os.environ.get("API_TOKEN", "").strip()
    if token:
        return token
    path = os.environ.get("TOKENS_FILE")
    if path and Path(path).is_file():
        tokens, _ = parse_tokens(Path(path).read_text(encoding="utf-8"))
        return next(iter(tokens.values()), None)
    return None


def main() -> int:
    token = _any_token()
    if not token:
        print("Aucun jeton disponible dans le conteneur.", file=sys.stderr)
        return 1
    request = urllib.request.Request("http://127.0.0.1:8000/status", headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            print(json.dumps(json.load(response), indent=2, ensure_ascii=False))
    except urllib.error.HTTPError as exc:
        print(f"HTTP {exc.code}: {exc.read().decode(errors='replace')}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

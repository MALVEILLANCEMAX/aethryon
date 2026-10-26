#!/usr/bin/env python3
"""Fait signer un plist de raccourci DÉJÀ VALIDÉ par HubSign (service de RoutineHub).

    hubsign.py ENTRÉE.unsigned.shortcut SORTIE.shortcut [--name "YouTube Converter"]

Même requête que Cherri (signing.go) : POST JSON {"shortcutName", "shortcut": plist XML} vers
https://hubsign.routinehub.services/sign ; réponse attendue : fichier AEA1.

Pourquoi ne pas utiliser `cherri --hubsign` : Cherri recompile alors le source avec de nouveaux
UUID aléatoires, si bien que le fichier signé ne serait pas exactement celui qu'on a validé.
Ici, on signe octet pour octet le plist contrôlé par tools/validate.py.

ATTENTION : HubSign est un service tiers ; il reçoit tout le contenu du raccourci. Ce script
refuse d'envoyer un plist qui contient un jeton réel de ytapi ou un « Bearer » en clair.
"""

from __future__ import annotations

import os
import argparse
import json
import plistlib
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate import all_strings, real_tokens  # noqa: E402

HUBSIGN_URL = "https://hubsign.routinehub.services/sign"
USER_AGENT = "cherri/v2.3.0 (raccourci-site/shortcut tools/hubsign.py)"
ALLOWED_TYPES = {"application/octet-stream", "application/x-plist", "application/x-apple-shortcut"}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("unsigned", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--name", default="YouTube Converter")
    parser.add_argument("--ytapi", type=Path, default=Path(os.environ.get("AETHRYON_MEDIA_API_DIR", "/nonexistent")))
    args = parser.parse_args(argv)

    plist = plistlib.loads(args.unsigned.read_bytes())
    xml = plistlib.dumps(plist, fmt=plistlib.FMT_XML).decode("utf-8")
    if any(t in xml for t in real_tokens(args.ytapi)) or any(
            re.search(r"Bearer\s+[^\s￼]", s) for s in all_strings(plist)):
        print("REFUS : le plist contient un jeton ; rien n'est envoyé à HubSign.", file=sys.stderr)
        return 2

    body = json.dumps({"shortcutName": args.name, "shortcut": xml}).encode("utf-8")
    for attempt in range(1, 4):  # HubSign est parfois lent : 3 essais, 180 s chacun
        request = urllib.request.Request(HUBSIGN_URL, data=body, method="POST", headers={
            "Content-Type": "application/json", "User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                content_type = response.headers.get("Content-Type", "")
                data = response.read()
                status = response.status
            break
        except urllib.error.HTTPError as exc:
            print(f"ÉCHEC HubSign : HTTP {exc.code} {exc.reason} — {exc.read()[:300]!r}", file=sys.stderr)
            return 1
        except (urllib.error.URLError, TimeoutError) as exc:
            print(f"HubSign, essai {attempt}/3 : {exc}", file=sys.stderr)
            if attempt == 3:
                print("ÉCHEC HubSign : service injoignable ou trop lent.", file=sys.stderr)
                return 1
            time.sleep(20 * attempt)
    if status != 200 or content_type.split(";")[0] not in ALLOWED_TYPES or data[:4] != b"AEA1":
        print(f"ÉCHEC HubSign : réponse inattendue (HTTP {status}, {content_type}, {data[:16]!r})", file=sys.stderr)
        return 1
    args.output.write_bytes(data)
    print(f"Signé par HubSign : {args.output} ({len(data)} octets, AEA1)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

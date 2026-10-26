#!/usr/bin/env python3
"""Copie publique du registre UNIQUE des plateformes (apps/media-api/app/plateformes.json) pour le site.

Écrit web/src/lib/plateformes-registre.ts (champs publics seulement : jamais les extracteurs yt-dlp). Avec --check :
n'écrit rien, code 1 si la copie diffère de la source (lancé par `make test`). Bibliothèque standard seule.
Usage : python3 scripts/sync-plateformes.py [--check]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "apps/media-api/app/plateformes.json"
TARGET = ROOT / "apps/web/src/lib/plateformes-registre.ts"
FIELDS = ("id", "nom", "categorie", "etat", "icone", "domaines", "formats", "priorite", "motif", "code")


def render() -> str:
    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    plateformes = [{k: p[k] for k in FIELDS if k in p} for p in data["plateformes"]]
    body = {"version": data["version"], "ytdlp": data["ytdlp"], "categories": data["categories"],
            "icones": data["icones"], "plateformes": plateformes}
    payload = json.dumps(body, ensure_ascii=False, indent=2)
    return (
        "// FICHIER GÉNÉRÉ par scripts/sync-plateformes.py depuis apps/media-api/app/plateformes.json (registre UNIQUE des\n"
        "// plateformes) : ne pas modifier à la main. Données pour l'interface (catégories, icônes neutres, états) ;\n"
        "// les extracteurs yt-dlp restent côté serveur. Vérifié par `make test` (--check).\n"
        "export type EtatPlateforme = \"officielle\" | \"beta\" | \"indisponible\" | \"refusee\";\n"
        "export type CategoriePlateforme = \"populaires\" | \"musique\" | \"streaming\" | \"autres\";\n"
        "export interface PlateformeRegistre {\n"
        "  id: string; nom: string; categorie: CategoriePlateforme; etat: EtatPlateforme; icone: string;\n"
        "  domaines: readonly string[]; formats?: readonly string[]; priorite?: string; motif?: string; code?: string;\n"
        "}\n"
        "export interface RegistrePlateformes {\n"
        "  version: string; ytdlp: string; categories: readonly { id: CategoriePlateforme; nom: string }[];\n"
        "  icones: Readonly<Record<string, string>>; plateformes: readonly PlateformeRegistre[];\n"
        "}\n\n"
        f"export const REGISTRE_PLATEFORMES: RegistrePlateformes = {payload};\n"
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Copie du registre des plateformes pour le site.")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args(argv)
    expected = render()
    if args.check:
        current = TARGET.read_text(encoding="utf-8") if TARGET.exists() else ""
        if current != expected:
            print(f"ÉCART : {TARGET.relative_to(ROOT)} n'est pas à jour : python3 scripts/sync-plateformes.py",
                  file=sys.stderr)
            return 1
        print("OK : copie du registre des plateformes à jour")
        return 0
    TARGET.write_text(expected, encoding="utf-8")
    print(f"Écrit : {TARGET.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

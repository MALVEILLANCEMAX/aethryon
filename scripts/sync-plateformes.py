#!/usr/bin/env python3
"""Copie publique du registre UNIQUE des plateformes (apps/media-api/app/plateformes.json) pour le site.

Écrit apps/web/src/lib/plateformes-registre.ts (champs publics seulement : jamais les extracteurs yt-dlp) et le CATALOGUE pour
les interfaces docs/api/CATALOGUE-PLATEFORMES.json (plateformes disponibles, formats réellement compatibles, fonctions
indisponibles avec leur raison, attribution obligatoire). Avec --check : n'écrit rien, code 1 si une copie diffère de la
source (lancé par `make test`). Bibliothèque standard seule.
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
CATALOGUE = ROOT / "docs/api/CATALOGUE-PLATEFORMES.json"
FORMATS = ("mp4", "mp3", "gif", "extrait")
NOMS_FORMATS = {"mp4": "MP4", "mp3": "MP3", "gif": "GIF", "extrait": "Extrait"}
STATUTS = {
    "disponible": "officielle : ouverte en production, essais réels réussis",
    "prete_a_ouvrir": "bêta validée par le propriétaire : essais de bout en bout réussis, ouverte seulement quand "
                      "PLATEFORMES_BETA la nomme (GET /platforms donne l'état réel du serveur)",
    "preproduction": "bêta désactivée : extracteur présent, conditions ou décision en attente",
    "indisponible": "connue mais coupée : message « temporairement indisponible »",
    "refusee": "jamais téléchargée (DRM, streaming payant, catalogue musical, conditions)",
}
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


def _statut(p: dict) -> str:
    if p["etat"] == "officielle":
        return "disponible"
    if p["etat"] == "beta":
        return "prete_a_ouvrir" if p.get("valide") else "preproduction"
    return p["etat"]


def render_catalogue() -> str:
    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    items = []
    for p in data["plateformes"]:
        statut = _statut(p)
        prouvee = statut in ("disponible", "prete_a_ouvrir")  # essais de bout en bout ou production
        permis = [f for f in FORMATS if p["etat"] in ("officielle", "beta") and f in (p.get("formats") or [])]
        formats = permis if prouvee else []
        raisons = p.get("indisponibles") or {}
        if p["etat"] == "indisponible":
            raison_generale = f"{p['nom']} est temporairement indisponible."
        elif p["etat"] == "refusee":
            raison_generale = p.get("motif") or "Plateforme non acceptée."
        elif statut == "preproduction":
            raison_generale = f"{p['nom']} : plateforme en essai, pas encore ouverte."
        else:
            raison_generale = f"{p['nom']} : non proposé pour cette plateforme."
        fermees = [{"fonction": f, "raison": raisons.get(f) or raison_generale} for f in FORMATS if f not in formats]
        item = {"id": p["id"], "nom": p["nom"], "categorie": p["categorie"], "icone": p["icone"], "etat": p["etat"],
                "statut": statut, "domaines": p["domaines"], "formats_compatibles": formats,
                "fonctions_indisponibles": fermees, "attribution_obligatoire": p.get("attribution") is True}
        if not prouvee and permis:
            item["formats_theoriques"] = permis  # extracteur présent, jamais prouvés de bout en bout
        for k in ("priorite", "essai", "valide", "conditions"):
            if p.get(k):
                item[k] = p[k]
        items.append(item)
    body = {
        "_lisezmoi": "FICHIER GÉNÉRÉ par scripts/sync-plateformes.py depuis apps/media-api/app/plateformes.json : ne pas "
                     "modifier à la main. Catalogue pour les interfaces (site, extension, Desktop, bot, démos). "
                     "formats_compatibles = formats permis ET prouvés par les essais réels ; une plateforme "
                     "« prete_a_ouvrir » n'est utilisable que lorsque GET /media/platforms la dit « disponible ». "
                     "attribution_obligatoire : afficher job.attribution.texte (auteur, licence, source) avec le "
                     "fichier. Icônes : pictogrammes neutres (aucun logo de marque).",
        "version": data["version"], "ytdlp": data["ytdlp"], "statuts": STATUTS, "formats": NOMS_FORMATS,
        "categories": data["categories"], "icones": data["icones"], "plateformes": items,
    }
    return json.dumps(body, ensure_ascii=False, indent=2) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Copie du registre des plateformes pour le site.")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args(argv)
    expected = {TARGET: render(), CATALOGUE: render_catalogue()}
    if args.check:
        for target, text in expected.items():
            current = target.read_text(encoding="utf-8") if target.exists() else ""
            if current != text:
                print(f"ÉCART : {target.relative_to(ROOT)} n'est pas à jour : python3 scripts/sync-plateformes.py",
                      file=sys.stderr)
                return 1
        print("OK : copie du registre et catalogue des plateformes à jour")
        return 0
    for target, text in expected.items():
        target.write_text(text, encoding="utf-8")
        print(f"Écrit : {target.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

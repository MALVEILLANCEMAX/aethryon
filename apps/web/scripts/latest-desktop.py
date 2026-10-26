#!/usr/bin/env python3
"""Annonce de mise à jour d'AETHRYON Desktop : downloads/desktop/latest.json (lue par desktop/noyau/src/maj_desktop.rs).

Schéma EXACT : {"version", "file", "sha256", "size", "released", "notes"}
  version   version d'AETHRYON Desktop contenue dans le setup (comparée à celle du Desktop installé) ;
  file      nom du setup publié, AETHRYON-Setup-<version du setup>.exe (servi sous /downloads/desktop/ ET premiere/) ;
  sha256    empreinte du setup (minuscules), identique à sa ligne de SHA256SUMS ; size : taille en octets ;
  released  AAAA-MM-JJ, date de la section du CHANGELOG du Desktop ; notes : lignes « - … » de cette section.

  Écrire  : latest-desktop.py --setup AETHRYON-Setup-X.exe --desktop-version 1.0.0-beta.4 --notes desktop/CHANGELOG.md
                              --sortie latest-desktop.json
  Vérifier : latest-desktop.py --verifier latest-desktop.json --setup <setup publié> --sha256sums <SHA256SUMS publié>
"""
import argparse
import hashlib
import json
import os
import re
import sys

VERSION = re.compile(r"^\d{1,5}\.\d{1,5}\.\d{1,5}(-beta\.\d{1,5})?$")
FICHIER = re.compile(r"^AETHRYON-Setup-\d{1,5}\.\d{1,5}\.\d{1,5}(-beta\.\d{1,5})?\.exe$")


def section(changelog, version):
    lignes = open(changelog, encoding="utf-8").read().splitlines()
    tete = re.compile(r"^##\s+\[?%s\]?\s+[—–-]\s+(\d{4}-\d{2}-\d{2})\s*$" % re.escape(version))
    for i, l in enumerate(lignes):
        m = tete.match(l)
        if m:
            notes = []
            for x in lignes[i + 1:]:
                if x.startswith("## "):
                    break
                n = re.match(r"^[-*]\s+(.+)$", x.strip())
                if n:
                    notes.append(re.sub(r"\*\*([^*]*)\*\*", r"\1", re.sub(r"`([^`]*)`", r"\1", n.group(1))).strip())
            return m.group(1), notes
    sys.exit("CHANGELOG : aucune section « ## %s — AAAA-MM-JJ »" % version)


def valider(r):
    assert set(r) == {"version", "file", "sha256", "size", "released", "notes"}, "champs : %s" % sorted(r)
    assert VERSION.match(r["version"]), "version"
    assert FICHIER.match(r["file"]), "file"
    assert re.fullmatch(r"[0-9a-f]{64}", r["sha256"]), "sha256"
    assert isinstance(r["size"], int) and 0 < r["size"] <= 300 * 1024 * 1024, "size"
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", r["released"]), "released"
    assert isinstance(r["notes"], list) and len(r["notes"]) <= 30 and all(isinstance(n, str) for n in r["notes"]), "notes"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--setup", required=True)
    ap.add_argument("--desktop-version")
    ap.add_argument("--notes")
    ap.add_argument("--sortie")
    ap.add_argument("--verifier")
    ap.add_argument("--sha256sums")
    a = ap.parse_args()
    d = open(a.setup, "rb").read()
    sha = hashlib.sha256(d).hexdigest()
    if a.verifier:
        r = json.load(open(a.verifier, encoding="utf-8"))
        try:
            valider(r)
            assert r["file"] == os.path.basename(a.setup), "file ≠ setup publié (%s)" % os.path.basename(a.setup)
            assert r["sha256"] == sha and r["size"] == len(d), "empreinte ou taille ≠ setup publié"
            if a.sha256sums:
                lignes = [l.split() for l in open(a.sha256sums, encoding="utf-8").read().splitlines() if l.strip()]
                assert [sha, r["file"]] in [[x[0], x[-1].lstrip("*")] for x in lignes], "absent de SHA256SUMS ou empreinte différente"
        except AssertionError as e:
            sys.exit("latest-desktop.json incohérent : %s" % e)
        print("latest-desktop.json cohérent : %s, Desktop %s, sha256 %s…" % (r["file"], r["version"], sha[:16]))
        return
    if not (a.desktop_version and a.notes and a.sortie):
        sys.exit("--desktop-version, --notes et --sortie sont requis pour écrire l'annonce")
    publiee, notes = section(a.notes, a.desktop_version)
    r = {"version": a.desktop_version, "file": os.path.basename(a.setup), "sha256": sha, "size": len(d), "released": publiee, "notes": notes[:8]}
    valider(r)
    with open(a.sortie + ".tmp", "w", encoding="utf-8") as f:
        json.dump(r, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(a.sortie + ".tmp", a.sortie)
    print("annonce du Desktop : %s (%s, %d octets, sha256 %s…)" % (a.sortie, r["file"], len(d), sha[:16]))


if __name__ == "__main__":
    main()

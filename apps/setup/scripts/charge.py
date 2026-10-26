#!/usr/bin/env python3
"""Compose charge.zip (la charge embarquée dans AETHRYON-Setup.exe) et son charge.json.

  python3 -I charge.py --sortie charge.zip --version 2.0.0-beta.1 \
      --zxp fr.aethryon.premiere.zxp [--remplacant] [--signature-json sig.json] \
      --desktop-exe aethryon-desktop.exe --desktop-dll WebView2Loader.dll --desktop-version 1.0.0-beta.3 \
      --ui-exe aethryon-setup-ui.exe --ui-dll WebView2Loader.dll \
      [--navigateur-zip aethryon-extension-3.6.1.zip]

--navigateur-zip : archive de PRODUCTION de l'extension navigateur (identique octet pour octet à celle publiée, avec
son latest.json) ; posée par le setup dans %LOCALAPPDATA%\AETHRYON\extension. Sa version et son identifiant sont lus
dans manifest.json (clé publique → identifiant Chrome, production exigée), chaque entrée est examinée.

La version et l'intervalle de Premiere de l'extension sont LUS dans CSXS/manifest.xml du ZXP signé ; l'archive est
déterministe (dates fixes, ordre fixe) pour que la même entrée donne la même charge.
"""
import argparse
import datetime
import hashlib
import io
import json
import os
import sys
import xml.etree.ElementTree as ET
import base64
import zipfile

ID_PRODUCTION = "necpohicddjeaeaaomaakehcbccapabg"


def navigateur(chemin):
    """Archive de l'extension navigateur → (version, identifiant), ou arrêt si elle n'est pas sûre."""
    z = zipfile.ZipFile(chemin)
    for i in z.infolist():
        n = i.filename
        if n.startswith("/") or "\\" in n or ":" in n or any(p in ("", ".", "..") for p in n.rstrip("/").split("/")):
            sys.exit("extension navigateur : entrée refusée %r" % n)
        if (i.external_attr >> 16) & 0o170000 == 0o120000:
            sys.exit("extension navigateur : lien symbolique %r" % n)
    m = json.loads(z.read("manifest.json"))
    ident = "".join(chr(97 + int(c, 16)) for c in hashlib.sha256(base64.b64decode(m["key"])).hexdigest()[:32])
    if m.get("name") != "AETHRYON" or m.get("manifest_version") != 3 or ident != ID_PRODUCTION:
        sys.exit("extension navigateur : ce n'est pas la version de production (nom, Manifest V3, identifiant %s)" % ident)
    return m["version"], ident


def fichier(source, nom, chemin):
    d = open(chemin, "rb").read()
    return {"source": source, "nom": nom, "sha256": hashlib.sha256(d).hexdigest(), "taille": len(d)}, d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sortie", required=True)
    ap.add_argument("--version", required=True)
    ap.add_argument("--zxp", required=True)
    ap.add_argument("--remplacant", action="store_true")
    ap.add_argument("--signature-json")
    ap.add_argument("--desktop-exe")
    ap.add_argument("--desktop-dll")
    ap.add_argument("--desktop-version")
    ap.add_argument("--ui-exe", required=True)
    ap.add_argument("--ui-dll", required=True)
    ap.add_argument("--navigateur-zip")
    a = ap.parse_args()

    zxp = zipfile.ZipFile(a.zxp)
    noms = zxp.namelist()
    if "META-INF/signatures.xml" not in noms or zxp.read("mimetype") != b"application/vnd.adobe.air-ucf-package+zip":
        sys.exit("ZXP non signé ou invalide : %s" % a.zxp)
    for i in zxp.infolist():
        if (i.external_attr >> 16) & 0o170000 == 0o120000:
            sys.exit("lien symbolique dans le ZXP : %s" % i.filename)
    try:
        man = ET.fromstring(zxp.read("CSXS/manifest.xml"))
    except ET.ParseError as e:
        sys.exit("CSXS/manifest.xml de l'extension n'est pas du XML bien formé (%s) : CEP ne pourrait pas le lire." % e)
    ident = man.get("ExtensionBundleId")
    version_ext = man.get("ExtensionBundleVersion") or "inconnue"
    if ident != "fr.aethryon.premiere":
        sys.exit("identifiant d'extension inattendu : %s" % ident)
    hote = next((h.get("Version") for h in man.iter() if h.tag.endswith("Host") and h.get("Name") == "PPRO"), None)
    if not hote:
        sys.exit("le manifeste de l'extension ne déclare pas Premiere Pro (Host PPRO)")

    entrees = []
    ext, d_ext = fichier("extension/fr.aethryon.premiere.zxp", "fr.aethryon.premiere.zxp", a.zxp)
    entrees.append((ext["source"], d_ext))
    signature = json.load(open(a.signature_json)) if a.signature_json else {}
    desktop = None
    if a.desktop_exe:
        f1, d1 = fichier("desktop/aethryon-desktop.exe", "aethryon-desktop.exe", a.desktop_exe)
        f2, d2 = fichier("desktop/WebView2Loader.dll", "WebView2Loader.dll", a.desktop_dll)
        entrees += [(f1["source"], d1), (f2["source"], d2)]
        desktop = {"version": a.desktop_version, "exe": "aethryon-desktop.exe", "fichiers": [f1, f2]}
    nav = None
    if a.navigateur_zip:
        v_nav, id_nav = navigateur(a.navigateur_zip)
        fn, dn = fichier("navigateur/aethryon-extension-%s.zip" % v_nav, "aethryon-extension-%s.zip" % v_nav, a.navigateur_zip)
        entrees.append((fn["source"], dn))
        nav = {"id": id_nav, "version": v_nav, "fichier": fn}
    u1, e1 = fichier("setup/aethryon-setup-ui.exe", "aethryon-setup-ui.exe", a.ui_exe)
    u2, e2 = fichier("setup/WebView2Loader.dll", "WebView2Loader.dll", a.ui_dll)
    entrees += [(u1["source"], e1), (u2["source"], e2)]
    manifeste = {
        "schema": 1,
        "produit": "AETHRYON",
        "version": a.version,
        "editeur": "AETHRYON",
        "construitLe": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "extension": {"id": ident, "version": version_ext, "fichier": ext, "hotePpro": hote, "remplacant": a.remplacant, "signature": signature},
        "desktop": desktop,
        "navigateur": nav,
        "interface": [u1, u2],
    }
    with zipfile.ZipFile(a.sortie + ".tmp", "w") as z:
        def ecrire(nom, d):
            zi = zipfile.ZipInfo(nom, date_time=(2026, 1, 1, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            z.writestr(zi, d, compresslevel=9)
        ecrire("charge.json", json.dumps(manifeste, ensure_ascii=False, indent=1).encode("utf-8"))
        for nom, d in entrees:
            ecrire(nom, d)
    os.replace(a.sortie + ".tmp", a.sortie)
    print("charge : %s (%d octets) — extension %s %s, Premiere %s, Desktop %s, extension navigateur %s" % (
        a.sortie, os.path.getsize(a.sortie), ident, version_ext, hote, desktop["version"] if desktop else "absent", nav["version"] if nav else "absente"))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Essais de zxp.py, avec un matériel de signature JETABLE (jamais celui de <dossier privé de signature>).

  python3 -I essais_zxp.py [--reference UN.zxp]

--reference : un ZXP réel signé par ZXPSignCmd d'Adobe ; zxp.py doit le déclarer valide (format relevé fidèle), puis
invalide dès qu'un octet d'un fichier change.
"""
import base64
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ICI)
import zxp  # noqa: E402

REFERENCE = None


def ecrire(chemin, donnees, mode="w"):
    """Écrit (ou ajoute, mode « ab ») et ferme le fichier aussitôt."""
    with open(chemin, mode, **({} if "b" in mode else {"encoding": "utf-8", "newline": ""})) as f:
        f.write(donnees)


def lire(chemin):
    with open(chemin, encoding="utf-8") as f:
        return f.read()


def extraire(z, d):
    with zipfile.ZipFile(z) as f:
        f.extractall(d)


def xmlsec_ok(dossier):
    """xmlsec1 sur le paquet extrait : (SignedInfo ok, références ok, références totales)."""
    shutil.copy(os.path.join(dossier, "META-INF", "signatures.xml"), os.path.join(dossier, "_sig.xml"))
    r = subprocess.run(["xmlsec1", "--verify", "--insecure", "--id-attr:Id", "http://www.w3.org/2000/09/xmldsig#:Manifest",
                        "--enabled-reference-uris", "same-doc,local,remote", "_sig.xml"], cwd=dossier, capture_output=True, text=True)
    os.remove(os.path.join(dossier, "_sig.xml"))
    out = r.stdout + r.stderr
    import re
    si = re.search(r"SignedInfo References \(ok/all\): (\d+)/(\d+)", out)
    mf = re.search(r"Manifests References \(ok/all\): (\d+)/(\d+)", out)
    return (r.returncode == 0 and si and si.group(1) == si.group(2) == "1"), int(mf.group(1)), int(mf.group(2))


class Essais(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.t = tempfile.mkdtemp()
        cls.secrets = os.path.join(cls.t, "secrets")
        subprocess.run(["bash", os.path.join(ICI, "creer-certificats.sh"), cls.secrets], check=True, capture_output=True)
        cls.src = os.path.join(cls.t, "ext")
        os.makedirs(os.path.join(cls.src, "CSXS"))
        os.makedirs(os.path.join(cls.src, "client", "Éléments"))
        ecrire(os.path.join(cls.src, "CSXS", "manifest.xml"), '<ExtensionManifest ExtensionBundleId="fr.aethryon.premiere"/>')
        ecrire(os.path.join(cls.src, "client", "index.html"), "<!doctype html><p>é & <b>x</b></p>")
        ecrire(os.path.join(cls.src, "client", "Éléments", "a&b.txt"), os.urandom(4096), "wb")
        ecrire(os.path.join(cls.src, "Zeta.js"), "// z")
        ecrire(os.path.join(cls.src, "alpha.js"), "// a")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.t)

    def signer(self, nom, **k):
        sortie = os.path.join(self.t, nom)
        zxp.signer(self.src, sortie, os.path.join(self.secrets, "signature.p12"), os.path.join(self.secrets, "mot-de-passe"),
                   k.get("tsa", os.path.join(self.secrets, "tsa")), k.get("algo", "rsa-sha1"), k.get("algo_h", "sha1"))
        return sortie

    def ca(self):
        return os.path.join(self.secrets, "tsa", "tsa.crt.pem")

    def test_01_signe_et_verifie(self):
        z = self.signer("a.zxp")
        r = zxp.verifier(z, self.ca(), True)
        self.assertTrue(r["valide"], r["erreurs"])
        self.assertEqual(r["fichiers_signes"], 6)  # mimetype + 5 fichiers
        self.assertTrue(r["horodatage"]["valide"])
        with zipfile.ZipFile(z) as f:
            infos = f.infolist()
            self.assertEqual(infos[0].filename, "mimetype")
            self.assertEqual(infos[0].compress_type, zipfile.ZIP_STORED)
            self.assertEqual(f.read("mimetype"), zxp.MIMETYPE)
        d = os.path.join(self.t, "a")
        extraire(z, d)
        self.assertTrue(zxp.verifier(d, self.ca(), True)["valide"])
        ok, n, tot = xmlsec_ok(d)
        self.assertTrue(ok)
        self.assertEqual((n, tot), (6, 6))

    def test_02_ordre_insensible_a_la_casse(self):
        z = self.signer("o.zxp")
        xml = zipfile.ZipFile(z).read("META-INF/signatures.xml").decode()
        uris = [u.split('"')[0] for u in xml.split('<Reference URI="')[1:]]
        self.assertEqual(uris, ["mimetype", "alpha.js", "client/index.html", "client/Éléments/a&amp;b.txt", "CSXS/manifest.xml", "Zeta.js"])

    def test_03_sha256_et_horodatage_sha256(self):
        z = self.signer("b.zxp", algo="rsa-sha256", algo_h="sha256")
        r = zxp.verifier(z, self.ca(), True)
        self.assertTrue(r["valide"], r["erreurs"])
        self.assertEqual(r["algo"], "rsa-sha256")
        d = os.path.join(self.t, "b")
        extraire(z, d)
        self.assertTrue(xmlsec_ok(d)[0])

    def test_04_sans_horodatage(self):
        z = self.signer("c.zxp", tsa=None)
        r = zxp.verifier(z, None, False)
        self.assertTrue(r["valide"])
        self.assertIn("aucun horodatage", r["avertissements"])
        self.assertFalse(zxp.verifier(z, None, True)["valide"])

    def falsifier(self, nom, action):
        z = self.signer(nom + ".zxp")
        d = os.path.join(self.t, nom)
        extraire(z, d)
        action(d)
        return zxp.verifier(d, self.ca(), True), d

    def test_05_fichier_modifie(self):
        def a(d):
            with open(os.path.join(d, "client", "index.html"), "ab") as f:
                f.write(b" ")
        r, d = self.falsifier("f1", a)
        self.assertFalse(r["valide"])
        self.assertIn("fichier modifié : client/index.html", r["erreurs"])
        self.assertEqual(xmlsec_ok(d)[1:], (5, 6))

    def test_06_fichier_ajoute_ou_retire(self):
        r, _ = self.falsifier("f2", lambda d: ecrire(os.path.join(d, "client", "en-trop.js"), "x"))
        self.assertIn("fichiers non signés : client/en-trop.js", r["erreurs"])
        r, _ = self.falsifier("f3", lambda d: os.remove(os.path.join(d, "alpha.js")))
        self.assertIn("fichier référencé absent : alpha.js", r["erreurs"])
        r, _ = self.falsifier("f4", lambda d: ecrire(os.path.join(d, ".DS_Store"), "x"))
        self.assertFalse(r["valide"])

    def test_07_lien_symbolique(self):
        r, _ = self.falsifier("f5", lambda d: (os.remove(os.path.join(d, "Zeta.js")), os.symlink("alpha.js", os.path.join(d, "Zeta.js"))))
        self.assertFalse(r["valide"])
        self.assertTrue(any("liens symboliques" in e for e in r["erreurs"]))
        os.symlink("alpha.js", os.path.join(self.src, "lien.js"))
        try:
            with self.assertRaises(zxp.ErreurZxp):
                self.signer("refus.zxp")
        finally:
            os.remove(os.path.join(self.src, "lien.js"))

    def test_08_signature_ou_horodatage_altere(self):
        def sig(d):
            p = os.path.join(d, "META-INF", "signatures.xml")
            s = lire(p)
            i = s.index('Id="PackageSignatureValue">') + len('Id="PackageSignatureValue">')
            c = "A" if s[i + 10] != "A" else "B"
            ecrire(p, s[:i + 10] + c + s[i + 11:])
        r, _ = self.falsifier("f6", sig)
        self.assertIn("signature RSA de SignedInfo invalide", r["erreurs"])
        self.assertIn("horodatage invalide", r["erreurs"])

        def man(d):
            p = os.path.join(d, "META-INF", "signatures.xml")
            ecrire(p, lire(p).replace('URI="alpha.js"', 'URI="Zeta.js"', 1))
        r, _ = self.falsifier("f7", man)
        self.assertIn("empreinte du Manifest invalide", r["erreurs"])

    def test_11_manifeste_mal_forme_refuse(self):
        m = os.path.join(self.src, "CSXS", "manifest.xml")
        avant = lire(m)
        ecrire(m, '<!-- option --enable-nodejs --><ExtensionManifest ExtensionBundleId="fr.aethryon.premiere"/>')
        try:
            with self.assertRaises(zxp.ErreurZxp) as e:
                self.signer("mal-forme.zxp")
            self.assertIn("pas du XML bien formé", str(e.exception))
        finally:
            ecrire(m, avant)

    def test_09_certificat_v1_comme_zxpsigncmd(self):
        out = subprocess.run(["openssl", "x509", "-in", os.path.join(self.secrets, "signature.crt.pem"), "-noout", "-text"],
                             capture_output=True, text=True).stdout
        self.assertIn("Version: 1 (0x0)", out)
        self.assertIn("sha256WithRSAEncryption", out)
        self.assertIn("Public-Key: (2048 bit)", out)

    def test_10_reference_adobe(self):
        if not REFERENCE:
            self.skipTest("aucun ZXP de référence fourni")
        r = zxp.verifier(REFERENCE, None, True)
        self.assertTrue(r["valide"], r["erreurs"])
        d = os.path.join(self.t, "ref")
        extraire(REFERENCE, d)
        self.assertTrue(zxp.verifier(d, None, True)["valide"])
        ok, n, tot = xmlsec_ok(d)
        self.assertTrue(ok and n == tot)
        cible = os.path.join(d, "CSXS", "manifest.xml")
        ecrire(cible, b" ", "ab")
        self.assertIn("fichier modifié : CSXS/manifest.xml", zxp.verifier(d, None, True)["erreurs"])


if __name__ == "__main__":
    if "--reference" in sys.argv:
        i = sys.argv.index("--reference")
        REFERENCE = sys.argv[i + 1]
        del sys.argv[i:i + 2]
    unittest.main(verbosity=2)

#!/usr/bin/env python3
"""Signature et vérification de paquets ZXP (extensions CEP d'Adobe), depuis Linux, sans ZXPSignCmd.

Réimplémentation du format que produit ZXPSignCmd 4.1.x, relevé sur un ZXP réel signé par l'outil d'Adobe
(voir FORMAT.md) :
  - `mimetype` = « application/vnd.adobe.air-ucf-package+zip » ;
  - `META-INF/signatures.xml` : XML-DSig, <SignedInfo> qui signe (C14N 1.0 inclusive) un <Manifest Id="PackageContents">
    listant chaque fichier (y compris `mimetype`) avec son SHA-256 ; certificat X.509 dans <KeyInfo> ;
  - horodatage RFC 3161 (réponse TimeStampResp entière, en base64) dans un bloc XAdES 1.1.1, calculé sur la forme
    canonique de <SignatureValue> dont le base64 est écrit SANS retour à la ligne.

Sous-commandes :
  signer    --source DOSSIER --sortie X.zxp --p12 F --mot-de-passe-fichier F [--tsa-dossier D | --sans-horodatage]
  verifier  X.zxp | DOSSIER  [--tsa-ca CERT.pem] [--exiger-horodatage] [--json]

Aucune clé ni aucun mot de passe n'est jamais affiché. Dépendances : python3-lxml (analyse XML seulement : la forme
canonique est calculée ici, car `tostring(method="c14n")` de lxml 4.9 / libxml2 ajoute `xmlns=""` à certains
descendants d'un sous-arbre), python3-cryptography, openssl (pour l'autorité d'horodatage locale).
"""
import argparse
import base64
import datetime
import hashlib
import io
import json
import os
import stat
import subprocess
import sys
import tempfile
import zipfile

from lxml import etree

DSIG = "http://www.w3.org/2000/09/xmldsig#"
XADES = "http://uri.etsi.org/01903/v1.1.1#"
C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315"
SHA256_URI = "http://www.w3.org/2001/04/xmlenc#sha256"
TYPE_MANIFESTE = "http://www.w3.org/2000/09/xmldsig#Manifest"
MIMETYPE = b"application/vnd.adobe.air-ucf-package+zip"
ALGOS_SIGNATURE = {
    "rsa-sha1": ("http://www.w3.org/2000/09/xmldsig#rsa-sha1", "sha1"),
    "rsa-sha256": ("http://www.w3.org/2001/04/xmldsig-more#rsa-sha256", "sha256"),
}
ALGOS_EMPREINTE = {SHA256_URI: "sha256", "http://www.w3.org/2000/09/xmldsig#sha1": "sha1"}
# Fichiers que le problème connu de novembre 2024 (et les archives de macOS) rendent dangereux dans un paquet signé.
NOMS_INTERDITS = {".DS_Store", "Thumbs.db", "desktop.ini"}
DOSSIERS_INTERDITS = {"__MACOSX", ".git"}
CRLF = "\r\n"


class ErreurZxp(Exception):
    pass


# ---------------------------------------------------------------------------------------------------------------
# Forme canonique XML 1.0 inclusive, sans commentaires (W3C REC-xml-c14n-20010315) d'un sous-arbre.

def _echapper_attr(v):
    return (v.replace("&", "&amp;").replace("<", "&lt;").replace('"', "&quot;")
            .replace("\t", "&#x9;").replace("\n", "&#xA;").replace("\r", "&#xD;"))


def _echapper_texte(v):
    return v.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\r", "&#xD;")


def c14n(element):
    """Sous-arbre `element` (lxml) en C14N 1.0 inclusive : l'apex porte toutes les déclarations d'espaces de noms en
    portée ; les descendants ne redéclarent que ce qui change. Attributs triés (espace de noms, nom local)."""
    morceaux = []

    def rendre(e, rendus):
        portee = dict(e.nsmap)
        decl = {p: u for p, u in portee.items() if rendus.get(p) != u}
        if None not in portee and rendus.get(None):
            decl[None] = ""
        nom = (e.prefix + ":" if e.prefix else "") + etree.QName(e).localname
        s = "<" + nom
        for p in sorted(decl, key=lambda x: "" if x is None else x):
            s += (' xmlns="%s"' % _echapper_attr(decl[p])) if p is None else (' xmlns:%s="%s"' % (p, _echapper_attr(decl[p])))
        attrs = []
        for cle, val in e.attrib.items():
            q = etree.QName(cle)
            if q.namespace:
                pref = next(p for p, u in portee.items() if u == q.namespace and p)
                attrs.append(((q.namespace, q.localname), pref + ":" + q.localname, val))
            else:
                attrs.append((("", q.localname), q.localname, val))
        for _, n, v in sorted(attrs):
            s += ' %s="%s"' % (n, _echapper_attr(v))
        morceaux.append(s + ">")
        if e.text:
            morceaux.append(_echapper_texte(e.text))
        suivants = dict(rendus)
        suivants.update(decl)
        for enfant in e:
            if isinstance(enfant.tag, str):
                rendre(enfant, suivants)
            # commentaires et instructions de traitement : ignorés (C14N sans commentaires) ; leur « tail » reste
            if enfant.tail:
                morceaux.append(_echapper_texte(enfant.tail))
        morceaux.append("</%s>" % nom)

    rendre(element, {})
    return "".join(morceaux).encode("utf-8")


def b64(data):
    return base64.b64encode(data).decode("ascii")


def b64_lignes(data, largeur=64):
    t = b64(data)
    return CRLF.join(t[i:i + largeur] for i in range(0, len(t), largeur))


# ---------------------------------------------------------------------------------------------------------------
# Inventaire du dossier source

def inventaire(source):
    """Liste (chemin relatif « / », chemin absolu) des fichiers, dans l'ordre d'un dossier NTFS (insensible à la casse).
    Refuse liens symboliques, fichiers spéciaux et fichiers parasites (problème connu de novembre 2024)."""
    fichiers, dossiers = [], []
    for racine, sous, noms in os.walk(source, followlinks=False):
        rel_racine = os.path.relpath(racine, source)
        for d in list(sous):
            p = os.path.join(racine, d)
            if os.path.islink(p):
                raise ErreurZxp("lien symbolique interdit dans le paquet : %s" % os.path.relpath(p, source))
            if d in DOSSIERS_INTERDITS:
                raise ErreurZxp("dossier interdit dans le paquet : %s" % os.path.relpath(p, source))
        sous.sort(key=lambda x: (x.lower(), x))
        if rel_racine != ".":
            dossiers.append(rel_racine.replace(os.sep, "/"))
        for n in noms:
            p = os.path.join(racine, n)
            rel = os.path.relpath(p, source).replace(os.sep, "/")
            st = os.lstat(p)
            if stat.S_ISLNK(st.st_mode):
                raise ErreurZxp("lien symbolique interdit dans le paquet : %s" % rel)
            if not stat.S_ISREG(st.st_mode):
                raise ErreurZxp("fichier spécial interdit : %s" % rel)
            if n in NOMS_INTERDITS:
                raise ErreurZxp("fichier parasite interdit : %s" % rel)
            if rel in ("mimetype", "META-INF/signatures.xml"):
                raise ErreurZxp("%s est produit par la signature : le retirer de la source" % rel)
            fichiers.append((rel, p))
    man = next((p for r, p in fichiers if r == "CSXS/manifest.xml"), None)
    if man is None:
        raise ErreurZxp("CSXS/manifest.xml absent : ce n'est pas une extension CEP")
    try:
        etree.parse(man, etree.XMLParser(resolve_entities=False, no_network=True))
    except etree.XMLSyntaxError as e:
        raise ErreurZxp("CSXS/manifest.xml n'est pas du XML bien formé (%s). CEP ne pourrait pas le lire. "
                        "Rappel : un commentaire XML ne peut pas contenir « -- »." % e)
    cle = lambda r: [x.lower() for x in r.split("/")]
    fichiers.sort(key=lambda x: cle(x[0]))
    dossiers.sort(key=cle)
    return fichiers, dossiers


# ---------------------------------------------------------------------------------------------------------------
# Signature

def charger_p12(p12, mot_de_passe_fichier):
    from cryptography.hazmat.primitives.serialization import pkcs12
    with open(mot_de_passe_fichier, "rb") as f:
        mdp = f.read().strip()
    with open(p12, "rb") as f:
        cle, cert, autres = pkcs12.load_key_and_certificates(f.read(), mdp)
    del mdp
    if cle is None or cert is None:
        raise ErreurZxp("le fichier PKCS#12 ne contient pas de clé et de certificat")
    return cle, cert, autres or []


def horodater_localement(donnees, tsa_dossier, algo):
    """Demande RFC 3161 à l'autorité d'horodatage LOCALE (openssl ts) : rien ne sort de la machine.
    Renvoie la réponse TimeStampResp complète (DER), comme ZXPSignCmd l'encapsule."""
    with tempfile.TemporaryDirectory() as t:
        d = os.path.join(t, "donnees")
        with open(d, "wb") as f:
            f.write(donnees)
        req, rep = os.path.join(t, "q.tsq"), os.path.join(t, "r.tsr")
        subprocess.run(["openssl", "ts", "-query", "-data", d, "-" + algo, "-cert", "-out", req],
                       check=True, capture_output=True)
        cnf = os.path.join(tsa_dossier, "tsa.cnf")
        # La clé de l'autorité est chiffrée par le même mot de passe que le PKCS#12, lu dans le fichier protégé.
        r = subprocess.run(["openssl", "ts", "-reply", "-config", cnf, "-queryfile", req, "-out", rep,
                            "-passin", "file:" + os.path.join(os.path.dirname(os.path.abspath(tsa_dossier)), "mot-de-passe")],
                           cwd=tsa_dossier, capture_output=True)
        if r.returncode != 0:
            raise ErreurZxp("autorité d'horodatage locale : échec (%s)" % r.stderr.decode(errors="replace").strip()[-300:])
        with open(rep, "rb") as f:
            return f.read()


def construire_xml(signed_info, valeur, cert_der, manifeste, horodatage, uri_algo):
    """Texte de signatures.xml, à la disposition exacte de ZXPSignCmd (CRLF entre les éléments)."""
    L = []
    L.append("<signatures>")
    L.append('<Signature xmlns="%s" Id="PackageSignature">' % DSIG)
    L.append(signed_info)
    # Base64 de la signature sur UNE ligne : la forme canonique horodatée est alors la même avant et après analyse.
    L.append('<SignatureValue Id="PackageSignatureValue">%s</SignatureValue>' % valeur)
    L.append("")
    L.append("<KeyInfo>")
    L.append("<X509Data>")
    L.append("<X509Certificate>%s%s</X509Certificate>" % (b64_lignes(cert_der), CRLF))
    L.append("</X509Data>")
    L.append("</KeyInfo>")
    L.append("<Object>")
    L.append(manifeste)
    L.append("</Object>")
    if horodatage is not None:
        L.append('<Object xmlns:xades="%s" >' % XADES)
        L.append("<xades:QualifyingProperties>")
        L.append("<xades:UnsignedProperties>")
        L.append("<xades:UnsignedSignatureProperties>")
        L.append("<xades:SignatureTimeStamp>")
        L.append('<xades:HashDataInfo uri="SignatureValue">')
        L.append("<Transforms>")
        L.append('<Transform Algorithm="%s"/>' % C14N)
        L.append("</Transforms>")
        L.append("</xades:HashDataInfo>")
        L.append("<xades:EncapsulatedTimeStamp>")
        L.append(b64_lignes(horodatage))
        L.append("</xades:EncapsulatedTimeStamp>")
        L.append("</xades:SignatureTimeStamp>")
        L.append("</xades:UnsignedSignatureProperties>")
        L.append("</xades:UnsignedProperties>")
        L.append("</xades:QualifyingProperties>")
        L.append("</Object>")
    L.append("</Signature>")
    L.append("</signatures>")
    return CRLF.join(L)


def texte_signed_info(uri_algo, empreinte_manifeste):
    return CRLF.join([
        "<SignedInfo>",
        '<CanonicalizationMethod Algorithm="%s"/>' % C14N,
        '<SignatureMethod Algorithm="%s"/>' % uri_algo,
        '<Reference Type="%s" URI="#PackageContents">' % TYPE_MANIFESTE,
        "<Transforms>",
        '<Transform Algorithm="%s"/>' % C14N,
        "</Transforms>",
        '<DigestMethod Algorithm="%s"/>' % SHA256_URI,
        "<DigestValue>%s</DigestValue>" % empreinte_manifeste,
        "</Reference>",
        "</SignedInfo>",
    ])


def _xml_attr(v):
    return v.replace("&", "&amp;").replace("<", "&lt;").replace('"', "&quot;")


def _element_dans_contexte(fragment):
    """Analyse un fragment dans le contexte de <Signature xmlns=DSIG> (mêmes espaces de noms qu'une fois écrit)."""
    doc = etree.fromstring(('<signatures><Signature xmlns="%s">' % DSIG + fragment + "</Signature></signatures>").encode("utf-8"))
    return doc[0][0]


def signer(source, sortie, p12, mdp_fichier, tsa_dossier=None, algo="rsa-sha1", algo_horodatage="sha1"):
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    fichiers, dossiers = inventaire(source)
    uri_algo, hash_algo = ALGOS_SIGNATURE[algo]
    cle, cert, _ = charger_p12(p12, mdp_fichier)
    refs = ['<Reference URI="mimetype"><DigestMethod Algorithm="%s"/><DigestValue>%s</DigestValue></Reference>'
            % (SHA256_URI, b64(hashlib.sha256(MIMETYPE).digest()))]
    for rel, p in fichiers:
        with open(p, "rb") as f:
            h = hashlib.sha256(f.read()).digest()
        refs.append('<Reference URI="%s"><DigestMethod Algorithm="%s"/><DigestValue>%s</DigestValue></Reference>'
                    % (_xml_attr(rel), SHA256_URI, b64(h)))
    manifeste = '<Manifest Id="PackageContents">' + CRLF + "".join(refs) + "</Manifest>"
    em = b64(hashlib.sha256(c14n(_element_dans_contexte(manifeste))).digest())
    si = texte_signed_info(uri_algo, em)
    h = hashes.SHA1() if hash_algo == "sha1" else hashes.SHA256()
    valeur = b64(cle.sign(c14n(_element_dans_contexte(si)), padding.PKCS1v15(), h))
    horodatage = None
    if tsa_dossier:
        sv = _element_dans_contexte('<SignatureValue Id="PackageSignatureValue">%s</SignatureValue>' % valeur)
        horodatage = horodater_localement(c14n(sv), tsa_dossier, algo_horodatage)
    xml = construire_xml(si, valeur, cert.public_bytes(serialization.Encoding.DER), manifeste, horodatage, uri_algo)
    # Archive : `mimetype` en premier et non compressé (convention UCF), puis META-INF, puis le reste (deflate).
    tmp = sortie + ".tmp"
    with zipfile.ZipFile(tmp, "w") as z:
        def info(nom, dossier=False):
            zi = zipfile.ZipInfo(nom, date_time=(2026, 1, 1, 0, 0, 0))
            zi.create_system = 0
            zi.external_attr = 0x10 if dossier else 0
            zi.compress_type = zipfile.ZIP_STORED if dossier or nom == "mimetype" else zipfile.ZIP_DEFLATED
            return zi
        z.writestr(info("mimetype"), MIMETYPE)
        z.writestr(info("META-INF/", True), b"")
        z.writestr(info("META-INF/signatures.xml"), xml.encode("utf-8"))
        for d in dossiers:
            z.writestr(info(d + "/", True), b"")
        for rel, p in fichiers:
            with open(p, "rb") as f:
                z.writestr(info(rel), f.read())
    os.replace(tmp, sortie)
    return {"fichiers": len(fichiers) + 1, "algo": algo, "horodatage": horodatage is not None}


# ---------------------------------------------------------------------------------------------------------------
# Vérification (indépendante de la signature : relit tout depuis le paquet)

class Paquet:
    def __init__(self, chemin):
        self.chemin = chemin
        self.est_zip = os.path.isfile(chemin)
        if self.est_zip:
            self.z = zipfile.ZipFile(chemin)
            self.liens = [i.filename for i in self.z.infolist() if (i.external_attr >> 16) & 0o170000 == 0o120000]
            self.noms = [i.filename for i in self.z.infolist() if not i.filename.endswith("/")]
        else:
            self.liens, self.noms = [], []
            for racine, sous, noms in os.walk(chemin, followlinks=False):
                for n in sous + noms:
                    p = os.path.join(racine, n)
                    if os.path.islink(p):
                        self.liens.append(os.path.relpath(p, chemin).replace(os.sep, "/"))
                for n in noms:
                    p = os.path.join(racine, n)
                    if not os.path.islink(p):
                        self.noms.append(os.path.relpath(p, chemin).replace(os.sep, "/"))

    def lire(self, nom):
        if self.est_zip:
            return self.z.read(nom)
        p = os.path.join(self.chemin, *nom.split("/"))
        if os.path.islink(p):
            raise ErreurZxp("lien symbolique : %s" % nom)
        with open(p, "rb") as f:
            return f.read()


def infos_horodatage(rep_der, donnees, tsa_ca):
    """Vérifie la réponse RFC 3161 par openssl ts : empreinte des données ET signature de l'autorité."""
    res = {"present": True}
    with tempfile.TemporaryDirectory() as t:
        r, d = os.path.join(t, "r.tsr"), os.path.join(t, "d")
        for chemin, contenu in ((r, rep_der), (d, donnees)):
            with open(chemin, "wb") as f:
                f.write(contenu)
        txt = subprocess.run(["openssl", "ts", "-reply", "-in", r, "-text"], capture_output=True, text=True)
        for ligne in txt.stdout.splitlines():
            if ligne.startswith("Time stamp:"):
                res["date"] = ligne.split(":", 1)[1].strip()
            elif ligne.startswith("Hash Algorithm:"):
                res["algo"] = ligne.split(":", 1)[1].strip()
            elif ligne.startswith("TSA:"):
                res["autorite"] = ligne.split(":", 1)[1].strip()
            elif ligne.startswith("Status:"):
                res["statut"] = ligne.split(":", 1)[1].strip()
        cmd = ["openssl", "ts", "-verify", "-in", r, "-data", d]
        if tsa_ca:
            cmd += ["-CAfile", tsa_ca]
        else:
            # Sans autorité de confiance fournie : on vérifie au moins l'empreinte et la signature avec le certificat
            # inclus dans le jeton (chaîne partielle), ce qui ne dit rien de la confiance accordée à l'autorité.
            tok = os.path.join(t, "tok")
            subprocess.run(["openssl", "ts", "-reply", "-in", r, "-token_out", "-out", tok], check=True, capture_output=True)
            certs = subprocess.run(["openssl", "pkcs7", "-inform", "DER", "-in", tok, "-print_certs"], capture_output=True, text=True).stdout
            ca = os.path.join(t, "ca.pem")
            with open(ca, "w") as f:
                f.write(certs)
            cmd += ["-CAfile", ca, "-partial_chain"]
        v = subprocess.run(cmd, capture_output=True, text=True)
        res["valide"] = v.returncode == 0 and "Verification: OK" in v.stdout
        res["confiance"] = "autorité fournie" if tsa_ca else "chaîne partielle (certificats du jeton)"
        if not res["valide"]:
            res["erreur"] = (v.stdout + v.stderr).strip()[-300:]
    return res


def verifier(chemin, tsa_ca=None, exiger_horodatage=False):
    import copy
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    pq = Paquet(chemin)
    r = {"paquet": os.path.basename(chemin.rstrip("/")), "erreurs": [], "avertissements": []}
    if pq.liens:
        r["erreurs"].append("liens symboliques : %s" % ", ".join(pq.liens))
    for n in pq.noms:
        if os.path.basename(n) in NOMS_INTERDITS or n.split("/")[0] in DOSSIERS_INTERDITS:
            r["erreurs"].append("fichier parasite : %s" % n)
    try:
        mt = pq.lire("mimetype")
        if mt != MIMETYPE:
            r["erreurs"].append("mimetype inattendu")
    except (KeyError, FileNotFoundError):
        r["erreurs"].append("mimetype absent")
    try:
        brut = pq.lire("META-INF/signatures.xml")
    except (KeyError, FileNotFoundError):
        r["erreurs"].append("META-INF/signatures.xml absent : paquet non signé")
        r["valide"] = False
        return r
    doc = etree.fromstring(brut, etree.XMLParser(resolve_entities=False, no_network=True))
    ns = {"d": DSIG, "x": XADES}
    sigs = doc.findall("d:Signature", ns)
    if len(sigs) != 1:
        r["erreurs"].append("%d éléments Signature (1 attendu)" % len(sigs))
        r["valide"] = False
        return r
    sig = sigs[0]
    si = sig.find("d:SignedInfo", ns)
    if si.find("d:CanonicalizationMethod", ns).get("Algorithm") != C14N:
        r["erreurs"].append("méthode de forme canonique inattendue")
    uri_algo = si.find("d:SignatureMethod", ns).get("Algorithm")
    algo = next((k for k, v in ALGOS_SIGNATURE.items() if v[0] == uri_algo), None)
    r["algo"] = algo or uri_algo
    refs = si.findall("d:Reference", ns)
    man = sig.find("d:Object/d:Manifest", ns)
    if len(refs) != 1 or refs[0].get("URI") != "#PackageContents" or man is None or man.get("Id") != "PackageContents":
        r["erreurs"].append("structure SignedInfo / Manifest inattendue")
        r["valide"] = False
        return r
    alg_ref = ALGOS_EMPREINTE.get(refs[0].find("d:DigestMethod", ns).get("Algorithm"))
    if b64(hashlib.new(alg_ref, c14n(man)).digest()) != refs[0].find("d:DigestValue", ns).text.strip():
        r["erreurs"].append("empreinte du Manifest invalide")
    certs = sig.findall("d:KeyInfo/d:X509Data/d:X509Certificate", ns)
    cert = x509.load_der_x509_certificate(base64.b64decode("".join(certs[0].text.split())))
    sv = sig.find("d:SignatureValue", ns)
    valeur = base64.b64decode("".join(sv.text.split()))
    try:
        h = hashes.SHA1() if algo == "rsa-sha1" else hashes.SHA256()
        cert.public_key().verify(valeur, c14n(si), padding.PKCS1v15(), h)
        r["signature_signedinfo"] = "valide"
    except Exception:
        r["erreurs"].append("signature RSA de SignedInfo invalide")
        r["signature_signedinfo"] = "INVALIDE"
    maintenant = datetime.datetime.utcnow()
    r["certificat"] = {
        "sujet": cert.subject.rfc4514_string(),
        "emetteur": cert.issuer.rfc4514_string(),
        "auto_signe": cert.subject == cert.issuer,
        "valide_du": cert.not_valid_before.isoformat() + "Z",
        "valide_au": cert.not_valid_after.isoformat() + "Z",
        "en_cours_de_validite": cert.not_valid_before <= maintenant <= cert.not_valid_after,
        "sha256": hashlib.sha256(cert.public_bytes(serialization.Encoding.DER)).hexdigest(),
        "cle_bits": cert.public_key().key_size,
    }
    # Fichiers : chaque référence correspond, et chaque fichier du paquet est référencé.
    vus = set()
    for ref in man.findall("d:Reference", ns):
        uri = ref.get("URI")
        if uri.startswith("/") or ".." in uri.split("/") or ":" in uri:
            r["erreurs"].append("URI de référence dangereuse : %s" % uri)
            continue
        vus.add(uri)
        a = ALGOS_EMPREINTE.get(ref.find("d:DigestMethod", ns).get("Algorithm"))
        try:
            contenu = pq.lire(uri)
        except (KeyError, FileNotFoundError):
            r["erreurs"].append("fichier référencé absent : %s" % uri)
            continue
        except ErreurZxp as e:
            r["erreurs"].append(str(e))
            continue
        if b64(hashlib.new(a, contenu).digest()) != ref.find("d:DigestValue", ns).text.strip():
            r["erreurs"].append("fichier modifié : %s" % uri)
    en_trop = [n for n in pq.noms if n not in vus and n != "META-INF/signatures.xml"]
    if en_trop:
        r["erreurs"].append("fichiers non signés : %s" % ", ".join(sorted(en_trop)))
    r["fichiers_signes"] = len(vus)
    # Horodatage XAdES
    ets = sig.find("d:Object/x:QualifyingProperties/x:UnsignedProperties/x:UnsignedSignatureProperties/x:SignatureTimeStamp/x:EncapsulatedTimeStamp", ns)
    if ets is None:
        r["horodatage"] = {"present": False}
        (r["erreurs"] if exiger_horodatage else r["avertissements"]).append("aucun horodatage")
    else:
        hdi = ets.getparent().find("x:HashDataInfo", ns)
        if hdi is None or hdi.get("uri") not in ("SignatureValue", "#PackageSignatureValue"):
            r["erreurs"].append("HashDataInfo inattendu")
        sv2 = copy.deepcopy(sv)
        sv2.text = "".join(sv.text.split())
        hd = infos_horodatage(base64.b64decode("".join(ets.text.split())), c14n(sv2), tsa_ca)
        r["horodatage"] = hd
        if not hd.get("valide"):
            r["erreurs"].append("horodatage invalide")
    r["valide"] = not r["erreurs"]
    return r


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sp = ap.add_subparsers(dest="cmd", required=True)
    s = sp.add_parser("signer")
    s.add_argument("--source", required=True)
    s.add_argument("--sortie", required=True)
    s.add_argument("--p12", required=True)
    s.add_argument("--mot-de-passe-fichier", required=True)
    g = s.add_mutually_exclusive_group(required=True)
    g.add_argument("--tsa-dossier")
    g.add_argument("--sans-horodatage", action="store_true")
    s.add_argument("--algo", choices=sorted(ALGOS_SIGNATURE), default="rsa-sha1")
    s.add_argument("--algo-horodatage", choices=["sha1", "sha256"], default="sha1")
    v = sp.add_parser("verifier")
    v.add_argument("chemin")
    v.add_argument("--tsa-ca")
    v.add_argument("--exiger-horodatage", action="store_true")
    v.add_argument("--json", action="store_true")
    a = ap.parse_args()
    try:
        if a.cmd == "signer":
            info = signer(a.source, a.sortie, a.p12, a.mot_de_passe_fichier, a.tsa_dossier, a.algo, a.algo_horodatage)
            print("signé : %s (%d fichiers, %s, horodatage : %s)" % (a.sortie, info["fichiers"], info["algo"], "oui" if info["horodatage"] else "non"))
        else:
            r = verifier(a.chemin, a.tsa_ca, a.exiger_horodatage)
            if a.json:
                print(json.dumps(r, ensure_ascii=False, indent=1))
            else:
                print("%s : %s" % (r["paquet"], "SIGNATURE VALIDE" if r["valide"] else "SIGNATURE INVALIDE"))
                c = r.get("certificat", {})
                if c:
                    print("  certificat : %s, %s, du %s au %s, RSA %d bits" % (c["sujet"], "auto-signé" if c["auto_signe"] else "émis par " + c["emetteur"], c["valide_du"][:10], c["valide_au"][:10], c["cle_bits"]))
                print("  algorithme : %s ; fichiers signés : %s" % (r.get("algo"), r.get("fichiers_signes")))
                hd = r.get("horodatage", {})
                if hd.get("present"):
                    print("  horodatage : %s, %s, autorité %s, %s (%s)" % (hd.get("date"), hd.get("algo"), hd.get("autorite"), "valide" if hd.get("valide") else "INVALIDE", hd.get("confiance")))
                else:
                    print("  horodatage : absent")
                for e in r["erreurs"]:
                    print("  ERREUR : " + e)
                for e in r["avertissements"]:
                    print("  avertissement : " + e)
            sys.exit(0 if r["valide"] else 1)
    except ErreurZxp as e:
        print("ERREUR : %s" % e, file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()

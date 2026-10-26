#!/usr/bin/env python3
"""Inspecte un raccourci signé (.shortcut au format AEA1) sans macOS.

    inspect_signed.py SIGNÉ.shortcut [--compare NON_SIGNÉ.shortcut] [--extract SORTIE.plist]

Contrôles :
  1. en-tête AEA1, profil 0 (signé, non chiffré) ;
  2. chaîne de certificats (auth data) vérifiée par openssl jusqu'à « Apple Root CA - G3 »,
     dont l'empreinte est figée ci-dessous (téléchargée sur apple.com/certificateauthority) ;
  3. extraction du contenu : en-tête racine, segments LZFSE, somme SHA-256 de chaque segment ;
  4. --compare : le plist signé doit avoir les mêmes actions, questions d'importation, types et
     entrées que le plist compilé. Les autres différences (ex. version cliente) sont listées.

Limite : la signature ECDSA de l'archive elle-même n'est PAS vérifiée ici (seul iOS le fait à
l'import). On vérifie la chaîne de certificats et l'intégrité des segments.
"""

from __future__ import annotations

import argparse
import hashlib
import plistlib
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

import lzfse

APPLE_ROOT_G3_SHA256 = "63343ABFB89A6A03EBB57E9B3F5FA7BE7C4F5C756F3017B3A8C488C3653E9179"
CHECKSUM_SIZE = {0: 0, 1: 8, 2: 32}
COMPRESSIONS = {ord("-"), ord("4"), ord("b"), ord("e"), ord("f"), ord("x"), ord("z")}
COMPARED_KEYS = ("WFWorkflowActions", "WFWorkflowImportQuestions", "WFWorkflowTypes",
                 "WFWorkflowInputContentItemClasses", "WFWorkflowNoInputBehavior")


class InspectError(Exception):
    pass


def check_chain(chain: list[bytes]) -> list[str]:
    report = []
    if len(chain) < 2:
        raise InspectError("chaîne de certificats trop courte")
    with tempfile.TemporaryDirectory() as tmp:
        pems = []
        for i, der in enumerate(chain):
            path = Path(tmp) / f"c{i}.pem"
            out = subprocess.run(["openssl", "x509", "-inform", "DER", "-out", str(path)],
                                 input=der, capture_output=True, check=True)
            pems.append(path)
            info = subprocess.run(["openssl", "x509", "-in", str(path), "-noout", "-subject", "-issuer",
                                   "-enddate"], capture_output=True, text=True, check=True).stdout
            report.append(f"cert {i} : " + " | ".join(line.strip() for line in info.splitlines()))
        root_fp = subprocess.run(["openssl", "x509", "-in", str(pems[-1]), "-noout", "-fingerprint", "-sha256"],
                                 capture_output=True, text=True, check=True).stdout
        fp = root_fp.split("=", 1)[1].strip().replace(":", "")
        if fp != APPLE_ROOT_G3_SHA256:
            raise InspectError(f"racine inattendue (empreinte {fp})")
        untrusted = Path(tmp) / "untrusted.pem"
        untrusted.write_bytes(b"".join(p.read_bytes() for p in pems[1:-1]))
        verify = subprocess.run(["openssl", "verify", "-CAfile", str(pems[-1]), "-untrusted", str(untrusted),
                                 str(pems[0])], capture_output=True, text=True)
        if verify.returncode != 0:
            raise InspectError(f"chaîne invalide : {verify.stdout.strip()} {verify.stderr.strip()}")
        report.append("chaîne vérifiée par openssl jusqu'à Apple Root CA - G3 (empreinte figée)")
    return report


def find_root_header(data: bytes, start: int) -> int:
    """Offset of the 48-byte root header, located by its invariants (profile 0 is unencrypted)."""
    for offset in range(start, min(start + 512, len(data) - 48)):
        file_size, enc_size, seg_size, per_cluster, comp, chk = struct.unpack("<QQIIBB", data[offset:offset + 26])
        if (enc_size == len(data) and 0 < file_size < 1 << 32 and seg_size and seg_size & (seg_size - 1) == 0
                and 0 < per_cluster <= 4096 and comp in COMPRESSIONS and chk in CHECKSUM_SIZE):
            return offset
    raise InspectError("en-tête racine introuvable")


def extract_payload(data: bytes, root: int) -> bytes:
    file_size, _, _seg_size, per_cluster, comp, chk = struct.unpack("<QQIIBB", data[root:root + 26])
    seg_hdr = 8 + CHECKSUM_SIZE[chk]
    pos = root + 48 + 32  # root header + first cluster header MAC
    out = bytearray()
    while len(out) < file_size:
        headers = [struct.unpack("<II", data[pos + i * seg_hdr: pos + i * seg_hdr + 8])
                   + (data[pos + i * seg_hdr + 8: pos + (i + 1) * seg_hdr],) for i in range(per_cluster)]
        pos += seg_hdr * per_cluster + 32 + 32 * per_cluster  # headers, next cluster MAC, segment MACs
        for raw_size, stored_size, checksum in headers:
            if raw_size == 0:
                continue
            chunk = data[pos:pos + stored_size]
            pos += stored_size
            segment = chunk if raw_size == stored_size or comp == ord("-") else lzfse.decompress(chunk)
            if len(segment) != raw_size:
                raise InspectError("taille de segment incohérente")
            if chk == 2 and hashlib.sha256(segment).digest() != checksum:
                raise InspectError("somme SHA-256 d'un segment invalide")
            out += segment
            if len(out) >= file_size:
                break
    return bytes(out[:file_size])


def parse_aar(payload: bytes) -> tuple[str, bytes]:
    """Return (path, data) of the single file stored in the Apple Archive (AA01)."""
    if payload[:4] not in (b"AA01", b"YAA1"):
        raise InspectError(f"archive inattendue ({payload[:4]!r})")
    pos = 0
    found: tuple[str, bytes] | None = None
    while pos < len(payload):
        hsize = struct.unpack("<H", payload[pos + 4:pos + 6])[0]
        fields, p = payload[pos + 6:pos + hsize], 0
        path, blob = "", 0
        while p < len(fields):
            key, kind = fields[p:p + 3].decode(), chr(fields[p + 3])
            p += 4
            if kind == "*":
                continue
            if kind in "1248":
                value = int.from_bytes(fields[p:p + int(kind)], "little")
                p += int(kind)
            elif kind == "P":
                n = struct.unpack("<H", fields[p:p + 2])[0]
                value = fields[p + 2:p + 2 + n].decode()
                p += 2 + n
            elif kind in "ABC":
                n = {"A": 2, "B": 4, "C": 8}[kind]
                value = int.from_bytes(fields[p:p + n], "little")
                p += n
            elif kind == "T":
                value = None
                p += 12
            elif kind == "S":
                value = None
                p += 8
            elif kind in "FGHI":
                value = None
                p += {"F": 20, "G": 32, "H": 48, "I": 64}[kind]
            else:
                raise InspectError(f"champ AAR inconnu {key}{kind}")
            if key == "PAT":
                path = value
            elif key == "DAT":
                blob = value
        data_start = pos + hsize
        if blob:
            found = (path, payload[data_start:data_start + blob])
        pos = data_start + blob
    if found is None:
        raise InspectError("aucun fichier dans l'archive")
    return found


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("signed", type=Path)
    parser.add_argument("--compare", type=Path)
    parser.add_argument("--extract", type=Path)
    args = parser.parse_args(argv)
    data = args.signed.read_bytes()
    try:
        magic, prof, auth_len = struct.unpack("<4sII", data[:12])
        if magic != b"AEA1":
            raise InspectError(f"pas un fichier AEA1 ({magic!r}) : fichier non signé ?")
        if prof & 0xFFFFFF != 0:
            raise InspectError(f"profil AEA {prof & 0xFFFFFF} (attendu 0 : signé, non chiffré)")
        auth = plistlib.loads(data[12:12 + auth_len])
        print(f"AEA1 profil 0, {len(data)} octets, auth data {auth_len} octets, clés {sorted(auth)}")
        for line in check_chain(auth["SigningCertificateChain"]):
            print("  " + line)
        root = find_root_header(data, 12 + auth_len)
        payload = extract_payload(data, root)
        print(f"  contenu extrait : {len(payload)} octets, sommes SHA-256 des segments correctes")
        name, wflow = parse_aar(payload)
        signed_plist = plistlib.loads(wflow)
        print(f"  archive : {name} ({len(wflow)} octets), {len(signed_plist.get('WFWorkflowActions', []))} actions")
        if args.extract:
            args.extract.write_bytes(plistlib.dumps(signed_plist, fmt=plistlib.FMT_XML))
        if args.compare:
            ours = plistlib.loads(args.compare.read_bytes())
            failures = [k for k in COMPARED_KEYS if ours.get(k) != signed_plist.get(k)]
            others = sorted(k for k in set(ours) | set(signed_plist)
                            if k not in COMPARED_KEYS and ours.get(k) != signed_plist.get(k))
            for key in others:
                print(f"  différence tolérée : {key} : {ours.get(key)!r:.60} -> {signed_plist.get(key)!r:.60}")
            if failures:
                raise InspectError(f"le contenu signé diffère du plist compilé : {failures}")
            print(f"  identique au plist compilé pour : {', '.join(COMPARED_KEYS)}")
        print("RÉSULTAT : signature Apple (chaîne) et contenu vérifiés")
        return 0
    except (InspectError, KeyError, struct.error, plistlib.InvalidFileException) as exc:
        print(f"ÉCHEC : {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

#!/usr/bin/env python3
# Essai de l'exe WINDOWS construit (aethryon-desktop.exe), mode hôte Native Messaging, SOUS WINE (Linux).
# Wine n'est pas Windows : ceci prouve que l'exe démarre, reconnaît le lancement par un navigateur (origine en argument),
# parle le protocole (longueur u32 + JSON) et n'écrit que dans %LOCALAPPDATA%\AETHRYON\transferts. WebView2 n'est pas en jeu.
# 1.0.0-beta.4 : « etat-extension » (dossier géré %LOCALAPPDATA%\AETHRYON\extension) et refus de toute adresse ou de
# tout chemin dans « mettre-a-jour-extension » (aucun téléchargement : la source de production n'est pas appelée ici).
import json, os, struct, subprocess, sys, glob
exe = sys.argv[1]
def trame(o):
    b = json.dumps(o).encode()
    return struct.pack("<I", len(b)) + b
entree = b"".join([
    trame({"type": "ping"}),
    trame({"type": "transfert", "id": "essai-wine", "titre": "Coucher de soleil", "plateforme": "youtube", "format": "mp4", "etat": "telechargement", "progression": 0.5, "fichierAttendu": "Coucher de soleil.mp4"}),
    trame({"type": "transfert", "id": "x", "etat": "attente", "jeton": "SECRET"}),
    trame({"type": "etat-extension"}),
    trame({"type": "mettre-a-jour-extension", "version": "3.6.1", "url": "https://ailleurs.example/SECRET.zip"}),
    trame({"type": "mettre-a-jour-extension", "dossier": "C:\\Windows\\SECRET"}),
])
env = dict(os.environ, WINEDEBUG="-all")
def lancer(args):
    p = subprocess.run(["/usr/lib/wine/wine", exe] + args, input=entree, capture_output=True, env=env, timeout=120)
    out, rep = p.stdout, []
    while len(out) >= 4:
        n = struct.unpack("<I", out[:4])[0]; rep.append(json.loads(out[4:4 + n])); out = out[4 + n:]
    return p.returncode, rep
code, rep = lancer(["chrome-extension://necpohicddjeaeaaomaakehcbccapabg/", "--parent-window=0"])
print("origine autorisée : code", code, "réponses", rep)
assert code == 0 and rep[0]["ok"] and rep[1] == {"ok": True, "id": "essai-wine", "etat": "telechargement"} and not rep[2]["ok"]
assert "mettre-a-jour-extension" in rep[0]["capacites"], rep[0]
e = rep[3]
print("etat-extension :", e)
assert e["ok"] and e["version"] is None and e["precedente"] is None and e["dossier"].replace("/", "\\").lower().endswith("\\appdata\\local\\aethryon\\extension"), e
assert not rep[4]["ok"] and not rep[5]["ok"], rep[4:]
assert "SECRET" not in json.dumps(rep)
code2, rep2 = lancer(["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"])
print("origine refusée : code", code2, "réponses", rep2)
assert code2 == 2 and rep2 == []
code3, rep3 = lancer(["--nm"])
print("--nm explicite : code", code3, "réponses", len(rep3))
assert code3 == 0 and len(rep3) == 6
f = glob.glob(os.path.expanduser("~/.wine/drive_c/users/*/AppData/Local/AETHRYON/transferts/*.json"))
print("fichiers écrits :", [os.path.basename(x) for x in f])
assert [os.path.basename(x) for x in f] == ["essai-wine.json"]
autres = [x for x in glob.glob(os.path.expanduser("~/.wine/drive_c/users/*/AppData/Local/AETHRYON/**"), recursive=True) if os.path.isfile(x)]
assert len(autres) == 1, autres
print("ESSAI NM SOUS WINE : RÉUSSI")

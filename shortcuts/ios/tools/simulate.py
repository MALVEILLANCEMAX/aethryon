#!/usr/bin/env python3
"""Simulateur d'exécution du raccourci compilé (plist), action par action, contre une vraie API.

    simulate.py FICHIER --base http://127.0.0.1:18112 --token-file F --input URL --menu "Vidéo MP4 (Photos)"
                [--texte-vide absent|valeur] [--out DOSSIER] [--json]

FICHIER : plist non signé (sortie de Cherri) ou fichier signé (AEA1, extrait via inspect_signed.py).

Ce que fait le simulateur, sans iPhone :
- il interprète les actions utilisées par ce raccourci (Si / Sinon / Fin, Menu, Répéter, variables,
  sorties d'actions, textes avec variables, dictionnaires, « Obtenir le contenu de l'URL ») ;
- il envoie les VRAIES requêtes HTTP (https://api.malvu.fr/media est réécrit vers --base) ;
- il vérifie le fichier final : type, taille, flux audio/vidéo lisibles (ffprobe) et, pour Photos,
  conteneur MP4/MOV avec H.264/HEVC (sinon Photos refuserait l'enregistrement) ;
- il échoue sur toute action ou condition inconnue (rien n'est deviné en silence).

Point iOS non documenté, rendu explicite : « Si <texte vide> a une valeur ». --texte-vide=valeur
simule un iPhone où une action Texte vide compte comme une valeur ; --texte-vide=absent l'inverse.
Un raccourci robuste doit réussir dans les DEUX cas.

Limite : ce n'est pas iOS. Le simulateur prouve la logique et le câblage du fichier (variables,
blocs, requêtes, décisions) face aux vraies réponses du serveur ; il ne prouve ni l'import, ni les
autorisations (Photos), ni le comportement exact de Raccourcis sur l'appareil.
Le jeton est lu dans --token-file et n'est jamais affiché (retiré de toute sortie par précaution).
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import plistlib
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

PUBLIC_BASE = "https://api.malvu.fr/media"
OBJ = "￼"
PHOTOS_CONTAINERS = {"mov,mp4,m4a,3gp,3g2,mj2"}
PHOTOS_VIDEO = {"h264", "hevc"}
PHOTOS_AUDIO = {"aac", "mp3", "alac", None}


class Stop(Exception):
    pass


class SimError(Exception):
    """Action ou situation que le simulateur ne sait pas reproduire fidèlement : échec franc."""


@dataclass
class File:
    name: str
    mime: str
    data: bytes

    @property
    def extension(self) -> str:
        ext = Path(self.name).suffix.lstrip(".").lower()
        if not ext:
            guess = mimetypes.guess_extension(self.mime.split(";")[0].strip()) or ""
            ext = guess.lstrip(".")
        return ext


@dataclass
class Run:
    base: str
    token: str
    share_input: list[str]
    menu_choice: str
    empty_text_has_value: bool
    out: Path
    clipboard: str = ""
    ask_answer: str = ""
    trace: list[str] = field(default_factory=list)
    requests: list[dict[str, Any]] = field(default_factory=list)
    alerts: list[str] = field(default_factory=list)
    saves: list[dict[str, Any]] = field(default_factory=list)
    stopped_at: int | None = None
    outcome: str = ""

    def log(self, line: str) -> None:
        self.trace.append(line.replace(self.token, "[jeton]") if self.token else line)


def load_plist(path: Path) -> dict:
    raw = path.read_bytes()
    if raw.startswith(b"AEA1"):
        here = Path(__file__).resolve().parent
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "extrait.plist"
            subprocess.run([sys.executable, str(here / "inspect_signed.py"), str(path), "--extract", str(out)],
                           check=True, stdout=subprocess.DEVNULL)
            return plistlib.loads(out.read_bytes())
    return plistlib.loads(raw)


# --- valeurs --------------------------------------------------------------------------------------

def as_text(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, bool):
        return "Oui" if v else "Non"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, (dict, list)) and not (isinstance(v, list) and all(isinstance(x, str) for x in v)):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list):
        return "\n".join(v)
    if isinstance(v, File):
        return v.name
    raise SimError(f"conversion en texte non gérée : {type(v).__name__}")


def has_value(v: Any, empty_text_has_value: bool) -> bool:
    if v is None:
        return False
    if isinstance(v, str):
        return True if empty_text_has_value else v != ""
    if isinstance(v, (list, dict)):
        return len(v) > 0
    return True


# --- interpréteur ------------------------------------------------------------------------------

class Machine:
    def __init__(self, plist: dict, run: Run) -> None:
        self.run = run
        self.actions = plist["WFWorkflowActions"]
        self.ids = [a["WFWorkflowActionIdentifier"].replace("is.workflow.actions.", "") for a in self.actions]
        self.params = [a.get("WFWorkflowActionParameters", {}) for a in self.actions]
        self.vars: dict[str, Any] = {}
        self.outputs: dict[str, Any] = {}
        self.previous: Any = None
        self.repeat_stack: list[dict[str, Any]] = []
        self.groups: dict[str, list[tuple[int, int]]] = {}
        for i, p in enumerate(self.params):
            gid = p.get("GroupingIdentifier")
            if gid is not None and "WFControlFlowMode" in p:
                self.groups.setdefault(gid, []).append((i, p["WFControlFlowMode"]))
        self.question_index = None
        for q in plist.get("WFWorkflowImportQuestions", []):
            self.question_index = q.get("ActionIndex")

    # résolution des paramètres
    def attachment(self, att: dict) -> Any:
        kind = att.get("Type")
        if kind == "Variable":
            name = att.get("VariableName")
            if name == "Repeat Index":
                value: Any = self.repeat_stack[-1]["index"] if self.repeat_stack else None
            elif name not in self.vars:
                raise SimError(f"variable « {name} » lue avant d'être définie")
            else:
                value = self.vars[name]
        elif kind == "ActionOutput":
            uuid = att.get("OutputUUID")
            if uuid not in self.outputs:
                raise SimError(f"sortie « {att.get('OutputName')} » lue avant que son action ne s'exécute")
            value = self.outputs[uuid]
        elif kind == "ExtensionInput":
            value = list(self.run.share_input)
        elif kind == "Clipboard":
            value = self.run.clipboard
        else:
            raise SimError(f"type de variable non géré : {kind}")
        for agg in att.get("Aggrandizements", []) or []:
            t = agg.get("Type")
            if t == "WFDictionaryValueVariableAggrandizement":
                value = value.get(agg.get("DictionaryKey")) if isinstance(value, dict) else None
            elif t == "WFCoercionVariableAggrandizement":
                cls = agg.get("CoercionItemClass")
                value = as_text(value) if cls == "WFStringContentItem" else value
            else:
                raise SimError(f"agrandissement non géré : {t}")
        return value

    def render(self, param: Any) -> str:
        """Texte avec variables (WFTextTokenString), en tenant compte des positions UTF-16."""
        if param is None:
            return ""
        if isinstance(param, str):
            return param
        ser = param.get("WFSerializationType")
        if ser == "WFTextTokenAttachment":
            return as_text(self.attachment(param["Value"]))
        if ser != "WFTextTokenString":
            raise SimError(f"texte attendu, reçu {ser}")
        value = param["Value"]
        units = value.get("string", "").encode("utf-16-le")
        ranges = []
        for rng, att in value.get("attachmentsByRange", {}).items():
            start, length = (int(x) for x in rng.strip("{}").split(","))
            ranges.append((start, length, att))
        for start, length, att in sorted(ranges, key=lambda r: -r[0]):
            piece = as_text(self.attachment(att)).encode("utf-16-le")
            units = units[: 2 * start] + piece + units[2 * (start + length):]
        return units.decode("utf-16-le")

    def value(self, param: Any) -> Any:
        if param is None:
            return None
        if isinstance(param, (str, int, float, bool)):
            return param
        if isinstance(param, dict) and param.get("Type") == "Variable" and "Variable" in param:
            return self.value(param["Variable"])
        ser = param.get("WFSerializationType")
        if ser == "WFTextTokenAttachment":
            return self.attachment(param["Value"])
        if ser == "WFTextTokenString":
            return self.render(param)
        if ser == "WFDictionaryFieldValue":
            out: dict[str, Any] = {}
            for item in param["Value"].get("WFDictionaryFieldValueItems", []):
                if item.get("WFItemType", 0) != 0:
                    raise SimError(f"type d'élément de dictionnaire non géré : {item.get('WFItemType')}")
                out[self.render(item.get("WFKey"))] = self.render(item.get("WFValue"))
            return out
        raise SimError(f"paramètre non géré : {ser}")

    # contrôle de flux
    def block(self, i: int) -> list[tuple[int, int]]:
        return self.groups[self.params[i]["GroupingIdentifier"]]

    def condition(self, p: dict) -> bool:
        if "WFConditions" in p:
            raise SimError("conditions multiples (WFConditions) non gérées")
        cond = int(p.get("WFCondition"))
        v = self.value(p.get("WFInput"))
        target = p.get("WFConditionalActionString", "")
        if cond == 100:
            return has_value(v, self.run.empty_text_has_value)
        if cond == 101:
            return not has_value(v, self.run.empty_text_has_value)
        text = as_text(v)
        if cond == 4:
            return text == target
        if cond == 5:
            return text != target
        if cond == 99:
            return target in text
        if cond == 999:
            return target not in text
        if cond == 8:
            return text.startswith(target)
        if cond == 9:
            return text.endswith(target)
        raise SimError(f"condition {cond} non gérée")

    def execute(self) -> None:
        pc = 0
        steps = 0
        while pc < len(self.actions):
            steps += 1
            if steps > 20000:
                raise SimError("plus de 20 000 actions exécutées : boucle infinie ?")
            ident, p = self.ids[pc], self.params[pc]
            mode = p.get("WFControlFlowMode")
            if ident == "conditional":
                if mode == 0:
                    ok = self.condition(p)
                    self.run.log(f"{pc:3d} Si (condition {p.get('WFCondition')} « {p.get('WFConditionalActionString', '')} ») → {'vrai' if ok else 'faux'}")
                    if ok:
                        pc += 1
                    else:
                        rest = [(j, m) for j, m in self.block(pc) if j > pc]
                        pc = next(j for j, m in rest if m in (1, 2)) + 1
                    continue
                if mode == 1:  # fin de la branche « vrai » : aller après « Fin du Si »
                    pc = next(j for j, m in self.block(pc) if m == 2) + 1
                    continue
                pc += 1
                continue
            if ident == "choosefrommenu":
                if mode == 0:
                    items = [x if isinstance(x, str) else x.get("WFValue") for x in p.get("WFMenuItems", [])]
                    if self.run.menu_choice not in items:
                        raise SimError(f"choix de menu « {self.run.menu_choice} » absent : {items}")
                    self.run.log(f"{pc:3d} Menu « {p.get('WFMenuPrompt')} » → {self.run.menu_choice}")
                    pc = next(j for j, m in self.block(pc)
                              if m == 1 and self.params[j].get("WFMenuItemTitle") == self.run.menu_choice) + 1
                    continue
                if mode == 1:  # fin de l'option choisie
                    pc = next(j for j, m in self.block(pc) if m == 2) + 1
                    continue
                pc += 1
                continue
            if ident == "repeat.count":
                if mode == 0:
                    count = int(self.value(p.get("WFRepeatCount")) or 0)
                    if count <= 0:
                        pc = next(j for j, m in self.block(pc) if m == 2) + 1
                        continue
                    self.repeat_stack.append({"start": pc, "count": count, "index": 1})
                    pc += 1
                    continue
                frame = self.repeat_stack[-1]
                if frame["index"] < frame["count"]:
                    frame["index"] += 1
                    pc = frame["start"] + 1
                else:
                    self.run.log(f"{pc:3d} Fin de la boucle ({frame['count']} tours)")
                    self.repeat_stack.pop()
                    pc += 1
                continue
            try:
                out = self.action(pc, ident, p)
            except Stop:
                self.run.stopped_at = pc
                return
            if "UUID" in p:
                self.outputs[p["UUID"]] = out
            self.previous = out
            pc += 1

    # actions
    def action(self, i: int, ident: str, p: dict) -> Any:
        log = self.run.log
        if ident == "nothing":
            return None
        if ident == "setvariable":
            self.vars[p["WFVariableName"]] = self.value(p.get("WFInput"))
            return self.vars[p["WFVariableName"]]
        if ident == "gettext":
            if i == self.question_index:
                return self.run.token  # réponse à la question d'importation
            return self.render(p.get("WFTextActionText"))
        if ident == "text.trimwhitespace":
            return as_text(self.value(p.get("WFInput"))).strip()
        if ident == "detect.link":
            v = self.value(p.get("WFInput"))
            items = v if isinstance(v, list) else [as_text(v)]
            return [u for item in items for u in re.findall(r"https?://[^\s<>\"']+", as_text(item))]
        if ident == "getclipboard":
            return self.run.clipboard
        if ident == "ask":
            return self.run.ask_answer
        if ident == "getitemfromlist":
            v = self.value(p.get("WFInput"))
            if p.get("WFItemSpecifier", "First Item") != "First Item":
                raise SimError("seul « Premier élément » est géré")
            return (v[0] if v else None) if isinstance(v, list) else v
        if ident == "alert":
            msg = self.render(p.get("WFAlertActionMessage"))
            self.run.alerts.append(msg)
            log(f"{i:3d} ALERTE « {msg} »")
            return None
        if ident == "exit":
            log(f"{i:3d} ARRÊT du raccourci")
            raise Stop()
        if ident == "notification":
            msg = self.render(p.get("WFNotificationActionBody"))
            log(f"{i:3d} notification « {self.render(p.get('WFNotificationActionTitle'))} : {msg} »")
            return None
        if ident == "downloadurl":
            return self.http(i, p)
        if ident == "detect.dictionary":
            v = self.value(p.get("WFInput"))
            if isinstance(v, dict):
                return v
            if isinstance(v, File) and "json" in v.mime:
                return json.loads(v.data)
            try:
                parsed = json.loads(as_text(v))
                return parsed if isinstance(parsed, dict) else {}
            except (ValueError, SimError):
                log(f"{i:3d} (Obtenir le dictionnaire : entrée non JSON → dictionnaire vide)")
                return {}
        if ident == "getvalueforkey":
            if p.get("WFGetDictionaryValueType", "Value") != "Value":
                raise SimError("seul « Valeur » est géré")
            v = self.value(p.get("WFInput"))
            return v.get(p.get("WFDictionaryKey")) if isinstance(v, dict) else None
        if ident == "properties.files":
            if "WFInput" in p:
                v = self.value(p["WFInput"])
            else:
                v = self.previous
                log(f"{i:3d} (Détails du fichier : entrée implicite = sortie de l'action précédente)")
            prop = p.get("WFContentItemPropertyName")
            if prop != "File Extension":
                raise SimError(f"propriété {prop} non gérée")
            return "json" if isinstance(v, dict) else (v.extension if isinstance(v, File) else "")
        if ident == "count":
            if p.get("WFCountType", "Items") != "Items":
                raise SimError("seul « Compter les éléments » est géré")
            v = self.value(p.get("Input"))
            n = len(v) if isinstance(v, (list, dict)) else (0 if v is None or v == "" else 1)
            log(f"{i:3d} Compter → {n}")
            return n
        if ident == "text.match":
            text = as_text(self.value(p.get("text")))
            flags = 0 if p.get("WFMatchTextCaseSensitive", True) else re.I
            found = [m.group(0) for m in re.finditer(p.get("WFMatchTextPattern", ""), text, flags)]
            log(f"{i:3d} Rechercher « {p.get('WFMatchTextPattern')} » → {len(found)} correspondance(s)")
            return found
        if ident == "url.expand":
            return self.expand(i, as_text(self.value(p.get("URL"))))
        if ident == "savetocameraroll":
            return self.save(i, self.value(p.get("WFInput")), "Photos")
        if ident == "documentpicker.save":
            return self.save(i, self.value(p.get("WFInput")), "Fichiers")
        raise SimError(f"action non gérée : {ident}")

    def http(self, i: int, p: dict) -> Any:
        method = p.get("WFHTTPMethod", "GET")
        url = self.render(p.get("WFURL"))
        if url.startswith(PUBLIC_BASE):
            url = self.run.base + url[len(PUBLIC_BASE):]
        headers = self.value(p.get("WFHTTPHeaders")) or {}
        data = None
        if method == "POST" and p.get("WFHTTPBodyType") == "JSON":
            data = json.dumps(self.value(p.get("WFJSONValues")) or {}).encode()
            headers = {**headers, "Content-Type": "application/json"}
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                status, body, ctype, disp = resp.status, resp.read(), resp.headers.get("Content-Type", ""), resp.headers.get("Content-Disposition", "")
        except urllib.error.HTTPError as exc:  # Raccourcis renvoie le corps des 4xx/5xx sans erreur
            status, body, ctype, disp = exc.code, exc.read(), exc.headers.get("Content-Type", ""), exc.headers.get("Content-Disposition", "")
        path = urllib.parse.urlsplit(url)
        shown = path.path + (f"?{path.query}" if path.query else "")
        self.run.requests.append({"method": method, "path": shown, "status": status, "type": ctype.split(";")[0], "bytes": len(body)})
        self.run.log(f"{i:3d} HTTP {method} {shown} → {status} ({ctype.split(';')[0]}, {len(body)} octets)")
        if "json" in ctype:
            try:
                parsed = json.loads(body)
                if isinstance(parsed, dict):
                    return parsed
            except ValueError:
                pass
        name = ""
        m = re.search(r"filename\*=UTF-8''([^;]+)", disp)
        if m:
            name = urllib.parse.unquote(m.group(1))
        else:
            m = re.search(r'filename="([^"]+)"', disp)
            name = m.group(1) if m else urllib.parse.unquote(path.path.rsplit("/", 1)[-1])
        return File(name=name or "Contenu de l'URL", mime=ctype.split(";")[0].strip(), data=body)

    def expand(self, i: int, url: str) -> str:
        """« Développer l'URL » : suit les redirections HTTP (HEAD, puis GET si HEAD est refusé), comme
        l'iPhone, mais depuis le serveur : TikTok peut répondre autrement à une IP de centre de données."""
        final = url
        for method in ("HEAD", "GET"):
            req = urllib.request.Request(url, method=method, headers={"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)"})
            try:
                with urllib.request.urlopen(req, timeout=20) as resp:
                    final = resp.geturl()
                break
            except urllib.error.HTTPError as exc:
                final = exc.geturl() or url
                if method == "GET" or exc.code not in (403, 405):
                    break
            except (urllib.error.URLError, TimeoutError) as exc:
                raise SimError(f"Développer l'URL : réseau en échec ({exc})") from None
        parts = urllib.parse.urlsplit(final)
        self.run.requests.append({"method": "EXPAND", "path": f"{parts.hostname}{parts.path}", "status": 0, "type": "", "bytes": 0})
        self.run.log(f"{i:3d} Développer l'URL → {parts.hostname}{parts.path}")
        return final

    def save(self, i: int, v: Any, where: str) -> Any:
        if not isinstance(v, File):
            raise SimError(f"enregistrement dans {where} d'une valeur qui n'est pas un fichier : {type(v).__name__}")
        probe = ffprobe(v, self.run.out)
        info = {"destination": where, "nom": v.name, "type": v.mime, "octets": len(v.data), **probe}
        if where == "Photos":
            ok = (probe.get("conteneur") in PHOTOS_CONTAINERS and probe.get("video") in PHOTOS_VIDEO
                  and probe.get("audio") in PHOTOS_AUDIO)
            if not ok:
                self.run.log(f"{i:3d} PHOTOS REFUSERAIT ce fichier : {probe}")
                raise SimError(f"Photos refuserait ce fichier : {probe}")
        self.run.saves.append(info)
        self.run.log(f"{i:3d} ENREGISTRÉ dans {where} : {v.mime}, {len(v.data)} octets, {probe}")
        return v


def ffprobe(f: File, out: Path) -> dict[str, Any]:
    out.mkdir(parents=True, exist_ok=True)
    target = out / ("fichier." + (f.extension or "bin"))
    target.write_bytes(f.data)
    res = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                          "format=format_name,duration:stream=codec_type,codec_name,width,height",
                          "-of", "json", str(target)], capture_output=True, text=True, timeout=60)
    if res.returncode != 0:
        return {"lisible": False}
    data = json.loads(res.stdout)
    streams = data.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    return {
        "lisible": True,
        "conteneur": data.get("format", {}).get("format_name"),
        "durée_s": round(float(data.get("format", {}).get("duration") or 0), 1),
        "video": video.get("codec_name") if video else None,
        "taille_image": f"{video.get('width')}x{video.get('height')}" if video else None,
        "audio": audio.get("codec_name") if audio else None,
    }


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("shortcut", type=Path)
    ap.add_argument("--base", required=True, help="URL de l'API qui remplace https://api.malvu.fr/media")
    ap.add_argument("--token-file", type=Path, required=True)
    ap.add_argument("--input", action="append", default=[], help="élément partagé (répétable)")
    ap.add_argument("--menu", required=True, help="titre de l'option de menu choisie")
    ap.add_argument("--texte-vide", choices=("absent", "valeur"), default="absent")
    ap.add_argument("--clipboard", default="")
    ap.add_argument("--out", type=Path, default=Path(tempfile.mkdtemp(prefix="simulation-")))
    ap.add_argument("--json", action="store_true", help="résumé JSON en dernière ligne")
    a = ap.parse_args(argv)
    token = a.token_file.read_text(encoding="utf-8").strip()
    run = Run(base=a.base.rstrip("/"), token=token, share_input=a.input, menu_choice=a.menu,
              empty_text_has_value=a.texte_vide == "valeur", out=a.out, clipboard=a.clipboard)
    machine = Machine(load_plist(a.shortcut), run)
    try:
        machine.execute()
        if run.saves:
            run.outcome = f"enregistré dans {run.saves[-1]['destination']}"
        elif run.stopped_at is not None:
            run.outcome = "arrêt après alerte" if run.alerts else "arrêt sans message"
        else:
            run.outcome = "fin sans enregistrement"
    except SimError as exc:
        run.outcome = f"ÉCHEC DE SIMULATION : {exc}"
    for line in run.trace:
        if any(k in line for k in ("HTTP", "ALERTE", "ARRÊT", "ENREGISTRÉ", "REFUSERAIT", "Menu", "notification", "Détails", "Obtenir")):
            print(line)
    print(f"RÉSULTAT : {run.outcome}")
    if a.json:
        summary = {"outcome": run.outcome, "requests": run.requests, "alerts": run.alerts, "saves": run.saves}
        print(json.dumps(summary, ensure_ascii=False).replace(token, "[jeton]"))
    return 0 if run.saves else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

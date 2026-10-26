#!/usr/bin/env python3
"""Validateur statique du raccourci « YouTube Converter » (plist compilé ou fichier signé).

    validate.py FICHIER.shortcut [--ytapi DIR]  (DIR: optional media-api deployment folder; default $AETHRYON_MEDIA_API_DIR)

FICHIER peut être le plist non signé produit par Cherri ou le fichier signé (AEA1) : dans ce
cas le contenu est extrait et vérifié (tools/inspect_signed.py). Ce qui est contrôlé :

  structure     types (feuille de partage), entrées acceptées, actions autorisées uniquement
  blocs         Si / Menu / Répéter : identifiants uniques, imbrication, branche non vide
  variables     chaque référence vise une action ou une variable définie AVANT son usage
  question      une question d'importation, ActionIndex présent, sur l'action Texte du jeton,
                champ vide, sans valeur par défaut
  API           les 3 requêtes (POST création, GET suivi, GET fichier) : URL, méthode, corps
                JSON exact {url, fmt}, en-tête Authorization = « Bearer » + sortie du jeton,
                clés Advanced/ShowHeaders ; aucune autre URL que api.malvu.fr
  erreurs       contrôle error/message/status après chaque requête JSON ; boucle bornée
  conditions    après la création du job : uniquement « est » / « n'est pas » comparé à une valeur
                fixe (la v1 testait « le texte de error a une valeur » : sur iOS un texte vide compte
                comme une valeur, d'où l'arrêt juste après le POST)
  secrets       aucun jeton réel de ytapi (comparé en mémoire, jamais affiché), aucune chaîne
                ressemblant à un jeton, aucun « Bearer » suivi d'une valeur en clair
  confirmation  une alerte juste après chaque enregistrement, jamais avant ; aucune requête après

Limite : un contrôle statique ne simule pas iOS. Il prouve que le fichier contient les bonnes
actions, reliées aux bonnes variables ; pas que Raccourcis les exécute comme prévu.
"""

from __future__ import annotations

import os
import argparse
import plistlib
import re
import sys
from pathlib import Path

API_JOBS = "https://api.malvu.fr/media/jobs?wait=20"
OBJ = "￼"
ALLOWED_ACTIONS = {
    "detect.link", "setvariable", "conditional", "getclipboard", "ask", "alert", "exit", "nothing",
    "getitemfromlist", "gettext", "text.trimwhitespace", "choosefrommenu", "downloadurl",
    "detect.dictionary", "getvalueforkey", "repeat.count", "properties.files", "savetocameraroll",
    "documentpicker.save", "notification",
    "count", "text.match", "url.expand",  # AETHRYON : présence par comptage, lien court TikTok développé
}
BLOCK_ACTIONS = {"conditional", "choosefrommenu", "repeat.count", "repeat.each"}
MAGIC_VARIABLES = {"Repeat Index", "Repeat Item"}
TOKEN_LIKE = re.compile(r"(?<![0-9A-Za-z_-])[0-9A-Za-z_-]{32,}(?![0-9A-Za-z_-])")
UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


class Report:
    def __init__(self) -> None:
        self.failures = 0

    def check(self, ok: bool, label: str, detail: str = "") -> bool:
        print(f"  {'PASS' if ok else 'FAIL'}  {label}{(' : ' + detail) if detail and not ok else ''}")
        if not ok:
            self.failures += 1
        return ok


def short(identifier: str) -> str:
    return identifier.removeprefix("is.workflow.actions.")


def attachments(value, found=None):
    """Every variable reference (attachment) inside a parameter value."""
    found = [] if found is None else found
    if isinstance(value, dict):
        kind = value.get("Type")
        # {"Type": "Variable", "Variable": {...}} is only the wrapper of a condition input.
        if (kind == "ActionOutput" and "OutputUUID" in value) or (kind == "Variable" and "VariableName" in value) \
                or kind in ("ExtensionInput", "Clipboard", "Ask", "CurrentDate", "DeviceDetails"):
            found.append(value)
        for item in value.values():
            attachments(item, found)
    elif isinstance(value, list):
        for item in value:
            attachments(item, found)
    return found


def all_strings(value, out=None):
    """Every string VALUE (dictionary keys are Shortcuts' own parameter names, not data)."""
    out = [] if out is None else out
    if isinstance(value, str):
        out.append(value)
    elif isinstance(value, dict):
        for v in value.values():
            all_strings(v, out)
    elif isinstance(value, list):
        for v in value:
            all_strings(v, out)
    return out


def token_string(value) -> tuple[str, list[dict]]:
    """(text, attachments in order) of a WFTextTokenString, or (literal, []) for a plain string."""
    if isinstance(value, str):
        return value, []
    if isinstance(value, dict) and value.get("WFSerializationType") == "WFTextTokenString":
        inner = value.get("Value", {})
        ranges = sorted(inner.get("attachmentsByRange", {}).items(),
                        key=lambda kv: int(kv[0].strip("{}").split(",")[0]))
        return inner.get("string", ""), [att for _, att in ranges]
    return "", []


def dict_items(value) -> dict[str, tuple[str, list[dict], int | None]]:
    items = {}
    if isinstance(value, dict) and value.get("WFSerializationType") == "WFDictionaryFieldValue":
        for item in value.get("Value", {}).get("WFDictionaryFieldValueItems", []):
            key, _ = token_string(item.get("WFKey"))
            text, atts = token_string(item.get("WFValue"))
            items[key] = (text, atts, item.get("WFItemType"))
    return items


def next_executed(ids: list[str], params: list[dict], i: int) -> int:
    """Index of the action that runs right after action i (other branches of a block skipped)."""
    j = i + 1
    while j < len(ids):
        p = params[j]
        mode = p.get("WFControlFlowMode") if ids[j] in BLOCK_ACTIONS else None
        if ids[j] == "nothing" or mode == 2:
            j += 1
        elif mode == 1:  # end of our branch: jump past the end of this block
            gid = p.get("GroupingIdentifier")
            j = next(k for k in range(j + 1, len(ids))
                     if params[k].get("GroupingIdentifier") == gid and params[k].get("WFControlFlowMode") == 2) + 1
        else:
            return j
    return len(ids) - 1


def load(path: Path) -> dict:
    data = path.read_bytes()
    if data[:4] == b"AEA1":
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import inspect_signed  # noqa: PLC0415 (needs lzfse: run with shortcut/.venv)
        _, prof, auth_len = __import__("struct").unpack("<4sII", data[:12])
        root = inspect_signed.find_root_header(data, 12 + auth_len)
        _, wflow = inspect_signed.parse_aar(inspect_signed.extract_payload(data, root))
        print(f"(fichier signé : contenu extrait, {len(wflow)} octets)")
        return plistlib.loads(wflow)
    return plistlib.loads(data)


def real_tokens(ytapi: Path) -> list[str]:
    """Tokens configured in ytapi (.env API_TOKEN + secrets/tokens). Never printed."""
    values = []
    env = ytapi / ".env"
    if env.is_file():
        for line in env.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith("API_TOKEN=") and line.split("=", 1)[1].strip():
                values.append(line.split("=", 1)[1].strip().strip('"').strip("'"))
    tokens = ytapi / "secrets" / "tokens"
    if tokens.is_file():
        for line in tokens.read_text(encoding="utf-8", errors="replace").splitlines():
            parts = line.split()
            if len(parts) == 2 and not line.lstrip().startswith("#"):
                values.append(parts[1])
    return [v for v in values if len(v) >= 16]


def validate(plist: dict, ytapi: Path, stage: str = "final") -> int:
    """stage : « native » (test B, sans réseau), « http » (test C, sans enregistrement) ou « final »."""
    rep = Report()
    actions = plist.get("WFWorkflowActions", [])
    ids = [short(a.get("WFWorkflowActionIdentifier", "")) for a in actions]
    params = [a.get("WFWorkflowActionParameters", {}) for a in actions]
    by_uuid = {p["UUID"]: i for i, p in enumerate(params) if "UUID" in p}
    print(f"{len(actions)} actions compilées")

    print("-- structure")
    rep.check(len(actions) > 0, "le raccourci contient des actions")
    rep.check("ActionExtension" in plist.get("WFWorkflowTypes", []), "visible dans la feuille de partage (ActionExtension)")
    rep.check({"WFURLContentItem", "WFStringContentItem"} <= set(plist.get("WFWorkflowInputContentItemClasses", [])),
              "accepte les URL et le texte")
    allowed = ALLOWED_ACTIONS | ({"showresult"} if stage not in ("final", "debug") else set())  # tests B/C
    if stage == "debug":
        allowed |= {"getitemtype"}  # « Obtenir le type » : affiché dans les alertes de diagnostic
    unexpected = sorted(set(ids) - allowed)
    rep.check(not unexpected, "aucune action hors liste (pas de « Exécuter un raccourci », d'URL externe…)", str(unexpected))

    print("-- blocs (Si, Menu, Répéter)")
    stack, closed, ok_blocks, empty_branches = [], set(), True, []
    for i, (ident, p) in enumerate(zip(ids, params)):
        if ident not in BLOCK_ACTIONS:
            continue
        gid, mode = p.get("GroupingIdentifier"), p.get("WFControlFlowMode")
        if mode == 0:
            if gid in closed or any(g == gid for g, _, _ in stack):
                ok_blocks = False
            stack.append((gid, ident, i))
            if ident == "conditional" and not (("WFInput" in p and "WFCondition" in p) or "WFConditions" in p):
                ok_blocks = False
        elif mode in (1, 2):
            if not stack or stack[-1][0] != gid or stack[-1][1] != ident:
                ok_blocks = False
                break
            if ident == "conditional" and mode in (1, 2):
                start = stack[-1][2] if mode == 1 or not any(
                    params[j].get("GroupingIdentifier") == gid and params[j].get("WFControlFlowMode") == 1
                    for j in range(stack[-1][2], i)) else None
                if start is not None:
                    body = [ids[j] for j in range(start + 1, i) if ids[j] != "nothing"]
                    if not body:
                        empty_branches.append(start)
            if mode == 2:
                closed.add(gid)
                stack.pop()
    rep.check(ok_blocks and not stack, "chaque bloc a un identifiant unique et est correctement imbriqué")
    rep.check(not empty_branches, "chaque « Si » a une branche principale non vide", str(empty_branches))

    print("-- variables")
    defined_vars: dict[str, int] = {}
    bad_refs = []
    for i, p in enumerate(params):
        for att in attachments({k: v for k, v in p.items() if k != "WFVariableName"}):
            kind = att.get("Type")
            if kind == "ActionOutput":
                src = by_uuid.get(att.get("OutputUUID"))
                if src is None or src >= i:
                    bad_refs.append(f"action {i} -> sortie inconnue/ultérieure {att.get('OutputName')}")
                elif params[src].get("CustomOutputName") not in (None, att.get("OutputName")):
                    bad_refs.append(f"action {i} -> nom de sortie incohérent {att.get('OutputName')}")
            elif kind == "Variable":
                name = att.get("VariableName")
                if name not in defined_vars and name not in MAGIC_VARIABLES:
                    bad_refs.append(f"action {i} -> variable non définie avant usage « {name} »")
        if ids[i] == "setvariable":
            defined_vars.setdefault(p.get("WFVariableName"), i)
    rep.check(not bad_refs, "chaque référence vise une action ou une variable définie avant", "; ".join(bad_refs[:5]))

    print("-- question d'importation (jeton)")
    questions = plist.get("WFWorkflowImportQuestions", [])
    token_action = None
    if rep.check(len(questions) == 1, "une seule question d'importation", str(len(questions))):
        q = questions[0]
        idx = q.get("ActionIndex")
        rep.check(isinstance(idx, int), "ActionIndex présent (sinon iOS ignore la question en silence)")
        if isinstance(idx, int) and 0 <= idx < len(actions):
            token_action = idx
            rep.check(ids[idx] == "gettext" and q.get("ParameterKey") == "WFTextActionText",
                      "la question vise le champ d'une action Texte", f"{ids[idx]} / {q.get('ParameterKey')}")
            rep.check(params[idx].get("WFTextActionText", "") == "", "le champ du jeton est vide dans le fichier")
        rep.check(not q.get("DefaultValue"), "aucune valeur par défaut pour le jeton")
        rep.check(bool(q.get("Text")), "la question a un texte")

    # Outputs that carry the token: the question's Text action, possibly through trimwhitespace.
    token_outputs = set()
    if token_action is not None:
        token_outputs.add(params[token_action].get("UUID"))
        for i, (ident, p) in enumerate(zip(ids, params)):
            if ident == "text.trimwhitespace" and any(a.get("OutputUUID") in token_outputs for a in attachments(p.get("WFInput"))):
                token_outputs.add(p.get("UUID"))

    requests = [i for i, ident in enumerate(ids) if ident == "downloadurl"]
    if stage == "native":
        rep.check(not requests, "étape native : aucune requête réseau")
    else:
        check_api(rep, ids, params, by_uuid, requests, token_outputs, actions, stage)
    if stage in ("http", "final") and requests:
        condition_checks(rep, ids, params, requests)
    secrets_checks(rep, plist, ytapi)
    if stage in ("final", "debug"):
        save_checks(rep, ids, params, stage)
    print(f"== {'VALIDE' if rep.failures == 0 else 'INVALIDE'} ({rep.failures} échec(s))")
    return rep.failures


def check_api(rep, ids, params, by_uuid, requests, token_outputs, actions, stage="final") -> None:
    print("-- requêtes vers l'API")
    value_keys = {params[i].get("WFDictionaryKey"): i for i, ident in enumerate(ids) if ident == "getvalueforkey"}

    def output_of_key(att: dict, key: str) -> bool:
        src = by_uuid.get(att.get("OutputUUID"))
        return src is not None and ids[src] == "getvalueforkey" and params[src].get("WFDictionaryKey") == key

    # Rôle de chaque requête : création (POST), suivi (status_url), fichier (file_url) et, en
    # version DEBUG seulement, l'expérience « lecture d'une erreur » (GET /media/status sans jeton).
    roles: dict[str, list[int]] = {"création": [], "suivi": [], "fichier": [], "sonde 401": [], "autre": []}
    for i in requests:
        p = params[i]
        text, atts = token_string(p.get("WFURL"))
        if p.get("WFHTTPMethod") == "POST":
            roles["création"].append(i)
        elif p.get("WFURL") == "https://api.malvu.fr/media/status" and not p.get("WFHTTPHeaders"):
            roles["sonde 401"].append(i)
        elif atts and output_of_key(atts[0], "status_url"):
            roles["suivi"].append(i)
        elif atts and output_of_key(atts[0], "file_url"):
            roles["fichier"].append(i)
        else:
            roles["autre"].append(i)
    rep.check(all(len(roles[r]) == 1 for r in ("création", "suivi", "fichier")) and not roles["autre"],
              "exactement une requête de création, une de suivi, une de fichier", str({k: len(v) for k, v in roles.items()}))
    rep.check(len(roles["sonde 401"]) == (1 if stage == "debug" else 0),
              "sonde 401 sans jeton : présente uniquement en version DEBUG")
    if any(len(roles[r]) != 1 for r in ("création", "suivi", "fichier")):
        return
    requests = [roles["création"][0], roles["suivi"][0], roles["fichier"][0]]

    def check_auth(i: int, label: str) -> None:
        p = params[i]
        headers = dict_items(p.get("WFHTTPHeaders"))
        auth = headers.get("Authorization")
        ok = (set(headers) == {"Authorization"} and auth is not None and auth[0] == "Bearer " + OBJ
              and len(auth[1]) == 1 and auth[1][0].get("OutputUUID") in token_outputs and auth[2] == 0)
        rep.check(ok, f"{label} : en-tête Authorization = « Bearer » + sortie du jeton (texte)", str(headers)[:200])
        rep.check(p.get("Advanced") is True and p.get("ShowHeaders") is True,
                  f"{label} : Advanced et ShowHeaders activés (méthode, corps, en-têtes pris en compte)")

    if True:
        post, status_get, file_get = requests
        p = params[post]
        rep.check(p.get("WFURL") == API_JOBS and p.get("WFHTTPMethod") == "POST" and p.get("WFHTTPBodyType") == "JSON",
                  f"création : POST JSON sur {API_JOBS}", f"{p.get('WFURL')} {p.get('WFHTTPMethod')}")
        body = dict_items(p.get("WFJSONValues"))
        def link_source(att: dict) -> bool:
            """Le lien extrait (Obtenir l'élément de la liste) ou, pour AETHRYON, la variable « lien » dont
            CHAQUE affectation est un texte fait uniquement de ce lien ou de sa version développée."""
            if att.get("Type") == "ActionOutput":
                return ids[by_uuid.get(att.get("OutputUUID"), 0)] == "getitemfromlist"
            if att.get("Type") != "Variable" or att.get("VariableName") != "lien":
                return False
            sets = [j for j, (ident, q) in enumerate(zip(ids, params)) if ident == "setvariable" and q.get("WFVariableName") == "lien"]
            for j in sets:
                src = [a for a in attachments(params[j].get("WFInput")) if a.get("Type") == "ActionOutput"]
                k = by_uuid.get(src[0].get("OutputUUID")) if len(src) == 1 else None
                if k is None or ids[k] != "gettext":
                    return False
                text, atts = token_string(params[k].get("WFTextActionText"))
                if text != OBJ or len(atts) != 1 or ids[by_uuid.get(atts[0].get("OutputUUID"), 0)] not in ("getitemfromlist", "url.expand"):
                    return False
            return bool(sets)
        lien_ok = "url" in body and body["url"][0] == OBJ and len(body["url"][1]) == 1 and link_source(body["url"][1][0])
        fmt_ok = "fmt" in body and body["fmt"][0] == OBJ and body["fmt"][1][:1] and \
            body["fmt"][1][0].get("VariableName") == "format"
        rep.check(set(body) == {"url", "fmt"} and all(v[2] == 0 for v in body.values()),
                  "création : corps JSON exactement {url, fmt}, en texte", str(sorted(body)))
        rep.check(lien_ok, "création : url = le lien extrait (variable, pas une chaîne fixe)")
        rep.check(bool(fmt_ok), "création : fmt = la variable du format choisi")
        check_auth(post, "création")

        text, atts = token_string(params[status_get].get("WFURL"))
        rep.check(params[status_get].get("WFHTTPMethod") == "GET" and text == OBJ + "?wait=20"
                  and len(atts) == 1 and output_of_key(atts[0], "status_url"),
                  "suivi : GET sur status_url + ?wait=20", text)
        check_auth(status_get, "suivi")

        text, atts = token_string(params[file_get].get("WFURL"))
        rep.check(params[file_get].get("WFHTTPMethod") == "GET" and text == OBJ and len(atts) == 1
                  and output_of_key(atts[0], "file_url"), "fichier : GET sur file_url", text)
        check_auth(file_get, "fichier")

        repeats = [i for i, ident in enumerate(ids) if ident == "repeat.count" and params[i].get("WFControlFlowMode") == 0]
        rep.check(len(repeats) == 1 and 1 <= int(params[repeats[0]].get("WFRepeatCount", 0)) <= 60,
                  "une seule boucle, bornée (≤ 60 tours)")
        if repeats:
            gid = params[repeats[0]]["GroupingIdentifier"]
            end = next(i for i in range(repeats[0] + 1, len(ids))
                       if ids[i] == "repeat.count" and params[i].get("GroupingIdentifier") == gid)
            rep.check(repeats[0] < status_get < end, "la requête de suivi est dans la boucle")

    urls = sorted({m for s in all_strings(actions) for m in re.findall(r"https?://[^\s\"'<>]+", s)})
    rep.check(all(u.startswith("https://api.malvu.fr/media/") for u in urls), "aucune autre URL que api.malvu.fr/media",
              str(urls))

    print("-- gestion des erreurs")
    for key in ("error", "detail", "message", "status", "status_url", "media_type", "file_url", "title"):
        rep.check(key in value_keys, f"la clé « {key} » de la réponse est lue")
    width = 40 if stage == "debug" else 70
    for label, start in (("création", requests[0]), ("suivi", requests[1])):
        window = ids[start:start + width]
        keys = [params[j].get("WFDictionaryKey") for j in range(start, min(start + width, len(ids))) if ids[j] == "getvalueforkey"]
        needed = {"message", "error", "status"} if (stage != "debug" or label == "création") else {"error", "status"}
        if stage != "debug":
            needed |= {"detail"}
        rep.check("detect.dictionary" in window and needed <= set(keys) and "exit" in window,
                  f"{label} : réponse contrôlée ({', '.join(sorted(needed))}) avec arrêt propre")

    def is_error_alert(i: int) -> bool:  # DEBUG : les alertes d'étape informent, seules les « Échec… » arrêtent
        text, _ = token_string(params[i].get("WFAlertActionMessage"))
        if stage != "debug" and previous_real(ids, i) in ("savetocameraroll", "documentpicker.save"):
            return False  # confirmation d'enregistrement
        return stage != "debug" or text.startswith("Échec")
    alerts_without_exit = [i for i, ident in enumerate(ids) if ident == "alert" and is_error_alert(i)
                           and ids[next_executed(ids, params, i)] != "exit"]
    rep.check(not alerts_without_exit, "chaque alerte d'erreur est suivie d'un arrêt", str(alerts_without_exit))



def previous_real(ids: list[str], i: int) -> str | None:
    j = i - 1
    while j >= 0 and ids[j] == "nothing":
        j -= 1
    return ids[j] if j >= 0 else None


def condition_checks(rep, ids, params, requests) -> None:
    # AETHRYON : la règle vaut pour tout le raccourci (présences testées par « Compter » + « est 0 »).
    # Les sources plus anciennes (YouTube Converter v2, test C dérivé) testaient des listes avant le POST.
    everywhere = any(ident == "count" for ident in ids)
    print("-- conditions " + ("de tout le raccourci" if everywhere else "après la création du job"))
    first = 0 if everywhere else min(requests)
    bad = []
    for i in range(first, len(ids)):
        p = params[i]
        if ids[i] != "conditional" or p.get("WFControlFlowMode") != 0:
            continue
        cond = p.get("WFCondition")
        target = p.get("WFConditionalActionString")
        if "WFConditions" in p or cond not in (4, 5) or not isinstance(target, str) or not target:
            bad.append(f"action {i} : condition {cond} « {target} »")
    rep.check(not bad, "uniquement « est » / « n'est pas » comparé à une valeur fixe (aucun test de présence ni « contient »)",
              "; ".join(bad[:5]))


def secrets_checks(rep, plist, ytapi) -> None:
    print("-- secrets")
    serialized = plistlib.dumps(plist, fmt=plistlib.FMT_XML).decode("utf-8")
    tokens = real_tokens(ytapi)
    leaked = [t for t in tokens if t in serialized]
    rep.check(not leaked, f"aucun des {len(tokens)} jetons réels de ytapi n'apparaît (comparaison en mémoire)",
              f"{len(leaked)} jeton(s) trouvé(s), valeurs non affichées")
    suspicious = sorted({m for s in all_strings(plist) for m in TOKEN_LIKE.findall(s) if not UUID_RE.match(m)})
    rep.check(not suspicious, "aucune chaîne ressemblant à un jeton (≥ 32 caractères)",
              f"{len(suspicious)} chaîne(s), non affichées")
    bearer_literal = [s for s in all_strings(plist) if re.search(r"Bearer\s+[^\s￼]", s)]
    rep.check(not bearer_literal, "aucun « Bearer » suivi d'une valeur en clair")



def save_checks(rep, ids, params, stage="final") -> None:
    print("-- enregistrement et confirmation")
    saves = [i for i, ident in enumerate(ids) if ident in ("savetocameraroll", "documentpicker.save")]
    notes = [i for i, ident in enumerate(ids) if ident == "notification"]
    rep.check(bool(saves) and "savetocameraroll" in [ids[i] for i in saves] and "documentpicker.save" in [ids[i] for i in saves],
              "enregistrement dans Photos et dans Fichiers prévus")
    rep.check(all(params[i].get("WFAskWhereToSave") is True for i in saves if ids[i] == "documentpicker.save"),
              "Fichiers : demande l'emplacement")
    if stage == "debug":
        rep.check(not notes, "DEBUG : pas de notification (les étapes sont des alertes)")
        return
    if not saves:
        return
    def next_real(i: int) -> int:
        j = i + 1
        while j < len(ids) and ids[j] == "nothing":
            j += 1
        return j
    confirmations = [next_real(i) for i in saves]
    rep.check(all(c < len(ids) and ids[c] == "alert" for c in confirmations),
              "chaque enregistrement est suivi d'une alerte de confirmation")
    # Avant l'enregistrement, toute alerte doit être une erreur (suivie d'un arrêt) : une alerte qui
    # laisse continuer serait une confirmation prématurée.
    early = [i for i in range(min(saves)) if ids[i] in ("alert", "notification")
             and ids[next_executed(ids, params, i)] != "exit"]
    rep.check(not notes and not early, "aucune confirmation (alerte ou notification) avant l'enregistrement", str(early or notes))
    rep.check(not any(ids[j] == "downloadurl" for j in range(min(saves), len(ids))),
              "aucune requête réseau après l'enregistrement")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("shortcut", type=Path)
    parser.add_argument("--ytapi", type=Path, default=Path(os.environ.get("AETHRYON_MEDIA_API_DIR", "/nonexistent")),
                        help="dossier ytapi dont les jetons réels ne doivent pas apparaître")
    parser.add_argument("--stage", choices=("native", "http", "final", "debug"), default="final")
    args = parser.parse_args(argv)
    return 1 if validate(load(args.shortcut), args.ytapi, args.stage) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

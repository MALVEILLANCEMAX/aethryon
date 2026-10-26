#!/usr/bin/env python3
"""Vérifie que tools/validate.py détecte réellement les défauts visés (tests par mutation).

    validator_mutants.py build/YouTube-Converter.unsigned.shortcut

Chaque mutant introduit un seul défaut dans une copie du plist compilé ; le validateur doit
le refuser. Le plist d'origine doit, lui, être accepté. Aucun secret n'est affiché : le mutant
« jeton réel » lit un jeton de ytapi en mémoire et ne l'écrit que dans un fichier temporaire
supprimé aussitôt.
"""

from __future__ import annotations

import os
import copy
import io
import plistlib
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import validate  # noqa: E402

YTAPI = Path(os.environ.get("AETHRYON_MEDIA_API_DIR", "/nonexistent"))


def run(plist: dict) -> tuple[int, str]:
    out = io.StringIO()
    with redirect_stdout(out):
        failures = validate.validate(plist, YTAPI)
    return failures, out.getvalue()


def find(plist: dict, ident: str, n: int = 0) -> dict:
    hits = [a for a in plist["WFWorkflowActions"] if a["WFWorkflowActionIdentifier"].endswith("." + ident)]
    return hits[n]["WFWorkflowActionParameters"]


def requests(plist: dict) -> list[dict]:
    return [a["WFWorkflowActionParameters"] for a in plist["WFWorkflowActions"]
            if a["WFWorkflowActionIdentifier"].endswith(".downloadurl")]


def m_no_action_index(p):
    del p["WFWorkflowImportQuestions"][0]["ActionIndex"]


def m_token_in_text(p):
    idx = p["WFWorkflowImportQuestions"][0]["ActionIndex"]
    p["WFWorkflowActions"][idx]["WFWorkflowActionParameters"]["WFTextActionText"] = "0123456789abcdef" * 4


def m_default_answer(p):
    p["WFWorkflowImportQuestions"][0]["DefaultValue"] = "mon-jeton"


def m_other_host(p):
    requests(p)[0]["WFURL"] = "https://evil.example/media/jobs?wait=20"


def m_literal_bearer(p):
    item = requests(p)[0]["WFHTTPHeaders"]["Value"]["WFDictionaryFieldValueItems"][0]
    item["WFValue"] = {"Value": {"string": "Bearer abc"}, "WFSerializationType": "WFTextTokenString"}


def m_no_advanced(p):
    del requests(p)[0]["Advanced"]


def m_no_showheaders(p):
    del requests(p)[1]["ShowHeaders"]


def m_extra_json_field(p):
    items = requests(p)[0]["WFJSONValues"]["Value"]["WFDictionaryFieldValueItems"]
    extra = copy.deepcopy(items[0])
    extra["WFKey"] = {"Value": {"string": "quality"}, "WFSerializationType": "WFTextTokenString"}
    items.append(extra)


def m_duplicate_grouping(p):
    ids = [a["WFWorkflowActionParameters"].get("GroupingIdentifier") for a in p["WFWorkflowActions"]
           if a["WFWorkflowActionIdentifier"].endswith(".conditional")]
    first = ids[0]
    for a in p["WFWorkflowActions"]:
        par = a.get("WFWorkflowActionParameters", {})
        if a["WFWorkflowActionIdentifier"].endswith(".conditional"):
            par["GroupingIdentifier"] = first  # the --derive-uuids bug


def m_variable_before_definition(p):
    acts = p["WFWorkflowActions"]
    acts.insert(0, copy.deepcopy(acts[2]))  # a condition on « liens » before it is set


def m_status_url_wrong(p):
    url = requests(p)[1]["WFURL"]["Value"]
    url["string"] = url["string"].replace("?wait=20", "&wait=20")


def m_alert_without_exit(p):
    acts = p["WFWorkflowActions"]
    i = next(i for i, a in enumerate(acts) if a["WFWorkflowActionIdentifier"].endswith(".exit"))
    acts[i] = {"WFWorkflowActionIdentifier": "is.workflow.actions.nothing", "WFWorkflowActionParameters": {}}


def m_early_confirmation(p):
    """La confirmation passe avant l'enregistrement (elle s'afficherait même si iOS refuse)."""
    acts = p["WFWorkflowActions"]
    i = next(i for i, a in enumerate(acts) if a["WFWorkflowActionIdentifier"].endswith(".savetocameraroll"))
    acts[i], acts[i + 1] = acts[i + 1], acts[i]


def m_presence_test_after_post(p):
    """Le défaut de la v1 : « Si <texte> a une valeur » après la création du job."""
    acts = p["WFWorkflowActions"]
    first = next(i for i, a in enumerate(acts) if a["WFWorkflowActionIdentifier"].endswith(".downloadurl"))
    par = next(a["WFWorkflowActionParameters"] for a in acts[first:]
               if a["WFWorkflowActionIdentifier"].endswith(".conditional") and a["WFWorkflowActionParameters"].get("WFControlFlowMode") == 0)
    par["WFCondition"] = 100
    par.pop("WFConditionalActionString", None)


def m_contains_after_post(p):
    acts = p["WFWorkflowActions"]
    first = next(i for i, a in enumerate(acts) if a["WFWorkflowActionIdentifier"].endswith(".downloadurl"))
    conds = [a["WFWorkflowActionParameters"] for a in acts[first:]
             if a["WFWorkflowActionIdentifier"].endswith(".conditional") and a["WFWorkflowActionParameters"].get("WFControlFlowMode") == 0]
    conds[-1]["WFCondition"] = 999


def m_presence_test_before_post(p):
    """AETHRYON : même un test de présence AVANT le POST est refusé (présences par « Compter »).
    Sans objet pour les sources sans « Compter » (YouTube Converter v2) : le mutant ne change rien."""
    acts = p["WFWorkflowActions"]
    if not any(a["WFWorkflowActionIdentifier"] == "is.workflow.actions.count" for a in acts):
        return  # sans objet : aucune modification
    first = next(i for i, a in enumerate(acts) if a["WFWorkflowActionIdentifier"].endswith(".downloadurl"))
    par = next(a["WFWorkflowActionParameters"] for a in acts[:first]
               if a["WFWorkflowActionIdentifier"].endswith(".conditional") and a["WFWorkflowActionParameters"].get("WFControlFlowMode") == 0)
    par["WFCondition"] = 100
    par.pop("WFConditionalActionString", None)


def m_link_from_elsewhere(p):
    """Le lien envoyé au serveur ne vient plus du lien partagé (ni de sa version développée)."""
    acts = p["WFWorkflowActions"]
    sets = [a["WFWorkflowActionParameters"] for a in acts
            if a["WFWorkflowActionIdentifier"].endswith(".setvariable") and a["WFWorkflowActionParameters"].get("WFVariableName") == "lien"]
    if sets:  # AETHRYON : une affectation de « lien » prend le presse-papiers
        clip = next(a["WFWorkflowActionParameters"] for a in acts if a["WFWorkflowActionIdentifier"].endswith(".getclipboard"))
        sets[-1]["WFInput"] = {"Value": {"OutputName": "Presse-papiers", "OutputUUID": clip.setdefault("UUID", "11111111-2222-3333-4444-555555555555"),
                                         "Type": "ActionOutput"}, "WFSerializationType": "WFTextTokenAttachment"}
    else:  # v2 : le corps du POST pointe vers une autre action que le lien extrait
        body = find(p, "downloadurl")["WFJSONValues"]["Value"]["WFDictionaryFieldValueItems"]
        url = next(item for item in body if item["WFKey"]["Value"]["string"] == "url")
        url["WFValue"]["Value"]["attachmentsByRange"] = {"{0, 1}": {"Type": "Variable", "VariableName": "format"}}


def m_unbounded_loop(p):
    find(p, "repeat.count")["WFRepeatCount"] = 500


def m_run_shortcut(p):
    p["WFWorkflowActions"].insert(5, {"WFWorkflowActionIdentifier": "is.workflow.actions.runworkflow",
                                      "WFWorkflowActionParameters": {}})


def m_no_share_sheet(p):
    p["WFWorkflowTypes"] = []


MUTANTS = [m_no_action_index, m_token_in_text, m_default_answer, m_other_host, m_literal_bearer,
           m_no_advanced, m_no_showheaders, m_extra_json_field, m_duplicate_grouping,
           m_variable_before_definition, m_status_url_wrong, m_alert_without_exit,
           m_early_confirmation, m_presence_test_after_post, m_contains_after_post, m_unbounded_loop, m_run_shortcut, m_no_share_sheet,
           m_presence_test_before_post, m_link_from_elsewhere]


def main(argv: list[str]) -> int:
    original = plistlib.loads(Path(argv[1]).read_bytes())
    failures, _ = run(original)
    ok = failures == 0
    print(f"  {'PASS' if ok else 'FAIL'}  plist d'origine accepté ({failures} échec(s))")
    for mutant in MUTANTS:
        p = copy.deepcopy(original)
        mutant(p)
        if p == original:
            print(f"  ----  mutant {mutant.__name__[2:]} sans objet pour ce fichier")
            continue
        failures, out = run(p)
        caught = failures > 0
        ok &= caught
        print(f"  {'PASS' if caught else 'FAIL'}  mutant {mutant.__name__[2:]} détecté ({failures} échec(s))")
    # Real ytapi token planted in memory only; the report never prints it.
    tokens = validate.real_tokens(YTAPI)
    if tokens:
        p = copy.deepcopy(original)
        idx = p["WFWorkflowImportQuestions"][0]["ActionIndex"]
        p["WFWorkflowActions"][idx]["WFWorkflowActionParameters"]["WFTextActionText"] = tokens[0]
        failures, out = run(p)
        caught = "FAIL  aucun des" in out
        ok &= caught
        print(f"  {'PASS' if caught else 'FAIL'}  mutant jeton_reel_de_ytapi détecté (valeur jamais affichée)")
    print(f"== {'tous les défauts sont détectés' if ok else 'DES DÉFAUTS PASSENT INAPERÇUS'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))

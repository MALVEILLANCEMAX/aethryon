#!/usr/bin/env python3
"""Vérifie que les textes d'erreur de conversion sont identiques partout (bibliothèque standard seule).

Sources comparées, caractère pour caractère :
  - docs/ERREURS.md        : la table qui fait foi (colonne « Code » entre backticks, colonne « Texte ») ;
  - account/src/usage.ts   : ERROR_TEXT (historique de l'espace personnel) ;
  - ytapi/app/errors.py    : USER_TEXT (champ `detail` renvoyé à l'iPhone), s'il existe ;
  - discord/src/errors.ts  : ERROR_TEXT (messages du bot Discord), s'il existe.

Code de sortie : 0 si tout concorde, 1 sinon (code absent ou en trop, texte différent, source illisible).
Usage : python3 scripts/check-error-codes.py [--racine CHEMIN]
"""

from __future__ import annotations

import argparse
import ast
import re
import sys
from pathlib import Path

MD_PATH = Path("docs/api/ERREURS.md")
TS_PATH = Path("apps/account/src/usage.ts")
DISCORD_TS_PATH = Path("apps/discord-bot/src/errors.ts")
PY_PATH = Path("apps/media-api/app/errors.py")


class SourceError(Exception):
    """Source absente ou illisible : la vérification ne peut pas conclure."""


# ---- docs/ERREURS.md -------------------------------------------------------------------------

def _cells(line: str) -> list[str]:
    """Cellules d'une ligne de table Markdown (les « \\| » échappés restent dans la cellule)."""
    body = line.strip()
    body = body[1:] if body.startswith("|") else body
    body = body[:-1] if body.endswith("|") and not body.endswith("\\|") else body
    return [c.strip().replace("\\|", "|") for c in re.split(r"(?<!\\)\|", body)]


def parse_markdown(text: str) -> tuple[dict[str, str], list[str]]:
    """Table « | `code` | … | texte | … » de ERREURS.md → ({code: texte}, problèmes)."""
    lines = text.splitlines()
    problems: list[str] = []
    for i, line in enumerate(lines):
        if not line.lstrip().startswith("|"):
            continue
        header = [c.lower() for c in _cells(line)]
        code_col = next((j for j, c in enumerate(header) if c.startswith("code")), None)
        text_col = next((j for j, c in enumerate(header) if c.startswith("texte")), None)
        if code_col is not None and text_col is not None:
            break
    else:
        raise SourceError(f"{MD_PATH} : en-tête de table « Code … Texte » introuvable")

    table: dict[str, str] = {}
    for line in lines[i + 2:]:  # en-tête puis ligne de séparation « |---| »
        if not line.lstrip().startswith("|"):
            break
        cells = _cells(line)
        if len(cells) <= max(code_col, text_col):
            problems.append(f"{MD_PATH} : ligne de table incomplète : {line.strip()[:80]}")
            continue
        m = re.fullmatch(r"`([A-Za-z0-9_]+)`", cells[code_col])
        if not m:
            problems.append(f"{MD_PATH} : code non reconnu (attendu entre backticks) : {cells[code_col]!r}")
            continue
        code = m.group(1)
        if code in table:
            problems.append(f"{MD_PATH} : code en double : {code}")
        table[code] = cells[text_col]
    if not table:
        raise SourceError(f"{MD_PATH} : aucune ligne de code dans la table")
    return table, problems


# ---- account/src/usage.ts --------------------------------------------------------------------

_JS_ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "v": "\v", "0": "\0"}


def _js_unescape(s: str) -> str:
    def repl(m: re.Match[str]) -> str:
        e = m.group(1)
        if e.startswith("u{"):
            return chr(int(e[2:-1], 16))
        if e[0] in "ux" and len(e) > 1:
            return chr(int(e[1:], 16))
        return _JS_ESCAPES.get(e, e)  # \" \' \\ et tout autre caractère échappé : lui-même

    return re.sub(r"\\(u\{[0-9A-Fa-f]+\}|u[0-9A-Fa-f]{4}|x[0-9A-Fa-f]{2}|.)", repl, s, flags=re.S)


_TS_ENTRY = re.compile(
    r"""^\s*(?:"(?P<dq>[^"\\]+)"|'(?P<sq>[^'\\]+)'|(?P<id>[A-Za-z_$][\w$]*))\s*:\s*"""
    r"""(?P<q>["'])(?P<text>(?:\\.|(?!(?P=q))[^\\\n])*)(?P=q)\s*,?\s*(?://.*)?$"""
)


def parse_typescript(text: str, path: Path = TS_PATH) -> tuple[dict[str, str], list[str]]:
    """Objet littéral `ERROR_TEXT … = { code: "texte", … };` → ({code: texte}, problèmes)."""
    m = re.search(r"\bERROR_TEXT\b[^=\n]*=\s*\{", text)
    if not m:
        raise SourceError(f"{path} : objet ERROR_TEXT introuvable")
    end = re.compile(r"^\s*\}\s*(?:as\s+const\s*)?;?\s*$", re.M).search(text, m.end())
    if not end:
        raise SourceError(f"{path} : fin de l'objet ERROR_TEXT introuvable")
    table: dict[str, str] = {}
    problems: list[str] = []
    for line in text[m.end():end.start()].splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("//"):
            continue
        e = _TS_ENTRY.match(line)
        if not e:
            problems.append(f"{path} : entrée de ERROR_TEXT illisible "
                            f"(une entrée « code: \"texte\", » par ligne) : {stripped[:80]}")
            continue
        code = e.group("dq") or e.group("sq") or e.group("id")
        if code in table:
            problems.append(f"{path} : code en double dans ERROR_TEXT : {code}")
        table[code] = _js_unescape(e.group("text"))
    return table, problems


# ---- ytapi/app/errors.py ---------------------------------------------------------------------

def parse_python(text: str) -> dict[str, str] | None:
    """Dictionnaire littéral USER_TEXT (affectation simple ou annotée) ; None s'il n'existe pas."""
    try:
        tree = ast.parse(text, filename=str(PY_PATH))
    except SyntaxError as exc:
        raise SourceError(f"{PY_PATH} : syntaxe invalide ({exc.msg}, ligne {exc.lineno})") from exc

    # Constantes de module (str) : une valeur de USER_TEXT peut y faire référence.
    constants: dict[str, str] = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            target, value = node.targets[0].id, node.value
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.value is not None:
            target, value = node.target.id, node.value
        else:
            continue
        if isinstance(value, ast.Constant) and isinstance(value.value, str):
            constants[target] = value.value

    def literal(node: ast.expr) -> str:
        if isinstance(node, ast.Name) and node.id in constants:
            return constants[node.id]
        value = ast.literal_eval(node)
        if not isinstance(value, str):
            raise ValueError("pas une chaîne")
        return value

    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            targets, value = node.targets, node.value
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            targets, value = [node.target], node.value
        else:
            continue
        if not any(isinstance(t, ast.Name) and t.id == "USER_TEXT" for t in targets):
            continue
        if not isinstance(value, ast.Dict):
            raise SourceError(f"{PY_PATH} : USER_TEXT (ligne {node.lineno}) n'est pas un dictionnaire littéral")
        table: dict[str, str] = {}
        for k, v in zip(value.keys, value.values):
            if k is None:
                raise SourceError(f"{PY_PATH} : USER_TEXT contient un « ** » (ligne {v.lineno}) : non vérifiable")
            try:
                code, msg = literal(k), literal(v)
            except (ValueError, SyntaxError) as exc:
                raise SourceError(f"{PY_PATH} : entrée non littérale dans USER_TEXT (ligne {k.lineno})") from exc
            if code in table:
                raise SourceError(f"{PY_PATH} : code en double dans USER_TEXT : {code}")
            table[code] = msg
        return table
    return None


# ---- comparaison -----------------------------------------------------------------------------

def _first_difference(a: str, b: str) -> str:
    i = next((j for j, (x, y) in enumerate(zip(a, b)) if x != y), min(len(a), len(b)))
    def show(s: str) -> str:
        return f"U+{ord(s[i]):04X} {s[i]!r}" if i < len(s) else "fin du texte"
    return f"1re différence au caractère {i + 1} : {show(a)} / {show(b)}"


def compare(reference: dict[str, str], name: str, other: dict[str, str]) -> list[str]:
    """Écarts entre ERREURS.md (référence) et une autre table."""
    problems: list[str] = []
    for code in reference:
        if code not in other:
            problems.append(f"{name} : code absent : {code}")
        elif other[code] != reference[code]:
            problems.append(
                f"{name} : texte différent pour {code}\n"
                f"    ERREURS.md : {reference[code]}\n"
                f"    {name:<10} : {other[code]}\n"
                f"    {_first_difference(reference[code], other[code])}"
            )
    for code in other:
        if code not in reference:
            problems.append(f"{name} : code en trop (absent de ERREURS.md) : {code}")
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compare les codes et textes d'erreur (ERREURS.md, account, ytapi).")
    parser.add_argument("--racine", type=Path, default=Path(__file__).resolve().parent.parent,
                        help="racine du dépôt (par défaut : dossier parent de scripts/)")
    root: Path = parser.parse_args(argv).racine

    def read(rel: Path) -> str:
        try:
            return (root / rel).read_text(encoding="utf-8")
        except OSError as exc:
            raise SourceError(f"{rel} : lecture impossible ({exc.strerror})") from exc

    try:
        reference, problems = parse_markdown(read(MD_PATH))
        account, ts_problems = parse_typescript(read(TS_PATH))
        problems += ts_problems
        problems += compare(reference, "account", account)
        py_file = root / PY_PATH
        ytapi = parse_python(read(PY_PATH)) if py_file.exists() else None
        bot = None
        if (root / DISCORD_TS_PATH).exists():
            bot, bot_problems = parse_typescript(read(DISCORD_TS_PATH), DISCORD_TS_PATH)
            problems += bot_problems
            problems += compare(reference, "discord", bot)
    except SourceError as exc:
        print(f"ÉCHEC : {exc}", file=sys.stderr)
        return 1

    if ytapi is None:
        print(f"ATTENTION : USER_TEXT est absent de {PY_PATH} (branche ytapi pas encore fusionnée ?) : "
              "seuls ERREURS.md et account sont comparés.", file=sys.stderr)
    else:
        problems += compare(reference, "ytapi", ytapi)

    if problems:
        for p in problems:
            print(f"ÉCART : {p}", file=sys.stderr)
        print(f"ÉCHEC : {len(problems)} écart(s) ; docs/ERREURS.md fait foi.", file=sys.stderr)
        return 1
    sources = "ERREURS.md, account, ytapi" if ytapi is not None else "ERREURS.md, account ; ytapi non vérifié"
    if bot is not None:
        sources += ", bot Discord"
    print(f"OK : {len(reference)} codes identiques ({sources})")
    return 0


if __name__ == "__main__":
    sys.exit(main())

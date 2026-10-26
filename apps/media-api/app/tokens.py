"""Labelled API tokens: API_TOKEN from the environment plus a hot-reloaded tokens file.

File format (mode 600, owner uid 10001, written by `make rotate-token LABEL=...`):

    # comments and blank lines are ignored
    iphone a3f0...64 hex chars...
    pc     9c1b...

One `label token` pair per line (a ':' or '=' separator is also accepted). Labels are the only
thing ever logged or shown; token values never leave this module.
"""

from __future__ import annotations

import logging
import os
import re
import secrets
import threading
import time
from pathlib import Path

log = logging.getLogger("ytapi.tokens")

ENV_LABEL = "env"
LABEL_RE = re.compile(r"[a-z0-9][a-z0-9_-]{0,31}")
TOKEN_RE = re.compile(r"[A-Za-z0-9_\-]{24,256}")
_LINE_RE = re.compile(r"\s*([^\s:=#]+)\s*[\s:=]\s*(\S+)\s*")
RELOAD_CHECK_S = 1.0


def parse_tokens(text: str) -> tuple[dict[str, str], list[int]]:
    """Return ({label: token}, [invalid line numbers]). Later duplicates of a label win."""
    tokens: dict[str, str] = {}
    invalid: list[int] = []
    for number, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        match = _LINE_RE.fullmatch(line)
        if not match or not LABEL_RE.fullmatch(match.group(1).lower()) or not TOKEN_RE.fullmatch(match.group(2)):
            invalid.append(number)
            continue
        tokens[match.group(1).lower()] = match.group(2)
    return tokens, invalid


class TokenStore:
    def __init__(self, env_token: str, tokens_file: Path | None) -> None:
        self._env_token = env_token
        self._file = tokens_file
        self._file_tokens: dict[str, str] = {}
        self._signature: tuple[int, int, int] | None = None
        self._last_check = 0.0
        self._lock = threading.Lock()
        self.file_state = "not_configured" if tokens_file is None else "missing"
        self._reload(force=True)

    # --- loading -----------------------------------------------------------------------------

    def _reload(self, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self._last_check < RELOAD_CHECK_S:
            return
        with self._lock:
            self._last_check = now
            if self._file is None:
                return
            try:
                st = self._file.stat()
            except FileNotFoundError:
                self._file_tokens, self._signature, self.file_state = {}, None, "missing"
                return
            except OSError:
                self._file_tokens, self._signature, self.file_state = {}, None, "unreadable"
                return
            signature = (st.st_mtime_ns, st.st_size, st.st_ino)
            if signature == self._signature and not force:
                return
            try:
                text = self._file.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                self._file_tokens, self._signature, self.file_state = {}, signature, "unreadable"
                log.warning("tokens file is not readable by the app user", extra={"tokens_file": str(self._file)})
                return
            tokens, invalid = parse_tokens(text)
            if invalid:
                log.warning("tokens file: invalid lines ignored", extra={"lines": invalid})
            if st.st_mode & 0o077:
                log.warning("tokens file is readable by group/others (expected mode 600)")
            self._file_tokens, self._signature = tokens, signature
            self.file_state = "ok" if tokens else "empty"
            log.info("tokens loaded", extra={"labels": sorted(tokens), "source": "file"})

    # --- queries -------------------------------------------------------------------------------

    def labels(self) -> list[str]:
        self._reload()
        labels = sorted(self._file_tokens)
        return ([ENV_LABEL] if self._env_token else []) + labels

    def match(self, candidate: str | None) -> str | None:
        """Label of the matching token, or None. Compares against every token (no early exit)."""
        if not candidate:
            return None
        self._reload()
        encoded = candidate.encode("utf-8", "surrogatepass")
        found = None
        pairs = list(self._file_tokens.items())
        if self._env_token:
            pairs.append((ENV_LABEL, self._env_token))
        for label, token in pairs:
            if secrets.compare_digest(encoded, token.encode("utf-8")) and found is None:
                found = label
        return found

    def has_any(self) -> bool:
        self._reload()
        return bool(self._env_token or self._file_tokens)


def generate_token() -> str:
    return secrets.token_hex(32)


def write_tokens_file(path: Path, tokens: dict[str, str], uid: int | None = None, gid: int | None = None) -> None:
    """Atomically rewrite the tokens file with mode 600 (used by scripts/rotate_token.py)."""
    lines = ["# ytapi tokens: one 'label token' per line. Managed by `make rotate-token`."]
    lines += [f"{label} {token}" for label, token in sorted(tokens.items())]
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, ("\n".join(lines) + "\n").encode())
        os.fchmod(fd, 0o600)
        if uid is not None and gid is not None:
            os.fchown(fd, uid, gid)
    finally:
        os.close(fd)
    os.replace(tmp, path)

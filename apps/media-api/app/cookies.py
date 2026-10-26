"""Validation of the optional YouTube cookies file (Netscape format), without ever exposing values.

Used at startup / on change (state shown in GET /status) and by `make cookies-install`
(`python3 -m app.cookies FILE`, exit code 0 = usable). Only counts, domains and dates are
reported; cookie names are checked against a fixed list, values are never read into the report.
"""

from __future__ import annotations

import re
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

# Same header rule as yt-dlp (http.cookiejar.NETSCAPE_MAGIC_RGX, applied to the first line).
HEADER_RE = re.compile(r"#( Netscape)? HTTP Cookie File")
HTTPONLY_PREFIX = "#HttpOnly_"
# Expiry values yt-dlp accepts ([0-9]+(.[0-9]+)?, or empty), bounded and ASCII-only. yt-dlp prints
# any other line, value included, to stderr: such lines are skipped (validate) or dropped (worker).
EXPIRY_RE = re.compile(r"(?:[0-9]{1,15}(?:\.[0-9]{1,9})?)?")
# Cookies that only exist in a logged-in Google/YouTube session.
LOGIN_COOKIES = {"SID", "HSID", "SSID", "APISID", "SAPISID", "__Secure-1PSID", "__Secure-3PSID",
                 "__Secure-1PAPISID", "__Secure-3PAPISID", "LOGIN_INFO"}
# yt-dlp's own rule (_has_auth_cookies): LOGIN_INFO plus one of these, sent to www.youtube.com.
SAPISID_COOKIES = {"SAPISID", "__Secure-1PAPISID", "__Secure-3PAPISID"}


def _sent_to_www_youtube(domain: str) -> bool:
    host = domain.lower()
    return host in (".youtube.com", "youtube.com", "www.youtube.com", ".www.youtube.com")


@dataclass
class CookieReport:
    state: str  # absent | unreadable | invalid | no_youtube | expired | ok
    detail: str
    entries: int = 0
    youtube_entries: int = 0
    google_entries: int = 0
    login_cookies: list[str] = field(default_factory=list)  # names only, never values
    expired_login_cookies: int = 0
    earliest_login_expiry: str | None = None
    checked_at: str = ""

    @property
    def usable(self) -> bool:
        return self.state == "ok"

    def public(self) -> dict[str, object]:
        return asdict(self)


def _iso(ts: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))


def validate(path: Path | None, now: float | None = None) -> CookieReport:
    now = time.time() if now is None else now
    stamp = _iso(now)
    if path is None:
        return CookieReport("absent", "Aucun fichier de cookies configuré.", checked_at=stamp)
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        return CookieReport("absent", "Pas de fichier de cookies (installez-le avec make cookies-install).",
                            checked_at=stamp)
    except OSError:
        return CookieReport("unreadable", "Fichier de cookies illisible par l'application (droits).", checked_at=stamp)
    if raw.startswith(b"\xef\xbb\xbf"):
        return CookieReport("invalid", "Le fichier commence par un BOM UTF-8 : réenregistrez-le sans BOM.",
                            checked_at=stamp)
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return CookieReport("invalid", "Le fichier n'est pas du texte UTF-8.", checked_at=stamp)
    stripped = text.lstrip()
    if stripped.startswith(("[", "{")):
        return CookieReport("invalid", "Export JSON détecté : il faut le format Netscape (cookies.txt).",
                            checked_at=stamp)
    lines = text.splitlines()
    if not lines or not HEADER_RE.match(lines[0]):
        return CookieReport("invalid", "Première ligne attendue : « # Netscape HTTP Cookie File ».",
                            checked_at=stamp)

    report = CookieReport("ok", "", checked_at=stamp)
    login_expiries: list[float] = []
    auth_names: set[str] = set()  # valid (unexpired) auth cookies sent to www.youtube.com
    for line in lines[1:]:
        if line.startswith(HTTPONLY_PREFIX):
            line = line[len(HTTPONLY_PREFIX):]
        if not line.strip() or line.startswith("#"):
            continue
        fields = line.split("\t")
        if len(fields) != 7 or not EXPIRY_RE.fullmatch(fields[4]):
            continue  # yt-dlp skips such lines too
        domain, _flag, _path, _secure, expires, name, _value = fields
        report.entries += 1
        host = domain.lstrip(".").lower()
        on_youtube = host == "youtube.com" or host.endswith(".youtube.com")
        on_google = host == "google.com" or host.endswith(".google.com")
        report.youtube_entries += on_youtube
        report.google_entries += on_google
        if (on_youtube or on_google) and name in LOGIN_COOKIES:
            if name not in report.login_cookies:
                report.login_cookies.append(name)
            try:
                expiry = float(expires or 0)
            except ValueError:
                expiry = 0.0
            if expiry and expiry < now:
                report.expired_login_cookies += 1
            else:
                if expiry:
                    login_expiries.append(expiry)
                if _sent_to_www_youtube(domain):
                    auth_names.add(name)
    report.login_cookies.sort()
    if login_expiries:
        report.earliest_login_expiry = _iso(min(login_expiries))

    logged_in = "LOGIN_INFO" in auth_names and bool(auth_names & SAPISID_COOKIES)
    if report.youtube_entries == 0:
        report.state, report.detail = "no_youtube", "Aucun cookie youtube.com dans le fichier."
    elif logged_in:
        report.detail = f"{report.entries} cookies, session YouTube détectée."
    elif report.expired_login_cookies:
        report.state, report.detail = "expired", "Les cookies de session YouTube ont expiré : réexportez-les."
    else:
        report.state, report.detail = ("no_youtube", "Pas de session YouTube connectée (il faut LOGIN_INFO et SAPISID "
                                       "sur youtube.com) : exportez depuis youtube.com une fois connecté.")
    return report


class CookieMonitor:
    """Re-validates the cookies file when it changes (mtime/size/inode), at most once per second."""

    def __init__(self, path: Path | None) -> None:
        self.path = path
        self._signature: tuple[int, int, int] | None = None
        self._last_check = 0.0
        self.report = validate(path)
        self._remember_signature()

    def _remember_signature(self) -> None:
        try:
            st = self.path.stat() if self.path else None
        except OSError:
            st = None
        self._signature = (st.st_mtime_ns, st.st_size, st.st_ino) if st else None

    def refresh(self) -> CookieReport:
        now = time.monotonic()
        if now - self._last_check < 1.0:
            return self.report
        self._last_check = now
        previous = self._signature
        self._remember_signature()
        if self._signature != previous:
            self.report = validate(self.path)
        return self.report

    def for_youtube(self) -> str | None:
        """Path to pass to a YouTube task, None for "no cookies"; raises on a broken file."""
        report = self.refresh()
        if report.state in ("invalid", "unreadable"):
            from .errors import ApiError

            raise ApiError(500, "cookies_invalid", f"Fichier de cookies inutilisable : {report.detail}")
        return str(self.path) if report.usable and self.path else None


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: python3 -m app.cookies FILE", file=sys.stderr)
        return 2
    report = validate(Path(argv[1]))
    print(f"état : {report.state} — {report.detail}")
    print(f"entrées : {report.entries} (youtube.com : {report.youtube_entries}, google.com : {report.google_entries})")
    if report.login_cookies:
        print(f"cookies de session présents : {', '.join(report.login_cookies)}")
    if report.earliest_login_expiry:
        print(f"première expiration d'un cookie de session : {report.earliest_login_expiry}")
    return 0 if report.usable else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))

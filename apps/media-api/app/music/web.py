"""Outgoing HTTP of AETHRYON Music (stdlib only, blocking: always called through asyncio.to_thread).

Every request:
- HTTPS only, port 443, no user:password in the URL, no proxy (http.client never reads HTTP(S)_PROXY), no cookie;
- the host must match the caller's `HostPolicy` (exact API hosts of a connector, or "any public host" for a podcast
  feed, an episode or a direct file) AND never be a commercial catalogue / streaming CDN (`BLOCKED_SUFFIXES`, always
  refused: stream ripping is impossible by construction, whatever a feed or a redirect points to);
- the name is resolved once, EVERY address must be public (no loopback, private, link-local, CGNAT, multicast,
  reserved), and the connection goes to that pinned address (TLS still verified against the name): no DNS rebinding;
- redirects are followed by hand, at most 5, each target checked again like the first URL;
- bounded body (max_bytes), per-operation timeout and overall deadline; optional progress callback and cancellation
  checked between chunks.
`allow_local=True` (MUSIC_ALLOW_LOCAL_SOURCES, tests only, refused by load_settings without DEBUG) admits http, any
port and private addresses, for local test servers.
"""

from __future__ import annotations

import http.client
import ipaddress
import socket
import ssl
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import IO
from urllib.parse import urljoin, urlsplit

from ..errors import ApiError

CHUNK = 64 * 1024
MAX_REDIRECTS = 5
OP_TIMEOUT_S = 20.0

# Commercial catalogues and their CDNs: no byte is ever DOWNLOADED from these hosts by AETHRYON Music (metadata calls
# to their official APIs use an exact allow-list instead, see HostPolicy.api). Suffix match on label boundaries.
BLOCKED_SUFFIXES: tuple[str, ...] = (
    # Spotify
    "spotify.com", "spotify.link", "scdn.co", "spotifycdn.com", "spotifycdn.net", "pscdn.co", "spotify.net",
    # Apple Music / iTunes (previews included: "streamed only, not downloaded")
    "apple.com", "itunes.com", "mzstatic.com", "apple-music.com", "aaplimg.com",
    # SoundCloud (pages, API, HLS and progressive streams)
    "soundcloud.com", "sndcdn.com", "soundcloud.cloud", "snd.sc",
    # Deezer
    "deezer.com", "dzcdn.net", "deezer.page.link", "deezer.net",
    # YouTube / YouTube Music / Google video CDN
    "youtube.com", "youtu.be", "youtube-nocookie.com", "googlevideo.com", "ytimg.com", "music.youtube.com",
    # Other commercial streaming / stores
    "tidal.com", "tidalhifi.com", "qobuz.com", "napster.com", "music.amazon.com", "music.amazon.fr",
    "bandcamp.com", "bcbits.com", "audiomack.com", "mixcloud.com", "anghami.com", "boomplay.com",
    "jiosaavn.com", "saavncdn.com", "pandora.com", "tiktok.com", "tiktokcdn.com",
)
# Streaming manifests / playlists: a manifest is how a stream is captured, never a file published for download.
BLOCKED_EXTENSIONS = (".m3u8", ".m3u", ".mpd", ".pls", ".asx", ".xspf", ".ism", ".f4m")
BLOCKED_CONTENT_TYPES = ("mpegurl", "dash+xml", "vnd.ms-sstr", "x-scpls", "f4m")


def host_matches(host: str, suffix: str) -> bool:
    return host == suffix or host.endswith("." + suffix)


def is_blocked_host(host: str) -> bool:
    host = host.lower().rstrip(".")
    return any(host_matches(host, s) for s in BLOCKED_SUFFIXES)


@dataclass(frozen=True)
class HostPolicy:
    """Hosts a request may reach: exact names, label suffixes (".us.archive.org"), or any public host."""

    exact: frozenset[str] = frozenset()
    suffixes: tuple[str, ...] = ()
    any_public: bool = False
    label: str = "source"

    @classmethod
    def api(cls, *hosts: str, suffixes: tuple[str, ...] = (), label: str = "api") -> HostPolicy:
        return cls(exact=frozenset(h.lower() for h in hosts), suffixes=suffixes, label=label)

    def allows(self, host: str) -> bool:
        host = host.lower().rstrip(".")
        if host in self.exact or any(host_matches(host, s.lstrip(".")) for s in self.suffixes):
            return True  # explicit API hosts of a connector (metadata calls)
        return self.any_public and not is_blocked_host(host)


ANY_PUBLIC = HostPolicy(any_public=True, label="publique")


class Refused(ApiError):
    """URL refused before any connection (scheme, host, address, manifest)."""


def _refused(detail: str, code: str = "source_refusee") -> Refused:
    return Refused(403, code, detail)


def check_url(url: str, policy: HostPolicy, allow_local: bool = False) -> tuple[str, str, int, str]:
    """(scheme, host, port, path+query) of an acceptable URL, or Refused."""
    if len(url) > 4096:
        raise _refused("Adresse trop longue.")
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        raise _refused("Adresse illisible.") from None
    scheme = parts.scheme.lower()
    if scheme != "https" and not (allow_local and scheme == "http"):
        raise _refused("Seules les adresses https:// sont acceptées.")
    host = (parts.hostname or "").lower().rstrip(".")
    if not host or parts.username or parts.password or any(c in host for c in "\\%@ "):
        raise _refused("Adresse invalide.")
    if port not in (None, 443) and not allow_local:
        raise _refused("Port non autorisé (443 seulement).")
    if is_blocked_host(host) and host not in policy.exact:
        raise _refused("Cette adresse appartient à un service de streaming commercial : AETHRYON Music n'en "
                       "télécharge jamais rien.", "telechargement_non_autorise")
    if not policy.allows(host):
        raise _refused(f"Hôte non autorisé pour cette source ({policy.label}).")
    lowered = parts.path.lower()
    if lowered.endswith(BLOCKED_EXTENSIONS):
        raise _refused("Flux de streaming (manifeste) refusé : seuls les fichiers publiés pour le téléchargement "
                       "sont importés.", "telechargement_non_autorise")
    path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
    return scheme, host, port or (443 if scheme == "https" else 80), path


def public_address(host: str, port: int, allow_local: bool = False) -> str:
    """Resolve `host`; every address must be public. Returns the address to connect to."""
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError):
        raise ApiError(502, "source_indisponible", "Nom de domaine introuvable.") from None
    addresses = [info[4][0] for info in infos]
    if not addresses:
        raise ApiError(502, "source_indisponible", "Nom de domaine introuvable.")
    if not allow_local:
        for raw in addresses:
            ip = ipaddress.ip_address(raw.split("%", 1)[0])
            mapped = getattr(ip, "ipv4_mapped", None)
            if mapped is not None:
                ip = mapped
            if not ip.is_global or ip.is_multicast:
                raise _refused("Adresse réseau non publique refusée.")
    return addresses[0]


class _PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, host: str, address: str, port: int, timeout: float, context: ssl.SSLContext) -> None:
        super().__init__(host, port, timeout=timeout, context=context)
        self._address = address
        self._ctx = context

    def connect(self) -> None:
        sock = socket.create_connection((self._address, self.port), self.timeout)
        self.sock = self._ctx.wrap_socket(sock, server_hostname=self.host)


class _PinnedHTTP(http.client.HTTPConnection):
    def __init__(self, host: str, address: str, port: int, timeout: float) -> None:
        super().__init__(host, port, timeout=timeout)
        self._address = address

    def connect(self) -> None:
        self.sock = socket.create_connection((self._address, self.port), self.timeout)


@dataclass
class Response:
    status: int
    headers: dict[str, str]
    url: str  # final URL (after redirects)
    body: bytes = b""
    received: int = 0  # bytes written to the sink (stream mode)
    redirects: list[str] = field(default_factory=list)

    def header(self, name: str) -> str:
        return self.headers.get(name.lower(), "")


class Cancelled(Exception):
    pass


class Web:
    """Blocking HTTP client shared by the connectors and the import jobs."""

    def __init__(self, user_agent: str, allow_local: bool = False, op_timeout_s: float = OP_TIMEOUT_S) -> None:
        self.user_agent = user_agent
        self.allow_local = allow_local
        self.op_timeout_s = op_timeout_s
        self.context = ssl.create_default_context()
        self.requests = 0  # counter (tests and /music/connecteurs diagnostics)

    def request(self, method: str, url: str, policy: HostPolicy, *, headers: dict[str, str] | None = None,
                body: bytes | None = None, max_bytes: int = 2 * 1024 * 1024, deadline_s: float = 15.0,
                sink: IO[bytes] | None = None, progress: Callable[[int, int | None], None] | None = None,
                cancelled: Callable[[], bool] | None = None, accept_status: tuple[int, ...] = (200, 206),
                peek: int | None = None) -> Response:
        """One request (redirects followed by hand). The body goes to `sink` (stream mode) or to Response.body (at
        most max_bytes; `peek` keeps only the first bytes and closes). Statuses outside accept_status are returned
        as is (the caller decides); bodies over max_bytes raise 413 fichier_trop_volumineux."""
        deadline = time.monotonic() + deadline_s
        hops: list[str] = []
        current = url
        for _ in range(MAX_REDIRECTS + 1):
            scheme, host, port, path = check_url(current, policy, self.allow_local)
            address = public_address(host, port, self.allow_local)
            timeout = max(1.0, min(self.op_timeout_s, deadline - time.monotonic()))
            conn: http.client.HTTPConnection
            if scheme == "https":
                conn = _PinnedHTTPS(host, address, port, timeout, self.context)
            else:
                conn = _PinnedHTTP(host, address, port, timeout)
            sent = {"User-Agent": self.user_agent, "Accept-Encoding": "identity", "Connection": "close",
                    **(headers or {})}
            try:
                self.requests += 1
                conn.request(method, path, body=body, headers=sent)
                resp = conn.getresponse()
                status = resp.status
                resp_headers = {k.lower(): v for k, v in resp.getheaders()}
                if status in (301, 302, 303, 307, 308) and resp_headers.get("location"):
                    resp.read(64 * 1024)
                    hops.append(current)
                    current = urljoin(current, resp_headers["location"])
                    if status == 303:
                        method, body = "GET", None
                    continue
                ctype = resp_headers.get("content-type", "").lower()
                if any(t in ctype for t in BLOCKED_CONTENT_TYPES):
                    raise _refused("Flux de streaming (manifeste) refusé.", "telechargement_non_autorise")
                out = Response(status, resp_headers, current, redirects=hops)
                if status not in accept_status:
                    out.body = resp.read(16 * 1024)
                    return out
                declared = resp_headers.get("content-length", "")
                total = int(declared) if declared.isdigit() else None
                if total is not None and total > max_bytes and peek is None:
                    raise ApiError(413, "fichier_trop_volumineux",
                                   f"Fichier trop volumineux ({total // (1024 * 1024)} Mo, "
                                   f"{max_bytes // (1024 * 1024)} Mo au plus).")
                chunks: list[bytes] = []
                received = 0
                while True:
                    if cancelled is not None and cancelled():
                        raise Cancelled()
                    if time.monotonic() > deadline:
                        raise ApiError(504, "source_trop_lente", "La source répond trop lentement : réessaie plus tard.")
                    want = CHUNK if peek is None else min(CHUNK, peek - received)
                    if want <= 0:
                        break
                    chunk = resp.read(want)
                    if not chunk:
                        break
                    received += len(chunk)
                    if received > max_bytes and peek is None:
                        raise ApiError(413, "fichier_trop_volumineux",
                                       f"Fichier trop volumineux ({max_bytes // (1024 * 1024)} Mo au plus).")
                    if sink is not None:
                        sink.write(chunk)
                    else:
                        chunks.append(chunk)
                    if progress is not None:
                        progress(received, total)
                out.body = b"".join(chunks)
                out.received = received
                if total is not None and peek is None and received != total:
                    raise ApiError(502, "transfert_incomplet", "Transfert interrompu : fichier incomplet.")
                return out
            except (ApiError, Cancelled):
                raise
            except (OSError, http.client.HTTPException, ValueError):
                raise ApiError(503, "source_indisponible", "La source ne répond pas : réessaie dans quelques minutes.",
                               {"Retry-After": "60"}) from None
            finally:
                conn.close()
        raise _refused("Trop de redirections.")

    def get_json(self, url: str, policy: HostPolicy, *, max_bytes: int = 4 * 1024 * 1024, deadline_s: float = 10.0,
                 headers: dict[str, str] | None = None) -> tuple[int, object]:
        import json

        resp = self.request("GET", url, policy, headers={"Accept": "application/json", **(headers or {})},
                            max_bytes=max_bytes, deadline_s=deadline_s, accept_status=(200,))
        if resp.status != 200:
            return resp.status, None
        try:
            return 200, json.loads(resp.body.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise ApiError(502, "source_illisible", "Réponse illisible de la source.") from None

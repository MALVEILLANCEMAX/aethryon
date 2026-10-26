"""Thumbnails of POST /preview for the AETHRYON Tools: fetched by the server, never by the visitor's browser.

The site's CSP only allows its own images, and the visitor's address never reaches a platform's CDN. This is the
ONLY place where ytapi fetches an address that a platform chose (the thumbnail of the media), so it is strict:
- https on port 443 only, no credentials, a host of the platforms' image CDNs (label boundary, never a substring);
- the name is resolved here and EVERY address must be public (no private, loopback, link-local, reserved,
  multicast or unspecified address); the connection goes to the checked address (no second resolution);
- the certificate is verified for the host name; at most 2 redirects, each one checked the same way;
- 6 s per step, 2 MB at most, an image type confirmed by its first bytes (JPEG, PNG, WebP);
- no proxy, no cookie, no referrer. Bytes are kept 10 min in memory (small LRU).
"""

from __future__ import annotations

import http.client
import ipaddress
import logging
import socket
import ssl
import time
from collections import OrderedDict
from urllib.parse import urlsplit, urlunsplit

from .errors import ApiError

log = logging.getLogger("ytapi.thumbs")

THUMB_HOSTS = ("ytimg.com", "ggpht.com", "tiktokcdn.com", "tiktokcdn-us.com", "tiktokcdn-eu.com", "ibyteimg.com",
               "byteimg.com", "twimg.com")
MAX_BYTES = 2 * 1024 * 1024
TIMEOUT_S = 6.0
MAX_REDIRECTS = 2
CACHE_S = 600
CACHE_ITEMS = 64


def _host_allowed(host: str) -> bool:
    return any(host == domain or host.endswith("." + domain) for domain in THUMB_HOSTS)


def _refuse(reason: str) -> ApiError:
    log.info("thumbnail refused", extra={"reason": reason})
    return ApiError(404, "thumbnail_unavailable", "Vignette indisponible.")


def check_url(url: str) -> tuple[str, str]:
    """(host, path?query) of an allowed thumbnail address, or 404."""
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        raise _refuse("unparsable") from None
    host = (parts.hostname or "").lower().rstrip(".")
    if parts.scheme != "https" or port not in (None, 443) or parts.username or parts.password:
        raise _refuse("scheme/port/credentials")
    if not host or not _host_allowed(host):
        raise _refuse("host")
    path = urlunsplit(("", "", parts.path or "/", parts.query, ""))
    return host, path


def public_addresses(host: str) -> list[str]:
    """Every address of `host`, all public, or 404 (one private answer is enough to refuse)."""
    try:
        infos = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except OSError:
        raise _refuse("dns") from None
    addresses: list[str] = []
    for info in infos:
        address = ipaddress.ip_address(info[4][0].split("%", 1)[0])
        if not address.is_global or address.is_multicast or address.is_reserved or address.is_unspecified:
            raise _refuse("non-public address")
        addresses.append(str(address))
    if not addresses:
        raise _refuse("dns")
    # IPv4 first: the server's IPv6 route is not guaranteed.
    return sorted(dict.fromkeys(addresses), key=lambda a: ":" in a)


def _sniff(data: bytes) -> str | None:
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def fetch_image(url: str) -> tuple[bytes, str]:
    """Blocking (run it in a thread). Returns (bytes, media type) or raises a 404 ApiError."""
    context = ssl.create_default_context()
    for _ in range(MAX_REDIRECTS + 1):
        host, path = check_url(url)
        address = public_addresses(host)[0]
        conn = http.client.HTTPSConnection(host, 443, timeout=TIMEOUT_S, context=context)
        try:
            raw = socket.create_connection((address, 443), timeout=TIMEOUT_S)
            conn.sock = context.wrap_socket(raw, server_hostname=host)  # certificate checked for `host`
            conn.request("GET", path, headers={"Host": host, "Accept": "image/jpeg,image/png,image/webp,image/*;q=0.5",
                                               "User-Agent": "Mozilla/5.0 (AETHRYON)", "Accept-Encoding": "identity"})
            response = conn.getresponse()
            if response.status in (301, 302, 303, 307, 308):
                location = response.getheader("Location") or ""
                if not location.startswith("https://"):
                    raise _refuse("redirect")
                url = location
                continue
            if response.status != 200:
                raise _refuse(f"status {response.status}")
            length = response.getheader("Content-Length")
            if length and length.isdigit() and int(length) > MAX_BYTES:
                raise _refuse("too large")
            data = response.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                raise _refuse("too large")
            kind = _sniff(data)
            if kind is None:
                raise _refuse("not an image")
            return data, kind
        except (OSError, ssl.SSLError, http.client.HTTPException):
            raise _refuse("network") from None
        finally:
            conn.close()
    raise _refuse("too many redirects")


class ThumbCache:
    def __init__(self) -> None:
        self._items: OrderedDict[str, tuple[float, bytes, str]] = OrderedDict()

    def get(self, url: str) -> tuple[bytes, str] | None:
        hit = self._items.get(url)
        if hit is None or time.time() - hit[0] > CACHE_S:
            self._items.pop(url, None)
            return None
        self._items.move_to_end(url)
        return hit[1], hit[2]

    def put(self, url: str, data: bytes, kind: str) -> None:
        self._items[url] = (time.time(), data, kind)
        self._items.move_to_end(url)
        while len(self._items) > CACHE_ITEMS:
            self._items.popitem(last=False)

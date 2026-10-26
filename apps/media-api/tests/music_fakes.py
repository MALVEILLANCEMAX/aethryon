"""Test doubles of AETHRYON Music: a fake web (no network, but every URL still goes through the real check_url of
app/music/web.py, redirects included), real small audio files made by ffmpeg, official API answers."""

from __future__ import annotations

import hashlib
import json
import subprocess
from collections.abc import Callable
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlsplit

from app.errors import ApiError
from app.music.web import BLOCKED_CONTENT_TYPES, Cancelled, HostPolicy, Response, Web, check_url

Reply = tuple[int, dict[str, str], bytes]
Handler = Callable[[str, str, dict[str, str]], Reply]


def jreply(data: Any, status: int = 200) -> Reply:
    return status, {"content-type": "application/json"}, json.dumps(data).encode()


class FakeWeb(Web):
    """Routes (host, path or path prefix ending with "*") -> reply or handler. Unknown route: 404."""

    def __init__(self) -> None:
        super().__init__("AETHRYON-Music/test")
        self.routes: dict[tuple[str, str], Reply | Handler] = {}
        self.calls: list[tuple[str, str]] = []  # (method, url) actually "sent"
        self.refused: list[str] = []  # URLs refused by check_url

    def add(self, host: str, path: str, reply: Reply | Handler) -> None:
        self.routes[(host, path)] = reply

    def _find(self, host: str, path: str) -> Reply | Handler | None:
        if (host, path) in self.routes:
            return self.routes[(host, path)]
        base = path.split("?", 1)[0]
        if (host, base) in self.routes:
            return self.routes[(host, base)]
        for (h, p), reply in self.routes.items():
            if h == host and p.endswith("*") and path.startswith(p[:-1]):
                return reply
        return None

    def request(self, method: str, url: str, policy: HostPolicy, *, headers: dict[str, str] | None = None,
                body: bytes | None = None, max_bytes: int = 2 * 1024 * 1024, deadline_s: float = 15.0,
                sink: Any = None, progress: Any = None, cancelled: Any = None,
                accept_status: tuple[int, ...] = (200, 206), peek: int | None = None) -> Response:
        current, hops = url, []
        for _ in range(6):
            try:
                _, host, _, path = check_url(current, policy, False)
            except ApiError:
                self.refused.append(current)
                raise
            self.calls.append((method, current))
            reply = self._find(host, path)
            if reply is None:
                status, rh, data = 404, {}, b"not found"
            elif callable(reply):
                status, rh, data = reply(method, path, headers or {})
            else:
                status, rh, data = reply
            rh = {k.lower(): v for k, v in rh.items()}
            if status in (301, 302, 303, 307, 308):
                hops.append(current)
                current = urljoin(current, rh["location"])
                continue
            if any(t in rh.get("content-type", "") for t in BLOCKED_CONTENT_TYPES):
                raise ApiError(403, "telechargement_non_autorise", "manifest")
            out = Response(status, rh, current, redirects=hops)
            if status not in accept_status:
                out.body = data[:16384]
                return out
            if peek is not None:
                out.body = data[:peek]
                return out
            if len(data) > max_bytes:
                raise ApiError(413, "fichier_trop_volumineux", "trop gros")
            if cancelled is not None and cancelled():
                raise Cancelled()
            if sink is not None:
                sink.write(data)
                out.received = len(data)
            else:
                out.body = data
            if progress is not None:
                progress(len(data), len(data))
            return out
        raise ApiError(403, "source_refusee", "redirections")

    def hosts(self) -> set[str]:
        return {urlsplit(u).hostname or "" for _, u in self.calls}


def make_audio(directory: Path, ext: str, seconds: float = 2.0) -> Path:
    codec = {"mp3": ["-c:a", "libmp3lame", "-b:a", "64k"], "ogg": ["-c:a", "libvorbis"], "flac": ["-c:a", "flac"],
             "wav": ["-c:a", "pcm_s16le"], "m4a": ["-c:a", "aac", "-b:a", "64k"]}[ext]
    out = directory / f"son-{seconds:g}.{ext}"
    if not out.exists():
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i",
                        f"sine=frequency=440:duration={seconds}", "-ac", "1", *codec, str(out)], check=True)
    return out


def tags_of(path: Path) -> dict[str, str]:
    out = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
                         capture_output=True, text=True, check=True)
    data = json.loads(out.stdout)
    tags = {k.lower(): v for k, v in (data.get("format", {}).get("tags") or {}).items()}
    for s in data.get("streams", []):  # Ogg/Opus keep their comments on the stream
        tags.update({k.lower(): v for k, v in (s.get("tags") or {}).items()})
    return tags


def md5_hex(data: bytes) -> str:
    return hashlib.md5(data).hexdigest()  # noqa: S324


def archive_metadata(ident: str, licenseurl: str | None, files: list[dict[str, Any]], **md: Any) -> dict[str, Any]:
    meta = {"identifier": ident, "title": "Gymnopédie n° 1", "creator": "Erik Satie (interprète : Ensemble Libre)",
            "date": "1888", "mediatype": "audio", "collection": ["opensource_audio"], **md}
    if licenseurl:
        meta["licenseurl"] = licenseurl
    return {"metadata": meta, "files": files, "server": "ia800001.us.archive.org", "dir": f"/1/items/{ident}"}


def commons_info(name: str, data: bytes, license_code: str = "cc-by-sa-4.0", mediatype: str = "AUDIO",
                 mime: str = "audio/ogg") -> dict[str, Any]:
    return {"query": {"pages": [{"title": f"File:{name}", "imageinfo": [{
        "url": f"https://upload.wikimedia.org/wikipedia/commons/a/ab/{name}",
        "descriptionurl": f"https://commons.wikimedia.org/wiki/File:{name}", "size": len(data), "mime": mime,
        "mediatype": mediatype, "sha1": hashlib.sha1(data).hexdigest(),  # noqa: S324
        "extmetadata": {"LicenseShortName": {"value": "CC BY-SA 4.0"}, "License": {"value": license_code},
                        "LicenseUrl": {"value": "https://creativecommons.org/licenses/by-sa/4.0"},
                        "Artist": {"value": "<a href=\"//commons.wikimedia.org/wiki/User:Exemple\">Exemple</a>"},
                        "ObjectName": {"value": "Chant d'oiseau"}, "AttributionRequired": {"value": "true"}}}]}]}}


def rss(enclosure_url: str, length: int, extra: str = "", mime: str = "audio/mpeg") -> bytes:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel><title>Les Ondes Libres</title><link>https://podcast.example.org/</link>
<itunes:author>Radio Exemple</itunes:author><copyright>© Radio Exemple</copyright>
<itunes:image href="https://podcast.example.org/cover.jpg"/>{extra}
<item><title>Épisode 1 : le son</title><guid>ep-0001</guid><pubDate>Mon, 20 Oct 2026 08:00:00 GMT</pubDate>
<enclosure url="{enclosure_url}" length="{length}" type="{mime}"/><itunes:duration>00:00:02</itunes:duration></item>
<item><title>Épisode vidéo</title><guid>ep-video</guid>
<enclosure url="https://cdn.example.org/ep-video.mp4" length="10" type="video/mp4"/></item>
</channel></rss>""".encode()

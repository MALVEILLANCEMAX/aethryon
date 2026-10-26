"""Result cache: same media + same output parameters within CACHE_TTL_MIN -> reuse the file.

Files are hard links inside TMP_DIR/cache/<key>/ (same volume as the job and /dl work dirs), so
a cached file and a job file share their bytes and can be deleted independently. The index is
in memory (lost on restart, like jobs); the oldest entries are evicted above MAX_CACHE_MB.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

log = logging.getLogger("ytapi.cache")

# Output parameters that change the produced file, per format.
_RELEVANT = {
    "mp4": ("quality", "transcode", "index", "start_s", "end_s"),
    "mp3": ("bitrate", "index", "start_s", "end_s"),
    "gif": ("gif_width", "gif_fps", "index", "start_s", "end_s"),
}


def cache_key(media_key: str, params: dict[str, Any]) -> str:
    fmt = params["fmt"]
    # Clip bounds only when set: keys of full-length files stay the ones computed before clips existed.
    relevant = {name: params.get(name) for name in _RELEVANT.get(fmt, ())
                if name not in ("start_s", "end_s") or params.get(name) is not None}
    blob = json.dumps({"m": media_key, "fmt": fmt, **relevant}, sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()[:32]


@dataclass
class CacheEntry:
    key: str
    path: Path
    result: dict[str, Any]
    size: int
    created: float


def link_or_copy(source: Path, target_dir: Path) -> Path:
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / source.name
    try:
        os.link(source, target)
    except FileExistsError:
        pass
    except OSError:
        shutil.copy2(source, target)  # different filesystem
    return target


class ResultCache:
    def __init__(self, root: Path, ttl_s: int, max_bytes: int) -> None:
        self.root = root
        self.ttl_s = ttl_s
        self.max_bytes = max_bytes
        self._entries: dict[str, CacheEntry] = {}

    @property
    def enabled(self) -> bool:
        return self.ttl_s > 0 and self.max_bytes > 0

    @property
    def total_bytes(self) -> int:
        return sum(e.size for e in self._entries.values())

    def get(self, key: str) -> CacheEntry | None:
        if not self.enabled:
            return None
        entry = self._entries.get(key)
        if entry is None:
            return None
        if time.time() - entry.created > self.ttl_s or not entry.path.is_file():
            self._drop(key)
            return None
        return entry

    def put(self, key: str, result: dict[str, Any]) -> None:
        if not self.enabled:
            return
        source = Path(result["filepath"])
        size = int(result.get("size") or 0)
        if size > self.max_bytes or not source.is_file():
            return
        self._drop(key)
        try:
            path = link_or_copy(source, self.root / key)
        except OSError:
            log.warning("cache: could not store file", exc_info=True)
            return
        self._entries[key] = CacheEntry(key, path, dict(result, filepath=str(path)), size, time.time())
        self._evict()

    def materialize(self, entry: CacheEntry, target_dir: Path) -> dict[str, Any]:
        """Give a request/job its own link to the cached file (safe against later eviction)."""
        path = link_or_copy(entry.path, target_dir)
        return dict(entry.result, filepath=str(path), cached=True)

    def prune(self) -> int:
        now = time.time()
        expired = [k for k, e in self._entries.items() if now - e.created > self.ttl_s or not e.path.is_file()]
        for key in expired:
            self._drop(key)
        return len(expired)

    def _evict(self) -> None:
        while self._entries and self.total_bytes > self.max_bytes:
            oldest = min(self._entries.values(), key=lambda e: e.created)
            self._drop(oldest.key)

    def _drop(self, key: str) -> None:
        self._entries.pop(key, None)
        shutil.rmtree(self.root / key, ignore_errors=True)

    def stats(self) -> dict[str, Any]:
        return {"enabled": self.enabled, "entries": len(self._entries), "bytes": self.total_bytes,
                "max_bytes": self.max_bytes, "ttl_min": self.ttl_s // 60}

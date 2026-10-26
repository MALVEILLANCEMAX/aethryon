"""JSON structured logging with secret redaction."""

from __future__ import annotations

import json
import logging
import re
import sys
from datetime import datetime, timezone

_REDACT_RES = [
    (re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]+"), r"\1[REDACTED]"),
    (re.compile(r"(?i)([?&]token=)[^&\s\"']+"), r"\1[REDACTED]"),
    (re.compile(r"(?i)(\"?(api_)?token\"?\s*[:=]\s*\"?)[^\s\"',&]+"), r"\1[REDACTED]"),
    # Credentials inside URLs (YT_PROXY=socks5h://user:pass@host, printed by yt-dlp in DEBUG).
    (re.compile(r"(?i)\b([a-z][a-z0-9+.-]*://)[^\s/@'\"]+@"), r"\1[REDACTED]@"),
]

_STD_ATTRS = set(vars(logging.makeLogRecord({})).keys()) | {"message", "asctime", "taskName", "color_message"}


def redact(text: str) -> str:
    for pattern, replacement in _REDACT_RES:
        text = pattern.sub(replacement, text)
    return text


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": redact(record.getMessage()),
        }
        for key, value in record.__dict__.items():
            if key not in _STD_ATTRS and not key.startswith("_"):
                payload[key] = redact(value) if isinstance(value, str) else value
        if record.exc_info:
            payload["exc"] = redact(self.formatException(record.exc_info))
        return json.dumps(payload, ensure_ascii=False, default=str)


def setup_logging(level: str) -> None:
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    # uvicorn's access log prints full query strings (which may carry ?token=): we log
    # requests ourselves without the query string, so keep the access logger silent.
    logging.getLogger("uvicorn.access").disabled = True
    for name in ("uvicorn", "uvicorn.error"):
        logger = logging.getLogger(name)
        logger.handlers[:] = []
        logger.propagate = True

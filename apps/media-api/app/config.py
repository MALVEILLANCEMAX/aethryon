"""Runtime configuration, read once from environment variables."""

from __future__ import annotations

import importlib.metadata
import ipaddress
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from .registre import registre
from .urls import detect_platform, is_youtube_music_host, refused_platform

# Domains open by default: those of the OFFICIAL platforms of the registry (app/plateformes.json), i.e. platforms
# tested for real with success. A beta platform is opened only by PLATEFORMES_BETA.
DEFAULT_ALLOWED_DOMAINS = ",".join(registre().domains("officielle"))
# socks5h: DNS resolved by the proxy (yt-dlp turns socks5 into socks5h anyway). https and socks4
# are refused: yt-dlp's ffmpeg downloader would bypass an https proxy silently, socks4 resolves
# names locally.
PROXY_SCHEMES = {"http", "socks5", "socks5h"}
# yt-dlp YouTube player clients asked for formats when no cookies are used (YT_CLIENTS): two clients
# whose https formats need no PO token, in preference order (see README "Robustesse YouTube").
DEFAULT_YT_CLIENTS = ("visionos", "web_embedded")

IpNetwork = ipaddress.IPv4Network | ipaddress.IPv6Network

_PERIODS = {"second": 1, "s": 1, "minute": 60, "min": 60, "m": 60, "hour": 3600, "h": 3600}


class ConfigError(ValueError):
    pass


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int, minimum: int = 0) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer, got {raw!r}") from exc
    if value < minimum:
        raise ConfigError(f"{name} must be >= {minimum}")
    return value


def _path(name: str, default: str | None) -> Path | None:
    raw = os.environ.get(name)
    raw = default if raw is None else raw.strip()
    return Path(raw) if raw else None


def parse_rate_limit(raw: str) -> tuple[int, int]:
    """Parse "20/minute" (or "20/min", "5/10s", "100/hour") into (count, seconds)."""
    match = re.fullmatch(r"\s*(\d+)\s*/\s*(\d*)\s*([a-z]+)\s*", raw.lower())
    if not match or match.group(3) not in _PERIODS:
        raise ConfigError(f"RATE_LIMIT must look like '20/minute', got {raw!r}")
    count = int(match.group(1))
    multiplier = int(match.group(2) or 1)
    if count < 1 or multiplier < 1:
        raise ConfigError("RATE_LIMIT values must be positive")
    return count, multiplier * _PERIODS[match.group(3)]


def parse_beta_platforms(raw: str) -> tuple[str, ...]:
    """PLATEFORMES_BETA="vimeo,dailymotion": beta platforms of the registry opened on this server (default: none)."""
    ids = tuple(dict.fromkeys(item.strip().lower() for item in raw.split(",") if item.strip()))
    reg = registre()
    for pid in ids:
        found = reg.get(pid)
        if found is None:
            raise ConfigError(f"PLATEFORMES_BETA: unknown platform {pid!r} (see app/plateformes.json)")
        if found.etat != "beta":
            raise ConfigError(f"PLATEFORMES_BETA: {pid} is {found.etat}, not beta: only beta platforms can be opened "
                              "this way (official ones are open by default, refused ones never)")
    return ids


def parse_domains(raw: str, beta: tuple[str, ...] = ()) -> tuple[str, ...]:
    domains = []
    for item in raw.split(","):
        domain = item.strip().lower().rstrip(".")
        if not domain:
            continue
        if not re.fullmatch(r"[a-z0-9-]+(\.[a-z0-9-]+)+", domain):
            raise ConfigError(f"ALLOWED_DOMAINS contains an invalid domain: {item!r}")
        domains.append(domain)
    if not domains:
        raise ConfigError("ALLOWED_DOMAINS is empty")
    closed = [d for d in domains if is_youtube_music_host(d)]
    if closed:
        raise ConfigError(f"ALLOWED_DOMAINS: {', '.join(closed)} (YouTube Music) is closed to the converter: "
                          "AETHRYON does not download the commercial music catalogue (owner's decision, 2026-10-23)")
    refused = [d for d in domains if refused_platform(d) is not None]
    if refused:
        raise ConfigError(f"ALLOWED_DOMAINS: {', '.join(refused)} belongs to a refused platform (paid streaming, music "
                          "catalogue, DRM or terms of use): it can never be opened")
    # Only domains of a platform of the registry (own yt-dlp extractor list): any other site can never be opened to
    # yt-dlp by configuration alone, and a beta platform only through PLATEFORMES_BETA.
    unknown = [d for d in domains if detect_platform(d) == "other"]
    if unknown:
        raise ConfigError(f"ALLOWED_DOMAINS: unsupported platform domain(s) {', '.join(unknown)} "
                          "(platforms of app/plateformes.json only; a new platform needs its registry entry)")
    reg = registre()
    closed_beta = [d for d in domains if (p := reg.get(detect_platform(d))) is not None
                   and p.etat in ("beta", "indisponible") and p.id not in beta]
    if closed_beta:
        raise ConfigError(f"ALLOWED_DOMAINS: {', '.join(closed_beta)} belongs to a beta or unavailable platform: a beta "
                          "platform is opened with PLATEFORMES_BETA only, an unavailable one not at all")
    for pid in beta:
        found = reg.get(pid)
        if found is not None:
            domains.extend(found.domaines)
    return tuple(dict.fromkeys(domains))


def enabled_platforms(allowed_domains: tuple[str, ...]) -> tuple[str, ...]:
    """Ids of the platforms the allowed domains open (registry order)."""
    ids = {detect_platform(d) for d in allowed_domains}
    return tuple(p.id for p in registre().plateformes if p.id in ids and p.telechargeable)


def parse_yt_clients(raw: str) -> tuple[str, ...]:
    """Parse YT_CLIENTS ("visionos,web_embedded"): yt-dlp player client names, in preference order.

    An empty value keeps yt-dlp's own default clients."""
    clients = []
    for item in raw.split(","):
        name = item.strip()
        if not name:
            continue
        if not re.fullmatch(r"[a-z0-9_]+", name):
            raise ConfigError(f"YT_CLIENTS contains an invalid client name: {name!r} (lowercase letters, digits, _)")
        clients.append(name)
    return tuple(dict.fromkeys(clients))


def parse_allow_from(raw: str) -> tuple[IpNetwork, ...]:
    """Parse INTERNAL_ALLOW_FROM ("10.251.20.0/24,10.251.10.0/24"): networks allowed to call /internal/v1.

    Strict CIDRs (no host bits set); a whole address family (/0) is refused. Empty = internal API off."""
    networks: list[IpNetwork] = []
    for item in raw.split(","):
        text = item.strip()
        if not text:
            continue
        try:
            network = ipaddress.ip_network(text, strict=True)
        except ValueError as exc:
            raise ConfigError(f"INTERNAL_ALLOW_FROM contains an invalid CIDR: {text!r} ({exc})") from exc
        if network.prefixlen == 0:
            raise ConfigError(f"INTERNAL_ALLOW_FROM must not allow every address: {text!r}")
        networks.append(network)
    return tuple(dict.fromkeys(networks))


def parse_proxy(raw: str) -> str | None:
    """Validate YT_PROXY (scheme://[user:pass@]host:port). Never echo the value: it may hold credentials."""
    raw = raw.strip()
    if not raw:
        return None
    if re.search(r"[\s\x00-\x1f]", raw):
        raise ConfigError("YT_PROXY must not contain spaces or control characters")
    try:
        parts = urlsplit(raw)
        port = parts.port
    except ValueError as exc:
        raise ConfigError("YT_PROXY is not a valid URL (scheme://host:port)") from exc
    scheme = parts.scheme.lower()
    if scheme not in PROXY_SCHEMES or not parts.hostname or not port:
        raise ConfigError("YT_PROXY must look like socks5h://host:port or http://host:port")
    if parts.path not in ("", "/") or parts.query or parts.fragment:
        raise ConfigError("YT_PROXY must not contain a path, query or fragment")
    if "+" in (parts.password or ""):
        raise ConfigError("YT_PROXY: percent-encode '+' in the password (%2B)")
    if scheme == "socks5":
        scheme = "socks5h"  # remote DNS, as yt-dlp does
    return f"{scheme}://{parts.netloc}"


@dataclass(frozen=True)
class Settings:
    api_token: str  # may be "" when a tokens file is used
    allowed_domains: tuple[str, ...]
    # Beta platforms of the registry opened on this server (PLATEFORMES_BETA; none by default).
    plateformes_beta: tuple[str, ...] = ()
    # Circuit breaker of the platforms other than YouTube (YouTube keeps its own, YT_COOLDOWN_*): after
    # PLATFORM_BREAKER_FAILURES consecutive failures of the platform itself (not of a given video), it is paused
    # PLATFORM_BREAKER_MIN minutes (doubled at each new failure after the pause, up to PLATFORM_BREAKER_MAX_MIN):
    # requests get 503 platform_unavailable + Retry-After at once. 0 failures = breaker off.
    platform_breaker_failures: int = 3
    platform_breaker_min: int = 10
    platform_breaker_max_min: int = 60
    max_concurrent: int = 2
    max_queue: int = 10
    max_duration_s: int = 3600
    max_filesize_mb: int = 1500
    download_timeout_s: int = 1800
    info_timeout_s: int = 90
    transcode_max_duration_s: int = 900
    gif_max_duration_s: int = 30
    job_ttl_min: int = 60
    tmp_dir: Path = Path("/data/tmp")
    cache_dir: Path | None = Path("/data/cache")
    cookies_file: Path | None = None
    tokens_file: Path | None = None
    rate_limit: tuple[int, int] = (20, 60)
    root_path: str = ""
    log_level: str = "INFO"
    debug: bool = False
    # YouTube protection (circuit breaker + limiter) and optional YouTube-only proxy.
    yt_cooldown_min: int = 15
    yt_cooldown_max_min: int = 60  # consecutive blocks double the pause up to this
    yt_concurrency: int = 1
    yt_min_interval_s: int = 3
    yt_proxy: str | None = None
    # yt-dlp YouTube player clients used without cookies (() = yt-dlp defaults).
    yt_clients: tuple[str, ...] = DEFAULT_YT_CLIENTS
    # Result cache.
    cache_ttl_min: int = 30
    max_cache_mb: int = 2000
    # Extra yt-dlp extractor args, e.g. for a PO token provider (see README).
    ytdlp_extractor_args: dict[str, dict[str, list[str]]] = field(default_factory=dict)
    # Per-user API keys (YouTube Converter 2.0), validated by the internal account service.
    # Off by default: with the flag off, the behaviour is exactly the one of the admin tokens only.
    user_keys_enabled: bool = False
    account_internal_url: str | None = None
    account_internal_token_file: Path | None = None
    user_key_prefix: str = "ytc_"
    # 0 = no cache: a revoked key is refused on the very next request (each request asks account).
    user_key_cache_s: float = 0.0
    account_timeout_s: float = 3.0
    # Jobs of user keys never use the owner's YouTube cookies unless explicitly allowed.
    user_jobs_use_cookies: bool = False
    # Internal admin API /internal/v1 (Control Center, through account): source networks allowed.
    # Empty = API absent. Also requires USER_KEYS_ENABLED (same shared internal token as account).
    internal_allow_from: tuple[IpNetwork, ...] = ()
    # Media tools (Discord bot v2, docs/API-OUTILS.md): POST /preview, clips (start_s/end_s) and derived
    # jobs (POST /jobs/{id}/derive: compression, GIF). Off by default: routes absent, clip parameters refused.
    media_tools_enabled: bool = False
    # AETHRYON Tools (docs/OUTILS.md), on top of the media tools: imported files (chunked uploads), edits
    # (derive ops video/audio/apercu/echantillon, crop/rotation/speed...), storyboard and waveform of a finished
    # file, retention extended while an editor is open. Off by default: routes absent, new derive ops refused.
    tools_enabled: bool = False
    max_upload_mb: int = 1024
    upload_chunk_mb: int = 5  # one PUT per chunk: each request stays short (Traefik v3 reads a request in <= 60 s)
    upload_idle_min: int = 30  # an import without a new chunk for this long is abandoned (unit given back)
    tools_keep_min: int = 120  # an open editor keeps its files this long after the last action...
    tools_keep_max_min: int = 360  # ...but never longer than this after the import or the conversion
    max_derived_per_source: int = 6
    # Clips (startMs/endMs or start_s/end_s, MEDIA_TOOLS_ENABLED): only the requested range is fetched (app/extraits.py).
    # Limits of the server, exposed by GET /limites: longest clip (GIF: GIF_MAX_DURATION_S), largest output file, most
    # bytes received from the platform for one clip, longest processing, clips processed at once. The length of the
    # source does not matter (MAX_DURATION_S only bounds full downloads).
    extrait_duree_max_s: int = 600
    extrait_sortie_max_mb: int = 1024
    extrait_telechargement_max_mb: int = 1024
    extrait_traitement_max_s: int = 1800
    extrait_simultanes_max: int = 1
    # AETHRYON Cloud V1 (account, CLOUD=on) : after a successful download of a user job, account is asked whether to
    # back the file up (administrator, cloud on, quota); ytapi then PUTs it to the storage through a presigned URL
    # (ytapi holds NO storage key). Never blocks or fails the delivery of the file. Off by default.
    cloud_sync: bool = False
    cloud_sync_allow_http: bool = False  # http presigned URLs (local test storage only)
    cloud_hold_max_min: int = 120  # a job's files are kept at most this long past the TTL while their upload runs
    # AETHRYON Music (app/music, MUSIC_ENABLED, off by default): links of music services recognised and described by
    # their OFFICIAL APIs, imports ONLY from sources that explicitly allow the download (free licence or public domain
    # on Internet Archive / Wikimedia Commons, podcast enclosures, direct files whose rights the user declares). Never
    # yt-dlp, never a commercial catalogue (Spotify, Apple Music, SoundCloud, Deezer, YouTube Music): see app/music.
    music_enabled: bool = False
    music_max_concurrent: int = 2  # imports downloading at once (the rest waits in the queue)
    music_max_queue: int = 10  # imports waiting or running, all users
    music_max_active_per_user: int = 2
    music_max_file_mb: int = 500
    music_max_duration_s: int = 10800  # 3 h (long podcast episodes)
    music_disk_max_mb: int = 2048  # temporary disk of all imports (reserved before each download)
    music_download_timeout_s: int = 900
    music_job_ttl_min: int = 60  # an imported file stays downloadable this long (longer while its cloud upload runs)
    # Spotify Web API (owner's free developer app; Spotify requires the app owner to have Premium, see MUSIC-RAPPORT.md):
    # client credentials for tracks/albums/artists; refresh token of the owner's account for the items of HIS playlists.
    music_spotify_client_id_file: Path | None = None
    music_spotify_client_secret_file: Path | None = None
    music_spotify_refresh_token_file: Path | None = None
    music_apple_previews: bool = True  # iTunes 30 s previews, streamed by the client from Apple, never stored
    music_deezer_api: bool = False  # Deezer API terms: non-commercial use only -> off (links + official widget only)
    music_direct_files: bool = True  # direct audio links, with the user's declaration of rights
    music_allow_local_sources: bool = False  # TESTS ONLY: http and private addresses for sources
    music_user_agent: str = "AETHRYON-Music/1.0 (+https://raccourci.malvu.fr)"

    @property
    def extrait_sortie_max_bytes(self) -> int:
        return self.extrait_sortie_max_mb * 1024 * 1024

    @property
    def extrait_telechargement_max_bytes(self) -> int:
        return self.extrait_telechargement_max_mb * 1024 * 1024

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def upload_chunk_bytes(self) -> int:
        return self.upload_chunk_mb * 1024 * 1024

    @property
    def max_filesize_bytes(self) -> int:
        return self.max_filesize_mb * 1024 * 1024

    @property
    def music_max_file_bytes(self) -> int:
        return self.music_max_file_mb * 1024 * 1024

    @property
    def music_disk_max_bytes(self) -> int:
        return self.music_disk_max_mb * 1024 * 1024

    @property
    def max_cache_bytes(self) -> int:
        return self.max_cache_mb * 1024 * 1024


def parse_extractor_args(raw: str) -> dict[str, dict[str, list[str]]]:
    """Parse 'ie:key=v1,v2;key2=v' entries separated by '|' (same syntax as yt-dlp --extractor-args)."""
    result: dict[str, dict[str, list[str]]] = {}
    for chunk in filter(None, (c.strip() for c in raw.split("|"))):
        ie, _, args = chunk.partition(":")
        if not ie or not args:
            raise ConfigError(f"YTDLP_EXTRACTOR_ARGS entry must be 'ie:key=value', got {chunk!r}")
        for pair in filter(None, (p.strip() for p in args.split(";"))):
            key, sep, value = pair.partition("=")
            if not sep:
                raise ConfigError(f"YTDLP_EXTRACTOR_ARGS pair must be key=value, got {pair!r}")
            result.setdefault(ie.strip().lower(), {})[key.strip()] = [v.strip() for v in value.split(",")]
    return result


def pot_plugin_installed() -> bool:
    try:
        importlib.metadata.distribution("bgutil-ytdlp-pot-provider")
    except importlib.metadata.PackageNotFoundError:
        return False
    return True


def apply_pot_policy(args: dict[str, dict[str, list[str]]], plugin_installed: bool) -> dict[str, dict[str, list[str]]]:
    """Image built with WITH_POT=1 but no bgutil server configured: tell yt-dlp not to ask the
    plugin for PO tokens (it would try its default 127.0.0.1:4416 on every YouTube request)."""
    if plugin_installed and "youtubepot-bgutilhttp" not in args:
        args.setdefault("youtube", {}).setdefault("fetch_pot", ["never"])
    return args


def load_settings() -> Settings:
    token = os.environ.get("API_TOKEN", "").strip()
    tokens_file = _path("TOKENS_FILE", None)
    if token and len(token) < 24:
        raise ConfigError("API_TOKEN is too short (min 24 chars). Generate one with: openssl rand -hex 32")
    if not token and not (tokens_file and tokens_file.exists()):
        raise ConfigError("No token configured: set API_TOKEN or create the tokens file (make rotate-token LABEL=...)")

    root_path = os.environ.get("ROOT_PATH", "").strip().rstrip("/")
    if root_path and not root_path.startswith("/"):
        raise ConfigError("ROOT_PATH must start with '/' (e.g. /media)")

    user_keys_enabled = _bool("USER_KEYS_ENABLED", False)
    user_key_prefix = os.environ.get("USER_KEY_PREFIX", "ytc_").strip() or "ytc_"
    account_url = os.environ.get("ACCOUNT_INTERNAL_URL", "").strip().rstrip("/") or None
    account_token_file = _path("ACCOUNT_INTERNAL_TOKEN_FILE", None)
    if user_keys_enabled:
        if not account_url or urlsplit(account_url).scheme not in {"http", "https"}:
            raise ConfigError("USER_KEYS_ENABLED=true requires ACCOUNT_INTERNAL_URL (http://host:port)")
        if not account_token_file or not account_token_file.is_file():
            raise ConfigError("USER_KEYS_ENABLED=true requires ACCOUNT_INTERNAL_TOKEN_FILE (an existing file)")
        if token.startswith(user_key_prefix):
            raise ConfigError(f"API_TOKEN must not start with the user key prefix {user_key_prefix!r}")

    media_tools_enabled = _bool("MEDIA_TOOLS_ENABLED", False)
    tools_enabled = _bool("TOOLS_ENABLED", False)
    if tools_enabled and not media_tools_enabled:
        raise ConfigError("TOOLS_ENABLED=true requires MEDIA_TOOLS_ENABLED=true (derived files)")
    if tools_enabled and not user_keys_enabled:
        raise ConfigError("TOOLS_ENABLED=true requires USER_KEYS_ENABLED=true (imports belong to an account)")

    if _bool("MUSIC_ALLOW_LOCAL_SOURCES", False) and not _bool("DEBUG", False):
        raise ConfigError("MUSIC_ALLOW_LOCAL_SOURCES=true is for tests only (it allows http and private addresses): "
                          "it needs DEBUG=true and must never be set in production")
    cloud_sync = _bool("CLOUD_SYNC", False)
    if cloud_sync and not user_keys_enabled:
        raise ConfigError("CLOUD_SYNC=true requires USER_KEYS_ENABLED=true (account decides who may use the cloud)")

    log_level = os.environ.get("LOG_LEVEL", "INFO").strip().upper()
    if log_level not in {"DEBUG", "INFO", "WARNING", "ERROR"}:
        raise ConfigError("LOG_LEVEL must be DEBUG, INFO, WARNING or ERROR")

    beta = parse_beta_platforms(os.environ.get("PLATEFORMES_BETA", ""))
    return Settings(
        api_token=token,
        allowed_domains=parse_domains(os.environ.get("ALLOWED_DOMAINS", DEFAULT_ALLOWED_DOMAINS), beta),
        plateformes_beta=beta,
        platform_breaker_failures=_int("PLATFORM_BREAKER_FAILURES", 3, minimum=0),
        platform_breaker_min=_int("PLATFORM_BREAKER_MIN", 10, minimum=1),
        platform_breaker_max_min=_int("PLATFORM_BREAKER_MAX_MIN", 60, minimum=1),
        max_concurrent=_int("MAX_CONCURRENT", 2, minimum=1),
        max_queue=_int("MAX_QUEUE", 10, minimum=1),
        max_duration_s=_int("MAX_DURATION_S", 3600, minimum=1),
        max_filesize_mb=_int("MAX_FILESIZE_MB", 1500, minimum=1),
        download_timeout_s=_int("DOWNLOAD_TIMEOUT_S", 1800, minimum=10),
        info_timeout_s=_int("INFO_TIMEOUT_S", 90, minimum=5),
        transcode_max_duration_s=_int("TRANSCODE_MAX_DURATION_S", 900, minimum=1),
        gif_max_duration_s=_int("GIF_MAX_DURATION_S", 30, minimum=1),
        job_ttl_min=_int("JOB_TTL_MIN", 60, minimum=1),
        tmp_dir=_path("TMP_DIR", "/data/tmp") or Path("/data/tmp"),
        cache_dir=_path("CACHE_DIR", "/data/cache"),
        cookies_file=_path("COOKIES_FILE", None),
        tokens_file=tokens_file,
        rate_limit=parse_rate_limit(os.environ.get("RATE_LIMIT", "20/minute")),
        root_path=root_path,
        log_level=log_level,
        debug=_bool("DEBUG", False),
        yt_cooldown_min=_int("YT_COOLDOWN_MIN", 15, minimum=0),
        yt_cooldown_max_min=_int("YT_COOLDOWN_MAX_MIN", 60, minimum=0),
        yt_concurrency=_int("YT_CONCURRENCY", 1, minimum=1),
        yt_min_interval_s=_int("YT_MIN_INTERVAL_S", 3, minimum=0),
        yt_proxy=parse_proxy(os.environ.get("YT_PROXY", "")),
        yt_clients=parse_yt_clients(os.environ.get("YT_CLIENTS", ",".join(DEFAULT_YT_CLIENTS))),
        cache_ttl_min=_int("CACHE_TTL_MIN", 30, minimum=0),
        max_cache_mb=_int("MAX_CACHE_MB", 2000, minimum=0),
        ytdlp_extractor_args=apply_pot_policy(parse_extractor_args(os.environ.get("YTDLP_EXTRACTOR_ARGS", "")),
                                              pot_plugin_installed()),
        user_keys_enabled=user_keys_enabled,
        account_internal_url=account_url,
        account_internal_token_file=account_token_file,
        user_key_prefix=user_key_prefix,
        user_key_cache_s=float(_int("USER_KEY_CACHE_S", 0, minimum=0)),
        account_timeout_s=float(_int("ACCOUNT_TIMEOUT_S", 3, minimum=1)),
        user_jobs_use_cookies=_bool("USER_JOBS_USE_COOKIES", False),
        internal_allow_from=parse_allow_from(os.environ.get("INTERNAL_ALLOW_FROM", "")),
        media_tools_enabled=media_tools_enabled,
        tools_enabled=tools_enabled,
        max_upload_mb=_int("MAX_UPLOAD_MB", 1024, minimum=1),
        upload_chunk_mb=_int("UPLOAD_CHUNK_MB", 5, minimum=1),
        upload_idle_min=_int("UPLOAD_IDLE_MIN", 30, minimum=1),
        tools_keep_min=_int("TOOLS_KEEP_MIN", 120, minimum=1),
        tools_keep_max_min=_int("TOOLS_KEEP_MAX_MIN", 360, minimum=1),
        max_derived_per_source=_int("MAX_DERIVED_PER_SOURCE", 6, minimum=1),
        extrait_duree_max_s=_int("EXTRAIT_DUREE_MAX_S", 600, minimum=1),
        extrait_sortie_max_mb=_int("EXTRAIT_SORTIE_MAX_MB", 1024, minimum=1),
        extrait_telechargement_max_mb=_int("EXTRAIT_TELECHARGEMENT_MAX_MB", 1024, minimum=1),
        extrait_traitement_max_s=_int("EXTRAIT_TRAITEMENT_MAX_S", 1800, minimum=30),
        extrait_simultanes_max=_int("EXTRAIT_SIMULTANES_MAX", 1, minimum=1),
        cloud_sync=cloud_sync,
        cloud_sync_allow_http=_bool("CLOUD_SYNC_ALLOW_HTTP", False),
        cloud_hold_max_min=_int("CLOUD_HOLD_MAX_MIN", 120, minimum=1),
        music_enabled=_bool("MUSIC_ENABLED", False),
        music_max_concurrent=_int("MUSIC_MAX_CONCURRENT", 2, minimum=1),
        music_max_queue=_int("MUSIC_MAX_QUEUE", 10, minimum=1),
        music_max_active_per_user=_int("MUSIC_MAX_ACTIVE_PER_USER", 2, minimum=1),
        music_max_file_mb=_int("MUSIC_MAX_FILE_MB", 500, minimum=1),
        music_max_duration_s=_int("MUSIC_MAX_DURATION_S", 10800, minimum=1),
        music_disk_max_mb=_int("MUSIC_DISK_MAX_MB", 2048, minimum=1),
        music_download_timeout_s=_int("MUSIC_DOWNLOAD_TIMEOUT_S", 900, minimum=10),
        music_job_ttl_min=_int("MUSIC_JOB_TTL_MIN", 60, minimum=1),
        music_spotify_client_id_file=_path("MUSIC_SPOTIFY_CLIENT_ID_FILE", None),
        music_spotify_client_secret_file=_path("MUSIC_SPOTIFY_CLIENT_SECRET_FILE", None),
        music_spotify_refresh_token_file=_path("MUSIC_SPOTIFY_REFRESH_TOKEN_FILE", None),
        music_apple_previews=_bool("MUSIC_APPLE_PREVIEWS", True),
        music_deezer_api=_bool("MUSIC_DEEZER_API", False),
        music_direct_files=_bool("MUSIC_DIRECT_FILES", True),
        music_allow_local_sources=_bool("MUSIC_ALLOW_LOCAL_SOURCES", False),
    )

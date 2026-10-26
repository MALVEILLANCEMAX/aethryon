"""Strict URL validation (allowlist) and platform detection.

Rules: http/https only, no credentials, no IP literal or localhost, default ports only,
hostname must equal an allowed domain or be a subdomain of it (label boundary), checked on
the parsed hostname (never with a prefix regex or a substring test).
"""

from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass
from functools import lru_cache
from urllib.parse import parse_qs, unquote, urlsplit, urlunsplit

from .errors import USER_TEXT, ApiError
from .registre import Plateforme, registre

MAX_URL_LENGTH = 2048

# Known platforms: domain -> platform id, derived from the single registry (app/plateformes.json): every platform that
# may run yt-dlp (officielle / beta) or that is known but switched off (indisponible). Refused platforms (DRM, paid
# streaming, music catalogues) are not here: they never map to a platform of the converter.
PLATFORM_DOMAINS: dict[str, str] = {
    d: p.id for p in registre().plateformes if p.etat != "refusee" for d in p.domaines
}
# The three platforms with their own hand-written URL rules; every other one is checked against the URL patterns of
# its own allowed yt-dlp extractors (never duplicated here, no network).
_CUSTOM_RULES = ("youtube", "tiktok", "twitter")
PLATFORM_NOT_ACCEPTED_CODE = "platform_not_accepted"
PLATFORM_UNAVAILABLE_CODE = "platform_unavailable"

# YouTube Music (catalogue musical commercial) est FERMÉ au convertisseur (décision du propriétaire, 2026-10-23) :
# music.youtube.com et ses sous-domaines, quelle que soit la façon d'écrire le lien (casse, point final, port,
# identifiants, sans schéma). Le refus est décidé avant tout autre contrôle et avant tout travail (aucun worker,
# aucune unité de quota, aucune requête réseau). Les liens YouTube classiques (youtube.com, m.youtube.com, youtu.be,
# Shorts) ne changent pas.
YOUTUBE_MUSIC_CODE = "youtube_music_not_accepted"
YOUTUBE_MUSIC_DOMAINS: tuple[str, ...] = (
    "music.youtube.com", "music.youtu.be", "music.youtube-nocookie.com", "youtubemusic.com",
)

_HOST_RE = re.compile(r"[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+")
_FORBIDDEN_CHARS_RE = re.compile(r"[\x00-\x20\x7f\\]")


@dataclass(frozen=True)
class MediaUrl:
    url: str
    host: str
    platform: str  # registry id (youtube | tiktok | twitter | vimeo...) | other
    media_index: int | None = None  # X: N from a .../status/ID/video/N link


def _invalid(detail: str) -> ApiError:
    return ApiError(400, "invalid_url", detail)


def host_matches(host: str, domain: str) -> bool:
    """True if host is exactly `domain` or a subdomain of it (label boundary)."""
    return host == domain or host.endswith("." + domain)


def is_youtube_music_host(host: str) -> bool:
    """True for music.youtube.com (and the other YouTube Music names) and their sub-domains, whatever the case or
    the trailing dot. Label boundary: notmusic.youtube.com is not YouTube Music."""
    bare = host.strip().lower().rstrip(".")
    return bool(bare) and any(host_matches(bare, domain) for domain in YOUTUBE_MUSIC_DOMAINS)


def _hostname_of(text: str) -> str:
    """Hostname of a link written with or without scheme (``https://x/``, ``//x/``, ``x/path``); never raises."""
    for attempt in (text, "https://" + text.lstrip("/")):
        try:
            host = urlsplit(attempt).hostname
        except ValueError:
            continue
        if host:
            return host
    return ""


def is_youtube_music_url(raw: str) -> bool:
    """True when the link names a YouTube Music host, in any written form (host only, no network)."""
    return is_youtube_music_host(_hostname_of(raw.strip()))


def youtube_music_error() -> ApiError:
    """The stable refusal of YouTube Music links (text shared with docs/ERREURS.md through USER_TEXT)."""
    return ApiError(400, YOUTUBE_MUSIC_CODE, USER_TEXT[YOUTUBE_MUSIC_CODE])


# A target written inside a redirect link (youtube.com/redirect?q=https%3A%2F%2Fmusic.youtube.com%2F…).
_URL_IN_TEXT_RE = re.compile(r"(?:[a-z][a-z0-9+.-]*:)?//([^/?#\s\\]+)", re.I)


def _carries_youtube_music_link(query: str) -> bool:
    """A query value that is, or contains, a YouTube Music link (percent-encoded up to three times). Used only to
    word the refusal of redirect pages that would be refused anyway: no link is ever followed."""
    for values in parse_qs(query).values():
        for value in values:
            text = value
            for _ in range(3):
                if is_youtube_music_url(text) or any(
                        is_youtube_music_host(_hostname_of("//" + target)) for target in _URL_IN_TEXT_RE.findall(text)):
                    return True
                decoded = unquote(text)
                if decoded == text:
                    break
                text = decoded
    return False


def detect_platform(host: str) -> str:
    """Platform id of a host (registry, longest domain wins), or "other" for unknown and refused hosts."""
    if is_youtube_music_host(host):
        return "other"  # not a platform of the converter: fails closed everywhere (config, worker)
    found = registre().for_host(host)
    return found.id if found is not None and found.etat != "refusee" else "other"


def refused_platform(host: str) -> Plateforme | None:
    """The refused platform (etat refusee) a host belongs to, if any (host only, no network)."""
    found = registre().for_host(host)
    return found if found is not None and found.etat == "refusee" else None


def platform_not_accepted_error(platform: Plateforme) -> ApiError:
    """Stable refusal of a platform AETHRYON never downloads from (text shared with docs/ERREURS.md)."""
    if platform.code == YOUTUBE_MUSIC_CODE:
        return youtube_music_error()
    return ApiError(400, PLATFORM_NOT_ACCEPTED_CODE, USER_TEXT[PLATFORM_NOT_ACCEPTED_CODE])


def platform_unavailable_error(name: str, retry_after_s: int | None = None) -> ApiError:
    headers = {"Retry-After": str(retry_after_s)} if retry_after_s else {}
    return ApiError(503, PLATFORM_UNAVAILABLE_CODE, f"{name} est temporairement indisponible. Réessaie plus tard.",
                    headers)


def allowed_platform_names(allowed_domains: tuple[str, ...]) -> list[str]:
    """Names of the platforms opened by the allowed domains, in registry order (for messages)."""
    ids = {detect_platform(d) for d in allowed_domains}
    return [p.nom for p in registre().plateformes if p.id in ids]


def validate_media_url(raw: str | None, allowed_domains: tuple[str, ...]) -> MediaUrl:
    if raw is None or not raw.strip():
        raise _invalid("Paramètre « url » manquant.")
    candidate = raw.strip()
    if len(candidate) > MAX_URL_LENGTH:
        raise _invalid(f"URL trop longue (max {MAX_URL_LENGTH} caractères).")
    if _FORBIDDEN_CHARS_RE.search(candidate):
        raise _invalid("L'URL contient des espaces, des caractères de contrôle ou des antislashs.")
    if is_youtube_music_url(candidate):
        raise youtube_music_error()

    try:
        parts = urlsplit(candidate)
        port = parts.port  # raises ValueError on a non-numeric / out-of-range port
    except ValueError as exc:
        raise _invalid("URL illisible.") from exc

    scheme = parts.scheme.lower()
    if scheme not in {"http", "https"}:
        raise _invalid("Seules les URL http et https sont acceptées.")
    if not parts.netloc:
        raise _invalid("URL sans nom de domaine.")
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        raise _invalid("Les identifiants dans l'URL ne sont pas acceptés.")
    if port is not None and port not in {80, 443}:
        raise _invalid("Seuls les ports par défaut (80/443) sont acceptés.")

    host = (parts.hostname or "").lower()
    if not host:
        raise _invalid("URL sans nom de domaine.")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise _invalid("Les adresses IP ne sont pas acceptées : utilisez le domaine de la plateforme.")
    if host == "localhost" or host.endswith(".localhost"):
        raise _invalid("localhost n'est pas accepté.")
    if not _HOST_RE.fullmatch(host) or all(label.isdigit() for label in host.split(".")):
        raise _invalid("Nom de domaine invalide.")

    refused = refused_platform(host)
    if refused is not None:
        raise platform_not_accepted_error(refused)
    known = registre().get(detect_platform(host))
    if known is not None and known.etat == "indisponible":
        raise platform_unavailable_error(known.nom)
    if not any(host_matches(host, domain) for domain in allowed_domains):
        if known is not None and known.etat == "beta":
            raise ApiError(400, "domain_not_allowed",
                           f"{known.nom} n'est pas encore prise en charge : plateforme en essai, pas encore ouverte.")
        names = ", ".join(allowed_platform_names(allowed_domains)) or "aucune plateforme"
        raise ApiError(400, "domain_not_allowed", f"Le domaine {host} n'est pas autorisé ({names} uniquement).")

    netloc = host if port is None else f"{host}:{port}"
    normalized = urlunsplit((scheme, netloc, parts.path or "/", parts.query, ""))
    platform = detect_platform(host)
    media_index = None
    if platform == "tiktok":
        normalized, host = _normalize_tiktok(scheme, host, parts.path or "/")
    elif platform == "youtube":
        _reject_youtube_collections(host, parts.path or "/", parts.query)
    elif platform == "twitter":
        match = _TWITTER_MEDIA_RE.search(parts.path or "")
        if match:
            media_index = int(match.group(2)) or None
            normalized = urlunsplit((scheme, netloc, parts.path[: match.start()], "", ""))
    elif platform not in _CUSTOM_RULES:
        check_extractor_shape(platform, normalized)
    return MediaUrl(url=normalized, host=host, platform=platform, media_index=media_index)


# Paths that are channels, playlists, feeds or searches, never a single video. Rejected
# before yt-dlp runs: extracting them would hit YouTube once per listed page or video.
# Every keyword is anchored ((?:/|$)) so that video ids such as youtu.be/feedBACK123 pass.
_YOUTUBE_COLLECTION_RE = re.compile(
    r"/(?:(?:playlist|feed|results|podcasts|gaming|premium|hashtag|browse|channel|c|user|source|search)(?:/|$)"
    r"|@[^/]+|shorts/?$|embed/videoseries(?:/|$)|$)",
    re.I,
)
_TWITTER_MEDIA_RE = re.compile(r"/(video|photo)/(\d{1,3})/?$")


# Single-video path shapes accepted without a v= parameter (allowlist: anything else would be
# routed by yt-dlp to the channel/playlist extractor, which fetches a page before we can refuse).
_YOUTUBE_VIDEO_PATH_RE = re.compile(r"/(?:shorts|live|embed|v|e|clip)/[A-Za-z0-9_-]+/?", re.I)


def _reject_youtube_collections(host: str, path: str, query: str) -> None:
    try:
        _check_youtube_shape(host, path, query)
    except ApiError:
        if _carries_youtube_music_link(query):
            raise youtube_music_error() from None  # youtube.com/redirect?q=<lien YouTube Music> and alike
        raise


def _check_youtube_shape(host: str, path: str, query: str) -> None:
    params = parse_qs(query)
    lowered = path.lower()
    if host == "youtu.be":
        # youtu.be/<id> is always a single video (a list= next to it names the video's playlist).
        if path.strip("/"):
            return
        raise _playlist_error()
    if lowered.startswith("/embed/videoseries"):
        raise _playlist_error()
    if "v" in params:
        return  # watch?v=...&list=... is a single video (noplaylist); yt-dlp maps any page + v= to it
    if lowered.rstrip("/") == "/watch":
        if "list" in params:
            raise _playlist_error()
        raise ApiError(400, "invalid_url", "Lien YouTube sans identifiant de vidéo (paramètre v=).")
    if _YOUTUBE_VIDEO_PATH_RE.fullmatch(path):
        return
    if _YOUTUBE_COLLECTION_RE.match(path) or path.rstrip("/").count("/") <= 1:
        raise _playlist_error()  # channels (/@name, /SomeName), playlists, feeds, searches
    raise ApiError(400, "unsupported_url",
                   "Ce type de lien YouTube n'est pas pris en charge : envoyez le lien d'une vidéo "
                   "(youtube.com/watch?v=…, youtu.be/…, /shorts/…).")


def _playlist_error() -> ApiError:
    return ApiError(400, "playlist_not_supported",
                    "Les playlists, chaînes et recherches ne sont pas prises en charge : envoyez le lien d'une vidéo.")


_YOUTUBE_ID_RE = re.compile(r"[A-Za-z0-9_-]{11}")
_YOUTUBE_PATH_ID_RE = re.compile(r"/(?:shorts|embed|live|v|e)/([A-Za-z0-9_-]{11})/?")
_CANONICAL_ID_RE = {"youtube": _YOUTUBE_ID_RE, "tiktok": re.compile(r"\d+")}


def media_key(media: MediaUrl) -> str:
    """Canonical media identity for the result cache and job merging (share links carry random
    ?si= etc.). Only unambiguous URL shapes get a canonical id; anything else (several id
    candidates, ';' separators...) falls back to the exact URL, which is always safe."""
    parts = urlsplit(media.url)
    if media.platform == "youtube" and ";" not in parts.query:
        params = parse_qs(parts.query)
        if media.host == "youtu.be":
            candidate = parts.path.strip("/").split("/")[0]
            if _YOUTUBE_ID_RE.fullmatch(candidate):
                return f"youtube:{candidate}"
        elif parts.path.rstrip("/") == "/watch":
            video = params.get("v", [""])[0]
            if _YOUTUBE_ID_RE.fullmatch(video):
                return f"youtube:{video}"
        elif "v" not in params:
            match = _YOUTUBE_PATH_ID_RE.fullmatch(parts.path)
            if match:
                return f"youtube:{match.group(1)}"
    elif media.platform == "tiktok":
        match = re.fullmatch(r"/@[^/]*/video/(\d+)/?", parts.path)
        if match:
            return f"tiktok:{match.group(1)}"
    elif media.platform == "twitter":
        match = re.search(r"/status(?:es)?/(\d+)", parts.path)
        if match:
            return f"twitter:{match.group(1)}"
    return f"{media.platform}:{media.host}{parts.path}?{parts.query}"


def result_matches_media(media: MediaUrl, result: dict[str, object]) -> bool:
    """Defence in depth for the cache: store a result under a canonical YouTube/TikTok id only if
    yt-dlp really downloaded that id (a crafted URL could name one id and lead to another)."""
    platform, _, ident = media_key(media).partition(":")
    id_re = _CANONICAL_ID_RE.get(platform)
    if id_re is None or not id_re.fullmatch(ident):
        return True  # exact-URL key, or X (the status id in the URL is the one yt-dlp uses)
    return str(result.get("id") or "") == ident


# TikTok shapes, matched on the full path (case-insensitive, optional trailing slash). Only single
# videos and short links reach yt-dlp: a profile, a hashtag or a sound would be extracted as a list.
_TIKTOK_VIDEO_RE = re.compile(r"/@([\w.-]*)/video/(\d+)/?", re.I)
# Embeds, players and legacy share pages: yt-dlp's TikTokIE accepts /@/video/<id> (empty user).
_TIKTOK_ALIAS_RE = re.compile(r"/(?:embed(?:/v2)?|player/v1|share/video)/(\d+)/?|/v/(\d+)\.html", re.I)
_TIKTOK_SHORT_HOSTS = {"vm.tiktok.com", "vt.tiktok.com"}
_TIKTOK_SHORT_CODE_RE = re.compile(r"/\w+/?")  # vm./vt.tiktok.com/<code>/ (yt-dlp TikTokVMIE)
_TIKTOK_T_RE = re.compile(r"/t/(\w+/?)", re.I)  # www.tiktok.com/t/<code>/ (same extractor)
_TIKTOK_LIVE_RE = re.compile(r"/(?:@[^/]+/)?live(?:/.*)?|/share/live/.*", re.I)
_TIKTOK_LIST_RE = re.compile(
    r"/@[^/]+/?|/@[^/]+/(?:collection|playlist)(?:/.*)?|/(?:tag|hashtag|music|sound|sticker|effect)(?:/.*)?", re.I)


def _normalize_tiktok(scheme: str, host: str, path: str) -> tuple[str, str]:
    """Allowlist of TikTok link shapes, rewritten for yt-dlp (whose TikTokIE only matches
    www.tiktok.com); share query strings are noise. Anything else is refused before any worker."""
    if "/photo/" in path:
        raise ApiError(400, "unsupported_content", "Les diaporamas photo TikTok ne sont pas pris en charge (vidéos uniquement).")
    if host in _TIKTOK_SHORT_HOSTS:
        if _TIKTOK_SHORT_CODE_RE.fullmatch(path):
            return urlunsplit(("https", host, path, "", "")), host
        raise _tiktok_unsupported()
    host = "www.tiktok.com"
    if video := _TIKTOK_VIDEO_RE.fullmatch(path):
        path = f"/@{video.group(1)}/video/{video.group(2)}"
    elif alias := _TIKTOK_ALIAS_RE.fullmatch(path):
        path = f"/@/video/{alias.group(1) or alias.group(2)}"
    elif short := _TIKTOK_T_RE.fullmatch(path):
        path = f"/t/{short.group(1)}"  # yt-dlp only knows www.tiktok.com/t/ (lowercase)
    else:
        if _TIKTOK_LIVE_RE.fullmatch(path):
            raise ApiError(400, "live_not_supported", "Les directs TikTok ne sont pas pris en charge.")
        if _TIKTOK_LIST_RE.fullmatch(path):
            raise ApiError(400, "playlist_not_supported",
                           "Les profils, collections, hashtags et sons TikTok ne sont pas pris en charge : "
                           "envoyez le lien d'une vidéo.")
        raise _tiktok_unsupported()
    return urlunsplit(("https", host, path, "", "")), host


def _tiktok_unsupported() -> ApiError:
    return ApiError(400, "unsupported_url",
                    "Ce type de lien TikTok n'est pas pris en charge : envoyez le lien d'une vidéo "
                    "(tiktok.com/@…/video/…, vm.tiktok.com/…, vt.tiktok.com/…).")


# --- other platforms: the URL patterns of their own allowed extractors (yt-dlp, no network) ---------------------


@lru_cache(maxsize=64)
def _extractor_classes(platform: str) -> tuple[type, ...]:
    """yt-dlp extractor classes allowed for `platform` (same full-match rule as yt-dlp's allowed_extractors)."""
    from yt_dlp.extractor import gen_extractor_classes  # heavy import, only when a new platform is used

    patterns = registre().extractors(avec_indisponibles=True).get(platform) or []
    return tuple(ie for ie in gen_extractor_classes()
                 if any(re.fullmatch(p, ie.IE_NAME.lower()) for p in patterns))


def check_extractor_shape(platform: str, url: str) -> None:
    """Refuse a link that none of the platform's allowed extractors recognises (a profile, a channel, a list...)
    BEFORE any worker: the allowed extractors are single-media ones, so the shape check is theirs, never a copy."""
    found = registre().get(platform)
    name = found.nom if found else platform
    if not any(ie.suitable(url) for ie in _extractor_classes(platform)):
        raise ApiError(400, "unsupported_url",
                       f"Ce type de lien {name} n'est pas pris en charge : envoyez le lien d'une seule vidéo "
                       "(pas un profil, une chaîne ou une liste).")


def check_platform_format(platform: str, fmt: str, clip: bool = False) -> None:
    """Formats the registry permits for the platform (e.g. no MP3 from Imgur, whose clips are mostly silent)."""
    found = registre().get(platform)
    if found is None or not found.formats:
        return
    if fmt not in found.formats or (clip and "extrait" not in found.formats):
        wanted = "un extrait" if clip and "extrait" not in found.formats else f"le format {fmt.upper()}"
        raise ApiError(422, "format_unavailable", f"{found.nom} : {wanted} n'est pas proposé pour cette plateforme.")

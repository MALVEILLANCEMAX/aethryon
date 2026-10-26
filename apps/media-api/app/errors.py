"""Uniform JSON errors {"error": code, "detail": message} and yt-dlp error mapping.

`error` codes are stable identifiers (English); `detail` is a short French sentence meant to be
shown as-is in an iPhone alert. Admin tokens get the technical detail; personal keys (ytc_) get
the fixed text of USER_TEXT for the codes of docs/ERREURS.md.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("ytapi.errors")

COOKIES_HINT = "Des cookies d'un compte jetable (make cookies-install) règlent souvent le problème."

# Text shown to personal keys (iPhone) and in the usage history of the account site: copied
# character for character from docs/ERREURS.md, which is the reference (same codes, same texts as
# account/src/usage.ts ERROR_TEXT). A code missing here keeps its technical detail in API answers.
USER_TEXT: dict[str, str] = {
    "not_found": "Vidéo supprimée ou inaccessible : la plateforme ne la trouve pas (lien erroné ou vidéo retirée).",
    "unavailable": "Vidéo supprimée ou inaccessible depuis le serveur : la plateforme ne la fournit pas "
                   "(retirée, masquée ou bloquée dans le pays du serveur).",
    "no_video": "Ce post ne contient pas de vidéo.",
    "media_index_not_found": "Ce post ne contient pas la vidéo demandée.",
    "private": "La vidéo est privée.",
    "age_restricted": "Vidéo soumise à une limite d'âge : la plateforme exige un compte connecté.",
    "members_only": "Vidéo réservée aux membres de la chaîne.",
    "geo_restricted": "Vidéo bloquée dans le pays du serveur.",
    "login_required": "La plateforme exige un compte connecté pour cette vidéo.",
    "unsupported_url": "Ce lien n'est pas pris en charge : partage une vidéo YouTube, TikTok ou X.",
    "unsupported_content": "Ce contenu n'est pas pris en charge (diaporama photo ou contenu protégé).",
    "playlist_not_supported": "Les playlists, chaînes et profils ne sont pas pris en charge : partage une vidéo.",
    "youtube_music_not_accepted": "Les liens YouTube Music ne sont pas acceptés : AETHRYON ne télécharge pas le "
                                  "catalogue musical commercial.",
    "live_not_supported": "Les directs et les premières ne sont pas pris en charge.",
    "short_link_unresolved": "Le lien court n'a pas pu être ouvert : ouvre la vidéo dans l'app puis partage-la "
                             "à nouveau.",
    "no_audio": "Cette vidéo n'a pas de son : MP3 impossible.",
    "too_long": "Vidéo trop longue pour le service.",
    "too_large": "Fichier trop volumineux pour le service.",
    "transcode_too_long": "Vidéo trop longue pour être réencodée.",
    "gif_too_long": "Vidéo trop longue pour un GIF.",
    "clip_out_of_range": "L'extrait demandé commence après la fin de la vidéo.",
    "cannot_fit": "Impossible de faire tenir ce média dans la taille demandée : il est trop long pour cette taille.",
    "unsupported_file": "Ce fichier n'est pas une vidéo ou un son pris en charge.",
    "resolution_too_high": "Image trop grande : le service accepte jusqu'à la 4K.",
    "invalid_crop": "Le recadrage demandé sort de l'image.",
    "bot_check": "Plateforme temporairement indisponible : elle impose au serveur une vérification anti-robot et "
                 "bloque ses demandes ; ni ta vidéo ni ton compte ne sont en cause. Réessaie plus tard.",
    "upstream_rate_limited": "Plateforme temporairement indisponible : elle limite le nombre de demandes du serveur ; "
                             "ni ta vidéo ni ton compte ne sont en cause. Réessaie plus tard.",
    "upstream_unavailable": "Plateforme temporairement indisponible : elle a renvoyé une erreur. Réessaie plus tard.",
    "upstream_timeout": "Plateforme temporairement indisponible : elle n'a pas répondu à temps.",
    "extractor_broken": "Plateforme temporairement indisponible : elle a changé son fonctionnement, le serveur "
                        "doit être mis à jour.",
    "upstream_forbidden": "Échec de récupération du média : la plateforme a refusé l'accès au fichier (HTTP 403).",
    "download_failed": "Échec de récupération du média : le téléchargement depuis la plateforme a été interrompu.",
    "format_unavailable": "Échec de récupération du média : aucun format compatible n'est proposé.",
    "upstream_error": "Échec de récupération du média (cause non identifiée).",
    "conversion_failed": "Échec du traitement vidéo.",
    "timeout": "Délai de conversion dépassé.",
    "insufficient_storage": "Serveur saturé (espace disque) : réessaie plus tard.",
    "server_busy": "Serveur occupé : réessaie dans un instant.",
    "internal_error": "Erreur interne.",
    "worker_crashed": "Erreur interne : le traitement s'est arrêté.",
    "cookies_invalid": "Erreur interne : configuration du serveur à corriger.",
    "proxy_unreachable": "Erreur interne : configuration du serveur à corriger.",
    "proxy_bypass": "Erreur interne : configuration du serveur à corriger.",
    "cancelled": "La conversion a été annulée.",
}
USER_TEXT_FALLBACK = "La conversion a échoué."


def user_text(code: str) -> str:
    return USER_TEXT.get(code, USER_TEXT_FALLBACK)


def detail_for(request: Request, code: str, detail: str) -> str:
    """Detail as seen by the caller: the fixed text of a known code for personal keys, the
    technical detail for admin tokens (and for codes outside docs/ERREURS.md: auth, quotas...)."""
    principal = getattr(request.state, "principal", None)
    if principal is not None and principal.is_user and code in USER_TEXT:
        return USER_TEXT[code]
    return detail


@dataclass
class ApiError(Exception):
    status: int
    code: str
    detail: str
    headers: dict[str, str] = field(default_factory=dict)

    def __str__(self) -> str:  # pragma: no cover - debugging helper
        return f"{self.status} {self.code}: {self.detail}"

    def to_dict(self) -> dict[str, object]:
        return {"status": self.status, "code": self.code, "detail": self.detail, "headers": self.headers}

    @classmethod
    def from_dict(cls, data: dict[str, object]) -> ApiError:
        return cls(int(data["status"]), str(data["code"]), str(data["detail"]), dict(data.get("headers") or {}))


def error_response(status: int, code: str, detail: str, headers: dict[str, str] | None = None) -> JSONResponse:
    return JSONResponse({"error": code, "detail": detail}, status_code=status, headers=headers)


_HTTP_CODES = {
    400: ("bad_request", "Requête illisible (corps mal formé ou trop gros)."),
    401: ("unauthorized", "Authentification requise."),
    403: ("forbidden", "Accès refusé."),
    404: ("not_found", "Route inconnue."),
    405: ("method_not_allowed", "Méthode HTTP non autorisée pour cette route."),
    413: ("too_large", "Requête trop grosse."),
    429: ("rate_limited", "Trop de requêtes."),
}


def _french_validation(err: dict) -> str:
    """French text for the pydantic errors a Shortcut can trigger (fallback: pydantic's message)."""
    kind, ctx = err.get("type", ""), err.get("ctx") or {}
    if kind == "literal_error":
        expected = str(ctx.get("expected", "")).replace(" or ", " ou ")
        return f"valeur non autorisée (valeurs possibles : {expected})"
    simple = {
        "missing": "champ obligatoire manquant",
        "extra_forbidden": "champ inconnu (retirez-le)",
        "int_parsing": "doit être un nombre entier",
        "int_type": "doit être un nombre entier",
        "int_from_float": "doit être un nombre entier",
        "bool_parsing": "doit être true ou false",
        "bool_type": "doit être true ou false",
        "string_type": "doit être du texte",
        "model_attributes_type": "le corps doit être un objet JSON",
        "model_type": "le corps doit être un objet JSON",
        "dict_type": "le corps doit être un objet JSON",
    }
    if kind in simple:
        return simple[kind]
    bounds = {"less_than_equal": ("≤", "le"), "greater_than_equal": ("≥", "ge"),
              "less_than": ("<", "lt"), "greater_than": (">", "gt")}
    if kind in bounds:
        sign, key = bounds[kind]
        return f"doit être {sign} {ctx.get(key)}"
    if kind == "string_too_short":
        return "ne doit pas être vide" if ctx.get("min_length") == 1 else f"trop court (min {ctx.get('min_length')})"
    if kind == "string_too_long":
        return f"trop long (max {ctx.get('max_length')} caractères)"
    return str(err.get("msg", "valeur invalide")).removeprefix("Value error, ")


def install_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(request: Request, exc: ApiError) -> JSONResponse:
        return error_response(exc.status, exc.code, detail_for(request, exc.code, exc.detail), exc.headers or None)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        parts = []
        for err in exc.errors():
            if err.get("type") == "json_invalid":
                parts.append("corps JSON mal formé")
                continue
            loc = ".".join(str(p) for p in err.get("loc", ()) if p not in ("query", "body"))
            parts.append(f"{loc or 'requête'} : {_french_validation(err)}")
        return error_response(400, "invalid_parameter", "Paramètre invalide — " + ("; ".join(parts) or "requête invalide"))

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code, detail = _HTTP_CODES.get(exc.status_code, ("http_error", "Erreur HTTP."))
        return error_response(exc.status_code, code, detail, getattr(exc, "headers", None))

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled error", extra={"path": request.url.path})
        return error_response(500, "internal_error",
                              detail_for(request, "internal_error", "Erreur interne du serveur (voir les logs)."))


# --- yt-dlp error mapping -------------------------------------------------------------------

# A rule's detail is a fixed text, or a function of the match and of the platform.
Detail = str | Callable[[re.Match[str], str], str]


def _cookies_hint(text: str) -> Callable[[re.Match[str], str], str]:
    """Cookies are only ever given to YouTube (app.main cookies_for): never suggest them elsewhere."""
    return lambda _, platform: f"{text} {COOKIES_HINT}" if platform in ("", "youtube") else text


def _login_detail(_: re.Match[str], platform: str) -> str:
    if platform in ("", "youtube"):
        return "Ce contenu exige un compte connecté. " + COOKIES_HINT
    name = {"tiktok": "TikTok", "twitter": "X"}.get(platform, "La plateforme")
    return (f"{name} exige un compte connecté pour ce contenu (sensible ou restreint) : le serveur n'utilise "
            "pas de compte sur cette plateforme.")


def _media_forbidden(_: re.Match[str], platform: str) -> str:
    # YouTube: the worker already fell back to the formats of the other clients before failing.
    if platform == "youtube":
        return "La plateforme refuse le flux du média (HTTP 403), même après repli sur un autre client."
    return "La plateforme refuse le flux du média (HTTP 403)."


# 10204 ("status_deleted"): TikTok sends the same status for deleted posts and for posts blocked in
# the server's country (the server is in Spain); yt-dlp words it "Your IP address is blocked".
TIKTOK_10204_DETAIL = ("TikTok ne fournit pas ce post au serveur (statut 10204 : supprimé, masqué ou bloqué dans "
                       "le pays du serveur).")


def _tiktok_status(match: re.Match[str], _: str) -> str:
    status = match.group(1)
    if status == "10204":
        return TIKTOK_10204_DETAIL
    return f"TikTok ne fournit pas ce post au serveur (statut {status} : supprimé, masqué ou indisponible)."


# Ordered (pattern, status, code, detail). First match wins; patterns are matched
# case-insensitively against the yt-dlp message, ANSI codes and the "[extractor] <id>:"
# prefix removed (media ids such as TikTok/X snowflakes may contain e.g. "404").
# Server-side failures are never blamed on the platform: disk, files and JS runtime come first,
# ffmpeg/ffprobe failures before not_found.
_YTDLP_RULES: list[tuple[re.Pattern[str], int, str, Detail]] = [
    (re.compile(r"confirm you.?re not a bot|not a bot", re.I), 503, "bot_check",
     "YouTube demande de prouver qu'on n'est pas un robot (IP du serveur signalée). " + COOKIES_HINT),
    # Must come before not_found: YouTube words it "Video unavailable. This content isn't
    # available, try again later. The current session has been rate-limited by YouTube...".
    (re.compile(r"try again later|rate.?limited by YouTube|has been rate.?limited|HTTP Error 429|"
                r"Too Many Requests|rate.?limit", re.I),
     503, "upstream_rate_limited", "La plateforme limite le serveur : réessayez plus tard."),
    (re.compile(r"Cookies file must be|does not look like a Netscape format cookies file|"
                r"cookies? file .*(invalid|format)|CookieLoadError|failed to load cookies", re.I),
     500, "cookies_invalid", "Le fichier de cookies n'est pas au format Netscape (cookies.txt) : réexportez-le."),
    (re.compile(r"\[Errno 28\]|No space left on device", re.I), 503, "insufficient_storage",
     "Disque du serveur plein (ENOSPC) : libérez de la place (fichiers temporaires, cache)."),
    (re.compile(r"unable to (write data|open for writing|rename file)", re.I), 500, "internal_error",
     "Écriture impossible dans le dossier temporaire du serveur (voir les logs)."),
    (re.compile(r"No supported JavaScript runtime", re.I), 500, "internal_error",
     "Aucun moteur JavaScript (deno) utilisable par yt-dlp : image du serveur à reconstruire."),
    (re.compile(r"Your IP address is blocked from accessing this post", re.I), 404, "unavailable",
     TIKTOK_10204_DETAIL),
    (re.compile(r"Video not available, status code (\d+)", re.I), 404, "unavailable", _tiktok_status),
    (re.compile(r"Unexpected response from webpage request|universal data for rehydration|"
                r"Unable to extract challenge data|Unable to solve JS challenge|"
                r"not available on this app|Watch on the latest version of YouTube", re.I),
     502, "extractor_broken", "La plateforme a changé ou bloqué la requête : mettez yt-dlp à jour (make update)."),
    (re.compile(r"No video could be found in this tweet|Media #\d+ is not a video", re.I), 404, "no_video",
     "Pas de vidéo ni de GIF dans ce post (supprimé, photo seule, ou contenu sensible/protégé)."),
    (re.compile(r"Unsupported URL|No suitable extractor", re.I), 400, "unsupported_url",
     "Lien non pris en charge (uniquement une vidéo ou un post YouTube, TikTok ou X)."),
    (re.compile(r"DRM.protected|\bDRM\b", re.I), 400, "unsupported_content",
     "Contenu protégé par DRM : non pris en charge."),
    (re.compile(r"Only images are available for download", re.I), 400, "unsupported_content",
     "Ce post ne contient que des images (diaporama) : non pris en charge."),
    # TikTok statuses 10216 (private post) and 10222 (private account) read "You do not have
    # permission to view this post. Log into an account that has access": private, not a login wall.
    (re.compile(r"private video|video is private|this account is private|protected tweet|"
                r"you are not authorized to view|is set to private|do not have permission to view this post", re.I),
     403, "private", "Contenu privé."),
    (re.compile(r"confirm your age|age.?restricted|inappropriate for some users|age limit|"
                r"age-gated|age gate", re.I),
     403, "age_restricted", _cookies_hint("Contenu soumis à une limite d'âge.")),
    (re.compile(r"members.?only|join this channel|available to this channel's members", re.I),
     403, "members_only", "Contenu réservé aux membres de la chaîne."),
    (re.compile(r"not available in your country|geo.?restrict|blocked it in your country|"
                r"not made this video available in your country|from your location", re.I),
     403, "geo_restricted", "Contenu bloqué dans le pays du serveur."),
    (re.compile(r"Unable to connect to proxy|ProxyError|SOCKS(4|5)?.{0,40}(error|fail|refused|unreachable)|"
                r"proxy.{0,40}(refused|unreachable|failed|timed out)|"
                # socks5h:// errors name the target host, not the proxy: SocksHTTPSConnection(host=...)
                r"Socks\w*Connection\(.{0,120}?(Failed to establish|refused|unreachable|timed out|No route)", re.I),
     502, "proxy_unreachable", "Le proxy YouTube (YT_PROXY) est injoignable : vérifiez le PC/NetBird."),
    # A 403 is never "not found". Page/API requests and media streams get different details.
    (re.compile(r"Unable to download (webpage|API page|JSON metadata)\b.*(HTTP Error 403|403: Forbidden)", re.I),
     502, "upstream_forbidden", "La plateforme refuse la page au serveur (HTTP 403)."),
    (re.compile(r"HTTP Error 403|403: Forbidden", re.I), 502, "upstream_forbidden", _media_forbidden),
    (re.compile(r"HTTP Error 5\d\d", re.I), 503, "upstream_unavailable",
     "La plateforme a renvoyé une erreur serveur (HTTP 5xx) : réessayez plus tard."),
    (re.compile(r"fragment \d+ not found", re.I), 502, "download_failed",
     "Le téléchargement du flux a échoué (fragment manquant) : réessayez."),
    # The extraction worked, then the stream URL vanished: not a deleted video.
    (re.compile(r"unable to download video data: HTTP Error (404|410)", re.I), 502, "download_failed",
     "Le flux du média a disparu pendant le téléchargement (HTTP 404/410) : réessayez."),
    (re.compile(r"(requires|need to|must) (log ?in|sign ?in|authentication|be logged)|login required|"
                r"log ?into an account|do not have permission to view|"
                r"nsfw tweet|sensitive content|use --cookies|account (credentials|cookies)", re.I),
     403, "login_required", _login_detail),
    # Must stay before the ffmpeg rule: "Postprocessing: WARNING: unable to obtain file audio codec".
    (re.compile(r"unable to obtain file audio codec|does not contain any audio|no audio stream", re.I),
     400, "no_audio", "Ce média n'a pas de piste audio : mp3 impossible."),
    (re.compile(r"^(Pre|Post)processing:|\b(ffmpeg|ffprobe)( and ffmpeg)? not found|Encoder not found|"
                r"Option not found", re.I),
     500, "conversion_failed", "La conversion du média a échoué (ffmpeg/ffprobe, voir les logs)."),
    (re.compile(r"video unavailable|video is unavailable|has been removed|no longer available|"
                r"does not exist|no longer exists|"
                r"(video|post|tweet|space|user|account|page|media|channel) (was )?not found|HTTP Error 404|"
                r"no status found|tweet is unavailable|this post is (unavailable|deleted)|post was deleted|"
                r"content is not available|recording is not available|"
                r"(account|channel).{0,60}terminated|has been terminated|"
                r"suspended account|account.{0,20}suspended|^suspended$|unable to find", re.I),
     404, "not_found", "Contenu introuvable (supprimé, indisponible ou mauvais lien)."),
    (re.compile(r"premieres in|live event will begin|this live event will|is currently live|"
                r"is a live stream|live streams? (are|is) not supported", re.I),
     400, "live_not_supported", "Les directs et premières ne sont pas pris en charge."),
    (re.compile(r"Requested format is not available|no video formats found|no formats found", re.I),
     422, "format_unavailable", "Aucun format téléchargeable ne correspond à la demande."),
    (re.compile(r"timed? ?out|timeout", re.I), 504, "upstream_timeout", "La plateforme n'a pas répondu à temps."),
    # Cut during the media download (TLS reset, truncated body): the extraction had worked.
    (re.compile(r"unable to download video data|Did not get any data blocks|non-properly terminated|"
                r"IncompleteRead", re.I),
     502, "download_failed", "Le téléchargement du flux a été interrompu : réessayez."),
    (re.compile(r"ffmpeg|ffprobe|postprocessing|preprocessing|conversion failed", re.I), 500, "conversion_failed",
     "La conversion du média a échoué."),
]

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
_IE_PREFIX_RE = re.compile(r"^\[[^\]]+\]\s*[^:\s]*:\s*")
# "Unsupported URL: <url>", or "No suitable extractor [(IE)] found for URL <url>" when extractors are
# restricted (allowed_extractors): <url> is where yt-dlp ended up, after the short link's redirect.
_UNSUPPORTED_RE = re.compile(r"(?:Unsupported URL|No suitable extractor(?: \([^)]*\))? found for URL):?\s*(\S+)",
                             re.I)
# Where TikTok sends a short link it does not resolve for the server: home, login, feeds.
_TIKTOK_DEAD_ENDS = {"", "login", "foryou", "explore"}
_TIKTOK_UNRESOLVED_DETAIL = ("Lien court TikTok non résolu : la redirection mène à l'accueil, à la connexion ou à "
                             "un autre lien court (lien expiré, ou redirection refusée au serveur).")


def clean_message(message: str) -> str:
    message = _ANSI_RE.sub("", message or "").strip()
    message = re.sub(r"^ERROR:\s*", "", message)
    return message


def _tiktok_unsupported(text: str) -> ApiError | None:
    """yt-dlp gave up on a TikTok link (in practice a vm./vt./tiktok.com/t/ short link, as app.urls
    lets only videos and short links through): classify the URL the redirect ended on."""
    match = _UNSUPPORTED_RE.search(text)
    if match is None:
        return None
    url = match.group(1)
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower()
    except ValueError:
        return None
    if host != "tiktok.com" and not host.endswith(".tiktok.com"):
        return None
    first = parts.path.strip("/").split("/")[0].lower()
    # Still a short link (TikTokVMIE refuses to loop), or a page that is no video at all.
    if host in ("vm.tiktok.com", "vt.tiktok.com") or first == "t" or first in _TIKTOK_DEAD_ENDS:
        return ApiError(502, "short_link_unresolved", _TIKTOK_UNRESOLVED_DETAIL)
    from .urls import validate_media_url  # lazy: app.urls imports this module

    try:
        validate_media_url(url, ("tiktok.com",))
    except ApiError as exc:
        # A short link to a profile, a hashtag, a live or a slideshow: same answer as for the full link.
        if exc.code in ("playlist_not_supported", "live_not_supported", "unsupported_content"):
            return exc
    # Any other TikTok page yt-dlp cannot open (m.tiktok.com/v/<id>.html, /discover/…): the short link
    # did not lead to a video it can read, which is not the same as an unsupported site.
    return ApiError(502, "short_link_unresolved", _TIKTOK_UNRESOLVED_DETAIL)


def map_ytdlp_error(message: str, platform: str = "", geo: bool = False) -> ApiError:
    text = clean_message(message)
    if geo:
        return ApiError(403, "geo_restricted", "Contenu bloqué dans le pays du serveur.")
    unsupported = re.search(r"Unsupported URL|No suitable extractor", text, re.I)
    if platform == "twitter" and unsupported:
        # A text tweet whose link/card points elsewhere: yt-dlp tried to follow the link.
        return ApiError(404, "no_video", "Pas de vidéo dans ce post (il renvoie seulement vers un autre site).")
    if platform == "tiktok" and unsupported:
        if "/photo/" in text:
            return ApiError(400, "unsupported_content", "Les diaporamas photo TikTok ne sont pas pris en charge.")
        error = _tiktok_unsupported(text)
        if error is not None:
            return error
    body = _IE_PREFIX_RE.sub("", text)
    for pattern, status, code, detail in _YTDLP_RULES:
        match = pattern.search(body)
        if match:
            return ApiError(status, code, detail(match, platform) if callable(detail) else detail)
    return ApiError(502, "upstream_error", "La plateforme a refusé ou échoué (détails dans les logs du serveur).")

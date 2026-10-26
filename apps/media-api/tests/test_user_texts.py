"""User texts (personal ytc_ keys): the exact table of docs/ERREURS.md.

docs/ is outside the docker build context (ytapi/), so the expected table is copied here; the
repository-level checker compares docs/ERREURS.md, app/errors.py and account/src/usage.ts.
"""

import re
from pathlib import Path

import pytest

from app.errors import _YTDLP_RULES, USER_TEXT, USER_TEXT_FALLBACK, map_ytdlp_error, user_text

# Copied character for character from docs/ERREURS.md (2026-10-12).
EXPECTED: dict[str, str] = {
    "not_found": "Vidéo supprimée ou inaccessible : la plateforme ne la trouve pas (lien erroné ou vidéo retirée).",
    "unavailable": "Vidéo supprimée ou inaccessible depuis le serveur : la plateforme ne la fournit pas (retirée, "
                   "masquée ou bloquée dans le pays du serveur).",
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
    "platform_not_accepted": "Cette plateforme n'est pas acceptée : AETHRYON ne télécharge ni le streaming payant, "
                             "ni les catalogues musicaux, ni les contenus protégés.",
    "live_not_supported": "Les directs et les premières ne sont pas pris en charge.",
    "short_link_unresolved": "Le lien court n'a pas pu être ouvert : ouvre la vidéo dans l'app puis partage-la à "
                             "nouveau.",
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
    "bot_check": "Plateforme temporairement indisponible : elle impose au serveur une vérification anti-robot et bloque ses demandes ; ni ta vidéo ni ton compte ne sont en cause. Réessaie plus tard.",
    "upstream_rate_limited": "Plateforme temporairement indisponible : elle limite le nombre de demandes du serveur ; ni ta vidéo ni ton compte ne sont en cause. Réessaie plus tard.",
    "upstream_unavailable": "Plateforme temporairement indisponible : elle a renvoyé une erreur. Réessaie plus tard.",
    "upstream_timeout": "Plateforme temporairement indisponible : elle n'a pas répondu à temps.",
    "extractor_broken": "Plateforme temporairement indisponible : elle a changé son fonctionnement, le serveur doit "
                        "être mis à jour.",
    "platform_unavailable": "Plateforme temporairement indisponible : trop d'échecs récents, elle est mise en pause "
                            "automatiquement ; ni ta vidéo ni ton compte ne sont en cause. Réessaie plus tard.",
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


def test_user_texts_are_exactly_the_documented_table() -> None:
    assert USER_TEXT == EXPECTED
    assert list(USER_TEXT) == list(EXPECTED)  # same order as the documentation, easier to review
    assert len(USER_TEXT) == 46


def test_user_texts_typography() -> None:
    for code, text in USER_TEXT.items():
        assert text.endswith("."), code
        assert "’" not in text and " " not in text and " " not in text, code  # plain ' and spaces
        assert not re.search(r"\S:|\s{2}|\s$", text), code  # French colon: one plain space before it
        assert "make " not in text and "cookies" not in text and "yt-dlp" not in text, code  # no admin hints


@pytest.mark.parametrize("code", sorted(EXPECTED))
def test_user_text_of_known_codes(code: str) -> None:
    assert user_text(code) == EXPECTED[code]


@pytest.mark.parametrize("code", ["unauthorized", "rate_limited", "quota_exceeded", "invalid_parameter",
                                  "job_not_found", "something_new", ""])
def test_unknown_codes_fall_back(code: str) -> None:
    assert user_text(code) == USER_TEXT_FALLBACK == "La conversion a échoué."


def test_every_mapped_ytdlp_code_has_a_user_text() -> None:
    codes = {code for _, _, code, _ in _YTDLP_RULES}
    assert codes <= set(USER_TEXT), codes - set(USER_TEXT)
    # Codes produced outside the rule table.
    for message, platform in [("whatever", "youtube"), ("ERROR: Unsupported URL: https://vm.tiktok.com/Z/", "tiktok"),
                              ("ERROR: Unsupported URL: https://www.tiktok.com/@u/photo/1", "tiktok"),
                              ("ERROR: Unsupported URL: https://example.com/", "twitter")]:
        assert map_ytdlp_error(message, platform).code in USER_TEXT
    assert map_ytdlp_error("whatever", "youtube", geo=True).code in USER_TEXT


def test_every_error_code_raised_by_the_app_is_documented() -> None:
    """Every conversion error code raised in app/ is in the table (auth/quota/request codes excepted)."""
    app_dir = Path(__file__).resolve().parent.parent / "app"
    raised: set[str] = set()
    for source in app_dir.glob("*.py"):
        raised |= set(re.findall(r'ApiError\(\s*\d{3},\s*"([a-z_]+)"', source.read_text(encoding="utf-8")))
        raised |= set(re.findall(r'_fail\(job, \d{3}, "([a-z_]+)"', source.read_text(encoding="utf-8")))
    # Answers to the request itself, never a conversion result: technical detail for everyone.
    request_codes = {"invalid_url", "domain_not_allowed", "forbidden_for_user_keys", "active_job_limit",
                     "auth_unavailable", "quota_exceeded", "service_paused", "invalid_parameter",
                     "account_suspended", "unauthorized", "rate_limited", "client_closed", "job_failed",
                     "job_not_ready", "file_gone", "job_not_found",
                     # Derived files (POST /jobs/{id}/derive): too many from one conversion, a request answer.
                     "derive_limit",
                     # Control Center (docs/ADMIN.md §5): platform switched off by an admin (account's message),
                     # internal admin API answers (never seen by a user key).
                     "platform_disabled", "forbidden", "job_already_cancelled", "job_finished",
                     # AETHRYON Tools (docs/OUTILS.md): answers to an import or file request, never a job result.
                     "forbidden_for_admin_tokens", "invalid_chunk", "chunk_out_of_range", "upload_pending",
                     "upload_closed", "upload_incomplete", "not_ready", "thumbnail_unavailable",
                     # Clips (CONTRAT-EXTRAITS): bounds or length refused by the server's limits.
                     "extrait_invalide", "extrait_trop_long"}
    # Clips (CONTRAT-EXTRAITS, extraits/BACKEND.md): job results whose French detail is shown as is (it explains the
    # limit or the source); not yet in docs/ERREURS.md, whose table is shared with account (unchanged here).
    clip_results = {"extrait_hors_source", "extrait_partiel_impossible", "extrait_trop_lourd"}
    assert raised, "no ApiError found: pattern out of date"
    assert raised - request_codes - clip_results <= set(USER_TEXT), \
        (raised - request_codes - clip_results) - set(USER_TEXT)
    assert not clip_results & set(USER_TEXT)  # their detail must reach the user, not a generic text

#!/usr/bin/env python3
"""Banc de compatibilité RÉEL des plateformes du registre (app/plateformes.json), lancé À LA MAIN.

Pour chaque plateforme beta, indisponible ou officielle (sauf YouTube, TikTok et X, déjà en production, sauf --avec-production) :
  1. contrôle du lien par les règles du service (app.urls.validate_media_url, aucune requête) ;
  2. métadonnées réelles avec les mêmes options que le worker (extracteurs autorisés de la plateforme seulement,
     jamais « generic », aucun cookie, aucun proxy) ;
  3. petit téléchargement réel : mode d'essai de yt-dlp (`test`: ~10 Kio, ou le premier fragment d'un flux
     segmenté), le plus petit format proposé.
Rien n'est contourné : un contenu privé, connecté, protégé (DRM) ou bloqué est noté comme un échec.

Politesse : une requête de plateforme à la fois, ESPACEMENT minimal entre deux liens (30 s par défaut, jamais moins
de 30 s), un ou deux liens publics par plateforme, aucun nouvel essai automatique. Sans --reel, le script ne fait
qu'afficher le plan (aucune requête réseau).

Usage (conteneur jetable de l'image media-api, avec réseau, code de la branche monté en lecture seule) :
  docker run --rm -v "$PWD/apps/media-api:/src:ro" -v "$OUT:/out" -w /src --entrypoint python aethryon-media-api:test \\
      banc/plateformes_reel.py --reel --sortie /out
Rapport : <sortie>/plateformes-AAAAMMJJ-HHMMZ.json et .md (daté, UTC).
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlsplit
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.errors import ApiError, map_ytdlp_error  # noqa: E402
from app.registre import registre  # noqa: E402
from app.urls import MediaUrl, check_extractor_shape, validate_media_url  # noqa: E402

# Liens publics d'essai : contenus libres ou officiels quand c'est possible, sinon les liens publics du jeu d'essai
# officiel de yt-dlp (extracteur concerné, version 2026.08.19). Un lien de repli n'est essayé que si le premier échoue.
LIENS: dict[str, list[str]] = {
    "vimeo": ["https://vimeo.com/56015672", "https://vimeo.com/76979871"],
    "dailymotion": ["https://www.dailymotion.com/video/x5kesuj", "https://www.dailymotion.com/video/x89eyek"],
    "archive": ["https://archive.org/details/Cops1922"],
    "wikimedia": ["https://commons.wikimedia.org/wiki/File:Die_Temperaturkurve_der_Erde_(ZDF,_Terra_X)_720p_HD_50FPS.webm"],
    "reddit": ["https://www.reddit.com/r/videos/comments/6rrwyj/that_small_heart_attack/"],
    "streamable": ["https://streamable.com/dnd1", "https://streamable.com/moo"],
    "imgur": ["https://imgur.com/A61SaA1"],
    "bluesky": ["https://bsky.app/profile/bsky.app/post/3l3vgf77uco2g",
                "https://bsky.app/profile/blu3blue.bsky.social/post/3l4omssdl632g"],
    "twitch": ["https://clips.twitch.tv/FaintLightGullWholeWheat", "https://www.twitch.tv/videos/635475444"],
    "kick": ["https://kick.com/mxddy?clip=clip_01GYXVB5Y8PWAPWCWMSBCFB05X"],
    "instagram": ["https://www.instagram.com/reel/Chunk8-jurw/"],
    "facebook": ["https://www.facebook.com/radiokicksfm/videos/3676516585958356/"],
    "pinterest": ["https://www.pinterest.com/pin/664281013778109217/"],
    "snapchat": ["https://www.snapchat.com/spotlight/W7_EDlXWTBiXAEEniNoMPwAAYYWtidGhudGZpAX1TKn0JAX1TKnXJAAAAAA"],
    "linkedin": ["https://www.linkedin.com/posts/the-mathworks_2_what-is-mathworks-cloud-center-activity-7151241570371948544-4Gu7"],
    "tumblr": ["https://maskofthedragon.tumblr.com/post/626907179849564160/mona-talking-in-english"],
    "bilibili": ["https://www.bilibili.com/video/BV13x41117TL"],
    "rumble": ["https://rumble.com/vdmum1-moose-the-dog-helps-girls-dig-a-snow-fort.html"],
    "vk": ["https://vk.com/video205387401_165548505"],
}
PRODUCTION = ("youtube", "tiktok", "twitter")
MIN_ESPACEMENT_S = 30.0


def _cfg() -> dict[str, Any]:
    return {"max_filesize_bytes": 50 * 1024 * 1024, "cache_dir": None, "extractor_args": {}, "log_level": "INFO",
            "yt_proxy": None}


def _erreur(exc: BaseException, platform: str) -> dict[str, Any]:
    if isinstance(exc, ApiError):
        return {"code": exc.code, "detail": exc.detail}
    message = str(exc)
    try:
        mapped = map_ytdlp_error(message, platform)
        code = mapped.code
    except Exception:  # noqa: BLE001
        code = "upstream_error"
    return {"code": code, "detail": message[:300]}


def essai(platform: str, url: str, allowed: tuple[str, ...]) -> dict[str, Any]:
    import yt_dlp

    from app import worker

    out: dict[str, Any] = {"plateforme": platform, "url": url, "debut": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    # Une plateforme « indisponible » est réessayée ici (c'est le rôle du banc) : mêmes extracteurs, même contrôle de
    # forme du lien ; le service, lui, la refuse avant tout travail.
    worker.PLATFORM_EXTRACTORS.update(registre().extractors(avec_indisponibles=True))
    try:
        found = registre().get(platform)
        if found is not None and found.etat == "indisponible":
            check_extractor_shape(platform, url)
            media = MediaUrl(url=url, host=urlsplit(url).hostname or "", platform=platform)
        else:
            media = validate_media_url(url, allowed)
    except ApiError as exc:
        out.update(regles="refus", erreur={"code": exc.code, "detail": exc.detail})
        return out
    out["regles"] = "ok"
    with tempfile.TemporaryDirectory(prefix="banc-plateformes-") as tmp:
        opts = worker.base_options(_cfg(), Path(tmp), media.platform) | {"skip_download": True}
        opts["format"] = "bv*+ba/b"
        opts.pop("max_filesize", None)
        t0 = time.monotonic()
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.sanitize_info(worker._extract(ydl, media.url, media.platform))
            resume = worker.summarize(info, {"max_duration_s": 3600, "gif_max_duration_s": 30,
                                             "transcode_max_duration_s": 900}, media.platform)
            out["metadonnees"] = {
                "ok": True, "secondes": round(time.monotonic() - t0, 1), "extracteur": resume.get("extractor"),
                "titre": (resume.get("title") or "")[:120], "duree": resume.get("duration"),
                "qualites": [q["quality"] for q in resume.get("qualities", [])],
                "audio": resume.get("audio_only_available"), "nb_formats": len(info.get("formats") or []),
            }
        except Exception as exc:  # noqa: BLE001
            out["metadonnees"] = {"ok": False, "secondes": round(time.monotonic() - t0, 1), **_erreur(exc, media.platform)}
            out["telechargement"] = {"ok": False, "code": "non_tente"}
            return out
        # Petit téléchargement réel : le plus petit format, mode d'essai (taille bornée par yt-dlp).
        dl_opts = worker.base_options(_cfg(), Path(tmp), media.platform) | {
            "test": True, "format": "b/bv*/ba", "format_sort": ["+size", "+br", "+res"]}
        t0 = time.monotonic()
        try:
            with yt_dlp.YoutubeDL(dl_opts) as ydl:
                ydl.download([media.url])
            fichiers = [p for p in Path(tmp).iterdir() if p.is_file() and p.stat().st_size > 0
                        and not p.name.endswith((".part", ".ytdl", ".txt"))]
            octets = sum(p.stat().st_size for p in fichiers)
            out["telechargement"] = {"ok": octets > 0, "octets": octets, "secondes": round(time.monotonic() - t0, 1)}
        except Exception as exc:  # noqa: BLE001
            out["telechargement"] = {"ok": False, "secondes": round(time.monotonic() - t0, 1),
                                     **_erreur(exc, media.platform)}
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--reel", action="store_true", help="faire les vraies requêtes (sinon : plan seulement)")
    ap.add_argument("--sortie", type=Path, default=Path("banc/resultats"))
    ap.add_argument("--espacement", type=float, default=MIN_ESPACEMENT_S)
    ap.add_argument("--seulement", default="", help="ids séparés par des virgules")
    args = ap.parse_args(argv)
    espacement = max(MIN_ESPACEMENT_S, args.espacement)
    reg = registre()
    seulement = {s for s in args.seulement.split(",") if s}
    cibles = [p for p in reg.plateformes if p.etat in ("officielle", "beta", "indisponible") and p.id not in PRODUCTION
              and (not seulement or p.id in seulement)]
    allowed = reg.domains("officielle", "beta")
    if not args.reel:
        for p in cibles:
            print(f"{p.id:12} {p.etat:8} {LIENS.get(p.id, ['(aucun lien)'])[0]}")
        print(f"{len(cibles)} plateformes, espacement {espacement:.0f} s : ajoute --reel pour lancer.")
        return 0
    stamp = time.strftime("%Y%m%d-%H%MZ", time.gmtime())
    resultats: list[dict[str, Any]] = []
    dernier = 0.0
    for p in cibles:
        liens = LIENS.get(p.id) or []
        if not liens:
            resultats.append({"plateforme": p.id, "regles": "non_teste", "erreur": {"code": "aucun_lien"}})
            continue
        for url in liens:
            attente = dernier + espacement - time.monotonic()
            if attente > 0:
                time.sleep(attente)
            dernier = time.monotonic()
            r = essai(p.id, url, allowed)
            resultats.append(r)
            ok = r.get("metadonnees", {}).get("ok") and r.get("telechargement", {}).get("ok")
            print(f"{p.id:12} {'RÉUSSI' if ok else 'ÉCHEC '} {url}", flush=True)
            if ok:
                break
    args.sortie.mkdir(parents=True, exist_ok=True)
    data = {"date": stamp, "ytdlp": __import__("yt_dlp.version").version.__version__, "espacement_s": espacement,
            "resultats": resultats}
    (args.sortie / f"plateformes-{stamp}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), "utf-8")
    lignes = [f"# Banc réel des plateformes — {stamp} (yt-dlp {data['ytdlp']}, espacement {espacement:.0f} s)", "",
              "| Plateforme | Lien | Règles | Métadonnées | Petit téléchargement |", "|---|---|---|---|---|"]
    for r in resultats:
        m, t = r.get("metadonnees") or {}, r.get("telechargement") or {}
        meta = (f"OK ({m.get('extracteur')}, {m.get('duree')} s, {m.get('qualites')})" if m.get("ok")
                else f"ÉCHEC `{m.get('code') or (r.get('erreur') or {}).get('code')}`")
        dl = f"OK ({t.get('octets')} o)" if t.get("ok") else f"ÉCHEC `{t.get('code')}`" if t else "—"
        lignes.append(f"| {r['plateforme']} | {r.get('url', '—')} | {r.get('regles')} | {meta} | {dl} |")
    (args.sortie / f"plateformes-{stamp}.md").write_text("\n".join(lignes) + "\n", "utf-8")
    print(f"Rapport : {args.sortie}/plateformes-{stamp}.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())

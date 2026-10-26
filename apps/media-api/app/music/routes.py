"""Routes /music/* (MUSIC_ENABLED=true; absent otherwise: 404 like any unknown route). Same authentication as the
rest of ytapi: an AETHRYON key `ytc_…` in `Authorization: Bearer` (extension, Premiere panel, the future Desktop key;
the site through account) or an administrator token. Every response is JSON except the imported file."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, Depends, Query, Request
from fastapi.responses import FileResponse, JSONResponse

from ..errors import ApiError
from ..filenames import content_disposition
from ..security import SlidingWindowLimiter
from ..userkeys import Principal
from .service import MusicService

# Per caller (user id, or the admin token label): outgoing calls to the services and imports stay bounded.
LIMITS = {"analyse": (60, 600), "recherche": (30, 600), "import": (20, 3600), "sync": (10, 600), "match": (30, 600)}


def make_router(music: MusicService, light: Callable[[Request], Awaitable[None]],
                heavy: Callable[[Request], Awaitable[None]]) -> APIRouter:
    router = APIRouter(prefix="/music")
    limiters = {k: SlidingWindowLimiter(n, w) for k, (n, w) in LIMITS.items()}

    def caller(request: Request, kind: str) -> Principal:
        principal: Principal = request.state.principal
        key = principal.user_id or f"admin:{principal.label}"
        wait = limiters[kind].hit(key)
        if wait is not None:
            raise ApiError(429, "rate_limited", f"Trop de demandes : réessaie dans {int(wait) + 1} s.",
                           {"Retry-After": str(int(wait) + 1)})
        return principal

    def body_of(raw: Any) -> dict[str, Any]:
        if not isinstance(raw, dict):
            raise ApiError(400, "requete_invalide", "Corps JSON (objet) attendu.")
        return raw

    def file_url(request: Request, job_id: str) -> str:
        return f"{request.scope.get('root_path', '')}/music/imports/{job_id}/fichier"

    @router.get("/connecteurs", dependencies=[Depends(light)])
    async def connecteurs() -> dict[str, Any]:
        return {"connecteurs": music.connecteurs(),
                "etats": {"lien_reconnu": "Lien valide, métadonnées non disponibles",
                          "identifie": "Titre identifié (métadonnées officielles), aucun fichier",
                          "correspondance": "Un fichier que tu possèdes déjà correspond",
                          "telechargeable": "Fichier réellement téléchargeable (la source l'autorise)"},
                "limites": {"tailleMaxMo": music.settings.music_max_file_mb,
                            "dureeMaxS": music.settings.music_max_duration_s,
                            "importsSimultanesParCompte": music.settings.music_max_active_per_user,
                            "conservationMin": music.settings.music_job_ttl_min}}

    @router.post("/analyser", dependencies=[Depends(light)])
    async def analyser(request: Request, raw: Any = Body(None)) -> dict[str, Any]:
        b = body_of(raw)
        caller(request, "analyse")
        return {"fiche": (await music.analyse(b.get("url"), b.get("type"))).to_json()}

    @router.get("/rechercher", dependencies=[Depends(light)])
    async def rechercher(request: Request, q: str = Query("", max_length=200),
                         source: str = Query("", max_length=20)) -> dict[str, Any]:
        caller(request, "recherche")
        return {"resultats": [f.to_json() for f in await music.search(q, source)], "source": source}

    @router.post("/correspondances", dependencies=[Depends(light)])
    async def correspondances(request: Request, raw: Any = Body(None)) -> dict[str, Any]:
        b = body_of(raw)
        caller(request, "match")
        return {"pistes": music.correspondances(b.get("pistes"), b.get("candidats")), "telechargements": 0}

    @router.post("/playlists/synchroniser", dependencies=[Depends(light)])
    async def synchroniser(request: Request, raw: Any = Body(None)) -> dict[str, Any]:
        b = body_of(raw)
        caller(request, "sync")
        return await music.synchroniser(b.get("url"), b.get("candidats"))

    @router.post("/imports", status_code=202, dependencies=[Depends(heavy)])
    async def create_import(request: Request, raw: Any = Body(None)) -> JSONResponse:
        b = body_of(raw)
        principal = caller(request, "import")
        job = await music.start_import(principal, b)
        return JSONResponse({"import": music.imports.view(job, file_url(request, job.id))}, status_code=202)

    @router.get("/imports", dependencies=[Depends(light)])
    async def list_imports(request: Request) -> dict[str, Any]:
        principal: Principal = request.state.principal
        return {"imports": [music.imports.view(j, file_url(request, j.id)) for j in music.imports.list_for(principal)]}

    @router.get("/imports/{job_id}", dependencies=[Depends(light)])
    async def get_import(request: Request, job_id: str) -> dict[str, Any]:
        job = music.imports.get(job_id, request.state.principal)
        return {"import": music.imports.view(job, file_url(request, job.id))}

    @router.delete("/imports/{job_id}", dependencies=[Depends(light)])
    async def delete_import(request: Request, job_id: str) -> dict[str, Any]:
        job = music.imports.get(job_id, request.state.principal)
        music.imports.cancel(job)
        return {"import": music.imports.view(job, None), "supprime": job.id not in music.imports.jobs}

    @router.get("/imports/{job_id}/fichier", dependencies=[Depends(light)])
    async def get_file(request: Request, job_id: str) -> FileResponse:
        job = music.imports.get(job_id, request.state.principal)
        if job.etat != "termine" or not job.result:
            raise ApiError(409, "import_non_termine", f"Import pas encore terminé ({job.etat}).")
        path = Path(job.result["filepath"])
        if not path.is_file():
            raise ApiError(410, "fichier_expire", "Fichier retiré du serveur : relance l'import.")
        return FileResponse(path, media_type=job.result["media_type"],
                            headers={"Content-Disposition": content_disposition(job.result["download_name"])})

    return router

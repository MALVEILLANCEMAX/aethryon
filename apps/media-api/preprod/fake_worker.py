"""PREPRODUCTION ONLY — ytapi with a fake worker: no yt-dlp, no network, tiny local files.

Copied only into the Docker target "preprod" (never into "runtime"). The real API code runs
unchanged (auth, user keys, quotas, jobs, files); only Runner._run is replaced.
- MP3: 2 s sine wave (audio/mpeg); MP4: 2 s blue frame + sound (video/mp4), generated once by ffmpeg.
- A URL containing "fail-test" fails with 403 "private" (to exercise error paths).
- Derived files (MEDIA_TOOLS_ENABLED: compression, GIF) are REAL: ffmpeg only, on the job's local file, no network.
- Clips (startMs/endMs or start_s/end_s): stages of the contract (analyse, recuperation, conversion, finalisation) with
  their progression and simulated bytes, then a REAL file of the requested length (ffmpeg, synthetic picture and sound,
  10 min at most). « partiel-impossible-test » in the URL fails with extrait_partiel_impossible.
"""

from __future__ import annotations

import asyncio
import shutil
import subprocess
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from app.config import load_settings
from app.errors import ApiError
from app.main import create_app
from app.runner import Cancelled, Runner, Task
from app.urls import MediaUrl, media_key

SAMPLES = Path("/tmp/preprod-samples")


def _samples() -> dict[str, Path]:
    SAMPLES.mkdir(parents=True, exist_ok=True)
    mp3, mp4 = SAMPLES / "sample.mp3", SAMPLES / "sample.mp4"
    if not mp3.exists():
        subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
                        "-q:a", "9", str(mp3)], check=True, timeout=60)
    if not mp4.exists():
        subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x245BFF:s=320x180:d=2",
                        "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-shortest", "-c:v", "libx264",
                        "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", str(mp4)],
                       check=True, timeout=60)
    return {"mp3": mp3, "mp4": mp4}


async def _fake_clip(task: Task, on_progress: Any, cancel_check: Any, gate: Any) -> dict[str, Any]:
    """A clip as the extension sees it: real stages, measured progression, bytes; a real file of the right length."""
    params = task.params or {}
    fmt = params.get("fmt", "mp4")
    length = max(0.5, min(600.0, float(params["end_s"]) - float(params["start_s"])))
    total = int(length * 120_000)  # « octets reçus » simulés (~1 Mbit/s)
    pause = 2.0 if "slow-test" in task.url else 0.3
    for etape, stage, steps in (("analyse", "extracting", 1), ("recuperation", "downloading", 4),
                                ("conversion", "converting", 4), ("finalisation", "finalizing", 1)):
        for k in range(steps):
            if cancel_check is not None and await cancel_check():
                raise Cancelled()
            progression = (k + 1) / steps if steps > 1 else None
            received = 0 if etape == "analyse" else total if etape != "recuperation" else int(total * (k + 1) / steps)
            if on_progress is not None:
                on_progress({"type": "progress", "stage": stage, "percent": None, "etape": etape,
                             "progression": progression, "octets": received})
            await asyncio.sleep(pause)
        if etape == "analyse":
            if gate is not None:
                gate.release()
            if "fail-test" in task.url:
                raise ApiError(403, "private", "Vidéo privée (erreur simulée de préproduction).")
            if "partiel-impossible-test" in task.url:
                raise ApiError(422, "extrait_partiel_impossible", "Cette source ne permet pas de récupérer seulement le "
                                                                  "passage demandé (erreur simulée de préproduction).")
    dest = Path(task.workdir) / f"preprod.{fmt}"
    picture = ["-f", "lavfi", "-i", f"testsrc2=size=320x180:rate=15:duration={length:.3f}"]
    sound = ["-f", "lavfi", "-i", f"sine=frequency=440:beep_factor=4:duration={length:.3f}"]
    out = {"mp4": [*picture, *sound, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac",
                   "-movflags", "+faststart"],
           "mp3": [*sound, "-c:a", "libmp3lame", "-b:a", "128k"],
           "gif": [*picture, "-vf", "fps=12,scale=240:-2"]}[fmt]
    await asyncio.to_thread(subprocess.run, ["ffmpeg", "-loglevel", "error", "-y", *out, str(dest)], check=True,
                            timeout=300)
    start, end = float(params["start_s"]), float(params["end_s"])
    return {
        "filepath": str(dest),
        "download_name": f"Démonstration préproduction (extrait {int(start)}s-{int(end)}s).{fmt}",
        "media_type": {"mp4": "video/mp4", "mp3": "audio/mpeg", "gif": "image/gif"}[fmt],
        "title": "Démonstration préproduction",
        "id": "preprod",
        "ext": fmt,
        "size": dest.stat().st_size,
        "notes": ["préproduction : fichier factice"],
        "extrait": {"debutMs": int(round(start * 1000)), "finMs": int(round(end * 1000)),
                    "dureeMs": int(round((end - start) * 1000)), "methode": "partielle", "protocoles": ["https"],
                    "octetsTelecharges": total, "octetsAnnonces": total, "octetsSourceComplete": total * 50,
                    "requetes": 12, "dureeSourceS": None, "recuperationS": pause * 4},
    }


async def fake_run(task: Task, timeout_s: float, on_progress: Any = None, cancel_check: Any = None,
                   gate: Any = None) -> dict[str, Any]:
    params = task.params or {}
    if task.kind == "download" and params.get("start_s") is not None and params.get("end_s") is not None:
        return await _fake_clip(task, on_progress, cancel_check, gate)
    stages = ["extracting", "downloading", "converting", "finalizing"]
    for i, stage in enumerate(stages):
        if cancel_check is not None and await cancel_check():
            raise Cancelled()
        if on_progress is not None:
            on_progress({"type": "progress", "stage": stage, "percent": 100 * i / len(stages)})
        # « slow-test » dans l'URL : conversion d'environ 32 s, pour exercer le suivi (status_url?wait=20).
        await asyncio.sleep(8.0 if "slow-test" in task.url else 0.35)
    if gate is not None:
        gate.release()
    if task.kind == "derive":
        return await _real_run(task, timeout_s, on_progress, cancel_check, None)
    if "fail-test" in task.url:
        raise ApiError(403, "private", "Vidéo privée (erreur simulée de préproduction).")
    media = MediaUrl(url=task.url, host=urlsplit(task.url).hostname or "", platform=task.platform)
    ident = media_key(media).partition(":")[2] or "preprod"
    if task.kind == "info":
        return {"platform": task.platform, "id": ident, "title": "Démonstration préproduction", "media_count": 1}
    fmt = (task.params or {}).get("fmt", "mp4")
    src = _samples()["mp3" if fmt == "mp3" else "mp4"]
    ext = "mp3" if fmt == "mp3" else "mp4"
    dest = Path(task.workdir) / f"preprod.{ext}"
    shutil.copyfile(src, dest)
    title = "Démonstration préproduction"
    return {
        "filepath": str(dest),
        "download_name": f"{title} [{ident[:11]}].{ext}",
        "media_type": "audio/mpeg" if ext == "mp3" else "video/mp4",
        "title": "Démonstration préproduction",
        "id": ident,
        "ext": ext,
        "size": dest.stat().st_size,
        "notes": ["préproduction : fichier factice"],
    }


settings = load_settings()
runner = Runner(settings)
_real_run = runner._run  # derived files: real worker process (ffmpeg only)
runner._run = fake_run  # type: ignore[method-assign]  # wrapper (breaker, gates) stays real
_samples()
app = create_app(settings, runner)

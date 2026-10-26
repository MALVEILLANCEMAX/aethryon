# ytapi: FastAPI + yt-dlp + ffmpeg + deno, non-root, single uvicorn worker, read-only friendly.
ARG PYTHON_IMAGE=python:3.12-slim
# Static deno binary (yt-dlp's default JS runtime for YouTube challenges, see yt-dlp wiki "EJS").
# `make update` rebuilds with --pull, so the "bin" tag follows the latest deno release.
ARG DENO_IMAGE=denoland/deno:bin

FROM ${DENO_IMAGE} AS deno

FROM ${PYTHON_IMAGE} AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PATH=/opt/venv/bin:$PATH \
    HOME=/home/app \
    TMP_DIR=/data/tmp \
    CACHE_DIR=/data/cache

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deno /deno /usr/local/bin/deno

RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /home/app --create-home --shell /usr/sbin/nologin app \
    && python -m venv /opt/venv \
    && mkdir -p /data/tmp /data/cache /app \
    && chown app:app /data/tmp /data/cache

WORKDIR /app

# Everything below /opt/venv and /app is owned by root: the app user cannot modify code or
# packages (yt-dlp plugins are only loaded from the venv, see app/worker.py). The worker shares
# the app's uid, so this does not protect the mounted secrets from a compromised worker.
# yt-dlp is updated by rebuilding the image (`make update`).
COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt \
    && deno --version \
    && ffmpeg -hide_banner -version | head -n 1 \
    && python -c "import curl_cffi, yt_dlp_ejs, yt_dlp; print('yt-dlp', yt_dlp.version.__version__)"

COPY app /app/app
COPY entrypoint.sh /app/entrypoint.sh

USER app

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"]

ENTRYPOINT ["tini", "--", "/app/entrypoint.sh"]

# Preproduction image (`make preprod-image`): the runtime image + a fake worker that never touches
# the network and returns tiny local MP3/MP4 files. Never deployed: the "runtime" target is unchanged.
FROM runtime AS preprod
COPY preprod/fake_worker.py /app/preprod_fake.py
ENTRYPOINT ["tini", "--"]
CMD ["sh", "-c", "exec uvicorn preprod_fake:app --host 0.0.0.0 --port 8000 --workers 1 --proxy-headers --forwarded-allow-ips \"${FORWARDED_ALLOW_IPS:-127.0.0.1}\" --no-access-log --no-server-header --timeout-graceful-shutdown 10"]

# Test image: `make test` (runs offline, never part of the deployed image).
FROM runtime AS test
USER root
COPY requirements-dev.txt /app/requirements-dev.txt
RUN pip install -r /app/requirements-dev.txt
COPY tests /app/tests
# Only the test stage gets the host scripts (secrets helpers are tested, never shipped).
COPY scripts /app/scripts
USER app
ENTRYPOINT []
CMD ["python", "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests"]


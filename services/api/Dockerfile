# syntax=docker/dockerfile:1

# GeoDjango loads GDAL and GEOS at import time, and a platform build that only runs
# `uv sync` cannot install them, so the image is the single place that fixes the whole runtime.
ARG PYTHON_IMAGE=python:3.13-slim-bookworm

FROM ${PYTHON_IMAGE} AS base

# Runtime libraries only: Django finds `libgdal` and `libgeos_c` through the linker cache. Even
# `collectstatic` imports GeoDjango, so the build stage needs them too.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends libgdal32 libgeos-c1v5 \
    && rm -rf /var/lib/apt/lists/*


FROM base AS build

COPY --from=ghcr.io/astral-sh/uv:0.12.19 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# `--locked` fails the build when uv.lock no longer matches pyproject.toml.
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY . .

# The collected files depend on the installed apps and static finders, not on any secret, but the
# settings validate the whole production environment when they load. These placeholders satisfy
# that validation and are not copied into the image's environment.
RUN APP_ENV=production \
    DJANGO_SECRET_KEY=build-only-placeholder \
    DATABASE_URL=postgres://build:build@localhost:5432/build \
    ALLOWED_HOSTS=build.invalid \
    CORS_ALLOWED_ORIGIN=https://build.invalid \
    WEB_ORIGIN=https://build.invalid \
    PREVIEW_SIGNING_KEY=build-only-placeholder-preview-signing-key \
    TRUSTED_PROXY_HOPS=1 \
    MEDIA_STORE=s3 \
    MEDIA_PUBLIC_BASE_URL=https://build.invalid \
    MEDIA_S3_ENDPOINT_URL=https://build.invalid \
    MEDIA_S3_ACCESS_KEY_ID=build \
    MEDIA_S3_SECRET_ACCESS_KEY=build \
    MEDIA_PUBLIC_BUCKET=build-public \
    MEDIA_ORIGINALS_BUCKET=build-originals \
    .venv/bin/python manage.py collectstatic --noinput


FROM base AS runtime

RUN useradd --system --uid 10001 --home-dir /app --shell /usr/sbin/nologin serendipeak

WORKDIR /app
COPY --from=build --chown=serendipeak:serendipeak /app /app

ENV PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

USER serendipeak

# Exec form: Gunicorn is PID 1 and receives the platform's SIGTERM directly. It reads
# gunicorn.conf.py from the working directory, which also binds to $PORT.
CMD ["gunicorn", "config.wsgi:application"]

import os
from pathlib import Path
from urllib.parse import unquote, urlsplit

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

APP_ENV = os.environ.get("APP_ENV", "production")
DEBUG = APP_ENV == "development"

SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]
ALLOWED_HOSTS = [host for host in os.environ.get("ALLOWED_HOSTS", "").split(",") if host]


def database_from_url(url):
    parts = urlsplit(url)
    if parts.scheme not in ("postgres", "postgresql"):
        raise ImproperlyConfigured("DATABASE_URL must use the postgres scheme")
    return {
        "ENGINE": "django.contrib.gis.db.backends.postgis",
        "NAME": unquote(parts.path.lstrip("/")),
        "USER": unquote(parts.username or ""),
        "PASSWORD": unquote(parts.password or ""),
        "HOST": parts.hostname or "",
        "PORT": str(parts.port or ""),
        # libpq has no default connect timeout; /healthz must answer 503 within the v1 2 s budget.
        "OPTIONS": {"connect_timeout": 2},
    }


DATABASES = {"default": database_from_url(os.environ["DATABASE_URL"])}

if os.environ.get("GDAL_LIBRARY_PATH"):
    GDAL_LIBRARY_PATH = os.environ["GDAL_LIBRARY_PATH"]
if os.environ.get("GEOS_LIBRARY_PATH"):
    GEOS_LIBRARY_PATH = os.environ["GEOS_LIBRARY_PATH"]

INSTALLED_APPS = [
    "django.contrib.gis",
    "django.contrib.postgres",
    "corsheaders",
    "rest_framework",
    "serendipeak.persistence",
    "serendipeak.cli",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

# Contract paths have no trailing slash, and v1 answers unknown paths with 404, never a redirect.
APPEND_SLASH = False

CORS_ALLOWED_ORIGIN = os.environ["CORS_ALLOWED_ORIGIN"]
if not CORS_ALLOWED_ORIGIN or "*" in CORS_ALLOWED_ORIGIN or "," in CORS_ALLOWED_ORIGIN:
    raise ImproperlyConfigured("CORS_ALLOWED_ORIGIN must be exactly one explicit origin")
CORS_ALLOWED_ORIGINS = [CORS_ALLOWED_ORIGIN]
CORS_ALLOW_METHODS = ["GET", "OPTIONS"]

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

USE_TZ = True
TIME_ZONE = "UTC"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    "DEFAULT_THROTTLE_CLASSES": [],
    "UNAUTHENTICATED_USER": None,
    "DEFAULT_RENDERER_CLASSES": ["serendipeak.httpapi.renderers.ContractJSONRenderer"],
    "DEFAULT_PARSER_CLASSES": [],
    "DEFAULT_CONTENT_NEGOTIATION_CLASS": "serendipeak.httpapi.negotiation.JsonOnlyNegotiation",
    "EXCEPTION_HANDLER": "serendipeak.httpapi.errors.api_exception_handler",
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "readable": {"format": "{asctime} {levelname} {name} {message}", "style": "{"},
        "json_line": {"()": "config.logging.JsonLineFormatter"},
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "readable" if DEBUG else "json_line",
        },
    },
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {
        "django": {"level": "INFO"},
        # Django logs every 4xx as a warning; an unknown slug is an expected answer, not a fault.
        "django.request": {"level": "ERROR"},
    },
}

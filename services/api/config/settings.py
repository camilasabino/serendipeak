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
    "django.contrib.contenttypes",
    "config.apps.UsersConfig",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # No autodiscovery: config.admin builds the one admin site and injects the use cases.
    "django.contrib.admin.apps.SimpleAdminConfig",
    "corsheaders",
    "rest_framework",
    "serendipeak.persistence",
    "serendipeak.cli",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
]

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "config" / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": f"django.contrib.auth.password_validation.{name}"}
    for name in (
        "UserAttributeSimilarityValidator",
        "MinimumLengthValidator",
        "CommonPasswordValidator",
        "NumericPasswordValidator",
    )
]

# Only the admin sets cookies. They carry the editor's identity, so they never travel over
# plain HTTP outside local development.
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"

STATIC_URL = "static/"

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

# Contract paths have no trailing slash, and v1 answers unknown paths with 404, never a redirect.
APPEND_SLASH = False

CORS_ALLOWED_ORIGIN = os.environ["CORS_ALLOWED_ORIGIN"]
if not CORS_ALLOWED_ORIGIN or "*" in CORS_ALLOWED_ORIGIN or "," in CORS_ALLOWED_ORIGIN:
    raise ImproperlyConfigured("CORS_ALLOWED_ORIGIN must be exactly one explicit origin")
CORS_ALLOWED_ORIGINS = [CORS_ALLOWED_ORIGIN]
CORS_ALLOW_METHODS = ["GET", "OPTIONS"]

MEDIA_STORES = ("filesystem", "s3")


def required_setting(name):
    value = os.environ.get(name, "")
    if not value:
        raise ImproperlyConfigured(f"{name} is required when MEDIA_STORE is {MEDIA_STORE}")
    return value


def media_base_url(name, *, allow_http):
    value = os.environ.get(name, "")
    parts = urlsplit(value)
    schemes = ("https", "http") if allow_http else ("https",)
    if (
        parts.scheme not in schemes
        or not parts.hostname
        or parts.username is not None
        or parts.query
        or parts.fragment
        or value.endswith("/")
    ):
        raise ImproperlyConfigured(
            f"{name} must be an {' or '.join(schemes)} URL without credentials, query, "
            "fragment or trailing slash"
        )
    return value


MEDIA_STORE = os.environ.get("MEDIA_STORE", "")
if MEDIA_STORE not in MEDIA_STORES:
    raise ImproperlyConfigured(f"MEDIA_STORE must be one of: {', '.join(MEDIA_STORES)}")

MEDIA_PUBLIC_BASE_URL = media_base_url("MEDIA_PUBLIC_BASE_URL", allow_http=DEBUG)

if MEDIA_STORE == "filesystem":
    # Production photographs live in R2. A filesystem store there would be ephemeral (the
    # deployment has no volume) and every redeploy would silently discard uploaded media.
    if not DEBUG:
        raise ImproperlyConfigured(
            "MEDIA_STORE=filesystem is only allowed when APP_ENV=development"
        )

    # Relative to the service directory, so the media location does not depend on where the
    # process was started from.
    MEDIA_ROOT = BASE_DIR / required_setting("MEDIA_ROOT")
else:
    MEDIA_S3_ENDPOINT_URL = media_base_url("MEDIA_S3_ENDPOINT_URL", allow_http=False)
    MEDIA_S3_ACCESS_KEY_ID = required_setting("MEDIA_S3_ACCESS_KEY_ID")
    MEDIA_S3_SECRET_ACCESS_KEY = required_setting("MEDIA_S3_SECRET_ACCESS_KEY")
    MEDIA_PUBLIC_BUCKET = required_setting("MEDIA_PUBLIC_BUCKET")
    MEDIA_ORIGINALS_BUCKET = required_setting("MEDIA_ORIGINALS_BUCKET")
    if MEDIA_PUBLIC_BUCKET == MEDIA_ORIGINALS_BUCKET:
        raise ImproperlyConfigured("MEDIA_PUBLIC_BUCKET and MEDIA_ORIGINALS_BUCKET must differ")

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

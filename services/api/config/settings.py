import os
from pathlib import Path
from urllib.parse import unquote, urlsplit

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

APP_ENV = os.environ.get("APP_ENV", "production")
DEBUG = APP_ENV == "development"

SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]
ALLOWED_HOSTS = [host for host in os.environ.get("ALLOWED_HOSTS", "").split(",") if host]
FORBIDDEN_HOST_CHARACTERS = frozenset("*/:@ ")
# An empty list in production makes every request answer 400, the platform's health check
# included, and a wildcard accepts any Host header; both are refused at startup instead.
if not DEBUG and (
    not ALLOWED_HOSTS
    or any(
        FORBIDDEN_HOST_CHARACTERS & set(host) or host.startswith(".") or not host.isascii()
        for host in ALLOWED_HOSTS
    )
):
    raise ImproperlyConfigured(
        "ALLOWED_HOSTS must list the exact host names served, without wildcards, "
        "leading dots, ports or schemes"
    )


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
    "django.contrib.auth",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "serendipeak.persistence",
    "serendipeak.cli",
    "serendipeak.studio",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "serendipeak.studio.middleware.StudioSecurityHeadersMiddleware",
    "serendipeak.studio.middleware.LegacyCookieCleanupMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "serendipeak.studio.middleware.StudioAccessMiddleware",
]

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
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

AUTH_USER_MODEL = "catalog.UserRecord"

PASSWORD_MINIMUM_LENGTH = 8
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": f"django.contrib.auth.password_validation.{name}", **options}
    for name, options in (
        ("UserAttributeSimilarityValidator", {}),
        ("MinimumLengthValidator", {"OPTIONS": {"min_length": PASSWORD_MINIMUM_LENGTH}}),
        ("CommonPasswordValidator", {}),
        ("NumericPasswordValidator", {}),
    )
]

LOGIN_URL = "studio:login"
LOGIN_REDIRECT_URL = "studio:landing"

# Only the Studio sets cookies. They carry the editor's identity, so they never travel over plain
# HTTP outside local development, and they are scoped to the Studio's path so that the public API
# and the health check never receive them. The names differ from the framework defaults on
# purpose: an earlier deployment issued "sessionid" and "csrftoken" for the whole site, and a
# browser still holding those would send both to the Studio, where the one with the wider path
# can shadow the new one. Under their own names the old cookies are never read, and the Studio
# expires them (LegacyCookieCleanupMiddleware).
SESSION_COOKIE_NAME = "studio_sessionid"
CSRF_COOKIE_NAME = "studio_csrftoken"
SESSION_COOKIE_PATH = "/studio/"
CSRF_COOKIE_PATH = "/studio/"
LEGACY_COOKIE_NAMES = ("sessionid", "csrftoken")
SESSION_COOKIE_AGE = 12 * 60 * 60
CSRF_FAILURE_VIEW = "serendipeak.studio.views.csrf_failure"
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"

STATIC_URL = "static/"


def non_negative_integer(name):
    value = os.environ.get(name, "0")
    if not value.isascii() or not value.isdecimal():
        raise ImproperlyConfigured(f"{name} must be a non-negative integer")

    return int(value)


# How many reverse proxies in front of the service append to X-Forwarded-For. Zero ignores the
# header, which is the only safe reading when nothing in front of the service is known to set it:
# the address that login throttling counts would otherwise be chosen by the client.
TRUSTED_PROXY_HOPS = non_negative_integer("TRUSTED_PROXY_HOPS")

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

# Contract paths have no trailing slash, and v1 answers unknown paths with 404, never a redirect.
APPEND_SLASH = False

CORS_ALLOWED_ORIGIN = os.environ["CORS_ALLOWED_ORIGIN"]
if not CORS_ALLOWED_ORIGIN or "*" in CORS_ALLOWED_ORIGIN or "," in CORS_ALLOWED_ORIGIN:
    raise ImproperlyConfigured("CORS_ALLOWED_ORIGIN must be exactly one explicit origin")
CORS_ALLOWED_ORIGINS = [CORS_ALLOWED_ORIGIN]
CORS_ALLOW_METHODS = ["GET", "OPTIONS"]


def explicit_origin(name, value, *, allow_http):
    schemes = ("https", "http") if allow_http else ("https",)
    parts = urlsplit(value)
    try:
        parts.port  # noqa: B018 - reading it is what validates a malformed port
    except ValueError:
        parts = None
    # Studio links are built by appending a path, so anything but a bare origin would corrupt them.
    if (
        parts is None
        or parts.scheme not in schemes
        or not parts.hostname
        or parts.username is not None
        or "*" in value
        or "," in value
        or value != f"{parts.scheme}://{parts.netloc}"
    ):
        raise ImproperlyConfigured(
            f"{name} must be exactly one explicit {' or '.join(schemes)} origin "
            "(scheme, host and optional port; no path, credentials, query or trailing slash)"
        )
    return value


def web_origin(name, *, allow_http):
    return explicit_origin(name, os.environ.get(name, ""), allow_http=allow_http)


def explicit_origins(name, *, allow_http):
    entries = [entry for entry in os.environ.get(name, "").split(",") if entry]

    return [explicit_origin(name, entry, allow_http=allow_http) for entry in entries]


# Where the visual camera editor is served. Deliberately independent of CORS_ALLOWED_ORIGIN: the
# two answer different questions (who may read the API, where the Studio sends editors) and may
# diverge.
WEB_ORIGIN = web_origin("WEB_ORIGIN", allow_http=DEBUG)

# Behind a TLS-terminating proxy the service receives plain HTTP, and the framework then expects
# "Origin: http://host" from a form that the browser posted to "https://host", so every Studio
# POST fails the CSRF check. The proxy's X-Forwarded-Proto is believed only when a trusted proxy
# is declared, because anything that reaches the service without passing through the proxy
# (another service over a private network, for instance) can send that header itself. Nothing
# configured here trusts X-Forwarded-Host, so the Host header stays what ALLOWED_HOSTS judges.
FORWARDED_PROTO_TRUSTED = TRUSTED_PROXY_HOPS > 0
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https") if FORWARDED_PROTO_TRUSTED else None

# An explicit list of origins whose form posts are accepted, for a deployment whose proxy cannot
# be trusted to declare HTTPS. Exact origins only: there is no wildcard form.
CSRF_TRUSTED_ORIGINS = explicit_origins("CSRF_TRUSTED_ORIGINS", allow_http=DEBUG)
if not DEBUG and not (FORWARDED_PROTO_TRUSTED or CSRF_TRUSTED_ORIGINS):
    raise ImproperlyConfigured(
        "Production needs HTTPS to be recognised: set TRUSTED_PROXY_HOPS to the number of "
        "proxies in front of the service, or CSRF_TRUSTED_ORIGINS to the public origin. "
        "Without either, every Studio form post is refused"
    )


def boolean_setting(name, *, default):
    value = os.environ.get(name)
    if value is None or value == "":
        return default
    if value not in ("0", "1"):
        raise ImproperlyConfigured(f"{name} must be 0 or 1")

    return value == "1"


# Redirecting needs to know which requests were already HTTPS. Without a trusted proxy header
# every request would look insecure and the redirect would never end, so it is refused rather
# than allowed to loop. The platform health check calls over plain HTTP and is exempt.
SECURE_SSL_REDIRECT = boolean_setting(
    "SECURE_SSL_REDIRECT", default=FORWARDED_PROTO_TRUSTED and not DEBUG
)
if SECURE_SSL_REDIRECT and not FORWARDED_PROTO_TRUSTED:
    raise ImproperlyConfigured(
        "SECURE_SSL_REDIRECT requires TRUSTED_PROXY_HOPS above 0, or it would redirect forever"
    )
SECURE_REDIRECT_EXEMPT = [r"^healthz$"]

# Browsers remember HSTS for the whole period and for every path of the host, so it is opt-in and
# meant to be raised in steps. The framework sends it on secure requests only, which without a
# trusted proxy header means never; that silent no-op is refused.
SECURE_HSTS_SECONDS = non_negative_integer("SECURE_HSTS_SECONDS")
if SECURE_HSTS_SECONDS and (DEBUG or not FORWARDED_PROTO_TRUSTED):
    raise ImproperlyConfigured(
        "SECURE_HSTS_SECONDS needs a production deployment with TRUSTED_PROXY_HOPS above 0"
    )
SECURE_HSTS_INCLUDE_SUBDOMAINS = False
SECURE_HSTS_PRELOAD = False

# The security middleware only redirects and sends HSTS. Its other response headers would reach
# the public API, whose headers are part of the contract; the Studio sets its own.
SECURE_CONTENT_TYPE_NOSNIFF = False
SECURE_REFERRER_POLICY = None
SECURE_CROSS_ORIGIN_OPENER_POLICY = None

# Signs the draft-preview tokens. Kept apart from SECRET_KEY so that rotating one never decides
# the other: changing it ends every outstanding preview and nothing else.
PREVIEW_SIGNING_KEY = os.environ.get("PREVIEW_SIGNING_KEY", "")
if len(PREVIEW_SIGNING_KEY) < 32 or PREVIEW_SIGNING_KEY == SECRET_KEY:
    raise ImproperlyConfigured(
        "PREVIEW_SIGNING_KEY must be at least 32 characters and differ from DJANGO_SECRET_KEY"
    )

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
        "readable": {
            "()": "config.logging.ReadableFormatter",
            "format": "{asctime} {levelname} {name} {message}",
            "style": "{",
        },
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

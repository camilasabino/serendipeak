from pathlib import Path
from runpy import run_path

import pytest
from django.conf import settings

SETTINGS_FILE = Path(__file__).resolve().parents[2] / "config" / "settings.py"
MEDIA_ENVIRONMENT = {
    "MEDIA_STORE": "s3",
    "MEDIA_PUBLIC_BASE_URL": "https://media.example",
    "MEDIA_S3_ENDPOINT_URL": "https://account.r2.cloudflarestorage.example",
    "MEDIA_S3_ACCESS_KEY_ID": "access-key",
    "MEDIA_S3_SECRET_ACCESS_KEY": "secret-key",
    "MEDIA_PUBLIC_BUCKET": "photographs-public",
    "MEDIA_ORIGINALS_BUCKET": "photographs-originals",
}


def test_the_admin_stack_is_installed_without_autodiscovering_the_default_site():
    for app in (
        "django.contrib.admin.apps.SimpleAdminConfig",
        "config.apps.UsersConfig",
        "django.contrib.contenttypes",
        "django.contrib.sessions",
        "django.contrib.messages",
    ):
        assert app in settings.INSTALLED_APPS
    assert "django.contrib.admin" not in settings.INSTALLED_APPS


def test_session_csrf_and_message_middleware_run_after_cors_and_before_the_views():
    middleware = settings.MIDDLEWARE

    assert middleware[0] == "corsheaders.middleware.CorsMiddleware"
    for name in (
        "django.contrib.sessions.middleware.SessionMiddleware",
        "django.middleware.csrf.CsrfViewMiddleware",
        "django.contrib.auth.middleware.AuthenticationMiddleware",
        "django.contrib.messages.middleware.MessageMiddleware",
    ):
        assert name in middleware
    assert middleware.index("django.contrib.sessions.middleware.SessionMiddleware") < (
        middleware.index("django.contrib.auth.middleware.AuthenticationMiddleware")
    )


def test_passwords_are_validated():
    assert len(settings.AUTH_PASSWORD_VALIDATORS) >= 4


def test_cookies_are_http_only_and_same_site():
    assert settings.SESSION_COOKIE_HTTPONLY is True
    assert settings.CSRF_COOKIE_HTTPONLY is True
    assert settings.SESSION_COOKIE_SAMESITE == "Lax"
    assert settings.CSRF_COOKIE_SAMESITE == "Lax"


@pytest.mark.parametrize(("app_env", "secure"), [("production", True), ("development", False)])
def test_cookies_are_secure_outside_development(monkeypatch, app_env, secure):
    monkeypatch.setenv("APP_ENV", app_env)
    for name, value in MEDIA_ENVIRONMENT.items():
        monkeypatch.setenv(name, value)

    loaded = run_path(str(SETTINGS_FILE))

    assert loaded["SESSION_COOKIE_SECURE"] is secure
    assert loaded["CSRF_COOKIE_SECURE"] is secure

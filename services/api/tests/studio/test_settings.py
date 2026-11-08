from pathlib import Path
from runpy import run_path

import pytest
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

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


@pytest.fixture
def load_settings(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("WEB_ORIGIN", "https://web.example")
    monkeypatch.setenv("PREVIEW_SIGNING_KEY", "p" * 40)
    for name, value in MEDIA_ENVIRONMENT.items():
        monkeypatch.setenv(name, value)

    return lambda: run_path(str(SETTINGS_FILE))


def test_sign_in_and_landing_are_the_named_studio_routes():
    assert settings.LOGIN_URL == "studio:login"
    assert settings.LOGIN_REDIRECT_URL == "studio:landing"


def test_the_session_lasts_twelve_hours():
    assert settings.SESSION_COOKIE_AGE == 12 * 60 * 60
    assert settings.SESSION_SAVE_EVERY_REQUEST is False
    assert settings.SESSION_EXPIRE_AT_BROWSER_CLOSE is False


def test_the_studio_is_an_installed_app_and_its_middleware_brackets_the_framework_ones():
    middleware = settings.MIDDLEWARE
    headers = "serendipeak.studio.middleware.StudioSecurityHeadersMiddleware"
    access = "serendipeak.studio.middleware.StudioAccessMiddleware"

    assert "serendipeak.studio" in settings.INSTALLED_APPS
    assert middleware.index(headers) < middleware.index("django.middleware.common.CommonMiddleware")
    assert middleware.index(access) > middleware.index(
        "django.contrib.auth.middleware.AuthenticationMiddleware"
    )
    assert middleware.index(access) > middleware.index(
        "django.contrib.messages.middleware.MessageMiddleware"
    )
    assert middleware.index(access) > middleware.index("django.middleware.csrf.CsrfViewMiddleware")


def test_csrf_failures_render_inside_the_studio():
    assert settings.CSRF_FAILURE_VIEW == "serendipeak.studio.views.csrf_failure"


def test_no_proxy_is_trusted_by_default():
    assert settings.TRUSTED_PROXY_HOPS == 0


@pytest.mark.parametrize(("value", "expected"), [("0", 0), ("1", 1), ("2", 2)])
def test_the_number_of_trusted_proxies_is_read_from_the_environment(
    load_settings, monkeypatch, value, expected
):
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", value)

    assert load_settings()["TRUSTED_PROXY_HOPS"] == expected


@pytest.mark.parametrize("value", ["", "-1", "one", "1.5", "²"])
def test_a_malformed_number_of_trusted_proxies_is_refused(load_settings, monkeypatch, value):
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", value)

    with pytest.raises(ImproperlyConfigured, match="TRUSTED_PROXY_HOPS"):
        load_settings()


def test_the_preview_signing_key_is_read_from_the_environment(load_settings, monkeypatch):
    monkeypatch.setenv("PREVIEW_SIGNING_KEY", "a-dedicated-preview-key-of-sufficient-length")

    assert load_settings()["PREVIEW_SIGNING_KEY"] == "a-dedicated-preview-key-of-sufficient-length"


@pytest.mark.parametrize("value", ["", "short", "x" * 31])
def test_a_missing_or_short_preview_signing_key_is_refused(load_settings, monkeypatch, value):
    monkeypatch.setenv("PREVIEW_SIGNING_KEY", value)

    with pytest.raises(ImproperlyConfigured, match="PREVIEW_SIGNING_KEY"):
        load_settings()


def test_an_absent_preview_signing_key_is_refused(load_settings, monkeypatch):
    monkeypatch.delenv("PREVIEW_SIGNING_KEY")

    with pytest.raises(ImproperlyConfigured, match="PREVIEW_SIGNING_KEY"):
        load_settings()


def test_the_preview_signing_key_cannot_be_the_secret_key(load_settings, monkeypatch):
    monkeypatch.setenv("DJANGO_SECRET_KEY", "s" * 50)
    monkeypatch.setenv("PREVIEW_SIGNING_KEY", "s" * 50)

    with pytest.raises(ImproperlyConfigured, match="PREVIEW_SIGNING_KEY"):
        load_settings()

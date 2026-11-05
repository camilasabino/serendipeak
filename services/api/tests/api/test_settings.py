from pathlib import Path
from runpy import run_path

import pytest
from django.core.exceptions import ImproperlyConfigured
from django.db import connection
from rest_framework.permissions import AllowAny
from rest_framework.settings import api_settings

from serendipeak.httpapi.errors import api_exception_handler
from serendipeak.httpapi.negotiation import JsonOnlyNegotiation
from serendipeak.httpapi.renderers import ContractJSONRenderer


def test_the_api_is_anonymous_unthrottled_and_read_only():
    assert api_settings.DEFAULT_AUTHENTICATION_CLASSES == []
    assert api_settings.DEFAULT_PERMISSION_CLASSES == [AllowAny]
    assert api_settings.DEFAULT_THROTTLE_CLASSES == []
    assert api_settings.UNAUTHENTICATED_USER is None
    assert api_settings.DEFAULT_PARSER_CLASSES == []


def test_responses_are_contract_json_and_errors_use_the_envelope_handler():
    assert api_settings.DEFAULT_RENDERER_CLASSES == [ContractJSONRenderer]
    assert api_settings.DEFAULT_CONTENT_NEGOTIATION_CLASS is JsonOnlyNegotiation
    assert api_settings.EXCEPTION_HANDLER is api_exception_handler


def test_requests_run_in_autocommit_so_the_daily_insert_commits_on_its_own():
    assert connection.settings_dict["ATOMIC_REQUESTS"] is False
    assert connection.settings_dict["AUTOCOMMIT"] is True


SETTINGS_FILE = Path(__file__).resolve().parents[2] / "config" / "settings.py"


@pytest.mark.parametrize(
    "value",
    [
        "",
        "*",
        "https://*.example",
        "https://a.example,https://b.example",
        "https://a.example,",
    ],
)
def test_the_cors_origin_must_be_exactly_one_explicit_origin(monkeypatch, value):
    monkeypatch.setenv("CORS_ALLOWED_ORIGIN", value)

    with pytest.raises(ImproperlyConfigured, match="CORS_ALLOWED_ORIGIN"):
        run_path(str(SETTINGS_FILE))


def test_a_single_explicit_origin_is_accepted(monkeypatch):
    monkeypatch.setenv("CORS_ALLOWED_ORIGIN", "https://app.example")

    loaded = run_path(str(SETTINGS_FILE))

    assert loaded["CORS_ALLOWED_ORIGINS"] == ["https://app.example"]


S3_ENVIRONMENT = {
    "MEDIA_STORE": "s3",
    "MEDIA_PUBLIC_BASE_URL": "https://media.example",
    "MEDIA_S3_ENDPOINT_URL": "https://account.r2.cloudflarestorage.example",
    "MEDIA_S3_ACCESS_KEY_ID": "access-key",
    "MEDIA_S3_SECRET_ACCESS_KEY": "secret-key",
    "MEDIA_PUBLIC_BUCKET": "photographs-public",
    "MEDIA_ORIGINALS_BUCKET": "photographs-originals",
}


def load_settings(monkeypatch, **environment):
    for name, value in environment.items():
        if value is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, value)

    return run_path(str(SETTINGS_FILE))


@pytest.mark.parametrize("value", [None, "", "memory", "S3"])
def test_the_media_store_must_be_chosen_explicitly(monkeypatch, value):
    with pytest.raises(ImproperlyConfigured, match="MEDIA_STORE"):
        load_settings(monkeypatch, MEDIA_STORE=value)


def test_the_filesystem_store_keeps_media_under_the_service_directory(monkeypatch):
    loaded = load_settings(
        monkeypatch,
        APP_ENV="development",
        MEDIA_STORE="filesystem",
        MEDIA_ROOT=".media",
        MEDIA_PUBLIC_BASE_URL="http://localhost:8000/media",
    )

    assert loaded["MEDIA_ROOT"] == SETTINGS_FILE.parents[1] / ".media"
    assert loaded["MEDIA_PUBLIC_BASE_URL"] == "http://localhost:8000/media"


def test_the_filesystem_store_needs_a_media_root(monkeypatch):
    with pytest.raises(ImproperlyConfigured, match="MEDIA_ROOT"):
        load_settings(monkeypatch, MEDIA_STORE="filesystem", MEDIA_ROOT=None)


@pytest.mark.parametrize(
    ("app_env", "value"),
    [
        ("development", None),
        ("development", "localhost:8000/media"),
        ("development", "ftp://media.example"),
        ("development", "http://localhost:8000/media/"),
        ("development", "https://user:password@media.example"),
        ("development", "https://media.example?version=1"),
        ("development", "https://media.example#top"),
        ("production", "http://media.example"),
    ],
)
def test_the_public_media_url_is_https_outside_development(monkeypatch, app_env, value):
    with pytest.raises(ImproperlyConfigured, match="MEDIA_PUBLIC_BASE_URL"):
        load_settings(
            monkeypatch,
            APP_ENV=app_env,
            MEDIA_STORE="filesystem",
            MEDIA_PUBLIC_BASE_URL=value,
        )


@pytest.mark.parametrize("app_env", [None, "production", "staging"])
def test_the_filesystem_store_is_rejected_outside_development(monkeypatch, app_env):
    with pytest.raises(ImproperlyConfigured, match="MEDIA_STORE=filesystem"):
        load_settings(
            monkeypatch,
            APP_ENV=app_env,
            MEDIA_STORE="filesystem",
            MEDIA_ROOT=".media",
            MEDIA_PUBLIC_BASE_URL="https://media.example",
        )


def test_the_s3_store_reads_its_endpoint_buckets_and_credentials(monkeypatch):
    loaded = load_settings(monkeypatch, APP_ENV="production", **S3_ENVIRONMENT)

    assert {name: loaded[name] for name in S3_ENVIRONMENT} == S3_ENVIRONMENT


@pytest.mark.parametrize(
    "name",
    [
        "MEDIA_S3_ENDPOINT_URL",
        "MEDIA_S3_ACCESS_KEY_ID",
        "MEDIA_S3_SECRET_ACCESS_KEY",
        "MEDIA_PUBLIC_BUCKET",
        "MEDIA_ORIGINALS_BUCKET",
    ],
)
def test_the_s3_store_fails_at_startup_without_its_settings(monkeypatch, name):
    with pytest.raises(ImproperlyConfigured, match=name):
        load_settings(monkeypatch, **{**S3_ENVIRONMENT, name: None})


def test_the_s3_endpoint_must_be_https(monkeypatch):
    environment = {**S3_ENVIRONMENT, "MEDIA_S3_ENDPOINT_URL": "http://localhost:9000"}

    with pytest.raises(ImproperlyConfigured, match="MEDIA_S3_ENDPOINT_URL"):
        load_settings(monkeypatch, APP_ENV="development", **environment)


def test_originals_and_public_media_need_separate_buckets(monkeypatch):
    environment = {**S3_ENVIRONMENT, "MEDIA_ORIGINALS_BUCKET": "photographs-public"}

    with pytest.raises(ImproperlyConfigured, match="must differ"):
        load_settings(monkeypatch, **environment)

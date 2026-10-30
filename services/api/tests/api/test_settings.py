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

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

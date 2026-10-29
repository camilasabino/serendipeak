import pytest
from corsheaders.conf import conf
from django.conf import settings

pytestmark = pytest.mark.django_db


def test_configured_origin_is_the_only_allowed_origin():
    assert settings.CORS_ALLOWED_ORIGINS == [settings.CORS_ALLOWED_ORIGIN]
    assert "*" not in settings.CORS_ALLOWED_ORIGINS
    assert conf.CORS_ALLOW_ALL_ORIGINS is False


def test_allowed_origin_is_echoed_and_varies(client):
    response = client.get("/healthz", headers={"Origin": settings.CORS_ALLOWED_ORIGIN})

    assert response["Access-Control-Allow-Origin"] == settings.CORS_ALLOWED_ORIGIN
    assert "origin" in response["Vary"].lower()


def test_other_origin_gets_no_cors_headers(client):
    response = client.get("/healthz", headers={"Origin": "https://evil.example"})

    assert "Access-Control-Allow-Origin" not in response

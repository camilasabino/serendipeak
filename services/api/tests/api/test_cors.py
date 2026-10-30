import json

import pytest
from django.conf import settings

from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.mountain_repository import DjangoMountainRepository
from tests.support.catalog import committed_seed
from tests.support.contract_fixtures import load_fixture

pytestmark = pytest.mark.django_db

OTHER_ORIGIN = "https://evil.example"
CONTRACT_PATHS = [
    "/healthz",
    "/api/v1/mountains/aconcagua",
    "/api/v1/mountains/random",
    "/api/v1/mountains/today",
]


@pytest.fixture
def catalog():
    DjangoCatalogStore().load(committed_seed())


def vary_tokens(response):
    return {token.strip().lower() for token in response.get("Vary", "").split(",")}


def preflight(client, path, origin, method="GET"):
    return client.options(
        path,
        headers={"Origin": origin, "Access-Control-Request-Method": method},
    )


@pytest.mark.parametrize("path", CONTRACT_PATHS)
def test_the_configured_origin_is_echoed_and_varies(catalog, client, path):
    response = client.get(path, headers={"Origin": settings.CORS_ALLOWED_ORIGIN})

    assert response.status_code == 200
    assert response["Access-Control-Allow-Origin"] == settings.CORS_ALLOWED_ORIGIN
    assert "origin" in vary_tokens(response)


@pytest.mark.parametrize("path", CONTRACT_PATHS)
def test_another_origin_gets_no_cors_headers_but_still_varies(catalog, client, path):
    response = client.get(path, headers={"Origin": OTHER_ORIGIN})

    assert response.status_code == 200
    assert not [name for name in response.headers if name.lower().startswith("access-control-")]
    assert "origin" in vary_tokens(response)


@pytest.mark.parametrize("path", CONTRACT_PATHS)
def test_a_request_without_origin_gets_no_cors_headers_but_still_varies(catalog, client, path):
    response = client.get(path)

    assert "Access-Control-Allow-Origin" not in response
    assert "origin" in vary_tokens(response)


@pytest.mark.parametrize(
    ("path", "fixture"),
    [
        ("/api/v1/mountains/unknown-peak", "error-mountain-not-found.json"),
        ("/api/v1/mountains/aconcagua/", None),
    ],
)
def test_error_responses_carry_the_cors_headers(catalog, client, path, fixture):
    response = client.get(path, headers={"Origin": settings.CORS_ALLOWED_ORIGIN})

    assert response.status_code == 404
    assert response["Access-Control-Allow-Origin"] == settings.CORS_ALLOWED_ORIGIN
    assert "origin" in vary_tokens(response)
    if fixture is not None:
        assert json.loads(response.content) == load_fixture(fixture)


def test_a_server_error_response_carries_the_cors_headers(client, monkeypatch):
    def fail(self, slug):
        raise RuntimeError("boom")

    monkeypatch.setattr(DjangoMountainRepository, "find_public_by_slug", fail)

    response = client.get(
        "/api/v1/mountains/aconcagua",
        headers={"Origin": settings.CORS_ALLOWED_ORIGIN},
    )

    assert response.status_code == 500
    assert response["Access-Control-Allow-Origin"] == settings.CORS_ALLOWED_ORIGIN
    assert "origin" in vary_tokens(response)


@pytest.mark.parametrize("path", CONTRACT_PATHS)
def test_the_preflight_of_the_configured_origin_allows_get_and_options_only(client, path):
    response = preflight(client, path, settings.CORS_ALLOWED_ORIGIN)

    assert response["Access-Control-Allow-Origin"] == settings.CORS_ALLOWED_ORIGIN
    allowed = {method.strip() for method in response["Access-Control-Allow-Methods"].split(",")}
    assert allowed == {"GET", "OPTIONS"}
    assert "origin" in vary_tokens(response)


def test_the_preflight_of_another_origin_is_not_granted(client):
    response = preflight(client, "/api/v1/mountains/random", OTHER_ORIGIN)

    assert not [name for name in response.headers if name.lower().startswith("access-control-")]
    assert "origin" in vary_tokens(response)


@pytest.mark.parametrize("origin", [OTHER_ORIGIN, "null", "https://*.example"])
def test_no_origin_is_ever_answered_with_a_wildcard(catalog, client, origin):
    for response in (
        client.get("/api/v1/mountains/random", headers={"Origin": origin}),
        preflight(client, "/api/v1/mountains/random", origin),
    ):
        assert response.headers.get("Access-Control-Allow-Origin") != "*"
        assert "Access-Control-Allow-Origin" not in response

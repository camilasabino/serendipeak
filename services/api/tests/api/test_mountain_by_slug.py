import json
import logging

import pytest
from django.conf import settings
from django.db import OperationalError, connection
from django.urls import Resolver404, resolve
from rest_framework.test import APIRequestFactory

from serendipeak.catalog.bootstrap.ports import CatalogMountain
from serendipeak.catalog.entities import MountainStatus
from serendipeak.errors import ApplicationError, InfrastructureError
from serendipeak.httpapi.views import MountainBySlugView, RandomMountainView, TodaysMountainView
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from tests.support.catalog import (
    CREATED_AT,
    UPDATED_AT,
    bare_mountain,
    catalog_mountain,
    catalog_of,
    fixture_catalog_with_media,
    media_of,
)
from tests.support.contract_fixtures import load_fixture, served_by_serendipeak
from tests.support.geography import continent, countries, country

CONTENT_TYPE = "application/json; charset=utf-8"
NOT_FOUND = load_fixture("error-mountain-not-found.json")
INTERNAL = load_fixture("error-internal.json")


@pytest.fixture
def catalog(db):
    bare = CatalogMountain(
        mountain=bare_mountain(),
        created_at=CREATED_AT,
        updated_at=UPDATED_AT,
    )
    draft = catalog_mountain("draft-peak", status=MountainStatus.DRAFT)

    DjangoCatalogStore().load(catalog_of(*fixture_catalog_with_media().mountains, bare, draft))


def body(response):
    return json.loads(response.content)


@pytest.mark.parametrize(
    ("slug", "fixture"),
    [
        ("aconcagua", "mountain-complete.json"),
        ("mount-olympus", "mountain-sparse.json"),
        ("bare-peak", "mountain-minimal.json"),
    ],
)
def test_a_public_mountain_matches_its_fixture(catalog, client, slug, fixture):
    response = client.get(f"/api/v1/mountains/{slug}")

    assert response.status_code == 200
    assert response["Content-Type"] == CONTENT_TYPE
    assert "Cache-Control" not in response
    assert body(response) == served_by_serendipeak(
        load_fixture(fixture), settings.MEDIA_PUBLIC_BASE_URL, media_of
    )


def test_non_ascii_text_is_served_unescaped(catalog, client):
    response = client.get("/api/v1/mountains/aconcagua")

    assert "Bjørn Christian Tørrissen".encode() in response.content


def test_a_lookup_is_three_queries_and_an_unknown_slug_one(
    catalog, client, django_assert_num_queries
):
    with django_assert_num_queries(3):
        assert client.get("/api/v1/mountains/aconcagua").status_code == 200

    with django_assert_num_queries(1):
        assert client.get("/api/v1/mountains/unknown-peak").status_code == 404


@pytest.mark.parametrize(
    "slug",
    ["draft-peak", "unknown-peak", "not-a-v1-mountain", "x" * 5000],
    ids=["draft", "unknown", "verify-api-probe", "long"],
)
def test_a_draft_or_unknown_mountain_is_not_found(catalog, client, slug):
    response = client.get(f"/api/v1/mountains/{slug}")

    assert response.status_code == 404
    assert response["Content-Type"] == CONTENT_TYPE
    assert "Cache-Control" not in response
    assert body(response) == NOT_FOUND


@pytest.mark.parametrize("path_slug", ["Aconcagua", "%00", "a%20b", "aconcagua%0A", "-peak"])
def test_a_malformed_slug_is_not_found_without_a_query(
    catalog,
    client,
    django_assert_num_queries,
    path_slug,
):
    with django_assert_num_queries(0):
        response = client.get(f"/api/v1/mountains/{path_slug}")

    assert response.status_code == 404
    assert body(response) == NOT_FOUND


def test_the_today_path_is_routed_to_its_own_endpoint():
    assert resolve("/api/v1/mountains/today").func.view_class is TodaysMountainView


def test_the_random_path_is_routed_to_its_own_endpoint():
    assert resolve("/api/v1/mountains/random").func.view_class is RandomMountainView


@pytest.mark.parametrize(
    "path",
    ["/api/v1/mountains/aconcagua/", "/api/v1/mountains/", "/api/v1/mountains/a/b"],
)
def test_other_shapes_of_the_path_are_not_routed(path):
    with pytest.raises(Resolver404):
        resolve(path)


@pytest.mark.parametrize(
    ("accept", "query"),
    [("text/html", ""), ("application/xml", ""), ("*/*", "?format=api")],
)
def test_json_is_served_whatever_the_client_asks_for(catalog, client, accept, query):
    response = client.get(f"/api/v1/mountains/aconcagua{query}", headers={"Accept": accept})

    assert response.status_code == 200
    assert response["Content-Type"] == CONTENT_TYPE
    assert body(response) == served_by_serendipeak(
        load_fixture("mountain-complete.json"), settings.MEDIA_PUBLIC_BASE_URL, media_of
    )


def test_a_not_found_answer_logs_no_warning(catalog, client, caplog):
    with caplog.at_level(logging.INFO):
        client.get("/api/v1/mountains/unknown-peak")

    assert [record for record in caplog.records if record.levelno >= logging.WARNING] == []


class RaisingUseCase:
    def __init__(self, error):
        self._error = error

    def execute(self, slug):
        raise self._error


def infrastructure_error():
    error = InfrastructureError("the database operation failed")
    error.__cause__ = OperationalError("password authentication failed for secret-host")

    return error


@pytest.mark.parametrize(
    "error",
    [
        infrastructure_error(),
        ApplicationError("unmapped secret-host"),
        RuntimeError("secret-host"),
    ],
    ids=["infrastructure", "unmapped-application", "unexpected"],
)
def test_any_other_failure_is_an_internal_error_without_its_cause(error, caplog):
    view = MountainBySlugView.as_view(get_mountain=RaisingUseCase(error))
    request = APIRequestFactory().get("/api/v1/mountains/aconcagua")

    with caplog.at_level(logging.ERROR, logger="serendipeak.httpapi.errors"):
        response = view(request, slug="aconcagua").render()

    assert response.status_code == 500
    assert response["Content-Type"] == CONTENT_TYPE
    assert "Cache-Control" not in response
    assert body(response) == INTERNAL
    assert b"secret-host" not in response.content

    [record] = caplog.records
    assert record.getMessage() == "Unhandled error on GET /api/v1/mountains/aconcagua"
    assert record.exc_info[1] is error


def test_a_database_failure_through_the_composed_endpoint_is_an_internal_error_logged_once(
    catalog,
    client,
    caplog,
):
    with connection.cursor() as cursor:
        cursor.execute('ALTER TABLE "mountain_image" RENAME TO "mountain_image_unavailable"')

    with caplog.at_level(logging.INFO):
        response = client.get("/api/v1/mountains/aconcagua")

    [record] = [record for record in caplog.records if record.levelno >= logging.WARNING]
    assert record.name == "serendipeak.httpapi.errors"
    assert record.exc_info is not None

    assert response.status_code == 500
    assert body(response) == INTERNAL
    assert b"mountain_image" not in response.content


GEOGRAPHY_PEAKS = [
    # The continent is not the countries' continent: a European country with an African
    # continent, a North American country with an Oceanian one, the Antarctic link, a mountain
    # across several countries and one with none.
    ("alpine-islet", "AF", ["CH"]),
    ("pacific-cone", "OC", ["US"]),
    ("ice-dome", "AN", ["AQ"]),
    ("border-spire", "AS", ["CN", "IN", "NP"]),
    ("unclaimed-rock", "EU", []),
]


@pytest.fixture
def geography_catalog(db):
    DjangoCatalogStore().load(
        catalog_of(
            *(
                catalog_mountain(slug, continent=continent(code), countries=countries(*codes))
                for slug, code, codes in GEOGRAPHY_PEAKS
            )
        )
    )


@pytest.mark.parametrize(("slug", "continent_code", "country_codes"), GEOGRAPHY_PEAKS)
def test_the_continent_and_countries_are_served_as_code_and_english_name(
    geography_catalog, client, slug, continent_code, country_codes
):
    served = body(client.get(f"/api/v1/mountains/{slug}"))

    assert served["continent"] == {
        "code": continent_code,
        "name": continent(continent_code).name.en,
    }
    assert served["countries"] == [
        {"code": code, "name": country(code).name.en} for code in country_codes
    ]


def test_countries_are_served_even_when_empty_and_ordered_by_english_name(
    geography_catalog, client
):
    assert body(client.get("/api/v1/mountains/unclaimed-rock"))["countries"] == []

    countries_served = body(client.get("/api/v1/mountains/border-spire"))["countries"]
    assert [item["name"] for item in countries_served] == ["China", "India", "Nepal"]


def test_only_english_text_and_reference_codes_are_served(geography_catalog, client):
    text = client.get("/api/v1/mountains/alpine-islet").content.decode()

    assert "África" not in text and "Suiza" not in text and "Suíça" not in text
    served = json.loads(text)
    assert set(served["continent"]) == {"code", "name"}
    assert all(set(item) == {"code", "name"} for item in served["countries"])
    assert not {key for key in served if key.endswith(("_es", "_pt", "Es", "Pt"))}


def test_the_daily_and_random_mountains_serve_the_same_geography(geography_catalog, client):
    for path in ("/api/v1/mountains/today", "/api/v1/mountains/random"):
        served = body(client.get(path))
        mountain = served.get("mountain", served)

        assert set(mountain["continent"]) == {"code", "name"}
        assert isinstance(mountain["countries"], list)

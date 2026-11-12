import json
import logging

import pytest
from django.urls import resolve
from rest_framework.test import APIRequestFactory

from serendipeak.catalog.bootstrap.ports import CatalogMountain
from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.localization import LocalizedText
from serendipeak.catalog.publish_mountain import PublishMountain
from serendipeak.errors import InfrastructureError
from serendipeak.httpapi.urls import MOUNTAIN_INDEX_MAX_AGE_SECONDS, cached_when_successful
from serendipeak.httpapi.views import MountainBySlugView, MountainIndexView
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.mountain_status_store import DjangoMountainStatusStore
from tests.support.catalog import (
    CREATED_AT,
    UPDATED_AT,
    bare_mountain,
    catalog_mountain,
    catalog_of,
    fixture_catalog_with_media,
)
from tests.support.contract_fixtures import load_fixture
from tests.support.geography import continent, countries
from tests.support.regions import region_path

PATH = "/api/v1/mountains"
CONTENT_TYPE = "application/json; charset=utf-8"
CACHED = f"public, max-age={MOUNTAIN_INDEX_MAX_AGE_SECONDS}"
INTERNAL = load_fixture("error-internal.json")
ENTRY_MEMBERS = {
    "slug",
    "name",
    "coordinates",
    "elevationMeters",
    "continent",
    "countries",
    "region",
}

BARE_INACTIVE = CatalogMountain(
    mountain=bare_mountain(), created_at=CREATED_AT, updated_at=UPDATED_AT
)
DRAFT = catalog_mountain("draft-peak", status=MountainStatus.DRAFT, camera=None, primary_image=None)
INACTIVE = catalog_mountain("retired-peak", status=MountainStatus.INACTIVE)


def body(response):
    return json.loads(response.content)


def slugs(response):
    return [entry["slug"] for entry in body(response)["mountains"]]


@pytest.fixture
def catalog(db):
    DjangoCatalogStore().load(
        catalog_of(*fixture_catalog_with_media().mountains, BARE_INACTIVE, DRAFT, INACTIVE)
    )


def test_lists_every_active_mountain_in_slug_code_point_order(catalog, client):
    response = client.get(PATH)

    assert response.status_code == 200
    assert response["Content-Type"] == CONTENT_TYPE
    assert slugs(response) == sorted(
        entry.mountain.slug
        for entry in fixture_catalog_with_media().mountains
        if entry.mountain.status is MountainStatus.ACTIVE
    )


def test_drafts_and_inactive_mountains_are_never_listed(catalog, client):
    listed = set(slugs(client.get(PATH)))

    assert {"draft-peak", "retired-peak", "bare-peak"}.isdisjoint(listed)


def test_the_answer_is_deterministic(catalog, client):
    assert client.get(PATH).content == client.get(PATH).content


def test_each_entry_is_the_locating_part_of_the_mountain_document(catalog, client):
    index = body(client.get(PATH))["mountains"]

    for entry in index:
        detail = body(client.get(f"{PATH}/{entry['slug']}"))
        assert entry == {member: detail[member] for member in ENTRY_MEMBERS}


def test_an_entry_serves_no_editorial_media_or_internal_member(catalog, client):
    response = client.get(PATH)

    for entry in body(response)["mountains"]:
        assert set(entry) == ENTRY_MEMBERS
    for leaked in (b'"id"', b"summary", b"camera", b"primaryImage", b"status", b"sources"):
        assert leaked not in response.content


def test_the_index_is_much_smaller_than_the_mountain_documents(catalog, client):
    index = client.get(PATH)
    details = sum(len(client.get(f"{PATH}/{slug}").content) for slug in slugs(index))

    assert len(index.content) < details / 2


@pytest.mark.django_db
def test_an_empty_catalog_lists_no_mountain(client):
    response = client.get(PATH)

    assert response.status_code == 200
    assert body(response) == {"mountains": []}
    assert response["Cache-Control"] == CACHED


@pytest.mark.django_db
def test_a_catalog_without_active_mountains_lists_none(client):
    DjangoCatalogStore().load(catalog_of(BARE_INACTIVE, DRAFT))

    assert body(client.get(PATH)) == {"mountains": []}


@pytest.mark.django_db
def test_geography_is_served_as_codes_english_names_and_region_paths(client):
    DjangoCatalogStore().load(
        catalog_of(
            catalog_mountain(
                "border-spire",
                name=LocalizedText(en="Border Spire", es="Aguja Fronteriza"),
                continent=continent("AS"),
                countries=countries("NP", "CN"),
                region=region_path("Great Range", "Inner Range"),
            ),
            catalog_mountain("lone-rock", continent=continent("EU"), countries=(), region=None),
        )
    )

    response = client.get(PATH)

    assert body(response) == {
        "mountains": [
            {
                "slug": "border-spire",
                "name": "Border Spire",
                "coordinates": {"latitude": -32.6531487, "longitude": -70.0119607},
                "elevationMeters": 6961,
                "continent": {"code": "AS", "name": "Asia"},
                "countries": [{"code": "CN", "name": "China"}, {"code": "NP", "name": "Nepal"}],
                "region": {
                    "slug": "inner-range",
                    "name": "Inner Range",
                    "ancestors": [{"slug": "great-range", "name": "Great Range"}],
                },
            },
            {
                "slug": "lone-rock",
                "name": "Lone Rock",
                "coordinates": {"latitude": -32.6531487, "longitude": -70.0119607},
                "elevationMeters": 6961,
                "continent": {"code": "EU", "name": "Europe"},
                "countries": [],
                "region": None,
            },
        ]
    }
    assert "Aguja" not in response.content.decode()


@pytest.mark.django_db
def test_a_newly_published_mountain_is_listed_on_the_next_request(client):
    ready = catalog_mountain("new-peak", status=MountainStatus.DRAFT)
    DjangoCatalogStore().load(catalog_of(catalog_mountain("aconcagua"), ready))
    assert slugs(client.get(PATH)) == ["aconcagua"]

    PublishMountain(DjangoMountainStatusStore()).execute(ready.mountain.id)

    assert slugs(client.get(PATH)) == ["aconcagua", "new-peak"]


def test_the_index_is_three_queries_however_many_mountains(
    catalog, client, django_assert_num_queries
):
    with django_assert_num_queries(3):
        assert client.get(PATH).status_code == 200


def test_a_successful_answer_may_be_cached_publicly_for_a_short_time(catalog, client):
    assert client.get(PATH)["Cache-Control"] == CACHED


def test_the_existing_mountain_endpoints_keep_their_routes_and_caching(catalog, client):
    assert resolve(PATH).func.view_class is MountainIndexView
    assert resolve(f"{PATH}/aconcagua").func.view_class is MountainBySlugView
    assert "Cache-Control" not in client.get(f"{PATH}/aconcagua")
    assert client.get(f"{PATH}/today")["Cache-Control"] == "no-store"
    assert client.get(f"{PATH}/random")["Cache-Control"] == "no-store"
    assert client.get(f"{PATH}/").status_code == 404


class FailingIndex:
    def execute(self):
        raise InfrastructureError("the database operation failed on secret-host")


def test_a_failure_is_an_internal_error_that_is_never_cached(caplog):
    view = cached_when_successful(
        MountainIndexView.as_view(get_index=FailingIndex()),
        max_age=MOUNTAIN_INDEX_MAX_AGE_SECONDS,
    )

    with caplog.at_level(logging.ERROR, logger="serendipeak.httpapi.errors"):
        response = view(APIRequestFactory().get(PATH)).render()

    assert response.status_code == 500
    assert response["Content-Type"] == CONTENT_TYPE
    assert response["Cache-Control"] == "no-store"
    assert body(response) == INTERNAL
    assert b"secret-host" not in response.content

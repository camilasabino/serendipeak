import json
import logging

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import resolve

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.get_mountain_by_slug import GetMountainBySlug
from serendipeak.catalog.get_mountain_index import GetMountainIndex
from serendipeak.discovery.get_random_mountain import GetRandomMountain
from serendipeak.discovery.get_todays_mountain import GetTodaysMountain
from serendipeak.httpapi.urls import mountain_urlpatterns
from serendipeak.httpapi.views import RandomMountainView
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.daily_discovery_repository import DjangoDailyDiscoveryRepository
from serendipeak.persistence.models import DailyDiscoveryRecord
from serendipeak.persistence.mountain_repository import DjangoMountainRepository
from tests.support.catalog import (
    catalog_mountain,
    catalog_of,
    fixture_catalog_with_media,
    media_of,
)
from tests.support.contract_fixtures import (
    load_fixture,
    load_frozen_catalog,
    served_by_serendipeak,
)
from tests.support.fakes import FixedClock, unused_preview

CONTENT_TYPE = "application/json; charset=utf-8"
PATH = "/api/v1/mountains/random"
NO_ELIGIBLE = load_fixture("error-no-eligible-mountains.json")
INTERNAL = load_fixture("error-internal.json")
MEDIA_BASE_URL = "https://media.example.test"
FROZEN_BY_SLUG = {mountain["slug"]: mountain for mountain in load_frozen_catalog()}


class FixedIndex:
    def __init__(self):
        self.index = 0
        self.counts = []

    def __call__(self, count):
        self.counts.append(count)

        return self.index


pick_index = FixedIndex()
urlpatterns = mountain_urlpatterns(
    get_mountain=GetMountainBySlug(DjangoMountainRepository()),
    get_index=GetMountainIndex(DjangoMountainRepository()),
    get_todays_mountain=GetTodaysMountain(
        DjangoMountainRepository(),
        DjangoDailyDiscoveryRepository(),
        FixedClock(None),
    ),
    get_random_mountain=GetRandomMountain(DjangoMountainRepository(), pick_index),
    get_preview=unused_preview(),
    media_base_url=MEDIA_BASE_URL,
)

pytestmark = pytest.mark.urls(__name__)


@pytest.fixture(autouse=True)
def fresh_pick_index():
    pick_index.index = 0
    pick_index.counts = []


@pytest.fixture
def catalog(db):
    DjangoCatalogStore().load(fixture_catalog_with_media())


@pytest.fixture
def small_catalog(db):
    DjangoCatalogStore().load(
        catalog_of(
            catalog_mountain("alpha"),
            catalog_mountain("bravo"),
            catalog_mountain("charlie"),
            catalog_mountain("retired-peak", status=MountainStatus.INACTIVE),
            catalog_mountain("draft-peak", status=MountainStatus.DRAFT),
        )
    )


def body(response):
    return json.loads(response.content)


def served_slugs(client, query="", candidates=3):
    slugs = []
    for index in range(candidates):
        pick_index.index = index
        slugs.append(body(client.get(f"{PATH}{query}"))["slug"])

    return slugs


def assert_no_store_json(response, status):
    assert response.status_code == status
    assert response["Content-Type"] == CONTENT_TYPE
    assert response["Cache-Control"] == "no-store"


def test_a_random_mountain_matches_the_complete_fixture(
    catalog,
    client,
    django_assert_num_queries,
):
    pick_index.index = sorted(FROZEN_BY_SLUG).index("aconcagua")

    with django_assert_num_queries(4):
        response = client.get(PATH)

    assert_no_store_json(response, 200)
    assert body(response) == served_by_serendipeak(
        load_fixture("mountain-complete.json"), MEDIA_BASE_URL, media_of
    )


def test_every_active_mountain_is_served_exactly_as_the_slug_endpoint_serves_it(
    catalog,
    client,
):
    for index, slug in enumerate(sorted(FROZEN_BY_SLUG)):
        pick_index.index = index

        assert body(client.get(PATH)) == body(client.get(f"/api/v1/mountains/{slug}"))


def test_the_index_selects_among_the_active_mountains_ordered_by_slug(catalog, client):
    active = sorted(FROZEN_BY_SLUG)

    for index in (0, 1, len(active) - 1):
        pick_index.index = index
        assert body(client.get(PATH))["slug"] == active[index]

    assert pick_index.counts == [len(active)] * 3


def test_only_active_mountains_are_served(small_catalog, client):
    assert served_slugs(client) == ["alpha", "bravo", "charlie"]
    assert pick_index.counts == [3, 3, 3]


def test_the_excluded_mountain_is_never_served_when_another_is_active(small_catalog, client):
    assert served_slugs(client, "?exclude=bravo", candidates=2) == ["alpha", "charlie"]
    assert pick_index.counts == [2, 2]


def test_only_the_first_exclude_value_counts(small_catalog, client):
    assert served_slugs(client, "?exclude=alpha&exclude=bravo", candidates=2) == [
        "bravo",
        "charlie",
    ]


@pytest.mark.parametrize(
    "query",
    ["", "?exclude=", "?exclude=unknown-peak", "?exclude=retired-peak", "?exclude=draft-peak"],
)
def test_an_empty_unknown_or_inactive_exclusion_has_no_effect(small_catalog, client, query):
    assert served_slugs(client, query) == ["alpha", "bravo", "charlie"]


@pytest.mark.parametrize("query", ["?exclude=Alpha", "?exclude=alpha%20", "?exclude=%00"])
def test_the_exclusion_is_not_normalized_and_never_reaches_the_database(
    small_catalog,
    client,
    query,
):
    assert served_slugs(client, query) == ["alpha", "bravo", "charlie"]


def test_the_sole_active_mountain_is_served_even_when_excluded(db, client):
    DjangoCatalogStore().load(
        catalog_of(
            catalog_mountain("alpha"),
            catalog_mountain("retired-peak", status=MountainStatus.INACTIVE),
        )
    )

    response = client.get(f"{PATH}?exclude=alpha")

    assert_no_store_json(response, 200)
    assert body(response)["slug"] == "alpha"


def test_no_active_mountain_answers_no_eligible_with_one_query(
    db, client, django_assert_num_queries
):
    DjangoCatalogStore().load(
        catalog_of(catalog_mountain("old-peak", status=MountainStatus.INACTIVE))
    )

    with django_assert_num_queries(1):
        response = client.get(PATH)

    assert_no_store_json(response, 503)
    assert body(response) == NO_ELIGIBLE
    assert pick_index.counts == []


def test_random_never_writes_a_discovery(catalog, client):
    before = list(DailyDiscoveryRecord.objects.values_list("date", "mountain_id"))

    with CaptureQueriesContext(connection) as queries:
        for index in range(5):
            pick_index.index = index
            assert client.get(PATH).status_code == 200

    statements = [query["sql"].lstrip().upper() for query in queries.captured_queries]
    assert statements
    assert all(statement.startswith(("SELECT", "WITH")) for statement in statements)
    assert list(DailyDiscoveryRecord.objects.values_list("date", "mountain_id")) == before


def test_a_database_failure_is_an_internal_error_logged_once(catalog, client, caplog):
    with connection.cursor() as cursor:
        cursor.execute('ALTER TABLE "mountain" RENAME TO "mountain_unavailable"')

    with caplog.at_level(logging.INFO):
        response = client.get(PATH)

    assert_no_store_json(response, 500)
    assert body(response) == INTERNAL
    [record] = [record for record in caplog.records if record.levelno >= logging.WARNING]
    assert record.name == "serendipeak.httpapi.errors"
    assert record.getMessage() == f"Unhandled error on GET {PATH}"


@pytest.mark.parametrize(("accept", "query"), [("text/html", ""), ("*/*", "?format=api")])
def test_json_is_served_whatever_the_client_asks_for(catalog, client, accept, query):
    response = client.get(f"{PATH}{query}", headers={"Accept": accept})

    assert_no_store_json(response, 200)


@pytest.mark.parametrize("path", [f"{PATH}/", f"{PATH}/x"])
def test_other_shapes_of_the_path_are_not_the_random_endpoint(client, path):
    assert client.get(path).status_code == 404


@pytest.mark.urls("config.urls")
def test_the_composed_endpoint_serves_an_active_mountain(catalog, client):
    assert resolve(PATH).func.view_class is RandomMountainView

    response = client.get(PATH)

    assert_no_store_json(response, 200)
    assert body(response)["slug"] in FROZEN_BY_SLUG

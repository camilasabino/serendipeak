import datetime
import json
import logging

import pytest
from django.db import connection
from django.urls import resolve

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.get_mountain_by_slug import GetMountainBySlug
from serendipeak.discovery.get_random_mountain import GetRandomMountain
from serendipeak.discovery.get_todays_mountain import GetTodaysMountain
from serendipeak.httpapi.urls import mountain_urlpatterns
from serendipeak.httpapi.views import TodaysMountainView
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.daily_discovery_repository import DjangoDailyDiscoveryRepository
from serendipeak.persistence.models import DailyDiscoveryRecord, MountainRecord
from serendipeak.persistence.mountain_repository import DjangoMountainRepository
from tests.support.catalog import (
    catalog_discovery,
    catalog_mountain,
    catalog_seed,
    committed_seed_with_media,
    media_of,
)
from tests.support.contract_fixtures import load_fixture, served_by_serendipeak
from tests.support.fakes import FixedClock

CONTENT_TYPE = "application/json; charset=utf-8"
PATH = "/api/v1/mountains/today"
DAILY = load_fixture("daily-mountain.json")
NO_ELIGIBLE = load_fixture("error-no-eligible-mountains.json")
INTERNAL = load_fixture("error-internal.json")
MEDIA_BASE_URL = "https://media.example.test"
OWNED_DAILY = served_by_serendipeak(DAILY, MEDIA_BASE_URL, media_of)
FIXTURE_DAY = datetime.date.fromisoformat(DAILY["date"])
NEW_DAY = datetime.date(2026, 10, 20)

clock = FixedClock(FIXTURE_DAY)
urlpatterns = mountain_urlpatterns(
    get_mountain=GetMountainBySlug(DjangoMountainRepository()),
    get_todays_mountain=GetTodaysMountain(
        DjangoMountainRepository(),
        DjangoDailyDiscoveryRepository(),
        clock,
    ),
    get_random_mountain=GetRandomMountain(DjangoMountainRepository(), lambda count: 0),
    media_base_url=MEDIA_BASE_URL,
)

pytestmark = pytest.mark.urls(__name__)


@pytest.fixture
def on_day():
    def set_day(day):
        clock.day = day

    yield set_day
    clock.day = FIXTURE_DAY


@pytest.fixture
def catalog(db):
    seed = committed_seed_with_media()
    aconcagua = next(entry for entry in seed.mountains if entry.mountain.slug == "aconcagua")
    history = [discovery for discovery in seed.discoveries if discovery.date != FIXTURE_DAY]

    DjangoCatalogStore().load(
        catalog_seed(
            *seed.mountains,
            discoveries=(*history, catalog_discovery(FIXTURE_DAY, aconcagua)),
        )
    )


def body(response):
    return json.loads(response.content)


def assert_no_store_json(response, status):
    assert response.status_code == status
    assert response["Content-Type"] == CONTENT_TYPE
    assert response["Cache-Control"] == "no-store"


def test_a_persisted_date_matches_the_daily_fixture(catalog, client, django_assert_num_queries):
    with django_assert_num_queries(2):
        response = client.get(PATH)

    assert_no_store_json(response, 200)
    assert body(response) == OWNED_DAILY


def test_a_new_date_persists_its_discovery_and_later_requests_reuse_it(
    catalog,
    client,
    on_day,
    django_assert_num_queries,
):
    on_day(NEW_DAY)

    with django_assert_num_queries(6):
        first = client.get(PATH)
    with django_assert_num_queries(2):
        second = client.get(PATH)

    assert_no_store_json(first, 200)
    assert body(first) == body(second)
    assert body(first)["date"] == "2026-10-20"
    stored = DailyDiscoveryRecord.objects.get(date=NEW_DAY)
    assert str(stored.mountain_id) == body(first)["mountain"]["id"]


def test_a_new_date_never_chooses_a_mountain_of_the_previous_thirty_dates(
    catalog,
    client,
    on_day,
):
    on_day(NEW_DAY)
    recent = set(
        DailyDiscoveryRecord.objects.filter(
            date__gte=NEW_DAY - datetime.timedelta(days=30)
        ).values_list("mountain__slug", flat=True)
    )

    slug = body(client.get(PATH))["mountain"]["slug"]

    assert recent
    assert slug not in recent
    assert MountainRecord.objects.get(slug=slug).status == "active"


def test_a_persisted_date_is_served_after_its_mountain_is_deactivated(catalog, client):
    MountainRecord.objects.filter(slug="aconcagua").update(status=MountainStatus.INACTIVE.value)

    response = client.get(PATH)

    assert_no_store_json(response, 200)
    assert body(response)["mountain"]["slug"] == "aconcagua"


def test_no_active_mountain_answers_no_eligible_without_writing(
    db,
    client,
    on_day,
    django_assert_num_queries,
    caplog,
):
    DjangoCatalogStore().load(
        catalog_seed(catalog_mountain("old-peak", status=MountainStatus.INACTIVE))
    )
    on_day(NEW_DAY)

    with django_assert_num_queries(2), caplog.at_level(logging.INFO):
        response = client.get(PATH)

    assert_no_store_json(response, 503)
    assert body(response) == NO_ELIGIBLE
    assert not DailyDiscoveryRecord.objects.exists()
    assert [record for record in caplog.records if record.levelno >= logging.WARNING] == []


def test_a_database_failure_is_an_internal_error_logged_once(catalog, client, caplog):
    with connection.cursor() as cursor:
        cursor.execute('ALTER TABLE "daily_discovery" RENAME TO "daily_discovery_unavailable"')

    with caplog.at_level(logging.INFO):
        response = client.get(PATH)

    assert_no_store_json(response, 500)
    assert body(response) == INTERNAL
    assert b"daily_discovery" not in response.content
    [record] = [record for record in caplog.records if record.levelno >= logging.WARNING]
    assert record.name == "serendipeak.httpapi.errors"
    assert record.getMessage() == f"Unhandled error on GET {PATH}"
    assert record.exc_info is not None


@pytest.mark.parametrize(("accept", "query"), [("text/html", ""), ("*/*", "?format=api")])
def test_json_is_served_whatever_the_client_asks_for(catalog, client, accept, query):
    response = client.get(f"{PATH}{query}", headers={"Accept": accept})

    assert_no_store_json(response, 200)
    assert body(response) == OWNED_DAILY


@pytest.mark.parametrize("path", [f"{PATH}/", "/api/v1/mountains/today/x"])
def test_other_shapes_of_the_path_are_not_the_today_endpoint(client, path):
    assert client.get(path).status_code == 404


@pytest.mark.urls("config.urls")
def test_the_composed_endpoint_serves_the_current_utc_date(catalog, client):
    assert resolve(PATH).func.view_class is TodaysMountainView

    before = datetime.datetime.now(datetime.UTC).date()
    response = client.get(PATH)
    after = datetime.datetime.now(datetime.UTC).date()

    assert_no_store_json(response, 200)
    served = datetime.date.fromisoformat(body(response)["date"])
    assert before <= served <= after
    assert DailyDiscoveryRecord.objects.filter(date=served).count() == 1

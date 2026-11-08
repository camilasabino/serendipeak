import datetime
import threading
import time

import pytest
from django.db import OperationalError, connection, connections, transaction

from serendipeak.catalog.bootstrap.check_catalog import CheckCatalog
from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.errors import CatalogAlreadyPopulated
from serendipeak.errors import InfrastructureError
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.errors import translate_database_errors
from serendipeak.persistence.models import DailyDiscoveryRecord, MountainRecord
from tests.support.catalog import (
    catalog_discovery,
    catalog_mountain,
    catalog_of,
    fixture_catalog,
    fixture_catalog_with_media,
    primary_image,
)

DAY = datetime.date(2026, 10, 3)
LOCK_WAIT_TIMEOUT_SECONDS = 10


def test_database_errors_become_infrastructure_errors():
    cause = OperationalError("connection refused")

    with pytest.raises(InfrastructureError) as raised, translate_database_errors():
        raise cause

    assert raised.value.__cause__ is cause


def statement_heads(captured):
    return [" ".join(query["sql"].split()[:3]) for query in captured.captured_queries]


@pytest.mark.django_db(transaction=True)
def test_load_locks_checks_and_inserts_in_one_transaction(django_assert_num_queries):
    with django_assert_num_queries(9) as captured:
        DjangoCatalogStore().load(fixture_catalog())

    assert statement_heads(captured) == [
        "BEGIN",
        'LOCK TABLE "mountain"',
        "SELECT 1 AS",
        'INSERT INTO "mountain_region"',
        'INSERT INTO "mountain"',
        'INSERT INTO "mountain_country"',
        'INSERT INTO "mountain_image"',
        'INSERT INTO "daily_discovery"',
        "COMMIT",
    ]


@pytest.mark.django_db(transaction=True)
def test_a_refused_load_writes_nothing_and_rolls_back(django_assert_num_queries):
    DjangoCatalogStore().load(catalog_of(catalog_mountain("aconcagua")))

    with (
        django_assert_num_queries(4) as captured,
        pytest.raises(CatalogAlreadyPopulated),
    ):
        DjangoCatalogStore().load(fixture_catalog())

    assert statement_heads(captured) == [
        "BEGIN",
        'LOCK TABLE "mountain"',
        "SELECT 1 AS",
        "ROLLBACK",
    ]


@pytest.mark.django_db
def test_snapshot_is_four_queries_whatever_the_images_countries_and_regions_of_the_mountains(
    django_assert_num_queries,
):
    committed = fixture_catalog()
    without_image = catalog_mountain(
        "imageless-peak", status=MountainStatus.DRAFT, primary_image=None
    )
    catalog = catalog_of(
        *committed.mountains,
        without_image,
        discoveries=committed.discoveries,
    )
    DjangoCatalogStore().load(catalog)

    with django_assert_num_queries(4):
        snapshot = DjangoCatalogStore().snapshot()

    assert (len(snapshot.mountains), len(snapshot.discoveries)) == (74, 8)
    assert without_image in snapshot.mountains
    assert set(snapshot.mountains) == set(catalog.mountains)


@pytest.mark.django_db
def test_check_catalog_reads_the_catalog_in_four_queries(django_assert_num_queries):
    store = DjangoCatalogStore()
    store.load(fixture_catalog_with_media())

    with django_assert_num_queries(4):
        report = CheckCatalog(store).execute()

    assert (report.checked, report.violations) == (73, ())


@pytest.mark.django_db
def test_a_constraint_violation_rolls_back_every_table():
    valid = catalog_mountain("aconcagua")
    invalid_image = catalog_mountain(
        "mont-blanc", primary_image=primary_image(source_page_url="http://insecure.example")
    )
    catalog = catalog_of(valid, invalid_image, discoveries=[catalog_discovery(DAY, valid)])

    with pytest.raises(InfrastructureError) as raised:
        DjangoCatalogStore().load(catalog)

    assert (
        raised.value.__cause__.__cause__.diag.constraint_name
        == "mountain_image_source_page_url_public_link"
    )
    assert not MountainRecord.objects.exists()
    assert not DailyDiscoveryRecord.objects.exists()


@pytest.mark.django_db(transaction=True)
def test_a_deferred_foreign_key_violation_surfaces_at_commit_as_an_infrastructure_error():
    orphan = catalog_discovery(DAY, catalog_mountain("unknown-peak"))
    catalog = catalog_of(catalog_mountain("aconcagua"), discoveries=[orphan])

    with pytest.raises(InfrastructureError) as raised:
        DjangoCatalogStore().load(catalog)

    assert raised.value.__cause__.__cause__.diag.constraint_name.startswith("daily_discovery_")
    assert not MountainRecord.objects.exists()


def waiting_lock_count():
    with connections["default"].cursor() as cursor:
        cursor.execute(
            "SELECT count(*) FROM pg_stat_activity"
            " WHERE datname = current_database() AND wait_event_type = 'Lock'"
        )
        return cursor.fetchone()[0]


def wait_for_lock_waiters(expected):
    deadline = time.monotonic() + LOCK_WAIT_TIMEOUT_SECONDS
    while waiting_lock_count() < expected:
        if time.monotonic() > deadline:
            raise AssertionError("the concurrent load never waited for the first load")
        time.sleep(0.02)


@pytest.mark.django_db(transaction=True)
def test_a_concurrent_load_waits_for_a_disjoint_load_and_refuses():
    unlisted = catalog_mountain("unlisted-peak")
    day_before_the_others = datetime.date(2026, 9, 30)
    first_catalog = catalog_of(
        unlisted, discoveries=[catalog_discovery(day_before_the_others, unlisted)]
    )
    second_catalog = fixture_catalog()
    assert unlisted.mountain.id not in {entry.mountain.id for entry in second_catalog.mountains}
    assert unlisted.mountain.slug not in {entry.mountain.slug for entry in second_catalog.mountains}
    assert day_before_the_others not in {d.date for d in second_catalog.discoveries}
    first_loaded = threading.Event()
    release_first = threading.Event()
    outcomes = {}

    def first():
        try:
            with transaction.atomic():
                DjangoCatalogStore().load(first_catalog)
                first_loaded.set()
                release_first.wait(LOCK_WAIT_TIMEOUT_SECONDS)
        finally:
            connection.close()

    def second():
        try:
            outcomes["second"] = DjangoCatalogStore().load(second_catalog)
        except CatalogAlreadyPopulated as error:
            outcomes["second"] = error
        finally:
            connection.close()

    first_thread = threading.Thread(target=first)
    first_thread.start()
    assert first_loaded.wait(LOCK_WAIT_TIMEOUT_SECONDS)
    second_thread = threading.Thread(target=second)
    second_thread.start()
    try:
        wait_for_lock_waiters(1)
    finally:
        release_first.set()
        first_thread.join()
        second_thread.join()

    assert isinstance(outcomes["second"], CatalogAlreadyPopulated)
    assert list(MountainRecord.objects.values_list("slug", flat=True)) == ["unlisted-peak"]
    assert list(DailyDiscoveryRecord.objects.values_list("date", flat=True)) == [
        day_before_the_others
    ]

import datetime
import threading
import time

import pytest
from django.db import OperationalError, connection, connections, transaction

from config.composition import build_bootstrap_catalog
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
    catalog_seed,
    committed_seed,
    frozen_catalog,
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
    with django_assert_num_queries(7) as captured:
        DjangoCatalogStore().load(committed_seed())

    assert statement_heads(captured) == [
        "BEGIN",
        'LOCK TABLE "mountain"',
        "SELECT 1 AS",
        'INSERT INTO "mountain"',
        'INSERT INTO "mountain_image"',
        'INSERT INTO "daily_discovery"',
        "COMMIT",
    ]


@pytest.mark.django_db(transaction=True)
def test_a_refused_load_writes_nothing_and_rolls_back(django_assert_num_queries):
    DjangoCatalogStore().load(catalog_seed(catalog_mountain("aconcagua")))

    with (
        django_assert_num_queries(4) as captured,
        pytest.raises(CatalogAlreadyPopulated),
    ):
        DjangoCatalogStore().load(committed_seed())

    assert statement_heads(captured) == [
        "BEGIN",
        'LOCK TABLE "mountain"',
        "SELECT 1 AS",
        "ROLLBACK",
    ]


@pytest.mark.django_db
def test_snapshot_is_two_queries_whether_or_not_a_mountain_has_an_image(
    django_assert_num_queries,
):
    committed = committed_seed()
    without_image = catalog_mountain(
        "imageless-peak", status=MountainStatus.DRAFT, primary_image=None
    )
    seed = catalog_seed(
        *committed.mountains,
        without_image,
        discoveries=committed.discoveries,
    )
    DjangoCatalogStore().load(seed)

    with django_assert_num_queries(2):
        snapshot = DjangoCatalogStore().snapshot()

    assert (len(snapshot.mountains), len(snapshot.discoveries)) == (74, 8)
    assert without_image in snapshot.mountains
    assert set(snapshot.mountains) == set(seed.mountains)


@pytest.mark.django_db
def test_check_catalog_reads_the_catalog_in_two_queries(django_assert_num_queries):
    store = DjangoCatalogStore()
    store.load(committed_seed())

    with django_assert_num_queries(2):
        report = CheckCatalog(store).execute()

    assert (report.checked, report.violations) == (73, ())


@pytest.mark.django_db
def test_a_constraint_violation_rolls_back_every_table():
    valid = catalog_mountain("aconcagua")
    invalid_image = catalog_mountain("mont-blanc", primary_image=primary_image(url=" "))
    seed = catalog_seed(valid, invalid_image, discoveries=[catalog_discovery(DAY, valid)])

    with pytest.raises(InfrastructureError) as raised:
        DjangoCatalogStore().load(seed)

    assert raised.value.__cause__.__cause__.diag.constraint_name == "mountain_image_url_not_blank"
    assert not MountainRecord.objects.exists()
    assert not DailyDiscoveryRecord.objects.exists()


@pytest.mark.django_db(transaction=True)
def test_a_deferred_foreign_key_violation_surfaces_at_commit_as_an_infrastructure_error():
    orphan = catalog_discovery(DAY, catalog_mountain("unknown-peak"))
    seed = catalog_seed(catalog_mountain("aconcagua"), discoveries=[orphan])

    with pytest.raises(InfrastructureError) as raised:
        DjangoCatalogStore().load(seed)

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
            raise AssertionError("the concurrent bootstrap never waited for the first load")
        time.sleep(0.02)


@pytest.mark.django_db(transaction=True)
def test_a_concurrent_bootstrap_waits_for_a_disjoint_load_and_refuses():
    unlisted = catalog_mountain("unlisted-peak")
    day_before_the_seed = datetime.date(2026, 9, 30)
    first_seed = catalog_seed(
        unlisted, discoveries=[catalog_discovery(day_before_the_seed, unlisted)]
    )
    seed, frozen = committed_seed(), frozen_catalog()
    assert unlisted.mountain.id not in {entry.mountain.id for entry in seed.mountains}
    assert unlisted.mountain.slug not in {entry.mountain.slug for entry in seed.mountains}
    assert day_before_the_seed not in {discovery.date for discovery in seed.discoveries}
    first_loaded = threading.Event()
    release_first = threading.Event()
    outcomes = {}

    def first():
        try:
            with transaction.atomic():
                DjangoCatalogStore().load(first_seed)
                first_loaded.set()
                release_first.wait(LOCK_WAIT_TIMEOUT_SECONDS)
        finally:
            connection.close()

    def second():
        try:
            outcomes["second"] = build_bootstrap_catalog().execute(seed, frozen)
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
        day_before_the_seed
    ]

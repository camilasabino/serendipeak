import datetime
import uuid

import pytest
from django.db import IntegrityError, connection, transaction

from serendipeak.errors import InfrastructureError
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.daily_discovery_repository import DjangoDailyDiscoveryRepository
from serendipeak.persistence.models import DailyDiscoveryRecord
from tests.support.catalog import catalog_discovery, catalog_mountain, catalog_seed

DAY = datetime.date(2026, 10, 20)
NEXT_DAY = DAY + datetime.timedelta(days=1)
ACONCAGUA = catalog_mountain("aconcagua")
DENALI = catalog_mountain("denali", primary_image=None)
FOREIGN_KEY_VIOLATION = "23503"


def arrange():
    DjangoCatalogStore().load(
        catalog_seed(
            ACONCAGUA,
            DENALI,
            discoveries=(
                catalog_discovery(DAY - datetime.timedelta(days=1), DENALI),
                catalog_discovery(DAY, ACONCAGUA),
            ),
        )
    )

    return DjangoDailyDiscoveryRepository()


@pytest.fixture
def repository(db):
    return arrange()


@pytest.mark.parametrize(("day", "found"), [(DAY, True), (NEXT_DAY, False)])
def test_a_date_lookup_joins_the_mountain_image_and_continent_and_reads_countries_and_region_apart(
    repository,
    django_assert_num_queries,
    day,
    found,
):
    with django_assert_num_queries(3 if found else 1) as captured:
        daily = repository.find_by_date(day)

    assert (daily is not None) is found
    sql = captured.captured_queries[0]["sql"]
    assert 'INNER JOIN "mountain"' in sql
    assert 'LEFT OUTER JOIN "mountain_image"' in sql
    assert 'INNER JOIN "continent"' in sql
    assert 'WHERE "daily_discovery"."date" = ' in sql
    assert '"mountain"."status" IN' not in sql


def test_listing_recent_discoveries_is_one_query(repository, django_assert_num_queries):
    with django_assert_num_queries(1) as captured:
        recent = repository.list_recent(DAY - datetime.timedelta(days=30), DAY)

    assert [discovery.slug for discovery in recent] == ["denali", "aconcagua"]
    assert "BETWEEN" in captured.captured_queries[0]["sql"]


@pytest.mark.parametrize(
    ("day", "mountain"),
    [(NEXT_DAY, DENALI), (DAY, DENALI)],
    ids=["inserted", "conflict"],
)
def test_insert_or_get_is_an_insert_that_ignores_conflicts_and_a_re_read(
    repository,
    django_assert_num_queries,
    day,
    mountain,
):
    with django_assert_num_queries(4) as captured:
        repository.insert_or_get(day, mountain.mountain.id)

    insert, re_read, countries, ancestors = (query["sql"] for query in captured.captured_queries)
    assert insert.startswith('INSERT INTO "daily_discovery"')
    assert insert.endswith("ON CONFLICT DO NOTHING")
    assert 'INNER JOIN "mountain"' in re_read
    assert '"mountain_country"' in countries
    assert "RECURSIVE" in ancestors


def test_the_insert_lets_the_database_set_the_creation_time(repository):
    repository.insert_or_get(NEXT_DAY, DENALI.mountain.id)

    assert DailyDiscoveryRecord.objects.get(date=NEXT_DAY).created_at is not None


def test_a_conflicting_insert_keeps_the_stored_row(repository):
    stored = DailyDiscoveryRecord.objects.get(date=DAY)

    repository.insert_or_get(DAY, DENALI.mountain.id)

    assert DailyDiscoveryRecord.objects.get(date=DAY).mountain_id == stored.mountain_id
    assert DailyDiscoveryRecord.objects.get(date=DAY).created_at == stored.created_at


@pytest.mark.django_db(transaction=True)
def test_an_unknown_mountain_fails_at_the_commit_of_the_insert_and_keeps_nothing():
    repository = arrange()

    with pytest.raises(InfrastructureError) as raised:
        repository.insert_or_get(NEXT_DAY, uuid.uuid4())

    cause = raised.value.__cause__
    assert isinstance(cause, IntegrityError)
    assert cause.__cause__.diag.sqlstate == FOREIGN_KEY_VIOLATION
    assert not DailyDiscoveryRecord.objects.filter(date=NEXT_DAY).exists()


def test_inside_a_transaction_an_unknown_mountain_is_never_returned(repository):
    with pytest.raises(IntegrityError), transaction.atomic():
        with pytest.raises(InfrastructureError):
            repository.insert_or_get(NEXT_DAY, uuid.uuid4())
        connection.check_constraints()

    assert not DailyDiscoveryRecord.objects.filter(date=NEXT_DAY).exists()


@pytest.mark.parametrize(
    "operation",
    [
        lambda repository: repository.find_by_date(DAY),
        lambda repository: repository.list_recent(DAY, DAY),
        lambda repository: repository.insert_or_get(NEXT_DAY, DENALI.mountain.id),
    ],
    ids=["find_by_date", "list_recent", "insert_or_get"],
)
def test_database_errors_become_infrastructure_errors(repository, operation):
    with connection.cursor() as cursor:
        cursor.execute('ALTER TABLE "daily_discovery" RENAME TO "daily_discovery_unavailable"')

    with pytest.raises(InfrastructureError) as raised:
        operation(repository)

    assert "daily_discovery" in str(raised.value.__cause__)


def test_pruning_is_one_delete_on_the_date(repository, django_assert_num_queries):
    cutoff = datetime.datetime.now(datetime.UTC).date() - datetime.timedelta(days=365)

    with django_assert_num_queries(1) as captured:
        deleted = repository.delete_before(cutoff)

    assert deleted == 0
    sql = captured.captured_queries[0]["sql"]
    assert sql.startswith('DELETE FROM "daily_discovery" WHERE "daily_discovery"."date" < ')


def test_pruning_a_retained_date_is_an_infrastructure_error_that_deletes_nothing(repository):
    with pytest.raises(InfrastructureError), transaction.atomic():
        repository.delete_before(NEXT_DAY)

    assert DailyDiscoveryRecord.objects.count() == 2

import datetime

import pytest
from django.db import IntegrityError, connection, transaction
from django.db.models import ProtectedError

from serendipeak.persistence.models import DailyDiscoveryRecord, MountainRecord
from tests.support.records import image_record, insert_error, mountain_record

DAY = datetime.date(2026, 10, 1)
RESTRICT_VIOLATION = "23001"
FOREIGN_KEY_VIOLATION = "23503"


@pytest.fixture
def mountain(db):
    record = mountain_record()
    record.save()
    return record


@pytest.fixture
def other_mountain(db):
    record = mountain_record(slug="mont-blanc", name="Mont Blanc")
    record.save()
    return record


@pytest.fixture
def discovery(mountain):
    record = DailyDiscoveryRecord(date=DAY, mountain=mountain)
    record.save(force_insert=True)
    return record


def database_error(statement):
    with pytest.raises(IntegrityError) as raised, transaction.atomic():
        statement()
    return raised.value.__cause__.diag


def execute(sql, params=()):
    with connection.cursor() as cursor:
        cursor.execute(sql, params)


def test_allows_one_discovery_per_date(discovery, other_mountain):
    error = insert_error(DailyDiscoveryRecord(date=DAY, mountain=other_mountain))

    assert error.constraint_name == "daily_discovery_pkey"


def test_created_at_defaults_to_the_insert_time(discovery):
    stored = DailyDiscoveryRecord.objects.get(date=DAY)

    assert stored.created_at is not None


def test_rejects_updating_a_discovery_through_the_queryset(discovery, other_mountain):
    error = database_error(
        lambda: DailyDiscoveryRecord.objects.filter(date=DAY).update(mountain=other_mountain)
    )

    assert error.sqlstate == RESTRICT_VIOLATION
    assert error.message_primary == "daily_discovery rows are immutable"


def test_rejects_saving_a_changed_discovery(discovery, other_mountain):
    discovery.mountain = other_mountain

    error = database_error(discovery.save)

    assert error.sqlstate == RESTRICT_VIOLATION


def test_rejects_updating_a_discovery_with_raw_sql(discovery):
    error = database_error(
        lambda: execute("UPDATE daily_discovery SET created_at = now() WHERE date = %s", [DAY])
    )

    assert error.sqlstate == RESTRICT_VIOLATION


def test_rejects_deleting_a_discovery_through_the_queryset(discovery):
    error = database_error(DailyDiscoveryRecord.objects.filter(date=DAY).delete)

    assert error.sqlstate == RESTRICT_VIOLATION


def test_rejects_deleting_a_discovery_with_raw_sql(discovery):
    error = database_error(lambda: execute("DELETE FROM daily_discovery"))

    assert error.sqlstate == RESTRICT_VIOLATION
    assert DailyDiscoveryRecord.objects.filter(date=DAY).exists()


@pytest.mark.django_db(transaction=True)
def test_truncate_still_empties_the_table_for_test_flushes(discovery):
    execute("TRUNCATE daily_discovery")

    assert not DailyDiscoveryRecord.objects.exists()


def test_orm_refuses_to_delete_a_mountain_with_discoveries(discovery, mountain):
    with pytest.raises(ProtectedError):
        mountain.delete()


def test_database_refuses_to_delete_a_mountain_with_discoveries(discovery, mountain):
    execute("SET CONSTRAINTS ALL IMMEDIATE")

    error = database_error(lambda: execute("DELETE FROM mountain WHERE id = %s", [mountain.id]))

    assert error.sqlstate == FOREIGN_KEY_VIOLATION


def test_orm_refuses_to_delete_a_mountain_with_an_image(mountain):
    image_record(mountain).save(force_insert=True)

    with pytest.raises(ProtectedError):
        mountain.delete()


def test_database_refuses_to_delete_a_mountain_with_an_image(mountain):
    image_record(mountain).save(force_insert=True)
    execute("SET CONSTRAINTS ALL IMMEDIATE")

    error = database_error(lambda: execute("DELETE FROM mountain WHERE id = %s", [mountain.id]))

    assert error.sqlstate == FOREIGN_KEY_VIOLATION


def test_a_mountain_without_dependents_can_be_deleted(mountain):
    mountain.delete()

    assert not MountainRecord.objects.exists()

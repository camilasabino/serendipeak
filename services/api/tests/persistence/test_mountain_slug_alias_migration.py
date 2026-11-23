import pytest
from django.db import connection

from serendipeak.persistence.catalog_store import DjangoCatalogStore
from tests.support.catalog import fixture_catalog
from tests.support.migrations import (
    historical_model,
    migrate_to,
    migrate_to_latest,
    migrate_to_latest_discarding_catalog,
)

BEFORE = ("catalog", "0023_login_attempt")
AFTER = ("catalog", "0024_mountain_slug_alias")

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def back_to_the_latest_schema():
    yield
    migrate_to_latest_discarding_catalog()


def stored_mountains(target):
    return list(historical_model(target, "MountainRecord").objects.order_by("id").values())


def load_catalog_then_migrate_back_to(target):
    """Rows that predate a migration: the ORM writes the latest schema, which is then reverted.

    The columns the later migrations added are dropped with their values, which are all null.
    """
    migrate_to_latest()
    DjangoCatalogStore().load(fixture_catalog())
    migrate_to(target)


def table_exists():
    return "mountain_slug_alias" in connection.introspection.table_names()


def test_the_migration_keeps_every_mountain_untouched_and_starts_with_no_former_slugs():
    load_catalog_then_migrate_back_to(BEFORE)
    before = stored_mountains(BEFORE)

    migrate_to(AFTER)

    assert len(before) == 73
    assert stored_mountains(AFTER) == before
    with connection.cursor() as cursor:
        cursor.execute("SELECT count(*) FROM mountain_slug_alias")
        assert cursor.fetchone()[0] == 0


def test_a_mountain_published_before_the_migration_keeps_its_old_address_afterwards():
    load_catalog_then_migrate_back_to(BEFORE)
    migrate_to(AFTER)

    mountains = historical_model(AFTER, "MountainRecord").objects
    slug = mountains.filter(status="active").order_by("slug").values_list("slug", flat=True)[0]
    mountains.filter(slug=slug).update(slug="renamed-after-migration")

    with connection.cursor() as cursor:
        cursor.execute("SELECT slug FROM mountain_slug_alias")
        assert cursor.fetchall() == [(slug,)]


def test_reversing_the_migration_drops_the_table_and_its_triggers_and_keeps_the_mountains():
    load_catalog_then_migrate_back_to(AFTER)
    before = stored_mountains(AFTER)

    migrate_to(BEFORE)

    assert not table_exists()
    assert stored_mountains(BEFORE) == before
    historical_model(BEFORE, "MountainRecord").objects.filter(slug="aconcagua").update(
        slug="renamed-without-triggers"
    )

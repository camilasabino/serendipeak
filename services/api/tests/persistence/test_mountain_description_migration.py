import pytest
from django.db import connection

from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.models import MountainRecord
from tests.support.catalog import fixture_catalog
from tests.support.migrations import (
    historical_model,
    migrate_to,
    migrate_to_latest,
    migrate_to_latest_discarding_catalog,
)

BEFORE = ("catalog", "0024_mountain_slug_alias")
AFTER = ("catalog", "0025_mountain_description")
DESCRIPTION_COLUMNS = {"description_en", "description_es", "description_pt"}

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def back_to_the_latest_schema():
    yield
    migrate_to_latest_discarding_catalog()


def mountain_columns():
    with connection.cursor() as cursor:
        return {
            column.name
            for column in connection.introspection.get_table_description(cursor, "mountain")
        }


def stored_mountains(target):
    return list(historical_model(target, "MountainRecord").objects.order_by("id").values())


def load_catalog_then_migrate_back():
    migrate_to_latest()
    DjangoCatalogStore().load(fixture_catalog())
    migrate_to(BEFORE)


def test_the_migration_adds_the_columns_and_keeps_every_mountain_untouched():
    load_catalog_then_migrate_back()
    before = stored_mountains(BEFORE)
    assert not DESCRIPTION_COLUMNS & mountain_columns()

    migrate_to(AFTER)

    after = stored_mountains(AFTER)
    assert len(before) == 73
    assert DESCRIPTION_COLUMNS <= mountain_columns()
    assert [{**row, **dict.fromkeys(DESCRIPTION_COLUMNS)} for row in before] == after


def test_reversing_the_migration_keeps_the_mountains_and_drops_the_columns():
    load_catalog_then_migrate_back()
    migrate_to(AFTER)
    before = stored_mountains(AFTER)

    migrate_to(BEFORE)

    assert not DESCRIPTION_COLUMNS & mountain_columns()
    assert stored_mountains(BEFORE) == [
        {name: value for name, value in row.items() if name not in DESCRIPTION_COLUMNS}
        for row in before
    ]


def test_a_description_can_be_stored_after_the_migration_and_is_absent_before_it_is_written():
    load_catalog_then_migrate_back()
    migrate_to(AFTER)
    migrate_to_latest()

    assert MountainRecord.objects.exclude(description_en=None).count() == 0
    MountainRecord.objects.filter(slug="aconcagua").update(description_en="First.\n\nSecond.")

    assert MountainRecord.objects.get(slug="aconcagua").description_en == "First.\n\nSecond."

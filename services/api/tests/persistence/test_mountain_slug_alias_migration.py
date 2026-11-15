import pytest
from django.db import connection

from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.models import MountainRecord
from tests.support.catalog import fixture_catalog
from tests.support.migrations import migrate_to, migrate_to_latest_discarding_catalog

BEFORE = ("catalog", "0023_login_attempt")
AFTER = ("catalog", "0024_mountain_slug_alias")

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def back_to_the_latest_schema():
    yield
    migrate_to_latest_discarding_catalog()


def stored_mountains():
    return list(MountainRecord.objects.order_by("id").values())


def table_exists():
    return "mountain_slug_alias" in connection.introspection.table_names()


def test_the_migration_keeps_every_mountain_untouched_and_starts_with_no_former_slugs():
    migrate_to(BEFORE)
    DjangoCatalogStore().load(fixture_catalog())
    before = stored_mountains()

    migrate_to(AFTER)

    assert len(before) == 73
    assert stored_mountains() == before
    with connection.cursor() as cursor:
        cursor.execute("SELECT count(*) FROM mountain_slug_alias")
        assert cursor.fetchone()[0] == 0


def test_a_mountain_published_before_the_migration_keeps_its_old_address_afterwards():
    migrate_to(BEFORE)
    DjangoCatalogStore().load(fixture_catalog())
    migrate_to(AFTER)

    slug = MountainRecord.objects.filter(status="active").order_by("slug").first().slug
    MountainRecord.objects.filter(slug=slug).update(slug="renamed-after-migration")

    with connection.cursor() as cursor:
        cursor.execute("SELECT slug FROM mountain_slug_alias")
        assert cursor.fetchall() == [(slug,)]


def test_reversing_the_migration_drops_the_table_and_its_triggers_and_keeps_the_mountains():
    migrate_to(AFTER)
    DjangoCatalogStore().load(fixture_catalog())
    before = stored_mountains()

    migrate_to(BEFORE)

    assert not table_exists()
    assert stored_mountains() == before
    MountainRecord.objects.filter(slug="aconcagua").update(slug="renamed-without-triggers")

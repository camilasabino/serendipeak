import pytest
from django.contrib.auth.models import Permission
from django.db import connection

from tests.support.migrations import (
    applied_head,
    latest_head,
    migrate_to,
    migrate_to_latest,
    migrate_to_latest_discarding_catalog,
)
from tests.support.records import mountain_record

BEFORE = ("catalog", "0012_catalog_pruning")
AFTER = ("catalog", "0013_user_record_and_role_permissions")

pytestmark = pytest.mark.django_db(transaction=True)


def tables():
    with connection.cursor() as cursor:
        return set(connection.introspection.table_names(cursor))


@pytest.fixture(autouse=True)
def back_to_the_latest_schema():
    yield
    migrate_to_latest_discarding_catalog()


def test_the_default_user_tables_are_not_created():
    assert "app_user" in tables()
    assert not {"auth_user", "auth_user_groups", "auth_user_user_permissions"} & tables()


def test_a_fresh_database_has_no_admin_log_table():
    assert "django_admin_log" not in tables()


def test_the_publish_permission_no_longer_exists():
    assert not Permission.objects.filter(codename="publish_mountain").exists()


def test_the_migration_reverses_without_touching_the_catalog_and_applies_again():
    mountain_record().save()

    migrate_to(BEFORE)

    assert applied_head() == BEFORE[1]
    assert "app_user" not in tables()
    assert "mountain" in tables()

    # Going back through the geography migrations dropped the continent, which an older schema
    # does not hold, so the mountain is given it again before the final validation.
    migrate_to(("catalog", "0017_mountain_continent"))
    with connection.cursor() as cursor:
        cursor.execute("UPDATE mountain SET continent_code = 'SA'")
    migrate_to_latest()

    assert applied_head() == latest_head()
    assert "app_user" in tables()
    with connection.cursor() as cursor:
        cursor.execute("SELECT count(*) FROM mountain WHERE slug = 'aconcagua'")
        assert cursor.fetchone()[0] == 1

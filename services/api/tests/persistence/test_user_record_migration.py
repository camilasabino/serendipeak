import pytest
from django.contrib.auth.models import Permission
from django.db import connection

from tests.support.migrations import applied_head, migrate_to, migrate_to_latest
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
    migrate_to_latest()


def test_a_fresh_database_creates_the_user_table_before_the_admin_log_that_references_it():
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT name FROM django_migrations WHERE (app, name) IN "
            "(('catalog', %s), ('admin', '0001_initial')) ORDER BY id",
            [AFTER[1]],
        )
        order = [row[0] for row in cursor.fetchall()]

    assert order == [AFTER[1], "0001_initial"]


def test_the_default_user_tables_are_not_created():
    assert "app_user" in tables()
    assert not {"auth_user", "auth_user_groups", "auth_user_user_permissions"} & tables()


def test_the_admin_log_references_the_user_table():
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT confrelid::regclass::text FROM pg_constraint "
            "WHERE conrelid = 'django_admin_log'::regclass AND contype = 'f' "
            "AND conname LIKE '%user_id%'"
        )
        referenced = [row[0] for row in cursor.fetchall()]

    assert referenced == ["app_user"]


def test_the_publish_permission_no_longer_exists():
    assert not Permission.objects.filter(codename="publish_mountain").exists()


def test_the_migration_reverses_without_touching_the_catalog_and_applies_again():
    mountain_record().save()

    migrate_to(BEFORE)

    assert applied_head() == BEFORE[1]
    assert "app_user" not in tables()
    assert "django_admin_log" not in tables()
    assert "mountain" in tables()

    migrate_to_latest()

    assert applied_head() == "0013_user_record_and_role_permissions"
    assert "app_user" in tables()
    with connection.cursor() as cursor:
        cursor.execute("SELECT count(*) FROM mountain WHERE slug = 'aconcagua'")
        assert cursor.fetchone()[0] == 1

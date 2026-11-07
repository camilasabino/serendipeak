from django.db import connections
from django.db.backends.signals import connection_created
from django.db.models.signals import post_migrate

from tests.support.geography import restore_reference_data

# The maintenance databases Django connects to while it creates and drops the test database.
MAINTENANCE_DATABASES = frozenset({"postgres", "template1"})


def _refuse_a_database_that_is_not_for_tests(sender, connection, **kwargs):
    # A fixture that reaches the database without pytest-django having swapped in the test one
    # would otherwise run against whatever DATABASE_URL names, the development database included.
    name = connection.settings_dict["NAME"] or "postgres"
    if name not in MAINTENANCE_DATABASES and not name.startswith("test_"):
        raise RuntimeError(f"the tests refuse to connect to the non-test database {name!r}")


def _restore_reference_data_after_flush(sender, using, **kwargs):
    # A transactional test ends by flushing every table, the reference tables included, and the
    # rows exist only because a migration loaded them. Flushing sends post_migrate once the
    # tables are empty, which is the moment to load them again.
    if sender.label != "catalog":
        return
    connection = connections[using]
    if {"continent", "country"} <= set(connection.introspection.table_names()):
        restore_reference_data(connection)


connection_created.connect(
    _refuse_a_database_that_is_not_for_tests, dispatch_uid="refuse-non-test-database"
)
post_migrate.connect(_restore_reference_data_after_flush, dispatch_uid="restore-reference-data")

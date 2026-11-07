from django.db import connection
from django.db.migrations.executor import MigrationExecutor


def migrate_to(target):
    executor = MigrationExecutor(connection)
    executor.loader.build_graph()
    executor.migrate([target])


def migrate_to_latest():
    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())


def migrate_to_latest_discarding_catalog():
    """Returns to the latest schema after a test that filled an older one.

    The rows a test loaded at an older schema carry no continent, which the latest schema
    refuses, and the test is over with them, so they go first.
    """
    with connection.cursor() as cursor:
        cursor.execute("TRUNCATE TABLE mountain CASCADE")
    migrate_to_latest()


def applied_head():
    executor = MigrationExecutor(connection)

    return max(name for app, name in executor.loader.applied_migrations if app == "catalog")


def historical_model(target, model_name):
    executor = MigrationExecutor(connection)

    return executor.loader.project_state([target]).apps.get_model("catalog", model_name)

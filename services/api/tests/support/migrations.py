from django.db import connection
from django.db.migrations.executor import MigrationExecutor


def migrate_to(target):
    executor = MigrationExecutor(connection)
    executor.loader.build_graph()
    executor.migrate([target])


def migrate_to_latest():
    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())


def applied_head():
    executor = MigrationExecutor(connection)

    return max(name for app, name in executor.loader.applied_migrations if app == "catalog")


def historical_model(target, model_name):
    executor = MigrationExecutor(connection)

    return executor.loader.project_state([target]).apps.get_model("catalog", model_name)

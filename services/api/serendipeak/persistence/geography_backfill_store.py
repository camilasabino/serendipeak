from collections.abc import Sequence

from django.db import connection, transaction
from django.db.migrations.recorder import MigrationRecorder

from serendipeak.catalog.bootstrap.ports import BackfillTarget
from serendipeak.catalog.errors import GeographyBackfillRejected, UnexpectedSchemaState
from serendipeak.catalog.geography_input import (
    BackfillPlan,
    GeographyInput,
    StoredGeography,
    plan_backfill,
)
from serendipeak.persistence.errors import translate_database_errors
from serendipeak.persistence.models import (
    CountryRecord,
    MountainCountryRecord,
    MountainRecord,
)

SCHEMA_READY = "0017_mountain_continent"
FINAL_MIGRATION = "0018_geography_final_validation"


def _catalog_migration() -> str:
    applied = MigrationRecorder(connection).applied_migrations()

    return max((name for app, name in applied if app == "catalog"), default="none")


def _table_columns(table: str) -> set[str]:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT column_name FROM information_schema.columns"
            " WHERE table_schema = current_schema() AND table_name = %s",
            [table],
        )
        return {name for (name,) in cursor.fetchall()}


def _read_stored_geography() -> list[StoredGeography]:
    """Read what the mountain table holds, whatever migration the schema is at.

    The model describes the final schema, which has neither the text array of v1 country names
    nor, before the schema migrations, the continent or the links, so this reads with SQL and
    takes the columns that exist.
    """
    columns = _table_columns("mountain")
    legacy = "countries" in columns
    has_continent = "continent_code" in columns
    selected = ", ".join(
        [
            "id",
            "slug",
            "countries" if legacy else "NULL",
            "continent_code" if has_continent else "NULL",
        ]
    )

    with connection.cursor() as cursor:
        cursor.execute(f'SELECT {selected} FROM mountain ORDER BY slug COLLATE "C"')
        rows = cursor.fetchall()

        links: dict = {}
        if _table_columns("mountain_country"):
            cursor.execute("SELECT mountain_id, country_code FROM mountain_country")
            for mountain_id, country_code in cursor.fetchall():
                links.setdefault(mountain_id, []).append(country_code)

    return [
        StoredGeography(
            id=mountain_id,
            slug=slug,
            legacy_country_names=None if names is None else tuple(names),
            continent_code=continent_code,
            country_codes=tuple(sorted(links.get(mountain_id, ()))),
        )
        for mountain_id, slug, names, continent_code in rows
    ]


class DjangoGeographyBackfillStore:
    def target(self) -> BackfillTarget:
        settings = connection.settings_dict
        with translate_database_errors(), connection.cursor() as cursor:
            cursor.execute("SELECT current_database()")
            (database,) = cursor.fetchone()

            return BackfillTarget(
                database=database,
                host=str(settings.get("HOST") or "local socket"),
                port=str(settings.get("PORT") or "default"),
                migration=_catalog_migration(),
            )

    def backfill(self, geography: GeographyInput, *, dry_run: bool) -> BackfillPlan:
        with translate_database_errors(), transaction.atomic():
            migration = _catalog_migration()
            if migration not in (SCHEMA_READY, FINAL_MIGRATION):
                raise UnexpectedSchemaState(migration, (SCHEMA_READY, FINAL_MIGRATION))

            # SHARE ROW EXCLUSIVE conflicts with itself and with every write, so the mountains
            # judged below are the mountains written, and a concurrent backfill waits.
            table = connection.ops.quote_name(MountainRecord._meta.db_table)
            with connection.cursor() as cursor:
                cursor.execute(f"LOCK TABLE {table} IN SHARE ROW EXCLUSIVE MODE")

            plan = plan_backfill(
                geography,
                _read_stored_geography(),
                frozenset(CountryRecord.objects.values_list("code", flat=True)),
            )
            if dry_run:
                return plan
            if migration == FINAL_MIGRATION and plan.changes:
                raise GeographyBackfillRejected(
                    (
                        f"{len(plan.changes)} mountain(s) differ, but the final migration is"
                        " applied and the catalog is no longer overwritten from the input",
                    )
                )

            self._write(geography, plan)

        return plan

    def _write(self, geography: GeographyInput, plan: BackfillPlan) -> None:
        by_slug = {entry.slug: entry for entry in geography.mountains}

        for change in plan.changes:
            entry = by_slug[change.slug]
            if change.continent is not None:
                MountainRecord.objects.filter(pk=entry.id).update(continent_id=entry.continent_code)
            MountainCountryRecord.objects.filter(
                mountain_id=entry.id, country_id__in=change.removed_countries
            ).delete()
            MountainCountryRecord.objects.bulk_create(
                MountainCountryRecord(mountain_id=entry.id, country_id=code)
                for code in change.added_countries
            )


class DjangoGeographyDraftReader:
    def read_mountains(self) -> Sequence[StoredGeography]:
        with translate_database_errors():
            return _read_stored_geography()

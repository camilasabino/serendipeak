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
from serendipeak.catalog.regions import MountainRegion, region_id_for_slug
from serendipeak.persistence.errors import translate_database_errors
from serendipeak.persistence.mapping import region_record, to_region
from serendipeak.persistence.models import (
    CountryRecord,
    MountainCountryRecord,
    MountainRecord,
    MountainRegionRecord,
)

# The migrations the backfill runs between, oldest first. The continent and the countries are
# written until the first one that validates them (the second), the regions until the last.
MIGRATIONS = (
    "0017_mountain_continent",
    "0018_geography_final_validation",
    "0019_mountain_region",
    "0020_region_final_validation",
)
GEOGRAPHY_FINAL = 1
REGIONS_FINAL = 3


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
    nor the v1 range name and, before the schema migrations, neither the continent, the links
    nor the region, so this reads with SQL and takes the columns that exist.
    """
    columns = _table_columns("mountain")
    legacy = "countries" in columns
    has_continent = "continent_code" in columns
    has_range = "range_name" in columns
    has_region = "region_id" in columns
    selected = ", ".join(
        [
            "m.id",
            "m.slug",
            "m.countries" if legacy else "NULL",
            "m.continent_code" if has_continent else "NULL",
            "m.range_name" if has_range else "NULL",
            "r.slug" if has_region else "NULL",
        ]
    )
    join = "LEFT JOIN mountain_region r ON r.id = m.region_id" if has_region else ""

    with connection.cursor() as cursor:
        cursor.execute(f'SELECT {selected} FROM mountain m {join} ORDER BY m.slug COLLATE "C"')
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
            has_legacy_range_name=has_range,
            legacy_range_name=range_name,
            region_slug=region_slug,
        )
        for mountain_id, slug, names, continent_code, range_name, region_slug in rows
    ]


def _read_stored_regions() -> list[MountainRegion] | None:
    if not _table_columns("mountain_region"):
        return None

    return [to_region(record) for record in MountainRegionRecord.objects.all()]


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
            if migration not in MIGRATIONS:
                raise UnexpectedSchemaState(migration, MIGRATIONS)

            # SHARE ROW EXCLUSIVE conflicts with itself and with every write, so the mountains
            # and regions judged below are the ones written, and a concurrent backfill waits.
            tables = [MountainRecord._meta.db_table]
            if _table_columns(MountainRegionRecord._meta.db_table):
                tables.append(MountainRegionRecord._meta.db_table)
            with connection.cursor() as cursor:
                for table in tables:
                    cursor.execute(
                        f"LOCK TABLE {connection.ops.quote_name(table)} IN SHARE ROW EXCLUSIVE MODE"
                    )

            plan = plan_backfill(
                geography,
                _read_stored_geography(),
                frozenset(CountryRecord.objects.values_list("code", flat=True)),
                _read_stored_regions(),
            )
            if dry_run:
                return plan

            blocked = _changes_after_their_final_migration(plan, MIGRATIONS.index(migration))
            if blocked:
                raise GeographyBackfillRejected(
                    (
                        f"{blocked} change(s) differ, but the migration that validates them is"
                        " applied and the catalog is no longer overwritten from the input",
                    )
                )

            self._write(geography, plan)

        return plan

    def _write(self, geography: GeographyInput, plan: BackfillPlan) -> None:
        by_slug = {entry.slug: entry for entry in geography.mountains}

        if plan.new_regions:
            wanted = set(plan.new_regions)
            MountainRegionRecord.objects.bulk_create(
                region_record(region) for region in geography.regions if region.slug in wanted
            )

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
            if change.region is not None:
                MountainRecord.objects.filter(pk=entry.id).update(
                    region_id=None
                    if entry.region_slug is None
                    else region_id_for_slug(entry.region_slug)
                )


def _changes_after_their_final_migration(plan: BackfillPlan, applied: int) -> int:
    geography_final = applied >= GEOGRAPHY_FINAL
    regions_final = applied >= REGIONS_FINAL

    return sum(
        (geography_final and _changes_geography(change))
        or (regions_final and change.region is not None)
        for change in plan.changes
    ) + (len(plan.new_regions or ()) if regions_final else 0)


def _changes_geography(change) -> bool:
    return bool(change.continent or change.added_countries or change.removed_countries)


class DjangoGeographyDraftReader:
    def read_mountains(self) -> Sequence[StoredGeography]:
        with translate_database_errors():
            return _read_stored_geography()

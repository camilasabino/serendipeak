import pytest
from django.db import connection

from serendipeak.catalog.errors import GeographyBackfillRejected
from serendipeak.persistence.geography_backfill_store import DjangoGeographyBackfillStore
from tests.support.geography import geography_document, invented_id, parse_document
from tests.support.geography_schema import (
    FINAL,
    PRESERVED,
    REGIONS,
    REGIONS_FINAL,
    SCHEMA_READY,
    column_names,
    constraint_names,
    fingerprints,
    mountain_values,
)
from tests.support.migrations import (
    applied_head,
    historical_model,
    migrate_to,
    migrate_to_latest,
    migrate_to_latest_discarding_catalog,
)
from tests.support.regions import region_path, regions_of

pytestmark = pytest.mark.django_db(transaction=True)

ALPHA, BETA, ICE = "alpha-peak", "beta-peak", "ice-peak"
CHAIN, RANGE = "Alpha Chain", "Beta Range"
WITH_RANGE = f"{PRESERVED}, range_name"
TAXONOMY = regions_of(region_path(CHAIN, RANGE), region_path("Gamma Chain"))
GAMMA_ONLY = regions_of(region_path("Gamma Chain"))


@pytest.fixture(autouse=True)
def back_to_the_latest_schema():
    yield
    migrate_to_latest_discarding_catalog()


GEOGRAPHY = {
    ALPHA: ("SA", "AR", ["Argentina"]),
    BETA: ("EU", "CH", ["Switzerland"]),
    ICE: ("AN", "AQ", []),
}


def populate_at(target):
    """The three mountains as the schema of target holds them: with their geography already
    applied from the final geography migration on, and with the v1 country names before it."""
    migrate_to(target)
    model = historical_model(target, "MountainRecord")
    ranges = {ALPHA: RANGE, BETA: "Gamma Chain", ICE: None}
    legacy = target == SCHEMA_READY

    for slug, (continent, country, names) in GEOGRAPHY.items():
        columns = mountain_values(slug, names, range_name=ranges[slug])
        if slug == ICE:
            columns.update(status="draft", summary_en=None, osm_node_id=None)
        if not legacy:
            columns.pop("countries")
            columns["continent_id"] = continent
        model.objects.create(**columns)
        if not legacy:
            with connection.cursor() as cursor:
                cursor.execute(
                    "INSERT INTO mountain_country (mountain_id, country_code) VALUES (%s, %s)",
                    [invented_id(slug), country],
                )


def document(*, alpha=RANGE, beta="Gamma Chain", ice=None, regions=TAXONOMY):
    slugs = {RANGE: "beta-range", "Gamma Chain": "gamma-chain", CHAIN: "alpha-chain"}
    entries = []
    for slug, continent, countries, name in (
        (ALPHA, "SA", ["AR"], alpha),
        (BETA, "EU", ["CH"], beta),
        (ICE, "AN", ["AQ"], ice),
    ):
        entries.append(
            (
                invented_id(slug),
                slug,
                continent,
                countries,
                *(() if name is None else (slugs[name],)),
            )
        )

    return geography_document(entries, regions)


def backfill(doc, *, dry_run=False):
    return DjangoGeographyBackfillStore().backfill(parse_document(doc), dry_run=dry_run)


def stored_regions():
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT r.slug, r.name_en, p.slug FROM mountain_region r"
            " LEFT JOIN mountain_region p ON p.id = r.parent_id ORDER BY r.slug"
        )
        return cursor.fetchall()


def stored_region_of_each_mountain():
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT m.slug, r.slug FROM mountain m"
            " LEFT JOIN mountain_region r ON r.id = m.region_id ORDER BY m.slug"
        )
        return dict(cursor.fetchall())


def table_names():
    with connection.cursor() as cursor:
        return set(connection.introspection.table_names(cursor))


def trigger_names():
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT tgname FROM pg_trigger WHERE tgrelid = 'mountain_region'::regclass"
            " AND NOT tgisinternal"
        )
        return {name for (name,) in cursor.fetchall()}


class TestSchemaMigration:
    def test_the_table_and_the_nullable_reference_arrive_empty_without_touching_mountains(self):
        populate_at(FINAL)
        before = fingerprints(WITH_RANGE)

        migrate_to(REGIONS)

        assert stored_regions() == []
        assert set(stored_region_of_each_mountain().values()) == {None}
        assert fingerprints(WITH_RANGE) == before
        assert {"region_id", "range_name"} <= column_names()

    def test_the_triggers_and_constraints_arrive_with_the_table(self):
        migrate_to(REGIONS)

        assert trigger_names() == {"mountain_region_no_cycle", "mountain_region_identity_immutable"}
        assert {
            "mountain_region_slug_key",
            "mountain_region_slug_format",
            "mountain_region_not_its_own_parent",
            "mountain_region_sibling_name_key",
            "mountain_region_wikidata_id_key",
        } <= constraint_names("mountain_region") | index_names()

    def test_reversing_removes_the_table_the_triggers_and_the_reference(self):
        populate_at(FINAL)
        migrate_to(REGIONS)
        before = fingerprints(WITH_RANGE)

        migrate_to(FINAL)

        assert "mountain_region" not in table_names()
        assert "region_id" not in column_names()
        assert fingerprints(WITH_RANGE) == before
        with connection.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM pg_proc WHERE proname LIKE 'mountain_region%'")
            assert cursor.fetchone()[0] == 0

    def test_it_applies_again_after_a_reversal(self):
        migrate_to(REGIONS)
        migrate_to(FINAL)

        migrate_to(REGIONS)

        assert "mountain_region" in table_names()


def index_names():
    with connection.cursor() as cursor:
        cursor.execute("SELECT indexname FROM pg_indexes WHERE tablename = 'mountain_region'")
        return {name for (name,) in cursor.fetchall()}


class TestConversion:
    @pytest.fixture
    def converted_up_to_the_backfill(self):
        populate_at(FINAL)
        before = fingerprints(WITH_RANGE)
        migrate_to(REGIONS)

        return before

    def test_the_whole_conversion_keeps_every_column_and_every_assignment(
        self, converted_up_to_the_backfill
    ):
        plan = backfill(document())
        migrate_to(REGIONS_FINAL)

        assert applied_head() == REGIONS_FINAL[1]
        assert (plan.checked, plan.new_regions) == (3, ("alpha-chain", "beta-range", "gamma-chain"))
        assert stored_regions() == [
            ("alpha-chain", CHAIN, None),
            ("beta-range", RANGE, "alpha-chain"),
            ("gamma-chain", "Gamma Chain", None),
        ]
        assert stored_region_of_each_mountain() == {
            ALPHA: "beta-range",
            BETA: "gamma-chain",
            ICE: None,
        }
        assert fingerprints(PRESERVED) == fingerprints_without_range(converted_up_to_the_backfill)
        assert "range_name" not in column_names()
        assert "mountain_range_name_not_blank" not in constraint_names()

    def test_the_backfill_writes_regions_and_region_ids_and_nothing_else(
        self, converted_up_to_the_backfill
    ):
        backfill(document())

        assert fingerprints(WITH_RANGE) == converted_up_to_the_backfill

    def test_a_rerun_reports_no_change_and_writes_nothing(self, converted_up_to_the_backfill):
        backfill(document())
        before = (stored_regions(), stored_region_of_each_mountain())

        again = backfill(document())

        assert (again.changes, again.new_regions) == ((), ())
        assert (stored_regions(), stored_region_of_each_mountain()) == before

    def test_a_dry_run_reports_and_writes_nothing(self, converted_up_to_the_backfill):
        plan = backfill(document(), dry_run=True)

        assert plan.new_regions == ("alpha-chain", "beta-range", "gamma-chain")
        assert stored_regions() == []
        assert set(stored_region_of_each_mountain().values()) == {None}

    def test_a_range_name_the_input_does_not_carry_stops_everything_and_names_the_mountain(
        self, converted_up_to_the_backfill
    ):
        with pytest.raises(GeographyBackfillRejected, match=f"{ALPHA}: region None does not match"):
            backfill(document(alpha=None, regions=GAMMA_ONLY))

        assert stored_regions() == []
        assert set(stored_region_of_each_mountain().values()) == {None}

    def test_a_region_that_is_not_the_stored_range_name_stops_everything(
        self, converted_up_to_the_backfill
    ):
        with pytest.raises(GeographyBackfillRejected, match=f"{ALPHA}: region 'Gamma Chain'"):
            backfill(document(alpha="Gamma Chain", regions=GAMMA_ONLY))

        assert stored_regions() == []

    def test_a_stored_region_the_input_lacks_is_refused(self, converted_up_to_the_backfill):
        backfill(document())
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO mountain_region (id, slug, name_en) VALUES (gen_random_uuid(),"
                " 'stray-chain', 'Stray')"
            )

        with pytest.raises(GeographyBackfillRejected, match="stray-chain"):
            backfill(document())

    def test_a_failure_halfway_leaves_nothing_written(
        self, converted_up_to_the_backfill, monkeypatch
    ):
        from serendipeak.persistence import geography_backfill_store as module

        real = module.MountainRecord.objects.filter

        def failing(*args, **kwargs):
            raise RuntimeError("the mountain write fails")

        monkeypatch.setattr(module.MountainRecord.objects, "filter", failing)

        with pytest.raises(Exception, match="database operation failed|mountain write"):
            backfill(document())
        monkeypatch.setattr(module.MountainRecord.objects, "filter", real)

        assert stored_regions() == []

    def test_a_mountain_without_a_range_name_keeps_no_region(self, converted_up_to_the_backfill):
        backfill(document())

        assert stored_region_of_each_mountain()[ICE] is None


def fingerprints_without_range(_):
    return fingerprints(PRESERVED)


class TestFinalValidation:
    def test_it_stops_naming_the_mountains_whose_range_name_has_no_region(self):
        populate_at(FINAL)
        migrate_to(REGIONS)
        before = fingerprints(WITH_RANGE)

        with pytest.raises(RuntimeError) as raised:
            migrate_to(REGIONS_FINAL)

        assert f"range name without a region: {ALPHA}, {BETA}" in str(raised.value)
        assert applied_head() == REGIONS[1]
        assert "range_name" in column_names()
        assert fingerprints(WITH_RANGE) == before

    def test_it_stops_naming_the_mountains_whose_region_is_not_their_range_name(self):
        populate_at(FINAL)
        migrate_to(REGIONS)
        backfill(document())
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE mountain_region SET name_en = 'Renamed' WHERE slug = 'beta-range'"
            )

        with pytest.raises(RuntimeError, match=f"region name differs from the range name: {ALPHA}"):
            migrate_to(REGIONS_FINAL)

        assert applied_head() == REGIONS[1]

    def test_without_mountains_it_passes_on_zero_rows(self):
        migrate_to(FINAL)

        migrate_to_latest()

        assert applied_head() == "0021_daily_discovery_retention"
        assert stored_regions() == []
        assert "range_name" not in column_names()

    def test_a_mountain_without_a_range_name_does_not_need_a_region(self):
        migrate_to(FINAL)
        model = historical_model(FINAL, "MountainRecord")
        columns = {
            key: value
            for key, value in mountain_values(ICE, range_name=None).items()
            if key != "countries"
        }
        model.objects.create(**columns, continent_id="AN")

        migrate_to(REGIONS_FINAL)

        assert applied_head() == REGIONS_FINAL[1]

    def test_reversing_gives_each_mountain_the_name_of_its_region_and_keeps_the_regions(self):
        populate_at(FINAL)
        migrate_to(REGIONS)
        backfill(document())
        migrate_to(REGIONS_FINAL)

        migrate_to(REGIONS)

        model = historical_model(REGIONS, "MountainRecord")
        assert {row.slug: row.range_name for row in model.objects.all()} == {
            ALPHA: RANGE,
            BETA: "Gamma Chain",
            ICE: None,
        }
        assert stored_region_of_each_mountain()[ALPHA] == "beta-range"
        assert len(stored_regions()) == 3


class TestBackfillAcrossTheSchemas:
    def test_before_the_region_table_only_the_continent_and_countries_are_written(self):
        populate_at(SCHEMA_READY)
        with connection.cursor() as cursor:
            cursor.execute("UPDATE mountain SET continent_code = NULL")

        plan = DjangoGeographyBackfillStore().backfill(parse_document(document()), dry_run=False)

        assert plan.new_regions is None
        assert {slug: value[0] for slug, value in stored_geography().items()} == {
            ALPHA: "SA",
            BETA: "EU",
            ICE: "AN",
        }

    def test_the_regions_follow_once_the_schema_has_them(self):
        populate_at(SCHEMA_READY)
        with connection.cursor() as cursor:
            cursor.execute("UPDATE mountain SET continent_code = NULL")
        DjangoGeographyBackfillStore().backfill(parse_document(document()), dry_run=False)
        migrate_to(REGIONS)

        plan = backfill(document())

        assert len(plan.new_regions) == 3
        assert stored_region_of_each_mountain()[ALPHA] == "beta-range"

    def test_after_the_region_migration_a_matching_input_reports_no_change(self):
        populate_at(FINAL)
        migrate_to(REGIONS)
        backfill(document())
        migrate_to(REGIONS_FINAL)

        plan = backfill(document())

        assert (plan.changes, plan.new_regions) == ((), ())

    def test_after_the_region_migration_a_differing_region_is_refused_and_writes_nothing(self):
        populate_at(FINAL)
        migrate_to(REGIONS)
        backfill(document())
        migrate_to(REGIONS_FINAL)
        before = stored_region_of_each_mountain()

        with pytest.raises(GeographyBackfillRejected, match="no longer overwritten"):
            backfill(document(ice="Gamma Chain"))

        assert stored_region_of_each_mountain() == before


def stored_geography():
    with connection.cursor() as cursor:
        cursor.execute("SELECT slug, continent_code FROM mountain ORDER BY slug")
        return {slug: (continent,) for slug, continent in cursor.fetchall()}

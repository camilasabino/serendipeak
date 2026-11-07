import json

import pytest
from django.db import connection

from serendipeak.catalog.bootstrap.apply_geography_backfill import ApplyGeographyBackfill
from serendipeak.catalog.errors import (
    GeographyBackfillRejected,
    InvalidGeographyInput,
    UnexpectedSchemaState,
)
from serendipeak.persistence.geography_backfill_store import DjangoGeographyBackfillStore
from tests.support.geography import geography_document, invented_id, parse_document
from tests.support.geography_schema import (
    BEFORE_GEOGRAPHY,
    CONTINENTS,
    COUNTRIES,
    FINAL,
    LOCALIZED,
    PRESERVED,
    SCHEMA_READY,
    column_names,
    constraint_names,
    fingerprints,
    migrate_to_schema_ready,
    mountain_values,
    nothing_is_assigned,
    stored_geography,
)
from tests.support.migrations import (
    applied_head,
    historical_model,
    migrate_to,
    migrate_to_latest,
    migrate_to_latest_discarding_catalog,
)

pytestmark = pytest.mark.django_db(transaction=True)

ALPHA, BETA, ICE = "alpha-peak", "beta-peak", "ice-peak"


@pytest.fixture(autouse=True)
def back_to_the_latest_schema():
    yield
    migrate_to_latest_discarding_catalog()


def populate(model):
    model.objects.create(**mountain_values(ALPHA, ["Argentina"]))
    model.objects.create(**mountain_values(BETA, ["Switzerland", "Italy"], range_name=None))
    model.objects.create(
        **mountain_values(ICE, [], summary_en=None, osm_node_id=None, status="draft")
    )


def input_document(*, alpha=("SA", ["AR"]), beta=("EU", ["CH", "IT"]), ice=("AN", ["AQ"])):
    return geography_document(
        [
            (invented_id(ALPHA), ALPHA, *alpha),
            (invented_id(BETA), BETA, *beta),
            (invented_id(ICE), ICE, *ice),
        ]
    )


def backfill(document, *, dry_run=False):
    return DjangoGeographyBackfillStore().backfill(parse_document(document), dry_run=dry_run)


class TestLocalizedMountainText:
    def test_the_old_columns_become_the_english_ones_without_copying_or_losing_text(self):
        migrate_to(BEFORE_GEOGRAPHY)
        model = historical_model(BEFORE_GEOGRAPHY, "MountainRecord")
        model.objects.create(
            **{
                **{
                    k: v
                    for k, v in mountain_values(ALPHA).items()
                    if k not in {"name_en", "summary_en", "countries"}
                },
                "name": "Alpha Peak",
                "summary": "An invented summary.",
                "countries": ["Argentina"],
            }
        )

        migrate_to(LOCALIZED)

        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT name_en, name_es, name_pt, summary_en, summary_es, summary_pt FROM mountain"
            )
            assert cursor.fetchone() == (
                "Alpha Peak",
                None,
                None,
                "An invented summary.",
                None,
                None,
            )
        assert {"name", "summary"}.isdisjoint(column_names())

    def test_the_checks_follow_the_new_names(self):
        migrate_to(LOCALIZED)

        names = constraint_names()

        assert {
            "mountain_name_en_not_blank",
            "mountain_name_es_not_blank",
            "mountain_name_pt_not_blank",
            "mountain_summary_en_not_blank",
            "mountain_summary_es_not_blank",
            "mountain_summary_pt_not_blank",
            "mountain_summary_translation_requires_english",
        } <= names
        assert {"mountain_name_not_blank", "mountain_summary_not_blank"}.isdisjoint(names)

    def test_reversing_restores_the_old_columns_and_drops_the_untouched_translations(self):
        migrate_to(LOCALIZED)
        model = historical_model(LOCALIZED, "MountainRecord")
        model.objects.create(**mountain_values(ALPHA, ["Argentina"], name_es="Alfa"))

        migrate_to(BEFORE_GEOGRAPHY)

        with connection.cursor() as cursor:
            cursor.execute("SELECT name, summary FROM mountain")
            assert cursor.fetchone() == ("Alpha Peak", "An invented summary.")
        assert {"name_en", "name_es", "summary_pt"}.isdisjoint(column_names())
        assert {"mountain_name_not_blank", "mountain_summary_not_blank"} <= constraint_names()


class TestSchemaMigrations:
    def test_reference_data_and_the_nullable_continent_arrive_without_touching_mountains(self):
        migrate_to(BEFORE_GEOGRAPHY)
        migrate_to(LOCALIZED)
        model = historical_model(LOCALIZED, "MountainRecord")
        populate(model)
        before = fingerprints(PRESERVED)

        migrate_to_schema_ready()

        with connection.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM continent")
            continents = cursor.fetchone()[0]
            cursor.execute("SELECT count(*) FROM country")
            countries = cursor.fetchone()[0]
            cursor.execute("SELECT count(*) FROM mountain_country")
            links = cursor.fetchone()[0]
        assert (continents, countries, links) == (7, 249, 0)
        assert fingerprints(PRESERVED) == before
        assert "continent_code" in column_names() and "countries" in column_names()
        assert nothing_is_assigned()

    def test_the_schema_migrations_reverse_one_by_one_and_forward_again(self):
        migrate_to_schema_ready()

        for target in (COUNTRIES, CONTINENTS, LOCALIZED, BEFORE_GEOGRAPHY):
            migrate_to(target)
            assert applied_head() == target[1]
        assert {"continent", "country", "mountain_country"}.isdisjoint(table_names())

        migrate_to_latest()

        assert applied_head() == FINAL[1]
        assert {"continent", "country", "mountain_country"} <= table_names()


class TestBackfillThenFinalValidation:
    @pytest.fixture
    def populated(self):
        model = migrate_to_schema_ready()
        populate(model)

        return fingerprints(PRESERVED)

    def test_the_whole_conversion_keeps_every_preserved_column_and_sets_the_geography(
        self, populated
    ):
        plan = backfill(input_document())

        assert (plan.checked, len(plan.changes)) == (3, 3)
        migrate_to_latest()

        assert applied_head() == FINAL[1]
        assert stored_geography() == {
            ALPHA: ("SA", ["AR"]),
            BETA: ("EU", ["CH", "IT"]),
            ICE: ("AN", ["AQ"]),
        }
        assert fingerprints(PRESERVED) == populated
        assert "countries" not in column_names()
        assert is_nullable("mountain", "continent_code") is False

    def test_the_backfill_writes_only_the_continent_and_the_links(self, populated):
        backfill(input_document())

        assert fingerprints(PRESERVED) == populated

    def test_a_rerun_reports_no_change_and_writes_nothing(self, populated):
        backfill(input_document())
        before = stored_geography()

        again = backfill(input_document())

        assert again.changes == ()
        assert (again.checked, again.unchanged) == (3, 3)
        assert stored_geography() == before

    def test_a_dry_run_reports_the_changes_and_writes_nothing(self, populated):
        plan = backfill(input_document(), dry_run=True)

        assert len(plan.changes) == 3
        assert nothing_is_assigned()

    def test_the_final_migration_stops_naming_the_mountains_without_a_continent(self, populated):
        with pytest.raises(RuntimeError) as raised:
            migrate_to_latest()

        message = str(raised.value)
        assert f"no continent: {ALPHA}, {BETA}, {ICE}" in message
        assert applied_head() == SCHEMA_READY[1]
        assert "countries" in column_names()
        assert fingerprints(PRESERVED) == populated

    def test_the_final_migration_stops_naming_the_mountains_whose_links_disagree(self, populated):
        backfill(input_document())
        with connection.cursor() as cursor:
            cursor.execute(
                "DELETE FROM mountain_country WHERE mountain_id = %s AND country_code = 'IT'",
                [invented_id(BETA)],
            )

        with pytest.raises(RuntimeError) as raised:
            migrate_to_latest()

        assert f"countries differ from their links: {BETA}" in str(raised.value)
        assert applied_head() == SCHEMA_READY[1]

    def test_the_final_migration_accepts_antarctica_without_a_legacy_name(self, populated):
        backfill(input_document())

        migrate_to_latest()

        assert stored_geography()[ICE] == ("AN", ["AQ"])

    @pytest.mark.parametrize(
        ("document", "message"),
        [
            (
                input_document(alpha=("SA", ["AR", "CL"])),
                f"{ALPHA}: countries ['AR', 'CL'] do not match",
            ),
            (input_document(beta=("EU", ["CH"])), f"{BETA}: countries ['CH'] do not match"),
            (input_document(alpha=("SA", ["ZZ"])), "country ZZ is not in the reference data"),
        ],
    )
    def test_countries_that_disagree_with_the_stored_names_stop_the_backfill(
        self, populated, document, message
    ):
        with pytest.raises(GeographyBackfillRejected, match=message.replace("[", r"\[")):
            backfill(document)

        assert nothing_is_assigned()

    def test_a_country_name_outside_the_alias_table_stops_the_backfill_and_names_it(
        self, populated
    ):
        model = historical_model(SCHEMA_READY, "MountainRecord")
        model.objects.filter(slug=ALPHA).update(countries=["Argentina", "Narnia"])

        with pytest.raises(GeographyBackfillRejected, match="Narnia"):
            backfill(input_document())

        assert nothing_is_assigned()

    def test_a_mountain_missing_from_the_input_stops_the_backfill_and_names_it(self, populated):
        document = geography_document(
            [(invented_id(ALPHA), ALPHA, "SA", ["AR"]), (invented_id(ICE), ICE, "AN", ["AQ"])]
        )

        with pytest.raises(GeographyBackfillRejected, match=f"mountain {BETA}"):
            backfill(document)

        assert nothing_is_assigned()

    def test_a_stale_entry_stops_the_backfill_and_names_it(self, populated):
        document = geography_document(
            [
                (invented_id(ALPHA), ALPHA, "SA", ["AR"]),
                (invented_id(BETA), BETA, "EU", ["CH", "IT"]),
                (invented_id(ICE), ICE, "AN", ["AQ"]),
                (invented_id("gone-peak"), "gone-peak", "EU", []),
            ]
        )

        with pytest.raises(GeographyBackfillRejected, match="entry gone-peak"):
            backfill(document)

        assert nothing_is_assigned()

    def test_an_input_with_another_checksum_is_refused_before_the_database_is_read(self, populated):
        class NeverTouched(DjangoGeographyBackfillStore):
            def target(self):
                raise AssertionError("the database was read")

        document = input_document()

        with pytest.raises(InvalidGeographyInput, match="expected checksum"):
            ApplyGeographyBackfill(NeverTouched()).execute(
                document, expected_sha256="0" * 64, dry_run=False, announce_target=print
            )

    def test_a_failure_halfway_leaves_nothing_written(self, populated, monkeypatch):
        from serendipeak.persistence import geography_backfill_store

        real = geography_backfill_store.MountainCountryRecord.objects.bulk_create
        calls = []

        def failing(objs, *args, **kwargs):
            calls.append(1)
            if len(calls) == 2:
                raise RuntimeError("the second write fails")
            return real(objs, *args, **kwargs)

        monkeypatch.setattr(
            geography_backfill_store.MountainCountryRecord.objects, "bulk_create", failing
        )

        with pytest.raises(Exception, match="database operation failed|second write"):
            backfill(input_document())

        assert nothing_is_assigned()

    def test_reversing_the_final_migration_restores_the_names_and_keeps_the_links(self, populated):
        backfill(input_document())
        migrate_to_latest()

        migrate_to(SCHEMA_READY)

        model = historical_model(SCHEMA_READY, "MountainRecord")
        assert {row.slug: row.countries for row in model.objects.all()} == {
            ALPHA: ["Argentina"],
            BETA: ["Italy", "Switzerland"],
            ICE: [],
        }
        assert is_nullable("mountain", "continent_code") is True
        assert stored_geography()[BETA] == ("EU", ["CH", "IT"])
        assert fingerprints(PRESERVED) == populated

    def test_reversing_refuses_a_country_that_v1_had_no_name_for(self, populated):
        backfill(input_document())
        migrate_to_latest()
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO mountain_country (mountain_id, country_code) VALUES (%s, 'FI')",
                [invented_id(ALPHA)],
            )

        with pytest.raises(RuntimeError, match="FI"):
            migrate_to(SCHEMA_READY)

        assert applied_head() == FINAL[1]
        assert "countries" not in column_names()


class TestFreshDatabase:
    def test_without_mountains_the_final_validation_passes_on_zero_rows(self):
        migrate_to(BEFORE_GEOGRAPHY)

        migrate_to_latest()

        assert applied_head() == FINAL[1]
        assert stored_geography() == {}
        assert is_nullable("mountain", "continent_code") is False

    def test_the_test_database_itself_was_built_from_zero_at_the_final_migration(self):
        assert applied_head() == FINAL[1]


class TestBackfillRefusesTheWrongSchema:
    @pytest.mark.parametrize("target", [BEFORE_GEOGRAPHY, LOCALIZED, COUNTRIES])
    def test_before_the_schema_is_ready_nothing_is_read(self, target):
        migrate_to(target)

        with pytest.raises(UnexpectedSchemaState) as raised:
            backfill(input_document())

        assert target[1] in str(raised.value)

    def test_after_the_final_migration_a_matching_input_reports_no_change(self):
        model = migrate_to_schema_ready()
        populate(model)
        backfill(input_document())
        migrate_to_latest()

        plan = backfill(input_document())

        assert plan.changes == ()

    def test_after_the_final_migration_a_differing_input_is_refused_and_writes_nothing(self):
        model = migrate_to_schema_ready()
        populate(model)
        backfill(input_document())
        migrate_to_latest()
        before = stored_geography()

        with pytest.raises(GeographyBackfillRejected, match="no longer overwritten"):
            backfill(input_document(alpha=("NA", ["AR"])))

        assert stored_geography() == before

    def test_after_the_final_migration_a_dry_run_still_reports_the_differences(self):
        model = migrate_to_schema_ready()
        populate(model)
        backfill(input_document())
        migrate_to_latest()

        plan = backfill(input_document(alpha=("NA", ["AR"])), dry_run=True)

        assert [change.slug for change in plan.changes] == [ALPHA]


def table_names():
    with connection.cursor() as cursor:
        return set(connection.introspection.table_names(cursor))


def is_nullable(table, column):
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT is_nullable FROM information_schema.columns"
            " WHERE table_name = %s AND column_name = %s AND table_schema = current_schema()",
            [table, column],
        )
        return cursor.fetchone()[0] == "YES"


def test_the_helper_document_is_valid_json():
    assert json.loads(json.dumps(input_document()))["format"] == "serendipeak.geography"

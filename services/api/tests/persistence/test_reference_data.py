import re

import pytest
from django.db import IntegrityError, connection, transaction
from django.db.models import ProtectedError

from serendipeak.catalog.country_aliases import ANTARCTICA_CODE, LEGACY_COUNTRY_CODES
from serendipeak.catalog.geography import CONTINENT_CODES
from serendipeak.persistence.models import (
    ContinentRecord,
    CountryRecord,
    MountainCountryRecord,
)
from tests.support.geography import CONTINENT_MIGRATION, COUNTRY_MIGRATION, reference
from tests.support.records import insert_error, mountain_record

pytestmark = pytest.mark.django_db

CONTINENT_NAMES = {
    "AF": ("Africa", "África", "África"),
    "AN": ("Antarctica", "Antártida", "Antártida"),
    "AS": ("Asia", "Asia", "Ásia"),
    "EU": ("Europe", "Europa", "Europa"),
    "NA": ("North America", "América del Norte", "América do Norte"),
    "OC": ("Oceania", "Oceanía", "Oceania"),
    "SA": ("South America", "Sudamérica", "América do Sul"),
}
# The reference continent of countries whose placement follows a convention: transcontinental
# countries take UN M49's placement of the whole country, overseas territories with their own
# ISO code take their own, and only Antarctica is overridden.
CONVENTIONS = {
    "RU": "EU", "TR": "AS", "KZ": "AS", "GE": "AS", "AM": "AS", "AZ": "AS", "CY": "AS",
    "EG": "AF", "PA": "NA", "ID": "AS", "TL": "AS", "RE": "AF", "YT": "AF", "GF": "SA",
    "GP": "NA", "MQ": "NA", "PM": "NA", "GL": "NA", "NC": "OC", "PF": "OC", "WF": "OC",
    "BV": "SA", "GS": "SA", "TF": "AF", "HM": "OC", "TW": "AS", "AQ": "AN",
    "AR": "SA", "US": "NA", "NZ": "OC", "FR": "EU", "CN": "AS", "AU": "OC", "MX": "NA",
}  # fmt: skip
# A sample of CLDR 49's own spellings, which are reported to the owner rather than corrected.
NAMES = {
    "US": ("United States", "Estados Unidos", "Estados Unidos"),
    "TR": ("Türkiye", "Turquía", "Turquia"),
    "CD": ("Congo - Kinshasa", "República Democrática del Congo", "Congo - Kinshasa"),
    "HK": ("Hong Kong SAR China", "RAE de Hong Kong (China)", "Hong Kong, RAE da China"),
    "MM": ("Myanmar (Burma)", "Myanmar (Birmania)", "Mianmar (Birmânia)"),
    "CN": ("China", "China", "China"),
    "AQ": ("Antarctica", "Antártida", "Antártida"),
}


def names_of(record):
    return (record.name_en, record.name_es, record.name_pt)


class TestContinents:
    def test_there_are_exactly_the_seven_approved_ones(self):
        assert set(ContinentRecord.objects.values_list("code", flat=True)) == set(CONTINENT_CODES)
        assert ContinentRecord.objects.count() == 7

    @pytest.mark.parametrize(("code", "names"), CONTINENT_NAMES.items())
    def test_their_names_are_the_pinned_reference_in_three_languages(self, code, names):
        assert names_of(ContinentRecord.objects.get(code=code)) == names

    def test_the_rows_are_the_ones_the_migration_loads(self):
        assert {(r.code, *names_of(r)) for r in ContinentRecord.objects.all()} == set(
            importable(CONTINENT_MIGRATION).CONTINENTS
        )

    @pytest.mark.parametrize("code", ["", "XX", "af", "EUR", "AF "])
    def test_a_code_outside_the_approved_set_is_refused(self, code):
        error = insert_error(ContinentRecord(code=code, name_en="X", name_es="X", name_pt="X"))

        assert error.constraint_name == "continent_code_valid"

    def test_an_english_name_is_unique(self):
        with pytest.raises(IntegrityError) as raised, transaction.atomic():
            ContinentRecord.objects.filter(code="AS").update(name_en="Europe")

        assert raised.value.__cause__.diag.constraint_name == "continent_name_en_key"

    @pytest.mark.parametrize("column", ["name_en", "name_es", "name_pt"])
    @pytest.mark.parametrize("blank", ["", " ", "\t\n"])
    def test_a_blank_name_is_refused(self, column, blank):
        names = {"name_en": "Test", "name_es": "Test", "name_pt": "Test", column: blank}

        error = insert_error(ContinentRecord(code="ZZ", **names))

        assert error.constraint_name in {
            f"continent_{column}_not_blank",
            "continent_code_valid",
        }


class TestCountries:
    def test_there_are_249_with_well_formed_unique_codes(self):
        codes = list(CountryRecord.objects.values_list("code", flat=True))

        assert len(codes) == len(set(codes)) == 249
        assert all(re.fullmatch(r"[A-Z]{2}", code) for code in codes)

    def test_the_48_codes_of_the_v1_catalog_and_antarctica_are_present(self):
        codes = set(CountryRecord.objects.values_list("code", flat=True))

        assert set(LEGACY_COUNTRY_CODES.values()) <= codes
        assert ANTARCTICA_CODE in codes

    def test_every_name_is_present_in_all_three_languages(self):
        for record in CountryRecord.objects.all():
            assert all(name.strip() == name and name for name in names_of(record)), record.code

    def test_english_names_are_unique(self):
        names = list(CountryRecord.objects.values_list("name_en", flat=True))

        assert len(set(names)) == len(names)

    @pytest.mark.parametrize(("code", "expected"), NAMES.items())
    def test_names_are_the_ones_cldr_publishes(self, code, expected):
        assert names_of(CountryRecord.objects.get(code=code)) == expected

    @pytest.mark.parametrize(("code", "continent"), CONVENTIONS.items())
    def test_the_reference_continent_follows_the_documented_conventions(self, code, continent):
        assert CountryRecord.objects.get(code=code).continent_id == continent

    def test_every_country_has_a_reference_continent_and_only_antarctica_is_overridden(self):
        assert set(CountryRecord.objects.values_list("continent_id", flat=True)) == set(
            CONTINENT_CODES
        )
        assert list(CountryRecord.objects.filter(continent_id="AN")) == [
            CountryRecord.objects.get(code="AQ")
        ]

    def test_no_name_was_overridden_by_hand(self):
        generator = importable("tools.generate_geography_reference")

        assert generator.NAME_OVERRIDES == ()

    def test_the_rows_are_the_ones_the_migration_loads(self):
        assert {(r.code, *names_of(r), r.continent_id) for r in CountryRecord.objects.all()} == set(
            importable(COUNTRY_MIGRATION).COUNTRIES
        )

    def test_the_helper_reference_reads_the_same_rows(self):
        assert set(reference().countries) == set(
            CountryRecord.objects.values_list("code", flat=True)
        )

    @pytest.mark.parametrize("code", ["", "A", "ar", "ARG", "A1", "1A", "A-", "AR\n"])
    def test_a_malformed_code_is_refused(self, code):
        error = insert_error(
            CountryRecord(
                code=code, name_en="Test", name_es="Test", name_pt="Test", continent_id="EU"
            )
        )

        assert error.constraint_name == "country_code_format"

    def test_an_english_name_is_unique(self):
        error = insert_error(
            CountryRecord(
                code="ZZ", name_en="Argentina", name_es="x", name_pt="x", continent_id="SA"
            )
        )

        assert error.constraint_name == "country_name_en_key"

    @pytest.mark.parametrize("column", ["name_en", "name_es", "name_pt"])
    @pytest.mark.parametrize("blank", ["", " "])
    def test_a_blank_name_is_refused(self, column, blank):
        names = {"name_en": "Test", "name_es": "Test", "name_pt": "Test", column: blank}

        error = insert_error(CountryRecord(code="ZZ", continent_id="EU", **names))

        assert error.constraint_name == f"country_{column}_not_blank"

    def test_a_country_needs_a_continent_that_exists(self):
        with pytest.raises(IntegrityError), transaction.atomic():
            CountryRecord.objects.create(
                code="ZZ", name_en="Test", name_es="Test", name_pt="Test", continent_id="XX"
            )
            connection.check_constraints()

    def test_a_country_needs_a_continent(self):
        error = insert_error(
            CountryRecord(code="ZZ", name_en="Test", name_es="Test", name_pt="Test")
        )

        assert error.sqlstate == "23502"


class TestReferences:
    @pytest.fixture
    def mountain(self):
        record = mountain_record()
        record.save()
        MountainCountryRecord.objects.create(mountain=record, country_id="AR")

        return record

    def test_the_orm_refuses_to_delete_a_continent_a_country_uses(self):
        with pytest.raises(ProtectedError):
            ContinentRecord.objects.get(code="SA").delete()

    def test_the_orm_refuses_to_delete_a_continent_only_a_mountain_uses(self):
        CountryRecord.objects.filter(continent_id="AN").update(continent_id="SA")
        mountain_record(slug="ice-peak", continent_id="AN").save()

        with pytest.raises(ProtectedError):
            ContinentRecord.objects.get(code="AN").delete()

    def test_the_orm_refuses_to_delete_a_country_a_mountain_links(self, mountain):
        with pytest.raises(ProtectedError):
            CountryRecord.objects.get(code="AR").delete()

    def test_the_orm_refuses_to_delete_a_mountain_with_a_country(self, mountain):
        with pytest.raises(ProtectedError):
            mountain.delete()

    @pytest.mark.parametrize(
        "sql",
        [
            "DELETE FROM continent WHERE code = 'SA'",
            "DELETE FROM country WHERE code = 'AR'",
            "DELETE FROM mountain",
        ],
    )
    def test_the_database_refuses_the_same_deletions(self, mountain, sql):
        with connection.cursor() as cursor:
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
            with pytest.raises(IntegrityError) as raised, transaction.atomic():
                cursor.execute(sql)

        assert raised.value.__cause__.diag.sqlstate == "23503"

    def test_a_mountain_cannot_link_the_same_country_twice(self, mountain):
        with pytest.raises(IntegrityError) as raised, transaction.atomic():
            MountainCountryRecord.objects.create(mountain=mountain, country_id="AR")

        assert raised.value.__cause__.diag.constraint_name == "mountain_country_pkey"

    def test_a_link_needs_an_existing_country(self, mountain):
        with pytest.raises(IntegrityError), transaction.atomic():
            MountainCountryRecord.objects.create(mountain=mountain, country_id="ZZ")
            connection.check_constraints()

    def test_a_link_needs_an_existing_mountain(self):
        with pytest.raises(IntegrityError), transaction.atomic():
            MountainCountryRecord.objects.create(
                mountain_id="00000000-0000-0000-0000-000000000001", country_id="AR"
            )
            connection.check_constraints()

    def test_a_mountain_needs_a_continent_on_every_status(self):
        for status in ("draft", "inactive", "active"):
            error = insert_error(
                mountain_record(slug=f"{status}-peak", continent_id=None, status=status)
            )

            assert error.sqlstate == "23502", status

    def test_a_mountain_needs_a_continent_that_exists(self):
        with pytest.raises(IntegrityError), transaction.atomic():
            mountain_record(continent_id="XX").save()
            connection.check_constraints()

    def test_the_link_table_is_indexed_for_both_directions(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT indexdef FROM pg_indexes WHERE tablename = 'mountain_country' ORDER BY 1"
            )
            definitions = [row[0] for row in cursor.fetchall()]

        assert any("(mountain_id, country_code)" in d for d in definitions)
        assert any("(country_code, mountain_id)" in d for d in definitions)
        assert len(definitions) == 2

    def test_the_references_of_countries_and_mountains_to_continents_are_indexed(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT tablename FROM pg_indexes WHERE indexdef LIKE '%(continent_code)%'"
            )
            tables = {row[0] for row in cursor.fetchall()}

        assert tables == {"country", "mountain"}


def importable(name):
    import importlib

    return importlib.import_module(name)

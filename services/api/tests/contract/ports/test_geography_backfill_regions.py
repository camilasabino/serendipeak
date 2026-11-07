import pytest
from django.db import connection

from serendipeak.catalog.errors import GeographyBackfillRejected
from serendipeak.catalog.geography_input import StoredGeography
from serendipeak.persistence.geography_backfill_store import (
    DjangoGeographyBackfillStore,
    DjangoGeographyDraftReader,
)
from tests.support.fakes import InMemoryGeographyStore
from tests.support.geography import geography_document, invented_id, parse_document
from tests.support.geography_schema import FINAL, REGIONS, mountain_values
from tests.support.migrations import (
    historical_model,
    migrate_to,
    migrate_to_latest_discarding_catalog,
)
from tests.support.regions import region_path, regions_of

pytestmark = pytest.mark.django_db(transaction=True)

RANGES = {"alpha-peak": "Beta Range", "beta-peak": "Gamma Chain", "ice-peak": None}
SLUG_OF = {"Beta Range": "beta-range", "Gamma Chain": "gamma-chain"}
TAXONOMY = regions_of(region_path("Alpha Chain", "Beta Range"), region_path("Gamma Chain"))


def document(regions=TAXONOMY, **region_of_mountain):
    entries = []
    for slug, continent, countries in (
        ("alpha-peak", "SA", ["AR"]),
        ("beta-peak", "EU", ["CH"]),
        ("ice-peak", "AN", ["AQ"]),
    ):
        name = region_of_mountain.get(slug.replace("-", "_"), RANGES[slug])
        entries.append(
            (
                invented_id(slug),
                slug,
                continent,
                countries,
                *(() if name is None else (SLUG_OF[name],)),
            )
        )

    return parse_document(geography_document(entries, regions))


class Harness:
    def __init__(self, store, reader):
        self.store = store
        self.reader = reader

    def regions_of_mountains(self):
        return {row.slug: row.region_slug for row in self.reader.read_mountains()}


@pytest.fixture(params=["in-memory", "django"])
def harness(request):
    if request.param == "in-memory":
        store = InMemoryGeographyStore(
            (
                StoredGeography(
                    id=invented_id(slug),
                    slug=slug,
                    legacy_country_names=None,
                    continent_code=continent,
                    country_codes=(country,),
                    has_legacy_range_name=True,
                    legacy_range_name=RANGES[slug],
                )
                for slug, continent, country in (
                    ("alpha-peak", "SA", "AR"),
                    ("beta-peak", "EU", "CH"),
                    ("ice-peak", "AN", "AQ"),
                )
            ),
            regions=[],
        )
        yield Harness(store, store)
        return

    migrate_to(FINAL)
    model = historical_model(FINAL, "MountainRecord")
    for slug, continent, country in (
        ("alpha-peak", "SA", "AR"),
        ("beta-peak", "EU", "CH"),
        ("ice-peak", "AN", "AQ"),
    ):
        columns = mountain_values(slug, range_name=RANGES[slug])
        columns.pop("countries")
        model.objects.create(**columns, continent_id=continent)
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO mountain_country (mountain_id, country_code) VALUES (%s, %s)",
                [invented_id(slug), country],
            )
    migrate_to(REGIONS)
    yield Harness(DjangoGeographyBackfillStore(), DjangoGeographyDraftReader())
    migrate_to_latest_discarding_catalog()


def test_applying_inserts_the_regions_and_sets_the_region_of_each_mountain(harness):
    plan = harness.store.backfill(document(), dry_run=False)

    assert plan.new_regions == ("alpha-chain", "beta-range", "gamma-chain")
    assert [(change.slug, change.region) for change in plan.changes] == [
        ("alpha-peak", (None, "beta-range")),
        ("beta-peak", (None, "gamma-chain")),
    ]
    assert harness.regions_of_mountains() == {
        "alpha-peak": "beta-range",
        "beta-peak": "gamma-chain",
        "ice-peak": None,
    }


def test_a_dry_run_reports_the_same_plan_and_writes_nothing(harness):
    dry = harness.store.backfill(document(), dry_run=True)

    assert set(harness.regions_of_mountains().values()) == {None}
    assert harness.store.backfill(document(), dry_run=False) == dry


def test_a_second_application_changes_nothing(harness):
    harness.store.backfill(document(), dry_run=False)

    again = harness.store.backfill(document(), dry_run=False)

    assert (again.changes, again.new_regions) == ((), ())


def test_an_input_whose_region_disagrees_with_the_range_name_is_refused_and_writes_nothing(
    harness,
):
    wrong = document(regions=regions_of(region_path("Gamma Chain")), alpha_peak="Gamma Chain")

    with pytest.raises(GeographyBackfillRejected, match="alpha-peak"):
        harness.store.backfill(wrong, dry_run=False)

    assert set(harness.regions_of_mountains().values()) == {None}

import pytest

from serendipeak.catalog.bootstrap.ports import BackfillTarget
from serendipeak.catalog.errors import GeographyBackfillRejected
from serendipeak.catalog.geography_input import StoredGeography
from serendipeak.persistence.geography_backfill_store import (
    DjangoGeographyBackfillStore,
    DjangoGeographyDraftReader,
)
from tests.support.fakes import InMemoryGeographyStore
from tests.support.geography import geography_document, invented_id, parse_document
from tests.support.geography_schema import migrate_to_schema_ready, mountain_values
from tests.support.migrations import migrate_to_latest_discarding_catalog

pytestmark = pytest.mark.django_db(transaction=True)

ROWS = {
    "alpha-peak": ("Argentina",),
    "beta-peak": ("Switzerland", "Italy"),
    "ice-peak": (),
}
DOCUMENT = geography_document(
    [
        (invented_id("alpha-peak"), "alpha-peak", "SA", ["AR"]),
        (invented_id("beta-peak"), "beta-peak", "EU", ["CH", "IT"]),
        (invented_id("ice-peak"), "ice-peak", "AN", ["AQ"]),
    ]
)


class Harness:
    """The store under test, with the way to arrange its mountains and read them back."""

    def __init__(self, store, reader):
        self.store = store
        self.reader = reader

    def stored(self):
        return [
            (row.slug, row.continent_code, row.country_codes)
            for row in self.reader.read_mountains()
        ]


@pytest.fixture(params=["in-memory", "django"])
def harness(request):
    if request.param == "in-memory":
        store = InMemoryGeographyStore(
            StoredGeography(
                id=invented_id(slug),
                slug=slug,
                legacy_country_names=names,
                continent_code=None,
                country_codes=(),
            )
            for slug, names in ROWS.items()
        )
        yield Harness(store, store)
        return

    model = migrate_to_schema_ready()
    for slug, names in ROWS.items():
        model.objects.create(**mountain_values(slug, list(names)))
    yield Harness(DjangoGeographyBackfillStore(), DjangoGeographyDraftReader())
    migrate_to_latest_discarding_catalog()


def test_it_identifies_the_target(harness):
    target = harness.store.target()

    assert isinstance(target, BackfillTarget)
    assert target.database and target.migration.startswith("0017")


def test_the_mountains_are_read_by_slug_with_their_v1_names(harness):
    rows = list(harness.reader.read_mountains())

    assert [row.slug for row in rows] == ["alpha-peak", "beta-peak", "ice-peak"]
    assert {row.slug: set(row.legacy_country_names) for row in rows} == {
        slug: set(names) for slug, names in ROWS.items()
    }
    assert all(row.continent_code is None and row.country_codes == () for row in rows)


def test_applying_assigns_the_continents_and_countries_and_reports_what_changed(harness):
    plan = harness.store.backfill(parse_document(DOCUMENT), dry_run=False)

    assert (plan.checked, len(plan.changes)) == (3, 3)
    assert harness.stored() == [
        ("alpha-peak", "SA", ("AR",)),
        ("beta-peak", "EU", ("CH", "IT")),
        ("ice-peak", "AN", ("AQ",)),
    ]


def test_a_dry_run_reports_the_same_plan_and_writes_nothing(harness):
    dry = harness.store.backfill(parse_document(DOCUMENT), dry_run=True)

    assert len(dry.changes) == 3
    assert all(continent is None for _, continent, _ in harness.stored())
    assert harness.store.backfill(parse_document(DOCUMENT), dry_run=False) == dry


def test_a_second_application_changes_nothing(harness):
    harness.store.backfill(parse_document(DOCUMENT), dry_run=False)
    stored = harness.stored()

    again = harness.store.backfill(parse_document(DOCUMENT), dry_run=False)

    assert (again.changes, again.unchanged) == ((), 3)
    assert harness.stored() == stored


def test_a_change_of_one_mountain_touches_only_that_mountain(harness):
    harness.store.backfill(parse_document(DOCUMENT), dry_run=False)
    changed = geography_document(
        [
            (invented_id("alpha-peak"), "alpha-peak", "NA", ["AR"]),
            (invented_id("beta-peak"), "beta-peak", "EU", ["CH", "IT"]),
            (invented_id("ice-peak"), "ice-peak", "AN", ["AQ"]),
        ]
    )

    plan = harness.store.backfill(parse_document(changed), dry_run=False)

    assert [(change.slug, change.continent) for change in plan.changes] == [
        ("alpha-peak", ("SA", "NA"))
    ]


@pytest.mark.parametrize(
    "entries",
    [
        [(invented_id("alpha-peak"), "alpha-peak", "SA", ["AR"])],
        [
            (invented_id("alpha-peak"), "alpha-peak", "SA", ["AR"]),
            (invented_id("beta-peak"), "beta-peak", "EU", ["CH", "IT"]),
            (invented_id("ice-peak"), "ice-peak", "AN", ["AQ"]),
            (invented_id("gone-peak"), "gone-peak", "EU", []),
        ],
        [
            (invented_id("alpha-peak"), "alpha-peak", "SA", ["CL"]),
            (invented_id("beta-peak"), "beta-peak", "EU", ["CH", "IT"]),
            (invented_id("ice-peak"), "ice-peak", "AN", ["AQ"]),
        ],
    ],
    ids=["missing-mountain", "stale-entry", "disagreeing-countries"],
)
def test_an_input_that_does_not_fit_is_refused_and_writes_nothing(harness, entries):
    with pytest.raises(GeographyBackfillRejected):
        harness.store.backfill(parse_document(geography_document(entries)), dry_run=False)

    assert all(continent is None and not codes for _, continent, codes in harness.stored())

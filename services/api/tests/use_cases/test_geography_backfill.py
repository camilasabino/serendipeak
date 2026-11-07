import pytest

from serendipeak.catalog.bootstrap.apply_geography_backfill import ApplyGeographyBackfill
from serendipeak.catalog.bootstrap.prepare_geography_input import PrepareGeographyInput
from serendipeak.catalog.errors import GeographyBackfillRejected, InvalidGeographyInput
from serendipeak.catalog.geography_input import StoredGeography, parse_geography_input
from tests.support.fakes import InMemoryGeographyStore
from tests.support.geography import geography_document, invented_id

ONE, TWO = invented_id("one"), invented_id("two")


def row(mountain_id, slug, legacy=("Argentina",), continent=None, countries=()):
    return StoredGeography(
        id=mountain_id,
        slug=slug,
        legacy_country_names=None if legacy is None else tuple(legacy),
        continent_code=continent,
        country_codes=tuple(countries),
    )


DOCUMENT = geography_document([(ONE, "alpha-peak", "SA", ["AR"]), (TWO, "ice-peak", "AN", ["AQ"])])
ROWS = [row(ONE, "alpha-peak"), row(TWO, "ice-peak", legacy=())]


def apply(store, document=DOCUMENT, *, expected=None, dry_run=False):
    announced = []
    result = ApplyGeographyBackfill(store).execute(
        document,
        expected_sha256=expected or document["content_sha256"],
        dry_run=dry_run,
        announce_target=announced.append,
    )

    return result, announced


def test_applying_writes_the_continents_and_links_and_reports_the_plan():
    store = InMemoryGeographyStore(ROWS)

    result, announced = apply(store)

    assert result.applied
    assert (result.plan.checked, len(result.plan.changes)) == (2, 2)
    assert [(r.continent_code, r.country_codes) for r in store.read_mountains()] == [
        ("SA", ("AR",)),
        ("AN", ("AQ",)),
    ]
    assert announced == [result.target]


def test_a_dry_run_reports_the_same_plan_and_writes_nothing():
    store = InMemoryGeographyStore(ROWS)

    dry, _ = apply(store, dry_run=True)

    assert not dry.applied
    assert store.writes == 0
    assert [r.continent_code for r in store.read_mountains()] == [None, None]
    assert apply(InMemoryGeographyStore(ROWS))[0].plan == dry.plan


def test_a_rerun_changes_nothing():
    store = InMemoryGeographyStore(ROWS)
    apply(store)
    writes = store.writes

    again, _ = apply(store)

    assert again.plan.changes == ()
    assert (again.plan.checked, again.plan.unchanged) == (2, 2)
    assert store.writes == writes


def test_the_target_is_announced_before_the_catalog_is_judged():
    store = InMemoryGeographyStore(ROWS)
    order = []
    original = store.backfill
    store.backfill = lambda *args, **kwargs: order.append("backfill") or original(*args, **kwargs)

    ApplyGeographyBackfill(store).execute(
        DOCUMENT,
        expected_sha256=DOCUMENT["content_sha256"],
        dry_run=True,
        announce_target=lambda target: order.append("announce"),
    )

    assert order == ["announce", "backfill"]


def test_an_input_with_another_checksum_is_refused_before_the_store_is_touched():
    store = InMemoryGeographyStore(ROWS)
    targeted = []
    store.target = lambda: targeted.append("target")

    with pytest.raises(InvalidGeographyInput):
        apply(store, expected="0" * 64)

    assert (targeted, store.reads, store.writes) == ([], 0, 0)


def test_an_input_that_misses_a_mountain_changes_nothing():
    store = InMemoryGeographyStore([*ROWS, row(invented_id("three"), "gamma-peak")])

    with pytest.raises(GeographyBackfillRejected, match="gamma-peak"):
        apply(store)

    assert store.writes == 0


def test_a_stale_input_changes_nothing():
    store = InMemoryGeographyStore(ROWS[:1])

    with pytest.raises(GeographyBackfillRejected, match="ice-peak"):
        apply(store)

    assert store.writes == 0


class TestPreparingADraft:
    def draft(self, rows):
        return PrepareGeographyInput(InMemoryGeographyStore(rows)).execute()

    def test_it_lists_every_mountain_with_its_countries_and_no_continent(self):
        draft = self.draft(
            [
                row(TWO, "beta-peak", legacy=("Switzerland", "Italy")),
                row(ONE, "alpha-peak"),
                row(invented_id("ice"), "ice-peak", legacy=()),
            ]
        )

        assert draft["mountains"] == [
            {"id": str(ONE), "slug": "alpha-peak", "continent": None, "countries": ["AR"]},
            {"id": str(TWO), "slug": "beta-peak", "continent": None, "countries": ["CH", "IT"]},
            {
                "id": str(invented_id("ice")),
                "slug": "ice-peak",
                "continent": None,
                "countries": [],
            },
        ]

    def test_it_reads_the_links_once_the_legacy_names_are_gone(self):
        [mountain] = self.draft(
            [row(ONE, "alpha-peak", legacy=None, continent="SA", countries=["CL", "AR"])]
        )["mountains"]

        assert mountain["countries"] == ["AR", "CL"]

    def test_a_draft_has_no_checksum_and_can_never_be_applied(self):
        draft = self.draft(ROWS)

        assert draft["content_sha256"] is None
        with pytest.raises(InvalidGeographyInput):
            parse_geography_input(draft, expected_sha256="0" * 64)

    def test_a_legacy_name_outside_the_alias_table_stops_the_draft(self):
        from serendipeak.catalog.country_aliases import UnknownLegacyCountry

        with pytest.raises(UnknownLegacyCountry, match="Atlantis"):
            self.draft([row(ONE, "alpha-peak", legacy=("Atlantis",))])

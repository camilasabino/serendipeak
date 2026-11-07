import datetime
from dataclasses import replace

import pytest

from serendipeak.catalog.bootstrap.bootstrap_catalog import BootstrapCatalog
from serendipeak.catalog.bootstrap.ports import CatalogSnapshot
from serendipeak.catalog.bootstrap.verify_catalog import VerifyCatalog
from serendipeak.catalog.errors import (
    CatalogAlreadyPopulated,
    CatalogMismatch,
    GeographyBackfillRejected,
)
from tests.support.catalog import (
    catalog_discovery,
    catalog_seed,
    committed_geography,
    frozen_catalog,
    frozen_mountain,
    parsed_committed_seed,
    seeded_mountain,
    split_seed,
)
from tests.support.fakes import InMemoryCatalogStore, InMemoryGeographyReference
from tests.support.geography import countries
from tests.support.regions import region_path

ACONCAGUA = seeded_mountain("aconcagua")
MONT_BLANC = seeded_mountain("mont-blanc")
SEED = catalog_seed(
    ACONCAGUA,
    MONT_BLANC,
    discoveries=[catalog_discovery(datetime.date(2026, 10, 3), MONT_BLANC)],
)
FROZEN = [frozen_mountain(ACONCAGUA), frozen_mountain(MONT_BLANC)]
PARSED_SEED, GEOGRAPHY = split_seed(SEED)


class DiscoveryDroppingStore:
    def __init__(self):
        self._store = InMemoryCatalogStore()

    def load(self, seed):
        self._store.load(replace(seed, discoveries=()))

    def snapshot(self):
        return self._store.snapshot()


def bootstrap(store):
    reference = InMemoryGeographyReference()

    return BootstrapCatalog(store, VerifyCatalog(store, reference), reference)


def test_bootstrap_loads_an_empty_catalog_and_reports_the_verification():
    store = InMemoryCatalogStore()

    report = bootstrap(store).execute(PARSED_SEED, FROZEN, GEOGRAPHY)

    assert store.snapshot().mountains == (ACONCAGUA, MONT_BLANC)
    assert store.snapshot().discoveries == SEED.discoveries
    assert (report.mountains, report.images, report.discoveries) == (2, 2, 1)
    assert (report.frozen.matched, report.frozen.total) == (2, 2)
    assert report.is_consistent


def test_bootstrap_loads_the_committed_seed():
    store = InMemoryCatalogStore()

    report = bootstrap(store).execute(
        parsed_committed_seed(), frozen_catalog(), committed_geography()
    )

    assert (report.mountains, report.images, report.discoveries) == (73, 73, 8)
    assert (report.frozen.matched, report.frozen.total) == (73, 73)
    assert report.is_consistent


def test_bootstrap_refuses_a_populated_catalog_and_leaves_it_unchanged():
    store = InMemoryCatalogStore()
    store.load(catalog_seed(ACONCAGUA))

    with pytest.raises(CatalogAlreadyPopulated):
        bootstrap(store).execute(PARSED_SEED, FROZEN, GEOGRAPHY)

    assert store.snapshot().mountains == (ACONCAGUA,)
    assert store.snapshot().discoveries == ()


def test_bootstrap_refuses_a_seed_that_differs_from_the_frozen_catalog_before_loading():
    store = InMemoryCatalogStore()
    renamed = replace(FROZEN[0], name="Cerro Aconcagua")

    with pytest.raises(CatalogMismatch) as raised:
        bootstrap(store).execute(PARSED_SEED, [renamed, FROZEN[1]], GEOGRAPHY)

    assert raised.value.mismatches == ("aconcagua: name differs",)
    assert store.snapshot() == CatalogSnapshot(mountains=(), discoveries=(), regions=())


def test_bootstrap_reports_a_catalog_that_does_not_round_trip_the_seed():
    store = DiscoveryDroppingStore()

    with pytest.raises(CatalogMismatch) as raised:
        bootstrap(store).execute(PARSED_SEED, FROZEN, GEOGRAPHY)

    assert raised.value.mismatches == ("daily discovery 2026-10-03 is missing",)


def test_bootstrap_stores_the_continent_and_countries_of_the_geography_input():
    store = InMemoryCatalogStore()

    bootstrap(store).execute(PARSED_SEED, FROZEN, GEOGRAPHY)

    stored = store.snapshot().mountains[0].mountain
    assert (stored.continent.code, [country.code for country in stored.countries]) == ("SA", ["AR"])
    assert stored.continent.name.en == "South America"


def test_bootstrap_refuses_an_input_that_misses_a_seed_mountain_before_loading():
    store = InMemoryCatalogStore()
    _, only_aconcagua = split_seed(catalog_seed(ACONCAGUA))

    with pytest.raises(GeographyBackfillRejected) as raised:
        bootstrap(store).execute(PARSED_SEED, FROZEN, only_aconcagua)

    assert [problem.split(" (")[0] for problem in raised.value.problems] == ["mountain mont-blanc"]
    assert store.snapshot() == CatalogSnapshot(mountains=(), discoveries=(), regions=())


def test_bootstrap_ignores_input_entries_of_mountains_the_seed_does_not_have():
    store = InMemoryCatalogStore()
    _, with_a_newer_mountain = split_seed(
        catalog_seed(ACONCAGUA, MONT_BLANC, seeded_mountain("newer-peak"))
    )

    report = bootstrap(store).execute(PARSED_SEED, FROZEN, with_a_newer_mountain)

    assert report.is_consistent
    assert len(store.snapshot().mountains) == 2


def test_bootstrap_refuses_countries_that_disagree_with_the_seed_names_before_loading():
    store = InMemoryCatalogStore()
    wrong = seeded_mountain("aconcagua", countries=countries("CL"))
    _, disagreeing = split_seed(catalog_seed(wrong, MONT_BLANC))

    with pytest.raises(GeographyBackfillRejected, match="do not match the stored names"):
        bootstrap(store).execute(PARSED_SEED, FROZEN, disagreeing)

    assert store.snapshot() == CatalogSnapshot(mountains=(), discoveries=(), regions=())


DEEP = seeded_mountain("aconcagua", region=region_path("Alpha Chain", "Beta Range", "Gamma Ridge"))
OTHER = seeded_mountain("mont-blanc", region=region_path("Alpha Chain", "Delta Range"))
BARE = seeded_mountain("bare-peak", region=None)


def bootstrap_regions(*mountains):
    seed = catalog_seed(*mountains)
    parsed, geography = split_seed(seed)
    store = InMemoryCatalogStore()
    frozen = [frozen_mountain(entry) for entry in mountains]
    report = bootstrap(store).execute(parsed, frozen, geography)

    return store, report


def test_bootstrap_stores_the_region_taxonomy_and_the_region_of_each_mountain():
    store, report = bootstrap_regions(DEEP, OTHER, BARE)

    snapshot = store.snapshot()
    assert report.is_consistent
    assert sorted(region.slug for region in snapshot.regions) == [
        "alpha-chain",
        "beta-range",
        "delta-range",
        "gamma-ridge",
    ]
    by_slug = {entry.mountain.slug: entry.mountain.region for entry in snapshot.mountains}
    assert by_slug["aconcagua"] == DEEP.mountain.region
    assert [ref.slug for ref in by_slug["aconcagua"].ancestors] == ["alpha-chain", "beta-range"]
    assert by_slug["mont-blanc"].ancestors[0].slug == "alpha-chain"
    assert by_slug["bare-peak"] is None


def test_bootstrap_refuses_a_region_that_is_not_the_seed_range_name_before_loading():
    store = InMemoryCatalogStore()
    parsed, geography = split_seed(catalog_seed(DEEP))
    renamed = replace(parsed, legacy_range_names={DEEP.mountain.id: "Another Name"})

    with pytest.raises(GeographyBackfillRejected, match="does not match the stored range name"):
        bootstrap(store).execute(renamed, [frozen_mountain(DEEP)], geography)

    assert store.snapshot() == CatalogSnapshot(mountains=(), discoveries=(), regions=())


def test_bootstrap_refuses_a_seed_range_name_the_input_gives_no_region():
    store = InMemoryCatalogStore()
    parsed, geography = split_seed(catalog_seed(BARE))
    ranged = replace(parsed, legacy_range_names={BARE.mountain.id: "Unplaced Range"})

    with pytest.raises(GeographyBackfillRejected, match="Unplaced Range"):
        bootstrap(store).execute(ranged, [frozen_mountain(BARE)], geography)


def test_verification_reports_a_region_that_differs_from_the_input():
    store, _ = bootstrap_regions(DEEP, BARE)
    parsed, geography = split_seed(catalog_seed(DEEP, BARE))
    drifted = replace(
        geography,
        regions=tuple(
            replace(region, wikidata_id="Q7") if region.slug == "beta-range" else region
            for region in geography.regions
        ),
    )

    report = VerifyCatalog(store, InMemoryGeographyReference()).execute(
        parsed, [frozen_mountain(DEEP), frozen_mountain(BARE)], drifted
    )

    assert [m.split(" (")[0] for m in report.seed_mismatches] == ["region beta-range"]


def test_verification_reports_a_stored_region_the_input_lacks_and_a_changed_mountain_region():
    store, _ = bootstrap_regions(DEEP, BARE)
    moved = replace(store.snapshot().mountains[0], mountain=replace(DEEP.mountain, region=None))
    store.replace(moved)
    parsed, geography = split_seed(catalog_seed(DEEP, BARE))

    report = VerifyCatalog(store, InMemoryGeographyReference()).execute(
        parsed, [frozen_mountain(DEEP), frozen_mountain(BARE)], geography
    )

    assert any("differs in region" in mismatch for mismatch in report.seed_mismatches)


def test_without_the_input_regions_are_not_compared():
    store, _ = bootstrap_regions(DEEP, BARE)
    parsed, _ = split_seed(catalog_seed(DEEP, BARE))

    report = VerifyCatalog(store, InMemoryGeographyReference()).execute(
        parsed, [frozen_mountain(DEEP), frozen_mountain(BARE)], None
    )

    assert report.is_consistent and not report.geography_compared

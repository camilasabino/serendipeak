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
    assert store.snapshot() == CatalogSnapshot(mountains=(), discoveries=())


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
    assert store.snapshot() == CatalogSnapshot(mountains=(), discoveries=())


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

    assert store.snapshot() == CatalogSnapshot(mountains=(), discoveries=())

import datetime
from dataclasses import replace

import pytest

from serendipeak.catalog.bootstrap.bootstrap_catalog import BootstrapCatalog
from serendipeak.catalog.bootstrap.ports import CatalogSnapshot
from serendipeak.catalog.bootstrap.verify_catalog import VerifyCatalog
from serendipeak.catalog.errors import CatalogAlreadyPopulated, CatalogMismatch
from tests.support.catalog import (
    catalog_discovery,
    catalog_mountain,
    catalog_seed,
    committed_seed,
    frozen_catalog,
    frozen_mountain,
)
from tests.support.fakes import InMemoryCatalogStore

ACONCAGUA = catalog_mountain("aconcagua")
MONT_BLANC = catalog_mountain("mont-blanc")
SEED = catalog_seed(
    ACONCAGUA,
    MONT_BLANC,
    discoveries=[catalog_discovery(datetime.date(2026, 10, 3), MONT_BLANC)],
)
FROZEN = [frozen_mountain(ACONCAGUA), frozen_mountain(MONT_BLANC)]


class DiscoveryDroppingStore:
    def __init__(self):
        self._store = InMemoryCatalogStore()

    def load(self, seed):
        self._store.load(replace(seed, discoveries=()))

    def snapshot(self):
        return self._store.snapshot()


def bootstrap(store):
    return BootstrapCatalog(store, VerifyCatalog(store))


def test_bootstrap_loads_an_empty_catalog_and_reports_the_verification():
    store = InMemoryCatalogStore()

    report = bootstrap(store).execute(SEED, FROZEN)

    assert store.snapshot().mountains == (ACONCAGUA, MONT_BLANC)
    assert store.snapshot().discoveries == SEED.discoveries
    assert (report.mountains, report.images, report.discoveries) == (2, 2, 1)
    assert (report.frozen.matched, report.frozen.total) == (2, 2)
    assert report.is_consistent


def test_bootstrap_loads_the_committed_seed():
    store = InMemoryCatalogStore()

    report = bootstrap(store).execute(committed_seed(), frozen_catalog())

    assert (report.mountains, report.images, report.discoveries) == (73, 73, 8)
    assert (report.frozen.matched, report.frozen.total) == (73, 73)
    assert report.is_consistent


def test_bootstrap_refuses_a_populated_catalog_and_leaves_it_unchanged():
    store = InMemoryCatalogStore()
    store.load(catalog_seed(ACONCAGUA))

    with pytest.raises(CatalogAlreadyPopulated):
        bootstrap(store).execute(SEED, FROZEN)

    assert store.snapshot().mountains == (ACONCAGUA,)
    assert store.snapshot().discoveries == ()


def test_bootstrap_refuses_a_seed_that_differs_from_the_frozen_catalog_before_loading():
    store = InMemoryCatalogStore()
    renamed = replace(FROZEN[0], name="Cerro Aconcagua")

    with pytest.raises(CatalogMismatch) as raised:
        bootstrap(store).execute(SEED, [renamed, FROZEN[1]])

    assert raised.value.mismatches == ("aconcagua: name differs",)
    assert store.snapshot() == CatalogSnapshot(mountains=(), discoveries=())


def test_bootstrap_reports_a_catalog_that_does_not_round_trip_the_seed():
    store = DiscoveryDroppingStore()

    with pytest.raises(CatalogMismatch) as raised:
        bootstrap(store).execute(SEED, FROZEN)

    assert raised.value.mismatches == ("daily discovery 2026-10-03 is missing",)

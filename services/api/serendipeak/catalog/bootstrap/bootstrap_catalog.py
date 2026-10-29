from collections.abc import Sequence

from serendipeak.catalog.bootstrap.frozen_catalog import (
    FrozenMountain,
    compare_with_frozen_catalog,
)
from serendipeak.catalog.bootstrap.seed import CatalogSeed
from serendipeak.catalog.bootstrap.verify_catalog import VerificationReport, VerifyCatalog
from serendipeak.catalog.errors import CatalogMismatch
from serendipeak.catalog.ports import CatalogStore


class BootstrapCatalog:
    def __init__(self, store: CatalogStore, verify_catalog: VerifyCatalog):
        self._store = store
        self._verify_catalog = verify_catalog

    def execute(
        self,
        seed: CatalogSeed,
        frozen: Sequence[FrozenMountain],
    ) -> VerificationReport:
        comparison = compare_with_frozen_catalog(
            frozen, (entry.mountain for entry in seed.mountains)
        )
        if comparison.mismatches:
            raise CatalogMismatch(comparison.mismatches)

        self._store.load(seed)

        report = self._verify_catalog.execute(seed, frozen)
        if not report.is_consistent:
            raise CatalogMismatch(report.mismatches)

        return report

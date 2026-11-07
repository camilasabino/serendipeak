from collections.abc import Sequence

from serendipeak.catalog.bootstrap.frozen_catalog import (
    FrozenMountain,
    compare_with_frozen_catalog,
)
from serendipeak.catalog.bootstrap.ports import CatalogSeed, CatalogStore, GeographyReferenceReader
from serendipeak.catalog.bootstrap.seed_geography import assign_geography
from serendipeak.catalog.bootstrap.verify_catalog import VerificationReport, VerifyCatalog
from serendipeak.catalog.errors import CatalogMismatch
from serendipeak.catalog.geography_input import GeographyInput


class BootstrapCatalog:
    def __init__(
        self,
        store: CatalogStore,
        verify_catalog: VerifyCatalog,
        reference: GeographyReferenceReader,
    ):
        self._store = store
        self._verify_catalog = verify_catalog
        self._reference = reference

    def execute(
        self,
        seed: CatalogSeed,
        frozen: Sequence[FrozenMountain],
        geography: GeographyInput,
    ) -> VerificationReport:
        comparison = compare_with_frozen_catalog(
            frozen, (entry.mountain for entry in seed.mountains)
        )
        if comparison.mismatches:
            raise CatalogMismatch(comparison.mismatches)

        # The seed carries no geography, so it is refused before anything is written when the
        # input does not supply it.
        self._store.load(assign_geography(seed, geography, self._reference.read()))

        report = self._verify_catalog.execute(seed, frozen, geography)
        if not report.is_consistent:
            raise CatalogMismatch(report.mismatches)

        return report

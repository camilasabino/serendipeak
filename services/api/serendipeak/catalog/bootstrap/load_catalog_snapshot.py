from serendipeak.catalog.bootstrap.catalog_snapshot import (
    catalog_from_snapshot_content,
    verified_snapshot_content,
)
from serendipeak.catalog.bootstrap.ports import CatalogStore, GeographyReferenceReader
from serendipeak.catalog.bootstrap.verify_catalog_snapshot import (
    SnapshotVerification,
    VerifyCatalogSnapshot,
)


class LoadCatalogSnapshot:
    """Initializes an empty catalog from a snapshot and then verifies what was stored.

    The checksum is judged before the database is read, and the store refuses a catalog that
    holds a mountain. The load is committed before the verification: when the verification
    reports mismatches the rows stay, so the environment is rebuilt rather than patched.
    """

    def __init__(
        self,
        store: CatalogStore,
        reference: GeographyReferenceReader,
        verify_snapshot: VerifyCatalogSnapshot,
    ):
        self._store = store
        self._reference = reference
        self._verify_snapshot = verify_snapshot

    def execute(self, document: object, expected_sha256: str) -> SnapshotVerification:
        content = verified_snapshot_content(document, expected_sha256)
        catalog = catalog_from_snapshot_content(content, self._reference.read())

        self._store.load(catalog)

        return self._verify_snapshot.execute(document, expected_sha256)

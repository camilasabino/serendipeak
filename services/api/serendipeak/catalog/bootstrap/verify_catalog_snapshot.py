from collections.abc import Sequence
from dataclasses import dataclass, fields

from serendipeak.catalog.bootstrap.catalog_snapshot import (
    CatalogSummary,
    catalog_from_snapshot_content,
    summarize_catalog,
    verified_snapshot_content,
)
from serendipeak.catalog.bootstrap.ports import (
    CatalogDiscovery,
    CatalogMountain,
    CatalogStore,
    GeographyReferenceReader,
)
from serendipeak.catalog.entities import Mountain
from serendipeak.catalog.regions import MountainRegion


@dataclass(frozen=True, slots=True)
class SnapshotVerification:
    stored: CatalogSummary
    mismatches: tuple[str, ...]
    discoveries_compared: bool

    @property
    def is_consistent(self) -> bool:
        return not self.mismatches


class VerifyCatalogSnapshot:
    """Compares the stored catalog with a snapshot, row by row.

    The comparison is exact, timestamps included, so it proves a load or a promotion and holds
    only while the catalog is unedited. Daily discoveries are compared when the snapshot carries
    some: a snapshot without them says nothing about them.
    """

    def __init__(self, store: CatalogStore, reference: GeographyReferenceReader):
        self._store = store
        self._reference = reference

    def execute(self, document: object, expected_sha256: str) -> SnapshotVerification:
        content = verified_snapshot_content(document, expected_sha256)
        expected = catalog_from_snapshot_content(content, self._reference.read())
        stored = self._store.snapshot()
        discoveries_compared = bool(expected.discoveries)

        return SnapshotVerification(
            stored=summarize_catalog(stored),
            mismatches=(
                *_region_mismatches(expected.regions, stored.regions),
                *_mountain_mismatches(expected.mountains, stored.mountains),
                *(
                    _discovery_mismatches(expected.discoveries, stored.discoveries)
                    if discoveries_compared
                    else ()
                ),
            ),
            discoveries_compared=discoveries_compared,
        )


def _region_mismatches(
    expected: Sequence[MountainRegion], actual: Sequence[MountainRegion]
) -> list[str]:
    stored = {region.id: region for region in actual}
    mismatches = []

    for region in expected:
        found = stored.pop(region.id, None)
        if found is None:
            mismatches.append(f"region {region.slug} ({region.id}) is missing")
        elif found != region:
            mismatches.append(f"region {region.slug} ({region.id}) differs from the snapshot")

    mismatches.extend(
        f"region {region.slug} ({region.id}) is not in the snapshot" for region in stored.values()
    )

    return mismatches


def _mountain_mismatches(
    expected: Sequence[CatalogMountain], actual: Sequence[CatalogMountain]
) -> list[str]:
    stored = {entry.mountain.id: entry for entry in actual}
    mismatches = []

    for entry in expected:
        found = stored.pop(entry.mountain.id, None)
        label = f"mountain {entry.mountain.slug} ({entry.mountain.id})"
        if found is None:
            mismatches.append(f"{label} is missing")
        elif found != entry:
            mismatches.append(f"{label} differs in {', '.join(_differing_fields(entry, found))}")

    mismatches.extend(
        f"mountain {entry.mountain.slug} ({entry.mountain.id}) is not in the snapshot"
        for entry in stored.values()
    )

    return mismatches


def _differing_fields(expected: CatalogMountain, actual: CatalogMountain) -> list[str]:
    mountain_fields = [
        field.name
        for field in fields(Mountain)
        if getattr(expected.mountain, field.name) != getattr(actual.mountain, field.name)
    ]
    entry_fields = [
        name
        for name in ("created_at", "updated_at")
        if getattr(expected, name) != getattr(actual, name)
    ]

    return [*mountain_fields, *entry_fields]


def _discovery_mismatches(
    expected: Sequence[CatalogDiscovery], actual: Sequence[CatalogDiscovery]
) -> list[str]:
    stored = {discovery.date: discovery for discovery in actual}
    mismatches = []

    for discovery in expected:
        found = stored.pop(discovery.date, None)
        if found is None:
            mismatches.append(f"daily discovery {discovery.date} is missing")
        elif found != discovery:
            mismatches.append(f"daily discovery {discovery.date} differs from the snapshot")

    mismatches.extend(
        f"daily discovery {discovery.date} is not in the snapshot" for discovery in stored.values()
    )

    return mismatches

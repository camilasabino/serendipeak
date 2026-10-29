from collections.abc import Sequence
from dataclasses import dataclass, fields

from serendipeak.catalog.bootstrap.frozen_catalog import (
    FrozenComparison,
    FrozenMountain,
    compare_with_frozen_catalog,
)
from serendipeak.catalog.bootstrap.ports import (
    CatalogDiscovery,
    CatalogMountain,
    CatalogSeed,
    CatalogStore,
)
from serendipeak.catalog.entities import Mountain


@dataclass(frozen=True, slots=True)
class VerificationReport:
    mountains: int
    images: int
    discoveries: int
    seed_mismatches: tuple[str, ...]
    frozen: FrozenComparison

    @property
    def mismatches(self) -> tuple[str, ...]:
        return (*self.seed_mismatches, *self.frozen.mismatches)

    @property
    def is_consistent(self) -> bool:
        return not self.mismatches


class VerifyCatalog:
    def __init__(self, store: CatalogStore):
        self._store = store

    def execute(
        self,
        seed: CatalogSeed,
        frozen: Sequence[FrozenMountain],
    ) -> VerificationReport:
        snapshot = self._store.snapshot()

        return VerificationReport(
            mountains=len(snapshot.mountains),
            images=sum(entry.mountain.primary_image is not None for entry in snapshot.mountains),
            discoveries=len(snapshot.discoveries),
            seed_mismatches=(
                *_mountain_mismatches(seed.mountains, snapshot.mountains),
                *_discovery_mismatches(seed.discoveries, snapshot.discoveries),
            ),
            frozen=compare_with_frozen_catalog(
                frozen, (entry.mountain for entry in snapshot.mountains)
            ),
        )


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
        f"mountain {entry.mountain.slug} ({entry.mountain.id}) is not in the seed"
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
        for name in ("image_provenance", "created_at", "updated_at")
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
            mismatches.append(f"daily discovery {discovery.date} differs from the seed")

    mismatches.extend(
        f"daily discovery {discovery.date} is not in the seed" for discovery in stored.values()
    )

    return mismatches

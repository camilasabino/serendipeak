from dataclasses import dataclass
from typing import Protocol

from serendipeak.catalog.bootstrap.seed import CatalogDiscovery, CatalogMountain, CatalogSeed


@dataclass(frozen=True, slots=True)
class CatalogSnapshot:
    mountains: tuple[CatalogMountain, ...]
    discoveries: tuple[CatalogDiscovery, ...]


class CatalogStore(Protocol):
    def load(self, seed: CatalogSeed) -> None:
        """Load the seed atomically into a store without mountains.

        Raises CatalogAlreadyPopulated and changes nothing when the store holds a mountain,
        including one stored by a concurrent load.
        """

    def snapshot(self) -> CatalogSnapshot: ...

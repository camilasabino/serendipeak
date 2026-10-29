from dataclasses import dataclass
from datetime import date, datetime
from typing import Protocol
from uuid import UUID

from serendipeak.catalog.entities import Mountain


@dataclass(frozen=True, slots=True)
class ImageProvenance:
    license_reported: str | None
    license_election_basis_url: str | None
    approved_on: date | None


@dataclass(frozen=True, slots=True)
class CatalogMountain:
    mountain: Mountain
    image_provenance: ImageProvenance | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class CatalogDiscovery:
    date: date
    mountain_id: UUID
    created_at: datetime


@dataclass(frozen=True, slots=True)
class CatalogSeed:
    mountains: tuple[CatalogMountain, ...]
    discoveries: tuple[CatalogDiscovery, ...]


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

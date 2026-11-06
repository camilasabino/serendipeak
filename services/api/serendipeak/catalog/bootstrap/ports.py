from dataclasses import dataclass
from datetime import date, datetime
from enum import StrEnum
from typing import Protocol
from uuid import UUID

from serendipeak.catalog.entities import ImageDimensions, Mountain, PhotographMedia


@dataclass(frozen=True, slots=True)
class CatalogMountain:
    mountain: Mountain
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


class AttachOutcome(StrEnum):
    APPLIED = "applied"
    ALREADY_ATTACHED = "already_attached"
    STALE = "stale"
    NOT_FOUND = "not_found"


class PhotographMediaWriter(Protocol):
    def attach_media(
        self,
        mountain_id: UUID,
        expected_dimensions: ImageDimensions,
        media: PhotographMedia,
    ) -> AttachOutcome:
        """Atomically attach media to the photograph of a mountain that has none yet.

        Applied only while the photograph still has expected_dimensions, the ones the media
        was verified against. ALREADY_ATTACHED when it already holds exactly this media, STALE
        when it holds other media or its dimensions changed, NOT_FOUND when the mountain or its
        photograph is gone. Nothing else about the mountain changes, its updated_at included.
        """

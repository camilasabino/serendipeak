from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from enum import StrEnum
from typing import Protocol
from uuid import UUID

from serendipeak.catalog.entities import ImageDimensions, Mountain, PhotographMedia
from serendipeak.catalog.geography import GeographyReference
from serendipeak.catalog.geography_input import BackfillPlan, GeographyInput, StoredGeography


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
    """The mountains and discoveries to load. A parsed seed names the v1 country text of each
    mountain in legacy_country_names; a seed ready to load holds real geography instead."""

    mountains: tuple[CatalogMountain, ...]
    discoveries: tuple[CatalogDiscovery, ...]
    legacy_country_names: Mapping[UUID, tuple[str, ...]] = field(default_factory=dict)


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


class GeographyReferenceReader(Protocol):
    def read(self) -> GeographyReference:
        """Return the continents and countries of the reference data, with their names."""


@dataclass(frozen=True, slots=True)
class BackfillTarget:
    database: str
    host: str
    port: str
    migration: str


class GeographyBackfillStore(Protocol):
    def target(self) -> BackfillTarget:
        """Identify the database a backfill would run against."""

    def backfill(self, geography: GeographyInput, *, dry_run: bool) -> BackfillPlan:
        """Judge the input against the stored mountains and, unless dry_run, apply it, atomically.

        The mountains are read, judged by plan_backfill and written under one lock, so the plan
        describes exactly what is written. Only the continent of a mountain and its country
        links are written; no other column and no timestamp changes. A dry run writes nothing.

        Raises UnexpectedSchemaState before reading when the schema is not the one the backfill
        is meant for, and GeographyBackfillRejected, writing nothing, when the input does not
        cover the stored mountains exactly or disagrees with them.
        """


class GeographyDraftReader(Protocol):
    def read_mountains(self) -> Sequence[StoredGeography]:
        """Return the id, slug and countries of every stored mountain, ordered by slug."""

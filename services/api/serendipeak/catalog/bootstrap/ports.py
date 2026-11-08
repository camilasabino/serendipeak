from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime
from typing import Protocol
from uuid import UUID

from serendipeak.catalog.entities import Mountain
from serendipeak.catalog.geography import GeographyReference
from serendipeak.catalog.geography_input import BackfillPlan, GeographyInput, StoredGeography
from serendipeak.catalog.regions import MountainRegion


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
class CatalogSnapshot:
    mountains: tuple[CatalogMountain, ...]
    discoveries: tuple[CatalogDiscovery, ...]
    regions: tuple[MountainRegion, ...] = ()


class CatalogStore(Protocol):
    def load(self, catalog: CatalogSnapshot) -> None:
        """Load the catalog atomically into a store without mountains, its regions included.

        Raises CatalogAlreadyPopulated and changes nothing when the store holds a mountain,
        including one stored by a concurrent load.
        """

    def snapshot(self) -> CatalogSnapshot: ...


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
        links are written, and the regions of the input that the store lacks, with the region
        of each mountain; no other column and no timestamp changes. A dry run writes nothing.

        Raises UnexpectedSchemaState before reading when the schema is not the one the backfill
        is meant for, and GeographyBackfillRejected, writing nothing, when the input does not
        cover the stored mountains exactly or disagrees with them.
        """


class GeographyDraftReader(Protocol):
    def read_mountains(self) -> Sequence[StoredGeography]:
        """Return the id, slug and countries of every stored mountain, ordered by slug."""

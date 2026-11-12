from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Protocol
from uuid import UUID

from serendipeak.catalog.entities import (
    CandidateMountain,
    CanonicalCamera,
    Continent,
    Coordinates,
    Country,
    Mountain,
    MountainIndexEntry,
    MountainStatus,
    PrimaryImage,
)
from serendipeak.catalog.mountain_update import MountainUpdate
from serendipeak.catalog.new_mountain import NewMountain
from serendipeak.catalog.publication import PublicationViolation
from serendipeak.catalog.region_changes import MountainRegionUpdate, NewMountainRegion
from serendipeak.catalog.regions import MountainRegion
from serendipeak.catalog.relocation import RelocationOutcome, RelocationRule
from serendipeak.catalog.status_transitions import Gate, StatusTransition


class MountainRepository(Protocol):
    def find_public_by_slug(self, slug: str) -> Mountain | None:
        """Return the active or inactive mountain whose slug equals slug exactly, with its image.

        Returns None for an unknown slug and for a draft mountain.
        """

    def list_active_candidates(self) -> Sequence[CandidateMountain]:
        """Return the id and slug of every active mountain, ordered by slug code points.

        Returns an empty sequence when no mountain is active.
        """

    def list_active_index(self) -> Sequence[MountainIndexEntry]:
        """Return the index entry of every active mountain, with its continent, countries and
        region path, ordered by slug code points, in a number of queries that does not grow with
        the catalog.

        Returns an empty sequence when no mountain is active.
        """


class MountainCatalogReader(Protocol):
    """Reads for the editorial screens: every status is visible, drafts included."""

    def list_all(self) -> Sequence[Mountain]:
        """Return every mountain with its image, continent, countries and region path, in no
        particular order. Returns an empty sequence for an empty catalog."""

    def find_by_slug(self, slug: str) -> Mountain | None:
        """Return the mountain whose slug equals slug exactly, whatever its status.

        Returns None for an unknown slug.
        """

    def find_by_id(self, mountain_id: UUID) -> Mountain | None:
        """Return the mountain with this id, whatever its status.

        Returns None for an unknown id.
        """


class Clock(Protocol):
    def now(self) -> datetime:
        """Return the current instant as an aware UTC datetime."""


class PreviewTokens(Protocol):
    """Capability tokens that let the holder read one mountain's saved draft for a short time."""

    def issue(self, mountain_id: UUID, now: datetime) -> str:
        """Return a token for this mountain that stops working after the preview lifetime."""

    def verify(self, token: str, now: datetime) -> UUID | None:
        """Return the mountain the token names, or None when it is forged, malformed, expired or
        of another kind. The reasons are deliberately not distinguished."""


@dataclass(frozen=True, slots=True)
class GeographyOptions:
    """The reference data an editor chooses from, in no particular order."""

    continents: Sequence[Continent]
    countries: Sequence[Country]
    regions: Sequence[MountainRegion]


class GeographyOptionsReader(Protocol):
    def read(self) -> GeographyOptions:
        """Return every continent, country and region. A table without rows reads as an empty
        sequence."""


class StatusChangeOutcome(StrEnum):
    APPLIED = "applied"
    NOT_FOUND = "not_found"
    WRONG_STATUS = "wrong_status"
    REJECTED = "rejected"


@dataclass(frozen=True, slots=True)
class StatusChange:
    outcome: StatusChangeOutcome
    status: MountainStatus | None
    violations: tuple[PublicationViolation, ...] = ()


class MountainStatusStore(Protocol):
    def change_status(
        self,
        mountain_id: UUID,
        transition: StatusTransition,
        gate: Gate,
    ) -> StatusChange:
        """Move the mountain from transition.source to transition.target, atomically.

        The mountain is read and written under one lock, so concurrent changes to the same
        mountain run one at a time and the gate judges exactly the state that is then written.
        The gate runs only when the mountain is in transition.source; a non-empty answer
        rejects the change and nothing is written.

        APPLIED carries the new status. NOT_FOUND carries none. WRONG_STATUS and REJECTED carry
        the unchanged status. Any mountain status is addressable, drafts included.
        """


class CameraChange(StrEnum):
    APPLIED = "applied"
    NOT_FOUND = "not_found"
    STALE = "stale"
    LOCATION_CHANGED = "location_changed"


class MountainCameraStore(Protocol):
    def replace_camera(
        self,
        mountain_id: UUID,
        camera: CanonicalCamera,
        expected: CanonicalCamera | None,
        expected_coordinates: Coordinates,
    ) -> CameraChange:
        """Replace the mountain's camera with camera if the mountain is still as it was read.

        The coordinates and the camera are compared and written under one lock, so concurrent
        changes to the same mountain run one at a time and a change based on an outdated reading
        is never written. expected_coordinates are the ones the camera was composed on. They are
        checked on their own, because a move clears the camera and two cameras that are both
        absent compare equal. expected None means the mountain has no camera. Both comparisons
        are exact.

        APPLIED means camera is stored and nothing else about the mountain but its update time
        changed. NOT_FOUND, LOCATION_CHANGED and STALE write nothing; LOCATION_CHANGED wins when
        both comparisons fail. Any mountain status is addressable, drafts included, and the
        status is never changed.
        """


class MountainLocationStore(Protocol):
    def relocate(
        self,
        mountain_id: UUID,
        coordinates: Coordinates,
        rule: RelocationRule,
    ) -> RelocationOutcome:
        """Move the mountain to coordinates and clear its camera, atomically, if rule allows it.

        The mountain is read and written under one lock, so concurrent changes to the same
        mountain run one at a time and the rule judges exactly the state that is then written.
        The rule receives the stored status and coordinates. On APPLIED the new location and the
        removal of the whole camera, framing included, are written together and nothing else but
        the update time changes. Every other outcome writes nothing; NOT_FOUND is the store's
        own. Any mountain status is addressable, drafts included, and the status is never
        changed.
        """


class MountainCreationStore(Protocol):
    def create_draft(self, mountain: NewMountain, image: PrimaryImage | None) -> Mountain:
        """Store mountain as a draft with image as its photograph, atomically, and return it.

        The mountain, its photograph and its country links are written together or not at all.
        With no image the draft has no photograph record.
        The status is draft, the camera is absent and both timestamps are the store's. The
        photograph's own file is not part of mountain: image already describes it. Repeated
        country codes are one link. The returned mountain is what was stored, with its
        continent, countries and region path.

        Raises SlugTaken when a mountain already has the slug, UnknownContinent for a continent
        code, UnknownRegion for a region id and UnknownCountries for country codes that
        reference data does not hold, and writes nothing. When several apply, the first of
        them in this order is raised.
        """


class MountainUpdateStore(Protocol):
    def update(
        self,
        mountain_id: UUID,
        update: MountainUpdate,
        gate: Gate,
        image: PrimaryImage | None = None,
    ) -> Mountain:
        """Write the content and geography of the mountain, atomically, and return it as stored.

        The mountain is locked first, so concurrent changes to the same mountain run one at a
        time, and the state the gate judges is exactly the one written. The columns of update
        and the country links change together or not at all; repeated country codes are one
        link, and a mountain whose state already equals update is not written. The status, the
        coordinates, the camera and the translated texts are never touched. When image is
        given it replaces the stored photograph, whose row is created for a mountain that has
        none, in the same write; its objects are already in storage and update.photograph
        (the uploaded file) is not read here. When image is None and update.credit is given, the
        credit columns of the stored photograph change and its file does not. When
        update.remove_photograph is set, the photograph record is deleted, with its credit, and
        the objects it pointed to are left alone. Otherwise the photograph is untouched. The
        gate receives the mountain as it would be stored, whatever its status, and a non-empty
        answer rejects the update.

        Raises UnknownMountain, SlugTaken (the slug of another mountain), UnknownContinent,
        UnknownRegion and UnknownCountries for references that reference data does not hold,
        MountainHasNoPhotograph for a credit given to a mountain without a photograph row, and
        PublicationRejected with the gate's answer, and writes nothing. When several apply,
        the first of them in this order is raised.
        """


class DraftMountainDeletionStore(Protocol):
    def delete_draft(self, mountain_id: UUID) -> None:
        """Delete the mountain with its photograph record and country links, atomically.

        The mountain is locked first and its status is judged under that lock, so a concurrent
        publication either finishes before the check or finds the mountain gone. The stored
        photograph objects are not touched.

        Raises UnknownMountain, MountainNotDraft for a mountain that is not a draft and
        MountainReferenced for a mountain that a daily discovery refers to, and deletes nothing.
        """


class MountainRegionStore(Protocol):
    """The writes of the region taxonomy. They share one port because they share one invariant
    and one lock: the structure of the tree, and the sibling names and Wikidata items that
    depend on it, change one write at a time. Each operation is atomic and writes nothing when
    it raises. None of them reassigns a child region or a mountain."""

    def create(self, region: NewMountainRegion) -> MountainRegion:
        """Store region with a new id and return it as stored.

        Raises UnknownRegion for a parent that does not exist, RegionSlugTaken, RegionNameTaken
        for a sibling that has the English name, ignoring case (roots are exempt), and
        RegionWikidataTaken. When several apply, the first of them in this order is raised.
        """

    def update(self, region_id: UUID, update: MountainRegionUpdate) -> MountainRegion:
        """Replace the names and the Wikidata item of the region and return it as stored.

        The id, the slug and the parent never change. A region whose state already equals
        update is not written.

        Raises UnknownRegion, RegionNameTaken and RegionWikidataTaken, in that order.
        """

    def move(self, region_id: UUID, parent_id: UUID | None) -> MountainRegion:
        """Make parent_id the parent of the region, or a root when it is None, and return it.

        Its descendants and its mountains are not touched: they point at the moved region. A
        region already under that parent is not written.

        Raises UnknownRegion for the region or for the parent, RegionWouldDescendFromItself
        when the parent is the region or one of its descendants, and RegionNameTaken, in that
        order.
        """

    def delete(self, region_id: UUID) -> None:
        """Delete the region.

        Raises UnknownRegion and RegionInUse, with the number of its child regions and
        mountains, when either exists. Nothing is moved or cascaded.
        """


@dataclass(frozen=True, slots=True)
class CountedRegion:
    region: MountainRegion
    # Mountains whose own region is this one, of any status; descendants are not counted.
    direct_mountains: int


@dataclass(frozen=True, slots=True)
class RegionMountain:
    id: UUID
    slug: str
    # English: the only language the Studio shows a mountain in.
    name: str
    status: MountainStatus
    region_id: UUID


class MountainRegionReader(Protocol):
    """Reads of the taxonomy for the editorial screens. Neither operation locks."""

    def read_all(self) -> Sequence[CountedRegion]:
        """Return every region with the number of mountains that point at it, in no particular
        order. Returns an empty sequence for an empty taxonomy."""

    def list_mountains(self, region_ids: Collection[UUID]) -> Sequence[RegionMountain]:
        """Return the mountains of any status whose region is one of region_ids, in no particular
        order. Returns an empty sequence for no ids."""

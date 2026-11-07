from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol
from uuid import UUID

from serendipeak.catalog.entities import (
    CandidateMountain,
    CanonicalCamera,
    Coordinates,
    Mountain,
    MountainStatus,
    PrimaryImage,
)
from serendipeak.catalog.mountain_update import MountainUpdate
from serendipeak.catalog.new_mountain import NewMountain
from serendipeak.catalog.publication import PublicationViolation
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

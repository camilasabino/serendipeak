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
    def create_draft(self, mountain: NewMountain, image: PrimaryImage) -> Mountain:
        """Store mountain as a draft with image as its photograph, atomically, and return it.

        The mountain, its photograph and its country links are written together or not at all.
        The status is draft, the camera is absent and both timestamps are the store's. The
        photograph's own file is not part of mountain: image already describes it. Repeated
        country codes are one link. The returned mountain is what was stored, with its
        continent, countries and region path.

        Raises SlugTaken when a mountain already has the slug, UnknownContinent for a continent
        code, UnknownRegion for a region id and UnknownCountries for country codes that
        reference data does not hold, and writes nothing. When several apply, the first of
        them in this order is raised.
        """

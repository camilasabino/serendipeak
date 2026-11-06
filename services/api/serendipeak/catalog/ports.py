from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol
from uuid import UUID

from serendipeak.catalog.entities import (
    CandidateMountain,
    CanonicalCamera,
    Mountain,
    MountainStatus,
)
from serendipeak.catalog.publication import PublicationViolation
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


class MountainCameraStore(Protocol):
    def replace_camera(
        self,
        mountain_id: UUID,
        camera: CanonicalCamera,
        expected: CanonicalCamera | None,
    ) -> CameraChange:
        """Replace the mountain's camera with camera if it still equals expected, atomically.

        The camera is compared and written under one lock, so concurrent changes to the same
        mountain run one at a time and a change based on an outdated reading is never written.
        expected None means the mountain has no camera; the comparison is exact.

        APPLIED means camera is stored and nothing else about the mountain but its update time
        changed. NOT_FOUND and STALE write nothing. Any mountain status is addressable, drafts
        included, and the status is never changed.
        """

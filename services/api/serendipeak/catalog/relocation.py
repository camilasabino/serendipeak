from collections.abc import Callable
from enum import StrEnum

from serendipeak.catalog.entities import Coordinates, MountainStatus


class RelocationOutcome(StrEnum):
    APPLIED = "applied"
    UNCHANGED = "unchanged"
    NOT_FOUND = "not_found"
    CONFIRMATION_REQUIRED = "confirmation_required"
    ACTIVE_MOUNTAIN = "active_mountain"


RelocationRule = Callable[[MountainStatus, Coordinates], RelocationOutcome]


def judge_relocation(
    status: MountainStatus,
    stored: Coordinates,
    requested: Coordinates,
    camera_reset_confirmed: bool,
) -> RelocationOutcome:
    """What moving a mountain from stored to requested does, judged on its stored state.

    A saved camera is framed on the summit where it was composed, so any other location makes
    it wrong. The comparison is exact: both sides are the same IEEE doubles, and an approximate
    one would let a small move keep a camera composed for another point. APPLIED means the move
    is allowed and clears the camera; the caller writes it. An active mountain is public, so it
    must be deactivated before it can move, whatever was confirmed.
    """
    if requested == stored:
        return RelocationOutcome.UNCHANGED
    if status is MountainStatus.ACTIVE:
        return RelocationOutcome.ACTIVE_MOUNTAIN
    if not camera_reset_confirmed:
        return RelocationOutcome.CONFIRMATION_REQUIRED

    return RelocationOutcome.APPLIED

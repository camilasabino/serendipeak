from uuid import UUID

from serendipeak.catalog.errors import InvalidStatusTransition, PublicationRejected, UnknownMountain
from serendipeak.catalog.ports import MountainStatusStore, StatusChangeOutcome
from serendipeak.catalog.status_transitions import Gate, StatusTransition


def apply_transition(
    statuses: MountainStatusStore,
    mountain_id: UUID,
    transition: StatusTransition,
    gate: Gate,
) -> None:
    change = statuses.change_status(mountain_id, transition, gate)

    match change.outcome:
        case StatusChangeOutcome.APPLIED:
            return
        case StatusChangeOutcome.NOT_FOUND:
            raise UnknownMountain(mountain_id)
        case StatusChangeOutcome.REJECTED:
            raise PublicationRejected(change.violations)
        case StatusChangeOutcome.WRONG_STATUS:
            raise InvalidStatusTransition(change.status, transition.target)

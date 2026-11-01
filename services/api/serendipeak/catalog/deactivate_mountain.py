from uuid import UUID

from serendipeak.catalog.apply_transition import apply_transition
from serendipeak.catalog.ports import MountainStatusStore
from serendipeak.catalog.status_transitions import DEACTIVATE


def _nothing_to_reject(_):
    return ()


class DeactivateMountain:
    def __init__(self, statuses: MountainStatusStore):
        self._statuses = statuses

    def execute(self, mountain_id: UUID) -> None:
        apply_transition(self._statuses, mountain_id, DEACTIVATE, _nothing_to_reject)

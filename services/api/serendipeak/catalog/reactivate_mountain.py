from uuid import UUID

from serendipeak.catalog.apply_transition import apply_transition
from serendipeak.catalog.ports import MountainStatusStore
from serendipeak.catalog.publication import publication_violations
from serendipeak.catalog.status_transitions import REACTIVATE


class ReactivateMountain:
    def __init__(self, statuses: MountainStatusStore):
        self._statuses = statuses

    def execute(self, mountain_id: UUID) -> None:
        apply_transition(self._statuses, mountain_id, REACTIVATE, publication_violations)

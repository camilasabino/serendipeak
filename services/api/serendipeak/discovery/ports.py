from collections.abc import Sequence
from datetime import date
from typing import Protocol
from uuid import UUID

from serendipeak.discovery.entities import DailyMountain, RecentDiscovery


class DailyDiscoveryRepository(Protocol):
    def find_by_date(self, day: date) -> DailyMountain | None:
        """Return the discovery persisted for day with its mountain and image, or None.

        The mountain is returned whatever its current status: history never changes.
        """

    def list_recent(self, first: date, last: date) -> Sequence[RecentDiscovery]:
        """Return the discoveries dated from first to last, both inclusive, ordered by date."""

    def insert_or_get(self, day: date, mountain_id: UUID) -> DailyMountain:
        """Persist mountain_id as the discovery of day unless day already has one.

        Returns the discovery persisted for day, which names another mountain when a
        concurrent or earlier caller persisted first; an existing discovery is never
        overwritten. Concurrent callers for the same day all receive the same discovery.
        The insert is atomic and committed when this returns. A mountain_id that names no
        mountain raises InfrastructureError and persists nothing, even though the reference
        is only checked when the insert commits.
        """

    def delete_before(self, cutoff: date) -> int:
        """Delete the discoveries dated before cutoff and return how many were deleted.

        Atomic and committed when this returns. A date from cutoff on is never deleted;
        running it again deletes nothing. The database refuses to delete a discovery that
        is inside the retention window whatever cutoff is passed, and that refusal is an
        InfrastructureError that deletes nothing.
        """

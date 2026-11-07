from uuid import UUID

from serendipeak.catalog.entities import Mountain
from serendipeak.catalog.errors import InvalidMountain
from serendipeak.catalog.mountain_update import (
    MountainUpdate,
    mountain_update_violations,
    public_edit_violations,
)
from serendipeak.catalog.ports import MountainUpdateStore


class UpdateMountain:
    def __init__(self, updates: MountainUpdateStore):
        self._updates = updates

    def execute(self, mountain_id: UUID, update: MountainUpdate) -> Mountain:
        """Save the content and geography of a mountain of any status and return it as stored.

        Raises InvalidMountain with every violated rule, UnknownMountain, SlugTaken,
        UnknownContinent, UnknownRegion and UnknownCountries from the store, and
        PublicationRejected when the saved state of an active or inactive mountain would no
        longer be publishable. Nothing is written for any of them.
        """
        violations = mountain_update_violations(update)
        if violations:
            raise InvalidMountain(violations)

        return self._updates.update(mountain_id, update, public_edit_violations)

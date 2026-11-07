from uuid import UUID

from serendipeak.catalog.entities import Mountain
from serendipeak.catalog.errors import InvalidMountain
from serendipeak.catalog.media.ingestion import PhotographIngestion
from serendipeak.catalog.mountain_update import (
    MountainUpdate,
    mountain_update_violations,
    public_edit_violations,
)
from serendipeak.catalog.new_mountain import stored_photograph
from serendipeak.catalog.ports import MountainUpdateStore


class UpdateMountain:
    def __init__(self, updates: MountainUpdateStore, ingestion: PhotographIngestion):
        self._updates = updates
        self._ingestion = ingestion

    def execute(self, mountain_id: UUID, update: MountainUpdate) -> Mountain:
        """Save the content, geography and photograph of a mountain of any status and return it.

        Raises InvalidMountain with every violated rule, PhotographRejected for a replacement
        file that is not an acceptable photograph, UnknownMountain, SlugTaken, UnknownContinent,
        UnknownRegion and UnknownCountries from the store, PublicationRejected when the saved
        state of an active or inactive mountain would no longer be publishable, and
        InfrastructureError when the photograph cannot be processed or stored. Nothing is
        written to the database for any of them. Removing the photograph of an active or inactive
        mountain is PublicationRejected, since it would no longer be publishable. A replacement's
        objects go to storage before the row, under immutable content-addressed keys, so a
        committed row never points to a missing object; a refusal by the store leaves them
        unreferenced, and the objects of a replaced or removed photograph are never deleted.
        """
        violations = mountain_update_violations(update)
        if violations:
            raise InvalidMountain(violations)

        image = None
        if update.photograph is not None:
            prepared = self._ingestion.prepare(update.photograph.data)
            media = self._ingestion.store(prepared)
            image = stored_photograph(update.photograph, media, prepared.dimensions)

        return self._updates.update(mountain_id, update, public_edit_violations, image)

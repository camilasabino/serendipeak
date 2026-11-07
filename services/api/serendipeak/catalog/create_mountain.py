from serendipeak.catalog.entities import Mountain
from serendipeak.catalog.errors import InvalidMountain
from serendipeak.catalog.media.ingestion import PhotographIngestion
from serendipeak.catalog.new_mountain import NewMountain, new_mountain_violations, stored_photograph
from serendipeak.catalog.ports import MountainCreationStore


class CreateMountain:
    def __init__(self, creations: MountainCreationStore, ingestion: PhotographIngestion):
        self._creations = creations
        self._ingestion = ingestion

    def execute(self, new: NewMountain) -> Mountain:
        """Create a draft mountain, with its photograph when one is given, and return it.

        Raises InvalidMountain with every violated rule, PhotographRejected for a file that is
        not an acceptable photograph, SlugTaken, UnknownContinent, UnknownRegion and
        UnknownCountries from the store, and InfrastructureError when the photograph cannot be
        processed or stored. Nothing is written for the first two. The photograph objects go to
        storage before the row, under immutable content-addressed keys, so a committed row never
        points to a missing object; a refusal by the store leaves them unreferenced.
        """
        violations = new_mountain_violations(new)
        if violations:
            raise InvalidMountain(violations)

        image = None
        if new.photograph is not None:
            prepared = self._ingestion.prepare(new.photograph.data)
            media = self._ingestion.store(prepared)
            image = stored_photograph(new.photograph, media, prepared.dimensions)

        return self._creations.create_draft(new, image)

from uuid import UUID

from serendipeak.catalog.ports import MountainRegionStore
from serendipeak.catalog.region_changes import (
    InvalidMountainRegion,
    MountainRegionUpdate,
    normalized_region_update,
    region_update_violations,
)
from serendipeak.catalog.regions import MountainRegion


class UpdateMountainRegion:
    def __init__(self, regions: MountainRegionStore):
        self._regions = regions

    def execute(self, region_id: UUID, update: MountainRegionUpdate) -> MountainRegion:
        """Replace the names and the Wikidata item of a region and return it.

        The slug and the parent cannot be changed here; the update does not carry them. The
        names are trimmed first. Raises InvalidMountainRegion with every violated rule, and
        UnknownRegion, RegionNameTaken and RegionWikidataTaken from the store. Nothing is
        written for any of them.
        """
        state = normalized_region_update(update)
        violations = region_update_violations(state)
        if violations:
            raise InvalidMountainRegion(violations)

        return self._regions.update(region_id, state)

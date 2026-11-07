from serendipeak.catalog.ports import MountainRegionStore
from serendipeak.catalog.region_changes import (
    InvalidMountainRegion,
    NewMountainRegion,
    new_region_violations,
    normalized_new_region,
)
from serendipeak.catalog.regions import MountainRegion


class CreateMountainRegion:
    def __init__(self, regions: MountainRegionStore):
        self._regions = regions

    def execute(self, new: NewMountainRegion) -> MountainRegion:
        """Create a region under new.parent_id, or a root, and return it.

        The names are trimmed first. Raises InvalidMountainRegion with every violated rule, and
        UnknownRegion, RegionSlugTaken, RegionNameTaken and RegionWikidataTaken from the store.
        Nothing is written for any of them.
        """
        region = normalized_new_region(new)
        violations = new_region_violations(region)
        if violations:
            raise InvalidMountainRegion(violations)

        return self._regions.create(region)

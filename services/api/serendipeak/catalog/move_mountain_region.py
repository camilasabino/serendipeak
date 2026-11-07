from uuid import UUID

from serendipeak.catalog.ports import MountainRegionStore
from serendipeak.catalog.regions import MountainRegion


class MoveMountainRegion:
    def __init__(self, regions: MountainRegionStore):
        self._regions = regions

    def execute(self, region_id: UUID, parent_id: UUID | None) -> MountainRegion:
        """Move a region, with everything below it, under parent_id, or make it a root.

        Raises UnknownRegion for the region or the parent, RegionWouldDescendFromItself for the
        region itself or one of its descendants, and RegionNameTaken when a child of the parent
        has the same name. Nothing is written for any of them, and the child regions and the
        mountains of the region stay attached to it.
        """
        return self._regions.move(region_id, parent_id)

from uuid import UUID

from serendipeak.catalog.ports import MountainRegionStore


class DeleteMountainRegion:
    def __init__(self, regions: MountainRegionStore):
        self._regions = regions

    def execute(self, region_id: UUID) -> None:
        """Delete a region that has no child regions and no mountains.

        Raises UnknownRegion and RegionInUse, which reports how many of each the region has.
        A region is never emptied for the caller: its children and mountains are moved or
        reassigned first, one decision at a time.
        """
        self._regions.delete(region_id)

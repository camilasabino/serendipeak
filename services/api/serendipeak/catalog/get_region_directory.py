from serendipeak.catalog.ports import MountainRegionReader
from serendipeak.catalog.region_directory import RegionDirectory


class GetRegionDirectory:
    def __init__(self, reader: MountainRegionReader):
        self._reader = reader

    def execute(self) -> RegionDirectory:
        """The whole taxonomy, read once, for the screens that create, edit, move or delete a
        region and need its parents, its neighbours and its counts."""
        return RegionDirectory(self._reader.read_all())

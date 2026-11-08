from dataclasses import dataclass

from serendipeak.catalog.ports import MountainRegionReader
from serendipeak.catalog.region_directory import RegionDirectory, RegionTreeEntry

SEARCH_MAX_LENGTH = 100


@dataclass(frozen=True, slots=True)
class MountainRegionTree:
    entries: tuple[RegionTreeEntry, ...]
    # Every region, whatever the search, so the page can tell "none yet" from "no match".
    total: int
    matches: int


class ListMountainRegions:
    def __init__(self, reader: MountainRegionReader):
        self._reader = reader

    def execute(self, *, search: str = "") -> MountainRegionTree:
        """The taxonomy as a tree with the mountains of each region, directly and below it: one
        read of the regions however many there are. The search looks at the names in every
        language and at the slug, and keeps the ancestors of what it finds."""
        directory = RegionDirectory(self._reader.read_all())
        entries = directory.tree(search[:SEARCH_MAX_LENGTH])

        return MountainRegionTree(
            entries=entries,
            total=len(directory),
            matches=sum(1 for entry in entries if entry.matched),
        )

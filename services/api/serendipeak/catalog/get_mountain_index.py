from serendipeak.catalog.entities import MountainIndexEntry
from serendipeak.catalog.ports import MountainRepository


class GetMountainIndex:
    def __init__(self, mountains: MountainRepository):
        self._mountains = mountains

    def execute(self) -> tuple[MountainIndexEntry, ...]:
        return tuple(self._mountains.list_active_index())

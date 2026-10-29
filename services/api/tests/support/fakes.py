from serendipeak.catalog.bootstrap.seed import CatalogSeed
from serendipeak.catalog.errors import CatalogAlreadyPopulated
from serendipeak.catalog.ports import CatalogSnapshot


class InMemoryCatalogStore:
    def __init__(self):
        self._mountains = {}
        self._discoveries = {}

    def load(self, seed: CatalogSeed):
        if self._mountains:
            raise CatalogAlreadyPopulated()

        self._mountains.update((entry.mountain.id, entry) for entry in seed.mountains)
        self._discoveries.update((discovery.date, discovery) for discovery in seed.discoveries)

    def snapshot(self):
        return CatalogSnapshot(
            mountains=tuple(
                sorted(self._mountains.values(), key=lambda entry: entry.mountain.slug)
            ),
            discoveries=tuple(sorted(self._discoveries.values(), key=lambda item: item.date)),
        )

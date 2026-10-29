from serendipeak.catalog.bootstrap.ports import CatalogSeed, CatalogSnapshot
from serendipeak.catalog.entities import PUBLIC_STATUSES
from serendipeak.catalog.errors import CatalogAlreadyPopulated


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


class InMemoryMountainRepository:
    def __init__(self, mountains=()):
        self._mountains = {mountain.slug: mountain for mountain in mountains}

    def find_public_by_slug(self, slug):
        mountain = self._mountains.get(slug)
        if mountain is None or mountain.status not in PUBLIC_STATUSES:
            return None

        return mountain

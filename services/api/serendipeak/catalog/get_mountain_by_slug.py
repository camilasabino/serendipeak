from serendipeak.catalog.entities import Mountain
from serendipeak.catalog.errors import MountainNotFound
from serendipeak.catalog.ports import MountainRepository
from serendipeak.catalog.slug import is_valid_slug


class GetMountainBySlug:
    def __init__(self, mountains: MountainRepository):
        self._mountains = mountains

    def execute(self, slug: str) -> Mountain:
        # No stored slug can break the slug rule (database CHECK), so a malformed one is unknown
        # without a query; this also keeps NUL characters, which PostgreSQL rejects, off the wire.
        if not is_valid_slug(slug):
            raise MountainNotFound(slug)

        mountain = self._mountains.find_public_by_slug(slug)
        if mountain is None:
            raise MountainNotFound(slug)

        return mountain

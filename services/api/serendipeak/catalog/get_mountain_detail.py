from dataclasses import dataclass

from serendipeak.catalog.entities import Mountain
from serendipeak.catalog.errors import MountainSlugNotFound
from serendipeak.catalog.ports import MountainCatalogReader
from serendipeak.catalog.publication import PublicationViolation, publication_violations
from serendipeak.catalog.slug import is_valid_slug


@dataclass(frozen=True, slots=True)
class MountainDetail:
    mountain: Mountain
    violations: tuple[PublicationViolation, ...]


class GetMountainDetail:
    def __init__(self, reader: MountainCatalogReader):
        self._reader = reader

    def execute(self, slug: str) -> MountainDetail:
        # No stored slug breaks the slug rule, so a malformed one is unknown without a query;
        # this also keeps NUL characters, which PostgreSQL rejects, off the wire.
        if not is_valid_slug(slug):
            raise MountainSlugNotFound(slug)

        mountain = self._reader.find_by_slug(slug)
        if mountain is None:
            raise MountainSlugNotFound(slug)

        return MountainDetail(mountain=mountain, violations=publication_violations(mountain))

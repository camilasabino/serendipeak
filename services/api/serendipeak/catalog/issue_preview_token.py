from dataclasses import dataclass

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.errors import MountainNotInDraft, MountainSlugNotFound
from serendipeak.catalog.ports import Clock, MountainCatalogReader, PreviewTokens
from serendipeak.catalog.slug import is_valid_slug


@dataclass(frozen=True, slots=True)
class PreviewGrant:
    slug: str
    token: str


class IssuePreviewToken:
    def __init__(self, reader: MountainCatalogReader, tokens: PreviewTokens, clock: Clock):
        self._reader = reader
        self._tokens = tokens
        self._clock = clock

    def execute(self, slug: str) -> PreviewGrant:
        # No stored slug breaks the slug rule, so a malformed one is unknown without a query;
        # this also keeps NUL characters, which PostgreSQL rejects, off the wire.
        if not is_valid_slug(slug):
            raise MountainSlugNotFound(slug)

        mountain = self._reader.find_by_slug(slug)
        if mountain is None:
            raise MountainSlugNotFound(slug)
        if mountain.status is not MountainStatus.DRAFT:
            raise MountainNotInDraft(slug)

        return PreviewGrant(
            slug=mountain.slug,
            token=self._tokens.issue(mountain.id, self._clock.now()),
        )

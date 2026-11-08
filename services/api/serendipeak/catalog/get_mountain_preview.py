from serendipeak.catalog.entities import Mountain, MountainStatus
from serendipeak.catalog.errors import InvalidPreviewToken, PreviewUnavailable
from serendipeak.catalog.ports import Clock, MountainCatalogReader, PreviewTokens


class GetMountainPreview:
    def __init__(self, reader: MountainCatalogReader, tokens: PreviewTokens, clock: Clock):
        self._reader = reader
        self._tokens = tokens
        self._clock = clock

    def execute(self, token: str) -> Mountain:
        mountain_id = self._tokens.verify(token, self._clock.now())
        if mountain_id is None:
            raise InvalidPreviewToken

        mountain = self._reader.find_by_id(mountain_id)
        # Only an unpublished mountain needs this door; a published one has its public page, so
        # the preview never becomes a second way to read the public catalog.
        if mountain is None or mountain.status is not MountainStatus.DRAFT:
            raise PreviewUnavailable(mountain_id)

        return mountain

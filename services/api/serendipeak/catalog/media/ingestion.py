import hashlib
from dataclasses import dataclass

from serendipeak.catalog.entities import ImageDimensions, PhotographMedia
from serendipeak.catalog.errors import PhotographRejected, PhotographRejection
from serendipeak.catalog.media import keys
from serendipeak.catalog.media.ports import MediaStore, PhotographFormat, PhotographProcessor

RENDITION_CONTENT_TYPE = "image/jpeg"

_ORIGINAL_CONTENT_TYPES = {
    PhotographFormat.JPEG: "image/jpeg",
    PhotographFormat.PNG: "image/png",
    PhotographFormat.WEBP: "image/webp",
}


@dataclass(frozen=True, slots=True)
class IngestionLimits:
    max_bytes: int


@dataclass(frozen=True, slots=True)
class MediaObject:
    key: str
    data: bytes
    content_type: str


@dataclass(frozen=True, slots=True)
class PreparedPhotograph:
    original_sha256: str
    dimensions: ImageDimensions
    original: MediaObject
    page: MediaObject
    viewer: MediaObject

    @property
    def media(self) -> PhotographMedia:
        return PhotographMedia(
            original_key=self.original.key,
            original_sha256=self.original_sha256,
            page_key=self.page.key,
            viewer_key=self.viewer.key,
        )


class PhotographIngestion:
    """Turns uploaded bytes into stored, content-addressed photograph media.

    prepare validates and renders without touching storage, so a caller can still refuse the
    photograph (a form error, a dimension check) before store writes anything. It raises
    PhotographRejected for a file that is not an acceptable photograph and InfrastructureError
    when an acceptable one cannot be processed.
    """

    def __init__(self, processor: PhotographProcessor, store: MediaStore, limits: IngestionLimits):
        self._processor = processor
        self._store = store
        self._limits = limits

    @property
    def limits(self) -> IngestionLimits:
        return self._limits

    def prepare(self, data: bytes) -> PreparedPhotograph:
        if len(data) > self._limits.max_bytes:
            raise PhotographRejected(PhotographRejection.TOO_MANY_BYTES)

        processed = self._processor.process(data)
        sha256 = hashlib.sha256(data).hexdigest()

        return PreparedPhotograph(
            original_sha256=sha256,
            dimensions=processed.dimensions,
            original=MediaObject(
                key=keys.original_key(sha256, processed.format),
                data=data,
                content_type=_ORIGINAL_CONTENT_TYPES[processed.format],
            ),
            page=MediaObject(
                key=keys.page_key(sha256),
                data=processed.page_jpeg,
                content_type=RENDITION_CONTENT_TYPE,
            ),
            viewer=MediaObject(
                key=keys.viewer_key(sha256),
                data=processed.viewer_jpeg,
                content_type=RENDITION_CONTENT_TYPE,
            ),
        )

    def store(self, prepared: PreparedPhotograph) -> PhotographMedia:
        """Store the original, then both renditions, skipping objects that already exist.

        The original goes first so a public rendition never exists without its source. A
        retry after a partial failure uploads only the missing objects.
        """
        original = prepared.original
        if not self._store.has_original(original.key):
            self._store.put_original(original.key, original.data, original.content_type)

        for rendition in (prepared.page, prepared.viewer):
            if not self._store.has_public(rendition.key):
                self._store.put_public(rendition.key, rendition.data, rendition.content_type)

        return prepared.media

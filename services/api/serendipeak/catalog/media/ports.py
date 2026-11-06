from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from serendipeak.catalog.entities import ImageDimensions


class PhotographFormat(StrEnum):
    JPEG = "jpeg"
    PNG = "png"
    WEBP = "webp"


@dataclass(frozen=True, slots=True)
class ProcessedPhotograph:
    format: PhotographFormat
    dimensions: ImageDimensions
    page_jpeg: bytes
    viewer_jpeg: bytes


class PhotographProcessor(Protocol):
    def process(self, data: bytes) -> ProcessedPhotograph:
        """Decode a photograph and render its public page and viewer JPEG renditions.

        The decoded content decides acceptance: JPEG, PNG or WebP, never the file name or a
        declared content type. dimensions are the original's after its EXIF orientation.
        Renditions follow the current rendition version in keys: sRGB, 8-bit RGB, no metadata,
        aspect ratio kept and never upscaled.

        Raises PhotographRejected for anything that is not an acceptable photograph, and
        InfrastructureError when an acceptable one cannot be processed (for instance when
        memory runs out or the encoder fails).
        """


class MediaStore(Protocol):
    """Content-addressed object storage for photographs.

    Every key must match MEDIA_KEY_PATTERN, otherwise ValueError is raised before any
    storage access. Originals are private; public objects are served to anyone and cached
    forever, so neither is ever overwritten. Storage failures raise InfrastructureError.
    """

    def put_original(self, key: str, data: bytes, content_type: str) -> None:
        """Store a private original under key, unless an object already exists there."""

    def put_public(self, key: str, data: bytes, content_type: str) -> None:
        """Store a public, immutably cached object under key, unless one already exists there."""

    def has_original(self, key: str) -> bool:
        """Return whether a private original exists under key."""

    def has_public(self, key: str) -> bool:
        """Return whether a public object exists under key."""

    def read_original(self, key: str) -> bytes:
        """Return the private original stored under key.

        Raises InfrastructureError when no original exists there.
        """


class SourceImageFetcher(Protocol):
    def fetch(self, url: str) -> bytes:
        """Return the bytes of the image file published at url.

        Only https is used, redirects included, and only on hosts the fetcher is authorized to
        contact; the body is read up to the legacy-source byte limit. Raises
        PhotographRejected(TOO_MANY_BYTES) beyond that limit and InfrastructureError when the
        file cannot be downloaded or its host is not authorized.
        """

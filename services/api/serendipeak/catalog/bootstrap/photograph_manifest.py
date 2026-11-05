from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID

from serendipeak.catalog.entities import ImageDimensions
from serendipeak.catalog.errors import InvalidPhotographManifest
from serendipeak.catalog.media.keys import is_sha256

MANIFEST_FORMAT = "serendipeak.legacy-photographs"
MANIFEST_FORMAT_VERSION = 1

_MANIFEST_KEYS = {"format", "format_version", "photographs"}
_ENTRY_KEYS = {
    "mountain_id",
    "slug",
    "source_identifier",
    "file_url",
    "sha256",
    "bytes",
    "width",
    "height",
}


@dataclass(frozen=True, slots=True)
class ManifestPhotograph:
    mountain_id: UUID
    slug: str
    source_identifier: str
    file_url: str
    sha256: str
    bytes: int
    dimensions: ImageDimensions


class PhotographManifest:
    """The pinned identity of each legacy photograph: its source file, checksum and size."""

    def __init__(self, photographs: Iterable[ManifestPhotograph]):
        self._by_mountain = {}
        for photograph in photographs:
            if photograph.mountain_id in self._by_mountain:
                raise InvalidPhotographManifest(
                    f"mountain {photograph.mountain_id} appears more than once"
                )
            self._by_mountain[photograph.mountain_id] = photograph

    @property
    def photographs(self) -> tuple[ManifestPhotograph, ...]:
        return tuple(sorted(self._by_mountain.values(), key=lambda photograph: photograph.slug))

    def photograph_of(self, mountain_id: UUID) -> ManifestPhotograph | None:
        return self._by_mountain.get(mountain_id)


class ManifestDifference(StrEnum):
    FILE_URL = "the manifest pins another file URL"
    SOURCE_IDENTIFIER = "the manifest pins another source identifier"
    DIMENSIONS = "the manifest pins other dimensions"
    CHECKSUM = "checksum_differs: the file is not the one in the manifest"
    SIZE = "the manifest pins another file size"


def manifest_differences(
    pinned: ManifestPhotograph,
    *,
    file_url: str,
    source_identifier: str,
    sha256: str,
    dimensions: ImageDimensions | None,
    size: int | None = None,
) -> tuple[ManifestDifference, ...]:
    """What a photograph's identity, checksum and dimensions have that the manifest does not pin.

    The file size is compared only when known: a stored original is verified by its checksum.
    """
    differences = [
        (pinned.file_url != file_url, ManifestDifference.FILE_URL),
        (pinned.source_identifier != source_identifier, ManifestDifference.SOURCE_IDENTIFIER),
        (pinned.sha256 != sha256, ManifestDifference.CHECKSUM),
        (size is not None and pinned.bytes != size, ManifestDifference.SIZE),
        (pinned.dimensions != dimensions, ManifestDifference.DIMENSIONS),
    ]

    return tuple(difference for differs, difference in differences if differs)


def parse_photograph_manifest(document: object) -> PhotographManifest:
    manifest = _object(document, _MANIFEST_KEYS, "manifest")
    if (
        manifest["format"] != MANIFEST_FORMAT
        or manifest["format_version"] != MANIFEST_FORMAT_VERSION
    ):
        raise InvalidPhotographManifest(
            f"manifest is not {MANIFEST_FORMAT} version {MANIFEST_FORMAT_VERSION}"
        )

    photographs = manifest["photographs"]
    if not isinstance(photographs, Sequence) or isinstance(photographs, str):
        raise InvalidPhotographManifest("manifest photographs must be a list")

    return PhotographManifest(
        _photograph(raw, f"photographs[{index}]") for index, raw in enumerate(photographs)
    )


def photograph_manifest_document(manifest: PhotographManifest) -> dict:
    return {
        "format": MANIFEST_FORMAT,
        "format_version": MANIFEST_FORMAT_VERSION,
        "photographs": [
            {
                "mountain_id": str(photograph.mountain_id),
                "slug": photograph.slug,
                "source_identifier": photograph.source_identifier,
                "file_url": photograph.file_url,
                "sha256": photograph.sha256,
                "bytes": photograph.bytes,
                "width": photograph.dimensions.width,
                "height": photograph.dimensions.height,
            }
            for photograph in manifest.photographs
        ],
    }


def _photograph(raw: object, label: str) -> ManifestPhotograph:
    fields = _object(raw, _ENTRY_KEYS, label)

    try:
        mountain_id = UUID(_text(fields["mountain_id"], f"{label} mountain_id"))
    except ValueError as error:
        raise InvalidPhotographManifest(f"{label} mountain_id is not a UUID") from error

    sha256 = _text(fields["sha256"], f"{label} sha256")
    if not is_sha256(sha256):
        raise InvalidPhotographManifest(f"{label} sha256 is not a lowercase SHA-256 digest")

    return ManifestPhotograph(
        mountain_id=mountain_id,
        slug=_text(fields["slug"], f"{label} slug"),
        source_identifier=_text(fields["source_identifier"], f"{label} source_identifier"),
        file_url=_text(fields["file_url"], f"{label} file_url"),
        sha256=sha256,
        bytes=_positive_integer(fields["bytes"], f"{label} bytes"),
        dimensions=ImageDimensions(
            width=_positive_integer(fields["width"], f"{label} width"),
            height=_positive_integer(fields["height"], f"{label} height"),
        ),
    )


def _object(value: object, keys: set[str], label: str) -> Mapping:
    if not isinstance(value, Mapping):
        raise InvalidPhotographManifest(f"{label} must be an object")
    if set(value) != keys:
        raise InvalidPhotographManifest(
            f"{label}: unexpected keys {sorted(set(value) - keys)},"
            f" missing keys {sorted(keys - set(value))}"
        )

    return value


def _text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise InvalidPhotographManifest(f"{label} must be a non-empty string")
    return value


def _positive_integer(value: object, label: str) -> int:
    if type(value) is not int or value <= 0:
        raise InvalidPhotographManifest(f"{label} must be a positive integer")
    return value

import re

from serendipeak.catalog.media.ports import PhotographFormat

SHA256_PATTERN = r"^[0-9a-f]{64}$"
MEDIA_KEY_PATTERN = r"^photographs/[0-9a-f]{64}/[a-z0-9][a-z0-9.-]*$"

KEY_PREFIX = "photographs/"
ORIGINAL_NAME_PREFIX = "original."

# Published renditions are cached forever under their key, so changing any rendition
# parameter requires a new version instead of new bytes under an existing key.
RENDITION_VERSION = "r1"
PAGE_NAME = f"page-{RENDITION_VERSION}.jpg"
VIEWER_NAME = f"viewer-{RENDITION_VERSION}.jpg"
PAGE_MAX_WIDTH = 1280
VIEWER_MAX_LONG_EDGE = 2560
RENDITION_JPEG_QUALITY = 85

_SHA256_REGEX = re.compile(SHA256_PATTERN)
_MEDIA_KEY_REGEX = re.compile(MEDIA_KEY_PATTERN)
_ORIGINAL_EXTENSIONS = {
    PhotographFormat.JPEG: "jpg",
    PhotographFormat.PNG: "png",
    PhotographFormat.WEBP: "webp",
}


def is_sha256(value: str) -> bool:
    return _SHA256_REGEX.fullmatch(value) is not None


def is_media_key(value: str) -> bool:
    return _MEDIA_KEY_REGEX.fullmatch(value) is not None


def require_media_key(value: str) -> str:
    if not is_media_key(value):
        raise ValueError(f"{value!r} is not a media key")

    return value


def original_key(sha256: str, photograph_format: PhotographFormat) -> str:
    extension = _ORIGINAL_EXTENSIONS[photograph_format]

    return f"{original_key_prefix(sha256)}{extension}"


def original_key_prefix(sha256: str) -> str:
    return f"{_directory(sha256)}/{ORIGINAL_NAME_PREFIX}"


def page_key(sha256: str) -> str:
    return f"{_directory(sha256)}/{PAGE_NAME}"


def viewer_key(sha256: str) -> str:
    return f"{_directory(sha256)}/{VIEWER_NAME}"


def public_url(base_url: str, key: str) -> str:
    return f"{base_url}/{require_media_key(key)}"


def _directory(sha256: str) -> str:
    if not is_sha256(sha256):
        raise ValueError(f"{sha256!r} is not a lowercase SHA-256 digest")

    return f"{KEY_PREFIX}{sha256}"

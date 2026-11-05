import os
import tempfile
from pathlib import Path

from serendipeak.catalog.media.keys import require_media_key
from serendipeak.errors import InfrastructureError

PUBLIC_DIRECTORY = "public"
ORIGINALS_DIRECTORY = "originals"


class FilesystemMediaStore:
    """Media on the local disk, for development and tests.

    Public objects and originals live in separate directories under root, so only the public
    one is ever served.
    """

    def __init__(self, root: Path):
        self._public = (root / PUBLIC_DIRECTORY).resolve()
        self._originals = (root / ORIGINALS_DIRECTORY).resolve()

    def put_original(self, key: str, data: bytes, content_type: str) -> None:
        _write(_path(self._originals, key), data)

    def put_public(self, key: str, data: bytes, content_type: str) -> None:
        _write(_path(self._public, key), data)

    def has_original(self, key: str) -> bool:
        return _path(self._originals, key).is_file()

    def has_public(self, key: str) -> bool:
        return _path(self._public, key).is_file()

    def read_original(self, key: str) -> bytes:
        path = _path(self._originals, key)

        try:
            return path.read_bytes()
        except FileNotFoundError as error:
            raise InfrastructureError(f"no original is stored under {key}") from error
        except OSError as error:
            raise InfrastructureError(f"could not read the original {key}") from error


def _path(directory: Path, key: str) -> Path:
    require_media_key(key)
    path = (directory / key).resolve()
    if not path.is_relative_to(directory):
        raise InfrastructureError(f"the media key {key} resolves outside the media directory")

    return path


def _write(path: Path, data: bytes) -> None:
    if path.is_file():
        return

    # Writing to a temporary file in the same directory and renaming it makes the object
    # appear whole or not at all, even when the process dies half way through.
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix=".", suffix=".partial")
    except OSError as error:
        raise InfrastructureError(f"could not store {path.name}") from error

    try:
        with os.fdopen(descriptor, "wb") as file:
            file.write(data)
        os.replace(temporary, path)
    except OSError as error:
        Path(temporary).unlink(missing_ok=True)
        raise InfrastructureError(f"could not store {path.name}") from error

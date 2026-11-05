import hashlib
from pathlib import Path

from serendipeak.catalog.media.ports import SourceImageFetcher
from serendipeak.errors import InfrastructureError
from serendipeak.media.atomic_file import write_file_atomically


class CachingSourceImageFetcher:
    """Keeps a local copy of every downloaded source file, so later runs need no network.

    Files are named after the SHA-256 of their URL. A cached file is returned as it is; the
    checks after fetching (dimensions, the manifest checksum) apply to it like to a download.
    """

    def __init__(self, fetcher: SourceImageFetcher, directory: Path):
        self._fetcher = fetcher
        self._directory = directory

    def fetch(self, url: str) -> bytes:
        path = self._directory / hashlib.sha256(url.encode("utf-8")).hexdigest()

        try:
            return path.read_bytes()
        except FileNotFoundError:
            pass
        except OSError as error:
            raise InfrastructureError(f"could not read the cached copy {path}") from error

        data = self._fetcher.fetch(url)
        write_file_atomically(path, data)

        return data

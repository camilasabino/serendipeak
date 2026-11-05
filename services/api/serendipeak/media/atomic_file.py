import os
import tempfile
from pathlib import Path

from serendipeak.errors import InfrastructureError


def write_file_atomically(path: Path, data: bytes) -> None:
    # Writing to a temporary file in the same directory and renaming it makes the file
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

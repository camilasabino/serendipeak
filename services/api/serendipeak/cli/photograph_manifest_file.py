import json
from pathlib import Path

from django.core.management.base import CommandError

from serendipeak.catalog.bootstrap.photograph_manifest import (
    PhotographManifest,
    parse_photograph_manifest,
    photograph_manifest_document,
)
from serendipeak.errors import ApplicationError


def load_photograph_manifest(path: Path) -> PhotographManifest:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise CommandError(f"cannot read {path}: {error}") from error

    try:
        return parse_photograph_manifest(document)
    except ApplicationError as error:
        raise CommandError(str(error)) from error


def write_photograph_manifest(manifest: PhotographManifest, path: Path) -> bool:
    """Write the manifest to a new file. Returns False when the file already holds it.

    A manifest pins the bytes of the photographs, so an existing file with other content is
    never replaced: moving it away is a deliberate act.
    """
    text = json.dumps(photograph_manifest_document(manifest), indent=2, ensure_ascii=False) + "\n"

    try:
        with path.open("x", encoding="utf-8") as file:
            file.write(text)
        return True
    except FileExistsError:
        pass
    except OSError as error:
        raise CommandError(f"cannot write {path}: {error}") from error

    try:
        unchanged = path.read_text(encoding="utf-8") == text
    except OSError as error:
        raise CommandError(f"cannot read {path}: {error}") from error
    if not unchanged:
        raise CommandError(
            f"{path} already exists with another manifest and is not overwritten: write to a new"
            " path, or move the existing file away if replacing the pinned photographs is intended"
        )

    return False

import json
from pathlib import Path

from django.core.management.base import CommandError


def read_json(path: Path) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise CommandError(f"cannot read {path}: {error}") from error

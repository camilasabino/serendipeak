import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from serendipeak.cli.errors import command_error
from serendipeak.errors import ApplicationError, InfrastructureError


class Command(BaseCommand):
    help = (
        "Write a draft of the private geography input from the catalog: every mountain with its"
        " id, slug and countries (the v1 names mapped to codes while the catalog still holds"
        " them), the continents empty and the checksum unset. Read-only. The operator completes"
        " the continents and freezes the file with its checksum; a draft cannot be applied."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--output",
            type=Path,
            required=True,
            help="where to write the draft (never defaults to a path in the repository)",
        )

    def handle(self, *args, **options):
        from config import composition

        output = options["output"]

        try:
            draft = composition.build_prepare_geography_input().execute()
        except (ApplicationError, InfrastructureError) as error:
            raise command_error(error) from error

        try:
            output.touch(mode=0o600, exist_ok=False)
            output.write_text(
                json.dumps(draft, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
            )
        except OSError as error:
            raise CommandError(f"cannot write {output}: {error}") from error

        self.stdout.write(f"Wrote a draft of {len(draft['mountains'])} mountains to {output}.")

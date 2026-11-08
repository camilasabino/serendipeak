import json
import os
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from serendipeak.cli.errors import command_error
from serendipeak.cli.snapshot_report import write_summary
from serendipeak.errors import ApplicationError, InfrastructureError


class Command(BaseCommand):
    help = (
        "Write the private catalog snapshot of the database: mountains with their geography,"
        " cameras and photograph metadata, and the region taxonomy. Users, sessions, secrets,"
        " reference data and media objects are not in it, and neither are daily discoveries"
        " unless asked for. Read-only on the database. The file is created with owner-only"
        " permissions, never replaces an existing file and is refused inside the repository."
        " Record the printed content_sha256: loading and verifying require it."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--output",
            type=Path,
            required=True,
            help="a new file outside the repository",
        )
        parser.add_argument(
            "--exclude-slug",
            action="append",
            default=[],
            metavar="SLUG",
            help="leave this mountain out (repeatable); every exclusion is reported",
        )
        parser.add_argument(
            "--exclude-region",
            action="append",
            default=[],
            metavar="SLUG",
            help=(
                "leave this region out (repeatable); refused while a mountain or a child that is"
                " kept is under it"
            ),
        )
        parser.add_argument(
            "--include-discoveries",
            action="store_true",
            help="also export the daily discoveries (excluded by default)",
        )

    def handle(self, *args, **options):
        from config import composition

        output = options["output"].expanduser().resolve()
        repository = composition.SERVICE_ROOT.parents[1]
        if output.is_relative_to(repository):
            raise CommandError(
                f"{output} is inside the repository: write the snapshot to a private location"
                " outside it"
            )

        self.stdout.write(f"Source: {composition.describe_database()}.")
        try:
            export = composition.build_export_catalog_snapshot().execute(
                exclude_slugs=options["exclude_slug"],
                exclude_region_slugs=options["exclude_region"],
                include_discoveries=options["include_discoveries"],
            )
        except (ApplicationError, InfrastructureError) as error:
            raise command_error(error) from error

        self.write_file(output, export.document)

        write_summary(self.stdout.write, export.summary)
        for slug in export.excluded_mountains:
            self.stdout.write(f"Excluded mountain: {slug}.")
        for slug in export.excluded_regions:
            self.stdout.write(f"Excluded region: {slug}.")
        for slug in export.empty_regions:
            self.stdout.write(f"Region without mountains: {slug}.")
        self.stdout.write(f"Wrote {output}")
        self.stdout.write(f"content_sha256: {export.document['content_sha256']}")

    def write_file(self, path: Path, document: dict) -> None:
        text = json.dumps(document, indent=2, ensure_ascii=False) + "\n"

        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError as error:
            raise CommandError(f"{path} already exists and is not replaced") from error
        except OSError as error:
            raise CommandError(f"cannot write {path}: {error}") from error

        with os.fdopen(descriptor, "w", encoding="utf-8") as file:
            file.write(text)

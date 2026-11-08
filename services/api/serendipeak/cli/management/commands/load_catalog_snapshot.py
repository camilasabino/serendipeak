from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from serendipeak.cli.errors import command_error
from serendipeak.cli.json_file import read_json
from serendipeak.cli.snapshot_report import write_summary
from serendipeak.errors import ApplicationError, InfrastructureError


class Command(BaseCommand):
    help = (
        "Initialize an empty catalog from a private catalog snapshot, then verify what was"
        " stored against it. The snapshot must carry the given checksum or nothing is read or"
        " written. Refuses a database that holds mountains, loads atomically and needs the"
        " reference data that migrate provides. The load is committed before the verification:"
        " when the verification fails, recreate the database and load again."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--input",
            type=Path,
            required=True,
            help="private catalog snapshot (never defaults to a path in the repository)",
        )
        parser.add_argument("--sha256", required=True, help="the checksum the snapshot must have")

    def handle(self, *args, **options):
        from config import composition

        document = read_json(options["input"])

        self.stdout.write(f"Target: {composition.describe_database()}.")
        try:
            verification = composition.build_load_catalog_snapshot().execute(
                document, options["sha256"]
            )
        except (ApplicationError, InfrastructureError) as error:
            raise command_error(error) from error

        write_summary(self.stdout.write, verification.stored)
        if not verification.is_consistent:
            for mismatch in verification.mismatches:
                self.stderr.write(mismatch)
            raise CommandError("the stored catalog does not match the snapshot")

        self.stdout.write("Loaded and verified: the catalog matches the snapshot.")

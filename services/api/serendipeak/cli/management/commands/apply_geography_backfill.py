from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from serendipeak.catalog.bootstrap.ports import BackfillTarget
from serendipeak.catalog.errors import GeographyBackfillRejected
from serendipeak.cli.errors import command_error
from serendipeak.cli.json_file import read_json
from serendipeak.errors import ApplicationError, InfrastructureError


class Command(BaseCommand):
    help = (
        "Give every mountain of the catalog its continent and country links from the private"
        " geography input. The input must carry the given checksum and cover the stored mountains"
        " exactly, or nothing is read or written. Runs in one transaction and writes nothing but"
        " the continent and the links. With --dry-run it reports what would change and writes"
        " nothing. Meant for the schema between the continent migration and the final geography"
        " validation migration."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--input",
            type=Path,
            required=True,
            help="private geography input (never defaults to a path in the repository)",
        )
        parser.add_argument(
            "--sha256", required=True, help="the checksum the geography input must have"
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="report every change and write nothing",
        )

    def handle(self, *args, **options):
        from config import composition

        document = read_json(options["input"])

        try:
            result = composition.build_apply_geography_backfill().execute(
                document,
                expected_sha256=options["sha256"],
                dry_run=options["dry_run"],
                announce_target=self.write_target,
            )
        except GeographyBackfillRejected as error:
            for problem in error.problems:
                self.stderr.write(problem)
            raise CommandError("the geography input does not fit the catalog") from error
        except (ApplicationError, InfrastructureError) as error:
            raise command_error(error) from error

        for change in result.plan.changes:
            self.stdout.write(self.describe(change))
        mode = "Dry run, nothing was written." if options["dry_run"] else "Applied."
        self.stdout.write(
            f"{mode} {result.plan.checked} mountains checked,"
            f" {len(result.plan.changes)} changed, {result.plan.unchanged} unchanged."
        )

    def write_target(self, target: BackfillTarget):
        self.stdout.write(
            f"Target: database {target.database} on {target.host}:{target.port},"
            f" catalog migration {target.migration}."
        )

    def describe(self, change):
        parts = []
        if change.continent is not None:
            before, after = change.continent
            parts.append(f"continent {before or '-'} -> {after}")
        if change.added_countries:
            parts.append(f"adds {', '.join(change.added_countries)}")
        if change.removed_countries:
            parts.append(f"removes {', '.join(change.removed_countries)}")

        return f"{change.slug}: {'; '.join(parts)}"

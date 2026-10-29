from django.core.management.base import BaseCommand, CommandError

from serendipeak.cli.errors import command_error
from serendipeak.errors import InfrastructureError


class Command(BaseCommand):
    help = (
        "Check the publication invariants of every active mountain in the catalog. Safe to run"
        " at any time; it does not compare the catalog with the seed."
    )

    def handle(self, *args, **options):
        from config import composition

        try:
            report = composition.build_check_catalog().execute()
        except InfrastructureError as error:
            raise command_error(error) from error
        for violation in report.violations:
            self.stderr.write(f"{violation.slug}: {violation.violation}")
        if report.violations:
            raise CommandError(
                f"{len(report.violations)} publication violations"
                f" in {report.checked} active mountains"
            )
        self.stdout.write(f"{report.checked} active mountains satisfy the publication invariants.")

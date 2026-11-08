from django.core.management.base import BaseCommand, CommandError

from serendipeak.cli.errors import command_error
from serendipeak.errors import InfrastructureError


class Command(BaseCommand):
    help = (
        "Check that every photograph of the catalog has complete owned media. Without options"
        " only the catalog is read. Exits non-zero when any photograph has a problem."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--deep",
            action="store_true",
            help="also check that the original and both renditions exist in the media store",
        )
        parser.add_argument(
            "--checksums",
            action="store_true",
            help="also download every original and compare it with its checksum (implies --deep)",
        )

    def handle(self, *args, **options):
        from config import composition

        try:
            report = composition.build_check_photograph_media().execute(
                deep=options["deep"], checksums=options["checksums"]
            )
        except InfrastructureError as error:
            raise command_error(error) from error

        for problem in report.problems:
            self.stderr.write(f"{problem.slug}: {problem.problem}")

        if report.problems:
            slugs = {problem.slug for problem in report.problems}
            raise CommandError(f"{len(slugs)} of {report.checked} photographs have media problems")

        scope = "checksums" if options["checksums"] else "objects" if options["deep"] else "media"
        self.stdout.write(f"{report.checked} photographs have complete media ({scope} checked).")

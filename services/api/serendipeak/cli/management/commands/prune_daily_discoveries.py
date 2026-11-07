from django.core.management.base import BaseCommand

from serendipeak.cli.errors import command_error
from serendipeak.errors import InfrastructureError


class Command(BaseCommand):
    help = (
        "Delete the daily discoveries older than the 365-day retention window. Idempotent and"
        " safe to run at any time; the database refuses to delete a discovery inside the window."
    )

    def handle(self, *args, **options):
        from config import composition

        try:
            result = composition.build_prune_daily_discoveries().execute()
        except InfrastructureError as error:
            raise command_error(error) from error

        self.stdout.write(
            f"Deleted {result.deleted} daily discoveries dated before {result.cutoff.isoformat()}."
        )

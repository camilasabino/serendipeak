import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from serendipeak.catalog.bootstrap.frozen_catalog import parse_frozen_catalog
from serendipeak.catalog.bootstrap.seed import parse_catalog_seed
from serendipeak.catalog.bootstrap.verify_catalog import VerificationReport
from serendipeak.catalog.errors import CatalogMismatch
from serendipeak.cli.errors import command_error
from serendipeak.errors import ApplicationError, InfrastructureError


class Command(BaseCommand):
    help = (
        "Load the seed artifact into an empty catalog, then verify the catalog against the seed"
        " and the frozen v1 catalog. Refuses when the catalog already holds mountains. The load"
        " is committed before the verification: when the verification fails, recreate the"
        " database and bootstrap again."
    )

    def add_arguments(self, parser):
        parser.add_argument("--seed", type=Path, help="seed artifact (default: the committed one)")
        parser.add_argument(
            "--frozen-catalog", type=Path, help="frozen catalog (default: contracts/v1)"
        )
        parser.add_argument(
            "--verify-only",
            action="store_true",
            help=(
                "only verify the catalog against the seed and the frozen catalog. Meant for a"
                " freshly bootstrapped catalog: later daily discoveries and catalog edits are"
                " reported as mismatches. Use check_catalog for routine checks."
            ),
        )

    def handle(self, *args, **options):
        from config import composition

        seed_document = read_json(options["seed"] or composition.SEED_PATH)
        frozen_document = read_json(options["frozen_catalog"] or composition.FROZEN_CATALOG_PATH)
        try:
            seed = parse_catalog_seed(seed_document)
            frozen = parse_frozen_catalog(frozen_document)
            if options["verify_only"]:
                report = composition.build_verify_catalog().execute(seed, frozen)
            else:
                report = composition.build_bootstrap_catalog().execute(seed, frozen)
        except CatalogMismatch as error:
            self.write_mismatches(error.mismatches)
            raise CommandError(
                "the catalog does not match the seed or the frozen catalog"
            ) from error
        except (ApplicationError, InfrastructureError) as error:
            raise command_error(error) from error
        self.write_report(report)
        if not report.is_consistent:
            self.write_mismatches(report.mismatches)
            raise CommandError("the catalog does not match the seed or the frozen catalog")

    def write_report(self, report: VerificationReport):
        self.stdout.write(
            f"Catalog: {report.mountains} mountains, {report.images} images,"
            f" {report.discoveries} daily discoveries."
        )
        self.stdout.write(f"Seed mismatches: {len(report.seed_mismatches)}.")
        self.stdout.write(
            f"Frozen catalog: {report.frozen.matched}/{report.frozen.total} mountains match."
        )

    def write_mismatches(self, mismatches: tuple[str, ...]):
        for mismatch in mismatches:
            self.stderr.write(mismatch)


def read_json(path: Path) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise CommandError(f"cannot read {path}: {error}") from error

from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from serendipeak.catalog.bootstrap.frozen_catalog import parse_frozen_catalog
from serendipeak.catalog.bootstrap.seed import parse_catalog_seed
from serendipeak.catalog.bootstrap.verify_catalog import VerificationReport
from serendipeak.catalog.errors import CatalogMismatch, GeographyBackfillRejected
from serendipeak.catalog.geography_input import parse_geography_input
from serendipeak.cli.errors import command_error
from serendipeak.cli.json_file import read_json
from serendipeak.errors import ApplicationError, InfrastructureError


class Command(BaseCommand):
    help = (
        "Load the seed artifact into an empty catalog, then verify the catalog against the seed"
        " and the frozen v1 catalog. The seed holds no continents or countries, so the load needs"
        " the private geography input and its checksum and refuses before writing without them."
        " Refuses when the catalog already holds mountains. The load is committed before the"
        " verification: when the verification fails, recreate the database and bootstrap again."
    )

    def add_arguments(self, parser):
        parser.add_argument("--seed", type=Path, help="seed artifact (default: the committed one)")
        parser.add_argument(
            "--frozen-catalog",
            type=Path,
            help="frozen catalog (default: contracts/v1)",
        )
        parser.add_argument(
            "--geography",
            type=Path,
            help="private geography input (never defaults to a path in the repository)",
        )
        parser.add_argument(
            "--geography-sha256",
            help="the checksum the geography input must have",
        )
        parser.add_argument(
            "--verify-only",
            action="store_true",
            help=(
                "only verify the catalog against the seed and the frozen catalog. Meant for a"
                " freshly bootstrapped catalog: later daily discoveries and catalog edits are"
                " reported as mismatches. Use check_catalog for routine checks. Without the"
                " geography input, continents and countries are not compared."
            ),
        )

    def handle(self, *args, **options):
        from config import composition

        geography_path = options["geography"]
        geography_sha256 = options["geography_sha256"]
        if (geography_path is None) != (geography_sha256 is None):
            raise CommandError("--geography and --geography-sha256 are given together")
        if geography_path is None and not options["verify_only"]:
            raise CommandError(
                "the seed has no continents or countries: pass --geography and"
                " --geography-sha256 (nothing was written)"
            )

        seed_document = read_json(options["seed"] or composition.SEED_PATH)
        frozen_document = read_json(options["frozen_catalog"] or composition.FROZEN_CATALOG_PATH)
        geography_document = None if geography_path is None else read_json(geography_path)

        try:
            seed = parse_catalog_seed(seed_document)
            frozen = parse_frozen_catalog(frozen_document)
            geography = (
                None
                if geography_document is None
                else parse_geography_input(geography_document, expected_sha256=geography_sha256)
            )
            if options["verify_only"]:
                report = composition.build_verify_catalog().execute(seed, frozen, geography)
            else:
                report = composition.build_bootstrap_catalog().execute(seed, frozen, geography)
        except GeographyBackfillRejected as error:
            self.write_mismatches(error.problems)
            raise CommandError("the geography input does not fit the seed") from error
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
            "Geography: compared."
            if report.geography_compared
            else "Geography: not compared (no geography input given)."
        )
        self.stdout.write(
            f"Frozen catalog: {report.frozen.matched}/{report.frozen.total} mountains match."
        )

    def write_mismatches(self, mismatches: tuple[str, ...]):
        for mismatch in mismatches:
            self.stderr.write(mismatch)

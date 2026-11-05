from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from serendipeak.catalog.bootstrap.materialize_photographs import (
    MaterializationOutcome,
    MaterializationReport,
    PhotographResult,
)
from serendipeak.cli.errors import command_error
from serendipeak.cli.photograph_manifest_file import (
    load_photograph_manifest,
    write_photograph_manifest,
)
from serendipeak.errors import ApplicationError, InfrastructureError

MEBIBYTE = 1024 * 1024


class Command(BaseCommand):
    help = (
        "Copy the source file of every photograph without media into the media store and"
        " attach the stored media. Only the file URLs pinned by the manifest are downloaded, and"
        " each file must be the pinned one (checksum and dimensions). A photograph outside the"
        " manifest needs --file. Photographs that already have media are skipped, and objects"
        " already stored are not uploaded again, so a failed run can be rerun. Exits non-zero"
        " when any photograph failed."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--slug",
            action="append",
            dest="slugs",
            metavar="SLUG",
            help="only this photograph; repeat for several",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="download and verify every file, but store and attach nothing",
        )
        parser.add_argument(
            "--cache-dir",
            type=Path,
            help="keep downloaded files here and read them from here on later runs",
        )
        parser.add_argument(
            "--file",
            action="append",
            dest="files",
            default=[],
            metavar="SLUG=PATH",
            help="use this local file instead of downloading the photograph of SLUG",
        )
        parser.add_argument(
            "--manifest",
            type=Path,
            metavar="PATH",
            help="the manifest every file must match (default: the committed one)",
        )
        parser.add_argument(
            "--write-manifest",
            type=Path,
            metavar="PATH",
            help=(
                "write the manifest of this run to a new file; needs every photograph verified"
                " in this run, and never replaces a file holding another manifest"
            ),
        )

    def handle(self, *args, **options):
        from config import composition

        files = {slug: read_file(path) for slug, path in parse_files(options["files"])}
        manifest = load_photograph_manifest(
            options["manifest"] or composition.PHOTOGRAPH_MANIFEST_PATH
        )

        try:
            report = composition.build_materialize_photographs(options["cache_dir"]).execute(
                slugs=options["slugs"],
                dry_run=options["dry_run"],
                files=files,
                manifest=manifest,
            )
        except (ApplicationError, InfrastructureError) as error:
            raise command_error(error) from error

        self.write_report(report)

        if options["write_manifest"] is not None:
            self.write_manifest(report, options["write_manifest"])

        if report.failed:
            raise CommandError(
                f"{len(report.failed)} of {len(report.results)} photographs failed:"
                f" {', '.join(result.slug for result in report.failed)}"
            )

    def write_report(self, report: MaterializationReport):
        for result in report.results:
            line = describe(result)
            if result.outcome is MaterializationOutcome.FAILED:
                self.stderr.write(line)
            else:
                self.stdout.write(line)

        counts = ", ".join(
            f"{sum(result.outcome is outcome for result in report.results)} {outcome}"
            for outcome in MaterializationOutcome
        )
        self.stdout.write(f"{len(report.results)} photographs: {counts}.")

        largest = report.largest_source
        if largest is not None:
            self.stdout.write(
                f"Largest source file: {largest.slug}, {largest.source.bytes} bytes"
                f" ({largest.source.bytes / MEBIBYTE:.1f} MiB)."
            )

    def write_manifest(self, report: MaterializationReport, path: Path):
        manifest = report.manifest()
        if manifest is None:
            raise CommandError(
                "the manifest was not written: it needs a run over the whole catalog that"
                " downloads and verifies every photograph"
            )

        written = write_photograph_manifest(manifest, path)
        outcome = "written to" if written else "already in"
        self.stdout.write(f"Manifest of {len(manifest.photographs)} photographs {outcome} {path}.")


def describe(result: PhotographResult) -> str:
    facts = []
    if result.source is not None:
        source = result.source
        facts.append(
            f"{source.bytes / MEBIBYTE:.1f} MiB, {source.dimensions.width}x"
            f"{source.dimensions.height}, sha256 {source.sha256[:12]}"
        )
    if result.detail is not None:
        facts.append(result.detail)

    return f"{result.slug}: {result.outcome}" + (f" ({'; '.join(facts)})" if facts else "")


def parse_files(values: list[str]) -> list[tuple[str, Path]]:
    files = []
    for value in values:
        slug, separator, path = value.partition("=")
        if not separator or not slug or not path:
            raise CommandError(f"--file expects SLUG=PATH, not {value!r}")
        files.append((slug, Path(path)))

    slugs = [slug for slug, _ in files]
    if len(set(slugs)) != len(slugs):
        raise CommandError("--file names a slug more than once")

    return files


def read_file(path: Path) -> bytes:
    try:
        return path.read_bytes()
    except OSError as error:
        raise CommandError(f"cannot read {path}: {error}") from error

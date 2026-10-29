import argparse
import hashlib
import json
import os
import subprocess
import sys
from contextlib import contextmanager
from datetime import UTC, date, datetime
from pathlib import Path, PurePosixPath

import psycopg
import yaml
from psycopg.rows import dict_row

from serendipeak.catalog.bootstrap.seed import (
    LEGACY_COMMIT,
    LEGACY_TAG,
    SEED_FORMAT,
    SEED_FORMAT_VERSION,
    content_sha256,
)

LEGACY_SCHEMA_VERSION = 9
MEDIA_MANIFEST_PATH = "data/media.yaml"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "seed" / "legacy-catalog-v1.json"

IMAGE_TYPE = "image"
IMAGE_SOURCE = "wikimedia_commons"
COMMONS_FILE_PREFIX = "File:"

MOUNTAIN_COLUMNS = (
    "id",
    "slug",
    "name",
    "latitude",
    "longitude",
    "elevation_meters",
    "prominence_meters",
    "range_name",
    "countries",
    "summary",
    "camera_heading_degrees",
    "camera_pitch_degrees",
    "camera_range_meters",
    "camera_framing_x",
    "camera_framing_y",
    "osm_type",
    "osm_id",
    "wikidata_id",
    "wikipedia_url",
    "status",
    "created_at",
    "updated_at",
)
IMAGE_COLUMNS = (
    "source_identifier",
    "source_page_url",
    "url",
    "thumbnail_url",
    "width",
    "height",
    "creator",
    "attribution",
    "license_name",
    "license_url",
)
DISCOVERY_COLUMNS = ("date", "mountain_id", "created_at")

# Every legacy column is either exported or deliberately dropped, so a schema
# drift in the legacy database stops the export instead of losing data silently.
EXPECTED_LEGACY_COLUMNS = {
    "mountains": {*MOUNTAIN_COLUMNS, "location"} - {"latitude", "longitude"},
    "mountain_media": {
        *IMAGE_COLUMNS,
        "id",
        "mountain_id",
        "type",
        "source",
        "title",
        "is_primary",
        "created_at",
    },
    "daily_discoveries": set(DISCOVERY_COLUMNS),
}

MANIFEST_ENTRY_KEYS = {"slug", "commonsFile", "license", "creator", "credit", "approvedOn"}
MANIFEST_REQUIRED_KEYS = {"slug", "commonsFile", "license", "approvedOn"}
MANIFEST_LICENSE_KEYS = {"reported", "elected", "electedUrl", "electionBasisUrl"}
ELECTION_KEYS = {"elected", "electedUrl", "electionBasisUrl"}


class ExportError(Exception):
    pass


class LegacyRepository:
    def __init__(self, path):
        self._path = Path(path)

    def media_manifest(self):
        tagged = self._git("rev-parse", "--verify", f"refs/tags/{LEGACY_TAG}^{{commit}}")
        if tagged.decode().strip() != LEGACY_COMMIT:
            raise ExportError(f"tag {LEGACY_TAG} does not point to {LEGACY_COMMIT}")

        return self._git("show", f"{LEGACY_COMMIT}:{MEDIA_MANIFEST_PATH}")

    def _git(self, *arguments):
        try:
            completed = subprocess.run(
                ["git", "-C", str(self._path), *arguments],
                capture_output=True,
                check=True,
            )
        except (OSError, subprocess.CalledProcessError) as error:
            raise ExportError(f"cannot read the legacy repository: {error}") from error

        return completed.stdout


class LegacyDatabase:
    def __init__(self, connection):
        self._connection = connection

    def assert_read_only(self):
        (setting,) = self._connection.execute("SHOW transaction_read_only").fetchone().values()
        if setting != "on":
            raise ExportError("the legacy database transaction is not read-only")

    def schema_migration(self):
        rows = self._connection.execute("SELECT version, dirty FROM schema_migrations").fetchall()
        return [(row["version"], row["dirty"]) for row in rows]

    def column_names(self, table):
        rows = self._connection.execute(
            "SELECT column_name FROM information_schema.columns"
            " WHERE table_schema = 'public' AND table_name = %s",
            (table,),
        ).fetchall()
        return {row["column_name"] for row in rows}

    def mountains(self):
        return self._connection.execute(
            "SELECT id, slug, name,"
            " ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude,"
            " elevation_meters, prominence_meters, range_name, countries, summary,"
            " camera_heading_degrees, camera_pitch_degrees, camera_range_meters,"
            " camera_framing_x, camera_framing_y,"
            " osm_type, osm_id, wikidata_id, wikipedia_url, status, created_at, updated_at"
            " FROM mountains"
        ).fetchall()

    def images(self):
        return self._connection.execute(
            "SELECT mountain_id, type, source, title, is_primary,"
            " source_identifier, source_page_url, url, thumbnail_url, width, height,"
            " creator, attribution, license_name, license_url"
            " FROM mountain_media"
        ).fetchall()

    def discoveries(self):
        return self._connection.execute(
            "SELECT date, mountain_id, created_at FROM daily_discoveries"
        ).fetchall()


@contextmanager
def read_only_snapshot(database_url):
    try:
        with psycopg.connect(database_url, row_factory=dict_row) as connection:
            connection.read_only = True
            connection.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
            with connection.transaction():
                database = LegacyDatabase(connection)
                database.assert_read_only()
                yield database
    except psycopg.Error as error:
        raise ExportError(f"legacy database error: {error}") from error


def parse_media_manifest(raw):
    document = yaml.safe_load(raw)
    if not isinstance(document, dict) or set(document) != {"media"}:
        raise ExportError("the media manifest must contain only the 'media' list")

    approvals = {}

    for entry in document["media"]:
        slug = entry.get("slug")
        unknown = set(entry) - MANIFEST_ENTRY_KEYS
        missing = MANIFEST_REQUIRED_KEYS - set(entry)
        if unknown or missing:
            raise ExportError(
                f"media entry {slug!r}: unsupported keys {sorted(unknown)},"
                f" missing keys {sorted(missing)}"
            )

        license_ = entry["license"]
        unknown_license = set(license_) - MANIFEST_LICENSE_KEYS
        if "reported" not in license_ or unknown_license:
            raise ExportError(f"media entry {slug!r}: unsupported license {sorted(license_)}")

        election = ELECTION_KEYS & set(license_)
        if election and election != ELECTION_KEYS:
            raise ExportError(f"media entry {slug!r}: incomplete license election")

        if not isinstance(entry["approvedOn"], date) or isinstance(entry["approvedOn"], datetime):
            raise ExportError(f"media entry {slug!r}: approvedOn is not a date")

        if slug in approvals:
            raise ExportError(f"media entry {slug!r} appears twice")
        approvals[slug] = entry

    return approvals


def media_title(source_identifier):
    return PurePosixPath(source_identifier.removeprefix(COMMONS_FILE_PREFIX)).stem


def timestamp(value):
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def check_legacy_schema(database):
    if database.schema_migration() != [(LEGACY_SCHEMA_VERSION, False)]:
        raise ExportError(f"legacy schema is not at clean version {LEGACY_SCHEMA_VERSION}")

    for table, expected in EXPECTED_LEGACY_COLUMNS.items():
        actual = database.column_names(table)
        if actual != expected:
            raise ExportError(
                f"legacy table {table}: unexpected columns {sorted(actual - expected)},"
                f" missing columns {sorted(expected - actual)}"
            )


def images_by_mountain(rows):
    images = {}

    for row in rows:
        mountain_id = row["mountain_id"]
        if row["type"] != IMAGE_TYPE or row["source"] != IMAGE_SOURCE or not row["is_primary"]:
            raise ExportError(f"mountain {mountain_id}: media row is not a primary Commons image")
        if row["title"] != media_title(row["source_identifier"]):
            raise ExportError(f"mountain {mountain_id}: media title is not derived from the file")
        if mountain_id in images:
            raise ExportError(f"mountain {mountain_id} has more than one media row")

        images[mountain_id] = row

    return images


def approval_fields(slug, image, approval):
    if approval is None:
        return {"license_reported": None, "license_election_basis_url": None, "approved_on": None}
    if image is None:
        raise ExportError(f"media entry {slug!r} has no stored image")

    license_ = approval["license"]
    expected = {
        "source_identifier": COMMONS_FILE_PREFIX + approval["commonsFile"],
        "license_name": license_.get("elected", license_["reported"]),
    }
    if "electedUrl" in license_:
        expected["license_url"] = license_["electedUrl"]
    if "creator" in approval:
        expected["creator"] = approval["creator"]
    if "credit" in approval:
        expected["attribution"] = approval["credit"]

    for column, value in expected.items():
        if image[column] != value:
            raise ExportError(
                f"media entry {slug!r}: {column} {image[column]!r} differs from {value!r}"
            )

    return {
        "license_reported": license_["reported"],
        "license_election_basis_url": license_.get("electionBasisUrl"),
        "approved_on": approval["approvedOn"].isoformat(),
    }


def exported_mountain(row, image, approval):
    mountain = {column: row[column] for column in MOUNTAIN_COLUMNS}
    mountain["id"] = str(row["id"])
    mountain["countries"] = list(row["countries"])
    mountain["created_at"] = timestamp(row["created_at"])
    mountain["updated_at"] = timestamp(row["updated_at"])

    fields = approval_fields(row["slug"], image, approval)
    mountain["image"] = (
        None if image is None else {**{column: image[column] for column in IMAGE_COLUMNS}, **fields}
    )

    return mountain


def build_content(mountain_rows, image_rows, discovery_rows, approvals):
    images = images_by_mountain(image_rows)
    mountain_ids = {row["id"] for row in mountain_rows}

    orphans = sorted(str(mountain_id) for mountain_id in images.keys() - mountain_ids)
    if orphans:
        raise ExportError(f"media rows reference unknown mountains {orphans}")

    unmatched = sorted(approvals.keys() - {row["slug"] for row in mountain_rows})
    if unmatched:
        raise ExportError(f"media entries reference unknown slugs {unmatched}")

    mountains = [
        exported_mountain(row, images.get(row["id"]), approvals.get(row["slug"]))
        for row in sorted(mountain_rows, key=lambda row: row["slug"])
    ]
    discoveries = [
        {
            "date": row["date"].isoformat(),
            "mountain_id": str(row["mountain_id"]),
            "created_at": timestamp(row["created_at"]),
        }
        for row in sorted(discovery_rows, key=lambda row: row["date"])
    ]

    return {"mountains": mountains, "daily_discoveries": discoveries}


def build_artifact(content, manifest_raw, exported_on):
    mountains = content["mountains"]
    return {
        "format": SEED_FORMAT,
        "format_version": SEED_FORMAT_VERSION,
        "exported_on": exported_on.isoformat(),
        "source": {
            "tag": LEGACY_TAG,
            "commit": LEGACY_COMMIT,
            "database_schema_version": LEGACY_SCHEMA_VERSION,
            "media_manifest": {
                "path": MEDIA_MANIFEST_PATH,
                "sha256": hashlib.sha256(manifest_raw).hexdigest(),
            },
        },
        "counts": {
            "mountains": len(mountains),
            "mountain_images": sum(mountain["image"] is not None for mountain in mountains),
            "media_approvals": sum(
                mountain["image"] is not None and mountain["image"]["approved_on"] is not None
                for mountain in mountains
            ),
            "daily_discoveries": len(content["daily_discoveries"]),
        },
        "content_sha256": content_sha256(content),
        "content": content,
    }


def render_artifact(artifact):
    return (json.dumps(artifact, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode(
        "utf-8"
    )


def export(database_url, legacy_repository, exported_on):
    manifest_raw = legacy_repository.media_manifest()
    approvals = parse_media_manifest(manifest_raw)

    with read_only_snapshot(database_url) as database:
        check_legacy_schema(database)
        content = build_content(
            database.mountains(),
            database.images(),
            database.discoveries(),
            approvals,
        )

    return render_artifact(build_artifact(content, manifest_raw, exported_on))


def parse_arguments(argv):
    parser = argparse.ArgumentParser(
        description="Export the frozen legacy catalog into the seed artifact."
    )
    parser.add_argument("--legacy-repo", required=True, type=Path)
    parser.add_argument("--database-url", default=os.environ.get("LEGACY_DATABASE_URL"))
    parser.add_argument("--output", default=DEFAULT_OUTPUT, type=Path)
    parser.add_argument(
        "--exported-on",
        default=datetime.now(UTC).date(),
        type=date.fromisoformat,
        help="export date recorded in the metadata (default: today in UTC)",
    )
    arguments = parser.parse_args(argv)
    if not arguments.database_url:
        parser.error("--database-url or LEGACY_DATABASE_URL is required")

    return arguments


def main(argv=None):
    arguments = parse_arguments(argv)
    try:
        rendered = export(
            arguments.database_url,
            LegacyRepository(arguments.legacy_repo),
            arguments.exported_on,
        )
    except ExportError as error:
        print(f"export failed: {error}", file=sys.stderr)
        return 1

    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_bytes(rendered)
    print(f"wrote {arguments.output} ({hashlib.sha256(rendered).hexdigest()})")

    return 0


if __name__ == "__main__":
    sys.exit(main())

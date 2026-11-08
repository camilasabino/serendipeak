import io
import json
import stat

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from config import composition
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.models import (
    MountainCountryRecord,
    MountainImageRecord,
    MountainRecord,
    MountainRegionRecord,
)
from tests.support.snapshots import varied_catalog

pytestmark = pytest.mark.django_db


def run(command, *arguments):
    stdout, stderr = io.StringIO(), io.StringIO()
    call_command(command, *arguments, stdout=stdout, stderr=stderr)

    return stdout.getvalue(), stderr.getvalue()


def failure(command, *arguments):
    stderr = io.StringIO()
    with pytest.raises(CommandError) as raised:
        call_command(command, *arguments, stdout=io.StringIO(), stderr=stderr)

    return str(raised.value), stderr.getvalue()


def checksum_of(stdout):
    return next(
        line.removeprefix("content_sha256: ")
        for line in stdout.splitlines()
        if line.startswith("content_sha256: ")
    )


def empty_catalog():
    MountainImageRecord.objects.all().delete()
    MountainCountryRecord.objects.all().delete()
    MountainRecord.objects.all().delete()
    MountainRegionRecord.objects.filter(parent__isnull=False).delete()
    MountainRegionRecord.objects.all().delete()


@pytest.fixture
def source():
    DjangoCatalogStore().load(varied_catalog(with_discoveries=False))


@pytest.fixture
def exported(source, tmp_path):
    path = tmp_path / "catalog.json"
    stdout, _ = run("export_catalog_snapshot", "--output", str(path))

    return path, checksum_of(stdout)


def test_export_writes_a_private_file_and_reports_what_it_holds(source, tmp_path):
    path = tmp_path / "catalog.json"

    stdout, stderr = run("export_catalog_snapshot", "--output", str(path))

    assert stderr == ""
    assert "Source: database test_" in stdout
    assert "4 mountains (active 2, draft 1, inactive 1)" in stdout
    assert "Continents: EU 1, SA 3." in stdout
    assert "2 regions, 3 photographs (2 with media), 0 daily discoveries." in stdout
    assert f"Wrote {path.resolve()}" in stdout
    document = json.loads(path.read_text(encoding="utf-8"))
    assert document["content_sha256"] == checksum_of(stdout)
    assert stat.S_IMODE(path.stat().st_mode) == 0o600


def test_export_reports_every_exclusion_and_leaves_the_mountain_out(source, tmp_path):
    path = tmp_path / "catalog.json"

    stdout, _ = run(
        "export_catalog_snapshot", "--output", str(path), "--exclude-slug", "draft-peak"
    )

    assert "Excluded mountain: draft-peak." in stdout
    assert "3 mountains" in stdout
    slugs = [raw["slug"] for raw in json.loads(path.read_text())["content"]["mountains"]]
    assert "draft-peak" not in slugs


def test_export_reports_the_regions_an_exclusion_leaves_empty_and_can_leave_them_out(
    source, tmp_path
):
    first = tmp_path / "first.json"
    second = tmp_path / "second.json"

    exclusions = ["--exclude-slug", "tall-peak", "--exclude-slug", "pending-peak"]
    stdout, _ = run("export_catalog_snapshot", "--output", str(first), *exclusions)
    again, _ = run(
        "export_catalog_snapshot",
        "--output",
        str(second),
        *exclusions,
        "--exclude-region",
        "test-range",
    )

    assert "Region without mountains: test-range." in stdout
    assert "Excluded region: test-range." in again
    assert "without mountains" not in again
    regions = [raw["slug"] for raw in json.loads(second.read_text())["content"]["regions"]]
    assert regions == ["test-chain"]


def test_export_never_replaces_a_file(source, tmp_path):
    path = tmp_path / "catalog.json"
    path.write_text("keep me", encoding="utf-8")

    message, _ = failure("export_catalog_snapshot", "--output", str(path))

    assert "already exists" in message
    assert path.read_text(encoding="utf-8") == "keep me"


def test_export_refuses_a_path_inside_the_repository(source):
    inside = composition.SERVICE_ROOT / "private-snapshot.json"

    message, _ = failure("export_catalog_snapshot", "--output", str(inside))

    assert "inside the repository" in message
    assert not inside.exists()


def test_export_of_an_unknown_exclusion_writes_nothing(source, tmp_path):
    path = tmp_path / "catalog.json"

    message, _ = failure(
        "export_catalog_snapshot", "--output", str(path), "--exclude-slug", "missing-peak"
    )

    assert "no mountain has these slugs: missing-peak" in message
    assert not path.exists()


def test_a_snapshot_loads_into_an_empty_database_and_exports_the_same_checksum(exported, tmp_path):
    path, checksum = exported
    empty_catalog()

    stdout, stderr = run("load_catalog_snapshot", "--input", str(path), "--sha256", checksum)

    assert stderr == ""
    assert "Target: database test_" in stdout
    assert "Loaded and verified: the catalog matches the snapshot." in stdout
    again, _ = run("export_catalog_snapshot", "--output", str(tmp_path / "again.json"))
    assert checksum_of(again) == checksum


def test_a_snapshot_with_discoveries_verifies_against_the_database_it_came_from(tmp_path):
    DjangoCatalogStore().load(varied_catalog())
    path = tmp_path / "catalog.json"
    stdout, _ = run("export_catalog_snapshot", "--output", str(path), "--include-discoveries")
    checksum = checksum_of(stdout)
    assert "2 daily discoveries" in stdout

    verified, _ = run("verify_catalog_snapshot", "--input", str(path), "--sha256", checksum)

    assert "The catalog matches the snapshot." in verified
    assert "not compared" not in verified


def test_load_refuses_a_database_that_holds_mountains(exported):
    path, checksum = exported

    message, _ = failure("load_catalog_snapshot", "--input", str(path), "--sha256", checksum)

    assert message == "the catalog already holds mountains"
    assert MountainRecord.objects.count() == 4


def test_load_with_another_checksum_reads_and_writes_nothing(exported):
    path, _ = exported
    empty_catalog()

    message, _ = failure("load_catalog_snapshot", "--input", str(path), "--sha256", "0" * 64)

    assert "not the expected" in message
    assert MountainRecord.objects.count() == 0
    assert MountainRegionRecord.objects.count() == 0


def test_load_of_a_snapshot_that_was_edited_by_hand_writes_nothing(exported):
    path, checksum = exported
    document = json.loads(path.read_text(encoding="utf-8"))
    document["content"]["mountains"][0]["elevation_meters"] += 1
    path.write_text(json.dumps(document), encoding="utf-8")
    empty_catalog()

    message, _ = failure("load_catalog_snapshot", "--input", str(path), "--sha256", checksum)

    assert "does not match the content" in message
    assert MountainRecord.objects.count() == 0


def test_load_of_a_file_that_is_not_json_names_the_file(tmp_path):
    path = tmp_path / "catalog.json"
    path.write_text("not json", encoding="utf-8")

    message, _ = failure("load_catalog_snapshot", "--input", str(path), "--sha256", "0" * 64)

    assert f"cannot read {path}" in message


def test_verify_reports_a_catalog_that_drifted_from_the_snapshot(exported):
    path, checksum = exported
    MountainRecord.objects.filter(slug="tall-peak").update(elevation_meters=1)

    message, stderr = failure("verify_catalog_snapshot", "--input", str(path), "--sha256", checksum)

    assert message == "the stored catalog does not match the snapshot"
    assert "mountain tall-peak" in stderr
    assert "differs in elevation_meters" in stderr


def test_verify_says_when_it_did_not_compare_discoveries(exported):
    path, checksum = exported

    stdout, _ = run("verify_catalog_snapshot", "--input", str(path), "--sha256", checksum)

    assert "Daily discoveries: not compared (the snapshot carries none)." in stdout
    assert "The catalog matches the snapshot." in stdout

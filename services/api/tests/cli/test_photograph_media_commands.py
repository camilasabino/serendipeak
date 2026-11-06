import hashlib
import io
import json

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from PIL import Image

from config import composition
from serendipeak.catalog.bootstrap.photograph_manifest import (
    ManifestPhotograph,
    PhotographManifest,
    photograph_manifest_document,
)
from serendipeak.catalog.entities import ImageDimensions
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.models import MountainImageRecord
from tests.support.catalog import catalog_seed, primary_image, seeded_mountain

pytestmark = pytest.mark.django_db

ACONCAGUA_URL = "https://upload.wikimedia.org/wikipedia/commons/4/4e/Aconcagua2016.jpg"
FUJI_URL = "https://upload.wikimedia.org/wikipedia/commons/1/1b/Fuji.jpg"
ACONCAGUA = seeded_mountain(
    "aconcagua",
    file_url=ACONCAGUA_URL,
    primary_image=primary_image(media=None, dimensions=ImageDimensions(64, 48)),
)
FUJI = seeded_mountain(
    "fuji",
    file_url=FUJI_URL,
    primary_image=primary_image(media=None, dimensions=ImageDimensions(40, 30)),
)


def jpeg(size, colour=(40, 90, 160)):
    buffer = io.BytesIO()
    Image.new("RGB", size, colour).save(buffer, format="JPEG")
    return buffer.getvalue()


ACONCAGUA_FILE = jpeg((64, 48))
FUJI_FILE = jpeg((40, 30))


def cache_path(cache, url):
    return cache / hashlib.sha256(url.encode()).hexdigest()


@pytest.fixture
def cache(tmp_path):
    directory = tmp_path / "cache"
    directory.mkdir()
    cache_path(directory, ACONCAGUA_URL).write_bytes(ACONCAGUA_FILE)
    cache_path(directory, FUJI_URL).write_bytes(FUJI_FILE)
    return directory


def pin(entry, data, **overrides):
    image = entry.mountain.primary_image
    fields = {
        "mountain_id": entry.mountain.id,
        "slug": entry.mountain.slug,
        "source_identifier": image.source_identifier,
        "file_url": entry.image_provenance.legacy_file_url,
        "sha256": hashlib.sha256(data).hexdigest(),
        "bytes": len(data),
        "dimensions": image.dimensions,
    }
    fields.update(overrides)

    return ManifestPhotograph(**fields)


def write_manifest(path, *photographs):
    document = photograph_manifest_document(PhotographManifest(photographs))
    path.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    return path


@pytest.fixture
def committed_manifest(monkeypatch, tmp_path):
    path = write_manifest(
        tmp_path / "committed-manifest.json",
        pin(ACONCAGUA, ACONCAGUA_FILE),
        pin(FUJI, FUJI_FILE),
    )
    monkeypatch.setattr(composition, "PHOTOGRAPH_MANIFEST_PATH", path)

    return path


@pytest.fixture
def media_root(settings, tmp_path, committed_manifest):
    settings.MEDIA_STORE = "filesystem"
    settings.MEDIA_ROOT = tmp_path / "media"
    DjangoCatalogStore().load(catalog_seed(ACONCAGUA, FUJI))
    return settings.MEDIA_ROOT


def run(command, *arguments):
    stdout, stderr = io.StringIO(), io.StringIO()
    call_command(command, *arguments, stdout=stdout, stderr=stderr)
    return stdout.getvalue().splitlines(), stderr.getvalue().splitlines()


def failure(command, *arguments):
    stdout, stderr = io.StringIO(), io.StringIO()
    with pytest.raises(CommandError) as raised:
        call_command(command, *arguments, stdout=stdout, stderr=stderr)
    return str(raised.value), stdout.getvalue().splitlines(), stderr.getvalue().splitlines()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def stored_files(root):
    return sorted(str(path.relative_to(root)) for path in root.rglob("*") if path.is_file())


def test_materialization_stores_attaches_and_reports_every_photograph(media_root, cache):
    stdout, stderr = run("materialize_photographs", "--cache-dir", str(cache))

    assert (
        stdout[0]
        == f"aconcagua: materialized (0.0 MiB, 64x48, sha256 {digest(ACONCAGUA_FILE)[:12]})"
    )
    assert stdout[1].startswith("fuji: materialized (0.0 MiB, 40x30")
    assert stdout[2] == "2 photographs: 2 materialized, 0 verified, 0 already attached, 0 failed."
    assert stdout[3] == f"Largest source file: aconcagua, {len(ACONCAGUA_FILE)} bytes (0.0 MiB)."
    assert stderr == []
    assert f"originals/photographs/{digest(FUJI_FILE)}/original.jpg" in stored_files(media_root)
    assert len(stored_files(media_root)) == 6
    image = MountainImageRecord.objects.get(pk=FUJI.mountain.id)
    assert image.original_sha256 == digest(FUJI_FILE)


def test_a_rerun_reports_every_photograph_already_attached(media_root, cache):
    run("materialize_photographs", "--cache-dir", str(cache))

    stdout, _ = run("materialize_photographs", "--cache-dir", str(cache))

    assert stdout == [
        "aconcagua: already attached",
        "fuji: already attached",
        "2 photographs: 0 materialized, 0 verified, 2 already attached, 0 failed.",
    ]


def test_a_dry_run_stores_and_attaches_nothing(media_root, cache):
    stdout, _ = run("materialize_photographs", "--dry-run", "--cache-dir", str(cache))

    assert stdout[2] == "2 photographs: 0 materialized, 2 verified, 0 already attached, 0 failed."
    assert not media_root.exists()
    assert not MountainImageRecord.objects.filter(original_key__isnull=False).exists()


def test_a_failed_photograph_is_listed_and_the_command_exits_non_zero(media_root, cache):
    cache_path(cache, FUJI_URL).write_bytes(jpeg((41, 30)))

    message, stdout, stderr = failure("materialize_photographs", "--cache-dir", str(cache))

    assert message == "1 of 2 photographs failed: fuji"
    assert stdout[0].startswith("aconcagua: materialized")
    assert stderr == [
        "fuji: failed (0.0 MiB, 41x30, sha256 "
        f"{digest(cache_path(cache, FUJI_URL).read_bytes())[:12]};"
        " dimensions_differ: the file is 41x30, the photograph is 40x30)"
    ]


def test_a_local_file_replaces_the_download(media_root, cache, tmp_path):
    archived = tmp_path / "fuji-archived.jpg"
    archived.write_bytes(jpeg((40, 30), colour=(200, 10, 10)))
    cache_path(cache, FUJI_URL).unlink()
    revised = write_manifest(tmp_path / "revised.json", pin(FUJI, archived.read_bytes()))

    run(
        "materialize_photographs",
        "--slug",
        "fuji",
        "--file",
        f"fuji={archived}",
        "--cache-dir",
        str(cache),
        "--manifest",
        str(revised),
    )

    image = MountainImageRecord.objects.get(pk=FUJI.mountain.id)
    assert image.original_sha256 == digest(archived.read_bytes())


@pytest.mark.parametrize("value", ["fuji", "=path", "fuji="])
def test_a_malformed_file_option_is_refused(media_root, value):
    message, _, _ = failure("materialize_photographs", "--file", value)

    assert message == f"--file expects SLUG=PATH, not {value!r}"


def test_an_unknown_slug_is_refused_before_any_work(media_root, cache):
    message, stdout, _ = failure("materialize_photographs", "--slug", "k2")

    assert message == "no selected photograph has these slugs: k2"
    assert stdout == []


def test_the_committed_manifest_is_enforced_without_any_flag(media_root, cache):
    cache_path(cache, FUJI_URL).write_bytes(jpeg((40, 30), colour=(0, 0, 0)))

    message, _, stderr = failure("materialize_photographs", "--cache-dir", str(cache))

    assert message == "1 of 2 photographs failed: fuji"
    assert stderr[0].endswith("checksum_differs: the file is not the one in the manifest)")
    assert not MountainImageRecord.objects.filter(pk=FUJI.mountain.id, original_key__isnull=False)


def test_another_manifest_replaces_the_committed_one(media_root, cache, tmp_path):
    cache_path(cache, FUJI_URL).write_bytes(jpeg((40, 30), colour=(0, 0, 0)))
    revised = write_manifest(
        tmp_path / "revised.json",
        pin(ACONCAGUA, ACONCAGUA_FILE),
        pin(FUJI, cache_path(cache, FUJI_URL).read_bytes()),
    )

    stdout, _ = run(
        "materialize_photographs", "--cache-dir", str(cache), "--manifest", str(revised)
    )

    assert stdout[-2].startswith("2 photographs: 2 materialized")


def test_a_photograph_outside_the_manifest_needs_an_explicit_file_and_is_never_downloaded(
    media_root, tmp_path
):
    only_aconcagua = write_manifest(tmp_path / "one.json", pin(ACONCAGUA, ACONCAGUA_FILE))
    empty_cache = tmp_path / "empty-cache"
    empty_cache.mkdir()
    cache_path(empty_cache, ACONCAGUA_URL).write_bytes(ACONCAGUA_FILE)
    fuji_file = tmp_path / "fuji.jpg"
    fuji_file.write_bytes(FUJI_FILE)
    arguments = ("--cache-dir", str(empty_cache), "--manifest", str(only_aconcagua))

    message, _, stderr = failure("materialize_photographs", *arguments)

    assert message == "1 of 2 photographs failed: fuji"
    assert stderr == [
        "fuji: failed (the manifest has no photograph for this mountain; pass its file)"
    ]
    assert list(empty_cache.iterdir()) == [cache_path(empty_cache, ACONCAGUA_URL)]

    stdout, _ = run("materialize_photographs", *arguments, "--file", f"fuji={fuji_file}")

    assert stdout[0] == "aconcagua: already attached"
    assert stdout[1].startswith("fuji: materialized")


def test_a_manifest_that_cannot_be_read_stops_the_run_before_any_work(media_root, tmp_path):
    message, stdout, _ = failure(
        "materialize_photographs", "--manifest", str(tmp_path / "missing.json")
    )

    assert message.startswith(f"cannot read {tmp_path / 'missing.json'}")
    assert stdout == []


def test_a_manifest_of_the_run_is_written_to_a_new_file(media_root, cache, tmp_path):
    manifest = tmp_path / "manifest.json"
    stdout, _ = run(
        "materialize_photographs",
        "--dry-run",
        "--cache-dir",
        str(cache),
        "--write-manifest",
        str(manifest),
    )

    assert stdout[-1] == f"Manifest of 2 photographs written to {manifest}."
    document = json.loads(manifest.read_text(encoding="utf-8"))
    assert [entry["slug"] for entry in document["photographs"]] == ["aconcagua", "fuji"]
    assert document["photographs"][1]["sha256"] == digest(FUJI_FILE)


def test_writing_the_manifest_again_changes_nothing_when_it_is_the_same(
    media_root, cache, tmp_path
):
    manifest = tmp_path / "manifest.json"
    arguments = ("--dry-run", "--cache-dir", str(cache), "--write-manifest", str(manifest))
    run("materialize_photographs", *arguments)
    written = manifest.read_bytes()

    stdout, _ = run("materialize_photographs", *arguments)

    assert stdout[-1] == f"Manifest of 2 photographs already in {manifest}."
    assert manifest.read_bytes() == written


def test_a_manifest_holding_other_photographs_is_never_overwritten(media_root, cache, tmp_path):
    pinned = write_manifest(tmp_path / "pinned.json", pin(FUJI, b"the file pinned first"))
    before = pinned.read_bytes()

    message, _, _ = failure(
        "materialize_photographs",
        "--dry-run",
        "--cache-dir",
        str(cache),
        "--write-manifest",
        str(pinned),
    )

    assert message.startswith(f"{pinned} already exists with another manifest")
    assert pinned.read_bytes() == before


def test_writing_to_the_committed_manifest_leaves_it_untouched(
    media_root, cache, committed_manifest
):
    canonical = committed_manifest.read_bytes()

    stdout, _ = run(
        "materialize_photographs",
        "--dry-run",
        "--cache-dir",
        str(cache),
        "--write-manifest",
        str(committed_manifest),
    )

    assert stdout[-1] == f"Manifest of 2 photographs already in {committed_manifest}."
    assert committed_manifest.read_bytes() == canonical


def test_a_manifest_is_not_written_from_a_partial_run(media_root, cache, tmp_path):
    manifest = tmp_path / "manifest.json"

    message, _, _ = failure(
        "materialize_photographs",
        "--slug",
        "fuji",
        "--cache-dir",
        str(cache),
        "--write-manifest",
        str(manifest),
    )

    assert message.startswith("the manifest was not written")
    assert not manifest.exists()


def test_an_invalid_manifest_is_refused(media_root, tmp_path):
    manifest = tmp_path / "manifest.json"
    manifest.write_text('{"format": "other"}', encoding="utf-8")

    message, _, _ = failure("materialize_photographs", "--manifest", str(manifest))

    assert message.startswith("manifest: unexpected keys")


def test_media_checks_fail_until_the_catalog_is_materialized(media_root, cache):
    message, _, stderr = failure("check_photograph_media")

    assert message == "2 of 2 photographs have media problems"
    assert stderr == ["aconcagua: no media", "fuji: no media"]

    run("materialize_photographs", "--cache-dir", str(cache))

    assert run("check_photograph_media")[0] == [
        "2 photographs have complete media (media checked)."
    ]
    assert run("check_photograph_media", "--deep", "--checksums")[0] == [
        "2 photographs have complete media (checksums checked)."
    ]


def test_the_deep_check_reports_a_missing_rendition(media_root, cache):
    run("materialize_photographs", "--cache-dir", str(cache))
    (media_root / "public" / "photographs" / digest(FUJI_FILE) / "viewer-r2.jpg").unlink()

    assert run("check_photograph_media")[1] == []
    message, _, stderr = failure("check_photograph_media", "--deep")

    assert message == "1 of 2 photographs have media problems"
    assert stderr == ["fuji: the viewer rendition is missing"]


def test_the_checksum_check_reports_a_changed_original(media_root, cache):
    run("materialize_photographs", "--cache-dir", str(cache))
    original = media_root / "originals" / "photographs" / digest(FUJI_FILE) / "original.jpg"
    original.write_bytes(b"tampered")

    assert run("check_photograph_media", "--deep")[1] == []
    _, _, stderr = failure("check_photograph_media", "--checksums")

    assert stderr == ["fuji: the original does not match its checksum"]


def test_the_checks_compare_the_photographs_with_the_committed_manifest_without_any_flag(
    media_root, cache, tmp_path
):
    run("materialize_photographs", "--cache-dir", str(cache))
    revised = write_manifest(
        tmp_path / "revised.json",
        pin(ACONCAGUA, ACONCAGUA_FILE),
        pin(FUJI, b"the file pinned first"),
    )

    assert run("check_photograph_media", "--deep", "--checksums")[1] == []
    message, _, stderr = failure(
        "check_photograph_media", "--deep", "--checksums", "--manifest", str(revised)
    )

    assert message == "1 of 2 photographs have media problems"
    assert stderr == ["fuji: the stored original is not the one in the manifest"]


def test_the_checks_report_a_pinned_photograph_the_catalog_does_not_have(
    media_root, cache, committed_manifest
):
    run("materialize_photographs", "--cache-dir", str(cache))
    extra = pin(seeded_mountain("k2"), b"k2", dimensions=ImageDimensions(10, 10))
    write_manifest(committed_manifest, pin(ACONCAGUA, ACONCAGUA_FILE), pin(FUJI, FUJI_FILE), extra)

    message, _, stderr = failure("check_photograph_media")

    assert message == "1 of 2 photographs have media problems"
    assert stderr == ["k2: the manifest photograph is not in the catalog"]


def test_the_checks_stop_when_the_manifest_cannot_be_read(media_root, tmp_path):
    message, _, stderr = failure("check_photograph_media", "--manifest", str(tmp_path / "x.json"))

    assert message.startswith("cannot read")
    assert stderr == []

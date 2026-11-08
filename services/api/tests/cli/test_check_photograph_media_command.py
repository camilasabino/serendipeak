import hashlib
import io

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from PIL import Image

from config import composition
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from tests.support.catalog import catalog_of, mountain_without_media, primary_image, with_mountain

pytestmark = pytest.mark.django_db


def jpeg(size, colour):
    buffer = io.BytesIO()
    Image.new("RGB", size, colour).save(buffer, format="JPEG")

    return buffer.getvalue()


ACONCAGUA_FILE = jpeg((64, 48), (40, 90, 160))
FUJI_FILE = jpeg((40, 30), (160, 90, 40))


def digest(data):
    return hashlib.sha256(data).hexdigest()


def stored(slug, data):
    """A mountain whose photograph went through the same ingestion the Studio uses."""
    ingestion = composition.build_studio_photograph_ingestion()
    prepared = ingestion.prepare(data)
    entry = mountain_without_media(slug)
    image = primary_image(media=ingestion.store(prepared), dimensions=prepared.dimensions)

    return with_mountain(entry, primary_image=image)


@pytest.fixture
def media_root(settings, tmp_path):
    settings.MEDIA_STORE = "filesystem"
    settings.MEDIA_ROOT = tmp_path / "media"

    return settings.MEDIA_ROOT


@pytest.fixture
def catalog(media_root):
    DjangoCatalogStore().load(
        catalog_of(stored("aconcagua", ACONCAGUA_FILE), stored("fuji", FUJI_FILE))
    )


def run(*arguments):
    stdout, stderr = io.StringIO(), io.StringIO()
    call_command("check_photograph_media", *arguments, stdout=stdout, stderr=stderr)

    return stdout.getvalue().splitlines(), stderr.getvalue().splitlines()


def failure(*arguments):
    stderr = io.StringIO()
    with pytest.raises(CommandError) as raised:
        call_command("check_photograph_media", *arguments, stdout=io.StringIO(), stderr=stderr)

    return str(raised.value), stderr.getvalue().splitlines()


def test_a_catalog_without_media_fails_the_check(media_root):
    DjangoCatalogStore().load(
        catalog_of(mountain_without_media("aconcagua"), mountain_without_media("fuji"))
    )

    message, stderr = failure()

    assert message == "2 of 2 photographs have media problems"
    assert stderr == ["aconcagua: no media", "fuji: no media"]


def test_a_catalog_with_stored_media_passes_every_level_of_the_check(catalog):
    assert run()[0] == ["2 photographs have complete media (media checked)."]
    assert run("--deep")[0] == ["2 photographs have complete media (objects checked)."]
    assert run("--deep", "--checksums")[0] == [
        "2 photographs have complete media (checksums checked)."
    ]


def test_the_deep_check_reports_a_missing_rendition(catalog, media_root):
    viewer = next((media_root / "public" / "photographs" / digest(FUJI_FILE)).glob("viewer-*.jpg"))
    viewer.unlink()

    assert run()[1] == []
    message, stderr = failure("--deep")

    assert message == "1 of 2 photographs have media problems"
    assert stderr == ["fuji: the viewer rendition is missing"]


def test_the_checksum_check_reports_a_changed_original(catalog, media_root):
    original = next(
        (media_root / "originals" / "photographs" / digest(FUJI_FILE)).glob("original*")
    )
    original.write_bytes(b"tampered")

    assert run("--deep")[1] == []
    _, stderr = failure("--checksums")

    assert stderr == ["fuji: the original does not match its checksum"]

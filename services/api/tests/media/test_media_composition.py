from config.composition import (
    STUDIO_INGESTION_LIMITS,
    build_check_photograph_media,
    build_media_store,
    build_studio_photograph_ingestion,
)
from serendipeak.catalog.bootstrap.check_photograph_media import CheckPhotographMedia
from serendipeak.media.filesystem_media_store import FilesystemMediaStore
from serendipeak.media.s3_media_store import S3MediaStore

MEBIBYTE = 1024 * 1024


def test_the_filesystem_store_is_built_under_the_media_root(settings, tmp_path):
    settings.MEDIA_STORE = "filesystem"
    settings.MEDIA_ROOT = tmp_path

    store = build_media_store()
    store.put_public(f"photographs/{'a' * 64}/page-r1.jpg", b"page", "image/jpeg")

    assert isinstance(store, FilesystemMediaStore)
    assert (tmp_path / "public" / "photographs" / ("a" * 64) / "page-r1.jpg").exists()


def test_the_s3_store_is_built_from_its_settings_without_contacting_it(settings):
    settings.MEDIA_STORE = "s3"
    settings.MEDIA_S3_ENDPOINT_URL = "https://account.r2.cloudflarestorage.example"
    settings.MEDIA_S3_ACCESS_KEY_ID = "access-key"
    settings.MEDIA_S3_SECRET_ACCESS_KEY = "secret-key"
    settings.MEDIA_PUBLIC_BUCKET = "photographs-public"
    settings.MEDIA_ORIGINALS_BUCKET = "photographs-originals"

    assert isinstance(build_media_store(), S3MediaStore)


def test_editors_have_a_byte_limit():
    assert STUDIO_INGESTION_LIMITS.max_bytes == 30 * MEBIBYTE


def test_the_studio_ingestion_is_built_with_its_limit(settings, tmp_path):
    settings.MEDIA_STORE = "filesystem"
    settings.MEDIA_ROOT = tmp_path

    assert build_studio_photograph_ingestion()._limits is STUDIO_INGESTION_LIMITS


def test_the_media_check_is_built_without_contacting_any_service(settings, tmp_path):
    settings.MEDIA_STORE = "filesystem"
    settings.MEDIA_ROOT = tmp_path

    assert isinstance(build_check_photograph_media(), CheckPhotographMedia)
